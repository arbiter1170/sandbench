import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { extractLegacySecrets } from "./secrets";
import type { Snapshot } from "./types";

const DOC_PATH = ["workspace", "snapshot"] as const;

export type CloudEnvelope = {
  updatedAt: number;
  snapshot: Snapshot;
};

function workspaceRef(uid: string) {
  const db = getFirebaseDb();
  if (!db) return null;
  return doc(db, "users", uid, DOC_PATH[0], DOC_PATH[1]);
}

/** Strip oversized fields and any API key before upload (IndexedDB blobs stay local). */
export function snapshotForCloud(snapshot: Snapshot): Snapshot {
  const clean = extractLegacySecrets(snapshot).snapshot;
  return {
    ...clean,
    logs: clean.logs.slice(0, 40),
    computer: clean.computer.slice(0, 40),
    threads: clean.threads.map((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => ({
        ...message,
        // Keep thumbs tiny; drop huge inline data if somehow present.
        screenThumb: message.screenThumb && message.screenThumb.length > 120_000 ? undefined : message.screenThumb,
      })),
    })),
  };
}

export async function pullCloudSnapshot(uid: string): Promise<CloudEnvelope | null> {
  const ref = workspaceRef(uid);
  if (!ref) return null;
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<CloudEnvelope>;
  if (!data.snapshot || typeof data.updatedAt !== "number") return null;
  return { updatedAt: data.updatedAt, snapshot: data.snapshot as Snapshot };
}

export async function pushCloudSnapshot(uid: string, snapshot: Snapshot, updatedAt = Date.now()): Promise<number> {
  const ref = workspaceRef(uid);
  if (!ref) throw new Error("Cloud sync is not configured.");
  const envelope: CloudEnvelope = { updatedAt, snapshot: snapshotForCloud(snapshot) };
  await setDoc(ref, envelope, { merge: false });
  return updatedAt;
}

/**
 * Prefer the newer of local vs cloud. If only one side has bots/content, prefer that.
 * Returns which snapshot to use and whether to upload local afterward.
 */
export function pickSyncWinner(
  local: Snapshot,
  localUpdatedAt: number,
  cloud: CloudEnvelope | null,
): { snapshot: Snapshot; pushLocal: boolean; updatedAt: number } {
  if (!cloud) {
    const hasLocal = local.bots.length > 0 || local.threads.length > 0;
    return { snapshot: local, pushLocal: hasLocal, updatedAt: localUpdatedAt || Date.now() };
  }
  if (cloud.updatedAt >= localUpdatedAt) {
    return { snapshot: cloud.snapshot, pushLocal: false, updatedAt: cloud.updatedAt };
  }
  return { snapshot: local, pushLocal: true, updatedAt: localUpdatedAt };
}
