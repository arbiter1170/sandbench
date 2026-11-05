// Tool descriptor (SB-10 registers these from runner/<area>/tools.mjs). The handler gets
// `ctx = { agentId, owner, ... }`, filled from the per-turn token. The agent id never comes from
// the tool's arguments, so an inputSchema that declares agentId, agent_id or owner is refused.
import { validateShape } from "./shape.mjs";

const CTX_FIELDS = ["agentId", "agent_id", "agent", "owner", "ownerId", "uid"];

/**
 * @typedef {object} ToolDescriptor
 * @property {string} name          snake_case, unique across the runner
 * @property {string} description
 * @property {object} inputSchema   JSON Schema, type "object"
 * @property {(args: object) => object} action   what the policy check sees (SB-06)
 * @property {(args: object, ctx: { agentId: string, owner: string }) => Promise<unknown>} handler
 */
export const TOOL_FIELDS = {
  name: { type: "string", required: true, pattern: /^[a-z][a-z0-9_]{1,63}$/ },
  description: { type: "string", required: true, maxLength: 2000 },
  inputSchema: { type: "object", required: true },
  action: { type: "function", required: true },
  handler: { type: "function", required: true },
};

export function validateTool(value) {
  const result = validateShape(TOOL_FIELDS, value, "tool");
  if (!result.ok) return result;
  const errors = [];
  const schema = value.inputSchema;
  if (schema.type !== "object") errors.push("inputSchema.type must be object");
  const properties = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  for (const name of properties) {
    if (CTX_FIELDS.includes(name)) errors.push(`inputSchema can't declare ${name}: it comes from the turn's token (ctx), never from arguments`);
  }
  return errors.length ? { ok: false, errors } : result;
}
