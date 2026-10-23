// Fast decision model for channel auto-route (OpenRouter Decisions / Jev-shaped).
import type { Bot, Settings, Thread } from "./types";

const THRESHOLD = 0.6;
const BUDGET_MS = 1_500;
const EVERYONE = "everyone";

export type DecisionPick = {
  bot: Bot | null;
  everyone: boolean;
  reason: string;
  probability: number;
  providerLabel: string;
};

function decisionKey(settings: Settings): string {
  return (settings.decisionKey?.trim() || settings.compatKey?.trim() || "").trim();
}

function decisionModel(settings: Settings): string {
  return settings.decisionModel?.trim() || "typesafe/jev-1.13";
}

export function buildDecisionPrompt(members: Bot[], text: string, channel: Thread): string {
  const roster = [
    ...members.map((bot) => `- ${bot.name} (${bot.id}): ${bot.role}. ${(bot.instructions || bot.persona).slice(0, 160)}`),
    `- ${EVERYONE}: several members should answer`,
  ].join("\n");
  const recent = (channel.messages ?? [])
    .filter((m) => m.status === "done" && m.text.trim())
    .slice(-8)
    .map((m) => `${m.role}: ${m.text.slice(0, 240)}`)
    .join("\n");
  return [
    "Pick who should answer this group-chat message. Reply with JSON only:",
    '{"choice":"<bot id or everyone>","probability":0.0}',
    "Choose the single best id from the list. Use everyone when several should reply.",
    `Room: ${channel.title}`,
    channel.sharedInstructions ? `Shared: ${channel.sharedInstructions.slice(0, 400)}` : "",
    `Members:\n${roster}`,
    recent ? `Recent:\n${recent}` : "",
    `Message:\n${text.slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseDecision(raw: string, members: Bot[]): DecisionPick | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: { choice?: unknown; probability?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { choice?: unknown; probability?: unknown };
  } catch {
    return null;
  }
  const choice = typeof parsed.choice === "string" ? parsed.choice.trim() : "";
  const probability = typeof parsed.probability === "number" ? parsed.probability : Number(parsed.probability);
  if (!choice || !Number.isFinite(probability)) return null;
  if (probability < THRESHOLD) return null;
  if (choice === EVERYONE || choice.toLowerCase() === "several members") {
    return { bot: null, everyone: true, reason: "several members", probability, providerLabel: "decision model" };
  }
  const bot =
    members.find((item) => item.id === choice) ||
    members.find((item) => item.name.toLowerCase() === choice.toLowerCase());
  if (!bot) return null;
  return { bot, everyone: false, reason: bot.name, probability, providerLabel: "decision model" };
}

/** OpenRouter chat-completions fallback that asks for Jev-shaped JSON (works without Decisions API). */
async function openRouterDecide(settings: Settings, prompt: string, signal: AbortSignal): Promise<string> {
  const key = decisionKey(settings);
  if (!key) throw new Error("No decision API key.");
  const model = decisionModel(settings);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:5173",
      "X-Title": "Sandbench",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: "system", content: "You are a room router. Answer with JSON only: {\"choice\":\"id\",\"probability\":0.0}." },
        { role: "user", content: prompt },
      ],
    }),
    signal,
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

export async function pickWithDecisionModel(
  settings: Settings,
  channel: Thread,
  members: Bot[],
  text: string,
): Promise<DecisionPick | null> {
  if (!settings.decisionEnabled) return null;
  if (!decisionKey(settings)) return null;
  const prompt = buildDecisionPrompt(members, text, channel);
  const signal = AbortSignal.timeout(BUDGET_MS);
  const providerLabel = settings.decisionProvider === "typesafe" ? "Jev" : "OpenRouter";
  try {
    const raw = await openRouterDecide(settings, prompt, signal);
    const picked = parseDecision(raw, members);
    if (!picked) return null;
    return { ...picked, providerLabel };
  } catch {
    return null;
  }
}

export async function testDecisionModel(settings: Settings): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  try {
    const dummyMembers: Bot[] = [
      {
        id: "a",
        name: "Alpha",
        role: "Lead",
        instructions: "Coordinates",
        persona: "Brief",
        color: "#4ea1ff",
        shape: "pebble",
        voice: "cove",
        primary: true,
        hidden: false,
        skills: [],
        memories: [],
        section: "",
        lastThinking: [],
        createdAt: 0,
      },
      {
        id: "b",
        name: "Beta",
        role: "Helper",
        instructions: "Helps",
        persona: "Warm",
        color: "#7dce82",
        shape: "bean",
        voice: "flint",
        primary: false,
        hidden: false,
        skills: [],
        memories: [],
        section: "",
        lastThinking: [],
        createdAt: 0,
      },
    ];
    const channel: Thread = { id: "t", title: "Test", updatedAt: 0, messages: [], memberIds: ["a", "b"] };
    const raw = await openRouterDecide(settings, buildDecisionPrompt(dummyMembers, "Who should greet the user?", channel), AbortSignal.timeout(BUDGET_MS));
    const picked = parseDecision(raw, dummyMembers);
    const ms = Date.now() - started;
    if (!picked) return { ok: false, ms, detail: raw.slice(0, 200) || "No valid JSON choice." };
    return { ok: true, ms, detail: `${picked.reason} · ${Math.round(picked.probability * 100)}%` };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message : String(error) };
  }
}
