// UX P5: "Effective setup" in the bot's Model tab. Fixtures follow F-P5-a..d in
// docs/superpowers/specs/2026-11-05-sandbench-ux-design.md (#26); all data is synthetic.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultAgentOption, optionName, setupRows, type MemoryState, type SkillsOnDisk } from "./effectiveSetup";
import type { AgentDriver } from "./harness";
import { translate, type Key } from "./i18n";
import type { Bot, Connector, Thread } from "./types";
import { blankBot } from "./work";

const t = (key: Key) => translate("en", key);
const claudeOk: AgentDriver = { id: "claude", label: "Claude Code (local CLI)", ok: true, detail: "" };
const noKey = { provider: "xai", ready: false, model: "grok-3" };
const settings = { defaultAgentDriver: "claude" as const, model: "grok-3" };
const pip = (patch: Partial<Bot> = {}): Bot => ({ ...blankBot("Pip", "Builder", true), id: "pip", createdAt: 1, skills: [], ...patch });
const loaded = (ids: string[]): SkillsOnDisk => ({ state: "loaded", ids });
const memory: MemoryState = { state: "loaded", hasIndex: true, files: 3 };
const rows = (bot: Bot, extra: Partial<Parameters<typeof setupRows>[0]> = {}) =>
  setupRows({ bot, settings, route: noKey, drivers: [claudeOk], harnessUp: true, runner: false, autoApprove: [], connectors: [], skills: loaded([]), memory, t, ...extra });
const row = (list: ReturnType<typeof setupRows>, id: string) => list.find((item) => item.id === id)!;

describe("effective setup (UX P5)", () => {
  it("F-P5-a: no driver on the bot and Claude Code as the Settings default", () => {
    const bot = pip();
    expect(defaultAgentOption({ bot, settings, route: noKey, drivers: [claudeOk], harnessUp: true, t })).toBe("Use default · Claude Code (CLI)");
    const agent = row(rows(bot), "agent");
    expect([agent.value, agent.badge]).toEqual(["Claude Code (CLI)", "From Settings default"]);
    expect(row(rows(bot), "model").value).toBe("Chosen by Claude Code");
  });

  it("F-P5-b: Claude Code set on the bot", () => {
    const agent = row(rows(pip({ driver: "claude" })), "agent");
    expect([agent.value, agent.badge]).toEqual(["Claude Code (CLI)", "Set on this bot"]);
  });

  it("the default option says what an empty value means now, and never changes the value", () => {
    const bot = pip({ driver: "claude" });
    // The bot's own choice does not change what "default" means.
    expect(defaultAgentOption({ bot, settings, route: noKey, drivers: [claudeOk], harnessUp: true, t })).toBe("Use default · Claude Code (CLI)");
    expect(defaultAgentOption({ bot, settings: { defaultAgentDriver: undefined }, route: noKey, drivers: [claudeOk], harnessUp: true, t })).toBe("Use default · Built-in planner");
    expect(defaultAgentOption({ bot, settings, route: noKey, drivers: [], harnessUp: false, t })).toBe("Use default · Claude Code (CLI) (not available)");
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).toMatch(/<select id="bot-agent-select" value=\{bot\.driver \?\? ""\}[^>]*onChange=\{\(event\) => props\.onPatch\(bot\.id, \{ driver: event\.target\.value \|\| undefined \}\)\}>\s*\{[^}]*\}\s*<option value="">\{defaultAgentOption\(/);
    expect(optionName("anthropic", [])).toBe("Anthropic (API)");
  });

  it("F-P5-c: a library skill the harness doesn't list is counted, not hidden", () => {
    const bot = pip({ skills: ["files"], librarySkillIds: ["notes", "gone"] } as Partial<Bot>);
    expect(row(rows(bot, { skills: loaded(["notes"]) }), "skills").value).toBe("3 assigned · 1 not found on disk");
    expect(row(rows(bot, { skills: loaded(["notes", "gone"]) }), "skills").value).toBe("3 assigned");
    expect(row(rows(bot, { skills: { state: "offline" } }), "skills").value).toBe("3 assigned · Unknown: harness offline");
    expect(row(rows(pip()), "skills").value).toBe("None assigned");
  });

  it("F-P5-d: memory that can't be read is said so, and replies go on", () => {
    expect(row(rows(pip(), { memory: { state: "failed" } }), "memory").value).toBe("Couldn't be read · replies go on without it");
    expect(row(rows(pip()), "memory").value).toBe("MEMORY.md + 2 files · read at the start of each reply");
    expect(row(rows(pip(), { memory: { state: "loaded", hasIndex: true, files: 1 } }), "memory").value).toBe("MEMORY.md · read at the start of each reply");
    expect(row(rows(pip(), { memory: { state: "loaded", hasIndex: false, files: 0 } }), "memory").value).toBe("No memory files yet");
    expect(row(rows(pip(), { memory: { state: "offline" } }), "memory").value).toBe("Unknown: harness offline");
    expect(row(rows(pip(), { runner: true }), "memory").value).toBe("Runner memory is not covered here");
  });

  it("P5-AC3: the counts are display only; nothing in the send path reads them", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/effectiveSetup|setupRows|skillsOnDisk|memoryState/);
  });

  it("in a group chat the folder and shared instructions come from the chat", () => {
    const channel = { id: "c1", title: "walklings-team", updatedAt: 1, messages: [], memberIds: ["pip"], workingFolder: "walklings-team", sharedInstructions: "Be brief." } as unknown as Thread;
    const list = rows(pip(), { channel });
    expect([row(list, "folder").value, row(list, "folder").badge]).toEqual(["walklings-team · in bot chats: workspace root", "From group chat"]);
    expect([row(list, "shared").value, row(list, "shared").badge]).toEqual(["Set for this group chat", "From group chat"]);
    const alone = rows(pip());
    expect([row(alone, "folder").value, row(alone, "folder").badge]).toEqual(["workspace root", "Default"]);
    expect(row(alone, "shared").value).toBe("Only used in group chats");
  });

  it("P5-AC2: badges follow the same resolution order as the turn", () => {
    const anthropic: AgentDriver = { id: "anthropic", label: "Anthropic (API)", ok: true, detail: "" };
    const viaProvider = row(rows(pip(), { settings: { defaultAgentDriver: undefined, model: "grok-3" }, route: { provider: "anthropic", ready: true, model: "m" }, drivers: [anthropic] }), "agent");
    expect([viaProvider.value, viaProvider.badge]).toEqual(["Anthropic (API)", "From the bot's model provider"]);
    // A chosen driver that can't run: named, not swapped for another.
    const missing = row(rows(pip({ driver: "codex" })), "agent");
    expect([missing.value, missing.badge]).toEqual(["Codex (CLI) (not available)", "Set on this bot"]);
    // The planner's model: the bot's own, or the Settings default.
    const planner = { settings: { defaultAgentDriver: undefined, model: "grok-3" } };
    expect([row(rows(pip(), planner), "model").value, row(rows(pip(), planner), "model").badge]).toEqual(["grok-3 · no model key: local stand-ins", "From Settings default"]);
    const own = rows(pip({ model: "grok-4" }), { ...planner, route: { provider: "xai", ready: true, model: "grok-4" } });
    expect([row(own, "model").value, row(own, "model").badge]).toEqual(["grok-4", "Set on this bot"]);
  });

  it("mode, auto-review and connectors say what the merged code does", () => {
    expect(row(rows(pip()), "mode").value).toBe("Ask (auto-review rules still apply)");
    expect(row(rows(pip({ approvalMode: "full" })), "mode")).toMatchObject({ value: "Full (same as Ask for now)", badge: "Set on this bot" });
    expect(row(rows(pip(), { autoApprove: ["git status", "Get-Date"] }), "autoReview")).toMatchObject({ value: "2 rules can let a command run without a card", badge: "Shared by all bots" });
    expect(row(rows(pip()), "autoReview").value).toBe("No rules: every command shows a card");
    const connectors = [{ id: "a", name: "A", status: "ok" }, { id: "b", name: "B", status: "untested" }] as unknown as Connector[];
    const bot = pip({ connectorIds: ["a", "b"] });
    expect(row(rows(bot, { connectors }), "connectors").value).toBe("2 assigned · 1 tested");
    expect(row(rows({ ...bot, driver: "codex" }, { connectors, drivers: [claudeOk, { id: "codex", label: "Codex (local CLI)", ok: true, detail: "" }] }), "connectors").value).toBe("Sandbench passes no connectors to Codex chats");
    expect(row(rows(bot, { connectors, runner: true }), "connectors").value).toBe("Not passed to runner turns");
  });

  it("P5-AC4: no new tab; every row links to where it is changed today", () => {
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).toMatch(/\(\["model", "customize", "work"\] as const\)\.map/);
    expect(shell).toMatch(/id="bot-model-select"/);
    for (const item of rows(pip({ driver: "claude" }), { channel: { id: "c", title: "x", updatedAt: 1, messages: [], memberIds: ["pip"], workingFolder: "f" } as unknown as Thread })) {
      expect(item.link, item.id).toBeTruthy();
    }
  });
});
