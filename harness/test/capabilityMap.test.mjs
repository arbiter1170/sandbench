// The capability map (src/capabilities.ts) is a hand-written table. These tests tie a set of
// rows that describe harness, runner and import behavior to the code. They do not pin every
// sentence, so a behavior change can still leave a row out of date. src/capabilities.test.ts
// pins every row's Needs label.
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
  for (const cli of ["@anthropic-ai/claude-code", "@openai/codex", "x.ai/cli", "grok", "codex", "claude.ai/install", "install.sh"]) {
    assert.ok(!dockerfile.includes(cli), cli);
    assert.ok(!runnerPackage.includes(cli), cli);
  }
});

test("each row that depends on more than the page says so", () => {
  const expected = {
    "Bot teammates": "harness",
    "Thinking trace and computer usage": "harness",
    "Computer use (local exec daemon, window capture)": "harness",
    "Agent drivers": "harness",
    "Auto-review rules and approvals": "harness",
    "Connectors and custom MCP": "harness",
    "Group chats": "harnessOrRunner",
    "Model per bot": "harness",
    "Test stack profiles": "harness",
    "Grok Bot migration": "harness",
    "Tasks, routines, and reminders": "harness",
    "Chat with markdown and code": "harnessOrRunner",
  };
  for (const [name, needs] of Object.entries(expected)) assert.equal(row(name).needs, needs, name);
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
    "Tasks, routines, and reminders": ["/schedules", "/triggers", "/due"],
  };
  for (const [name, routes] of Object.entries(needs)) {
    for (const route of routes) {
      assert.ok(harness.includes(`"${route}`), `harness serves ${route}`);
      // A sub-path such as "/triggers/runs" counts as serving it.
      assert.ok(!new RegExp(`["'\`]${route}["'\`/]`).test(runner), `runner does not serve ${route}`);
    }
    assert.equal(row(name).needs, "harness", name);
  }
  assert.match(row("Thinking trace and computer usage").web, /the runner does not serve them/);
  assert.match(row("Tasks, routines, and reminders").web, /Webhooks and recent runs need the local harness/);
});

test("the routines row matches the page's own schedule check", () => {
  // The page's loop stands down whenever a harness or a runner answers /health, and the runner
  // has no schedule routes, so a healthy runner build runs nothing. If it stops answering, the
  // loop runs again.
  assert.match(read("src/App.tsx"), /^\s*if \(sendingRef\.current \|\| harnessRef\.current\) return;/m);
  assert.match(row("Tasks, routines, and reminders").web, /While a runner answers, a runner build does not run routines, even with a tab open; if it stops answering, the page's own check can fire a due routine, and that run counts as done/);
});

test("the migration row lists what the Windows import script drops", () => {
  const { web, state } = row("Grok Bot migration");
  const script = read("scripts/import-grok-desktop.mjs");
  assert.notEqual(state, "working");
  assert.ok(script.includes('schedule: "Weekdays at 9:00"'));
  assert.match(web, /placeholder schedule \(weekdays at 9:00\)/);
  assert.ok(script.includes("bots[index % bots.length]"));
  assert.match(web, /dealt out to bots in turn/);
  // The pack's own list, not the one on each bot.
  assert.match(script, /bots,\r?\n\s+plugins: \[\],\r?\n\s+connectors: \[\],/);
  assert.ok(!script.includes("webhooks"));
  assert.match(web, /writes no connectors or webhooks/);
  assert.ok(script.includes("threads.slice(0, 40)") && script.includes("routines.slice(0, 40)"));
  assert.match(web, /at most 40 chats and 40 routines/);
});

test("rows that say the harness or the runner are served by both", () => {
  // The runner's server file only: routes/index.mjs lists these names as reserved, which is not
  // the same as serving them.
  const runner = read("runner/api/server.mjs");
  const harness = read("harness/server.mjs");
  const both = { "Chat with markdown and code": ["/model"], "Group chats": ["/exec", "/turns"] };
  for (const [name, routes] of Object.entries(both)) {
    assert.equal(row(name).needs, "harnessOrRunner", name);
    for (const route of routes) {
      assert.ok(harness.includes(`"${route}"`), `harness serves ${route}`);
      assert.ok(runner.includes(`route === "${route}"`), `runner serves ${route}`);
    }
  }
  // Every model call from the page goes through this one route.
  assert.ok(read("src/harness.ts").includes("fetch(`${BASE}/model`"));
});

test("a local provider base works only on the harness, as the model and profile rows say", () => {
  assert.ok(read("harness/server.mjs").includes("allowLocal: true"));
  assert.ok(read("runner/api/server.mjs").includes("allowLocal: false"));
  assert.ok(read("src/testProfiles.ts").includes("http://127.0.0.1:11434/v1"));
  assert.match(row("Model per bot").web, /page model calls to a local provider address work only with the local harness/);
  assert.match(row("Test stack profiles").web, /Ready does not check that a local server such as Ollama is running/);
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
  assert.match(read("src/App.tsx"), /system: assembleBotSystem\(\{[\s\S]{0,300}memoryDoc,/, "driver turns get the memory document");
  assert.doesNotMatch(web, /on every turn/);
  assert.match(web, /Without a key or a signed-in CLI driver, replies are local stand-ins/);
  assert.match(web, /MEMORY\.md .*reaches agent-driver turns, and planner replies only when the decision step fails/);
});

test("the hosted site cannot reach the local harness, as the map note says", () => {
  assert.ok(read("src/harness.ts").includes('RUNNER_URL || "/harness"'));
  assert.ok(read("vite.config.ts").includes('"/harness":'));
  assert.ok(read("electron/main.mjs").includes('startsWith("/harness")'));
  assert.ok(!read("vercel.json").includes("/harness"));
  assert.match(read("src/i18n.ts"), /local harness is reached through the local dev page \(npm run dev\) or the desktop app, not the hosted site/);
});

test("the table shows the label, the note states the rule, and the hint is usable", () => {
  assert.ok(read("src/views.tsx").includes("<td>{needsLabel(item)}</td>"));
  const i18n = read("src/i18n.ts");
  assert.match(i18n, /says what must be running for everything in a row to work/);
  assert.match(i18n, /or open the desktop app, which starts its own harness/);
  assert.ok(!i18n.includes("grokbot-poc"));
  assert.ok(read("electron/main.mjs").includes("harness/server.mjs"), "the desktop app starts its own harness");
});

test("the sign-in row matches the gate the page is wrapped in", () => {
  const main = read("src/main.tsx");
  assert.match(main, /<AuthGate>\{\(user\) => <App user=\{user\} \/>\}<\/AuthGate>/);
  assert.match(read("src/AuthGate.tsx"), /^\s*if \(!isEmailAllowed\(user\.email\)\) \{/m);
  assert.match(row("Google sign-in and 1Password").web, /sign-in is required before the app opens, and only allowlisted accounts/);
});
