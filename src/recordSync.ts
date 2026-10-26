// SB-02b: in runner mode the workspace syncs as one record per entity (runner/db/store.mjs)
// instead of one Firestore snapshot where the newest write wins.
//   load   -> the runner's records become the workspace (or this device's copy is uploaded
//             the first time the runner has none)
//   push   -> only records that changed are sent, each with the version it last read; a
//             409 means another device changed that record, so the changed fields are
//             re-sent on top of its newer version
//   stream -> changes from other devices arrive over /api/stream and are applied in place
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

type Data = Record<string, unknown>;
export type LocalRecord = { kind: RecordKind; id: string; data: Data; threadId?: string };
export type RemoteRecord = LocalRecord & { version: number; deleted: boolean; seq?: number };
export type Op =
  | { op: "create"; record: LocalRecord }
  | { op: "patch"; record: LocalRecord; fields: Data }
  | { op: "delete"; kind: RecordKind; id: string };

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

export const keyOf = (kind: RecordKind, id: string) => `${kind}/${id}`;

/** JSON round trip: what the runner would store (drops undefined, keeps null). */
function plain(value: unknown): Data {
  return JSON.parse(JSON.stringify(value ?? {})) as Data;
}

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
  for (const [kind, field] of LISTS) next[field] = lists.get(kind) ?? [];
  return next as unknown as Snapshot;
}

/** Top-level fields that differ; a field that disappeared is sent as null. */
export function changedFields(before: Data, after: Data): Data {
  const fields: Data = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) fields[key] = key in after ? after[key] : null;
  }
  return fields;
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
  for (const [key, record] of synced) if (!next.has(key)) ops.push({ op: "delete", kind: record.kind, id: record.id });
  // Threads before their messages, so a fresh device never sees a message without a thread.
  const rank = (op: Op) => ORDER.indexOf(op.op === "delete" ? op.kind : op.record.kind);
  return ops.sort((a, b) => rank(a) - rank(b));
}

/** Apply a change from another device to one list (agents, routines, tasks, ...). */
export function upsertItem<T extends { id: string }>(list: T[], change: RemoteRecord): T[] {
  if (change.deleted) return list.filter((item) => item.id !== change.id);
  const item = change.data as unknown as T;
  return list.some((entry) => entry.id === change.id) ? list.map((entry) => (entry.id === change.id ? item : entry)) : [...list, item];
}

/** Apply a thread change; the thread keeps the messages this device already has. */
export function applyThreadChange(threads: Thread[], change: RemoteRecord): Thread[] {
  if (change.deleted) return threads.filter((thread) => thread.id !== change.id);
  const known = threads.find((thread) => thread.id === change.id);
  const next = { ...(change.data as unknown as Thread), messages: known?.messages ?? [] };
  return known ? threads.map((thread) => (thread.id === change.id ? next : thread)) : [...threads, next];
}

/** Apply a message change inside its thread, keeping the thread's messages oldest first. */
export function applyMessageChange(threads: Thread[], change: RemoteRecord): Thread[] {
  return threads.map((thread) => {
    if (thread.id !== change.threadId) return thread;
    const messages = upsertItem(thread.messages, change).sort((a, b) => a.createdAt - b.createdAt);
    return { ...thread, messages };
  });
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export class RecordSync {
  private synced = new Map<string, LocalRecord>();
  private versions = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private stopped = false;
  /** Stops the change stream started by `stream`. */
  stopStream: (() => void) | null = null;

  constructor(private readonly fetcher: Fetcher = runnerFetch) {}

  private async json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await this.fetcher(path, init);
    return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
  }

  private remember(record: RemoteRecord) {
    const key = keyOf(record.kind, record.id);
    if (record.deleted) {
      this.synced.delete(key);
      this.versions.delete(key);
      return;
    }
    this.synced.set(key, { kind: record.kind, id: record.id, data: record.data, threadId: record.threadId });
    this.versions.set(key, record.version);
  }

  /** Everything the runner holds for this user, or null if it holds nothing yet. */
  async load(base: Snapshot): Promise<Snapshot | null> {
    const head = await this.json<{ seq: number }>("/changes/head");
    if (head.status !== 200) throw new Error(`The runner's records are not available (${head.status}).`);
    this.seq = head.body.seq;
    for (const kind of ORDER.filter((item) => item !== "messages")) {
      const list = await this.json<{ items: RemoteRecord[] }>(`/data/${kind}?limit=5000`);
      if (list.status !== 200) throw new Error(`Could not load ${kind} (${list.status}).`);
      list.body.items.forEach((record) => this.remember(record));
    }
    for (const record of [...this.synced.values()].filter((item) => item.kind === "threads")) {
      const list = await this.json<{ items: RemoteRecord[] }>(`/data/messages?thread=${encodeURIComponent(record.id)}&limit=5000`);
      if (list.status === 200) list.body.items.forEach((message) => this.remember(message));
    }
    return this.synced.size ? fromRecords(this.synced.values(), base) : null;
  }

  /** Send what changed since the runner last agreed with us. Calls are queued, never overlap. */
  push(snapshot: Snapshot): Promise<void> {
    const run = this.queue.then(() => this.pushNow(snapshot));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pushNow(snapshot: Snapshot) {
    for (const op of diffRecords(this.synced, toRecords(snapshot))) {
      if (op.op === "delete") {
        const key = keyOf(op.kind, op.id);
        const { status, body } = await this.json<RemoteRecord & { current?: RemoteRecord }>(`/data/${op.kind}/${encodeURIComponent(op.id)}?version=${this.versions.get(key) ?? 0}`, { method: "DELETE" });
        if (status === 200) this.remember(body);
        else if (status === 404) this.synced.delete(key);
        else if (status === 409 && body.current) this.remember(body.current); // changed elsewhere: keep their copy
        continue;
      }
      const { record } = op;
      if (op.op === "create") {
        const { status, body } = await this.json<RemoteRecord & { current?: RemoteRecord }>(`/data/${record.kind}`, {
          method: "POST",
          body: JSON.stringify({ id: record.id, data: record.data, threadId: record.threadId }),
        });
        if (status === 201) this.remember(body);
        else if (status === 409 && body.current) {
          // Another device created it first: keep theirs, then lay our fields on top.
          this.remember(body.current);
          await this.patch(record, changedFields(body.current.data, record.data));
        }
        continue;
      }
      await this.patch(record, op.fields);
    }
  }

  private async patch(record: LocalRecord, fields: Data) {
    if (!Object.keys(fields).length) return;
    const key = keyOf(record.kind, record.id);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { status, body } = await this.json<RemoteRecord & { current?: RemoteRecord }>(`/data/${record.kind}/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ version: this.versions.get(key) ?? 0, data: fields }),
      });
      if (status === 200) return this.remember(body);
      if (status === 409 && body.current) {
        // Another device saved this record first. Its fields stay; ours go on top.
        this.remember(body.current);
        continue;
      }
      if (status === 404) {
        this.synced.delete(key);
        this.versions.delete(key);
      }
      return;
    }
  }

  /** Follow the change feed; `onRemote` gets each change made by another device. */
  stream(onRemote: (change: RemoteRecord) => void): () => void {
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
              const change = JSON.parse(line.slice(6)) as RemoteRecord;
              this.seq = Math.max(this.seq, change.seq ?? 0);
              const key = keyOf(change.kind, change.id);
              if ((this.versions.get(key) ?? 0) >= change.version) continue; // our own write, or old news
              this.remember(change);
              onRemote(change);
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
}
