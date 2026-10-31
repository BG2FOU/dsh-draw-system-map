import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { apply, inject, name } from "../lib/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILL_DIR = join(ROOT, "assets", "draw-system-map");
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");

/** Mount the plugin against a minimal fake context and return its provider. */
function mount() {
  const factories = [];
  const ctx = {
    skills: {
      registerProvider(factory) {
        factories.push(factory);
      },
    },
  };

  apply(ctx);

  assert.equal(factories.length, 1, "apply() must register exactly one provider");
  return factories[0]();
}

/** Read the raw SKILL.md once for comparisons. */
const rawSkill = await readFile(SKILL_FILE, "utf8");

test("declares the expected plugin metadata", () => {
  assert.equal(name, "dsh-skill-draw-system-map");
  assert.deepEqual(inject, ["skills"]);
});

test("lists one bundled draw-system-map candidate", async () => {
  const provider = mount();
  assert.equal(typeof provider.name, "string");
  assert.match(provider.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

  const candidates = await provider.list();
  assert.equal(candidates.length, 1);

  const [candidate] = candidates;
  assert.equal(candidate.name, "draw-system-map");
  assert.equal(candidate.source, "bundled");
  assert.equal(candidate.provider, provider.name);
  assert.equal(candidate.rank, 600);
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });

  // The description must be the real frontmatter value, not a placeholder.
  const descriptionValue = /^description:\s*(.*)$/mu.exec(rawSkill)[1].trim();
  const expectedDescription = descriptionValue.startsWith('"')
    ? JSON.parse(descriptionValue)
    : descriptionValue.replace(/^'(.*)'$/u, "$1");
  assert.equal(candidate.description, expectedDescription);

  assert.equal(candidate.resourceBase.kind, "directory");
  assert.equal(candidate.resourceBase.path, SKILL_DIR.split("\\").join("/"));
  assert.ok(!candidate.resourceBase.path.includes("\\"));

  assert.equal(candidate.locator, candidate.path);
  assert.equal(candidate.path, SKILL_FILE);
  assert.ok(existsSync(candidate.path));
});

test("ships the complete skill payload", () => {
  const required = [
    "SKILL.md",
    "README.md",
    "references/basemap-guide.md",
    "references/data-format.md",
    "references/drawing-guide.md",
    "references/import-guide.md",
    "references/import-validation.md",
    "references/roadmap.md",
    "references/source-data-format.md",
    "references/style-rules.md",
    "scripts/basemap.py",
    "scripts/create_map.py",
    "scripts/draw_map.py",
    "scripts/export_png.py",
    "scripts/import_gtfs.py",
    "scripts/layout_network.py",
    "scripts/network_topology.py",
    "scripts/parallel_tracks.py",
    "scripts/schematic_layout.py",
    "assets/minimal-network.json",
    "assets/metro-style-network.json",
    "assets/import-examples/station-sequences.csv",
    "assets/previews/metro-style.svg",
    "tests/test_draw_map.py",
    "tests/test_layout_network.py",
    "tests/test_parallel_tracks.py",
    "tests/test_reference_markers.py",
    "tests/test_schematic_layout.py",
    "tests/test_station_offsets.py",
  ];

  for (const relative of required) {
    assert.ok(existsSync(join(SKILL_DIR, relative)), `missing skill payload file: ${relative}`);
  }
});

test("does not ship generated map output", () => {
  assert.equal(existsSync(join(SKILL_DIR, "output")), false);
});

test("loads the body without frontmatter", async () => {
  const provider = mount();
  const [candidate] = await provider.list();
  const definition = await provider.get(candidate);

  assert.equal(definition.name, "draw-system-map");
  assert.equal(definition.provider, candidate.provider);
  assert.equal(definition.source, "bundled");
  assert.deepEqual(definition.resourceBase, candidate.resourceBase);
  assert.equal(definition.path, SKILL_FILE);

  const expectedBody = rawSkill.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "").trim();
  assert.equal(definition.content, expectedBody);
  assert.ok(definition.content.startsWith("# 绘制通用线网示意图"));
  assert.ok(!definition.content.startsWith("---"));
  assert.ok(definition.content.includes("scripts/draw_map.py"));
});

test("every relative markdown link in SKILL.md resolves inside the payload", async () => {
  const provider = mount();
  const [candidate] = await provider.list();
  const definition = await provider.get(candidate);

  const targets = [...definition.content.matchAll(/\]\(([^)\s]+)\)/gu)].map((match) => match[1]);
  assert.ok(targets.length >= 5, "expected the skill body to link its references and examples");

  for (const target of targets) {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("#")) continue;
    const relative = target.replace(/^<|>$/gu, "");
    assert.ok(existsSync(join(SKILL_DIR, relative)), `broken relative link: ${target}`);
  }
});

test("ignores candidates from other providers", async () => {
  const provider = mount();
  assert.equal(await provider.get({ locator: "/tmp/not-our-skill" }), undefined);
  assert.equal(await provider.get({}), undefined);
});

test("respects an aborted load signal", async () => {
  const provider = mount();
  const [candidate] = await provider.list();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(provider.get(candidate, { signal: controller.signal }), {
    name: "AbortError",
  });
});
