// UX P1: the chat's context line and its read-only "How this chat runs" sheet. Fixtures follow
// F-P1-a..d in docs/superpowers/specs/2026-11-05-sandbench-ux-design.md (#26); all data is synthetic.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatAgent, contextLine, effectiveDriver, lastFolder, lastModel, sheetRows, type Connection } from "./chatContext";
import { ChatContext, contextSections } from "./chatContextView";
import type { AgentDriver } from "./harness";
import { translate, type Key } from "./i18n";
import type { Bot, Message, Thread } from "./types";
import { blankBot } from "./work";

const t = (key: Key) => translate("en", key);
const NOW = 1_800_000_000_000;
const bot = (name: string, patch: Partial<Bot> = {}): Bot => ({ ...blankBot(name, "Helper", true), id: name.toLowerCase(), createdAt: 1, ...patch });
const claudeOk: AgentDriver = { id: "claude", label: "Claude Code (local CLI)", ok: true, detail: "" };
const codexMissing: AgentDriver = { id: "codex", label: "Codex (local CLI)", ok: false, detail: "codex not found" };
const noKey = { provider: "xai", ready: false, model: "grok-3" };
const connected: Connection = { state: "connected", runner: false, now: NOW, checkedAt: NOW - 4000, lastOkAt: NOW - 4000, platform: "win32", workspace: "C:\\Users\\<you>\\.sandbench\\workspace" };
const offline: Connection = { state: "offline", runner: false, now: NOW, checkedAt: NOW - 2000, lastOkAt: NOW - 95_000 };
const agentOf = (member: Bot, drivers: AgentDriver[], harnessUp: boolean, defaultDriver?: string) => chatAgent({ bot: member, defaultDriver, route: noKey, drivers, harnessUp });
const row = (rows: ReturnType<typeof sheetRows>, id: string) => rows.find((item) => item.id === id)!;

describe("chat context line and sheet (UX P1)", () => {
  it("F-P1-a: a bot with no driver uses the Settings default Claude Code, in the workspace root", () => {
    const north = bot("North");
    const agent = agentOf(north, [claudeOk], true, "claude");
    expect(agent).toEqual({ kind: "driver", id: "claude", name: "Claude Code", source: "settings" });
    const line = contextLine({ members: [{ name: "North", agent }], connection: connected, t });
    expect([line.agent, line.folder, line.connection].join(" · ")).toBe("Claude Code · workspace root · Connected");
    const rows = sheetRows({ bot: north, agent, route: noKey, connection: connected, messages: [], t });
    expect(row(rows, "agent").badge).toBe("From Settings default");
    expect(row(rows, "agent").value).toMatch(/runs through the CLI's own sign-in · Sandbench stores no key for it/);
    expect(row(rows, "runsOn").value).toBe("Local harness on this computer (win32) · Connected · checked 4 s ago");
    // grok-3 (the Settings model) is not a Claude model, so the CLI picks its own.
    expect(row(rows, "model").value).toBe("Claude Code picks its own model · known after a reply");
    const sent = sheetRows({ bot: north, agent, route: { provider: "anthropic", ready: true, model: "claude-opus-5" }, connection: connected, messages: [], t });
    expect(row(sent, "model").value).toBe("claude-opus-5 · sent to Claude Code");
    expect(row(rows, "folder").value).toBe("Workspace root (configured): C:\\Users\\<you>\\.sandbench\\workspace");
  });

  it("F-P1-b: with the harness offline the line says so and harness rows are unknown, not the last good values", () => {
    const north = bot("North");
    const agent = agentOf(north, [], false, "claude");
    expect(agent).toMatchObject({ kind: "unavailable", id: "claude", name: "Claude Code", source: "settings", detail: "" });
    const line = contextLine({ members: [{ name: "North", agent }], connection: offline, t });
    expect(line.connection).toBe("Local harness not reachable");
    expect(line.folder).toBe("");
    expect(line.tone).toBe("bad");
    const rows = sheetRows({ bot: north, agent, route: noKey, connection: offline, messages: [], t });
    expect(row(rows, "model").value).toBe("Unknown: harness offline");
    expect(row(rows, "connectors").value).toBe("Unknown: harness offline");
    expect(row(rows, "memory").value).toBe("Unknown: harness offline");
    expect(row(rows, "folder").value).toBe("Workspace root (configured): Unknown: harness offline");
    // I-9: the last good check shows only with its age.
    expect(row(rows, "runsOn").value).toBe("Unknown: harness offline · last connected 2 min ago");
    expect(row(rows, "agent").value).toMatch(/needs the local harness, which is not reachable\. Until it is, the built-in planner answers/);
    expect(JSON.stringify(rows)).not.toContain("win32");
  });

  it("F-P1-c: a chosen driver that is not installed is named, with the harness's own detail", () => {
    const north = bot("North", { driver: "codex" });
    const agent = agentOf(north, [claudeOk, codexMissing], true, "claude");
    expect(agent).toEqual({ kind: "unavailable", id: "codex", name: "Codex", source: "bot", detail: "codex not found" });
    const line = contextLine({ members: [{ name: "North", agent }], connection: connected, t });
    expect([line.agent, line.folder, line.connection].join(" · ")).toBe("Codex (not available) · workspace root · Connected");
    expect(line.tone).toBe("bad");
    const rows = sheetRows({ bot: north, agent, route: noKey, connection: connected, messages: [], t });
    expect(row(rows, "agent").value).toBe("Codex is not available on the harness: codex not found. Until it is, the built-in planner answers this chat.");
    expect(row(rows, "agent").badge).toBe("Chosen for this bot");
    // The planner answers, so the Model row is the planner's, not "chosen by Codex".
    expect(row(rows, "model").value).toBe("No model key: replies are local stand-ins");
    // Before anyone checked, a chosen driver is not called unavailable.
    const checking: Connection = { state: "checking", runner: false, now: NOW };
    const early = contextLine({ members: [{ name: "North", agent }], connection: checking, t });
    expect([early.agent, early.connection, early.tone]).toEqual(["Codex", "Checking…", "wait"]);
    expect(row(sheetRows({ bot: north, agent, route: noKey, connection: checking, messages: [], t }), "agent").value).toBe("Codex · Checking…");
  });

  it("runner mode has its own words, and its turns get no connectors", () => {
    const north = bot("North", { connectorIds: ["c-a"] });
    const claude = { kind: "driver" as const, id: "claude", name: "Claude Code", source: "bot" as const };
    const up: Connection = { state: "connected", runner: true, now: NOW, checkedAt: NOW - 1000, lastOkAt: NOW - 1000 };
    const down: Connection = { state: "offline", runner: true, now: NOW, checkedAt: NOW - 1000, lastOkAt: NOW - 60_000 };
    const rowsUp = sheetRows({ bot: north, agent: claude, route: noKey, connection: up, messages: [], t });
    expect(row(rowsUp, "runsOn").value).toBe("Runner · reachable");
    expect(row(rowsUp, "connectors").value).toBe("Not passed to runner turns.");
    expect(row(rowsUp, "memory").value).toBe("Runner memory is not covered here.");
    expect(row(rowsUp, "closed").value).toMatch(/^A started runner turn keeps going without this page/);
    const rowsDown = sheetRows({ bot: north, agent: { kind: "unavailable", id: "claude", name: "Claude Code", source: "bot", detail: "" }, route: noKey, connection: down, messages: [], t });
    expect(row(rowsDown, "runsOn").value).toBe("Runner · not reachable");
    expect(row(rowsDown, "agent").value).toMatch(/^Claude Code needs the runner, which is not reachable/);
    expect(row(rowsDown, "connectors").value).toBe("Unknown: runner not reachable");
    expect(JSON.stringify(rowsDown)).not.toMatch(/local harness/i);
  });

  it("F-P1-d: a group chat names each agent with its members, and has a short form for narrow screens", () => {
    const members = [bot("Pip", { driver: "claude" }), bot("Moss", { driver: "claude" }), bot("Fern")];
    const channel = { id: "c1", title: "walklings-team", updatedAt: 1, messages: [], memberIds: members.map((item) => item.id), workingFolder: "walklings-team" } as unknown as Thread;
    const line = contextLine({ members: members.map((member) => ({ name: member.name, agent: agentOf(member, [claudeOk], true) })), channel, connection: connected, t });
    expect(`${line.agent} · ${line.folderPrefix}${line.folder} · ${line.connection}`).toBe("Claude Code (Pip, Moss) · Built-in planner (Fern) · folder walklings-team · Connected");
    expect(`${line.short} · ${line.folder} · ${line.connection}`).toBe("Mixed agents · walklings-team · Connected");
    // One agent for every member: no member list, no "Mixed".
    const same = contextLine({ members: members.slice(0, 2).map((member) => ({ name: member.name, agent: agentOf(member, [claudeOk], true) })), channel, connection: connected, t });
    expect([same.agent, same.short, same.folderPrefix]).toEqual(["Claude Code", "Claude Code", ""]);
  });

  it("P1-AC1: every mode has an agent and a connection word, and the tone never stands alone", () => {
    const north = bot("North");
    const states: Connection[] = [connected, offline, { state: "checking", runner: false, now: NOW }, { state: "connected", runner: true, now: NOW, checkedAt: NOW }, { state: "offline", runner: true, now: NOW, checkedAt: NOW }];
    const words = states.map((connection) => contextLine({ members: [{ name: "North", agent: agentOf(north, [], connection.state === "connected") }], connection, t }));
    expect(words.map((line) => line.connection)).toEqual(["Connected", "Local harness not reachable", "Checking…", "Runner reachable", "Runner not reachable"]);
    for (const line of words) expect(line.agent).toBeTruthy();
    expect(words[2].tone).toBe("wait");
    // The dot is a different shape per tone, next to the words.
    const markup = ({ checkedAt, lastOkAt, now: _now, ...connection }: Connection) =>
      renderToStaticMarkup(createElement(ChatContext, { t, members: [{ name: "North", agent: { kind: "planner" }, sheet: { bot: north, route: noKey, messages: [] } }], connection: { ...connection, log: { checkedAt, lastOkAt } }, onRecheck: async () => true }));
    expect(markup(connected)).toContain(">●<");
    expect(markup(offline)).toContain(">▲<");
    expect(markup({ state: "checking", runner: false, now: NOW })).toContain(">○<");
    expect(markup(offline)).toContain("Local harness not reachable");
  });

  it("P1-AC2: resolveAgentDriver is this same function, and it keeps the old order of choices", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/function resolveAgentDriver\(bot: Bot\): AgentDriver \| undefined \{\s*const settings = settingsRef\.current;\s*return effectiveDriver\(\{/);
    const anthropic: AgentDriver = { id: "anthropic", label: "Anthropic (API)", ok: true, detail: "" };
    const http: AgentDriver = { id: "http", label: "OpenAI-compatible tools", ok: true, detail: "" };
    const pick = (patch: Partial<Bot>, route = noKey, defaultDriver?: string, drivers = [claudeOk, codexMissing, anthropic, http], harnessUp = true) =>
      effectiveDriver({ bot: bot("B", patch), defaultDriver, route, drivers, harnessUp })?.id;
    expect(pick({ driver: "claude" })).toBe("claude");
    expect(pick({ driver: "codex" }, noKey, "claude")).toBeUndefined(); // a chosen driver never falls back
    expect(pick({}, noKey, "claude")).toBe("claude");
    expect(pick({}, { provider: "anthropic", ready: true, model: "m" }, "codex")).toBe("anthropic"); // default not ok: provider rule
    expect(pick({ skills: [] }, { provider: "openai_compat", ready: true, model: "m" })).toBeUndefined();
    expect(pick({ skills: ["computer"] }, { provider: "openai_compat", ready: true, model: "m" })).toBe("http");
    expect(pick({ driver: "claude" }, noKey, undefined, [claudeOk], false)).toBeUndefined(); // no harness, no driver
    // The line's agent is the same driver whenever one answers.
    const agent = chatAgent({ bot: bot("B"), defaultDriver: undefined, route: { provider: "anthropic", ready: true, model: "m" }, drivers: [anthropic], harnessUp: true });
    expect(agent).toEqual({ kind: "driver", id: "anthropic", name: "Anthropic (API)", source: "provider" });
  });

  it("a group chat's configured folder is the channel's; a bot chat's is the workspace root", () => {
    const channel = { id: "c1", title: "t", updatedAt: 1, messages: [], memberIds: ["pip"], workingFolder: "walklings-team" } as unknown as Thread;
    const rows = sheetRows({ bot: bot("Pip"), agent: { kind: "planner" }, route: noKey, channel, connection: connected, messages: [], t });
    expect(row(rows, "folder").value).toBe("walklings-team, inside the workspace (configured)");
    const sections = contextSections({ members: [{ name: "Pip", agent: { kind: "planner" }, sheet: { bot: bot("Pip"), route: noKey, messages: [] } }], channel, connection: connected, t });
    expect(sections.map((section) => section.title)).toEqual(["This chat", "Pip"]);
    expect(sections[0].rows.map((item) => item.id)).toEqual(["runsOn", "folder", "closed"]);
  });

  it("the folder and model a turn reported are shown as the last turn's, apart from the configured ones", () => {
    const messages = [
      { id: "1", role: "assistant", text: "", createdAt: 1, attachments: [], status: "done", thinking: ["Working folder: C:\\Users\\<you>\\.sandbench\\workspace\\demo", "Claude Code session started on claude-sonnet-x."] },
    ] as unknown as Message[];
    expect(lastFolder(messages)).toBe("C:\\Users\\<you>\\.sandbench\\workspace\\demo");
    expect(lastModel(messages)).toBe("claude-sonnet-x");
    const rows = sheetRows({ bot: bot("North"), agent: { kind: "driver", id: "claude", name: "Claude Code", source: "bot" }, route: noKey, connection: connected, messages, t });
    expect(row(rows, "folder").detail).toBe("Last turn: C:\\Users\\<you>\\.sandbench\\workspace\\demo");
    expect(row(rows, "model").value).toBe("last reply: claude-sonnet-x");
    // Only the newest reply counts: an older reply's model is not the current one.
    const later = [...messages, { id: "2", role: "assistant", text: "", createdAt: 2, attachments: [], status: "done", thinking: ["Answer with grok-3."] }] as unknown as Message[];
    expect(lastModel(later)).toBeUndefined();
  });

  it("when the page closes: a started turn keeps going; with no harness, nothing is queued", () => {
    const rows = (connection: Connection) => row(sheetRows({ bot: bot("North"), agent: { kind: "planner" }, route: noKey, connection, messages: [], t }), "closed").value;
    expect(rows(connected)).toMatch(/^A turn already started keeps going on the harness until it ends or waits for an approval\./);
    expect(rows(offline)).toBe("Nothing runs while every Sandbench tab is closed. Without a reachable local harness, schedules are only checked while a tab is open.");
  });

  it("rows say what the merged code does: connectors (#32), memory saves (#33, #35), approvals", () => {
    const withConnectors = bot("North", { connectorIds: ["c-a", "c-b"] });
    const claude = { kind: "driver" as const, id: "claude", name: "Claude Code", source: "bot" as const };
    const codex = { kind: "driver" as const, id: "codex", name: "Codex", source: "bot" as const };
    const rows = (agent: Parameters<typeof sheetRows>[0]["agent"], route = noKey) => sheetRows({ bot: withConnectors, agent, route, connection: connected, messages: [], t });
    expect(row(rows(claude), "connectors").value).toBe("2 assigned to this bot. Claude Code gets the tested ones that need no stored secret, and no other MCP servers; each tool call asks for approval.");
    expect(row(rows(codex), "connectors").value).toBe("Sandbench passes no connectors to Codex chats.");
    // Codex and Grok run their own commands; their requests to Sandbench always ask.
    expect(row(rows(codex), "tools").value).toBe("Codex runs its own commands under its own settings. Requests it sends to Sandbench always ask; auto-review rules don't apply to them.");
    expect(row(rows({ kind: "driver", id: "anthropic", name: "Anthropic (API)", source: "provider" }), "tools").value).toMatch(/unless a Settings auto-review rule covers them/);
    expect(row(rows({ kind: "planner" }), "connectors").value).toBe("2 assigned to this bot; each tool call shows a card.");
    expect(row(rows(claude), "memory").value).toMatch(/Agent chats can't propose memory notes/);
    expect(row(rows({ kind: "planner" }, { provider: "xai", ready: true, model: "grok-3" }), "memory").value).toMatch(/when choosing each step\. A reply can propose a note; each one waits for your approval/);
    expect(row(rows({ kind: "planner" }), "memory").value).toMatch(/^Not read without a model key/);
    expect(row(rows(claude), "tools").value).toMatch(/run without a card\. Other actions ask unless a Settings auto-review rule or an earlier approval of the same call/);
    // Never claim a sign-in state the harness doesn't check, or "asks every time".
    const all = JSON.stringify([rows(claude), rows(codex), rows({ kind: "planner" })]);
    expect(all).not.toMatch(/signed in|no API key|asks every time|anything else asks/i);
  });

  it("P1-AC3: the sheet is read-only: no inputs, selects or text areas anywhere in its view", () => {
    const view = readFileSync(new URL("./chatContextView.tsx", import.meta.url), "utf8");
    expect(view).not.toMatch(/<input|<select|<textarea|contentEditable/);
    expect(view).toMatch(/role="dialog" aria-modal="true"/);
    expect(view).toMatch(/event\.key !== "Escape"/);
    expect(view).toMatch(/document\.addEventListener\("keydown", onEscape\)/);
    expect(view).toMatch(/node\.inert = true/);
    expect(view).toMatch(/button:not\(:disabled\)/);
    expect(view).not.toMatch(/disabled=\{busy\}/);
    expect(view).toMatch(/node\.inert = false;\s*trigger\.current\?\.focus\(\);/);
  });

  it("P1-AC5: the connection word never shrinks and the agent name gives way first", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.chat-context \.ctx-conn \{ flex: none;/);
    expect(css).toMatch(/\.chat-context \.ctx-agent \{ flex: 0 3 auto; min-width: min\(8ch, 30%\);/);
    expect(css).toMatch(/@container chat \(max-width: 700px\)/);
    expect(css).toMatch(/\.chat-context \.ctx-folder \{ flex: 0 1 auto;/);
    expect(css).toMatch(/\.chat-context \{[^}]*min-height: 44px;/);
  });
});
