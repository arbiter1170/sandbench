// Test fixture: a RegExp prefix; returns false for anything but GET so requests fall through.
export default {
  name: "echo",
  prefix: /^\/echo\/[a-z]+$/,
  create: () => async (req, res, route) => {
    if (req.method !== "GET") return false;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ echo: route.slice("/echo/".length) }));
    return true;
  },
};
