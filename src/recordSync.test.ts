import { describe, expect, it } from "vitest";
import { applyMessageChange, applyThreadChange, changedFields, diffRecords, fromRecords, RecordSync, toRecords, upsertItem, type RemoteRecord } from "./recordSync";
import type { Snapshot, Thread } from "./types";

function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
  return {
    threads: [],
    reminders: [],
    events: [],
    contacts: [],
    settings: { model: "grok-3" },
    logs: [],
    bots: [],
    tasks: [],
    routines: [],
    computer: [],
    studio: { onboarded: true },
    ...parts,
  } as unknown as Snapshot;
}

const thread = (id: string, messages: { id: string; createdAt: number; text?: string }[] = []) =>
  ({ id, title: id, updatedAt: 1, messages: messages.map((m) => ({ text: "", role: "user", ...m })) }) as unknown as Thread;

describe("toRecords / fromRecords", () => {
  it("stores one record per item and messages apart from their thread, and rebuilds the same snapshot", () => {
    const before = snapshot({
      bots: [{ id: "qa", name: "QA" }] as unknown as Snapshot["bots"],
      threads: [thread("t1", [{ id: "m2", createdAt: 2 }, { id: "m1", createdAt: 1 }])],
      logs: Array.from({ length: 60 }, (_, i) => ({ id: `log${i}`, message: `${i}`, at: i })) as unknown as Snapshot["logs"],
    });
    const records = toRecords(before);
    expect(records.get("threads/t1")?.data).not.toHaveProperty("messages");
    expect(records.get("messages/m1")?.threadId).toBe("t1");
    expect([...records.keys()].filter((key) => key.startsWith("logs/"))).toHaveLength(60);
    const after = fromRecords(records.values(), snapshot());
    expect(after.threads[0].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(after.bots).toEqual([{ id: "qa", name: "QA" }]);
    expect(after.logs).toHaveLength(60);
  });

  it("keeps items without a usable id on this device", () => {
    const records = toRecords(snapshot({ tasks: [{ id: "../bad" }, { id: "ok" }] as unknown as Snapshot["tasks"] }));
    expect(records.has("tasks/ok")).toBe(true);
    expect([...records.keys()].some((key) => key.includes("bad"))).toBe(false);
  });
});

describe("diffRecords", () => {
  it("creates, patches only the changed fields, deletes, and sends threads before their messages", () => {
    const synced = toRecords(snapshot({ bots: [{ id: "qa", name: "QA", role: "x" }, { id: "gone" }] as unknown as Snapshot["bots"] }));
    const next = toRecords(
      snapshot({ bots: [{ id: "qa", name: "QA bot", role: "x" }] as unknown as Snapshot["bots"], threads: [thread("t1", [{ id: "m1", createdAt: 1 }])] }),
    );
    const ops = diffRecords(synced, next);
    expect(ops.find((op) => op.op === "patch")).toMatchObject({ fields: { name: "QA bot" } });
    expect(ops.find((op) => op.op === "delete")).toMatchObject({ kind: "agents", id: "gone" });
    const creates = ops.filter((op) => op.op === "create").map((op) => (op.op === "create" ? op.record.kind : ""));
    expect(creates.indexOf("threads")).toBeLessThan(creates.indexOf("messages"));
  });

  it("sends a field that disappeared as null", () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: null });
  });
});

describe("changes from another device", () => {
  const change = (parts: Partial<RemoteRecord>) => ({ version: 2, deleted: false, data: {}, ...parts }) as RemoteRecord;

  it("upserts and removes list items", () => {
    const list = [{ id: "a", n: 1 }];
    expect(upsertItem(list, change({ kind: "tasks", id: "a", data: { id: "a", n: 2 } }))).toEqual([{ id: "a", n: 2 }]);
    expect(upsertItem(list, change({ kind: "tasks", id: "b", data: { id: "b" } }))).toHaveLength(2);
    expect(upsertItem(list, change({ kind: "tasks", id: "a", deleted: true }))).toEqual([]);
  });

  it("keeps a thread's messages when the thread itself changes, and places new messages in order", () => {
    const threads = [thread("t1", [{ id: "m1", createdAt: 1 }, { id: "m3", createdAt: 3 }])];
    const renamed = applyThreadChange(threads, change({ kind: "threads", id: "t1", data: { id: "t1", title: "Renamed" } }));
    expect(renamed[0].title).toBe("Renamed");
    expect(renamed[0].messages).toHaveLength(2);
    const withMessage = applyMessageChange(renamed, change({ kind: "messages", id: "m2", threadId: "t1", data: { id: "m2", createdAt: 2 } }));
    expect(withMessage[0].messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});

describe("RecordSync against a fake runner", () => {
  // A tiny in-memory runner with versions and 409s, like runner/db/store.mjs.
  function fakeRunner() {
    const rows = new Map<string, RemoteRecord>();
    const calls: string[] = [];
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const fetcher = async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push(`${method} ${path}`);
      const url = new URL(path, "http://runner");
      const [, , kind, id] = url.pathname.split("/");
      if (url.pathname === "/changes/head") return reply(200, { seq: 0 });
      if (method === "GET") return reply(200, { items: [...rows.values()].filter((row) => row.kind === kind && !row.deleted && (kind !== "messages" || row.threadId === url.searchParams.get("thread"))) });
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (method === "POST") {
        const key = `${kind}/${body.id}`;
        if (rows.has(key)) return reply(409, { current: rows.get(key) });
        const row = { kind, id: body.id, version: 1, deleted: false, data: body.data, threadId: body.threadId } as RemoteRecord;
        rows.set(key, row);
        return reply(201, row);
      }
      const row = rows.get(`${kind}/${id}`);
      if (!row) return reply(404, {});
      if (method === "PATCH") {
        if (body.version !== row.version) return reply(409, { current: row });
        const next = { ...row, version: row.version + 1, data: { ...row.data, ...body.data } };
        rows.set(`${kind}/${id}`, next);
        return reply(200, next);
      }
      return reply(404, {});
    };
    return { rows, calls, fetcher };
  }

  it("uploads this device's copy when the runner has nothing, then sends only what changed", async () => {
    const runner = fakeRunner();
    const sync = new RecordSync(runner.fetcher);
    const local = snapshot({ bots: [{ id: "qa", name: "QA" }] as unknown as Snapshot["bots"] });
    expect(await sync.load(local)).toBeNull();
    await sync.push(local);
    expect(runner.rows.get("agents/qa")?.data).toEqual({ id: "qa", name: "QA" });
    runner.calls.length = 0;
    await sync.push(snapshot({ bots: [{ id: "qa", name: "QA bot" }] as unknown as Snapshot["bots"] }));
    expect(runner.calls).toEqual(["PATCH /data/agents/qa"]);
  });

  it("on a 409, keeps the other device's fields and lays this device's change on top", async () => {
    const runner = fakeRunner();
    const laptop = new RecordSync(runner.fetcher);
    const phone = new RecordSync(runner.fetcher);
    const start = snapshot({ bots: [{ id: "sup", name: "Supervisor", instructions: "old", persona: "calm" }] as unknown as Snapshot["bots"] });
    await laptop.load(start);
    await laptop.push(start);
    const phoneCopy = (await phone.load(snapshot()))!;
    // Both edit different fields of the same agent from version 1.
    await laptop.push(snapshot({ bots: [{ id: "sup", name: "Supervisor", instructions: "new", persona: "calm" }] as unknown as Snapshot["bots"] }));
    await phone.push({ ...phoneCopy, bots: [{ ...phoneCopy.bots[0], persona: "brisk" }] });
    expect(runner.rows.get("agents/sup")?.data).toMatchObject({ instructions: "new", persona: "brisk" });
  });
});
