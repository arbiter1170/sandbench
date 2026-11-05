import { describe, expect, it } from "vitest";
import {
  applyMessageChange,
  applyThreadChange,
  changedFields,
  diffRecords,
  fromRecords,
  memoryBaseStore,
  mergeRecords,
  RecordSync,
  toRecords,
  upsertByTime,
  upsertItem,
  type BaseStore,
  type Data,
  type RemoteRecord,
} from "./recordSync";
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
const bots = (...list: Record<string, unknown>[]) => list as unknown as Snapshot["bots"];
const tasks = (...list: Record<string, unknown>[]) => list as unknown as Snapshot["tasks"];

describe("toRecords / fromRecords", () => {
  it("stores one record per item and messages apart from their thread, and rebuilds the same snapshot", () => {
    const before = snapshot({
      bots: bots({ id: "qa", name: "QA" }),
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
    // All 60 are records on the runner; the page shows the newest 40, newest first.
    expect(after.logs).toHaveLength(40);
    expect(after.logs[0].id).toBe("log59");
  });

  it("keeps items without a usable id on this device", () => {
    const records = toRecords(snapshot({ tasks: tasks({ id: "../bad" }, { id: "ok" }) }));
    expect(records.has("tasks/ok")).toBe(true);
    expect([...records.keys()].some((key) => key.includes("bad"))).toBe(false);
  });
});

describe("diffRecords", () => {
  it("creates, patches only the changed fields, deletes, and sends threads before their messages", () => {
    const synced = toRecords(snapshot({ bots: bots({ id: "qa", name: "QA", role: "x" }, { id: "gone" }) }));
    const next = toRecords(snapshot({ bots: bots({ id: "qa", name: "QA bot", role: "x" }), threads: [thread("t1", [{ id: "m1", createdAt: 1 }])] }));
    const ops = diffRecords(synced, next);
    expect(ops.find((op) => op.op === "patch")).toMatchObject({ fields: { name: "QA bot" } });
    expect(ops.find((op) => op.op === "delete")).toMatchObject({ kind: "agents", id: "gone" });
    const creates = ops.filter((op) => op.op === "create").map((op) => (op.op === "create" ? op.record.kind : ""));
    expect(creates.indexOf("threads")).toBeLessThan(creates.indexOf("messages"));
  });

  it("sends a field that disappeared as null, and treats a null field on the runner as missing", () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: null });
    expect(changedFields({ a: 1, b: null }, { a: 1 })).toEqual({});
  });
});

describe("mergeRecords (edits made here while the runner was away)", () => {
  const rec = (kind: "agents" | "tasks", id: string, data: Data) => [`${kind}/${id}`, { kind, id, data }] as const;

  it("replays new records, changed fields and deletes on top of the runner's copy", () => {
    const base = new Map([rec("agents", "sup", { id: "sup", instructions: "old", persona: "calm" }), rec("tasks", "t1", { id: "t1" })]);
    const remote = new Map([rec("agents", "sup", { id: "sup", instructions: "new", persona: "calm" }), rec("tasks", "t1", { id: "t1" }), rec("tasks", "t2", { id: "t2" })]);
    const mine = new Map([rec("agents", "sup", { id: "sup", instructions: "old", persona: "brisk" }), rec("tasks", "t3", { id: "t3" })]);
    const merged = mergeRecords(remote, base, mine);
    expect(merged.get("agents/sup")?.data).toEqual({ id: "sup", instructions: "new", persona: "brisk" });
    expect([...merged.keys()].sort()).toEqual(["agents/sup", "tasks/t2", "tasks/t3"]);
  });

  it("drops an edit to a record the runner deleted (deletes win)", () => {
    const base = new Map([rec("tasks", "t1", { id: "t1", done: false })]);
    const mine = new Map([rec("tasks", "t1", { id: "t1", done: true })]);
    expect(mergeRecords(new Map(), base, mine).size).toBe(0);
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

  it("applies only the fields that changed, so an edit still waiting to be saved here survives", () => {
    const list = [{ id: "a", title: "mine, unsaved", done: false }];
    const next = upsertItem(list, change({ kind: "tasks", id: "a", data: { id: "a", title: "old", done: true } }), { done: true });
    expect(next).toEqual([{ id: "a", title: "mine, unsaved", done: true }]);
    // A field change for an item deleted here does not bring it back.
    expect(upsertItem([], change({ kind: "tasks", id: "a", data: { id: "a" } }), { done: true })).toEqual([]);
  });

  it("keeps a thread's messages when the thread itself changes, and places new messages in order", () => {
    const threads = [thread("t1", [{ id: "m1", createdAt: 1 }, { id: "m3", createdAt: 3 }])];
    const renamed = applyThreadChange(threads, change({ kind: "threads", id: "t1", data: { id: "t1", title: "Renamed" } }), { title: "Renamed" });
    expect(renamed[0].title).toBe("Renamed");
    expect(renamed[0].messages).toHaveLength(2);
    const withMessage = applyMessageChange(renamed, change({ kind: "messages", id: "m2", threadId: "t1", data: { id: "m2", createdAt: 2 } }));
    expect(withMessage[0].messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});

/** An in-memory runner with versions, 409s, tombstones and id-paged lists, like runner/db/store.mjs. */
function fakeRunner({ pageSize = 2 } = {}) {
  const rows = new Map<string, RemoteRecord>();
  const calls: string[] = [];
  // writesLeft: writes before the connection drops (or, with hang, before the tab is closed).
  const control = { down: false, writesLeft: Infinity, hang: false, failPath: null as RegExp | null };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetcher = async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    if (control.down) throw new TypeError("Failed to fetch");
    if (method !== "GET" && control.writesLeft-- <= 0) {
      if (control.hang) return new Promise<Response>(() => undefined);
      throw new TypeError("Failed to fetch");
    }
    calls.push(`${method} ${path}`);
    if (control.failPath?.test(path)) return reply(500, { error: "boom" });
    const url = new URL(path, "http://runner");
    const [, , kind, id] = url.pathname.split("/");
    if (url.pathname === "/changes/head") return reply(200, { seq: 0 });
    if (method === "GET") {
      const after = url.searchParams.get("after") ?? "";
      const all = [...rows.values()]
        .filter((row) => row.kind === kind && !row.deleted && (kind !== "messages" || row.threadId === url.searchParams.get("thread")))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .filter((row) => row.id > after);
      return reply(200, { items: all.slice(0, pageSize), more: all.length > pageSize });
    }
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (method === "POST") {
      const key = `${kind}/${body.id}`;
      if (rows.has(key)) return reply(409, { current: rows.get(key) });
      const row = { kind, id: body.id, version: 1, deleted: false, data: body.data, ...(body.threadId ? { threadId: body.threadId } : {}) } as RemoteRecord;
      rows.set(key, row);
      return reply(201, row);
    }
    const key = `${kind}/${decodeURIComponent(id)}`;
    const row = rows.get(key);
    if (!row || row.deleted) return reply(404, row ? { current: row } : {});
    const version = method === "DELETE" ? Number(url.searchParams.get("version")) : body.version;
    if (version !== row.version) return reply(409, { current: row });
    const next = method === "DELETE" ? { ...row, version: row.version + 1, deleted: true } : { ...row, version: row.version + 1, data: { ...row.data, ...body.data } };
    rows.set(key, next);
    return reply(200, next);
  };
  const data = (key: string) => (rows.get(key)?.deleted ? undefined : rows.get(key)?.data);
  return { rows, calls, control, fetcher, data };
}

/** Apply a change to a test snapshot the way App.tsx does. */
function applyToSnapshot(state: Snapshot, change: RemoteRecord, fields: Data | null): Snapshot {
  if (change.kind === "agents") return { ...state, bots: upsertItem(state.bots, change, fields) };
  if (change.kind === "tasks") return { ...state, tasks: upsertItem(state.tasks, change, fields) };
  if (change.kind === "logs") return { ...state, logs: upsertByTime(state.logs, change, fields) };
  if (change.kind === "computer") return { ...state, computer: upsertByTime(state.computer, change, fields) };
  if (change.kind === "threads") return { ...state, threads: applyThreadChange(state.threads, change, fields) };
  if (change.kind === "messages") return { ...state, threads: applyMessageChange(state.threads, change, fields) };
  return state;
}

/** One device: its page state, its local (IndexedDB) copy, and its saved base. */
class Page {
  state: Snapshot;
  saved: Snapshot;
  sync: RecordSync;
  backups: Snapshot[] = [];
  constructor(
    readonly runner: ReturnType<typeof fakeRunner>,
    saved: Snapshot = snapshot(),
    readonly base: BaseStore = memoryBaseStore(),
  ) {
    this.state = saved;
    this.saved = saved;
    this.sync = new RecordSync(runner.fetcher, base);
  }

  async open(firstCopy?: Snapshot) {
    this.sync.onRemote = (change, fields) => {
      this.state = applyToSnapshot(this.state, change, fields);
    };
    this.state = await this.sync.open(() => this.state, {
      firstCopy: firstCopy ? async () => firstCopy : undefined,
      backup: async (copy) => void this.backups.push(copy),
    });
    this.saved = this.state;
    await this.sync.push(this.state).catch(() => undefined);
  }

  edit(change: (state: Snapshot) => Snapshot) {
    this.state = change(this.state);
  }

  /** What the page's save effect does: local copy first, then the runner. */
  async save(revision = this.sync.revision) {
    this.saved = this.state;
    await this.sync.push(this.state, revision).catch(() => undefined);
  }

  /** A reload: a new page on this device's local copy and saved base. */
  reload() {
    return new Page(this.runner, this.saved, this.base);
  }
}
const device = (runner: ReturnType<typeof fakeRunner>, saved?: Snapshot) => new Page(runner, saved);

const setBot = (id: string, fields: Record<string, unknown>) => (state: Snapshot) => ({
  ...state,
  bots: state.bots.map((bot) => (bot.id === id ? { ...bot, ...fields } : bot)),
});

describe("RecordSync against a fake runner", () => {
  it("uploads this device's copy when the runner has nothing, then sends only what changed", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ bots: bots({ id: "qa", name: "QA" }) }));
    await laptop.open();
    expect(runner.data("agents/qa")).toEqual({ id: "qa", name: "QA" });
    runner.calls.length = 0;
    laptop.edit(setBot("qa", { name: "QA bot" }));
    await laptop.save();
    expect(runner.calls).toEqual(["PATCH /data/agents/qa"]);
  });

  it("uploads the copy firstCopy picks (a newer Firestore copy) instead of the local one", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ bots: bots({ id: "old", name: "Old" }) }));
    await laptop.open(snapshot({ bots: bots({ id: "newer", name: "From Firestore" }) }));
    expect(runner.data("agents/newer")).toBeTruthy();
    expect(runner.data("agents/old")).toBeUndefined();
  });

  it("loads every page of a list, and keeps a one-time backup before the runner's copy replaces a never-synced one", async () => {
    const runner = fakeRunner({ pageSize: 2 });
    const laptop = device(runner, snapshot({ bots: bots(...Array.from({ length: 7 }, (_, i) => ({ id: `b${i}` }))) }));
    await laptop.open();
    const phone = device(runner, snapshot({ bots: bots({ id: "phone-only" }) }));
    await phone.open();
    expect(phone.state.bots.map((bot) => bot.id).sort()).toEqual(["b0", "b1", "b2", "b3", "b4", "b5", "b6"]);
    expect(phone.backups.map((copy) => copy.bots.map((bot) => bot.id))).toEqual([["phone-only"]]);
  });

  it("a 409 brings the other device's fields to the page, so this device's next save keeps them", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ bots: bots({ id: "sup", name: "Supervisor", instructions: "old", persona: "calm", notes: "" }) }));
    await laptop.open();
    const phone = device(runner);
    await phone.open();
    // Both edit different fields of the same agent from version 1.
    laptop.edit(setBot("sup", { instructions: "new" }));
    await laptop.save();
    phone.edit(setBot("sup", { persona: "brisk" }));
    await phone.save();
    expect(runner.data("agents/sup")).toMatchObject({ instructions: "new", persona: "brisk" });
    expect(phone.state.bots[0]).toMatchObject({ instructions: "new", persona: "brisk" });
    // The phone's next save, of an unrelated field, must not send instructions "old" back.
    phone.edit(setBot("sup", { notes: "later" }));
    await phone.save();
    expect(runner.data("agents/sup")).toMatchObject({ instructions: "new", persona: "brisk", notes: "later" });
  });

  it("a save taken before the page applied a 409's fields does not send the old values back", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ bots: bots({ id: "sup", instructions: "old", persona: "calm", notes: "" }) }));
    await laptop.open();
    const phone = device(runner);
    await phone.open();
    laptop.edit(setBot("sup", { instructions: "new" }));
    await laptop.save();
    // Two saves from the phone, both taken before it heard about the laptop's edit.
    const revision = phone.sync.revision;
    const first = { ...phone.state, bots: bots({ id: "sup", instructions: "old", persona: "brisk", notes: "" }) };
    const second = { ...phone.state, bots: bots({ id: "sup", instructions: "old", persona: "brisk", notes: "typed" }) };
    await Promise.all([phone.sync.push(first, revision), phone.sync.push(second, revision)]);
    expect(runner.data("agents/sup")).toMatchObject({ instructions: "new", persona: "brisk", notes: "typed" });
  });

  it("a delete that gets a 409 still wins", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ tasks: tasks({ id: "t1", title: "a" }) }));
    await laptop.open();
    const phone = device(runner);
    await phone.open();
    laptop.edit((state) => ({ ...state, tasks: tasks({ id: "t1", title: "b" }) }));
    await laptop.save();
    phone.edit((state) => ({ ...state, tasks: [] }));
    await phone.save();
    expect(runner.data("tasks/t1")).toBeUndefined();
  });

  it("edits made while the runner was down are replayed on its copy at the next load, not wiped", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ bots: bots({ id: "sup", instructions: "old", persona: "calm" }), tasks: tasks({ id: "t1" }, { id: "t2" }) }));
    await laptop.open();
    const phone = device(runner);
    await phone.open();

    runner.control.down = true;
    phone.edit(setBot("sup", { persona: "brisk" }));
    phone.edit((state) => ({ ...state, tasks: [...state.tasks.filter((task) => task.id !== "t2"), ...tasks({ id: "t3" })] }));
    await phone.save();
    // Reload while still offline: the load fails, nothing is replaced, nothing is sent.
    const offline = phone.reload();
    await expect(offline.sync.open(() => offline.state)).rejects.toThrow();
    expect(offline.sync.ready).toBe(false);
    await offline.sync.push(offline.state);
    expect(offline.state.bots[0]).toMatchObject({ persona: "brisk" });

    // Meanwhile the laptop changed another field of the same agent.
    runner.control.down = false;
    laptop.edit(setBot("sup", { instructions: "new" }));
    await laptop.save();

    const back = phone.reload();
    await back.open();
    expect(back.state.bots[0]).toMatchObject({ instructions: "new", persona: "brisk" });
    expect(back.state.tasks.map((task) => task.id).sort()).toEqual(["t1", "t3"]);
    expect(runner.data("agents/sup")).toMatchObject({ instructions: "new", persona: "brisk" });
    expect(runner.data("tasks/t2")).toBeUndefined();
    expect(runner.data("tasks/t3")).toBeTruthy();
  });

  it("a first upload cut short resumes on the next load instead of the partial copy replacing this device's", async () => {
    const runner = fakeRunner();
    const many = snapshot({ bots: bots(...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}` }))), threads: [thread("t1", [{ id: "m1", createdAt: 1 }, { id: "m2", createdAt: 2 }])] });
    const laptop = device(runner, many);
    runner.control.writesLeft = 4; // the connection drops after four records
    await laptop.open();
    expect([...runner.rows.keys()].length).toBe(4);
    runner.control.writesLeft = Infinity;
    const back = laptop.reload();
    await back.open();
    expect(back.state.bots.map((bot) => bot.id).sort()).toEqual(["b0", "b1", "b2", "b3", "b4", "b5"]);
    expect(back.state.threads[0].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect([...runner.rows.keys()].filter((key) => key.startsWith("agents/")).length).toBe(6);
    expect(runner.data("messages/m2")).toBeTruthy();
    expect(back.backups).toEqual([]);
  });

  it("a tab closed during its first upload also resumes, before anything was saved as synced", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ bots: bots(...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}` }))) }));
    runner.control.writesLeft = 3;
    runner.control.hang = true;
    void laptop.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([...runner.rows.keys()]).toEqual(["settings/settings", "studio/studio", "agents/b0"]);
    runner.control.writesLeft = Infinity;
    const back = laptop.reload();
    await back.open();
    expect(back.state.bots.map((bot) => bot.id).sort()).toEqual(["b0", "b1", "b2", "b3", "b4"]);
    expect([...runner.rows.keys()].filter((key) => key.startsWith("agents/")).length).toBe(5);
  });

  it("a failed message load fails the whole load instead of leaving the thread empty", async () => {
    const runner = fakeRunner();
    const laptop = device(runner, snapshot({ threads: [thread("t1", [{ id: "m1", createdAt: 1 }])] }));
    await laptop.open();
    const back = laptop.reload();
    runner.control.failPath = /\/data\/messages/;
    await expect(back.sync.open(() => back.state)).rejects.toThrow(/messages/);
    expect(back.sync.ready).toBe(false);
    expect(back.state.threads[0].messages).toHaveLength(1);
  });

  describe("logs and computer events (the page keeps the newest 40, the runner keeps all)", () => {
    const log = (id: string, at: number) => ({ id, message: id, at });
    const logs = (...list: { id: string; at: number }[]) => list as unknown as Snapshot["logs"];
    /** What the page does when it logs something: newest first, trimmed to 40. */
    const addLog = (id: string, at: number) => (state: Snapshot) => ({ ...state, logs: logs(log(id, at), ...state.logs).slice(0, 40) });
    const forty = () => logs(...Array.from({ length: 40 }, (_, i) => log(`l${String(i).padStart(2, "0")}`, 100 - i)));

    it("a trimmed log is never deleted on the runner, and another device's newest log is kept in order", async () => {
      const runner = fakeRunner({ pageSize: 50 });
      const laptop = device(runner, snapshot({ logs: forty() }));
      await laptop.open();
      const phone = device(runner);
      await phone.open();
      phone.edit(addLog("p1", 200));
      await phone.save();
      // The laptop hears about p1, then logs k1 itself.
      laptop.sync.receive({ ...runner.rows.get("logs/p1")!, seq: 1 });
      expect(laptop.state.logs[0].id).toBe("p1");
      runner.calls.length = 0;
      laptop.edit(addLog("k1", 300));
      await laptop.save();
      expect(runner.calls.filter((call) => call.startsWith("DELETE"))).toEqual([]);
      expect(runner.calls).toEqual(["POST /data/logs"]);
      expect(runner.data("logs/p1")).toBeTruthy();
      expect(runner.data("logs/l39")).toBeTruthy();
      expect(laptop.state.logs.slice(0, 2).map((item) => item.id)).toEqual(["k1", "p1"]);
      expect(laptop.state.logs).toHaveLength(40);
    });

    it("a reload replays no deletes for logs that fell off this device, and loads the newest 40", async () => {
      const runner = fakeRunner({ pageSize: 50 });
      const laptop = device(runner, snapshot({ logs: forty() }));
      await laptop.open();
      for (let i = 0; i < 5; i += 1) {
        laptop.edit(addLog(`n${i}`, 1000 + i));
        await laptop.save();
      }
      runner.calls.length = 0;
      const back = laptop.reload();
      await back.open();
      expect(runner.calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
      expect([...runner.rows.values()].filter((row) => row.kind === "logs" && !row.deleted)).toHaveLength(45);
      expect(back.state.logs).toHaveLength(40);
      expect(back.state.logs[0].id).toBe("n4");
    });

    it("deleting a bot removes its computer events on the runner, including ones this page trimmed", async () => {
      const runner = fakeRunner({ pageSize: 100 });
      const events = Array.from({ length: 45 }, (_, i) => ({ id: `e${i}`, botId: i % 2 ? "qa" : "sup", at: i }));
      for (const event of events) runner.rows.set(`computer/${event.id}`, { kind: "computer", id: event.id, version: 1, deleted: false, data: event } as RemoteRecord);
      runner.rows.set("settings/settings", { kind: "settings", id: "settings", version: 1, deleted: false, data: {} } as RemoteRecord);
      const laptop = device(runner);
      await laptop.open();
      expect(laptop.state.computer).toHaveLength(40);
      await laptop.sync.removeWhere("computer", (data) => data.botId === "qa");
      const left = [...runner.rows.values()].filter((row) => row.kind === "computer" && !row.deleted);
      expect(left.every((row) => row.data.botId === "sup")).toBe(true);
      expect(left).toHaveLength(23);
    });
  });
});
