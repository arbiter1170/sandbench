// Contracts every SB-03 track builds against (SB-03 PR 1). Plain JS validators, no dependency:
// each validateX(value) returns { ok: true, value } or { ok: false, errors: string[] }, and each
// error names the field. Unknown fields are refused, so a caller can't smuggle in something the
// engine is meant to fill (an owner, an agent id) by adding a key.
export * from "./job.mjs";
export * from "./turn.mjs";
export * from "./approval.mjs";
export * from "./tool.mjs";
export * from "./policy.mjs";
export { validateShape } from "./shape.mjs";
