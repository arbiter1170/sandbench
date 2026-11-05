// Data routes (SB-02), all behind the runner's sign-in check; rows are scoped to the
// signed-in user's uid.
//   GET    /api/data/:kind[?thread=&since=&limit=&after=]   list (messages: one thread, oldest
//          first); with after= the list is in id order and pages by id
//   GET    /api/data/:kind/:id
//   POST   /api/data/:kind          { id, data, threadId? }   -> 201, version 1
//   PATCH  /api/data/:kind/:id      { version, data }          -> merged fields, version + 1
//   DELETE /api/data/:kind/:id?version=n                       -> tombstone
//   GET    /api/changes?since=seq                              -> JSON catch-up
//   GET    /api/changes/head                                   -> { seq } newest for this user
//   GET    /api/stream?since=seq                               -> SSE change feed
// A stale version gets 409 with { current }, so the page reloads that one row.
import { StoreError } from "../db/store.mjs";
import { readJson, send } from "./http.mjs";

const HEARTBEAT_MS = 15_000;
const MAX_STREAMS_PER_USER = 8;

function fail(res, error) {
  if (error instanceof StoreError) return send(res, error.status, { error: error.message, ...(error.current ? { current: error.current } : {}) });
  throw error;
}

export function createDataRoutes(store) {
  const openStreams = new Map();

  async function stream(req, res, url, user) {
    const owner = user.uid;
    if ((openStreams.get(owner) ?? 0) >= MAX_STREAMS_PER_USER) return send(res, 429, { error: "Too many open change streams for this account." });
    let last = Number(url.searchParams.get("since") || 0);
    let busy = false;
    let again = false;
    let open = true;
    const flush = async () => {
      if (busy) return void (again = true);
      busy = true;
      try {
        do {
          again = false;
          let more = true;
          while (more && open) {
            const batch = await store.changesSince(owner, last);
            for (const change of batch.changes) res.write(`id: ${change.seq}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`);
            last = batch.last;
            more = batch.more;
          }
        } while (again && open);
      } finally {
        busy = false;
      }
    };
    // Reserve the slot and attach cleanup before any await, so a client that leaves
    // while we subscribe still frees its slot, and concurrent opens can't pass the cap.
    openStreams.set(owner, (openStreams.get(owner) ?? 0) + 1);
    let unsubscribe = null;
    let beat = null;
    let expiry = null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      open = false;
      if (beat) clearInterval(beat);
      if (expiry) clearTimeout(expiry);
      unsubscribe?.();
      const count = (openStreams.get(owner) ?? 1) - 1;
      if (count > 0) openStreams.set(owner, count);
      else openStreams.delete(owner);
    };
    // The response's close fires when the client leaves, and when the expiry ends it.
    res.on("close", release);
    try {
      // Subscribe before answering, so a LISTEN failure is a 500 rather than a dead stream.
      const off = await store.subscribe((who) => {
        if (who === owner) void flush().catch(() => res.end());
      });
      unsubscribe = off;
    } catch (error) {
      release();
      throw error;
    }
    if (released || res.destroyed) return void unsubscribe();
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    beat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
    // The stream lives no longer than the ID token that opened it; the page reconnects
    // with a fresh token and its last seq.
    expiry = user.exp ? setTimeout(() => res.end(), Math.max(0, user.exp * 1000 - Date.now())) : null;
    res.write(": ready\n\n");
    await flush();
  }

  /** Returns true when it handled the request. */
  return async function dataRoute(req, res, route, url, user) {
    const owner = user.uid;
    try {
      if (req.method === "GET" && route === "/changes/head") {
        return send(res, 200, { seq: await store.head(owner) }), true;
      }
      if (req.method === "GET" && route === "/changes") {
        return send(res, 200, await store.changesSince(owner, url.searchParams.get("since"), url.searchParams.get("limit"))), true;
      }
      if (req.method === "GET" && route === "/stream") {
        return await stream(req, res, url, user), true;
      }
      const match = /^\/data\/([a-z]+)(?:\/([^/]+))?$/.exec(route);
      if (!match) return false;
      const [, kind, id] = match;
      if (!id && req.method === "GET") {
        const list = await store.list(owner, kind, {
          threadId: url.searchParams.get("thread") || undefined,
          since: url.searchParams.get("since") || 0,
          limit: url.searchParams.get("limit") || undefined,
          after: url.searchParams.get("after") ?? undefined,
        });
        return send(res, 200, list), true;
      }
      if (!id && req.method === "POST") {
        const body = await readJson(req, 1024 * 1024);
        return send(res, 201, await store.create(owner, kind, String(body.id ?? ""), body.data, { threadId: body.threadId })), true;
      }
      if (id && req.method === "GET") return send(res, 200, await store.get(owner, kind, id)), true;
      if (id && req.method === "PATCH") {
        const body = await readJson(req, 1024 * 1024);
        return send(res, 200, await store.patch(owner, kind, id, body.version, body.data)), true;
      }
      if (id && req.method === "DELETE") {
        return send(res, 200, await store.remove(owner, kind, id, Number(url.searchParams.get("version")))), true;
      }
      return false;
    } catch (error) {
      return fail(res, error), true;
    }
  };
}
