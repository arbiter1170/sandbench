// What the page needs to resume a dropped event stream: the turn's state, and a replay that
// starts after the last event it saw. Commands are recorded, never run.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DRIVERS } from "../drivers/index.mjs";
import { createTurns } from "../turns.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sb-turn-state-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

let release = () => {};
const slow = {
  id: "test-slow",
  label: "Slow (tests only)",
  available: async () => ({ ok: true }),
  startTurn(_turn, io) {
    const done = (async () => {
      io.emit({ type: "message_delta", text: "one" });
      await new Promise((resolve) => (release = resolve));
      io.emit({ type: "message_delta", text: "two" });
      if (await io.requestPermission({ command: "git push origin main", reason: "test" })) await io.runCommand("git push origin main");
    })();
    return { done, interrupt: () => undefined };
  },
};
DRIVERS.push(slow);
after(() => DRIVERS.splice(DRIVERS.indexOf(slow), 1));

function collect(turns, from, turnId) {
  const got = [];
  let close = () => {};
  turns.subscribe(
    { on: (name, fn) => name === "close" && (close = fn) },
    { writeHead() {}, write: (chunk) => String(chunk).startsWith("id:") && got.push(JSON.parse(String(chunk).split("data: ")[1])), on() {}, end() {} },
    new URL(`http://x/events?turn=${turnId}&after=${from}`),
  );
  return { got, close: () => close() };
}

test("a turn reports running, then finished while its end is replayable, and unknown ids are unknown", async () => {
  const ran = [];
  const turns = createTurns({ runShell: async (command) => (ran.push(command), { code: 0, stdout: "", stderr: "" }), resolveFolder: () => tmp });
  assert.equal(turns.state("0123456789abcdef"), "unknown");
  const { id } = turns.start({ driver: slow.id, prompt: "hi" });
  assert.equal(turns.state(id), "running");

  // The page saw everything up to "one", then its stream dropped.
  const first = collect(turns, 0, id);
  await new Promise((resolve) => setImmediate(resolve));
  const lastSeen = first.got.at(-1).seq;
  first.close();
  release();
  await new Promise((resolve) => setImmediate(resolve));

  // Resuming from that event replays only what came after it; the waiting card is still waiting.
  const resumed = collect(turns, lastSeen, id);
  const card = resumed.got.find((event) => event.type === "permission_request");
  assert.deepEqual(resumed.got.filter((event) => event.type === "message_delta").map((event) => event.text), ["two"]);
  assert.ok(resumed.got.every((event) => event.seq > lastSeen));
  assert.equal(card.auto, false);
  assert.equal(turns.state(id), "running");

  // Resuming does not answer or re-run anything; a denial still keeps the command from running.
  assert.equal(turns.permit(card.permissionId, false), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  resumed.close();
  assert.deepEqual(ran, []);
  assert.equal(turns.state(id), "finished");

  // A new harness process (a restart) knows nothing about the old turn.
  const restarted = createTurns({ runShell: async () => ({ code: 0, stdout: "", stderr: "" }), resolveFolder: () => tmp });
  assert.equal(restarted.state(id), "unknown");
});
