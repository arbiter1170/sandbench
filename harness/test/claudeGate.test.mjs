// The Claude Code approval hook (harness/drivers/claudeGate.mjs) and how the driver uses it.
// Claude Code runs its built-in read-only shell commands (`cat`, `ls`, read-only `git`)
// without a prompt, so without the hook they would skip the approval card.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const HOME = mkdtempSync(path.join(os.tmpdir(), "sb-gate-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const gate = await import("../drivers/claudeGate.mjs");
const claude = await import("../drivers/claude.mjs");
const { ASK, gateDecision, runGate, GATE_FILE, HOOK_FLAG, ALLOW_ENV } = gate;

const bash = (command) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

test("the hook asks for every shell command the user has not approved, read-only ones included", () => {
  for (const command of ["cat notes.txt", "ls", "git status", "git log -1", "head -n 1 README.md", "pwd", "echo hi", "rm notes.txt"]) {
    assert.deepEqual(gateDecision(bash(command), []), ASK, command);
    assert.deepEqual(gateDecision(bash(command), ["Bash(cat other.txt)", `PowerShell(${command})`]), ASK, command);
  }
  assert.deepEqual(gateDecision({ tool_name: "PowerShell", tool_input: { command: "Get-Date" } }, ["Bash(Get-Date)"]), ASK);
});

test("an approved command goes on to the allow rules only word for word", () => {
  assert.equal(gateDecision(bash("cat notes.txt"), ["Bash(cat notes.txt)"]), null);
  assert.equal(gateDecision({ tool_name: "PowerShell", tool_input: { command: "Get-Date" } }, ["PowerShell(Get-Date)"]), null);
  for (const command of ["cat notes.txt ", " cat notes.txt", "cat  notes.txt", "cat notes.txt && rm x", "CAT notes.txt", "cat notes.txt other.txt"]) {
    assert.deepEqual(gateDecision(bash(command), ["Bash(cat notes.txt)"]), ASK, JSON.stringify(command));
  }
});

test("a request the hook cannot read is asked about, never let through", () => {
  for (const input of [null, "x", 5, {}, { tool_name: "Bash" }, { tool_name: "Bash", tool_input: { command: "" } }, { tool_name: "Bash", tool_input: { command: 5 } }, { tool_name: "Read", tool_input: { file_path: "a" } }]) {
    assert.deepEqual(gateDecision(input, ["Bash(ls)"]), ASK, JSON.stringify(input));
  }
  assert.deepEqual(gateDecision(bash("ls"), null), ASK);
  assert.deepEqual(gateDecision(bash("ls"), "Bash(ls)"), ASK);
  for (const [stdin, allow] of [["not json", "[]"], [JSON.stringify(bash("ls")), undefined], [JSON.stringify(bash("ls")), "not json"], [JSON.stringify(bash("ls")), '{"0":"Bash(ls)"}']]) {
    assert.equal(runGate(stdin, allow === undefined ? {} : { [ALLOW_ENV]: allow }), JSON.stringify(ASK), `${stdin} / ${allow}`);
  }
  assert.equal(runGate(JSON.stringify(bash("ls")), { [ALLOW_ENV]: '["Bash(ls)"]' }), "");
});

test("the hook file answers on stdout when Claude Code runs it, and does nothing when imported", () => {
  const run = (input, allow) => spawnSync(process.execPath, [GATE_FILE, HOOK_FLAG], { input, env: { ...process.env, [ALLOW_ENV]: allow }, encoding: "utf8" });
  const asked = run(JSON.stringify(bash("cat notes.txt")), "[]");
  assert.equal(asked.status, 0);
  assert.deepEqual(JSON.parse(asked.stdout), ASK);
  assert.equal(JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision, "ask");
  const passed = run(JSON.stringify(bash("cat notes.txt")), '["Bash(cat notes.txt)"]');
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout, "");
  assert.deepEqual(JSON.parse(run("garbage", "[]").stdout), ASK);
  const imported = spawnSync(process.execPath, [GATE_FILE], { input: JSON.stringify(bash("ls")), encoding: "utf8" });
  assert.equal(imported.stdout, "");
  assert.doesNotThrow(() => claude.checkGate());
});

test("the driver will not start a turn when the hook does not answer", () => {
  const dir = mkdtempSync(path.join(HOME, "bad-gate-"));
  const silent = path.join(dir, "silent.mjs");
  writeFileSync(silent, "");
  const crash = path.join(dir, "crash.mjs");
  writeFileSync(crash, "throw new Error('boom')");
  const allowAll = path.join(dir, "allow.mjs");
  writeFileSync(allowAll, "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }))");
  for (const file of [silent, crash, allowAll, path.join(dir, "missing.mjs")]) {
    assert.throws(() => claude.checkGate(process.execPath, file), /approval hook/, file);
  }
  assert.throws(() => claude.checkGate(path.join(dir, "no-node"), GATE_FILE), /approval hook/);
});

test("the settings file always runs the hook first for Bash and PowerShell, whatever extras say", () => {
  const command = claude.gateHookCommand();
  assert.equal(command, `"${process.execPath}" "${GATE_FILE}" ${HOOK_FLAG}`);
  const plain = JSON.parse(claude.buildClaudeSettings(["Bash(ls)"]));
  assert.deepEqual(plain.permissions, { allow: ["Bash(ls)"] });
  assert.deepEqual(plain.hooks.PreToolUse, [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command, timeout: 30 }] }]);
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] };
  const merged = JSON.parse(
    claude.buildClaudeSettings(["Bash(ls)"], {
      settings: { disableAllHooks: true, hooks: { PreToolUse: [other], Stop: [{ hooks: [] }] }, permissions: { allow: ["Bash(*)"], defaultMode: "bypassPermissions" } },
    }),
  );
  assert.equal("disableAllHooks" in merged, false);
  assert.deepEqual(merged.permissions, { allow: ["Bash(ls)"] });
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].command, command);
  assert.deepEqual(merged.hooks.PreToolUse[1], other);
  assert.deepEqual(merged.hooks.Stop, [{ hooks: [] }]);
  for (const hooks of [[], "x", null]) {
    assert.equal(JSON.parse(claude.buildClaudeSettings([], { settings: { hooks } })).hooks.PreToolUse[0].hooks[0].command, command, JSON.stringify(hooks));
  }
});

test("a hook path a shell would still expand inside quotes is refused", () => {
  for (const bad of ['/opt/a"b/node', "/opt/$HOME/node", "/opt/`id`/node", "/opt/%PATH%/node", "/opt/a!b/node", "/opt/a\nb/node", "relative/node", ""]) {
    assert.throws(() => claude.gateHookCommand(bad, GATE_FILE), /approval hook/, JSON.stringify(bad));
    assert.throws(() => claude.gateHookCommand(process.execPath, bad), /approval hook/, JSON.stringify(bad));
  }
  assert.equal(claude.gateHookCommand("/opt/my node/node", "/srv/a b/claudeGate.mjs"), `"/opt/my node/node" "/srv/a b/claudeGate.mjs" ${HOOK_FLAG}`);
});

// A stand-in `claude` CLI: it records the settings and env it was given, then plays a script
// of stream-json lines. Only POSIX can run it as a program, so this part skips on Windows.
function fakeCli(lines, lingerMs = 200) {
  const dir = mkdtempSync(path.join(HOME, "fake-cli-"));
  const bin = path.join(dir, "claude");
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("fs");
process.on("SIGTERM", () => process.exit(143)); // as the real CLI does
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(dir, "seen.json"))}, JSON.stringify({ settings: JSON.parse(fs.readFileSync(args[args.indexOf("--settings") + 1], "utf8")), allowEnv: process.env.${ALLOW_ENV} }));
for (const line of ${JSON.stringify(lines)}) process.stdout.write(JSON.stringify(line) + "\\n");
setTimeout(() => {}, ${lingerMs});
`,
  );
  chmodSync(bin, 0o755);
  return { bin, seen: () => JSON.parse(readFileSync(path.join(dir, "seen.json"), "utf8")) };
}

const posix = process.platform !== "win32";
const turn = () => ({ id: `t${Math.random().toString(36).slice(2, 10)}`, system: "", history: [], prompt: "hi", model: "sonnet", cwd: HOME, extras: {} });
const io = () => {
  const cards = [];
  const events = [];
  return { cards, events, signal: new AbortController().signal, current: null, emit: (event) => events.push(event), requestPermission: async (request) => (cards.push(request), false) };
};

test("a shell command that runs without approval stops the turn", { skip: !posix }, async () => {
  const { bin, seen } = fakeCli([
    { type: "system", subtype: "init", session_id: "session-0001" },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "cat notes.txt" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "fake notes", is_error: false }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "after the unapproved run" }] } },
    { type: "result", session_id: "session-0001", result: "done", permission_denials: [] },
  ], 20_000);
  process.env.SANDBENCH_CLAUDE_BIN = bin;
  try {
    const turnIo = io();
    const started = Date.now();
    await assert.rejects(claude.startTurn(turn(), turnIo).done, /ran a shell command nobody approved \(cat notes\.txt\)/);
    // Stopped at once: nothing after the unapproved run reaches the page, and the CLI was not
    // left to finish (it would linger for 20 seconds).
    assert.ok(Date.now() - started < 10_000);
    assert.equal(turnIo.events.some((event) => event.type === "tool_end" || event.type === "message_delta"), false);
    const { settings, allowEnv } = seen();
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, claude.gateHookCommand());
    assert.equal(allowEnv, "[]");
  } finally {
    delete process.env.SANDBENCH_CLAUDE_BIN;
  }
});

test("a denied shell command becomes a card; a refused call is not an unapproved run (Claude Code's own Read tool is outside the hook, a known gap)", { skip: !posix }, async () => {
  const { bin } = fakeCli([
    { type: "system", subtype: "init", session_id: "session-0002" },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "cat notes.txt" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Waiting for approval in Sandbench.", is_error: true }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu2", name: "Read", input: { file_path: "notes.txt" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu2", content: "fake notes", is_error: false }] } },
    { type: "result", session_id: "session-0002", result: "done", permission_denials: [{ tool_name: "Bash", tool_input: { command: "cat notes.txt" } }] },
  ]);
  process.env.SANDBENCH_CLAUDE_BIN = bin;
  try {
    const turnIo = io();
    await claude.startTurn(turn(), turnIo).done;
    assert.deepEqual(
      turnIo.cards.map((card) => [card.command, card.tool]),
      [["cat notes.txt", "Bash"]],
    );
  } finally {
    delete process.env.SANDBENCH_CLAUDE_BIN;
  }
});

test("a turn checks the hook before it starts Claude Code", { skip: !posix }, async () => {
  const { bin } = fakeCli([{ type: "result", session_id: "session-0003", result: "done", permission_denials: [] }]);
  process.env.SANDBENCH_CLAUDE_BIN = bin;
  try {
    let checked = 0;
    await claude.startTurn(turn(), io(), { checkGate: () => (checked += 1) }).done;
    assert.equal(checked, 1);
    await assert.rejects(
      claude.startTurn(turn(), io(), {
        checkGate: () => {
          throw new Error("The Claude Code approval hook did not answer as expected, so the turn was not started.");
        },
      }).done,
      /approval hook/,
    );
    await claude.startTurn(turn(), io()).done;
  } finally {
    delete process.env.SANDBENCH_CLAUDE_BIN;
  }
});
