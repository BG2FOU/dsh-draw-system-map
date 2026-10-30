/**
 * DSH skill provider for the bundled `draw-system-map` skill.
 *
 * The skill is plain Markdown plus Python scripts. This module only exposes it
 * to the harness, so it imports nothing but Node built-ins: the package stays
 * installable via `link:` without pulling anything into the profile.
 *
 * @module dsh-skill-draw-system-map
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Plugin id; equals the npm package name. */
export const name = "dsh-skill-draw-system-map";

/** Wait for the skill registry before registering the provider. */
export const inject = ["skills"];

/** Skill identifier; must stay kebab-case and match SKILL.md frontmatter. */
const SKILL_NAME = "draw-system-map";

/** Provider id; unique per provider and stable across releases. */
const PROVIDER_NAME = "dsh-draw-system-map";

/**
 * Bundled skills use rank 600 (`BUNDLED_SKILL_RANK` in @deepseek-ai/dsh-skill).
 * Repeated as a literal so this package has zero dependencies.
 */
const BUNDLED_SKILL_RANK = 600;

const SKILL_DIR = resolve(fileURLToPath(new URL("../assets/draw-system-map/", import.meta.url)));
const SKILL_PATH = join(SKILL_DIR, "SKILL.md");

/** Directory shown to the model as the base for relative paths in SKILL.md. */
const RESOURCE_BASE = Object.freeze({
  kind: "directory",
  path: SKILL_DIR.split(sep).join("/"),
});

/**
 * Parse the small YAML subset used by skill frontmatter: top-level scalar
 * keys, quoted strings, folded/literal blocks, and continuation lines.
 *
 * @param {string} raw file contents
 * @param {string} file path used in error messages
 * @returns {{ fields: Map<string, string>, content: string }}
 */
function parseSkillFile(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (match === null) {
    throw new Error(`${name}: ${file} must start with a --- frontmatter block`);
  }

  /** @type {Map<string, string>} */
  const fields = new Map();
  let key;
  for (const line of match[1].split(/\r?\n/u)) {
    const entry = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/u.exec(line);
    if (entry !== null) {
      key = entry[1];
      fields.set(key, entry[2] ?? "");
    } else if (key !== undefined && line.trim() !== "") {
      fields.set(key, `${fields.get(key)}\n${line.trim()}`);
    }
  }

  return { fields, content: raw.slice(match[0].length).trim() };
}

/**
 * Convert a raw frontmatter value to a plain string. Handles the block
 * scalars (`>` and `|`) whose continuation lines were joined by
 * {@link parseSkillFile}.
 *
 * @param {string} value raw value
 * @returns {string}
 */
function parseScalar(value) {
  const lines = value.split("\n");
  const head = (lines.shift() ?? "").trim();

  if (/^[>|][+-]?$/u.test(head)) {
    const block = lines.map((line) => line.trim()).filter(Boolean);
    return block.join(head.startsWith(">") ? " " : "\n");
  }
  if (head.length > 1 && head.startsWith('"') && head.endsWith('"')) {
    try {
      return JSON.parse(head);
    } catch {
      return head.slice(1, -1);
    }
  }
  if (head.length > 1 && head.startsWith("'") && head.endsWith("'")) {
    return head.slice(1, -1).replaceAll("''", "'");
  }
  return head;
}

/**
 * Validate a skill file and split it into metadata and body.
 *
 * @param {string} raw file contents
 * @param {string} file path used in error messages
 * @returns {{ description: string, content: string }}
 */
function readSkill(raw, file) {
  const { fields, content } = parseSkillFile(raw, file);
  const skillName = parseScalar(fields.get("name") ?? "");
  const description = parseScalar(fields.get("description") ?? "");

  if (skillName !== SKILL_NAME) {
    throw new Error(`${name}: ${file} declares name "${skillName}", expected "${SKILL_NAME}"`);
  }
  if (description === "") {
    throw new Error(`${name}: ${file} needs a non-empty description`);
  }
  return { description, content };
}

/**
 * Build the discovery candidate for the bundled skill.
 *
 * @param {string} description frontmatter description
 * @returns {object}
 */
function createCandidate(description) {
  return {
    name: SKILL_NAME,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: "bundled",
    provider: PROVIDER_NAME,
    rank: BUNDLED_SKILL_RANK,
    resourceBase: { ...RESOURCE_BASE },
    locator: SKILL_PATH,
    path: SKILL_PATH,
  };
}

/**
 * Build the skill provider registered with `ctx.skills`.
 *
 * @param {string} description frontmatter description captured at apply time
 * @returns {{ name: string, list: () => Promise<object[]>, get: (candidate: object, options?: { signal?: AbortSignal }) => Promise<object | undefined> }}
 */
function createProvider(description) {
  const candidate = createCandidate(description);

  return {
    name: PROVIDER_NAME,

    async list() {
      return [candidate];
    },

    async get(selected, options = {}) {
      if (selected.locator !== SKILL_PATH) return undefined;

      // Re-read on every load so body/reference edits apply without a restart.
      const raw = await readFile(SKILL_PATH, { encoding: "utf8", signal: options.signal });
      const { description: current, content } = readSkill(raw, SKILL_PATH);

      return {
        name: SKILL_NAME,
        description: current,
        invocation: { ...candidate.invocation },
        source: candidate.source,
        provider: PROVIDER_NAME,
        resourceBase: { ...RESOURCE_BASE },
        content,
        path: SKILL_PATH,
      };
    },
  };
}

/**
 * Register the bundled skill. Fails fast when the payload is missing or the
 * frontmatter no longer matches {@link SKILL_NAME}.
 *
 * @param {object} ctx plugin context
 */
export function apply(ctx) {
  const { description } = readSkill(readFileSync(SKILL_PATH, "utf8"), SKILL_PATH);
  const provider = createProvider(description);
  ctx.skills.registerProvider(() => provider);
}
