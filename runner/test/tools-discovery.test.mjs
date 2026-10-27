// SB-03 PR 1 tool discovery over fixture folders (runner/test/fixtures/tools/).
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { discoverTools } from "../tools/discover.mjs";

const root = (name) => fileURLToPath(new URL(`./fixtures/tools/${name}/`, import.meta.url));

test("tools.mjs files in each area are found and sorted by name", async () => {
  assert.deepEqual((await discoverTools({ root: root("good") })).map((tool) => tool.name), ["alpha_tool", "beta_tool", "zeta_tool"]);
});

test("a duplicate tool name throws and names both files", async () => {
  await assert.rejects(discoverTools({ root: root("dup") }), /same_tool is defined twice: one\/tools\.mjs and two\/tools\.mjs/);
});

test("an invalid descriptor throws and names the file", async () => {
  await assert.rejects(discoverTools({ root: root("bad") }), /area\/tools\.mjs: tool who_am_i is invalid: .*agentId/);
});

test("the runner itself has no tools yet", async () => {
  assert.deepEqual(await discoverTools(), []);
});
