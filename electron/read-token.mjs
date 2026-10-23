import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

/** Prefer project `.harness-token` (written by harness); else persist one under userData. */
export function readOrCreateToken({ projectRoot, userData }) {
  const projectToken = path.join(projectRoot, ".harness-token");
  if (existsSync(projectToken)) {
    const token = readFileSync(projectToken, "utf8").trim();
    if (token) return { token, source: projectToken };
  }
  mkdirSync(userData, { recursive: true });
  const stored = path.join(userData, "harness-token");
  if (existsSync(stored)) {
    const token = readFileSync(stored, "utf8").trim();
    if (token) return { token, source: stored };
  }
  const token = randomBytes(24).toString("hex");
  writeFileSync(stored, token, { mode: 0o600 });
  return { token, source: stored };
}

export async function waitForHealth({ baseUrl, token, timeoutMs = 45_000 }) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { "x-sandbench-token": token },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return true;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Harness did not become healthy: ${last}`);
}
