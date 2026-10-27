import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    env: {},
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

test("secrets: the page can add and remove keys but only ever reads names and previews", async () => {
  const put = await fetch(`${base}/api/secrets/ANTHROPIC_API_KEY`, as("good", { method: "PUT", body: JSON.stringify({ value: "test-only-value-0123456789" }) }));
  assert.equal(put.status, 200);
  assert.doesNotMatch(await put.text(), /0123456789/);
  const listed = await (await fetch(`${base}/api/secrets`, as("good"))).text();
  assert.match(listed, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(listed, /0123456789/);
  assert.equal((await fetch(`${base}/api/secrets`)).status, 401);
  assert.equal((await fetch(`${base}/api/secrets/ANTHROPIC_API_KEY`, as("other", { method: "PUT", body: JSON.stringify({ value: "x-attacker-1234567" }) }))).status, 403);
  assert.equal((await fetch(`${base}/api/secrets/bad-name`, as("good", { method: "PUT", body: "{}" }))).status, 404);
  const removed = await fetch(`${base}/api/secrets/ANTHROPIC_API_KEY`, as("good", { method: "DELETE" }));
  assert.deepEqual(await removed.json(), { ok: true });
});

test("model proxy on the runner refuses localhost bases and needs a stored key", async () => {
  const local = await fetch(`${base}/api/model`, post("good", { provider: "openai_compat", base: "http://127.0.0.1:5432", path: "/chat/completions", payload: {} }));
  assert.equal(local.status, 400);
  const missing = await fetch(`${base}/api/model`, post("good", { provider: "xai", path: "/chat/completions", payload: {} }));
  assert.equal(missing.status, 409);
  assert.equal((await fetch(`${base}/api/model`, post(null, { provider: "xai", path: "/chat/completions" }))).status, 401);
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

test("SB-09: file and exec routes use the agent from server-side context, not the body", async () => {
  let current = "qa";
  const home = path.join(tmp, "agents-home");
  const runner = createRunner({
    home,
    allowedEmails: ["vincent@example.test"],
    env: {},
    verifyIdToken: async () => ({ uid: "u1", email: "vincent@example.test", email_verified: true }),
    // Stands in for SB-03/SB-10, which will look the agent up from the turn or tool session.
    agentFor: () => current,
  });
  await new Promise((resolve) => runner.listen(0, "127.0.0.1", resolve));
  const at = `http://127.0.0.1:${runner.address().port}/api`;
  try {
    writeFileSync(path.join(home, "shared", "handoff", "changelog.md"), "build 20261026-0001");
    // The body names another agent; the server ignores it.
    const own = await fetch(`${at}/workspace/write`, post("good", { path: "notes.md", content: "qa notes", approved: true, agent: "pixelpets", slug: "pixelpets" }));
    assert.equal(own.status, 200);
    assert.equal((await own.json()).path, "notes.md");
    assert.equal(readFileSync(path.join(home, "agents", "qa", "notes.md"), "utf8"), "qa notes");
    assert.equal(existsSync(path.join(home, "agents", "pixelpets", "notes.md")), false);

    for (const bad of ["agents/pixelpets/x.md", "../pixelpets/x.md", "wt/pixelpets/game/main/x.md", "shared/repos/x.md", "/etc/x"]) {
      assert.equal((await fetch(`${at}/workspace/write`, post("good", { path: bad, content: "x", approved: true }))).status, 400, bad);
    }
    const handoff = await (await fetch(`${at}/workspace/read?path=shared/handoff/changelog.md`, as("good"))).json();
    assert.deepEqual(handoff, { exists: true, content: "build 20261026-0001" });
    assert.equal((await fetch(`${at}/workspace/read?path=agents/pixelpets/notes.md`, as("good"))).status, 400);

    current = "design";
    const exec = await (await fetch(`${at}/exec`, post("good", { command: "pwd", approved: true }))).json();
    assert.match(exec.stdout, /agents\/design\n$/);
    mkdirSync(path.join(home, "wt", "pixelpets", "game", "main"), { recursive: true });
    assert.equal((await fetch(`${at}/exec`, post("good", { command: "touch x", approved: true, folder: "wt/pixelpets/game/main" }))).status, 400);
    assert.equal((await fetch(`${at}/workspace/read?path=../qa/notes.md`, as("good"))).status, 400);
    const turn = await fetch(`${at}/turns`, post("good", { driver: "http", prompt: "hi", folder: "agents/qa" }));
    assert.equal(turn.status, 500);
    assert.match((await turn.json()).error, /working folder/);

    current = "../escape";
    assert.equal((await fetch(`${at}/exec`, post("good", { command: "pwd", approved: true }))).status, 500);
    assert.equal(existsSync(path.join(home, "escape")), false);
  } finally {
    runner.close();
  }
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
