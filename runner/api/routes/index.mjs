// Route registry (SB-03 PR 1). New /api routes are new files in this folder; nobody edits
// server.mjs again. Each module default-exports
//   { name, prefix, create(deps) -> async (req, res, route, url, user) => boolean }
// where `prefix` is a string the route starts with (e.g. "/jobs") or a RegExp, `route` is the path
// after /api, and the handler returns false to fall through. Handlers sit behind the sign-in
// check like every other /api route; `user.uid` is the owner.
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Built-in /api paths (server.mjs, data.mjs, memory.mjs). A module can't take them over.
export const RESERVED = ["/health", "/secrets", "/model", "/drivers", "/turns", "/permissions", "/events", "/workspace", "/exec", "/data", "/changes", "/stream", "/memory", "/skills", "/prompt"];

const NAME = /^[a-z][a-z0-9-]{0,40}$/;

/** True when `prefix` (string or RegExp) matches `route`. */
export function prefixMatches(prefix, route) {
  if (prefix instanceof RegExp) return prefix.test(route);
  return route === prefix || route.startsWith(`${prefix}/`);
}

// Two string prefixes overlap when one contains the other; a RegExp overlaps a string it matches,
// or another RegExp with the same source. (A general RegExp overlap test isn't possible, so keep
// RegExp prefixes anchored and specific.)
function overlaps(a, b) {
  if (typeof a === "string" && typeof b === "string") return prefixMatches(a, b) || prefixMatches(b, a);
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source;
  const [re, str] = a instanceof RegExp ? [a, b] : [b, a];
  return re.test(str);
}

function checkModule(file, mod) {
  const where = path.basename(file);
  if (!mod || typeof mod !== "object") throw new Error(`${where}: default export must be { name, prefix, create }`);
  if (typeof mod.name !== "string" || !NAME.test(mod.name)) throw new Error(`${where}: name must be lowercase letters, digits and -`);
  const okPrefix = (typeof mod.prefix === "string" && /^\/[a-z0-9][a-z0-9/_-]*$/.test(mod.prefix)) || mod.prefix instanceof RegExp;
  if (!okPrefix) throw new Error(`${where}: prefix must be a path like "/jobs" or a RegExp`);
  if (typeof mod.create !== "function") throw new Error(`${where}: create(deps) is missing`);
  for (const reserved of RESERVED) {
    if (overlaps(mod.prefix, reserved)) throw new Error(`${where}: prefix ${mod.prefix} overlaps the built-in ${reserved}`);
  }
}

/** Loads every route module in `dir` (except index.mjs), sorted by file name. */
export async function loadRouteFactories(dir = new URL(".", import.meta.url)) {
  const folder = dir instanceof URL ? fileURLToPath(dir) : String(dir);
  const files = readdirSync(folder).filter((name) => name.endsWith(".mjs") && name !== "index.mjs").sort();
  const loaded = [];
  for (const name of files) {
    const file = path.join(folder, name);
    const mod = (await import(pathToFileURL(file).href)).default;
    checkModule(file, mod);
    for (const other of loaded) {
      if (other.name === mod.name) throw new Error(`${name}: route name ${mod.name} is already used by ${other.file}`);
      if (overlaps(other.prefix, mod.prefix)) throw new Error(`${name}: prefix ${mod.prefix} overlaps ${other.prefix} in ${other.file}`);
    }
    loaded.push({ name: mod.name, prefix: mod.prefix, create: mod.create, file: name });
  }
  return loaded;
}
