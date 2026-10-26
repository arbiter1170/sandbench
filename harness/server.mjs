// Sandbench local harness. Runs on 127.0.0.1 only and answers the Vite dev proxy,
// which adds the token from .harness-token. Commands only run when the browser
// sends one the user approved, and they run inside ~/.sandbench/workspace.
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listDrivers } from "./drivers/index.mjs";
import { listVoices as ttsListVoices, providerMeta, speak as ttsSpeak } from "./tts/index.mjs";
import { proxyModel } from "./modelProxy.mjs";
import { createSecretStore } from "./secrets.mjs";
import { createTurns } from "./turns.mjs";

const PORT = Number(process.env.SANDBENCH_HARNESS_PORT || 8799);
const HOOK_PORT = Number(process.env.SANDBENCH_WEBHOOK_PORT || 8801);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(HERE, "..", ".harness-token");
const SANDBENCH_HOME = path.join(os.homedir(), ".sandbench");
const WORKSPACE = path.join(SANDBENCH_HOME, "workspace");
const SKILLS_DIR = path.join(SANDBENCH_HOME, "skills");
const BOTS_DIR = path.join(SANDBENCH_HOME, "bots");
const TOKEN = randomBytes(24).toString("hex");
// API keys live here, not in the page or Firestore (SB-05). The page can add or remove a
// key but only ever reads back its name and a short preview.
const secrets = createSecretStore({ file: path.join(SANDBENCH_HOME, "secrets.json") });
const TTS_SECRETS = { xai: "XAI_API_KEY", elevenlabs: "ELEVENLABS_API_KEY", fish: "FISH_API_KEY" };
mkdirSync(SKILLS_DIR, { recursive: true });
mkdirSync(BOTS_DIR, { recursive: true });

function seedSampleSkill() {
  const dir = path.join(SKILLS_DIR, "workspace-notes");
  const file = path.join(dir, "SKILL.md");
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    `# Workspace notes

When the user asks for durable notes, write short Markdown under the Sandbench workspace and mention the path.
Prefer MEMORY.md for long-lived facts and keep daily logs under memory/log/.
`,
    "utf8",
  );
}
seedSampleSkill();
const MAX_OUTPUT = 64 * 1024;
const WINDOWS = process.platform === "win32";
const POINTER_VK = { enter: 13, tab: 9, escape: 27, up: 38, down: 40, left: 37, right: 39, space: 32, backspace: 8 };
const POINTER_CLICK = `
if (-not ([System.Management.Automation.PSTypeName]'SBPoint').Type) {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SBPoint { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); }'
}
$x = [int]$env:SB_X; $y = [int]$env:SB_Y
[SBPoint]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 40
[SBPoint]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[SBPoint]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "Clicked $x, $y"`;
const POINTER_TYPE = `
Add-Type -AssemblyName System.Windows.Forms
$t = [string]$env:SB_TEXT
$escaped = [regex]::Replace($t, '([+^%~(){}\\[\\]])', '{$1}')
[System.Windows.Forms.SendKeys]::SendWait($escaped)
Write-Output ("Typed " + $t.Length + " characters")`;
const POINTER_KEY = `
if (-not ([System.Management.Automation.PSTypeName]'SBKey').Type) {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SBKey { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'
}
$k = [byte]$env:SB_VK
[SBKey]::keybd_event($k, 0, 0, [UIntPtr]::Zero)
[SBKey]::keybd_event($k, 0, 2, [UIntPtr]::Zero)
Write-Output "Pressed key $k"`;

mkdirSync(WORKSPACE, { recursive: true });
writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });

function workspacePath(relative) {
  if (typeof relative !== "string" || !relative.trim() || relative.length > 240) return null;
  if (path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) return null;
  const target = path.resolve(WORKSPACE, relative);
  const inside = path.relative(WORKSPACE, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return target;
}

function runShell(command, { timeoutMs = 30_000, cwd = WORKSPACE, maxOutput = MAX_OUTPUT, env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = WINDOWS
      ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd, windowsHide: true, env: env ? { ...process.env, ...env } : process.env })
      : spawn("/bin/sh", ["-c", command], { cwd, env: env ? { ...process.env, ...env } : process.env });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const take = (current, chunk) => {
      if (current.length >= maxOutput) {
        truncated = true;
        return current;
      }
      return (current + chunk.toString("utf8")).slice(0, maxOutput);
    };
    child.stdout.on("data", (chunk) => (stdout = take(stdout, chunk)));
    child.stderr.on("data", (chunk) => (stderr = take(stderr, chunk)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, truncated, ms: Date.now() - started });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error), truncated, ms: Date.now() - started });
    });
  });
}

const SCREEN_PS = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$full = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$w = [Math]::Min(1280, $b.Width); $h = [int]($b.Height * $w / $b.Width)
$small = New-Object System.Drawing.Bitmap $full, $w, $h
$ms = New-Object IO.MemoryStream
$small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())`;

let screenCache = { at: 0, data: null, pending: null };
async function captureScreen() {
  if (screenCache.data && Date.now() - screenCache.at < 1000) return screenCache.data;
  if (screenCache.pending) return screenCache.pending;
  screenCache.pending = (async () => {
    if (WINDOWS) {
      const result = await runShell(SCREEN_PS, { timeoutMs: 10_000, maxOutput: 16 * 1024 * 1024 });
      if (result.code !== 0) throw new Error(result.stderr || "Screen capture failed.");
      return Buffer.from(result.stdout.trim(), "base64");
    }
    if (process.platform === "darwin") {
      const file = path.join(os.tmpdir(), `sandbench-${process.pid}.jpg`);
      const result = await runShell(`screencapture -x -t jpg "${file}" && base64 -i "${file}"`, { timeoutMs: 10_000, maxOutput: 16 * 1024 * 1024 });
      if (result.code !== 0) throw new Error(result.stderr || "Screen capture failed.");
      return Buffer.from(result.stdout.replace(/\s+/g, ""), "base64");
    }
    if (process.platform === "linux") {
      const file = path.join(os.tmpdir(), `sandbench-${process.pid}.jpg`);
      const result = await runShell(
        `(command -v import >/dev/null && import -window root "${file}") || (command -v gnome-screenshot >/dev/null && gnome-screenshot -f "${file}") || (command -v scrot >/dev/null && scrot "${file}"); base64 -w0 "${file}" 2>/dev/null || base64 "${file}"`,
        { timeoutMs: 10_000, maxOutput: 16 * 1024 * 1024 },
      );
      if (result.code !== 0) throw new Error(result.stderr || "Screen capture failed. Install ImageMagick (import), gnome-screenshot, or scrot.");
      return Buffer.from(result.stdout.replace(/\s+/g, ""), "base64");
    }
    throw new Error("Screen capture is not wired for this platform.");
  })();
  try {
    const data = await screenCache.pending;
    screenCache = { at: Date.now(), data, pending: null };
    return data;
  } catch (error) {
    screenCache.pending = null;
    throw error;
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function runMacPointer(body, point) {
  if (body.action === "click") {
    if (!point) return { error: "Click needs screen coordinates." };
    console.log(`[input] click ${body.x},${body.y}`);
    // Prefer cliclick when installed; fall back to AppleScript System Events (limited).
    const result = await runShell(
      `if command -v cliclick >/dev/null; then cliclick c:${body.x},${body.y}; else osascript -e 'tell application "System Events" to click at {${body.x}, ${body.y}}'; fi`,
      { timeoutMs: 10_000 },
    );
    return result;
  }
  if (body.action === "type") {
    if (typeof body.text !== "string" || !body.text) return { error: "Type needs text." };
    if (body.text.length > 400) return { error: "Type is limited to 400 characters." };
    console.log(`[input] type ${body.text.length} chars`);
    const quoted = shellEscape(body.text);
    return runShell(
      `if command -v cliclick >/dev/null; then printf %s ${quoted} | cliclick t:$(cat); else osascript -e 'tell application "System Events" to keystroke ${quoted}'; fi`,
      { timeoutMs: 10_000 },
    );
  }
  if (body.action === "key") {
    const key = String(body.key || "").toLowerCase();
    const map = { enter: "return", tab: "tab", escape: "escape", space: "space", backspace: "delete" };
    const named = map[key];
    if (!named) return { error: "That key is not available on macOS." };
    console.log(`[input] key ${key}`);
    return runShell(`osascript -e 'tell application "System Events" to key code ${key === "enter" ? 36 : key === "tab" ? 48 : key === "escape" ? 53 : key === "space" ? 49 : 51}'`, {
      timeoutMs: 10_000,
    });
  }
  return { error: "Unknown pointer action." };
}

async function runLinuxPointer(body, point) {
  if (body.action === "click") {
    if (!point) return { error: "Click needs screen coordinates." };
    console.log(`[input] click ${body.x},${body.y}`);
    return runShell(`command -v xdotool >/dev/null || { echo "Install xdotool for pointer control." >&2; exit 1; }; xdotool mousemove ${body.x} ${body.y} click 1`, {
      timeoutMs: 10_000,
    });
  }
  if (body.action === "type") {
    if (typeof body.text !== "string" || !body.text) return { error: "Type needs text." };
    if (body.text.length > 400) return { error: "Type is limited to 400 characters." };
    console.log(`[input] type ${body.text.length} chars`);
    return runShell(`command -v xdotool >/dev/null || { echo "Install xdotool for pointer control." >&2; exit 1; }; xdotool type --clearmodifiers -- ${shellEscape(body.text)}`, {
      timeoutMs: 10_000,
    });
  }
  if (body.action === "key") {
    const key = String(body.key || "").toLowerCase();
    const map = { enter: "Return", tab: "Tab", escape: "Escape", space: "space", backspace: "BackSpace", up: "Up", down: "Down", left: "Left", right: "Right" };
    const named = map[key];
    if (!named) return { error: "That key is not available." };
    console.log(`[input] key ${key}`);
    return runShell(`command -v xdotool >/dev/null || { echo "Install xdotool for pointer control." >&2; exit 1; }; xdotool key ${named}`, { timeoutMs: 10_000 });
  }
  return { error: "Unknown pointer action." };
}

function botDir(botId) {
  return path.join(BOTS_DIR, botId);
}

function readBotSoul(botId) {
  const file = path.join(botDir(botId), "SOUL.md");
  if (!existsSync(file)) return { soul: "", exists: false };
  return { soul: readFileSync(file, "utf8").slice(0, 24_000), exists: true };
}

function writeBotSoul(botId, soul) {
  const dir = botDir(botId);
  mkdirSync(dir, { recursive: true });
  const text = String(soul).slice(0, 24_000);
  writeFileSync(path.join(dir, "SOUL.md"), text, "utf8");
  return { ok: true, bytes: Buffer.byteLength(text, "utf8") };
}

function memoryAllowlisted(rel) {
  if (rel === "MEMORY.md") return true;
  if (/^memory\/[a-zA-Z0-9][\w.-]{0,60}\.md$/.test(rel)) return true;
  if (/^memory\/log\/\d{4}-\d{2}-\d{2}\.md$/.test(rel)) return true;
  return false;
}

function readBotMemory(botId) {
  const root = botDir(botId);
  const files = [];
  const indexPath = path.join(root, "MEMORY.md");
  if (existsSync(indexPath)) {
    files.push({ path: "MEMORY.md", content: readFileSync(indexPath, "utf8").slice(0, 64_000) });
  }
  const memDir = path.join(root, "memory");
  if (existsSync(memDir)) {
    for (const name of readdirSafe(memDir)) {
      if (!name.endsWith(".md")) continue;
      const rel = `memory/${name}`;
      if (!memoryAllowlisted(rel)) continue;
      files.push({ path: rel, content: readFileSync(path.join(memDir, name), "utf8").slice(0, 32_000) });
    }
  }
  const logDir = path.join(root, "memory", "log");
  if (existsSync(logDir)) {
    for (const name of readdirSafe(logDir).slice(-14)) {
      const rel = `memory/log/${name}`;
      if (!memoryAllowlisted(rel)) continue;
      files.push({ path: rel, content: readFileSync(path.join(logDir, name), "utf8").slice(0, 16_000) });
    }
  }
  return { files };
}

function writeBotMemory(botId, body) {
  const rel = typeof body.path === "string" ? body.path.replace(/\\/g, "/") : "";
  if (!memoryAllowlisted(rel)) throw new Error("That memory path is not allowed.");
  const target = path.join(botDir(botId), ...rel.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  if (body.op === "delete") {
    if (existsSync(target)) unlinkSync(target);
    return { ok: true, path: rel, bytes: 0 };
  }
  const content = typeof body.content === "string" ? body.content.slice(0, 64_000) : "";
  writeFileSync(target, content, "utf8");
  return { ok: true, path: rel, bytes: Buffer.byteLength(content, "utf8") };
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

function listSkillLibrary() {
  const skills = [];
  for (const name of readdirSafe(SKILLS_DIR)) {
    const skillMd = path.join(SKILLS_DIR, name, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const raw = readFileSync(skillMd, "utf8").slice(0, 32_000);
    const title = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() || name;
    const summary = raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) || "";
    skills.push({ id: name, title, summary: summary.slice(0, 200), body: raw });
  }
  return skills;
}

let lastCpu = os.cpus();
function cpuPercent() {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((cpu, index) => {
    const before = lastCpu[index]?.times ?? cpu.times;
    const spent = Object.keys(cpu.times).reduce((sum, key) => sum + (cpu.times[key] - before[key]), 0);
    idle += cpu.times.idle - before.idle;
    total += spent;
  });
  lastCpu = now;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

async function processes() {
  const command = WINDOWS
    ? "Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 @{n='name';e={$_.ProcessName}},@{n='cpu';e={[math]::Round($_.CPU,1)}},@{n='mem';e={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress"
    : "ps -eo comm,time,rss --sort=-time | head -n 13";
  const result = await runShell(command, { timeoutMs: 10_000 });
  let list = [];
  if (WINDOWS) {
    try {
      const parsed = JSON.parse(result.stdout || "[]");
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      list = [];
    }
  } else {
    list = result.stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const [name, time, rss] = line.trim().split(/\s+/);
        const [h, m, s] = (time || "0:0:0").split(":").map(Number);
        return { name, cpu: (h || 0) * 3600 + (m || 0) * 60 + (s || 0), mem: Math.round(Number(rss || 0) / 1024) };
      });
  }
  return {
    cpu: cpuPercent(),
    memUsed: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
    memTotal: Math.round(os.totalmem() / 1024 / 1024),
    host: os.hostname(),
    platform: process.platform,
    list,
  };
}

async function readSse(response) {
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  if (type.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    return data.length ? JSON.parse(data[data.length - 1]) : null;
  }
  return text ? JSON.parse(text) : null;
}

async function openMcp(url, headers) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only http and https MCP servers are supported.");
  const base = { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers };
  const init = await fetch(url, {
    method: "POST",
    headers: base,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sandbench", version: "0.1.0" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!init.ok) throw new Error(`initialize returned ${init.status}`);
  const session = init.headers.get("mcp-session-id");
  const info = await readSse(init);
  const next = session ? { ...base, "mcp-session-id": session } : base;
  await fetch(url, {
    method: "POST",
    headers: next,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  return { info, headers: next };
}

async function callMcp(url, headers, tool, args) {
  const session = await openMcp(url, headers);
  const response = await fetch(url, {
    method: "POST",
    headers: session.headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: tool, arguments: args ?? {} } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`tools/call returned ${response.status}`);
  const result = await readSse(response);
  if (result?.error) throw new Error(result.error.message || "Tool call failed.");
  const content = result?.result?.content ?? [];
  const text = content
    .map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
    .join("\n")
    .slice(0, MAX_OUTPUT);
  return { isError: Boolean(result?.result?.isError), text };
}

function toolSchema(input) {
  if (!input || typeof input !== "object") return undefined;
  const properties = {};
  for (const [key, value] of Object.entries(input.properties ?? {})) {
    if (value && typeof value === "object") properties[key] = { type: value.type, description: typeof value.description === "string" ? value.description : "" };
  }
  return {
    properties,
    required: Array.isArray(input.required) ? input.required.filter((key) => typeof key === "string") : [],
  };
}

async function probeMcp(url, headers) {
  const { info, headers: next } = await openMcp(url, headers);
  const listed = await fetch(url, {
    method: "POST",
    headers: next,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(10_000),
  });
  const tools = listed.ok ? await readSse(listed) : null;
  return {
    server: info?.result?.serverInfo ?? null,
    tools: (tools?.result?.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      schema: toolSchema(tool.inputSchema),
    })),
  };
}

const SCHEDULE_FILE = path.join(os.homedir(), ".sandbench", "schedules.json");

function parseSchedule(schedule) {
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

function routineDue(schedule, lastRunAt, now) {
  const parsed = parseSchedule(schedule);
  if (!parsed) return false;
  const last = lastRunAt ?? 0;
  if (parsed.kind === "every") return now.getTime() - last >= parsed.minutes * 60_000;
  if (!parsed.days.includes(now.getDay())) return false;
  const slot = new Date(now);
  slot.setHours(parsed.hour, parsed.minute, 0, 0);
  return now.getTime() >= slot.getTime() && now.getTime() - slot.getTime() < 10 * 60_000 && last < slot.getTime();
}

function loadSchedules() {
  try {
    const parsed = JSON.parse(readFileSync(SCHEDULE_FILE, "utf8"));
    return {
      routines: Array.isArray(parsed.routines) ? parsed.routines : [],
      fired: parsed.fired && typeof parsed.fired === "object" ? parsed.fired : {},
      due: Array.isArray(parsed.due) ? parsed.due : [],
    };
  } catch {
    return { routines: [], fired: {}, due: [] };
  }
}

let schedules = loadSchedules();

function saveSchedules() {
  writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules));
}

function notifyRoutine(title) {
  if (!WINDOWS) return;
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(6000, 'Sandbench', $env:SB_TITLE, 'Info'); Start-Sleep -Seconds 7; $n.Dispose()",
    ],
    { windowsHide: true, detached: true, stdio: "ignore", env: { ...process.env, SB_TITLE: `Routine ready: ${title}`.slice(0, 180) } },
  );
  child.unref();
}

function tickSchedules() {
  const now = new Date();
  let changed = false;
  for (const routine of schedules.routines) {
    if (!routine.enabled || !routineDue(routine.schedule, schedules.fired[routine.id], now)) continue;
    schedules.fired[routine.id] = now.getTime();
    changed = true;
    if (schedules.due.some((item) => item.routineId === routine.id)) continue;
    schedules.due.push({ id: randomBytes(8).toString("hex"), routineId: routine.id, botId: routine.botId, title: routine.title, at: now.getTime() });
    console.log(`[routine] ${routine.title}`);
    notifyRoutine(routine.title);
  }
  if (changed) saveSchedules();
}

setInterval(tickSchedules, 15_000);

const TRIGGER_FILE = path.join(os.homedir(), ".sandbench", "triggers.json");
const MAX_RUNS = 50;

function loadTriggers() {
  try {
    const parsed = JSON.parse(readFileSync(TRIGGER_FILE, "utf8"));
    return {
      webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs.slice(0, MAX_RUNS) : [],
    };
  } catch {
    return { webhooks: [], runs: [] };
  }
}

let triggers = loadTriggers();

function saveTriggers() {
  writeFileSync(TRIGGER_FILE, JSON.stringify(triggers));
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest();
}

function recordRun(run) {
  triggers.runs = [{ id: randomBytes(8).toString("hex"), at: Date.now(), ...run }, ...triggers.runs].slice(0, MAX_RUNS);
  saveTriggers();
}

function publicWebhook(hook) {
  return { id: hook.id, botId: hook.botId, name: hook.name, title: hook.title, enabled: hook.enabled, hasSecret: Boolean(hook.secretHash) };
}

function cleanText(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function fillHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, secrets.fill(String(value))]));
}

async function readJson(req, limit = 256 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

const agentTurns = createTurns({
  runShell,
  captureScreen,
  secrets,
  resolveFolder: (folder) => {
    const cwd = folder ? workspacePath(folder) : WORKSPACE;
    if (cwd) mkdirSync(cwd, { recursive: true });
    return cwd;
  },
});

const server = createServer(async (req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return send(res, 403, { error: "Bad host." });
  if (req.headers["x-sandbench-token"] !== TOKEN) return send(res, 401, { error: "Missing harness token." });
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, platform: process.platform, host: os.hostname(), workspace: WORKSPACE });
    }
    if (req.method === "GET" && url.pathname === "/screen") {
      return send(res, 200, await captureScreen(), "image/jpeg");
    }
    if (req.method === "GET" && url.pathname === "/processes") {
      return send(res, 200, await processes());
    }
    if (req.method === "POST" && url.pathname === "/input") {
      const body = await readJson(req);
      if (body.approved !== true) return send(res, 403, { error: "Pointer action was not approved." });
      const point = Number.isInteger(body.x) && Number.isInteger(body.y) && body.x >= 0 && body.y >= 0 && body.x <= 20000 && body.y <= 20000;
      let result;
      if (WINDOWS) {
        if (body.action === "click") {
          if (!point) return send(res, 400, { error: "Click needs screen coordinates." });
          console.log(`[input] click ${body.x},${body.y}`);
          result = await runShell(POINTER_CLICK, { timeoutMs: 10_000, env: { SB_X: String(body.x), SB_Y: String(body.y) } });
        } else if (body.action === "type") {
          if (typeof body.text !== "string" || !body.text) return send(res, 400, { error: "Type needs text." });
          if (body.text.length > 400) return send(res, 400, { error: "Type is limited to 400 characters." });
          console.log(`[input] type ${body.text.length} chars`);
          result = await runShell(POINTER_TYPE, { timeoutMs: 10_000, env: { SB_TEXT: body.text } });
        } else if (body.action === "key") {
          const vk = POINTER_VK[String(body.key || "").toLowerCase()];
          if (!vk) return send(res, 400, { error: "That key is not available." });
          console.log(`[input] key ${body.key}`);
          result = await runShell(POINTER_KEY, { timeoutMs: 10_000, env: { SB_VK: String(vk) } });
        } else {
          return send(res, 400, { error: "Unknown pointer action." });
        }
      } else if (process.platform === "darwin") {
        result = await runMacPointer(body, point);
        if (result.error) return send(res, 400, { error: result.error });
      } else if (process.platform === "linux") {
        result = await runLinuxPointer(body, point);
        if (result.error) return send(res, 400, { error: result.error });
      } else {
        return send(res, 400, { error: "Pointer actions are not supported on this platform." });
      }
      let screenThumb = null;
      if (body.captureScreen !== false && result.code === 0) {
        try {
          const jpeg = await captureScreen();
          if (jpeg.length < 200_000) screenThumb = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
        } catch {
          // Thumbnail is optional.
        }
      }
      return send(res, 200, { ...result, ...(screenThumb ? { screenThumb } : {}) });
    }
    if (req.method === "GET" && url.pathname === "/tts/meta") {
      return send(res, 200, providerMeta());
    }
    if (req.method === "GET" && url.pathname === "/tts/voices") {
      const provider = String(url.searchParams.get("provider") || "xai");
      const key = TTS_SECRETS[provider] ? (secrets.get(TTS_SECRETS[provider]) ?? "") : "";
      const baseUrl = String(url.searchParams.get("baseUrl") || "").trim();
      try {
        const voices = await ttsListVoices(provider, { key, baseUrl });
        return send(res, 200, { voices, provider });
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && url.pathname === "/tts/speak") {
      const body = await readJson(req);
      const provider = String(body.provider || "xai");
      try {
        const audio = await ttsSpeak(provider, {
          text: body.text,
          voiceId: body.voiceId,
          key: TTS_SECRETS[provider] ? (secrets.get(TTS_SECRETS[provider]) ?? "") : "",
          baseUrl: body.baseUrl,
          model: body.model,
          fishModel: body.fishModel,
        });
        res.writeHead(200, { "content-type": audio.mime, "cache-control": "no-store" });
        res.end(Buffer.from(audio.bytes));
        return;
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (req.method === "GET" && url.pathname === "/skills") {
      return send(res, 200, { skills: listSkillLibrary() });
    }
    if (req.method === "GET" && url.pathname.startsWith("/bots/") && url.pathname.endsWith("/memory")) {
      const botId = url.pathname.slice("/bots/".length, -"/memory".length);
      if (!/^[-\w]{1,80}$/.test(botId)) return send(res, 400, { error: "Bad bot id." });
      return send(res, 200, readBotMemory(botId));
    }
    if (req.method === "POST" && url.pathname.startsWith("/bots/") && url.pathname.endsWith("/memory")) {
      const botId = url.pathname.slice("/bots/".length, -"/memory".length);
      if (!/^[-\w]{1,80}$/.test(botId)) return send(res, 400, { error: "Bad bot id." });
      const body = await readJson(req);
      try {
        return send(res, 200, writeBotMemory(botId, body));
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (req.method === "GET" && url.pathname.startsWith("/bots/") && url.pathname.endsWith("/soul")) {
      const botId = url.pathname.slice("/bots/".length, -"/soul".length);
      if (!/^[-\w]{1,80}$/.test(botId)) return send(res, 400, { error: "Bad bot id." });
      return send(res, 200, readBotSoul(botId));
    }
    if (req.method === "POST" && url.pathname.startsWith("/bots/") && url.pathname.endsWith("/soul")) {
      const botId = url.pathname.slice("/bots/".length, -"/soul".length);
      if (!/^[-\w]{1,80}$/.test(botId)) return send(res, 400, { error: "Bad bot id." });
      const body = await readJson(req);
      return send(res, 200, writeBotSoul(botId, typeof body.soul === "string" ? body.soul : ""));
    }
    if (req.method === "POST" && url.pathname === "/workspace/write") {
      const body = await readJson(req);
      if (body.approved !== true) return send(res, 403, { error: "File change was not approved." });
      const target = workspacePath(body.path);
      if (!target) return send(res, 400, { error: "The path must stay inside the workspace folder." });
      if (body.op === "delete") {
        if (!existsSync(target)) return send(res, 404, { error: "That file does not exist." });
        unlinkSync(target);
        console.log(`[file] delete ${body.path}`);
        return send(res, 200, { ok: true, path: path.relative(WORKSPACE, target), bytes: 0 });
      }
      if (typeof body.content !== "string") return send(res, 400, { error: "No file content." });
      if (Buffer.byteLength(body.content, "utf8") > 256 * 1024 - 4096) return send(res, 400, { error: "Files are limited to about 250 KB." });
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body.content, "utf8");
      console.log(`[file] write ${body.path}`);
      return send(res, 200, { ok: true, path: path.relative(WORKSPACE, target), bytes: Buffer.byteLength(body.content, "utf8") });
    }
    if (req.method === "GET" && url.pathname === "/workspace/read") {
      const target = workspacePath(url.searchParams.get("path"));
      if (!target) return send(res, 400, { error: "The path must stay inside the workspace folder." });
      if (!existsSync(target)) return send(res, 200, { exists: false, content: "" });
      return send(res, 200, { exists: true, content: readFileSync(target, "utf8").slice(0, 64 * 1024) });
    }
    if (req.method === "POST" && url.pathname === "/exec") {
      const body = await readJson(req);
      if (typeof body.command !== "string" || !body.command.trim()) return send(res, 400, { error: "No command." });
      if (body.approved !== true) return send(res, 403, { error: "Command was not approved." });
      const cwd = body.folder ? workspacePath(body.folder) : WORKSPACE;
      if (!cwd) return send(res, 400, { error: "The working folder must stay inside the workspace folder." });
      mkdirSync(cwd, { recursive: true });
      console.log(`[exec] ${body.folder ? `(${body.folder}) ` : ""}${body.command}`);
      const result = await runShell(body.command, { cwd });
      let screenThumb = null;
      if (body.captureScreen === true && result.code === 0) {
        try {
          const jpeg = await captureScreen();
          if (jpeg.length < 200_000) screenThumb = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
        } catch {
          // optional
        }
      }
      return send(res, 200, { ...result, ...(screenThumb ? { screenThumb } : {}) });
    }
    if (req.method === "POST" && url.pathname === "/mcp/probe") {
      const body = await readJson(req);
      return send(res, 200, await probeMcp(String(body.url || ""), fillHeaders(body.headers)));
    }
    if (req.method === "POST" && url.pathname === "/mcp/call") {
      const body = await readJson(req);
      if (body.approved !== true) return send(res, 403, { error: "Tool call was not approved." });
      console.log(`[mcp] ${body.tool} @ ${body.url}`);
      const headers = fillHeaders(body.headers);
      return send(res, 200, await callMcp(String(body.url || ""), headers, String(body.tool || ""), body.args));
    }
    if (req.method === "POST" && url.pathname === "/schedules") {
      const body = await readJson(req);
      const routines = Array.isArray(body.routines) ? body.routines : [];
      const ids = new Set(routines.map((item) => item.id));
      schedules.routines = routines
        .filter((item) => item && typeof item.id === "string" && typeof item.botId === "string" && typeof item.title === "string" && typeof item.schedule === "string")
        .map((item) => ({ id: item.id, botId: item.botId, title: item.title.slice(0, 240), schedule: item.schedule.slice(0, 80), enabled: item.enabled !== false }));
      for (const routine of schedules.routines) {
        if (schedules.fired[routine.id] === undefined) schedules.fired[routine.id] = Date.now();
      }
      for (const id of Object.keys(schedules.fired)) if (!ids.has(id)) delete schedules.fired[id];
      schedules.due = schedules.due.filter((item) => item.webhookId || ids.has(item.routineId));
      saveSchedules();
      tickSchedules();
      return send(res, 200, { ok: true, waiting: schedules.due.length });
    }
    if (req.method === "GET" && url.pathname === "/triggers") {
      return send(res, 200, { hookPort: HOOK_PORT, webhooks: triggers.webhooks.map(publicWebhook), runs: triggers.runs.slice(0, 20) });
    }
    if (req.method === "POST" && url.pathname === "/triggers/sync") {
      const body = await readJson(req);
      const incoming = (Array.isArray(body.webhooks) ? body.webhooks : []).filter(
        (item) => item && typeof item.id === "string" && typeof item.botId === "string" && typeof item.name === "string",
      );
      const known = new Map(triggers.webhooks.map((hook) => [hook.id, hook]));
      triggers.webhooks = incoming.slice(0, 50).map((item) => ({
        id: item.id.slice(0, 64),
        botId: item.botId.slice(0, 64),
        name: cleanText(item.name, 80),
        title: cleanText(item.title, 400),
        enabled: item.enabled !== false,
        secretHash: known.get(item.id)?.secretHash,
      }));
      const ids = new Set(triggers.webhooks.map((hook) => hook.id));
      schedules.due = schedules.due.filter((item) => !item.webhookId || ids.has(item.webhookId));
      saveTriggers();
      saveSchedules();
      return send(res, 200, { ok: true, webhooks: triggers.webhooks.map(publicWebhook) });
    }
    if (req.method === "POST" && url.pathname === "/triggers/secret") {
      const body = await readJson(req);
      const hook = triggers.webhooks.find((item) => item.id === body.id);
      if (!hook) return send(res, 404, { error: "Sync the webhook before asking for a secret." });
      const secret = `sbh_${randomBytes(24).toString("base64url")}`;
      hook.secretHash = hashSecret(secret).toString("hex");
      saveTriggers();
      return send(res, 200, { secret, preview: secret.slice(-4) });
    }
    if (req.method === "POST" && url.pathname === "/triggers/runs") {
      const body = await readJson(req);
      if (!["routine", "webhook"].includes(body.kind) || !["ok", "failed", "skipped"].includes(body.status)) return send(res, 400, { error: "Bad run receipt." });
      recordRun({
        kind: body.kind,
        triggerId: cleanText(body.triggerId, 64),
        botId: cleanText(body.botId, 64),
        title: cleanText(body.title, 240),
        status: body.status,
        ms: Number.isFinite(body.ms) ? Math.round(body.ms) : undefined,
      });
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/secrets") {
      return send(res, 200, { secrets: secrets.list() });
    }
    const secretRoute = /^\/secrets\/([A-Z][A-Z0-9_]{1,63})$/.exec(url.pathname);
    if (req.method === "PUT" && secretRoute) {
      const body = await readJson(req);
      try {
        return send(res, 200, secrets.set(secretRoute[1], body.value, body.scope || "shared"));
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (req.method === "DELETE" && secretRoute) {
      try {
        return send(res, 200, { ok: secrets.remove(secretRoute[1]) });
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/model") {
      const body = await readJson(req, 2 * 1024 * 1024);
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      return await proxyModel(body, res, { store: secrets, allowLocal: true, signal: controller.signal });
    }
    if (req.method === "GET" && url.pathname === "/drivers") {
      return send(res, 200, { drivers: await listDrivers() });
    }
    if (req.method === "POST" && url.pathname === "/turns") {
      const body = await readJson(req);
      return send(res, 200, agentTurns.start(body));
    }
    const interrupt = /^\/turns\/([a-f0-9]{16})\/interrupt$/.exec(url.pathname);
    if (req.method === "POST" && interrupt) {
      return send(res, 200, { ok: agentTurns.interrupt(interrupt[1]) });
    }
    const permission = /^\/permissions\/([a-f0-9]{16})$/.exec(url.pathname);
    if (req.method === "POST" && permission) {
      const body = await readJson(req);
      const ok = agentTurns.permit(permission[1], body.allow === true);
      return send(res, ok ? 200 : 404, ok ? { ok } : { error: "That request is no longer waiting." });
    }
    if (req.method === "GET" && url.pathname === "/events") {
      return agentTurns.subscribe(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/due") {
      return send(res, 200, { items: schedules.due });
    }
    if (req.method === "POST" && url.pathname === "/due/ack") {
      const body = await readJson(req);
      const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
      schedules.due = schedules.due.filter((item) => !ids.has(item.id));
      saveSchedules();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Not found." });
  } catch (error) {
    // A streamed model reply that fails half way has already sent its headers.
    if (res.headersSent) return res.end();
    const closed = error?.cause?.code === "UND_ERR_SOCKET" || error?.message === "terminated";
    return send(res, 500, { error: closed ? "The remote server closed the connection." : error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Sandbench harness on http://127.0.0.1:${PORT}`);
  console.log(`Commands run in ${WORKSPACE}`);
});

async function readText(req, limit) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request too large.");
  }
  return raw;
}

function secretMatches(hook, header) {
  const match = /^Bearer\s+(\S+)$/i.exec(header || "");
  if (!match || !hook.secretHash) return false;
  return timingSafeEqual(hashSecret(match[1]), Buffer.from(hook.secretHash, "hex"));
}

const hooks = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    const route = /^\/hooks\/([A-Za-z0-9-]{1,64})$/.exec(url.pathname);
    if (req.method !== "POST" || !route) return send(res, 404, { error: "Not found." });
    const hook = triggers.webhooks.find((item) => item.id === route[1]);
    if (!hook || !secretMatches(hook, req.headers.authorization)) return send(res, 401, { error: "Unknown webhook or wrong secret." });
    const payload = (await readText(req, 64 * 1024)).slice(0, 4000);
    if (!hook.enabled) {
      recordRun({ kind: "webhook", triggerId: hook.id, botId: hook.botId, title: hook.name, status: "skipped" });
      return send(res, 409, { error: "This webhook is paused." });
    }
    if (schedules.due.filter((item) => item.webhookId === hook.id).length >= 20) return send(res, 429, { error: "Too many deliveries are waiting." });
    const item = { id: randomBytes(8).toString("hex"), webhookId: hook.id, botId: hook.botId, title: hook.title || hook.name, payload, at: Date.now() };
    schedules.due.push(item);
    saveSchedules();
    console.log(`[webhook] ${hook.name}`);
    return send(res, 202, { queued: true, id: item.id });
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

hooks.listen(HOOK_PORT, "127.0.0.1", () => {
  console.log(`Webhook receiver on http://127.0.0.1:${HOOK_PORT}/hooks/<id>`);
});
