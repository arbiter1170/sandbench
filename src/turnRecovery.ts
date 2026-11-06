import type { Approval, Message, Thread } from "./types";

// Resuming and settling lost turns is for local-harness turns only: a runner turn (SB-03 PR 2)
// keeps going without the tab and is the runner's to settle, so runner mode follows one stream
// as before (src/harness.ts) and skips settleLoadedThreads. The end-of-turn labels below (Stop,
// no decision) apply to both.

/** The in-flight marker an approved card shows until its result arrives. */
export const IN_FLIGHT = "…";

export const RELOADED = "The page closed or reloaded before this reply finished.";
export const DROPPED = "The connection to the local harness dropped before the turn finished.";
export const HARNESS_RESTARTED = "The local harness restarted, so this turn is gone.";
export const GAP = "Some of this turn's events were dropped by the local harness before this page read them, so what happened after that is unknown.";

/**
 * A card whose answer or result can no longer reach this page. Nothing is sent to the harness:
 * a waiting request is not denied or approved from here (the harness denies it itself when its
 * wait runs out), and nothing is run again.
 */
export function settleCard(approval: Approval, reason: string): Approval {
  if (approval.status === "pending" && approval.permissionId) {
    return { ...approval, status: "failed", output: `Not answered. ${reason} The harness denies a request nobody answers after 30 minutes.` };
  }
  if (approval.status === "approved" && approval.output === IN_FLIGHT) {
    return { ...approval, output: `No result came back. ${reason} It may have run; check before running it again.` };
  }
  return approval;
}

/**
 * Settle one message after its turn stopped reaching this page. The partial text and trace stay;
 * a reply that was still arriving becomes an interrupted error instead of a finished one. A
 * planner card that is still waiting (no `permissionId`) is the page's own and stays answerable.
 */
export function settleMessage(message: Message, reason: string): Message {
  const approval = message.approval ? settleCard(message.approval, reason) : undefined;
  const streaming = message.status === "streaming";
  if (!streaming && approval === message.approval) return message;
  return {
    ...message,
    ...(approval ? { approval } : {}),
    ...(streaming ? { status: "error" as const, interrupted: reason } : {}),
  };
}

/** Run on a local workspace as it loads: no turn from before the load is still reaching it. */
export function settleLoadedThreads(threads: Thread[], reason = RELOADED): Thread[] {
  let changed = false;
  const next = threads.map((thread) => {
    let touched = false;
    const messages = thread.messages.map((message) => {
      const settled = settleMessage(message, reason);
      if (settled !== message) touched = true;
      return settled;
    });
    if (!touched) return thread;
    changed = true;
    return { ...thread, messages };
  });
  return changed ? next : threads;
}

export type FollowResult = "ended" | "dropped" | "gone" | "gap";

/**
 * Follow a harness turn's event stream until it ends (`onEvent` returns true for done or error).
 * A stream that closes or fails first is resumed from the last event seen, so nothing is shown
 * twice and nothing is re-run; the harness replays what was missed. Returns "gone" when the
 * harness no longer knows the turn, "gap" when some of its events fell out of the harness's
 * replay buffer before they were read, and "dropped" when it stays unreachable (`retries`
 * failed resumes in a row; a resume that brings new events starts the count again). The
 * signal rethrows the AbortError.
 */
export async function followTurn<E extends { seq?: number; type: string }>(options: {
  after: number;
  signal: AbortSignal;
  subscribe: (after: number, onEvent: (event: E) => boolean | void) => Promise<void>;
  state: () => Promise<"running" | "finished" | "unknown">;
  onEvent: (event: E) => boolean | void;
  retries?: number;
  delayMs?: (attempt: number) => number;
}): Promise<FollowResult> {
  const retries = options.retries ?? 3;
  const delay = options.delayMs ?? ((attempt) => 500 * 2 ** attempt);
  let last = options.after;
  let ended = false;
  let gap = false;
  const handle = (event: E) => {
    if (event.type === "gap") {
      gap = true;
      return true;
    }
    if (typeof event.seq === "number") {
      if (event.seq <= last) return false;
      last = event.seq;
    }
    ended = options.onEvent(event) === true;
    return ended;
  };
  for (let attempt = 0; ; attempt += 1) {
    const from = last;
    try {
      await options.subscribe(last, handle);
    } catch (error) {
      if (isAbort(error) || options.signal.aborted) throw error;
    }
    if (gap) return "gap";
    if (ended) return "ended";
    if (last > from) attempt = 0;
    if (options.signal.aborted) throw new DOMException("Stopped.", "AbortError");
    if (attempt >= retries) return "dropped";
    await wait(delay(attempt), options.signal);
    const state = await options.state().catch(() => null);
    if (state === "unknown") return "gone";
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Stopped.", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException("Stopped.", "AbortError"));
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

// Stop (U-7 in the UX design): the harness publishes the same `permission_resolved
// {allow:false}` for a user's Deny, a 30-minute expiry and Stop, and the page's interrupt POST
// can fail unseen, so a card that was still waiting when Stop was pressed never says "denied".
// It says the stop was requested until the harness's `done{stopped:true}` confirms it.
export const STOP_REQUESTED = "Stop requested · no decision. Nobody answered before Stop, and the harness has not confirmed the stop yet.";
/** How long the page keeps reading a turn's events after Stop, waiting for done{stopped:true}. */
export const STOP_GRACE_MS = 5_000;
export const STOPPED = "Stopped · no decision. Nobody answered before the turn stopped, so it was not approved.";
export const NO_DECISION = "No decision recorded here. The turn ended before this page saw an answer.";
// A refusal this page did not make: its own Deny leaves "pending" before the request is sent.
export const REFUSED_ELSEWHERE = "Not approved. No decision was recorded here: the request expired after 30 minutes or was answered somewhere else.";
// On the reply itself (Message.interrupted): S5a and S5b in the UX design.
export const STOPPED_REPLY = "Stopped by you. Steps above with a recorded result ran; others have unknown status.";
export const STOP_REQUESTED_REPLY = "Stop requested · not confirmed. The harness has not said the turn stopped.";
const NO_RESULT_AT_STOP = "No result came back before the turn stopped. It may have run; check before running it again.";

/** A driver card that was still waiting when Stop was pressed. */
export function stoppedCard(approval: Approval, confirmed: boolean): Approval {
  return { ...approval, status: "failed", output: confirmed ? STOPPED : STOP_REQUESTED };
}

const waitingDriverCard = (approval: Approval | undefined): boolean =>
  Boolean(approval?.permissionId) && (approval?.status === "pending" || (approval?.status === "failed" && approval.output === STOP_REQUESTED));

/**
 * Settle one of a driver turn's messages once the turn stops reaching the page: lost (the
 * stream could not be resumed), stopped (Stop pressed; `stopConfirmed` once `done{stopped:true}`
 * arrived), or ended (done or error, `failed` for an error).
 */
export function settleEndedMessage(message: Message, end: { lost?: string; stopRequested: boolean; stopConfirmed: boolean; failed: boolean; last?: boolean }): Message {
  if (end.lost) return settleMessage(message, end.lost);
  const card = message.approval;
  const approval = card && waitingDriverCard(card)
    ? end.stopRequested
      ? stoppedCard(card, end.stopConfirmed)
      : { ...card, status: "failed" as const, output: NO_DECISION }
    : end.stopRequested && message.approval?.status === "approved" && message.approval.output === IN_FLIGHT
      ? { ...message.approval, output: NO_RESULT_AT_STOP }
      : message.approval;
  const status = message.status === "streaming" ? (end.failed && !end.stopRequested ? "error" : "done") : message.status;
  // A stopped reply never looks finished: the one still arriving, or the turn's last message, says so.
  const marked = end.stopRequested && !message.interrupted && (message.status === "streaming" || end.last);
  if (approval === message.approval && status === message.status && !marked) return message;
  return { ...message, status, ...(approval ? { approval } : {}), ...(marked ? { interrupted: end.stopConfirmed ? STOPPED_REPLY : STOP_REQUESTED_REPLY } : {}) };
}
