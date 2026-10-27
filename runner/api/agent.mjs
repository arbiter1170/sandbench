// Agent routes (SB-08), behind the runner's sign-in check; memory is scoped to the signed-in
// user's uid. The agent is named in the path because these calls come from the page; the
// tools in SB-10 will take it from the agent's own session instead.
//   GET  /api/memory/:agent[?q=&kind=&limit=]   search (with q) or newest first
//   POST /api/memory/:agent          { kind, text }          -> 201
//   POST /api/memory/:agent/import   { files: [{ path, content }] }  harness file memory, idempotent
//   GET  /api/skills                 skills index (name, title, description)
//   GET  /api/skills/:name           one skill, read fresh
//   GET  /api/agents/:id/prompt      the system prompt a turn would get now
import { StoreError } from "../db/store.mjs";
import { importMemoryFiles } from "../agent/memory-import.mjs";
import { readJson, send } from "./http.mjs";

export function createAgentRoutes({ memory, skills, prompts }) {
  /** Returns true when it handled the request. */
  return async function agentRoute(req, res, route, url, user) {
    const owner = user.uid;
    try {
      if (req.method === "GET" && route === "/skills") {
        return send(res, 200, { skills: skills.listSkills() }), true;
      }
      const skill = /^\/skills\/([^/]+)$/.exec(route);
      if (req.method === "GET" && skill) {
        try {
          return send(res, 200, skills.loadSkill(decodeURIComponent(skill[1]))), true;
        } catch {
          return send(res, 404, { error: "No such skill." }), true;
        }
      }
      const prompt = /^\/agents\/([^/]+)\/prompt$/.exec(route);
      const mem = /^\/memory\/([^/]+)(\/import)?$/.exec(route);
      if (!prompt && !mem) return false;
      if (!memory) return send(res, 503, { error: "This runner has no database (set DATABASE_URL)." }), true;
      if (req.method === "GET" && prompt) {
        return send(res, 200, await prompts.promptFor(owner, prompt[1])), true;
      }
      if (!mem) return false;
      const agentId = mem[1];
      if (mem[2] && req.method === "POST") {
        const body = await readJson(req, 4 * 1024 * 1024);
        return send(res, 200, await importMemoryFiles(memory, { owner, agentId, files: body.files })), true;
      }
      if (mem[2]) return false;
      if (req.method === "GET") {
        const query = url.searchParams.get("q");
        const kind = url.searchParams.get("kind") || undefined;
        const limit = url.searchParams.get("limit") || undefined;
        const items = query ? await memory.memorySearch({ owner, agentId, query, kind, limit }) : await memory.memoryList({ owner, agentId, kind, limit });
        return send(res, 200, { items }), true;
      }
      if (req.method === "POST") {
        const body = await readJson(req, 64 * 1024);
        const result = await memory.memorySave({ owner, agentId, kind: body.kind, text: body.text });
        return send(res, 201, result.item), true;
      }
      return false;
    } catch (error) {
      if (error instanceof StoreError || error?.status) return send(res, error.status, { error: error.message }), true;
      throw error;
    }
  };
}
