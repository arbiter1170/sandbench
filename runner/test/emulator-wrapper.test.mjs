// SB-13 Firebase emulator wrapper with a fake spawn: no Java, no firebase-tools, no real project.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { emulatorStart, emulatorStop } from "../browser/emulator.mjs";

function fakeSpawn() {
  const calls = [];
  const spawn = (command, args, options) => {
    const config = JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8"));
    const child = { killed: false, kill: () => (child.killed = true) };
    calls.push({ command, args, options, config, child });
    return child;
  };
  return { spawn, calls };
}

test("a project id that is not demo-* is refused before anything starts", () => {
  const { spawn, calls } = fakeSpawn();
  for (const project of ["walklings-prod", "my-project", "", "demo", "DEMO-x", "demo-", "demo-a b", undefined]) {
    assert.throws(() => emulatorStart({ project, spawn }), /demo-\*/, String(project));
  }
  assert.equal(calls.length, 0);
});

test("a guarded id is refused, even when it starts with demo-", () => {
  const { spawn, calls } = fakeSpawn();
  // A fake id passed the same way SANDBENCH_BLOCKED_PROJECTS is; never a real off-limits id.
  assert.throws(() => emulatorStart({ project: "demo-blocked-x", spawn, extraBlocked: "other-x,demo-blocked-x" }), /off-limits/);
  assert.equal(calls.length, 0);
});

test("demo-walklings starts with --project, the three emulators and the game's ports; stop removes the config", () => {
  const { spawn, calls } = fakeSpawn();
  const handle = emulatorStart({ project: "demo-walklings", spawn, extraBlocked: "" });
  assert.equal(calls.length, 1);
  const [{ command, args, config, child }] = calls;
  assert.equal(command, "firebase");
  assert.deepEqual(args.slice(0, 5), ["emulators:start", "--only", "auth,firestore,database", "--project", "demo-walklings"]);
  assert.equal(args[args.indexOf("--project") + 1], "demo-walklings");
  assert.deepEqual(
    { auth: config.emulators.auth.port, firestore: config.emulators.firestore.port, database: config.emulators.database.port },
    { auth: 9099, firestore: 8180, database: 9000 },
  );
  assert.ok(existsSync(handle.config));
  assert.equal(emulatorStop(handle), true);
  assert.equal(child.killed, true);
  assert.equal(existsSync(handle.config), false);
});

test("ports can be changed but must be sane", () => {
  const { spawn, calls } = fakeSpawn();
  const handle = emulatorStart({ project: "demo-walklings", spawn, ports: { auth: 19099, firestore: 18180, database: 19000 }, extraBlocked: "" });
  assert.equal(calls[0].config.emulators.firestore.port, 18180);
  emulatorStop(handle);
  assert.throws(() => emulatorStart({ project: "demo-walklings", spawn, ports: { auth: 80, firestore: 8180, database: 9000 }, extraBlocked: "" }), /ports/);
});
