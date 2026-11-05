// SB-03 PR 2: the turn engine on real Postgres with the fake driver. Needs TEST_DATABASE_URL (CI
// fails if this skips). Works in its own schema (sb_engine); each test gets its own pg-boss schema
// (sb_engine_boss_<name>) so engines never take each other's jobs, except the restart test, whose
// engine generations share one queue, as a real restart does.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FAILED_TWICE_MESSAGE, INTERRUPTED_MESSAGE } from "../worker/engine.mjs";
import { SHELL_GATE_MESSAGE, TOOLS_GATE_MESSAGE } from "../worker/turns.mjs";
import { agentRecord, makeEngine, setupDb, skip, until } from "./fixtures/engine-harness.mjs";

const OWNER = "u-vincent";
const OTHER = "u-other";
let db;
const open = [];

const SCRIPTS = {
  reply: [{ say: "Hello " }, { say: "from the fake." }],
  slow: [{ say: "slow " }, { wait: 1500 }, { say: "done" }],
  hang: [{ say: "before the crash " }, { hang: true }, { say: "after" }],
  ask: [{ say: "asking " }, { ask: "ls -la", reason: "list files" }, { say: " end" }],
  fail: [{ say: "oops " }, { fail: "the model fell over" }],
};

before(async () => {
  if (skip) return;
  db = await setupDb("sb_engine");
  for (const id of ["qa", "pixelpets", "design", "sprites", "sleepy"]) await db.store.create(OWNER, "agents", id, agentRecord(id, id === "sleepy" ? { paused: true } : {}));
  await db.store.create(OTHER, "agents", "qa", agentRecord("qa"));
});

after(async () => {
  for (const engine of open) await engine.stop().catch(() => undefined);
  for (const engine of open) await engine.dispose().catch(() => undefined);
  await db?.teardown();
});

/** An engine for one test, started, remembered for clean-up. */
async function started(boss, options = {}) {
  const made = makeEngine(db, { scripts: SCRIPTS, boss, ...options });
  open.push(made.engine);
  await made.engine.start({ pollingIntervalSeconds: 0.5 });
  return made;
}

const request = (agentId, text, extra = {}) => ({ threadId: `t-${agentId}`, text, agentId, driver: "fake", ...extra });
const finished = (engine, id, states = ["done", "failed", "cancelled"]) =>
  until(async () => {
    const job = await engine.getJob(OWNER, id);
    return job && states.includes(job.status) ? job : null;
  }, { label: `job ${id} to reach ${states.join("/")}` });
const cardFor = (engine, jobId) => until(async () => (await engine.approvals.list(OWNER, { status: "pending" })).find((item) => item.job_id === jobId), { label: `a pending card for ${jobId}` });
const types = (events) => events.map((event) => event.type);

test("a turn gets its reply: events in order, the reply as a messages record, and a late reader sees everything", { skip }, async () => {
  const { engine, fake } = await started("reply");
  const { jobId, replyId, messageId } = await engine.startTurn({ owner: OWNER, request: request("qa", "say hello", { messageId: "m-user-1", replyId: "m-reply-1" }) });
  assert.equal(messageId, "m-user-1");
  assert.equal(replyId, "m-reply-1");
  const job = await finished(engine, jobId);
  assert.equal(job.status, "done");
  assert.equal(job.exit_code, 0);
  assert.ok(job.started_at && job.finished_at);
  assert.ok(job.session_id, "the driver's session id was recorded on the job");
  // A client attaching after the fact reads the whole stream from seq 1...
  const events = await engine.events.list(jobId, 0);
  assert.deepEqual(types(events), ["queued", "turn_start", "thinking", "message_delta", "message_delta", "done"]);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4, 5, 6]);
  // ...and paging from the middle continues where it left off.
  assert.deepEqual(types(await engine.events.list(jobId, 4)), ["message_delta", "done"]);
  // The reply is a record in the thread, so the SB-02 stream already carries it.
  const reply = await db.store.get(OWNER, "messages", "m-reply-1");
  assert.equal(reply.data.text, "Hello from the fake.");
  assert.equal(reply.data.status, "done");
  assert.equal(reply.data.role, "assistant");
  assert.equal(reply.data.authorBotId, "qa");
  assert.equal(reply.threadId, "t-qa");
  const user = await db.store.get(OWNER, "messages", "m-user-1");
  assert.equal(user.data.text, "say hello");
  assert.equal(user.data.role, "user");
  // The driver got a system prompt built from the agent record, no history for a fresh thread,
  // the agent's own folder as cwd, and no key (none was named).
  const call = fake.calls.at(-1);
  assert.match(call.turn.system, /You are QA, tester/);
  assert.deepEqual(call.turn.history, []);
  assert.ok(call.turn.cwd.endsWith("/agents/qa"), call.turn.cwd);
  assert.equal(call.rawKey, "");
  assert.deepEqual(call.turn.extras, {});
});

test("the page's stand-in reply record is patched, not duplicated, and earlier messages become history", { skip }, async () => {
  const { engine, fake } = await started("standin");
  await db.store.create(OWNER, "messages", "m-user-2", { id: "m-user-2", role: "user", text: "second question", createdAt: Date.now(), status: "done", attachments: [], localStandIn: false, fresh: false }, { threadId: "t-qa" });
  const standIn = await db.store.create(OWNER, "messages", "m-reply-2", { id: "m-reply-2", role: "assistant", text: "", createdAt: Date.now(), status: "streaming", attachments: [], localStandIn: false, fresh: true, thinking: ["Hand the turn to Fake driver."] }, { threadId: "t-qa" });
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("qa", "second question", { messageId: "m-user-2", replyId: "m-reply-2" }) });
  assert.equal((await finished(engine, jobId)).status, "done");
  const reply = await db.store.get(OWNER, "messages", "m-reply-2");
  assert.equal(reply.version, standIn.version + 1);
  assert.equal(reply.data.text, "Hello from the fake.");
  assert.equal(reply.data.status, "done");
  assert.deepEqual(reply.data.thinking, ["Hand the turn to Fake driver."], "the page's own fields survive the patch");
  const all = await db.store.list(OWNER, "messages", { threadId: "t-qa" });
  assert.deepEqual(all.items.map((item) => item.id).sort(), ["m-reply-1", "m-reply-2", "m-user-1", "m-user-2"]);
  // History: the first exchange, in order, without this turn's own two records.
  assert.deepEqual(fake.calls.at(-1).turn.history, [
    { role: "user", content: "say hello" },
    { role: "assistant", content: "Hello from the fake." },
  ]);
});

test("the named key reaches the driver on the turn object only, with the agent's scope applied", { skip }, async () => {
  const { engine, fake } = await started("keys", { secretsEnv: { ANTHROPIC_API_KEY: "sk-ant-test-value-0123456789" } });
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("qa", "with a key", { secret: "ANTHROPIC_API_KEY", model: "claude-sonnet-5", base: "https://api.anthropic.com/v1" }) });
  assert.equal((await finished(engine, jobId)).status, "done");
  const call = fake.calls.at(-1);
  assert.equal(call.rawKey, "sk-ant-test-value-0123456789");
  assert.equal(call.turn.model, "claude-sonnet-5");
  assert.equal(call.turn.base, "https://api.anthropic.com/v1");
  assert.deepEqual(call.turn.extras, {});
  // The job row never holds the value: payload carries the name only.
  const job = await engine.getJob(OWNER, jobId);
  assert.equal(job.payload.secret, "ANTHROPIC_API_KEY");
  assert.equal(JSON.stringify(job).includes("sk-ant-test"), false);
});

test("two turns for one agent run one after the other; different agents run together, never more than the cap", { skip }, async () => {
  const { engine } = await started("cap", { env: { SANDBENCH_MAX_TURNS: "2" } });
  assert.equal(engine.limits.maxTurns, 2);
  const a1 = await engine.startTurn({ owner: OWNER, request: request("pixelpets", "#slow one") });
  const a2 = await engine.startTurn({ owner: OWNER, request: request("pixelpets", "#slow two") });
  const b1 = await engine.startTurn({ owner: OWNER, request: request("design", "#slow three") });
  const c1 = await engine.startTurn({ owner: OWNER, request: request("sprites", "#slow four") });
  const jobs = await Promise.all([a1, a2, b1, c1].map(({ jobId }) => finished(engine, jobId)));
  assert.deepEqual(jobs.map((job) => job.status), ["done", "done", "done", "done"]);
  const span = (id) => {
    const job = jobs.find((item) => item.id === id);
    return { start: new Date(job.started_at).getTime(), end: new Date(job.finished_at).getTime() };
  };
  // Same agent: the second turn started only after the first finished.
  assert.ok(span(a2.jobId).start >= span(a1.jobId).end, "pixelpets' second turn waited for its first");
  // Different agents overlapped: at least two turns were running at the same moment...
  const spans = jobs.map((job) => span(job.id));
  const concurrentAt = (t) => spans.filter((item) => item.start <= t && t < item.end).length;
  const moments = spans.flatMap((item) => [item.start, item.end]);
  const peak = Math.max(...moments.map(concurrentAt));
  assert.ok(peak >= 2, `expected overlap, peak was ${peak}`);
  // ...and never more than the cap.
  assert.ok(peak <= 2, `cap exceeded: ${peak}`);
});

test("permission requests are denied with a reason while agent tools are gated (the main.mjs default)", { skip }, async () => {
  const { engine, fake } = await started("gated", { agentTools: false });
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("qa", "#ask please list") });
  assert.equal((await finished(engine, jobId)).status, "done");
  const events = await engine.events.list(jobId, 0);
  const ask = events.find((event) => event.type === "permission_request");
  assert.equal(ask.data.denied, true);
  assert.equal(ask.data.deniedReason, TOOLS_GATE_MESSAGE);
  assert.equal(events.filter((event) => event.type === "tool_start").length, 0);
  assert.equal((await db.sql`select count(*)::int as n from approvals where job_id = ${jobId}`)[0].n, 0, "no card was created");
  assert.equal(fake.calls.at(-1).permissions[0].allowed, false);
});

test("with tools allowed, a request becomes an approval card; approving it runs into the SB-29 shell gate", { skip }, async () => {
  const { engine, fake } = await started("cards");
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("design", "#ask list the folder") });
  const card = await cardFor(engine, jobId);
  assert.equal(card.class, "yellow");
  assert.equal(card.required_approver, "owner");
  assert.equal(card.request.command, "ls -la");
  assert.equal(card.request.policy, "No policy installed yet");
  // The other account can't see or decide it.
  assert.equal(await engine.approvals.get(OTHER, card.id), null);
  assert.deepEqual(await engine.approvals.decide({ owner: OTHER, id: card.id, allow: true }), { ok: false, status: null });
  assert.deepEqual(await engine.approvals.decide({ owner: OWNER, id: card.id, allow: true }), { ok: true, status: "approved" });
  // A second decision changes nothing.
  assert.deepEqual(await engine.approvals.decide({ owner: OWNER, id: card.id, allow: false }), { ok: false, status: "approved" });
  assert.equal((await finished(engine, jobId)).status, "done");
  const events = await engine.events.list(jobId, 0);
  assert.deepEqual(types(events).filter((type) => ["permission_request", "permission_resolved", "tool_start", "tool_end"].includes(type)), ["permission_request", "permission_resolved", "tool_start", "tool_end"]);
  assert.equal(events.find((event) => event.type === "permission_request").data.permissionId, card.id);
  const end = events.find((event) => event.type === "tool_end");
  assert.equal(end.data.code, 126);
  assert.equal(end.data.output, SHELL_GATE_MESSAGE);
  assert.equal(fake.calls.at(-1).commands[0].code, 126);
  assert.equal((await engine.approvals.get(OWNER, card.id)).decided_by, OWNER);
});

test("with a shell wired in (SB-29 later), an approved command runs in the agent's folder", { skip }, async () => {
  const ran = [];
  const shell = async (command, { cwd }) => {
    ran.push({ command, cwd });
    return { code: 0, stdout: "file-a\n", stderr: "", truncated: false, ms: 3 };
  };
  const { engine } = await started("shell", { shell });
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("design", "#ask go", { folder: "sub/dir" }) });
  const card = await cardFor(engine, jobId);
  await engine.approvals.decide({ owner: OWNER, id: card.id, allow: true });
  assert.equal((await finished(engine, jobId)).status, "done");
  assert.equal(ran.length, 1);
  assert.equal(ran[0].command, "ls -la");
  assert.ok(ran[0].cwd.endsWith("/agents/design/sub/dir"), ran[0].cwd);
  const end = (await engine.events.list(jobId, 0)).find((event) => event.type === "tool_end");
  assert.deepEqual({ code: end.data.code, output: end.data.output }, { code: 0, output: "file-a\n" });
});

test("a folder outside the agent's areas fails the turn before any driver call", { skip }, async () => {
  const { engine, fake } = await started("folder");
  const before = fake.calls.length;
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("design", "hi", { folder: "../pixelpets" }) });
  const job = await finished(engine, jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /'\.\.'/);
  assert.equal(fake.calls.length, before);
});

test("a denied card, and a turn interrupted while it waits on a card", { skip }, async () => {
  const { engine } = await started("deny");
  const denied = await engine.startTurn({ owner: OWNER, request: request("design", "#ask rm -rf /") });
  const card = await cardFor(engine, denied.jobId);
  await engine.approvals.decide({ owner: OWNER, id: card.id, allow: false });
  assert.equal((await finished(engine, denied.jobId)).status, "done");
  const reply = await db.store.get(OWNER, "messages", `${denied.jobId}-reply`);
  assert.match(reply.data.text, /\[denied\]/);
  const events = await engine.events.list(denied.jobId, 0);
  assert.equal(events.filter((event) => event.type === "tool_start").length, 0);
  assert.equal(events.find((event) => event.type === "permission_resolved").data.allow, false);

  const waiting = await engine.startTurn({ owner: OWNER, request: request("design", "#ask sleep 100") });
  const second = await cardFor(engine, waiting.jobId);
  assert.deepEqual(await engine.interrupt(OWNER, waiting.jobId), { ok: true, status: "cancelling" });
  const stopped = await finished(engine, waiting.jobId);
  assert.equal(stopped.status, "cancelled");
  assert.equal((await engine.events.list(waiting.jobId, 0)).at(-1).data.stopped, true);
  // The interrupt doesn't decide the card; it stays pending until its timeout expires it.
  assert.equal((await engine.approvals.get(OWNER, second.id)).status, "pending");
  // Interrupting a finished job changes nothing.
  assert.deepEqual(await engine.interrupt(OWNER, denied.jobId), { ok: false, status: "done" });
});

test("a queued turn can be dropped before it runs", { skip }, async () => {
  const { engine } = await started("drop");
  const first = await engine.startTurn({ owner: OWNER, request: request("sprites", "#slow hold the line") });
  const queued = await engine.startTurn({ owner: OWNER, request: request("sprites", "never runs") });
  await finished(engine, first.jobId, ["running"]);
  assert.deepEqual(await engine.interrupt(OWNER, queued.jobId), { ok: true, status: "cancelled" });
  assert.equal((await finished(engine, first.jobId)).status, "done");
  const dropped = await engine.getJob(OWNER, queued.jobId);
  assert.equal(dropped.status, "cancelled");
  assert.deepEqual(types(await engine.events.list(queued.jobId, 0)), ["queued", "done"]);
  assert.equal(await engine.queue.state(dropped.queue_job_id), "cancelled");
});

test("a failing driver fails the job and writes the error to the reply", { skip }, async () => {
  const { engine } = await started("fail");
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("qa", "#fail now") });
  const job = await finished(engine, jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.error, "the model fell over");
  const events = await engine.events.list(jobId, 0);
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).data.message, "the model fell over");
  const reply = await db.store.get(OWNER, "messages", `${jobId}-reply`);
  assert.equal(reply.data.status, "error");
  assert.equal(reply.data.text, "the model fell over");
});

test("a paused agent, an unknown agent, another owner's agent and a bad body are refused before anything is queued", { skip }, async () => {
  const { engine } = await started("refuse");
  const count = async () => (await db.sql`select count(*)::int as n from jobs`)[0].n;
  const before = await count();
  await assert.rejects(engine.startTurn({ owner: OWNER, request: request("sleepy", "wake up") }), (error) => error.status === 409 && /paused/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: request("nobody", "hi") }), (error) => error.status === 404);
  await assert.rejects(engine.startTurn({ owner: OTHER, request: request("pixelpets", "hi") }), (error) => error.status === 404, "pixelpets belongs to the other owner");
  await assert.rejects(engine.startTurn({ owner: OWNER, request: { ...request("qa", "hi"), agentSlug: "pixelpets" } }), (error) => error.status === 400 && /agentSlug/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: { ...request("qa", "hi"), owner: OTHER } }), (error) => error.status === 400 && /owner/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: { ...request("qa", "hi"), key: "sk-ant-nope" } }), (error) => error.status === 400 && /key/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: request("qa", "hi", { secret: "GITHUB_TOKEN" }) }), (error) => error.status === 400 && /secret/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: request("qa", "hi", { base: "http://10.0.0.5/v1" }) }), (error) => error.status === 400 && /base/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: request("qa", "hi", { driver: "nope" }) }), (error) => error.status === 400 && /driver/.test(error.message));
  await assert.rejects(engine.startTurn({ owner: OWNER, request: { threadId: "t", text: "hi", driver: "fake" } }), (error) => error.status === 400 && /agentId/.test(error.message));
  assert.equal(await count(), before);
});

test("owner isolation: another account sees neither the job nor its events, and can't interrupt it", { skip }, async () => {
  const { engine } = await started("owner");
  const { jobId } = await engine.startTurn({ owner: OWNER, request: request("qa", "mine") });
  await finished(engine, jobId);
  assert.equal(await engine.getJob(OTHER, jobId), null);
  assert.deepEqual(await engine.interrupt(OTHER, jobId), { ok: false, status: null });
  assert.ok(await engine.getJob(OWNER, jobId));
});

test("restart: a turn the engine died on is retried exactly once (resuming its session), and a second death fails it", { skip }, async () => {
  // Engine A takes the job and dies mid-turn.
  const a = await started("restart");
  const { jobId } = await a.engine.startTurn({ owner: OWNER, request: request("qa", "#hang crash test") });
  await a.fake.held(jobId);
  // The session id is written as soon as the driver reports it (a moment after the hold starts).
  const mid = await until(async () => {
    const job = await a.engine.getJob(OWNER, jobId);
    return job?.status === "running" && job.session_id ? job : null;
  }, { label: "the session id on the running job" });
  assert.equal(mid.attempt, 0);
  await a.engine.abandon(); // a crash: no row is touched, pg-boss still shows the job active
  assert.equal((await a.engine.getJob(OWNER, jobId)).status, "running");
  assert.equal(await a.engine.queue.state(mid.queue_job_id), "active");

  // Engine B starts on the same queue: the orphan's pg-boss job is failed (freeing qa's singleton
  // key), the turn is queued once more with attempt 1 and the session to resume, and it finishes.
  const b = makeEngine(db, { scripts: { ...SCRIPTS, hang: SCRIPTS.reply }, boss: "restart" });
  open.push(b.engine);
  await b.engine.start({ pollingIntervalSeconds: 0.5 });
  assert.equal(await b.engine.queue.state(mid.queue_job_id), "failed");
  const done = await finished(b.engine, jobId);
  assert.equal(done.status, "done");
  assert.equal(done.attempt, 1);
  assert.notEqual(done.queue_job_id, mid.queue_job_id);
  const events = await b.engine.events.list(jobId, 0);
  const interrupted = events.find((event) => event.type === "interrupted");
  assert.equal(interrupted.data.message, INTERRUPTED_MESSAGE);
  assert.equal(interrupted.data.attempt, 1);
  assert.equal(interrupted.data.resume, true);
  assert.equal(types(events).filter((type) => type === "turn_start").length, 2);
  assert.equal(events.filter((event) => event.type === "turn_start").at(-1).data.resumed, true);
  assert.equal(b.fake.calls.at(-1).turn.extras.resume, mid.session_id, "the retry resumed the recorded session");
  assert.equal((await db.store.get(OWNER, "messages", `${jobId}-reply`)).data.text, "Hello from the fake.");
  await b.engine.abandon();

  // A turn that dies twice is failed, not retried again.
  const c = makeEngine(db, { scripts: SCRIPTS, boss: "restart" });
  open.push(c.engine);
  await c.engine.start({ pollingIntervalSeconds: 0.5 });
  const twice = await c.engine.startTurn({ owner: OWNER, request: request("qa", "#hang twice") });
  await c.fake.held(twice.jobId);
  await c.engine.abandon();
  const d = makeEngine(db, { scripts: SCRIPTS, boss: "restart" });
  open.push(d.engine);
  await d.engine.start({ pollingIntervalSeconds: 0.5 });
  await d.fake.held(twice.jobId); // the one retry is running
  assert.equal((await d.engine.getJob(OWNER, twice.jobId)).attempt, 1);
  await d.engine.abandon();
  const e = makeEngine(db, { scripts: SCRIPTS, boss: "restart" });
  open.push(e.engine);
  await e.engine.start({ pollingIntervalSeconds: 0.5 });
  const dead = await e.engine.getJob(OWNER, twice.jobId);
  assert.equal(dead.status, "failed");
  assert.equal(dead.error, FAILED_TWICE_MESSAGE);
  const last = (await e.engine.events.list(twice.jobId, 0)).at(-1);
  assert.equal(last.type, "error");
  assert.equal(last.data.message, FAILED_TWICE_MESSAGE);
  assert.equal((await db.store.get(OWNER, "messages", `${twice.jobId}-reply`)).data.status, "error");
  // A clean stop of a running engine also leaves the row for the next start to retry.
  const f = makeEngine(db, { scripts: SCRIPTS, boss: "restart" });
  open.push(f.engine);
  await f.engine.start({ pollingIntervalSeconds: 0.5 });
  const slow = await f.engine.startTurn({ owner: OWNER, request: request("qa", "#hang stop test") });
  await f.fake.held(slow.jobId);
  await f.engine.stop();
  assert.equal((await f.engine.getJob(OWNER, slow.jobId)).status, "cancelled", "a clean stop cancels its own running turns");
});

test("pending approvals survive a restart and expire by time, not by the restart", { skip }, async () => {
  const first = await started("approvals", { approvalTimeoutMs: 1500 });
  const { jobId } = await first.engine.startTurn({ owner: OWNER, request: request("design", "#ask touch x") });
  const card = await cardFor(first.engine, jobId);
  await first.engine.abandon();
  // Still pending right after the "crash"...
  assert.equal((await first.engine.approvals.get(OWNER, card.id)).status, "pending");
  // ...the next engine's start leaves a young card alone (the orphaned turn is retried and asks
  // again, so a second card appears), and expires both once they are old.
  const next = makeEngine(db, { scripts: SCRIPTS, boss: "approvals", approvalTimeoutMs: 1500 });
  open.push(next.engine);
  await next.engine.start({ pollingIntervalSeconds: 0.5 });
  assert.equal((await next.engine.approvals.get(OWNER, card.id)).status, "pending");
  await until(async () => (await next.engine.approvals.list(OWNER, { status: "pending" })).filter((item) => item.job_id === jobId).length === 2, { label: "the retry's card" });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  // The old card (nobody waits on it any more) is expired by the start-up sweep; the live one is
  // expired by its own timer. Either way both end "expired", never "denied" or lost.
  assert.ok((await next.engine.approvals.expireStale()) >= 1);
  assert.equal((await next.engine.approvals.get(OWNER, card.id)).status, "expired");
  assert.deepEqual((await next.engine.approvals.list(OWNER, { status: "expired" })).filter((item) => item.job_id === jobId).length, 2);
  // The retried turn's wait saw the expiry as a denial and finished.
  const job = await finished(next.engine, jobId);
  assert.equal(job.status, "done");
  assert.match((await db.store.get(OWNER, "messages", `${jobId}-reply`)).data.text, /\[denied\]/);
});
