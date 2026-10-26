import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedProjectCount, isBlockedProject, projectHash } from "../guard.mjs";

test("four off-limits projects are listed by hash", () => {
  assert.equal(blockedProjectCount, 4);
});

test("demo and unknown projects are allowed", () => {
  assert.equal(isBlockedProject("demo-sandbench"), false);
  assert.equal(isBlockedProject("sandbench-prod"), false);
  assert.equal(isBlockedProject(""), false);
});

test("SANDBENCH_BLOCKED_PROJECTS adds ids", () => {
  assert.equal(isBlockedProject("other-project", "a-project, other-project"), true);
  assert.equal(isBlockedProject("sandbench-prod", "a-project"), false);
});

test("hash is plain sha256 of the trimmed id", () => {
  assert.equal(projectHash(" demo-sandbench "), projectHash("demo-sandbench"));
  assert.match(projectHash("x"), /^[0-9a-f]{64}$/);
});
