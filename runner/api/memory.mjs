// Memory, skills and prompt routes (SB-08), behind the runner's sign-in check; owner = the
// signed-in uid, never anything in the request.
//   GET  /api/memory?agent=&q=&kind=&limit=   search with q (best first), else newest first
//   POST /api/memory   { agentId, kind, text }   -> 201
//   GET  /api/skills                            skills index [{ name, description }]
//   GET  /api/skills/:name                      one skill, read fresh
//   GET  /api/prompt/:agentId                   { prompt } a turn would get now
// server.mjs answers 503 for memory and prompt when the runner has no database.
import { StoreError } from "../db/store.mjs";
import { readJson, send } from "./http.mjs";

export function createMemoryRoutes({ memory, skills, buildPrompt }) {
  /** Returns true when it handled the request. */
  return async function memoryRoute(req, res, route, url, user) {
    const owner = user.uid;
    try {
      if (req.method === "GET" && route === "/skills") return send(res, 200, { skills: skills.index() }), true;
      const skill = /^\/skills\/([^/]+)$/.exec(route);
      if (req.method === "GET" && skill) {
        let name = "";
        try {
          name = decodeURIComponent(skill[1]);
        } catch {
          // a malformed escape is just an unknown skill
        }
        const found = skills.loadSkill(name);
        return send(res, found ? 200 : 404, found ?? { error: "No such skill." }), true;
      }
      if (req.method === "GET" && route === "/memory") {
        const agentId = url.searchParams.get("agent") ?? "";
        const query = url.searchParams.get("q");
        const kind = url.searchParams.get("kind") || undefined;
        const limit = url.searchParams.get("limit") || undefined;
        const items = query ? await memory.search({ owner, agentId, query, kind, limit }) : await memory.recent({ owner, agentId, kind, limit });
        return send(res, 200, { items }), true;
      }
      if (req.method === "POST" && route === "/memory") {
        const body = await readJson(req, 64 * 1024);
        const result = await memory.save({ owner, agentId: body.agentId, kind: body.kind, text: body.text });
        return send(res, 201, result.item), true;
      }
      const prompt = /^\/prompt\/([^/]+)$/.exec(route);
      if (req.method === "GET" && prompt) return send(res, 200, { prompt: await buildPrompt(owner, prompt[1]) }), true;
      return false;
    } catch (error) {
      if (error instanceof StoreError) return send(res, error.status, { error: error.message }), true;
      throw error;
    }
  };
}
