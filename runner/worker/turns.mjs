// One agent turn on the runner (SB-03 PR 2). This is the server-side version of what the page's
// askBot/driveTurn did: load the agent record, the thread's messages, the system prompt (SB-08),
// the working folder (SB-09, by the agent's slug from the job, never from the request) and the key
// (SB-05, by name, with the agent's scope), then call driver.startTurn and turn every driver event
// into a `job_events` row. The final reply becomes a `messages` record, so a device that attaches
// later sees it through the SB-02 stream.
//
// Permission requests go through the policy check and become approval rows (runner/jobs/approvals.mjs)
// that survive a restart. The engine's own shell tool is gated until SB-29: without a `shell`
// dependency, an approved command is answered with a refusal, never run.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { buildSystemPrompt } from "../agent/prompt.mjs";
import { AGENT_SLUG, resolveWorkspacePath } from "../workspace/index.mjs";
import { StoreError } from "../db/store.mjs";
import { TURN_SECRET_NAMES } from "../contracts/turn.mjs";

// Which stored keys a turn may name (the same set the harness accepts). Values never leave the server.
export const TURN_SECRETS = new Set(TURN_SECRET_NAMES);
export const HISTORY_LIMIT = 20;
export const SHELL_GATE_MESSAGE = "Shell commands in runner-mode turns wait for agent isolation (SB-29); nothing was run.";
export const TOOLS_GATE_MESSAGE = "Tools in runner-mode turns wait for agent isolation (SB-29).";

export class TurnError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TurnError";
    this.status = status;
  }
}

/** The agent's slug for workspace paths: the profile's `slug`, or its record id when that fits. */
export function agentSlug(agent) {
  const slug = typeof agent?.data?.slug === "string" ? agent.data.slug.trim() : "";
  if (slug && AGENT_SLUG.test(slug)) return slug;
  if (typeof agent?.id === "string" && AGENT_SLUG.test(agent.id)) return agent.id;
  return null;
}

/** Thread messages before this turn, as driver history (the newest HISTORY_LIMIT, oldest first). */
export function historyFrom(records, { exclude = [] } = {}) {
  const skip = new Set(exclude.filter(Boolean));
  return records
    .filter((record) => !record.deleted && !skip.has(record.id))
    .map((record) => record.data ?? {})
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.status === "done" && typeof message.text === "string" && message.text.trim())
    .slice(-HISTORY_LIMIT)
    .map((message) => ({ role: message.role, content: message.text.slice(0, 8000) }));
}

/** Creates the reply record or patches the page's stand-in with the same id (one retry on 409). */
export async function writeReply({ store, owner, threadId, id, agentId, text, status, createdAt }) {
  const patch = { text, status };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let current = null;
    try {
      current = await store.get(owner, "messages", id);
    } catch (error) {
      if (!(error instanceof StoreError) || error.status !== 404) throw error;
    }
    try {
      if (!current) {
        return await store.create(owner, "messages", id, { id, role: "assistant", text, createdAt: createdAt ?? Date.now(), attachments: [], status, localStandIn: false, fresh: false, authorBotId: agentId, threadId }, { threadId });
      }
      if (current.deleted) return current;
      return await store.patch(owner, "messages", id, current.version, patch);
    } catch (error) {
      if (!(error instanceof StoreError) || error.status !== 409) throw error;
    }
  }
  throw new TurnError(409, "The reply record kept changing under the engine.");
}

/**
 * Runs one turn for `job` (a `jobs` row) and resolves with `{ reply, sessionId }`. Throws on a
 * driver error (the engine records it). `deps`:
 *   store, memory, skills, teamDir, roots, secrets, driverById, policy, approvals, events,
 *   shell (null until SB-29), agentTools (false: every permission request is denied with a reason),
 *   signal (the engine's abort for this job), onSession(sessionId).
 */
export async function runTurn({ job, deps }) {
  const { store, memory, skills, teamDir, roots, secrets, driverById, policy, approvals, events, shell = null, agentTools = false, signal, onSession = () => {}, onError = () => {} } = deps;
  const owner = job.owner;
  const payload = job.payload ?? {};
  // Appends are chained per job inside `events`, so a non-awaited emit keeps its place in the order.
  const emit = (type, data) => events.append(job.id, type, data).catch((error) => onError(error));

  const agent = await store.get(owner, "agents", job.agent_id);
  if (agent.data?.paused === true) throw new TurnError(409, "This agent is paused.");
  const slug = agentSlug(agent);
  if (!slug) throw new TurnError(400, "This agent has no usable slug for a workspace.");
  const driver = driverById(payload.driver);
  if (!driver) throw new TurnError(400, `Unknown driver: ${payload.driver ?? "(none)"}.`);

  // The working folder: the agent's own folder, or a path inside its areas (SB-09 rules).
  const cwd = payload.folder ? resolveWorkspacePath(roots, slug, payload.folder, { write: true }) : path.join(roots.agents, slug);
  mkdirSync(cwd, { recursive: true });

  const system = await buildSystemPrompt({ owner, agent, memory, skills, teamDir });
  const page = await store.list(owner, "messages", { threadId: payload.threadId, limit: 5000 });
  const history = historyFrom(page.items, { exclude: [payload.messageId, payload.replyId] });
  // The key is looked up by name with the agent's scope and goes only onto the in-memory turn
  // object the driver reads; it is never an argument, never an event and never logged.
  const key = TURN_SECRETS.has(payload.secret) ? (secrets?.get(payload.secret, { agent: slug }) ?? "") : "";

  const turn = {
    id: job.id,
    prompt: String(payload.text ?? "").slice(0, 20_000),
    system: system.slice(0, 40_000),
    history,
    model: typeof payload.model === "string" ? payload.model.slice(0, 120) : "",
    base: typeof payload.base === "string" ? payload.base : "",
    key,
    cwd,
    // A retried turn resumes the driver session it had, when the driver reported one.
    extras: job.attempt > 0 && job.session_id ? { resume: job.session_id } : {},
  };

  let reply = "";
  let sessionId = job.session_id ?? null;
  const io = {
    signal,
    current: "",
    emit: (event) => {
      if (!event || typeof event !== "object") return;
      if (event.type === "session") {
        if (typeof event.sessionId === "string" && /^[\w-]{8,80}$/.test(event.sessionId)) {
          sessionId = event.sessionId;
          onSession(sessionId);
        }
        return;
      }
      if (event.type === "message_delta" && typeof event.text === "string") reply += event.text;
      const { type, ...data } = event;
      void emit(type, data);
    },
    requestPermission: async ({ command, reason, tool }) => {
      const request = { command: String(command ?? "").slice(0, 4000), reason: String(reason ?? "").slice(0, 1000), ...(tool ? { tool: String(tool).slice(0, 80) } : {}) };
      if (!agentTools) {
        await emit("permission_request", { permissionId: "", ...request, auto: false, denied: true, deniedReason: TOOLS_GATE_MESSAGE });
        return false;
      }
      const verdict = policy.check({ agent, action: { kind: tool ? "tool" : "shell", ...request } });
      if (verdict.blocked) {
        await emit("permission_request", { permissionId: "", ...request, auto: false, denied: true, deniedReason: verdict.reason });
        return false;
      }
      if (verdict.needs === "none") {
        const permissionId = `auto-${Date.now().toString(16)}`;
        await emit("permission_request", { permissionId, ...request, auto: true });
        io.current = permissionId;
        return true;
      }
      const card = await approvals.create({ owner, jobId: job.id, agentId: job.agent_id, klass: verdict.class, requiredApprover: verdict.needs === "vincent" ? "vincent" : "owner", request: { ...request, policy: verdict.reason } });
      await emit("permission_request", { permissionId: card.id, ...request, auto: false, class: card.class, requiredApprover: card.required_approver });
      const status = await approvals.wait(card.id, { signal });
      const allow = status === "approved";
      await emit("permission_resolved", { permissionId: card.id, allow, status });
      if (allow) io.current = card.id;
      return allow;
    },
    runCommand: async (command) => {
      const permissionId = io.current;
      await emit("tool_start", { permissionId, command: String(command).slice(0, 4000) });
      if (!shell) {
        const result = { code: 126, stdout: "", stderr: SHELL_GATE_MESSAGE, truncated: false, ms: 0 };
        await emit("tool_end", { permissionId, code: result.code, output: result.stderr, ms: 0 });
        return result;
      }
      const result = await shell(command, { cwd });
      await emit("tool_end", { permissionId, code: result.code, output: [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 16_000), ms: result.ms });
      return result;
    },
  };

  await emit("turn_start", { driver: driver.id, agentId: job.agent_id, attempt: job.attempt, ...(turn.extras.resume ? { resumed: true } : {}) });
  const handle = driver.startTurn(turn, io);
  const stop = () => handle.interrupt?.();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await handle.done;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  return { reply, sessionId, agent };
}
