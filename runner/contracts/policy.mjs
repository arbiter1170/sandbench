// Policy check (SB-06): check({ agent, action }) -> { class, needs, reason, blocked? }.
// `blocked: true` is a hard block: no card is offered and nobody can approve it. (This field is
// the handoff's addition to the brief's contract.)
import { validateShape } from "./shape.mjs";

export const POLICY_CLASSES = ["green", "yellow", "red"];
export const POLICY_NEEDS = ["none", "card", "vincent"];

/** @typedef {{ class: "green"|"yellow"|"red", needs: "none"|"card"|"vincent", reason: string, blocked?: boolean }} PolicyResult */
export const POLICY_RESULT_FIELDS = {
  class: { type: "string", required: true, enum: POLICY_CLASSES },
  needs: { type: "string", required: true, enum: POLICY_NEEDS },
  reason: { type: "string", required: true, maxLength: 2000 },
  blocked: { type: "boolean" },
};

export function validatePolicyResult(value) {
  const result = validateShape(POLICY_RESULT_FIELDS, value, "policy result");
  if (!result.ok) return result;
  const errors = [];
  if (value.class === "red" && value.needs !== "vincent" && !value.blocked) errors.push("needs must be vincent for a red item (or blocked)");
  if (value.needs === "none" && value.class !== "green") errors.push("only a green item can need nothing");
  if (value.blocked && value.needs === "none") errors.push("a blocked item can't need nothing");
  return errors.length ? { ok: false, errors } : result;
}
