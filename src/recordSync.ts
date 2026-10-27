// SB-02b: in runner mode the workspace syncs as one record per entity (runner/db/store.mjs)
// instead of one Firestore snapshot where the newest write wins.
//   open   -> load every record (paged), then:
//             - the runner has none: this device uploads its copy (or a newer Firestore copy)
//             - this device has never synced: the runner's copy replaces the local one (the
//               caller keeps a one-time backup first)
//             - otherwise: edits made here since the last sync (local copy vs. the saved
//               base) are replayed on top of the runner's copy, never replaced by it
//   push   -> only records that changed are sent, each with the version it last read; a
//             409 means another device changed that record, so its fields go to the page and
//             ours are re-sent on top of its newer version
//   stream -> changes from other devices arrive over /api/stream; only the fields that
//             changed are applied, so an edit still waiting to be saved here is kept
// The base (records as this device last agreed with the runner, with versions) is saved on
// the device after each push. It only advances for a record once the local copy holds the
// runner's version of it, so a reload can always tell an edit made here from one it missed.
import { localCopy } from "./db";
import { runnerFetch } from "./harness";
import type { Snapshot, Thread } from "./types";

export type RecordKind =
  | "agents"
  | "threads"
  | "messages"
  | "routines"
  | "tasks"
  | "reminders"
  | "events"
  | "contacts"
  | "logs"
  | "computer"
  | "settings"
  | "studio";

export type Data = Record<string, unknown>;
export type LocalRecord = { kind: RecordKind; id: string; data: Data; threadId?: string };
export type BaseRecord = LocalRecord & { version: number };
export type RemoteRecord = BaseRecord & { deleted: boolean; seq?: number };
export type Base = Map<string, BaseRecord>;
export type Op =
  | { op: "create"; record: LocalRecord }
  | { op: "patch"; record: LocalRecord; fields: Data }
  | { op: "delete"; kind: RecordKind; id: string };
/** Where the base is kept between loads (IndexedDB in the page, memory in tests). */
export type BaseStore = { load(): Promise<BaseRecord[] | null>; save(records: BaseRecord[]): Promise<void> };
/**
 * A change the page should apply. `fields` lists only what changed (null = field removed);
 * when it is null the whole record is new to this device, or deleted.
 */
export type RemoteChange = (change: RemoteRecord, fields: Data | null) => void;

/** Snapshot arrays stored one row per item, and the field each lives in. */
const LISTS = [
  ["agents", "bots"],
  ["routines", "routines"],
  ["tasks", "tasks"],
  ["reminders", "reminders"],
  ["events", "events"],
  ["contacts", "contacts"],
  ["logs", "logs"],
  ["computer", "computer"],
] as const satisfies readonly (readonly [RecordKind, keyof Snapshot])[];
const ORDER: RecordKind[] = ["settings", "studio", "agents", "threads", "messages", "routines", "tasks", "reminders", "events", "contacts", "logs", "computer"];
const ID = /^[A-Za-z0-9_-]{1,80}$/;
/**
 * Kinds the page keeps only the newest KEEP of (logs, computer events). The runner keeps them
 * all: an item trimmed here is never a delete, and removals go through `removeWhere`.
 */
export const APPEND_ONLY: ReadonlySet<RecordKind> = new Set<RecordKind>(["logs", "computer"]);
export const KEEP = 40;
const PAGE = 1000;

export const keyOf = (kind: RecordKind, id: string) => `${kind}/${id}`;

/** JSON round trip: what the runner would store (drops undefined, keeps null). */
function plain(value: unknown): Data {
  return JSON.parse(JSON.stringify(value ?? {})) as Data;
}

/** A missing field and a null one are the same: the runner keeps a removed field as null. */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const local = (record: LocalRecord): LocalRecord => ({ kind: record.kind, id: record.id, data: record.data, ...(record.threadId ? { threadId: record.threadId } : {}) });

/** Split a snapshot into records. Items without a usable id stay on this device only. */
export function toRecords(snapshot: Snapshot): Map<string, LocalRecord> {
  const out = new Map<string, LocalRecord>();
  const put = (record: LocalRecord) => {
    if (ID.test(record.id)) out.set(keyOf(record.kind, record.id), record);
  };
  put({ kind: "settings", id: "settings", data: plain(snapshot.settings) });
  put({ kind: "studio", id: "studio", data: plain(snapshot.studio) });
  for (const [kind, field] of LISTS) {
    for (const item of (snapshot[field] ?? []) as { id: string }[]) put({ kind, id: item.id, data: plain(item) });
  }
  for (const thread of snapshot.threads ?? []) {
    const { messages, ...rest } = thread;
    put({ kind: "threads", id: thread.id, data: plain(rest) });
    for (const message of messages ?? []) put({ kind: "messages", id: message.id, threadId: thread.id, data: plain(message) });
  }
  return out;
}

/** Rebuild a snapshot from records; messages are grouped under their thread, oldest first. */
export function fromRecords(records: Iterable<LocalRecord>, base: Snapshot): Snapshot {
  const lists = new Map<RecordKind, Data[]>();
  const messages = new Map<string, Data[]>();
  let settings = base.settings as unknown as Data;
  let studio = base.studio as unknown as Data;
  for (const record of records) {
    if (record.kind === "settings") settings = record.data;
    else if (record.kind === "studio") studio = record.data;
    else if (record.kind === "messages") {
      const list = messages.get(record.threadId ?? "") ?? [];
      list.push(record.data);
      messages.set(record.threadId ?? "", list);
    } else lists.set(record.kind, [...(lists.get(record.kind) ?? []), record.data]);
  }
  const byTime = (a: Data, b: Data) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0);
  const threads = (lists.get("threads") ?? []).map((thread) => ({
    ...thread,
    messages: (messages.get(String(thread.id)) ?? []).sort(byTime),
  })) as unknown as Thread[];
  const next = { ...base, threads, settings, studio } as unknown as Record<string, unknown>;
  const newest = (a: Data, b: Data) => Number(b.at ?? 0) - Number(a.at ?? 0);
  for (const [kind, field] of LISTS) next[field] = APPEND_ONLY.has(kind) ? (lists.get(kind) ?? []).sort(newest).slice(0, KEEP) : (lists.get(kind) ?? []);
  return next as unknown as Snapshot;
}

/** Top-level fields that differ; a field that disappeared is sent as null. */
export function changedFields(before: Data, after: Data): Data {
  const fields: Data = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!same(before[key], after[key])) fields[key] = after[key] ?? null;
  }
  return fields;
}

/** `data` with `fields` laid on top; a null field is removed. */
export function applyFields<T extends object>(data: T, fields: Data): T {
  const out = { ...data } as Data;
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out as T;
}

/** The fields `ours` sets that differ from `theirs` (fields `ours` lacks are left alone). */
function ownFields(theirs: Data, ours: Data): Data {
  const fields: Data = {};
  for (const [key, value] of Object.entries(ours)) if (value !== null && !same(theirs[key], value)) fields[key] = value;
  return fields;
}

function without(fields: Data, keys: Iterable<string>): Data {
  const out = { ...fields };
  for (const key of keys) delete out[key];
  return out;
}

function sameRecord(a: LocalRecord | undefined, b: LocalRecord | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (a.threadId ?? "") === (b.threadId ?? "") && Object.keys(changedFields(a.data, b.data)).length === 0;
}

/** What to send so the runner matches `next`, given what it last told us (`synced`). */
export function diffRecords(synced: Map<string, LocalRecord>, next: Map<string, LocalRecord>): Op[] {
  const ops: Op[] = [];
  for (const [key, record] of next) {
    const known = synced.get(key);
    if (!known) ops.push({ op: "create", record });
    else {
      const fields = changedFields(known.data, record.data);
      if (Object.keys(fields).length) ops.push({ op: "patch", record, fields });
    }
  }
  for (const [key, record] of synced) {
    if (!next.has(key) && !APPEND_ONLY.has(record.kind)) ops.push({ op: "delete", kind: record.kind, id: record.id });
  }
  // Threads before their messages, so a fresh device never sees a message without a thread.
  const rank = (op: Op) => ORDER.indexOf(op.op === "delete" ? op.kind : op.record.kind);
  return ops.sort((a, b) => rank(a) - rank(b));
}

/**
 * The runner's copy with this device's own edits since `base` replayed on top: new records
 * are added, changed fields win over the runner's, and deletes win. An edit to a record the
 * runner no longer has is dropped (it was deleted elsewhere, and deletes win).
 */
export function mergeRecords(remote: Map<string, LocalRecord>, base: Map<string, LocalRecord>, mine: Map<string, LocalRecord>): Map<string, LocalRecord> {
  const merged = new Map<string, LocalRecord>([...remote].map(([key, record]) => [key, local(record)]));
  for (const op of diffRecords(base, mine)) {
    if (op.op === "delete") {
      merged.delete(keyOf(op.kind, op.id));
      continue;
    }
    const key = keyOf(op.record.kind, op.record.id);
    const theirs = merged.get(key);
    if (op.op === "create") merged.set(key, theirs ? { ...theirs, data: applyFields(theirs.data, ownFields(theirs.data, op.record.data)) } : op.record);
    else if (theirs) merged.set(key, { ...theirs, data: applyFields(theirs.data, op.fields) });
  }
  return merged;
}

/** Apply a change from another device to one list (agents, routines, tasks, ...). */
export function upsertItem<T extends { id: string }>(list: T[], change: RemoteRecord, fields: Data | null = null): T[] {
  if (change.deleted) return list.filter((item) => item.id !== change.id);
  const known = list.some((entry) => entry.id === change.id);
  // Only the changed fields, so an edit here that is still waiting to be saved survives.
  if (known) return list.map((entry) => (entry.id !== change.id ? entry : fields ? applyFields(entry, fields) : (change.data as unknown as T)));
  // A change to an item this device deleted: the delete wins (it goes out with the next save).
  return fields ? list : [...list, change.data as unknown as T];
}

/** Apply a log or computer-event change: newest first by `at`, trimmed to the newest KEEP. */
export function upsertByTime<T extends { id: string; at: number }>(list: T[], change: RemoteRecord, fields: Data | null = null): T[] {
  return [...upsertItem(list, change, fields)].sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0)).slice(0, KEEP);
}

/** Apply a thread change; the thread keeps the messages this device already has. */
export function applyThreadChange(threads: Thread[], change: RemoteRecord, fields: Data | null = null): Thread[] {
  if (change.deleted) return threads.filter((thread) => thread.id !== change.id);
  const known = threads.find((thread) => thread.id === change.id);
  if (!known) return fields ? threads : [...threads, { ...(change.data as unknown as Thread), messages: [] }];
  const next = fields ? applyFields(known, without(fields, ["messages"])) : { ...(change.data as unknown as Thread), messages: known.messages };
  return threads.map((thread) => (thread.id === change.id ? next : thread));
}

/** Apply a message change inside its thread, keeping the thread's messages oldest first. */
export function applyMessageChange(threads: Thread[], change: RemoteRecord, fields: Data | null = null): Thread[] {
  return threads.map((thread) => {
    if (thread.id !== change.threadId) return thread;
    const messages = upsertItem(thread.messages, change, fields).sort((a, b) => a.createdAt - b.createdAt);
    return { ...thread, messages };
  });
}

/** A base kept in memory (tests, or before the page wires IndexedDB in). */
export function memoryBaseStore(initial: BaseRecord[] | null = null): BaseStore & { records: BaseRecord[] | null } {
  const box = {
    records: initial,
    load: async () => box.records,
    save: async (records: BaseRecord[]) => {
      box.records = records;
    },
  };
  return box;
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
type Hooks = {
  /** The copy to upload when the runner has no records yet (default: the local copy). */
  firstCopy?: () => Promise<Snapshot>;
  /** Called once before the runner's copy first replaces the local one. */
  backup?: (local: Snapshot) => Promise<void>;
};
/** A change sent to the page, kept until every snapshot that predates it has been pushed. */
type Delivery = { rev: number; key: string; fields: Data | null; deleted: boolean };

export class RecordSync {
  /** The runner's copy, as far as this device knows. */
  private synced: Base = new Map();
  /** Newest version seen per record, deleted ones included. */
  private versions = new Map<string, number>();
  private base: Base = new Map();
  private deliveries: Delivery[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private stopped = false;
  /** True once `open` has loaded the runner's records; until then pushes wait in the local copy. */
  ready = false;
  /** Counts changes sent to the page; a snapshot taken at revision r already holds the first r. */
  revision = 0;
  /** Gets every change the page should apply: from other devices, or found on a 409. */
  onRemote: RemoteChange | null = null;
  /** Stops the change stream started by `stream`. */
  stopStream: (() => void) | null = null;

  constructor(
    private readonly fetcher: Fetcher = runnerFetch,
    private readonly store: BaseStore = memoryBaseStore(),
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await this.fetcher(path, init);
    return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
  }

  private remember(record: RemoteRecord) {
    const key = keyOf(record.kind, record.id);
    this.versions.set(key, Math.max(this.versions.get(key) ?? 0, record.version));
    if (record.deleted) this.synced.delete(key);
    else this.synced.set(key, { ...local(record), version: record.version });
  }

  private deliver(change: RemoteRecord, fields: Data | null) {
    this.revision += 1;
    this.deliveries.push({ rev: this.revision, key: keyOf(change.kind, change.id), fields, deleted: change.deleted });
    this.onRemote?.(change, fields);
  }

  /** Every page of one list; any failed page fails the whole load. */
  private async listAll(path: string): Promise<RemoteRecord[]> {
    const out: RemoteRecord[] = [];
    let after = "";
    for (;;) {
      const join = path.includes("?") ? "&" : "?";
      const { status, body } = await this.json<{ items?: RemoteRecord[]; more?: boolean }>(`${path}${join}limit=${PAGE}&after=${encodeURIComponent(after)}`);
      if (status !== 200 || !Array.isArray(body.items)) throw new Error(`Could not load ${path} (${status}).`);
      out.push(...body.items);
      if (!body.more || !body.items.length) return out;
      after = body.items[body.items.length - 1].id;
    }
  }

  /**
   * Load the runner's records and decide what the workspace is (see the top of this file).
   * Throws if any part of the load fails; nothing is replaced then, so call it again later.
   * `current` gives this device's workspace; it is read after the network part, so edits
   * made while the load was in flight are included. The caller puts the result in place,
   * saves it locally, then pushes it.
   */
  async open(current: () => Snapshot, hooks: Hooks = {}): Promise<Snapshot> {
    const head = await this.json<{ seq: number }>("/changes/head");
    if (head.status !== 200) throw new Error(`The runner's records are not available (${head.status}).`);
    const remote: Base = new Map();
    const add = (record: RemoteRecord) => {
      if (!record.deleted) remote.set(keyOf(record.kind, record.id), { ...local(record), version: record.version });
    };
    for (const kind of ORDER.filter((item) => item !== "messages")) (await this.listAll(`/data/${kind}`)).forEach(add);
    for (const thread of [...remote.values()].filter((item) => item.kind === "threads")) {
      (await this.listAll(`/data/messages?thread=${encodeURIComponent(thread.id)}`)).forEach(add);
    }
    const saved = await this.store.load();
    let snapshot: Snapshot;
    if (!remote.size) {
      // An empty base before the first upload: if it is cut short, the next load sees the
      // partial copy on the runner and replays the rest instead of taking the partial copy.
      await this.store.save([]);
      this.base = new Map();
      snapshot = hooks.firstCopy ? await hooks.firstCopy() : current();
    } else if (!saved) {
      await hooks.backup?.(current());
      this.base = new Map();
      snapshot = fromRecords(remote.values(), current());
    } else {
      this.base = new Map(saved.map((record) => [keyOf(record.kind, record.id), record]));
      const mine = current();
      snapshot = fromRecords(mergeRecords(remote, this.base, toRecords(mine)).values(), mine);
    }
    this.synced = remote;
    this.versions = new Map([...remote].map(([key, record]) => [key, record.version]));
    this.deliveries = [];
    this.seq = head.body.seq;
    this.ready = true;
    return snapshot;
  }

  /**
   * Send what changed since the runner last agreed with us. `revision` is `this.revision` as
   * of the state the snapshot was taken from. Calls are queued and never overlap. Before
   * `open` succeeds nothing is sent: the edits wait in the local copy and the saved base.
   */
  push(snapshot: Snapshot, revision = this.revision): Promise<void> {
    if (!this.ready) return Promise.resolve();
    const run = this.queue.then(() => this.pushNow(snapshot, revision));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Delete every record of `kind` whose data matches, as far as the runner's copy is known.
   * For logs and computer events this is the only way to delete (see APPEND_ONLY). Queued
   * with the pushes; nothing is sent before `open` succeeds.
   */
  removeWhere(kind: RecordKind, match: (data: Data) => boolean): Promise<void> {
    if (!this.ready) return Promise.resolve();
    const run = this.queue.then(async () => {
      for (const record of [...this.synced.values()]) if (record.kind === kind && match(record.data)) await this.remove(kind, record.id);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * A snapshot taken before the page applied a change must not send it back: for records
   * changed since `revision`, use the runner's values for the fields that changed.
   */
  private rebase(records: Map<string, LocalRecord>, revision: number) {
    for (const delivery of this.deliveries) {
      if (delivery.rev <= revision) continue;
      const theirs = this.synced.get(delivery.key);
      const ours = records.get(delivery.key);
      if (!theirs) {
        if (delivery.deleted) records.delete(delivery.key);
      } else if (!delivery.fields) {
        if (!ours) records.set(delivery.key, local(theirs));
      } else if (ours) {
        const fields: Data = {};
        for (const key of Object.keys(delivery.fields)) fields[key] = theirs.data[key] ?? null;
        records.set(delivery.key, { ...ours, data: applyFields(ours.data, fields) });
      }
    }
    return records;
  }

  private async pushNow(snapshot: Snapshot, revision: number) {
    try {
      for (const op of diffRecords(this.synced, this.rebase(toRecords(snapshot), revision))) {
        if (op.op === "delete") await this.remove(op.kind, op.id);
        else if (op.op === "create") await this.create(op.record);
        else await this.patch(op.record, op.fields);
      }
    } finally {
      this.deliveries = this.deliveries.filter((delivery) => delivery.rev > revision);
      await this.settle(snapshot);
    }
  }

  /** Advance the saved base for each record the local copy now holds as the runner has it. */
  private async settle(snapshot: Snapshot) {
    const kept = toRecords(localCopy(snapshot));
    let changed = false;
    for (const key of new Set([...this.synced.keys(), ...kept.keys(), ...this.base.keys()])) {
      // A log this device no longer keeps needs no base: a missing one is never replayed.
      if (!kept.has(key) && APPEND_ONLY.has(key.split("/")[0] as RecordKind)) {
        if (this.base.delete(key)) changed = true;
        continue;
      }
      const theirs = this.synced.get(key);
      if (!sameRecord(kept.get(key), theirs)) continue;
      const known = this.base.get(key);
      if (theirs && (!known || known.version !== theirs.version || !sameRecord(known, theirs))) {
        this.base.set(key, theirs);
        changed = true;
      } else if (!theirs && known) {
        this.base.delete(key);
        changed = true;
      }
    }
    if (changed) await this.store.save([...this.base.values()]).catch(() => undefined);
  }

  private async create(record: LocalRecord) {
    const { status, body } = await this.json<RemoteRecord & { current?: RemoteRecord }>(`/data/${record.kind}`, {
      method: "POST",
      body: JSON.stringify({ id: record.id, data: record.data, threadId: record.threadId }),
    });
    if (status === 201) return this.remember(body);
    if (status !== 409 || !body.current) return;
    const current = body.current;
    this.remember(current);
    if (current.deleted) return this.deliver(current, null); // deleted elsewhere: deletes win
    // Another device created it first: its other fields go to the page, ours go on top.
    const theirs = without(changedFields(record.data, current.data), Object.keys(ownFields(current.data, record.data)));
    if (Object.keys(theirs).length) this.deliver(current, theirs);
    await this.patch(record, ownFields(current.data, record.data));
  }

  private async patch(record: LocalRecord, fields: Data) {
    if (!Object.keys(fields).length) return;
    const key = keyOf(record.kind, record.id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { status, body } = await this.json<RemoteRecord & { current?: RemoteRecord }>(`/data/${record.kind}/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ version: this.versions.get(key) ?? 0, data: fields }),
      });
      if (status === 200) return this.remember(body);
      if (status === 409 && body.current) {
        // Another device saved this record first. The fields it changed go to the page (so the
        // next save can't send the old values back); ours go on top of its version.
        const before = this.synced.get(key);
        this.remember(body.current);
        const theirs = without(changedFields(before?.data ?? {}, body.current.data), Object.keys(fields));
        if (Object.keys(theirs).length) this.deliver(body.current, theirs);
        continue;
      }
      if (status === 404) {
        // Deleted on another device: deletes win, so the page drops it too.
        const gone: RemoteRecord = body.current ?? { ...local(record), version: (this.versions.get(key) ?? 0) + 1, deleted: true };
        this.remember({ ...gone, deleted: true });
        this.deliver({ ...gone, deleted: true }, null);
      }
      return;
    }
  }

  private async remove(kind: RecordKind, id: string) {
    const key = keyOf(kind, id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { status, body } = await this.json<RemoteRecord & { current?: RemoteRecord }>(`/data/${kind}/${encodeURIComponent(id)}?version=${this.versions.get(key) ?? 0}`, { method: "DELETE" });
      if (status === 200) return this.remember(body);
      if (status === 404) {
        this.synced.delete(key);
        return;
      }
      // 409: another device changed it after we read it. The delete still wins: send it
      // again with the newer version.
      if (status === 409 && body.current) {
        this.remember(body.current);
        continue;
      }
      return;
    }
  }

  /** Follow the change feed; each change made by another device goes to `onRemote`. */
  stream(onRemote?: RemoteChange): () => void {
    if (onRemote) this.onRemote = onRemote;
    this.stopped = false;
    let controller: AbortController | null = null;
    let delay = 1000;
    const loop = async () => {
      while (!this.stopped) {
        controller = new AbortController();
        try {
          const response = await this.fetcher(`/stream?since=${this.seq}`, { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
          delay = 1000;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!this.stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const line = block.split("\n").find((item) => item.startsWith("data: "));
              if (!line || !block.includes("event: change")) continue;
              this.receive(JSON.parse(line.slice(6)) as RemoteRecord);
            }
          }
        } catch {
          if (this.stopped) return;
        }
        // The stream ends when the ID token expires; reconnect with a fresh one.
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void loop();
    this.stopStream = () => {
      this.stopped = true;
      controller?.abort();
    };
    return this.stopStream;
  }

  /** One change from the feed. Our own writes, and versions already seen, are skipped. */
  receive(change: RemoteRecord) {
    this.seq = Math.max(this.seq, change.seq ?? 0);
    const key = keyOf(change.kind, change.id);
    if ((this.versions.get(key) ?? 0) >= change.version) return;
    const before = this.synced.get(key);
    this.remember(change);
    this.deliver(change, before && !change.deleted ? changedFields(before.data, change.data) : null);
  }
}
