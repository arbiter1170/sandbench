// SB-08 memory against a real Postgres. Like data.test.mjs it needs TEST_DATABASE_URL naming a
// *_test database, and is skipped otherwise. It works in its own schema, so it can run at the
// same time as data.test.mjs (node --test runs files in parallel).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const URL_ = process.env.TEST_DATABASE_URL || "";
const skip = !URL_ ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(URL_) ? "TEST_DATABASE_URL must name a *_test database" : false;
const SCHEMA = "sb_memory_test";
const VINCENT = "u-vincent";
const OTHER = "u-other";

let sql;
let store;
let memory;
let tmp;
let team;
let server;
let base;

before(async () => {
  if (skip) return;
  const { default: postgres } = await import("postgres");
  const admin = postgres(URL_, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA};`);
  await admin.end();
  sql = postgres(URL_, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const { migrate } = await import("../db/migrate.mjs");
  const { createStore } = await import("../db/store.mjs");
  const { createMemory } = await import("../agent/memory.mjs");
  const { createRunner } = await import("../api/server.mjs");
  assert.deepEqual(await migrate(sql), ["001_init.sql", "002_memory.sql"]);
  store = createStore(sql);
  memory = createMemory(sql);
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-memory-"));
  team = path.join(tmp, "team");
  mkdirSync(path.join(team, ".claude", "skills", "walklings-qa-run"), { recursive: true });
  writeFileSync(path.join(team, "AGENTS.md"), "# Walklings team\n\nNever force-push.\n");
  writeFileSync(path.join(team, ".claude", "skills", "walklings-qa-run", "SKILL.md"), "---\nname: walklings-qa-run\ndescription: Phone-width QA run.\n---\nSteps.\n");
  server = createRunner({
    home: path.join(tmp, "home"),
    teamDir: team,
    allowedEmails: ["vincent@example.test", "other@example.test"],
    env: {},
    verifyIdToken: async (token) => {
      if (token === "vincent") return { uid: VINCENT, email: "vincent@example.test", email_verified: true };
      if (token === "other") return { uid: OTHER, email: "other@example.test", email_verified: true };
      throw new Error("bad token");
    },
    store,
    memory,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.closeAllConnections?.();
  server?.close();
  if (sql) {
    await sql.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await sql.end({ timeout: 1 });
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const call = (who, method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

test("save and search memory with full-text search", { skip }, async () => {
  await memory.memorySave({ owner: VINCENT, agentId: "qa", kind: "profile", text: "I check phone widths 320, 375 and 390 px." });
  await memory.memorySave({ owner: VINCENT, agentId: "qa", kind: "journal", text: "Build 20261026-0001 failed the inventory screen at 320." });
  await memory.memorySave({ owner: VINCENT, agentId: "qa", kind: "journal", text: "Lunch order: noodles." });
  // Stemming: "width" finds "widths"; "failing builds" finds "failed" and "Build".
  const widths = await memory.memorySearch({ owner: VINCENT, agentId: "qa", query: "width" });
  assert.deepEqual(widths.map((item) => item.text), ["I check phone widths 320, 375 and 390 px."]);
  const failing = await memory.memorySearch({ owner: VINCENT, agentId: "qa", query: "failing builds", kind: "journal" });
  assert.equal(failing.length, 1);
  assert.match(failing[0].text, /inventory screen/);
  assert.deepEqual(await memory.memorySearch({ owner: VINCENT, agentId: "qa", query: "spaceship" }), []);
  await assert.rejects(memory.memorySave({ owner: VINCENT, agentId: "qa", kind: "secret", text: "x" }), /profile or journal/);
  await assert.rejects(memory.memorySave({ owner: VINCENT, agentId: "../qa", kind: "profile", text: "x" }), /Agent ids/);
  await assert.rejects(memory.memorySave({ owner: VINCENT, agentId: "qa", kind: "profile", text: "x".repeat(16 * 1024 + 1) }), /limited/);
});

test("memory is isolated by owner and by agent", { skip }, async () => {
  await memory.memorySave({ owner: OTHER, agentId: "qa", kind: "profile", text: "Other account: widths 1024 only." });
  await memory.memorySave({ owner: VINCENT, agentId: "design", kind: "profile", text: "Design checks widths in Figma." });
  const mine = await memory.memorySearch({ owner: VINCENT, agentId: "qa", query: "widths" });
  assert.deepEqual(mine.map((item) => item.text), ["I check phone widths 320, 375 and 390 px."]);
  const theirs = await memory.memorySearch({ owner: OTHER, agentId: "qa", query: "widths" });
  assert.deepEqual(theirs.map((item) => item.text), ["Other account: widths 1024 only."]);
  // Over HTTP the owner is the signed-in account, whatever the request says.
  const other = await call("other", "GET", "/memory/qa?q=phone");
  assert.deepEqual(other.body.items, []);
  const saved = await call("vincent", "POST", "/memory/qa", { kind: "profile", text: "Off-limits Firebase projects are listed by hash in runner/guard.mjs.", owner: OTHER });
  assert.equal(saved.status, 201);
  assert.deepEqual((await memory.memorySearch({ owner: OTHER, agentId: "qa", query: "Firebase" })), []);
  const found = await call("vincent", "GET", "/memory/qa?q=firebase%20projects");
  assert.equal(found.body.items.length, 1);
  assert.equal((await call("vincent", "POST", "/memory/qa", { kind: "nope", text: "x" })).status, 400);
  assert.equal((await fetch(`${base}/memory/qa`)).status, 401);
});

test("a profile fact appears in the agent's next prompt", { skip }, async () => {
  await store.create(VINCENT, "agents", "qa", { name: "QA", title: "Test lead", description: "You test Walklings builds.", capabilities: ["launch_build"] });
  const before = await call("vincent", "GET", "/agents/qa/prompt");
  assert.equal(before.status, 200);
  assert.doesNotMatch(before.body.prompt, /Sprites owns the sprite sheets/);
  assert.match(before.body.prompt, /^# You are QA, Test lead/);
  assert.match(before.body.prompt, /Never force-push\./);
  assert.match(before.body.prompt, /- walklings-qa-run: Phone-width QA run\./);
  assert.match(before.body.prompt, /## Recent journal\n\n- \d{4}-\d{2}-\d{2}: Lunch order/);
  await call("vincent", "POST", "/memory/qa", { kind: "profile", text: "Sprites owns the sprite sheets." });
  const next = await call("vincent", "GET", "/agents/qa/prompt");
  assert.match(next.body.prompt, /## What you remember\n\n- I check phone widths 320, 375 and 390 px\.\n[\s\S]*- Sprites owns the sprite sheets\./);
  // Another account's memory and agents never leak in.
  assert.doesNotMatch(next.body.prompt, /1024 only/);
  assert.equal((await call("other", "GET", "/agents/qa/prompt")).status, 404);
  assert.equal((await call("vincent", "GET", "/agents/nobody/prompt")).status, 404);
});

test("the harness file-memory import is idempotent", { skip }, async () => {
  const { importMemoryFiles, readHarnessMemory } = await import("../agent/memory-import.mjs");
  const bot = path.join(tmp, "bots", "pixelpets");
  mkdirSync(path.join(bot, "memory", "log"), { recursive: true });
  writeFileSync(path.join(bot, "MEMORY.md"), "# PixelPets\n\nBuilds are stamped with tools/bump_build.py.\n\nPRs go to deploy branches only.\n");
  writeFileSync(path.join(bot, "memory", "people.md"), "Vincent reviews every merge.\n");
  writeFileSync(path.join(bot, "memory", "log", "2026-10-20.md"), "Shipped the pet shop.\n");
  writeFileSync(path.join(bot, "memory", "log", "notes.txt"), "not memory");
  const files = readHarnessMemory(bot);
  // One item per paragraph; the "# PixelPets" heading on its own is not a fact.
  assert.deepEqual(files.map((file) => file.path), ["MEMORY.md", "memory/people.md", "memory/log/2026-10-20.md"]);

  const first = await importMemoryFiles(memory, { owner: VINCENT, agentId: "pixelpets", files });
  assert.deepEqual(first, { imported: 4, skipped: 0, refused: 0 });
  const again = await importMemoryFiles(memory, { owner: VINCENT, agentId: "pixelpets", files: readHarnessMemory(bot) });
  assert.deepEqual(again, { imported: 0, skipped: 4, refused: 0 });
  const all = await memory.memoryList({ owner: VINCENT, agentId: "pixelpets" });
  assert.equal(all.length, 4);
  const journal = all.filter((item) => item.kind === "journal");
  assert.deepEqual(journal.map((item) => new Date(item.createdAt).toISOString()), ["2026-10-20T12:00:00.000Z"]);

  // An edited file adds only its new paragraph; bad paths are refused, over HTTP too.
  writeFileSync(path.join(bot, "MEMORY.md"), "# PixelPets\n\nBuilds are stamped with tools/bump_build.py.\n\nPRs go to deploy branches only.\n\nNever touch the game's Firebase project.\n");
  const edited = await call("vincent", "POST", "/memory/pixelpets/import", { files: [...readHarnessMemory(bot), { path: "../../etc/passwd", content: "x" }, { path: "memory/../x.md", content: "x" }] });
  assert.deepEqual(edited.body, { imported: 1, skipped: 4, refused: 2 });
  assert.equal((await memory.memoryList({ owner: VINCENT, agentId: "pixelpets" })).length, 5);
  // The same files under another account are that account's own copy.
  assert.deepEqual(await importMemoryFiles(memory, { owner: OTHER, agentId: "pixelpets", files }), { imported: 4, skipped: 0, refused: 0 });
});

test("memory backup writes one folder per agent", { skip }, async () => {
  const out = path.join(tmp, "backup");
  const written = await memory.memoryExport(out, { owner: VINCENT });
  assert.deepEqual(written.map((entry) => entry.agentId).sort(), ["design", "pixelpets", "qa"]);
  const lines = readFileSync(path.join(out, VINCENT, "qa", "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(lines.some((line) => line.kind === "profile" && /Sprites owns/.test(line.text)));
  assert.match(readFileSync(path.join(out, VINCENT, "qa", "profile.md"), "utf8"), /- I check phone widths/);
  assert.throws(() => readFileSync(path.join(out, OTHER, "qa", "memory.jsonl")));
});
