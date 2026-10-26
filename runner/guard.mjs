// Firebase projects Sandbench must never use. The ids are kept out of this public
// repo; only their SHA-256 hashes are listed. Add more ids at deploy time with
// SANDBENCH_BLOCKED_PROJECTS (comma-separated) in deploy/.env.
import { createHash } from "node:crypto";

const BLOCKED_PROJECT_HASHES = new Set([
  "c8c715273233de54e7d9de595ae35e17cbfd86ded10a94c1212846b7f447c3a0",
  "3004f8269cef3a2945bc7d0336e0d558478de49b39dd179023da410d1aa62453",
  "17e948d35b3ef3b8888ccdc66c67c6e855ca692b96e9276a9439d3b51e3cba2e",
  "791f8c7f0249c0fdb4f6c98dad52e47e84f0018e913814296d8076a0003928c9",
]);

export function projectHash(projectId) {
  return createHash("sha256").update(String(projectId).trim()).digest("hex");
}

export function isBlockedProject(projectId, extra = "") {
  const id = String(projectId || "").trim();
  if (!id) return false;
  const extraIds = String(extra || "").split(",").map((s) => s.trim()).filter(Boolean);
  return extraIds.includes(id) || BLOCKED_PROJECT_HASHES.has(projectHash(id));
}

export const blockedProjectCount = BLOCKED_PROJECT_HASHES.size;
