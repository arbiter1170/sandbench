import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createShell } from "../shell.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "sb-shell-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("a command that reads standard input sees its end at once instead of waiting for the timeout", { skip: process.platform === "win32" }, async () => {
  writeFileSync(path.join(dir, "notes.txt"), "fake notes\n");
  const run = createShell(dir);
  for (const command of ["cat", "cat -n", "head -n 1", "wc -l"]) {
    const result = await run(command, { timeoutMs: 5_000 });
    assert.equal(result.code, 0, command);
    assert.ok(result.ms < 4_000, `${command} took ${result.ms} ms`);
  }
  assert.equal((await run("cat notes.txt")).stdout, "fake notes\n");
});
