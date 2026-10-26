// Real firebase-admin token checks against the Firebase Auth emulator (project demo-sandbench).
// Skipped unless FIREBASE_AUTH_EMULATOR_HOST is set. CI runs it with:
//   cd runner/test/emulator && npx firebase-tools emulators:exec --only auth --project demo-sandbench \
//     "node --test ../emulator.test.mjs"
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = "demo-sandbench";
const EMU = `http://${HOST}/identitytoolkit.googleapis.com/v1`;

async function post(url, body, headers = {}) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const out = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(out));
  return out;
}

async function tokenFor(email, verified) {
  const user = await post(`${EMU}/accounts:signUp?key=demo`, { email, password: "demo-pass-1", returnSecureToken: true });
  if (verified) await post(`${EMU}/projects/${PROJECT}/accounts:update`, { localId: user.localId, emailVerified: true }, { authorization: "Bearer owner" });
  return (await post(`${EMU}/accounts:signInWithPassword?key=demo`, { email, password: "demo-pass-1", returnSecureToken: true })).idToken;
}

let base;
let server;
let tmp;

before(async () => {
  if (!HOST) return;
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  const { firebaseVerifier } = await import("../api/auth.mjs");
  const { createRunner } = await import("../api/server.mjs");
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-emu-"));
  server = createRunner({
    home: tmp,
    allowedEmails: ["allowed@example.test", "unverified@example.test"],
    verifyIdToken: await firebaseVerifier(PROJECT),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("emulator tokens: allowed 200, off the allowlist 403, unverified 403, none or garbage 401", { skip: !HOST && "Auth emulator not running" }, async () => {
  const health = (token) => fetch(`${base}/api/health`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const allowed = await health(await tokenFor("allowed@example.test", true));
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).host, os.hostname());
  assert.equal((await health(await tokenFor("stranger@example.test", true))).status, 403);
  assert.equal((await health(await tokenFor("unverified@example.test", false))).status, 403);
  assert.equal((await health()).status, 401);
  assert.equal((await health("abc.def.ghi")).status, 401);
});
