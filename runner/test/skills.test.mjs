// SB-08 team skills; temp folders only, no database.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createSkills } from "../agent/skills.mjs";
import { createRunner } from "../api/server.mjs";

let tmp;
let team;
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
  // A folder outside the skills tree, reached through a link: never read.
  mkdirSync(path.join(tmp, "elsewhere"));
  writeFileSync(path.join(tmp, "elsewhere", "SKILL.md"), "secret notes");
  symlinkSync(path.join(tmp, "elsewhere"), skillDir("linked"), "junction");
  writeFileSync(path.join(tmp, "outside.md"), "outside");
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("the index lists names and descriptions, and skips linked folders", () => {
  assert.deepEqual(createSkills({ dir: team }).index(), [
    { name: "plain", description: "Plain skill" },
    { name: "walklings-qa-run", description: "Run the pp_verify suite at 320, 375 and 390 px." },
  ]);
});

test("editing a SKILL.md changes loadSkill on the next call, with the same object", () => {
  const skills = createSkills({ dir: team });
  assert.match(skills.loadSkill("walklings-qa-run").body, /Start with 390\./);
  writeSkill("walklings-qa-run", "---\nname: walklings-qa-run\ndescription: Run at 320 first now.\n---\n\nStart with 320.\n");
  const next = skills.loadSkill("walklings-qa-run");
  assert.match(next.body, /Start with 320\./);
  assert.equal(next.description, "Run at 320 first now.");
  assert.equal(skills.index().find((skill) => skill.name === "walklings-qa-run").description, "Run at 320 first now.");
});

test("'../x', absolute, nested, empty, linked, uppercase and over-long names are refused", () => {
  const skills = createSkills({ dir: team });
  for (const name of ["../outside", "..", "/etc/passwd", path.join(tmp, "elsewhere"), "plain/SKILL.md", "a/b", "", "linked", "Plain", "PLAIN", "a".repeat(62), "missing", "-x", "\0", 7, undefined]) {
    assert.equal(skills.loadSkill(name), null, String(name));
  }
  assert.ok(skills.loadSkill("a".repeat(61)) === null, "valid name, no such skill");
});

test("no team folder: an empty index and no skills, never a throw", () => {
  for (const dir of ["", undefined, path.join(tmp, "missing")]) {
    const skills = createSkills({ dir });
    assert.deepEqual(skills.index(), []);
    assert.equal(skills.loadSkill("plain"), null);
  }
});

test("without a database, memory and prompt routes are 503; skills still work; all need sign-in", async () => {
  const runner = createRunner({
    home: path.join(tmp, "home"),
    teamDir: team,
    allowedEmails: ["vincent@example.test"],
    env: {},
    verifyIdToken: async (token) => {
      if (token === "good") return { uid: "u1", email: "vincent@example.test", email_verified: true };
      throw new Error("bad token");
    },
  });
  await new Promise((resolve) => runner.listen(0, "127.0.0.1", resolve));
  const at = `http://127.0.0.1:${runner.address().port}/api`;
  const get = (route, token = "good") => fetch(`${at}${route}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  try {
    for (const route of ["/memory?agent=qa", "/skills", "/skills/plain", "/prompt/qa"]) assert.equal((await get(route, null)).status, 401, route);
    assert.equal((await get("/memory?agent=qa")).status, 503);
    assert.equal((await get("/prompt/qa")).status, 503);
    assert.equal((await (await get("/skills")).json()).skills.length, 2);
    assert.match((await (await get("/skills/plain")).json()).body, /No front matter/);
    assert.equal((await get("/skills/..%2Foutside.md")).status, 404);
    assert.equal((await get("/skills/linked")).status, 404);
    assert.equal((await get("/skills/%E0%A4%A")).status, 404);
  } finally {
    runner.close();
  }
});
