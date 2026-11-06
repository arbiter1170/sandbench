// PreToolUse hook for Claude Code turns. Claude Code runs its own read-only shell commands
// (`ls`, `cat`, read-only `git`, ...) without a permission prompt in every mode, and that set
// cannot be configured, so an `allow` list alone lets them skip the approval card. This hook
// sees every Bash and PowerShell call first: a command the user approved in this turn (its
// `Tool(command)` rule is in SANDBENCH_CLAUDE_ALLOW) goes on to the allow rules, and anything
// else gets "ask". In `claude -p` nobody can answer that prompt, so the call is denied and
// listed in the result's `permission_denials`, which the driver turns into a card.
//
// Claude Code treats a hook that crashes or cannot start as no answer and runs the call, so
// this file answers "ask" on every error, and the driver checks it before each turn.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GATE_FILE = fileURLToPath(import.meta.url);
export const ALLOW_ENV = "SANDBENCH_CLAUDE_ALLOW";
export const GATED_TOOLS = ["Bash", "PowerShell"];
const REASON = "Waiting for approval in Sandbench.";

export const ASK = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: REASON } };

/** The hook's answer for one request: null lets it go on to the allow rules, else ASK. */
export function gateDecision(input, allow) {
  if (!input || typeof input !== "object" || !Array.isArray(allow)) return ASK;
  const tool = input.tool_name;
  if (!GATED_TOOLS.includes(tool)) return ASK;
  const command = input.tool_input?.command;
  if (typeof command !== "string" || !command) return ASK;
  return allow.includes(`${tool}(${command})`) ? null : ASK;
}

/** Run as the hook: read the request on stdin, write the answer on stdout. */
export function runGate(stdinText, env = process.env) {
  try {
    const decision = gateDecision(JSON.parse(stdinText), JSON.parse(env[ALLOW_ENV] ?? "null"));
    return decision ? JSON.stringify(decision) : "";
  } catch {
    return JSON.stringify(ASK);
  }
}

// The hook command passes this flag; importing the file (the driver, the tests) does not run it.
export const HOOK_FLAG = "--sandbench-claude-gate";

if (process.argv[2] === HOOK_FLAG) {
  let output;
  try {
    output = runGate(readFileSync(0, "utf8"));
  } catch {
    output = JSON.stringify(ASK);
  }
  process.stdout.write(output);
}
