// SB-03 PR 1: 003_jobs.sql against a real Postgres. Needs TEST_DATABASE_URL naming a *_test
// database (CI fails if this skips). Works in its own schemas, so it can run beside the other DB
// tests.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const URL_ = process.env.TEST_DATABASE_URL || "";
const skip = !URL_ ? "TEST_DATABASE_URL not set" : !/_test(\?|$)/.test(URL_) ? "TEST_DATABASE_URL must name a *_test database" : false;
const FRESH = "sb_jobs_fresh";
const UPGRADE = "sb_jobs_upgrade";
const MIGRATIONS = fileURLToPath(new URL("../db/migrations/", import.meta.url));

let migrate;
let sql;
let tmp;

// One connection for everything, switching schemas with search_path.
const useSchema = (schema) => sql.unsafe(`set search_path to ${schema}`);

before(async () => {
  if (skip) return;
  const { default: postgres } = await import("postgres");
  ({ migrate } = await import("../db/migrate.mjs"));
  sql = postgres(URL_, { max: 1, onnotice: () => {} });
  for (const schema of [FRESH, UPGRADE]) await sql.unsafe(`drop schema if exists ${schema} cascade; create schema ${schema};`);
  await useSchema(FRESH);
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-migrations-"));
});

after(async () => {
  if (sql) {
    for (const schema of [FRESH, UPGRADE]) await sql.unsafe(`drop schema if exists ${schema} cascade`);
    await sql.end({ timeout: 1 });
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("an empty database gets 001-003, and a second run is a no-op", { skip }, async () => {
  assert.deepEqual(await migrate(sql), ["001_init.sql", "002_memory.sql", "003_jobs.sql"]);
  assert.deepEqual(await migrate(sql), []);
});

test("a database already at 002 gets only 003", { skip }, async () => {
  await useSchema(UPGRADE);
  try {
    for (const name of ["001_init.sql", "002_memory.sql"]) copyFileSync(path.join(MIGRATIONS, name), path.join(tmp, name));
    assert.deepEqual(await migrate(sql, { dir: tmp }), ["001_init.sql", "002_memory.sql"]);
    assert.deepEqual(await migrate(sql), ["003_jobs.sql"]);
    assert.deepEqual(await migrate(sql), []);
  } finally {
    await useSchema(FRESH);
  }
});

const job = (id, owner = "u-a", extra = {}) => ({ id, owner, agent_id: "qa", kind: "turn", status: "queued", root_job_id: id, payload: sql.json({ threadId: "t1" }), timeout_s: 3600, ...extra });
const insertJob = (row) => sql`insert into jobs ${sql(row)}`;

test("jobs, events and approvals take valid rows", { skip }, async () => {
  await insertJob(job("j1"));
  await insertJob(job("j1-child", "u-a", { kind: "exec", parent_job_id: "j1", root_job_id: "j1", pid: 4242, pgid: 4242, resumable: true }));
  await sql`insert into job_events ${sql([{ job_id: "j1", seq: 1, type: "turn_start", data: sql.json({}) }, { job_id: "j1", seq: 2, type: "message_delta", data: sql.json({ text: "hi" }) }])}`;
  await sql`insert into approvals ${sql({ id: "a1", owner: "u-a", job_id: "j1", agent_id: "qa", class: "red", required_approver: "vincent", request: sql.json({ tool: "exec", command: "git push" }) })}`;
  const [row] = await sql`select status, attempt, resumable, timeout_s, created_at, updated_at from jobs where id = 'j1'`;
  assert.deepEqual({ status: row.status, attempt: row.attempt, resumable: row.resumable, timeout_s: row.timeout_s }, { status: "queued", attempt: 0, resumable: false, timeout_s: 3600 });
  assert.ok(row.created_at instanceof Date && row.updated_at instanceof Date);
  const [approval] = await sql`select status from approvals where id = 'a1'`;
  assert.equal(approval.status, "pending");
});

test("bad kind, status, timeout and approval values are refused by the table checks", { skip }, async () => {
  await assert.rejects(insertJob(job("bad-kind", "u-a", { kind: "deploy" })), /check/);
  await assert.rejects(insertJob(job("bad-status", "u-a", { status: "paused" })), /check/);
  await assert.rejects(insertJob(job("bad-timeout", "u-a", { timeout_s: 0 })), /check/);
  await assert.rejects(sql`insert into job_events ${sql({ job_id: "j1", seq: 0, type: "x", data: sql.json({}) })}`, /check/);
  await assert.rejects(sql`insert into job_events ${sql({ job_id: "j1", seq: 1, type: "dup", data: sql.json({}) })}`, /duplicate|unique/);
  await assert.rejects(sql`insert into job_events ${sql({ job_id: "nope", seq: 1, type: "x", data: sql.json({}) })}`, /foreign key/);
  await assert.rejects(sql`insert into approvals ${sql({ id: "a-bad", owner: "u-a", job_id: "j1", agent_id: "qa", class: "orange", required_approver: "owner", request: sql.json({}) })}`, /check/);
  // A red item is Vincent's to decide, enforced by the table too.
  await assert.rejects(sql`insert into approvals ${sql({ id: "a-red", owner: "u-a", job_id: "j1", agent_id: "qa", class: "red", required_approver: "owner", request: sql.json({}) })}`, /check/);
});

test("deleting a job removes its events and approvals; a child keeps living without its parent link", { skip }, async () => {
  await insertJob(job("j2"));
  await sql`insert into job_events ${sql({ job_id: "j2", seq: 1, type: "turn_start", data: sql.json({}) })}`;
  await sql`insert into approvals ${sql({ id: "a2", owner: "u-a", job_id: "j2", agent_id: "qa", class: "yellow", required_approver: "owner", request: sql.json({}) })}`;
  await sql`delete from jobs where id = 'j2'`;
  assert.equal((await sql`select count(*)::int as n from job_events where job_id = 'j2'`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from approvals where job_id = 'j2'`)[0].n, 0);
  await sql`delete from jobs where id = 'j1'`;
  const [child] = await sql`select parent_job_id from jobs where id = 'j1-child'`;
  assert.equal(child.parent_job_id, null);
});

test("two owners' rows are separable by owner", { skip }, async () => {
  await insertJob(job("jb1", "u-b"));
  await insertJob(job("jb2", "u-b", { status: "running" }));
  assert.deepEqual((await sql`select id from jobs where owner = 'u-b' order by id`).map((row) => row.id), ["jb1", "jb2"]);
  assert.deepEqual((await sql`select id from jobs where owner = 'u-a' order by id`).map((row) => row.id), ["j1-child"]);
  assert.deepEqual((await sql`select id from jobs where owner = 'u-b' and status = 'running'`).map((row) => row.id), ["jb2"]);
});
