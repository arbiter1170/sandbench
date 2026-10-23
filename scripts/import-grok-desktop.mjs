#!/usr/bin/env node
// Reads Grok Bot desktop sand-client-persistence blobs and writes sandbench-migration.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHAPES = new Set(["pebble", "bean", "capsule", "gem", "hex"]);
const COLORS = ["#0c5f73", "#8d2348", "#1f4b3a", "#3d4a88", "#8a5a12", "#243044"];

function persistenceDir(input) {
  if (input) return path.resolve(input);
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Grok Bot", "sand-client-persistence");
}

function readBlobs(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Persistence folder not found: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".blob"))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")).value;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function mapShape(raw) {
  const shape = String(raw || "pebble").toLowerCase();
  return SHAPES.has(shape) ? shape : "pebble";
}

function mapColor(raw) {
  const color = String(raw || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[Math.abs(hash(color)) % COLORS.length];
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

function threadMessages(entries) {
  const out = [];
  for (const entry of entries) {
    if (entry.kind === "message" && typeof entry.content === "string" && entry.content.trim()) {
      out.push({ role: entry.role === "assistant" ? "assistant" : "user", text: entry.content.trim().slice(0, 12_000) });
    }
    if (entry.kind === "send-message" && entry.message?.type === "text" && typeof entry.message.content === "string") {
      out.push({ role: "assistant", text: entry.message.content.trim().slice(0, 12_000) });
    }
  }
  return out.slice(-120);
}

function main() {
  const dir = persistenceDir(process.argv[2]);
  const blobs = readBlobs(dir);
  let agents = [];
  let pinned = new Set();
  const threads = [];
  const routines = [];
  for (const value of blobs) {
    if (Array.isArray(value.rows) && value.rows[0]?.name) agents = value.rows;
    if (Array.isArray(value.pinnedAgentIds)) pinned = new Set(value.pinnedAgentIds);
    if (Array.isArray(value.entries) && value.entries.some((e) => e.kind === "message" || e.kind === "send-message")) {
      const title = value.entries.find((e) => e.kind === "message" && e.role === "user")?.content?.slice(0, 72) || "Imported chat";
      const messages = threadMessages(value.entries);
      if (messages.length) threads.push({ title, messages });
    }
    for (const entry of value.entries ?? []) {
      if (entry.event?.type === "automation-changed" && entry.event.action === "created") {
        routines.push({ title: entry.event.automationName || entry.event.automationId || "Routine", schedule: "Weekdays at 9:00" });
      }
    }
  }
  if (agents.length === 0) throw new Error("No agent rows found in persistence blobs.");
  const bots = agents.map((agent, index) => ({
    ref: `bot-${index + 1}`,
    name: String(agent.name || `Bot ${index + 1}`).slice(0, 80),
    role: String(agent.title || agent.role || "Teammate").slice(0, 120),
    instructions: String(agent.description || "").slice(0, 8000),
    persona: "Imported from Grok Bot.",
    color: mapColor(agent.avatarColor),
    shape: mapShape(agent.avatarShape),
    voice: "cove",
    skills: ["computer", "reminders"],
    provider: "anthropic",
    driver: "anthropic",
    plugins: [],
    connectors: [],
    ...(agent.description ? { memories: [String(agent.description).slice(0, 2000)] } : {}),
  }));
  const pack = {
    format: "sandbench-migration",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: { app: "grok-desktop", version: "sand-client-persistence" },
    bots,
    plugins: [],
    connectors: [],
    channels: [],
    routines: routines.slice(0, 40).map((item, index) => ({ bot: bots[index % bots.length].ref, title: item.title, schedule: item.schedule })),
    threads: threads.slice(0, 40).map((thread, index) => ({ bot: bots[index % bots.length].ref, title: thread.title, messages: thread.messages })),
  };
  const out = process.argv[3] ? path.resolve(process.argv[3]) : path.join(process.cwd(), "sandbench-migration.json");
  fs.writeFileSync(out, JSON.stringify(pack, null, 2), "utf8");
  console.log(`Wrote ${out} (${bots.length} bots, ${pack.threads.length} threads, ${pack.routines.length} routines).`);
}

main();
