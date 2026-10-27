// Per-agent workspaces (SB-09). Every root comes from SANDBENCH_HOME:
//   workspace/                  legacy: the owner context (no agent), today's folder for page calls
//   shared/                     every agent reads; agents write only under shared/handoff/
//   agents/<slug>/              an agent's own folder (read and write)
//   wt/<slug>/<repo>/<branch>/  that agent's git worktrees (read and write; worktrees.mjs)
//
// For an agent, a path starting "shared/" or "wt/<slug>/" names that area; anything else is
// inside its own folder, so another agent's folder can't even be named. This limits the runner's
// file routes and where a command starts. It is not a sandbox: a shell command can still open any
// path the runner's user can.
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export const AGENT_SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

export class WorkspaceError extends Error {
  /** @param {"invalid" | "outside" | "forbidden"} code */
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export function workspaceRoots(home) {
  return {
    legacy: path.join(home, "workspace"),
    shared: path.join(home, "shared"),
    agents: path.join(home, "agents"),
    wt: path.join(home, "wt"),
  };
}

// The relative path from base to target, or null when target is not strictly inside base.
function within(base, target) {
  const relative = path.relative(base, target);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === "..") return null;
  return relative;
}

// realpath of the deepest part of `target` that exists, plus the rest. A symlink that points
// nowhere yet is refused: writing through it would create its target, wherever that is.
function realOf(target) {
  const rest = [];
  let existing = target;
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...rest);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      let link = false;
      try {
        link = lstatSync(existing).isSymbolicLink();
      } catch {
        // not there at all
      }
      if (link) throw new WorkspaceError("forbidden", "That path goes through a link to nowhere.");
      const parent = path.dirname(existing);
      if (parent === existing) return target;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Returns the absolute path `agentSlug` may use, or throws WorkspaceError.
 * `agentSlug === null` is the owner context: the legacy workspace folder, as before SB-09.
 * The slug always comes from the server (SB-03 passes it from the job), never from a request.
 */
export function resolveWorkspacePath(roots, agentSlug, requested, { write = false } = {}) {
  if (agentSlug !== null && (typeof agentSlug !== "string" || !AGENT_SLUG.test(agentSlug))) {
    throw new WorkspaceError("invalid", "Unknown agent.");
  }
  if (typeof requested !== "string" || !requested.trim() || requested.length > 240) throw new WorkspaceError("invalid", "No path.");
  if (requested.includes("\0") || requested.includes("\\")) throw new WorkspaceError("invalid", "That path has characters that aren't allowed.");
  if (requested.startsWith("/") || /^[a-z]:/i.test(requested)) throw new WorkspaceError("invalid", "Paths are relative.");
  const parts = requested.split("/");
  if (parts.includes("..")) throw new WorkspaceError("outside", "Paths can't use '..'.");

  // `base` is the folder the target must stay inside, before and after following links.
  let base;
  let rest;
  if (agentSlug === null) {
    [base, rest] = [roots.legacy, parts];
  } else if (parts[0] === "shared") {
    if (write && parts[1] !== "handoff") throw new WorkspaceError("forbidden", "Agents write only under shared/handoff/.");
    [base, rest] = write ? [path.join(roots.shared, "handoff"), parts.slice(2)] : [roots.shared, parts.slice(1)];
  } else if (parts[0] === "wt") {
    if (parts[1] !== agentSlug) throw new WorkspaceError("forbidden", "Another agent's worktree can't be read or written.");
    [base, rest] = [path.join(roots.wt, agentSlug), parts.slice(2)];
  } else {
    [base, rest] = [path.join(roots.agents, agentSlug), parts];
  }

  const target = path.resolve(base, ...rest.filter((part) => part && part !== "."));
  if (!within(base, target)) throw new WorkspaceError("outside", "The path must stay inside the workspace folder.");
  if (!within(realOf(base), realOf(target))) throw new WorkspaceError("forbidden", "That path leads outside its folder through a link.");
  return target;
}
