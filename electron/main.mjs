// Minimal Windows Electron shell: spawn harness, wait for health, load Vite UI.
import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readOrCreateToken, waitForHealth } from "./read-token.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PORT = Number(process.env.SANDBENCH_HARNESS_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const DEV_UI = process.env.SANDBENCH_DEV_URL || "http://127.0.0.1:5173";

let harnessChild = null;
let staticServer = null;
let harnessToken = "";

function startHarness() {
  const env = { ...process.env, SANDBENCH_HARNESS_PORT: String(PORT) };
  harnessChild = spawn("node", ["harness/server.mjs"], {
    cwd: ROOT,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  harnessChild.stderr?.on("data", (chunk) => process.stderr.write(`[harness] ${chunk}`));
  harnessChild.on("exit", (code) => {
    console.error(`[sandbench-desktop] harness exited ${code}`);
  });
}

function mimeFor(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function startStaticProxy(distDir, token) {
  return new Promise((resolve) => {
    staticServer = createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/harness")) {
        const target = `${BASE}${url.pathname.slice("/harness".length)}${url.search}`;
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const upstream = await fetch(target, {
            method: req.method,
            headers: {
              "x-sandbench-token": token,
              ...(body.length ? { "content-type": req.headers["content-type"] || "application/json" } : {}),
            },
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          const out = Buffer.from(await upstream.arrayBuffer());
          const headers = { "content-type": upstream.headers.get("content-type") || "application/octet-stream", "cache-control": "no-store" };
          res.writeHead(upstream.status, headers);
          res.end(out);
        } catch (error) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }
      let rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.normalize(path.join(distDir, rel));
      if (!file.startsWith(distDir) || !existsSync(file) || !statSync(file).isFile()) {
        const fallback = path.join(distDir, "index.html");
        if (!existsSync(fallback)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(fallback));
        return;
      }
      res.writeHead(200, { "content-type": mimeFor(file) });
      res.end(readFileSync(file));
    });
    staticServer.listen(0, "127.0.0.1", () => resolve(staticServer.address().port));
  });
}

async function createWindow(uiUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Sandbench",
  });
  await win.loadURL(uiUrl);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    startHarness();
    // Harness writes a fresh token on boot; wait for the file then health.
    const tokenFile = path.join(ROOT, ".harness-token");
    const deadline = Date.now() + 20_000;
    while (!existsSync(tokenFile) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const { token } = readOrCreateToken({ projectRoot: ROOT, userData: app.getPath("userData") });
    harnessToken = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : token;
    await waitForHealth({ baseUrl: BASE, token: harnessToken });

    const dist = path.join(ROOT, "dist");
    let uiUrl = DEV_UI;
    if (existsSync(path.join(dist, "index.html")) && process.env.SANDBENCH_ELECTRON_DEV !== "1") {
      const port = await startStaticProxy(dist, harnessToken);
      uiUrl = `http://127.0.0.1:${port}/`;
    } else {
      process.env.SANDBENCH_ELECTRON_DEV = "1";
    }
    await createWindow(uiUrl);
  });

  app.on("window-all-closed", () => {
    if (harnessChild && !harnessChild.killed) harnessChild.kill();
    staticServer?.close();
    app.quit();
  });
}
