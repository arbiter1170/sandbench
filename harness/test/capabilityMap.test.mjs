// The capability map (src/capabilities.ts) is a hand-written table. These tests tie the rows
// that describe harness, runner and import behavior to the code, so a behavior change fails
// here until the label is updated too.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DRIVERS } from "../drivers/index.mjs";
import { createTurns } from "../turns.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const rows = new Map(
  // `\r?\n`: a Windows clone with core.autocrlf checks this file out with CRLF.
  [...read("src/capabilities.ts").matchAll(/observed: "([^"]*)",\r?\n\s+web: "([^"]*)",\r?\n\s+state: "(\w+)",\r?\n\s+needs: "(\w+)",/g)].map(([, observed, web, state, needs]) => [
    observed,
    { web, state, needs },
  ]),
);
const row = (name) => {
  assert.ok(rows.has(name), `missing row ${name}`);
  return rows.get(name);
};

test("the drivers row names every registered driver and the right count", () => {
  const { web } = row("Agent drivers");
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
  assert.match(web, new RegExp(`^${words[DRIVERS.length]} drivers`));
  for (const driver of DRIVERS) assert.ok(web.includes(driver.label), `${driver.label} is not in the row`);
});

test("the API drivers report available with no key, as the row says", async () => {
  assert.match(row("Agent drivers").web, /listed as available before a key is stored/);
  for (const id of ["anthropic", "http"]) {
    const state = await DRIVERS.find((driver) => driver.id === id).available();
    assert.equal(state.ok, true, id);
  }
});

test("the runner image installs none of the CLI drivers, as the row says", () => {
  assert.match(row("Agent drivers").web, /runner image ships none/);
  const dockerfile = read("runner/Dockerfile");
  const runnerPackage = read("runner/package.json");
  for (const cli of ["@anthropic-ai/claude-code", "@openai/codex", "x.ai/cli", "grok"]) {
    assert.ok(!dockerfile.includes(cli), cli);
    assert.ok(!runnerPackage.includes(cli), cli);
  }
});

test("driver turns get no connector config from the request, as the drivers and connectors rows say", () => {
  assert.match(row("Agent drivers").web, /do not get the bot's connectors yet/);
  assert.match(row("Connectors and custom MCP").web, /Agent-driver turns .* do not get connectors yet/);
  let seen;
  const probe = {
    id: "test-extras",
    label: "probe",
    available: async () => ({ ok: true }),
    startTurn(turn) {
      seen = turn.extras;
      return { done: Promise.resolve(), interrupt: () => undefined };
    },
  };
  DRIVERS.push(probe);
  try {
    const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder: () => root });
    turns.start({ driver: probe.id, prompt: "hi", extras: { mcpConfig: { mcpServers: { x: {} } } }, connectors: [{ id: "c1" }] });
  } finally {
    DRIVERS.splice(DRIVERS.indexOf(probe), 1);
  }
  assert.deepEqual(seen, {});
});

test("rows that need harness-only routes do not claim the runner", () => {
  const runner = [read("runner/api/server.mjs"), ...readdirSync(path.join(root, "runner/api/routes")).map((file) => read(`runner/api/routes/${file}`))].join("\n");
  const harness = read("harness/server.mjs");
  const needs = {
    "Thinking trace and computer usage": ["/screen", "/processes"],
    "Computer use (local exec daemon, window capture)": ["/input", "/screen"],
    "Connectors and custom MCP": ["/mcp/call"],
    "Tasks, routines, and reminders": ["/schedules", "/triggers"],
  };
  for (const [name, routes] of Object.entries(needs)) {
    for (const route of routes) {
      assert.ok(harness.includes(`"${route}"`), `harness serves ${route}`);
      assert.ok(!new RegExp(`["'\`]${route}["'\`]`).test(runner), `runner does not serve ${route}`);
    }
    assert.notEqual(row(name).needs, "harnessOrRunner", name);
  }
  assert.match(row("Thinking trace and computer usage").web, /the runner does not serve them/);
  assert.match(row("Tasks, routines, and reminders").web, /A runner build does not run routines, even with a tab open/);
  assert.equal(row("Tasks, routines, and reminders").needs, "harness", "webhooks and recent runs are harness-only");
  assert.match(row("Tasks, routines, and reminders").web, /Webhooks and recent runs need the local harness/);
});

test("the migration row lists what the Windows import script drops", () => {
  const { web, state } = row("Grok Bot migration");
  const script = read("scripts/import-grok-desktop.mjs");
  assert.notEqual(state, "working");
  assert.ok(script.includes('schedule: "Weekdays at 9:00"'));
  assert.match(web, /placeholder schedule \(weekdays at 9:00\)/);
  assert.ok(script.includes("bots[index % bots.length]"));
  assert.match(web, /dealt out to bots in turn/);
  assert.ok(script.includes("connectors: []") && !script.includes("webhooks"));
  assert.match(web, /writes no connectors or webhooks/);
  assert.ok(script.includes("threads.slice(0, 40)") && script.includes("routines.slice(0, 40)"));
  assert.match(web, /at most 40 chats and 40 routines/);
});

test("rows that say the harness or the runner are served by both", () => {
  const runner = [read("runner/api/server.mjs"), ...readdirSync(path.join(root, "runner/api/routes")).map((file) => read(`runner/api/routes/${file}`))].join("\n");
  const harness = read("harness/server.mjs");
  const both = { "Model per bot": ["/model"], "Chat with markdown and code": ["/model"], "Agent drivers": ["/drivers", "/turns"], "Test stack profiles": ["/secrets", "/drivers"] };
  for (const [name, routes] of Object.entries(both)) {
    assert.equal(row(name).needs, "harnessOrRunner", name);
    for (const route of routes) {
      assert.ok(harness.includes(route), `harness serves ${route}`);
      assert.ok(runner.includes(route), `runner serves ${route}`);
    }
  }
  // Every model call from the page goes through this one route.
  assert.ok(read("src/harness.ts").includes("fetch(`${BASE}/model`"));
});

test("the computer use row says what works on the runner", () => {
  const runner = read("runner/api/server.mjs");
  for (const route of ["/exec", "/workspace/read", "/workspace/write"]) assert.ok(runner.includes(`"${route}"`), route);
  assert.match(row("Computer use (local exec daemon, window capture)").web, /On the runner, commands run in bash and file changes work; clicks, keystrokes and screenshots need the local harness/);
});

test("the teammates row does not promise MEMORY.md on planner turns", () => {
  const { web, needs } = row("Bot teammates");
  assert.equal(needs, "harness", "MEMORY.md is read through the harness");
  assert.ok(!read("src/work.ts").includes("memoryDoc"), "the planner decision prompt has no memory document");
  assert.doesNotMatch(web, /on every turn/);
  assert.match(web, /MEMORY\.md .*reaches agent-driver turns, and planner replies only when the decision step fails/);
});

test("the hosted site cannot reach the local harness, as the map note says", () => {
  assert.ok(read("src/harness.ts").includes('RUNNER_URL || "/harness"'));
  assert.ok(read("vite.config.ts").includes("/harness"));
  assert.ok(!read("vercel.json").includes("/harness"));
  assert.match(read("src/i18n.ts"), /local harness is reached through the local dev page/);
});

test("the sign-in row matches the gate the page is wrapped in", () => {
  const main = read("src/main.tsx");
  assert.match(main, /<AuthGate>\{\(user\) => <App user=\{user\} \/>\}<\/AuthGate>/);
  assert.match(read("src/AuthGate.tsx"), /isEmailAllowed\(user\.email\)/);
  assert.match(row("Google sign-in and 1Password").web, /sign-in is required before the app opens, and only allowlisted accounts/);
});
