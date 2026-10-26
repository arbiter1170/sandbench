import { describe, expect, it } from "vitest";
import { snapshotForCloud } from "./cloudSync";
import { extractLegacySecrets } from "./secrets";
import type { Snapshot } from "./types";

const FAKE = "test-only-value-0123456789";

// A snapshot as an older build saved it, with keys in Settings and Studio secret values.
function legacy(): Snapshot {
  return {
    bots: [],
    threads: [],
    logs: [],
    computer: [],
    settings: { model: "grok-3", apiKey: FAKE, anthropicKey: `${FAKE}-a`, compatKey: "mock", decisionKey: "", elevenLabsKey: `${FAKE}-e`, fishKey: undefined },
    studio: { secrets: [{ id: "1", name: "COMPOSIO_KEY", value: `${FAKE}-c`, createdAt: 1 }], connectors: [] },
  } as unknown as Snapshot;
}

describe("extractLegacySecrets", () => {
  it("moves every old key field out and maps it to its server name", () => {
    const { snapshot, found } = extractLegacySecrets(legacy());
    expect(found).toEqual([
      { name: "XAI_API_KEY", value: FAKE },
      { name: "ANTHROPIC_API_KEY", value: `${FAKE}-a` },
      { name: "ELEVENLABS_API_KEY", value: `${FAKE}-e` },
      { name: "COMPOSIO_KEY", value: `${FAKE}-c` },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("0123456789");
    expect(snapshot.studio.secrets).toEqual([{ id: "1", name: "COMPOSIO_KEY", createdAt: 1 }]);
    expect((snapshot.settings as unknown as Record<string, unknown>).model).toBe("grok-3");
  });

  it("skips the mock profile's placeholder key", () => {
    expect(extractLegacySecrets(legacy()).found.some((item) => item.value === "mock")).toBe(false);
  });

  it("leaves a clean snapshot clean", () => {
    const once = extractLegacySecrets(legacy()).snapshot;
    expect(extractLegacySecrets(once).found).toEqual([]);
  });
});

describe("snapshotForCloud", () => {
  it("never uploads a key, even from a snapshot that still has one", () => {
    expect(JSON.stringify(snapshotForCloud(legacy()))).not.toMatch(/0123456789|apiKey|anthropicKey|compatKey|elevenLabsKey/);
  });
});

describe("moveLegacySecrets", () => {
  it("never overwrites a key the server already has, and keeps keys when no server answers", async () => {
    const { moveLegacySecrets } = await import("./secrets");
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/secrets")) return new Response(JSON.stringify({ secrets: [{ name: "XAI_API_KEY", preview: "x", scope: "shared", source: "file", updatedAt: 1 }] }));
      return new Response(JSON.stringify({ name: "ANTHROPIC_API_KEY", preview: "x", scope: "shared", source: "file", updatedAt: 2 }));
    }) as typeof fetch;
    try {
      const left = await moveLegacySecrets([
        { name: "XAI_API_KEY", value: "stale-browser-copy" },
        { name: "ANTHROPIC_API_KEY", value: "only-in-browser" },
      ]);
      expect(left).toEqual([]);
      expect(calls).toEqual(["GET /harness/secrets", "PUT /harness/secrets/ANTHROPIC_API_KEY"]);
      globalThis.fetch = (async () => {
        throw new Error("offline");
      }) as typeof fetch;
      const kept = [{ name: "FISH_API_KEY", value: "waits-on-device" }];
      expect(await moveLegacySecrets(kept)).toEqual(kept);
    } finally {
      globalThis.fetch = original;
    }
  });
});
