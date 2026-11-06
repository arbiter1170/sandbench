// Agent turns: starts a driver, fans its events out to /events subscribers, and holds
// each permission request until the page answers it.
import { reviewPermission } from "./autoReview.mjs";
import { randomBytes } from "node:crypto";
import { driverById } from "./drivers/index.mjs";
import { describeWorkingDirectory } from "./workingDirectory.mjs";

const BUFFER = 500;
const PERMISSION_TIMEOUT_MS = 30 * 60_000;

// The page names which stored key a turn should use; the value is looked up here (SB-05).
const TURN_SECRETS = new Set(["XAI_API_KEY", "ANTHROPIC_API_KEY", "COMPAT_API_KEY"]);

// `workspaceRoot` (the local harness passes it) turns on the working-directory block at the end
// of every turn's system text and the `cwd` field on `turn_start`. Without it (the runner) the
// prompt and the events are exactly what they were.
export function createTurns({ runShell, resolveFolder, captureScreen, secrets, workspaceRoot }) {
  const events = [];
  const subscribers = new Set();
  const turns = new Map();
  const permissions = new Map();
  let seq = 0;
  // For each turn, the newest of its events that fell out of the replay buffer, and the turns
  // that ended. A page resuming from before an evicted event is told there is a gap instead of
  // silently missing it, and a finished turn stays "finished" after its last event is evicted.
  const evicted = new Map();
  const ended = new Set();
  const remember = (collection, add) => {
    add();
    if (collection.size > 1000) collection.delete(collection.keys().next().value);
  };

  function publish(turnId, event) {
    const entry = { ...event, turnId, seq: ++seq, at: Date.now() };
    events.push(entry);
    if (events.length > BUFFER) {
      for (const old of events.splice(0, events.length - BUFFER)) remember(evicted, () => evicted.set(old.turnId, old.seq));
    }
    if (event.type === "done" || event.type === "error") remember(ended, () => ended.add(turnId));
    for (const sub of subscribers) {
      if (!sub.turn || sub.turn === turnId) sub.write(entry);
    }
    return entry;
  }

  // `ctx` comes from the server (the runner's agent slug, SB-09), never from the request body.
  function start(body, ctx = {}) {
    const driver = driverById(body.driver);
    if (!driver) throw new Error("Unknown driver.");
    if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new Error("No prompt.");
    const cwd = resolveFolder(body.folder, ctx);
    if (!cwd) throw new Error("The working folder must stay inside the workspace folder.");
    const id = randomBytes(8).toString("hex");
    const after = seq;
    const controller = new AbortController();
    const rules = Array.isArray(body.allow) ? body.allow.filter((item) => typeof item === "string") : [];
    const ran = new Set();
    const granted = new Set();
    // The block goes after the page's text is cut to size, so a long system prompt can't trim it.
    const where = workspaceRoot ? describeWorkingDirectory({ cwd, root: workspaceRoot }) : "";
    const pageSystem = typeof body.system === "string" ? body.system.slice(0, 40_000) : "";
    const turn = {
      id,
      prompt: body.prompt.slice(0, 20_000),
      system: where ? [pageSystem, where].filter(Boolean).join("\n\n") : pageSystem,
      history: (Array.isArray(body.history) ? body.history : [])
        .filter((item) => (item?.role === "user" || item?.role === "assistant") && typeof item.content === "string")
        .slice(-20)
        .map((item) => ({ role: item.role, content: item.content.slice(0, 8000) })),
      model: typeof body.model === "string" ? body.model.slice(0, 120) : "",
      base: typeof body.base === "string" ? body.base : "",
      key: TURN_SECRETS.has(body.secret) ? (secrets?.get(body.secret) ?? "") : "",
      cwd,
      // Driver extras (claude.mjs) are set by the engine in later items, never from the request.
      extras: {},
    };
    // Only the local harness passes `ctx.connectors`: the bot's own synced servers, never the request's.
    const mcp = driver.id === "claude" && ctx.connectors ? ctx.connectors.attach({ turnId: id, botId: body.botId }) : null;
    if (mcp?.file) turn.extras = { mcpConfig: mcp.file };
    const io = {
      signal: controller.signal,
      emit: (event) => {
        if (event.type === "tool_end") ran.add(event.permissionId);
        return publish(id, event);
      },
      requestPermission: ({ command, reason, tool }) => {
        const permissionId = randomBytes(8).toString("hex");
        if (reviewPermission({ command, tool }, rules).auto) {
          publish(id, { type: "permission_request", permissionId, command, reason, tool, auto: true });
          granted.add(permissionId);
          io.current = permissionId;
          return Promise.resolve(true);
        }
        if (body.unattendedDeny) {
          publish(id, { type: "permission_request", permissionId, command, reason, tool, auto: false, denied: true });
          return Promise.resolve(false);
        }
        publish(id, { type: "permission_request", permissionId, command, reason, tool, auto: false });
        return new Promise((resolve) => {
          const timer = setTimeout(() => finish(false), PERMISSION_TIMEOUT_MS);
          const finish = (allow) => {
            clearTimeout(timer);
            permissions.delete(permissionId);
            controller.signal.removeEventListener("abort", cancel);
            if (allow) {
              granted.add(permissionId);
              io.current = permissionId;
            }
            publish(id, { type: "permission_resolved", permissionId, allow });
            resolve(allow);
          };
          const cancel = () => finish(false);
          controller.signal.addEventListener("abort", cancel, { once: true });
          permissions.set(permissionId, { turnId: id, finish });
        });
      },
      runCommand: async (command) => {
        const permissionId = io.current;
        publish(id, { type: "tool_start", permissionId, command });
        console.log(`[agent ${driver.id}] ${command}`);
        const result = await runShell(command, { cwd });
        ran.add(permissionId);
        let screenThumb;
        if (body.captureScreen === true && result.code === 0 && typeof captureScreen === "function") {
          try {
            const jpeg = await captureScreen();
            if (jpeg?.length && jpeg.length < 200_000) screenThumb = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
          } catch {
            // optional
          }
        }
        publish(id, {
          type: "tool_end",
          permissionId,
          code: result.code,
          output: [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 16_000),
          ms: result.ms,
          ...(screenThumb ? { screenThumb } : {}),
        });
        return result;
      },
      current: "",
    };
    publish(id, { type: "turn_start", driver: driver.id, ...(where ? { cwd } : {}) });
    let handle;
    try {
      handle = driver.startTurn(turn, io);
    } catch (error) {
      // The turn never started, so its done promise will never remove the connector file.
      mcp?.release();
      throw error;
    }
    turns.set(id, { controller, handle });
    if (mcp?.servers.length) {
      publish(id, { type: "thinking", text: `Connectors for this turn: ${mcp.servers.map((item) => item.connector).join(", ")}. Each tool asks for approval.` });
    }
    for (const item of mcp?.skipped ?? []) publish(id, { type: "thinking", text: `Connector ${item.name} left out: ${item.reason}` });
    handle.done
      .then(() => {
        for (const permissionId of granted) {
          if (!ran.has(permissionId)) publish(id, { type: "tool_end", permissionId, output: "The agent ran this step itself; its result is in the reply." });
        }
        publish(id, { type: "done" });
      })
      .catch((error) => {
        const aborted = controller.signal.aborted || error?.name === "AbortError";
        publish(id, aborted ? { type: "done", stopped: true } : { type: "error", message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        turns.delete(id);
        mcp?.release();
      });
    return { id, after };
  }

  function interrupt(id) {
    const turn = turns.get(id);
    if (!turn) return false;
    turn.controller.abort();
    turn.handle.interrupt();
    return true;
  }

  // "running" while the driver works, "finished" once it ended (the last 1000 turns), "unknown"
  // otherwise (a restarted harness, or a turn long gone). The page uses it to tell a dropped
  // event stream it can resume from a turn that is gone.
  function state(id) {
    if (turns.has(id)) return "running";
    return ended.has(id) ? "finished" : "unknown";
  }

  function permit(permissionId, allow) {
    const pending = permissions.get(permissionId);
    if (!pending) return false;
    pending.finish(allow === true);
    return true;
  }

  function subscribe(req, res, url) {
    const after = Number(url.searchParams.get("after") || 0);
    const turn = url.searchParams.get("turn") || "";
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const sub = { turn, write: (entry) => res.write(`id: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`) };
    // Some of this turn's events after `after` are no longer in the buffer: say so first.
    if (turn && (evicted.get(turn) ?? 0) > after) res.write(`data: ${JSON.stringify({ type: "gap", turnId: turn })}\n\n`);
    for (const entry of events) {
      if (entry.seq > after && (!turn || entry.turnId === turn)) sub.write(entry);
    }
    subscribers.add(sub);
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(beat);
      subscribers.delete(sub);
    });
  }

  return { start, interrupt, permit, subscribe, state };
}
