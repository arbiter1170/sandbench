// One status line per assistant message (UX P2): an icon shape and a word, never colour alone,
// and only the actions the state table allows. Everything here is derived from the message as
// stored plus page-local facts the caller passes in (runner mode, whether a turn is running,
// whether a later message continues the same agent turn). Nothing is fetched or guessed: a
// state that the page can't prove (a start it didn't see answered, a Stop the harness didn't
// confirm) says so instead of picking the likelier story.
import type { ChatAgent } from "./chatContext";
import { IN_FLIGHT, STOPPED_REPLY, STOP_REQUESTED_REPLY } from "./turnRecovery";
import type { Message, Thread } from "./types";

export type TurnStateId =
  | "starting" // S1
  | "working" // S2
  | "waiting" // S3
  | "finished" // S4
  | "stopped" // S5a
  | "stopRequested" // S5b
  | "failed" // S6
  | "rounds" // S7
  | "interrupted" // S8
  | "couldntStart" // S9 (S12 once the planner answer is chosen)
  | "startUnknown" // S10
  | "stoppedInPage" // a built-in planner reply stopped in this page (no harness turn to confirm)
  | "continued"; // an earlier message of an agent turn that went on in a later message

export type TurnAction = "checkConnection" | "askAgain" | "plannerAnswer" | "errorDetails";

export type TurnKey =
  | "tsStarting" | "tsStartingLine" | "tsWorking" | "tsWaiting" | "tsWaitingLine" | "tsFinished" | "tsFinishedApproval"
  | "tsApprovedByYou" | "tsApprovedByRule" | "tsApproved" | "tsOneTimeDone" | "tsStopped" | "tsStoppedLine"
  | "tsStopRequested" | "tsStopRequestedLine" | "tsFailed" | "tsFailedLine" | "tsFailedPlannerLine" | "tsFailedNoReason"
  | "tsRounds" | "tsRoundsLine" | "tsInterrupted" | "tsInterruptedLine" | "tsCouldntStart" | "tsCouldntStartLine"
  | "tsCouldntStartRefusedLine" | "tsStartUnknown" | "tsStartUnknownLine" | "tsStoppedInPage" | "tsStoppedInPageLine"
  | "tsContinued" | "tsReasonUnreachable" | "tsReasonRunnerUnreachable" | "tsReasonUnavailable" | "tsReasonUnavailableRunner"
  | "tsReasonRefused" | "tsNothingSent" | "tsThisReply";

export type TurnStatus = {
  state: TurnStateId;
  /** A shape, read with the word; hidden from screen readers (the word carries the meaning). */
  icon: string;
  /** The short state word, also shown in the message header. */
  word: string;
  /** The full status line, word first. This is the polite live region. */
  text: string;
  /** S2 only: the newest trace step, shown after the line but outside the live region. */
  step?: string;
  /** S9 only: why it couldn't start, and that nothing was sent. */
  reason?: string;
  note?: string;
  tone: "live" | "wait" | "ok" | "bad" | "warn";
  actions: TurnAction[];
};

export type TurnContext = {
  t: (key: TurnKey) => string;
  /** The bot's name, for "<bot> is paused until you choose." */
  bot?: string;
  /** A later message carries on the same agent turn (see continuedIds). */
  continued?: boolean;
  /** Runner mode: the one-time planner answer is withheld there (W-3). */
  runner?: boolean;
};

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** "Claude Code exited with 1." → "Claude Code exited with 1": the first sentence, short. */
export function shortReason(reason: string | undefined): string {
  const line = (reason ?? "").trim().split("\n")[0].trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  const cut = sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
  return cut.replace(/[.!?]+$/, "");
}

/** The status line for one assistant message, or null for a user message. */
export function turnStatus(message: Message, ctx: TurnContext): TurnStatus | null {
  if (message.role !== "assistant") return null;
  const { t } = ctx;
  const make = (state: TurnStateId, icon: string, word: string, text: string, tone: TurnStatus["tone"], actions: TurnAction[] = [], extra: Partial<TurnStatus> = {}): TurnStatus =>
    ({ state, icon, word, text, tone, actions, ...extra });

  // S9 (and S12 on the same message): no turn exists. Its only way to the planner is the tap.
  if (message.startFailure) {
    const failure = message.startFailure;
    const agent = failure.agent;
    const reason =
      failure.kind === "unreachable"
        ? t(failure.runner ? "tsReasonRunnerUnreachable" : "tsReasonUnreachable")
        : failure.kind === "unavailable"
          ? fill(t(failure.runner ? "tsReasonUnavailableRunner" : "tsReasonUnavailable"), { agent, detail: failure.detail ? `: ${failure.detail.replace(/[.\s]+$/, "")}` : "" })
          : fill(t("tsReasonRefused"), { detail: (failure.detail ?? "").replace(/[.\s]+$/, "") });
    const line = fill(t(failure.kind === "refused" ? "tsCouldntStartRefusedLine" : "tsCouldntStartLine"), { agent });
    // The planner choice is offered only here, only once, and never in runner mode (W-3).
    const actions: TurnAction[] = ["checkConnection", ...(!failure.runner && !ctx.runner && !message.plannerAnswer ? (["plannerAnswer"] as const) : [])];
    return make("couldntStart", "⊘", t("tsCouldntStart"), `${t("tsCouldntStart")} · ${line}`, "bad", actions, { reason: `${reason}.`, note: fill(t("tsNothingSent"), { agent }) });
  }
  // S10: POST /turns failed in a way that doesn't prove no turn exists.
  if (message.startUnknown) {
    return make("startUnknown", "?", t("tsStartUnknown"), fill(t("tsStartUnknownLine"), { agent: message.startUnknown.agent }), "warn", ["checkConnection", "askAgain"]);
  }
  if (message.status === "streaming") {
    if (message.driverTurn && !message.driverTurn.id) {
      return make("starting", "○", t("tsStarting"), fill(t("tsStartingLine"), { agent: message.driverTurn.agent }), "live");
    }
    if (message.approval?.status === "pending") return waiting(ctx);
    return make("working", "◐", t("tsWorking"), t("tsWorking"), "live", [], { step: message.thinking?.at(-1) });
  }
  if (message.approval?.status === "pending") return waiting(ctx);
  if (ctx.continued) return make("continued", "↓", "", t("tsContinued"), "ok");
  if (message.interrupted === STOPPED_REPLY) {
    return make("stopped", "■", t("tsStopped"), t("tsStoppedLine"), "warn", ["askAgain"]);
  }
  if (message.interrupted === STOP_REQUESTED_REPLY) {
    return make("stopRequested", "□", t("tsStopRequested"), t("tsStopRequestedLine"), "warn", ["checkConnection", "askAgain"]);
  }
  // S8: a lost stream, a dropped resume, a harness restart or a reload (turnRecovery.ts).
  if (message.interrupted) {
    return make("interrupted", "▲", t("tsInterrupted"), fill(t("tsInterruptedLine"), { reason: message.interrupted.trim() }), "warn", ["checkConnection", "askAgain"]);
  }
  if (message.stoppedInPage) return make("stoppedInPage", "■", t("tsStoppedInPage"), t("tsStoppedInPageLine"), "warn", ["askAgain"]);
  if (message.status === "error") {
    const reason = shortReason(message.failure);
    const text = reason
      ? fill(t(message.driverTurn ? "tsFailedLine" : "tsFailedPlannerLine"), { reason })
      : t("tsFailedNoReason");
    return make("failed", "✕", t("tsFailed"), text, "bad", [...(message.failure ? (["errorDetails"] as const) : []), "askAgain"]);
  }
  if (message.roundsExhausted) {
    return make("rounds", "⋯", t("tsRounds"), fill(t("tsRoundsLine"), { n: message.roundsExhausted }), "warn", ["askAgain"]);
  }
  // An approved step whose result hasn't come back yet: the turn is still working on it.
  if (message.approval?.status === "approved" && message.approval.output === IN_FLIGHT) {
    return make("working", "◐", t("tsWorking"), t("tsWorking"), "live");
  }
  const approval = message.approval?.status === "approved"
    ? fill(t("tsFinishedApproval"), {
        title: message.approval.command.length > 60 ? `${message.approval.command.slice(0, 59)}…` : message.approval.command,
        how: t(message.approval.auto ? "tsApprovedByRule" : message.approval.permissionId ? "tsApprovedByYou" : "tsApproved"),
      })
    : "";
  const once = message.answeredBy?.kind === "planner-once" ? fill(t("tsOneTimeDone"), { agent: message.answeredBy.agent }) : "";
  return make("finished", "✓", t("tsFinished"), [t("tsFinished"), approval, once].filter(Boolean).join(" · "), "ok");
}

function waiting(ctx: TurnContext): TurnStatus {
  const text = fill(ctx.t("tsWaitingLine"), { bot: ctx.bot || ctx.t("tsThisReply") });
  return { state: "waiting", icon: "‖", word: ctx.t("tsWaiting"), text, tone: "wait", actions: [] };
}

/** Messages that an agent turn went on from (a card, then more text in a new message). */
export function continuedIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  const lastOfTurn = new Map<string, string>();
  for (const message of messages) {
    const turn = message.role === "assistant" ? message.driverTurn?.id : undefined;
    if (!turn) continue;
    const before = lastOfTurn.get(turn);
    if (before) ids.add(before);
    lastOfTurn.set(turn, message.id);
  }
  return ids;
}

// harness/turns.mjs `start()` throws these before a turn id exists. Only they prove no turn was
// created (I-4b); the server's catch-all answers 500 for errors after `turn_start` too.
export const START_REFUSALS = ["Unknown driver.", "No prompt.", "The working folder must stay inside the workspace folder."] as const;

/** POST /turns failed: refused before a turn existed (S9), or not known (S10). */
export class TurnStartError extends Error {
  readonly kind: "refused" | "unknown";
  readonly reason: string;
  constructor(kind: "refused" | "unknown", reason: string) {
    super(reason);
    this.kind = kind;
    this.reason = reason;
  }
}

export function classifyStartError(error: unknown): TurnStartError {
  const reason = error instanceof Error ? error.message : String(error);
  // A network failure (fetch's TypeError) or any other answer may have come after a start.
  const refused = !(error instanceof TypeError) && (START_REFUSALS as readonly string[]).includes(reason.trim());
  return new TurnStartError(refused ? "refused" : "unknown", reason);
}

/** S9's record for a chosen agent that can't run now (I-4a): nothing was sent to it. */
export function startFailureFor(agent: Extract<ChatAgent, { kind: "unavailable" }>, input: { harnessUp: boolean; runner: boolean }): NonNullable<Message["startFailure"]> {
  return {
    kind: input.harnessUp ? "unavailable" : "unreachable",
    agent: agent.name,
    ...(input.harnessUp && agent.detail ? { detail: agent.detail } : {}),
    ...(input.runner ? { runner: true } : {}),
  };
}

/** Whether the one-time planner answer can start from this message now (I-1, I-3, W-3). */
export function canChoosePlanner(message: Message | undefined, input: { runner: boolean; busy: boolean }): boolean {
  return Boolean(message?.startFailure) && !message?.startFailure?.runner && !message?.plannerAnswer && !input.runner && !input.busy;
}

/**
 * Write the planner claim onto the S9 message (I-3). Returns null when there is nothing to claim:
 * no such message, not S9, or already claimed. The caller writes the result before it starts the
 * planner turn, in the same synchronous step, so a second tap or a stale render finds the claim.
 */
export function claimPlannerAnswer(threads: Thread[], threadId: string, messageId: string, claim: { messageId: string; at: number }): Thread[] | null {
  const thread = threads.find((item) => item.id === threadId);
  const message = thread?.messages.find((item) => item.id === messageId);
  if (!thread || !message?.startFailure || message.plannerAnswer) return null;
  const messages = thread.messages.map((item) => (item.id === messageId ? { ...item, plannerAnswer: { ...claim } } : item));
  return threads.map((item) => (item.id === threadId ? { ...thread, messages } : item));
}

/** The message a reply answered: the nearest earlier message from the person. */
export function promptFor(messages: Message[], messageId: string): string {
  const index = messages.findIndex((item) => item.id === messageId);
  for (let at = index - 1; at >= 0; at -= 1) {
    if (messages[at].role === "user") return messages[at].text;
  }
  return "";
}
