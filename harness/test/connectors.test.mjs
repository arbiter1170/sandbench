// Local Claude Code turns get only their own bot's synced, tested connectors. Everything here
// is synthetic: a temp HOME, a fake `claude` CLI that speaks the stream-json protocol the
// driver reads, and an MCP server on 127.0.0.1 that records what it was asked to do.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-connectors-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
after(() => rmSync(tmp, { recursive: true, force: true }));

const { createConnectorRegistry, urlProblem } = await import("../connectors.mjs");
const { createTurns } = await import("../turns.mjs");
const { DRIVERS } = await import("../drivers/index.mjs");

const dir = path.join(tmp, ".sandbench", "driver-settings");

function connector(id, overrides = {}) {
  return { id, name: `Notes ${id}`, url: "http://127.0.0.1:9/mcp", headers: [], status: "ok", ...overrides };
}

function collect(turns) {
  const events = [];
  let close = () => {};
  turns.subscribe({ on: (name, fn) => name === "close" && (close = fn) }, { writeHead() {}, write(chunk) { const data = /data: (.*)\n/.exec(String(chunk)); if (data) events.push(JSON.parse(data[1])); } }, new URL("http://x/events?after=0"));
  const until = (predicate, ms = 5000) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = events.find(predicate);
        if (hit) return resolve(hit);
        if (Date.now() - started > ms) return reject(new Error(`timed out; saw ${events.map((item) => item.type).join(",")}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  return { events, until, close: () => close() };
}

test("urls: https anywhere, http only on this computer, nothing else", () => {
  assert.equal(urlProblem("https://mcp.example.test/mcp"), "");
  assert.equal(urlProblem("http://127.0.0.1:7000/mcp"), "");
  assert.equal(urlProblem("http://localhost:7000/mcp"), "");
  assert.notEqual(urlProblem("http://mcp.example.test/mcp"), "");
  assert.notEqual(urlProblem("file:///etc/passwd"), "");
  assert.notEqual(urlProblem("https://user:pw@mcp.example.test/mcp"), "");
  assert.notEqual(urlProblem("not a url"), "");
  assert.notEqual(urlProblem(42), "");
});

test("a bot gets only its own assigned connectors; other bots, unknown bots and missing bot ids get none", () => {
  const registry = createConnectorRegistry({ dir });
  registry.sync({ connectors: [connector("c-a"), connector("c-b")], bots: { "bot-a": ["c-a"], "bot-b": ["c-b"], "bot-c": [] } });
  const mine = registry.attach({ turnId: "aaaaaaaaaaaaaaa1", botId: "bot-a" });
  try {
    const config = JSON.parse(readFileSync(mine.file, "utf8"));
    assert.deepEqual(Object.values(config.mcpServers).map((item) => item.url), ["http://127.0.0.1:9/mcp"]);
    assert.equal(mine.servers.length, 1);
    assert.equal(mine.servers[0].connector, "Notes c-a");
    if (process.platform !== "win32") assert.equal(statSync(mine.file).mode & 0o777, 0o600);
  } finally {
    mine.release();
  }
  assert.equal(existsSync(mine.file), false, "release deletes the per-turn file");
  for (const botId of ["bot-c", "bot-z", undefined, "../bot-a", { id: "bot-a" }]) {
    const none = registry.attach({ turnId: "aaaaaaaaaaaaaaa2", botId });
    assert.equal(none.file, "", `no config for ${JSON.stringify(botId)}`);
  }
  assert.equal(registry.attach({ turnId: "../../escape", botId: "bot-a" }).file, "", "turn ids can't steer the file path");
});

test("a bot can't be assigned a connector that wasn't synced, and a new sync replaces old assignments", () => {
  const registry = createConnectorRegistry({ dir });
  registry.sync({ connectors: [connector("c-a")], bots: { "bot-a": ["c-a", "c-ghost"] } });
  const first = registry.attach({ turnId: "bbbbbbbbbbbbbbb1", botId: "bot-a" });
  assert.equal(first.servers.length, 1);
  first.release();
  registry.sync({ connectors: [connector("c-a")], bots: {} });
  assert.equal(registry.attach({ turnId: "bbbbbbbbbbbbbbb2", botId: "bot-a" }).file, "", "unassigning takes effect on the next turn");
});

test("untested, secret-bearing, off-machine and malformed connectors fail closed with a reason", () => {
  const registry = createConnectorRegistry({ dir });
  const result = registry.sync({
    connectors: [
      connector("ok", { headers: [{ key: "X-Client", value: "sandbench" }] }),
      connector("untested", { status: "untested" }),
      connector("secret", { headers: [{ key: "Authorization", value: "Bearer {{NOTES_TOKEN}}" }] }),
      connector("remote-http", { url: "http://mcp.example.test/mcp" }),
      connector("stdio", { url: "stdio:node evil.mjs" }),
      connector("bad-header", { headers: [{ key: "X-Bad\r\nInjected", value: "1" }] }),
      connector("crlf-value", { headers: [{ key: "X-Ok", value: "a\r\nb" }] }),
      { id: "../../etc", name: "Escape", url: "https://mcp.example.test", status: "ok" },
      "not an object",
    ],
    bots: { "bot-a": ["ok", "untested", "secret", "remote-http", "stdio", "bad-header", "crlf-value", "../../etc"] },
  });
  assert.deepEqual(result, { ok: true, connectors: 7, rejected: 2 });
  const attached = registry.attach({ turnId: "ccccccccccccccc1", botId: "bot-a" });
  try {
    assert.deepEqual(attached.servers.map((item) => item.connector), ["Notes ok"]);
    assert.deepEqual(attached.skipped.map((item) => item.name), ["Notes untested", "Notes secret", "Notes remote-http", "Notes stdio", "Notes bad-header", "Notes crlf-value"]);
    assert.match(attached.skipped.find((item) => item.name === "Notes secret").reason, /secret/);
    const text = readFileSync(attached.file, "utf8");
    assert.equal(/\{\{|NOTES_TOKEN|example\.test|stdio/.test(text), false, "only the usable connector is written");
    assert.deepEqual(Object.values(JSON.parse(text).mcpServers)[0].headers, { "X-Client": "sandbench" });
  } finally {
    attached.release();
  }
});

test("sync answers with counts only, never urls or headers", () => {
  const registry = createConnectorRegistry({ dir });
  const reply = JSON.stringify(registry.sync({ connectors: [connector("c-a", { headers: [{ key: "Authorization", value: "Bearer {{NOTES_TOKEN}}" }] })], bots: { "bot-a": ["c-a"] } }));
  assert.equal(/127\.0\.0\.1|NOTES_TOKEN|Authorization/.test(reply), false);
});

// Turn wiring, with a stand-in driver in the "claude" slot so no CLI is needed.
function withFakeClaude(fn) {
  const index = DRIVERS.findIndex((item) => item.id === "claude");
  const real = DRIVERS[index];
  const seen = [];
  DRIVERS[index] = {
    id: "claude",
    label: "fake",
    available: async () => ({ ok: true }),
    startTurn(turn) {
      seen.push({ extras: turn.extras, configExists: turn.extras.mcpConfig ? existsSync(turn.extras.mcpConfig) : false });
      return { done: Promise.resolve(), interrupt() {} };
    },
  };
  return Promise.resolve(fn(seen)).finally(() => {
    DRIVERS[index] = real;
  });
}

test("the engine hands the bot's config to Claude turns only, and ignores extras or config in the request", async () => {
  await withFakeClaude(async (seen) => {
    const registry = createConnectorRegistry({ dir });
    registry.sync({ connectors: [connector("c-a"), connector("c-b", { headers: [{ key: "Authorization", value: "Bearer {{NOTES_TOKEN}}" }] })], bots: { "bot-a": ["c-a", "c-b"] } });
    const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder: () => tmp });
    const feed = collect(turns);
    const forged = { extras: { mcpConfig: "/tmp/evil.json", settings: { permissions: { allow: ["*"] } } }, mcpConfig: "/tmp/evil.json", connectors: [connector("evil")] };
    after(() => feed.close());
    const { id } = turns.start({ driver: "claude", prompt: "hi", botId: "bot-a", ...forged }, { connectors: registry });
    await feed.until((item) => item.turnId === id && item.type === "done");
    assert.equal(seen.length, 1);
    assert.deepEqual(Object.keys(seen[0].extras), ["mcpConfig"]);
    assert.notEqual(seen[0].extras.mcpConfig, "/tmp/evil.json");
    assert.equal(seen[0].configExists, true);
    assert.equal(existsSync(seen[0].extras.mcpConfig), false, "the file is gone once the turn ends");
    const notes = feed.events.filter((item) => item.turnId === id && item.type === "thinking").map((item) => item.text);
    assert.ok(notes.some((text) => /Connectors for this turn: Notes c-a\. Each tool asks for approval\./.test(text)));
    assert.ok(notes.some((text) => /Connector Notes c-b left out: .*secret/.test(text)));
    assert.equal(JSON.stringify(feed.events).includes("NOTES_TOKEN"), false);

    // A request that names no bot, or a server that passes no registry (the runner), gets nothing.
    turns.start({ driver: "claude", prompt: "hi", ...forged }, { connectors: registry });
    turns.start({ driver: "claude", prompt: "hi", botId: "bot-a", ...forged });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(seen.slice(1).map((item) => item.extras), [{}, {}]);
    feed.close();
  });
  assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".mcp.json")), []);
});

test("non-Claude drivers never get a connector config", async () => {
  const registry = createConnectorRegistry({ dir });
  registry.sync({ connectors: [connector("c-a")], bots: { "bot-a": ["c-a"] } });
  let attached = 0;
  const counting = { sync: registry.sync, attach: (args) => (attached += 1, registry.attach(args)) };
  const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder: () => tmp });
  const feed = collect(turns);
  after(() => feed.close());
  const { id } = turns.start({ driver: "http", prompt: "hi", model: "m", base: "http://127.0.0.1:9/v1", botId: "bot-a" }, { connectors: counting });
  await feed.until((item) => item.turnId === id && (item.type === "done" || item.type === "error"));
  assert.equal(attached, 0);
  feed.close();
});

// The real claude.mjs driver against a fake CLI and a synthetic MCP server.
async function notesServer() {
  const calls = [];
  const authorizations = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    authorizations.push(req.headers.authorization ?? "");
    const message = raw ? JSON.parse(raw) : {};
    if (message.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "synthetic-notes", version: "1" } };
    else if (message.method === "tools/list") result = { tools: [{ name: "write_note", description: "Append a note.", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] };
    else if (message.method === "tools/call") {
      calls.push(message.params);
      result = { content: [{ type: "text", text: `saved: ${message.params.arguments.text}` }] };
    }
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, calls, authorizations, close };
}

// Speaks the parts of `claude -p --output-format stream-json` the driver reads. It "wants"
// write_note on every configured server; it only calls one once the settings allow it.
const FAKE_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); return at < 0 ? "" : args[at + 1]; };
const allow = JSON.parse(fs.readFileSync(flag("--settings"), "utf8")).permissions.allow;
const configFile = flag("--mcp-config");
const servers = configFile ? JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers : {};
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, servers }) + "\\n");
const out = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
(async () => {
  out({ type: "system", subtype: "init", session_id: "fake-session-0001" });
  const denials = [];
  for (const [name, server] of Object.entries(servers)) {
    const tool = "mcp__" + name + "__write_note";
    const input = { text: "synthetic note" };
    if (!allow.includes(tool)) { denials.push({ tool_name: tool, tool_use_id: "t-" + name, tool_input: input }); continue; }
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t-" + name, name: tool, input }] } });
    const post = (body) => fetch(server.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(server.headers || {}) }, body: JSON.stringify(body) }).then((r) => r.json());
    await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const called = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "write_note", arguments: input } });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t-" + name, content: called.result.content }] } });
  }
  out({ type: "result", session_id: "fake-session-0001", is_error: false, result: denials.length ? "Waiting for approval." : "Done.", permission_denials: denials });
})();
`;

async function cliTurn({ registry, botId, answer }) {
  const bin = path.join(tmp, "fake-claude");
  writeFileSync(bin, FAKE_CLI);
  chmodSync(bin, 0o755);
  const log = path.join(tmp, `cli-${Math.random().toString(16).slice(2)}.log`);
  process.env.SANDBENCH_CLAUDE_BIN = bin;
  process.env.FAKE_CLAUDE_LOG = log;
  writeFileSync(log, "");
  const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder: () => tmp });
  const feed = collect(turns);
  const body = { driver: "claude", prompt: "save a note", botId, ...(answer === "unattended" ? { unattendedDeny: true } : {}) };
  const { id } = turns.start(body, { connectors: registry });
  let end;
  try {
    if (answer === true || answer === false) {
      const asked = await feed.until((item) => item.turnId === id && item.type === "permission_request");
      turns.permit(asked.permissionId, answer);
    } else if (answer === "stop") {
      await feed.until((item) => item.turnId === id && item.type === "permission_request");
      turns.interrupt(id);
    }
    end = await feed.until((item) => item.turnId === id && (item.type === "done" || item.type === "error"));
  } finally {
    feed.close();
  }
  const runs = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { end, events: feed.events.filter((item) => item.turnId === id), runs };
}

const posix = { timeout: 20_000, ...(process.platform === "win32" ? { skip: "the fake CLI is a POSIX script" } : {}) };

test("CLI fixture: an approved connector tool runs once against the bot's own server", posix, async () => {
  const notes = await notesServer();
  const other = await notesServer();
  try {
    const registry = createConnectorRegistry({ dir });
    registry.sync({ connectors: [connector("c-a", { url: notes.url }), connector("c-b", { url: other.url })], bots: { "bot-a": ["c-a"], "bot-b": ["c-b"] } });
    const { end, events, runs } = await cliTurn({ registry, botId: "bot-a", answer: true });
    assert.equal(end.type, "done");
    assert.equal(notes.calls.length, 1, "exactly one write after one approval");
    assert.deepEqual(notes.calls[0], { name: "write_note", arguments: { text: "synthetic note" } });
    assert.equal(other.calls.length + other.authorizations.length, 0, "another bot's server is never contacted");
    const asked = events.find((item) => item.type === "permission_request");
    assert.match(asked.command, /^mcp__sb_notes_c_a_ca__write_note$/);
    assert.equal(asked.auto, false);
    const ended = events.find((item) => item.type === "tool_end" && item.permissionId === asked.permissionId);
    assert.match(ended.output, /saved: synthetic note/);
    assert.equal(runs.length, 2, "one denied round, one resumed round");
    assert.ok(runs.every((run) => Object.keys(run.servers).length === 1));
  } finally {
    notes.close();
    other.close();
  }
});

test("CLI fixture: a denied, unattended or stopped tool request never reaches the server", posix, async () => {
  for (const answer of [false, "unattended", "stop"]) {
    const notes = await notesServer();
    try {
      const registry = createConnectorRegistry({ dir });
      registry.sync({ connectors: [connector("c-a", { url: notes.url })], bots: { "bot-a": ["c-a"] } });
      const { end, runs } = await cliTurn({ registry, botId: "bot-a", answer });
      assert.equal(end.type, "done", `${answer} ends the turn`);
      assert.equal(notes.calls.length, 0, `${answer}: no tool call`);
      assert.equal(runs.length, 1, `${answer}: the session is not resumed`);
    } finally {
      notes.close();
    }
  }
});

test("CLI fixture: a bot without connectors, or with only secret-bearing ones, runs with no --mcp-config", posix, async () => {
  const notes = await notesServer();
  try {
    const registry = createConnectorRegistry({ dir });
    registry.sync({
      connectors: [connector("c-s", { url: notes.url, headers: [{ key: "Authorization", value: "Bearer {{NOTES_TOKEN}}" }] })],
      bots: { "bot-a": ["c-s"], "bot-b": [] },
    });
    for (const botId of ["bot-a", "bot-b", "bot-forged"]) {
      const { end, events, runs } = await cliTurn({ registry, botId, answer: null });
      assert.equal(end.type, "done");
      assert.equal(runs[0].args.includes("--mcp-config"), false, `${botId}: no config`);
      assert.equal(JSON.stringify(events).includes("NOTES_TOKEN"), false);
    }
    assert.equal(notes.calls.length + notes.authorizations.length, 0);
  } finally {
    notes.close();
  }
  assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".mcp.json")), []);
});
