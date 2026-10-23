export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "p"; inlines: Inline[] }
  | { type: "h"; level: number; inlines: Inline[] }
  | { type: "code"; lang: string; text: string }
  | { type: "ul"; items: Inline[][] }
  | { type: "quote"; inlines: Inline[] };

const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInlines(input: string): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  for (const match of input.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", text: input.slice(last, index) });
    if (match[1] != null) out.push({ type: "code", text: match[1] });
    else if (match[2] != null) out.push({ type: "strong", text: match[2] });
    else if (match[3] != null) out.push({ type: "em", text: match[3] });
    else if (match[4] != null && match[5] != null) {
      out.push({ type: "link", text: match[4], href: match[5] });
    }
    last = index + match[0].length;
  }
  if (last < input.length) out.push({ type: "text", text: input.slice(last) });
  if (out.length === 0) out.push({ type: "text", text: "" });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "h",
        level: heading[1]?.length ?? 1,
        inlines: parseInlines(heading[2] ?? ""),
      });
      i += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        buf.push((lines[i] ?? "").slice(2));
        i += 1;
      }
      blocks.push({ type: "quote", inlines: parseInlines(buf.join(" ")) });
      continue;
    }
    if (line.startsWith("- ")) {
      const items: Inline[][] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("- ")) {
        items.push(parseInlines((lines[i] ?? "").slice(2)));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const buf = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        next.trim() === "" ||
        next.startsWith("```") ||
        next.startsWith("#") ||
        next.startsWith("> ") ||
        next.startsWith("- ")
      ) {
        break;
      }
      buf.push(next);
      i += 1;
    }
    blocks.push({ type: "p", inlines: parseInlines(buf.join(" ")) });
  }
  return blocks;
}
