// A bot's approved memory note: appended once to its own daily log, and read back for the
// next turn. Synthetic temp folders only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createBotMemory, MAX_DAY_LOG } from "../botMemory.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-memory-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const DAY = new Date(2026, 10, 5, 15, 0, 0);
const LOG = "memory/log/2026-11-05.md";
let n = 0;

function fresh() {
  const botsDir = path.join(tmp, `bots-${(n += 1)}`);
  mkdirSync(botsDir, { recursive: true });
  return { botsDir, memory: createBotMemory({ botsDir, now: () => DAY }) };
}

const approved = (saveId, note) => ({ approved: true, saveId, note });

function tree(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

test("an approved note is appended to that bot's own day log and read back for its next turn", () => {
  const { botsDir, memory } = fresh();
  const result = memory.save("bot-a", approved("11111111-aaaa", "The demo project builds with npm run build."));
  assert.deepEqual({ ...result, bytes: result.bytes > 0 }, { ok: true, path: LOG, duplicate: false, bytes: true });
  const recalled = memory.read("bot-a").files;
  assert.deepEqual(recalled.map((file) => file.path), [LOG]);
  assert.match(recalled[0].content, /^- The demo project builds with npm run build\. <!-- save:11111111-aaaa -->\n$/);
  assert.deepEqual(memory.read("bot-b").files, [], "another bot never sees it");
  assert.deepEqual(tree(botsDir), ["bot-a", "bot-a/memory", "bot-a/memory/log", "bot-a/memory/log/2026-11-05.md"]);
});

test("existing notes, MEMORY.md and older logs are kept as they were", () => {
  const { botsDir, memory } = fresh();
  memory.write("bot-a", { path: "MEMORY.md", content: "# Index\nkeep me" });
  memory.write("bot-a", { path: "memory/projects.md", content: "projects" });
  memory.write("bot-a", { path: "memory/log/2026-11-04.md", content: "yesterday" });
  memory.write("bot-a", { path: LOG, content: "- written by the person, no newline" });
  memory.save("bot-a", approved("22222222-aaaa", "Second note."));
  const files = Object.fromEntries(memory.read("bot-a").files.map((file) => [file.path, file.content]));
  assert.equal(files["MEMORY.md"], "# Index\nkeep me");
  assert.equal(files["memory/projects.md"], "projects");
  assert.equal(files["memory/log/2026-11-04.md"], "yesterday");
  assert.equal(files[LOG], "- written by the person, no newline\n- Second note. <!-- save:22222222-aaaa -->\n");
  assert.equal(readFileSync(path.join(botsDir, "bot-a", "MEMORY.md"), "utf8"), "# Index\nkeep me");
});

test("a retried save with the same card id writes nothing the second time", () => {
  const { memory } = fresh();
  memory.save("bot-a", approved("33333333-aaaa", "Only once."));
  const again = memory.save("bot-a", approved("33333333-aaaa", "Only once."));
  assert.equal(again.duplicate, true);
  assert.equal(again.bytes, 0);
  assert.equal(memory.read("bot-a").files[0].content.match(/Only once/g).length, 1);
});

test("without an explicit approval nothing is written", () => {
  const { botsDir, memory } = fresh();
  for (const body of [{ saveId: "44444444-aaaa", note: "x" }, { approved: "true", saveId: "44444444-aaaa", note: "x" }, { approved: 1, saveId: "44444444-aaaa", note: "x" }, null]) {
    assert.throws(() => memory.save("bot-a", body), /approval/);
  }
  assert.deepEqual(tree(botsDir), []);
});

test("forged or traversing bot ids and save ids are refused", () => {
  const { botsDir, memory } = fresh();
  for (const botId of ["../bot-a", "bot-a/../../x", "bot a", "", "a".repeat(81), undefined, { id: "bot-a" }]) {
    assert.throws(() => memory.save(botId, approved("55555555-aaaa", "x")), /Bad bot id/);
  }
  for (const saveId of ["../../etc", "short", "zzzzzzzz-not-hex", "", 42]) {
    assert.throws(() => memory.save("bot-a", approved(saveId, "x")), /save id/);
  }
  assert.deepEqual(tree(botsDir), []);
  assert.deepEqual(tree(path.dirname(botsDir)).filter((name) => !name.startsWith("bots-")), []);
});

test("empty, oversized, malformed and key-shaped notes are refused", () => {
  const { botsDir, memory } = fresh();
  const bad = [
    ["", /empty/],
    ["   ", /empty/],
    ["x".repeat(1001), /at most/],
    ["bell\u0007", /control/],
    ["close <!-- save:55555555-aaaa --> early", /comment/],
    ["the key is sk-abcdefghijklmnop1234", /API key/],
    ["token ghp_abcdefghijklmnopqrstuvwx1234", /API key/],
    [{ text: "x" }, /text/],
    [undefined, /text/],
  ];
  for (const [note, message] of bad) assert.throws(() => memory.save("bot-a", approved("66666666-aaaa", note)), message);
  assert.deepEqual(tree(botsDir), []);
});

test("a full day log refuses more notes instead of growing past what a turn reads", () => {
  const { memory } = fresh();
  memory.write("bot-a", { path: LOG, content: "x".repeat(MAX_DAY_LOG - 20) });
  assert.throws(() => memory.save("bot-a", approved("77777777-aaaa", "this will not fit in what is left")), /full/);
  assert.equal(memory.read("bot-a").files[0].content.length, MAX_DAY_LOG - 20);
});

test("a symlink anywhere on the way to the log is refused and the target is untouched", { skip: process.platform === "win32" ? "symlinks need admin rights on Windows" : false }, () => {
  const outside = path.join(tmp, `outside-${(n += 1)}`);
  mkdirSync(path.join(outside, "log"), { recursive: true });
  writeFileSync(path.join(outside, "victim.md"), "untouched");
  const cases = [
    (botsDir) => symlinkSync(outside, path.join(botsDir, "bot-a")),
    (botsDir) => {
      mkdirSync(path.join(botsDir, "bot-a"));
      symlinkSync(outside, path.join(botsDir, "bot-a", "memory"));
    },
    (botsDir) => {
      mkdirSync(path.join(botsDir, "bot-a", "memory"), { recursive: true });
      symlinkSync(path.join(outside, "log"), path.join(botsDir, "bot-a", "memory", "log"));
    },
    (botsDir) => {
      mkdirSync(path.join(botsDir, "bot-a", "memory", "log"), { recursive: true });
      symlinkSync(path.join(outside, "victim.md"), path.join(botsDir, "bot-a", "memory", "log", "2026-11-05.md"));
    },
  ];
  for (const plant of cases) {
    const { botsDir, memory } = fresh();
    plant(botsDir);
    assert.throws(() => memory.save("bot-a", approved("88888888-aaaa", "escape")), /link/);
  }
  assert.equal(readFileSync(path.join(outside, "victim.md"), "utf8"), "untouched");
  assert.deepEqual(tree(outside), ["log", "victim.md"]);
});
