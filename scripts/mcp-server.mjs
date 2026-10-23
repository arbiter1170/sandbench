#!/usr/bin/env node
// Bounded MCP control plane for Sandbench: health, list_bots, send_message, get_screen.
// Talks to the local harness on 127.0.0.1 only. See docs/mcp-server.md.
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DEFAULT_BASE = "http://127.0.0.1:8799";

function log(msg) {
  process.stderr.write(`[sandbench-mcp] ${msg}\n`);
}

function readToken() {
  if (process.env.SANDBENCH_HARNESS_TOKEN?.trim()) return process.env.SANDBENCH_HARNESS_TOKEN.trim();
  const candidates = [
    path.join(ROOT, ".harness-token"),
    path.join(os.homedir(), ".sandbench", "harness-token"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
  }
  return "";
}

function baseUrl() {
  return (process.env.SANDBENCH_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

async function harness(pathname, init = {}) {
  const token = readToken();
  if (!token) throw new Error("No harness token. Start `npm run harness` or set SANDBENCH_HARNESS_TOKEN.");
  const response = await fetch(`${baseUrl()}${pathname}`, {
    ...init,
    headers: {
      "x-sandbench-token": token,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Harness ${response.status}: ${text.slice(0, 200)}`);
  }
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  if (type.includes("image/")) {
    const buf = Buffer.from(await response.arrayBuffer());
    return { mime: type.split(";")[0], base64: buf.toString("base64") };
  }
  return response.text();
}

function listBotsFromExport() {
  const file = process.env.SANDBENCH_TEAM_FILE || path.join(ROOT, "sandbench-team.json");
  if (!existsSync(file)) return [];
  try {
    const pack = JSON.parse(readFileSync(file, "utf8"));
    if (pack?.format !== "sandbench-team" || !Array.isArray(pack.bots)) return [];
    return pack.bots.map((bot) => ({
      ref: bot.ref,
      name: bot.name,
      role: bot.role,
      model: bot.model,
      driver: bot.driver,
    }));
  } catch {
    return [];
  }
}

const TOOLS = [
  {
    name: "health",
    description: "Check that the Sandbench harness is reachable on localhost.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_bots",
    description: "List bots from SANDBENCH_TEAM_FILE or ./sandbench-team.json (export from Team → Share).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "send_message",
    description: "Start a harness agent turn (requires driver). Limited local control plane — not a full chat API.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        driver: { type: "string", description: "claude | codex | grok | anthropic | http" },
        model: { type: "string" },
        system: { type: "string" },
        folder: { type: "string", description: "Relative workspace folder" },
      },
      required: ["prompt", "driver"],
      additionalProperties: false,
    },
  },
  {
    name: "get_screen",
    description: "Capture the primary screen as a JPEG (Windows/macOS harness).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function callTool(name, args) {
  if (name === "health") return { content: [{ type: "text", text: JSON.stringify(await harness("/health"), null, 2) }] };
  if (name === "list_bots") {
    return { content: [{ type: "text", text: JSON.stringify(listBotsFromExport(), null, 2) }] };
  }
  if (name === "get_screen") {
    const shot = await harness("/screen");
    return {
      content: [
        { type: "text", text: "Primary screen JPEG." },
        { type: "image", data: shot.base64, mimeType: shot.mime || "image/jpeg" },
      ],
    };
  }
  if (name === "send_message") {
    const body = {
      driver: String(args.driver || ""),
      prompt: String(args.prompt || "").slice(0, 20_000),
      system: typeof args.system === "string" ? args.system.slice(0, 40_000) : "",
      model: typeof args.model === "string" ? args.model.slice(0, 120) : "",
      folder: typeof args.folder === "string" ? args.folder : "",
      history: [],
      unattendedDeny: true,
    };
    const started = await harness("/turns", { method: "POST", body: JSON.stringify(body) });
    return { content: [{ type: "text", text: JSON.stringify(started, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } })}\n`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
log(`listening; harness ${baseUrl()}`);

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  void (async () => {
    try {
      if (method === "initialize") {
        return reply(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "sandbench", version: "0.1.0" },
        });
      }
      if (method === "notifications/initialized" || method === "initialized") return;
      if (method === "tools/list") return reply(id, { tools: TOOLS });
      if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
        const result = await callTool(name, args);
        return reply(id, result);
      }
      if (method === "ping") return reply(id, {});
      return fail(id, `Method not found: ${method}`);
    } catch (error) {
      fail(id, error instanceof Error ? error.message : String(error));
    }
  })();
});
