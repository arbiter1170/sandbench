import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runnerMode } from "./harness";
import { driveRunnerTurn, permitTurn, startRunnerTurn, watchRunnerTurn, type Fetcher, type RunnerJobEvent, type TurnUi } from "./runnerTurns";
import type { Message } from "./types";

const sse = (events: object[], status = 200) =>
  new Response(events.map((event) => `id: ${(event as { seq: number }).seq}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { status, headers: { "content-type": "text/event-stream" } });
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ev = (seq: number, type: RunnerJobEvent["type"], extra: object = {}): RunnerJobEvent => ({ seq, jobId: "j1", turnId: "j1", type, ...extra });

/** A fake runner: records calls and answers from a script keyed by method + path prefix. */
function fakeRunner(answers: Record<string, (init?: RequestInit, path?: string) => Response | Promise<Response>>) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const fetcher: Fetcher = async (path, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ path, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const key = Object.keys(answers).find((item) => `${method} ${path}`.startsWith(item));
    if (!key) return json({ error: `no answer for ${method} ${path}` }, 500);
    return answers[key](init, path);
  };
  return { fetcher, calls };
}

describe("local harness mode is untouched", () => {
  it("this build is not in runner mode, and permitTurn is exactly harnessPermit then", async () => {
    expect(runnerMode).toBe(false);
    const harnessPermit = vi.fn().mockResolvedValue({ ok: true });
    const fetcher = vi.fn();
    await expect(permitTurn("abc", true, { runnerMode: false, fetcher, harnessPermit })).resolves.toEqual({ ok: true });
    expect(harnessPermit).toHaveBeenCalledWith("abc", true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("App.tsx keeps the harness turn path, behind a runnerMode guard, and routes card answers through permitTurn", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const start = source.indexOf("async function driveTurn(");
    const body = source.slice(start, source.indexOf("\n  }\n", start));
    expect(body).toContain("if (runnerMode) {");
    expect(body.indexOf("if (runnerMode) {")).toBeLessThan(body.indexOf("harnessStartTurn("));
    // The harness path's own calls are still there, after the guard.
    for (const call of ["harnessStartTurn(", "harnessInterrupt(", "harnessEvents("]) expect(body).toContain(call);
    expect(source).toContain("void permitTurn(permissionId, approve)");
    expect(source).not.toContain("void harnessPermit(");
  });

  it("in runner mode, permitTurn answers the approval row and reports the runner's refusal", async () => {
    const runner = fakeRunner({ "POST /approvals/card-1": () => json({ ok: true, status: "approved" }), "POST /approvals/old": () => json({ error: "That card is already denied." }, 409) });
    const harnessPermit = vi.fn();
    await expect(permitTurn("card-1", true, { runnerMode: true, fetcher: runner.fetcher, harnessPermit })).resolves.toEqual({ ok: true, status: "approved" });
    expect(runner.calls[0]).toEqual({ path: "/approvals/card-1", method: "POST", body: { allow: true } });
    await expect(permitTurn("old", false, { runnerMode: true, fetcher: runner.fetcher, harnessPermit })).rejects.toThrow(/already denied/);
    expect(harnessPermit).not.toHaveBeenCalled();
  });
});

describe("startRunnerTurn", () => {
  it("posts the turn request without empty fields and returns the ids", async () => {
    const runner = fakeRunner({ "POST /jobs": () => json({ jobId: "j1", messageId: "u1", replyId: "r1" }, 201) });
    const started = await startRunnerTurn({ threadId: "t1", text: "hi", agentId: "qa", driver: "claude", model: "", base: "", secret: "ANTHROPIC_API_KEY", folder: undefined, messageId: "u1", replyId: "r1" }, runner.fetcher);
    expect(started).toEqual({ jobId: "j1", messageId: "u1", replyId: "r1" });
    expect(runner.calls[0].body).toEqual({ threadId: "t1", text: "hi", agentId: "qa", driver: "claude", secret: "ANTHROPIC_API_KEY", messageId: "u1", replyId: "r1" });
  });

  it("surfaces the runner's reason (a paused agent)", async () => {
    const runner = fakeRunner({ "POST /jobs": () => json({ error: "paused" }, 409) });
    await expect(startRunnerTurn({ threadId: "t1", text: "hi", agentId: "sup", driver: "claude" }, runner.fetcher)).rejects.toThrow("paused");
  });
});

describe("watchRunnerTurn", () => {
  const noSleep = { sleep: async () => undefined, delayMs: 0 };

  it("reads events, reconnects from the last seq when the stream drops, and stops at the terminal event", async () => {
    let connection = 0;
    const runner = fakeRunner({
      "GET /jobs/j1/events?after=0": () => {
        connection += 1;
        return sse([ev(1, "turn_start"), ev(2, "message_delta", { text: "Hel" })]); // dropped: no terminal event
      },
      "GET /jobs/j1/events?after=2": () => {
        connection += 1;
        return sse([ev(2, "message_delta", { text: "DUP" }), ev(3, "message_delta", { text: "lo" }), ev(4, "done"), ev(5, "thinking", { text: "never read" })]);
      },
    });
    const seen: RunnerJobEvent[] = [];
    await watchRunnerTurn("j1", 0, new AbortController().signal, (event) => void seen.push(event), { fetcher: runner.fetcher, ...noSleep });
    expect(connection).toBe(2);
    expect(seen.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(seen.map((event) => event.text).filter(Boolean).join("")).toBe("Hello");
  });

  it("gives up on a job the runner no longer has, retries a flaky runner, and stops quietly on abort", async () => {
    const gone = fakeRunner({ "GET /jobs/j1/events": () => json({ error: "No such job." }, 404) });
    await expect(watchRunnerTurn("j1", 0, new AbortController().signal, () => undefined, { fetcher: gone.fetcher, ...noSleep })).rejects.toThrow(/gone/);

    let attempts = 0;
    const flaky = fakeRunner({
      "GET /jobs/j1/events": () => {
        attempts += 1;
        if (attempts < 3) throw new TypeError("Failed to fetch");
        return sse([ev(1, "done")]);
      },
    });
    const seen: string[] = [];
    await watchRunnerTurn("j1", 0, new AbortController().signal, (event) => void seen.push(event.type), { fetcher: flaky.fetcher, retries: 5, ...noSleep });
    expect(attempts).toBe(3);
    expect(seen).toEqual(["done"]);

    const dead = fakeRunner({ "GET /jobs/j1/events": () => { throw new TypeError("Failed to fetch"); } });
    await expect(watchRunnerTurn("j1", 0, new AbortController().signal, () => undefined, { fetcher: dead.fetcher, retries: 2, ...noSleep })).rejects.toThrow(/Failed to fetch/);

    const controller = new AbortController();
    const aborted = fakeRunner({
      "GET /jobs/j1/events": () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });
    await expect(watchRunnerTurn("j1", 0, controller.signal, () => undefined, { fetcher: aborted.fetcher, ...noSleep })).resolves.toBeUndefined();
  });
});

describe("driveRunnerTurn", () => {
  const message = (id: string, role: Message["role"] = "assistant"): Message => ({ id, role, text: "", createdAt: 0, attachments: [], status: "streaming", localStandIn: false, fresh: true });

  function page() {
    const messages = new Map<string, Message>([["a1", message("a1")]]);
    let next = 0;
    const ui: TurnUi = {
      patchMessage: (_thread, id, update) => {
        const current = messages.get(id);
        if (current) messages.set(id, update(current));
      },
      beginAssistant: () => {
        const id = `a${++next + 1}`;
        messages.set(id, message(id));
        return id;
      },
      addActivity: vi.fn(),
      bumpUsage: vi.fn(),
    };
    return { ui, messages };
  }

  const args = (signal = new AbortController().signal) => ({
    botId: "qa",
    threadId: "t1",
    assistantId: "a1",
    messageId: "u1",
    prompt: "hello",
    driver: "claude",
    model: "sonnet",
    base: "https://api.anthropic.com/v1",
    secret: "ANTHROPIC_API_KEY" as const,
    signal,
    appendThinking: vi.fn(),
  });

  it("starts the job with the page's record ids, paints deltas, cards and tool results, and returns the reply", async () => {
    const events = [
      ev(1, "queued"),
      ev(2, "turn_start"),
      ev(3, "thinking", { text: "fake turn started" }),
      ev(4, "message_delta", { text: "Let me look. " }),
      ev(5, "permission_request", { permissionId: "card-1", command: "ls", reason: "look around" }),
      ev(6, "permission_resolved", { permissionId: "card-1", allow: true }),
      ev(7, "tool_start", { permissionId: "card-1", command: "ls" }),
      ev(8, "tool_end", { permissionId: "card-1", code: 126, output: "waits for SB-29", ms: 0 }),
      ev(9, "message_delta", { text: "Done." }),
      ev(10, "done"),
    ];
    const runner = fakeRunner({ "POST /jobs": () => json({ jobId: "j1", messageId: "u1", replyId: "a1" }, 201), "GET /jobs/j1/events?after=0": () => sse(events) });
    const { ui, messages } = page();
    const a = args();
    const reply = await driveRunnerTurn(a, ui, { fetcher: runner.fetcher });
    expect(reply).toBe("Let me look. Done.");
    expect(runner.calls[0]).toMatchObject({ path: "/jobs", method: "POST", body: { threadId: "t1", text: "hello", agentId: "qa", driver: "claude", model: "sonnet", secret: "ANTHROPIC_API_KEY", messageId: "u1", replyId: "a1" } });
    expect(JSON.stringify(runner.calls[0].body)).not.toContain("key");
    expect(a.appendThinking).toHaveBeenCalledWith("fake turn started");
    // The first assistant message holds the text before the card, then the card itself.
    const first = messages.get("a1")!;
    expect(first.text).toBe("Let me look. ");
    expect(first.status).toBe("done");
    expect(first.approval).toMatchObject({ command: "ls", reason: "look around", status: "approved", permissionId: "card-1", output: "waits for SB-29", exitCode: 126 });
    expect(ui.addActivity).toHaveBeenCalledWith("t1", "a1", "Ran ls · exit 126", 0);
    expect(ui.bumpUsage).toHaveBeenCalledWith({ commands: 1 });
    // The text after the card went into a new assistant message, marked done at the end.
    const second = messages.get("a2")!;
    expect(second.text).toBe("Done.");
    expect(second.status).toBe("done");
    expect(second.localStandIn).toBe(false);
  });

  it("shows a gated tool request as a denied card with the runner's reason", async () => {
    const events = [ev(1, "turn_start"), ev(2, "permission_request", { permissionId: "", command: "ls", reason: "look", denied: true, deniedReason: "Tools in runner-mode turns wait for agent isolation (SB-29)." }), ev(3, "message_delta", { text: " [denied]" }), ev(4, "done")];
    const runner = fakeRunner({ "POST /jobs": () => json({ jobId: "j1", messageId: "u1", replyId: "a1" }, 201), "GET /jobs/j1/events": () => sse(events) });
    const { ui, messages } = page();
    await driveRunnerTurn(args(), ui, { fetcher: runner.fetcher });
    expect(messages.get("a1")!.approval).toEqual({ command: "ls", reason: "Tools in runner-mode turns wait for agent isolation (SB-29).", status: "denied" });
  });

  it("throws the runner's error event, and interrupts the job when the page aborts", async () => {
    const runner = fakeRunner({ "POST /jobs": () => json({ jobId: "j1", messageId: "u1", replyId: "a1" }, 201), "GET /jobs/j1/events": () => sse([ev(1, "turn_start"), ev(2, "error", { message: "the model fell over" })]) });
    await expect(driveRunnerTurn(args(), page().ui, { fetcher: runner.fetcher })).rejects.toThrow("the model fell over");

    const controller = new AbortController();
    const slow = fakeRunner({
      "POST /jobs": () => json({ jobId: "j1", messageId: "u1", replyId: "a1" }, 201),
      "POST /jobs/j1/interrupt": () => json({ ok: true, status: "cancelling" }),
      "GET /jobs/j1/events": () => {
        controller.abort();
        return sse([ev(1, "turn_start"), ev(2, "done", { stopped: true })]);
      },
    });
    const { ui, messages } = page();
    await driveRunnerTurn(args(controller.signal), ui, { fetcher: slow.fetcher });
    expect(slow.calls.some((call) => call.path === "/jobs/j1/interrupt" && call.method === "POST")).toBe(true);
    expect(messages.get("a1")!.status).toBe("done");
  });
});
