// Approval cards as rows (SB-03 PR 2). A permission request from a driver becomes an `approvals`
// row (003_jobs.sql, contract in runner/contracts/approval.mjs) and the turn waits on the row, not
// on an in-memory promise, so a runner restart keeps the card: it is still pending afterwards, or
// expired once the 30-minute timeout (the same one harness/turns.mjs has) has passed.
//
// Until SB-06 wires the red gate, the owner decides every card from the page. A row whose
// required_approver is "vincent" is still only decidable by the signed-in owner (Sandbench has one
// human user); SB-06 adds the decision id and the account check.
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

export const APPROVAL_TIMEOUT_MS = 30 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DEFAULT_POLL_MS = 1000;

const toRow = (row) =>
  row
    ? {
        id: row.id,
        owner: row.owner,
        job_id: row.job_id,
        agent_id: row.agent_id,
        class: row.class,
        required_approver: row.required_approver,
        status: row.status,
        decision_id: row.decision_id,
        request: row.request,
        decided_by: row.decided_by,
        created_at: new Date(row.created_at).toISOString(),
        decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      }
    : null;

export function createApprovals({ sql, emitter = new EventEmitter(), timeoutMs = APPROVAL_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  async function create({ owner, jobId, agentId, klass, requiredApprover, request }) {
    const id = randomBytes(8).toString("hex");
    const approver = klass === "red" ? "vincent" : requiredApprover ?? "owner";
    const [row] = await sql`
      insert into approvals (id, owner, job_id, agent_id, class, required_approver, request)
      values (${id}, ${owner}, ${jobId}, ${agentId}, ${klass}, ${approver}, ${sql.json(request ?? {})})
      returning *`;
    return toRow(row);
  }

  async function get(owner, id) {
    if (!ID.test(String(id))) return null;
    const [row] = await sql`select * from approvals where owner = ${owner} and id = ${id}`;
    return toRow(row);
  }

  async function list(owner, { status = "pending", limit = 200 } = {}) {
    const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const rows = await sql`select * from approvals where owner = ${owner} ${status ? sql`and status = ${status}` : sql``} order by created_at desc limit ${cap}`;
    return rows.map(toRow);
  }

  /** Pending cards older than the timeout become expired. Returns how many. Safe to call any time. */
  async function expireStale(now = Date.now()) {
    const cutoff = new Date(now - timeoutMs);
    const rows = await sql`update approvals set status = 'expired', decided_at = now() where status = 'pending' and created_at < ${cutoff} returning id, job_id, owner`;
    for (const row of rows) emitter.emit("approval", { id: row.id, jobId: row.job_id, status: "expired" });
    return rows.length;
  }

  /**
   * The owner's decision. Only a pending card changes; a second click, or a click from another
   * account, changes nothing. Returns { ok, status } where ok is false when nothing changed.
   */
  async function decide({ owner, id, allow, decidedBy }) {
    if (!ID.test(String(id))) return { ok: false, status: null };
    const status = allow === true ? "approved" : "denied";
    const [row] = await sql`
      update approvals set status = ${status}, decided_by = ${decidedBy ?? owner}, decided_at = now()
      where owner = ${owner} and id = ${id} and status = 'pending'
      returning id, job_id, status`;
    if (!row) {
      const current = await get(owner, id);
      return { ok: false, status: current?.status ?? null };
    }
    emitter.emit("approval", { id: row.id, jobId: row.job_id, status: row.status });
    return { ok: true, status: row.status };
  }

  /**
   * Resolves with the card's final status: "approved", "denied" or "expired". A decision made in
   * this process arrives through the emitter; one made elsewhere (another runner process, a
   * restart) is picked up by polling the row. `signal` (the turn's abort) resolves "denied".
   */
  function wait(id, { signal } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timer);
        emitter.off("approval", onApproval);
        signal?.removeEventListener("abort", onAbort);
        resolve(status);
      };
      const onApproval = (event) => {
        if (event.id === id) finish(event.status);
      };
      const onAbort = () => finish("denied");
      const check = async () => {
        try {
          const [row] = await sql`select status from approvals where id = ${id}`;
          if (!row) return finish("expired");
          if (row.status !== "pending") return finish(row.status);
        } catch {
          // The next poll tries again.
        }
      };
      const poll = setInterval(check, pollMs);
      const timer = setTimeout(async () => {
        try {
          await sql`update approvals set status = 'expired', decided_at = now() where id = ${id} and status = 'pending'`;
        } catch {
          // Expiry is also applied by expireStale on the next start.
        }
        finish("expired");
      }, timeoutMs);
      emitter.on("approval", onApproval);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      void check();
    });
  }

  return { create, get, list, decide, expireStale, wait, emitter };
}
