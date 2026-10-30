#!/usr/bin/env python3
"""Prepare a portable Illustrator import job; does not produce or claim a native AI file."""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET

from draw_map import MapError, render

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
DRAWABLE = {"path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text"}


def tag(node):
    return node.tag.rsplit("}", 1)[-1]


def units(root):
    """Yield paint order with native layer/group names, without changing geometry."""
    for child in root:
        if tag(child) == "rect":
            yield "Background", "Canvas", child
        elif tag(child) == "g":
            for group in child:
                identifier = group.get("id")
                if identifier == "basemap":
                    for part in group:
                        pid = part.get("id")
                        if pid == "basemap-background":
                            yield "Basemap background", "Water background", part
                        elif pid in ("basemap-land", "basemap-admin", "basemap-water", "basemap-boundary"):
                            role = {"basemap-land": "Land and islands", "basemap-admin": "Administrative fills",
                                    "basemap-water": "Water and rivers", "basemap-boundary": "Boundaries"}[pid]
                            for feature in part:
                                yield role, feature.get("data-feature"), feature
                        elif pid == "basemap-labels":
                            yield "Geographic labels", "Regional names", part
                elif identifier == "routes":
                    for route in group:
                        yield "Routes", route.get("data-route"), route
                else:
                    role = {"regions": "Legacy regions", "stations": "Stations", "labels": "Station labels",
                            "heading": "Heading", "legend": "Legend", "annotations": "Notes"}.get(identifier)
                    if role:
                        yield role, role, group


def isolate(root, selected):
    """Keep the selected subtree plus its styled/clipped ancestors and all defs."""
    def prune(node):
        if node is selected:
            return copy.deepcopy(node)
        result = ET.Element(node.tag, node.attrib)
        for child in node:
            if tag(child) == "defs":
                continue
            kept = prune(child)
            if kept is not None:
                result.append(kept)
        return result if len(result) else None

    result = prune(root)
    definitions = ET.Element(f"{{{NS}}}defs")
    for node in root.iter():
        if tag(node) == "defs":
            definitions.extend(copy.deepcopy(list(node)))
    if len(definitions):
        result.insert(0, definitions)
    return result


def prepare(source, destination, font_name, bold_font_name=None, points_per_unit=.75):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists():
        raise MapError("Job directory already exists; use a new directory to preserve existing work")
    bold_font_name = font_name if bold_font_name is None else bold_font_name
    for name in (font_name, bold_font_name):
        if (not isinstance(name, str) or not name.strip() or name != name.strip()
                or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF
                       or ord(char) in (0xFFFE, 0xFFFF) for char in name)):
            raise MapError("Use a nonempty Illustrator PostScript font name without control characters or surrounding spaces")
    if isinstance(points_per_unit, bool) or not math.isfinite(points_per_unit) or points_per_unit <= 0:
        raise MapError("points_per_unit must be a finite positive number")
    data = json.loads(source.read_text(encoding="utf-8"))
    svg = render(data)
    root = ET.fromstring(svg)
    width, height = float(root.get("width")), float(root.get("height"))
    if max(width, height) * points_per_unit > 16383:
        raise MapError("AI job exceeds the standard artboard range; reduce points_per_unit")
    root.set("width", f"{width * points_per_unit:.8g}pt")
    root.set("height", f"{height * points_per_unit:.8g}pt")
    # Resolve the chosen font explicitly, rather than relying on SVG CSS fallbacks.
    for node in root.iter():
        if "font-family" in node.attrib:
            node.set("font-family", font_name)
        if tag(node) == "text":
            bold = node.get("font-weight") in ("bold", "600", "700", "800", "900")
            node.set("font-family", bold_font_name if bold else font_name)
            node.attrib.pop("font-weight", None)

    job = {"version": 1, "status": "prepared_not_native_verified", "output": "network.ai",
           "width_points": width * points_per_unit, "height_points": height * points_per_unit,
           "points_per_unit": points_per_unit, "fonts": sorted({font_name, bold_font_name}), "units": []}
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".illustrator-job-", dir=destination.parent))
    try:
        (temporary / "layers").mkdir()
        (temporary / "source.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (temporary / "artwork.svg").write_text(svg, encoding="utf-8")
        ET.ElementTree(root).write(temporary / "bridge.svg", encoding="utf-8", xml_declaration=True)
        for layer, name, selected in units(root):
            visible = [n for n in selected.iter() if tag(n) in DRAWABLE]
            if not visible:
                continue
            filename = f"layers/{len(job['units']):03d}.svg"
            extracted = isolate(root, selected)
            ET.ElementTree(extracted).write(temporary / filename, encoding="utf-8", xml_declaration=True)
            text = [n.text for n in selected.iter() if tag(n) in ("text", "tspan") and n.text]
            job["units"].append({"layer": layer, "group": name, "file": filename,
                                 "text": text, "source_objects": len(visible)})
        (temporary / "manifest.json").write_text(json.dumps(job, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for name in ("export_ai.jsx", "inspect_environment.jsx"):
            shutil.copy2(Path(__file__).parent / "illustrator" / name, temporary / name)
        # JSON is embedded as data, ASCII-escaped so names cannot terminate JS strings.
        launch = ('#target illustrator\n(function () {\nvar root = new File($.fileName).parent;\n'
                  '$.evalFile(new File(root.fsName + "/export_ai.jsx"));\n'
                  'drawSystemMapExport(' + json.dumps(job, ensure_ascii=True) + ', root);\n}());\n')
        (temporary / "run-export.jsx").write_text(launch, encoding="utf-8")
        (temporary / "START-HERE.txt").write_text(
            "This is a prepared job, not an AI file.\n"
            "Copy this entire folder to a machine with Adobe Illustrator and the specified fonts.\n"
            "In Illustrator use File > Scripts > Other Script, then run run-export.jsx.\n"
            "The script refuses to overwrite network.ai or native-report.json. Use a new job for each attempt.\n"
            "Native checks and manual visual review are required.\n"
            "A successful report still records manual_review=pending. Keep source.json and artwork.svg.\n", encoding="utf-8")
        temporary.rename(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--font-name", required=True, help="Target Illustrator font PostScript name")
    parser.add_argument("--bold-font-name", help="Defaults to the same font; specify a bold font for bold headings")
    parser.add_argument("--points-per-unit", type=float, default=.75, help="Default 0.75 pt per SVG/CSS pixel")
    args = parser.parse_args()
    try:
        job = prepare(args.input, args.output_dir, args.font_name, args.bold_font_name, args.points_per_unit)
        print(f"Prepared {len(job['units'])} vector import units: {args.output_dir}; native AI export not yet run")
    except (MapError, OSError, ValueError, ET.ParseError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
