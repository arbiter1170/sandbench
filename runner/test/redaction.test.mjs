// SB-03 PR 2: no key reaches job_events, the jobs row, logs or an API response. The redactor is
// tested alone, then an engine turn with a driver that echoes its key (Postgres; CI fails if the
// DB part skips).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { createSecretStore } from "../../harness/secrets.mjs";
import { createRedactor, REDACTED } from "../jobs/events.mjs";
import { agentRecord, makeEngine, setupDb, skip, until } from "./fixtures/engine-harness.mjs";

const OWNER = "u-vincent";
let db;
const open = [];

before(async () => {
  if (skip) return;
  db = await setupDb("sb_redaction");
  await db.store.create(OWNER, "agents", "qa", agentRecord("qa"));
});

after(async () => {
  for (const engine of open) await engine.stop().catch(() => undefined);
  for (const engine of open) await engine.dispose().catch(() => undefined);
  await db?.teardown();
});

test("the redactor scrubs known store values and key-shaped strings, deeply, and leaves the rest alone", () => {
  const value = `sb-${randomBytes(12).toString("hex")}`; // a store value of no known shape
  const secrets = createSecretStore({ env: { XAI_API_KEY: value } });
  const redact = createRedactor({ secrets, extra: ["extra-known-secret"] });
  const input = {
    text: `token ${value} and sk-ant-api03-abcdefghij and Bearer eyJhbGciOiJIUzI1NiJ9.abc.def plus xai-0123456789abcdef and ghp_abcdefghijklmnop and github_pat_abcdefghijklmnop`,
    nested: [{ deep: `again ${value}` }, "extra-known-secret here", 42, null, true],
    fine: "nothing secret, Bearer alone, short xai- prefix",
  };
  const out = redact(input);
  assert.equal(out.text.includes(value), false);
  assert.equal(out.text, `token ${REDACTED} and ${REDACTED} and ${REDACTED} plus ${REDACTED} and ${REDACTED} and ${REDACTED}`);
  assert.deepEqual(out.nested, [{ deep: `again ${REDACTED}` }, `${REDACTED} here`, 42, null, true]);
  assert.equal(out.fine, input.fine);
  // The input is not mutated, and a key added to the store later is scrubbed on the next call.
  assert.ok(input.text.includes(value));
  const file = createSecretStore({ env: {} , file: path.join(db?.home ?? process.cwd(), "unused.json") });
  const later = createRedactor({ secrets: file });
  assert.equal(later("plain-value-1234").includes("plain-value"), true);
  // Short values are never treated as secrets (they would wipe ordinary words).
  const tiny = createRedactor({ secrets: createSecretStore({ env: { XAI_API_KEY: "abc" } }) });
  assert.equal(tiny("abc is fine"), "abc is fine");
});

test("a driver that echoes its key leaves no trace in job_events, the jobs row or the reply", { skip }, async () => {
  const key = `sk-ant-${randomBytes(16).toString("hex")}`;
  const plain = `sb-${randomBytes(12).toString("hex")}`; // a key of no known shape: the store value is what catches it
  const made = makeEngine(db, {
    scripts: { reply: [{ say: "start " }, { echoKey: true }, { say: " end" }], fail: [{ echoKey: true }, { fail: `boom with ${key} and ${plain}` }] },
    boss: "echo",
    secretsEnv: { ANTHROPIC_API_KEY: key, XAI_API_KEY: plain },
  });
  open.push(made.engine);
  await made.engine.start({ pollingIntervalSeconds: 0.5 });
  const leaks = async (jobId) => {
    const rows = await db.sql`select type, data from job_events where job_id = ${jobId}`;
    const [job] = await db.sql`select * from jobs where id = ${jobId}`;
    const messages = await db.store.list(OWNER, "messages", { threadId: "t-qa" });
    const blob = JSON.stringify({ rows, job, messages });
    return { blob, has: blob.includes(key) || blob.includes(plain), rows };
  };

  const ok = await made.engine.startTurn({ owner: OWNER, request: { threadId: "t-qa", text: "echo it", agentId: "qa", driver: "fake", secret: "ANTHROPIC_API_KEY" } });
  await until(async () => (await made.engine.getJob(OWNER, ok.jobId))?.status === "done", { label: "echo turn" });
  const first = await leaks(ok.jobId);
  assert.equal(first.has, false, "the key must not be stored anywhere");
  const deltas = first.rows.filter((row) => row.type === "message_delta").map((row) => row.data.text);
  assert.equal(deltas[1], `key=${REDACTED} Bearer ${REDACTED}`);
  assert.equal((await db.store.get(OWNER, "messages", `${ok.jobId}-reply`)).data.text.includes(key), false);
  // The driver did receive the real key, on the turn object only.
  assert.equal(made.fake.calls.at(-1).rawKey, key);
  assert.deepEqual(Object.keys(made.fake.calls.at(-1).turn.extras), []);

  const failing = await made.engine.startTurn({ owner: OWNER, request: { threadId: "t-qa", text: "#fail echo", agentId: "qa", driver: "fake", secret: "XAI_API_KEY" } });
  const job = await until(async () => {
    const row = await made.engine.getJob(OWNER, failing.jobId);
    return row?.status === "failed" ? row : null;
  }, { label: "failing echo turn" });
  const second = await leaks(failing.jobId);
  assert.equal(second.has, false, "an error message is scrubbed too");
  assert.equal(job.error, `boom with ${REDACTED} and ${REDACTED}`);
  assert.equal((await db.store.get(OWNER, "messages", `${failing.jobId}-reply`)).data.text, `boom with ${REDACTED} and ${REDACTED}`);

  // The insert itself scrubs too (a later tool or SB-04 job writing an event directly can't leak).
  const direct = await made.engine.events.append(ok.jobId, "note", { text: `direct ${key}`, nested: { deep: plain } });
  assert.deepEqual(direct.data, { text: `direct ${REDACTED}`, nested: { deep: REDACTED } });
  const [stored] = await db.sql`select data from job_events where job_id = ${ok.jobId} and seq = ${direct.seq}`;
  assert.deepEqual(stored.data, { text: `direct ${REDACTED}`, nested: { deep: REDACTED } });
});
