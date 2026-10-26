import { getFirebaseAuth } from "./firebase";
import type { Connector, PointerAction, TriggerRun, WebhookTrigger } from "./types";

const HEADERS = { "x-sandbench-client": "1" };
// Runner mode (SB-01): VITE_RUNNER_URL (e.g. "/api") points at the hosted runner, and each
// call carries the signed-in user's Firebase ID token. Without it, the local harness is
// reached through the Vite dev proxy at /harness.
const RUNNER_URL = (import.meta.env.VITE_RUNNER_URL ?? "").replace(/\/$/, "");
const BASE = RUNNER_URL || "/harness";

async function authHeaders(): Promise<Record<string, string>> {
  if (!RUNNER_URL) return HEADERS;
  const token = await getFirebaseAuth()?.currentUser?.getIdToken();
  return token ? { ...HEADERS, authorization: `Bearer ${token}` } : HEADERS;
}

export type HarnessHealth = { ok: boolean; platform: string; host: string; workspace: string };
export type ProcessStat = { name: string; cpu: number; mem: number };
export type ProcessReport = { cpu: number; memUsed: number; memTotal: number; host: string; platform: string; list: ProcessStat[] };
export type ExecResult = { code: number; stdout: string; stderr: string; truncated: boolean; ms: number };
export type McpProbe = {
  server: { name?: string; version?: string } | null;
  tools: { name: string; description: string; schema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } }[];
};

export type DueRoutine = { id: string; routineId?: string; webhookId?: string; payload?: string; botId: string; title: string; at: number };
export type HarnessTriggers = {
  hookPort: number;
  webhooks: { id: string; botId: string; name: string; title: string; enabled: boolean; hasSecret: boolean }[];
  runs: TriggerRun[];
};

export { call as harnessCall };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Harness returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

export type ModelRequest = {
  provider: "xai" | "openai_compat" | "anthropic" | "openrouter";
  /** Only for OpenAI-compatible servers (or a custom xAI base); the server checks it. */
  base?: string;
  path: "/chat/completions" | "/messages";
  payload: unknown;
};

/** A model call through the harness or runner, which adds the stored API key (SB-05). */
export async function modelFetch(request: ModelRequest, signal?: AbortSignal): Promise<Response> {
  return fetch(`${BASE}/model`, {
    method: "POST",
    signal,
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function harnessHealth(): Promise<HarnessHealth | null> {
  try {
    return await call<HarnessHealth>("/health", { signal: AbortSignal.timeout(2500) });
  } catch {
    return null;
  }
}

export function harnessProcesses(): Promise<ProcessReport> {
  return call<ProcessReport>("/processes");
}

export async function harnessScreen(): Promise<Blob> {
  const response = await fetch(`${BASE}/screen`, { headers: await authHeaders() });
  if (!response.ok) throw new Error(`Screen capture returned ${response.status}.`);
  return response.blob();
}

export type ExecResultWithThumb = ExecResult & { screenThumb?: string };

export function harnessExec(command: string, folder?: string, captureScreen = false): Promise<ExecResultWithThumb> {
  return call<ExecResultWithThumb>("/exec", {
    method: "POST",
    body: JSON.stringify({ command, approved: true, captureScreen, ...(folder ? { folder } : {}) }),
  });
}

export function harnessInput(pointer: PointerAction): Promise<ExecResultWithThumb> {
  return call<ExecResultWithThumb>("/input", { method: "POST", body: JSON.stringify({ ...pointer, approved: true }) });
}

export type TtsProvider = "xai" | "elevenlabs" | "fish" | "chatterbox" | "system";

export async function harnessTtsSpeak(input: {
  provider: TtsProvider;
  text: string;
  voiceId: string;
  baseUrl?: string;
  model?: string;
  fishModel?: string;
}): Promise<Blob> {
  const response = await fetch(`${BASE}/tts/speak`, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `TTS returned ${response.status}.`);
  }
  return response.blob();
}

export function harnessTtsVoices(provider: TtsProvider, opts: { baseUrl?: string } = {}) {
  const params = new URLSearchParams({ provider });
  if (opts.baseUrl) params.set("baseUrl", opts.baseUrl);
  return call<{ voices: { id: string; label: string; description?: string }[]; provider: string }>(`/tts/voices?${params}`);
}

export function harnessTtsMeta() {
  return call<{ providers: string[]; systemAvailable: boolean }>("/tts/meta");
}

export function harnessSkills() {
  return call<{ skills: { id: string; title: string; summary: string; body: string }[] }>("/skills");
}

export function harnessBotSoul(botId: string) {
  return call<{ soul: string; exists: boolean }>(`/bots/${encodeURIComponent(botId)}/soul`);
}

export function harnessWriteBotSoul(botId: string, soul: string) {
  return call<{ ok: boolean; bytes: number }>(`/bots/${encodeURIComponent(botId)}/soul`, {
    method: "POST",
    body: JSON.stringify({ soul }),
  });
}

export function harnessBotMemory(botId: string) {
  return call<{ files: { path: string; content: string }[] }>(`/bots/${encodeURIComponent(botId)}/memory`);
}

export function harnessWriteBotMemory(botId: string, pathName: string, content: string) {
  return call<{ ok: boolean; path: string; bytes: number }>(`/bots/${encodeURIComponent(botId)}/memory`, {
    method: "POST",
    body: JSON.stringify({ path: pathName, content }),
  });
}

export function harnessWriteFile(file: { path: string; op: "write" | "delete"; content?: string }): Promise<{ ok: boolean; path: string; bytes: number }> {
  return call("/workspace/write", { method: "POST", body: JSON.stringify({ ...file, approved: true }) });
}

export function harnessReadFile(relative: string): Promise<{ exists: boolean; content: string }> {
  return call(`/workspace/read?path=${encodeURIComponent(relative)}`);
}

export function harnessProbe(url: string, headers: Record<string, string>): Promise<McpProbe> {
  return call<McpProbe>("/mcp/probe", { method: "POST", body: JSON.stringify({ url, headers }) });
}

export function harnessCallTool(url: string, headers: Record<string, string>, tool: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  return call("/mcp/call", { method: "POST", body: JSON.stringify({ url, headers, tool, args, approved: true }) });
}

/** Header templates as stored; the harness or runner fills {{NAME}} from its secret store. */
export function connectorHeaders(connector: Connector): Record<string, string> {
  return Object.fromEntries(connector.headers.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value]));
}

export function harnessSyncSchedules(routines: { id: string; botId: string; title: string; schedule: string; enabled: boolean }[]): Promise<{ ok: boolean }> {
  return call("/schedules", { method: "POST", body: JSON.stringify({ routines }) });
}

export function harnessDue(): Promise<{ items: DueRoutine[] }> {
  return call("/due");
}

export function harnessAck(ids: string[]): Promise<{ ok: boolean }> {
  return call("/due/ack", { method: "POST", body: JSON.stringify({ ids }) });
}

export function harnessTriggers(): Promise<HarnessTriggers> {
  return call("/triggers");
}

export function harnessSyncWebhooks(webhooks: WebhookTrigger[]): Promise<{ ok: boolean }> {
  const body = webhooks.map(({ id, botId, name, title, enabled }) => ({ id, botId, name, title, enabled }));
  return call("/triggers/sync", { method: "POST", body: JSON.stringify({ webhooks: body }) });
}

export function harnessWebhookSecret(id: string): Promise<{ secret: string; preview: string }> {
  return call("/triggers/secret", { method: "POST", body: JSON.stringify({ id }) });
}

export function harnessRecordRun(run: Omit<TriggerRun, "id" | "at">): Promise<{ ok: boolean }> {
  return call("/triggers/runs", { method: "POST", body: JSON.stringify(run) });
}

export type AgentDriver = { id: string; label: string; ok: boolean; detail: string; models?: string[] };
export type AgentEvent = {
  seq: number;
  turnId: string;
  type: "turn_start" | "thinking" | "message_delta" | "permission_request" | "permission_resolved" | "tool_start" | "tool_end" | "done" | "error";
  text?: string;
  permissionId?: string;
  command?: string;
  reason?: string;
  auto?: boolean;
  denied?: boolean;
  allow?: boolean;
  code?: number;
  output?: string;
  ms?: number;
  message?: string;
  stopped?: boolean;
  screenThumb?: string;
};
export type TurnRequest = {
  driver: string;
  prompt: string;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
  base: string;
  /** Which stored key the driver should use; the value never leaves the server. */
  secret?: "XAI_API_KEY" | "ANTHROPIC_API_KEY" | "COMPAT_API_KEY";
  folder?: string;
  allow: string[];
  unattendedDeny: boolean;
  captureScreen?: boolean;
};

export function harnessDrivers(): Promise<{ drivers: AgentDriver[] }> {
  return call("/drivers");
}

export function harnessStartTurn(request: TurnRequest): Promise<{ id: string; after: number }> {
  return call("/turns", { method: "POST", body: JSON.stringify(request) });
}

export function harnessInterrupt(turnId: string): Promise<{ ok: boolean }> {
  return call(`/turns/${turnId}/interrupt`, { method: "POST", body: "{}" });
}

export function harnessPermit(permissionId: string, allow: boolean): Promise<{ ok: boolean }> {
  return call(`/permissions/${permissionId}`, { method: "POST", body: JSON.stringify({ allow }) });
}

export async function harnessEvents(turnId: string, after: number, signal: AbortSignal, onEvent: (event: AgentEvent) => boolean | void): Promise<void> {
  const response = await fetch(`${BASE}/events?turn=${turnId}&after=${after}`, { headers: await authHeaders(), signal });
  if (!response.ok || !response.body) throw new Error(`The event stream returned ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        if (onEvent(JSON.parse(line.slice(5)) as AgentEvent) === true) return;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export function autoApproved(command: string, rules: string[]): boolean {
  const trimmed = command.trim();
  if (/[;&|>`]|\$\(/.test(trimmed)) return false;
  const head = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  return rules.some((rule) => rule.trim().toLowerCase() === head);
}
