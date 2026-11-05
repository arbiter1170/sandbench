// The one place a local turn tells the model where it is. The page only names a folder (or
// nothing); the harness resolves it against the workspace root and passes that path to the
// driver as its process cwd. Without this block the model knows only "the Sandbench workspace
// folder" and may guess a path (a live run tried `.sandbox` instead of `.sandbench`). With it the
// exact path is in the prompt; a model can still mistype, but no longer has to guess.
import path from "node:path";

/**
 * @param {{ cwd: string, root: string, pathApi?: typeof path }} input
 *   cwd is the resolved working directory the driver runs in; root is the workspace root it
 *   lives in. pathApi defaults to the host's path module (tests pass path.win32 or path.posix).
 */
export function describeWorkingDirectory({ cwd, root, pathApi = path }) {
  if (typeof cwd !== "string" || !cwd) throw new Error("describeWorkingDirectory needs the resolved cwd.");
  if (typeof root !== "string" || !root) throw new Error("describeWorkingDirectory needs the workspace root.");
  const relative = pathApi.relative(root, cwd);
  const folder = relative && !relative.startsWith("..") && !pathApi.isAbsolute(relative) ? relative : "";
  return [
    "Working directory (resolved by Sandbench; it is the current directory of your tools, shell commands and relative paths):",
    `- Path: ${cwd}`,
    `- Workspace root: ${root}`,
    folder ? `- Configured folder: ${folder} (inside the workspace root)` : "- Configured folder: none; the working directory is the workspace root itself",
    "Use this path exactly as written, or use paths relative to it. Do not guess, shorten or retype it from memory. The folder may be empty.",
  ].join("\n");
}
