// Exports agent memory (SB-08) to a folder, one memory.jsonl and profile.md per agent:
//   DATABASE_URL=postgres://... node scripts/memory-backup.mjs <out-dir> [--owner <uid>]
// Point <out-dir> at a checkout of the private team repo and commit it there. Nothing
// schedules this yet; the nightly run is SB-14.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMemory } from "../runner/agent/memory.mjs";

const args = process.argv.slice(2);
const ownerAt = args.indexOf("--owner");
const owner = ownerAt >= 0 ? args[ownerAt + 1] : undefined;
const out = args.find((arg, index) => !arg.startsWith("--") && (ownerAt < 0 || index !== ownerAt + 1));
if (!out || !process.env.DATABASE_URL || (ownerAt >= 0 && !owner)) {
  console.error("Usage: DATABASE_URL=... node scripts/memory-backup.mjs <out-dir> [--owner <uid>]");
  process.exit(2);
}

// `postgres` is a runner dependency (npm ci --prefix runner), not a root one.
const require = createRequire(new URL("../runner/package.json", import.meta.url));
const { default: postgres } = await import(pathToFileURL(require.resolve("postgres")).href);
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const written = await createMemory(sql).memoryExport(path.resolve(out), { owner });
  for (const entry of written) console.log(`${entry.agentId}: ${entry.items} item(s)`);
  console.log(`Backed up ${written.length} agent(s) to ${path.resolve(out)}`);
} finally {
  await sql.end({ timeout: 5 });
}
