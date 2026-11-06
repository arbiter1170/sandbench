// "Effective setup" at the top of a bot's Model tab (UX P5): what this bot actually runs with,
// where each value comes from, and where it is changed. Display only; it reuses the P1 derivation
// (chatAgent / effectiveDriver), so the badges follow the same order as the turn itself.
import { agentName, channelFolder, chatAgent, driverModel, type ChatAgent } from "./chatContext";
import type { AgentDriver } from "./harness";
import type { Bot, Connector, Settings, Thread } from "./types";

type Route = { provider: string; ready: boolean; model: string };

export type SetupKey =
  | "esTitle" | "esAgent" | "esModel" | "esFolder" | "esMode" | "esAutoReview" | "esShared" | "esSkills" | "esMemory" | "esConnectors"
  | "esFromBot" | "esFromSettings" | "esFromProvider" | "esFromChannel" | "esDefault" | "esAllBots"
  | "esPlanner" | "esNotAvailable" | "esUseDefault" | "esChosenBy" | "esStandIn" | "esWorkspaceRoot" | "esChannelFolder"
  | "esRules" | "esNoRules" | "esSharedSet" | "esSharedNone" | "esSharedOnlyChannels"
  | "esSkillsCount" | "esSkillsMissing" | "esSkillsNone" | "esUnknownOffline" | "esChecking"
  | "esMemoryFiles" | "esMemoryNone" | "esMemoryFailed" | "esMemoryRunner" | "esMemoryStandIn" | "esMemoryFilesCapped" | "esSkillsRunner" | "esSkillsFailed" | "esModelSent" | "esConnectorsClaude" | "esMemoryIndexOnly" | "esConnectorsCount" | "esConnectorsNone" | "esConnectorsRunner" | "esConnectorsNotUsed"
  | "esLinkHere" | "esLinkCustomize" | "esLinkSettings" | "esLinkTeam" | "esLinkWork"
  | "permissionAsk" | "permissionAuto" | "permissionFull";

type Translate = (key: SetupKey) => string;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** Where a row's value is changed. "here" names an element id in this tab. */
export type SetupLink = { to: "here"; id: string } | { to: "customize" | "settings" | "team" | "work" };
export type SetupRow = { id: string; label: string; value: string; badge?: string; link?: SetupLink };

/** What the bot's library skills look like on the harness: the ids found, offline, or still loading. */
export type SkillsOnDisk = { state: "loaded"; ids: string[] } | { state: "failed" } | { state: "offline" } | { state: "loading" } | { state: "runner" };
export type MemoryState = { state: "loaded"; hasIndex: boolean; files: number } | { state: "failed" } | { state: "offline" } | { state: "loading" };

/** A driver's name for a select option: "Claude Code (CLI)", "Anthropic (API)". */
export function optionName(id: string, drivers: AgentDriver[]): string {
  const label = drivers.find((item) => item.id === id)?.label;
  if (label) return label.replace(/\(local CLI\)$/i, "(CLI)");
  const name = agentName(id, drivers);
  return ["claude", "codex", "grok"].includes(id) ? `${name} (CLI)` : name;
}

const agentLabel = (agent: ChatAgent, drivers: AgentDriver[], t: Translate) =>
  agent.kind === "planner" ? t("esPlanner") : agent.kind === "unavailable" ? `${optionName(agent.id, drivers)} (${t("esNotAvailable")})` : optionName(agent.id, drivers);

/** The empty option of the bot's Agent select: "Use default · Claude Code (CLI)". Its value is still "". */
export function defaultAgentOption(input: { bot: Bot; settings: Pick<Settings, "defaultAgentDriver">; route: Route; drivers: AgentDriver[]; harnessUp: boolean; t: Translate }): string {
  const agent = chatAgent({ bot: { ...input.bot, driver: undefined }, defaultDriver: input.settings.defaultAgentDriver, route: input.route, drivers: input.drivers, harnessUp: input.harnessUp });
  return fill(input.t("esUseDefault"), { agent: agentLabel(agent, input.drivers, input.t) });
}

export function setupRows(input: {
  bot: Bot;
  settings: Pick<Settings, "defaultAgentDriver" | "model">;
  route: Route;
  drivers: AgentDriver[];
  harnessUp: boolean;
  runner: boolean;
  channel?: Thread | null;
  autoApprove: readonly string[];
  connectors: Connector[];
  skills: SkillsOnDisk;
  memory: MemoryState;
  /** No health answer yet: nothing is called unavailable or offline. */
  checking?: boolean;
  t: Translate;
}): SetupRow[] {
  const { bot, t, route } = input;
  const agent = chatAgent({ bot, defaultDriver: input.settings.defaultAgentDriver, route, drivers: input.drivers, harnessUp: input.harnessUp });
  const badge = (from: "bot" | "settings" | "provider" | "channel" | "default" | "all") =>
    t(from === "bot" ? "esFromBot" : from === "settings" ? "esFromSettings" : from === "provider" ? "esFromProvider" : from === "channel" ? "esFromChannel" : from === "all" ? "esAllBots" : "esDefault");
  const unknown = t("esUnknownOffline");

  const agentRow: SetupRow = {
    id: "agent",
    label: t("esAgent"),
    value: agent.kind === "unavailable" && input.checking ? `${optionName(agent.id, input.drivers)} · ${t("esChecking")}` : agentLabel(agent, input.drivers, t),
    badge: agent.kind === "planner" ? badge("default") : badge(agent.source),
    link: { to: "here", id: "bot-agent-select" },
  };

  // The page sends the route's model with a driver turn too; the driver keeps or drops it
  // (driverModel). The planner, and a chosen driver that can't run, use it as is.
  const sent = agent.kind === "driver" ? driverModel(agent.id, route.model) : undefined;
  const modelRow: SetupRow =
    agent.kind === "driver"
      ? sent
        ? { id: "model", label: t("esModel"), value: fill(t("esModelSent"), { model: sent, name: agent.name }), badge: badge(bot.model?.trim() ? "bot" : "settings"), link: { to: "here", id: "bot-model-select" } }
        : { id: "model", label: t("esModel"), value: fill(t("esChosenBy"), { name: agent.name, model: route.model }), link: { to: "here", id: "bot-model-select" } }
      : {
          id: "model",
          label: t("esModel"),
          value: route.ready ? route.model : `${route.model} · ${t("esStandIn")}`,
          badge: badge(bot.model?.trim() ? "bot" : "settings"),
          link: { to: "here", id: "bot-model-select" },
        };

  // The same check roomFolder makes: an unsafe folder runs in the workspace root.
  const folderName = channelFolder(input.channel);
  const folderRow: SetupRow = folderName
    ? { id: "folder", label: t("esFolder"), value: fill(t("esChannelFolder"), { folder: folderName }), badge: badge("channel"), link: { to: "work" } }
    : { id: "folder", label: t("esFolder"), value: t("esWorkspaceRoot"), badge: badge("default") };

  const mode = bot.approvalMode ?? "ask";
  const modeRow: SetupRow = {
    id: "mode",
    label: t("esMode"),
    value: t(mode === "auto" ? "permissionAuto" : mode === "full" ? "permissionFull" : "permissionAsk"),
    // New bots store "ask", the default, so only another mode counts as set on the bot.
    badge: badge(bot.approvalMode && bot.approvalMode !== "ask" ? "bot" : "default"),
    link: { to: "customize" },
  };

  const rules = input.autoApprove.length;
  const reviewRow: SetupRow = { id: "autoReview", label: t("esAutoReview"), value: rules ? fill(t("esRules"), { count: rules }) : t("esNoRules"), badge: badge("all"), link: { to: "team" } };

  const sharedRow: SetupRow = input.channel?.memberIds
    ? { id: "shared", label: t("esShared"), value: input.channel.sharedInstructions?.trim() ? t("esSharedSet") : t("esSharedNone"), badge: badge("channel"), link: { to: "work" } }
    : { id: "shared", label: t("esShared"), value: t("esSharedOnlyChannels") };

  // Library skills the harness doesn't list are dropped from the prompt (skillLinesFor); count them.
  const library = bot.librarySkillIds ?? [];
  const builtIn = bot.skills.length;
  const skillsValue =
    builtIn + library.length === 0
      ? t("esSkillsNone")
      : library.length === 0 || input.skills.state === "loaded"
        ? (() => {
            const missing = input.skills.state === "loaded" ? library.filter((id) => !(input.skills as { ids: string[] }).ids.includes(id)).length : 0;
            const base = fill(t("esSkillsCount"), { count: builtIn + library.length });
            return missing ? `${base} · ${fill(t("esSkillsMissing"), { count: missing })}` : base;
          })()
        : `${fill(t("esSkillsCount"), { count: builtIn + library.length })} · ${
            input.skills.state === "loading" || input.checking
              ? t("esChecking")
              : input.skills.state === "runner"
                ? t("esSkillsRunner")
                : input.skills.state === "failed"
                  ? t("esSkillsFailed")
                  : unknown
          }`;
  const skillsRow: SetupRow = { id: "skills", label: t("esSkills"), value: skillsValue, badge: badge("bot"), link: { to: "customize" } };

  const memory = input.memory;
  const memoryValue =
    input.runner
      ? t("esMemoryRunner")
      : memory.state === "loading" || input.checking
        ? t("esChecking")
        : memory.state === "offline"
          ? unknown
          : memory.state === "failed"
            ? t("esMemoryFailed")
            : memory.files === 0
              ? t("esMemoryNone")
              : agent.kind !== "driver" && !route.ready
                ? t("esMemoryStandIn")
                : memory.hasIndex && memory.files === 1
                  ? t("esMemoryIndexOnly")
                  : // A reply reads at most 8 files (memoryDocument).
                    fill(t(memory.files > 8 ? "esMemoryFilesCapped" : "esMemoryFiles"), { index: memory.hasIndex ? "MEMORY.md + " : "", count: memory.hasIndex ? memory.files - 1 : memory.files });
  const memoryRow: SetupRow = { id: "memory", label: t("esMemory"), value: memoryValue, badge: badge("bot"), link: { to: "customize" } };

  // Claude Code turns get the bot's tested connectors (#32); other drivers get none; runner turns none.
  const assigned = input.connectors.filter((item) => (bot.connectorIds ?? []).includes(item.id));
  const tested = assigned.filter((item) => item.status === "ok").length;
  const connectorsValue = !assigned.length
    ? t("esConnectorsNone")
    : agent.kind === "driver" && input.runner
      ? t("esConnectorsRunner")
      : agent.kind === "driver" && agent.id !== "claude"
        ? fill(t("esConnectorsNotUsed"), { name: agent.name })
        : agent.kind === "driver"
          ? fill(t("esConnectorsClaude"), { count: assigned.length, tested })
          : fill(t("esConnectorsCount"), { count: assigned.length, tested });
  const connectorsRow: SetupRow = { id: "connectors", label: t("esConnectors"), value: connectorsValue, badge: badge("bot"), link: { to: "team" } };

  return [agentRow, modelRow, folderRow, modeRow, reviewRow, sharedRow, skillsRow, memoryRow, connectorsRow];
}
