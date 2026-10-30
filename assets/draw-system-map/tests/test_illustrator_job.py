"""Preparation behavior only. These checks do not run Adobe Illustrator."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "scripts"))
from prepare_illustrator import MapError, prepare, tag


class IllustratorPreparationTests(unittest.TestCase):
    def test_job_retains_source_and_explicit_layers_without_claiming_native_export(self):
        source = SKILL / "assets/coastal-basemap-network.json"
        original = source.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "job"
            job = prepare(source, destination, "NotoSansCJKsc-Regular", "NotoSansCJKsc-Bold")
            self.assertEqual(json.loads((destination / "source.json").read_text()), json.loads(original))
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(job["status"], "prepared_not_native_verified")
            self.assertEqual(list(destination.glob("*.ai")), [])
            roles = [unit["layer"] for unit in job["units"]]
            self.assertLess(roles.index("Land and islands"), roles.index("Routes"))
            self.assertLess(roles.index("Routes"), roles.index("Station labels"))
            self.assertEqual([unit["group"] for unit in job["units"] if unit["layer"] == "Routes"], ["red", "blue"])
            for unit in job["units"]:
                svg = ET.parse(destination / unit["file"]).getroot()
                self.assertEqual(svg.get("width"), "1050pt")
                self.assertFalse(any(tag(node) == "image" for node in svg.iter()))
                # Every local clip reference must resolve inside its independent SVG.
                ids = {node.get("id") for node in svg.iter() if node.get("id")}
                for node in svg.iter():
                    clip = node.get("clip-path")
                    if clip:
                        self.assertIn(clip[5:-1], ids)

    def test_refuses_existing_outputs_and_invalid_source_without_partial_job(self):
        source = SKILL / "assets/minimal-network.json"
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            destination = folder / "existing"
            destination.mkdir()
            sentinel = destination / "network.ai"
            sentinel.write_bytes(b"existing user work")
            with self.assertRaises(MapError):
                prepare(source, destination, "Font")
            self.assertEqual(sentinel.read_bytes(), b"existing user work")
            bad_source = folder / "bad.json"
            bad_source.write_text('{"version": 1}')
            with self.assertRaises(MapError):
                prepare(bad_source, folder / "bad-job", "Font")
            self.assertFalse((folder / "bad-job").exists())
            for scale in [0, -1, float("nan"), float("inf"), True]:
                with self.subTest(scale=scale), self.assertRaises(MapError):
                    prepare(source, folder / "scaled", "Font", points_per_unit=scale)
            self.assertFalse((folder / "scaled").exists())
            for bad_font in ["", " Font", "Font\nName", "Font\x00Name", "Font\ud800", 1]:
                with self.subTest(font=repr(bad_font)), self.assertRaises(MapError):
                    prepare(source, folder / "bad-font", bad_font)
                with self.subTest(bold=repr(bad_font)), self.assertRaises(MapError):
                    prepare(source, folder / "bad-bold", "Font", bad_font)
            self.assertFalse((folder / "bad-font").exists())
            self.assertFalse((folder / "bad-bold").exists())

    def test_cli_prepares_a_portable_job_from_an_unrelated_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "my job"
            command = [sys.executable, str(SKILL / "scripts/prepare_illustrator.py"),
                       str(SKILL / "assets/metro-style-network.json"), "--output-dir", str(output),
                       "--font-name", "NotoSansCJKsc-Regular"]
            result = subprocess.run(command, cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertTrue(all((output / unit["file"]).is_file() for unit in manifest["units"]))
            self.assertNotIn(directory, (output / "run-export.jsx").read_text())

    def test_split_layers_recompose_to_the_same_pixels(self):
        try:
            import gi
            gi.require_version("Rsvg", "2.0")
            from gi.repository import Rsvg
        except (ImportError, ValueError):
            self.skipTest("Optional SVG split regression requires PyGObject/librsvg")
        for name in ["coastal-basemap", "inland-basemap", "metro-style"]:
            with self.subTest(template=name), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory) / "job"
                job = prepare(SKILL / f"assets/{name}-network.json", folder, "NotoSansCJKsc-Regular")
                original = ET.parse(folder / "bridge.svg").getroot()
                merged = ET.Element(original.tag, original.attrib)
                for index, unit in enumerate(job["units"]):
                    root = ET.parse(folder / unit["file"]).getroot()
                    for child in root:
                        if tag(child) != "defs" or index == 0:
                            merged.append(copy.deepcopy(child))
                def pixels(root):
                    return bytes(Rsvg.Handle.new_from_data(ET.tostring(root)).get_pixbuf().get_pixels())
                expected, actual = pixels(original), pixels(merged)
                self.assertEqual(len(expected), len(actual))
                self.assertLessEqual(max(abs(a - b) for a, b in zip(expected, actual)), 1)


if __name__ == "__main__":
    unittest.main()
