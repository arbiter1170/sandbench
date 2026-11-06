// The shell the harness starts, by absolute path. A bare "powershell.exe" is looked up in the
// child's working folder before PATH on Windows, so a bot that writes powershell.exe into its
// turn folder would replace the shell for every later command there.
import path from "node:path";

/** Windows PowerShell 5.1, which ships with every supported Windows, under the system root. */
export function windowsPowerShell(env = process.env) {
  const root = [env.SystemRoot, env.windir].find((value) => typeof value === "string" && path.win32.isAbsolute(value) && /^[a-z]:\\/i.test(value)) ?? "C:\\Windows";
  return path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export const POSIX_SHELL = "/bin/sh";
