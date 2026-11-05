// SB-03 PR 1 contracts: fixtures pass, every bad field is named, the default policy never allows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateApproval, validateJob, validateJobEvent, validatePolicyResult, validateTool, validateTurnRequest } from "../contracts/index.mjs";
import { check as defaultCheck } from "../policy/default.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../contracts/fixtures/${name}.json`, import.meta.url), "utf8"));
const named = (result, field) => {
  assert.equal(result.ok, false, `expected a failure naming ${field}`);
  assert.ok(result.errors.some((error) => error.startsWith(field)), `${field}: ${result.errors.join(" | ")}`);
};
const cases = [
  ["job", validateJob],
  ["job-event", validateJobEvent],
  ["turn", validateTurnRequest],
  ["approval", validateApproval],
  ["policy", validatePolicyResult],
];

test("every fixture is valid", () => {
  for (const [name, validate] of cases) assert.deepEqual(validate(fixture(name)), { ok: true, value: fixture(name) }, name);
});

test("each required field, when missing, is named", () => {
  const required = {
    job: ["id", "owner", "agent_id", "kind", "status", "payload", "timeout_s", "resumable", "created_at"],
    "job-event": ["job_id", "seq", "type", "data", "at"],
    turn: ["threadId", "text"],
    approval: ["id", "owner", "job_id", "agent_id", "class", "required_approver", "status", "request", "created_at"],
    policy: ["class", "needs", "reason"],
  };
  for (const [name, validate] of cases) {
    for (const field of required[name]) {
      const value = fixture(name);
      delete value[field];
      named(validate(value), field);
    }
  }
});

test("bad enums, types and ranges are named", () => {
  named(validateJob({ ...fixture("job"), kind: "deploy" }), "kind");
  named(validateJob({ ...fixture("job"), status: "paused" }), "status");
  named(validateJob({ ...fixture("job"), timeout_s: 0 }), "timeout_s");
  named(validateJob({ ...fixture("job"), timeout_s: 13 * 3600 }), "timeout_s");
  named(validateJob({ ...fixture("job"), pid: 1.5 }), "pid");
  named(validateJob({ ...fixture("job"), created_at: "yesterday" }), "created_at");
  named(validateJob({ ...fixture("job"), owner: null }), "owner");
  named(validateJob({ ...fixture("job"), agent_id: "../qa" }), "agent_id");
  named(validateJobEvent({ ...fixture("job-event"), seq: 0 }), "seq");
  named(validateApproval({ ...fixture("approval"), class: "orange" }), "class");
  named(validateApproval({ ...fixture("approval"), required_approver: "anyone" }), "required_approver");
  named(validateApproval({ ...fixture("approval"), required_approver: "owner" }), "required_approver");
  named(validatePolicyResult({ ...fixture("policy"), needs: "maybe" }), "needs");
  named(validatePolicyResult({ class: "yellow", needs: "none", reason: "x" }), "only a green item");
  named(validatePolicyResult({ class: "red", needs: "card", reason: "x" }), "needs");
  assert.equal(validatePolicyResult({ class: "red", needs: "vincent", reason: "push to main", blocked: true }).ok, true);
});

test("a turn request can't carry fields the engine fills", () => {
  named(validateTurnRequest({ ...fixture("turn"), owner: "u-other" }), "owner");
  named(validateTurnRequest({ ...fixture("turn"), extras: { maxTurns: 200 } }), "extras");
  named(validateTurnRequest({ ...fixture("turn"), model: "opus; rm -rf /" }), "model");
  named(validateTurnRequest({ ...fixture("turn"), text: "" }), "text");
});

test("a tool descriptor whose inputSchema declares agentId (or owner) is refused", () => {
  const tool = {
    name: "memory_save",
    description: "Save a memory item.",
    inputSchema: { type: "object", properties: { kind: { type: "string" }, text: { type: "string" } }, required: ["kind", "text"] },
    action: (args) => ({ type: "memory_save", kind: args.kind }),
    handler: async () => ({ ok: true }),
  };
  assert.equal(validateTool(tool).ok, true);
  for (const field of ["agentId", "agent_id", "owner"]) {
    const result = validateTool({ ...tool, inputSchema: { type: "object", properties: { ...tool.inputSchema.properties, [field]: { type: "string" } } } });
    named(result, "inputSchema");
    assert.match(result.errors.join(" "), new RegExp(field));
  }
  named(validateTool({ ...tool, name: "Memory Save" }), "name");
  named(validateTool({ ...tool, handler: "not a function" }), "handler");
  named(validateTool({ ...tool, inputSchema: { type: "array" } }), "inputSchema");
});

test("the default policy asks for a card for everything and never allows on its own", () => {
  for (const action of [{ type: "exec", command: "ls" }, { type: "memory_search" }, {}, undefined]) {
    const result = defaultCheck({ agent: { id: "qa" }, action });
    assert.equal(validatePolicyResult(result).ok, true);
    assert.equal(result.needs, "card");
    assert.notEqual(result.needs, "none");
    assert.equal(result.blocked, false);
  }
});
