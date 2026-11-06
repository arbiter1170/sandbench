import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { POSIX_SHELL, windowsPowerShell } from "../shellPath.mjs";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");

test("Windows PowerShell is started by its absolute path under the system root", () => {
  assert.equal(windowsPowerShell({ SystemRoot: "C:\\Windows" }), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(windowsPowerShell({ SystemRoot: "D:\\WINNT" }), "D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(windowsPowerShell({ windir: "E:\\Windows" }), "E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});

test("a missing, relative or network system root falls back to C:\\Windows", () => {
  const fallback = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  for (const env of [{}, { SystemRoot: "" }, { SystemRoot: "Windows" }, { SystemRoot: ".\\turn" }, { SystemRoot: "\\\\share\\Windows" }, { SystemRoot: "\\Windows" }]) {
    assert.equal(windowsPowerShell(env), fallback, JSON.stringify(env));
  }
});

test("the shell paths are absolute, so a file planted in the turn folder cannot stand in", () => {
  assert.ok(path.win32.isAbsolute(windowsPowerShell()));
  assert.match(windowsPowerShell(), /^[A-Za-z]:\\/);
  assert.ok(path.posix.isAbsolute(POSIX_SHELL));
});

test("the harness server never spawns a program by bare name", () => {
  const source = readFileSync(SERVER, "utf8");
  assert.doesNotMatch(source, /["']powershell(\.exe)?["']/i);
  for (const match of source.matchAll(/\bspawn\(\s*([^,\s]+)/g)) {
    assert.ok(/^(POWERSHELL|POSIX_SHELL)$/.test(match[1]), `spawn(${match[1]}) should use an absolute shell path`);
  }
});

test("the harness shell closes standard input, so `cat` with no file ends at once", () => {
  const source = readFileSync(SERVER, "utf8");
  const runShell = source.slice(source.indexOf("function runShell("), source.indexOf("function runShell(") + 900);
  assert.match(runShell, /child\.stdin\.end\(\);/);
});
