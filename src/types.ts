export type Role = "user" | "assistant";

export type Attachment = {
  id: string;
  kind: "image" | "audio";
  name: string;
  mime: string;
};

export type Message = {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
  attachments: Attachment[];
  status: "done" | "streaming" | "error";
  localStandIn: boolean;
  fresh: boolean;
  thinking?: string[];
  authorBotId?: string;
  approval?: Approval;
  activity?: ActivityChip[];
  screenThumb?: string;
  trigger?: TriggerRef;
};

export type TriggerRef = { kind: "routine" | "webhook"; id: string };

export type PointerKey = "enter" | "tab" | "escape" | "up" | "down" | "left" | "right" | "space" | "backspace";

export type PointerAction =
  | { action: "click"; x: number; y: number }
  | { action: "type"; text: string }
  | { action: "key"; key: PointerKey };

export type ApprovalQuestion = {
  prompt: string;
  options?: { id: string; label: string }[];
  multi?: boolean;
};

export type ApprovalFile = {
  path: string;
  op: "write" | "delete";
  preview: string;
  previous?: string;
  existed?: boolean;
};

export type Approval = {
  command: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "unavailable" | "failed";
  auto?: boolean;
  output?: string;
  exitCode?: number;
  tool?: { connectorId: string; name: string; args: Record<string, unknown> };
  pointer?: PointerAction;
  question?: ApprovalQuestion;
  file?: ApprovalFile;
  permissionId?: string;
};

export type ActivityChip = { label: string; ms?: number; shotId?: string };

export type Thread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  botId?: string;
  memberIds?: string[];
  sharedInstructions?: string;
  leadBotId?: string;
  workingFolder?: string;
  autoRoute?: boolean;
};

export type Reminder = {
  id: string;
  title: string;
  at: number;
  done: boolean;
  botId?: string;
};

export type BotShape = "pebble" | "bean" | "capsule" | "gem" | "hex";
export type BotVoice = "cove" | "flint" | "lumen" | "nimbus";
export type SkillId = "computer" | "files" | "reminders" | "calendar" | "mail";

export type ApprovalMode = "ask" | "auto" | "full";
export type BotVisibility = "team" | "hidden" | "primary_only";

export type SoulRevision = {
  at: number;
  before: string;
  after: string;
};

export type BotUsage = {
  turns: number;
  charsIn: number;
  charsOut: number;
  commands: number;
  since: number;
};

export type Bot = {
  id: string;
  name: string;
  role: string;
  instructions: string;
  persona: string;
  /** Canonical soul text (also mirrored to ~/.sandbench/bots/<id>/SOUL.md when harness is up). */
  soul?: string;
  soulHistory?: SoulRevision[];
  color: string;
  shape: BotShape;
  voice: BotVoice;
  primary: boolean;
  hidden: boolean;
  skills: SkillId[];
  /** Ids from the local skills library (~/.sandbench/skills). */
  librarySkillIds?: string[];
  memories: string[];
  section: string;
  lastThinking: string[];
  createdAt: number;
  avatar?: string;
  plugins?: string[];
  connectorIds?: string[];
  speakReplies?: boolean;
  muted?: boolean;
  model?: string;
  provider?: "xai" | "openai_compat" | "anthropic";
  driver?: string;
  testProfile?: TestProfileId;
  /** Built-in preset that keeps model chips and REA instructions on duplicates. */
  preset?: "rea";
  /** Which REA chip is active; Composer never sends from this app. */
  modelChoice?: "opus" | "grok" | "composer";
  pinned?: boolean;
  unread?: boolean;
  lastPreview?: string;
  approvalMode?: ApprovalMode;
  visibility?: BotVisibility;
  usage?: BotUsage;
};

export type BotFile = {
  id: string;
  botId: string;
  name: string;
  mime: string;
  size: number;
  addedAt: number;
};

export type Plugin = {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  builtIn: boolean;
};

export type ToolSchema = {
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
};

export type Connector = {
  id: string;
  name: string;
  url: string;
  headers: { key: string; value: string }[];
  status: "untested" | "ok" | "failed";
  serverName: string;
  tools: { name: string; description: string; schema?: ToolSchema }[];
  error: string;
  checkedAt: number;
};

/** A named secret used in connector headers as {{NAME}}. The value lives on the harness or runner only. */
export type Secret = {
  id: string;
  name: string;
  createdAt: number;
};

export type Studio = {
  files: BotFile[];
  plugins: Plugin[];
  connectors: Connector[];
  secrets: Secret[];
  autoApprove: string[];
  unattended: "ask" | "skip";
  drafts: Record<string, string>;
  usage: { turns: number; charsIn: number; charsOut: number; commands: number; since: number };
  onboarded: boolean;
  webhooks: WebhookTrigger[];
};

export function defaultStudio(): Studio {
  return {
    files: [],
    plugins: [],
    connectors: [],
    secrets: [],
    autoApprove: ["Get-ChildItem", "Get-Date", "Get-Process", "Get-Location", "dir", "ls", "pwd"],
    unattended: "ask",
    drafts: {},
    usage: { turns: 0, charsIn: 0, charsOut: 0, commands: 0, since: Date.now() },
    onboarded: false,
    webhooks: [],
  };
}

export type BotTask = {
  id: string;
  botId: string;
  title: string;
  status: "queued" | "working" | "done";
  thinking: string[];
  createdAt: number;
};

export type Routine = {
  id: string;
  botId: string;
  title: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: number;
};

export type WebhookTrigger = {
  id: string;
  botId: string;
  name: string;
  title: string;
  enabled: boolean;
  secretPreview?: string;
  createdAt: number;
};

export type TriggerRun = {
  id: string;
  kind: "routine" | "webhook";
  triggerId: string;
  botId: string;
  title: string;
  at: number;
  status: "ok" | "failed" | "skipped";
  ms?: number;
};

export type ComputerEvent = {
  id: string;
  botId: string;
  at: number;
  app: string;
  action: string;
  cpu: number;
};

export type CalEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  notes: string;
};

export type Contact = {
  id: string;
  name: string;
  tel: string;
  email: string;
};

export type Locale =
  | "en"
  | "zh-Hans"
  | "zh-Hant"
  | "hi"
  | "pl"
  | "es"
  | "pt"
  | "ja"
  | "fr"
  | "ko"
  | "de"
  | "tr";

export type TestProfileId = "xai" | "claude-api" | "claude-cli" | "ollama" | "groq" | "mock";

export type Settings = {
  displayName: string;
  locale: Locale;
  apiBase: string;
  model: string;
  useProxy: boolean;
  compatBase?: string;
  anthropicModel?: string;
  defaultAgentDriver?: "" | "anthropic" | "http" | "claude" | "codex" | "grok";
  defaultTestProfile?: TestProfileId;
  lockEnabled: boolean;
  pinHash: string;
  pinSalt: string;
  credentialId: string;
  sections: string[];
  /** Hosted or browser speech for Call / speak replies. */
  ttsMode?: "browser" | "xai" | "elevenlabs" | "fish" | "chatterbox" | "system";
  /** Active voice id for the selected hosted provider. */
  ttsVoiceId?: string;
  /** @deprecated Prefer ttsVoiceId; kept for older snapshots. */
  xaiVoiceId?: string;
  fishModel?: string;
  chatterboxBaseUrl?: string;
  chatterboxModel?: string;
  /** Fast decision model for channel auto-route (OpenRouter Decisions / Jev). */
  decisionEnabled?: boolean;
  decisionProvider?: "openrouter" | "typesafe";
  decisionModel?: string;
  /** Attach a JPEG thumb after approved harness pointer/shell work. */
  attachWorkScreenshots?: boolean;
};

export type LogItem = {
  id: string;
  message: string;
  at: number;
};

export type PendingFile = {
  id: string;
  kind: "image" | "audio";
  name: string;
  mime: string;
  blob: Blob;
  previewUrl: string;
};

export type Snapshot = {
  threads: Thread[];
  reminders: Reminder[];
  events: CalEvent[];
  contacts: Contact[];
  settings: Settings;
  logs: LogItem[];
  bots: Bot[];
  tasks: BotTask[];
  routines: Routine[];
  computer: ComputerEvent[];
  studio: Studio;
};

export const LOCALE_OPTIONS: { id: Locale; label: string; speech: string }[] = [
  { id: "en", label: "English", speech: "en-US" },
  { id: "zh-Hans", label: "简体中文", speech: "zh-CN" },
  { id: "zh-Hant", label: "繁體中文", speech: "zh-TW" },
  { id: "hi", label: "हिन्दी", speech: "hi-IN" },
  { id: "pl", label: "Polski", speech: "pl-PL" },
  { id: "es", label: "Español", speech: "es-ES" },
  { id: "pt", label: "Português", speech: "pt-BR" },
  { id: "ja", label: "日本語", speech: "ja-JP" },
  { id: "fr", label: "Français", speech: "fr-FR" },
  { id: "ko", label: "한국어", speech: "ko-KR" },
  { id: "de", label: "Deutsch", speech: "de-DE" },
  { id: "tr", label: "Türkçe", speech: "tr-TR" },
];

export function detectLocale(): Locale {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("zh-hant") || lang.startsWith("zh-tw") || lang.startsWith("zh-hk")) {
    return "zh-Hant";
  }
  if (lang.startsWith("zh")) return "zh-Hans";
  const hit = LOCALE_OPTIONS.find((item) => lang.startsWith(item.id.toLowerCase().slice(0, 2)) && item.id !== "zh-Hans" && item.id !== "zh-Hant");
  return hit?.id ?? "en";
}

export function defaultSettings(): Settings {
  return {
    displayName: "",
    locale: detectLocale(),
    apiBase: "",
    model: "grok-3",
    useProxy: true,
    lockEnabled: false,
    pinHash: "",
    pinSalt: "",
    credentialId: "",
    sections: [],
    ttsMode: "browser",
    decisionEnabled: false,
    decisionProvider: "openrouter",
    decisionModel: "typesafe/jev-1.13",
    attachWorkScreenshots: true,
  };
}

export function defaultBotUsage(): BotUsage {
  return { turns: 0, charsIn: 0, charsOut: 0, commands: 0, since: Date.now() };
}
