export type Token = { text: string; kind: "plain" | "key" | "str" | "com" | "num" };

const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "import",
  "from",
  "export",
  "async",
  "await",
  "class",
  "new",
  "type",
  "interface",
  "string",
  "number",
  "boolean",
  "true",
  "false",
  "null",
  "undefined",
]);

const TOKEN =
  /(`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|\/\/.*$|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|\s+|./gm;

export function highlight(code: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(TOKEN.source, "gm");
  for (const match of code.matchAll(re)) {
    const text = match[0];
    if (!text) continue;
    let kind: Token["kind"] = "plain";
    if (match[1]) kind = "str";
    else if (text.startsWith("//") || text.startsWith("/*")) kind = "com";
    else if (/^\d/.test(text)) kind = "num";
    else if (KEYWORDS.has(text)) kind = "key";
    tokens.push({ text, kind });
  }
  return tokens.length > 0 ? tokens : [{ text: code, kind: "plain" }];
}
