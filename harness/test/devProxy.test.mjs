// The dev server, with the real vite.config.ts. A production build bundles src/approvalPolicy.ts's
// import of harness/autoReview.mjs, so only `vite dev` fetches it by URL: when the /harness proxy
// caught that request, the page stayed blank in dev while every build-based test passed.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let vite;
let base;

before(async () => {
  vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "silent", server: { port: 0, strictPort: false, hmr: false, watch: null } });
  await vite.listen();
  const { port } = vite.httpServer.address();
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await vite?.close();
});

test("the page's shared harness module loads through the dev server", async () => {
  const policy = await (await fetch(`${base}/src/approvalPolicy.ts`)).text();
  assert.match(policy, /\/harness\/autoReview\.mjs/, "the page no longer imports the module this test covers");
  const response = await fetch(`${base}/harness/autoReview.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /javascript/);
  assert.match(await response.text(), /reviewCommand/);
});

test("a harness route without the client header is still refused, .mjs or not", async () => {
  assert.equal((await fetch(`${base}/harness/health`)).status, 403);
  assert.equal((await fetch(`${base}/harness/turns`, { method: "POST" })).status, 403);
  assert.equal((await fetch(`${base}/harness/autoReview.mjs`, { method: "POST" })).status, 403);
});

test("a call with the client header goes to the harness even if its path ends in .mjs", async () => {
  // A stand-in on the harness's dev port, if it is free. Vite would answer with source; the proxy doesn't.
  const seen = [];
  const stub = createHttpServer((req, res) => {
    seen.push(req.url);
    res.end("from-harness");
  });
  const free = await new Promise((resolve) => {
    stub.once("error", () => resolve(false));
    stub.listen(8799, "127.0.0.1", () => resolve(true));
  });
  try {
    const response = await fetch(`${base}/harness/autoReview.mjs`, { headers: { "x-sandbench-client": "1" } });
    const body = await response.text();
    assert.doesNotMatch(body, /reviewCommand/, "a client call was served as page source");
    if (free) assert.deepEqual([body, seen], ["from-harness", ["/autoReview.mjs"]]);
  } finally {
    if (free) await new Promise((resolve) => stub.close(resolve));
  }
});
