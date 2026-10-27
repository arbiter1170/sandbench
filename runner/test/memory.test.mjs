// SB-08 memory against a real Postgres. Like data.test.mjs it needs TEST_DATABASE_URL naming a
// *_test database and is skipped otherwise (CI fails if it skips). It works in its own schema, so
// it can run at the same time as data.test.mjs (node --test runs files in parallel).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const URL_ = process.env.TEST_DATABASE_URL || "";
const skip = !URL_ ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(URL_) ? "TEST_DATABASE_URL must name a *_test database" : false;
const SCHEMA = "sb_memory_test";
const A = "u-vincent";
const B = "u-other";

let sql;
let store;
let memory;
let migrate;
let tmp;
let server;
let base;

before(async () => {
  if (skip) return;
  const { default: postgres } = await import("postgres");
  const admin = postgres(URL_, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA};`);
  await admin.end();
  sql = postgres(URL_, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } });
  ({ migrate } = await import("../db/migrate.mjs"));
  const { createStore } = await import("../db/store.mjs");
  const { createMemory } = await import("../agent/memory.mjs");
  const { createRunner } = await import("../api/server.mjs");
  store = createStore(sql);
  memory = createMemory(sql);
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-memory-"));
  const team = path.join(tmp, "team");
  mkdirSync(path.join(team, ".claude", "skills", "walklings-qa-run"), { recursive: true });
  writeFileSync(path.join(team, "AGENTS.md"), "# Walklings team\n\nNever force-push.\n");
  writeFileSync(path.join(team, ".claude", "skills", "walklings-qa-run", "SKILL.md"), "---\nname: walklings-qa-run\ndescription: Phone-width QA run.\n---\nSteps.\n");
  server = createRunner({
    home: path.join(tmp, "home"),
    teamDir: team,
    allowedEmails: ["vincent@example.test", "other@example.test"],
    env: {},
    verifyIdToken: async (token) => {
      if (token === "a") return { uid: A, email: "vincent@example.test", email_verified: true };
      if (token === "b") return { uid: B, email: "other@example.test", email_verified: true };
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
    headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

test("the migration applies on an empty database, and a second run is a no-op", { skip }, async () => {
  // data.test.mjs pins the full list; here only that 002 applies after 001 on an empty database.
  assert.deepEqual((await migrate(sql)).slice(0, 2), ["001_init.sql", "002_memory.sql"]);
  assert.deepEqual(await migrate(sql), []);
});

test("save then search finds it, best match first, with English stemming", { skip }, async () => {
  await memory.save({ owner: A, agentId: "qa", kind: "profile", text: "I check phone widths 320, 375 and 390 px." });
  await memory.save({ owner: A, agentId: "qa", kind: "journal", text: "Build 20261026-0001 failed the inventory screen at 320." });
  await memory.save({ owner: A, agentId: "qa", kind: "journal", text: "Widths again: widths 320 and widths 390 failed, widths 375 passed." });
  await memory.save({ owner: A, agentId: "qa", kind: "journal", text: "Lunch order: noodles." });
  const widths = await memory.search({ owner: A, agentId: "qa", query: "width" });
  assert.equal(widths.length, 2);
  assert.match(widths[0].text, /^Widths again/, "the item that matches most ranks first");
  assert.ok(widths[0].rank >= widths[1].rank);
  const failing = await memory.search({ owner: A, agentId: "qa", query: "failing builds" });
  assert.match(failing[0].text, /inventory screen/);
  assert.deepEqual(await memory.search({ owner: A, agentId: "qa", query: "spaceship" }), []);
});

test("kind filter and limit clamp", { skip }, async () => {
  const journal = await memory.search({ owner: A, agentId: "qa", query: "320", kind: "journal" });
  assert.deepEqual(journal.map((item) => item.kind), ["journal", "journal"]);
  assert.deepEqual((await memory.search({ owner: A, agentId: "qa", query: "320", kind: "profile" })).map((item) => item.kind), ["profile"]);
  assert.equal((await memory.search({ owner: A, agentId: "qa", query: "320", limit: 1 })).length, 1);
  assert.equal((await memory.search({ owner: A, agentId: "qa", query: "320", limit: 0 })).length, 3, "0 means the default");
  assert.equal((await memory.search({ owner: A, agentId: "qa", query: "320", limit: 9999 })).length, 3, "clamped to 50");
  assert.equal((await memory.recent({ owner: A, agentId: "qa", kind: "journal", limit: 2 })).length, 2);
  await assert.rejects(memory.save({ owner: A, agentId: "qa", kind: "secret", text: "x" }), /profile or journal/);
});

test("over 8000 characters is refused, by the code and by the table's check", { skip }, async () => {
  await assert.rejects(memory.save({ owner: A, agentId: "qa", kind: "profile", text: "x".repeat(8001) }), /8000/);
  await assert.rejects(sql`insert into memory_items (owner, agent_id, kind, text) values (${A}, 'qa', 'profile', ${"x".repeat(8001)})`, /check/);
  assert.ok((await memory.save({ owner: A, agentId: "qa", kind: "journal", text: "y".repeat(8000) })).saved);
});

test("owner isolation: owner B sees nothing of owner A, for the same agent id", { skip }, async () => {
  await memory.save({ owner: B, agentId: "qa", kind: "profile", text: "Other account: widths 1024 only." });
  assert.deepEqual((await memory.search({ owner: B, agentId: "qa", query: "widths" })).map((item) => item.text), ["Other account: widths 1024 only."]);
  assert.ok((await memory.search({ owner: A, agentId: "qa", query: "widths" })).every((item) => !/1024/.test(item.text)));
  assert.deepEqual((await memory.profile({ owner: B, agentId: "qa" })).map((item) => item.text), ["Other account: widths 1024 only."]);
});

test("agent isolation: agent B sees nothing of agent A", { skip }, async () => {
  await memory.save({ owner: A, agentId: "design", kind: "profile", text: "Design checks widths in the spec." });
  assert.deepEqual((await memory.search({ owner: A, agentId: "design", query: "widths" })).map((item) => item.text), ["Design checks widths in the spec."]);
  assert.ok((await memory.search({ owner: A, agentId: "qa", query: "widths" })).every((item) => !/Design/.test(item.text)));
  await assert.rejects(memory.save({ owner: A, agentId: "../qa", kind: "profile", text: "x" }), /Agent ids/);
});

test("HTTP: sign-in required, owner from the token, and the prompt shows a new fact", { skip }, async () => {
  assert.equal((await call(null, "GET", "/memory?agent=qa")).status, 401);
  assert.equal((await call(null, "POST", "/memory", { agentId: "qa", kind: "profile", text: "x" })).status, 401);
  assert.deepEqual((await call("b", "GET", "/memory?agent=qa&q=phone")).body.items, []);
  const saved = await call("a", "POST", "/memory", { agentId: "qa", kind: "profile", text: "Sprites owns the sprite sheets.", owner: B });
  assert.equal(saved.status, 201);
  assert.deepEqual(await memory.search({ owner: B, agentId: "qa", query: "sprite" }), [], "a body can't pick the owner");
  assert.equal((await call("a", "GET", "/memory?agent=qa&q=sprite%20sheets")).body.items.length, 1);
  assert.equal((await call("a", "POST", "/memory", { agentId: "qa", kind: "nope", text: "x" })).status, 400);

  await store.create(A, "agents", "qa", { name: "QA", title: "Test lead", description: "You test Walklings builds." });
  const prompt = await call("a", "GET", "/prompt/qa");
  assert.equal(prompt.status, 200);
  assert.match(prompt.body.prompt, /^# You are QA, Test lead/);
  assert.match(prompt.body.prompt, /Never force-push\./);
  assert.match(prompt.body.prompt, /- walklings-qa-run: Phone-width QA run\./);
  assert.match(prompt.body.prompt, /## What you remember\n\n- I check phone widths[\s\S]*- Sprites owns the sprite sheets\./);
  assert.doesNotMatch(prompt.body.prompt, /1024 only/);
  assert.equal((await call("b", "GET", "/prompt/qa")).status, 404);
  assert.equal((await call("a", "GET", "/prompt/nobody")).status, 404);
});

test("the file-memory import is idempotent", { skip }, async () => {
  const { importFileMemory } = await import("../agent/memory-import.mjs");
  const dir = path.join(tmp, "bots", "pixelpets");
  mkdirSync(path.join(dir, "memory", "log"), { recursive: true });
  writeFileSync(path.join(dir, "MEMORY.md"), "# PixelPets\n\nBuilds are stamped with tools/bump_build.py.\n\nPRs go to deploy branches only.\n");
  writeFileSync(path.join(dir, "memory", "people.md"), "Vincent reviews every merge.\n");
  writeFileSync(path.join(dir, "memory", "log", "2026-10-20.md"), "Shipped the pet shop.\n");
  writeFileSync(path.join(dir, "memory", "log", "notes.txt"), "not memory");
  const args = { dir, owner: A, agentId: "pixelpets", memory };
  assert.deepEqual(await importFileMemory(args), { inserted: 4, skipped: 0 });
  assert.deepEqual(await importFileMemory(args), { inserted: 0, skipped: 4 });
  const journal = await memory.recent({ owner: A, agentId: "pixelpets", kind: "journal" });
  assert.deepEqual(journal.map((item) => [item.text, new Date(item.createdAt).toISOString()]), [["Shipped the pet shop.", "2026-10-20T12:00:00.000Z"]]);
  // An edited file adds only its new paragraph.
  writeFileSync(path.join(dir, "MEMORY.md"), "# PixelPets\n\nBuilds are stamped with tools/bump_build.py.\n\nPRs go to deploy branches only.\n\nNever touch the game's Firebase project.\n");
  assert.deepEqual(await importFileMemory(args), { inserted: 1, skipped: 4 });
  assert.equal((await memory.profile({ owner: A, agentId: "pixelpets" })).length, 4);
  // Another owner's import is its own copy.
  assert.deepEqual(await importFileMemory({ ...args, owner: B }), { inserted: 5, skipped: 0 });
});

test("the backup writes profile.md and journal.md per agent for one owner", { skip }, async () => {
  const { exportMemory } = await import("../agent/memory-backup.mjs");
  const out = path.join(tmp, "backup");
  const written = await exportMemory({ sql, owner: A, dir: out });
  assert.deepEqual(written.map((entry) => entry.agentId), ["design", "pixelpets", "qa"]);
  const profile = readFileSync(path.join(out, "qa", "profile.md"), "utf8");
  assert.match(profile, /^# qa: profile memory\n\n- I check phone widths 320, 375 and 390 px\.\n- Sprites owns the sprite sheets\.\n$/);
  assert.doesNotMatch(profile, /1024/);
  assert.match(readFileSync(path.join(out, "pixelpets", "journal.md"), "utf8"), /- 2026-10-20: Shipped the pet shop\./);
});
