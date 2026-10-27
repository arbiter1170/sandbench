// Firebase emulators for tests (SB-13). Only `demo-*` projects, which never reach a real Firebase
// project, and never one of the guarded ids (runner/guard.mjs). `--project` is always passed. The
// ports default to the game repo's firebase.json (auth 9099, firestore 8180, database 9000); there
// is no game repo clone here, so they are parameters. Not exposed yet: the tools are SB-10.
import { spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isBlockedProject } from "../guard.mjs";

const DEMO = /^demo-[a-z0-9-]{1,40}$/;

export function checkEmulatorProject(project, extraBlocked = process.env.SANDBENCH_BLOCKED_PROJECTS) {
  if (typeof project !== "string" || !project.startsWith("demo-") || !DEMO.test(project)) {
    throw new Error("The emulators only run demo-* projects.");
  }
  if (isBlockedProject(project, extraBlocked)) throw new Error("That project is off-limits.");
  return project;
}

/** Returns a handle for emulatorStop. `spawn` is injectable so tests need neither Java nor firebase-tools. */
export function emulatorStart({ project, ports = { auth: 9099, firestore: 8180, database: 9000 }, spawn = nodeSpawn, cwd = os.tmpdir(), extraBlocked } = {}) {
  checkEmulatorProject(project, extraBlocked);
  for (const port of [ports.auth, ports.firestore, ports.database]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Emulator ports are whole numbers from 1024 to 65535.");
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "sb-emulator-"));
  const config = path.join(dir, "firebase.json");
  writeFileSync(
    config,
    JSON.stringify({ emulators: { auth: { port: ports.auth }, firestore: { port: ports.firestore }, database: { port: ports.database }, ui: { enabled: false } } }, null, 2),
    { mode: 0o600 },
  );
  const child = spawn("firebase", ["emulators:start", "--only", "auth,firestore,database", "--project", project, "--config", config], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return { project, ports, config, child, dir };
}

export function emulatorStop(handle) {
  if (!handle) return false;
  try {
    if (handle.child && !handle.child.killed) handle.child.kill("SIGINT");
  } finally {
    rmSync(handle.dir, { recursive: true, force: true });
  }
  return true;
}
