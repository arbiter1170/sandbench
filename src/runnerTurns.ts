// Runner-mode turns (SB-03 PR 2). In runner mode (VITE_RUNNER_URL) a turn is a job on the runner:
// the page posts the request, then watches the job's event stream and paints it into the thread
// the same way the local-harness path does. The runner finishes the turn whether or not the tab
// stays open; the reply lands in a `messages` record, so a device that attaches later gets it from
// the SB-02 record stream. Local harness mode never comes through this file.
import { harnessPermit, runnerFetch, runnerMode, type AgentEvent } from "./harness";
import type { Approval, Message } from "./types";

export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

/** The body of POST /api/jobs (runner/contracts/turn.mjs). Never a key: `secret` is a name. */
export type RunnerTurnRequest = {
  threadId: string;
  text: string;
  agentId: string;
  driver: string;
  model?: string;
  base?: string;
  secret?: "XAI_API_KEY" | "ANTHROPIC_API_KEY" | "COMPAT_API_KEY";
  folder?: string;
  /** The user message record the page already holds for this turn. */
  messageId?: string;
  /** The assistant message record the reply is written into (the page's stand-in). */
  replyId?: string;
};

export type RunnerJobEvent = AgentEvent & {
  jobId: string;
  at?: number;
  deniedReason?: string;
  status?: string;
  class?: string;
};

export type RunnerTurnStarted = { jobId: string; messageId: string; replyId: string };

const TERMINAL = new Set<AgentEvent["type"]>(["done", "error"]);

async function fail(response: Response, what: string): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error || `${what} returned ${response.status}.`);
}

/** Drops empty optional fields: the runner's contract refuses an empty string. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

export async function startRunnerTurn(request: RunnerTurnRequest, fetcher: Fetcher = runnerFetch): Promise<RunnerTurnStarted> {
  const response = await fetcher("/jobs", { method: "POST", body: JSON.stringify(compact(request)) });
  if (response.status !== 201) return fail(response, "Starting the turn");
  return (await response.json()) as RunnerTurnStarted;
}

export function interruptRunnerTurn(jobId: string, fetcher: Fetcher = runnerFetch): Promise<Response> {
  return fetcher(`/jobs/${encodeURIComponent(jobId)}/interrupt`, { method: "POST", body: "{}" });
}

/**
 * Answers a permission card. In runner mode the card is an approval row on the runner; in local
 * harness mode this is exactly `harnessPermit`, unchanged.
 */
export function permitTurn(
  permissionId: string,
  allow: boolean,
  deps: { runnerMode: boolean; fetcher: Fetcher; harnessPermit: typeof harnessPermit } = { runnerMode, fetcher: runnerFetch, harnessPermit },
): Promise<{ ok: boolean }> {
  if (!deps.runnerMode) return deps.harnessPermit(permissionId, allow);
  return deps.fetcher(`/approvals/${encodeURIComponent(permissionId)}`, { method: "POST", body: JSON.stringify({ allow }) }).then(async (response) => {
    if (!response.ok) return fail(response, "Answering the card");
    return (await response.json()) as { ok: boolean };
  });
}

/** Parses one SSE body into events (the runner closes the stream after the terminal event). */
async function* readEvents(response: Response): AsyncGenerator<RunnerJobEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((item) => item.startsWith("data:"));
        if (line) yield JSON.parse(line.slice(5)) as RunnerJobEvent;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/**
 * Watches a job's events from `after` until the terminal event. A stream that ends early (the
 * phone's connection dropped) is reopened from the last seq seen, so nothing is missed or
 * repeated. Resolves when `onEvent` returns true or the terminal event arrives; rejects when the
 * job is gone or the runner stays unreachable.
 */
export async function watchRunnerTurn(
  jobId: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: RunnerJobEvent) => boolean | void,
  { fetcher = runnerFetch, retries = 10, delayMs = 1000, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: { fetcher?: Fetcher; retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  let last = after;
  let failures = 0;
  while (!signal.aborted) {
    let response: Response;
    try {
      response = await fetcher(`/jobs/${encodeURIComponent(jobId)}/events?after=${last}`, { signal });
    } catch (error) {
      if (signal.aborted) return;
      if (++failures > retries) throw error instanceof Error ? error : new Error(String(error));
      await sleep(Math.min(delayMs * failures, 10_000));
      continue;
    }
    if (response.status === 404) throw new Error("That turn is gone from the runner.");
    if (!response.ok) {
      if (++failures > retries) return fail(response, "The event stream");
      await sleep(Math.min(delayMs * failures, 10_000));
      continue;
    }
    failures = 0;
    let terminal = false;
    try {
      for await (const event of readEvents(response)) {
        if (event.seq <= last) continue;
        last = event.seq;
        const stop = onEvent(event) === true || TERMINAL.has(event.type);
        if (stop) {
          terminal = true;
          break;
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (++failures > retries) throw error instanceof Error ? error : new Error(String(error));
    }
    if (terminal || signal.aborted) return;
    // The stream ended without a terminal event: reconnect from where we were.
    await sleep(delayMs);
  }
}

/** What driveRunnerTurn needs from the page; the same helpers App.tsx's harness path uses. */
export type TurnUi = {
  patchMessage: (threadId: string, messageId: string, update: (message: Message) => Message) => void;
  beginAssistant: (threadId: string, botId: string) => string;
  addActivity: (threadId: string, messageId: string, label: string, ms?: number) => void;
  bumpUsage: (patch: { commands?: number }) => void;
};

export type DriveRunnerTurnArgs = {
  botId: string;
  threadId: string;
  assistantId: string;
  messageId?: string;
  prompt: string;
  driver: string;
  model: string;
  base: string;
  secret?: RunnerTurnRequest["secret"];
  folder?: string;
  signal: AbortSignal;
  appendThinking: (step: string) => void;
};

/**
 * The runner-mode body of App.tsx's driveTurn: start the job, then paint its events into the
 * thread exactly as the harness path paints harness events. Returns the reply text.
 */
export async function driveRunnerTurn(args: DriveRunnerTurnArgs, ui: TurnUi, deps: { fetcher?: Fetcher; watch?: typeof watchRunnerTurn } = {}): Promise<string> {
  const fetcher = deps.fetcher ?? runnerFetch;
  const watch = deps.watch ?? watchRunnerTurn;
  const { threadId, botId } = args;
  const { jobId } = await startRunnerTurn(
    {
      threadId,
      text: args.prompt,
      agentId: botId,
      driver: args.driver,
      model: args.model,
      base: args.base,
      secret: args.secret,
      folder: args.folder,
      messageId: args.messageId,
      replyId: args.assistantId,
    },
    fetcher,
  );
  const stop = () => void interruptRunnerTurn(jobId, fetcher).catch(() => undefined);
  args.signal.addEventListener("abort", stop, { once: true });
  let current: string | null = args.assistantId;
  let reply = "";
  let failure: string | undefined;
  const cards = new Map<string, { id: string; command: string }>();
  const target = () => {
    if (current) return current;
    const id = ui.beginAssistant(threadId, botId);
    ui.patchMessage(threadId, id, (message) => ({ ...message, localStandIn: false }));
    current = id;
    return id;
  };
  try {
    await watch(jobId, 0, args.signal, (event) => {
      if (event.type === "thinking" && event.text) args.appendThinking(event.text);
      if (event.type === "message_delta" && event.text) {
        const chunk = event.text;
        reply += chunk;
        ui.patchMessage(threadId, target(), (message) => ({ ...message, text: message.text + chunk }));
      }
      if (event.type === "permission_request") {
        const id = target();
        const permissionId = event.permissionId || "";
        if (permissionId) cards.set(permissionId, { id, command: event.command ?? "" });
        const status: Approval["status"] = event.auto ? "approved" : event.denied ? "denied" : "pending";
        const approval: Approval = {
          command: event.command ?? "",
          reason: event.denied && event.deniedReason ? event.deniedReason : event.reason || "The agent asked to run this.",
          status,
          ...(permissionId ? { permissionId } : {}),
          ...(event.auto ? { auto: true, output: "…" } : {}),
        };
        ui.patchMessage(threadId, id, (message) => ({ ...message, status: "done", approval }));
        current = null;
      }
      if (event.type === "permission_resolved" && event.permissionId) {
        const id = cards.get(event.permissionId)?.id;
        if (id) {
          ui.patchMessage(threadId, id, (message) =>
            message.approval?.status === "pending" ? { ...message, approval: { ...message.approval, status: event.allow ? "approved" : "denied" } } : message,
          );
        }
      }
      if (event.type === "tool_end" && event.permissionId) {
        const card = cards.get(event.permissionId);
        if (card) {
          const { id, command } = card;
          ui.patchMessage(threadId, id, (message) =>
            message.approval ? { ...message, approval: { ...message.approval, output: event.output ?? "", ...(event.code !== undefined ? { exitCode: event.code } : {}) } } : message,
          );
          ui.addActivity(threadId, id, event.code !== undefined ? `Ran ${command} · exit ${event.code}` : `Agent ran ${command}`, event.ms);
          ui.bumpUsage({ commands: 1 });
        }
      }
      if (event.type === "error") failure = event.message || "The agent stopped with an error.";
      return event.type === "done" || event.type === "error";
    }, { fetcher });
  } finally {
    args.signal.removeEventListener("abort", stop);
    for (const { id } of cards.values()) {
      ui.patchMessage(threadId, id, (message) => (message.approval?.status === "pending" ? { ...message, approval: { ...message.approval, status: "denied" } } : message));
    }
  }
  if (current) ui.patchMessage(threadId, current, (message) => ({ ...message, status: "done" }));
  if (failure) throw new Error(failure);
  return reply;
}
