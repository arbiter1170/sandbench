// Runner entry point. All settings come from the environment (deploy/.env on the VM);
// nothing secret is read from the repo or the page.
import os from "node:os";
import path from "node:path";
import { firebaseVerifier, parseAllowlist } from "./api/auth.mjs";
import { createRunner } from "./api/server.mjs";

const env = process.env;
const allowedEmails = parseAllowlist(env.SANDBENCH_ALLOWED_EMAILS);
const projectId = env.FIREBASE_PROJECT_ID || "";

if (allowedEmails.length === 0) throw new Error("Set SANDBENCH_ALLOWED_EMAILS; the runner refuses to start with an empty allowlist.");
if (!projectId) throw new Error("Set FIREBASE_PROJECT_ID to Sandbench's own Firebase project (or a demo-* id with the emulator).");
const BLOCKED_PROJECTS = ["haven-57041", "ourtime-529bd", "studio-6245027179-b7f2d", "walklings-4cc89"];
if (BLOCKED_PROJECTS.includes(projectId)) throw new Error(`${projectId} is off-limits for Sandbench.`);

const port = Number(env.PORT || 8080);
const server = createRunner({
  home: env.SANDBENCH_HOME || path.join(os.homedir(), ".sandbench"),
  uiDir: env.SANDBENCH_UI_DIR || "",
  publicOrigin: env.SANDBENCH_PUBLIC_ORIGIN || "",
  allowedEmails,
  verifyIdToken: await firebaseVerifier(projectId),
});

server.listen(port, env.HOST || "0.0.0.0", () => {
  console.log(`Sandbench runner on :${port} (project ${projectId}, ${allowedEmails.length} allowed account(s))`);
});
