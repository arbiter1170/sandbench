// Team skills (SB-08): `.claude/skills/<name>/SKILL.md` in the team checkout
// (SANDBENCH_TEAM_DIR). Nothing is cached, so an edit to a skill file changes what the next
// call returns without a redeploy. Claude Code finds these itself when its working folder
// holds `.claude/`; the load_skill tool for the API drivers (SB-10) calls loadSkill.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_SKILL = 64 * 1024;

// A plain folder holding a plain SKILL.md: no symlinks, so a skill can't point outside.
function skillFile(dir, name) {
  if (typeof name !== "string" || !NAME.test(name) || name.includes("..")) return null;
  const folder = path.join(dir, name);
  const file = path.join(folder, "SKILL.md");
  try {
    if (!lstatSync(folder).isDirectory() || !lstatSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return file;
}

// Reads `name:` and `description:` from YAML front matter, else the heading and first line.
export function parseSkill(name, raw) {
  const meta = {};
  let body = raw;
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (front) {
    body = raw.slice(front[0].length);
    for (const line of front[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
      if (pair) meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#")) ?? "";
  return {
    name,
    title: meta.name || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || name,
    description: (meta.description || firstLine).slice(0, 500),
  };
}

export function createSkills({ teamDir }) {
  const dir = teamDir ? path.join(teamDir, ".claude", "skills") : "";

  /** Name and description of every skill, for the prompt's index. */
  function listSkills() {
    if (!dir) return [];
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return [];
    }
    const skills = [];
    for (const name of names) {
      const file = skillFile(dir, name);
      if (!file) continue;
      const { title, description } = parseSkill(name, readFileSync(file, "utf8").slice(0, MAX_SKILL));
      skills.push({ name, title, description });
    }
    return skills;
  }

  /** The whole skill, read fresh. Throws for anything that isn't a plain skill folder. */
  function loadSkill(name) {
    const file = dir ? skillFile(dir, name) : null;
    if (!file) throw new Error("No such skill.");
    const body = readFileSync(file, "utf8").slice(0, MAX_SKILL);
    return { ...parseSkill(name, body), body };
  }

  return { listSkills, loadSkill };
}
