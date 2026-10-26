// Applies runner/db/migrations/*.sql in name order, once each, under an advisory lock
// so two runner processes starting together cannot both migrate.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK = 727401; // any constant; shared by every runner process

export async function migrate(sql, { dir = DIR } = {}) {
  const files = readdirSync(dir).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const applied = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK})`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migrations`).map((row) => row.name));
    for (const name of files) {
      if (done.has(name)) continue;
      await tx.unsafe(readFileSync(path.join(dir, name), "utf8"));
      await tx`insert into schema_migrations (name) values (${name})`;
      applied.push(name);
    }
  });
  return applied;
}
