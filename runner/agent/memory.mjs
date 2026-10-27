// Agent memory (SB-08) in Postgres: memory_items (002_memory.sql). Every call names its owner
// (the signed-in uid) and agent (the agent's record id), like the record store.
//   profile  facts added to every prompt
//   journal  dated notes, found by full-text search
// The memory_save / memory_search tools that call this come with SB-10.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ID, StoreError } from "../db/store.mjs";

export const MEMORY_KINDS = ["profile", "journal"];
export const MAX_TEXT = 16 * 1024;
// Folder names in a backup; anything else is left out rather than written to an odd path.
const SAFE_NAME = /^[A-Za-z0-9_-]{1,128}$/;

function checkAgent(owner, agentId) {
  if (typeof owner !== "string" || !owner) throw new StoreError(401, "No owner.");
  if (typeof agentId !== "string" || !ID.test(agentId)) throw new StoreError(400, "Agent ids use letters, digits, - and _ (up to 80).");
}

function checkKind(kind) {
  if (!MEMORY_KINDS.includes(kind)) throw new StoreError(400, "Memory kind is profile or journal.");
}

const toItem = (row) => ({
  id: Number(row.id),
  agentId: row.agent_id,
  kind: row.kind,
  text: row.text,
  createdAt: new Date(row.created_at).getTime(),
  ...(row.rank !== undefined ? { rank: Number(row.rank) } : {}),
});

export function createMemory(sql) {
  /** Saves one item. With `source`, saving the same source again is a no-op ({ saved: false }). */
  async function memorySave({ owner, agentId, kind, text, source = null, createdAt }) {
    checkAgent(owner, agentId);
    checkKind(kind);
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) throw new StoreError(400, "Memory text is empty.");
    if (body.length > MAX_TEXT) throw new StoreError(413, `Memory items are limited to ${MAX_TEXT} characters.`);
    const at = createdAt ? new Date(createdAt) : new Date();
    if (Number.isNaN(at.getTime())) throw new StoreError(400, "Bad createdAt.");
    const rows = await sql`
      insert into memory_items (owner, agent_id, kind, text, source, created_at)
      values (${owner}, ${agentId}, ${kind}, ${body}, ${source}, ${at})
      on conflict (owner, agent_id, source) where source is not null do nothing
      returning id, agent_id, kind, text, created_at`;
    return rows.length ? { saved: true, item: toItem(rows[0]) } : { saved: false };
  }

  /** Full-text search over one agent's memory, best match first. */
  async function memorySearch({ owner, agentId, query, kind, limit = 10 }) {
    checkAgent(owner, agentId);
    if (kind !== undefined) checkKind(kind);
    const q = typeof query === "string" ? query.trim().slice(0, 500) : "";
    if (!q) return [];
    const cap = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const rows = await sql`
      select id, agent_id, kind, text, created_at, ts_rank(tsv, query) as rank
      from memory_items, websearch_to_tsquery('english', ${q}) as query
      where owner = ${owner} and agent_id = ${agentId} and tsv @@ query
        ${kind ? sql`and kind = ${kind}` : sql``}
      order by rank desc, created_at desc
      limit ${cap}`;
    return rows.map(toItem);
  }

  /** Newest first. */
  async function memoryList({ owner, agentId, kind, limit = 50 }) {
    checkAgent(owner, agentId);
    if (kind !== undefined) checkKind(kind);
    const cap = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const rows = await sql`
      select id, agent_id, kind, text, created_at from memory_items
      where owner = ${owner} and agent_id = ${agentId} ${kind ? sql`and kind = ${kind}` : sql``}
      order by created_at desc, id desc
      limit ${cap}`;
    return rows.map(toItem);
  }

  /**
   * Writes every item to `dir/<owner>/<agent>/memory.jsonl` (oldest first) plus a readable
   * profile.md. Scheduling it nightly is SB-14.
   */
  async function memoryExport(dir, { owner } = {}) {
    const rows = await sql`
      select id, owner, agent_id, kind, text, source, created_at from memory_items
      ${owner ? sql`where owner = ${owner}` : sql``}
      order by owner, agent_id, id`;
    const groups = new Map();
    for (const row of rows) {
      if (!SAFE_NAME.test(row.owner) || !SAFE_NAME.test(row.agent_id)) continue;
      const key = `${row.owner}/${row.agent_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const written = [];
    for (const [key, items] of groups) {
      const folder = path.join(dir, ...key.split("/"));
      mkdirSync(folder, { recursive: true });
      const lines = items.map((row) => JSON.stringify({ id: Number(row.id), kind: row.kind, text: row.text, source: row.source, createdAt: new Date(row.created_at).toISOString() }));
      writeFileSync(path.join(folder, "memory.jsonl"), `${lines.join("\n")}\n`, "utf8");
      const profile = items.filter((row) => row.kind === "profile").map((row) => `- ${row.text.replace(/\n/g, "\n  ")}`);
      writeFileSync(path.join(folder, "profile.md"), `# Profile memory\n\n${profile.join("\n")}\n`, "utf8");
      written.push({ owner: items[0].owner, agentId: items[0].agent_id, items: items.length });
    }
    return written;
  }

  return { memorySave, memorySearch, memoryList, memoryExport };
}
