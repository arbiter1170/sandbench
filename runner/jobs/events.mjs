// Job events (SB-03 PR 2): one `job_events` row per driver event, `seq` counting up per job, and
// the redaction every row and error message goes through first. A secret can reach an event in
// two ways: a driver echoes the key it was given, or a tool prints one. Both are scrubbed before
// the insert, so no key is ever stored or streamed.
import { EventEmitter } from "node:events";

export const REDACTED = "[redacted]";
const MIN_SECRET_LENGTH = 6;

// Shapes of keys this runner may hold, matched even when the store doesn't know the value.
export const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bxai-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
];

/**
 * Builds `redact(value)`: deep-copies `value` with every known secret value and every
 * secret-shaped string replaced. `secrets` is the secret store (harness/secrets.mjs); its
 * values are read on every call, so a key added later is scrubbed too.
 */
export function createRedactor({ secrets = null, extra = [] } = {}) {
  function values() {
    const out = new Set(extra.filter((item) => typeof item === "string" && item.length >= MIN_SECRET_LENGTH));
    if (secrets) {
      for (const { name } of secrets.list()) {
        const value = secrets.get(name);
        if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) out.add(value);
      }
    }
    return out;
  }

  function scrub(text, known) {
    let out = text;
    for (const value of known) out = out.split(value).join(REDACTED);
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
    return out;
  }

  function walk(value, known) {
    if (typeof value === "string") return scrub(value, known);
    if (Array.isArray(value)) return value.map((item) => walk(item, known));
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = walk(item, known);
      return out;
    }
    return value;
  }

  return (value) => walk(value, values());
}

const TYPE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_DATA = 256 * 1024;

/**
 * `append(jobId, type, data)` writes one redacted row and emits it on `emitter` ("event") so the
 * SSE route can forward it live. `list(jobId, after)` is the catch-up read.
 */
export function createJobEvents({ sql, redact = (value) => value, emitter = new EventEmitter() }) {
  // Inserts for one job run one after the other, so `seq` never collides and events keep the
  // order the driver emitted them in, even when a caller doesn't await each append.
  const chains = new Map();

  async function insert(jobId, type, data) {
    const clean = redact(data ?? {});
    const json = JSON.stringify(clean);
    const body = json.length > MAX_DATA ? { truncated: true, type } : clean;
    const [row] = await sql`
      insert into job_events (job_id, seq, type, data)
      values (${jobId}, (select coalesce(max(seq), 0) + 1 from job_events where job_id = ${jobId}), ${type}, ${sql.json(body)})
      returning seq, at`;
    const event = { jobId, seq: Number(row.seq), type, data: body, at: new Date(row.at).getTime() };
    emitter.emit("event", event);
    return event;
  }

  function append(jobId, type, data = {}) {
    if (!TYPE.test(type)) return Promise.reject(new Error(`Bad event type: ${type}`));
    const previous = chains.get(jobId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => insert(jobId, type, data));
    chains.set(jobId, run);
    run.finally(() => {
      if (chains.get(jobId) === run) chains.delete(jobId);
    }).catch(() => undefined);
    return run;
  }

  async function list(jobId, after = 0, limit = 1000) {
    const cap = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    const rows = await sql`select seq, type, data, at from job_events where job_id = ${jobId} and seq > ${Number(after) || 0} order by seq limit ${cap}`;
    return rows.map((row) => ({ jobId, seq: Number(row.seq), type: row.type, data: row.data, at: new Date(row.at).getTime() }));
  }

  return { append, list, emitter, redact };
}
