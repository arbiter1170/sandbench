import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRunner } from "../api/server.mjs";

const ORIGIN = "https://sandbench.example.test";
const SITE = "https://site.example.test";
let base;
let server;
let tmp;

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-runner-"));
  const ui = path.join(tmp, "dist");
  mkdirSync(path.join(ui, "assets"), { recursive: true });
  writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>Sandbench</title>");
  writeFileSync(path.join(ui, "assets", "app.js"), "console.log(1)");
  writeFileSync(path.join(tmp, "secret.txt"), "do not serve");
  server = createRunner({
    home: path.join(tmp, "home"),
    uiDir: ui,
    publicOrigin: ORIGIN,
    allowedOrigins: [SITE],
    allowedEmails: ["vincent@example.com"],
    verifyIdToken: async (token) => {
      if (token === "good") return { uid: "u1", email: "vincent@example.com", email_verified: true };
      if (token === "other") return { uid: "u2", email: "other@example.com", email_verified: true };
      throw new Error("bad token");
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});

const as = (token, init = {}) => ({ ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
const post = (token, body) => as(token, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("/healthz answers without a token and leaks nothing", async () => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("/api with no token is 401, wrong account is 403, allowed account sees the host", async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 401);
  assert.equal((await fetch(`${base}/api/health`, as("forged"))).status, 401);
  assert.equal((await fetch(`${base}/api/health`, as("other"))).status, 403);
  const ok = await fetch(`${base}/api/health`, as("good"));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.host, os.hostname());
  assert.equal(body.user, "vincent@example.com");
});

test("every /api route is behind the check, including unknown ones", async () => {
  for (const route of ["/api/drivers", "/api/events", "/api/workspace/read?path=a", "/api/nope", "/api"]) {
    assert.equal((await fetch(`${base}${route}`)).status, 401, route);
  }
  assert.equal((await fetch(`${base}/api/exec`, post(null, { command: "id", approved: true }))).status, 401);
});

test("a cross-site Origin is refused even with a good token", async () => {
  const response = await fetch(`${base}/api/health`, as("good", { headers: { origin: "https://evil.example" } }));
  assert.equal(response.status, 403);
  assert.equal((await fetch(`${base}/api/health`, as("good", { headers: { origin: ORIGIN } }))).status, 200);
});

test("exec needs approval and runs in bash inside the workspace", async () => {
  assert.equal((await fetch(`${base}/api/exec`, post("good", { command: "echo hi" }))).status, 403);
  const response = await fetch(`${base}/api/exec`, post("good", { command: "echo hi && pwd", approved: true }));
  const result = await response.json();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^hi\n.*workspace\n$/);
  assert.equal((await fetch(`${base}/api/exec`, post("good", { command: "pwd", approved: true, folder: "../.." }))).status, 400);
});

test("workspace read and write stay inside the workspace", async () => {
  const write = await fetch(`${base}/api/workspace/write`, post("good", { path: "notes/a.md", content: "hello", approved: true }));
  assert.equal(write.status, 200);
  const read = await (await fetch(`${base}/api/workspace/read?path=notes/a.md`, as("good"))).json();
  assert.deepEqual(read, { exists: true, content: "hello" });
  assert.equal((await fetch(`${base}/api/workspace/read?path=../../secret.txt`, as("good"))).status, 400);
  assert.equal((await fetch(`${base}/api/workspace/write`, post("good", { path: "/etc/x", content: "x", approved: true }))).status, 400);
});

test("the UI is served from the same address, with an index.html fallback", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Sandbench<\/title>/);
  const asset = await fetch(`${base}/assets/app.js`);
  assert.match(asset.headers.get("cache-control"), /immutable/);
  assert.match(await (await fetch(`${base}/bots/qa`)).text(), /<title>Sandbench/);
});

test("static paths cannot climb out of the UI folder", async () => {
  for (const route of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]) {
    const text = await (await fetch(`${base}${route}`)).text();
    assert.doesNotMatch(text, /do not serve/, route);
  }
});

test("CORS: an allowed site gets a preflight answer and its origin echoed back", async () => {
  const pre = await fetch(`${base}/api/health`, {
    method: "OPTIONS",
    headers: { origin: SITE, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), SITE);
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  assert.equal(pre.headers.get("access-control-allow-credentials"), null);
  assert.match(pre.headers.get("vary"), /Origin/);
  const ok = await fetch(`${base}/api/health`, as("good", { headers: { origin: SITE } }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), SITE);
});

test("CORS: any other origin is refused, preflight included", async () => {
  const pre = await fetch(`${base}/api/health`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
  assert.equal(pre.status, 403);
  assert.equal(pre.headers.get("access-control-allow-origin"), null);
  assert.equal((await fetch(`${base}/api/health`, as("good", { headers: { origin: "https://sandbench-evil.vercel.app" } }))).status, 403);
  assert.equal((await fetch(`${base}/api/health`, { method: "OPTIONS" })).status, 403);
});

test("CORS: the sign-in check still applies to an allowed site", async () => {
  const none = await fetch(`${base}/api/health`, { headers: { origin: SITE } });
  assert.equal(none.status, 401);
  // The browser can read the error because the origin header is sent on refusals too.
  assert.equal(none.headers.get("access-control-allow-origin"), SITE);
  assert.equal((await fetch(`${base}/api/health`, as("other", { headers: { origin: SITE } }))).status, 403);
});

test("a runner with no origin list refuses every browser Origin", async () => {
  const strict = createRunner({ home: path.join(tmp, "strict"), allowedEmails: ["vincent@example.com"], verifyIdToken: async () => ({ uid: "u1", email: "vincent@example.com", email_verified: true }) });
  await new Promise((resolve) => strict.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${strict.address().port}/api/health`;
  try {
    assert.equal((await fetch(url, as("good", { headers: { origin: SITE } }))).status, 403);
    assert.equal((await fetch(url, as("good"))).status, 200);
  } finally {
    strict.close();
  }
});
