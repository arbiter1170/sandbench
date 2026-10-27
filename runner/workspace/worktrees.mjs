// Git worktrees per agent (SB-09). Repos come from an allowlist (SANDBENCH_REPOS); each agent's
// worktrees live in wt/<slug>/<repo>/<branch>, so the owner is its own folder and a slug like "qa"
// can never claim "qa-lead"'s worktrees. git always runs through execFile with an argument list,
// never a shell string, and every input is checked before the first git call.
// Nothing calls these yet: the worktree_create / worktree_remove tools are SB-10, the nightly
// prune is SB-14.
import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { AGENT_SLUG, resolveWorkspacePath } from "./paths.mjs";

const REPO_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function validBranch(name) {
  if (typeof name !== "string" || !BRANCH.test(name)) return false;
  if (name.startsWith("-") || name.includes("..") || name.includes("//")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return false;
  return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

/** `name=/abs/path[#base],name2=...` (base defaults to origin/main) -> { name: { path, base } }. */
export function parseRepoAllowlist(text) {
  const repos = {};
  for (const entry of String(text || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const match = /^([^=]+)=([^#]+)(?:#(.+))?$/.exec(entry);
    const [name, dir, base = "origin/main"] = match ? [match[1].trim(), match[2].trim(), match[3]?.trim()] : [];
    if (!match || !REPO_NAME.test(name) || !path.isAbsolute(dir) || !validBranch(base)) {
      throw new Error(`SANDBENCH_REPOS: "${entry}" is not name=/absolute/path[#base].`);
    }
    repos[name] = { path: dir, base };
  }
  return repos;
}

const same = (a, b) => {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
};

export function createWorktrees({ roots, repos = {}, exec = promisify(execFile) }) {
  const git = (args) =>
    exec("git", args, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }).then((out) =>
      String(out?.stdout ?? "").trim(),
    );
  const ok = (args) => git(args).then(() => true, () => false);

  function check({ agentSlug, repo, branch, base }) {
    if (typeof agentSlug !== "string" || !AGENT_SLUG.test(agentSlug)) throw new Error("Unknown agent.");
    if (typeof repo !== "string" || !Object.hasOwn(repos, repo)) throw new Error("That repo is not on the allowlist.");
    if (!validBranch(branch)) throw new Error("That branch name is not allowed.");
    if (base !== undefined && !validBranch(base)) throw new Error("That base is not allowed.");
    // The same rules as the file routes, so a link the agent left in its wt folder can't send
    // the checkout into another agent's folder.
    const dest = resolveWorkspacePath(roots, agentSlug, ["wt", agentSlug, repo, branch].join("/"), { write: true });
    return { repoPath: repos[repo].path, dest };
  }

  async function list(repoPath) {
    const out = await git(["-C", repoPath, "worktree", "list", "--porcelain"]);
    return out
      .split(/\n\n+/)
      .map((block) => ({
        path: /^worktree (.+)$/m.exec(block)?.[1],
        branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1],
      }))
      .filter((entry) => entry.path);
  }

  async function create({ agentSlug, repo, branch, base }) {
    const { repoPath, dest } = check({ agentSlug, repo, branch, base });
    const from = base ?? repos[repo].base;
    if (existsSync(dest)) throw new Error("That worktree already exists.");
    if (!(await ok(["-C", repoPath, "check-ref-format", `refs/heads/${branch}`]))) throw new Error("That branch name is not allowed.");
    if (from.startsWith("origin/")) await git(["-C", repoPath, "fetch", "--quiet", "origin"]);
    // --no-track: a plain `git push` from the new branch can't land on the base it started from.
    await git(["-C", repoPath, "worktree", "add", "--no-track", "-b", branch, dest, from]);
    return { path: dest, branch };
  }

  async function remove({ agentSlug, repo, branch }) {
    const { repoPath, dest } = check({ agentSlug, repo, branch });
    if (!(await list(repoPath)).some((entry) => same(entry.path, dest))) throw new Error("No such worktree.");
    // Never --force: git refuses when there are uncommitted changes. The branch is kept.
    await git(["-C", repoPath, "worktree", "remove", dest]);
    return { removed: true };
  }

  /**
   * Worktrees under wt/ whose branch is merged into the repo's base and whose folder hasn't
   * changed for `olderThanDays`. Dry run by default: it only reports. With dryRun false it runs
   * `git worktree remove` and `git branch -d` (never --force, never -D).
   */
  async function prune({ olderThanDays = 7, now = Date.now(), dryRun = true } = {}) {
    const removed = [];
    const kept = [];
    const cutoff = now - olderThanDays * DAY_MS;
    for (const [name, repo] of Object.entries(repos)) {
      if (!existsSync(repo.path)) continue;
      // A failed fetch only makes fewer branches look merged.
      await ok(["-C", repo.path, "fetch", "--quiet", "origin"]);
      for (const entry of await list(repo.path)) {
        const relative = path.relative(roots.wt, entry.path);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
        const item = { repo: name, path: entry.path, branch: entry.branch };
        const reason =
          !entry.branch ? "no branch"
          : statSync(entry.path).mtimeMs > cutoff ? "recent"
          : !(await ok(["-C", repo.path, "merge-base", "--is-ancestor", entry.branch, repo.base])) ? "not merged"
          : (await git(["-C", entry.path, "status", "--porcelain"])) ? "uncommitted changes"
          : "";
        if (reason) {
          kept.push({ ...item, reason });
          continue;
        }
        if (!dryRun) {
          await git(["-C", repo.path, "worktree", "remove", entry.path]);
          item.branchDeleted = await ok(["-C", repo.path, "branch", "-d", entry.branch]);
        }
        removed.push(item);
      }
    }
    return { removed, kept, dryRun };
  }

  return { create, remove, prune };
}
