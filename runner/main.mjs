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
import { createSecretStore } from "../harness/secrets.mjs";
import { createSkills } from "./agent/skills.mjs";
import { createEngine } from "./worker/engine.mjs";

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

const home = env.SANDBENCH_HOME || path.join(os.homedir(), ".sandbench");
const teamDir = env.SANDBENCH_TEAM_DIR || "";
// Model keys: environment variables (XAI_API_KEY, ANTHROPIC_API_KEY, ...) or this 0600 file.
const secretsFile = env.SANDBENCH_SECRETS_FILE || undefined;

// SB-02 records and SB-08 memory live in Postgres (DATABASE_URL, set by deploy/compose.yml).
// SB-03 PR 2: so does the turn engine (jobs, approvals, the pg-boss queue in its own schema).
let store = null;
let memory = null;
let engine = null;
if (env.DATABASE_URL) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
  const applied = await migrate(sql);
  if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
  store = createStore(sql);
  memory = createMemory(sql);
  engine = createEngine({
    sql,
    connectionString: env.DATABASE_URL,
    store,
    memory,
    skills: createSkills({ dir: teamDir }),
    teamDir,
    home,
    // The same store createRunner builds: keys by name, scoped per agent, never in an event.
    secrets: createSecretStore({ file: secretsFile ?? path.join(home, "secrets.json"), env }),
    env,
    // SB-29 gate (docs/runner.md "Agent isolation", point 9): until the sandbox exists, a
    // runner-mode turn gets no shell and every tool request is denied with that reason. The
    // approval-card path is built and tested; SB-29 turns it on.
    shell: null,
    agentTools: false,
  });
}

// Route modules get the engine on top of the deps createRunner gives them.
const routes = (await loadRouteFactories()).map((factory) => ({ ...factory, create: (deps) => factory.create({ ...deps, engine }) }));

const port = Number(env.PORT || 8080);
const server = createRunner({
  home,
  uiDir: env.SANDBENCH_UI_DIR || "",
  publicOrigin: env.SANDBENCH_PUBLIC_ORIGIN || "",
  secretsFile,
  // Other pages allowed to call /api from a browser, comma-separated exact origins
  // (for a laptop runner: the Vercel production URL). No wildcards.
  allowedOrigins: String(env.SANDBENCH_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
  allowedEmails,
  verifyIdToken: await firebaseVerifier(projectId),
  store,
  memory,
  // A checkout of the private team repo: AGENTS.md and .claude/skills/*/SKILL.md (SB-08).
  teamDir,
  // SB-03 route registry: every module in runner/api/routes/ (jobs and approvals so far).
  routes,
});

server.listen(port, env.HOST || "0.0.0.0", async () => {
  console.log(`Sandbench runner on :${port} (project ${projectId}, ${allowedEmails.length} allowed account(s))`);
  if (engine) {
    // Retries turns a previous process died on (once each), expires old cards, then takes work.
    await engine.start();
    console.log(`Turn engine on: up to ${engine.limits.maxTurns} turn(s) at a time, one per agent.`);
  }
});

// A clean stop cancels running turns (the next start finds nothing to retry); a crash leaves them
// `running`, and the next start retries each one once.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    try {
      await engine?.stop();
    } finally {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    }
  });
}
