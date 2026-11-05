// Shared set-up for the SB-03 PR 2 Postgres tests: a schema of its own (so the files can run
// side by side and beside data.test.mjs, which wipes `public`), the migrations, a record store,
// a temp SANDBENCH_HOME and an engine wired to the fake driver.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSecretStore } from "../../../harness/secrets.mjs";
import { createSkills } from "../../agent/skills.mjs";
import { createMemory } from "../../agent/memory.mjs";
import { migrate } from "../../db/migrate.mjs";
import { createStore } from "../../db/store.mjs";
import { createEngine } from "../../worker/engine.mjs";
import { createFakeDriver } from "./fake-driver.mjs";

export const URL_ = process.env.TEST_DATABASE_URL || "";
export const skip = !URL_ ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(URL_) ? "TEST_DATABASE_URL must name a *_test database" : false;

export async function setupDb(schema) {
  const { default: postgres } = await import("postgres");
  const admin = postgres(URL_, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop schema if exists ${schema} cascade; create schema ${schema};`);
  // Also every pg-boss schema a killed earlier run may have left (an orphaned active job there
  // would block its agent's singleton key).
  const stale = await admin`select nspname from pg_namespace where nspname like ${`${schema}_boss%`}`;
  for (const row of stale) await admin.unsafe(`drop schema if exists ${row.nspname} cascade`);
  await admin.end({ timeout: 1 });
  // Every connection of this pool works in the test schema.
  const sql = postgres(URL_, { max: 6, onnotice: () => {}, connection: { search_path: schema } });
  await migrate(sql);
  const store = createStore(sql);
  const memory = createMemory(sql);
  const home = mkdtempSync(path.join(os.tmpdir(), `sb-${schema}-`));
  const teardown = async () => {
    const cleaner = postgres(URL_, { max: 1, onnotice: () => {} });
    const extra = await cleaner`select nspname from pg_namespace where nspname like ${`${schema}_boss%`}`.catch(() => []);
    for (const row of extra) await cleaner.unsafe(`drop schema if exists ${row.nspname} cascade`).catch(() => undefined);
    await cleaner.unsafe(`drop schema if exists ${schema} cascade`).catch(() => undefined);
    await cleaner.end({ timeout: 1 });
    await sql.end({ timeout: 1 });
    rmSync(home, { recursive: true, force: true });
  };
  return { sql, store, memory, home, teardown, bossSchema: `${schema}_boss` };
}

/**
 * An engine on the given db, with a fake driver (scripts) and quiet pg-boss. `boss` names the
 * pg-boss schema suffix: engines that should share one queue (a restart sequence) use the same
 * one; otherwise each test takes its own so engines never take each other's jobs.
 */
export function makeEngine(db, { scripts, boss = "", env = {}, secretsEnv = {}, agentTools = true, shell = null, policy, heartbeatMs = 200, approvalTimeoutMs } = {}) {
  const fake = createFakeDriver({ scripts });
  const secrets = createSecretStore({ file: path.join(db.home, "secrets.json"), env: secretsEnv });
  const engine = createEngine({
    sql: db.sql,
    connectionString: URL_,
    store: db.store,
    memory: db.memory,
    skills: createSkills({ dir: "" }),
    teamDir: "",
    home: db.home,
    secrets,
    env,
    driverById: fake.driverById,
    shell,
    agentTools,
    ...(policy ? { policy } : {}),
    bossSchema: `${db.bossSchema}${boss ? `_${boss}` : ""}`,
    bossOptions: { supervise: false },
    heartbeatMs,
    ...(approvalTimeoutMs ? { approvalTimeoutMs } : {}),
    log: () => undefined,
  });
  return { engine, fake, secrets };
}

/** Waits until `fn()` is truthy (polling), or fails after `ms`. */
export async function until(fn, { ms = 10_000, every = 50, label = "condition" } = {}) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

export const agentRecord = (id, extra = {}) => ({ id, name: id.toUpperCase(), role: "tester", title: "tester", instructions: `You are ${id}.`, slug: id, ...extra });
