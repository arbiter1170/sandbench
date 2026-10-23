export function localStandIn(userText: string, attachmentNames: string[]): string {
  const extras =
    attachmentNames.length > 0 ? `\n\nAttached on this machine: ${attachmentNames.join(", ")}.` : "";
  const text = userText.trim();
  const lower = text.toLowerCase();
  if (/\b(code|function|typescript|javascript|react)\b/.test(lower)) {
    const sample = [
      "**Local stand-in.** This reply was composed in the browser and was not sent anywhere.",
      "",
      "```ts",
      "export function echo(message: string) {",
      "  return message.trim();",
      "}",
      "```",
      "",
      text ? `Your note was: ${text}` : "There was no text besides the attachment.",
    ];
    if (extras) sample.push("", extras.trim());
    return sample.join("\n");
  }
  if (!text && attachmentNames.length > 0) {
    return `**Local stand-in.** I kept ${attachmentNames.join(", ")} in this browser. Reading the pixels or the audio needs your own API key in Settings.`;
  }
  const body = text.includes("\n") ? text : text ? `> ${text}` : "";
  const lines = [
    "**Local stand-in.** Nothing was sent to a server.",
    "",
    body,
    "",
    "The thread, files, reminders, and calendar stay in this browser. Add your own API key in Settings when you want a live model.",
  ];
  if (extras) lines.push("", extras.trim());
  return lines.join("\n");
}

export type ModelRoute = {
  apiKey: string;
  apiBase: string;
  model: string;
  useProxy: boolean;
  provider: "xai" | "openai_compat" | "anthropic";
};

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export function routeFor(
  bot: { model?: string; provider?: "xai" | "openai_compat" | "anthropic" } | undefined,
  settings: {
    apiKey: string;
    apiBase: string;
    model: string;
    useProxy: boolean;
    compatBase?: string;
    compatKey?: string;
    anthropicKey?: string;
    anthropicModel?: string;
  },
): ModelRoute {
  const chosen = bot?.model?.trim();
  const groq = settings.compatBase?.includes("api.groq.com");
  const model = chosen || (groq ? "openai/gpt-oss-120b" : settings.model);
  if (bot?.provider === "anthropic" && settings.anthropicKey?.trim()) {
    return {
      apiKey: settings.anthropicKey,
      apiBase: "https://api.anthropic.com/v1",
      model: bot?.model?.trim() || settings.anthropicModel?.trim() || DEFAULT_ANTHROPIC_MODEL,
      useProxy: false,
      provider: "anthropic",
    };
  }
  if (bot?.provider === "openai_compat" && settings.compatKey?.trim() && settings.compatBase?.trim()) {
    return { apiKey: settings.compatKey, apiBase: settings.compatBase, model, useProxy: false, provider: "openai_compat" };
  }
  return { apiKey: settings.apiKey, apiBase: settings.apiBase, model, useProxy: settings.useProxy, provider: "xai" };
}

async function* anthropicStream(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The model response had no body.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && json.delta.text) yield json.delta.text;
      } catch {
        // Incomplete SSE chunk.
      }
    }
  }
}

function resolveBase(apiBase: string, useProxy: boolean): string {
  const trimmed = apiBase.trim().replace(/\/$/, "");
  if (trimmed) {
    if (!trimmed.startsWith("https://") && !trimmed.startsWith("/") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(trimmed)) {
      throw new Error("The API base URL must start with https://, point at this computer (http://127.0.0.1 or http://localhost), or be the local /api-proxy path.");
    }
    return trimmed;
  }
  if (useProxy) return "/api-proxy/v1";
  throw new Error("Add an https:// base URL, or turn on the dev proxy.");
}

export async function streamText(
  full: string,
  instant: boolean,
  signal: AbortSignal,
  onDelta: (chunk: string) => void,
): Promise<void> {
  if (instant) {
    onDelta(full);
    return;
  }
  const size = 14;
  for (let i = 0; i < full.length; i += size) {
    if (signal.aborted) throw new DOMException("Stopped.", "AbortError");
    onDelta(full.slice(i, i + size));
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

export async function streamReply(options: {
  messages: { role: "user" | "assistant"; content: string }[];
  apiKey: string;
  apiBase: string;
  model: string;
  useProxy: boolean;
  provider?: ModelRoute["provider"];
  attachmentNames: string[];
  instant: boolean;
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<{ localStandIn: boolean }> {
  const lastUser = [...options.messages].reverse().find((item) => item.role === "user");
  if (!options.apiKey.trim()) {
    const full = localStandIn(lastUser?.content ?? "", options.attachmentNames);
    if (options.instant) {
      options.onDelta(full);
      return { localStandIn: true };
    }
    const size = 14;
    for (let i = 0; i < full.length; i += size) {
      if (options.signal.aborted) {
        throw new DOMException("Stopped.", "AbortError");
      }
      options.onDelta(full.slice(i, i + size));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return { localStandIn: true };
  }

  if (options.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: options.signal,
      headers: {
        "x-api-key": options.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model.trim() || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 4096,
        stream: true,
        messages: options.messages.map((item) => ({ role: item.role, content: item.content })),
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 280);
      throw new Error(detail || `The model request failed (${response.status}).`);
    }
    for await (const chunk of anthropicStream(response)) options.onDelta(chunk);
    return { localStandIn: false };
  }

  const base = resolveBase(options.apiBase, options.useProxy);
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${options.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model.trim() || "grok-3",
      stream: true,
      messages: options.messages,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 280);
    throw new Error(detail || `The model request failed (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text === "string" && text) options.onDelta(text);
    return { localStandIn: false };
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("The model response had no body.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return { localStandIn: false };
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) options.onDelta(delta);
      } catch {
        // Incomplete SSE chunks are ignored until the next line arrives.
      }
    }
  }
  return { localStandIn: false };
}

export async function completeText(options: {
  messages: { role: "user" | "assistant"; content: string }[];
  apiKey: string;
  apiBase: string;
  model: string;
  useProxy: boolean;
  provider?: ModelRoute["provider"];
  signal: AbortSignal;
}): Promise<string> {
  if (options.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: options.signal,
      headers: {
        "x-api-key": options.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model.trim() || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 4096,
        messages: options.messages.map((item) => ({ role: item.role, content: item.content })),
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 280);
      throw new Error(detail || `The model request failed (${response.status}).`);
    }
    const json = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    if (!text?.trim()) throw new Error("The model returned an empty decision.");
    return text;
  }
  const base = resolveBase(options.apiBase, options.useProxy);
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${options.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model.trim() || "grok-3",
      stream: false,
      messages: options.messages,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 280);
    throw new Error(detail || `The model request failed (${response.status}).`);
  }
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("The model returned an empty decision.");
  return text;
}
