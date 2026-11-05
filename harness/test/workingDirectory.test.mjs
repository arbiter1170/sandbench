import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { describeWorkingDirectory } from "../workingDirectory.mjs";

// Fake Windows paths, with a space in the user name; nothing here is a real machine.
const WIN_ROOT = "C:\\Users\\Some Body\\.sandbench\\workspace";
const POSIX_ROOT = "/home/some-body/.sandbench/workspace";

test("the default working folder is named as the workspace root itself", () => {
  const text = describeWorkingDirectory({ cwd: WIN_ROOT, root: WIN_ROOT, pathApi: path.win32 });
  assert.match(text, /^Working directory \(resolved by Sandbench/);
  assert.ok(text.includes(`- Path: ${WIN_ROOT}\n`), text);
  assert.ok(text.includes(`- Workspace root: ${WIN_ROOT}\n`), text);
  assert.match(text, /- Configured folder: none; the working directory is the workspace root itself/);
  assert.match(text, /exactly as written/);
});

test("a configured team folder is named relative to the root, and the path keeps its spaces and backslashes", () => {
  const cwd = `${WIN_ROOT}\\walklings-team`;
  const text = describeWorkingDirectory({ cwd, root: WIN_ROOT, pathApi: path.win32 });
  assert.ok(text.includes(`- Path: ${cwd}\n`), text);
  assert.match(text, /- Configured folder: walklings-team \(inside the workspace root\)/);
  // Verbatim: the page or the model get the same string the process was started with.
  assert.equal(text.split("\n")[1], `- Path: C:\\Users\\Some Body\\.sandbench\\workspace\\walklings-team`);
});

test("a nested folder keeps the host separator; posix roots work the same way", () => {
  const win = describeWorkingDirectory({ cwd: `${WIN_ROOT}\\notes\\today`, root: WIN_ROOT, pathApi: path.win32 });
  assert.match(win, /- Configured folder: notes\\today \(inside the workspace root\)/);
  const posix = describeWorkingDirectory({ cwd: `${POSIX_ROOT}/launch`, root: POSIX_ROOT, pathApi: path.posix });
  assert.ok(posix.includes(`- Path: ${POSIX_ROOT}/launch\n`), posix);
  assert.match(posix, /- Configured folder: launch \(inside the workspace root\)/);
  const self = describeWorkingDirectory({ cwd: POSIX_ROOT, root: POSIX_ROOT, pathApi: path.posix });
  assert.match(self, /- Configured folder: none/);
});

test("a cwd outside the root is still stated as the path, with no folder line claimed", () => {
  // resolveFolder refuses these; if one ever got through, the block must not describe it as inside.
  const text = describeWorkingDirectory({ cwd: "C:\\Elsewhere\\dir", root: WIN_ROOT, pathApi: path.win32 });
  assert.ok(text.includes("- Path: C:\\Elsewhere\\dir\n"), text);
  assert.match(text, /- Configured folder: none/);
});

test("the block refuses a missing cwd or root", () => {
  assert.throws(() => describeWorkingDirectory({ cwd: "", root: WIN_ROOT }), /cwd/);
  assert.throws(() => describeWorkingDirectory({ cwd: WIN_ROOT, root: undefined }), /root/);
});
