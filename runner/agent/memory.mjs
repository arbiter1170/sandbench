// Agent memory (SB-08) in Postgres (002_memory.sql). Every query filters on the owner (the
// signed-in uid) and the agent (its record id): an agent never reads another agent's memory and
// an owner never sees another owner's.
//   profile  facts that go into every prompt
//   journal  dated notes, found by full-text search
// The memory_save / memory_search tools that call this come with SB-10.
import { ID, StoreError } from "../db/store.mjs";

export const MEMORY_KINDS = ["profile", "journal"];
export const MAX_TEXT = 8000;

function checkAgent(owner, agentId) {
  if (typeof owner !== "string" || !owner) throw new StoreError(401, "No owner.");
  if (typeof agentId !== "string" || !ID.test(agentId)) throw new StoreError(400, "Agent ids use letters, digits, - and _ (up to 80).");
}

function checkKind(kind, optional = false) {
  if (optional && kind === undefined) return;
  if (!MEMORY_KINDS.includes(kind)) throw new StoreError(400, "Memory kind is profile or journal.");
}

const clamp = (value, fallback, max) => Math.min(Math.max(Math.trunc(Number(value)) || fallback, 1), max);

const toItem = (row) => ({
  id: Number(row.id),
  agentId: row.agent_id,
  kind: row.kind,
  text: row.text,
  createdAt: new Date(row.created_at).getTime(),
  ...(row.rank !== undefined ? { rank: Number(row.rank) } : {}),
});

export function createMemory(sql) {
  /**
   * Saves one item. With `sourceHash` (imports), saving the same hash again does nothing and
   * returns { saved: false }.
   */
  async function save({ owner, agentId, kind, text, sourceHash = null, createdAt }) {
    checkAgent(owner, agentId);
    checkKind(kind);
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) throw new StoreError(400, "Memory text is empty.");
    if (body.length > MAX_TEXT) throw new StoreError(413, `Memory items are limited to ${MAX_TEXT} characters.`);
    const at = createdAt === undefined ? new Date() : new Date(createdAt);
    if (Number.isNaN(at.getTime())) throw new StoreError(400, "Bad createdAt.");
    const rows = await sql`
      insert into memory_items (owner, agent_id, kind, text, source_hash, created_at)
      values (${owner}, ${agentId}, ${kind}, ${body}, ${sourceHash}, ${at})
      on conflict (owner, agent_id, source_hash) do nothing
      returning id, agent_id, kind, text, created_at`;
    return rows.length ? { saved: true, item: toItem(rows[0]) } : { saved: false };
  }

  /** Full-text search (English stemming), best match first. limit 1-50. */
  async function search({ owner, agentId, query, kind, limit = 10 }) {
    checkAgent(owner, agentId);
    checkKind(kind, true);
    const q = typeof query === "string" ? query.trim().slice(0, 500) : "";
    if (!q) return [];
    const rows = await sql`
      select id, agent_id, kind, text, created_at, ts_rank(tsv, query) as rank
      from memory_items, websearch_to_tsquery('english', ${q}) as query
      where owner = ${owner} and agent_id = ${agentId} and tsv @@ query
        ${kind ? sql`and kind = ${kind}` : sql``}
      order by rank desc, created_at desc, id desc
      limit ${clamp(limit, 10, 50)}`;
    return rows.map(toItem);
  }

  /** Newest first. limit 1-500. */
  async function recent({ owner, agentId, kind, limit = 20 }) {
    checkAgent(owner, agentId);
    checkKind(kind, true);
    const rows = await sql`
      select id, agent_id, kind, text, created_at from memory_items
      where owner = ${owner} and agent_id = ${agentId} ${kind ? sql`and kind = ${kind}` : sql``}
      order by created_at desc, id desc
      limit ${clamp(limit, 20, 500)}`;
    return rows.map(toItem);
  }

  /** Every profile item, oldest first (the order they were learned), for the prompt. */
  async function profile({ owner, agentId }) {
    checkAgent(owner, agentId);
    const rows = await sql`
      select id, agent_id, kind, text, created_at from memory_items
      where owner = ${owner} and agent_id = ${agentId} and kind = 'profile'
      order by created_at, id
      limit 500`;
    return rows.map(toItem);
  }

  return { save, search, recent, profile };
}
