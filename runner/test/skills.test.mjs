// SB-08 skills and prompt building; no database needed.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { agentProfile, buildSystemPrompt } from "../agent/prompt.mjs";
import { createSkills } from "../agent/skills.mjs";
import { createRunner } from "../api/server.mjs";

let tmp;
let team;
let skills;
const skillDir = (name) => path.join(team, ".claude", "skills", name);
const writeSkill = (name, text) => {
  mkdirSync(skillDir(name), { recursive: true });
  writeFileSync(path.join(skillDir(name), "SKILL.md"), text);
};

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-skills-"));
  team = path.join(tmp, "team");
  writeSkill("walklings-qa-run", "---\nname: walklings-qa-run\ndescription: \"Run the pp_verify suite at 320, 375 and 390 px.\"\n---\n\n# QA run\n\nStart with 390.\n");
  writeSkill("plain", "# Plain skill\n\nNo front matter here.\n");
  // A folder outside the skills folder, reached through a link: must not be read.
  mkdirSync(path.join(tmp, "elsewhere"), { recursive: true });
  writeFileSync(path.join(tmp, "elsewhere", "SKILL.md"), "secret notes");
  symlinkSync(path.join(tmp, "elsewhere"), skillDir("linked"), "junction");
  writeFileSync(path.join(tmp, "outside.md"), "outside");
  skills = createSkills({ teamDir: team });
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("the skills index lists name and description, skipping linked folders", () => {
  assert.deepEqual(skills.listSkills(), [
    { name: "plain", title: "Plain skill", description: "No front matter here." },
    { name: "walklings-qa-run", title: "walklings-qa-run", description: "Run the pp_verify suite at 320, 375 and 390 px." },
  ]);
});

test("editing a skill file changes loadSkill on the next call, with no restart", () => {
  assert.match(skills.loadSkill("walklings-qa-run").body, /Start with 390\./);
  writeSkill("walklings-qa-run", "---\nname: walklings-qa-run\ndescription: Run at 320 first now.\n---\n\nStart with 320.\n");
  const next = skills.loadSkill("walklings-qa-run");
  assert.match(next.body, /Start with 320\./);
  assert.equal(next.description, "Run at 320 first now.");
  assert.equal(skills.listSkills().find((skill) => skill.name === "walklings-qa-run").description, "Run at 320 first now.");
});

test("'../', absolute, nested and linked skill names are refused", () => {
  for (const name of ["../outside", "..", "../../etc/passwd", "/etc/passwd", path.join(tmp, "elsewhere"), "C:\\x", "plain/SKILL.md", "a/b", ".claude", "", "linked", "missing", "\0", 7]) {
    assert.throws(() => skills.loadSkill(name), /No such skill/, String(name));
  }
  assert.deepEqual(createSkills({ teamDir: "" }).listSkills(), []);
  assert.throws(() => createSkills({ teamDir: "" }).loadSkill("plain"), /No such skill/);
});

test("the prompt has the profile, team rules, skills index, profile memory and journal", () => {
  const profile = agentProfile({ name: "QA", title: "Test lead", description: "You test Walklings builds.", capabilities: ["merge", "launch_rockets"], max_steps: -4, slug: "Not A Slug" });
  assert.deepEqual(profile.capabilities, ["merge"]);
  assert.equal(profile.max_steps, undefined);
  assert.equal(profile.slug, undefined);
  const prompt = buildSystemPrompt({
    profile,
    agentsMd: "# Team\nNever force-push.",
    skills: skills.listSkills(),
    memory: [{ text: "I check widths 320, 375 and 390." }],
    journal: [{ text: "Build 20261026-0001 passed.", createdAt: Date.UTC(2026, 9, 26) }],
  });
  assert.match(prompt, /^# You are QA, Test lead\n\nYou test Walklings builds\./);
  assert.match(prompt, /You may: merge\./);
  assert.match(prompt, /## Team rules \(AGENTS\.md\)\n\n# Team\nNever force-push\./);
  assert.match(prompt, /- walklings-qa-run: Run at 320 first now\./);
  assert.match(prompt, /## What you remember\n\n- I check widths 320, 375 and 390\./);
  assert.match(prompt, /- 2026-10-26: Build 20261026-0001 passed\./);
  // An agent with no profile falls back to its instructions and leaves empty sections out.
  const bare = buildSystemPrompt({ profile: agentProfile({ name: "Old bot", instructions: "Be brief." }) });
  assert.equal(bare, "# You are Old bot\n\nBe brief.");
});

test("without a database, memory and prompt routes say so; skills still work", async () => {
  const runner = createRunner({
    home: path.join(tmp, "home"),
    teamDir: team,
    allowedEmails: ["vincent@example.test"],
    env: {},
    verifyIdToken: async () => ({ uid: "u1", email: "vincent@example.test", email_verified: true }),
  });
  await new Promise((resolve) => runner.listen(0, "127.0.0.1", resolve));
  const at = `http://127.0.0.1:${runner.address().port}/api`;
  const get = (route) => fetch(`${at}${route}`, { headers: { authorization: "Bearer good" } });
  try {
    assert.equal((await get("/memory/qa")).status, 503);
    assert.equal((await get("/agents/qa/prompt")).status, 503);
    assert.equal((await get("/skills")).status, 200);
    assert.equal((await (await get("/skills")).json()).skills.length, 2);
    assert.match((await (await get("/skills/plain")).json()).body, /No front matter/);
    assert.equal((await get("/skills/..%2Foutside.md")).status, 404);
    assert.equal((await get("/skills/linked")).status, 404);
    assert.equal((await fetch(`${at}/skills`)).status, 401);
  } finally {
    runner.close();
  }
});
