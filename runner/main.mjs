// Runner entry point. All settings come from the environment (deploy/.env on the VM);
// nothing secret is read from the repo or the page.
import os from "node:os";
import path from "node:path";
import { firebaseVerifier, parseAllowlist } from "./api/auth.mjs";
import { createMemory } from "./agent/memory.mjs";
import { loadRouteFactories } from "./api/routes/index.mjs";
import { createRunner } from "./api/server.mjs";
import { migrate } from "./db/migrate.mjs";
import { createStore } from "./db/store.mjs";
import { isBlockedProject } from "./guard.mjs";

const env = process.env;
const allowedEmails = parseAllowlist(env.SANDBENCH_ALLOWED_EMAILS);
const projectId = env.FIREBASE_PROJECT_ID || "";

if (allowedEmails.length === 0) throw new Error("Set SANDBENCH_ALLOWED_EMAILS; the runner refuses to start with an empty allowlist.");
if (!projectId) throw new Error("Set FIREBASE_PROJECT_ID to Sandbench's own Firebase project (or a demo-* id with the emulator).");
if (isBlockedProject(projectId, env.SANDBENCH_BLOCKED_PROJECTS)) throw new Error(`${projectId} is off-limits for Sandbench.`);

for (const origin of String(env.SANDBENCH_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)) {
  if (origin.includes("*") || !/^https:\/\/[^/]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new Error(`SANDBENCH_ALLOWED_ORIGINS holds exact https:// origins only (no path, no wildcard): ${origin}`);
  }
}

// SB-02 records and SB-08 memory live in Postgres (DATABASE_URL, set by deploy/compose.yml).
let store = null;
let memory = null;
if (env.DATABASE_URL) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
  const applied = await migrate(sql);
  if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
  store = createStore(sql);
  memory = createMemory(sql);
}

const port = Number(env.PORT || 8080);
const server = createRunner({
  home: env.SANDBENCH_HOME || path.join(os.homedir(), ".sandbench"),
  uiDir: env.SANDBENCH_UI_DIR || "",
  publicOrigin: env.SANDBENCH_PUBLIC_ORIGIN || "",
  // Model keys: environment variables (XAI_API_KEY, ANTHROPIC_API_KEY, ...) or this 0600 file.
  secretsFile: env.SANDBENCH_SECRETS_FILE || undefined,
  // Other pages allowed to call /api from a browser, comma-separated exact origins
  // (for a laptop runner: the Vercel production URL). No wildcards.
  allowedOrigins: String(env.SANDBENCH_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
  allowedEmails,
  verifyIdToken: await firebaseVerifier(projectId),
  store,
  memory,
  // A checkout of the private team repo: AGENTS.md and .claude/skills/*/SKILL.md (SB-08).
  teamDir: env.SANDBENCH_TEAM_DIR || "",
  // SB-03 route registry: every module in runner/api/routes/ (none yet).
  routes: await loadRouteFactories(),
});

server.listen(port, env.HOST || "0.0.0.0", () => {
  console.log(`Sandbench runner on :${port} (project ${projectId}, ${allowedEmails.length} allowed account(s))`);
});
