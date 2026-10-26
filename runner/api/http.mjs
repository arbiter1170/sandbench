// Small helpers shared by the runner routes.
export function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

export async function readJson(req, limit = 256 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
