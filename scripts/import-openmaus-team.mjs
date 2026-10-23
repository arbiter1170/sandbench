#!/usr/bin/env node
// Convert an OpenMausBot BotMRR / team Markdown subset into a sandbench-team.json pack.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#") || stripped.startsWith("-")) continue;
    const eq = stripped.indexOf(":");
    if (eq < 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^\d+$/.test(value)) meta[key] = Number(value);
    else meta[key] = value;
  }
  // Collect agents as simple list when written as YAML list of maps (name/title only).
  const agents = [];
  let current = null;
  let inAgents = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^agents:\s*$/.test(line.trim())) {
      inAgents = true;
      continue;
    }
    if (inAgents && /^[a-zA-Z]/.test(line) && !line.startsWith(" ") && !line.startsWith("-")) {
      inAgents = false;
      if (current) agents.push(current);
      current = null;
      continue;
    }
    if (!inAgents) continue;
    const item = /^\s*-\s+key:\s*(.+)$/.exec(line) || /^\s*-\s+name:\s*(.+)$/.exec(line);
    if (item) {
      if (current) agents.push(current);
      const raw = item[1].trim().replace(/^["']|["']$/g, "");
      current = { key: raw, name: raw };
      continue;
    }
    if (!current) continue;
    const field = /^\s+(name|title|description|key):\s*(.+)$/.exec(line);
    if (field) {
      const val = field[2].trim().replace(/^["']|["']$/g, "");
      if (field[1] === "name") current.name = val;
      if (field[1] === "title") current.role = val;
      if (field[1] === "description") current.instructions = val;
      if (field[1] === "key") current.key = val;
    }
    const color = /^\s+color:\s*(.+)$/.exec(line);
    if (color) current.color = color[1].trim().replace(/^["']|["']$/g, "");
  }
  if (current) agents.push(current);
  if (agents.length) meta._agents = agents;
  return { meta, body: match[2] };
}

function blankBot(name, role) {
  return {
    id: randomUUID(),
    name,
    role: role || "Teammate",
    instructions: "",
    persona: "",
    color: "#4ea1ff",
    shape: "pebble",
    voice: "cove",
    primary: false,
    hidden: false,
    skills: ["computer", "files"],
    memories: [],
    section: "",
    lastThinking: [],
    createdAt: Date.now(),
  };
}

export function openMausMarkdownToTeam(text) {
  const { meta, body } = parseFrontmatter(text);
  const bots = [];
  if (Array.isArray(meta._agents) && meta._agents.length) {
    for (const agent of meta._agents) {
      const bot = blankBot(agent.name || agent.key || "Bot", agent.role || "Teammate");
      if (agent.instructions) bot.instructions = String(agent.instructions);
      if (agent.color && /^#[0-9a-fA-F]{3,8}$/.test(agent.color)) bot.color = agent.color;
      bots.push(bot);
    }
  } else {
    // Fall back to ## Name sections (Sandbench-style or Team section).
    const chunks = body.split(/^## /m).slice(1);
    for (const chunk of chunks) {
      const [head, ...rest] = chunk.split("\n");
      const title = head.trim();
      if (!title || /^(Activation|Mission|Outcomes|Connections|Team|Chief of Staff|Completion rule)$/i.test(title)) {
        continue;
      }
      const sectionBody = rest.join("\n");
      const bot = blankBot(title, "Teammate");
      const role = /^-?\s*role:\s*(.+)$/im.exec(sectionBody)?.[1]?.trim();
      if (role) bot.role = role;
      const instructions = /### Instructions\n([\s\S]*?)(?=\n### |$)/i.exec(sectionBody)?.[1]?.trim();
      if (instructions) bot.instructions = instructions;
      const persona = /### Persona\n([\s\S]*?)(?=\n### |$)/i.exec(sectionBody)?.[1]?.trim();
      if (persona) bot.persona = persona;
      bots.push(bot);
    }
  }
  if (!bots.length) throw new Error("No agents found in that Markdown.");
  bots[0].primary = true;
  const roomName = typeof meta.name === "string" ? meta.name : "Imported team";
  const shared = typeof meta.tagline === "string" ? meta.tagline : typeof meta.summary === "string" ? meta.summary : "";
  return {
    format: "sandbench-team",
    version: 1,
    exportedAt: Date.now(),
    bots,
    channels: bots.length > 1
      ? [
          {
            title: roomName,
            memberNames: bots.map((b) => b.name),
            sharedInstructions: shared,
            autoRoute: true,
          },
        ]
      : [],
    plugins: [],
    connectors: [],
    routines: [],
  };
}

const input = process.argv[2];
const output = process.argv[3] || "sandbench-team-from-openmaus.json";
if (!input) {
  console.error("Usage: node scripts/import-openmaus-team.mjs <team.md> [out.json]");
  process.exit(1);
}
const pack = openMausMarkdownToTeam(readFileSync(path.resolve(input), "utf8"));
writeFileSync(path.resolve(output), JSON.stringify(pack, null, 2));
console.log(`Wrote ${output} with ${pack.bots.length} bot(s).`);
