// Sandbench runner API. The local harness (harness/server.mjs) binds 127.0.0.1 and trusts
// the Vite proxy's token; the runner is reachable through Cloudflare, so every /api call
// is checked against a Firebase ID token and the server-side allowlist (auth.mjs).
//
// Ported from the harness: health, drivers, turns, permissions, events, workspace read and
// write, exec. Desktop-only routes (/screen, /input, /processes, /tts) stay in the harness.
// Skills, memory, schedules, triggers and MCP move here in their own SB items.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { listDrivers } from "../../harness/drivers/index.mjs";
import { proxyModel } from "../../harness/modelProxy.mjs";
import { createSecretStore } from "../../harness/secrets.mjs";
import { createTurns } from "../../harness/turns.mjs";
import { createShell } from "../shell.mjs";
import { resolveWorkspacePath, workspaceRoots } from "../workspace/index.mjs";
import { createAuth } from "./auth.mjs";
import { createDataRoutes } from "./data.mjs";
import { createMemoryRoutes } from "./memory.mjs";
import { buildSystemPrompt } from "../agent/prompt.mjs";
import { createSkills } from "../agent/skills.mjs";
import { readJson, send } from "./http.mjs";
import { createStatic } from "./static.mjs";

// Browsers send these on the page's calls; nothing else is allowed cross-origin.
const CORS_HEADERS = "authorization, content-type, x-sandbench-client";
const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export function createRunner({ home, uiDir, allowedEmails, verifyIdToken, publicOrigin = "", allowedOrigins = [], store = null, memory = null, teamDir = "", secretsFile, env = process.env }) {
  // The runner's own address plus any page hosted elsewhere (e.g. the Vercel site).
  // Exact matches only: no wildcards, no credentials or cookies (the ID token is a header).
  const origins = new Set([publicOrigin, ...allowedOrigins].map((item) => String(item || "").trim().replace(/\/$/, "")).filter(Boolean));
  // SB-09: shared/, agents/<slug>/ and wt/ sit next to the page's own workspace/ folder.
  const roots = workspaceRoots(home);
  for (const folder of Object.values(roots)) mkdirSync(folder, { recursive: true });
  const workspace = roots.legacy;
  // Page calls are the owner context (no agent). A refused path keeps today's 400 answers.
  const resolve = (relative, write, agentSlug = null) => {
    try {
      return resolveWorkspacePath(roots, agentSlug, relative, { write });
    } catch {
      return null;
    }
  };
  const runShell = createShell(workspace);
  const authenticate = createAuth({ verifyIdToken, allowedEmails });
  const serveStatic = createStatic(uiDir);
  // Keys come from the runner's environment or its secrets file, never from the page (SB-05).
  const secrets = createSecretStore({ file: secretsFile ?? path.join(home, "secrets.json"), env });
  const turns = createTurns({
    runShell,
    secrets,
    resolveFolder: (folder, ctx = {}) => {
      const agentSlug = ctx.agentSlug ?? null;
      const own = agentSlug ? path.join(roots.agents, agentSlug) : workspace;
      const cwd = folder ? resolve(folder, true, agentSlug) : own;
      if (cwd) mkdirSync(cwd, { recursive: true });
      return cwd;
    },
  });

  // SB-02 records; without DATABASE_URL the runner still works, minus these routes.
  const dataRoute = store ? createDataRoutes(store) : null;
  // SB-08 memory and prompts need the database; skills (SANDBENCH_TEAM_DIR) work without it.
  const skills = createSkills({ dir: teamDir });
  const memoryRoute = createMemoryRoutes({
    memory,
    skills,
    // A missing agent is the store's 404.
    buildPrompt: async (owner, agentId) => buildSystemPrompt({ owner, agent: await store.get(owner, "agents", agentId), memory, skills, teamDir }),
  });

  async function api(req, res, url, user) {
    const route = url.pathname.slice("/api".length) || "/";
    if (/^\/(data|changes|stream)(\/|$)/.test(route)) {
      if (!dataRoute) return send(res, 503, { error: "This runner has no database (set DATABASE_URL)." });
      if (await dataRoute(req, res, route, url, user)) return;
    }
    if (/^\/(memory|skills|prompt)(\/|$)/.test(route)) {
      if (!route.startsWith("/skills") && (!store || !memory)) return send(res, 503, { error: "This runner has no database (set DATABASE_URL)." });
      if (await memoryRoute(req, res, route, url, user)) return;
    }
    if (req.method === "GET" && route === "/health") {
      return send(res, 200, { ok: true, platform: process.platform, host: os.hostname(), workspace, user: user.email });
    }
    if (req.method === "GET" && route === "/secrets") {
      return send(res, 200, { secrets: secrets.list() });
    }
    const secretRoute = /^\/secrets\/([A-Z][A-Z0-9_]{1,63})$/.exec(route);
    if (req.method === "PUT" && secretRoute) {
      const body = await readJson(req);
      try {
        const saved = secrets.set(secretRoute[1], body.value, body.scope || "shared");
        console.log(`[secret] ${user.email} set ${saved.name} (${saved.scope})`);
        return send(res, 200, saved);
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (req.method === "DELETE" && secretRoute) {
      try {
        console.log(`[secret] ${user.email} remove ${secretRoute[1]}`);
        return send(res, 200, { ok: secrets.remove(secretRoute[1]) });
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (req.method === "POST" && route === "/model") {
      const body = await readJson(req, 2 * 1024 * 1024);
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      // No localhost bases on the VM: the runner must not become a door into its own network.
      return await proxyModel(body, res, { store: secrets, allowLocal: false, signal: controller.signal });
    }
    if (req.method === "GET" && route === "/drivers") {
      return send(res, 200, { drivers: await listDrivers() });
    }
    if (req.method === "POST" && route === "/turns") {
      // SB-03 passes the slug from the job, never from the request body.
      return send(res, 200, turns.start(await readJson(req), { agentSlug: null }));
    }
    const interrupt = /^\/turns\/([a-f0-9]{16})\/interrupt$/.exec(route);
    if (req.method === "POST" && interrupt) {
      return send(res, 200, { ok: turns.interrupt(interrupt[1]) });
    }
    const permission = /^\/permissions\/([a-f0-9]{16})$/.exec(route);
    if (req.method === "POST" && permission) {
      const body = await readJson(req);
      const ok = turns.permit(permission[1], body.allow === true);
      return send(res, ok ? 200 : 404, ok ? { ok } : { error: "That request is no longer waiting." });
    }
    if (req.method === "GET" && route === "/events") {
      return turns.subscribe(req, res, url);
    }
    if (req.method === "GET" && route === "/workspace/read") {
      const target = resolve(url.searchParams.get("path"), false);
      if (!target) return send(res, 400, { error: "The path must stay inside the workspace folder." });
      if (!existsSync(target)) return send(res, 200, { exists: false, content: "" });
      return send(res, 200, { exists: true, content: readFileSync(target, "utf8").slice(0, 64 * 1024) });
    }
    if (req.method === "POST" && route === "/workspace/write") {
      const body = await readJson(req);
      if (body.approved !== true) return send(res, 403, { error: "File change was not approved." });
      const target = resolve(body.path, true);
      if (!target) return send(res, 400, { error: "The path must stay inside the workspace folder." });
      if (body.op === "delete") {
        if (!existsSync(target)) return send(res, 404, { error: "That file does not exist." });
        unlinkSync(target);
        console.log(`[file] ${user.email} delete ${body.path}`);
        return send(res, 200, { ok: true, path: path.relative(workspace, target), bytes: 0 });
      }
      if (typeof body.content !== "string") return send(res, 400, { error: "No file content." });
      if (Buffer.byteLength(body.content, "utf8") > 256 * 1024 - 4096) return send(res, 400, { error: "Files are limited to about 250 KB." });
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body.content, "utf8");
      console.log(`[file] ${user.email} write ${body.path}`);
      return send(res, 200, { ok: true, path: path.relative(workspace, target), bytes: Buffer.byteLength(body.content, "utf8") });
    }
    if (req.method === "POST" && route === "/exec") {
      const body = await readJson(req);
      if (typeof body.command !== "string" || !body.command.trim()) return send(res, 400, { error: "No command." });
      if (body.approved !== true) return send(res, 403, { error: "Command was not approved." });
      const cwd = body.folder ? resolve(body.folder, true) : workspace;
      if (!cwd) return send(res, 400, { error: "The working folder must stay inside the workspace folder." });
      mkdirSync(cwd, { recursive: true });
      console.log(`[exec] ${user.email} ${body.folder ? `(${body.folder}) ` : ""}${body.command}`);
      return send(res, 200, await runShell(body.command, { cwd }));
    }
    return send(res, 404, { error: "Not found." });
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://runner.local");
    try {
      // Liveness for Docker only; says nothing about the host or the user.
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        // Only listed origins may call the API from a browser. With no list, any Origin is
        // refused, so a stray page can never use a visitor's token against this runner.
        const origin = req.headers.origin;
        if (origin) {
          if (!origins.has(origin)) return send(res, 403, { error: "Cross-site requests are refused." });
          res.setHeader("access-control-allow-origin", origin);
          res.setHeader("vary", "Origin");
        }
        if (req.method === "OPTIONS") {
          if (!origin) return send(res, 403, { error: "Cross-site requests are refused." });
          res.writeHead(204, {
            "access-control-allow-methods": CORS_METHODS,
            "access-control-allow-headers": CORS_HEADERS,
            "access-control-max-age": "600",
            "cache-control": "no-store",
          });
          return res.end();
        }
        const auth = await authenticate(req);
        if (!auth.user) return send(res, auth.status, { error: auth.error });
        return await api(req, res, url, auth.user);
      }
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, url);
      return send(res, 404, { error: "Not found." });
    } catch (error) {
      if (res.headersSent) return res.end();
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
