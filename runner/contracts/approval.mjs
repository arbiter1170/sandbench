// Approval record (SB-03 table, SB-06 behaviour): one row per card. Red items need Vincent.
import { validateShape } from "./shape.mjs";

export const APPROVAL_CLASSES = ["green", "yellow", "red"];
export const APPROVERS = ["owner", "vincent"];
export const APPROVAL_STATUS = ["pending", "approved", "denied", "expired"];
const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * @typedef {object} ApprovalRecord
 * @property {string} id
 * @property {string} owner
 * @property {string} job_id
 * @property {string} agent_id
 * @property {"green"|"yellow"|"red"} class
 * @property {"owner"|"vincent"} required_approver
 * @property {"pending"|"approved"|"denied"|"expired"} status
 * @property {string|null} decision_id
 * @property {object} request          what was asked (tool, arguments, reason)
 * @property {string|null} decided_by
 * @property {string} created_at
 * @property {string|null} decided_at
 */
export const APPROVAL_FIELDS = {
  id: { type: "string", required: true, pattern: ID },
  owner: { type: "string", required: true, maxLength: 128 },
  job_id: { type: "string", required: true, pattern: ID },
  agent_id: { type: "string", required: true, pattern: ID },
  class: { type: "string", required: true, enum: APPROVAL_CLASSES },
  required_approver: { type: "string", required: true, enum: APPROVERS },
  status: { type: "string", required: true, enum: APPROVAL_STATUS },
  decision_id: { type: "string", nullable: true, maxLength: 80 },
  request: { type: "object", required: true },
  decided_by: { type: "string", nullable: true, maxLength: 128 },
  created_at: { type: "timestamp", required: true },
  decided_at: { type: "timestamp", nullable: true },
};

export function validateApproval(value) {
  const result = validateShape(APPROVAL_FIELDS, value, "approval");
  if (!result.ok) return result;
  // A red item is decided by Vincent only.
  if (value.class === "red" && value.required_approver !== "vincent") return { ok: false, errors: ["required_approver must be vincent for a red item"] };
  return result;
}
