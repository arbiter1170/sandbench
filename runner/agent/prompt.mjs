// The agent's system prompt (SB-08), built fresh for every turn from:
//   the agent profile (its record in `agents`), the team AGENTS.md, the skills index,
//   every profile memory item, and the most recent journal entries.
// The inbox summary the plan mentions waits for messaging (SB-07). The turn engine (SB-03)
// calls promptFor; until then GET /api/agents/:id/prompt shows what a turn would get.
import { readFileSync } from "node:fs";
import path from "node:path";

export const CAPABILITIES = ["notify_owner", "launch_build", "merge", "email"];
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LIMITS = { agentsMd: 24_000, profile: 16_000, journal: 8, journalItem: 2_000, skills: 60 };

/** The SB-08 profile fields from an agent record's data, with anything malformed dropped. */
export function agentProfile(data = {}) {
  const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
  const number = (value, min, max) => (Number.isFinite(value) && value >= min && value <= max ? value : undefined);
  return {
    name: text(data.name, 120) ?? "Agent",
    slug: typeof data.slug === "string" && SLUG.test(data.slug) ? data.slug : undefined,
    title: text(data.title, 120),
    description: text(data.description, 8_000) ?? text(data.instructions, 8_000),
    capabilities: Array.isArray(data.capabilities) ? CAPABILITIES.filter((item) => data.capabilities.includes(item)) : [],
    model: text(data.model, 120),
    driver: text(data.driver, 40),
    max_steps: number(data.max_steps, 1, 1_000),
    budget_usd_day: number(data.budget_usd_day, 0, 10_000),
    workspace: text(data.workspace, 200),
  };
}

export function buildSystemPrompt({ profile, agentsMd = "", skills = [], memory = [], journal = [] }) {
  const parts = [`# You are ${profile.name}${profile.title ? `, ${profile.title}` : ""}`];
  if (profile.description) parts.push(profile.description);
  if (profile.capabilities.length) parts.push(`You may: ${profile.capabilities.join(", ")}. Anything else that needs one of these is not yours to do.`);
  if (agentsMd.trim()) parts.push(`## Team rules (AGENTS.md)\n\n${agentsMd.trim().slice(0, LIMITS.agentsMd)}`);
  if (skills.length) {
    const lines = skills.slice(0, LIMITS.skills).map((skill) => `- ${skill.name}: ${skill.description || skill.title}`);
    parts.push(`## Skills\n\nLoad a skill by name when it fits the task.\n\n${lines.join("\n")}`);
  }
  let room = LIMITS.profile;
  const facts = [];
  for (const item of memory) {
    const line = `- ${item.text.replace(/\n/g, "\n  ")}`;
    if (line.length > room) break;
    facts.push(line);
    room -= line.length;
  }
  if (facts.length) parts.push(`## What you remember\n\n${facts.join("\n")}`);
  if (journal.length) {
    const lines = journal.slice(0, LIMITS.journal).map((item) => `- ${new Date(item.createdAt).toISOString().slice(0, 10)}: ${item.text.slice(0, LIMITS.journalItem).replace(/\n/g, " ")}`);
    parts.push(`## Recent journal\n\n${lines.join("\n")}\n\nSearch your memory for older entries.`);
  }
  return parts.join("\n\n");
}

/** Loads everything a prompt needs for one agent; throws the store's 404 for an unknown agent. */
export function createPrompts({ store, memory, skills, teamDir }) {
  async function promptFor(owner, agentId) {
    const record = await store.get(owner, "agents", agentId);
    if (record.deleted) throw Object.assign(new Error("No such agent."), { status: 404 });
    const profile = agentProfile(record.data);
    let agentsMd = "";
    if (teamDir) {
      try {
        agentsMd = readFileSync(path.join(teamDir, "AGENTS.md"), "utf8");
      } catch {
        // no team rules file
      }
    }
    // Profile facts oldest first, so the newest are the ones dropped when space runs out
    // and the list reads in the order it was learned.
    const facts = (await memory.memoryList({ owner, agentId, kind: "profile", limit: 500 })).reverse();
    const journal = await memory.memoryList({ owner, agentId, kind: "journal", limit: LIMITS.journal });
    return { profile, prompt: buildSystemPrompt({ profile, agentsMd, skills: skills.listSkills(), memory: facts, journal }) };
  }
  return { promptFor };
}
