// Server-side datastore (SB-02): one versioned row per entity, scoped to its owner.
//   create  -> version 1 (409 if the id already exists)
//   patch   -> shallow-merges fields into `data` only if the caller's version is current;
//              otherwise 409 with the current row, so the page reloads that row and retries
//   remove  -> tombstone (same version rule), so other devices see the delete
// Every write appends to `changes` in the same transaction and NOTIFYs listeners, which
// is what the /api/stream change feed sends to the other devices.

/** What each kind of record is called on the wire, and where it lives. */
export const KINDS = {
  agents: { table: "agents" },
  threads: { table: "threads" },
  messages: { table: "messages" },
  routines: { table: "routines" },
  tasks: { table: "workspace_items" },
  reminders: { table: "workspace_items" },
  events: { table: "workspace_items" },
  contacts: { table: "workspace_items" },
  logs: { table: "workspace_items" },
  computer: { table: "workspace_items" },
  settings: { table: "workspace_items" },
  studio: { table: "workspace_items" },
};

export const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_DATA = 512 * 1024;
const CHANNEL = "sandbench_changes";

export class StoreError extends Error {
  constructor(status, message, current) {
    super(message);
    this.status = status;
    this.current = current;
  }
}

function checkKind(kind) {
  const spec = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!spec) throw new StoreError(404, `Unknown record kind: ${kind}.`);
  return spec;
}

function checkId(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new StoreError(400, "Record ids use letters, digits, - and _ (up to 80).");
}

function checkData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new StoreError(400, "A record's data must be an object.");
  if (JSON.stringify(data).length > MAX_DATA) throw new StoreError(413, "That record is too large.");
}

/** Threads are stored without their messages; messages are rows of their own. */
function clean(kind, data) {
  if (kind !== "threads" || !("messages" in data)) return data;
  const { messages: _messages, ...rest } = data;
  return rest;
}

function toRecord(kind, row) {
  if (!row) return null;
  return {
    kind,
    id: row.id,
    version: row.version,
    updatedAt: new Date(row.updated_at).getTime(),
    deleted: row.deleted,
    ...(kind === "messages" ? { threadId: row.thread_id } : {}),
    data: row.data,
  };
}

/** `onLogged` is a test hook, awaited inside the write transaction after its change row. */
export function createStore(sql, { onLogged } = {}) {
  const listeners = new Set();
  let listening = null;

  // Columns that pick out one row of a kind; workspace_items also needs the kind.
  const where = (tx, kind, spec, owner, id) =>
    spec.table === "workspace_items" ? tx`owner = ${owner} and kind = ${kind} and id = ${id}` : tx`owner = ${owner} and id = ${id}`;

  async function current(tx, kind, owner, id) {
    const spec = checkKind(kind);
    const [row] = await tx`select * from ${tx(spec.table)} where ${where(tx, kind, spec, owner, id)}`;
    return toRecord(kind, row);
  }

  async function logChange(tx, owner, kind, id, version) {
    // `seq` is handed out at insert time, not at commit. Without this lock a write could
    // take seq N but commit after N+1, and a reader whose cursor had moved to N+1 would
    // never see it. Holding a per-owner lock from here until commit makes one owner's
    // changes commit in seq order. Each write touches one row, so this cannot deadlock.
    await tx`select pg_advisory_xact_lock(hashtextextended(${owner}, 0))`;
    const [change] = await tx`insert into changes (owner, kind, id, version) values (${owner}, ${kind}, ${id}, ${version}) returning seq`;
    await tx`select pg_notify(${CHANNEL}, ${owner})`;
    if (onLogged) await onLogged(tx);
    return Number(change.seq);
  }

  return {
    async list(owner, kind, { threadId, since = 0, limit = 1000, includeDeleted = false } = {}) {
      const spec = checkKind(kind);
      const cap = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
      const after = new Date(Number(since) || 0);
      const showDeleted = includeDeleted || Number(since) > 0;
      if (kind === "messages" && threadId) checkId(threadId);
      const rows = await sql`
        select * from ${sql(spec.table)}
        where owner = ${owner}
          ${spec.table === "workspace_items" ? sql`and kind = ${kind}` : sql``}
          ${kind === "messages" && threadId ? sql`and thread_id = ${threadId}` : sql``}
          ${showDeleted ? sql`` : sql`and not deleted`}
          and updated_at > ${after}
        order by ${kind === "messages" ? sql`created_at, id` : sql`updated_at, id`}
        limit ${cap + 1}`;
      return { items: rows.slice(0, cap).map((row) => toRecord(kind, row)), more: rows.length > cap };
    },

    async get(owner, kind, id) {
      checkId(id);
      const record = await current(sql, kind, owner, id);
      if (!record) throw new StoreError(404, "No such record.");
      return record;
    },

    async create(owner, kind, id, data, { threadId } = {}) {
      const spec = checkKind(kind);
      checkId(id);
      checkData(data);
      const body = clean(kind, data);
      return sql.begin(async (tx) => {
        let rows;
        if (kind === "messages") {
          const thread = threadId ?? data.threadId;
          checkId(thread);
          rows = await tx`
            insert into messages (owner, id, thread_id, created_at, data)
            values (${owner}, ${id}, ${thread}, ${Number(data.createdAt) || Date.now()}, ${tx.json(body)})
            on conflict do nothing returning *`;
        } else if (spec.table === "workspace_items") {
          rows = await tx`insert into workspace_items (owner, kind, id, data) values (${owner}, ${kind}, ${id}, ${tx.json(body)}) on conflict do nothing returning *`;
        } else {
          rows = await tx`insert into ${tx(spec.table)} (owner, id, data) values (${owner}, ${id}, ${tx.json(body)}) on conflict do nothing returning *`;
        }
        if (!rows.length) throw new StoreError(409, "A record with that id already exists.", await current(tx, kind, owner, id));
        const seq = await logChange(tx, owner, kind, id, rows[0].version);
        return { ...toRecord(kind, rows[0]), seq };
      });
    },

    async patch(owner, kind, id, version, data) {
      const spec = checkKind(kind);
      checkId(id);
      checkData(data);
      if (!Number.isInteger(version)) throw new StoreError(400, "Send the version you last read.");
      const body = clean(kind, data);
      return sql.begin(async (tx) => {
        const rows = await tx`
          update ${tx(spec.table)}
          set data = data || ${tx.json(body)}, version = version + 1, updated_at = now()
            ${kind === "messages" && body.createdAt ? tx`, created_at = ${Number(body.createdAt) || 0}` : tx``}
          where ${where(tx, kind, spec, owner, id)} and version = ${version} and not deleted
          returning *`;
        if (!rows.length) {
          const now = await current(tx, kind, owner, id);
          if (!now || now.deleted) throw new StoreError(404, "No such record.", now);
          throw new StoreError(409, "This record changed on another device. Reload it and try again.", now);
        }
        const seq = await logChange(tx, owner, kind, id, rows[0].version);
        return { ...toRecord(kind, rows[0]), seq };
      });
    },

    async remove(owner, kind, id, version) {
      const spec = checkKind(kind);
      checkId(id);
      if (!Number.isInteger(version)) throw new StoreError(400, "Send the version you last read.");
      return sql.begin(async (tx) => {
        const rows = await tx`
          update ${tx(spec.table)} set deleted = true, version = version + 1, updated_at = now()
          where ${where(tx, kind, spec, owner, id)} and version = ${version} and not deleted
          returning *`;
        if (!rows.length) {
          const now = await current(tx, kind, owner, id);
          if (!now || now.deleted) throw new StoreError(404, "No such record.", now);
          throw new StoreError(409, "This record changed on another device. Reload it and try again.", now);
        }
        const seq = await logChange(tx, owner, kind, id, rows[0].version);
        return { ...toRecord(kind, rows[0]), seq };
      });
    },

    /**
     * Changes after `since`, in commit order, each with the record as it is now (a later
     * version may already be there; the page keeps whichever version is higher).
     */
    async changesSince(owner, since = 0, limit = 500) {
      const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
      const changes = await sql`select seq, kind, id from changes where owner = ${owner} and seq > ${Number(since) || 0} order by seq limit ${cap}`;
      const out = [];
      for (const change of changes) {
        const record = await current(sql, change.kind, owner, change.id);
        if (record) out.push({ seq: Number(change.seq), ...record });
      }
      // The cursor follows the change rows themselves, so it always moves forward.
      return { changes: out, last: changes.length ? Number(changes[changes.length - 1].seq) : Number(since) || 0, more: changes.length === cap };
    },

    /** Call `fn(owner)` after any committed write; returns an unsubscribe function. */
    async subscribe(fn) {
      listeners.add(fn);
      // A failed LISTEN is not cached: the next subscriber tries again.
      listening ??= sql
        .listen(CHANNEL, (owner) => {
          for (const listener of listeners) listener(owner);
        })
        .catch((error) => {
          listening = null;
          throw error;
        });
      try {
        await listening;
      } catch (error) {
        listeners.delete(fn);
        throw error;
      }
      return () => listeners.delete(fn);
    },
  };
}
