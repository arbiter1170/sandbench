// Approval cards API (SB-03 PR 2): the owner's answer to a card the engine is waiting on. The
// rows are in `approvals` (003_jobs.sql) and outlive a restart. Owner-scoped, behind sign-in.
// SB-06 adds the red gate here (the decision id, the signed-in-account check, 403 for agent
// tokens) and the policy that decides a card's class; today every card is yellow and the owner's.
//
//   GET  /api/approvals?status=pending   this account's cards (pending by default)
//   POST /api/approvals/:id  { allow }   decide one -> 200 { ok: true, status };
//                                        409 when it is no longer pending; 404 when it isn't yours
import { readJson, send } from "../http.mjs";

const ONE = /^\/approvals\/([A-Za-z0-9_-]{1,80})$/;
const STATUSES = new Set(["pending", "approved", "denied", "expired"]);

export default {
  name: "approvals",
  prefix: "/approvals",
  create: ({ engine = null }) => {
    return async (req, res, route, url, user) => {
      if (!engine) {
        send(res, 503, { error: "This runner has no job engine (set DATABASE_URL)." });
        return true;
      }
      const owner = user.uid;
      if (req.method === "GET" && route === "/approvals") {
        const wanted = url.searchParams.get("status") ?? "pending";
        if (!STATUSES.has(wanted)) {
          send(res, 400, { error: "status is pending, approved, denied or expired." });
          return true;
        }
        send(res, 200, { approvals: await engine.approvals.list(owner, { status: wanted }) });
        return true;
      }
      const one = ONE.exec(route);
      if (req.method === "GET" && one) {
        const card = await engine.approvals.get(owner, one[1]);
        if (!card) send(res, 404, { error: "No such approval." });
        else send(res, 200, { approval: card });
        return true;
      }
      if (req.method === "POST" && one) {
        let body;
        try {
          body = await readJson(req, 16 * 1024);
        } catch (error) {
          send(res, 400, { error: error.message });
          return true;
        }
        if (typeof body.allow !== "boolean") {
          send(res, 400, { error: "Send { allow: true } or { allow: false }." });
          return true;
        }
        const result = await engine.approvals.decide({ owner, id: one[1], allow: body.allow, decidedBy: user.email ?? owner });
        if (result.ok) send(res, 200, { ok: true, status: result.status });
        else if (result.status === null) send(res, 404, { error: "No such approval." });
        else send(res, 409, { error: `That card is already ${result.status}.`, status: result.status });
        return true;
      }
      return false;
    };
  },
};
