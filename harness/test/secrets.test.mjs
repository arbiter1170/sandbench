import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createSecretStore, preview } from "../secrets.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-secrets-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const fresh = (name, env = {}) => createSecretStore({ file: path.join(tmp, `${name}.json`), env });
const FAKE = "fake-test-value-0123456789";

test("list never returns values, only name, preview and scope", () => {
  const store = fresh("list");
  store.set("ANTHROPIC_API_KEY", FAKE);
  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "ANTHROPIC_API_KEY");
  assert.equal(listed[0].preview, preview(FAKE));
  assert.doesNotMatch(JSON.stringify(listed), /0123456789/);
});

test("the file is written 0600 and re-read on every lookup (rotation without restart)", () => {
  const file = path.join(tmp, "rotate.json");
  const store = createSecretStore({ file, env: {} });
  store.set("ANTHROPIC_API_KEY", "first-value-aaaaaaaa");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  writeFileSync(file, JSON.stringify({ secrets: { ANTHROPIC_API_KEY: { value: "rotated-value-bbbbbbbb", scope: "shared" } } }));
  assert.equal(store.get("ANTHROPIC_API_KEY"), "rotated-value-bbbbbbbb");
});

test("an agent-scoped secret is hidden from other agents but usable by its agent and the owner", () => {
  const store = fresh("scope");
  store.set("CURSOR_API_KEY", FAKE, "pixelpets");
  assert.equal(store.get("CURSOR_API_KEY", { agent: "token-engineer" }), null);
  assert.equal(store.get("CURSOR_API_KEY", { agent: "pixelpets" }), FAKE);
  assert.equal(store.get("CURSOR_API_KEY"), FAKE);
});

test("environment values win, show up in list, and cannot be overwritten from the page", () => {
  const store = fresh("env", { XAI_API_KEY: "env-value-cccccccccc" });
  assert.equal(store.get("XAI_API_KEY"), "env-value-cccccccccc");
  assert.equal(store.list().find((item) => item.name === "XAI_API_KEY")?.source, "env");
  assert.throws(() => store.set("XAI_API_KEY", "x-other-value-123"));
  assert.throws(() => store.remove("XAI_API_KEY"));
});

test("names and scopes are validated", () => {
  const store = fresh("names");
  assert.throws(() => store.set("lower_case", FAKE));
  assert.throws(() => store.set("../../etc", FAKE));
  assert.throws(() => store.set("GOOD_NAME", FAKE, "Bad Scope"));
  assert.throws(() => store.set("GOOD_NAME", "   "));
  assert.equal(store.get("../x"), null);
});

test("remove deletes the value from disk", () => {
  const file = path.join(tmp, "remove.json");
  const store = createSecretStore({ file, env: {} });
  store.set("FISH_API_KEY", FAKE);
  assert.equal(store.remove("FISH_API_KEY"), true);
  assert.doesNotMatch(readFileSync(file, "utf8"), /0123456789/);
  assert.equal(store.get("FISH_API_KEY"), null);
});

test("fill resolves {{NAME}} placeholders on the server and leaves unknown ones", () => {
  const store = fresh("fill");
  store.set("COMPOSIO_KEY", FAKE);
  assert.equal(store.fill("Bearer {{COMPOSIO_KEY}}"), `Bearer ${FAKE}`);
  assert.equal(store.fill("{{MISSING}}"), "{{MISSING}}");
});

test("a secrets file that can't be read is never overwritten, and the last good copy is kept as .bak", () => {
  const file = path.join(tmp, "broken.json");
  const store = createSecretStore({ file, env: {} });
  store.set("XAI_API_KEY", FAKE);
  store.set("ANTHROPIC_API_KEY", FAKE);
  assert.match(readFileSync(`${file}.bak`, "utf8"), /XAI_API_KEY/);
  assert.equal(statSync(`${file}.bak`).mode & 0o777, 0o600);
  // A hand edit breaks the JSON: lookups go on without file keys, but no write replaces it.
  writeFileSync(file, '{ "secrets": { "XAI_API_KEY": { "value": "x" }, ', { mode: 0o600 });
  assert.equal(store.get("XAI_API_KEY"), null);
  assert.throws(() => store.set("COMPAT_API_KEY", FAKE), /can't be read/);
  assert.throws(() => store.remove("XAI_API_KEY"), /can't be read/);
  assert.match(readFileSync(file, "utf8"), /^\{ "secrets"/, "the broken file is left as it was");
  writeFileSync(file, "[]", { mode: 0o600 });
  assert.throws(() => store.set("COMPAT_API_KEY", FAKE), /not a secrets file/);
});
