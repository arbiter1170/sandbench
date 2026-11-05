// Title and summary for a skill folder's SKILL.md, for the harness skill library list.
//
// Team skills (the walklings-team pack, Claude Code skills) start with YAML front matter
// (`name`, `description`). The first non-heading line of such a file is the `---` fence, so a
// plain "first line" summary shows "---". This reads `description` from the front matter instead.
// A file with no front matter keeps the old behaviour: the first line that is not a heading.

const SUMMARY_MAX = 200;

function splitFrontMatter(raw) {
  const text = raw.replace(/\r\n?/g, "\n");
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { front: "", body: text };
  return { front: match[1], body: text.slice(match[0].length) };
}

// One top-level key of a front-matter block: inline value, quoted value, or a `>` / `|` block.
function frontMatterValue(front, key) {
  const lines = front.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (start < 0) return "";
  const first = lines[start].slice(key.length + 1).trim();
  const block = /^[>|][+-]?$/.test(first);
  const continuation = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      if (block) continuation.push("");
      continue;
    }
    if (!/^[ \t]/.test(line)) break;
    continuation.push(line.trim());
  }
  let value = block ? continuation.join(" ") : [first, ...continuation].join(" ");
  value = value.trim();
  if (!block && /^'.*'$/s.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
  else if (!block && /^".*"$/s.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
  return value.replace(/\s+/g, " ").trim();
}

export function parseSkill(raw, name) {
  const { front, body } = splitFrontMatter(String(raw));
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || frontMatterValue(front, "name") || name;

  let summary = frontMatterValue(front, "description");
  if (!summary) {
    const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
    summary = lines.find((line) => !line.startsWith("#") && !line.startsWith(">")) || "";
    if (!summary) {
      const quote = lines.find((line) => line.startsWith(">"));
      summary = quote ? quote.replace(/^>\s*/, "").replace(/\*\*/g, "") : "";
    }
  }
  return { title, summary: summary.slice(0, SUMMARY_MAX) };
}
