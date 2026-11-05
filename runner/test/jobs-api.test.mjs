// SB-03 PR 2: the jobs and approvals routes through createRunner, behind the sign-in check, on
// real Postgres (TEST_DATABASE_URL; CI fails if this skips). Schema sb_jobs_api.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRunner } from "../api/server.mjs";
import { loadRouteFactories } from "../api/routes/index.mjs";
import { agentRecord, makeEngine, setupDb, skip, until } from "./fixtures/engine-harness.mjs";

const USERS = {
  vincent: { uid: "u-vincent", email: "vincent@example.test", email_verified: true },
  other: { uid: "u-other", email: "other@example.test", email_verified: true },
};
let db;
let engine;
let fake;
let server;
let base;
let bare;
let bareBase;

const SCRIPTS = {
  reply: [{ say: "Hi " }, { say: "there." }],
  ask: [{ say: "may I? " }, { ask: "ls", reason: "look" }, { say: " bye" }],
  hang: [{ say: "working " }, { hang: true }],
};

before(async () => {
  if (skip) return;
  db = await setupDb("sb_jobs_api");
  await db.store.create("u-vincent", "agents", "qa", agentRecord("qa"));
  await db.store.create("u-vincent", "agents", "sleepy", agentRecord("sleepy", { paused: true }));
  ({ engine, fake } = makeEngine(db, { scripts: SCRIPTS, boss: "api" }));
  await engine.start({ pollingIntervalSeconds: 0.5 });
  const factories = await loadRouteFactories();
  const verifyIdToken = async (token) => {
    if (!USERS[token]) throw new Error("bad token");
    return USERS[token];
  };
  server = createRunner({
    home: db.home,
    allowedEmails: ["vincent@example.test", "other@example.test"],
    env: {},
    verifyIdToken,
    store: db.store,
    memory: db.memory,
    routes: factories.map((factory) => ({ ...factory, create: (deps) => factory.create({ ...deps, engine }) })),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  // A runner with a database but no engine (the routes answer 503, nothing else breaks).
  bare = createRunner({ home: db.home, allowedEmails: ["vincent@example.test"], env: {}, verifyIdToken, store: db.store, routes: factories });
  await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
  bareBase = `http://127.0.0.1:${bare.address().port}/api`;
});

after(async () => {
  server?.closeAllConnections?.();
  server?.close();
  bare?.closeAllConnections?.();
  bare?.close();
  await engine?.stop().catch(() => undefined);
  await db?.teardown();
});

const call = (who, method, route, body, root = base) =>
  fetch(`${root}${route}`, {
    method,
    headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));

/** Reads one SSE response fully (until the server closes it) and returns the parsed events. */
async function readStream(who, route, { signal } = {}) {
  const response = await fetch(`${base}${route}`, { headers: { authorization: `Bearer ${who}` }, signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data:")))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(5)));
}

const turn = (text, extra = {}) => ({ threadId: "t-qa", text, agentId: "qa", driver: "fake", ...extra });

test("the routes need sign-in, and answer 503 on a runner without an engine", { skip }, async () => {
  assert.equal((await fetch(`${base}/jobs`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/jobs/abc/events`)).status, 401);
  assert.equal((await fetch(`${base}/approvals`)).status, 401);
  assert.equal((await call("vincent", "POST", "/jobs", turn("hi"), bareBase)).status, 503);
  assert.equal((await call("vincent", "GET", "/approvals", undefined, bareBase)).status, 503);
  // Unknown sub-paths fall through to the built-in 404.
  assert.equal((await call("vincent", "GET", "/jobs/abc/nope")).status, 404);
  assert.equal((await call("vincent", "PUT", "/jobs")).status, 404);
});

test("a message through the API gets its reply, and a second client attaching afterwards reads the full stream", { skip }, async () => {
  const started = await call("vincent", "POST", "/jobs", turn("hello there", { messageId: "u1", replyId: "r1" }));
  assert.equal(started.status, 201);
  assert.deepEqual(Object.keys(started.body).sort(), ["jobId", "messageId", "replyId"]);
  const { jobId } = started.body;
  // The first client watches live from the start.
  const live = await readStream("vincent", `/jobs/${jobId}/events?after=0`);
  assert.deepEqual(live.map((event) => event.type), ["queued", "turn_start", "thinking", "message_delta", "message_delta", "done"]);
  assert.equal(live.at(-1).turnId, jobId);
  assert.equal(live.at(-1).jobId, jobId);
  assert.equal(live.map((event) => event.text).filter(Boolean).join(""), "fake turn startedHi there.");
  // The job row is readable, the reply is a record, and nothing in the row looks like a key.
  const row = await call("vincent", "GET", `/jobs/${jobId}`);
  assert.equal(row.status, 200);
  assert.equal(row.body.job.status, "done");
  assert.equal(row.body.job.payload.text, "hello there");
  assert.equal("key" in row.body.job.payload, false);
  assert.equal((await db.store.get("u-vincent", "messages", "r1")).data.text, "Hi there.");
  // A second client, attaching after the turn finished (the tab was closed), gets everything...
  const later = await readStream("vincent", `/jobs/${jobId}/events?after=0`);
  assert.deepEqual(later.map((event) => event.seq), [1, 2, 3, 4, 5, 6]);
  // ...or just the part it missed.
  const tail = await readStream("vincent", `/jobs/${jobId}/events?after=4`);
  assert.deepEqual(tail.map((event) => event.type), ["message_delta", "done"]);
  // And a stream that starts after the terminal event closes right away with nothing.
  assert.deepEqual(await readStream("vincent", `/jobs/${jobId}/events?after=6`), []);
});

test("owner isolation through HTTP: another account gets 404 on the job, its events, its interrupt and its cards", { skip }, async () => {
  const { body } = await call("vincent", "POST", "/jobs", turn("#ask private"));
  const { jobId } = body;
  const card = await until(async () => (await engine.approvals.list("u-vincent")).find((item) => item.job_id === jobId), { label: "card" });
  assert.equal((await call("other", "GET", `/jobs/${jobId}`)).status, 404);
  assert.equal((await fetch(`${base}/jobs/${jobId}/events`, { headers: { authorization: "Bearer other" } })).status, 404);
  assert.equal((await call("other", "POST", `/jobs/${jobId}/interrupt`, {})).status, 404);
  assert.equal((await call("other", "GET", `/approvals/${card.id}`)).status, 404);
  assert.equal((await call("other", "POST", `/approvals/${card.id}`, { allow: true })).status, 404);
  assert.deepEqual((await call("other", "GET", "/approvals")).body, { approvals: [] });
  // The owner sees the card and decides it; a second decision is a 409.
  const mine = await call("vincent", "GET", "/approvals");
  assert.equal(mine.body.approvals.some((item) => item.id === card.id), true);
  assert.equal((await call("vincent", "POST", `/approvals/${card.id}`, { allow: "yes" })).status, 400);
  const decided = await call("vincent", "POST", `/approvals/${card.id}`, { allow: true });
  assert.deepEqual(decided, { status: 200, body: { ok: true, status: "approved" } });
  const again = await call("vincent", "POST", `/approvals/${card.id}`, { allow: false });
  assert.equal(again.status, 409);
  assert.equal(again.body.status, "approved");
  assert.equal((await call("vincent", "GET", `/approvals/${card.id}`)).body.approval.decided_by, "vincent@example.test");
  const events = await readStream("vincent", `/jobs/${jobId}/events?after=0`);
  const request = events.find((event) => event.type === "permission_request");
  assert.equal(request.permissionId, card.id);
  assert.equal(events.find((event) => event.type === "permission_resolved").allow, true);
  assert.equal(events.find((event) => event.type === "tool_end").code, 126, "the SB-29 shell gate answered the approved command");
});

test("a paused agent is refused with 409, an unknown agent with 404, and a body that names a slug or an owner with 400", { skip }, async () => {
  const count = async () => (await db.sql`select count(*)::int as n from jobs`)[0].n;
  const before = await count();
  const paused = await call("vincent", "POST", "/jobs", turn("wake", { agentId: "sleepy" }));
  assert.equal(paused.status, 409);
  assert.equal(paused.body.error, "paused");
  assert.equal((await call("vincent", "POST", "/jobs", turn("hi", { agentId: "ghost" }))).status, 404);
  const slug = await call("vincent", "POST", "/jobs", { ...turn("hi"), agentSlug: "pixelpets" });
  assert.equal(slug.status, 400);
  assert.match(slug.body.error, /agentSlug is not a known field/);
  assert.equal((await call("vincent", "POST", "/jobs", { ...turn("hi"), owner: "u-other" })).status, 400);
  assert.equal((await call("vincent", "POST", "/jobs", { ...turn("hi"), key: "sk-ant-x" })).status, 400);
  assert.equal((await call("vincent", "POST", "/jobs", { threadId: "t-qa", text: "" })).status, 400);
  assert.equal((await fetch(`${base}/jobs`, { method: "POST", headers: { authorization: "Bearer vincent", "content-type": "application/json" }, body: "{not json" })).status, 400);
  assert.equal(await count(), before);
});

test("interrupt stops a running turn and the stream ends with a stopped marker", { skip }, async () => {
  const { body } = await call("vincent", "POST", "/jobs", turn("#hang long"));
  const { jobId } = body;
  await fake.held(jobId);
  const stop = await call("vincent", "POST", `/jobs/${jobId}/interrupt`, {});
  assert.deepEqual(stop, { status: 200, body: { ok: true, status: "cancelling" } });
  const events = await readStream("vincent", `/jobs/${jobId}/events?after=0`);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).stopped, true);
  assert.equal((await call("vincent", "GET", `/jobs/${jobId}`)).body.job.status, "cancelled");
  // Interrupting again is a no-op with the current status.
  assert.deepEqual((await call("vincent", "POST", `/jobs/${jobId}/interrupt`, {})).body, { ok: false, status: "cancelled" });
  assert.equal((await call("vincent", "POST", "/jobs/nope/interrupt", {})).status, 404);
});
