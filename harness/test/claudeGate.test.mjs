// The Claude Code approval hook (harness/drivers/claudeGate.mjs) and how the driver uses it.
// Claude Code runs its built-in read-only shell commands (`cat`, `ls`, read-only `git`)
// without a prompt, so without the hook they would skip the approval card.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const HOME = mkdtempSync(path.join(os.tmpdir(), "sb-gate-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const gate = await import("../drivers/claudeGate.mjs");
const claude = await import("../drivers/claude.mjs");
const { ASK, REASON, gateDecision, gateKey, runGate, HOOK_FLAG } = gate;
const GATE_FILE = fileURLToPath(new URL("../drivers/claudeGate.mjs", import.meta.url));
const SETTINGS_DIR = path.join(HOME, ".sandbench", "driver-settings");

const bash = (command) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
let lists = 0;
const listFile = (approved) => {
  const file = path.join(HOME, `list-${(lists += 1)}.approved.json`);
  writeFileSync(file, typeof approved === "string" ? approved : JSON.stringify(approved));
  return file;
};

test("the hook asks for every shell command the user has not approved, read-only ones included", () => {
  for (const command of ["cat notes.txt", "ls", "git status", "git log -1", "head -n 1 README.md", "pwd", "echo hi", "rm notes.txt"]) {
    assert.deepEqual(gateDecision(bash(command), []), ASK, command);
    assert.deepEqual(gateDecision(bash(command), ["Bash(cat other.txt)", `PowerShell(${command})`, command]), ASK, command);
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

test("approvals are keyed by the exact command, and a Monitor call is keyed as the Bash call Claude Code sends", () => {
  assert.equal(gateKey("Bash", { command: "cat notes.txt" }), "Bash(cat notes.txt)");
  assert.equal(gateKey("Monitor", { command: "cat notes.txt", description: "x" }), "Bash(cat notes.txt)");
  assert.equal(gateKey("PowerShell", { command: "Get-Date" }), "PowerShell(Get-Date)");
  assert.equal(gateKey("Read", { file_path: "notes.txt" }), "Read(notes.txt)");
  assert.equal(gateKey("Glob", { path: "src" }), "Glob(src)");
  assert.equal(gateKey("WebSearch", { query: "x" }), "WebSearch(x)");
  assert.equal(gateKey("WebFetch", { url: "https://example.test/a", prompt: "p" }), "WebFetch(https://example.test/a)");
  assert.equal(gateKey("Write", { file_path: "/w/a.txt", content: "x" }), "Write(/w/a.txt)");
  assert.equal(gateKey("Edit", { file_path: "/w/a.txt", old_string: "a", new_string: "b" }), "Edit(/w/a.txt)");
  assert.equal(gateKey("NotebookEdit", { notebook_path: "/w/n.ipynb" }), "NotebookEdit(/w/n.ipynb)");
  assert.equal(gateKey("mcp__srv__send", { to: "a", body: { x: 1, a: 2 } }), gateKey("mcp__srv__send", { body: { a: 2, x: 1 }, to: "a" }));
  assert.notEqual(gateKey("mcp__srv__send", { to: "a" }), gateKey("mcp__srv__send", { to: "b" }));
  assert.equal(gateKey("TodoWrite", { todos: [] }), "TodoWrite");
  for (const [tool, input] of [["WebFetch", {}], ["WebFetch", { url: "" }], ["WebSearch", {}], ["Write", { content: "x" }], ["Edit", {}], ["mcp__srv__send", undefined], ["mcp__srv__send", []], ["Bash", { command: "" }], ["Bash", {}], ["PowerShell", { file_path: "x" }], ["Bash", undefined], ["", { command: "ls" }], [null, {}], [5, {}]]) assert.equal(gateKey(tool, input), null, JSON.stringify([tool, input]));
  // An approved non-shell call the hook is sent goes through once approved (it was a loop before).
  assert.equal(gateDecision({ tool_name: "Read", tool_input: { file_path: "notes.txt" } }, ["Read(notes.txt)"]), null);
  assert.deepEqual(gateDecision({ tool_name: "Read", tool_input: { file_path: "notes.txt" } }, ["Read(other.txt)", "Read"]), ASK);
});

test("a request the hook cannot read is asked about, never let through", () => {
  for (const input of [null, "x", 5, {}, { tool_name: "Bash" }, { tool_name: "Bash", tool_input: { command: "" } }, { tool_name: "Bash", tool_input: { command: 5 } }]) {
    assert.deepEqual(gateDecision(input, ["Bash(ls)", "Bash", "Bash()"]), ASK, JSON.stringify(input));
  }
  assert.deepEqual(gateDecision(bash("ls"), null), ASK);
  assert.deepEqual(gateDecision(bash("ls"), "Bash(ls)"), ASK);
  for (const [stdin, list] of [["not json", "[]"], [JSON.stringify(bash("ls")), "not json"], [JSON.stringify(bash("ls")), '{"0":"Bash(ls)"}']]) {
    assert.equal(runGate(stdin, listFile(list)), JSON.stringify(ASK), `${stdin} / ${list}`);
  }
  assert.equal(runGate(JSON.stringify(bash("ls")), path.join(HOME, "missing.approved.json")), JSON.stringify(ASK));
  assert.equal(runGate(JSON.stringify(bash("ls")), undefined), JSON.stringify(ASK));
  assert.equal(runGate(JSON.stringify(bash("ls")), listFile(["Bash(ls)"])), "");
});

test("the hook reads its list from the file on its command line and ignores the environment", () => {
  const run = (input, args, env = {}) => spawnSync(process.execPath, [GATE_FILE, ...args], { input, env: { ...process.env, ...env }, encoding: "utf8" });
  const asked = run(JSON.stringify(bash("cat notes.txt")), [HOOK_FLAG, listFile([])], { SANDBENCH_CLAUDE_ALLOW: '["Bash(cat notes.txt)"]' });
  assert.equal(asked.status, 0);
  assert.deepEqual(JSON.parse(asked.stdout), ASK);
  assert.equal(JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision, "ask");
  const passed = run(JSON.stringify(bash("cat notes.txt")), [HOOK_FLAG, listFile(["Bash(cat notes.txt)"])]);
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout, "");
  assert.deepEqual(JSON.parse(run("garbage", [HOOK_FLAG, listFile([])]).stdout), ASK);
  assert.deepEqual(JSON.parse(run(JSON.stringify(bash("ls")), [HOOK_FLAG]).stdout), ASK);
  const imported = run(JSON.stringify(bash("ls")), []);
  assert.equal(imported.stdout, "");
  // A program that imports the hook file (the harness) and has arguments of its own is not the hook.
  const host = path.join(HOME, "host.mjs");
  writeFileSync(host, `await import(${JSON.stringify(GATE_FILE)});`);
  const hosted = spawnSync(process.execPath, [host, "--port", "8799"], { input: JSON.stringify(bash("ls")), encoding: "utf8" });
  assert.equal(hosted.status, 0);
  assert.equal(hosted.stdout, "");
});

test("the driver will not start a turn when the hook does not answer both ways", () => {
  const dir = mkdtempSync(path.join(HOME, "bad-gate-"));
  const list = path.join(dir, "t.approved.json");
  const script = (name, body) => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return file;
  };
  const alwaysAsk = `process.stdout.write(${JSON.stringify(JSON.stringify(ASK))})`;
  for (const file of [
    script("silent.mjs", ""),
    script("crash.mjs", "throw new Error('boom')"),
    script("allow.mjs", "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }))"),
    // Asks for everything, so an approved command would never run.
    script("always-ask.mjs", alwaysAsk),
    script("exit1.mjs", `${alwaysAsk}; process.exitCode = 1`),
    // Exits 1 only when it asks: Claude Code would take the refusal as no answer and run the call.
    script("ask-exit1.mjs", `const list = process.argv[3]; process.argv.length = 2; const { runGate } = await import(${JSON.stringify(GATE_FILE)}); const { readFileSync } = await import("node:fs"); const out = runGate(readFileSync(0, "utf8"), list); process.stdout.write(out); if (out) process.exitCode = 1;`),
    // Answers both ways correctly but exits 1, which Claude Code takes as no answer.
    script("right-but-exit1.mjs", `const list = process.argv[3]; process.argv.length = 2; const { runGate } = await import(${JSON.stringify(GATE_FILE)}); const { readFileSync } = await import("node:fs"); process.stdout.write(runGate(readFileSync(0, "utf8"), list)); process.exitCode = 1;`),
    path.join(dir, "missing.mjs"),
  ]) {
    assert.throws(() => claude.checkGate(list, process.execPath, file), /approval hook/, file);
  }
  assert.throws(() => claude.checkGate(list, path.join(dir, "no-node"), GATE_FILE), /approval hook/);
  assert.doesNotThrow(() => claude.checkGate(list));
  assert.equal(readFileSync(list, "utf8"), "[]");
  // It only ever writes a `.approved.json` list file.
  for (const bad of [path.join(dir, "notes.txt"), "relative.approved.json", undefined]) {
    assert.throws(() => claude.checkGate(bad), /list file/, String(bad));
    assert.throws(() => claude.gateHookCommand(bad), /list file/, String(bad));
  }
  assert.equal(existsSync(path.join(dir, "notes.txt")), false);
});

test("the settings file always runs the hook first, keeps hooks on, and clears what would change the hook process", () => {
  const command = claude.gateHookCommand("/tmp/t.approved.json");
  assert.equal(command, `"${process.execPath}" "${GATE_FILE}" ${HOOK_FLAG} "/tmp/t.approved.json"`);
  const plain = JSON.parse(claude.buildClaudeSettings(["Bash(ls)"], {}, command));
  assert.deepEqual(plain.permissions, { allow: ["Bash(ls)"] });
  assert.equal(plain.disableAllHooks, false);
  assert.deepEqual(plain.env, { NODE_OPTIONS: "", BASH_ENV: "", ENV: "" });
  assert.deepEqual(plain.hooks.PreToolUse, [{ matcher: "Bash|PowerShell|Monitor|WebFetch|WebSearch|Write|Edit|MultiEdit|NotebookEdit|mcp__.*", hooks: [{ type: "command", command, timeout: 30, onFailure: "block" }] }]);
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] };
  const merged = JSON.parse(
    claude.buildClaudeSettings(
      ["Bash(ls)"],
      {
        settings: {
          disableAllHooks: true,
          env: { NODE_OPTIONS: "--require ./evil.cjs", BASH_ENV: "./evil.sh", ENV: "./evil.sh", KEEP: "1" },
          hooks: { PreToolUse: [other], Stop: [{ hooks: [] }] },
          permissions: { allow: ["Bash(*)"], defaultMode: "bypassPermissions" },
        },
      },
      command,
    ),
  );
  assert.equal(merged.disableAllHooks, false);
  assert.deepEqual(merged.env, { KEEP: "1", NODE_OPTIONS: "", BASH_ENV: "", ENV: "" });
  assert.deepEqual(merged.permissions, { allow: ["Bash(ls)"] });
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].command, command);
  assert.deepEqual(merged.hooks.PreToolUse[1], other);
  assert.deepEqual(merged.hooks.Stop, [{ hooks: [] }]);
  for (const hooks of [[], "x", null]) {
    assert.equal(JSON.parse(claude.buildClaudeSettings([], { settings: { hooks } }, command)).hooks.PreToolUse[0].hooks[0].command, command, JSON.stringify(hooks));
  }
  for (const env of [[], "x", null]) assert.deepEqual(JSON.parse(claude.buildClaudeSettings([], { settings: { env } }, command)).env, { NODE_OPTIONS: "", BASH_ENV: "", ENV: "" });
  assert.throws(() => claude.buildClaudeSettings([], {}), /hook/);
});

test("Claude Code is started without the turn folder's settings or skills", () => {
  const args = claude.buildClaudeArgs({ settingsFile: "/tmp/s.json", model: null, sessionId: "" });
  assert.equal(args[args.indexOf("--setting-sources") + 1], "user");
  assert.ok(args.includes("--disable-slash-commands"));
});

test("a hook path a shell would still expand inside quotes is refused", () => {
  for (const bad of ['/opt/a"b/node', "/opt/$HOME/node", "/opt/`id`/node", "/opt/%PATH%/node", "/opt/a!b/node", "/opt/a\nb/node", "relative/node", ""]) {
    assert.throws(() => claude.gateHookCommand("/tmp/l.approved.json", bad, GATE_FILE), /approval hook/, JSON.stringify(bad));
    assert.throws(() => claude.gateHookCommand("/tmp/l.approved.json", process.execPath, bad), /approval hook/, JSON.stringify(bad));
    if (/["$`%!\n]/.test(bad)) assert.throws(() => claude.gateHookCommand(`/tmp/${bad}x.approved.json`), /approval hook/, JSON.stringify(bad));
  }
  assert.equal(
    claude.gateHookCommand("/srv/l.approved.json", "/opt/my node/node", "/srv/a b/claudeGate.mjs"),
    `"/opt/my node/node" "/srv/a b/claudeGate.mjs" ${HOOK_FLAG} "/srv/l.approved.json"`,
  );
});

// A stand-in `claude` CLI: it records the arguments, the settings and what the hook's list file
// held, then plays a script of stream-json lines. POSIX only, so this part skips on Windows.
function fakeCli(lines, { lingerMs = 200, readStdin = true } = {}) {
  const dir = mkdtempSync(path.join(HOME, "fake-cli-"));
  const bin = path.join(dir, "claude");
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("fs");
process.on("SIGTERM", () => process.exit(143)); // as the real CLI does
const args = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
const list = settings.hooks.PreToolUse[0].hooks[0].command.match(/"([^"]+)"$/)[1];
fs.appendFileSync(${JSON.stringify(path.join(dir, "seen.jsonl"))}, JSON.stringify({ args, settings, list: JSON.parse(fs.readFileSync(list, "utf8")) }) + "\\n");
${readStdin ? "" : "process.exit(0);"}
for (const line of ${JSON.stringify(lines)}) process.stdout.write(JSON.stringify(line) + "\\n");
setTimeout(() => {}, ${lingerMs});
`,
  );
  chmodSync(bin, 0o755);
  return { bin, seen: () => readFileSync(path.join(dir, "seen.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) };
}

const posix = process.platform !== "win32";
const turn = () => ({ id: `t${Math.random().toString(36).slice(2, 10)}`, system: "", history: [], prompt: "hi", model: "sonnet", cwd: HOME, extras: {} });
const io = (approve = false) => {
  const cards = [];
  const events = [];
  const turnIo = {
    cards,
    events,
    signal: new AbortController().signal,
    current: null,
    emit: (event) => events.push(event),
    requestPermission: async (request) => {
      cards.push(request);
      turnIo.current = `p${cards.length}`;
      return approve;
    },
  };
  return turnIo;
};
const withCli = async (cli, run) => {
  process.env.SANDBENCH_CLAUDE_BIN = cli.bin;
  try {
    await run();
  } finally {
    delete process.env.SANDBENCH_CLAUDE_BIN;
  }
};
const ran = (id, name, input, content, isError) => [
  { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } },
];

for (const [label, content, isError] of [
  ["succeeds", "fake notes", false],
  ["exits non-zero", "Exit code 1\nfake notes\ncat: missing.txt: No such file", true],
  ["fails in a way that only looks like the refusal", `${REASON}\nfake notes`, true],
  ["prints the refusal text but succeeds", REASON, false],
]) {
  test(`a shell command that runs without approval and ${label} stops the turn`, { skip: !posix }, async () => {
    const cli = fakeCli(
      [
        { type: "system", subtype: "init", session_id: "session-0001" },
        ...ran("tu1", "Bash", { command: "cat notes.txt missing.txt" }, content, isError),
        { type: "assistant", message: { content: [{ type: "text", text: "after the unapproved run" }] } },
        { type: "result", session_id: "session-0001", result: "done", permission_denials: [] },
      ],
      { lingerMs: 20_000 },
    );
    await withCli(cli, async () => {
      const turnIo = io();
      const started = Date.now();
      await assert.rejects(claude.startTurn(turn(), turnIo).done, /ran a command nobody approved \(cat notes\.txt missing\.txt\)/);
      // Stopped at once: nothing after the run reaches the page, and the CLI was not left to finish.
      assert.ok(Date.now() - started < 10_000);
      assert.equal(turnIo.events.some((event) => event.type === "tool_end" || event.type === "message_delta"), false);
      const [{ settings, list }] = cli.seen();
      assert.equal(settings.disableAllHooks, false);
      assert.deepEqual(list, []);
    });
  });
}

test("a Monitor call that runs without approval stops the turn too", { skip: !posix }, async () => {
  const cli = fakeCli([
    { type: "system", subtype: "init", session_id: "session-0005" },
    ...ran("tu1", "Monitor", { command: "cat notes.txt", description: "x" }, "Monitor started", false),
    { type: "result", session_id: "session-0005", result: "done", permission_denials: [] },
  ]);
  await withCli(cli, async () => {
    await assert.rejects(claude.startTurn(turn(), io()).done, /nobody approved \(Monitor cat notes\.txt\)/);
  });
});

test("a refused call becomes a card, and the approved call is in the hook's list on the next round", { skip: !posix }, async () => {
  const cli = fakeCli([
    { type: "system", subtype: "init", session_id: "session-0002" },
    ...ran("tu1", "Bash", { command: "cat notes.txt" }, REASON, true),
    ...ran("tu2", "Monitor", { command: "tail -f log.txt", description: "x" }, REASON, true),
    // Claude Code's own Read tool is outside the hook (a known gap): it is not an unapproved run.
    ...ran("tu3", "Read", { file_path: "notes.txt" }, "fake notes", false),
    {
      type: "result",
      session_id: "session-0002",
      result: "done",
      permission_denials: [
        { tool_name: "Bash", tool_input: { command: "cat notes.txt" } },
        { tool_name: "Monitor", tool_input: { command: "tail -f log.txt", description: "x" } },
      ],
    },
  ]);
  await withCli(cli, async () => {
    const turnIo = io(true);
    // Later rounds replay the same refusals; their keys are approved by then, so it is not a stop.
    await claude.startTurn(turn(), turnIo).done;
    assert.deepEqual(
      turnIo.cards.slice(0, 2).map((card) => [card.command, card.tool]),
      [
        ["cat notes.txt", "Bash"],
        ["Monitor tail -f log.txt", "Monitor"],
      ],
    );
    const seen = cli.seen();
    assert.deepEqual(seen[0].list, []);
    assert.deepEqual(seen[1].list, ["Bash(cat notes.txt)", "Bash(tail -f log.txt)"]);
    assert.deepEqual(seen[1].settings.permissions.allow, ["Bash(cat notes.txt)", "Monitor"]);
    for (const { args } of seen) {
      assert.ok(args.includes("--disable-slash-commands"));
      assert.equal(args[args.indexOf("--setting-sources") + 1], "user");
    }
  });
  assert.deepEqual(
    readdirSync(SETTINGS_DIR).filter((name) => name.endsWith(".json")),
    [],
    "the settings and list files are removed after the turn",
  );
});

test("a turn checks the hook before it starts Claude Code", { skip: !posix }, async () => {
  const cli = fakeCli([{ type: "result", session_id: "session-0003", result: "done", permission_denials: [] }]);
  await withCli(cli, async () => {
    const calls = [];
    await claude.startTurn(turn(), io(), { checkGate: (file) => calls.push(file) }).done;
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\.approved\.json$/);
    assert.equal(path.dirname(calls[0]), SETTINGS_DIR);
    await assert.rejects(
      claude.startTurn(turn(), io(), {
        checkGate: () => {
          throw new Error("The Claude Code approval hook did not answer as expected, so the turn was not started.");
        },
      }).done,
      /approval hook/,
    );
    await claude.startTurn(turn(), io()).done;
  });
});

test("a CLI that exits without reading its prompt does not crash the harness", { skip: !posix }, async () => {
  const cli = fakeCli([], { readStdin: false });
  await withCli(cli, async () => {
    const big = { ...turn(), prompt: "x".repeat(4 * 1024 * 1024) };
    await assert.rejects(claude.startTurn(big, io()).done, /without a result|exited/);
  });
});

test("one approved WebFetch or Write covers that exact call only, and the next one still gets its own card", { skip: !posix }, async () => {
  const refused = (id, name, input) => ran(id, name, input, REASON, true);
  const fetchOne = { url: "https://example.test/one", prompt: "x" };
  const fetchTwo = { url: "https://example.test/two?d=fake", prompt: "x" };
  const write = { file_path: "/w/a.txt", content: "hello" };
  const cli = fakeCli([
    { type: "system", subtype: "init", session_id: "session-0006" },
    ...refused("tu1", "WebFetch", fetchOne),
    ...refused("tu2", "Write", write),
    ...refused("tu3", "WebFetch", fetchTwo),
    {
      type: "result",
      session_id: "session-0006",
      result: "done",
      permission_denials: [
        { tool_name: "WebFetch", tool_input: fetchOne },
        { tool_name: "Write", tool_input: write },
        { tool_name: "WebFetch", tool_input: fetchTwo },
      ],
    },
  ]);
  await withCli(cli, async () => {
    const turnIo = io(false);
    let asked = 0;
    // Approve the first two cards (WebFetch one, Write), deny the rest.
    turnIo.requestPermission = async (request) => {
      turnIo.cards.push(request);
      turnIo.current = `p${turnIo.cards.length}`;
      asked += 1;
      return asked <= 2;
    };
    await claude.startTurn(turn(), turnIo).done;
    assert.deepEqual(
      turnIo.cards.map((card) => card.command),
      ["WebFetch https://example.test/one", "Write /w/a.txt", "WebFetch https://example.test/two?d=fake", "WebFetch https://example.test/two?d=fake"],
    );
    const [first, second] = cli.seen();
    assert.deepEqual(first.list, []);
    // Claude Code's rule is the bare name; the hook's list holds the exact calls.
    assert.deepEqual(second.settings.permissions.allow, ["WebFetch", "Write"]);
    assert.deepEqual(second.list, ["WebFetch(https://example.test/one)", "Write(/w/a.txt)"]);
    assert.deepEqual(gateDecision({ tool_name: "WebFetch", tool_input: fetchTwo }, second.list), ASK);
    assert.equal(gateDecision({ tool_name: "WebFetch", tool_input: fetchOne }, second.list), null);
  });
});

test("an unapproved WebFetch, Write or MCP call that comes back with anything but the refusal stops the turn", { skip: !posix }, async () => {
  for (const [name, input] of [
    ["WebFetch", { url: "https://example.test/x", prompt: "p" }],
    ["Write", { file_path: "/w/a.txt", content: "x" }],
    ["mcp__srv__send", { to: "a" }],
  ]) {
    const cli = fakeCli([
      { type: "system", subtype: "init", session_id: "session-0007" },
      ...ran("tu1", name, input, "ok", false),
      { type: "result", session_id: "session-0007", result: "done", permission_denials: [] },
    ]);
    await withCli(cli, async () => {
      await assert.rejects(claude.startTurn(turn(), io()).done, /nobody approved/, name);
    });
  }
});

test("a connector tool is keyed on its whole input, even with an argument named command", () => {
  const deploy = gateKey("mcp__ops__run", { command: "deploy", target: "prod", force: true });
  assert.equal(deploy, 'mcp__ops__run({"command":"deploy","force":true,"target":"prod"})');
  // Not a shell key: approving it lets no Bash call through, and a Bash approval doesn't cover it.
  assert.notEqual(deploy, gateKey("Bash", { command: "deploy" }));
  assert.equal(gateDecision({ tool_name: "Bash", tool_input: { command: "deploy" } }, [deploy]), ASK);
  assert.equal(gateDecision({ tool_name: "mcp__ops__run", tool_input: { command: "deploy", target: "staging" } }, ["Bash(deploy)", deploy]), ASK);
  // The same tool with other arguments, or another tool with the same ones, is another call.
  assert.notEqual(deploy, gateKey("mcp__ops__run", { command: "deploy", target: "staging", force: true }));
  assert.notEqual(deploy, gateKey("mcp__other__run", { command: "deploy", target: "prod", force: true }));
  assert.equal(gateDecision({ tool_name: "mcp__ops__run", tool_input: { force: true, target: "prod", command: "deploy" } }, [deploy]), null);
  // Monitor still comes to the hook as Bash and is keyed by its command.
  assert.equal(gateKey("Bash", { command: "tail -f log" }), "Bash(tail -f log)");
});

test("a connector tool's card shows all of its arguments, which is what one approval covers", () => {
  const label = (name, input) => claude.normalizeEvent({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name, input }] } }).find((event) => event.type === "tool_use").label;
  assert.equal(label("mcp__fs__write_file", { path: "/notes/a.md", content: "hello" }), 'mcp__fs__write_file {"path":"/notes/a.md","content":"hello"}');
  assert.equal(label("mcp__ops__run", { command: "deploy", target: "prod" }), 'mcp__ops__run {"command":"deploy","target":"prod"}');
  assert.equal(label("mcp__srv__ping", {}), "mcp__srv__ping");
  const long = label("mcp__srv__send", { body: "x".repeat(400) });
  assert.equal(long.length, "mcp__srv__send ".length + 300);
  assert.ok(long.endsWith("…"));
  // Other tools keep their target.
  assert.equal(label("Monitor", { command: "tail -f log" }), "Monitor tail -f log");
  assert.equal(label("WebFetch", { url: "https://example.test/a" }), "WebFetch https://example.test/a");
});
