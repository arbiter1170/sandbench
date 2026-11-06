// What an approval card says (UX P3): a plain title, labelled fields, what the step does on this
// PC, what approving covers, and how the card ended. Display only: nothing here approves, denies,
// settles or retries anything. Every line is derived from what the card itself carries, checked
// against the code that produces it:
//
// - Planner cards (no `permissionId`) come from approvalFields (work.ts) and run once through
//   runApproval (App.tsx).
// - Claude Code cards carry the driver's own reason, `Claude Code asked to use <Tool>.`, and its
//   denialCommand text (harness/drivers/claude.mjs). What one approval lets through is the gate's
//   key for that call (claudeGate.mjs gateKey): the exact command, URL, query or MCP arguments,
//   or the file (whatever its content) for Write/Edit/NotebookEdit, for the rest of the turn.
// - Other driver cards (codex, grok, http, anthropic) answer one request: accept, allow-once, or
//   one runCommand.
// - How a card ended comes from the turn-recovery texts (turnRecovery.ts), this tab's own Deny
//   click, and a tool_end's exit code. A card without proof says what is known instead.
import type { Key } from "./i18n";
import { IN_FLIGHT, NO_DECISION, REFUSED_ELSEWHERE, STOPPED, STOP_REQUESTED } from "./turnRecovery";
import type { Approval } from "./types";

type Translate = (key: Key) => string;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

export type CardAgent = "planner" | "claude" | "driver";
export type CardKind = "command" | "web-fetch" | "web-search" | "file" | "connector" | "pointer" | "memory" | "tool" | "agent";
export type CardEnding =
  | "waiting"
  | "approved-no-result-yet"
  | "approved-recorded"
  | "approved-exit"
  | "approved-tool-error"
  | "approved-no-separate-result"
  | "approved-no-result-at-stop"
  | "approved-failed"
  | "denied-by-you"
  | "denied-unattended"
  | "denied-source-unknown"
  | "stopped"
  | "stop-requested"
  | "no-decision"
  | "connection-lost"
  | "answer-unconfirmed"
  | "already-closed"
  | "unavailable"
  | "unknown";
/** An icon shape per ending, so state is never told by colour alone (the label is the word). */
export type CardIcon = "clock" | "check" | "dots" | "cross" | "slash" | "stop" | "question" | "unlink" | "minus";

export type CardField = { id: string; label: string; value: string; code?: boolean; note?: string };

export type ApprovalView = {
  agent: CardAgent;
  kind: CardKind;
  title: string;
  fields: CardField[];
  scopeLabel: string;
  scope: string;
  /** Pending driver cards only: what happens when nobody answers. */
  timeout?: string;
  approveLabel: string;
  denyLabel: string;
  ending: CardEnding;
  label: string;
  icon: CardIcon;
  /** What the ending means, in a sentence or two; undefined when the label says it all. */
  detail?: string;
  /** Approve and Deny are offered (the caller still needs a handler). */
  decidable: boolean;
  /** The output is a real result (or a planner error) and is shown in its own scroll box. */
  showOutput: boolean;
};

// ---- Which tab denied: page-local, for this page's lifetime (I-8). ----

const deniedHere = new Map<string, number>();

/** Record that the person pressed Deny on this card in this tab. Display only. */
export function recordDeny(cardId: string, at = Date.now()): void {
  if (cardId && !deniedHere.has(cardId)) deniedHere.set(cardId, at);
}

/** When this tab's Deny was pressed for the card, if it was. */
export function deniedAt(cardId: string): number | undefined {
  return deniedHere.get(cardId);
}

// ---- What kind of request this is. ----

// A card is Claude Code's only when the harness's own `tool` field on the permission_request
// (Approval.agentTool) names the tool, and the driver's reason text (claude.mjs `converse`) and
// card text agree with it. Another driver's reason and command can be model-written, so they alone
// prove nothing; a card saved before agentTool existed counts as not Claude Code's.
const CLAUDE_REASON = /^Claude Code asked to use ([\w.:-]+)\.$/;
const SHELL_TOOLS = new Set(["Bash", "PowerShell", "Monitor"]);
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// claude.mjs denialCommand cuts MCP arguments at 300 characters.
const MCP_ARGS_SHOWN = 300;

export type ClaudeRequest = { tool: string; target: string };

/** The Claude Code tool and its target as the card shows them, or null for any other card. */
export function claudeRequest(approval: Pick<Approval, "command" | "reason" | "permissionId" | "agentTool">): ClaudeRequest | null {
  if (!approval.permissionId || !approval.agentTool) return null;
  const match = CLAUDE_REASON.exec(approval.reason ?? "");
  if (!match || match[1] !== approval.agentTool) return null;
  const tool = match[1];
  const command = approval.command ?? "";
  // denialCommand: Bash and PowerShell show the command alone; every other tool "<Tool> <target>".
  if (tool === "Bash" || tool === "PowerShell") return { tool, target: command };
  if (command !== tool && !command.startsWith(`${tool} `)) return null;
  return { tool, target: command.slice(tool.length).trim() };
}

// claude.mjs denialCommand shows an MCP call as all of its arguments in JSON, cut to 299
// characters and "…" past 300 (#38). A harness from before #38 showed one argument (command,
// file_path, notebook_path, path, url or query) when it had one: text that isn't a JSON object
// is that one value. The page can't tell a pre-#38 harness from its labels alone.

/** What an MCP card's target text is: all the arguments, all of them cut short, one value, or nothing. */
export function mcpArguments(target: string): "full" | "cut" | "single" | "none" {
  if (!target) return "none";
  try {
    const parsed: unknown = JSON.parse(target);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? "full" : "single";
  } catch {
    return target.length === MCP_ARGS_SHOWN && target.startsWith('{"') ? "cut" : "single";
  }
}

function claudeKind(tool: string): CardKind {
  if (SHELL_TOOLS.has(tool)) return "command";
  if (tool === "WebFetch") return "web-fetch";
  if (tool === "WebSearch") return "web-search";
  if (FILE_TOOLS.has(tool)) return "file";
  if (/^mcp__.+/.test(tool)) return "connector";
  return "tool";
}

function plannerKind(approval: Approval): CardKind {
  if (approval.memory) return "memory";
  if (approval.file) return "file";
  if (approval.tool) return "connector";
  if (approval.pointer) return "pointer";
  return "command";
}

// ---- How the card ended. ----

const LOST_PENDING = "Not answered. ";
const LOST_PENDING_END = " The harness denies a request nobody answers after 30 minutes.";
const LOST_IN_FLIGHT = "No result came back. ";
const LOST_IN_FLIGHT_END = " It may have run; check before running it again.";
// turnRecovery.ts NO_RESULT_AT_STOP (not exported): an approved card with no result at Stop.
const NO_RESULT_AT_STOP = "No result came back before the turn stopped.";
// harness/turns.mjs: the tool_end it publishes at turn end for a granted step with no result.
export const SYNTHETIC_RESULT = "The agent ran this step itself; its result is in the reply.";
// harness/server.mjs: POST /permissions/<id> for a request that is no longer waiting (404).
export const NOT_WAITING = "That request is no longer waiting.";

const between = (text: string, start: string, end: string) => text.slice(start.length, text.endsWith(end) ? text.length - end.length : undefined).trim();

type Ending = { ending: CardEnding; label: string; icon: CardIcon; detail?: string; showOutput: boolean };

function endingFor(approval: Approval, kind: CardKind, agent: CardAgent, t: Translate, local: { deniedAt?: number; time: (ms: number) => string }): Ending {
  const output = approval.output;
  // A failed card that later got a tool_end (App.tsx keeps the earlier text in answerError): the
  // harness granted the request. After a 404 from this page's own answer, it was granted elsewhere.
  const late = approval.answerError !== undefined;
  const elsewhere = late && approval.answerError?.trim() === NOT_WAITING;
  const who = approval.auto ? t("acWhoAuto") : elsewhere ? t("acWhoElsewhere") : t("acWhoApproved");
  const lateNote = late ? (elsewhere ? t("acApprovedElsewhereBody") : t("acLateResultBody")) : "";
  const approved = (key: Key, icon: CardIcon, extra: Partial<Ending> = {}, values: Record<string, string | number> = {}): Ending => {
    const detail = [lateNote, approval.auto ? t("acAutoBody") : "", extra.detail ?? ""].filter(Boolean).join(" ");
    return { ending: "approved-recorded", icon, showOutput: false, ...extra, label: `${who} · ${fill(t(key), values)}`, ...(detail ? { detail } : { detail: undefined }) };
  };
  switch (approval.status) {
    case "pending":
      return { ending: "waiting", label: t("approvalPending"), icon: "clock", showOutput: false };
    case "approved": {
      if (output === undefined || output === IN_FLIGHT) return approved("acResultNoneYet", "dots", { ending: "approved-no-result-yet" });
      if (approval.exitCode !== undefined) {
        if (approval.exitCode === 0) return approved("acResultRecorded", "check", { ending: "approved-recorded", showOutput: true });
        if (agent === "planner" && kind === "connector") return approved("acResultToolError", "cross", { ending: "approved-tool-error", showOutput: true });
        return approved("acResultExit", "cross", { ending: "approved-exit", showOutput: true }, { code: approval.exitCode });
      }
      if (output.startsWith(NO_RESULT_AT_STOP)) {
        return approved("acResultNoneAtStop", "stop", { ending: "approved-no-result-at-stop", detail: t("acNoResultAtStopBody") });
      }
      if (output.startsWith(LOST_IN_FLIGHT)) {
        return {
          ending: "connection-lost",
          label: t("acLost"),
          icon: "unlink",
          detail: fill(t("acLostInFlightBody"), { reason: between(output, LOST_IN_FLIGHT, LOST_IN_FLIGHT_END) }).replace(/\s+/g, " ").trim(),
          showOutput: false,
        };
      }
      // No exit code: the harness's own end-of-turn record, or a result without one. Never "recorded".
      return approved("acResultNoneSeparate", "question", {
        ending: "approved-no-separate-result",
        detail: t("acNoSeparateBody"),
        showOutput: output !== SYNTHETIC_RESULT && output.trim() !== "",
      });
    }
    case "denied":
      if (approval.autoDenied) return { ending: "denied-unattended", label: t("acDeniedUnattended"), icon: "slash", detail: t("acDeniedUnattendedBody"), showOutput: false };
      return local.deniedAt !== undefined
        ? { ending: "denied-by-you", label: t("acDeniedByYou"), icon: "slash", detail: fill(t("acDeniedByYouBody"), { time: local.time(local.deniedAt) }), showOutput: false }
        : { ending: "denied-source-unknown", label: t("acDeniedUnknown"), icon: "slash", detail: t("acDeniedUnknownBody"), showOutput: false };
    case "failed": {
      if (agent === "planner") {
        return { ending: "approved-failed", label: `${who} · ${t("acResultFailed")}`, icon: "cross", detail: approval.auto ? t("acAutoBody") : undefined, showOutput: true };
      }
      if (output === STOPPED) return { ending: "stopped", label: t("acStopped"), icon: "stop", detail: t("acStoppedBody"), showOutput: false };
      if (output === STOP_REQUESTED) return { ending: "stop-requested", label: t("acStopRequested"), icon: "stop", detail: t("acStopRequestedBody"), showOutput: false };
      if (output === REFUSED_ELSEWHERE) return { ending: "no-decision", label: t("acNoDecision"), icon: "minus", detail: t("acNoDecisionClosedBody"), showOutput: false };
      if (output === NO_DECISION) return { ending: "no-decision", label: t("acNoDecision"), icon: "minus", detail: t("acNoDecisionEndedBody"), showOutput: false };
      if (output?.startsWith(LOST_PENDING)) {
        return {
          ending: "connection-lost",
          label: t("acLost"),
          icon: "unlink",
          detail: fill(t("acLostPendingBody"), { reason: between(output, LOST_PENDING, LOST_PENDING_END) }).replace(/\s+/g, " ").trim(),
          showOutput: false,
        };
      }
      // decideApproval: the harness said the request had already closed (404), so this answer did nothing.
      if (output?.trim() === NOT_WAITING) return { ending: "already-closed", label: t("acAlreadyClosed"), icon: "minus", detail: t("acAlreadyClosedBody"), showOutput: false };
      // decideApproval: the answer could not be sent to the harness (the request may still be open).
      if (output) return { ending: "answer-unconfirmed", label: t("acAnswerUnconfirmed"), icon: "question", detail: fill(t("acAnswerUnconfirmedBody"), { error: output.trim() }), showOutput: false };
      return { ending: "unknown", label: t("acUnknown"), icon: "question", showOutput: false };
    }
    case "unavailable":
      return { ending: "unavailable", label: t("acUnavailable"), icon: "minus", detail: t("acUnavailableBody"), showOutput: false };
    default:
      return { ending: "unknown", label: t("acUnknown"), icon: "question", showOutput: false };
  }
}

// ---- The whole card. ----

export function approvalView(
  approval: Approval,
  t: Translate,
  local: { deniedAt?: number; time?: (ms: number) => string } = {},
): ApprovalView {
  const time = local.time ?? ((ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const claude = claudeRequest(approval);
  const agent: CardAgent = approval.permissionId ? (claude ? "claude" : "driver") : "planner";
  const kind: CardKind = claude ? claudeKind(claude.tool) : agent === "driver" ? "agent" : plannerKind(approval);
  const fields: CardField[] = [];
  const field = (id: string, label: Key, value: string, extra: Partial<CardField> = {}) => fields.push({ id, label: t(label), value, ...extra });
  let title: string;
  let scope: string;
  let approveLabel: string;
  let effect: string;

  if (claude) {
    const { tool, target } = claude;
    field("tool", "acFieldTool", fill(t("acToolClaude"), { tool }));
    // A hooked call with no target has no gate key (claudeGate.mjs gateKey returns null): an
    // approval cannot be matched to it, so the hook asks again. MCP tools are keyed on their
    // arguments even when there are none.
    const unmatched = !target && kind !== "connector" && kind !== "tool";
    if (kind === "command") {
      title = t("acTitleCommand");
      // No "Starts in" row: Claude Code's shell can change folder between calls, so the card can't say.
      field("target", "acFieldCommand", target || t("acNotShown"), { code: Boolean(target) });
      effect = t("acEffectCommand");
      scope = unmatched ? t("acScopeClaudeUnmatched") : t("acScopeClaudeCommand");
      approveLabel = t("acApproveRun");
    } else if (kind === "web-fetch") {
      title = t("acTitleWebFetch");
      field("target", "acFieldAddress", target || t("acNotShown"), { code: Boolean(target) });
      effect = t("acEffectWeb");
      scope = unmatched ? t("acScopeClaudeUnmatched") : t("acScopeClaudeFetch");
      approveLabel = t("acApprovePage");
    } else if (kind === "web-search") {
      title = t("acTitleWebSearch");
      field("target", "acFieldQuery", target || t("acNotShown"), { code: Boolean(target) });
      effect = t("acEffectWeb");
      scope = unmatched ? t("acScopeClaudeUnmatched") : t("acScopeClaudeSearch");
      approveLabel = t("acApproveSearch");
    } else if (kind === "file") {
      title = tool === "Write" ? t("acTitleFileWrite") : tool === "NotebookEdit" ? t("acTitleNotebookEdit") : t("acTitleFileEdit");
      field("target", "acFieldFile", target || t("acNotShown"), { code: Boolean(target) });
      effect = target ? fill(tool === "Write" ? t("acEffectWrite") : t("acEffectEdit"), { path: target }) : t("acEffectUnknown");
      scope = unmatched ? t("acScopeClaudeUnmatched") : fill(t("acScopeClaudeFile"), { tool });
      approveLabel = t("acApproveChange");
    } else if (kind === "connector") {
      title = t("acTitleConnector");
      const args = mcpArguments(target);
      if (args === "full") field("target", "acFieldArguments", target, { code: true });
      else if (args === "cut") field("target", "acFieldArguments", target, { code: true, note: t("acArgsCut") });
      else if (args === "single") field("target", "acFieldTarget", target, { code: true, note: t("acArgsOthersHidden") });
      effect = t("acEffectConnector");
      // Only a card that shows every argument can say the approval is for exactly this call.
      scope = args === "full" || args === "none" ? t("acScopeClaudeConnector") : t("acScopeClaudeConnectorPartial");
      approveLabel = t("acApproveCall");
    } else {
      title = fill(t("acTitleTool"), { tool });
      if (target) field("target", "acFieldTarget", target, { code: true });
      effect = t("acEffectUnknown");
      scope = fill(t("acScopeClaudeTool"), { tool });
      approveLabel = t("acApprove");
    }
  } else if (agent === "driver") {
    title = t("acTitleAgent");
    field("tool", "acFieldTool", approval.agentTool || t("acToolNotRecorded"));
    field("target", "acFieldRequest", approval.command, { code: true });
    effect = t("acEffectCommand");
    scope = t("acScopeDriver");
    approveLabel = t("acApprove");
  } else {
    scope = t("acScopePlanner");
    if (kind === "memory") {
      const memory = approval.memory!;
      title = t("acTitleMemory");
      field("tool", "acFieldTool", t("acToolMemoryPlanner"));
      field("target", "acFieldSavesTo", memory.destination, { code: true });
      effect = fill(t("memorySavePreview"), { path: memory.destination }) + ".";
      approveLabel = t("acApproveSave");
    } else if (kind === "file") {
      const file = approval.file!;
      title = file.op === "delete" ? t("acTitleFileDelete") : file.existed === true ? t("acTitleFileReplace") : file.existed === false ? t("acTitleFileCreate") : t("acTitleFileWrite");
      field("tool", "acFieldTool", t("acToolFilePlanner"));
      field("target", "acFieldFile", file.path, { code: true });
      effect = fill(file.op === "delete" ? t("acEffectDelete") : t("acEffectWrite"), { path: file.path });
      approveLabel = t("acApproveChange");
    } else if (kind === "connector") {
      const tool = approval.tool!;
      title = t("acTitleConnector");
      field("tool", "acFieldTool", fill(t("acToolPlanner"), { tool: tool.name }));
      field("target", "acFieldArguments", JSON.stringify(tool.args), { code: true });
      effect = t("acEffectConnector");
      approveLabel = t("acApproveCall");
    } else if (kind === "pointer") {
      title = t("acTitlePointer");
      field("tool", "acFieldTool", t("acToolPointerPlanner"));
      field("target", "acFieldAction", approval.command, { code: true });
      effect = t("acEffectPointer");
      approveLabel = t("acApproveAction");
    } else {
      title = t("acTitleCommand");
      field("tool", "acFieldTool", t("acToolShellPlanner"));
      field("target", "acFieldCommand", approval.command, { code: true });
      field("where", "acFieldRunsIn", t("acRunsInChat"));
      effect = t("acEffectCommand");
      approveLabel = t("acApproveRun");
    }
  }
  field("effect", "acFieldOnThisPc", effect);
  // Claude Code's reason is the driver's own "asked to use <Tool>", which the Tool row already says.
  if (!claude && approval.reason?.trim()) field("reason", "acFieldReason", approval.reason.trim());

  const end = endingFor(approval, kind, agent, t, { deniedAt: local.deniedAt, time });
  const decidable = approval.status === "pending";
  return {
    agent,
    kind,
    title,
    fields,
    scopeLabel: decidable ? t("acScopeIfApprove") : t("acScopeCovers"),
    scope,
    ...(decidable && agent !== "planner" ? { timeout: t("acTimeout") } : {}),
    approveLabel,
    denyLabel: t("deny"),
    ending: end.ending,
    label: end.label,
    icon: end.icon,
    ...(end.detail ? { detail: end.detail } : {}),
    decidable,
    showOutput: end.showOutput && approval.output !== undefined && approval.output !== IN_FLIGHT,
  };
}
