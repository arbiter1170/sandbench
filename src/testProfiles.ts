import type { AgentDriver } from "./harness";
import type { Key } from "./i18n";
import type { Bot, Settings, TestProfileId } from "./types";

export type { TestProfileId };

export const TEST_PROFILE_IDS: TestProfileId[] = ["xai", "claude-api", "claude-cli", "ollama", "groq"];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export const PROFILE_MODELS: Record<TestProfileId, string[]> = {
  xai: ["grok-4.7", "grok-3", "grok-3-mini", "grok-2"],
  "claude-api": ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-sonnet-4-5-20250929"],
  // Claude Code prefers aliases or current ids; retired API aliases (3.5 haiku, sonnet 4) fail.
  "claude-cli": ["opus", "sonnet", "haiku", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"],
  ollama: ["llama3.1", "llama3.2", "qwen2.5"],
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"],
  mock: ["mock-tools"],
};

export function modelsForProfile(profile: TestProfileId | "" | undefined): string[] {
  if (!profile) return PROFILE_MODELS.xai;
  return PROFILE_MODELS[profile] ?? PROFILE_MODELS.xai;
}

const OLLAMA_BASE = "http://127.0.0.1:11434/v1";
const GROQ_BASE = "https://api.groq.com/openai/v1";
const MOCK_BASE = "http://127.0.0.1:11435/v1";

export function profileLabelKey(id: TestProfileId): Key {
  const map: Record<TestProfileId, Key> = {
    xai: "testProfileXai",
    "claude-api": "testProfileClaudeApi",
    "claude-cli": "testProfileClaudeCli",
    ollama: "testProfileOllama",
    groq: "testProfileGroq",
    mock: "testProfileMock",
  };
  return map[id];
}

export function applyProfileToBot(profile: TestProfileId, settings: Settings): Partial<Bot> {
  const tagged: Partial<Bot> = { testProfile: profile };
  switch (profile) {
    case "xai":
      return { ...tagged, provider: undefined, driver: undefined, model: undefined };
    case "claude-api":
      return {
        ...tagged,
        provider: "anthropic",
        driver: "anthropic",
        model: settings.anthropicModel?.trim() || DEFAULT_ANTHROPIC_MODEL,
      };
    case "claude-cli":
      return { ...tagged, provider: undefined, driver: "claude", model: "sonnet" };
    case "ollama":
      return {
        ...tagged,
        provider: "openai_compat",
        driver: "http",
        model: "llama3.1",
      };
    case "groq":
      return {
        ...tagged,
        provider: "openai_compat",
        driver: "http",
        model: "openai/gpt-oss-120b",
      };
    case "mock":
      return {
        ...tagged,
        provider: "openai_compat",
        driver: "http",
        model: "mock-tools",
      };
    default:
      return tagged;
  }
}

export function applyProfileToSettings(profile: TestProfileId): Partial<Settings> {
  switch (profile) {
    case "xai":
      return { defaultTestProfile: profile, defaultAgentDriver: undefined };
    case "claude-api":
      return { defaultTestProfile: profile, defaultAgentDriver: "anthropic" };
    case "claude-cli":
      return { defaultTestProfile: profile, defaultAgentDriver: "claude" };
    case "ollama":
      return {
        defaultTestProfile: profile,
        compatBase: OLLAMA_BASE,
        defaultAgentDriver: "http",
      };
    case "groq":
      return {
        defaultTestProfile: profile,
        compatBase: GROQ_BASE,
        defaultAgentDriver: "http",
      };
    case "mock":
      return {
        defaultTestProfile: profile,
        compatBase: MOCK_BASE,
        compatKey: "mock",
        defaultAgentDriver: "http",
      };
    default:
      return { defaultTestProfile: profile };
  }
}

export function profileTouchesCompatBase(profile: TestProfileId): boolean {
  return profile === "ollama" || profile === "groq" || profile === "mock";
}

export function inferProfileFromBot(bot: Bot, settings: Settings): TestProfileId | "" {
  if (bot.testProfile) return bot.testProfile;
  if (bot.driver === "claude") return "claude-cli";
  if (bot.provider === "anthropic" && bot.driver === "anthropic") return "claude-api";
  if (bot.provider === "openai_compat" && bot.driver === "http") {
    const base = settings.compatBase?.trim() ?? "";
    if (base.startsWith(OLLAMA_BASE) || base === OLLAMA_BASE.replace(/\/v1$/, "")) return "ollama";
    if (base.startsWith(GROQ_BASE)) return "groq";
    if (base.startsWith(MOCK_BASE)) return "mock";
    return "";
  }
  if (!bot.provider && !bot.driver) return "xai";
  return "";
}

export type ProfileReadiness = { ready: boolean; missing: string[] };

export function profileReadiness(
  profile: TestProfileId,
  settings: Settings,
  drivers: AgentDriver[] = [],
): ProfileReadiness {
  const missing: string[] = [];
  const driverOk = (id: string) => drivers.some((item) => item.id === id && item.ok);

  switch (profile) {
    case "xai":
      if (!settings.apiKey.trim()) missing.push("testProfileNeedXaiKey");
      break;
    case "claude-api":
      if (!settings.anthropicKey?.trim()) missing.push("testProfileNeedAnthropicKey");
      if (drivers.length > 0 && !driverOk("anthropic")) missing.push("testProfileNeedAnthropicDriver");
      break;
    case "claude-cli":
      if (drivers.length > 0 && !driverOk("claude")) missing.push("testProfileNeedClaudeCli");
      break;
    case "ollama":
      if (!settings.compatBase?.trim()) missing.push("testProfileNeedCompatBase");
      if (!settings.compatKey?.trim()) missing.push("testProfileNeedCompatKey");
      if (drivers.length > 0 && !driverOk("http")) missing.push("testProfileNeedHarness");
      break;
    case "groq":
      if (!settings.compatBase?.trim()) missing.push("testProfileNeedCompatBase");
      if (!settings.compatKey?.trim()) missing.push("testProfileNeedGroqKey");
      if (drivers.length > 0 && !driverOk("http")) missing.push("testProfileNeedHarness");
      break;
    case "mock":
      if (!settings.compatBase?.trim()) missing.push("testProfileNeedCompatBase");
      if (drivers.length > 0 && !driverOk("http")) missing.push("testProfileNeedHarness");
      break;
    default:
      break;
  }

  return { ready: missing.length === 0, missing };
}

/** Merge profile patch onto a bot, removing cleared optional fields. */
export function mergeBotProfile(bot: Bot, profile: TestProfileId, settings: Settings): Bot {
  const patch = applyProfileToBot(profile, settings);
  const next = { ...bot, ...patch };
  if (patch.provider === undefined) delete next.provider;
  if (patch.driver === undefined) delete next.driver;
  if (patch.model === undefined) delete next.model;
  return next;
}

export function botWithDefaultProfile(bot: Bot, settings: Settings): Bot {
  const profile = settings.defaultTestProfile;
  if (!profile) return bot;
  return mergeBotProfile(bot, profile, settings);
}
