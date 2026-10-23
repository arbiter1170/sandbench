import {
  defaultSettings,
  defaultStudio,
  type Studio,
  type Bot,
  type BotTask,
  type CalEvent,
  type ComputerEvent,
  type Contact,
  type LogItem,
  type Reminder,
  type Routine,
  type Settings,
  type Snapshot,
  type Thread,
} from "./types";

const DB_NAME = "sandbench";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the local database."));
  });
}

function run<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Local database request failed."));
  });
}

function settled(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Local database transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Local database transaction aborted."));
  });
}

export type LocalBundle = { snapshot: Snapshot; updatedAt: number };

export async function loadSnapshot(): Promise<LocalBundle> {
  const db = await openDb();
  try {
    const tx = db.transaction("kv", "readonly");
    const store = tx.objectStore("kv");
    const done = settled(tx);
    const threadsReq = store.get("threads") as IDBRequest<Thread[] | undefined>;
    const remindersReq = store.get("reminders") as IDBRequest<Reminder[] | undefined>;
    const eventsReq = store.get("events") as IDBRequest<CalEvent[] | undefined>;
    const contactsReq = store.get("contacts") as IDBRequest<Contact[] | undefined>;
    const settingsReq = store.get("settings") as IDBRequest<Settings | undefined>;
    const logsReq = store.get("logs") as IDBRequest<LogItem[] | undefined>;
    const botsReq = store.get("bots") as IDBRequest<Bot[] | undefined>;
    const tasksReq = store.get("tasks") as IDBRequest<BotTask[] | undefined>;
    const routinesReq = store.get("routines") as IDBRequest<Routine[] | undefined>;
    const computerReq = store.get("computer") as IDBRequest<ComputerEvent[] | undefined>;
    const studioReq = store.get("studio") as IDBRequest<Partial<Studio> | undefined>;
    const updatedReq = store.get("updatedAt") as IDBRequest<number | undefined>;
    const [threads, reminders, events, contacts, settings, logs, bots, tasks, routines, computer, studio, updatedAt] =
      await Promise.all([
        run(threadsReq),
        run(remindersReq),
        run(eventsReq),
        run(contactsReq),
        run(settingsReq),
        run(logsReq),
        run(botsReq),
        run(tasksReq),
        run(routinesReq),
        run(computerReq),
        run(studioReq),
        run(updatedReq),
      ]);
    await done;
    return {
      updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
      snapshot: {
        threads: threads ?? [],
        reminders: reminders ?? [],
        events: events ?? [],
        contacts: contacts ?? [],
        settings: settings ?? defaultSettings(),
        logs: logs ?? [],
        bots: bots ?? [],
        tasks: tasks ?? [],
        routines: routines ?? [],
        computer: computer ?? [],
        studio: { ...defaultStudio(), ...(studio ?? {}) },
      },
    };
  } finally {
    db.close();
  }
}

export async function saveSnapshot(snapshot: Snapshot, updatedAt = Date.now()): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    const done = settled(tx);
    store.put(snapshot.threads, "threads");
    store.put(snapshot.reminders, "reminders");
    store.put(snapshot.events, "events");
    store.put(snapshot.contacts, "contacts");
    store.put(snapshot.settings, "settings");
    store.put(snapshot.logs.slice(0, 40), "logs");
    store.put(snapshot.bots, "bots");
    store.put(snapshot.tasks, "tasks");
    store.put(snapshot.routines, "routines");
    store.put(snapshot.computer.slice(0, 40), "computer");
    store.put(snapshot.studio, "studio");
    store.put(updatedAt, "updatedAt");
    await done;
    return updatedAt;
  } finally {
    db.close();
  }
}

export async function saveBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction("blobs", "readwrite");
    const done = settled(tx);
    tx.objectStore("blobs").put(blob, id);
    await done;
  } finally {
    db.close();
  }
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction("blobs", "readonly");
    const done = settled(tx);
    const value = await run(tx.objectStore("blobs").get(id) as IDBRequest<Blob | undefined>);
    await done;
    return value;
  } finally {
    db.close();
  }
}

export async function deleteBlob(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction("blobs", "readwrite");
    const done = settled(tx);
    tx.objectStore("blobs").delete(id);
    await done;
  } finally {
    db.close();
  }
}

export async function eraseDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Could not erase local data."));
    req.onblocked = () => resolve();
  });
}
