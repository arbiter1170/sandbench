import assert from "node:assert/strict";
import { test } from "node:test";
import * as claude from "../drivers/claude.mjs";
import * as http from "../drivers/http.mjs";
import { DRIVERS, driverById } from "../drivers/index.mjs";

test("every driver meets the contract in drivers/index.mjs", () => {
  for (const driver of DRIVERS) {
    assert.equal(typeof driver.id, "string");
    assert.equal(typeof driver.label, "string");
    assert.equal(typeof driver.available, "function");
    assert.equal(typeof driver.startTurn, "function");
    assert.equal(driverById(driver.id), driver);
  }
  assert.equal(driverById("nope"), undefined);
});

test("claude mapCliModel maps ids and rejects unsafe arguments", () => {
  assert.equal(claude.mapCliModel("haiku"), "haiku");
  assert.equal(claude.mapCliModel("claude-3-5-haiku-latest"), "haiku");
  assert.equal(claude.mapCliModel("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(claude.mapCliModel("opus; rm -rf /"), null);
  assert.equal(claude.mapCliModel("gpt-4o"), null);
  assert.equal(claude.mapCliModel(42), null);
});

test("claude normalizeEvent maps stream-json events", () => {
  assert.deepEqual(claude.normalizeEvent({ type: "system", subtype: "init", session_id: "s1" })[0], { type: "session", sessionId: "s1" });
  assert.deepEqual(claude.normalizeEvent({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }), [
    { type: "message_delta", text: "hi" },
  ]);
  const [result] = claude.normalizeEvent({ type: "result", session_id: "s1", result: "done", permission_denials: [{ tool_name: "Bash" }] });
  assert.equal(result.type, "result");
  assert.equal(result.denials.length, 1);
  assert.deepEqual(claude.normalizeEvent(null), []);
});

test("http baseUrl only allows https or this computer", () => {
  assert.equal(http.baseUrl(""), "https://api.x.ai/v1");
  assert.equal(http.baseUrl("https://example.test/v1/"), "https://example.test/v1");
  assert.equal(http.baseUrl("http://127.0.0.1:8787/v1"), "http://127.0.0.1:8787/v1");
  assert.throws(() => http.baseUrl("http://evil.test/v1"));
  assert.throws(() => http.baseUrl("http://localhost.evil.test/v1"));
});

test("http normalizeEvent reads text and tool call deltas", () => {
  const events = http.normalizeEvent({
    choices: [{ delta: { content: "ok", tool_calls: [{ index: 0, id: "c1", function: { name: "run_command", arguments: "{}" } }] } }],
  });
  assert.deepEqual(events, [
    { type: "message_delta", text: "ok" },
    { type: "tool_call_delta", index: 0, callId: "c1", name: "run_command", args: "{}" },
  ]);
  assert.deepEqual(http.normalizeEvent({}), []);
});
