// SB-02 datastore against a real Postgres. Set TEST_DATABASE_URL to a database whose
// name ends in _test (its public schema is wiped); skipped otherwise. CI runs it with a
// Postgres service container.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const URL_ = process.env.TEST_DATABASE_URL || "";
const skip = !URL_ ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(URL_) ? "TEST_DATABASE_URL must name a *_test database" : false;

let sql;
let store;
let server;
let base;
let tmp;
const USERS = {
  laptop: { uid: "u-vincent", email: "vincent@example.test", email_verified: true },
  phone: { uid: "u-vincent", email: "vincent@example.test", email_verified: true },
  other: { uid: "u-other", email: "other@example.test", email_verified: true },
  // A token that expires in about a second (exp is in seconds).
  get brief() {
    return { uid: "u-brief", email: "vincent@example.test", email_verified: true, exp: Math.floor(Date.now() / 1000) + 1 };
  },
};

before(async () => {
  if (skip) return;
  const { default: postgres } = await import("postgres");
  const { migrate } = await import("../db/migrate.mjs");
  const { createStore } = await import("../db/store.mjs");
  const { createRunner } = await import("../api/server.mjs");
  sql = postgres(URL_, { max: 5, onnotice: () => {} });
  await sql.unsafe("drop schema public cascade; create schema public;");
  assert.deepEqual(await migrate(sql), ["001_init.sql"]);
  store = createStore(sql);
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-data-"));
  server = createRunner({
    home: tmp,
    allowedEmails: ["vincent@example.test", "other@example.test"],
    verifyIdToken: async (token) => {
      if (!USERS[token]) throw new Error("bad token");
      return USERS[token];
    },
    store,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.closeAllConnections?.();
  server?.close();
  await sql?.end({ timeout: 1 });
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const call = (who, method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

test("migrations apply once", { skip }, async () => {
  const { migrate } = await import("../db/migrate.mjs");
  assert.deepEqual(await migrate(sql), []);
});

test("records need sign-in and are scoped to their owner", { skip }, async () => {
  assert.equal((await fetch(`${base}/data/agents`)).status, 401);
  assert.equal((await call("laptop", "POST", "/data/agents", { id: "qa", data: { name: "QA" } })).status, 201);
  assert.equal((await call("other", "GET", "/data/agents/qa")).status, 404);
  assert.deepEqual((await call("other", "GET", "/data/agents")).body.items, []);
  assert.equal((await call("laptop", "POST", "/data/agents", { id: "qa", data: { name: "again" } })).status, 409);
});

test("acceptance: an edit on the laptop and an approval on the phone at the same time both survive", { skip }, async () => {
  await call("laptop", "POST", "/data/agents", { id: "supervisor", data: { name: "Supervisor", instructions: "old" } });
  await call("laptop", "POST", "/data/threads", { id: "qa-thread", data: { title: "QA", botId: "qa" } });
  await call("laptop", "POST", "/data/messages", { id: "card-1", threadId: "qa-thread", data: { role: "assistant", text: "Run it?", createdAt: 1, approval: { state: "pending" } } });
  // Both devices read version 1 of different rows and write at the same moment.
  const [edit, approve] = await Promise.all([
    call("laptop", "PATCH", "/data/agents/supervisor", { version: 1, data: { instructions: "new instructions" } }),
    call("phone", "PATCH", "/data/messages/card-1", { version: 1, data: { approval: { state: "approved" } } }),
  ]);
  assert.equal(edit.status, 200);
  assert.equal(approve.status, 200);
  assert.equal((await call("phone", "GET", "/data/agents/supervisor")).body.data.instructions, "new instructions");
  assert.equal((await call("laptop", "GET", "/data/messages/card-1")).body.data.approval.state, "approved");
});

test("two edits of the same row: one wins, the other gets 409 with the current row and retries", { skip }, async () => {
  const [a, b] = await Promise.all([
    call("laptop", "PATCH", "/data/agents/supervisor", { version: 2, data: { persona: "calm" } }),
    call("phone", "PATCH", "/data/agents/supervisor", { version: 2, data: { role: "Coordinator" } }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.status === 409 ? a : b;
  const loserPatch = a.status === 409 ? { persona: "calm" } : { role: "Coordinator" };
  assert.equal(loser.body.current.version, 3);
  const retry = await call("phone", "PATCH", "/data/agents/supervisor", { version: loser.body.current.version, data: loserPatch });
  assert.equal(retry.status, 200);
  const final = (await call("laptop", "GET", "/data/agents/supervisor")).body;
  assert.equal(final.data.persona, "calm");
  assert.equal(final.data.role, "Coordinator");
  assert.equal(final.data.instructions, "new instructions");
  assert.equal(final.version, 4);
});

test("acceptance: a 300-message thread loads in full, in order, and logs are not capped at 40", { skip }, async () => {
  await call("laptop", "POST", "/data/threads", { id: "long", data: { title: "Supervisor", messages: [{ id: "x" }] } });
  for (let i = 0; i < 300; i += 1) {
    await store.create("u-vincent", "messages", `m${String(i).padStart(3, "0")}`, { role: i % 2 ? "assistant" : "user", text: `#${i}`, createdAt: 1000 + i }, { threadId: "long" });
  }
  for (let i = 0; i < 60; i += 1) await store.create("u-vincent", "logs", `log${i}`, { message: `log ${i}`, at: i });
  const thread = (await call("phone", "GET", "/data/threads/long")).body;
  assert.equal("messages" in thread.data, false, "messages are stored as their own rows");
  const messages = (await call("phone", "GET", "/data/messages?thread=long")).body;
  assert.equal(messages.items.length, 300);
  assert.equal(messages.more, false);
  assert.deepEqual(messages.items.slice(0, 3).map((item) => item.data.text), ["#0", "#1", "#2"]);
  assert.equal(messages.items[299].data.text, "#299");
  assert.equal((await call("phone", "GET", "/data/logs")).body.items.length, 60);
});

test("deletes are tombstones the other device can see", { skip }, async () => {
  await call("laptop", "POST", "/data/reminders", { id: "r1", data: { text: "stretch" } });
  assert.equal((await call("laptop", "DELETE", "/data/reminders/r1?version=9")).status, 409);
  const gone = await call("laptop", "DELETE", "/data/reminders/r1?version=1");
  assert.equal(gone.status, 200);
  assert.equal(gone.body.deleted, true);
  assert.deepEqual((await call("phone", "GET", "/data/reminders")).body.items, []);
  assert.equal((await call("laptop", "PATCH", "/data/reminders/r1", { version: 2, data: { text: "x" } })).status, 404);
});

test("bad input is refused", { skip }, async () => {
  assert.equal((await call("laptop", "GET", "/data/secrets")).status, 404);
  assert.equal((await call("laptop", "GET", "/data/constructor")).status, 404);
  assert.equal((await call("laptop", "GET", "/data/tostring")).status, 404);
  assert.equal((await call("laptop", "POST", "/data/agents", { id: "../x", data: {} })).status, 400);
  assert.equal((await call("laptop", "POST", "/data/agents", { id: "ok", data: [1] })).status, 400);
  assert.equal((await call("laptop", "POST", "/data/messages", { id: "m-x", data: { text: "no thread" } })).status, 400);
  assert.equal((await call("laptop", "PATCH", "/data/agents/qa", { data: { name: "no version" } })).status, 400);
  assert.equal((await call("laptop", "POST", "/data/agents", { id: "big", data: { blob: "x".repeat(600 * 1024) } })).status, 413);
});

test("the change feed: catch-up in order, and a live push to the other device", { skip }, async () => {
  const all = (await call("phone", "GET", "/changes?since=0&limit=2000")).body;
  const seqs = all.changes.map((change) => change.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  assert.ok(all.changes.every((change) => change.kind && change.id && change.data));
  // The other user has written nothing yet, so their feed is empty.
  assert.deepEqual((await call("other", "GET", "/changes?since=0")).body.changes, []);

  // The phone listens; the laptop writes; the phone hears about it.
  const controller = new AbortController();
  const response = await fetch(`${base}/stream?since=${all.last}`, { headers: { authorization: "Bearer phone" }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const heard = (async () => {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += decoder.decode(value, { stream: true });
      const hit = buffer.split("\n\n").find((block) => block.includes("event: change"));
      if (hit) return JSON.parse(hit.split("\n").find((line) => line.startsWith("data: ")).slice(6));
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await call("laptop", "PATCH", "/data/agents/qa", { version: 1, data: { name: "QA bot" } });
  const change = await Promise.race([heard, new Promise((_, reject) => setTimeout(() => reject(new Error("no live change within 5 s")), 5000))]);
  assert.equal(change.kind, "agents");
  assert.equal(change.id, "qa");
  assert.equal(change.data.name, "QA bot");
  assert.ok(change.seq > all.last);
  controller.abort();
});

test("another user's writes never reach this user's feed", { skip }, async () => {
  const before = (await call("laptop", "GET", "/changes?since=0&limit=2000")).body.last;
  await call("other", "POST", "/data/contacts", { id: "c1", data: { name: "Someone" } });
  assert.deepEqual((await call("laptop", "GET", `/changes?since=${before}`)).body.changes, []);
});

test("the feed never skips a write that commits after a later one (two devices saving at once)", { skip }, async () => {
  const { createStore } = await import("../db/store.mjs");
  let reachedLog;
  const reached = new Promise((resolve) => (reachedLog = resolve));
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  // This store's writes pause after taking their change seq, before they commit.
  const slow = createStore(sql, {
    onLogged: async () => {
      reachedLog();
      await gate;
    },
  });
  const owner = "u-race";
  await store.create(owner, "agents", "x", { n: 0 });
  await store.create(owner, "agents", "y", { n: 0 });
  let cursor = (await store.changesSince(owner, 0)).last;
  const first = slow.patch(owner, "agents", "x", 1, { n: 1 }); // device A: seq taken, not committed yet
  await reached;
  const second = store.patch(owner, "agents", "y", 1, { n: 1 }); // device B saves meanwhile
  await new Promise((resolve) => setTimeout(resolve, 300));
  const seen = new Set();
  const early = await store.changesSince(owner, cursor); // a reader polls in between
  for (const change of early.changes) seen.add(change.id);
  cursor = early.last;
  release();
  await Promise.all([first, second]);
  const late = await store.changesSince(owner, cursor);
  for (const change of late.changes) seen.add(change.id);
  assert.deepEqual([...seen].sort(), ["x", "y"], "every committed write reaches the reader");
});

test("a change stream ends when its sign-in token expires", { skip }, async () => {
  const started = Date.now();
  const response = await fetch(`${base}/stream?since=0`, { headers: { authorization: "Bearer brief" } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const ended = (async () => {
    while (!(await reader.read()).done);
  })();
  await Promise.race([ended, new Promise((_, reject) => setTimeout(() => reject(new Error("stream outlived its token")), 5000))]);
  assert.ok(Date.now() - started < 5000);
});

test("each account can hold a limited number of open streams", { skip }, async () => {
  const controllers = [];
  try {
    for (let i = 0; i < 8; i += 1) {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${base}/stream?since=0`, { headers: { authorization: "Bearer other" }, signal: controller.signal });
      assert.equal(response.status, 200);
    }
    assert.equal((await fetch(`${base}/stream?since=0`, { headers: { authorization: "Bearer other" } })).status, 429);
  } finally {
    for (const controller of controllers) controller.abort();
  }
  // Closing them frees the slots again.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const again = new AbortController();
  const response = await fetch(`${base}/stream?since=0`, { headers: { authorization: "Bearer other" }, signal: again.signal });
  assert.equal(response.status, 200);
  again.abort();
});
