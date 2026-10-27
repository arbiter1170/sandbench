// One-time import of the harness's file memory into memory_items (SB-08). The harness route
// (harness/server.mjs /bots/:id/memory) is untouched; its files are now only a source for this.
//   <dir>/MEMORY.md and <dir>/memory/*.md   -> profile, one item per paragraph
//   <dir>/memory/log/YYYY-MM-DD.md          -> journal, in file-name order, dated that day
// Every item carries source_hash = sha256("<file name>\n<paragraph>"), so a second run inserts
// nothing and an edited file adds only its new paragraphs. Bare headings are skipped.
//
// Postgres publishes no port, so run it inside the runner, one bot folder at a time:
//   docker compose -f deploy/compose.yml cp ~/.sandbench/bots/<id> runner:/srv/sandbench/import/<id>
//   docker compose -f deploy/compose.yml exec runner \
//     node runner/agent/memory-import.mjs --dir /srv/sandbench/import/<id> --agent <id> [--owner <uid>]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_TEXT } from "./memory.mjs";

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function mdFiles(folder, pattern) {
  try {
    return readdirSync(folder).filter((name) => pattern.test(name)).sort();
  } catch {
    return [];
  }
}

// One item per non-empty paragraph; a paragraph longer than MAX_TEXT is split.
function paragraphs(text) {
  const out = [];
  for (const paragraph of text.split(/\r?\n\s*\r?\n/)) {
    let part = paragraph.trim();
    if (!part || /^#{1,6}\s[^\n]*$/.test(part)) continue;
    while (part.length > MAX_TEXT) {
      out.push(part.slice(0, MAX_TEXT));
      part = part.slice(MAX_TEXT);
    }
    out.push(part);
  }
  return out;
}

/** The files to import from one bot's folder, in the order they are saved. */
export function harnessMemoryFiles(dir) {
  const files = [];
  const add = (rel, kind, createdAt) => {
    const text = readText(path.join(dir, ...rel.split("/")));
    if (text !== null) files.push({ rel, kind, createdAt, text });
  };
  add("MEMORY.md", "profile");
  for (const name of mdFiles(path.join(dir, "memory"), /^[a-zA-Z0-9][\w.-]{0,60}\.md$/)) add(`memory/${name}`, "profile");
  for (const name of mdFiles(path.join(dir, "memory", "log"), /^\d{4}-\d{2}-\d{2}\.md$/)) add(`memory/log/${name}`, "journal", `${name.slice(0, 10)}T12:00:00Z`);
  return files;
}

export async function importFileMemory({ dir, owner, agentId, memory }) {
  let inserted = 0;
  let skipped = 0;
  for (const file of harnessMemoryFiles(dir)) {
    for (const text of paragraphs(file.text)) {
      const sourceHash = createHash("sha256").update(`${file.rel}\n${text}`).digest("hex");
      const result = await memory.save({ owner, agentId, kind: file.kind, text, sourceHash, ...(file.createdAt ? { createdAt: file.createdAt } : {}) });
      if (result.saved) inserted++;
      else skipped++;
    }
  }
  return { inserted, skipped };
}

// CLI: DATABASE_URL=... node runner/agent/memory-import.mjs --dir <bot folder> --agent <id> [--owner <uid>]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag) => {
    const at = process.argv.indexOf(flag);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  const dir = arg("--dir");
  const agentId = arg("--agent");
  if (!dir || !agentId || !process.env.DATABASE_URL) {
    console.error("Usage: DATABASE_URL=... node runner/agent/memory-import.mjs --dir <bot folder> --agent <id> [--owner <uid>]");
    process.exit(2);
  }
  const { default: postgres } = await import("postgres");
  const { migrate } = await import("../db/migrate.mjs");
  const { createMemory } = await import("./memory.mjs");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(sql);
    let owner = arg("--owner");
    if (!owner) {
      // The one account that has this agent; refuse to guess between several.
      const owners = await sql`select distinct owner from agents where id = ${agentId} and not deleted`;
      if (owners.length !== 1) throw new Error(`Found ${owners.length} accounts with agent ${agentId}; pass --owner <uid>.`);
      owner = owners[0].owner;
    }
    const result = await importFileMemory({ dir, owner, agentId, memory: createMemory(sql) });
    console.log(`${agentId}: ${result.inserted} inserted, ${result.skipped} already there`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
