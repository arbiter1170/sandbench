// UX P2: the turn status line, Couldn't start and the one-time planner answer. Fixtures follow
// F-P2-a..g in docs/superpowers/specs/2026-11-05-sandbench-ux-design.md; all data is synthetic.
// The state table is pure (src/turnStatus.ts) and rendered by MessageBody (src/views.tsx); the
// App wiring is checked at source level where a behaviour test would need the whole page.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatAgent } from "./chatContext";
import { translate, type Key } from "./i18n";
import { DROPPED, IN_FLIGHT, RELOADED, settleEndedMessage, settleLoadedThreads, settleMessage, STOP_GRACE_MS, STOP_REQUESTED_REPLY, STOPPED_REPLY } from "./turnRecovery";
import {
  askAgainDraft,
  canChoosePlanner,
  claimPlannerAnswer,
  classifyStartError,
  continuedIds,
  decideStart,
  promptFor,
  runningMessageId,
  shortReason,
  START_REFUSALS,
  startFailureFor,
  startFailureSummary,
  startPlannerAnswer,
  turnStatus,
  type TurnStateId,
} from "./turnStatus";
import type { Approval, Message, Thread } from "./types";
import { MessageBody, type TurnControls } from "./views";
import { blankBot } from "./work";

const t = (key: Key) => translate("en", key);
let next = 0;
const msg = (patch: Partial<Message> = {}): Message => ({
  id: `m${(next += 1)}`,
  role: "assistant",
  text: "",
  createdAt: next,
  attachments: [],
  status: "done",
  localStandIn: false,
  fresh: false,
  authorBotId: "north",
  ...patch,
});
const user = (text: string) => msg({ role: "user", text, authorBotId: undefined });
const card = (patch: Partial<Approval> = {}): Approval => ({ command: "npm test", reason: "Claude Code asked to use Bash.", status: "pending", permissionId: "p1", ...patch });
const status = (message: Message, extra: { continued?: boolean; runner?: boolean } = {}) => turnStatus(message, { t, bot: "North", ...extra })!;
const controls = (patch: Partial<TurnControls> = {}): TurnControls => ({
  runner: false,
  busy: false,
  continued: false,
  onCheckConnection: async () => true,
  onAskAgain: () => undefined,
  onPlannerAnswer: () => undefined,
  ...patch,
});
const render = (message: Message, turn: TurnControls | undefined = controls()) => renderToStaticMarkup(createElement(MessageBody, { message, t, youLabel: "You", author: "North", turn }));
const PLANNER_BUTTON = "Answer with the built-in planner this time";
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const body = (name: string) => {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf("\n  }\n", start);
  return app.slice(start, end);
};

// F-P2-a: North chose Claude Code; the harness health check fails.
const north = { ...blankBot("North", "General", true), id: "north", driver: "claude" };
const offlineAgent = chatAgent({ bot: north, route: { provider: "xai", ready: false, model: "grok-3" }, drivers: [], harnessUp: false });
const s9 = () => {
  if (offlineAgent.kind !== "unavailable") throw new Error("fixture");
  return msg({ id: "s9", thinking: ["Claude Code couldn't start, so nothing was sent to it. The built-in planner did not answer."], startFailure: startFailureFor(offlineAgent, { harnessUp: false, runner: false }) });
};

// One message per state, for the table-wide checks.
const everyState = (): [TurnStateId, Message, { continued?: boolean }?][] => [
  ["starting", msg({ status: "streaming", driverTurn: { agent: "Claude Code" } })],
  ["working", msg({ status: "streaming", driverTurn: { agent: "Claude Code", id: "t1" }, thinking: ["Claude wants Bash: npm test."] })],
  ["waiting", msg({ approval: card(), driverTurn: { agent: "Claude Code", id: "t1" } })],
  ["finished", msg({ text: "All tests pass." })],
  ["stopped", msg({ interrupted: STOPPED_REPLY, driverTurn: { agent: "Claude Code", id: "t1" } })],
  ["stopRequested", msg({ interrupted: STOP_REQUESTED_REPLY, driverTurn: { agent: "Claude Code", id: "t1" } })],
  ["failed", msg({ status: "error", failure: "Claude Code exited with 1.", driverTurn: { agent: "Claude Code", id: "t1" } })],
  ["rounds", msg({ roundsExhausted: 4, driverTurn: { agent: "Claude Code", id: "t1" } })],
  ["interrupted", msg({ status: "error", interrupted: DROPPED, text: "partial", driverTurn: { agent: "Claude Code", id: "t1" } })],
  ["couldntStart", s9()],
  ["startUnknown", msg({ status: "error", startUnknown: { agent: "Claude Code", reason: "Failed to fetch" }, driverTurn: { agent: "Claude Code" } })],
  ["stoppedInPage", msg({ stoppedInPage: true, text: "Stopped." })],
  ["stoppedBeforeStart", msg({ stoppedBeforeStart: true, driverTurn: { agent: "Claude Code" } })],
  ["continued", msg({ approval: card({ status: "approved", output: "ok", exitCode: 0 }), driverTurn: { agent: "Claude Code", id: "t1" } }), { continued: true }],
];

describe("the turn state table (UX P2)", () => {
  it("every state has its own word and an icon shape; the line starts with the word", () => {
    const rows = everyState().map(([id, message, extra]) => [id, status(message, extra)] as const);
    for (const [id, line] of rows) {
      expect(line.state, id).toBe(id);
      expect(line.icon, id).toMatch(/^\S$/u);
      if (id !== "continued") expect(line.text.startsWith(line.word), id).toBe(true);
    }
    expect(rows.map(([, line]) => line.text)).toMatchInlineSnapshot(`
      [
        "Starting Claude Code…",
        "Working",
        "Waiting for you · North is paused until you choose.",
        "Finished",
        "Stopped by you. Steps above with a recorded result ran; others have unknown status.",
        "Stop requested · not confirmed. The harness didn't confirm within 5 s that it stopped, so this turn may still be running there. This page no longer follows it. Execution status: unknown.",
        "Failed · Claude Code exited with 1. The agent had started. Steps without a recorded result have unknown status. No retry, no fallback.",
        "Ended after 4 approval rounds without a final answer.",
        "Interrupted · execution status unknown. The connection to the local harness dropped before the turn finished. Sandbench can't confirm what ran after that. Partial text is kept.",
        "Couldn't start · Claude Code isn't available",
        "Start status unknown · Couldn't confirm the start. Claude Code may have started this reply. Nothing will be retried automatically.",
        "Stopped in this page. A command already sent to the harness may still finish there; steps without a recorded result have unknown status.",
        "Stopped before it started. Nothing was sent to Claude Code.",
        "Continued below",
      ]
    `);
    expect(status(everyState()[1][1]).step).toBe("Claude wants Bash: npm test.");
    expect(turnStatus(user("hi"), { t })).toBeNull();
  });

  it("the actions are the table's: Ask again… and Check connection where it says, nothing else", () => {
    const actions = Object.fromEntries(everyState().map(([id, message, extra]) => [id, status(message, extra).actions]));
    expect(actions).toEqual({
      starting: [],
      working: [],
      waiting: [],
      finished: [],
      stopped: ["askAgain"],
      stopRequested: ["checkConnection", "askAgain"],
      failed: ["errorDetails", "askAgain"],
      rounds: ["askAgain"],
      interrupted: ["checkConnection", "askAgain"],
      couldntStart: ["checkConnection", "plannerAnswer"],
      startUnknown: ["checkConnection", "askAgain"],
      stoppedInPage: ["askAgain"],
      stoppedBeforeStart: ["askAgain"],
      continued: [],
    });
  });

  it("P2-AC1: 'Receiving' no longer appears; every assistant message shows its state word", () => {
    expect(Object.values(translate("en", "tsWorking"))).toBeTruthy();
    for (const [id, message, extra] of everyState()) {
      const html = render(message, controls({ continued: Boolean(extra?.continued) }));
      expect(html, id).not.toMatch(/Receiving/);
      expect(html, id).toContain(status(message, extra).text.replace(/'/g, "&#x27;"));
      expect(html, id).toContain('role="status"');
    }
    const views = readFileSync(new URL("./views.tsx", import.meta.url), "utf8");
    expect(views).not.toContain('t("receiving")');
    // Only state changes are announced: the message itself is no longer a live region per token.
    expect(views).not.toMatch(/<article[^>]*aria-live/);
  });

  it("P2-AC3: the planner choice appears only in S9, never in S5a, S5b, S6, S8 or S10", () => {
    for (const [id, message, extra] of everyState()) {
      const html = render(message, controls({ continued: Boolean(extra?.continued) }));
      expect(html.includes(PLANNER_BUTTON), id).toBe(id === "couldntStart");
    }
  });

  it("P2-AC10: failed and interrupted read differently from finished by shape and word, not colour", () => {
    const finished = status(msg({ text: "done" }));
    const failed = status(msg({ status: "error", failure: "boom" }));
    const lost = status(msg({ status: "error", interrupted: RELOADED }));
    const stopped = status(msg({ interrupted: STOP_REQUESTED_REPLY }));
    const shapes = new Set([finished.icon, failed.icon, lost.icon, stopped.icon]);
    const words = new Set([finished.word, failed.word, lost.word, stopped.word]);
    expect(shapes.size).toBe(4);
    expect(words.size).toBe(4);
    // The icon is decorative (aria-hidden); the word is in the live region.
    expect(render(msg({ status: "error", failure: "boom" }))).toMatch(/<span class="turn-icon" aria-hidden="true">✕<\/span><span class="turn-text">Failed · boom\./);
  });

  it("S4 names one approval and who approved it, without claiming more than the card says", () => {
    expect(status(msg({ approval: card({ status: "approved", output: "ok", exitCode: 0 }) })).text).toBe("Finished · 1 approval: npm test (approved by you)");
    expect(status(msg({ approval: card({ status: "approved", auto: true, output: "ok" }) })).text).toBe("Finished · 1 approval: npm test (auto-approved by rule)");
    // A planner card approved by a rule and one approved by a person look alike in the data.
    expect(status(msg({ approval: card({ status: "approved", permissionId: undefined, output: "ok" }) })).text).toBe("Finished · 1 approval: npm test (approved)");
    // Still running its approved step: not finished yet.
    expect(status(msg({ approval: card({ status: "approved", output: IN_FLIGHT }) })).state).toBe("working");
  });

  it("older saved messages, without any of the new fields, still read sensibly", () => {
    expect(status(msg({ text: "Hello" })).text).toBe("Finished");
    expect(status(msg({ status: "error", text: "Harness returned 500." })).text).toBe("Failed. Steps without a recorded result have unknown status. Nothing is retried.");
    expect(status(msg({ status: "streaming" })).state).toBe("working");
  });

  it("a short reason is the first sentence, without its full stop", () => {
    expect(shortReason("Claude Code exited with 1.\nstack…")).toBe("Claude Code exited with 1");
    expect(shortReason("Claude Code ran a command nobody approved (cat notes.txt), so the turn was stopped. More.")).toBe("Claude Code ran a command nobody approved (cat notes.txt), so the turn was stopped");
    expect(shortReason("x".repeat(300))).toHaveLength(140);
    expect(shortReason(undefined)).toBe("");
  });

  it("continuedIds marks the earlier messages of one agent turn, not the last, and not other turns", () => {
    const a = msg({ driverTurn: { agent: "Claude Code", id: "t1" } });
    const b = msg({ driverTurn: { agent: "Claude Code", id: "t1" } });
    const c = msg({ driverTurn: { agent: "Claude Code", id: "t1" } });
    const other = msg({ driverTurn: { agent: "Claude Code", id: "t2" } });
    const planner = msg();
    expect([...continuedIds([user("go"), a, b, c, other, planner])]).toEqual([a.id, b.id]);
  });
});

describe("Couldn't start and the one-time planner answer (S9, S12)", () => {
  it("F-P2-a: harness down → S9 'Couldn't start · Claude Code isn't available', the reason, and no planner text", () => {
    const message = s9();
    expect(message.startFailure).toEqual({ kind: "unreachable", agent: "Claude Code" });
    const html = render(message);
    expect(html).toContain("Couldn&#x27;t start · Claude Code isn&#x27;t available");
    expect(html).toContain("Reason: the local harness isn&#x27;t reachable.");
    expect(html).toContain("Nothing was sent to Claude Code and no tools were requested.");
    expect(html).toContain("Check connection");
    expect(html).toContain(PLANNER_BUTTON);
    expect(html).not.toContain('class="markdown');
    expect(message.text).toBe("");
    // The S9 card is a group labelled by its own status line.
    expect(html).toMatch(/<div class="turn-card tone-bad" role="group" aria-labelledby="turn-s9">/);
  });

  it("F-P2-a and the H1 race: a chosen agent that can't be resolved before the start is Couldn't start, never the planner (P2-AC2, I-2)", async () => {
    expect(app).not.toContain("so the built-in planner answers.");
    const calls: string[] = [];
    const decide = (resolved: (string | undefined)[], extra: { chosen?: boolean; plannerOnce?: boolean; abortAfterRecheck?: boolean } = {}) => {
      let aborted = false;
      let index = 0;
      return decideStart<string>({
        plannerOnce: Boolean(extra.plannerOnce),
        chosen: extra.chosen ?? true,
        resolve: () => resolved[Math.min(index++, resolved.length - 1)],
        recheck: async () => {
          calls.push("recheck");
          if (extra.abortAfterRecheck) aborted = true;
        },
        aborted: () => aborted,
      });
    };
    // Harness down from the start (F-P2-a): read once more, then Couldn't start.
    expect(await decide([undefined, undefined])).toEqual({ kind: "couldntStart" });
    // H1: the agent looked available when the reply began (intended), but the harness dropped
    // during the skill and memory reads; at the decision it resolves to nothing: still S9.
    expect(await decide([undefined, undefined])).toEqual({ kind: "couldntStart" });
    // A stale reading that the re-read fixes: the agent answers.
    expect(await decide([undefined, "claude"])).toEqual({ kind: "driver", driver: "claude" });
    expect(await decide(["claude"])).toEqual({ kind: "driver", driver: "claude" });
    expect(calls).toEqual(["recheck", "recheck", "recheck"]);
    // Only a bot with no agent chosen gets the planner, and only the tap skips the decision.
    expect(await decide([undefined], { chosen: false })).toEqual({ kind: "planner" });
    expect(await decide(["claude"], { plannerOnce: true })).toEqual({ kind: "planner" });
    // The app decides with this, after its reads, from the bot's and Settings' choice.
    const ask = body("askBot");
    expect(ask.indexOf("await decideStart({")).toBeGreaterThan(ask.indexOf("await Promise.all([skillLinesFor(bot), memoryDocFor(botId)])"));
    expect(ask).toMatch(/chosen: Boolean\(bot\.driver \|\| settingsRef\.current\.defaultAgentDriver\),\s*resolve: \(\) => resolveAgentDriver\(bot\),\s*recheck: recheckHarness,/);
    expect(ask.indexOf('if (decision.kind === "couldntStart") {')).toBeLessThan(ask.indexOf("await playTurn({"));
  });

  it("M3: Stop pressed during the S1 re-read (or before it) ends the reply with nothing sent", async () => {
    let aborted = false;
    const resolve = () => undefined;
    let sent = 0;
    const result = await decideStart({ plannerOnce: false, chosen: true, resolve, recheck: async () => void (aborted = true), aborted: () => aborted });
    expect(result).toEqual({ kind: "stopped" });
    expect(await decideStart({ plannerOnce: true, chosen: true, resolve, recheck: async () => void (sent += 1), aborted: () => true })).toEqual({ kind: "stopped" });
    expect(sent).toBe(0);
    const line = status(msg({ stoppedBeforeStart: true, driverTurn: { agent: "Claude Code" } }));
    expect([line.state, line.text, line.actions]).toEqual(["stoppedBeforeStart", "Stopped before it started. Nothing was sent to Claude Code.", ["askAgain"]]);
    expect(status(msg({ stoppedBeforeStart: true })).text).toBe("Stopped before it started. Nothing ran.");
    expect(render(msg({ stoppedBeforeStart: true }))).not.toContain(PLANNER_BUTTON);
  });

  it("an unavailable driver names the harness's detail; a refused start names the harness's refusal", () => {
    const listed = chatAgent({ bot: north, route: { provider: "xai", ready: false, model: "m" }, drivers: [{ id: "claude", label: "Claude Code (local CLI)", ok: false, detail: "Install the Claude Code CLI, sign in, then restart the harness." }], harnessUp: true });
    if (listed.kind !== "unavailable") throw new Error("fixture");
    const unavailable = status(msg({ startFailure: startFailureFor(listed, { harnessUp: true, runner: false }) }));
    expect(unavailable.reason).toBe("Reason: Claude Code isn't available on this computer: Install the Claude Code CLI, sign in, then restart the harness.");
    const refused = status(msg({ startFailure: { kind: "refused", agent: "Claude Code", detail: "The working folder must stay inside the workspace folder." } }));
    expect(refused.text).toBe("Couldn't start · Claude Code didn't start");
    expect(refused.reason).toBe("Reason: the harness refused the start: The working folder must stay inside the workspace folder.");
    // Nothing in the S9 copy claims a sign-in state.
    for (const key of ["tsCouldntStart", "tsCouldntStartLine", "tsReasonUnreachable", "tsReasonUnavailable", "tsNothingSent"] as Key[]) expect(t(key)).not.toMatch(/signed in|not signed/i);
  });

  it("F-P2-a twice quickly, through the app's claim path: one claim, one planner turn, the S9 message links to it (I-3, P2-AC4)", async () => {
    const source = s9();
    let ref: Thread[] = [{ id: "chat", title: "x", updatedAt: 1, botId: "north", messages: [user("List the files"), source] }];
    const asks: unknown[] = [];
    const writes: unknown[] = [];
    let ids = 0;
    const tap = () =>
      startPlannerAnswer({
        messageId: "s9",
        runner: false,
        busy: () => false,
        onBusy: () => writes.push("busy"),
        threads: () => ref,
        write: (claimed, claim) => {
          // Before the turn is asked for (asks is still empty here on the first tap).
          writes.push({ asksSoFar: asks.length, ...claim });
          ref = claimed;
        },
        newId: () => `reply-${(ids += 1)}`,
        now: () => 1_700_000_000_000,
        // The turn isn't running yet when the second tap lands: only the claim stops it.
        ask: async (request) => void asks.push(request),
        refuse: () => undefined,
      });
    expect(tap()).toBe(true);
    expect(tap()).toBe(false);
    expect(asks).toEqual([{ threadId: "chat", sourceId: "s9", replyId: "reply-1", botId: "north", prompt: "List the files", agent: "Claude Code" }]);
    expect(writes).toEqual([{ asksSoFar: 0, threadId: "chat", sourceId: "s9", replyId: "reply-1", at: 1_700_000_000_000 }]);
    const claimed = ref[0].messages[1];
    expect(claimed.plannerAnswer).toEqual({ messageId: "reply-1", at: 1_700_000_000_000 });
    expect(canChoosePlanner(claimed, { runner: false, busy: false })).toBe(false);
    // The claim changes that one field and nothing else (I-6: nothing carried, no approvals).
    const { plannerAnswer: _claim, ...rest } = claimed;
    expect(rest).toEqual(source);
    const html = render(claimed);
    expect(html).not.toContain(PLANNER_BUTTON);
    expect(html).toMatch(/<a href="#msg-reply-1">Planner answer chosen at [^<]+ ↓<\/a>/);
    // The app uses this path, writes the ref and saves at once, and changes no bot or Settings (P2-AC5).
    const handler = body("answerWithPlanner");
    expect(handler).toContain("startPlannerAnswer({");
    expect(handler).toContain("threadsRef.current = claimed;");
    expect(handler).toContain("void saveSnapshot({ ...workspaceRef.current, threads: claimed })");
    expect(handler).not.toMatch(/setBots|patchBot|setSettings|patchSettings|defaultAgentDriver/);
  });

  it("I-1, I-3, W-3, M4: no claim while a turn runs, in runner mode, for a scheduled run, or when a reply already answered for it", () => {
    const thread = (messages: Message[]): Thread[] => [{ id: "chat", title: "x", updatedAt: 1, messages }];
    const attempt = (threads: Thread[], extra: { runner?: boolean; busy?: boolean } = {}) => {
      const asked: unknown[] = [];
      let busyNoted = 0;
      const started = startPlannerAnswer({
        messageId: "s9",
        runner: Boolean(extra.runner),
        busy: () => Boolean(extra.busy),
        onBusy: () => (busyNoted += 1),
        threads: () => threads,
        write: () => asked.push("write"),
        newId: () => "r",
        now: () => 1,
        ask: async (request) => void asked.push(request),
        refuse: () => undefined,
      });
      return { started, asked, busyNoted };
    };
    expect(attempt(thread([user("hi"), s9()]), { busy: true })).toEqual({ started: false, asked: [], busyNoted: 1 });
    expect(attempt(thread([user("hi"), s9()]), { runner: true }).asked).toEqual([]);
    expect(attempt(thread([user("hi"), { ...s9(), startFailure: { kind: "unreachable", agent: "Claude Code", unattended: true } }])).asked).toEqual([]);
    // A claim that never reached storage, but whose reply did: the reply blocks a second one.
    const answered = msg({ answeredBy: { kind: "planner-once", agent: "Claude Code", sourceId: "s9" } });
    expect(attempt(thread([user("hi"), s9(), answered])).asked).toEqual([]);
    expect(claimPlannerAnswer(thread([user("hi"), s9(), answered]), "chat", "s9", { messageId: "x", at: 1 })).toBeNull();
    // With no text to answer, the claim stays and says why; nothing is asked for or retried.
    const refused: unknown[] = [];
    startPlannerAnswer({ messageId: "s9", runner: false, busy: () => false, onBusy: () => undefined, threads: () => thread([s9()]), write: () => undefined, newId: () => "r", now: () => 1, ask: async () => refused.push("ask"), refuse: (request) => refused.push(request.reason) });
    expect(refused).toEqual(["noPrompt"]);
  });

  it("M4: a scheduled or webhook run that couldn't start says so, offers no planner, and records why", () => {
    const failure = { kind: "unreachable" as const, agent: "Claude Code", unattended: true };
    const html = render(msg({ startFailure: failure }));
    expect(html).not.toContain(PLANNER_BUTTON);
    expect(html).toContain("This was a scheduled or webhook run, so nothing ran.");
    expect(startFailureSummary(failure, t)).toBe("Couldn't start · the local harness isn't reachable");
    const ask = body("askBot");
    expect(ask).toMatch(/\.\.\.\(options\.unattended \? \{ unattended: true \} : \{\}\),/);
    expect(ask).toMatch(/receiptDone\(options\.receipt, botId, started, "failed", summary\);\s*if \(options\.routineId\) setRoutines/);
    const server = readFileSync(new URL("../harness/server.mjs", import.meta.url), "utf8");
    expect(server).toContain('{ detail: cleanText(body.detail, 240) }');
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain("{routine.lastNote ? ` · ${routine.lastNote}` : \"\"}");
    expect(shell).toContain("{run.detail ? ` · ${run.detail}` : \"\"}");
  });

  it("the planner turn uses the bot's normal rules and the Settings auto-review list, nothing from the failed start (P2-AC6, I-6)", () => {
    const ask = body("askBot");
    // The one planner path: the same planTurn and makeApproval every planner reply uses.
    expect(ask).toMatch(/autoRun: \(command\) => autoApproved\(command, currentStudio\.autoApprove\),/);
    expect(ask).toMatch(/makeApproval\(chosen, Boolean\(options\.unattended\), bot\)/);
    expect(ask).not.toMatch(/plannerOnce\.[a-zA-Z]*[Aa]pprov/);
    // The request carries the prompt, the thread and the claim only.
    const handler = body("answerWithPlanner");
    expect(handler).toMatch(/askBot\(request\.botId, request\.prompt, \{\s*threadId: request\.threadId,\s*skipUser: true,\s*plannerOnce: \{ replyId: request\.replyId, sourceId: request\.sourceId, agent: request\.agent \},\s*\}\)/);
  });

  it("F-P2-b: after a reload the S9 message still shows 'Planner answer chosen' and offers nothing", () => {
    const thread: Thread = {
      id: "chat",
      title: "x",
      updatedAt: 1,
      botId: "north",
      messages: [user("List the files"), { ...s9(), plannerAnswer: { messageId: "reply-1", at: 1_700_000_000_000 } }, msg({ id: "reply-1", status: "streaming", text: "Here", answeredBy: { kind: "planner-once", agent: "Claude Code", sourceId: "s9" } })],
    };
    const [loaded] = settleLoadedThreads(JSON.parse(JSON.stringify([thread])) as Thread[]);
    const source = loaded.messages[1];
    expect(source.plannerAnswer).toEqual({ messageId: "reply-1", at: 1_700_000_000_000 });
    expect(canChoosePlanner(source, { runner: false, busy: false })).toBe(false);
    expect(render(source)).toContain("Planner answer chosen at");
    expect(render(source)).not.toContain(PLANNER_BUTTON);
    // The planner reply that was cut off by the reload is interrupted, labelled one-time, no planner choice.
    const reply = loaded.messages[2];
    expect(status(reply).state).toBe("interrupted");
    expect(render(reply)).toContain("Built-in planner · one time");
    expect(render(reply)).not.toContain(PLANNER_BUTTON);
  });

  it("F-P2-b: the one-time reply says the next message uses the chosen agent again; the next send tries it first (P2-AC5)", () => {
    const reply = msg({ text: "Here is the plan.", answeredBy: { kind: "planner-once", agent: "Claude Code", sourceId: "s9" } });
    expect(status(reply).text).toBe("Finished · You chose this for one reply. Next message uses Claude Code again.");
    // Nothing about the agent is stored by the choice: with the harness still down, a new send
    // derives the same unavailable agent, so a new S9 appears and the planner does not answer.
    expect(chatAgent({ bot: north, route: { provider: "xai", ready: false, model: "m" }, drivers: [], harnessUp: false }).kind).toBe("unavailable");
    expect(north.driver).toBe("claude");
  });

  it("W-3: in runner mode the planner choice is withheld entirely", () => {
    if (offlineAgent.kind !== "unavailable") throw new Error("fixture");
    const runnerS9 = msg({ startFailure: startFailureFor(offlineAgent, { harnessUp: false, runner: true }) });
    expect(status(runnerS9).reason).toBe("Reason: the runner isn't reachable.");
    expect(status(runnerS9).actions).toEqual(["checkConnection"]);
    expect(canChoosePlanner(runnerS9, { runner: true, busy: false })).toBe(false);
    const html = render(runnerS9, controls({ runner: true }));
    expect(html).not.toContain(PLANNER_BUTTON);
    expect(html).toContain("isn&#x27;t offered with the runner yet");
    // And a local S9 viewed while the page runs against a runner.
    expect(render(s9(), controls({ runner: true }))).not.toContain(PLANNER_BUTTON);
  });

  it("I-1: while any turn runs, the planner choice is disabled and says when it will be available", () => {
    const html = render(s9(), controls({ busy: true }));
    expect(html).toMatch(/<button type="button" class="turn-planner" disabled="">Answer with the built-in planner this time<\/button>/);
    expect(html).toContain("Available once the current reply ends.");
    expect(canChoosePlanner(s9(), { runner: false, busy: true })).toBe(false);
    expect(canChoosePlanner(s9(), { runner: false, busy: false })).toBe(true);
  });
});

describe("start failures: proof that no turn exists (I-4)", () => {
  it("only the harness's three pre-start refusals are S9; a network TypeError and any other error are S10", () => {
    expect(START_REFUSALS).toEqual(["Unknown driver.", "No prompt.", "The working folder must stay inside the workspace folder."]);
    const harness = readFileSync(new URL("../harness/turns.mjs", import.meta.url), "utf8");
    for (const refusal of START_REFUSALS) expect(harness).toContain(`throw new Error(${JSON.stringify(refusal)})`);
    for (const refusal of START_REFUSALS) expect(classifyStartError(new Error(refusal)).kind).toBe("refused");
    // F-P2-e
    expect(classifyStartError(new TypeError("Failed to fetch")).kind).toBe("unknown");
    expect(classifyStartError(new TypeError("Unknown driver.")).kind).toBe("unknown");
    expect(classifyStartError(new Error("Harness returned 502.")).kind).toBe("unknown");
    expect(classifyStartError(new Error("Claude Code is not installed on this computer.")).kind).toBe("unknown");
    expect(classifyStartError("odd").kind).toBe("unknown");
  });

  it("F-P2-e: S10 shows Check connection and Ask again…, never the planner", () => {
    const html = render(msg({ status: "error", startUnknown: { agent: "Claude Code", reason: "Failed to fetch" }, driverTurn: { agent: "Claude Code" } }));
    expect(html).toContain("Couldn&#x27;t confirm the start. Claude Code may have started this reply.");
    expect(html).toContain("Check connection");
    expect(html).toContain("Ask again…");
    expect(html).toContain("Earlier steps may already have run, so check before you send.");
    expect(html).not.toContain(PLANNER_BUTTON);
    // Nothing on S10 says nothing was sent.
    expect(html).not.toContain("Nothing was sent");
  });

  it("the app classifies only the POST /turns failure, and writes S9 or S10 from it without a retry", () => {
    const drive = body("driveTurn");
    expect(app.match(/classifyStartError\(/g)).toHaveLength(1);
    expect(drive).toMatch(/await harnessStartTurn\(\{[\s\S]*?\}\)\.catch\(\(error: unknown\) => \{\s*throw classifyStartError\(error\);\s*\}\);/);
    const ask = body("askBot");
    const branch = ask.slice(ask.indexOf("if (error instanceof TurnStartError) {"), ask.indexOf("const aborted = error instanceof DOMException"));
    expect(branch).toMatch(/const startFailure = \{ kind: "refused" as const, agent: startingAgent, detail: error\.reason,/);
    expect(branch).toMatch(/error\.kind === "refused"\s*\? \{ \.\.\.message, status: "done", startFailure \}/);
    expect(branch).toMatch(/: \{ \.\.\.message, status: "error", startUnknown: \{ agent: startingAgent, reason: error\.reason \} \}/);
    expect(branch).not.toMatch(/askBot|driveTurn|harnessStartTurn|playTurn|setBanner/);
    // S1 → S2 once the id is back (I-5: from here on the turn counts as started).
    expect(drive).toMatch(/patchMessage\(threadId, args\.assistantId, \(message\) => \(\{ \.\.\.message, driverTurn: \{ agent: args\.agentName, id: turnId \} \}\)\);/);
  });
});

describe("after a start: no planner, no retry (I-5)", () => {
  it("F-P2-c: an error after one approved Bash card with a real result → S6 on the last message, card message continues", () => {
    const end = { stopRequested: false, stopConfirmed: false, failed: true };
    const first = settleEndedMessage(msg({ text: "I'll run the tests.", approval: card({ status: "approved", output: "3 passed", exitCode: 0 }), driverTurn: { agent: "Claude Code", id: "t1" } }), { ...end, last: false });
    const last = { ...settleEndedMessage(msg({ status: "streaming", text: "Now the lint", driverTurn: { agent: "Claude Code", id: "t1" } }), { ...end, last: true }), failure: "Claude Code exited with 1.\nfull log" };
    const ids = continuedIds([user("test it"), first, last]);
    expect(status(first, { continued: ids.has(first.id) }).state).toBe("continued");
    const failed = status(last, { continued: ids.has(last.id) });
    expect(failed.state).toBe("failed");
    expect(failed.text).toMatch(/^Failed · Claude Code exited with 1\. The agent had started\./);
    const html = render(last);
    expect(html).toContain("Show error details");
    expect(html).toContain("full log");
    expect(html).not.toContain(PLANNER_BUTTON);
  });

  it("F-P2-d: a lost stream with partial text and a waiting driver card → S8, partial text kept, Check connection and Ask again…", () => {
    const lost = settleMessage(msg({ status: "streaming", text: "Half of the answ", approval: card(), driverTurn: { agent: "Claude Code", id: "t1" } }), DROPPED);
    const line = status(lost);
    expect(line.state).toBe("interrupted");
    expect(line.actions).toEqual(["checkConnection", "askAgain"]);
    const html = render(lost);
    expect(html).toContain("Half of the answ");
    expect(html).toContain("Interrupted · execution status unknown.");
    expect(html).not.toContain(PLANNER_BUTTON);
  });

  it("F-P2-g: Stop with the interrupt refused and no done{stopped:true} within the grace → S5b for good; done{stopped:true} inside it → S5a (P2-AC11)", () => {
    // #31 closes the stream STOP_GRACE_MS after Stop, so a confirmation can only arrive inside it;
    // the S5b copy says how long the page waited and that it no longer follows the turn.
    expect(STOP_GRACE_MS).toBe(5000);
    expect(status(msg({ interrupted: STOP_REQUESTED_REPLY })).text).toContain("didn't confirm within 5 s that it stopped");
    expect(status(msg({ interrupted: STOP_REQUESTED_REPLY })).text).toContain("This page no longer follows it.");
    const streaming = msg({ status: "streaming", text: "Building…", driverTurn: { agent: "Claude Code", id: "t1" } });
    const unconfirmed = settleEndedMessage(streaming, { stopRequested: true, stopConfirmed: false, failed: false, last: true });
    expect(status(unconfirmed).state).toBe("stopRequested");
    expect(render(unconfirmed)).toContain("Stop requested · not confirmed.");
    expect(render(unconfirmed)).not.toContain("Stopped by you");
    expect(render(unconfirmed)).not.toContain(PLANNER_BUTTON);
    const confirmed = settleEndedMessage(streaming, { stopRequested: true, stopConfirmed: true, failed: false, last: true });
    expect(status(confirmed).state).toBe("stopped");
    expect(render(confirmed)).toContain("Stopped by you.");
    // "Stopped by you" is only ever the confirmed state's copy.
    for (const [id, message, extra] of everyState()) {
      if (id === "stopped") continue;
      expect(status(message, extra).text, id).not.toContain("Stopped by you");
    }
  });

  it("the turn's last message keeps the full error or the rounds signal, and a Stop during the start is still sent", () => {
    const drive = body("driveTurn");
    expect(drive).toMatch(/if \(event\.type === "thinking" && typeof event\.roundsExhausted === "number"\) rounds = event\.roundsExhausted;/);
    expect(drive).toMatch(/if \(!lost && !end\.stopRequested && \(failure \|\| rounds\)\) \{\s*patchMessage\(threadId, created\[created\.length - 1\]/);
    expect(drive).toMatch(/if \(args\.signal\.aborted\) stop\(\);\s*else args\.signal\.addEventListener\("abort", stop, \{ once: true \}\);/);
  });
});

describe("a reply of the turn that is still running (M1)", () => {
  it("the newest reply of the running turn reads Working, even with a real result on its card", () => {
    const card = msg({ driverTurn: { agent: "Claude Code", id: "t1" }, approval: { command: "ls", reason: "r", status: "approved", permissionId: "p1", output: "a\nb", exitCode: 0 } });
    expect(status(card).text).toBe("Finished · 1 approval: ls (approved by you)");
    const running = turnStatus(card, { t, bot: "North", running: true })!;
    expect([running.state, running.text]).toEqual(["working", "Working"]);
    expect(render(card, controls({ running: true }))).not.toContain("Finished");
    // Running doesn't hide an ending the page already knows, or the S9 card.
    expect(turnStatus(msg({ status: "error", failure: "boom" }), { t, running: true })!.state).toBe("failed");
    expect(turnStatus(s9(), { t, running: true })!.state).toBe("couldntStart");
    expect(turnStatus(msg({ approval: card.approval && { ...card.approval, status: "pending" } }), { t, running: true })!.state).toBe("waiting");
  });

  it("runningMessageId is the working bot's newest reply in this chat; the shell passes it only for the turn's own chat", () => {
    const older = msg({ authorBotId: "north" });
    const other = msg({ authorBotId: "pip" });
    const newest = msg({ authorBotId: "north" });
    expect(runningMessageId([user("a"), older, other, newest, user("b")], "north")).toBe(newest.id);
    expect(runningMessageId([older], null)).toBeUndefined();
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain("const running = props.workingThreadId && props.workingThreadId === props.openThreadId ? runningMessageId(messages, workingBotId) : undefined;");
    expect(app).toMatch(/const assistantId = options\.plannerOnce\?\.replyId \?\? crypto\.randomUUID\(\);\s*setWorkingThreadId\(threadId\);/);
  });
});

describe("Check connection, Ask again… and the busy note", () => {
  it("P2-AC7: Check connection is the context line's recheck, which reads only /health and /drivers", () => {
    const recheck = app.slice(app.indexOf("const recheckHarness = useCallback("), app.indexOf("}, [checkHealth]);", app.indexOf("const recheckHarness = useCallback(")));
    const calls = [...recheck.matchAll(/\b(harness[A-Z]\w*|fetch|runnerFetch|askBot|driveTurn)\(/g)].map((match) => match[1]);
    expect(calls).toEqual(["harnessDrivers"]);
    expect(recheck).toContain("await checkHealth()");
    const check = app.slice(app.indexOf("const checkHealth = useCallback("), app.indexOf("}, []);", app.indexOf("const checkHealth = useCallback(")));
    expect([...check.matchAll(/\b(harness[A-Z]\w*|fetch)\(/g)].map((match) => match[1])).toEqual(["harnessHealth"]);
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain("onCheckConnection: props.onRecheckHarness,");
    expect(app).toContain("onRecheckHarness={recheckHarness}");
    // Its result is a polite announcement next to the button; focus is not moved.
    const html = render(s9());
    expect(html).toMatch(/<span class="turn-result" role="status" aria-live="polite"><\/span>/);
    const views = readFileSync(new URL("./views.tsx", import.meta.url), "utf8");
    const view = views.slice(views.indexOf("function CheckConnection("), views.indexOf("function TurnStatusView("));
    expect(view).not.toMatch(/\.focus\(/);
  });

  it("P2-AC8: Ask again… fills the composer with the original message and focuses it; it never sends", () => {
    const handler = body("askAgain");
    expect(handler).toMatch(/const next = askAgainDraft\(draftRef\.current, promptFor\(thread\.messages, messageId\)\);/);
    expect(handler).toContain("focusComposer();");
    // L2: an empty composer (or one holding the same text) gets the original message; a draft
    // being typed is kept, and the note says how to bring the message back.
    expect(askAgainDraft("", "List the files")).toEqual({ draft: "List the files", kept: false });
    expect(askAgainDraft("  ", "List the files")).toEqual({ draft: "List the files", kept: false });
    expect(askAgainDraft("List the files", "List the files")).toEqual({ draft: "List the files", kept: false });
    expect(askAgainDraft("half a new quest", "List the files")).toEqual({ draft: "half a new quest", kept: true });
    expect(t("tsAskAgainKept")).toMatch(/^Your draft is kept\./);
    expect(handler).not.toMatch(/askBot|sendToChannel|harness[A-Z]\w*\(|driveTurn|fetch\(/);
    const messages = [user("first"), msg({ id: "a1" }), user("List the files"), msg({ id: "a2" }), msg({ id: "a3" })];
    expect(promptFor(messages, "a2")).toBe("List the files");
    expect(promptFor(messages, "a3")).toBe("List the files");
    expect(promptFor(messages, "a1")).toBe("first");
    expect(promptFor([msg({ id: "lonely" })], "lonely")).toBe("");
  });

  it("F-P2-f: a send during a turn makes no request, keeps the draft, and shows a polite busy note (P2-AC9, I-1)", () => {
    const ask = body("askBot");
    const guard = ask.slice(0, ask.indexOf("sendingRef.current = true;"));
    expect(guard).toMatch(/if \(sendingRef\.current\) \{\s*if \(!options\.unattended && !options\.skipUser\) noteBusy\(\);\s*return \[\];\s*\}/);
    // The guard comes before the draft is cleared and before anything is saved or sent.
    expect(ask.indexOf("noteBusy()")).toBeLessThan(ask.indexOf('setDraft("")'));
    expect(guard).not.toMatch(/saveBlob|harness[A-Z]\w*\(|driveTurn|playTurn|setDraft/);
    const channel = body("sendToChannel");
    expect(channel).toMatch(/if \(sendingRef\.current\) \{\s*noteBusy\(\);\s*return;\s*\}/);
    // The note is cleared when the turn ends.
    expect(ask).toMatch(/finally \{\s*sendingRef\.current = false;\s*workingRef\.current = null;\s*setWorkingBotId\(null\);\s*setWorkingThreadId\(null\);\s*setComposerNote\(\(note\) => \(note\?\.kind === "busy" \? null : note\)\);/);
    expect(t("tsBusy").replace("{bot}", "North")).toBe("North is still replying. Your message is kept; send it when this turn ends.");
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain('<p className="busy-note" role="status" aria-live="polite">{props.busyNote}</p>');
  });
});
