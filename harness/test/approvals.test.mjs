// Approval behavior at the execution boundary: what actually reaches runShell during a driver
// turn. The fake commands are recorded, never executed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DRIVERS } from "../drivers/index.mjs";
import { createSecretStore } from "../secrets.mjs";
import { createTurns } from "../turns.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-approvals-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// A driver that asks for each scripted request in turn and runs it only when allowed, the
// same contract the real drivers follow (drivers/index.mjs).
const scripted = {
  id: "test-scripted",
  label: "Scripted (tests only)",
  available: async () => ({ ok: true }),
  startTurn(turn, io) {
    const done = (async () => {
      for (const request of JSON.parse(turn.prompt)) {
        if (await io.requestPermission({ reason: "test", ...request })) await io.runCommand(request.command);
      }
    })();
    return { done, interrupt: () => undefined };
  },
};
DRIVERS.push(scripted);
after(() => DRIVERS.splice(DRIVERS.indexOf(scripted), 1));

function harness(extra = {}) {
  const ran = [];
  const turns = createTurns({
    runShell: async (command) => {
      ran.push(command);
      return { code: 0, stdout: "", stderr: "", ms: 1 };
    },
    resolveFolder: () => tmp,
    ...extra,
  });
  return { turns, ran };
}

function watch(turns, onEvent = () => {}) {
  const events = [];
  let close = () => {};
  const finished = new Promise((resolve) => {
    const res = {
      writeHead() {},
      write(chunk) {
        const line = String(chunk).split("\n").find((item) => item.startsWith("data: "));
        if (!line) return;
        const event = JSON.parse(line.slice(6));
        events.push(event);
        onEvent(event);
        if (event.type === "done" || event.type === "error") resolve(event);
      },
      on() {},
      end() {},
    };
    turns.subscribe({ on: (name, fn) => name === "close" && (close = fn) }, res, new URL("http://x/events?after=0"));
  });
  return { events, finished: finished.finally(() => close()) };
}

async function scriptedTurn(requests, allow, answer = () => undefined, body = {}) {
  const { turns, ran } = harness();
  const { events, finished } = watch(turns, (event) => {
    if (event.type === "permission_request" && !event.auto && !event.denied) {
      const choice = answer(event);
      // The card is published before it is registered, as the page always answers later.
      if (choice !== undefined) setImmediate(() => turns.permit(event.permissionId, choice));
    }
  });
  turns.start({ driver: scripted.id, prompt: JSON.stringify(requests), allow, ...body });
  const last = await finished;
  return { ran, events, last, requests: events.filter((event) => event.type === "permission_request") };
}

test("a `git` rule auto-runs git status but `git push` waits for a card and does not run when denied", async () => {
  const { ran, requests } = await scriptedTurn(
    [{ command: "git status" }, { command: "git push origin main" }, { command: "git push --force origin main", tool: "Bash" }],
    ["git"],
    () => false,
  );
  assert.deepEqual(ran, ["git status"]);
  assert.deepEqual(requests.map((event) => [event.command, event.auto]), [
    ["git status", true],
    ["git push origin main", false],
    ["git push --force origin main", false],
  ]);
});

test("compound, redirected and substituted commands under a matching rule wait and never run unapproved", async () => {
  const commands = ["Get-Date; Remove-Item -Recurse C:\\", "Get-Date | Out-File x", "ls > out.txt", "echo $(whoami)", "Get-Date && del x"];
  const { ran, requests } = await scriptedTurn(commands.map((command) => ({ command })), ["Get-Date", "ls", "echo"], () => false);
  assert.deepEqual(ran, []);
  assert.ok(requests.every((event) => event.auto === false));
});

test("non-shell tool requests (file writes, web fetches) always wait even when the rule names the tool", async () => {
  const { ran, requests } = await scriptedTurn(
    [
      { command: "Write notes.txt", tool: "Write" },
      { command: "WebFetch https://example.test", tool: "WebFetch" },
    ],
    ["Write", "Write notes.txt", "WebFetch"],
    () => false,
  );
  assert.deepEqual(ran, []);
  assert.deepEqual(requests.map((event) => event.auto), [false, false]);
});

test("the real drivers label their requests, so the gate can tell a shell command from another tool", () => {
  const driver = (name) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../drivers", `${name}.mjs`), "utf8");
  assert.ok(driver("claude").includes("tool: denial.tool_name"));
  assert.equal(driver("codex").match(/tool: "codex"/g)?.length, 2);
  assert.ok(driver("grok").includes('tool: "grok"'));
});

test("the gate uses the rules in the request, not built-in ones", async () => {
  const covered = await scriptedTurn([{ command: "pwd" }], ["pwd"], () => false);
  assert.deepEqual(covered.ran, ["pwd"]);
  const uncovered = await scriptedTurn([{ command: "pwd" }], ["git"], () => false);
  assert.deepEqual(uncovered.ran, [], "this request's rules do not cover it");
});

test("an explicit approval runs that one request only; the same command asks again next time", async () => {
  let answered = 0;
  const { ran, requests } = await scriptedTurn([{ command: "git push origin main" }, { command: "git push origin main" }], ["git"], () => (answered++ === 0 ? true : false));
  assert.deepEqual(ran, ["git push origin main"]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((event) => event.auto === false));
});

test("an unattended turn denies what the rules do not cover and runs nothing else", async () => {
  const { ran, requests } = await scriptedTurn([{ command: "git status" }, { command: "git push origin main" }], ["git"], () => undefined, { unattendedDeny: true });
  assert.deepEqual(ran, ["git status"]);
  assert.equal(requests[1].denied, true);
});

test("a card nobody answers expires as a denial and the command does not run", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { turns, ran } = harness();
    const { events, finished } = watch(turns, (event) => {
      if (event.type === "permission_request" && !event.auto) setImmediate(() => mock.timers.tick(30 * 60_000));
    });
    turns.start({ driver: scripted.id, prompt: JSON.stringify([{ command: "git push origin main" }]), allow: ["git"] });
    await finished;
    assert.deepEqual(ran, []);
    assert.deepEqual(events.filter((event) => event.type === "permission_resolved").map((event) => event.allow), [false]);
  } finally {
    mock.timers.reset();
  }
});

test("stopping a turn while a card waits denies it and nothing runs", async () => {
  const { turns, ran } = harness();
  let id = "";
  const { events, finished } = watch(turns, (event) => {
    if (event.type === "permission_request" && !event.auto) setImmediate(() => turns.interrupt(id));
  });
  ({ id } = turns.start({ driver: scripted.id, prompt: JSON.stringify([{ command: "git push origin main" }]), allow: ["git"] }));
  await finished;
  assert.deepEqual(ran, []);
  assert.equal(events.find((event) => event.type === "permission_resolved")?.allow, false);
});

test("the real http driver: a model asking for `git push` under a `git` rule gets a card, and a denial keeps it from running", async () => {
  const replies = [
    { choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "git status" }) } }] } }] },
    { choices: [{ message: { content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "git push origin main" }) } }] } }] },
    { choices: [{ message: { content: "done" } }] },
  ];
  const upstream = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(replies.shift() ?? { choices: [{ message: { content: "done" } }] }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const secrets = createSecretStore({ file: path.join(tmp, "s.json"), env: {} });
    secrets.set("COMPAT_API_KEY", "test-key-not-real-0000");
    const { turns, ran } = harness({ secrets });
    const { events, finished } = watch(turns, (event) => {
      if (event.type === "permission_request" && !event.auto) setImmediate(() => turns.permit(event.permissionId, false));
    });
    turns.start({ driver: "http", prompt: "tidy up", model: "m", base: `http://127.0.0.1:${upstream.address().port}/v1`, secret: "COMPAT_API_KEY", allow: ["git"] });
    const last = await finished;
    assert.equal(last.type, "done");
    assert.deepEqual(ran, ["git status"]);
    assert.deepEqual(
      events.filter((event) => event.type === "permission_request").map((event) => [event.command, event.auto]),
      [
        ["git status", true],
        ["git push origin main", false],
      ],
    );
  } finally {
    upstream.close();
  }
});
