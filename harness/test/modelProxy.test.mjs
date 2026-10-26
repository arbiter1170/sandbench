import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { proxyModel, resolveTarget } from "../modelProxy.mjs";
import { createSecretStore } from "../secrets.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-proxy-"));
const store = createSecretStore({ file: path.join(tmp, "s.json"), env: {} });
let upstream;
let upstreamUrl;
let seen;

before(async () => {
  upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seen = { path: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
});
after(() => {
  upstream.close();
  rmSync(tmp, { recursive: true, force: true });
});

function fakeRes() {
  const out = { status: 0, headers: {}, chunks: [] };
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    write(chunk) {
      out.chunks.push(Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) out.chunks.push(Buffer.from(chunk));
      out.body = Buffer.concat(out.chunks).toString("utf8");
    },
  };
}

test("only known providers and endpoints are allowed", () => {
  assert.throws(() => resolveTarget({ provider: "evil", path: "/chat/completions" }));
  assert.throws(() => resolveTarget({ provider: "xai", path: "/files" }));
  assert.throws(() => resolveTarget({ provider: "openai_compat", base: "http://169.254.169.254", path: "/chat/completions" }));
  assert.throws(() => resolveTarget({ provider: "openai_compat", base: "http://127.0.0.1:1/v1", path: "/chat/completions" }));
  assert.equal(resolveTarget({ provider: "openai_compat", base: "http://127.0.0.1:1/v1", path: "/chat/completions" }, { allowLocal: true }).url, "http://127.0.0.1:1/v1/chat/completions");
  assert.equal(resolveTarget({ provider: "anthropic", base: "https://evil.example", path: "/messages" }).url, "https://api.anthropic.com/v1/messages");
});

test("a missing key is 409 and names the secret", async () => {
  const res = fakeRes();
  await proxyModel({ provider: "openai_compat", base: upstreamUrl, path: "/chat/completions", payload: {} }, res, { store, allowLocal: true });
  assert.equal(res.out.status, 409);
  assert.match(res.out.body, /COMPAT_API_KEY/);
});

test("the server adds the key and streams the answer back", async () => {
  store.set("COMPAT_API_KEY", "test-only-server-value");
  const res = fakeRes();
  await proxyModel({ provider: "openai_compat", base: upstreamUrl, path: "/chat/completions", payload: { model: "m", messages: [] } }, res, { store, allowLocal: true });
  assert.equal(res.out.status, 200);
  assert.equal(seen.headers.authorization, "Bearer test-only-server-value");
  assert.equal(seen.path, "/v1/chat/completions");
  assert.deepEqual(seen.body, { model: "m", messages: [] });
  assert.match(res.out.body, /"content":"hi"/);
  assert.doesNotMatch(res.out.body, /test-only-server-value/);
});

test("anthropic uses x-api-key and the version header", async () => {
  store.set("ANTHROPIC_API_KEY", "test-only-anthropic-value");
  let headers;
  const fetchImpl = async (url, init) => {
    headers = init.headers;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  await proxyModel({ provider: "anthropic", path: "/messages", payload: {} }, fakeRes(), { store, fetchImpl });
  assert.equal(headers["x-api-key"], "test-only-anthropic-value");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers.authorization, undefined);
});

test("an agent cannot use a key scoped to another agent", async () => {
  store.set("XAI_API_KEY", "test-only-scoped-value", "supervisor");
  const res = fakeRes();
  await proxyModel({ provider: "xai", path: "/chat/completions", payload: {} }, res, { store, agent: "token-engineer", fetchImpl: () => assert.fail("must not call upstream") });
  assert.equal(res.out.status, 409);
});
