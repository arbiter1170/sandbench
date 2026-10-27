// SB-09 path rules. No database and no bash needed.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRunner } from "../api/server.mjs";
import { WorkspaceError, resolveWorkspacePath, workspaceRoots } from "../workspace/index.mjs";

let tmp;
let roots;
const resolve = (slug, requested, write = false) => resolveWorkspacePath(roots, slug, requested, { write });
const refused = (slug, requested, write, code) =>
  assert.throws(() => resolve(slug, requested, write), (error) => error instanceof WorkspaceError && (!code || error.code === code), `${slug} ${JSON.stringify(requested)}`);

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-ws-"));
  roots = workspaceRoots(path.join(tmp, "home"));
  for (const folder of [roots.legacy, path.join(roots.shared, "handoff"), path.join(roots.shared, "notes"), path.join(roots.agents, "qa"), path.join(roots.agents, "pixelpets"), path.join(roots.wt, "pixelpets", "game", "feat")]) {
    mkdirSync(folder, { recursive: true });
  }
  mkdirSync(path.join(tmp, "outside"));
  writeFileSync(path.join(roots.shared, "handoff", "changelog.md"), "build 1");
  // Links an agent (or a careless command) could leave behind. Junctions work on Windows without
  // admin rights; on Linux the type is ignored.
  symlinkSync(path.join(tmp, "outside"), path.join(roots.legacy, "out"), "junction");
  symlinkSync(path.join(roots.agents, "pixelpets"), path.join(roots.agents, "qa", "peek"), "junction");
  symlinkSync(path.join(roots.wt, "pixelpets"), path.join(roots.agents, "qa", "pp-wt"), "junction");
  symlinkSync(path.join(tmp, "nowhere", "new.txt"), path.join(roots.agents, "qa", "dangle"), "junction");
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("roots all come from the home folder", () => {
  const home = path.join(tmp, "home");
  assert.deepEqual(roots, { legacy: path.join(home, "workspace"), shared: path.join(home, "shared"), agents: path.join(home, "agents"), wt: path.join(home, "wt") });
});

test("owner context works as before, plus link and null-byte checks", () => {
  assert.equal(resolve(null, "notes/a.md", true), path.join(roots.legacy, "notes", "a.md"));
  assert.equal(resolve(null, "shared/x.md"), path.join(roots.legacy, "shared", "x.md"));
  refused(null, "../../secret.txt", false, "outside");
  refused(null, "/etc/passwd", false, "invalid");
  refused(null, "C:\\Windows", false, "invalid");
  refused(null, "notes\0.md", false, "invalid");
  refused(null, "out/x.md", true, "forbidden");
  for (const bad of ["", "   ", "a".repeat(241), 42, null, "a\\..\\b"]) refused(null, bad);
});

test("an agent reads shared/ and its own folder, and writes its own folder", () => {
  assert.equal(resolve("qa", "shared/handoff/changelog.md"), path.join(roots.shared, "handoff", "changelog.md"));
  assert.equal(resolve("qa", "shared/notes/plan.md"), path.join(roots.shared, "notes", "plan.md"));
  assert.equal(resolve("qa", "report.md", true), path.join(roots.agents, "qa", "report.md"));
  assert.equal(resolve("qa", "./runs/1.md", true), path.join(roots.agents, "qa", "runs", "1.md"));
});

test("agents write in shared/ only under shared/handoff/", () => {
  assert.equal(resolve("qa", "shared/handoff/x.md", true), path.join(roots.shared, "handoff", "x.md"));
  refused("qa", "shared/notes/x.md", true, "forbidden");
  refused("qa", "shared/x.md", true, "forbidden");
  refused("qa", "shared/handoff", true);
});

test("another agent's folder can't be named, and '..' is refused in any position", () => {
  // agents/... is just a folder inside the agent's own folder.
  assert.equal(resolve("qa", "agents/pixelpets/plan.md"), path.join(roots.agents, "qa", "agents", "pixelpets", "plan.md"));
  for (const bad of ["../pixelpets/plan.md", "notes/../../pixelpets/x", "notes/../notes.md", "..", "shared/../agents/pixelpets/x", "wt/qa/../pixelpets/x"]) {
    refused("qa", bad, false, "outside");
    refused("qa", bad, true, "outside");
  }
});

test("another agent's worktree is neither readable nor writable", () => {
  for (const write of [false, true]) {
    refused("design", "wt/pixelpets/game/feat/src/main.js", write, "forbidden");
    refused("qa", "wt/pixelpets/game/feat/src/main.js", write, "forbidden");
  }
  assert.equal(resolve("pixelpets", "wt/pixelpets/game/feat/src/main.js", true), path.join(roots.wt, "pixelpets", "game", "feat", "src", "main.js"));
  refused("pixelpets", "wt/pixelpets", false);
});

test("links can't lead into another agent's folder or worktree, or out of the home", () => {
  refused("qa", "peek/plan.md", false, "forbidden");
  refused("qa", "peek/new.md", true, "forbidden");
  refused("qa", "pp-wt/game/feat/x.js", true, "forbidden");
  // A link that points nowhere yet would create its target on write.
  refused("qa", "dangle", true, "forbidden");
});

test("bad slugs are refused", () => {
  for (const slug of ["../x", "A", "Qa", "", "-qa", "qa/x", "a".repeat(42), 7]) refused(slug, "notes.md", false, "invalid");
  assert.ok(resolve("a".repeat(41), "notes.md"));
});

test("a request body can't choose an agent: page calls stay in the owner context", async () => {
  const home = path.join(tmp, "runner-home");
  const runner = createRunner({
    home,
    allowedEmails: ["vincent@example.test"],
    env: {},
    verifyIdToken: async () => ({ uid: "u1", email: "vincent@example.test", email_verified: true }),
  });
  await new Promise((done) => runner.listen(0, "127.0.0.1", done));
  const at = `http://127.0.0.1:${runner.address().port}/api`;
  const post = (route, body) => fetch(`${at}${route}`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    for (const root of ["workspace", "shared", "agents", "wt"]) assert.ok(existsSync(path.join(home, root)), root);
    const write = await post("/workspace/write", { path: "notes.md", content: "hi", approved: true, agentSlug: "pixelpets", ctx: { agentSlug: "pixelpets" } });
    assert.equal(write.status, 200);
    assert.equal(readFileSync(path.join(home, "workspace", "notes.md"), "utf8"), "hi");
    assert.equal(existsSync(path.join(home, "agents", "pixelpets")), false);
    assert.equal((await post("/exec", { command: "pwd", approved: true, folder: "../agents/other" })).status, 400);
    const turn = await post("/turns", { driver: "http", prompt: "hi", folder: "../agents/other", agentSlug: "other" });
    assert.equal(turn.status, 500);
    assert.match((await turn.json()).error, /working folder/);
    assert.equal(existsSync(path.join(home, "agents", "other")), false);
  } finally {
    runner.close();
  }
});
