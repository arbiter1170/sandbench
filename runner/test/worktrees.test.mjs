// SB-09 worktrees against real git, with local fixture repos only (no network, no real clones).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { resolveWorkspacePath } from "../workspace/paths.mjs";
import { createWorktrees, validBranch } from "../workspace/worktrees.mjs";

const DAY = 24 * 60 * 60 * 1000;
let tmp;
let home;
let clone;
let clock;
let worktrees;

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const commit = (cwd, file, text) => {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `add ${file}`);
};

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-wt-"));
  // Keep the developer's own git config (signing, hooks, default branch) out of the fixture.
  writeFileSync(path.join(tmp, "gitconfig"), "");
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: path.join(tmp, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.test",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.test",
  });
  const origin = path.join(tmp, "game.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = path.join(tmp, "seed");
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  git(seed, "remote", "add", "origin", origin);
  commit(seed, "README.md", "game\n");
  git(seed, "push", "-q", "origin", "main");

  home = path.join(tmp, "home");
  clone = path.join(home, "shared", "repos", "game");
  mkdirSync(path.dirname(clone), { recursive: true });
  execFileSync("git", ["clone", "-q", origin, clone]);
  for (const slug of ["pixelpets", "review", "design", "qa"]) mkdirSync(path.join(home, "agents", slug), { recursive: true });
  mkdirSync(path.join(home, "wt"), { recursive: true });
  clock = Date.now();
  worktrees = createWorktrees({ home, repos: ["game"], now: () => clock });
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("two agents build in separate worktrees off origin/main without touching each other", async () => {
  const main = git(clone, "rev-parse", "origin/main");
  const pp = await worktrees.worktreeCreate({ agent: "pixelpets", repo: "game", branch: "pp/feature" });
  const rv = await worktrees.worktreeCreate({ agent: "review", repo: "game", branch: "review/feature" });
  assert.equal(pp.path, path.join(home, "wt", "pixelpets", "game", "pp", "feature"));
  assert.equal(pp.relative, "wt/pixelpets/game/pp/feature");
  assert.equal(git(pp.path, "rev-parse", "HEAD"), main);
  assert.equal(git(rv.path, "rev-parse", "HEAD"), main);

  commit(pp.path, "pp.txt", "pixelpets\n");
  commit(rv.path, "review.txt", "review\n");
  assert.equal(existsSync(path.join(rv.path, "pp.txt")), false);
  assert.equal(existsSync(path.join(pp.path, "review.txt")), false);
  assert.equal(git(pp.path, "branch", "--show-current"), "pp/feature");
  assert.equal(git(rv.path, "branch", "--show-current"), "review/feature");
  // The shared clone stays on main and clean.
  assert.equal(git(clone, "branch", "--show-current"), "main");
  assert.equal(git(clone, "status", "--porcelain"), "");
  // A new branch does not track origin/main, so a plain push can't land on main.
  assert.throws(() => git(clone, "config", "--get", "branch.pp/feature.merge"));
});

test("a branch checked out by one agent can't be taken by another", async () => {
  await assert.rejects(worktrees.worktreeCreate({ agent: "design", repo: "game", branch: "pp/feature" }), /git worktree failed/);
  assert.equal(existsSync(path.join(home, "wt", "design", "game", "pp", "feature", "README.md")), false);
});

test("Design cannot write into PixelPets' worktree, even through a symlink", async () => {
  assert.equal(resolveWorkspacePath(home, "design", "wt/pixelpets/game/pp/feature/pp.txt", { write: true }), null);
  assert.ok(resolveWorkspacePath(home, "pixelpets", "wt/pixelpets/game/pp/feature/pp.txt", { write: true }));
  // Design plants a link in its own wt folder that points at PixelPets' worktrees.
  mkdirSync(path.join(home, "wt", "design"), { recursive: true });
  rmSync(path.join(home, "wt", "design", "game"), { recursive: true, force: true });
  symlinkSync(path.join(home, "wt", "pixelpets", "game"), path.join(home, "wt", "design", "game"), "junction");
  await assert.rejects(worktrees.worktreeCreate({ agent: "design", repo: "game", branch: "design/sneak" }), /not allowed/);
  assert.equal(existsSync(path.join(home, "wt", "pixelpets", "game", "design")), false);
  rmSync(path.join(home, "wt", "design", "game"), { recursive: true, force: true });
  // And it can't remove PixelPets' worktree either.
  await assert.rejects(worktrees.worktreeRemove({ agent: "design", repo: "game", branch: "pp/feature" }), /No such worktree/);
  assert.ok(existsSync(path.join(home, "wt", "pixelpets", "game", "pp", "feature", "pp.txt")));
});

test("branch names with '-', '..', spaces or shell characters are refused", async () => {
  const bad = ["-x", "--upload-pack=touch", "a..b", "has space", "a;id", "$(id)", "a|b", "a&b", "a`id`", "../x", "/x", "x/", "a//b", ".hidden", "x/.y", "x.lock", "x.", "", "a".repeat(101), "a\nb", "a~1", "a^", "a:b", "a?", "a*", "a[b", "a\\b"];
  for (const branch of bad) {
    assert.equal(validBranch(branch), false, JSON.stringify(branch));
    await assert.rejects(worktrees.worktreeCreate({ agent: "qa", repo: "game", branch }), /not allowed/, JSON.stringify(branch));
  }
  await assert.rejects(worktrees.worktreeCreate({ agent: "qa", repo: "game", branch: "ok", base: "--output=/tmp/x" }), /base is not allowed/);
  await assert.rejects(worktrees.worktreeCreate({ agent: "qa", repo: "other", branch: "ok" }), /allowlist/);
  await assert.rejects(worktrees.worktreeCreate({ agent: "../qa", repo: "game", branch: "ok" }), /Unknown agent/);
  for (const branch of ["main", "qa/run-20261026", "fix_1.2", "Feature/X"]) assert.equal(validBranch(branch), true, branch);
  // Nothing was created by the refused calls.
  assert.equal(existsSync(path.join(home, "wt", "qa")), false);
  assert.equal(git(clone, "branch", "--list", "ok"), "");
});

test("an owner removes its own worktree; uncommitted work stops the removal", async () => {
  const qa = await worktrees.worktreeCreate({ agent: "qa", repo: "game", branch: "qa/check" });
  writeFileSync(path.join(qa.path, "wip.txt"), "unsaved");
  await assert.rejects(worktrees.worktreeRemove({ agent: "qa", repo: "game", branch: "qa/check" }), /git worktree failed/);
  rmSync(path.join(qa.path, "wip.txt"));
  assert.equal(await worktrees.worktreeRemove({ agent: "qa", repo: "game", branch: "qa/check" }), true);
  assert.equal(existsSync(qa.path), false);
  // The branch is kept, so no committed work is lost.
  assert.equal(git(clone, "branch", "--list", "qa/check").replace(/^[*+ ]+/, ""), "qa/check");
});

test("prune removes only merged worktrees with no activity for 7 days", async () => {
  const start = clock;
  const merged = await worktrees.worktreeCreate({ agent: "design", repo: "game", branch: "design/merged" });
  commit(merged.path, "spec.md", "spec\n");
  git(merged.path, "push", "-q", "origin", "HEAD:main");
  const unmerged = await worktrees.worktreeCreate({ agent: "design", repo: "game", branch: "design/open" });
  commit(unmerged.path, "draft.md", "draft\n");
  const dirty = await worktrees.worktreeCreate({ agent: "qa", repo: "game", branch: "qa/dirty" });
  writeFileSync(path.join(dirty.path, "notes.txt"), "not committed");
  clock = start + 5 * DAY;
  const recent = await worktrees.worktreeCreate({ agent: "qa", repo: "game", branch: "qa/recent" });
  clock = start + 8 * DAY;

  const { removed, kept } = await worktrees.pruneWorktrees({ olderThanDays: 7 });
  assert.deepEqual(removed.map((item) => item.branch), ["design/merged"]);
  const why = Object.fromEntries(kept.map((item) => [item.branch, item.why]));
  assert.equal(why["design/open"], "not merged");
  assert.equal(why["qa/dirty"], "uncommitted changes");
  assert.equal(why["qa/recent"], "recent");
  assert.equal(existsSync(merged.path), false);
  for (const item of [unmerged, dirty, recent]) assert.ok(existsSync(item.path), item.branch);
  assert.equal(readFileSync(path.join(dirty.path, "notes.txt"), "utf8"), "not committed");
  // The shared clone itself is never a prune candidate.
  assert.ok(existsSync(path.join(clone, "README.md")));
});
