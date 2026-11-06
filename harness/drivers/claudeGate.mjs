// PreToolUse hook for Claude Code turns. Claude Code runs its own read-only shell commands
// (`ls`, `cat`, read-only `git`, ...) without a permission prompt in every mode, and that set
// cannot be configured, so an `allow` list alone lets them skip the approval card. This hook
// sees every Bash and PowerShell call first (and any other tool Claude Code sends it, such as
// Monitor): a call the user approved in this turn word for word goes on to the allow rules,
// and anything else gets "ask". In `claude -p` nobody can answer that prompt, so the call is
// denied and listed in the result's `permission_denials`, which the driver turns into a card.
//
// The approved list is a file the driver writes outside the turn folder, named on the hook's
// command line, so nothing the turn folder or Claude Code's environment says can change it.
// Claude Code treats a hook that crashes, cannot start or times out as no answer and runs the
// call, so this file answers "ask" on every error, the driver checks it before each turn, and
// the driver stops a turn when a call it did not approve has any outcome but this refusal.
import { readFileSync } from "node:fs";

export const GATED_TOOLS = ["Bash", "PowerShell"];
// Every tool the hook sees: the shells, plus the tools that change files or reach the network.
// Claude Code's own allow rule for these is the bare tool name (an absolute-path rule such as
// `Write(/abs/a.txt)` never matches, and a bare `WebFetch` rule would cover every URL), so the
// hook alone decides which exact call runs. Read, Grep and Glob are not here (a known gap).
const HOOKED = ["Bash", "PowerShell", "Monitor", "WebFetch", "WebSearch", "Write", "Edit", "MultiEdit", "NotebookEdit"];
export const HOOK_MATCHER = `${HOOKED.join("|")}|mcp__.*`;
export const hookedTool = (tool) => typeof tool === "string" && (HOOKED.includes(tool) || /^mcp__.+/.test(tool));

// JSON with sorted keys, so the same call always gives the same key.
const stable = (value) =>
  Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value) ?? "null";
export const REASON = "Waiting for approval in Sandbench.";
// The hook command passes this flag; importing the file (the driver, the tests) does not run it.
export const HOOK_FLAG = "--sandbench-claude-gate";

export const ASK = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: REASON } };

/**
 * The key one approval covers: the exact command for anything that runs one, the exact URL or
 * query for WebFetch and WebSearch, the file for Write, Edit and NotebookEdit, and the exact
 * arguments for an MCP tool. The driver keys approvals the same way. Claude Code hands this hook
 * a Monitor call as a Bash call with the same command, so every tool that runs a command other
 * than PowerShell is keyed as Bash. null (always ask) when the call has no such target.
 */
export function gateKey(tool, input) {
  if (typeof tool !== "string" || !tool) return null;
  const command = input?.command;
  if (typeof command === "string") return command ? `${tool === "PowerShell" ? "PowerShell" : "Bash"}(${command})` : null;
  if (GATED_TOOLS.includes(tool)) return null;
  const named = (value) => (typeof value === "string" && value ? `${tool}(${value})` : null);
  if (tool === "WebFetch") return named(input?.url);
  if (tool === "WebSearch") return named(input?.query);
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) return named(input?.file_path ?? input?.notebook_path);
  if (/^mcp__.+/.test(tool)) return input && typeof input === "object" && !Array.isArray(input) ? `${tool}(${stable(input)})` : null;
  const target = input?.file_path ?? input?.path;
  return typeof target === "string" && target ? `${tool}(${target})` : tool;
}

/** The hook's answer for one request: null lets it go on to the allow rules, else ASK. */
export function gateDecision(input, approved) {
  if (!input || typeof input !== "object" || !Array.isArray(approved)) return ASK;
  const key = gateKey(input.tool_name, input.tool_input);
  return key !== null && approved.includes(key) ? null : ASK;
}

/** Run as the hook: the request on stdin, the approved list in `listFile`; the answer for stdout. */
export function runGate(stdinText, listFile) {
  try {
    const list = JSON.parse(readFileSync(listFile, "utf8"));
    const decision = gateDecision(JSON.parse(stdinText), list);
    return decision ? JSON.stringify(decision) : "";
  } catch {
    return JSON.stringify(ASK);
  }
}

if (process.argv[2] === HOOK_FLAG) {
  let output;
  try {
    output = runGate(readFileSync(0, "utf8"), process.argv[3]);
  } catch {
    output = JSON.stringify(ASK);
  }
  process.stdout.write(output);
}
