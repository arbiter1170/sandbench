// Test fixture: a route reachable at /api/ping behind sign-in.
export default {
  name: "ping",
  prefix: "/ping",
  create: (deps) => async (req, res, route, url, user) => {
    if (req.method !== "GET" || route !== "/ping") return false;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ pong: true, owner: user.uid, hasDeps: ["store", "memory", "skills", "secrets", "env", "home"].every((key) => key in deps) }));
    return true;
  },
};
