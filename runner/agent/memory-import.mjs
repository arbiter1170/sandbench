// One-time import of the harness's file memory (~/.sandbench/bots/<id>/, served by
// harness/server.mjs /bots/:id/memory) into memory_items (SB-08). The harness route stays;
// its files are now only a source for this import.
//   MEMORY.md and memory/*.md   -> profile
//   memory/log/YYYY-MM-DD.md    -> journal, dated that day
// Each piece is saved with a source made of its path and a hash of its text, so running the
// import again adds nothing, and an edited file only adds its new pieces.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MAX_TEXT } from "./memory.mjs";

// The same paths the harness accepts (harness/server.mjs memoryAllowlisted).
export function memoryPathAllowed(rel) {
  if (rel === "MEMORY.md") return true;
  if (/^memory\/[a-zA-Z0-9][\w.-]{0,60}\.md$/.test(rel)) return true;
  return /^memory\/log\/\d{4}-\d{2}-\d{2}\.md$/.test(rel);
}

/** Reads one bot's memory folder the way the harness does. */
export function readHarnessMemory(botDir) {
  const files = [];
  const read = (rel) => {
    const file = path.join(botDir, ...rel.split("/"));
    if (memoryPathAllowed(rel) && existsSync(file)) files.push({ path: rel, content: readFileSync(file, "utf8") });
  };
  const names = (dir) => {
    try {
      return readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
    } catch {
      return [];
    }
  };
  read("MEMORY.md");
  for (const name of names(path.join(botDir, "memory"))) read(`memory/${name}`);
  for (const name of names(path.join(botDir, "memory", "log"))) read(`memory/log/${name}`);
  return files;
}

// One item per paragraph (so search finds the fact, and an edit adds only what changed),
// skipping bare headings; a paragraph longer than MAX_TEXT is cut.
function pieces(text) {
  const out = [];
  for (const paragraph of text.split(/\r?\n\s*\r?\n/)) {
    let part = paragraph.trim();
    if (!part || /^#{1,6}\s[^\n]*$/.test(part)) continue;
    while (part.length > MAX_TEXT) {
      out.push(part.slice(0, MAX_TEXT));
      part = part.slice(MAX_TEXT);
    }
    out.push(part);
  }
  return out;
}

/** Imports `files` ({ path, content }[]) for one agent. Returns counts. */
export async function importMemoryFiles(memory, { owner, agentId, files }) {
  let imported = 0;
  let skipped = 0;
  let refused = 0;
  for (const file of Array.isArray(files) ? files : []) {
    const rel = typeof file?.path === "string" ? file.path.replace(/\\/g, "/") : "";
    if (!memoryPathAllowed(rel) || typeof file.content !== "string") {
      refused++;
      continue;
    }
    const day = /^memory\/log\/(\d{4}-\d{2}-\d{2})\.md$/.exec(rel)?.[1];
    for (const text of pieces(file.content)) {
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
      const result = await memory.memorySave({
        owner,
        agentId,
        kind: day ? "journal" : "profile",
        text,
        source: `harness:${rel}:${hash}`,
        ...(day ? { createdAt: `${day}T12:00:00Z` } : {}),
      });
      if (result.saved) imported++;
      else skipped++;
    }
  }
  return { imported, skipped, refused };
}
