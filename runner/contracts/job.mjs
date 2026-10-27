// Job record and job event (SB-03, stored in 003_jobs.sql). SB-04 adds detached exec jobs and
// SB-12 build jobs on the same record, so later items never need to alter `jobs`.
import { validateShape } from "./shape.mjs";

export const JOB_KINDS = ["turn", "exec", "build"];
export const JOB_STATUS = ["queued", "running", "done", "failed", "cancelled", "interrupted"];
const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * @typedef {object} JobRecord
 * @property {string} id
 * @property {string} owner           signed-in uid
 * @property {string} agent_id        the agent's record id
 * @property {"turn"|"exec"|"build"} kind
 * @property {"queued"|"running"|"done"|"failed"|"cancelled"|"interrupted"} status
 * @property {string|null} parent_job_id
 * @property {string|null} root_job_id   Stop all cancels everything under one root
 * @property {object} payload
 * @property {number|null} pid
 * @property {number|null} pgid          process group, for detached jobs (SB-04)
 * @property {number} timeout_s
 * @property {string|null} heartbeat_at
 * @property {number|null} exit_code
 * @property {string|null} error
 * @property {boolean} resumable
 * @property {string} created_at
 * @property {string|null} started_at
 * @property {string|null} finished_at
 */
export const JOB_FIELDS = {
  id: { type: "string", required: true, pattern: ID },
  owner: { type: "string", required: true, maxLength: 128 },
  agent_id: { type: "string", required: true, pattern: ID },
  kind: { type: "string", required: true, enum: JOB_KINDS },
  status: { type: "string", required: true, enum: JOB_STATUS },
  parent_job_id: { type: "string", nullable: true, pattern: ID },
  root_job_id: { type: "string", nullable: true, pattern: ID },
  payload: { type: "object", required: true },
  pid: { type: "integer", nullable: true, min: 1 },
  pgid: { type: "integer", nullable: true, min: 1 },
  timeout_s: { type: "integer", required: true, min: 1, max: 12 * 60 * 60 },
  heartbeat_at: { type: "timestamp", nullable: true },
  exit_code: { type: "integer", nullable: true },
  error: { type: "string", nullable: true, maxLength: 8000 },
  resumable: { type: "boolean", required: true },
  created_at: { type: "timestamp", required: true },
  started_at: { type: "timestamp", nullable: true },
  finished_at: { type: "timestamp", nullable: true },
};

/** @typedef {{ job_id: string, seq: number, type: string, data: object, at: string }} JobEvent */
export const JOB_EVENT_FIELDS = {
  job_id: { type: "string", required: true, pattern: ID },
  seq: { type: "integer", required: true, min: 1 },
  type: { type: "string", required: true, pattern: /^[a-z][a-z0-9_]{0,39}$/ },
  data: { type: "object", required: true },
  at: { type: "timestamp", required: true },
};

export const validateJob = (value) => validateShape(JOB_FIELDS, value, "job");
export const validateJobEvent = (value) => validateShape(JOB_EVENT_FIELDS, value, "job event");
