// The turn engine (SB-03 PR 2): `jobs` rows, the pg-boss queue, the worker loop, interrupts and
// restart recovery. It runs inside the runner process when there is a database (runner/main.mjs);
// it is a module so it can also run in a separate service later (handoff §3, Q4).
//
// Lifecycle of a turn job:
//   startTurn  -> jobs row `queued` (payload = the turn request), user message record, pg-boss send
//   worker     -> `running` (started_at, heartbeat every few seconds), runTurn, then `done` with
//                 the reply written to a `messages` record, or `failed` / `cancelled`
//   restart    -> reconcile(): a `running` row nobody is heartbeating is an orphan. Its pg-boss job
//                 is failed (freeing the agent's singleton key) and the turn is queued once more
//                 with `attempt + 1` ("interrupted, retrying"), resuming the driver session when
//                 one was reported. A second orphaning of the same job fails it for good.
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { driverById as defaultDriverById } from "../../harness/drivers/index.mjs";
import { validateTurnRequest } from "../contracts/turn.mjs";
import { check as defaultPolicy } from "../policy/default.mjs";
import { StoreError } from "../db/store.mjs";
import { createApprovals } from "../jobs/approvals.mjs";
import { createJobEvents, createRedactor } from "../jobs/events.mjs";
import { readLimits } from "../jobs/limits.mjs";
import { createQueue, DEFAULT_TURN_TIMEOUT_S } from "../jobs/queue.mjs";
import { workspaceRoots } from "../workspace/index.mjs";
import { runTurn, TurnError, writeReply } from "./turns.mjs";

export const MAX_ATTEMPTS = 2; // the first run plus exactly one retry
export const INTERRUPTED_MESSAGE = "interrupted, retrying";
export const FAILED_TWICE_MESSAGE = "interrupted twice; not retried";
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const JOB_ID_BYTES = 8;

const toJob = (row) =>
  row
    ? {
        ...row,
        timeout_s: Number(row.timeout_s),
        attempt: Number(row.attempt),
        pid: row.pid === null ? null : Number(row.pid),
        pgid: row.pgid === null ? null : Number(row.pgid),
        exit_code: row.exit_code === null ? null : Number(row.exit_code),
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
        started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
        finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
        heartbeat_at: row.heartbeat_at ? new Date(row.heartbeat_at).toISOString() : null,
      }
    : null;

/**
 * @param {object} deps
 * @param {import("postgres").Sql} deps.sql            the runner's connection (jobs, job_events, approvals)
 * @param {string} deps.connectionString              for pg-boss (its own pool and schema)
 * @param {object} deps.store                         SB-02 record store
 * @param {object|null} deps.memory                   SB-08 memory (optional)
 * @param {object} deps.skills                        SB-08 skills reader
 * @param {string} deps.teamDir
 * @param {string} deps.home                          SANDBENCH_HOME (workspace roots)
 * @param {object} deps.secrets                       secret store
 * @param {object} [deps.env]
 * @param {object} [deps.policy]                      { check } (default: needs a card for everything)
 * @param {function} [deps.driverById]
 * @param {function|null} [deps.shell]                null until SB-29: approved commands are refused, not run
 * @param {boolean} [deps.agentTools]                 false until SB-29: permission requests are denied with a reason
 * @param {string} [deps.bossSchema]
 * @param {object} [deps.bossOptions]
 * @param {number} [deps.heartbeatMs]
 * @param {function} [deps.log]
 */
export function createEngine(deps) {
  const {
    sql,
    connectionString,
    store,
    memory = null,
    skills,
    teamDir = "",
    home,
    secrets,
    env = process.env,
    policy = { check: defaultPolicy },
    driverById = defaultDriverById,
    shell = null,
    agentTools = false,
    bossSchema = "pgboss",
    bossOptions = {},
    heartbeatMs = 5000,
    approvalTimeoutMs,
    log = (...args) => console.log("[engine]", ...args),
  } = deps;
  if (!sql || !store || !home || !connectionString) throw new Error("The engine needs sql, store, home and connectionString.");

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const limits = readLimits(env);
  const roots = workspaceRoots(home);
  const redact = createRedactor({ secrets });
  const events = createJobEvents({ sql, redact, emitter });
  const approvals = createApprovals({ sql, emitter, ...(approvalTimeoutMs ? { timeoutMs: approvalTimeoutMs } : {}) });
  const queue = createQueue({ connectionString, schema: bossSchema, limits, bossOptions, onError: (error) => log("pg-boss:", redact(String(error?.message ?? error))) });
  const running = new Map(); // jobId -> { controller, heartbeat }
  let started = false;

  // ---- jobs rows -------------------------------------------------------------------------------

  async function getJob(owner, id) {
    if (!ID.test(String(id))) return null;
    const [row] = await sql`select * from jobs where owner = ${owner} and id = ${id}`;
    return toJob(row);
  }

  async function loadJob(id) {
    const [row] = await sql`select * from jobs where id = ${id}`;
    return toJob(row);
  }

  async function setStatus(id, status, extra = {}) {
    const { error = null, exit_code = null, finished = false, started: begun = false, session_id, queue_job_id, attempt } = extra;
    await sql`
      update jobs set
        status = ${status},
        updated_at = now(),
        ${begun ? sql`started_at = now(), heartbeat_at = now(),` : sql``}
        ${finished ? sql`finished_at = now(),` : sql``}
        ${session_id !== undefined ? sql`session_id = ${session_id},` : sql``}
        ${queue_job_id !== undefined ? sql`queue_job_id = ${queue_job_id},` : sql``}
        ${attempt !== undefined ? sql`attempt = ${attempt},` : sql``}
        error = ${error === null ? null : redact(String(error)).slice(0, 8000)},
        exit_code = ${exit_code}
      where id = ${id}`;
  }

  const heartbeat = (id) => sql`update jobs set heartbeat_at = now() where id = ${id} and status = 'running'`.catch((error) => log("heartbeat:", error.message));

  // ---- starting a turn -------------------------------------------------------------------------

  /** Validates the request, loads the agent (404 / 409 paused), writes the user message, queues. */
  async function startTurn({ owner, request }) {
    const checked = validateTurnRequest(request);
    if (!checked.ok) throw new TurnError(400, checked.errors.join("; "));
    const body = checked.value;
    const agentId = body.agentId;
    if (!agentId) throw new TurnError(400, "agentId is required to start a turn.");
    const agent = await store.get(owner, "agents", agentId); // StoreError 404 when missing
    if (agent.data?.paused === true) throw new TurnError(409, "paused");
    if (!driverById(body.driver)) throw new TurnError(400, `Unknown driver: ${body.driver ?? "(none)"}.`);

    const id = randomBytes(JOB_ID_BYTES).toString("hex");
    const messageId = body.messageId ?? `${id}-user`;
    const replyId = body.replyId ?? `${id}-reply`;
    // The user message, unless the page already synced one with this id (409: fine).
    try {
      await store.create(owner, "messages", messageId, { id: messageId, role: "user", text: body.text, createdAt: Date.now(), attachments: [], status: "done", localStandIn: false, fresh: false, threadId: body.threadId }, { threadId: body.threadId });
    } catch (error) {
      if (!(error instanceof StoreError) || error.status !== 409) throw error;
    }
    const payload = { ...body, messageId, replyId };
    await sql`insert into jobs ${sql({ id, owner, agent_id: agentId, kind: "turn", status: "queued", root_job_id: id, payload: sql.json(payload), timeout_s: DEFAULT_TURN_TIMEOUT_S, singleton_key: agentId })}`;
    await events.append(id, "queued", { agentId, threadId: body.threadId });
    const queueJobId = await queue.enqueueTurn({ jobId: id, agentId, timeoutS: DEFAULT_TURN_TIMEOUT_S });
    await sql`update jobs set queue_job_id = ${queueJobId}, updated_at = now() where id = ${id}`;
    return { jobId: id, messageId, replyId };
  }

  // ---- the worker -------------------------------------------------------------------------------

  async function handle({ jobId }) {
    const job = await loadJob(jobId);
    if (!job || job.kind !== "turn") return;
    if (job.status !== "queued") return; // cancelled while waiting, or already handled
    const controller = new AbortController();
    const beat = setInterval(() => void heartbeat(jobId), heartbeatMs);
    running.set(jobId, { controller, heartbeat: beat });
    await setStatus(jobId, "running", { started: true });
    let outcome = { status: "failed", error: null };
    let result = null;
    try {
      result = await runTurn({
        job,
        deps: {
          store,
          memory,
          skills,
          teamDir,
          roots,
          secrets,
          driverById,
          policy,
          approvals,
          events,
          shell,
          agentTools,
          signal: controller.signal,
          onSession: (sessionId) => void sql`update jobs set session_id = ${sessionId} where id = ${jobId}`.catch(() => undefined),
          onError: (error) => log("event:", error.message),
        },
      });
      outcome = controller.signal.aborted ? { status: "cancelled" } : { status: "done" };
    } catch (error) {
      const aborted = controller.signal.aborted || error?.name === "AbortError";
      outcome = aborted ? { status: "cancelled" } : { status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearInterval(beat);
      running.delete(jobId);
    }
    // The engine may have been abandoned (crash simulation) while the turn ran: then this row is
    // the next engine's to finish, not ours, and pg-boss must not hear a completion either (a dead
    // process reports nothing), so the handler never settles.
    if (!started) return new Promise(() => undefined);
    const current = await loadJob(jobId);
    if (!current || current.status !== "running") return;
    const payload = job.payload ?? {};
    const replyBase = { store, owner: job.owner, threadId: payload.threadId, id: payload.replyId, agentId: job.agent_id };
    if (outcome.status === "done") {
      await writeReply({ ...replyBase, text: result?.reply ?? "", status: "done" });
      await setStatus(jobId, "done", { finished: true, exit_code: 0, ...(result?.sessionId ? { session_id: result.sessionId } : {}) });
      await events.append(jobId, "done", {});
    } else if (outcome.status === "cancelled") {
      await writeReply({ ...replyBase, text: result?.reply ?? "", status: "done" }).catch(() => undefined);
      await setStatus(jobId, "cancelled", { finished: true });
      await events.append(jobId, "done", { stopped: true });
    } else {
      const message = redact(String(outcome.error ?? "The agent stopped with an error."));
      await writeReply({ ...replyBase, text: message, status: "error" }).catch(() => undefined);
      await setStatus(jobId, "failed", { finished: true, error: message });
      await events.append(jobId, "error", { message });
    }
  }

  // ---- interrupt --------------------------------------------------------------------------------

  /** Stops a running turn in this process, or drops a queued one. Owner-scoped. */
  async function interrupt(owner, jobId) {
    const job = await getJob(owner, jobId);
    if (!job) return { ok: false, status: null };
    if (job.status === "running") {
      const live = running.get(jobId);
      if (live) {
        live.controller.abort();
        return { ok: true, status: "cancelling" };
      }
      // Running elsewhere (an orphan before reconcile): mark it so no retry happens.
      await queue.fail(job.queue_job_id, "interrupted by the owner").catch(() => false);
      await setStatus(jobId, "cancelled", { finished: true });
      await events.append(jobId, "done", { stopped: true });
      return { ok: true, status: "cancelled" };
    }
    if (job.status === "queued") {
      await queue.cancel(job.queue_job_id).catch(() => false);
      await setStatus(jobId, "cancelled", { finished: true });
      await events.append(jobId, "done", { stopped: true });
      return { ok: true, status: "cancelled" };
    }
    return { ok: false, status: job.status };
  }

  // ---- restart recovery -------------------------------------------------------------------------

  /**
   * Running turns nobody is heartbeating are orphans of a previous process. Each is retried once
   * ("interrupted, retrying", attempt + 1, resuming the driver session when known) or, on its
   * second orphaning, failed. `staleMs` 0 (the default at start-up) treats every running turn as
   * orphaned: one engine runs per database.
   */
  async function reconcile({ staleMs = 0 } = {}) {
    const cutoff = new Date(Date.now() - staleMs);
    const rows = await sql`select * from jobs where kind = 'turn' and status = 'running' and (heartbeat_at is null or heartbeat_at <= ${cutoff}) order by created_at`;
    const report = { retried: [], failed: [], requeued: [] };
    for (const row of rows) {
      const job = toJob(row);
      if (running.has(job.id)) continue;
      await queue.fail(job.queue_job_id, INTERRUPTED_MESSAGE).catch(() => false);
      if (job.attempt + 1 < MAX_ATTEMPTS) {
        await events.append(job.id, "interrupted", { message: INTERRUPTED_MESSAGE, attempt: job.attempt + 1, ...(job.session_id ? { resume: true } : {}) });
        const queueJobId = await queue.enqueueTurn({ jobId: job.id, agentId: job.agent_id, timeoutS: job.timeout_s });
        await setStatus(job.id, "queued", { attempt: job.attempt + 1, queue_job_id: queueJobId });
        report.retried.push(job.id);
      } else {
        const payload = job.payload ?? {};
        await writeReply({ store, owner: job.owner, threadId: payload.threadId, id: payload.replyId, agentId: job.agent_id, text: FAILED_TWICE_MESSAGE, status: "error" }).catch(() => undefined);
        await setStatus(job.id, "failed", { finished: true, error: FAILED_TWICE_MESSAGE });
        await events.append(job.id, "error", { message: FAILED_TWICE_MESSAGE });
        report.failed.push(job.id);
      }
    }
    // A `queued` row whose pg-boss job is no longer waiting (taken by a process that died before
    // it marked the row running, or expired) would never run and, if still `active`, would block
    // its agent's key. Settle the stale pg-boss job and send the turn again; it never ran, so the
    // attempt count stays.
    const queued = await sql`select * from jobs where kind = 'turn' and status = 'queued' order by created_at`;
    for (const row of queued) {
      const job = toJob(row);
      const state = job.queue_job_id ? await queue.state(job.queue_job_id).catch(() => null) : null;
      if (state === "created" || state === "retry") continue;
      if (state === "active") await queue.fail(job.queue_job_id, INTERRUPTED_MESSAGE).catch(() => false);
      const queueJobId = await queue.enqueueTurn({ jobId: job.id, agentId: job.agent_id, timeoutS: job.timeout_s });
      await sql`update jobs set queue_job_id = ${queueJobId}, updated_at = now() where id = ${job.id} and status = 'queued'`;
      report.requeued.push(job.id);
    }
    return report;
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  async function start({ pollingIntervalSeconds } = {}) {
    if (started) return;
    await queue.start();
    started = true;
    const expired = await approvals.expireStale();
    const recovered = await reconcile();
    if (expired || recovered.retried.length || recovered.failed.length || recovered.requeued.length) log(`start: ${expired} approvals expired, ${recovered.retried.length} turns retried, ${recovered.failed.length} failed, ${recovered.requeued.length} queued again`);
    await queue.work(handle, pollingIntervalSeconds ? { pollingIntervalSeconds } : {});
  }

  /**
   * What the database sees when this process goes away, crash or `docker compose restart`:
   * heartbeats stop, polling stops, no row is settled. Running turns stay `running` in `jobs` (and
   * `active` in pg-boss) for the next engine's reconcile(), which retries each one once. The
   * in-process waiters (a driver, an approval wait) are released, and handle() writes nothing
   * because `started` is already false.
   */
  async function abandon() {
    if (!started) return;
    started = false;
    for (const [id, live] of running) {
      clearInterval(live.heartbeat);
      running.delete(id);
      live.controller.abort();
    }
    await queue.abandon();
  }

  /** abandon(), then close pg-boss: the runner's shutdown path (SIGTERM). */
  async function stop() {
    await abandon();
    await dispose();
  }

  /** Closes pg-boss (after abandon(), or for an engine that never started). */
  async function dispose() {
    await queue.stop({ graceful: false }).catch(() => undefined);
  }

  return { startTurn, getJob, interrupt, reconcile, start, stop, abandon, dispose, events, approvals, queue, emitter, limits, running, redact };
}
