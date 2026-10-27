// One-time import of the harness's file memory into Postgres (SB-08). Safe to run again.
//   DATABASE_URL=postgres://... node scripts/memory-import.mjs <bots-dir> [--owner <uid>]
// <bots-dir> holds one folder per bot id, as ~/.sandbench/bots does. Only bots that exist as
// agent records on the runner are imported. Without --owner, the one account that has agent
// records is used. Postgres publishes no port, so on the runner copy the folder in first:
//   docker compose cp ~/.sandbench/bots runner:/srv/sandbench/import-bots
//   docker compose exec runner node scripts/memory-import.mjs /srv/sandbench/import-bots
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMemory } from "../runner/agent/memory.mjs";
import { importMemoryFiles, readHarnessMemory } from "../runner/agent/memory-import.mjs";
import { migrate } from "../runner/db/migrate.mjs";
import { ID } from "../runner/db/store.mjs";

const args = process.argv.slice(2);
const ownerAt = args.indexOf("--owner");
let owner = ownerAt >= 0 ? args[ownerAt + 1] : undefined;
const dir = args.find((arg, index) => !arg.startsWith("--") && (ownerAt < 0 || index !== ownerAt + 1));
if (!dir || !process.env.DATABASE_URL || (ownerAt >= 0 && !owner)) {
  console.error("Usage: DATABASE_URL=... node scripts/memory-import.mjs <bots-dir> [--owner <uid>]");
  process.exit(2);
}

const require = createRequire(new URL("../runner/package.json", import.meta.url));
const { default: postgres } = await import(pathToFileURL(require.resolve("postgres")).href);
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await migrate(sql);
  if (!owner) {
    const owners = await sql`select distinct owner from agents where not deleted`;
    if (owners.length !== 1) throw new Error(`Found ${owners.length} accounts with agents; pass --owner <uid>.`);
    owner = owners[0].owner;
  }
  const known = new Set((await sql`select id from agents where owner = ${owner} and not deleted`).map((row) => row.id));
  const memory = createMemory(sql);
  for (const id of readdirSync(dir).sort()) {
    if (!ID.test(id)) continue;
    if (!known.has(id)) {
      console.log(`${id}: skipped (no agent record with this id)`);
      continue;
    }
    const result = await importMemoryFiles(memory, { owner, agentId: id, files: readHarnessMemory(path.join(dir, id)) });
    console.log(`${id}: ${result.imported} imported, ${result.skipped} already there`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
