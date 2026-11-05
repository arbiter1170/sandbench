// Team skills (SB-08): `<dir>/.claude/skills/<name>/SKILL.md`, where dir is SANDBENCH_TEAM_DIR (a
// read-only checkout of the private team repo). Read on every call, no cache, so editing a skill
// changes the next turn without a redeploy. Claude Code finds these itself when its working folder
// holds `.claude/`; the load_skill tool for the API drivers (SB-10) calls loadSkill.
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;
const MAX_SKILL = 64 * 1024;

/** Reads `name:` and `description:` from front matter; else the folder name and first body line. */
export function parseSkill(name, raw) {
  const meta = {};
  let body = raw;
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (front) {
    body = raw.slice(front[0].length);
    for (const line of front[1].split(/\r?\n/)) {
      const pair = /^(name|description):\s*(.*)$/i.exec(line);
      if (pair) meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  return { name: meta.name || name, description: (meta.description || firstLine.replace(/^#+\s*/, "")).slice(0, 500) };
}

export function createSkills({ dir } = {}) {
  const root = dir ? path.join(dir, ".claude", "skills") : "";

  // A real folder directly under skills/ holding a real SKILL.md, whose real path stays inside.
  function skillFile(name) {
    if (!root || typeof name !== "string" || !NAME.test(name)) return null;
    const folder = path.join(root, name);
    const file = path.join(folder, "SKILL.md");
    try {
      if (!lstatSync(folder).isDirectory() || !lstatSync(file).isFile()) return null;
      const realRoot = realpathSync(root);
      const inside = path.relative(realRoot, realpathSync(file));
      if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
    } catch {
      return null;
    }
    return file;
  }

  /** [{ name, description }] for the prompt's skills index; [] when there is no team folder. */
  function index() {
    if (!root) return [];
    let names;
    try {
      names = readdirSync(root).sort();
    } catch {
      return [];
    }
    return names.flatMap((folder) => {
      const file = skillFile(folder);
      return file ? [{ ...parseSkill(folder, readFileSync(file, "utf8").slice(0, MAX_SKILL)), name: folder }] : [];
    });
  }

  /** { name, description, body }, read fresh; null for a missing or refused name. */
  function loadSkill(name) {
    const file = skillFile(name);
    if (!file) return null;
    const body = readFileSync(file, "utf8").slice(0, MAX_SKILL);
    return { ...parseSkill(name, body), name, body };
  }

  return { index, loadSkill };
}
