import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  DROPPED,
  followTurn,
  GAP,
  IN_FLIGHT,
  NO_DECISION,
  REFUSED_ELSEWHERE,
  RELOADED,
  settleCard,
  settleEndedMessage,
  settleLoadedThreads,
  settleMessage,
  STOP_REQUESTED,
  STOP_REQUESTED_REPLY,
  STOPPED,
  STOPPED_REPLY,
  stoppedCard,
} from "./turnRecovery";
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

describe("harnessEvents (the local driver path)", () => {
  it("throws TurnLostError when the stream ends and the harness no longer knows the turn", async () => {
    const { harnessEvents, TurnLostError } = await import("./harness");
    const { HARNESS_RESTARTED } = await import("./turnRecovery");
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/events")) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('id: 5\ndata: {"seq":5,"turnId":"t","type":"message_delta","text":"Hi"}\n\n'));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ state: "unknown" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const seen: string[] = [];
      const following = harnessEvents("0123456789abcdef", 4, new AbortController().signal, (event) => {
        if (event.text) seen.push(event.text);
        return event.type === "done";
      });
      await expect(following).rejects.toBeInstanceOf(TurnLostError);
      await expect(following).rejects.toThrow(HARNESS_RESTARTED);
      expect(seen).toEqual(["Hi"]);
      expect(urls.filter((url) => url.includes("/events"))).toHaveLength(1);
      expect(urls.some((url) => url.endsWith("/turns/0123456789abcdef"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("settling a driver turn's messages when it ends (U-7: Stop never reads as a Deny)", () => {
  const driverCard = card({ permissionId: "b".repeat(16) });
  const ended = { stopRequested: false, stopConfirmed: false, failed: false };

  it("a card still waiting when Stop was pressed says the stop was requested, then stopped once the harness confirms", () => {
    const requested = settleEndedMessage(message({ approval: driverCard }), { ...ended, stopRequested: true });
    expect(requested.approval).toMatchObject({ status: "failed", output: STOP_REQUESTED });
    expect(requested.approval?.status).not.toBe("denied");
    const confirmed = settleEndedMessage(message({ approval: driverCard }), { ...ended, stopRequested: true, stopConfirmed: true });
    expect(confirmed.approval).toMatchObject({ status: "failed", output: STOPPED });
    // A card the stream already marked "stop requested" is upgraded when the confirmation arrives.
    const upgraded = settleEndedMessage(message({ approval: stoppedCard(driverCard, false) }), { ...ended, stopRequested: true, stopConfirmed: true });
    expect(upgraded.approval?.output).toBe(STOPPED);
    expect(stoppedCard(driverCard, true)).toMatchObject({ status: "failed", output: STOPPED, command: driverCard.command, permissionId: driverCard.permissionId });
  });

  it("a card nobody answered when the turn ended on its own says no decision was recorded, not denied", () => {
    const settled = settleEndedMessage(message({ approval: driverCard }), ended);
    expect(settled.approval).toMatchObject({ status: "failed", output: NO_DECISION });
  });

  it("cards the user answered, auto-approved ones, results and planner cards are left as they are", () => {
    for (const approval of [
      card({ permissionId: "c".repeat(16), status: "denied" }),
      card({ permissionId: "c".repeat(16), status: "approved", output: "ran" }),
      card({ permissionId: "c".repeat(16), status: "failed", output: "exit 1" }),
      card({ permissionId: "c".repeat(16), status: "failed", output: REFUSED_ELSEWHERE }),
      card({}),
    ]) {
      const done = message({ approval });
      for (const end of [ended, { ...ended, stopRequested: true }, { ...ended, stopRequested: true, stopConfirmed: true }]) expect(settleEndedMessage(done, end)).toBe(done);
    }
    // An in-flight result is only rewritten when Stop cut it off.
    const inFlight = message({ approval: card({ permissionId: "c".repeat(16), status: "approved", auto: true, output: IN_FLIGHT }) });
    expect(settleEndedMessage(inFlight, ended)).toBe(inFlight);
    const cut = settleEndedMessage(inFlight, { ...ended, stopRequested: true });
    expect(cut.approval).toMatchObject({ status: "approved", auto: true });
    expect(cut.approval?.output).toMatch(/may have run/);
  });

  it("a stopped reply never looks finished: it says stopped once confirmed, stop requested before", () => {
    const streaming = message({ status: "streaming", text: "partial" });
    expect(settleEndedMessage(streaming, { ...ended, stopRequested: true })).toMatchObject({ status: "done", interrupted: STOP_REQUESTED_REPLY, text: "partial" });
    expect(settleEndedMessage(streaming, { ...ended, stopRequested: true, stopConfirmed: true }).interrupted).toBe(STOPPED_REPLY);
    // The turn's last message carries it even when nothing was still arriving.
    const last = message({ text: "all of it" });
    expect(settleEndedMessage(last, { ...ended, stopRequested: true, stopConfirmed: true, last: true }).interrupted).toBe(STOPPED_REPLY);
    expect(settleEndedMessage(last, { ...ended, stopRequested: true, stopConfirmed: true })).toBe(last);
    // Not on a normal end.
    expect(settleEndedMessage(last, { ...ended, last: true })).toBe(last);
    expect(settleEndedMessage(streaming, ended).interrupted).toBeUndefined();
  });

  it("a reply still arriving becomes done on Stop or a normal end, and an error when the turn failed", () => {
    const streaming = message({ status: "streaming", text: "partial" });
    expect(settleEndedMessage(streaming, ended).status).toBe("done");
    expect(settleEndedMessage(streaming, { ...ended, failed: true }).status).toBe("error");
    expect(settleEndedMessage(streaming, { ...ended, failed: true, stopRequested: true }).status).toBe("done");
    expect(settleEndedMessage(streaming, ended).text).toBe("partial");
  });

  it("a lost turn settles exactly as before: interrupted, nothing answered", () => {
    const lost = settleEndedMessage(message({ status: "streaming", approval: driverCard }), { ...ended, lost: DROPPED, stopRequested: true });
    expect(lost).toEqual(settleMessage(message({ status: "streaming", approval: driverCard }), DROPPED));
    expect(lost.interrupted).toBe(DROPPED);
  });

  it("a loaded workspace is settled only in local mode; runner turns outlive the tab and are the runner's", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(app).toContain("setThreads(runnerMode ? snapshot.threads : settleLoadedThreads(snapshot.threads));");
  });

  it("the page settles every message of a driver turn this way, and only its own Deny reads as denied", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const drive = app.slice(app.indexOf("async function driveTurn("), app.indexOf("if (failure) throw new Error(failure);") + 40);
    // A refusal that finds the card still waiting: Stop, or an expiry or another tab.
    expect(drive).toMatch(/: args\.signal\.aborted\s*\?\s*\{ \.\.\.message, approval: stoppedCard\(message\.approval, false\) \}\s*: \{ \.\.\.message, approval: \{ \.\.\.message\.approval, status: "failed", output: REFUSED_ELSEWHERE \} \}/);
    expect(drive).not.toMatch(/event\.allow \? "approved" : "denied"/);
    expect(drive).toMatch(/if \(event\.type === "done" && event\.stopped === true\) stopConfirmed = true;/);
    expect(drive).toMatch(/created\.forEach\(\(id, index\) => patchMessage\(threadId, id, \(message\) => settleEndedMessage\(message, \{ \.\.\.end, last: index === created\.length - 1 \}\)\)\);/);
    // Messages made after a card are settled too, and a lost or stopped turn is not a success.
    expect(drive).toMatch(/const id = beginAssistant\(threadId, bot\.id\);[\s\S]{0,160}created\.push\(id\);/);
    expect(drive).toMatch(/if \(args\.signal\.aborted\) throw new DOMException\("Stopped\.", "AbortError"\);\s*if \(lost\) throw new Error\(lost\);/);
    // Stop keeps the stream open for STOP_GRACE_MS so done{stopped:true} can arrive.
    expect(drive).toMatch(/await harnessEvents\(turnId, after, stream\.signal,/);
    expect(drive).toMatch(/grace = setTimeout\(\(\) => stream\.abort\(\), STOP_GRACE_MS\);/);
    expect(drive).toMatch(/clearTimeout\(grace\);/);
    // An auto-approved card starts approved, an unattended one denied, anything else waits.
    expect(drive).toMatch(/const status = event\.auto \? "approved" : event\.denied \? "denied" : "pending";/);
    expect(drive).not.toMatch(/status: "denied" as const/);
  });

  it("an interrupted reply shows its label and why", () => {
    const views = readFileSync(new URL("./views.tsx", import.meta.url), "utf8");
    expect(views).toContain('{message.interrupted ? <span className="meta">{t("interrupted")}</span> : null}');
    expect(views).toContain('{message.interrupted ? <p className="hint">{message.interrupted}</p> : null}');
  });
});

describe("gaps and long turns", () => {
  const instant = () => 0;
  it("a gap marker from the harness ends the follow as gap, without passing it on", async () => {
    const seen: string[] = [];
    const result = await followTurn<Event>({
      after: 3,
      signal: new AbortController().signal,
      subscribe: async (_after, onEvent) => {
        if (onEvent({ type: "gap" } as Event) === true) return;
        onEvent({ seq: 9, type: "done" });
      },
      state: async () => "running",
      onEvent: (event) => (seen.push(event.type), event.type === "done"),
      delayMs: instant,
    });
    expect(result).toBe("gap");
    expect(seen).toEqual([]);
  });

  it("a resume that brings new events starts the retry count again", async () => {
    // Four drops, each followed by a good resume, then the end: not "dropped".
    let calls = 0;
    const result = await followTurn<Event>({
      after: 0,
      signal: new AbortController().signal,
      subscribe: async (after, onEvent) => {
        calls += 1;
        if (calls <= 5) {
          onEvent({ seq: after + 1, type: "message_delta" });
          return;
        }
        onEvent({ seq: after + 1, type: "done" });
      },
      state: async () => "running",
      onEvent: (event) => event.type === "done",
      retries: 2,
      delayMs: instant,
    });
    expect(result).toBe("ended");
    expect(calls).toBe(6);
    // With no progress, the same budget runs out.
    const stuck = await followTurn<Event>({ after: 0, signal: new AbortController().signal, subscribe: async () => undefined, state: async () => "running", onEvent: () => false, retries: 2, delayMs: instant });
    expect(stuck).toBe("dropped");
  });
});

describe("harnessEvents results", () => {
  const withFetch = async (events: string, state: string, run: () => Promise<void>) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/events")) {
        const body = new ReadableStream({
          start(controller) {
            if (events) controller.enqueue(new TextEncoder().encode(events));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ state }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  it("a gap from the harness is a lost turn, and so is a harness that stays unreachable", async () => {
    const { harnessEvents, TurnLostError } = await import("./harness");
    await withFetch('data: {"type":"gap","turnId":"t"}\n\n', "running", async () => {
      const following = harnessEvents("0123456789abcdef", 4, new AbortController().signal, () => false);
      await expect(following).rejects.toBeInstanceOf(TurnLostError);
      await expect(following).rejects.toThrow(GAP);
    });
  });

  it("a stream that keeps closing while the harness says running ends as dropped, never quietly", async () => {
    vi.useFakeTimers();
    try {
      const { harnessEvents, TurnLostError } = await import("./harness");
      await withFetch("", "running", async () => {
        const following = harnessEvents("0123456789abcdef", 4, new AbortController().signal, () => false);
        const settled = following.catch((error) => error);
        await vi.runAllTimersAsync();
        const error = await settled;
        expect(error).toBeInstanceOf(TurnLostError);
        expect(String(error.message)).toBe(DROPPED);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("runner mode follows one stream as before, with no state call", () => {
    const harness = readFileSync(new URL("./harness.ts", import.meta.url), "utf8");
    expect(harness).toMatch(/if \(runnerMode\) return streamEvents\(turnId, after, signal, onEvent\);\s*const result = await followTurn/);
  });
});
