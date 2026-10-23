// Shared PATH discovery for local agent CLIs (Claude, Codex, Grok).
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function candidatesIn(dir, names) {
  if (!dir) return [];
  return names.map((name) => path.join(dir, name)).filter((full) => existsSync(full));
}

export function findOnPath(names, { envKey, extraDirs = [] } = {}) {
  const override = envKey ? process.env[envKey] : null;
  if (override) return existsSync(override) ? override : null;
  const wanted = process.platform === "win32" ? names.flatMap((n) => [`${n}.exe`, `${n}.cmd`, n]) : names;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const hit = candidatesIn(dir, wanted)[0];
    if (hit) return hit;
  }
  if (process.platform === "win32") {
    const extras = [
      path.join(process.env.APPDATA || "", "npm"),
      path.join(process.env.LOCALAPPDATA || "", "npm"),
      path.join(os.homedir(), ".local", "bin"),
      ...extraDirs,
    ];
    for (const dir of extras) {
      const hit = candidatesIn(dir, wanted)[0];
      if (hit) return hit;
    }
  }
  for (const dir of extraDirs) {
    const hit = candidatesIn(dir, wanted)[0];
    if (hit) return hit;
  }
  return null;
}
