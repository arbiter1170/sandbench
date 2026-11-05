// Memory backup (SB-08): writes <dir>/<agent_id>/profile.md and journal.md for one owner.
// Commit the folder in the private team repo. Not scheduled; the nightly run is SB-14.
// Postgres publishes no port, so it runs inside the runner:
//   docker compose -f deploy/compose.yml exec runner \
//     node runner/agent/memory-backup.mjs --out /srv/sandbench/backup [--owner <uid>]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ID } from "../db/store.mjs";

const day = (value) => new Date(value).toISOString().slice(0, 10);
const bullet = (text) => `- ${text.replace(/\n/g, "\n  ")}`;

/** Returns [{ agentId, profile, journal }] counts for what was written. */
export async function exportMemory({ sql, owner, dir }) {
  if (typeof owner !== "string" || !owner) throw new Error("exportMemory needs an owner.");
  const rows = await sql`
    select agent_id, kind, text, created_at from memory_items
    where owner = ${owner}
    order by agent_id, created_at, id`;
  const agents = new Map();
  for (const row of rows) {
    // Agent ids follow the record id rules, so they are safe folder names; skip anything else.
    if (!ID.test(row.agent_id)) continue;
    if (!agents.has(row.agent_id)) agents.set(row.agent_id, { profile: [], journal: [] });
    agents.get(row.agent_id)[row.kind].push(row);
  }
  const written = [];
  for (const [agentId, items] of agents) {
    const folder = path.join(dir, agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "profile.md"), `# ${agentId}: profile memory\n\n${items.profile.map((row) => bullet(row.text)).join("\n")}\n`, "utf8");
    writeFileSync(path.join(folder, "journal.md"), `# ${agentId}: journal\n\n${items.journal.map((row) => bullet(`${day(row.created_at)}: ${row.text}`)).join("\n")}\n`, "utf8");
    written.push({ agentId, profile: items.profile.length, journal: items.journal.length });
  }
  return written;
}

// CLI: DATABASE_URL=... node runner/agent/memory-backup.mjs --out <dir> [--owner <uid>]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag) => {
    const at = process.argv.indexOf(flag);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  const out = arg("--out");
  if (!out || !process.env.DATABASE_URL) {
    console.error("Usage: DATABASE_URL=... node runner/agent/memory-backup.mjs --out <dir> [--owner <uid>]");
    process.exit(2);
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    let owner = arg("--owner");
    if (!owner) {
      const owners = await sql`select distinct owner from memory_items`;
      if (owners.length !== 1) throw new Error(`Found ${owners.length} accounts with memory; pass --owner <uid>.`);
      owner = owners[0].owner;
    }
    for (const entry of await exportMemory({ sql, owner, dir: path.resolve(out) })) {
      console.log(`${entry.agentId}: ${entry.profile} profile, ${entry.journal} journal`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
