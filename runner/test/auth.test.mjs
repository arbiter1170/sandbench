import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuth, parseAllowlist } from "../api/auth.mjs";

const TOKENS = {
  vincent: { uid: "u1", email: "Vincent@Example.com", email_verified: true },
  stranger: { uid: "u2", email: "someone@example.com", email_verified: true },
  unverified: { uid: "u3", email: "vincent@example.com", email_verified: false },
};
const verifyIdToken = async (token) => {
  if (!TOKENS[token]) throw new Error("bad token");
  return TOKENS[token];
};
const request = (authorization) => ({ headers: authorization ? { authorization } : {} });

test("parseAllowlist trims, lowercases and drops blanks", () => {
  assert.deepEqual(parseAllowlist(" A@x.com, ,b@Y.com "), ["a@x.com", "b@y.com"]);
  assert.deepEqual(parseAllowlist(undefined), []);
});

test("no token or a bad token is 401", async () => {
  const auth = createAuth({ verifyIdToken, allowedEmails: ["vincent@example.com"] });
  assert.equal((await auth(request())).status, 401);
  assert.equal((await auth(request("Basic abc"))).status, 401);
  assert.equal((await auth(request("Bearer forged"))).status, 401);
});

test("a valid token for an account off the allowlist is 403", async () => {
  const auth = createAuth({ verifyIdToken, allowedEmails: ["vincent@example.com"] });
  assert.equal((await auth(request("Bearer stranger"))).status, 403);
});

test("an unverified email is 403 even when it matches", async () => {
  const auth = createAuth({ verifyIdToken, allowedEmails: ["vincent@example.com"] });
  assert.equal((await auth(request("Bearer unverified"))).status, 403);
});

test("an allowed account passes, matched without case", async () => {
  const auth = createAuth({ verifyIdToken, allowedEmails: ["vincent@example.com"] });
  assert.deepEqual(await auth(request("Bearer vincent")), { user: { uid: "u1", email: "vincent@example.com" } });
});

test("an empty allowlist lets nobody in", async () => {
  const auth = createAuth({ verifyIdToken, allowedEmails: [] });
  assert.equal((await auth(request("Bearer vincent"))).status, 403);
});
