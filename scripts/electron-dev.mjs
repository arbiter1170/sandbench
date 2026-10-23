process.env.SANDBENCH_ELECTRON_DEV = "1";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("npx", ["electron", "."], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
