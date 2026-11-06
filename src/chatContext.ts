// What the chat's context line and "How this chat runs" sheet say (UX P1). Everything here is
// derived from signals the page already has: the harness health poll, /drivers, the bot and
// Settings, and the turn trace. Nothing is fetched, and no label claims more than that evidence:
// `/drivers` ok means the CLI binary answers, not that a turn will start or that it is signed in.
import type { AgentDriver } from "./harness";
import type { Bot, Message, Thread } from "./types";

type Route = { provider: string; ready: boolean; model: string };
type Translate = (key: ContextKey) => string;

/**
 * The agent driver that answers a bot's turn, or undefined for the built-in planner. This is the
 * page's only definition: `resolveAgentDriver` in App.tsx calls it, so the context line and the
 * turn always agree (P1-AC2).
 */
export function effectiveDriver(input: { bot: Pick<Bot, "driver" | "skills">; defaultDriver?: string; route: Route; drivers: AgentDriver[]; harnessUp: boolean }): AgentDriver | undefined {
  if (!input.harnessUp) return undefined;
  const list = input.drivers;
  if (input.bot.driver) {
    const chosen = list.find((item) => item.id === input.bot.driver);
    return chosen?.ok ? chosen : undefined;
  }
  const pick = (id: string) => list.find((item) => item.id === id && item.ok);
  if (input.defaultDriver) {
    const chosen = pick(input.defaultDriver);
    if (chosen) return chosen;
  }
  if (input.route.provider === "anthropic" && input.route.ready) return pick("anthropic");
  if (input.route.provider === "openai_compat" && input.route.ready && input.bot.skills.includes("computer")) return pick("http");
  return undefined;
}

export type AgentSource = "bot" | "settings" | "provider";
export type ChatAgent =
  | { kind: "driver"; id: string; name: string; source: AgentSource }
  | { kind: "unavailable"; id: string; name: string; source: AgentSource; detail: string }
  | { kind: "planner" };

// Driver labels without "(local CLI)", for the line. Used when /drivers is not loaded (harness offline).
const NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", grok: "Grok", anthropic: "Anthropic (API)", http: "OpenAI-compatible tools" };
export function agentName(id: string, drivers: AgentDriver[] = []): string {
  const label = drivers.find((item) => item.id === id)?.label;
  return label ? label.replace(/\s*\(local CLI\)$/i, "") : (NAMES[id] ?? id);
}

/** Who answers this bot: the effective driver, a chosen driver that can't run now, or the planner. */
export function chatAgent(input: Parameters<typeof effectiveDriver>[0]): ChatAgent {
  const effective = effectiveDriver(input);
  if (effective) {
    const source: AgentSource = input.bot.driver ? "bot" : effective.id === input.defaultDriver ? "settings" : "provider";
    return { kind: "driver", id: effective.id, name: agentName(effective.id, input.drivers), source };
  }
  const chosen = input.bot.driver || input.defaultDriver;
  if (chosen) {
    const listed = input.drivers.find((item) => item.id === chosen);
    return { kind: "unavailable", id: chosen, name: agentName(chosen, input.drivers), source: input.bot.driver ? "bot" : "settings", detail: input.harnessUp ? (listed?.detail ?? "") : "" };
  }
  return { kind: "planner" };
}

export type Connection = {
  /** checking: no health answer yet; connected / offline from the latest answer. */
  state: "checking" | "connected" | "offline";
  runner: boolean;
  now: number;
  checkedAt?: number;
  lastOkAt?: number;
  platform?: string;
  workspace?: string;
};

export type ContextKey =
  | "ctxPlanner" | "ctxMixed" | "ctxWorkspaceRoot" | "ctxFolderPrefix" | "ctxNotAvailable" | "ctxConnected" | "ctxChecking" | "ctxNotReachable"
  | "ctxRunnerReachable" | "ctxRunnerNotReachable"
  | "ctxRowRunsOn" | "ctxRowAgent" | "ctxRowModel" | "ctxRowFolder" | "ctxRowTools" | "ctxRowConnectors" | "ctxRowMemory" | "ctxRowSkills" | "ctxRowClosed"
  | "ctxRunsOnHarness" | "ctxRunsOnPlanner" | "ctxRunsOnOffline" | "ctxRunsOnPlannerOffline" | "ctxRunsOnRunner" | "ctxChecked" | "ctxLastConnected" | "ctxNeverConnected"
  | "ctxReachable" | "ctxUnreachable" | "ctxRunnerOffline" | "ctxAgentUnavailableRunner" | "ctxToolsCli" | "ctxConnectorsRunner"
  | "ctxBadgeBot" | "ctxBadgeSettings" | "ctxBadgeProvider"
  | "ctxAgentClaude" | "ctxAgentOther" | "ctxAgentUnavailable" | "ctxAgentUnavailableOffline" | "ctxAgentPlanner"
  | "ctxUnknownOffline" | "ctxModelAfterReply" | "ctxModelLast" | "ctxModelPlanner" | "ctxModelStandIn"
  | "ctxFolderBot" | "ctxFolderChannel" | "ctxFolderLast"
  | "ctxToolsClaude" | "ctxToolsDriver" | "ctxToolsPlanner"
  | "ctxConnectorsClaude" | "ctxConnectorsNone" | "ctxConnectorsOther" | "ctxConnectorsPlanner"
  | "ctxMemoryDriver" | "ctxMemoryPlanner" | "ctxMemoryStandIn" | "ctxMemoryRunner"
  | "ctxSkills" | "ctxSkillsNone"
  | "ctxClosedLocal" | "ctxClosedNoHarness" | "ctxClosedRunner";

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** "12 s", "3 min", "2 h": how long ago a check was. */
export function ago(now: number, at: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export function connectionWord(connection: Connection, t: Translate): string {
  if (connection.state === "checking") return t("ctxChecking");
  if (connection.runner) return t(connection.state === "connected" ? "ctxRunnerReachable" : "ctxRunnerNotReachable");
  return t(connection.state === "connected" ? "ctxConnected" : "ctxNotReachable");
}

export type MemberAgent = { name: string; agent: ChatAgent };

// Before the first health answer, or before /drivers answered, a chosen driver is not yet known
// to be unavailable: the line shows its name only.
const agentText = (agent: ChatAgent, t: Translate, checking: boolean) =>
  agent.kind === "planner" ? t("ctxPlanner") : agent.kind === "unavailable" && !checking ? `${agent.name} (${t("ctxNotAvailable")})` : agent.name;

export type ContextLine = {
  /** The full agent part; `short` replaces it on narrow screens (several agents in a group chat). */
  agent: string;
  short: string;
  /** "folder " before a group chat's folder in the full form only (`short` drops it). */
  folderPrefix: string;
  folder: string;
  connection: string;
  tone: "ok" | "bad" | "wait";
};

/** The one-line summary: agent · folder · connection word (the word never depends on colour). */
export function contextLine(input: { members: MemberAgent[]; channel?: Thread; connection: Connection; t: Translate }): ContextLine {
  const { connection, t } = input;
  const groups = new Map<string, string[]>();
  for (const member of input.members) {
    const key = agentText(member.agent, t, connection.state === "checking");
    groups.set(key, [...(groups.get(key) ?? []), member.name]);
  }
  const keys = [...groups.keys()];
  const several = Boolean(input.channel) && keys.length > 1;
  const agent = several ? keys.map((key) => `${key} (${groups.get(key)!.join(", ")})`).join(" · ") : (keys[0] ?? t("ctxPlanner"));
  const folderName = input.channel ? (input.channel.workingFolder?.trim() || "") : "";
  // A bot chat's folder is the workspace root, which only a reachable harness reports.
  const folder = input.channel ? folderName || t("ctxWorkspaceRoot") : connection.state === "offline" && !connection.runner ? "" : t("ctxWorkspaceRoot");
  const folderPrefix = several && folderName ? t("ctxFolderPrefix") : "";
  const unavailable = input.members.some((member) => member.agent.kind === "unavailable");
  const tone = connection.state === "checking" ? "wait" : connection.state === "offline" || unavailable ? "bad" : "ok";
  return { agent, short: several ? t("ctxMixed") : agent, folderPrefix, folder, connection: connectionWord(connection, t), tone };
}

export type SheetRow = { id: string; label: string; value: string; detail?: string; badge?: string };

/** The model named in the newest reply's trace ("Claude Code session started on X." / "Using Claude Code model X"). An older reply's model is not this chat's current one. */
export function lastModel(messages: Message[]): string | undefined {
  const newest = [...messages].reverse().find((message) => message.role === "assistant");
  for (const line of [...(newest?.thinking ?? [])].reverse()) {
    const started = /session started on (.+?)\.?$/.exec(line);
    if (started) return started[1];
    const using = /^Using .+ model (\S+)/.exec(line);
    if (using) return using[1];
  }
  return undefined;
}

/** The folder the last turn reported (`turn_start.cwd`, written to the trace as "Working folder: …"). */
export function lastFolder(messages: Message[]): string | undefined {
  for (const message of [...messages].reverse()) {
    const line = [...(message.thinking ?? [])].reverse().find((item) => item.startsWith("Working folder: "));
    if (line) return line.slice("Working folder: ".length);
  }
  return undefined;
}

/** The read-only sheet for one bot (the chat's bot, or one member of a group chat). */
export function sheetRows(input: {
  bot: Pick<Bot, "name" | "skills" | "connectorIds" | "librarySkillIds">;
  agent: ChatAgent;
  route: Route;
  channel?: Thread;
  connection: Connection;
  messages: Message[];
  t: Translate;
}): SheetRow[] {
  const { agent, connection, t, route } = input;
  const offline = connection.state === "offline";
  const checking = connection.state === "checking";
  // Rows that only the harness or runner can answer are unknown while it is not reachable.
  const unknown = t(connection.runner ? "ctxRunnerOffline" : "ctxUnknownOffline");
  const checked = connection.checkedAt ? fill(t("ctxChecked"), { age: ago(connection.now, connection.checkedAt) }) : "";
  const isDriver = agent.kind === "driver";
  const name = agent.kind === "planner" ? t("ctxPlanner") : agent.name;

  const runsOn = checking
    ? t("ctxChecking")
    : connection.runner
      ? fill(t("ctxRunsOnRunner"), { state: t(connection.state === "connected" ? "ctxReachable" : "ctxUnreachable") })
      : offline
        ? agent.kind === "planner"
          ? t("ctxRunsOnPlannerOffline")
          : `${t("ctxRunsOnOffline")} · ${connection.lastOkAt ? fill(t("ctxLastConnected"), { age: ago(connection.now, connection.lastOkAt) }) : t("ctxNeverConnected")}`
        : `${fill(t(agent.kind === "planner" ? "ctxRunsOnPlanner" : "ctxRunsOnHarness"), { platform: connection.platform || "?" })} · ${t("ctxConnected")} · ${checked}`;

  const badge = agent.kind === "planner" ? undefined : t(agent.source === "bot" ? "ctxBadgeBot" : agent.source === "settings" ? "ctxBadgeSettings" : "ctxBadgeProvider");
  const agentValue =
    agent.kind === "planner"
      ? t("ctxAgentPlanner")
      : agent.kind === "unavailable" && checking
        ? `${agent.name} · ${t("ctxChecking")}`
        : agent.kind === "unavailable"
        ? fill(t(offline ? (connection.runner ? "ctxAgentUnavailableRunner" : "ctxAgentUnavailableOffline") : "ctxAgentUnavailable"), { name: agent.name, detail: agent.detail ? `: ${agent.detail}` : "" })
        : fill(t(agent.id === "claude" ? "ctxAgentClaude" : "ctxAgentOther"), { name: agent.name });

  // Offline, nothing is known (the stored keys are read through the harness too). A chosen driver
  // that can't run now: the planner answers, with the planner's model.
  const model = offline
    ? unknown
    : agent.kind === "planner" || (agent.kind === "unavailable" && !checking)
      ? route.ready
        ? fill(t("ctxModelPlanner"), { model: route.model })
        : t("ctxModelStandIn")
      : (() => {
            const seen = lastModel(input.messages);
            return seen ? fill(t("ctxModelLast"), { model: seen }) : fill(t("ctxModelAfterReply"), { name });
          })();

  const folderName = input.channel?.workingFolder?.trim();
  const configured = folderName
    ? fill(t("ctxFolderChannel"), { folder: folderName })
    : fill(t("ctxFolderBot"), { path: offline || !connection.workspace ? unknown : connection.workspace });
  const reported = lastFolder(input.messages);

  // Codex and Grok run their own commands; what they send to Sandbench always asks (autoReview.mjs).
  const tools =
    agent.kind === "planner" || agent.kind === "unavailable"
      ? t("ctxToolsPlanner")
      : agent.id === "claude"
        ? t("ctxToolsClaude")
        : agent.id === "codex" || agent.id === "grok"
          ? fill(t("ctxToolsCli"), { name })
          : t("ctxToolsDriver");

  const assigned = (input.bot.connectorIds ?? []).length;
  // The runner passes no connector registry, so runner turns get none (harness/connectors.mjs).
  const connectors =
    offline
      ? unknown
      : connection.runner && isDriver
        ? t("ctxConnectorsRunner")
        : isDriver && agent.id === "claude"
        ? assigned
          ? fill(t("ctxConnectorsClaude"), { count: assigned })
          : t("ctxConnectorsNone")
        : isDriver
          ? fill(t("ctxConnectorsOther"), { name })
          : assigned
            ? fill(t("ctxConnectorsPlanner"), { count: assigned })
            : t("ctxConnectorsNone");

  const memory = connection.runner
    ? t("ctxMemoryRunner")
    : offline
      ? unknown
      : isDriver
        ? t("ctxMemoryDriver")
        : route.ready
          ? t("ctxMemoryPlanner")
          : t("ctxMemoryStandIn");

  const library = (input.bot.librarySkillIds ?? []).length;
  const skills =
    input.bot.skills.length || library
      ? fill(t("ctxSkills"), { builtIn: input.bot.skills.join(", ") || "0", library: offline && library ? `${library} (${unknown})` : library })
      : t("ctxSkillsNone");

  return [
    { id: "runsOn", label: t("ctxRowRunsOn"), value: runsOn },
    { id: "agent", label: t("ctxRowAgent"), value: agentValue, ...(badge ? { badge } : {}) },
    { id: "model", label: t("ctxRowModel"), value: model },
    { id: "folder", label: t("ctxRowFolder"), value: configured, ...(reported ? { detail: fill(t("ctxFolderLast"), { path: reported }) } : {}) },
    { id: "tools", label: t("ctxRowTools"), value: tools },
    { id: "connectors", label: t("ctxRowConnectors"), value: connectors },
    { id: "memory", label: t("ctxRowMemory"), value: memory },
    { id: "skills", label: t("ctxRowSkills"), value: skills },
    { id: "closed", label: t("ctxRowClosed"), value: t(connection.runner ? "ctxClosedRunner" : offline ? "ctxClosedNoHarness" : "ctxClosedLocal") },
  ];
}
