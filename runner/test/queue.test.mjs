// SB-03 PR 2: the pg-boss wrapper against real Postgres (TEST_DATABASE_URL; CI fails if this
// skips). pg-boss works in its own schema (sb_queue_boss); nothing here touches our tables.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createQueue, TURN_QUEUE } from "../jobs/queue.mjs";
import { readLimits, DEFAULT_MAX_BUILDS, DEFAULT_MAX_TURNS } from "../jobs/limits.mjs";

const URL_ = process.env.TEST_DATABASE_URL || "";
const skip = !URL_ ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(URL_) ? "TEST_DATABASE_URL must name a *_test database" : false;
const SCHEMA = "sb_queue_boss";
const QUIET = { supervise: false };
const queues = [];

async function clean() {
  const { default: postgres } = await import("postgres");
  const sql = postgres(URL_, { max: 1, onnotice: () => {} });
  const rows = await sql`select nspname from pg_namespace where nspname like ${`${SCHEMA}%`}`;
  for (const row of rows) await sql.unsafe(`drop schema if exists ${row.nspname} cascade`);
  await sql.end({ timeout: 1 });
}

before(async () => {
  if (skip) return;
  await clean();
});

after(async () => {
  for (const queue of queues) await queue.stop().catch(() => undefined);
  if (!skip) await clean();
});

async function open(suffix, maxTurns) {
  const queue = createQueue({ connectionString: URL_, schema: `${SCHEMA}_${suffix}`, limits: { maxTurns, maxBuilds: 1 }, bossOptions: QUIET });
  queues.push(queue);
  await queue.start();
  return queue;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("limits come from the environment with the laptop defaults, and bad values fall back", () => {
  assert.deepEqual(readLimits({}), { maxTurns: DEFAULT_MAX_TURNS, maxBuilds: DEFAULT_MAX_BUILDS });
  assert.deepEqual(readLimits({}), { maxTurns: 2, maxBuilds: 1 });
  assert.deepEqual(readLimits({ SANDBENCH_MAX_TURNS: "3", SANDBENCH_MAX_BUILDS: "2" }), { maxTurns: 3, maxBuilds: 2 });
  for (const bad of ["0", "-1", "abc", "2.5", "999", ""]) assert.equal(readLimits({ SANDBENCH_MAX_TURNS: bad }).maxTurns, 2, `bad value ${JSON.stringify(bad)}`);
  assert.throws(() => createQueue({ connectionString: URL_ || "postgres://x", limits: { maxTurns: 0 } }), /maxTurns/);
  assert.throws(() => createQueue({ connectionString: "", limits: { maxTurns: 1 } }), /connection string/);
});

test("one turn per agent at a time (singletonKey), and no more than the cap overall", { skip }, async () => {
  const queue = await open("cap", 2);
  const log = [];
  let active = 0;
  let peak = 0;
  const finished = new Map();
  await queue.work(async ({ jobId }) => {
    active += 1;
    peak = Math.max(peak, active);
    log.push(`start ${jobId}`);
    await sleep(jobId.startsWith("a") ? 700 : 300);
    active -= 1;
    log.push(`end ${jobId}`);
    finished.get(jobId)?.();
  }, { pollingIntervalSeconds: 0.5 });
  const waits = [];
  const send = async (jobId, agentId) => {
    waits.push(new Promise((resolve) => finished.set(jobId, resolve)));
    return queue.enqueueTurn({ jobId, agentId, timeoutS: 60 });
  };
  const ids = [await send("a1", "qa"), await send("a2", "qa"), await send("b1", "design"), await send("c1", "sprites")];
  await Promise.all(waits);
  // pg-boss settles a job a moment after its handler resolves.
  for (const id of ids) {
    const deadline = Date.now() + 3000;
    while ((await queue.state(id)) !== "completed" && Date.now() < deadline) await sleep(50);
  }
  assert.equal(peak, 2, `peak concurrency was ${peak}`);
  assert.ok(log.indexOf("start a2") > log.indexOf("end a1"), `qa's second turn waited: ${log.join(", ")}`);
  assert.ok(log.indexOf("start b1") < log.indexOf("end a1"), `design ran alongside qa: ${log.join(", ")}`);
  for (const id of ids) assert.equal(await queue.state(id), "completed");
});

test("a queued job can be cancelled; an orphaned active job can be failed from another instance, freeing its key", { skip }, async () => {
  const first = await open("orphan", 1);
  let holding;
  const held = new Promise((resolve) => (holding = resolve));
  await first.work(async () => {
    holding();
    await new Promise(() => undefined); // never settles: the process "dies" with the job active
  }, { pollingIntervalSeconds: 0.5 });
  const activeId = await first.enqueueTurn({ jobId: "j-active", agentId: "qa", timeoutS: 60 });
  await held;
  const waitingId = await first.enqueueTurn({ jobId: "j-waiting", agentId: "qa", timeoutS: 60 });
  await sleep(700);
  assert.equal(await first.state(activeId), "active");
  assert.equal(await first.state(waitingId), "created", "the same agent's next turn waits");
  // Cancel works on the waiting one only.
  assert.equal(await first.cancel(waitingId), true);
  assert.equal(await first.state(waitingId), "cancelled");
  assert.equal(await first.state(activeId), "active", "the active one is untouched");
  await first.abandon();

  // A second instance (the restarted runner) settles the orphan; qa's key is free again.
  const second = createQueue({ connectionString: URL_, schema: `${SCHEMA}_orphan`, limits: { maxTurns: 1, maxBuilds: 1 }, bossOptions: QUIET });
  queues.push(second);
  await second.start();
  assert.equal(await second.fail(activeId, "interrupted"), true);
  assert.equal(await second.state(activeId), "failed");
  assert.equal(await second.fail(activeId), false, "already settled");
  const ran = [];
  await second.work(async ({ jobId }) => {
    ran.push(jobId);
  }, { pollingIntervalSeconds: 0.5 });
  const nextId = await second.enqueueTurn({ jobId: "j-next", agentId: "qa", timeoutS: 60 });
  const deadline = Date.now() + 5000;
  while (!ran.length && Date.now() < deadline) await sleep(50);
  assert.deepEqual(ran, ["j-next"]);
  assert.equal(await second.state(nextId), "completed");
  assert.equal(await second.cancel(null), false);
  assert.equal(await second.fail(undefined), false);
});

test("the queue name and timeout bounds", { skip }, async () => {
  const queue = await open("bounds", 1);
  assert.equal(TURN_QUEUE, "agent.turn");
  // pg-boss caps expiration at 24 hours; a huge timeout is clamped rather than refused.
  const id = await queue.enqueueTurn({ jobId: "j-long", agentId: "qa", timeoutS: 10 * 24 * 60 * 60 });
  const job = await queue.boss.getJobById(TURN_QUEUE, id);
  assert.equal(job.expireInSeconds, 24 * 60 * 60);
  assert.equal(job.singletonKey, "qa");
  assert.equal(job.retryLimit, 0);
  assert.deepEqual(job.data, { jobId: "j-long" });
  await queue.cancel(id);
});
