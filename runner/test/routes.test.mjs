// SB-03 PR 1 route registry, with fixture route folders (runner/test/fixtures/routes/).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRunner } from "../api/server.mjs";
import { loadRouteFactories } from "../api/routes/index.mjs";

const fixtures = new URL("./fixtures/routes/", import.meta.url);
let tmp;
let server;
let base;

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-routes-"));
  server = createRunner({
    home: tmp,
    allowedEmails: ["vincent@example.test"],
    env: {},
    verifyIdToken: async (token) => {
      if (token === "good") return { uid: "u1", email: "vincent@example.test", email_verified: true };
      throw new Error("bad token");
    },
    routes: await loadRouteFactories(new URL("good/", fixtures)),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const get = (route, token = "good") => fetch(`${base}${route}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});

test("the loader sorts by file name and skips index.mjs", async () => {
  assert.deepEqual((await loadRouteFactories(new URL("good/", fixtures))).map((route) => route.file), ["05-echo.mjs", "10-ping.mjs"]);
  // The real routes folder ships empty.
  assert.deepEqual(await loadRouteFactories(), []);
});

test("duplicate names, overlapping prefixes and built-in paths are refused at load", async () => {
  await assert.rejects(loadRouteFactories(new URL("dup-name/", fixtures)), /route name same is already used by a\.mjs/);
  await assert.rejects(loadRouteFactories(new URL("overlap/", fixtures)), /overlaps \/jobs in a\.mjs/);
  await assert.rejects(loadRouteFactories(new URL("reserved/", fixtures)), /overlaps the built-in \/data/);
});

test("a registry route is reachable behind sign-in, with the runner's deps", async () => {
  assert.equal((await get("/ping", null)).status, 401);
  assert.equal((await get("/ping", "forged")).status, 401);
  const ok = await get("/ping");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { pong: true, owner: "u1", hasDeps: true });
  assert.deepEqual(await (await get("/echo/hello")).json(), { echo: "hello" });
});

test("a handler that returns false falls through; unknown paths and built-ins work as before", async () => {
  // The echo route only answers GET; a POST falls through to the built-in 404.
  assert.equal((await fetch(`${base}/echo/hello`, { method: "POST", headers: { authorization: "Bearer good" } })).status, 404);
  assert.equal((await get("/ping/extra")).status, 404);
  assert.equal((await get("/nope")).status, 404);
  assert.equal((await get("/health")).status, 200);
  // No database: the data routes still answer 503, as before.
  assert.equal((await get("/data/agents")).status, 503);
});
