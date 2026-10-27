// Per-agent workspaces (SB-09). Everything lives under SANDBENCH_HOME:
//   shared/             handoff notes and repo clones; every agent reads, writes only shared/handoff
//   agents/<slug>/      an agent's default working folder; only that agent reads or writes it
//   wt/<slug>/<repo>/<branch>   that agent's git worktrees (worktrees.mjs)
//   workspace/          the page's own folder, for calls that carry no agent yet (see server.mjs)
//
// A requested path is relative. "shared/...", "agents/<slug>/..." and "wt/<slug>/..." name an
// area; anything else is inside the caller's own folder. This limits the runner's file routes and
// the folder a command starts in. It is not a sandbox: a shell command can still open any path
// the runner's user can, so isolating commands needs OS-level users or containers.
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Shared folders an agent may write into; the rest of shared/ (repo clones) is read-only.
const SHARED_WRITABLE = ["handoff"];

export function workspaceRoots(home) {
  return {
    home,
    shared: path.join(home, "shared"),
    agents: path.join(home, "agents"),
    wt: path.join(home, "wt"),
    page: path.join(home, "workspace"),
  };
}

export function ownFolder(home, agentSlug) {
  const roots = workspaceRoots(home);
  return agentSlug ? path.join(roots.agents, agentSlug) : roots.page;
}

// What `agentSlug` may do at `parts` (path segments under home): "write", "read" or null.
function access(parts, agentSlug, write) {
  const [area, owner] = parts;
  let level = null;
  if (area === "shared") level = parts.length > 1 && SHARED_WRITABLE.includes(parts[1]) && parts.length > 2 ? "write" : "read";
  else if ((area === "agents" || area === "wt") && agentSlug && owner === agentSlug) level = "write";
  else if (area === "workspace" && !agentSlug) level = "write";
  if (!level) return false;
  return write ? level === "write" : true;
}

// Follows symlinks for the part of `target` that exists, so a link can't lead out of an area.
// A link that points nowhere yet returns null: writing through it would create its target.
function realTarget(target) {
  let existing = target;
  const rest = [];
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...rest);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      try {
        if (lstatSync(existing).isSymbolicLink()) return null;
      } catch {
        // not there at all; keep climbing
      }
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

function segmentsUnder(root, target) {
  const inside = path.relative(root, target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return inside ? inside.split(path.sep) : [];
}

// Returns the absolute path, or null when the agent may not reach it.
export function resolveWorkspacePath(root, agentSlug, requested, { write = false } = {}) {
  if (agentSlug !== null && (typeof agentSlug !== "string" || !SLUG.test(agentSlug))) return null;
  if (typeof requested !== "string" || !requested.trim() || requested.length > 400) return null;
  if (requested.includes("\0")) return null;
  if (path.isAbsolute(requested) || /^[a-z]:/i.test(requested) || requested.startsWith("\\")) return null;
  const normalized = requested.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) return null;

  const first = normalized.split("/")[0];
  const named = first === "shared" || first === "agents" || first === "wt";
  const base = named ? root : ownFolder(root, agentSlug);
  const target = path.resolve(base, normalized);
  const parts = segmentsUnder(root, target);
  if (!parts || !access(parts, agentSlug, write)) return null;
  // An area's root itself ("shared", "agents/qa") is a folder to list or start in, not a file.
  if (parts.length < (parts[0] === "workspace" ? 2 : parts[0] === "shared" ? 2 : 3)) return null;

  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  const real = realTarget(target);
  const realParts = real && segmentsUnder(realRoot, real);
  if (!realParts || !access(realParts, agentSlug, write)) return null;
  return target;
}

// The folder a command or turn starts in: the caller's own folder by default, otherwise any
// folder the caller may write to (its own worktrees included).
export function resolveWorkFolder(root, agentSlug, folder) {
  if (!folder) return ownFolder(root, agentSlug);
  return resolveWorkspacePath(root, agentSlug, folder, { write: true });
}
