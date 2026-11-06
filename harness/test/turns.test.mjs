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

// Runs one http-driver turn against a fake model and returns what the model was sent plus the
// events the page would see. `folder` and `resolveFolder` stand in for the server's own.
async function runTurn({ workspaceRoot, resolveFolder, folder, system }) {
  const bodies = [];
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "done" } }] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const secrets = createSecretStore({ file: path.join(tmp, `s-${Math.random().toString(16).slice(2)}.json`), env: {} });
  secrets.set("COMPAT_API_KEY", "stored-on-server-12345");
  const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder, secrets, workspaceRoot });
  const events = [];
  let closeSubscriber = () => {};
  const finished = new Promise((resolve) => {
    const res = {
      writeHead() {},
      write(chunk) {
        const data = /^data: (.*)$/m.exec(String(chunk));
        if (data) events.push(JSON.parse(data[1]));
        if (/"type":"(done|error)"/.test(String(chunk))) resolve();
      },
      on() {},
      end() {},
    };
    turns.subscribe({ on: (event, fn) => event === "close" && (closeSubscriber = fn) }, res, new URL("http://x/events?after=0"));
  });
  turns.start({ driver: "http", prompt: "hi", model: "m", base: `http://127.0.0.1:${upstream.address().port}/v1`, secret: "COMPAT_API_KEY", folder, system });
  await finished;
  closeSubscriber();
  upstream.close();
  return { system: bodies[0]?.messages?.[0]?.content ?? "", events };
}

test("with a workspace root, the turn's system text ends with the resolved working directory and turn_start names it", async () => {
  // A fake Windows layout: the resolver stands in for the harness's workspacePath (same root).
  const root = "C:\\Users\\Some Body\\.sandbench\\workspace";
  const resolveFolder = (folder) => (folder ? `${root}\\${folder}` : root);
  const scoped = await runTurn({ workspaceRoot: root, resolveFolder, folder: "walklings-team", system: "Be brief." });
  assert.ok(scoped.system.startsWith("Be brief.\n\n"), scoped.system);
  assert.ok(scoped.system.includes(`- Path: ${root}\\walklings-team\n`), scoped.system);
  assert.ok(scoped.system.includes(`- Workspace root: ${root}\n`), scoped.system);
  // The host here is posix, so the relative line is computed by the server's own path module;
  // what matters for the model is the verbatim Path line above.
  const start = scoped.events.find((event) => event.type === "turn_start");
  assert.equal(start.cwd, `${root}\\walklings-team`);

  const plain = await runTurn({ workspaceRoot: root, resolveFolder, folder: undefined, system: "" });
  assert.ok(plain.system.startsWith("Working directory (resolved by Sandbench"), plain.system);
  assert.ok(plain.system.includes(`- Path: ${root}\n`), plain.system);
  assert.equal(plain.events.find((event) => event.type === "turn_start").cwd, root);
});

test("the working-directory block survives a system prompt at the 40,000 character cut", async () => {
  const root = "/home/some-body/.sandbench/workspace";
  const long = "x".repeat(50_000);
  const { system } = await runTurn({ workspaceRoot: root, resolveFolder: () => root, system: long });
  assert.equal(system.indexOf("Working directory (resolved by Sandbench"), 40_000 + 2);
  assert.ok(system.endsWith("The folder may be empty."), system.slice(-80));
});

test("without a workspace root (the runner) the system text and turn_start are unchanged", async () => {
  const { system, events } = await runTurn({ resolveFolder: () => tmp, folder: undefined, system: "Be brief." });
  assert.equal(system, "Be brief.");
  assert.deepEqual(Object.keys(events.find((event) => event.type === "turn_start")).sort(), ["at", "driver", "seq", "turnId", "type"]);
});
