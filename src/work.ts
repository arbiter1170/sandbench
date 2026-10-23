import { botWithDefaultProfile } from "./testProfiles";
import type { Approval, ApprovalFile, ApprovalQuestion, Bot, BotFile, BotShape, BotVoice, Connector, Plugin, PointerAction, PointerKey, Routine, Settings, SkillId, Thread, WebhookTrigger } from "./types";

export const SHAPES: BotShape[] = ["pebble", "bean", "capsule", "gem", "hex"];
export const COLORS = ["#0c5f73", "#8d2348", "#1f4b3a", "#3d4a88", "#8a5a12", "#243044"];
export const SKILLS: SkillId[] = ["computer", "files", "reminders", "calendar", "mail"];

export const VOICES: { id: BotVoice; pitch: number; rate: number }[] = [
  { id: "cove", pitch: 1, rate: 1 },
  { id: "flint", pitch: 0.82, rate: 0.94 },
  { id: "lumen", pitch: 1.18, rate: 1.06 },
  { id: "nimbus", pitch: 0.92, rate: 0.88 },
];

export type ActionDraft = { app: string; action: string; cpu: number };

export type LibraryText = { name: string; text: string };

export type TurnPlan = {
  thinking: string[];
  actions: ActionDraft[];
  reply: string;
  command?: { text: string; reason: string };
  tool?: { connectorId: string; name: string; args: Record<string, unknown>; label: string; why: string };
  pointer?: { label: string; reason: string; pointer: PointerAction };
  step?: StepAction;
  reminder?: { title: string; at: number };
  trigger?: TriggerDraft;
};

export type TriggerDraft = { kind: "routine"; title: string; schedule: string } | { kind: "webhook"; name: string; title: string };

const SCHEDULE_PHRASE =
  "(?:every\\s+\\d+\\s*(?:minutes?|mins?|hours?|hrs?)|every\\s+hour|hourly|(?:every\\s+|each\\s+|on\\s+)?(?:weekdays?|weekends?|day|morning|evening|night|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)\\s+at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)";

export function proposeTrigger(text: string): TriggerDraft | undefined {
  const clean = text.replace(/@\S+\s*/g, "").trim();
  const hook = /\b(?:create|add|make|set up)\s+(?:a\s+)?webhook\s+(?:called\s+|named\s+)?["“']?([^"”',:]+?)["”']?\s*(?:that|to|which|:|,)\s+(.+)$/i.exec(clean);
  if (hook) return { kind: "webhook", name: hook[1].trim().slice(0, 80), title: taskTitle(hook[2]).slice(0, 400) };
  const lead = new RegExp(`^(?:please\\s+)?(${SCHEDULE_PHRASE})\\s*[,:]?\\s+(.{3,})$`, "i").exec(clean);
  const tail = lead ? null : new RegExp(`^(?:please\\s+)?(.{3,}?)\\s*,?\\s+(${SCHEDULE_PHRASE})\\s*[.!]?$`, "i").exec(clean);
  const schedule = lead?.[1] ?? tail?.[2];
  const task = lead?.[2] ?? tail?.[1];
  if (!schedule || !task || !parseSchedule(schedule)) return undefined;
  const title = taskTitle(task.replace(/^(?:please\s+)?(?:can you\s+)?/i, ""));
  return title ? { kind: "routine", title: title.slice(0, 240), schedule: schedule.trim() } : undefined;
}

function taskTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ").replace(/[?.!,]+$/, "");
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export const MAX_ACTIONS = 3;

export const POINTER_KEYS: PointerKey[] = ["enter", "tab", "escape", "up", "down", "left", "right", "space", "backspace"];

export type StepAction =
  | { kind: "command"; command: string; reason: string }
  | { kind: "tool"; connectorId: string; name: string; args: Record<string, unknown>; label: string; why: string }
  | { kind: "pointer"; pointer: PointerAction; label: string; reason: string }
  | { kind: "question"; question: ApprovalQuestion; label: string; reason: string }
  | { kind: "file"; file: ApprovalFile; label: string; reason: string };

export function actionLabel(action: StepAction): string {
  if (action.kind === "command") return action.command;
  if (action.kind === "tool") return `${action.label} ${JSON.stringify(action.args)}`;
  if (action.kind === "question") return `Question: ${action.question.prompt.slice(0, 80)}`;
  if (action.kind === "file") return `${action.file.op === "write" ? "Write" : "Delete"} ${action.file.path}`;
  return action.label;
}

export function proposeReminder(text: string, now = new Date()): TurnPlan["reminder"] {
  const match = /remind me (?:to |about )?(.+?)(?:\s+(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|\s+in\s+(\d+)\s*(minute|min|hour|hr)s?)?\s*[.!?]?$/i.exec(text.trim());
  if (!match?.[1]) return undefined;
  const at = new Date(now);
  if (match[5]) {
    at.setTime(now.getTime() + Number(match[5]) * (match[6].toLowerCase().startsWith("h") ? 3_600_000 : 60_000));
  } else if (match[2]) {
    let hour = Number(match[2]);
    const meridiem = match[4]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    at.setHours(hour, Number(match[3] ?? 0), 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  } else {
    at.setTime(now.getTime() + 3_600_000);
  }
  return { title: match[1].replace(/^@\S+\s*/, "").trim(), at: at.getTime() };
}

const TOOL_STOP = new Set(["the", "a", "an", "to", "for", "of", "and", "or", "in", "on", "with", "me", "my", "what", "whats", "is", "are", "this", "that", "please", "can", "you", "how", "do", "does", "show", "get", "list", "read", "from", "about"]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !TOOL_STOP.has(token));
}

function toolArgs(text: string, tool: Connector["tools"][number]): Record<string, unknown> | null {
  const repo = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(text)?.[1];
  const props = tool.schema?.properties ?? {};
  const keys = Object.keys(props);
  const args: Record<string, unknown> = {};
  if (keys.length === 0) {
    if (repo && /wiki|repo/i.test(`${tool.name} ${tool.description}`)) args.repoName = repo;
    else if (/question|ask/i.test(tool.name)) args.question = text.trim();
    return args;
  }
  for (const [key, spec] of Object.entries(props)) {
    if (spec.type && spec.type !== "string") continue;
    const name = key.toLowerCase();
    if (/repo|repository/.test(name) && repo) args[key] = repo;
    else if (/question|query|prompt|message|text|topic/.test(name) || name === "q") args[key] = text.trim();
  }
  const missing = (tool.schema?.required ?? []).filter((key) => args[key] === undefined);
  return missing.length > 0 ? null : args;
}

function toolScore(text: string, tool: Connector["tools"][number]): number {
  const hay = text.toLowerCase();
  const nameTokens = tool.name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !TOOL_STOP.has(token));
  let score = 0;
  for (const token of nameTokens) if (hay.includes(token)) score += 2;
  const seen = new Set(words(text));
  for (const token of words(tool.description)) if (seen.has(token)) score += 1;
  return score;
}

export function matchConnectorTool(text: string, connectors: Connector[]): TurnPlan["tool"] {
  const ranked = connectors
    .flatMap((connector) => connector.tools.map((tool) => ({ connector, tool, score: toolScore(text, tool) })))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || (ranked[1] && ranked[1].score >= best.score)) return undefined;
  const args = toolArgs(text, best.tool);
  if (!args) return undefined;
  return {
    connectorId: best.connector.id,
    name: best.tool.name,
    args,
    label: `${best.connector.name} · ${best.tool.name}`,
    why: best.tool.description.split("\n")[0]?.trim().slice(0, 180) || `Call ${best.tool.name}.`,
  };
}

export function proposeTool(text: string, connectors: Connector[]): TurnPlan["tool"] {
  const match = /^\/tool\s+([\w.-]+)\s*([\s\S]*)$/m.exec(text.trim());
  if (!match) return undefined;
  const connector = connectors.find((item) => item.tools.some((tool) => tool.name === match[1]));
  if (!connector) return undefined;
  const tool = connector.tools.find((item) => item.name === match[1]);
  let args: Record<string, unknown> = {};
  const raw = match[2].trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return {
    connectorId: connector.id,
    name: match[1],
    args,
    label: `${connector.name} · ${match[1]}`,
    why: tool?.description.split("\n")[0]?.trim().slice(0, 180) || "You asked to call this tool.",
  };
}

export function libraryNotes(library: LibraryText[], request: string): { names: string[]; body: string } | null {
  if (library.length === 0) return null;
  const lower = request.toLowerCase();
  const named = library.filter((file) => {
    const stem = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    return lower.includes(file.name.toLowerCase()) || (stem.length > 2 && lower.includes(stem));
  });
  const mentioned = /\b(file|files|notes|library|document|wrote|written)\b/.test(lower);
  const chosen = named.length > 0 ? named : mentioned ? library.slice(0, 3) : [];
  if (chosen.length === 0) return null;
  const body = chosen.map((file) => `From **${file.name}**:\n\n${file.text.trim().slice(0, 1500)}`).join("\n\n");
  return { names: chosen.map((file) => file.name), body };
}

function parseTable(output: string): { headers: string[]; rows: string[][] } | null {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const sep = lines.findIndex((line) => /^-+(\s+-+)*$/.test(line.trim()));
  if (sep < 1) return null;
  const headers = lines[sep - 1].trim().split(/\s{2,}/);
  const rows = lines
    .slice(sep + 1)
    .map((line) => line.trim().split(/\s{2,}/))
    .filter((row) => row.length >= Math.min(2, headers.length) && row.some((cell) => cell));
  return rows.length > 0 ? { headers, rows } : null;
}

function readOutput(command: string, output: string, exitCode?: number): string {
  const trimmed = output.trim();
  const head = command.trim().split(/\s+/)[0] ?? "";
  if (!trimmed) {
    if (/childitem|^dir$|^ls$/i.test(head)) return "The workspace folder is empty.";
    return exitCode && exitCode !== 0 ? `It finished with exit code ${exitCode} and no output.` : "It finished with no output.";
  }
  const table = parseTable(trimmed);
  const cpuIndex = table?.headers.findIndex((header) => /cpu/i.test(header)) ?? -1;
  if (table && cpuIndex >= 0) {
    const nameIndex = table.headers.findIndex((header) => /name|process/i.test(header));
    let best = table.rows[0];
    let bestCpu = -1;
    for (const row of table.rows) {
      const cpu = Number(row[cpuIndex]);
      if (Number.isFinite(cpu) && cpu > bestCpu) {
        bestCpu = cpu;
        best = row;
      }
    }
    const nameOf = (row: string[]) => row[nameIndex >= 0 ? nameIndex : 0] ?? row[0];
    const name = nameOf(best);
    const others = table.rows.filter((row) => nameOf(row) !== name).slice(0, 4).map(nameOf);
    const seconds = bestCpu >= 0 ? bestCpu.toLocaleString(undefined, { maximumFractionDigits: 0 }) : best[cpuIndex];
    return others.length > 0
      ? `${name} is using the most CPU (${seconds} seconds). After it: ${others.join(", ")}.`
      : `${name} is using the most CPU (${seconds} seconds).`;
  }
  if (/^get-date$/i.test(head)) {
    const line = trimmed.split(/\r?\n/).find((item) => item.trim() && !item.startsWith("stderr"));
    return `The clock on this computer says ${line?.trim()}.`;
  }
  if (/childitem|^dir$|^ls$/i.test(head)) {
    const names = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12);
    return `The folder contains: ${names.join(", ")}.`;
  }
  const preview = trimmed.split(/\r?\n/).slice(0, 14).join("\n");
  return exitCode && exitCode !== 0 ? `It exited with code ${exitCode}.\n\n${preview}` : preview;
}

export function interpretResult(input: { bot: Bot; label: string; output: string; exitCode?: number; failed?: boolean }): string {
  if (input.failed) return `**${input.bot.name}.** That did not run. ${input.output.trim() || "The computer returned an error."}`;
  if (input.label.startsWith("Question: ")) return `**${input.bot.name}.** Got it: ${input.output.trim() || "no answer"}.`;
  if (/^(Write|Delete) /.test(input.label)) return `**${input.bot.name}.** ${input.output.trim()}`;
  if (input.label.includes(" · ")) {
    const body = input.output.trim().slice(0, 1200) || "The tool returned nothing.";
    return `**${input.bot.name}.** From ${input.label.split(" {")[0]}:\n\n${body}`;
  }
  return `**${input.bot.name}.** ${readOutput(input.label, input.output, input.exitCode)}`;
}

export type TurnContext = {
  plugins: Plugin[];
  files: BotFile[];
  connectors: Connector[];
  harness: boolean;
  autoRun?: (command: string) => boolean;
  library?: LibraryText[];
  shared?: string;
};

export const BUILTIN_PLUGINS: Plugin[] = [
  {
    id: "plugin-brief",
    name: "Daily brief",
    summary: "Opens each morning reply with what changed since yesterday.",
    instructions: "Start replies to routines with a three line brief: done, blocked, next.",
    builtIn: true,
  },
  {
    id: "plugin-review",
    name: "Second look",
    summary: "Ends answers with the one thing most likely to be wrong.",
    instructions: "Close every answer with one line that names the weakest assumption.",
    builtIn: true,
  },
  {
    id: "plugin-diagram",
    name: "Diagrams",
    summary: "Draws flows as Mermaid diagrams when a process has steps.",
    instructions: "When describing a process with three or more steps, include a mermaid flowchart.",
    builtIn: true,
  },
  {
    id: "plugin-terse",
    name: "Terse mode",
    summary: "Keeps answers under eighty words.",
    instructions: "Keep the whole answer under eighty words.",
    builtIn: true,
  },
];

export type BotTemplate = {
  id: string;
  name: string;
  role: string;
  instructions: string;
  persona: string;
  color: string;
  shape: BotShape;
  voice: BotVoice;
  skills: SkillId[];
  plugins: string[];
  section?: string;
  preset?: Bot["preset"];
  model?: string;
  driver?: string;
  provider?: Bot["provider"];
  modelChoice?: Bot["modelChoice"];
};

/** Claude Code id for Opus 5.5 (verified via `claude --model opus`). */
export const REA_OPUS_MODEL = "claude-opus-5-5";
/** xAI API id for Grok 4.7. */
export const REA_GROK_MODEL = "grok-4.7";

export const REA_BOT_ID = "rea";

export const REA_INSTRUCTIONS = [
  "You guide reverse-engineering work with the REA method. This chat does not attach the REA MCP tool list; give clear next steps the operator can run in Cursor with REA, or via the CLI.",
  "Require a named app, installed artifact, or absolute file path before analysis. Paths from unrelated reports do not select the target. Ask when matches are ambiguous.",
  "Route by artifact: ASAR/JS tree → analyze_javascript_application; ZIP/APK/IPA/MSIX → open_binary / inspect_artifact; Android code → inspect_android_package; managed PE → inspect_managed_artifact; native PE/ELF → open_binary then focused tools; browser/Electron → list targets or capture_browser_scenario; HAR/SAZ → inspect_web_network_capture.",
  "Start summary-first. Prefer detail summary on large JavaScript or layout jobs, then page with inspect_analysis_view. Do not repeat an identical analysis without a changed input.",
  "Label every claim as observed, inferred, or unknown. Cite Evidence IDs when present. Static analysis never observed execution.",
  "Skip REA for ordinary source-repository architecture; use normal repository tools there.",
  "When tools are missing, diagnose registration vs provider vs restart; do not claim capabilities that are not available.",
].join(" ");

export const TEMPLATES: BotTemplate[] = [
  {
    id: "rea",
    name: "REA",
    role: "Reverse engineering",
    instructions: REA_INSTRUCTIONS,
    persona: "Evidence-first. Short. Separates observation from inference.",
    color: COLORS[3],
    shape: "hex",
    voice: "flint",
    skills: ["computer", "files"],
    plugins: ["plugin-review"],
    section: "REA",
    preset: "rea",
    model: REA_OPUS_MODEL,
    driver: "claude",
    modelChoice: "opus",
  },
  {
    id: "operator",
    name: "Operator",
    role: "Runs things on the computer",
    instructions: "Do the work on the computer when asked. Propose one command at a time and explain what it changes.",
    persona: "Precise. Reports exit codes and file paths.",
    color: COLORS[3],
    shape: "hex",
    voice: "flint",
    skills: ["computer", "files"],
    plugins: ["plugin-review"],
  },
  {
    id: "researcher",
    name: "Scout",
    role: "Research and summaries",
    instructions: "Gather what is known, separate facts from guesses, and cite where each fact came from.",
    persona: "Curious and careful with claims.",
    color: COLORS[0],
    shape: "bean",
    voice: "lumen",
    skills: ["files"],
    plugins: ["plugin-review", "plugin-diagram"],
  },
  {
    id: "scheduler",
    name: "Tempo",
    role: "Calendar, reminders, routines",
    instructions: "Keep the calendar honest. Turn loose requests into reminders with a time.",
    persona: "Warm and brisk.",
    color: COLORS[4],
    shape: "capsule",
    voice: "cove",
    skills: ["reminders", "calendar", "mail"],
    plugins: ["plugin-brief"],
  },
  {
    id: "writer",
    name: "Quill",
    role: "Drafts and edits",
    instructions: "Draft in the user's voice. Offer one tighter revision after each draft.",
    persona: "Plain words, short sentences.",
    color: COLORS[1],
    shape: "gem",
    voice: "nimbus",
    skills: ["files", "mail"],
    plugins: ["plugin-terse"],
  },
];

export function botFromTemplate(template: BotTemplate, primary: boolean): Bot {
  return {
    ...blankBot(template.name, template.role, primary),
    instructions: template.instructions,
    persona: template.persona,
    color: template.color,
    shape: template.shape,
    voice: template.voice,
    skills: [...template.skills],
    plugins: [...template.plugins],
    ...(template.section !== undefined ? { section: template.section } : {}),
    ...(template.preset ? { preset: template.preset } : {}),
    ...(template.model !== undefined ? { model: template.model } : {}),
    ...(template.driver !== undefined ? { driver: template.driver } : {}),
    ...(template.provider !== undefined ? { provider: template.provider } : {}),
    ...(template.modelChoice ? { modelChoice: template.modelChoice } : {}),
  };
}

/** Stable REA bot for the left rail. Same id every load so it is not duplicated. */
export function createReaBot(): Bot {
  const template = TEMPLATES.find((item) => item.id === "rea")!;
  return {
    ...botFromTemplate(template, false),
    id: REA_BOT_ID,
  };
}

export function applyReaModelChoice(choice: NonNullable<Bot["modelChoice"]>): Partial<Bot> {
  switch (choice) {
    case "opus":
      return {
        modelChoice: "opus",
        model: REA_OPUS_MODEL,
        driver: "claude",
        provider: undefined,
        testProfile: "claude-cli",
      };
    case "grok":
      return {
        modelChoice: "grok",
        model: REA_GROK_MODEL,
        driver: undefined,
        provider: undefined,
        testProfile: "xai",
      };
    case "composer":
      return {
        modelChoice: "composer",
        model: undefined,
        driver: undefined,
        provider: undefined,
      };
  }
}

const COMMAND_HINTS: { test: RegExp; command: string; reason: string }[] = [
  { test: /\b(list|show|what'?s in)\b.*\b(files|folder|directory|workspace)\b/, command: "Get-ChildItem", reason: "List the bot workspace folder." },
  { test: /\b(processes|running apps|what'?s running|task manager)\b/, command: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 Name, CPU", reason: "Read the busiest processes." },
  { test: /\b(disk|drive|storage) (space|usage|free)\b/, command: "Get-PSDrive -PSProvider FileSystem", reason: "Read free space on each drive." },
  { test: /\bwhat (time|date|day) is it\b/, command: "Get-Date", reason: "Read the clock on this computer." },
  { test: /\b(where am i|working folder|current folder)\b/, command: "Get-Location", reason: "Show the working folder." },
];

export function proposeCommand(text: string): { text: string; reason: string } | undefined {
  const fenced = /```(?:powershell|ps1|ps|sh|bash|shell)?\n([\s\S]+?)```/.exec(text);
  if (fenced?.[1]?.trim()) return { text: fenced[1].trim(), reason: "Run the command you wrote." };
  const inline = /\brun\s+`([^`]+)`/i.exec(text);
  if (inline?.[1]?.trim()) return { text: inline[1].trim(), reason: "Run the command you named." };
  const lower = text.toLowerCase();
  const hit = COMMAND_HINTS.find((item) => item.test.test(lower));
  return hit ? { text: hit.command, reason: hit.reason } : undefined;
}

export function proposePointer(text: string): Extract<StepAction, { kind: "pointer" }> | undefined {
  const click = /\bclick(?:\s+at)?\s+(\d{1,5})\s*[, ]\s*(\d{1,5})\b/i.exec(text);
  if (click) {
    const x = Number(click[1]);
    const y = Number(click[2]);
    return { kind: "pointer", pointer: { action: "click", x, y }, label: `Click ${x}, ${y}`, reason: "Click that point on the primary screen, in pixels from the top left." };
  }
  const typed = /\btype\s+(?:"([^"]{1,400})"|'([^']{1,400})')/i.exec(text);
  if (typed) {
    const value = (typed[1] ?? typed[2]).slice(0, 400);
    return { kind: "pointer", pointer: { action: "type", text: value }, label: `Type “${value}”`, reason: "Type this into the window that currently has focus." };
  }
  const key = new RegExp(`\\bpress\\s+(${POINTER_KEYS.join("|")})\\b`, "i").exec(text);
  if (key) {
    const name = key[1].toLowerCase() as PointerKey;
    return { kind: "pointer", pointer: { action: "key", key: name }, label: `Press ${name}`, reason: "Press that key in the window that currently has focus." };
  }
  return undefined;
}

function toolStep(tool: NonNullable<TurnPlan["tool"]>): StepAction {
  return { kind: "tool", connectorId: tool.connectorId, name: tool.name, args: tool.args, label: tool.label, why: tool.why };
}

export type Answer = { label: string; output: string };

export function safeWorkspacePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!cleaned || cleaned.length > 240) return null;
  if (cleaned.startsWith("/") || /^[a-z]:/i.test(cleaned)) return null;
  if (cleaned.split("/").some((part) => part === ".." || part === "")) return null;
  return cleaned;
}

export function questionStep(prompt: string, options: string[] = [], multi = false, reason = "I need your answer before I continue."): Extract<StepAction, { kind: "question" }> {
  const text = prompt.trim().replace(/\s+/g, " ").slice(0, 200);
  const question: ApprovalQuestion = { prompt: text };
  const cleaned = options.map((item) => item.trim()).filter((item) => item && item.length <= 80).slice(0, 8);
  if (cleaned.length >= 2) {
    question.options = cleaned.map((label, index) => ({ id: `opt${index + 1}`, label }));
    if (multi) question.multi = true;
  }
  return { kind: "question", question, label: `Question: ${text.slice(0, 80)}`, reason };
}

export function fileStep(target: string, op: "write" | "delete", content: string, reason: string): Extract<StepAction, { kind: "file" }> {
  const file: ApprovalFile = { path: target, op, preview: op === "write" ? content.slice(0, 200_000) : "" };
  return { kind: "file", file, label: `${op === "write" ? "Write" : "Delete"} ${target}`, reason };
}

function splitChoices(text: string): string[] {
  return text
    .replace(/[?.!]+$/, "")
    .split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i)
    .map((item) => item.trim().replace(/^["'`]|["'`]$/g, ""))
    .filter(Boolean);
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}?`;
}

export function proposeQuestion(text: string): Extract<StepAction, { kind: "question" }> | undefined {
  const trimmed = text.trim();
  const choices = /\bask me\s+((?:which|what|whether|how|who|when)\b[^:?]*?)\s*(?::|\u2014|\s-\s|\bfrom\b|\bbetween\b)\s*(.+)$/i.exec(trimmed);
  if (choices) {
    const options = splitChoices(choices[2]);
    if (options.length >= 2) return questionStep(sentence(choices[1]), options, /\b(which ones|any of|all that apply)\b/i.test(trimmed), "You asked me to check with you.");
  }
  const open = /\bask me\s+((?:which|what|whether|how|who|when)\b[^?]{3,160})\??$/i.exec(trimmed);
  if (open) return questionStep(sentence(open[1]), [], false, "You asked me to check with you.");
  return undefined;
}

const FILE_NAME = "`?([\\w][\\w./-]*\\.[A-Za-z0-9]{1,8})`?";

export function proposeFile(text: string, answers: Answer[] = []): StepAction | undefined {
  const trimmed = text.trim();
  const remove = new RegExp(`\\b(?:delete|remove)\\s+(?:the\\s+)?(?:file\\s+)?${FILE_NAME}`, "i").exec(trimmed);
  if (remove) {
    const target = safeWorkspacePath(remove[1]);
    return target ? fileStep(target, "delete", "", "Delete this file from the workspace folder.") : undefined;
  }
  const writeTo = new RegExp(`\\b(?:write|put|save)\\s+(?:"([^"]+)"|'([^']+)')\\s+(?:to|into|in)\\s+(?:a\\s+)?(?:file\\s+)?(?:named\\s+|called\\s+)?${FILE_NAME}`, "i").exec(trimmed);
  if (writeTo) {
    const target = safeWorkspacePath(writeTo[3]);
    return target ? fileStep(target, "write", (writeTo[1] ?? writeTo[2]).replace(/\\n/g, "\n"), "Write this text into the workspace folder.") : undefined;
  }
  const create = new RegExp(
    `\\b(?:create|make|write|save)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:new\\s+)?(?:file\\s+)?(?:named\\s+|called\\s+)?${FILE_NAME}(?:\\s+(?:with|containing|that says|saying)\\s+(?:"([^"]*)"|'([^']*)'|(.+)))?`,
    "i",
  ).exec(trimmed);
  if (!create) return undefined;
  const target = safeWorkspacePath(create[1]);
  if (!target) return undefined;
  const given = create[2] ?? create[3] ?? create[4]?.trim();
  if (given) return fileStep(target, "write", given.replace(/\\n/g, "\n"), "Create this file in the workspace folder.");
  const ask = questionStep(`What should ${target} say?`, [], false, `I need the text before I can create ${target}.`);
  const answered = answers.find((item) => item.label === ask.label);
  if (answered?.output.trim()) return fileStep(target, "write", answered.output, "Create this file with what you wrote.");
  return ask;
}

export function actionForText(bot: Bot, text: string, connectors: Connector[], answers: Answer[] = []): StepAction | undefined {
  const mine = connectors.filter((item) => (bot.connectorIds ?? []).includes(item.id));
  const explicit = proposeTool(text, mine);
  if (explicit) return toolStep(explicit);
  const question = proposeQuestion(text);
  if (question) return question;
  if (bot.skills.includes("computer") || bot.skills.includes("files")) {
    const file = proposeFile(text, answers);
    if (file) return file;
  }
  if (bot.skills.includes("computer")) {
    const pointer = proposePointer(text);
    if (pointer) return pointer;
    const command = proposeCommand(text);
    if (command) return { kind: "command", command: command.text, reason: command.reason };
  }
  const tool = matchConnectorTool(text, mine);
  return tool ? toolStep(tool) : undefined;
}

export function clauseActions(bot: Bot, text: string, connectors: Connector[], answers: Answer[] = []): StepAction[] {
  const parts = text.split(/\s+(?:and then|then|after that|and also)\s+/i).map((part) => part.trim()).filter(Boolean);
  const actions: StepAction[] = [];
  for (const clause of parts.length > 0 ? parts : [text]) {
    const action = actionForText(bot, clause, connectors, answers);
    if (!action || actions.some((item) => actionLabel(item) === actionLabel(action))) continue;
    actions.push(action);
  }
  return actions;
}

export function nextLocalAction(bot: Bot, request: string, finished: Answer[], connectors: Connector[]): StepAction | undefined {
  const done = finished.map((item) => item.label);
  return clauseActions(bot, request, connectors, finished).find((action) => !done.includes(actionLabel(action)));
}

export function guardAction(bot: Bot, action: StepAction | undefined): StepAction | undefined {
  if (!action) return undefined;
  if ((action.kind === "command" || action.kind === "pointer") && !bot.skills.includes("computer")) return undefined;
  if (action.kind === "file" && !bot.skills.includes("computer") && !bot.skills.includes("files")) return undefined;
  return action;
}

export function planAction(plan: TurnPlan): StepAction | undefined {
  if (plan.step) return plan.step;
  if (plan.tool) return { kind: "tool", connectorId: plan.tool.connectorId, name: plan.tool.name, args: plan.tool.args, label: plan.tool.label, why: plan.tool.why };
  if (plan.pointer) return { kind: "pointer", pointer: plan.pointer.pointer, label: plan.pointer.label, reason: plan.pointer.reason };
  if (plan.command) return { kind: "command", command: plan.command.text, reason: plan.command.reason };
  return undefined;
}

export function needsHarness(action: StepAction): boolean {
  return action.kind !== "question";
}

export function lineDiff(previous: string, next: string): string {
  const before = previous.split(/\r?\n/);
  const after = next.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      out.push(`  ${before[i]}`);
      i += 1;
      j += 1;
    } else if (j < after.length && !before.slice(i).includes(after[j])) {
      out.push(`+ ${after[j]}`);
      j += 1;
    } else if (i < before.length) {
      out.push(`- ${before[i]}`);
      i += 1;
    } else {
      out.push(`+ ${after[j]}`);
      j += 1;
    }
    if (out.length > 400) {
      out.push("…");
      break;
    }
  }
  return out.join("\n");
}

export function approvalFields(action: StepAction): Pick<Approval, "command" | "reason" | "tool" | "pointer" | "question" | "file"> {
  if (action.kind === "command") return { command: action.command, reason: action.reason };
  if (action.kind === "tool") {
    return { command: actionLabel(action), reason: action.why, tool: { connectorId: action.connectorId, name: action.name, args: action.args } };
  }
  if (action.kind === "question") return { command: action.label, reason: action.reason, question: action.question };
  if (action.kind === "file") return { command: action.label, reason: action.reason, file: action.file };
  return { command: action.label, reason: action.reason, pointer: action.pointer };
}

export function continuationText(previous: string, action: StepAction, auto: boolean): string {
  const line =
    action.kind === "command"
      ? auto
        ? `Running \`${action.command}\` now. ${action.reason}`
        : `Next I want to run \`${action.command}\`. ${action.reason} Approve it on the card.`
      : action.kind === "tool"
        ? `Next I want to call **${action.label}**. ${action.why} Approve it on the card.`
        : action.kind === "question"
          ? `Next I need your answer: **${action.question.prompt}**`
          : action.kind === "file"
            ? `Next I want to **${action.file.op}** \`${action.file.path}\`. Approve it on the card.`
            : `Next: **${action.label}**. ${action.reason} Approve it on the card.`;
  return `${previous}\n\n${line}`;
}

function pointInRange(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 20_000;
}

function parseTrigger(value: unknown): TriggerDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const title = typeof item.title === "string" ? taskTitle(item.title).slice(0, 400) : "";
  if (!title) return undefined;
  if (typeof item.schedule === "string" && parseSchedule(item.schedule)) return { kind: "routine", title: title.slice(0, 240), schedule: item.schedule.trim().slice(0, 80) };
  if (typeof item.webhook === "string" && item.webhook.trim()) return { kind: "webhook", name: item.webhook.trim().slice(0, 80), title };
  return undefined;
}

export function parseModelDecision(raw: string, connectors: Connector[]): { answer: string; action?: StepAction; trigger?: TriggerDraft } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const answer = typeof record.answer === "string" ? record.answer.trim() : "";
  if (!answer) return null;
  if (record.action != null && (typeof record.action !== "object" || Array.isArray(record.action))) return null;
  const action = record.action == null ? undefined : decisionAction(record.action as Record<string, unknown>, connectors);
  const trigger = parseTrigger(record.trigger);
  return { answer, ...(action ? { action } : {}), ...(trigger ? { trigger } : {}) };
}

function decisionAction(act: Record<string, unknown>, connectors: Connector[]): StepAction | undefined {
  const reason = typeof act.reason === "string" && act.reason.trim() ? act.reason.trim().slice(0, 240) : "The model asked for this step.";
  if (act.kind === "command" && typeof act.command === "string" && act.command.trim()) {
    return { kind: "command", command: act.command.trim().slice(0, 400), reason };
  }
  if (act.kind === "tool" && typeof act.name === "string") {
    const connector = connectors.find((item) => item.tools.some((tool) => tool.name === act.name));
    const tool = connector?.tools.find((item) => item.name === act.name);
    if (!connector || !tool) return undefined;
    const args = act.args && typeof act.args === "object" && !Array.isArray(act.args) ? (act.args as Record<string, unknown>) : {};
    return { kind: "tool", connectorId: connector.id, name: tool.name, args, label: `${connector.name} · ${tool.name}`, why: reason };
  }
  if (act.kind === "click" && pointInRange(act.x) && pointInRange(act.y)) {
    return { kind: "pointer", pointer: { action: "click", x: act.x, y: act.y }, label: `Click ${act.x}, ${act.y}`, reason };
  }
  if (act.kind === "type" && typeof act.text === "string" && act.text.trim()) {
    const value = act.text.slice(0, 400);
    return { kind: "pointer", pointer: { action: "type", text: value }, label: `Type “${value}”`, reason };
  }
  if (act.kind === "key" && typeof act.key === "string" && POINTER_KEYS.includes(act.key.toLowerCase() as PointerKey)) {
    const name = act.key.toLowerCase() as PointerKey;
    return { kind: "pointer", pointer: { action: "key", key: name }, label: `Press ${name}`, reason };
  }
  if (act.kind === "question" && typeof act.prompt === "string" && act.prompt.trim()) {
    const options = Array.isArray(act.options) ? act.options.filter((item): item is string => typeof item === "string") : [];
    return questionStep(act.prompt, options, act.multi === true, reason);
  }
  if (act.kind === "file") {
    const target = safeWorkspacePath(act.path);
    if (!target) return undefined;
    if (act.op === "delete") return fileStep(target, "delete", "", reason);
    if (typeof act.content === "string") return fileStep(target, "write", act.content, reason);
  }
  return undefined;
}

export function decisionPrompt(input: {
  bot: Bot;
  request: string;
  connectors: Connector[];
  allow: string[];
  library: LibraryText[];
  pluginLines: string[];
  finished: { label: string; output: string }[];
  shared?: string;
}): string {
  const tools = input.connectors.flatMap((connector) =>
    connector.tools.map((tool) => `- ${tool.name} on ${connector.name}: ${tool.description.split("\n")[0]?.slice(0, 180) ?? ""} args ${JSON.stringify(tool.schema ?? {})}`),
  );
  const done = input.finished.map((item) => `Ran: ${item.label}\nOutput:\n${item.output.slice(0, 2000)}`).join("\n\n");
  return [
    `You are ${input.bot.name}, ${input.bot.role}.`,
    `Instructions:\n${input.bot.instructions}`,
    `Persona:\n${input.bot.persona}`,
    input.shared?.trim() ? `Shared instructions for this group chat:\n${input.shared.trim()}` : "",
    input.pluginLines.length ? `Plugins:\n${input.pluginLines.map((line) => `- ${line}`).join("\n")}` : "",
    input.bot.memories.length ? `Memories:\n${input.bot.memories.map((item) => `- ${item}`).join("\n")}` : "",
    input.library.length ? `Files:\n${input.library.map((file) => `## ${file.name}\n${file.text.slice(0, 2000)}`).join("\n\n")}` : "",
    tools.length ? `Connector tools:\n${tools.join("\n")}` : "No connector tools are available.",
    `PowerShell may run in the workspace after the user approves. These first words can run without a prompt when the command has no pipes or redirects: ${input.allow.join(", ") || "(none)"}.`,
    "Pointer actions (click, type, key) always wait for approval. Propose a click only when the user gave pixel coordinates. Do not invent a point.",
    "File changes stay inside the workspace folder, use a relative path, and wait for approval. Ask the person a question when the request leaves a real choice open.",
    done ? `Already finished this turn:\n${done}` : "Nothing has run yet for this request.",
    `User request:\n${input.request}`,
    "Reply with one JSON object and no other text.",
    'If you can answer now: {"answer":"the answer","action":null}',
    'Otherwise one next action: {"answer":"what you learned and what you will do next","action":{"kind":"command","command":"Get-Date","reason":"why"}}',
    'Tool: {"kind":"tool","name":"tool_name","args":{},"reason":"why"}',
    'Click: {"kind":"click","x":0,"y":0,"reason":"why"}  Type: {"kind":"type","text":"...","reason":"why"}  Key: {"kind":"key","key":"enter","reason":"why"}',
    'Question: {"kind":"question","prompt":"Which one?","options":["A","B"],"multi":false,"reason":"why"}  (options may be empty for a free-text answer)',
    'File: {"kind":"file","path":"notes/today.md","op":"write","content":"...","reason":"why"}  or {"kind":"file","path":"old.txt","op":"delete","reason":"why"}',
    'When the person asks for something that repeats or reacts to deliveries, add a top-level "trigger" next to "answer": {"schedule":"weekdays at 9:00","title":"what to do"} or {"webhook":"name","title":"what to do with each delivery"}. Schedules look like "every 30 minutes", "hourly", or "weekdays at 9:00".',
    "One action only. Stop when the output already answers the request.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseSchedule(schedule: string): { kind: "every"; minutes: number } | { kind: "at"; hour: number; minute: number; days: number[] } | null {
  const text = schedule.trim().toLowerCase();
  const every = /every\s+(\d+)\s*(minute|min|hour|hr)s?/.exec(text);
  if (every) return { kind: "every", minutes: Number(every[1]) * (every[2].startsWith("h") ? 60 : 1) };
  if (/^hourly$|every hour/.test(text)) return { kind: "every", minutes: 60 };
  const at = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(text);
  if (!at) return null;
  let hour = Number(at[1]);
  const minute = Number(at[2] ?? 0);
  if (at[3] === "pm" && hour < 12) hour += 12;
  if (at[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let days = [0, 1, 2, 3, 4, 5, 6];
  if (/weekday/.test(text)) days = [1, 2, 3, 4, 5];
  else if (/weekend/.test(text)) days = [0, 6];
  else {
    const named = names.map((name, index) => (text.includes(name) ? index : -1)).filter((index) => index >= 0);
    if (named.length > 0) days = named;
  }
  return { kind: "at", hour, minute, days };
}

export function routineDue(schedule: string, lastRunAt: number | undefined, now: Date): boolean {
  const parsed = parseSchedule(schedule);
  if (!parsed) return false;
  const last = lastRunAt ?? 0;
  if (parsed.kind === "every") return now.getTime() - last >= parsed.minutes * 60_000;
  if (!parsed.days.includes(now.getDay())) return false;
  const slot = new Date(now);
  slot.setHours(parsed.hour, parsed.minute, 0, 0);
  return now.getTime() >= slot.getTime() && now.getTime() - slot.getTime() < 10 * 60_000 && last < slot.getTime();
}

const SECRET_PATTERN = /\b(xai-[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g;

export function scrubSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[removed]");
}

export function teamToMarkdown(bots: Bot[], plugins: Plugin[]): string {
  const lines = ["# Sandbench team", "", "Exported without chats, files, memories, secrets, or computer access.", ""];
  for (const bot of bots) {
    lines.push(
      `## ${bot.name}`,
      `- role: ${bot.role}`,
      `- color: ${bot.color}`,
      `- shape: ${bot.shape}`,
      `- voice: ${bot.voice}`,
      `- skills: ${bot.skills.join(", ")}`,
      `- plugins: ${(bot.plugins ?? []).map((id) => plugins.find((item) => item.id === id)?.name ?? id).join(", ")}`,
      "",
      "### Instructions",
      scrubSecrets(bot.instructions),
      "",
      "### Persona",
      scrubSecrets(bot.persona),
      "",
    );
  }
  return lines.join("\n");
}

export function teamFromMarkdown(text: string, plugins: Plugin[]): Bot[] {
  const chunks = text.split(/^## /m).slice(1);
  return chunks.map((chunk) => {
    const [head, ...rest] = chunk.split("\n");
    const body = rest.join("\n");
    const field = (key: string) => new RegExp(`^- ${key}:\\s*(.*)$`, "m").exec(body)?.[1]?.trim() ?? "";
    const section = (key: string) => new RegExp(`### ${key}\\n([\\s\\S]*?)(?=\\n### |$)`).exec(body)?.[1]?.trim() ?? "";
    const bot = blankBot(head.trim(), field("role"), false);
    const shape = field("shape") as BotShape;
    const voice = field("voice") as BotVoice;
    const color = field("color");
    return {
      ...bot,
      instructions: scrubSecrets(section("Instructions")) || bot.instructions,
      persona: scrubSecrets(section("Persona")) || bot.persona,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : bot.color,
      shape: SHAPES.includes(shape) ? shape : bot.shape,
      voice: VOICES.some((item) => item.id === voice) ? voice : bot.voice,
      skills: field("skills").split(",").map((item) => item.trim()).filter((item): item is SkillId => SKILLS.includes(item as SkillId)),
      plugins: field("plugins")
        .split(",")
        .map((name) => plugins.find((item) => item.name.toLowerCase() === name.trim().toLowerCase())?.id)
        .filter((id): id is string => Boolean(id)),
    };
  });
}

/** Subset of OpenMausBot BotMRR Markdown → Sandbench bots + optional channel. */
export function openMausTeamFromMarkdown(text: string): { bots: Bot[]; channelTitle?: string; sharedInstructions?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const front = match?.[1] ?? "";
  const body = match?.[2] ?? text;
  const title = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const tagline = /^tagline:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const summary = /^summary:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const bots: Bot[] = [];
  let current: { name: string; role: string; instructions: string; color?: string } | null = null;
  let inAgents = false;
  const flush = () => {
    if (!current?.name) {
      current = null;
      return;
    }
    const bot = blankBot(current.name, current.role || "Teammate", bots.length === 0);
    bot.instructions = scrubSecrets(current.instructions) || bot.instructions;
    if (current.color && /^#[0-9a-f]{6}$/i.test(current.color)) bot.color = current.color;
    bots.push(bot);
    current = null;
  };
  for (const line of front.split(/\r?\n/)) {
    if (/^agents:\s*$/.test(line.trim())) {
      inAgents = true;
      continue;
    }
    if (inAgents && /^[a-zA-Z]/.test(line) && !line.startsWith(" ") && !line.startsWith("\t") && !line.trim().startsWith("-")) {
      flush();
      inAgents = false;
      continue;
    }
    if (!inAgents) continue;
    const start = /^\s*-\s+(?:key|name):\s*(.+)$/.exec(line);
    if (start) {
      flush();
      const raw = start[1].trim().replace(/^["']|["']$/g, "");
      current = { name: raw, role: "Teammate", instructions: "" };
      continue;
    }
    if (!current) continue;
    const name = /^\s+name:\s*(.+)$/.exec(line);
    if (name) current.name = name[1].trim().replace(/^["']|["']$/g, "");
    const role = /^\s+title:\s*(.+)$/.exec(line);
    if (role) current.role = role[1].trim().replace(/^["']|["']$/g, "");
    const desc = /^\s+description:\s*(.+)$/.exec(line);
    if (desc) current.instructions = desc[1].trim().replace(/^["']|["']$/g, "");
    const color = /^\s+color:\s*(.+)$/.exec(line);
    if (color) {
      const c = color[1].trim().replace(/^["']|["']$/g, "");
      current.color = c.startsWith("#") ? c : undefined;
    }
  }
  flush();
  if (!bots.length) {
    const fromMd = teamFromMarkdown(body, []);
    if (fromMd.length) return { bots: fromMd, channelTitle: title, sharedInstructions: tagline || summary };
  }
  return { bots, channelTitle: title, sharedInstructions: tagline || summary };
}

const SKILL_WORDS: Record<SkillId, string[]> = {
  computer: ["run", "command", "terminal", "process", "install", "screen", "click", "computer", "powershell", "build"],
  files: ["file", "folder", "write", "save", "notes", "delete", "directory"],
  reminders: ["remind", "reminder", "alarm", "timer", "later", "tomorrow"],
  calendar: ["calendar", "meeting", "schedule", "event", "agenda", "week"],
  mail: ["mail", "email", "inbox", "reply", "draft"],
};

export function routeLocally(members: Bot[], text: string): { bot: Bot; reason: string } | undefined {
  const asked = new Set(words(text));
  let best: { bot: Bot; score: number; hits: string[] } | undefined;
  let tie = false;
  for (const bot of members) {
    const vocabulary = new Set([...words(`${bot.role} ${bot.instructions}`), ...bot.skills.flatMap((skill) => SKILL_WORDS[skill])]);
    const hits = [...asked].filter((word) => vocabulary.has(word));
    if (!best || hits.length > best.score) {
      best = { bot, score: hits.length, hits };
      tie = false;
    } else if (hits.length === best.score) {
      tie = true;
    }
  }
  if (!best || best.score === 0 || tie) return undefined;
  return { bot: best.bot, reason: `matched ${best.hits.slice(0, 4).join(", ")}` };
}

export function routePrompt(members: Bot[], text: string, shared?: string): string {
  return [
    "Pick the one teammate who should answer this group chat message.",
    shared?.trim() ? `Shared instructions for the group chat:\n${shared.trim()}` : "",
    `Teammates:\n${members.map((bot) => `- ${bot.name}: ${bot.role}. ${bot.instructions.slice(0, 200)}`).join("\n")}`,
    `Message:\n${text}`,
    'Reply with one JSON object and no other text: {"bot":"exact teammate name","reason":"short reason"}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseRoute(raw: string, members: Bot[]): { bot: Bot; reason: string } | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = record(JSON.parse(raw.slice(start, end + 1)));
    const name = text(parsed.bot, 80).trim().toLowerCase();
    const bot = members.find((item) => item.name.toLowerCase() === name);
    return bot ? { bot, reason: text(parsed.reason, 160).trim() || "the decision model picked it" } : undefined;
  } catch {
    return undefined;
  }
}

export function inFolder(action: StepAction | undefined, folder: string | undefined): StepAction | undefined {
  if (!action || action.kind !== "file" || !folder || action.file.path.startsWith(`${folder}/`)) return action;
  const target = safeWorkspacePath(`${folder}/${action.file.path}`);
  if (!target) return action;
  return { ...action, file: { ...action.file, path: target }, label: `${action.file.op === "delete" ? "Delete" : "Write"} ${target}` };
}

export const TEAM_FORMAT = "sandbench-team";

export type TeamPackage = {
  format: typeof TEAM_FORMAT;
  version: 1;
  exportedAt: string;
  bots: {
    ref: string;
    name: string;
    role: string;
    instructions: string;
    persona: string;
    color: string;
    shape: BotShape;
    voice: BotVoice;
    skills: SkillId[];
    model?: string;
    provider?: "xai" | "openai_compat" | "anthropic";
    driver?: string;
    plugins: string[];
    connectors: string[];
  }[];
  plugins: { ref: string; name: string; summary: string; instructions: string }[];
  connectors: { ref: string; name: string; host: string; headerKeys: string[] }[];
  channels: { name: string; members: string[]; sharedInstructions?: string; lead?: string; workingFolder?: string; autoRoute?: boolean }[];
  routines: { bot: string; title: string; schedule: string }[];
};

export type TeamApply = { bots: Bot[]; plugins: Plugin[]; connectors: Connector[]; channels: Thread[]; routines: Routine[] };

function urlHost(url: string): string {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? `${parsed.protocol}//${parsed.host}` : "";
  } catch {
    return "";
  }
}

export function teamToJson(input: { bots: Bot[]; plugins: Plugin[]; connectors: Connector[]; channels: Thread[]; routines: Routine[] }): string {
  const botRef = new Map(input.bots.map((bot, index) => [bot.id, `bot-${index + 1}`]));
  const custom = input.plugins.filter((plugin) => !plugin.builtIn);
  const pluginRef = (id: string) => (BUILTIN_PLUGINS.some((item) => item.id === id) ? `builtin:${id}` : custom.some((item) => item.id === id) ? `plugin-${custom.findIndex((item) => item.id === id) + 1}` : "");
  const used = new Set(input.bots.flatMap((bot) => bot.connectorIds ?? []));
  const connectors = input.connectors.filter((item) => used.has(item.id));
  const connectorRef = new Map(connectors.map((item, index) => [item.id, `connector-${index + 1}`]));
  const pack: TeamPackage = {
    format: TEAM_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    bots: input.bots.map((bot) => ({
      ref: botRef.get(bot.id) ?? "",
      name: bot.name,
      role: bot.role,
      instructions: scrubSecrets(bot.instructions),
      persona: scrubSecrets(bot.persona),
      color: bot.color,
      shape: bot.shape,
      voice: bot.voice,
      skills: bot.skills,
      ...(bot.model ? { model: bot.model } : {}),
      ...(bot.provider ? { provider: bot.provider } : {}),
      ...(bot.driver ? { driver: bot.driver } : {}),
      plugins: (bot.plugins ?? []).map(pluginRef).filter(Boolean),
      connectors: (bot.connectorIds ?? []).map((id) => connectorRef.get(id) ?? "").filter(Boolean),
    })),
    plugins: custom
      .filter((plugin) => input.bots.some((bot) => (bot.plugins ?? []).includes(plugin.id)))
      .map((plugin) => ({ ref: pluginRef(plugin.id), name: plugin.name, summary: scrubSecrets(plugin.summary), instructions: scrubSecrets(plugin.instructions) })),
    connectors: connectors.map((item) => ({
      ref: connectorRef.get(item.id) ?? "",
      name: item.name,
      host: urlHost(item.url),
      headerKeys: item.headers.map((header) => header.key.trim()).filter(Boolean),
    })),
    channels: input.channels
      .filter((thread) => thread.memberIds?.some((id) => botRef.has(id)))
      .map((thread) => ({
        name: thread.title,
        members: (thread.memberIds ?? []).map((id) => botRef.get(id) ?? "").filter(Boolean),
        ...(thread.sharedInstructions?.trim() ? { sharedInstructions: scrubSecrets(thread.sharedInstructions) } : {}),
        ...(thread.leadBotId && botRef.has(thread.leadBotId) ? { lead: botRef.get(thread.leadBotId) } : {}),
        ...(thread.workingFolder ? { workingFolder: thread.workingFolder } : {}),
        ...(thread.autoRoute ? { autoRoute: true } : {}),
      })),
    routines: input.routines
      .filter((routine) => botRef.has(routine.botId))
      .map((routine) => ({ bot: botRef.get(routine.botId) ?? "", title: scrubSecrets(routine.title), schedule: routine.schedule })),
  };
  return JSON.stringify(pack, null, 2);
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 200) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseTeamJson(raw: string): TeamPackage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = record(parsed);
  if (root.format !== TEAM_FORMAT || root.version !== 1) return null;
  const bots = list(root.bots).map(record).filter((bot) => text(bot.ref, 40) && text(bot.name, 80).trim());
  if (bots.length === 0) return null;
  const refs = new Set(bots.map((bot) => text(bot.ref, 40)));
  const strings = (value: unknown, limit: number) => list(value).filter((item): item is string => typeof item === "string").map((item) => item.slice(0, limit));
  return {
    format: TEAM_FORMAT,
    version: 1,
    exportedAt: text(root.exportedAt, 40),
    bots: bots.map((bot) => {
      const shape = text(bot.shape, 20) as BotShape;
      const voice = text(bot.voice, 20) as BotVoice;
      const color = text(bot.color, 7);
      return {
        ref: text(bot.ref, 40),
        name: text(bot.name, 80).trim(),
        role: text(bot.role, 120),
        instructions: scrubSecrets(text(bot.instructions, 8000)),
        persona: scrubSecrets(text(bot.persona, 4000)),
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[0],
        shape: SHAPES.includes(shape) ? shape : "pebble",
        voice: VOICES.some((item) => item.id === voice) ? voice : "cove",
        skills: strings(bot.skills, 20).filter((item): item is SkillId => SKILLS.includes(item as SkillId)),
        ...(text(bot.model, 80).trim() ? { model: text(bot.model, 80).trim() } : {}),
        ...(bot.provider === "openai_compat" ? { provider: "openai_compat" as const } : {}),
        ...(bot.provider === "anthropic" ? { provider: "anthropic" as const } : {}),
        ...(bot.driver === "http" || bot.driver === "claude" || bot.driver === "anthropic" ? { driver: bot.driver } : {}),
        plugins: strings(bot.plugins, 80),
        connectors: strings(bot.connectors, 40),
      };
    }),
    plugins: list(root.plugins)
      .map(record)
      .filter((plugin) => text(plugin.ref, 40) && text(plugin.name, 80).trim())
      .map((plugin) => ({ ref: text(plugin.ref, 40), name: text(plugin.name, 80), summary: scrubSecrets(text(plugin.summary, 400)), instructions: scrubSecrets(text(plugin.instructions, 4000)) })),
    connectors: list(root.connectors)
      .map(record)
      .filter((item) => text(item.ref, 40) && text(item.name, 80).trim())
      .map((item) => ({ ref: text(item.ref, 40), name: text(item.name, 80), host: urlHost(text(item.host, 300)), headerKeys: strings(item.headerKeys, 80).filter((key) => /^[A-Za-z0-9-]+$/.test(key)) })),
    channels: list(root.channels)
      .map(record)
      .map((item) => {
        const folder = safeWorkspacePath(item.workingFolder);
        return {
          name: text(item.name, 80).trim(),
          members: strings(item.members, 40).filter((ref) => refs.has(ref)),
          ...(text(item.sharedInstructions, 4000).trim() ? { sharedInstructions: scrubSecrets(text(item.sharedInstructions, 4000)) } : {}),
          ...(refs.has(text(item.lead, 40)) ? { lead: text(item.lead, 40) } : {}),
          ...(folder ? { workingFolder: folder } : {}),
          ...(item.autoRoute === true ? { autoRoute: true } : {}),
        };
      })
      .filter((item) => item.name && item.members.length > 0),
    routines: list(root.routines)
      .map(record)
      .map((item) => ({ bot: text(item.bot, 40), title: scrubSecrets(text(item.title, 240)).trim(), schedule: text(item.schedule, 80).trim() }))
      .filter((item) => refs.has(item.bot) && item.title && parseSchedule(item.schedule)),
  };
}

export function applyTeam(pack: TeamPackage, existing: Plugin[]): TeamApply {
  const botIds = new Map<string, string>(pack.bots.map((bot) => [bot.ref, crypto.randomUUID()]));
  const plugins: Plugin[] = [];
  const pluginIds = new Map<string, string>();
  for (const plugin of pack.plugins) {
    const same = existing.find((item) => item.name.toLowerCase() === plugin.name.toLowerCase() && item.instructions === plugin.instructions);
    if (same) {
      pluginIds.set(plugin.ref, same.id);
      continue;
    }
    const id = crypto.randomUUID();
    pluginIds.set(plugin.ref, id);
    plugins.push({ id, name: plugin.name, summary: plugin.summary, instructions: plugin.instructions, builtIn: false });
  }
  const connectorIds = new Map<string, string>(pack.connectors.map((item) => [item.ref, crypto.randomUUID()]));
  const connectors: Connector[] = pack.connectors.map((item) => ({
    id: connectorIds.get(item.ref) ?? crypto.randomUUID(),
    name: item.name,
    url: item.host ? `${item.host}/` : "",
    headers: item.headerKeys.map((key) => ({ key, value: "" })),
    status: "untested",
    serverName: "",
    tools: [],
    error: "",
    checkedAt: 0,
  }));
  const bots = pack.bots.map((item) => {
    const base = blankBot(item.name, item.role, false);
    return {
      ...base,
      id: botIds.get(item.ref) ?? base.id,
      instructions: item.instructions || base.instructions,
      persona: item.persona || base.persona,
      color: item.color,
      shape: item.shape,
      voice: item.voice,
      skills: item.skills,
      ...(item.model ? { model: item.model } : {}),
      ...(item.provider ? { provider: item.provider } : {}),
      ...(item.driver ? { driver: item.driver } : {}),
      plugins: item.plugins
        .map((ref) => (ref.startsWith("builtin:") ? BUILTIN_PLUGINS.find((plugin) => plugin.id === ref.slice(8))?.id : pluginIds.get(ref)))
        .filter((id): id is string => Boolean(id)),
      connectorIds: item.connectors.map((ref) => connectorIds.get(ref)).filter((id): id is string => Boolean(id)),
    };
  });
  const channels: Thread[] = pack.channels.map((item) => {
    const memberIds = item.members.map((ref) => botIds.get(ref)).filter((id): id is string => Boolean(id));
    return {
      id: crypto.randomUUID(),
      title: item.name,
      updatedAt: Date.now(),
      messages: [],
      botId: memberIds[0],
      memberIds,
      ...(item.sharedInstructions ? { sharedInstructions: item.sharedInstructions } : {}),
      ...(item.lead ? { leadBotId: botIds.get(item.lead) } : {}),
      ...(item.workingFolder ? { workingFolder: item.workingFolder } : {}),
      ...(item.autoRoute ? { autoRoute: true } : {}),
    };
  });
  const routines: Routine[] = pack.routines.map((item) => ({
    id: crypto.randomUUID(),
    botId: botIds.get(item.bot) ?? "",
    title: item.title,
    schedule: item.schedule,
    enabled: false,
    lastRunAt: Date.now(),
  }));
  return { bots, plugins, connectors, channels, routines };
}

export const MIGRATION_FORMAT = "sandbench-migration";

export type MigrationPackage = {
  format: typeof MIGRATION_FORMAT;
  version: 1;
  exportedAt: string;
  source?: { app: string; version?: string };
  bots: (TeamPackage["bots"][number] & { memories?: string[] })[];
  plugins: TeamPackage["plugins"];
  connectors: TeamPackage["connectors"];
  channels: TeamPackage["channels"];
  routines: TeamPackage["routines"];
  webhooks?: { bot: string; name: string; title: string }[];
  threads?: { bot?: string; title: string; messages: { role: "user" | "assistant"; text: string }[] }[];
  studio?: { autoApprove?: string[] };
};

export type MigrationApply = TeamApply & { threads: Thread[]; webhooks: WebhookTrigger[]; autoApprove?: string[] };

export function parseMigrationJson(raw: string): MigrationPackage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = record(parsed);
  if (root.format === MIGRATION_FORMAT && root.version === 1) {
    const team = parseTeamJson(raw);
    if (!team) return null;
    const bots = team.bots.map((bot, index) => {
      const src = list(root.bots).map(record)[index];
      const memories = list(src?.memories)
        .filter((item): item is string => typeof item === "string")
        .map((item) => scrubSecrets(item.slice(0, 2000)))
        .slice(0, 80);
      return { ...bot, ...(memories.length ? { memories } : {}) };
    });
    const source = record(root.source);
    return {
      format: MIGRATION_FORMAT,
      version: 1,
      exportedAt: text(root.exportedAt, 40),
      ...(text(source.app, 80) ? { source: { app: text(source.app, 80), ...(text(source.version, 40) ? { version: text(source.version, 40) } : {}) } } : {}),
      bots,
      plugins: team.plugins,
      connectors: team.connectors,
      channels: team.channels,
      routines: team.routines,
      webhooks: list(root.webhooks)
        .map(record)
        .map((item) => ({ bot: text(item.bot, 40), name: scrubSecrets(text(item.name, 80).trim()), title: scrubSecrets(text(item.title, 240).trim()) }))
        .filter((item) => item.bot && item.name && item.title),
      threads: list(root.threads)
        .map(record)
        .map((item) => ({
          bot: text(item.bot, 40) || undefined,
          title: text(item.title, 120).trim() || "Imported chat",
          messages: list(item.messages)
            .map(record)
            .map((msg) => ({
              role: msg.role === "assistant" ? ("assistant" as const) : ("user" as const),
              text: scrubSecrets(text(msg.text, 12_000).trim()),
            }))
            .filter((msg) => msg.text)
            .slice(0, 200),
        }))
        .filter((item) => item.messages.length > 0),
      studio: list(record(root.studio).autoApprove).length
        ? { autoApprove: list(record(root.studio).autoApprove).filter((item): item is string => typeof item === "string").slice(0, 40) }
        : undefined,
    };
  }
  const team = parseTeamJson(raw);
  if (!team) return null;
  return {
    format: MIGRATION_FORMAT,
    version: 1,
    exportedAt: team.exportedAt,
    bots: team.bots,
    plugins: team.plugins,
    connectors: team.connectors,
    channels: team.channels,
    routines: team.routines,
  };
}

export function applyMigration(pack: MigrationPackage, existing: Plugin[]): MigrationApply {
  const team = applyTeam({ format: TEAM_FORMAT, version: 1, exportedAt: pack.exportedAt, bots: pack.bots, plugins: pack.plugins, connectors: pack.connectors, channels: pack.channels, routines: pack.routines }, existing);
  const botIds = new Map(pack.bots.map((bot, index) => [bot.ref, team.bots[index]?.id]));
  team.bots = team.bots.map((bot, index) => {
    const src = pack.bots[index];
    return src?.memories?.length ? { ...bot, memories: src.memories.slice(0, 80) } : bot;
  });
  const threads: Thread[] = (pack.threads ?? []).flatMap((item) => {
    const botId = item.bot ? botIds.get(item.bot) : team.bots[0]?.id;
    if (!botId) return [];
    const now = Date.now();
    return [
      {
        id: crypto.randomUUID(),
        title: item.title.slice(0, 72),
        updatedAt: now,
        botId,
        messages: item.messages.map((message, index) => ({
          id: crypto.randomUUID(),
          role: message.role,
          text: message.text,
          createdAt: now + index,
          attachments: [],
          status: "done" as const,
          localStandIn: false,
          fresh: false,
          ...(message.role === "assistant" ? { authorBotId: botId } : {}),
        })),
      },
    ];
  });
  const webhooks: WebhookTrigger[] = (pack.webhooks ?? []).flatMap((item) => {
    const botId = botIds.get(item.bot) ?? team.bots[0]?.id;
    if (!botId) return [];
    return [{ id: crypto.randomUUID(), botId, name: item.name, title: item.title, enabled: false, createdAt: Date.now() }];
  });
  return { ...team, threads, webhooks, autoApprove: pack.studio?.autoApprove };
}

export function blankBot(name: string, role: string, primary: boolean, settings?: Settings): Bot {
  const base: Bot = {
    id: crypto.randomUUID(),
    name: name.trim() || "Teammate",
    role: role.trim() || "Teammate",
    instructions: "Answer in short paragraphs. Say when a step needs the computer. Keep notes in this browser.",
    persona: "Calm, specific, and brief.",
    soul: "Calm, specific, and brief.",
    color: COLORS[0],
    shape: "pebble",
    voice: "cove",
    primary,
    hidden: false,
    skills: ["computer", "reminders"],
    librarySkillIds: [],
    memories: [],
    section: "",
    lastThinking: [],
    createdAt: Date.now(),
    approvalMode: "ask",
    visibility: primary ? "team" : "team",
    usage: { turns: 0, charsIn: 0, charsOut: 0, commands: 0, since: Date.now() },
    soulHistory: [],
  };
  if (!settings?.defaultTestProfile) return base;
  return botWithDefaultProfile(base, settings);
}

export function planTurn(bot: Bot, input: string, context: TurnContext = { plugins: [], files: [], connectors: [], harness: false }): TurnPlan {
  const text = input.trim();
  const lower = text.toLowerCase();
  const plugins = context.plugins.filter((item) => (bot.plugins ?? []).includes(item.id));
  const files = context.files.filter((item) => item.botId === bot.id);
  const connectors = context.connectors.filter((item) => (bot.connectorIds ?? []).includes(item.id));
  const library = context.library ?? [];
  const notes = libraryNotes(library, text);
  const trigger = proposeTrigger(text);
  const steps = trigger ? [] : clauseActions(bot, text, connectors);
  const first = steps[0];
  const command = first?.kind === "command" ? { text: first.command, reason: first.reason } : undefined;
  const tool = first?.kind === "tool" ? { connectorId: first.connectorId, name: first.name, args: first.args, label: first.label, why: first.why } : undefined;
  const pointer = first?.kind === "pointer" ? { label: first.label, reason: first.reason, pointer: first.pointer } : undefined;
  const question = first?.kind === "question" ? first : undefined;
  const fileChange = first?.kind === "file" ? first : undefined;
  const thinking = [
    `Read the instructions for ${bot.name}.`,
    bot.instructions.trim()
      ? `Instruction in force: ${bot.instructions.trim().slice(0, 160)}`
      : "This teammate has no instructions yet.",
    `Speak in this persona: ${bot.persona.trim() || "plain and direct"}`,
  ];
  if (context.shared?.trim()) thinking.push(`Group chat instructions: ${context.shared.trim().slice(0, 160)}`);
  if (bot.memories.length > 0) {
    thinking.push(`Recall ${bot.memories.length} saved ${bot.memories.length === 1 ? "memory" : "memories"}.`);
  }
  for (const plugin of plugins) thinking.push(`Plugin ${plugin.name}: ${plugin.instructions}`);
  if (library.length > 0) thinking.push(`Read ${library.map((file) => file.name).join(", ")}.`);
  else if (files.length > 0) thinking.push(`Library has ${files.length} file${files.length === 1 ? "" : "s"}: ${files.slice(0, 4).map((item) => item.name).join(", ")}.`);
  if (connectors.length > 0) {
    const tools = connectors.flatMap((item) => item.tools.map((entry) => entry.name));
    thinking.push(`Connected: ${connectors.map((item) => item.name).join(", ")}${tools.length ? ` (${tools.join(", ")})` : ""}. A matching tool is proposed on its own.`);
  }
  const actions: ActionDraft[] = [];
  const reminder = !trigger && bot.skills.includes("reminders") ? proposeReminder(text.replace(/@\S+\s*/g, "")) : undefined;
  if (trigger?.kind === "routine") {
    thinking.push(`This repeats. Create a routine “${trigger.title}” on “${trigger.schedule}” instead of doing it once.`);
    actions.push({ app: "Triggers", action: `Created routine: ${trigger.title}`, cpu: 6 });
  } else if (trigger) {
    thinking.push(`Create a webhook “${trigger.name}”. Each delivery asks me to: ${trigger.title}`);
    actions.push({ app: "Triggers", action: `Created webhook: ${trigger.name}`, cpu: 6 });
  }
  if (reminder) {
    const when = new Date(reminder.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    thinking.push(`Set a reminder: “${reminder.title}” for ${when}.`);
    actions.push({ app: "Reminders", action: `Added “${reminder.title}” for ${when}`, cpu: 8 });
  } else if (/remind|alarm|timer/.test(lower) && bot.skills.includes("reminders")) {
    thinking.push("This belongs with reminders.");
    actions.push({ app: "Reminders", action: "Checked open reminders", cpu: 8 });
  }
  if (/calendar|schedule|meeting/.test(lower) && bot.skills.includes("calendar")) {
    thinking.push("Check the calendar before answering.");
    actions.push({ app: "Calendar", action: "Read today's events", cpu: 12 });
  }
  if (/mail|email|inbox/.test(lower) && bot.skills.includes("mail")) {
    thinking.push("Look at mail, then answer.");
    actions.push({ app: "Mail", action: "Scanned the local note of the inbox", cpu: 10 });
  }
  if (/file|code|script|terminal|function|folder/.test(lower)) {
    thinking.push("This needs files and a terminal on the shared computer.");
    if (bot.skills.includes("files")) {
      actions.push({ app: "Files", action: "Listed the working folder", cpu: 16 });
    }
    if (bot.skills.includes("computer") && !command) {
      actions.push({ app: "Terminal", action: "Considered a command; none was clear enough to propose", cpu: 18 });
    }
  }
  if (steps.length > 1) thinking.push(`This request has ${steps.length} steps. First: ${actionLabel(steps[0])}.`);
  if (question) thinking.push(`Ask before acting: ${question.question.prompt}`);
  if (fileChange) {
    thinking.push(`Propose ${fileChange.label} and show it before anything is saved.`);
    actions.push({ app: "Files", action: `Proposed: ${fileChange.label}`, cpu: 10 });
  }
  if (pointer) {
    thinking.push(`Propose ${pointer.label} and wait for approval. Pointer actions are never automatic.`);
    actions.push({ app: "Screen", action: `Proposed: ${pointer.label}`, cpu: 14 });
  }
  if (tool) {
    thinking.push(`Call ${tool.label} with ${JSON.stringify(tool.args)} after approval.`);
    actions.push({ app: "Connector", action: `Proposed: ${tool.label}`, cpu: 12 });
  }
  if (command) {
    thinking.push(
      context.harness
        ? `Propose \`${command.text}\` and wait for approval before it runs.`
        : `This needs \`${command.text}\`, but the local harness is not running.`,
    );
    actions.push({ app: "Terminal", action: `Proposed: ${command.text}`, cpu: 22 });
  }
  if (actions.length === 0) {
    thinking.push("No computer action is required. Draft the reply.");
    actions.push({ app: "Browser", action: "Kept a note in the local session", cpu: 6 });
  } else {
    thinking.push("Record the computer session, then answer.");
  }

  const lines = [
    `**${bot.name}.** ${bot.persona.trim() || "Working from the instructions on this teammate."}`,
    "",
    bot.instructions.trim() ? `Following: ${bot.instructions.trim()}` : "No instruction is saved yet.",
    "",
    text ? `Request: ${text}` : "",
  ];
  if (/\b(code|function|typescript|javascript|react)\b/.test(lower)) {
    lines.push(
      "",
      "```ts",
      "export function echo(message: string) {",
      "  return message.trim();",
      "}",
      "```",
    );
  }
  if (plugins.some((item) => item.id === "plugin-diagram") || /\b(diagram|flow ?chart|steps)\b/.test(lower)) {
    lines.push("", "```mermaid", "flowchart LR", "  A[Request] --> B[Plan]", "  B --> C{Needs computer?}", "  C -- yes --> D[Ask approval]", "  C -- no --> E[Reply]", "  D --> E", "```");
  }
  if (notes) lines.push("", notes.body);
  if (reminder) {
    lines.push("", `Reminder set: **${reminder.title}**, ${new Date(reminder.at).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })}.`);
  }
  if (steps.length > 1) {
    lines.push("", `After it finishes I will ask for the next step: ${steps.slice(1).map((step) => actionLabel(step)).join(", then ")}.`);
  }
  if (trigger?.kind === "routine") {
    lines.push("", `Routine created: **${trigger.title}**, ${trigger.schedule}. Edit, pause, or undo it on the card below.`);
  } else if (trigger) {
    lines.push("", `Webhook created: **${trigger.name}**. Get its secret under Triggers. Pause or undo it on the card below.`);
  } else if (question) {
    lines.push("", `Before I go on: **${question.question.prompt}** Answer on the card below.`);
  } else if (fileChange) {
    lines.push(
      "",
      !context.harness
        ? `I would ${fileChange.file.op} \`${fileChange.file.path}\` here. Start the local harness with \`npm run harness\` to let me do it.`
        : `I want to ${fileChange.file.op} \`${fileChange.file.path}\` in the workspace folder. ${fileChange.reason} Check it on the card below.`,
    );
  } else if (pointer) {
    lines.push("", `I want to **${pointer.label}**. ${pointer.reason} Approve it on the card below.`);
  } else if (tool) {
    lines.push("", `I want to call **${tool.label}**. ${tool.why} Approve it on the card below.`);
  } else if (command) {
    lines.push(
      "",
      !context.harness
        ? `I would run \`${command.text}\` here. Start the local harness with \`npm run harness\` to let me do it.`
        : context.autoRun?.(command.text)
          ? `Running \`${command.text}\` now. ${command.reason} It is on your auto-review list.`
          : `I want to run \`${command.text}\`. ${command.reason} Approve it on the card below.`,
    );
  } else if (!reminder && !notes && !trigger) {
    lines.push("", "This reply was written in the browser without a model. Add an API key in Settings for real answers.");
  }
  if (plugins.some((item) => item.id === "plugin-review")) {
    lines.push(
      "",
      command
        ? `*Weakest assumption: that ${command.text.split(/\s+/)[0]} only reads state. Check the card before approving.*`
        : tool
          ? `*Weakest assumption: that ${tool.name} only reads data. Check what the connector can change.*`
          : pointer
            ? "*Weakest assumption: that the point lands on the window you expect. Check the card before approving.*"
            : fileChange
              ? `*Weakest assumption: that nothing else depends on ${fileChange.file.path}. Check the preview before approving.*`
              : "*Weakest assumption: that this answer needs nothing outside this browser.*",
    );
  }
  return { thinking, actions, reply: lines.filter((line) => line !== undefined).join("\n"), command, tool, pointer, step: first, reminder, trigger };
}

export async function playTurn(options: {
  plan: TurnPlan;
  instant: boolean;
  signal: AbortSignal;
  onThinking: (step: string) => void;
  onAction: (action: ActionDraft) => void;
}): Promise<void> {
  const gap = options.instant ? 0 : 220;
  for (let i = 0; i < options.plan.thinking.length; i += 1) {
    if (options.signal.aborted) throw new DOMException("Stopped.", "AbortError");
    options.onThinking(options.plan.thinking[i]);
    const action = options.plan.actions[i];
    if (action) options.onAction(action);
    if (gap) await new Promise((resolve) => setTimeout(resolve, gap));
  }
  for (const action of options.plan.actions.slice(options.plan.thinking.length)) {
    if (options.signal.aborted) throw new DOMException("Stopped.", "AbortError");
    options.onAction(action);
  }
}
