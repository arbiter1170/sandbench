import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseSkill } from "../skillLibrary.mjs";

test("a folded description (>-) over several lines becomes one summary", () => {
  const raw = [
    "---",
    "name: walklings-room-packet",
    "description: >-",
    "  Use when PixelPets Design writes a Walklings room reskin, layout change,",
    "  palette fix or interior expansion packet.",
    "---",
    "> **Local copy (walklings-team pack).** Synced for Claude Code.",
    "",
    "# Walklings room packet",
    "",
    "AGENTS.md rule 9 applies.",
  ].join("\n");
  const { title, summary } = parseSkill(raw, "walklings-room-packet");
  assert.equal(title, "Walklings room packet");
  assert.equal(summary, "Use when PixelPets Design writes a Walklings room reskin, layout change, palette fix or interior expansion packet.");
});

test("literal block, quoted and plain descriptions", () => {
  assert.equal(parseSkill("---\nname: a\ndescription: |\n  Line one.\n  Line two.\n---\n# A\n", "a").summary, "Line one. Line two.");
  assert.equal(parseSkill("---\nname: a\ndescription: 'It''s quoted: yes'\n---\n# A\n", "a").summary, "It's quoted: yes");
  assert.equal(parseSkill('---\nname: a\ndescription: "Say \\"hi\\""\n---\n# A\n', "a").summary, 'Say "hi"');
  assert.equal(parseSkill("---\nname: a\ndescription: Plain words here\n---\n# A\n", "a").summary, "Plain words here");
});

test("CRLF files parse the same as LF", () => {
  const lf = "---\nname: a\ndescription: >-\n  Two\n  lines.\n---\n# Title\nBody\n";
  assert.deepEqual(parseSkill(lf.replace(/\n/g, "\r\n"), "a"), parseSkill(lf, "a"));
});

test("the front-matter fence is never the summary", () => {
  const { summary } = parseSkill("---\nname: a\n---\n# Title\n\nFirst real line.\n", "a");
  assert.equal(summary, "First real line.");
});

test("a file with no front matter keeps the old behaviour", () => {
  const { title, summary } = parseSkill("# Workspace notes\n\nWhen asked, save notes.\nMore.\n", "workspace-notes");
  assert.equal(title, "Workspace notes");
  assert.equal(summary, "When asked, save notes.");
});

test("title falls back to the front-matter name, then the folder name", () => {
  assert.equal(parseSkill("---\nname: from-front\ndescription: x\n---\nNo heading here.\n", "folder").title, "from-front");
  assert.equal(parseSkill("No heading, no front matter.\n", "folder").title, "folder");
});

test("a blockquote-only body still gives a summary, and the summary is capped at 200", () => {
  assert.equal(parseSkill("# T\n> **Note.** only this\n", "t").summary, "Note. only this");
  assert.equal(parseSkill(`---\nname: a\ndescription: ${"x".repeat(500)}\n---\n# A\n`, "a").summary.length, 200);
});

test("a heading inside the front matter is not the title", () => {
  assert.equal(parseSkill("---\nname: a\n# a comment\ndescription: d\n---\n# Real title\n", "a").title, "Real title");
});

// Optional: point SANDBENCH_TEST_SKILLS_DIR at a real skills folder (for example the walklings-team
// pack's .claude/skills) to check that every skill gets a real summary. Skipped when unset.
const realDir = process.env.SANDBENCH_TEST_SKILLS_DIR;
test("every skill in SANDBENCH_TEST_SKILLS_DIR has a real summary", { skip: !realDir || !existsSync(realDir) }, () => {
  const names = readdirSync(realDir).filter((n) => existsSync(path.join(realDir, n, "SKILL.md")));
  assert.ok(names.length > 0);
  for (const name of names) {
    const { title, summary } = parseSkill(readFileSync(path.join(realDir, name, "SKILL.md"), "utf8").slice(0, 32_000), name);
    assert.ok(title.length > 0, `${name}: title`);
    assert.ok(summary.length > 10 && !summary.startsWith("---"), `${name}: summary was "${summary}"`);
  }
});
