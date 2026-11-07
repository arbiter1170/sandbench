// A second harness that can't get its ports must leave the running harness's token alone: when it
// overwrote the file first, the page's calls got 401 from the harness that was still running.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "server.mjs");
const TOKEN_FILE = path.join(here, "..", "..", ".harness-token");
const home = mkdtempSync(path.join(os.tmpdir(), "sb-token-"));
after(() => rmSync(home, { recursive: true, force: true }));

const token = () => (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8") : null);

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

for (const held of ["SANDBENCH_HARNESS_PORT", "SANDBENCH_WEBHOOK_PORT"]) {
  test(`a harness that finds ${held} in use exits with a clear message and doesn't write the token`, { timeout: 30_000 }, async () => {
    const before = token();
    const holder = createServer();
    await new Promise((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const ports = { SANDBENCH_HARNESS_PORT: String(await freePort()), SANDBENCH_WEBHOOK_PORT: String(await freePort()), [held]: String(holder.address().port) };
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, HOME: home, USERPROFILE: home, ...ports }, stdio: ["ignore", "ignore", "pipe"] });
    try {
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const code = await new Promise((resolve) => child.on("close", resolve));
      assert.equal(code, 1);
      assert.match(stderr, /in use/);
      assert.equal(token(), before);
    } finally {
      child.kill();
      await new Promise((resolve) => holder.close(resolve));
      // If this ever fails again, put a developer's real token back.
      if (token() !== before) {
        if (before !== null) writeFileSync(TOKEN_FILE, before, { mode: 0o600 });
        else rmSync(TOKEN_FILE, { force: true });
      }
    }
  });
}
