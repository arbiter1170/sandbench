// pg-boss wrapper (SB-03 PR 2). pg-boss keeps its own tables in its own schema (default `pgboss`);
// `jobs` and `job_events` stay ours, linked by `jobs.queue_job_id`. One queue so far, `agent.turn`,
// with the `singleton` policy and `singletonKey = agentId`: one turn per agent runs at a time and
// the rest wait in the queue. The global cap is `localConcurrency` from runner/jobs/limits.mjs
// (SANDBENCH_MAX_TURNS, default 2). Retries are ours (jobs.attempt), so pg-boss's retryLimit is 0.
//
// pg-boss 12.x needs Node 22.12+ and Postgres 13+; CI runs Postgres 17.
import { PgBoss } from "pg-boss";

export const TURN_QUEUE = "agent.turn";
export const DEFAULT_TURN_TIMEOUT_S = 60 * 60;
const MAX_EXPIRE_S = 24 * 60 * 60; // pg-boss's own ceiling

// pg-boss background work this runner doesn't need yet; tests pass more of these to stay quiet.
const QUIET = { schedule: false, registerInstance: false, monitorVacuum: false, reindex: false };

/**
 * @param {object} options
 * @param {string} options.connectionString  DATABASE_URL (pg-boss opens its own small pool)
 * @param {string} [options.schema]          pg-boss's schema (tests use one per file)
 * @param {{ maxTurns: number }} options.limits
 * @param {object} [options.bossOptions]     passed through to the PgBoss constructor
 */
export function createQueue({ connectionString, schema = "pgboss", limits, bossOptions = {}, onError = () => {} }) {
  if (!connectionString) throw new Error("The queue needs a database connection string.");
  if (!limits || !Number.isInteger(limits.maxTurns) || limits.maxTurns < 1) throw new Error("The queue needs limits.maxTurns.");
  const boss = new PgBoss({ connectionString, schema, max: Math.max(3, limits.maxTurns + 2), ...QUIET, ...bossOptions });
  boss.on("error", (error) => onError(error));
  let started = false;

  async function start() {
    if (started) return;
    await boss.start();
    // Idempotent: pg-boss leaves an existing queue's policy alone.
    await boss.createQueue(TURN_QUEUE, { policy: "singleton", retryLimit: 0, expireInSeconds: Math.min(DEFAULT_TURN_TIMEOUT_S, MAX_EXPIRE_S) });
    started = true;
  }

  /** Queues one turn. The handler gets `{ jobId }` and finds the rest in our `jobs` row. */
  async function enqueueTurn({ jobId, agentId, timeoutS = DEFAULT_TURN_TIMEOUT_S }) {
    const expire = Math.min(Math.max(Number(timeoutS) || DEFAULT_TURN_TIMEOUT_S, 1), MAX_EXPIRE_S);
    const id = await boss.send(TURN_QUEUE, { jobId }, { singletonKey: agentId, expireInSeconds: expire, retryLimit: 0 });
    if (!id) throw new Error("pg-boss refused the job.");
    return id;
  }

  /** `handler({ jobId })` runs one turn; up to limits.maxTurns run at once, one per agent. */
  async function work(handler, { pollingIntervalSeconds = 1 } = {}) {
    return boss.work(TURN_QUEUE, { localConcurrency: limits.maxTurns, batchSize: 1, pollingIntervalSeconds }, async ([job]) => {
      await handler(job.data);
    });
  }

  /** A queued (not yet active) pg-boss job; true when it was cancelled. */
  async function cancel(queueJobId) {
    if (!queueJobId) return false;
    const result = await boss.cancel(TURN_QUEUE, queueJobId);
    return result.affected > 0;
  }

  /** Settles an orphaned active pg-boss job (a turn whose engine died), freeing its singleton key. */
  async function fail(queueJobId, reason = "interrupted") {
    if (!queueJobId) return false;
    const result = await boss.fail(TURN_QUEUE, queueJobId, { reason });
    return result.affected > 0;
  }

  async function state(queueJobId) {
    const job = await boss.getJobById(TURN_QUEUE, queueJobId);
    return job?.state ?? null;
  }

  /** Stops polling without settling active jobs: what a crash looks like to the database. */
  async function abandon() {
    await boss.offWork(TURN_QUEUE, { wait: false });
  }

  async function stop({ graceful = false, timeout = 5000 } = {}) {
    if (!started) return;
    started = false;
    await boss.stop({ graceful, timeout, close: true });
  }

  return { start, stop, enqueueTurn, work, cancel, fail, state, abandon, boss };
}
