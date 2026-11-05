// SB-09 worktrees with real git on local fixture repos (no network, no real repo).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createWorktrees, parseRepoAllowlist, resolveWorkspacePath, validBranch, workspaceRoots } from "../workspace/index.mjs";

const DAY = 24 * 60 * 60 * 1000;
let tmp;
let roots;
let clone;
let worktrees;

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const commit = (cwd, file, text) => {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `add ${file}`);
};
const age = (dir, days) => {
  const when = new Date(Date.now() - days * DAY);
  utimesSync(dir, when, when);
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
  clone = path.join(tmp, "clones", "game");
  execFileSync("git", ["clone", "-q", origin, clone]);

  roots = workspaceRoots(path.join(tmp, "home"));
  for (const folder of Object.values(roots)) mkdirSync(folder, { recursive: true });
  mkdirSync(path.join(roots.shared, "handoff"), { recursive: true });
  writeFileSync(path.join(roots.shared, "handoff", "changelog.md"), "build 20261026-0001\n");
  worktrees = createWorktrees({ roots, repos: { game: { path: clone, base: "origin/main" } } });
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("SANDBENCH_REPOS parses name=/abs/path[#base] and refuses anything else", () => {
  const abs = path.join(tmp, "clones", "game");
  assert.deepEqual(parseRepoAllowlist(`game=${abs}, design=${abs}#origin/develop`), {
    game: { path: abs, base: "origin/main" },
    design: { path: abs, base: "origin/develop" },
  });
  assert.deepEqual(parseRepoAllowlist(""), {});
  for (const bad of ["game", "game=relative/path", `Game=${abs}`, `game=${abs}#-x`, `game=${abs}#a..b`]) {
    assert.throws(() => parseRepoAllowlist(bad), /SANDBENCH_REPOS/, bad);
  }
});

test("two agents build in separate worktrees off the same base without touching each other", async () => {
  const main = git(clone, "rev-parse", "origin/main");
  const pp = await worktrees.create({ agentSlug: "pixelpets", repo: "game", branch: "pp/shop" });
  const rv = await worktrees.create({ agentSlug: "review", repo: "game", branch: "review/shop" });
  assert.deepEqual(pp, { path: path.join(roots.wt, "pixelpets", "game", "pp", "shop"), branch: "pp/shop" });
  assert.equal(git(pp.path, "rev-parse", "HEAD"), main);
  assert.equal(git(rv.path, "rev-parse", "HEAD"), main);
  commit(pp.path, "shop.js", "pixelpets\n");
  commit(rv.path, "review.md", "review\n");
  assert.equal(git(rv.path, "status", "--porcelain"), "");
  assert.equal(git(pp.path, "status", "--porcelain"), "");
  assert.equal(existsSync(path.join(rv.path, "shop.js")), false);
  assert.equal(existsSync(path.join(pp.path, "review.md")), false);
  // The clone itself stays clean on main, and the new branch does not track main.
  assert.equal(git(clone, "branch", "--show-current"), "main");
  assert.equal(git(clone, "status", "--porcelain"), "");
  assert.throws(() => git(clone, "config", "--get", "branch.pp/shop.merge"));
  await assert.rejects(worktrees.create({ agentSlug: "pixelpets", repo: "game", branch: "pp/shop" }), /already exists/);
});

test("QA reads the shared handoff; Design can't write into PixelPets' worktree", async () => {
  assert.ok(resolveWorkspacePath(roots, "qa", "shared/handoff/changelog.md"));
  assert.throws(() => resolveWorkspacePath(roots, "design", "wt/pixelpets/game/pp/shop/shop.js", { write: true }), /worktree/);
  // Design leaves a link in its own wt folder pointing at PixelPets' worktrees, then asks for one.
  mkdirSync(path.join(roots.wt, "design"), { recursive: true });
  symlinkSync(path.join(roots.wt, "pixelpets", "game"), path.join(roots.wt, "design", "game"), "junction");
  await assert.rejects(worktrees.create({ agentSlug: "design", repo: "game", branch: "sneak" }), /link/);
  assert.equal(existsSync(path.join(roots.wt, "pixelpets", "game", "sneak")), false);
  rmSync(path.join(roots.wt, "design", "game"), { recursive: true, force: true });
  await assert.rejects(worktrees.remove({ agentSlug: "design", repo: "game", branch: "pp/shop" }), /No such worktree/);
  assert.ok(existsSync(path.join(roots.wt, "pixelpets", "game", "pp", "shop", "shop.js")));
});

test("bad branch names, bases, repos and slugs are refused before any git call", async () => {
  const calls = [];
  const fake = createWorktrees({ roots, repos: { game: { path: clone, base: "origin/main" } }, exec: async (...args) => calls.push(args) });
  const bad = ["-x", "a..b", "a b", "a;b", "$(x)", "a\nb", "a|b", "a&b", "a`b`", "../x", "/x", "x/", "a//b", ".hidden", "x.lock", "", "a".repeat(101), "a~1", "a:b"];
  for (const branch of bad) {
    assert.equal(validBranch(branch), false, JSON.stringify(branch));
    await assert.rejects(fake.create({ agentSlug: "qa", repo: "game", branch }), /not allowed/, JSON.stringify(branch));
  }
  await assert.rejects(fake.create({ agentSlug: "qa", repo: "game", branch: "ok", base: "--output=x" }), /base/);
  await assert.rejects(fake.create({ agentSlug: "qa", repo: "other", branch: "ok" }), /allowlist/);
  await assert.rejects(fake.create({ agentSlug: "qa", repo: "__proto__", branch: "ok" }), /allowlist/);
  await assert.rejects(fake.create({ agentSlug: "../qa", repo: "game", branch: "ok" }), /Unknown agent/);
  await assert.rejects(fake.remove({ agentSlug: "qa", repo: "game", branch: "-f" }), /not allowed/);
  assert.deepEqual(calls, []);
  for (const branch of ["main", "qa/run-20261026", "fix_1.2", "Feature/X"]) assert.equal(validBranch(branch), true, branch);
});

test("an agent removes its own worktree, never one with uncommitted work", async () => {
  const qa = await worktrees.create({ agentSlug: "qa", repo: "game", branch: "qa/check" });
  writeFileSync(path.join(qa.path, "wip.txt"), "unsaved");
  await assert.rejects(worktrees.remove({ agentSlug: "qa", repo: "game", branch: "qa/check" }));
  assert.ok(existsSync(path.join(qa.path, "wip.txt")));
  rmSync(path.join(qa.path, "wip.txt"));
  assert.deepEqual(await worktrees.remove({ agentSlug: "qa", repo: "game", branch: "qa/check" }), { removed: true });
  assert.equal(existsSync(qa.path), false);
  assert.equal(git(clone, "branch", "--list", "qa/check").replace(/^[*+ ]+/, ""), "qa/check");
});

test("prune removes only merged worktrees older than 7 days; dry run removes nothing", async () => {
  const merged = await worktrees.create({ agentSlug: "design", repo: "game", branch: "design/spec" });
  commit(merged.path, "spec.md", "spec\n");
  git(merged.path, "push", "-q", "origin", "HEAD:main");
  const open = await worktrees.create({ agentSlug: "design", repo: "game", branch: "design/draft" });
  commit(open.path, "draft.md", "draft\n");
  const young = await worktrees.create({ agentSlug: "qa", repo: "game", branch: "qa/young" });
  const dirty = await worktrees.create({ agentSlug: "qa", repo: "game", branch: "qa/dirty" });
  writeFileSync(path.join(dirty.path, "notes.txt"), "not committed");
  for (const dir of [merged.path, open.path, dirty.path]) age(dir, 8);
  age(young.path, 3);

  const dry = await worktrees.prune();
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.removed.map((item) => item.branch), ["design/spec"]);
  assert.ok(existsSync(merged.path), "a dry run removes nothing");

  const result = await worktrees.prune({ dryRun: false });
  assert.deepEqual(result.removed.map((item) => item.branch), ["design/spec"]);
  const reasons = Object.fromEntries(result.kept.map((item) => [item.branch, item.reason]));
  assert.equal(reasons["design/draft"], "not merged");
  assert.equal(reasons["qa/young"], "recent");
  assert.equal(reasons["qa/dirty"], "uncommitted changes");
  assert.equal(existsSync(merged.path), false);
  for (const item of [open, young, dirty]) assert.ok(existsSync(item.path), item.branch);
  // The shared clone itself is never a candidate.
  assert.ok(existsSync(path.join(clone, "README.md")));
});
