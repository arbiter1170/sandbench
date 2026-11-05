// The agent's system prompt (SB-08), in this order:
//   profile description, team AGENTS.md, skills index, profile memory, 10 most recent journal items.
// At most 40,000 characters (the limit harness/turns.mjs applies to `system`). Each section has its
// own budget and is cut at a word with a marker, never mid-word. The same inputs give the same
// string. The turn engine (SB-03) calls this; until then GET /api/prompt/:agentId shows it. The
// inbox summary waits for messaging (SB-07).
import { readFileSync } from "node:fs";
import path from "node:path";

export const MAX_PROMPT = 40_000;
const BUDGET = { description: 8_000, agentsMd: 12_000, skills: 4_000, profile: 10_000, journal: 5_000 };
const JOURNAL_ITEMS = 10;
export const CUT = "\n[… cut to fit]";

/** Cuts `text` to at most `max` characters at a word boundary, ending with the CUT marker. */
export function fit(text, max) {
  if (text.length <= max) return text;
  const room = max - CUT.length;
  const head = text.slice(0, room + 1);
  const space = head.search(/\s\S*$/);
  return `${(space > 0 ? head.slice(0, space) : text.slice(0, room)).trimEnd()}${CUT}`;
}

function readAgentsMd(teamDir) {
  if (!teamDir) return "";
  try {
    return readFileSync(path.join(teamDir, "AGENTS.md"), "utf8").trim();
  } catch {
    return "";
  }
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** `agent` is the record from the store ({ id, data }); `owner` scopes the memory. */
export async function buildSystemPrompt({ owner, agent, memory, skills, teamDir }) {
  const data = agent?.data ?? {};
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : agent?.id ?? "Agent";
  const title = typeof data.title === "string" && data.title.trim() ? `, ${data.title.trim()}` : "";
  const description = [data.description, data.instructions].find((value) => typeof value === "string" && value.trim())?.trim() ?? "";

  const sections = [fit(`# You are ${name}${title}${description ? `\n\n${description}` : ""}`, BUDGET.description)];

  const agentsMd = readAgentsMd(teamDir);
  if (agentsMd) sections.push(fit(`## Team rules (AGENTS.md)\n\n${agentsMd}`, BUDGET.agentsMd));

  const index = skills ? skills.index() : [];
  if (index.length) {
    const lines = index.map((skill) => `- ${skill.name}: ${skill.description}`);
    sections.push(fit(`## Skills\n\nLoad a skill by name when it fits the task.\n\n${lines.join("\n")}`, BUDGET.skills));
  }

  if (memory && agent?.id) {
    const facts = await memory.profile({ owner, agentId: agent.id });
    if (facts.length) sections.push(fit(`## What you remember\n\n${facts.map((item) => `- ${item.text.replace(/\n/g, "\n  ")}`).join("\n")}`, BUDGET.profile));
    const journal = await memory.recent({ owner, agentId: agent.id, kind: "journal", limit: JOURNAL_ITEMS });
    if (journal.length) {
      const lines = journal.map((item) => `- ${day(item.createdAt)}: ${item.text.replace(/\s+/g, " ")}`);
      sections.push(fit(`## Recent journal (newest first)\n\n${lines.join("\n")}\n\nSearch your memory for older entries.`, BUDGET.journal));
    }
  }

  return fit(sections.join("\n\n"), MAX_PROMPT);
}
