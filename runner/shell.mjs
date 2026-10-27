// Shell and workspace helpers for the runner (Linux, bash). The local harness keeps its
// own PowerShell version. Timeouts stay at 30 s until SB-04 adds detached jobs.
import { spawn } from "node:child_process";
import path from "node:path";

const MAX_OUTPUT = 64 * 1024;

export function insideRoot(root, relative) {
  if (typeof relative !== "string" || !relative.trim() || relative.length > 240) return null;
  if (path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) return null;
  const target = path.resolve(root, relative);
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return target;
}

export function createShell(defaultCwd) {
  return function runShell(command, { timeoutMs = 30_000, cwd = defaultCwd, maxOutput = MAX_OUTPUT, env } = {}) {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn("/bin/bash", ["-c", command], { cwd, env: env ? { ...process.env, ...env } : process.env });
      let stdout = "";
      let stderr = "";
      let truncated = false;
      const take = (current, chunk) => {
        if (current.length >= maxOutput) {
          truncated = true;
          return current;
        }
        return (current + chunk.toString("utf8")).slice(0, maxOutput);
      };
      child.stdout.on("data", (chunk) => (stdout = take(stdout, chunk)));
      child.stderr.on("data", (chunk) => (stderr = take(stderr, chunk)));
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, truncated, ms: Date.now() - started });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: String(error), truncated, ms: Date.now() - started });
      });
    });
  };
}
