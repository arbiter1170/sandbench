// Serves the built UI (dist/) from the same address as the API, so there is no CORS
// and one Cloudflare Access app covers both. Unknown paths fall back to index.html.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function createStatic(uiDir) {
  const root = uiDir ? path.resolve(uiDir) : null;
  return function serveStatic(req, res, url) {
    if (!root || !existsSync(path.join(root, "index.html"))) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("The UI is not built on this runner.");
    }
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const inside = path.relative(root, file);
    if (inside.startsWith("..") || path.isAbsolute(inside) || !existsSync(file) || !statSync(file).isFile()) {
      file = path.join(root, "index.html");
    }
    const ext = path.extname(file).toLowerCase();
    // Hashed assets can be cached; the page and service worker must not be.
    const cache = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": cache });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  };
}
