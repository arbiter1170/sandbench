import { describe, expect, it } from "vitest";
import { pickSyncWinner, snapshotForCloud, type CloudEnvelope } from "./cloudSync";
import type { Snapshot } from "./types";

// Only the fields cloudSync reads; the rest of Snapshot does not matter here.
function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
  return { bots: [], threads: [], logs: [], computer: [], ...parts } as unknown as Snapshot;
}

describe("pickSyncWinner", () => {
  it("keeps local and pushes it when the cloud is empty and local has content", () => {
    const local = snapshot({ bots: [{ id: "qa" }] as unknown as Snapshot["bots"] });
    expect(pickSyncWinner(local, 5, null)).toEqual({ snapshot: local, pushLocal: true, updatedAt: 5 });
  });

  it("does not push an empty local workspace", () => {
    expect(pickSyncWinner(snapshot(), 5, null).pushLocal).toBe(false);
  });

  it("prefers the cloud when it is newer or the same age", () => {
    const cloud: CloudEnvelope = { updatedAt: 10, snapshot: snapshot() };
    expect(pickSyncWinner(snapshot(), 10, cloud)).toEqual({ snapshot: cloud.snapshot, pushLocal: false, updatedAt: 10 });
  });

  it("prefers local when it is newer", () => {
    const local = snapshot();
    const cloud: CloudEnvelope = { updatedAt: 3, snapshot: snapshot() };
    expect(pickSyncWinner(local, 9, cloud)).toEqual({ snapshot: local, pushLocal: true, updatedAt: 9 });
  });
});

describe("snapshotForCloud", () => {
  it("caps logs and computer events at 40", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }));
    const out = snapshotForCloud(
      snapshot({ logs: many as unknown as Snapshot["logs"], computer: many as unknown as Snapshot["computer"] }),
    );
    expect(out.logs).toHaveLength(40);
    expect(out.computer).toHaveLength(40);
  });

  it("drops oversized screen thumbnails", () => {
    const threads = [{ messages: [{ screenThumb: "x".repeat(120_001) }, { screenThumb: "small" }] }];
    const out = snapshotForCloud(snapshot({ threads: threads as unknown as Snapshot["threads"] }));
    expect(out.threads[0].messages.map((m) => m.screenThumb)).toEqual([undefined, "small"]);
  });
});
