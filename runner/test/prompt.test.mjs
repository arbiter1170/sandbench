// SB-08 prompt builder. Memory here is an in-memory stand-in with the same methods the prompt
// uses; memory.test.mjs checks the same flow against Postgres.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { CUT, MAX_PROMPT, buildSystemPrompt, fit } from "../agent/prompt.mjs";
import { createSkills } from "../agent/skills.mjs";

let tmp;
let team;
let skills;

// Same contract as createMemory: save, profile (oldest first), recent (newest first).
function fakeMemory() {
  const items = [];
  let clock = Date.UTC(2026, 9, 20);
  return {
    async save({ owner, agentId, kind, text }) {
      const item = { id: items.length + 1, owner, agentId, kind, text, createdAt: (clock += 60_000) };
      items.push(item);
      return { saved: true, item };
    },
    async profile({ owner, agentId }) {
      return items.filter((item) => item.owner === owner && item.agentId === agentId && item.kind === "profile");
    },
    async recent({ owner, agentId, kind, limit }) {
      return items.filter((item) => item.owner === owner && item.agentId === agentId && item.kind === kind).reverse().slice(0, limit);
    },
  };
}

const qa = { id: "qa", data: { name: "QA", title: "Test lead", description: "You test Walklings builds at phone widths." } };

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-prompt-"));
  team = path.join(tmp, "team");
  mkdirSync(path.join(team, ".claude", "skills", "walklings-qa-run"), { recursive: true });
  writeFileSync(path.join(team, "AGENTS.md"), "# Walklings team\n\nNever force-push.\n");
  writeFileSync(path.join(team, ".claude", "skills", "walklings-qa-run", "SKILL.md"), "---\nname: walklings-qa-run\ndescription: Phone-width QA run.\n---\nSteps.\n");
  skills = createSkills({ dir: team });
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("a profile fact saved through memory appears in the next prompt", async () => {
  const memory = fakeMemory();
  const before = await buildSystemPrompt({ owner: "u1", agent: qa, memory, skills, teamDir: team });
  assert.doesNotMatch(before, /which widths/i);
  await memory.save({ owner: "u1", agentId: "qa", kind: "profile", text: "I check widths 320, 375 and 390." });
  await memory.save({ owner: "u2", agentId: "qa", kind: "profile", text: "Another account's fact." });
  const next = await buildSystemPrompt({ owner: "u1", agent: qa, memory, skills, teamDir: team });
  assert.match(next, /## What you remember\n\n- I check widths 320, 375 and 390\./);
  assert.doesNotMatch(next, /Another account/);
});

test("sections come in order: profile, AGENTS.md, skills, profile memory, journal", async () => {
  const memory = fakeMemory();
  await memory.save({ owner: "u1", agentId: "qa", kind: "profile", text: "Off-limits Firebase projects are blocked by hash." });
  for (let n = 1; n <= 12; n++) await memory.save({ owner: "u1", agentId: "qa", kind: "journal", text: `Run ${n} passed.` });
  const prompt = await buildSystemPrompt({ owner: "u1", agent: qa, memory, skills, teamDir: team });
  const order = ["# You are QA, Test lead", "You test Walklings builds", "## Team rules (AGENTS.md)", "Never force-push.", "## Skills", "- walklings-qa-run: Phone-width QA run.", "## What you remember", "## Recent journal"].map((part) => prompt.indexOf(part));
  assert.ok(order.every((at) => at >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // The 10 most recent journal items, newest first.
  assert.match(prompt, /- 2026-10-20: Run 12 passed\./);
  assert.match(prompt, /Run 3 passed\./);
  assert.doesNotMatch(prompt, /Run 2 passed\./);
  assert.ok(prompt.indexOf("Run 12") < prompt.indexOf("Run 11"));
});

test("an agent with only old instructions, no team folder and no memory gets a short prompt", async () => {
  const prompt = await buildSystemPrompt({ owner: "u1", agent: { id: "old", data: { name: "Old bot", instructions: "Be brief." } }, memory: fakeMemory(), skills: createSkills({ dir: "" }), teamDir: "" });
  assert.equal(prompt, "# You are Old bot\n\nBe brief.");
});

test("never over 40,000 characters, cut at a word with a marker, and deterministic", async () => {
  const memory = fakeMemory();
  const word = "widths ";
  for (let n = 0; n < 40; n++) await memory.save({ owner: "u1", agentId: "qa", kind: "profile", text: word.repeat(1000).trim() });
  for (let n = 0; n < 10; n++) await memory.save({ owner: "u1", agentId: "qa", kind: "journal", text: word.repeat(1000).trim() });
  writeFileSync(path.join(team, "AGENTS.md"), word.repeat(20_000));
  const huge = { id: "qa", data: { name: "QA", description: word.repeat(5_000) } };
  try {
    const first = await buildSystemPrompt({ owner: "u1", agent: huge, memory, skills, teamDir: team });
    const second = await buildSystemPrompt({ owner: "u1", agent: huge, memory, skills, teamDir: team });
    assert.ok(first.length <= MAX_PROMPT, String(first.length));
    assert.equal(first, second);
    assert.ok(first.includes(CUT));
    // Every cut ends on a whole word.
    for (const piece of first.split(CUT).slice(0, -1)) assert.match(piece, /widths$/);
  } finally {
    writeFileSync(path.join(team, "AGENTS.md"), "# Walklings team\n\nNever force-push.\n");
  }
  assert.equal(fit("short", 100), "short");
  assert.equal(fit("alpha beta gamma delta epsilon zeta", 10 + CUT.length), `alpha beta${CUT}`);
  assert.equal(fit("alphabetagammadelta epsilon", 5 + CUT.length), `alpha${CUT}`, "one long word is cut hard");
});
