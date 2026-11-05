// Jobs API (SB-03 PR 2), a route module for the SB-03 PR 1 registry. Owner-scoped, behind the
// runner's sign-in like every /api route. `deps.engine` is the turn engine; runner/main.mjs adds it
// to the registry deps when there is a database. Without it every route answers 503.
//
//   POST /api/jobs                       start a turn: a turn request (runner/contracts/turn.mjs)
//                                        -> 201 { jobId, messageId, replyId }; 400 bad body,
//                                        404 unknown agent, 409 "paused"
//   GET  /api/jobs/:id                   the job row (no key is ever in it)
//   GET  /api/jobs/:id/events?after=<seq> SSE: catch-up from `after`, then live; closes after the
//                                        terminal event (done / error)
//   POST /api/jobs/:id/interrupt         stop a running turn or drop a queued one -> { ok, status }
//
// The path is /api/jobs (not /api/turns): /turns is a built-in path the registry reserves for the
// page's owner-context turn route in server.mjs.
import { StoreError } from "../../db/store.mjs";
import { readJson, send } from "../http.mjs";

const JOB = /^\/jobs\/([A-Za-z0-9_-]{1,80})$/;
const EVENTS = /^\/jobs\/([A-Za-z0-9_-]{1,80})\/events$/;
const INTERRUPT = /^\/jobs\/([A-Za-z0-9_-]{1,80})\/interrupt$/;
const KEEP_ALIVE_MS = 15_000;
const TERMINAL = new Set(["done", "error"]);

/** One SSE frame. `turnId` mirrors `jobId` so the page's AgentEvent shape fits as it is. */
export function frame(event) {
  const body = { seq: event.seq, turnId: event.jobId, jobId: event.jobId, type: event.type, at: event.at, ...event.data };
  return `id: ${event.seq}\ndata: ${JSON.stringify(body)}\n\n`;
}

function status(error) {
  if (error instanceof StoreError) return error.status;
  if (typeof error?.status === "number") return error.status;
  return 500;
}

export default {
  name: "jobs",
  prefix: "/jobs",
  create: ({ engine = null }) => {
    return async (req, res, route, url, user) => {
      if (!engine) {
        send(res, 503, { error: "This runner has no job engine (set DATABASE_URL)." });
        return true;
      }
      const owner = user.uid;

      if (req.method === "POST" && route === "/jobs") {
        let body;
        try {
          body = await readJson(req, 64 * 1024);
        } catch (error) {
          send(res, 400, { error: error.message });
          return true;
        }
        try {
          const started = await engine.startTurn({ owner, request: body });
          send(res, 201, started);
        } catch (error) {
          const code = status(error);
          send(res, code === 500 ? 500 : code, { error: code === 500 ? "The turn could not be started." : error.message });
          if (code === 500) console.error("[jobs] start:", engine.redact(String(error?.stack ?? error)));
        }
        return true;
      }

      const one = JOB.exec(route);
      if (req.method === "GET" && one) {
        const job = await engine.getJob(owner, one[1]);
        if (!job) send(res, 404, { error: "No such job." });
        else send(res, 200, { job });
        return true;
      }

      const interrupt = INTERRUPT.exec(route);
      if (req.method === "POST" && interrupt) {
        const result = await engine.interrupt(owner, interrupt[1]);
        if (result.status === null) send(res, 404, { error: "No such job." });
        else send(res, 200, result);
        return true;
      }

      const events = EVENTS.exec(route);
      if (req.method === "GET" && events) {
        const jobId = events[1];
        const job = await engine.getJob(owner, jobId);
        if (!job) {
          send(res, 404, { error: "No such job." });
          return true;
        }
        const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        let last = after;
        let closed = false;
        const finish = () => {
          if (closed) return;
          closed = true;
          clearInterval(beat);
          engine.emitter.off("event", onLive);
          res.end();
        };
        const write = (event) => {
          if (closed || event.seq <= last) return;
          last = event.seq;
          res.write(frame(event));
          if (TERMINAL.has(event.type)) finish();
        };
        // Subscribe first, then catch up, so nothing slips between the two; `last` dedupes.
        const pending = [];
        let caughtUp = false;
        const onLive = (event) => {
          if (event.jobId !== jobId) return;
          if (caughtUp) write(event);
          else pending.push(event);
        };
        engine.emitter.on("event", onLive);
        const beat = setInterval(() => {
          if (!closed) res.write(": keep-alive\n\n");
        }, KEEP_ALIVE_MS);
        req.on("close", finish);
        try {
          for (const event of await engine.events.list(jobId, after)) write(event);
          caughtUp = true;
          for (const event of pending.sort((a, b) => a.seq - b.seq)) write(event);
          // A finished job whose terminal event is already behind `after`: nothing more will come.
          if (!closed && ["done", "failed", "cancelled"].includes(job.status)) {
            const fresh = await engine.getJob(owner, jobId);
            if (fresh && ["done", "failed", "cancelled"].includes(fresh.status)) {
              const tail = await engine.events.list(jobId, last);
              for (const event of tail) write(event);
              if (!closed) finish();
            }
          }
        } catch (error) {
          console.error("[jobs] events:", engine.redact(String(error?.message ?? error)));
          finish();
        }
        return true;
      }

      return false;
    };
  },
};
