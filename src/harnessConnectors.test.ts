import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessStartTurn, harnessSyncConnectors } from "./harness";
import type { Connector } from "./types";

const connector: Connector = {
  id: "c-notes",
  name: "Notes",
  url: "https://mcp.example.test/mcp",
  headers: [{ key: "Authorization", value: "Bearer {{NOTES_TOKEN}}" }],
  status: "ok",
  serverName: "synthetic-notes",
  tools: [{ name: "write_note", description: "Append a note." }],
  error: "",
  checkedAt: 1,
};

function captureFetch() {
  const bodies: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      bodies.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, id: "0123456789abcdef", after: 0 }), { headers: { "content-type": "application/json" } });
    }),
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe("local connectors for Claude Code turns", () => {
  it("syncs only the fields the harness checks, with header values still as templates", async () => {
    const sent = captureFetch();
    await harnessSyncConnectors([connector], [{ id: "bot-a", connectorIds: ["c-notes"] }, { id: "bot-b" }]);
    expect(sent[0].url).toBe("/harness/connectors/sync");
    expect(sent[0].body).toEqual({
      connectors: [{ id: "c-notes", name: "Notes", url: "https://mcp.example.test/mcp", headers: [{ key: "Authorization", value: "Bearer {{NOTES_TOKEN}}" }], status: "ok" }],
      bots: { "bot-a": ["c-notes"], "bot-b": [] },
    });
  });

  it("a turn names its bot and carries no connector config of its own", async () => {
    const sent = captureFetch();
    await harnessStartTurn({ driver: "claude", prompt: "hi", system: "", history: [], model: "", base: "", allow: [], unattendedDeny: false, botId: "bot-a" });
    const body = sent[0].body as Record<string, unknown>;
    expect(body.botId).toBe("bot-a");
    expect(body).not.toHaveProperty("connectors");
    expect(body).not.toHaveProperty("extras");
    expect(body).not.toHaveProperty("mcpConfig");
  });
});
