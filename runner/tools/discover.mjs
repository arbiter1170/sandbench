// Tool discovery (SB-03 PR 1; SB-10's registry calls this). Tools live next to their code in
// runner/<area>/tools.mjs, which exports `tools = [descriptor, ...]`. No central list to edit.
// Each descriptor is checked with validateTool; a duplicate name or an invalid descriptor throws
// and names the file(s).
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateTool } from "../contracts/tool.mjs";

const RUNNER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function discoverTools({ root = RUNNER_DIR } = {}) {
  const found = new Map();
  for (const area of readdirSync(root).sort()) {
    const file = path.join(root, area, "tools.mjs");
    if (area === "node_modules" || !statSync(path.join(root, area)).isDirectory() || !existsSync(file)) continue;
    const where = path.relative(root, file).split(path.sep).join("/");
    const mod = await import(pathToFileURL(file).href);
    if (!Array.isArray(mod.tools)) throw new Error(`${where}: export const tools = [...] is missing`);
    for (const tool of mod.tools) {
      const result = validateTool(tool);
      if (!result.ok) throw new Error(`${where}: tool ${tool?.name ?? "(no name)"} is invalid: ${result.errors.join("; ")}`);
      if (found.has(tool.name)) throw new Error(`Tool ${tool.name} is defined twice: ${found.get(tool.name).file} and ${where}`);
      found.set(tool.name, { tool, file: where });
    }
  }
  return [...found.values()].map((entry) => entry.tool).sort((a, b) => a.name.localeCompare(b.name));
}
