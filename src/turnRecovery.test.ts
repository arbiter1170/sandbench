import { describe, expect, it } from "vitest";
import { DROPPED, followTurn, IN_FLIGHT, RELOADED, settleCard, settleLoadedThreads, settleMessage } from "./turnRecovery";
import type { Approval, Message, Thread } from "./types";

const message = (patch: Partial<Message>): Message => ({
  id: "m1",
  role: "assistant",
  text: "",
  createdAt: 1,
  attachments: [],
  status: "done",
  localStandIn: false,
  fresh: false,
  ...patch,
});
const card = (patch: Partial<Approval>): Approval => ({ command: "git push origin main", reason: "test", status: "pending", ...patch });
const thread = (messages: Message[]): Thread => ({ id: "t1", title: "t", createdAt: 1, updatedAt: 1, messages }) as Thread;

describe("settling a local workspace as it loads", () => {
  it("turns a reply saved mid-stream into an interrupted error and keeps its partial text and trace", () => {
    const saved = message({ status: "streaming", text: "Half of the ans", thinking: ["Ask the model."] });
    const [loaded] = settleLoadedThreads([thread([saved])]);
    expect(loaded.messages[0]).toMatchObject({ status: "error", interrupted: RELOADED, text: "Half of the ans", thinking: ["Ask the model."] });
  });

  it("leaves finished messages, and a workspace with nothing to settle, exactly as they were", () => {
    const threads = [thread([message({ text: "done" }), message({ id: "m2", status: "error", text: "boom" })])];
    expect(settleLoadedThreads(threads)).toBe(threads);
  });

  it("keeps a planner card that is still waiting answerable: it is the page's own and never ran", () => {
    const planner = card({});
    expect(settleCard(planner, RELOADED)).toBe(planner);
    const threads = [thread([message({ approval: planner })])];
    expect(settleLoadedThreads(threads)).toBe(threads);
  });

  it("marks a driver card nobody can answer from here as not answered, without approving or denying it", () => {
    const settled = settleCard(card({ permissionId: "a".repeat(16) }), RELOADED);
    expect(settled.status).toBe("failed");
    expect(settled.output).toMatch(/^Not answered\. .*denies a request nobody answers after 30 minutes/);
  });

  it("replaces an in-flight placeholder with a note that the command may have run, and leaves real results alone", () => {
    expect(settleCard(card({ status: "approved", output: IN_FLIGHT }), RELOADED).output).toMatch(/No result came back\. .*It may have run; check before running it again\./);
    const ran = card({ status: "approved", output: "ok", exitCode: 0 });
    expect(settleCard(ran, RELOADED)).toBe(ran);
    const denied = card({ status: "denied", permissionId: "b".repeat(16) });
    expect(settleCard(denied, RELOADED)).toBe(denied);
  });

  it("a message settled after a dropped stream says why", () => {
    expect(settleMessage(message({ status: "streaming" }), DROPPED)).toMatchObject({ status: "error", interrupted: DROPPED });
  });
});

type Event = { seq: number; type: string; text?: string };

// A fake harness: a replay buffer like harness/turns.mjs, and streams that can be cut off.
function fakeHarness(events: Event[], cuts: number[], state: () => "running" | "finished" | "unknown" = () => "running") {
  const calls: number[] = [];
  return {
    calls,
    subscribe: async (after: number, onEvent: (event: Event) => boolean | void) => {
      calls.push(after);
      const cut = cuts.shift();
      for (const event of events.filter((item) => item.seq > after)) {
        if (cut !== undefined && event.seq > cut) {
          if (cut < 0) throw new TypeError("network error");
          return;
        }
        if (onEvent(event) === true) return;
      }
    },
    state: async () => state(),
  };
}

const terminal = (event: { type: string }) => event.type === "done" || event.type === "error";

describe("following a turn's events", () => {
  const stream: Event[] = [
    { seq: 11, type: "message_delta", text: "Hel" },
    { seq: 12, type: "message_delta", text: "lo" },
    { seq: 13, type: "done" },
  ];
  const instant = () => 0;

  it("a normal turn ends after one stream", async () => {
    const harness = fakeHarness(stream, []);
    const seen: number[] = [];
    const result = await followTurn<Event>({ after: 10, signal: new AbortController().signal, ...harness, onEvent: (event) => (seen.push(event.seq), terminal(event)), delayMs: instant });
    expect(result).toBe("ended");
    expect(seen).toEqual([11, 12, 13]);
  });

  it("a stream that closes early resumes from the last event, showing nothing twice", async () => {
    const harness = fakeHarness(stream, [11]);
    const text: string[] = [];
    const result = await followTurn<Event>({
      after: 10,
      signal: new AbortController().signal,
      ...harness,
      onEvent: (event) => {
        if (event.text) text.push(event.text);
        return terminal(event);
      },
      delayMs: instant,
    });
    expect(result).toBe("ended");
    expect(harness.calls).toEqual([10, 11]);
    expect(text.join("")).toBe("Hello");
  });

  it("a stream that fails with a network error resumes the same way", async () => {
    const harness = fakeHarness(stream, [-1]);
    const result = await followTurn<Event>({ after: 10, signal: new AbortController().signal, ...harness, onEvent: terminal, delayMs: instant });
    expect(result).toBe("ended");
    expect(harness.calls).toEqual([10, 10]);
  });

  it("ignores events replayed at or before the last one seen", async () => {
    const seen: number[] = [];
    const result = await followTurn<Event>({
      after: 10,
      signal: new AbortController().signal,
      subscribe: async (_after, onEvent) => {
        for (const event of [...stream.slice(0, 2), ...stream]) if (onEvent(event) === true) return;
      },
      state: async () => "running",
      onEvent: (event) => (seen.push(event.seq), terminal(event)),
      delayMs: instant,
    });
    expect(result).toBe("ended");
    expect(seen).toEqual([11, 12, 13]);
  });

  it("an ended stream without done or error is never reported as finished", async () => {
    const harness = fakeHarness(stream.slice(0, 2), [99, 99, 99, 99]);
    const result = await followTurn<Event>({ after: 10, signal: new AbortController().signal, ...harness, onEvent: terminal, delayMs: instant, retries: 3 });
    expect(result).toBe("dropped");
    expect(harness.calls.length).toBe(4);
  });

  it("a harness that restarted (turn unknown) is reported as gone instead of waiting forever", async () => {
    const harness = fakeHarness(stream, [11, 11], () => "unknown");
    const result = await followTurn<Event>({ after: 10, signal: new AbortController().signal, ...harness, onEvent: terminal, delayMs: instant });
    expect(result).toBe("gone");
    expect(harness.calls).toEqual([10]);
  });

  it("an unreachable harness while resuming counts as a retry, then the turn is dropped", async () => {
    const harness = fakeHarness([], [-1, -1, -1, -1]);
    const result = await followTurn<Event>({
      after: 10,
      signal: new AbortController().signal,
      subscribe: harness.subscribe,
      state: () => Promise.reject(new TypeError("Failed to fetch")),
      onEvent: terminal,
      delayMs: instant,
      retries: 2,
    });
    expect(result).toBe("dropped");
  });

  it("an error event ends the turn (the caller reports it as an error)", async () => {
    const harness = fakeHarness([{ seq: 11, type: "error" }], []);
    expect(await followTurn<Event>({ after: 10, signal: new AbortController().signal, ...harness, onEvent: terminal, delayMs: instant })).toBe("ended");
  });

  it("Stop while waiting to resume rethrows the abort and does not resubscribe", async () => {
    const controller = new AbortController();
    const harness = fakeHarness(stream, [11, 11]);
    const following = followTurn<Event>({ after: 10, signal: controller.signal, ...harness, onEvent: terminal, delayMs: () => 50 });
    setTimeout(() => controller.abort(), 5);
    await expect(following).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.calls).toEqual([10]);
  });
});
