// Each bot's memory folder under ~/.sandbench/bots/<id>. `read` and `write` back the page's
// Memory panel (the person edits MEMORY.md and memory/*.md). `save` is the only way a bot's own
// approved note gets in: it appends one line to that bot's daily log and never rewrites,
// moves or deletes anything already there.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const BOT_ID = /^[-\w]{1,80}$/;
const SAVE_ID = /^[a-f0-9-]{8,64}$/i;
const MAX_NOTE = 1000;
const KEY_SHAPE = /\b(xai-[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})\b/;
// The page injects at most 6,000 characters of each memory file into a turn; a day's log
// stays under that so the newest note is never the part cut off.
export const MAX_DAY_LOG = 6000;

export function memoryAllowlisted(rel) {
  if (rel === "MEMORY.md") return true;
  if (/^memory\/[a-zA-Z0-9][\w.-]{0,60}\.md$/.test(rel)) return true;
  if (/^memory\/log\/\d{4}-\d{2}-\d{2}\.md$/.test(rel)) return true;
  return false;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

function localDay(now) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Why a note can't be saved, or "" when it can. */
export function noteProblem(note) {
  if (typeof note !== "string") return "The note must be text.";
  const text = note.trim();
  if (!text) return "The note is empty.";
  if (text.length > MAX_NOTE) return `Notes are at most ${MAX_NOTE} characters.`;
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return "The note has control characters.";
  // The card must show everything that is saved: no invisible format, private-use, unassigned or
  // lone surrogate characters (tag characters and bidi overrides can hide text), and NFC only.
  if (/[\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u.test(text)) return "The note has invisible characters.";
  if (text !== text.normalize("NFC")) return "The note is not in normalized Unicode (NFC).";
  if (/<!--|-->/.test(text)) return "The note can't contain comment markers.";
  // Saved notes go into later prompts sent to model providers.
  if (KEY_SHAPE.test(text)) return "The note looks like it contains an API key or token.";
  return "";
}

export function createBotMemory({ botsDir, now = () => new Date() }) {
  const botDir = (botId) => path.join(botsDir, botId);

  function read(botId) {
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

  function write(botId, body) {
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

  // Every folder from the bots folder down to the file must be a real folder (or not exist
  // yet), and the file a real file: a symlink anywhere could point the write outside.
  function checkChain(parts) {
    let current = botsDir;
    for (const part of parts) {
      current = path.join(current, part);
      let stat;
      try {
        stat = lstatSync(current);
      } catch {
        return "";
      }
      if (stat.isSymbolicLink()) return "The memory folder contains a link, so nothing was saved.";
    }
    return "";
  }

  /**
   * Append one approved note to `memory/log/<today>.md` for this bot. `saveId` (the approval
   * card's id) makes a retry a no-op instead of a second line.
   */
  function save(botId, body) {
    if (typeof botId !== "string" || !BOT_ID.test(botId)) throw new Error("Bad bot id.");
    if (body?.approved !== true) throw new Error("Memory saves need an approval.");
    const saveId = typeof body.saveId === "string" ? body.saveId : "";
    if (!SAVE_ID.test(saveId)) throw new Error("The save id is not valid.");
    const problem = noteProblem(body.note);
    if (problem) throw new Error(problem);
    const rel = `memory/log/${localDay(now())}.md`;
    const parts = [botId, ...rel.split("/")];
    const linked = checkChain(parts);
    if (linked) throw new Error(linked);
    const target = path.join(botsDir, ...parts);
    const before = existsSync(target) ? readFileSync(target, "utf8") : "";
    const marker = `<!-- save:${saveId} -->`;
    if (before.includes(marker)) return { ok: true, path: rel, duplicate: true, bytes: 0 };
    const line = `- ${body.note.trim().replace(/\s+/g, " ")} ${marker}\n`;
    const text = `${before && !before.endsWith("\n") ? "\n" : ""}${line}`;
    if (before.length + text.length > MAX_DAY_LOG) throw new Error("Today's memory log is full; nothing was saved.");
    mkdirSync(path.dirname(target), { recursive: true });
    const again = checkChain(parts);
    if (again) throw new Error(again);
    appendFileSync(target, text, { encoding: "utf8", flag: "a" });
    return { ok: true, path: rel, duplicate: false, bytes: Buffer.byteLength(text, "utf8") };
  }

  return { read, write, save };
}
