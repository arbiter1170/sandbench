// Codex CLI driver: `codex app-server` over NDJSON JSON-RPC on stdio.
// MVP maps turn/start → turn/completed and shell approval requests to Sandbench cards.
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { findOnPath } from "./find-bin.mjs";

export const id = "codex";
export const label = "Codex (local CLI)";

const SAFE_ARG = /^[\w.:\\/@+-]+$/;
const STATIC_MODELS = ["gpt-5.4", "gpt-5.2", "o3", "o4-mini"];

let starting = 0;
const waiting = [];

function launchLimit() {
  const configured = Number(process.env.SANDBENCH_CODEX_LAUNCH_SLOTS);
  return Number.isInteger(configured) && configured > 0 ? configured : Math.max(2, cpus().length);
}

function trySlot() {
  if (starting >= launchLimit()) return null;
  starting += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    starting -= 1;
    while (waiting.length && !waiting.shift()());
  };
}

function acquireSlot(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const take = () => {
      const slot = trySlot();
      if (!slot) return false;
      signal.removeEventListener("abort", abort);
      resolve(slot);
      return true;
    };
    const abort = () => {
      const index = waiting.indexOf(take);
      if (index >= 0) waiting.splice(index, 1);
      resolve(null);
    };
    if (take()) return;
    waiting.push(take);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function findBinary() {
  return findOnPath(["codex"], {
    envKey: "SANDBENCH_CODEX_BIN",
    extraDirs: [process.env.CODEX_HOME ? undefined : undefined].filter(Boolean),
  });
}

export async function available() {
  const bin = findBinary();
  return bin
    ? { ok: true, detail: bin, models: STATIC_MODELS }
    : {
        ok: false,
        detail: "Install the Codex CLI (`npm i -g @openai/codex` or the OpenAI installer), sign in, then restart the harness.",
        models: STATIC_MODELS,
      };
}

export function normalizeEvent() {
  return [];
}

function buildPrompt(turn) {
  return [turn.system, ...turn.history.map((item) => `${item.role === "user" ? "User" : "You"}: ${item.content}`), `User: ${turn.prompt}`]
    .filter(Boolean)
    .join("\n\n");
}

export function startTurn(turn, io) {
  let child = null;
  const done = (async () => {
    const bin = findBinary();
    if (!bin) throw new Error("Codex is not installed on this computer.");
    const release = await acquireSlot(io.signal);
    if (!release) throw new DOMException("Stopped.", "AbortError");
    try {
      await runAppServer(bin, turn, io, (proc) => {
        child = proc;
      });
    } finally {
      release();
    }
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

async function runAppServer(bin, turn, io, onSpawn) {
  const windowsScript = process.platform === "win32" && bin.toLowerCase().endsWith(".cmd");
  const child = spawn(bin, ["app-server"], {
    cwd: turn.cwd,
    windowsHide: true,
    shell: windowsScript,
    stdio: ["pipe", "pipe", "pipe"],
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
    if (method === "item/commandExecution/requestApproval" || method.includes("requestApproval") || method.includes("commandExecution")) {
      const command = String(params.command ?? params.cmd ?? params.proposed_cmd ?? params.tool?.command ?? "shell").slice(0, 2000);
      const reason = String(params.reason ?? params.message ?? "Codex asked to run a command.").slice(0, 500);
      const allow = await io.requestPermission({ command, reason, tool: "codex" });
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: allow
          ? { decision: "accept", action: "accept" }
          : { decision: "decline", action: "decline" },
      });
      return;
    }
    if (method === "item/fileChange/requestApproval" || method.includes("fileChange")) {
      const pathHint = String(params.path ?? params.file ?? params.file_path ?? "file").slice(0, 400);
      const allow = await io.requestPermission({
        command: `edit ${pathHint}`,
        reason: String(params.reason ?? "Codex asked to edit a file.").slice(0, 500),
        tool: "codex",
      });
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: allow ? { decision: "accept", action: "accept" } : { decision: "decline", action: "decline" },
      });
      return;
    }
    // Unknown server request: decline safely so the turn can continue or fail closed.
    send({ jsonrpc: "2.0", id: msg.id, result: { decision: "decline", action: "decline" } });
  }

  function handleNotification(msg) {
    const method = String(msg.method || "");
    const params = msg.params || {};
    if (method === "turn/completed" || method === "turn/complete") {
      if (!settled) {
        settled = true;
        resolveDone();
      }
      return;
    }
    if (method === "item/agentMessage/delta" || method === "agentMessage/delta") {
      const text = params.delta ?? params.text ?? params.content;
      if (typeof text === "string" && text) io.emit({ type: "message_delta", text });
      return;
    }
    if (method === "item/reasoning/delta" || method === "reasoning/delta") {
      const text = params.delta ?? params.text;
      if (typeof text === "string" && text) io.emit({ type: "thinking", text: text.slice(0, 400) });
      return;
    }
    if (method === "turn/started") {
      io.emit({ type: "thinking", text: "Codex turn started." });
      return;
    }
    // Nested item events
    const item = params.item || params;
    if (item?.type === "agentMessage" && typeof item.text === "string") {
      io.emit({ type: "message_delta", text: item.text });
    }
    if (method.includes("error") && params.message) {
      io.emit({ type: "thinking", text: String(params.message).slice(0, 400) });
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
    else if (code !== 0 && code !== null) rejectDone(new Error(stderr.trim() || `codex exited with ${code}.`));
    else resolveDone();
  });

  try {
    await request("initialize", {
      clientInfo: { name: "sandbench", title: "Sandbench", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });

    const model = turn.model && SAFE_ARG.test(turn.model) ? turn.model : undefined;
    const started = await request("thread/start", {
      cwd: turn.cwd,
      ...(model ? { model } : {}),
      developerInstructions: turn.system || undefined,
      ephemeral: true,
    });
    const threadId = started?.thread?.id ?? started?.threadId;
    if (!threadId) throw new Error("Codex did not return a thread id.");
    io.emit({ type: "session", sessionId: threadId });
    io.emit({ type: "thinking", text: `Codex session started${model ? ` on ${model}` : ""}.` });

    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: buildPrompt(turn) }],
    });
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
