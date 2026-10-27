// Git worktrees per agent (SB-09). Clones live in shared/repos/<repo> (put there by Vincent or a
// setup step; nothing here clones). Each agent's worktrees live in wt/<slug>/<repo>/<branch>, so the
// owner is the first folder and a slug like "qa" can never be read as part of "qa-lead".
// git always runs through execFile with an argument list, never a shell string.
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { SLUG, resolveWorkspacePath, workspaceRoots } from "./paths.mjs";

const execFileAsync = promisify(execFile);
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const REPO = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function validBranch(name) {
  if (typeof name !== "string" || !BRANCH.test(name)) return false;
  if (name.startsWith("-") || name.includes("..") || name.includes("//")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return false;
  return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

function samePath(a, b) {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

export function createWorktrees({ home, repos = [], now = () => Date.now() }) {
  const roots = workspaceRoots(home);
  const allowed = new Set(repos.filter((name) => REPO.test(name)));

  async function git(cwd, args, { ok = false } = {}) {
    try {
      const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      return ok ? true : stdout.trim();
    } catch (error) {
      if (ok) return false;
      throw new Error(`git ${args[0]} failed: ${String(error.stderr || error.message).trim().slice(0, 400)}`);
    }
  }

  function check({ agent, repo, branch, base }) {
    if (typeof agent !== "string" || !SLUG.test(agent)) throw new Error("Unknown agent.");
    if (!allowed.has(repo)) throw new Error("That repo is not on the worktree allowlist.");
    if (!validBranch(branch)) throw new Error("That branch name is not allowed.");
    if (base !== undefined && !validBranch(base)) throw new Error("That base is not allowed.");
    const repoDir = path.join(roots.shared, "repos", repo);
    if (!existsSync(path.join(repoDir, ".git"))) throw new Error(`No clone of ${repo} in shared/repos.`);
    const relative = ["wt", agent, repo, ...branch.split("/")].join("/");
    // The same check as the file routes, so a symlink the agent left in its wt folder can't
    // send the checkout into another agent's folder.
    const target = resolveWorkspacePath(home, agent, relative, { write: true });
    if (!target) throw new Error("That worktree path is not allowed.");
    return { repoDir, target, relative };
  }

  async function list(repoDir) {
    const out = await git(repoDir, ["worktree", "list", "--porcelain"]);
    return out.split(/\n\n+/).map((block) => {
      const entry = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) entry.path = line.slice(9);
        else if (line.startsWith("branch refs/heads/")) entry.branch = line.slice(18);
      }
      return entry;
    }).filter((entry) => entry.path);
  }

  async function worktreeCreate({ agent, repo, branch, base = "origin/main" }) {
    const { repoDir, target, relative } = check({ agent, repo, branch, base });
    if (existsSync(target)) throw new Error("That worktree already exists.");
    if (!(await git(repoDir, ["check-ref-format", `refs/heads/${branch}`], { ok: true }))) throw new Error("That branch name is not allowed.");
    if (base.startsWith("origin/")) await git(repoDir, ["fetch", "--quiet", "origin"]);
    const exists = await git(repoDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { ok: true });
    // git creates the parent folders. --no-track: a new branch must not push to the base it started from.
    await git(repoDir, exists ? ["worktree", "add", target, branch] : ["worktree", "add", "--no-track", "-b", branch, target, base]);
    await git(repoDir, ["config", `branch.${branch}.sandbenchBase`, base]);
    await git(repoDir, ["config", `branch.${branch}.sandbenchCreated`, String(now())]);
    return { path: target, relative, repo, branch, base };
  }

  async function worktreeRemove({ agent, repo, branch }) {
    const { repoDir, target } = check({ agent, repo, branch });
    const known = (await list(repoDir)).some((entry) => samePath(entry.path, target));
    if (!known) throw new Error("No such worktree.");
    // No --force: git refuses when the worktree has uncommitted changes. The branch is kept.
    await git(repoDir, ["worktree", "remove", target]);
    return true;
  }

  // Removes worktrees whose branch is merged into its base and that have seen no commit and
  // no creation for `olderThanDays`. Dirty worktrees are kept. Scheduling it is SB-14.
  async function pruneWorktrees({ olderThanDays = 7 } = {}) {
    const removed = [];
    const kept = [];
    for (const repo of allowed) {
      const repoDir = path.join(roots.shared, "repos", repo);
      if (!existsSync(path.join(repoDir, ".git"))) continue;
      // A failed fetch only makes fewer branches look merged.
      await git(repoDir, ["fetch", "--quiet", "origin"], { ok: true });
      for (const entry of await list(repoDir)) {
        const inside = path.relative(roots.wt, entry.path);
        if (!entry.branch || inside.startsWith("..") || path.isAbsolute(inside)) continue;
        const base = (await git(repoDir, ["config", "--get", `branch.${entry.branch}.sandbenchBase`]).catch(() => "")) || "origin/main";
        const created = Number(await git(repoDir, ["config", "--get", `branch.${entry.branch}.sandbenchCreated`]).catch(() => "0")) || 0;
        const lastCommit = Number(await git(entry.path, ["log", "-1", "--format=%ct", "HEAD"])) * 1000;
        const why =
          now() - Math.max(created, lastCommit) < olderThanDays * DAY_MS ? "recent"
          : !validBranch(base) || !(await git(entry.path, ["merge-base", "--is-ancestor", "HEAD", base], { ok: true })) ? "not merged"
          : (await git(entry.path, ["status", "--porcelain"])) ? "uncommitted changes"
          : "";
        if (why) {
          kept.push({ path: entry.path, branch: entry.branch, why });
          continue;
        }
        await git(repoDir, ["worktree", "remove", entry.path]);
        removed.push({ path: entry.path, branch: entry.branch });
      }
      await git(repoDir, ["worktree", "prune"], { ok: true });
    }
    return { removed, kept };
  }

  return { worktreeCreate, worktreeRemove, pruneWorktrees };
}
