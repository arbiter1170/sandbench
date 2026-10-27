// Claude Code driver, written from the public headless-mode docs: `claude -p` with
// `--output-format stream-json`. Tools Claude has not been allowed to use come back as
// permission denials in the result event. Each denial becomes an approval card; approved
// ones are allowed through a settings file and the session resumes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const id = "claude";
export const label = "Claude Code (local CLI)";

const MAX_ROUNDS = 4;
const SAFE_ARG = /^[\w.:\\/@-]+$/;
const SETTINGS_DIR = path.join(os.homedir(), ".sandbench", "driver-settings");

// Claude Code accepts aliases (haiku/sonnet/opus) and current dated ids. Older API
// aliases like claude-3-5-haiku-latest are retired and fail with "may not exist".
const CLI_MODEL_ALIASES = {
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus",
  fable: "fable",
  "claude-haiku-4-5": "claude-haiku-4-5",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
  "claude-haiku-5-5": "claude-haiku-5-5",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-sonnet-5-5": "claude-sonnet-5-5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
  "claude-opus-5-5": "claude-opus-5-5",
  "claude-opus-5": "claude-opus-5",
};

/** Map Sandbench / Anthropic API model ids onto Claude Code CLI --model values. */
export function mapCliModel(raw) {
  if (typeof raw !== "string") return null;
  const model = raw.trim();
  if (!model || !SAFE_ARG.test(model)) return null;
  const lower = model.toLowerCase();
  if (CLI_MODEL_ALIASES[lower]) return CLI_MODEL_ALIASES[lower];
  if (/haiku/i.test(model)) return "haiku";
  if (/sonnet/i.test(model)) return "sonnet";
  if (/opus/i.test(model)) return "opus";
  if (/^claude[\w.-]*$/i.test(model)) return model;
  return null;
}

const SESSION_ID = /^[\w-]{8,80}$/;

// The extension point for later items (SB-03 PR 1): extras = { settings?, mcpConfig?, maxTurns?,
// resume? }. SB-06 fills settings (its hook), SB-10 mcpConfig, SB-04 maxTurns; nobody else edits
// this file. With no extras the arguments are exactly what they were before.
function checkExtras(extras) {
  if (extras === null || typeof extras !== "object" || Array.isArray(extras)) throw new Error("Driver extras must be an object.");
  if (extras.mcpConfig !== undefined && (typeof extras.mcpConfig !== "string" || !SAFE_ARG.test(extras.mcpConfig))) throw new Error("mcpConfig has characters the CLI cannot take.");
  if (extras.maxTurns !== undefined && !(Number.isInteger(extras.maxTurns) && extras.maxTurns >= 1 && extras.maxTurns <= 200)) throw new Error("maxTurns must be a whole number from 1 to 200.");
  if (extras.resume !== undefined && (typeof extras.resume !== "string" || !SESSION_ID.test(extras.resume))) throw new Error("resume must be a session id.");
  if (extras.settings !== undefined && (extras.settings === null || typeof extras.settings !== "object" || Array.isArray(extras.settings))) throw new Error("settings must be an object.");
}

/** The `claude -p` arguments for one round. `model` is the already-mapped CLI model (or null). */
export function buildClaudeArgs({ settingsFile, model, sessionId, extras = {} }) {
  checkExtras(extras);
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--settings", settingsFile];
  if (model) args.push("--model", model);
  if (extras.mcpConfig !== undefined) args.push("--mcp-config", extras.mcpConfig);
  if (extras.maxTurns !== undefined) args.push("--max-turns", String(extras.maxTurns));
  const resume = extras.resume ?? sessionId;
  if (resume) args.push("--resume", resume);
  return args;
}

/**
 * The settings file's JSON. `extras.settings` is merged in, but `permissions` is always the
 * driver's own approved list: extras can never widen what Claude Code may run.
 */
export function buildClaudeSettings(allow, extras = {}) {
  checkExtras(extras);
  return JSON.stringify({ ...(extras.settings ?? {}), permissions: { allow } });
}

function isDesktopGui(full) {
  // Claude Desktop (AnthropicClaude\claude.exe) is a GUI Electron app, not the headless CLI.
  return /[/\\]AnthropicClaude[/\\]/i.test(full);
}

function candidatesIn(dir, names) {
  if (!dir) return [];
  return names.map((name) => path.join(dir, name)).filter((full) => existsSync(full) && !isDesktopGui(full));
}

function findBinary() {
  const override = process.env.SANDBENCH_CLAUDE_BIN;
  if (override) return existsSync(override) && !isDesktopGui(override) ? override : null;
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const hit = candidatesIn(dir, names)[0];
    if (hit) return hit;
  }
  if (process.platform === "win32") {
    const extras = [
      path.join(process.env.APPDATA || "", "npm"),
      path.join(process.env.LOCALAPPDATA || "", "npm"),
      path.join(os.homedir(), ".local", "bin"),
    ];
    for (const dir of extras) {
      const hit = candidatesIn(dir, names)[0];
      if (hit) return hit;
    }
  }
  return null;
}

export async function available() {
  const bin = findBinary();
  const models = ["haiku", "sonnet", "opus", "claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5-5"];
  return bin
    ? { ok: true, detail: bin, models }
    : {
        ok: false,
        detail:
          "Install the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`), sign in, then restart the harness. Claude Desktop is not the CLI.",
        models,
      };
}

function denialCommand(denial) {
  const input = denial?.tool_input ?? {};
  if (denial?.tool_name === "Bash" || denial?.tool_name === "PowerShell") return String(input.command ?? "").trim();
  const target = input.file_path ?? input.path ?? input.url ?? "";
  return `${denial?.tool_name ?? "Tool"}${target ? ` ${target}` : ""}`;
}

function allowRule(denial) {
  const input = denial?.tool_input ?? {};
  if (denial?.tool_name === "Bash" || denial?.tool_name === "PowerShell") return `${denial.tool_name}(${input.command})`;
  const target = input.file_path ?? input.path;
  return target ? `${denial.tool_name}(${target})` : String(denial?.tool_name ?? "");
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return [];
  if (raw.type === "system" && raw.subtype === "init") {
    return [{ type: "session", sessionId: raw.session_id }, { type: "thinking", text: `Claude Code session started${raw.model ? ` on ${raw.model}` : ""}.` }];
  }
  if (raw.type === "assistant") {
    return (raw.message?.content ?? []).flatMap((part) => {
      if (part.type === "text" && part.text) return [{ type: "message_delta", text: part.text }];
      if (part.type === "thinking" && part.thinking) return [{ type: "thinking", text: part.thinking.slice(0, 400) }];
      if (part.type === "tool_use") {
        return [
          { type: "thinking", text: `Claude wants ${part.name}${part.input?.command ? `: ${part.input.command}` : ""}.` },
          { type: "tool_use", toolUseId: part.id, label: denialCommand({ tool_name: part.name, tool_input: part.input }) },
        ];
      }
      return [];
    });
  }
  if (raw.type === "user") {
    return (raw.message?.content ?? []).flatMap((part) => {
      if (part.type !== "tool_result") return [];
      const content = Array.isArray(part.content) ? part.content.map((item) => item.text ?? "").join("\n") : String(part.content ?? "");
      return [
        { type: "thinking", text: `${part.is_error ? "Tool error" : "Tool result"}: ${content.slice(0, 200)}` },
        { type: "tool_result", toolUseId: part.tool_use_id, output: content, isError: Boolean(part.is_error) },
      ];
    });
  }
  if (raw.type === "result") {
    return [{ type: "result", sessionId: raw.session_id, isError: Boolean(raw.is_error), text: raw.result ?? "", denials: Array.isArray(raw.permission_denials) ? raw.permission_denials : [] }];
  }
  return [];
}

function runOnce(bin, args, stdin, cwd, io, onEvent) {
  return new Promise((resolve, reject) => {
    const windowsScript = process.platform === "win32" && bin.toLowerCase().endsWith(".cmd");
    const child = spawn(bin, args, { cwd, windowsHide: true, shell: windowsScript, stdio: ["pipe", "pipe", "pipe"] });
    const stop = () => child.kill();
    io.signal.addEventListener("abort", stop, { once: true });
    let buffer = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          normalizeEvent(JSON.parse(line)).forEach(onEvent);
        } catch {
          // Non-JSON lines are progress noise.
        }
      }
    });
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk.toString("utf8")).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => {
      io.signal.removeEventListener("abort", stop);
      if (io.signal.aborted) return reject(new DOMException("Stopped.", "AbortError"));
      if (code !== 0 && code !== null) return reject(new Error(stderr.trim() || `claude exited with ${code}.`));
      resolve();
    });
    child.stdin.end(stdin);
  });
}

export function startTurn(turn, io) {
  const bin = findBinary();
  mkdirSync(SETTINGS_DIR, { recursive: true });
  const settingsFile = path.join(SETTINGS_DIR, `${turn.id}.json`);
  const done = (async () => {
    if (!bin) throw new Error("Claude Code is not installed on this computer.");
    if (!SAFE_ARG.test(settingsFile)) throw new Error("The settings path has characters the CLI cannot take.");
    await converse(bin, settingsFile, turn, io);
  })().finally(() => rmSync(settingsFile, { force: true }));
  return { done, interrupt: () => undefined };
}

async function converse(bin, settingsFile, turn, io) {
  const allow = [];
  const approvedIds = new Map();
  const toolLabels = new Map();
  // A resumed session (extras.resume) starts the first round; later rounds resume the live one.
  const { resume, ...extras } = turn.extras ?? {};
  let sessionId = resume ?? "";
  let prompt = [turn.system, ...turn.history.map((item) => `${item.role === "user" ? "User" : "You"}: ${item.content}`), `User: ${turn.prompt}`].filter(Boolean).join("\n\n");
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    writeFileSync(settingsFile, buildClaudeSettings(allow, extras));
    // Map API / retired ids (e.g. claude-3-5-haiku-latest) onto Claude Code aliases.
    // Non-Claude ids from other test profiles are skipped so the CLI uses its default.
    const cliModel = mapCliModel(turn.model);
    if (cliModel && cliModel !== turn.model) {
      io.emit({ type: "thinking", text: `Using Claude Code model ${cliModel} (mapped from ${turn.model}).` });
    }
    const args = buildClaudeArgs({ settingsFile, model: cliModel, sessionId, extras });
    let result = null;
    await runOnce(bin, args, prompt, turn.cwd, io, (event) => {
      if (event.type === "session" && /^[\w-]{8,80}$/.test(event.sessionId || "")) sessionId = event.sessionId;
      else if (event.type === "result") result = event;
      else if (event.type === "tool_use") toolLabels.set(event.toolUseId, event.label);
      else if (event.type === "tool_result") {
        const permissionId = approvedIds.get(toolLabels.get(event.toolUseId));
        if (permissionId && !event.isError) {
          approvedIds.delete(toolLabels.get(event.toolUseId));
          io.emit({ type: "tool_end", permissionId, code: 0, output: event.output.slice(0, 16_000) });
        }
      } else io.emit(event);
    });
    if (!result) throw new Error("Claude Code ended without a result.");
    if (result.isError) throw new Error(result.text || "Claude Code reported an error.");
    const denials = result.denials.filter((item) => !allow.includes(allowRule(item)));
    if (denials.length === 0) return;
    const approved = [];
    for (const denial of denials) {
      const command = denialCommand(denial);
      if (await io.requestPermission({ command, reason: `Claude Code asked to use ${denial.tool_name}.`, tool: denial.tool_name })) {
        approved.push(denial);
        approvedIds.set(command, io.current);
      }
    }
    if (approved.length === 0 || !sessionId) return;
    allow.push(...approved.map(allowRule));
    io.emit({ type: "thinking", text: "Resume the session with the approved tools." });
    prompt = `The user approved: ${approved.map(denialCommand).join("; ")}. Run ${approved.length === 1 ? "it" : "them"} now and continue.`;
  }
}
