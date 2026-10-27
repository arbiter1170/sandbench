import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { resolveWorkFolder, resolveWorkspacePath } from "../workspace/paths.mjs";

let tmp;
let home;
const at = (...parts) => path.join(home, ...parts);

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-ws-"));
  home = path.join(tmp, "home");
  for (const folder of ["shared/handoff", "shared/repos/game", "agents/qa", "agents/design", "agents/pixelpets", "wt/pixelpets/game/feat", "workspace", "outside"].map((p) => path.join(home, p))) {
    mkdirSync(folder, { recursive: true });
  }
  writeFileSync(at("shared", "handoff", "changelog.md"), "build 1");
  writeFileSync(at("agents", "pixelpets", "plan.md"), "secret plan");
  symlinkSync(at("agents", "pixelpets"), at("agents", "qa", "peek"), "junction");
  symlinkSync(at("wt", "pixelpets", "game"), at("agents", "design", "pp-wt"), "junction");
  symlinkSync(path.join(tmp, "nowhere", "new.txt"), at("agents", "qa", "dangle"), "junction");
  symlinkSync(at("agents", "qa", "notes"), at("agents", "qa", "own-link"), "junction");
  mkdirSync(at("agents", "qa", "notes"));
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("an agent reads and writes its own folder; plain paths land there", () => {
  assert.equal(resolveWorkspacePath(home, "qa", "notes/today.md", { write: true }), at("agents", "qa", "notes", "today.md"));
  assert.equal(resolveWorkspacePath(home, "qa", "agents/qa/notes/today.md", { write: true }), at("agents", "qa", "notes", "today.md"));
  assert.equal(resolveWorkspacePath(home, "qa", "own-link/today.md", { write: true }), at("agents", "qa", "own-link", "today.md"));
});

test("QA can read the shared handoff folder and write only in shared/handoff", () => {
  assert.equal(resolveWorkspacePath(home, "qa", "shared/handoff/changelog.md"), at("shared", "handoff", "changelog.md"));
  assert.ok(resolveWorkspacePath(home, "qa", "shared/handoff/qa-report.md", { write: true }));
  assert.ok(resolveWorkspacePath(home, "qa", "shared/repos/game/README.md"));
  assert.equal(resolveWorkspacePath(home, "qa", "shared/repos/game/README.md", { write: true }), null);
  assert.equal(resolveWorkspacePath(home, "qa", "shared/top.md", { write: true }), null);
});

test("one agent cannot read or write another agent's folder or worktree", () => {
  for (const write of [false, true]) {
    assert.equal(resolveWorkspacePath(home, "qa", "agents/pixelpets/plan.md", { write }), null);
    assert.equal(resolveWorkspacePath(home, "design", "wt/pixelpets/game/feat/src/main.js", { write }), null);
  }
  assert.ok(resolveWorkspacePath(home, "pixelpets", "wt/pixelpets/game/feat/src/main.js", { write: true }));
});

test("'..' is refused, in any spelling", () => {
  // Refused even when it would stay inside the agent's own folder.
  for (const requested of ["notes/../notes.md", "agents/qa/../qa/x.md", "../pixelpets/plan.md","agents/qa/../pixelpets/plan.md", "notes/../../pixelpets/plan.md", "..\\pixelpets\\plan.md", "..", "wt/../agents/pixelpets/plan.md"]) {
    assert.equal(resolveWorkspacePath(home, "qa", requested), null, requested);
    assert.equal(resolveWorkspacePath(home, "qa", requested, { write: true }), null, requested);
  }
});

test("symlinks cannot lead into another agent's folder or out of the home", () => {
  assert.equal(resolveWorkspacePath(home, "qa", "peek/plan.md"), null);
  assert.equal(resolveWorkspacePath(home, "qa", "peek/new.md", { write: true }), null);
  assert.equal(resolveWorkspacePath(home, "design", "pp-wt/feat/x.js", { write: true }), null);
  // A link to a file that doesn't exist yet would create it outside the home on write.
  assert.equal(resolveWorkspacePath(home, "qa", "dangle", { write: true }), null);
});

test("absolute paths, drive letters, null bytes and odd input are refused", () => {
  for (const requested of ["/etc/passwd", "C:\\Windows\\x", "c:x", "\\\\server\\share", "notes\0.md", "", "   ", "a".repeat(401), 42, null, undefined]) {
    assert.equal(resolveWorkspacePath(home, "qa", requested), null, String(requested));
  }
});

test("bad slugs are refused, and the page (no agent) keeps the workspace folder", () => {
  for (const slug of ["../qa", "QA", "-qa", "", "qa/x", "a".repeat(41)]) {
    assert.equal(resolveWorkspacePath(home, slug, "notes.md"), null, slug);
  }
  assert.equal(resolveWorkspacePath(home, null, "notes/a.md", { write: true }), at("workspace", "notes", "a.md"));
  assert.equal(resolveWorkspacePath(home, null, "agents/qa/x.md"), null);
  assert.equal(resolveWorkspacePath(home, null, "wt/pixelpets/game/feat/x"), null);
  assert.ok(resolveWorkspacePath(home, null, "shared/handoff/changelog.md"));
});

test("a work folder must be writable: own folder by default, own worktrees allowed", () => {
  assert.equal(resolveWorkFolder(home, "qa", ""), at("agents", "qa"));
  assert.equal(resolveWorkFolder(home, null, undefined), at("workspace"));
  assert.equal(resolveWorkFolder(home, "pixelpets", "wt/pixelpets/game/feat"), at("wt", "pixelpets", "game", "feat"));
  assert.equal(resolveWorkFolder(home, "design", "wt/pixelpets/game/feat"), null);
  assert.equal(resolveWorkFolder(home, "qa", "shared/repos/game"), null);
  assert.equal(resolveWorkFolder(home, "qa", "../.."), null);
});
