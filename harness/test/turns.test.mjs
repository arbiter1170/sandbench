import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createSecretStore } from "../secrets.mjs";
import { createTurns } from "../turns.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-turns-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("a turn gets its key from the server store by name; a key in the request body is ignored", async () => {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "done" } }] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const secrets = createSecretStore({ file: path.join(tmp, "s.json"), env: {} });
  secrets.set("COMPAT_API_KEY", "stored-on-server-12345");
  const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder: () => tmp, secrets });
  const base = `http://127.0.0.1:${upstream.address().port}/v1`;
  let closeSubscriber = () => {};
  const finished = new Promise((resolve) => {
    const res = { writeHead() {}, write(chunk) { if (/"type":"(done|error)"/.test(String(chunk))) resolve(String(chunk)); }, on() {}, end() {} };
    turns.subscribe({ on: (event, fn) => event === "close" && (closeSubscriber = fn) }, res, new URL("http://x/events?after=0"));
  });
  turns.start({ driver: "http", prompt: "hi", model: "m", base, secret: "COMPAT_API_KEY", key: "from-the-page-xxxxxxx" });
  const last = await finished;
  assert.match(last, /"type":"done"/);
  assert.deepEqual(seen, ["Bearer stored-on-server-12345"]);

  // A secret name outside the allowed set is never resolved.
  const before = seen.length;
  turns.start({ driver: "http", prompt: "hi", model: "m", base, secret: "CURSOR_API_KEY" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  closeSubscriber();
  upstream.close();
  // Without a resolved key the driver stops before calling the model at all.
  assert.equal(seen.length, before);
});
