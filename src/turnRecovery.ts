import type { Approval, Message, Thread } from "./types";

// Local-harness turns only. A runner turn (SB-03 PR 2) keeps going without the tab and is the
// runner's to settle, so none of this runs in runner mode.

/** The in-flight marker an approved card shows until its result arrives. */
export const IN_FLIGHT = "…";

export const RELOADED = "The page closed or reloaded before this reply finished.";
export const DROPPED = "The connection to the local harness dropped before the turn finished.";
export const HARNESS_RESTARTED = "The local harness restarted, so this turn is gone.";

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

export type FollowResult = "ended" | "dropped" | "gone";

/**
 * Follow a harness turn's event stream until it ends (`onEvent` returns true for done or error).
 * A stream that closes or fails first is resumed from the last event seen, so nothing is shown
 * twice and nothing is re-run; the harness replays what was missed. Returns "gone" when the
 * harness no longer knows the turn and "dropped" when it stays unreachable. Stop (the signal)
 * rethrows the AbortError.
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
  const handle = (event: E) => {
    if (typeof event.seq === "number") {
      if (event.seq <= last) return false;
      last = event.seq;
    }
    ended = options.onEvent(event) === true;
    return ended;
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      await options.subscribe(last, handle);
    } catch (error) {
      if (isAbort(error) || options.signal.aborted) throw error;
    }
    if (ended) return "ended";
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
export const STOPPED = "Stopped · no decision. Nobody answered before the turn stopped, so it was not approved.";
export const NO_DECISION = "No decision recorded here. The turn ended before this page saw an answer.";

/** A driver card that was still waiting when Stop was pressed. */
export function stoppedCard(approval: Approval, confirmed: boolean): Approval {
  return { ...approval, status: "failed", output: confirmed ? STOPPED : STOP_REQUESTED };
}

const waitingDriverCard = (approval: Approval | undefined): approval is Approval =>
  Boolean(approval?.permissionId) && (approval?.status === "pending" || (approval?.status === "failed" && approval.output === STOP_REQUESTED));

/**
 * Settle one of a driver turn's messages once the turn stops reaching the page: lost (the
 * stream could not be resumed), stopped (Stop pressed; `stopConfirmed` once `done{stopped:true}`
 * arrived), or ended (done or error, `failed` for an error).
 */
export function settleEndedMessage(message: Message, end: { lost?: string; stopRequested: boolean; stopConfirmed: boolean; failed: boolean }): Message {
  if (end.lost) return settleMessage(message, end.lost);
  const approval = waitingDriverCard(message.approval)
    ? end.stopRequested
      ? stoppedCard(message.approval, end.stopConfirmed)
      : { ...message.approval, status: "failed" as const, output: NO_DECISION }
    : message.approval;
  const status = message.status === "streaming" ? (end.failed && !end.stopRequested ? "error" : "done") : message.status;
  return approval === message.approval && status === message.status ? message : { ...message, status, ...(approval ? { approval } : {}) };
}
