// UX P2 S7: when the Claude driver uses all its approval rounds and the last round's approved
// steps would need another one, it says so with a `roundsExhausted` field on a final thinking
// event, so the page can show "Ended after N approval rounds without a final answer" instead of
// a turn that ends with no message. A stand-in `claude` CLI (POSIX only) asks for a new command
// every round; nothing real runs.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const HOME = mkdtempSync(path.join(os.tmpdir(), "sb-rounds-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const claude = await import("../drivers/claude.mjs");
const { createTurns } = await import("../turns.mjs");
const posix = process.platform !== "win32";

// Each run asks for `echo round-<n>`, n counting the runs, so no round's denial is already approved.
function fakeCli({ denials = true } = {}) {
  const dir = mkdtempSync(path.join(HOME, "fake-cli-"));
  const bin = path.join(dir, "claude");
  const count = path.join(dir, "runs.txt");
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("fs");
const file = ${JSON.stringify(count)};
const runs = (fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) : 0) + 1;
fs.writeFileSync(file, String(runs));
const out = (line) => process.stdout.write(JSON.stringify(line) + "\\n");
out({ type: "system", subtype: "init", session_id: "session-rounds-1" });
out({ type: "assistant", message: { content: [{ type: "text", text: "round " + runs }] } });
out({ type: "result", session_id: "session-rounds-1", result: "ok", permission_denials: ${denials} ? [{ tool_name: "Bash", tool_input: { command: "echo round-" + runs } }] : [] });
`,
  );
  chmodSync(bin, 0o755);
  return { bin, runs: () => Number(readFileSync(count, "utf8")) };
}

const turn = () => ({ id: `t${Math.random().toString(36).slice(2, 10)}`, system: "", history: [], prompt: "hi", model: "sonnet", cwd: HOME, extras: {} });
const io = (approve) => {
  const events = [];
  const cards = [];
  const turnIo = {
    events,
    cards,
    signal: new AbortController().signal,
    current: null,
    emit: (event) => events.push(event),
    requestPermission: async (request) => {
      cards.push(request.command);
      turnIo.current = `p${cards.length}`;
      return approve;
    },
  };
  return turnIo;
};
const noGateCheck = { checkGate: () => undefined };

async function withCli(cli, run) {
  process.env.SANDBENCH_CLAUDE_BIN = cli.bin;
  try {
    await run();
  } finally {
    delete process.env.SANDBENCH_CLAUDE_BIN;
  }
}

test("all approval rounds used with approved steps still waiting: one roundsExhausted signal, no resume line after it", { skip: !posix }, async () => {
  const cli = fakeCli();
  await withCli(cli, async () => {
    const turnIo = io(true);
    await claude.startTurn(turn(), turnIo, noGateCheck).done;
    assert.equal(cli.runs(), 4, "four rounds ran");
    assert.deepEqual(turnIo.cards, ["echo round-1", "echo round-2", "echo round-3", "echo round-4"]);
    const signals = turnIo.events.filter((event) => event.roundsExhausted !== undefined);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].type, "thinking");
    assert.equal(signals[0].roundsExhausted, 4);
    assert.match(signals[0].text, /4 approval rounds/);
    // The signal is the last event: no "Resume the session" claim follows it.
    assert.equal(turnIo.events.at(-1), signals[0]);
    assert.equal(turnIo.events.filter((event) => /Resume the session/.test(event.text ?? "")).length, 3);
  });
});

test("a turn whose last denial is refused ends normally, without the signal", { skip: !posix }, async () => {
  const cli = fakeCli();
  await withCli(cli, async () => {
    const turnIo = io(false);
    await claude.startTurn(turn(), turnIo, noGateCheck).done;
    assert.equal(cli.runs(), 1);
    assert.equal(turnIo.events.some((event) => event.roundsExhausted !== undefined), false);
  });
});

test("a turn that finishes without denials has no signal", { skip: !posix }, async () => {
  const cli = fakeCli({ denials: false });
  await withCli(cli, async () => {
    const turnIo = io(true);
    await claude.startTurn(turn(), turnIo, noGateCheck).done;
    assert.equal(cli.runs(), 1);
    assert.equal(turnIo.events.some((event) => event.roundsExhausted !== undefined), false);
  });
});

// End to end through the harness's turn store (turns.mjs) with the real approval hook check:
// the last round's approved step ends as not handed over, never as "The agent ran this step itself".
test("through createTurns: the last round's approved step is not reported as run", { skip: !posix }, async () => {
  const cli = fakeCli();
  await withCli(cli, async () => {
    const turns = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "", ms: 1 }), resolveFolder: () => HOME });
    const events = [];
    let close = () => undefined;
    const finished = new Promise((resolve) => {
      const res = {
        writeHead() {},
        write(chunk) {
          const line = String(chunk).split("\n").find((item) => item.startsWith("data: "));
          if (!line) return;
          const event = JSON.parse(line.slice(6));
          events.push(event);
          if (event.type === "permission_request" && !event.auto) setImmediate(() => turns.permit(event.permissionId, true));
          if (event.type === "done" || event.type === "error") resolve(event);
        },
      };
      // The stand-in request records its close handler, so the stream's keep-alive timer is stopped below.
      turns.subscribe({ on: (name, handler) => name === "close" && (close = handler) }, res, new URL("http://127.0.0.1/events?after=0"));
    });
    turns.start({ driver: "claude", prompt: "hi" });
    const end = await finished;
    close();
    assert.equal(end.type, "done");
    assert.equal(cli.runs(), 4);
    const requests = events.filter((event) => event.type === "permission_request");
    assert.equal(requests.length, 4);
    const last = requests.at(-1).permissionId;
    const endsForLast = events.filter((event) => event.type === "tool_end" && event.permissionId === last);
    assert.deepEqual(endsForLast.map((event) => [event.undelivered, event.output]), [[true, "Approved, but the turn ended before Claude Code was given this step."]]);
    // Steps approved in earlier rounds were handed back (this stand-in prints no result for them),
    // so they keep the harness's usual line; only the last round's step did not run.
    for (const request of requests.slice(0, -1)) {
      assert.match(events.find((event) => event.type === "tool_end" && event.permissionId === request.permissionId)?.output ?? "", /ran this step itself/);
    }
    assert.equal(events.filter((event) => event.roundsExhausted === 4).length, 1);
  });
});
