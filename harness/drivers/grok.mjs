// Grok Build CLI driver: `grok … agent stdio` over ACP JSON-RPC on stdio.
// MVP: initialize → authenticate (cached_token) → session/new → session/prompt.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findOnPath } from "./find-bin.mjs";

export const id = "grok";
export const label = "Grok (local CLI)";

const SAFE_ARG = /^[\w.:\\/@+-]+$/;
const STATIC_MODELS = ["grok-4.7", "grok-4.6", "grok-4.5"];

function grokHome() {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

function findBinary() {
  return findOnPath(["grok"], {
    envKey: "SANDBENCH_GROK_BIN",
    extraDirs: [
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".grok", "bin"),
    ],
  });
}

function signedIn() {
  return existsSync(path.join(grokHome(), "auth.json"));
}

export async function available() {
  const bin = findBinary();
  if (!bin) {
    return {
      ok: false,
      detail: "Install the Grok CLI from https://x.ai/cli, run `grok login`, then restart the harness.",
      models: STATIC_MODELS,
    };
  }
  if (!signedIn()) {
    return {
      ok: false,
      detail: `Found ${bin}, but Grok is not signed in. Run \`grok login\`, then restart the harness.`,
      models: STATIC_MODELS,
    };
  }
  return { ok: true, detail: bin, models: STATIC_MODELS };
}

export function normalizeEvent() {
  return [];
}

function buildPrompt(turn) {
  const body = [turn.system, ...turn.history.map((item) => `${item.role === "user" ? "User" : "You"}: ${item.content}`), turn.prompt]
    .filter(Boolean)
    .join("\n\n");
  return body;
}

export function startTurn(turn, io) {
  let child = null;
  const done = (async () => {
    const bin = findBinary();
    if (!bin) throw new Error("Grok CLI is not installed on this computer.");
    if (!signedIn()) throw new Error("Grok is not signed in. Run `grok login`, then retry.");
    await runAcp(bin, turn, io, (proc) => {
      child = proc;
    });
  })();
  return {
    done,
    interrupt: () => {
      try {
        child?.kill();
      } catch {
        // ignore
      }
    },
  };
}

async function runAcp(bin, turn, io, onSpawn) {
  const model = turn.model && SAFE_ARG.test(turn.model) ? turn.model : "";
  const args = ["--permission-mode", "default", "agent", ...(model ? ["-m", model] : []), "stdio"];
  const windowsScript = process.platform === "win32" && bin.toLowerCase().endsWith(".cmd");
  const env = { ...process.env };
  delete env.XAI_API_KEY;
  const child = spawn(bin, args, {
    cwd: turn.cwd,
    windowsHide: true,
    shell: windowsScript,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  onSpawn(child);

  let nextId = 1;
  const pending = new Map();
  let buffer = "";
  let stderr = "";
  let settled = false;
  let resolveDone;
  let rejectDone;
  const finished = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const stop = () => {
    try {
      child.kill();
    } catch {
      // ignore
    }
  };
  io.signal.addEventListener("abort", stop, { once: true });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async function handleServerRequest(msg) {
    const method = String(msg.method || "");
    const params = msg.params || {};
    if (method === "session/request_permission" || method.endsWith("request_permission")) {
      const toolCall = params.toolCall || params.tool_call || {};
      const title = String(toolCall.title ?? toolCall.kind ?? toolCall.name ?? "tool").slice(0, 200);
      const command = String(
        toolCall.rawInput?.command ??
          toolCall.rawInput?.cmd ??
          toolCall.content?.find?.((c) => c.type === "content" && c.content?.type === "text")?.content?.text ??
          title,
      ).slice(0, 2000);
      const allow = await io.requestPermission({
        command,
        reason: `Grok asked to use ${title}.`,
        tool: "grok",
      });
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          outcome: {
            outcome: allow ? "selected" : "cancelled",
            optionId: allow ? "allow-once" : undefined,
          },
        },
      });
      return;
    }
    // fs / other client capabilities we did not advertise
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  function handleNotification(msg) {
    if (msg.method !== "session/update") return;
    const update = msg.params?.update;
    if (!update) return;
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const text = update.content?.text ?? update.text;
      if (typeof text === "string" && text) io.emit({ type: "message_delta", text });
      return;
    }
    if (kind === "agent_thought_chunk") {
      const text = update.content?.text ?? update.text;
      if (typeof text === "string" && text) io.emit({ type: "thinking", text: text.slice(0, 400) });
      return;
    }
    if (kind === "tool_call") {
      const title = update.title ?? update.kind ?? update.toolCallId ?? "tool";
      io.emit({ type: "thinking", text: `Grok wants ${title}.` });
      return;
    }
    if (kind === "tool_call_update" && update.status === "completed") {
      io.emit({ type: "thinking", text: `Tool finished: ${update.toolCallId || "tool"}.` });
    }
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const pend = pending.get(msg.id);
        if (pend) {
          pending.delete(msg.id);
          if (msg.error) pend.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else pend.resolve(msg.result);
        }
      } else if (msg.id !== undefined && msg.method) {
        void handleServerRequest(msg);
      } else if (msg.method) {
        handleNotification(msg);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });
  child.on("error", (error) => {
    if (!settled) {
      settled = true;
      rejectDone(error);
    }
  });
  child.on("close", (code) => {
    io.signal.removeEventListener("abort", stop);
    if (settled) return;
    settled = true;
    if (io.signal.aborted) rejectDone(new DOMException("Stopped.", "AbortError"));
    else if (code !== 0 && code !== null) rejectDone(new Error(stderr.trim() || `grok exited with ${code}.`));
    else resolveDone();
  });

  try {
    const init = await request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "sandbench", version: "0.1.0" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });

    const methods = Array.isArray(init?.authMethods) ? init.authMethods : [];
    if (methods.some((m) => m?.id === "cached_token")) {
      try {
        await request("authenticate", { methodId: "cached_token" });
      } catch {
        throw new Error("Grok is not signed in to your grok.com account. Run `grok login`, then retry.");
      }
    }

    const created = await request("session/new", { cwd: turn.cwd, mcpServers: [] });
    const sessionId = created?.sessionId;
    if (!sessionId) throw new Error("Grok did not return a session id.");
    io.emit({ type: "session", sessionId });
    io.emit({ type: "thinking", text: `Grok session started${model ? ` on ${model}` : ""}.` });

    if (model) {
      try {
        await request("session/set_model", { sessionId, modelId: model });
      } catch {
        // Older CLIs may ignore set_model; argv -m already set.
      }
    }

    await request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: buildPrompt(turn) }],
    });
    if (!settled) {
      settled = true;
      resolveDone();
    }
    await finished;
  } catch (error) {
    stop();
    throw error;
  } finally {
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    stop();
  }
}
