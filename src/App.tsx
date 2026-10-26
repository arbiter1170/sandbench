import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { completeText, routeFor, streamReply, streamText } from "./assistant";
import { SignOutButton } from "./AuthGate";
import { pickSyncWinner, pullCloudSnapshot, pushCloudSnapshot } from "./cloudSync";
import { Workspace } from "./shell";
import { deleteBlob, eraseDatabase, getBlob, loadPendingSecrets, loadSnapshot, saveBlob, savePendingSecrets, saveSnapshot } from "./db";
import {
  autoApproved,
  connectorHeaders,
  harnessAck,
  harnessCallTool,
  harnessDrivers,
  harnessDue,
  harnessEvents,
  harnessExec,
  harnessHealth,
  harnessInput,
  harnessInterrupt,
  harnessPermit,
  harnessReadFile,
  harnessRecordRun,
  harnessScreen,
  harnessStartTurn,
  harnessSyncSchedules,
  harnessSyncWebhooks,
  harnessTriggers,
  harnessBotMemory,
  harnessSkills,
  harnessTtsSpeak,
  harnessWebhookSecret,
  harnessWriteFile,
  type AgentDriver,
  type HarnessHealth,
  runnerMode,
} from "./harness";
import { pickWithDecisionModel } from "./decision";
import { applyMessageChange, applyThreadChange, RecordSync, upsertItem, type RemoteRecord } from "./recordSync";
import { extractLegacySecrets, listSecrets, moveLegacySecrets, removeSecret, saveSecret, type LegacySecret, type SecretInfo } from "./secrets";
import { HubPanel, Onboarding } from "./studio";
import {
  downloadCalendar,
  hashPin,
  makeSwatch,
  randomSalt,
  registerPasskey,
  verifyPasskey,
} from "./device";
import { translate } from "./i18n";
import { assembleBotSystem } from "./prompt";
import { speakable } from "./speech";
import {
  applyProfileToSettings,
  MOCK_COMPAT_KEY,
  mergeBotProfile,
  profileTouchesCompatBase,
  type TestProfileId,
} from "./testProfiles";
import type { Key } from "./i18n";
import {
  defaultSettings,
  defaultStudio,
  LOCALE_OPTIONS,
  type Approval,
  type Bot,
  type Studio,
  type BotTask,
  type CalEvent,
  type ComputerEvent,
  type Contact,
  type LogItem,
  type Message,
  type PendingFile,
  type Reminder,
  type Routine,
  type Settings,
  type Thread,
  type TriggerRef,
  type TriggerRun,
  type WebhookTrigger,
} from "./types";
import { LockScreen, SettingsPanel, ToolsPanel } from "./views";
import {
  actionLabel,
  approvalFields,
  blankBot,
  botFromTemplate,
  createReaBot,
  REA_BOT_ID,
  BUILTIN_PLUGINS,
  continuationText,
  decisionPrompt,
  guardAction,
  inFolder,
  interpretResult,
  MAX_ACTIONS,
  needsHarness,
  nextLocalAction,
  parseModelDecision,
  parseRoute,
  planAction,
  planTurn,
  playTurn,
  routeLocally,
  routePrompt,
  routineDue,
  safeWorkspacePath,
  VOICES,
  type BotTemplate,
  type LibraryText,
  type StepAction,
  type MigrationApply,
  type TeamApply,
  type TriggerDraft,
} from "./work";

function roomFolder(room: Thread | undefined): string | undefined {
  return room?.memberIds && room.workingFolder ? safeWorkspacePath(room.workingFolder) ?? undefined : undefined;
}

type Receipt = { kind: "routine" | "webhook"; triggerId: string; title: string };
type AskOptions = { threadId?: string; skipUser?: boolean; unattended?: boolean; receipt?: Receipt; routed?: string };


function migrateDrafts(drafts: Record<string, string>, all: Thread[]): Record<string, string> {
  const next = { ...drafts };
  for (const [key, value] of Object.entries(drafts)) {
    if (all.some((thread) => thread.id === key)) continue;
    const latest = all.filter((thread) => thread.botId === key && !thread.memberIds).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest && next[latest.id] === undefined) next[latest.id] = value;
  }
  return next;
}

function latestBotThread(all: Thread[], botId: string): Thread | undefined {
  return all.filter((thread) => thread.botId === botId && !thread.memberIds).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

export function App({ user }: { user: User }) {
  const [hydrated, setHydrated] = useState(false);
  const [persist, setPersist] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings>(() => defaultSettings());
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [tasks, setTasks] = useState<BotTask[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [computer, setComputer] = useState<ComputerEvent[]>([]);
  const [studio, setStudio] = useState<Studio>(() => defaultStudio());
  const [harness, setHarness] = useState<HarnessHealth | null>(null);
  // API keys stay on the harness or runner (SB-05); the page knows names and previews only.
  const [secretInfo, setSecretInfo] = useState<SecretInfo[]>([]);
  const [keysAvailable, setKeysAvailable] = useState(false);
  const keyNames = useMemo(() => new Set(secretInfo.map((item) => item.name)), [secretInfo]);
  const [drivers, setDrivers] = useState<AgentDriver[]>([]);
  const [triggerRuns, setTriggerRuns] = useState<TriggerRun[]>([]);
  const [hookPort, setHookPort] = useState<number | null>(null);
  const [freshSecret, setFreshSecret] = useState<{ id: string; secret: string } | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [workingBotId, setWorkingBotId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [callActive, setCallActive] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [focus, setFocus] = useState<"rail" | "chat" | "side">("chat");
  const [overlay, setOverlay] = useState<null | "tools" | "settings" | "hub">(null);
  const [createNonce, setCreateNonce] = useState(0);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 861px)").matches);
  const [online, setOnline] = useState(navigator.onLine);
  const [banner, setBanner] = useState("");
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [lockError, setLockError] = useState("");
  const [canInstall, setCanInstall] = useState(false);
  const [notifyState, setNotifyState] = useState<NotificationPermission | "unknown">(() =>
    "Notification" in window ? Notification.permission : "unknown",
  );
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const speechRef = useRef<{ stop: () => void } | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const installRef = useRef<InstallPrompt | null>(null);
  const remindersRef = useRef(reminders);
  const pendingRef = useRef(pending);
  const threadsRef = useRef(threads);
  const botsRef = useRef(bots);
  const settingsRef = useRef(settings);
  const studioRef = useRef(studio);
  const harnessRef = useRef(harness);
  const keyNamesRef = useRef(keyNames);
  keyNamesRef.current = keyNames;
  const driversRef = useRef(drivers);
  const routinesRef = useRef(routines);
  const callRef = useRef(callActive);
  const speakTokenRef = useRef(0);
  const holdListenRef = useRef(false);
  const draftRef = useRef(draft);
  const targetRef = useRef<string | null>(null);
  const openThreadRef = useRef<string | null>(null);
  const selectedBotRef = useRef<string | null>(null);
  const drainRef = useRef(false);
  studioRef.current = studio;
  harnessRef.current = harness;
  driversRef.current = drivers;
  routinesRef.current = routines;
  callRef.current = callActive;
  draftRef.current = draft;
  remindersRef.current = reminders;
  pendingRef.current = pending;
  threadsRef.current = threads;
  botsRef.current = bots;
  settingsRef.current = settings;
  openThreadRef.current = openThreadId;
  selectedBotRef.current = selectedBotId;

  const t = useMemo(() => {
    return (key: Key) => translate(settings.locale, key);
  }, [settings.locale]);

  const cloudUpdatedAtRef = useRef(0);
  const skipNextCloudPushRef = useRef(false);
  // Runner mode (SB-02b): records on the runner replace the Firestore snapshot.
  const recordSyncRef = useRef<RecordSync | null>(null);

  useEffect(() => {
    let active = true;
    const applySnapshot = (snapshot: Awaited<ReturnType<typeof loadSnapshot>>["snapshot"]) => {
      const loaded = (snapshot.bots.length > 0 ? snapshot.bots : [blankBot("North", "General teammate", true)]).map((bot) => ({
        ...bot,
        section: bot.section ?? "",
        memories: bot.memories ?? [],
        lastThinking: bot.lastThinking ?? [],
        skills: bot.skills ?? [],
      }));
      const nextBots = loaded.some((bot) => bot.id === REA_BOT_ID) ? loaded : [...loaded, createReaBot()];
      setThreads(snapshot.threads);
      setReminders(snapshot.reminders);
      setEvents(snapshot.events);
      setContacts(snapshot.contacts);
      setSettings({ ...defaultSettings(), ...snapshot.settings, sections: snapshot.settings.sections ?? [] });
      setLogs(snapshot.logs);
      setBots(nextBots);
      setTasks(snapshot.tasks);
      setRoutines(snapshot.routines);
      setComputer(snapshot.computer);
      setStudio({ ...snapshot.studio, drafts: migrateDrafts(snapshot.studio.drafts, snapshot.threads) });
      const first = nextBots.find((bot) => bot.primary)?.id ?? nextBots[0]?.id ?? null;
      const chat = [...snapshot.threads].filter((thread) => thread.botId === first && !thread.memberIds).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setSelectedBotId(first);
      setOpenThreadId(chat?.id ?? null);
      targetRef.current = chat?.id ?? null;
      const drafts = migrateDrafts(snapshot.studio.drafts, snapshot.threads);
      setDraft(chat ? drafts[chat.id] ?? drafts[first ?? ""] ?? "" : "");
    };

    const snapshotPromise = Promise.race([
      loadSnapshot(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Local data took too long to open.")), 4000);
      }),
    ]);
    void snapshotPromise
      .then(async (bundle) => {
        if (!active) return;
        // Keys saved by older builds come out of the snapshot here and wait on this device
        // only until the harness or runner can take them (SB-05).
        const local = extractLegacySecrets(bundle.snapshot);
        const found: LegacySecret[] = [...(await loadPendingSecrets().catch(() => [])), ...local.found];
        let snapshot = local.snapshot;
        let updatedAt = bundle.updatedAt;
        if (runnerMode) {
          // The runner's records are the workspace; this device's copy is only a cache. The
          // first device to sign in uploads its copy when the runner has none yet.
          const sync = new RecordSync();
          try {
            const remote = await sync.load(local.snapshot);
            if (remote) snapshot = remote;
            else await sync.push(local.snapshot);
            recordSyncRef.current = sync;
            updatedAt = Date.now();
            await saveSnapshot(snapshot, updatedAt).catch(() => undefined);
          } catch {
            // Runner unreachable: work from this device's copy; the next load syncs.
          }
        } else try {
          const pulled = await pullCloudSnapshot(user.uid);
          const cloudClean = pulled ? extractLegacySecrets(pulled.snapshot) : null;
          if (cloudClean) found.push(...cloudClean.found);
          const cloud = pulled && cloudClean ? { ...pulled, snapshot: cloudClean.snapshot } : null;
          const picked = pickSyncWinner(local.snapshot, bundle.updatedAt, cloud);
          snapshot = picked.snapshot;
          updatedAt = picked.updatedAt;
          cloudUpdatedAtRef.current = picked.updatedAt;
          // A cloud copy that still held keys is rewritten without them right away.
          const scrubCloud = Boolean(cloudClean?.found.length);
          skipNextCloudPushRef.current = !picked.pushLocal && !scrubCloud;
          if (picked.pushLocal || scrubCloud) {
            await pushCloudSnapshot(user.uid, snapshot, updatedAt || Date.now());
            cloudUpdatedAtRef.current = updatedAt || Date.now();
          } else if (cloud && cloud.updatedAt > bundle.updatedAt) {
            await saveSnapshot(snapshot, cloud.updatedAt);
          }
        } catch {
          // Offline or rules not deployed yet — continue with local data.
        }
        if (found.length) {
          const unique = [...new Map(found.map((item) => [item.name, item])).values()];
          await savePendingSecrets(unique).catch(() => undefined);
          await saveSnapshot(snapshot, updatedAt || Date.now()).catch(() => undefined);
          void flushPendingSecrets();
        }
        applySnapshot(snapshot);
        setHydrated(true);
        recordSyncRef.current?.stream(applyRemoteChange);
      })
      .catch(() => {
        if (!active) return;
        const bot = blankBot("North", "General teammate", true);
        setBots([bot, createReaBot()]);
        setSelectedBotId(bot.id);
        setPersist(false);
        setBanner(translate(defaultSettings().locale, "dbError"));
        setHydrated(true);
      });
    return () => {
      active = false;
      recordSyncRef.current?.stopStream?.();
      recordSyncRef.current = null;
    };
  }, [user.uid]);

  useEffect(() => {
    if (!hydrated || !persist) return;
    const handle = window.setTimeout(() => {
      const target = targetRef.current;
      const saved = target ? { ...studio, drafts: { ...studio.drafts, [target]: draft } } : studio;
      const snapshot = { threads, reminders, events, contacts, settings, logs, bots, tasks, routines, computer, studio: saved };
      void saveSnapshot(snapshot)
        .then(async (updatedAt) => {
          cloudUpdatedAtRef.current = updatedAt;
          if (runnerMode) {
            // Only the records that changed go to the runner; Firestore is not written.
            await recordSyncRef.current?.push(snapshot).catch(() => undefined);
            return;
          }
          if (skipNextCloudPushRef.current) {
            skipNextCloudPushRef.current = false;
            return;
          }
          try {
            await pushCloudSnapshot(user.uid, snapshot, updatedAt);
          } catch {
            // Keep local; next save retries cloud.
          }
        })
        .catch(() => {
          setBanner(translate(settings.locale, "dbError"));
        });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [hydrated, persist, threads, reminders, events, contacts, settings, logs, bots, tasks, routines, computer, studio, draft, user.uid]);

  useEffect(() => {
    let active = true;
    const check = () => {
      void harnessHealth().then((next) => {
        if (active) setHarness((prev) => (Boolean(prev) === Boolean(next) && prev?.host === next?.host ? prev : next));
      });
    };
    check();
    const handle = window.setInterval(check, 8000);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, []);

  useEffect(() => {
    void refreshKeys().then(flushPendingSecrets);
  }, [harness]);

  useEffect(() => {
    const seen = () => {
      if (document.hidden) return;
      const open = threadsRef.current.find((thread) => thread.id === openThreadRef.current && !thread.memberIds);
      if (open?.botId) setBots((prev) => (prev.some((item) => item.id === open.botId && item.unread) ? prev.map((item) => (item.id === open.botId ? { ...item, unread: false } : item)) : prev));
    };
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const warm = () => {
      void window.speechSynthesis.getVoices();
    };
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  useEffect(() => {
    if (!harness) {
      setDrivers([]);
      return;
    }
    let active = true;
    void harnessDrivers()
      .then((result) => active && setDrivers(result.drivers))
      .catch(() => active && setDrivers([]));
    return () => {
      active = false;
    };
  }, [harness]);

  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setInterval(() => {
      if (sendingRef.current || harnessRef.current) return;
      const now = new Date();
      const due = routinesRef.current.find((routine) => routine.enabled && routineDue(routine.schedule, routine.lastRunAt, now));
      if (!due) return;
      setRoutines((prev) => prev.map((item) => (item.id === due.id ? { ...item, lastRunAt: now.getTime() } : item)));
      routinesRef.current = routinesRef.current.map((item) => (item.id === due.id ? { ...item, lastRunAt: now.getTime() } : item));
      void askBot(due.botId, due.title, { unattended: true });
    }, 20_000);
    return () => window.clearInterval(handle);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !harness) return;
    void harnessSyncSchedules(
      routines.filter((routine) => routine.enabled).map((routine) => ({
        id: routine.id,
        botId: routine.botId,
        title: routine.title,
        schedule: routine.schedule,
        enabled: routine.enabled,
      })),
    ).catch(() => undefined);
  }, [hydrated, harness, routines]);

  useEffect(() => {
    if (!hydrated || !harness) return;
    void harnessSyncWebhooks(studio.webhooks)
      .then(() => refreshTriggers())
      .catch(() => undefined);
  }, [hydrated, harness, studio.webhooks]);

  useEffect(() => {
    if (!hydrated || !harness) return;
    let active = true;
    const drain = async () => {
      if (!active || drainRef.current) return;
      drainRef.current = true;
      try {
        await refreshTriggers();
        const { items } = await harnessDue();
        for (const item of items) {
          if (!active) return;
          const kind = item.webhookId ? "webhook" : "routine";
          const triggerId = item.webhookId ?? item.routineId ?? "";
          const bot = botsRef.current.find((entry) => entry.id === item.botId);
          if (!bot) {
            await harnessAck([item.id]);
            await harnessRecordRun({ kind, triggerId, botId: item.botId, title: item.title, status: "skipped" });
            continue;
          }
          if (sendingRef.current) return;
          const thread = latestBotThread(threadsRef.current, item.botId);
          const prompt = item.webhookId ? `${item.title}\n\nWebhook delivery:\n${item.payload?.trim() || "(empty body)"}` : item.title;
          await askBot(item.botId, prompt, { unattended: true, threadId: thread?.id, receipt: { kind, triggerId, title: item.title } });
          await harnessAck([item.id]);
          if (item.routineId) setRoutines((prev) => prev.map((routine) => (routine.id === item.routineId ? { ...routine, lastRunAt: item.at } : routine)));
        }
        if (items.length > 0) await refreshTriggers();
      } catch {
        // The harness can restart between polls. The next poll tries again.
      } finally {
        drainRef.current = false;
      }
    };
    void drain();
    const handle = window.setInterval(() => void drain(), 5_000);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [hydrated, harness]);

  useEffect(() => {
    document.documentElement.lang = settings.locale;
  }, [settings.locale]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const onChange = () => setWide(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const onError = (event: ErrorEvent) => {
      setLogs((prev) =>
        [{ id: crypto.randomUUID(), message: event.message, at: Date.now() }, ...prev].slice(0, 40),
      );
    };
    window.addEventListener("error", onError);
    const onInstall = (event: Event) => {
      event.preventDefault();
      installRef.current = event as InstallPrompt;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateNonce((value) => value + 1);
        setFocus("rail");
        setOverlay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      media.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("error", onError);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const handle = window.setInterval(() => {
      const due = remindersRef.current.filter((item) => !item.done && item.at <= Date.now());
      if (due.length === 0) return;
      if ("Notification" in window && Notification.permission === "granted") {
        for (const item of due) {
          try {
            new Notification("Sandbench", { body: item.title });
          } catch {
            // Notification construction can fail if permission changes mid-interval.
          }
        }
      }
      const ids = new Set(due.map((item) => item.id));
      setReminders((prev) => prev.map((item) => (ids.has(item.id) ? { ...item, done: true } : item)));
    }, 4000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (!hydrated || overlay !== null) return;
    composerRef.current?.focus();
  }, [focus, selectedBotId, hydrated, unlocked, overlay]);

  useEffect(() => {
    return () => {
      for (const file of pendingRef.current) URL.revokeObjectURL(file.previewUrl);
    };
  }, []);

  const streaming = threads.some((thread) => thread.messages.some((message) => message.status === "streaming"));
  const youLabel = settings.displayName.trim() || t("you");
  const locked = settings.lockEnabled && Boolean(settings.pinHash || settings.credentialId) && !unlocked;

  function patchSettings(partial: Partial<Settings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  function addPending(blob: Blob, name: string, kind: "image" | "audio") {
    if (blob.size > 8 * 1024 * 1024) {
      setBanner(t("tooLarge"));
      return;
    }
    setPending((prev) => {
      if (prev.length >= 4) {
        queueMicrotask(() => setBanner(t("tooMany")));
        return prev;
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind,
          name,
          mime: blob.type || (kind === "image" ? "image/png" : "audio/webm"),
          blob,
          previewUrl: URL.createObjectURL(blob),
        },
      ];
    });
  }

  function takeFiles(files: FileList | File[]) {
    for (const file of files) {
      if (file.type.startsWith("image/")) addPending(file, file.name || "photo.png", "image");
    }
  }


  function stop() {
    abortRef.current?.abort();
  }

  function applyTestProfileToBot(botId: string, profile: TestProfileId, syncSettings = true) {
    setBots((prev) =>
      prev.map((bot) => (bot.id === botId ? mergeBotProfile(bot, profile, settingsRef.current) : bot)),
    );
    if (syncSettings && profileTouchesCompatBase(profile)) {
      patchSettings(applyProfileToSettings(profile));
    }
  }

  /** A change saved on another device, applied to the matching piece of state. */
  function applyRemoteChange(change: RemoteRecord) {
    switch (change.kind) {
      case "agents":
        return setBots((prev) => upsertItem(prev, change));
      case "threads":
        return setThreads((prev) => applyThreadChange(prev, change));
      case "messages":
        return setThreads((prev) => applyMessageChange(prev, change));
      case "routines":
        return setRoutines((prev) => upsertItem(prev, change));
      case "tasks":
        return setTasks((prev) => upsertItem(prev, change));
      case "reminders":
        return setReminders((prev) => upsertItem(prev, change));
      case "events":
        return setEvents((prev) => upsertItem(prev, change));
      case "contacts":
        return setContacts((prev) => upsertItem(prev, change));
      case "logs":
        return setLogs((prev) => upsertItem(prev, change));
      case "computer":
        return setComputer((prev) => upsertItem(prev, change));
      case "settings":
        return change.deleted ? undefined : setSettings((prev) => ({ ...prev, ...(change.data as Partial<Settings>) }));
      case "studio":
        return change.deleted ? undefined : setStudio((prev) => ({ ...prev, ...(change.data as Partial<Studio>) }));
    }
  }

  function refreshKeys(): Promise<boolean> {
    return listSecrets().then(
      (list) => {
        setSecretInfo(list);
        setKeysAvailable(true);
        return true;
      },
      () => {
        setKeysAvailable(false);
        return false;
      },
    );
  }

  /** Move keys left by an older build into the harness or runner, then forget them here. */
  async function flushPendingSecrets() {
    const pending = await loadPendingSecrets().catch(() => [] as LegacySecret[]);
    if (pending.length === 0) return;
    const left = await moveLegacySecrets(pending);
    await savePendingSecrets(left).catch(() => undefined);
    if (left.length < pending.length) {
      setLogs((prev) => [{ id: crypto.randomUUID(), message: translate(settingsRef.current.locale, "keysMoved"), at: Date.now() }, ...prev].slice(0, 40));
      void refreshKeys();
    }
    if (left.length) setBanner(translate(settingsRef.current.locale, "keysPending"));
  }

  async function saveKey(name: string, value: string) {
    await saveSecret(name, value);
    await refreshKeys();
  }

  async function removeKey(name: string) {
    await removeSecret(name);
    await refreshKeys();
  }

  function applyDefaultTestProfile(profile: TestProfileId) {
    const current = settingsRef.current;
    const patch = applyProfileToSettings(profile);
    if (profileTouchesCompatBase(profile) && current.compatBase?.trim()) {
      if (!window.confirm(translate(current.locale, "testProfileOverwriteCompat"))) {
        delete patch.compatBase;
      }
    }
    patchSettings(patch);
    // The mock server takes any key; store one unless a real COMPAT_API_KEY is already there.
    if (profile === "mock" && keysAvailable && !keyNamesRef.current.has("COMPAT_API_KEY")) {
      void saveSecret("COMPAT_API_KEY", MOCK_COMPAT_KEY).then(refreshKeys, () => undefined);
    }
  }

  function patchBot(id: string, patch: Partial<Bot>) {
    setBots((prev) =>
      prev.map((bot) => {
        if (bot.id === id) return { ...bot, ...patch };
        if (patch.primary) return { ...bot, primary: false };
        return bot;
      }),
    );
    if (patch.name) {
      setThreads((prev) => prev.map((thread) => (thread.botId === id && thread.messages.length === 0 ? { ...thread, title: patch.name ?? thread.title } : thread)));
    }
  }

  function rememberDraft(nextKey: string | null) {
    const previous = targetRef.current;
    if (previous === nextKey) return;
    const saved = draftRef.current;
    setStudio((prev) => ({ ...prev, drafts: previous ? { ...prev.drafts, [previous]: saved } : prev.drafts }));
    setDraft(nextKey ? studioRef.current.drafts[nextKey] ?? "" : "");
    targetRef.current = nextKey;
  }

  function openThread(threadId: string) {
    const thread = threadsRef.current.find((item) => item.id === threadId);
    if (!thread) return;
    rememberDraft(threadId);
    setOpenThreadId(threadId);
    if (!thread.memberIds && thread.botId) {
      const botId = thread.botId;
      setSelectedBotId(botId);
      if (botsRef.current.some((bot) => bot.id === botId && bot.unread)) {
        setBots((prev) => prev.map((bot) => (bot.id === botId ? { ...bot, unread: false } : bot)));
      }
    }
    setFocus("chat");
    setOverlay(null);
  }

  function duplicateBot(id: string) {
    const source = botsRef.current.find((bot) => bot.id === id);
    if (!source) return;
    addBots([
      {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} ${t("copySuffix")}`,
        primary: false,
        pinned: false,
        unread: false,
        hidden: false,
        lastThinking: [],
        lastPreview: undefined,
        createdAt: Date.now(),
      },
    ]);
  }

  function openBot(botId: string) {
    const chat = latestBotThread(threadsRef.current, botId);
    if (chat) openThread(chat.id);
    else {
      setSelectedBotId(botId);
      setBots((prev) => prev.map((bot) => (bot.id === botId && bot.unread ? { ...bot, unread: false } : bot)));
      setOpenThreadId(null);
      rememberDraft(null);
    }
  }

  function createChat(botId: string) {
    const bot = botsRef.current.find((item) => item.id === botId);
    const thread: Thread = { id: crypto.randomUUID(), botId, title: bot?.name || "New chat", updatedAt: Date.now(), messages: [] };
    const next = [thread, ...threadsRef.current];
    threadsRef.current = next;
    setThreads(next);
    openThread(thread.id);
  }

  function addBots(next: Bot[], options?: { skipThreads?: boolean }) {
    if (next.length === 0) return;
    const hasBots = botsRef.current.length > 0;
    const made = next.map((bot, index) => ({ ...bot, primary: !hasBots && index === 0 }));
    setBots((prev) => [...prev, ...made]);
    if (options?.skipThreads) return;
    const madeThreads = made.map((bot): Thread => ({ id: crypto.randomUUID(), botId: bot.id, title: bot.name, updatedAt: Date.now(), messages: [] }));
    const nextThreads = [...madeThreads, ...threadsRef.current];
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    openThread(madeThreads[0].id);
  }

  function importMigration(pack: MigrationApply) {
    importTeam(pack, { skipBotThreads: pack.threads.length > 0 });
    if (pack.threads.length) {
      const nextThreads = [...pack.threads, ...threadsRef.current];
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
      openThread(pack.threads[0].id);
    }
    if (pack.webhooks.length) setStudio((prev) => ({ ...prev, webhooks: [...pack.webhooks, ...prev.webhooks] }));
    if (pack.autoApprove?.length) setStudio((prev) => ({ ...prev, autoApprove: pack.autoApprove! }));
  }

  function importTeam(team: TeamApply, options?: { skipBotThreads?: boolean }) {
    setStudio((prev) => ({ ...prev, plugins: [...prev.plugins, ...team.plugins], connectors: [...prev.connectors, ...team.connectors] }));
    addBots(team.bots, { skipThreads: options?.skipBotThreads });
    if (team.channels.length > 0) {
      const nextThreads = [...threadsRef.current, ...team.channels];
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
    }
    if (team.routines.length > 0) {
      routinesRef.current = [...team.routines, ...routinesRef.current];
      setRoutines((prev) => [...team.routines, ...prev]);
    }
  }

  function createBot(name: string, role: string) {
    addBots([blankBot(name, role, botsRef.current.length === 0, settingsRef.current)]);
  }

  function addFromTemplates(items: Bot[] | BotTemplate[]) {
    const list = items as (Bot | BotTemplate)[];
    addBots(list.map((item) => ("createdAt" in item ? item : botFromTemplate(item, false))));
  }

  function deleteBot(id: string) {
    setBots((prev) => prev.filter((bot) => bot.id !== id));
    setTasks((prev) => prev.filter((task) => task.botId !== id));
    setRoutines((prev) => prev.filter((routine) => routine.botId !== id));
    const nextThreads = threadsRef.current
      .filter((thread) => thread.memberIds || thread.botId !== id)
      .map((thread) => (thread.memberIds?.includes(id) ? { ...thread, memberIds: thread.memberIds.filter((item) => item !== id) } : thread));
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    setComputer((prev) => prev.filter((event) => event.botId !== id));
    setReminders((prev) => prev.filter((item) => item.botId !== id));
    const gone = studioRef.current.files.filter((file) => file.botId === id);
    for (const file of gone) void deleteBlob(file.id);
    setStudio((prev) => ({ ...prev, files: prev.files.filter((file) => file.botId !== id) }));
    setSelectedBotId((current) => (current === id ? null : current));
    const open = nextThreads.find((thread) => thread.id === openThreadRef.current);
    if (!open) {
      const fallback = nextThreads.find((thread) => !thread.memberIds) ?? nextThreads[0];
      if (fallback) openThread(fallback.id);
      else {
        setOpenThreadId(null);
        targetRef.current = null;
        setDraft("");
      }
    }
  }

  function removeThread(threadId: string) {
    const thread = threadsRef.current.find((item) => item.id === threadId);
    if (!thread || thread.memberIds) return;
    const nextThreads = threadsRef.current.filter((item) => item.id !== threadId);
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    if (openThreadRef.current !== threadId) return;
    const sibling = latestBotThread(nextThreads, thread.botId ?? "");
    if (sibling) openThread(sibling.id);
    else {
      setOpenThreadId(null);
      targetRef.current = null;
      setDraft("");
    }
  }

  function createChannel(title: string, memberIds: string[]) {
    const thread: Thread = { id: crypto.randomUUID(), title, memberIds, updatedAt: Date.now(), messages: [] };
    const next = [thread, ...threadsRef.current];
    threadsRef.current = next;
    setThreads(next);
    openThread(thread.id);
  }

  async function sendToChannel(channelId: string, text: string) {
    const channel = threadsRef.current.find((thread) => thread.id === channelId);
    if (!channel?.memberIds || sendingRef.current) return;
    const members = botsRef.current.filter((bot) => channel.memberIds?.includes(bot.id));
    const lower = text.toLowerCase();
    const mentioned = members.filter((bot) => lower.includes(`@${bot.name.toLowerCase()}`));
    if (mentioned.length === 0 && channel.autoRoute && members.length > 1) {
      const picked = await pickResponder(channel, members, text);
      if (picked.everyone) {
        for (let index = 0; index < members.length; index += 1) {
          const shown = await askBot(members[index].id, text, {
            threadId: channelId,
            skipUser: index > 0,
            routed: index === 0 ? `${t("routedTo")} ${picked.reason}.` : undefined,
          });
          if (shown.length === 0 && index === 0) return;
        }
        return;
      }
      await askBot(picked.bot.id, text, { threadId: channelId, routed: `${t("routedTo")} ${picked.bot.name}: ${picked.reason}.` });
      return;
    }
    const targets = mentioned.length > 0 ? mentioned : members;
    for (let index = 0; index < targets.length; index += 1) {
      const shown = await askBot(targets[index].id, text, { threadId: channelId, skipUser: index > 0 });
      if (shown.length === 0 && index === 0) return;
    }
  }

  async function pickResponder(channel: Thread, members: Bot[], text: string): Promise<{ bot: Bot; reason: string; everyone?: boolean }> {
    const lead = members.find((bot) => bot.id === channel.leadBotId) ?? members[0];
    const settings = settingsRef.current;
    if (settings.decisionEnabled) {
      const decided = await pickWithDecisionModel(settings, channel, members, text, keyNamesRef.current);
      if (decided?.everyone) {
        return { bot: lead, reason: `${t("pickedByDecision")} · ${Math.round(decided.probability * 100)}% · everyone`, everyone: true };
      }
      if (decided?.bot) {
        return {
          bot: decided.bot,
          reason: `${t("pickedByDecision")} · ${Math.round(decided.probability * 100)}% (${decided.providerLabel})`,
        };
      }
    }
    const route = routeFor(lead, settings, keyNamesRef.current);
    if (route.ready) {
      try {
        const raw = await completeText({
          messages: [{ role: "user", content: routePrompt(members, text, channel.sharedInstructions) }],
          apiBase: route.apiBase,
          model: route.model,
          useProxy: route.useProxy,
          provider: route.provider,
          signal: AbortSignal.timeout(15_000),
        });
        const picked = parseRoute(raw, members);
        if (picked) return picked;
      } catch {
        // Fall through to the local match, then the lead.
      }
    }
    return routeLocally(members, text) ?? { bot: lead, reason: "no clear match, so the lead answers" };
  }

  async function addFiles(botId: string, list: FileList) {
    const made: Studio["files"] = [];
    for (const file of Array.from(list)) {
      if (file.size > 25 * 1024 * 1024) {
        setBanner(t("tooLarge"));
        continue;
      }
      const id = crypto.randomUUID();
      try {
        await saveBlob(id, file);
      } catch {
        setBanner(t("dbError"));
        return;
      }
      made.push({ id, botId, name: file.name, mime: file.type || "application/octet-stream", size: file.size, addedAt: Date.now() });
    }
    if (made.length > 0) setStudio((prev) => ({ ...prev, files: [...made, ...prev.files] }));
  }

  function removeFile(id: string) {
    void deleteBlob(id);
    setStudio((prev) => ({ ...prev, files: prev.files.filter((file) => file.id !== id) }));
  }

  function resolveCallTarget(): { botId: string; threadId?: string } | null {
    const fromThread = (id: string | null) => {
      if (!id) return null;
      const thread = threadsRef.current.find((item) => item.id === id);
      if (thread?.botId && !thread.memberIds) return { botId: thread.botId, threadId: thread.id };
      return null;
    };
    const direct = fromThread(targetRef.current) ?? fromThread(openThreadRef.current);
    if (direct) return direct;
    const botId = selectedBotRef.current;
    if (botId && botsRef.current.some((bot) => bot.id === botId)) return { botId };
    return null;
  }

  function scheduleListenForCall(delayMs = 400) {
    if (!callRef.current) return;
    window.setTimeout(() => {
      if (callRef.current) listenForCall();
    }, delayMs);
  }

  async function ensureMicForCall(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch {
      setBanner(t("micFailed"));
      return false;
    }
  }

  function listenForCall() {
    if (!callRef.current) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      callRef.current = false;
      setCallActive(false);
      setBanner(t("speechMissing"));
      return;
    }
    if (speechRef.current) {
      try {
        speechRef.current.stop();
      } catch {
        // Already stopped.
      }
      speechRef.current = null;
    }
    const recognition = new Ctor();
    recognition.lang = LOCALE_OPTIONS.find((item) => item.id === settingsRef.current.locale)?.speech ?? "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    let heard = "";
    let retry = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        heard += ` ${event.results[index]?.[0].transcript ?? ""}`;
      }
    };
    recognition.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        callRef.current = false;
        setCallActive(false);
        setListening(false);
        setBanner(t("micFailed"));
        return;
      }
      if (code === "aborted") return;
      retry = true;
      if (code === "audio-capture") setBanner(t("callListenFailed"));
      if (code === "network") setBanner(t("callNetwork"));
    };
    recognition.onend = () => {
      if (speechRef.current === recognition) speechRef.current = null;
      setListening(false);
      if (!callRef.current || holdListenRef.current) return;
      const said = heard.trim();
      if (!said) {
        scheduleListenForCall(retry ? 600 : 400);
        return;
      }
      const target = resolveCallTarget();
      if (!target) {
        setBanner(t("callNoBot"));
        scheduleListenForCall();
        return;
      }
      void askBot(target.botId, said, target.threadId ? { threadId: target.threadId } : undefined);
    };
    speechRef.current = recognition;
    setListening(true);
    let waits = 0;
    const start = () => {
      if (!callRef.current || speechRef.current !== recognition) return;
      if ("speechSynthesis" in window && window.speechSynthesis.speaking && waits < 15) {
        waits += 1;
        window.setTimeout(start, 200);
        return;
      }
      try {
        recognition.start();
      } catch {
        setListening(false);
        if (speechRef.current === recognition) speechRef.current = null;
        scheduleListenForCall();
      }
    };
    start();
  }

  function toggleCall() {
    if (callRef.current) {
      callRef.current = false;
      holdListenRef.current = false;
      speakTokenRef.current += 1;
      setCallActive(false);
      setListening(false);
      speechRef.current?.stop();
      speechRef.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      return;
    }
    void (async () => {
      const allowed = await ensureMicForCall();
      if (!allowed) return;
      if (callRef.current) return;
      callRef.current = true;
      setCallActive(true);
      listenForCall();
    })();
  }

  function patchMessage(threadId: string, messageId: string, update: (message: Message) => Message) {
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id !== threadId ? thread : { ...thread, messages: thread.messages.map((message) => (message.id === messageId ? update(message) : message)) },
      ),
    );
  }

  function bumpUsage(patch: Partial<Studio["usage"]>) {
    setStudio((prev) => ({
      ...prev,
      usage: {
        ...prev.usage,
        turns: prev.usage.turns + (patch.turns ?? 0),
        charsIn: prev.usage.charsIn + (patch.charsIn ?? 0),
        charsOut: prev.usage.charsOut + (patch.charsOut ?? 0),
        commands: prev.usage.commands + (patch.commands ?? 0),
      },
    }));
  }

  function bumpBotUsage(botId: string, patch: Partial<{ turns: number; charsIn: number; charsOut: number; commands: number }>) {
    setBots((prev) =>
      prev.map((bot) => {
        if (bot.id !== botId) return bot;
        const usage = bot.usage ?? { turns: 0, charsIn: 0, charsOut: 0, commands: 0, since: Date.now() };
        return {
          ...bot,
          usage: {
            ...usage,
            turns: usage.turns + (patch.turns ?? 0),
            charsIn: usage.charsIn + (patch.charsIn ?? 0),
            charsOut: usage.charsOut + (patch.charsOut ?? 0),
            commands: usage.commands + (patch.commands ?? 0),
          },
        };
      }),
    );
  }

  const skillCacheRef = useRef<Map<string, string>>(new Map());

  async function skillLinesFor(bot: Bot): Promise<string[]> {
    if (!(bot.librarySkillIds?.length)) return [];
    try {
      const { skills } = await harnessSkills();
      for (const skill of skills) skillCacheRef.current.set(skill.id, `${skill.title}\n${skill.body.slice(0, 4000)}`);
    } catch {
      // Use cache when harness is down.
    }
    return (bot.librarySkillIds ?? [])
      .map((id) => skillCacheRef.current.get(id))
      .filter((line): line is string => Boolean(line));
  }

  async function memoryDocFor(botId: string): Promise<string> {
    try {
      const { files } = await harnessBotMemory(botId);
      return files
        .slice(0, 8)
        .map((file) => `## ${file.path}\n${file.content.slice(0, 6000)}`)
        .join("\n\n")
        .slice(0, 24_000);
    } catch {
      return "";
    }
  }

  async function readLibrary(botId: string): Promise<LibraryText[]> {
    const files = studioRef.current.files.filter((file) => file.botId === botId);
    const out: LibraryText[] = [];
    let budget = 40_000;
    for (const file of files) {
      if (budget <= 0) break;
      const textual = /text\/|json|xml|javascript|markdown|csv|svg/.test(file.mime) || /\.(md|txt|ts|tsx|js|jsx|json|csv|log|py|ps1|css|html|xml|yml|yaml)$/i.test(file.name);
      if (!textual) continue;
      const blob = await getBlob(file.id);
      if (!blob) continue;
      const text = (await blob.text()).slice(0, Math.min(12_000, budget));
      budget -= text.length;
      out.push({ name: file.name, text });
    }
    return out;
  }

  function beginAssistant(threadId: string, botId: string): string {
    const id = crypto.randomUUID();
    const message: Message = {
      id,
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      attachments: [],
      status: "streaming",
      localStandIn: !routeFor(botsRef.current.find((item) => item.id === botId), settingsRef.current, keyNamesRef.current).ready,
      fresh: true,
      authorBotId: botId,
    };
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id !== threadId
          ? thread
          : { ...thread, updatedAt: Date.now(), messages: thread.messages.map((item) => ({ ...item, fresh: false })).concat(message) },
      ),
    );
    return id;
  }

  function pluginLinesFor(bot: Bot): string[] {
    return [...BUILTIN_PLUGINS, ...studioRef.current.plugins].filter((item) => (bot.plugins ?? []).includes(item.id)).map((item) => item.instructions);
  }

  function makeApproval(action: StepAction, unattended: boolean, bot?: Bot): Approval {
    const auto = action.kind === "command" && autoApproved(action.command, studioRef.current.autoApprove);
    const mode = bot?.approvalMode ?? "ask";
    const autoOk = mode === "auto" || mode === "full" ? auto || mode === "full" : auto;
    return {
      ...approvalFields(action),
      status:
        needsHarness(action) && !harnessRef.current
          ? "unavailable"
          : autoOk
            ? "approved"
            : unattended && !auto && studioRef.current.unattended === "skip"
              ? "denied"
              : "pending",
    };
  }

  function attachPrevious(threadId: string, messageId: string, approval: Approval | undefined) {
    const file = approval?.file;
    if (!file || approval.status !== "pending") return;
    void harnessReadFile(file.path)
      .then((current) => {
        patchMessage(threadId, messageId, (message) =>
          message.approval?.file ? { ...message, approval: { ...message.approval, file: { ...message.approval.file, existed: current.exists, previous: current.exists ? current.content : undefined } } } : message,
        );
      })
      .catch(() => undefined);
  }

  async function answerFromResult(
    threadId: string,
    botId: string,
    label: string,
    output: string,
    exitCode: number | undefined,
    failed: boolean,
    unattended: boolean,
    signal: AbortSignal,
  ) {
    const bot = botsRef.current.find((item) => item.id === botId);
    if (!bot) return;
    const room = threadsRef.current.find((thread) => thread.id === threadId);
    const messages = room?.messages ?? [];
    let start = 0;
    messages.forEach((message, index) => {
      if (message.role === "user") start = index + 1;
    });
    const request = [...messages].reverse().find((message) => message.role === "user")?.text ?? "";
    const finished = messages.slice(start).flatMap((message) =>
      message.approval && (message.approval.status === "approved" || message.approval.status === "failed")
        ? [{ label: message.approval.command, output: message.approval.output ?? "" }]
        : [],
    );
    const current = finished.find((item) => item.label === label);
    if (current) current.output = output;
    else finished.push({ label, output });
    const local = interpretResult({ bot, label, output, exitCode, failed });
    const connectors = studioRef.current.connectors.filter((item) => (bot.connectorIds ?? []).includes(item.id));
    const capped = failed || finished.length >= MAX_ACTIONS;
    let follow: StepAction | undefined;
    let prose = local;
    let modelSpoke = false;
    const route = routeFor(bot, settingsRef.current, keyNamesRef.current);
    if (!capped && route.ready) {
      try {
        const raw = await completeText({
          messages: [
            {
              role: "user",
              content: decisionPrompt({
                bot,
                request,
                connectors,
                allow: studioRef.current.autoApprove,
                library: await readLibrary(bot.id),
                pluginLines: pluginLinesFor(bot),
                finished,
                shared: room?.memberIds ? room.sharedInstructions : undefined,
              }),
            },
          ],
          apiBase: route.apiBase,
          model: route.model,
          useProxy: route.useProxy,
          provider: route.provider,
          signal,
        });
        const decision = parseModelDecision(raw, connectors);
        if (decision) {
          modelSpoke = true;
          prose = decision.answer;
          follow = guardAction(bot, decision.action);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
      }
    }
    if (!modelSpoke && !capped) follow = nextLocalAction(bot, request, finished, connectors);
    follow = inFolder(follow, roomFolder(room));
    if (follow && finished.some((item) => item.label === actionLabel(follow!))) follow = undefined;
    if (follow && !modelSpoke) prose = continuationText(local, follow, follow.kind === "command" && autoApproved(follow.command, studioRef.current.autoApprove));
    const id = beginAssistant(threadId, botId);
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let text = "";
    const onDelta = (chunk: string) => {
      text += chunk;
      patchMessage(threadId, id, (message) => ({ ...message, text: message.text + chunk }));
    };
    try {
      await streamText(prose, instant, signal, onDelta);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (!text) onDelta(prose);
    }
    const approval = follow ? makeApproval(follow, unattended, bot) : undefined;
    patchMessage(threadId, id, (message) => ({ ...message, status: "done", approval }));
    attachPrevious(threadId, id, approval);
    bumpUsage({ charsOut: text.length });
    bumpBotUsage(bot.id, { charsOut: text.length });
    finishTurnAudio(bot, text || prose);
    if (
      approval &&
      follow &&
      (approval.status === "approved" ||
        (approval.status === "pending" && follow.kind === "command" && autoApproved(follow.command, studioRef.current.autoApprove)))
    ) {
      await runApproval(threadId, id, approval, true, unattended, signal);
      bumpBotUsage(bot.id, { commands: 1 });
    }
  }

  function addActivity(threadId: string, messageId: string, label: string, ms?: number) {
    patchMessage(threadId, messageId, (message) => ({
      ...message,
      activity: [...(message.activity ?? []), { label: label.slice(0, 120), ...(ms !== undefined ? { ms: Math.round(ms) } : {}) }].slice(-6),
    }));
  }

  async function attachScreen(threadId: string, messageId: string) {
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const bitmap = await createImageBitmap(await harnessScreen());
      const width = Math.min(360, bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round((bitmap.height * width) / bitmap.width);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const thumb = canvas.toDataURL("image/jpeg", 0.6);
      if (thumb.length < 120_000) patchMessage(threadId, messageId, (message) => ({ ...message, screenThumb: thumb }));
    } catch {
      // A missing thumbnail leaves the card and its output intact.
    }
  }

  async function runApproval(
    threadId: string,
    messageId: string,
    approval: Approval,
    auto: boolean,
    unattended = false,
    signal: AbortSignal = new AbortController().signal,
    answer?: string,
  ) {
    const command = approval.command;
    patchMessage(threadId, messageId, (message) =>
      message.approval ? { ...message, approval: { ...message.approval, status: "approved", auto, output: approval.question ? answer ?? "" : "…" } } : message,
    );
    try {
      if (approval.question) {
        const author = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((message) => message.id === messageId)?.authorBotId ?? "";
        await answerFromResult(threadId, author, approval.command, answer ?? "", undefined, false, unattended, signal);
        return;
      }
      if (approval.file) {
        const started = performance.now();
        const result = await harnessWriteFile({ path: approval.file.path, op: approval.file.op, content: approval.file.preview });
        const output = approval.file.op === "delete" ? `Deleted ${result.path}.` : `Wrote ${result.path} (${result.bytes.toLocaleString()} bytes).`;
        patchMessage(threadId, messageId, (message) =>
          message.approval ? { ...message, approval: { ...message.approval, output, exitCode: 0 } } : message,
        );
        bumpUsage({ commands: 1 });
        addActivity(threadId, messageId, `${approval.file.op === "delete" ? "Deleted" : "Wrote"} ${result.path}`, performance.now() - started);
        const author = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((message) => message.id === messageId)?.authorBotId ?? "";
        if (author) {
          setComputer((prev) =>
            [{ id: crypto.randomUUID(), botId: author, at: Date.now(), app: "Files", action: `${approval.command} (${Math.round(performance.now() - started)} ms)`, cpu: 10 }, ...prev].slice(0, 40),
          );
        }
        await answerFromResult(threadId, author, approval.command, output, 0, false, unattended, signal);
        return;
      }
      if (approval.pointer) {
        const result = await harnessInput(approval.pointer);
        const output = [result.stdout.trimEnd(), result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : ""].filter(Boolean).join("\n");
        patchMessage(threadId, messageId, (message) =>
          message.approval ? { ...message, approval: { ...message.approval, output, exitCode: result.code } } : message,
        );
        bumpUsage({ commands: 1 });
        addActivity(threadId, messageId, approval.command, result.ms);
        if (settingsRef.current.attachWorkScreenshots !== false) {
          if (result.screenThumb && result.screenThumb.length < 200_000) {
            patchMessage(threadId, messageId, (message) => ({ ...message, screenThumb: result.screenThumb }));
          } else {
            void attachScreen(threadId, messageId);
          }
        }
        const author = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((message) => message.id === messageId)?.authorBotId ?? "";
        if (author) {
          setComputer((prev) =>
            [{ id: crypto.randomUUID(), botId: author, at: Date.now(), app: "Screen", action: approval.command, cpu: 12 }, ...prev].slice(0, 40),
          );
        }
        await answerFromResult(threadId, author, approval.command, output, result.code, result.code !== 0, unattended, signal);
        return;
      }
      if (approval.tool) {
        const connector = studioRef.current.connectors.find((item) => item.id === approval.tool?.connectorId);
        if (!connector) throw new Error("That connector was removed.");
        const started = performance.now();
        const result = await harnessCallTool(connector.url, connectorHeaders(connector), approval.tool.name, approval.tool.args);
        patchMessage(threadId, messageId, (message) =>
          message.approval ? { ...message, approval: { ...message.approval, output: result.text, exitCode: result.isError ? 1 : 0 } } : message,
        );
        bumpUsage({ commands: 1 });
        addActivity(threadId, messageId, `Called ${approval.command}`, performance.now() - started);
        const author = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((message) => message.id === messageId)?.authorBotId ?? "";
        await answerFromResult(threadId, author, approval.command, result.text, result.isError ? 1 : 0, result.isError, unattended, signal);
        return;
      }
      const room = threadsRef.current.find((thread) => thread.id === threadId);
      const wantShot = settingsRef.current.attachWorkScreenshots !== false;
      const result = await harnessExec(command, roomFolder(room), wantShot);
      const output = [result.stdout.trimEnd(), result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "", result.truncated ? "(output truncated)" : ""]
        .filter(Boolean)
        .join("\n");
      patchMessage(threadId, messageId, (message) =>
        message.approval
          ? {
              ...message,
              approval: { ...message.approval, output, exitCode: result.code },
              ...(wantShot && result.screenThumb && result.screenThumb.length < 200_000 ? { screenThumb: result.screenThumb } : {}),
            }
          : message,
      );
      bumpUsage({ commands: 1 });
      addActivity(threadId, messageId, `Ran ${command} · exit ${result.code}`, result.ms);
      const botId = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((message) => message.id === messageId)?.authorBotId;
      if (botId) {
        setComputer((prev) =>
          [{ id: crypto.randomUUID(), botId, at: Date.now(), app: "Terminal", action: `Ran ${command} (exit ${result.code}, ${result.ms} ms)`, cpu: 30 }, ...prev].slice(0, 40),
        );
      }
      const author = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((message) => message.id === messageId)?.authorBotId ?? "";
      await answerFromResult(threadId, author, command, output, result.code, result.code !== 0, unattended, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      patchMessage(threadId, messageId, (item) =>
        item.approval ? { ...item, approval: { ...item.approval, status: "failed", output: message } } : item,
      );
      const author = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((item) => item.id === messageId)?.authorBotId ?? "";
      await answerFromResult(threadId, author, approval.command, message, undefined, true, unattended, signal);
    }
  }

  function decideApproval(threadId: string, messageId: string, approve: boolean, answer?: string) {
    const message = threadsRef.current.find((thread) => thread.id === threadId)?.messages.find((item) => item.id === messageId);
    if (!message?.approval || message.approval.status !== "pending") return;
    const permissionId = message.approval.permissionId;
    if (permissionId) {
      patchMessage(threadId, messageId, (item) => (item.approval ? { ...item, approval: { ...item.approval, status: approve ? "approved" : "denied", ...(approve ? { output: "…" } : {}) } } : item));
      void harnessPermit(permissionId, approve).catch((error) => {
        patchMessage(threadId, messageId, (item) =>
          item.approval ? { ...item, approval: { ...item.approval, status: "failed", output: error instanceof Error ? error.message : String(error) } } : item,
        );
      });
      return;
    }
    if (!approve) {
      patchMessage(threadId, messageId, (item) => (item.approval ? { ...item, approval: { ...item.approval, status: "denied" } } : item));
      if (callRef.current) scheduleListenForCall();
      return;
    }
    if (message.approval.question && !answer?.trim()) return;
    void runApproval(threadId, messageId, message.approval, false, false, new AbortController().signal, answer?.trim());
  }

  async function driveTurn(args: {
    bot: Bot;
    driver: string;
    threadId: string;
    assistantId: string;
    prompt: string;
    system: string;
    history: { role: "user" | "assistant"; content: string }[];
    folder?: string;
    unattended: boolean;
    signal: AbortSignal;
    appendThinking: (step: string) => void;
  }): Promise<string> {
    const { bot, threadId } = args;
    const route = routeFor(bot, settingsRef.current, keyNamesRef.current);
    const { id: turnId, after } = await harnessStartTurn({
      driver: args.driver,
      prompt: args.prompt,
      system: args.system,
      history: args.history,
      model: route.model,
      base:
        route.provider === "anthropic"
          ? "https://api.anthropic.com/v1"
          : route.apiBase.trim() || (route.useProxy ? "https://api.x.ai/v1" : ""),
      secret: route.secret,
      folder: args.folder,
      allow: studioRef.current.autoApprove,
      unattendedDeny: args.unattended && studioRef.current.unattended === "skip",
      captureScreen: settingsRef.current.attachWorkScreenshots !== false,
    });
    const stop = () => void harnessInterrupt(turnId).catch(() => undefined);
    args.signal.addEventListener("abort", stop, { once: true });
    let current: string | null = args.assistantId;
    let reply = "";
    let failure: string | undefined;
    const cards = new Map<string, { id: string; command: string }>();
    const target = () => {
      if (current) return current;
      const id = beginAssistant(threadId, bot.id);
      patchMessage(threadId, id, (message) => ({ ...message, localStandIn: false }));
      current = id;
      return id;
    };
    try {
      await harnessEvents(turnId, after, args.signal, (event) => {
        if (event.type === "thinking" && event.text) args.appendThinking(event.text);
        if (event.type === "message_delta" && event.text) {
          const chunk = event.text;
          reply += chunk;
          patchMessage(threadId, target(), (message) => ({ ...message, text: message.text + chunk }));
        }
        if (event.type === "permission_request" && event.permissionId) {
          const id = target();
          cards.set(event.permissionId, { id, command: event.command ?? "" });
          const status = event.auto ? "approved" : event.denied ? "denied" : "pending";
          const approval: Approval = {
            command: event.command ?? "",
            reason: event.reason || "The agent asked to run this.",
            status,
            permissionId: event.permissionId,
            ...(event.auto ? { auto: true, output: "…" } : {}),
          };
          patchMessage(threadId, id, (message) => ({ ...message, status: "done", approval }));
          current = null;
        }
        if (event.type === "permission_resolved" && event.permissionId) {
          const id = cards.get(event.permissionId)?.id;
          if (id) {
            patchMessage(threadId, id, (message) =>
              message.approval?.status === "pending" ? { ...message, approval: { ...message.approval, status: event.allow ? "approved" : "denied" } } : message,
            );
          }
        }
        if (event.type === "tool_end" && event.permissionId) {
          const card = cards.get(event.permissionId);
          if (card) {
            const { id, command } = card;
            const thumb = typeof event.screenThumb === "string" ? event.screenThumb : undefined;
            patchMessage(threadId, id, (message) =>
              message.approval
                ? {
                    ...message,
                    approval: { ...message.approval, output: event.output ?? "", ...(event.code !== undefined ? { exitCode: event.code } : {}) },
                    ...(thumb && thumb.length < 200_000 ? { screenThumb: thumb } : {}),
                  }
                : message,
            );
            addActivity(threadId, id, event.code !== undefined ? `Ran ${command} · exit ${event.code}` : `Agent ran ${command}`, event.ms);
            bumpUsage({ commands: 1 });
          }
        }
        if (event.type === "error") failure = event.message || "The agent stopped with an error.";
        return event.type === "done" || event.type === "error";
      });
    } finally {
      args.signal.removeEventListener("abort", stop);
      for (const { id } of cards.values()) {
        patchMessage(threadId, id, (message) => (message.approval?.status === "pending" ? { ...message, approval: { ...message.approval, status: "denied" } } : message));
      }
    }
    if (current) patchMessage(threadId, current, (message) => ({ ...message, status: "done" }));
    if (failure) throw new Error(failure);
    return reply;
  }

  function speakBrowser(text: string, bot: Bot, token: number, after?: () => void) {
    if (!("speechSynthesis" in window) || !text) {
      after?.();
      return;
    }
    try {
      if (!window.speechSynthesis.getVoices().length) {
        // iOS Safari often returns an empty voice list until a user gesture; skip instead of hanging.
        after?.();
        return;
      }
    } catch {
      after?.();
      return;
    }
    window.speechSynthesis.cancel();
    const tune = VOICES.find((item) => item.id === bot.voice) ?? VOICES[0];
    const utter = new SpeechSynthesisUtterance(text);
    utter.pitch = tune.pitch;
    utter.rate = tune.rate;
    const lang = LOCALE_OPTIONS.find((item) => item.id === settingsRef.current.locale)?.speech ?? "en-US";
    utter.lang = lang;
    const voices = window.speechSynthesis.getVoices();
    const match =
      voices.find((voice) => voice.lang === lang) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    if (match) utter.voice = match;
    let finished = false;
    const done = () => {
      if (finished || speakTokenRef.current !== token) return;
      finished = true;
      window.clearTimeout(watch);
      after?.();
    };
    const watch = window.setTimeout(done, Math.min(90_000, Math.max(4_000, text.length * 80)));
    utter.onend = done;
    utter.onerror = done;
    window.speechSynthesis.speak(utter);
  }

  function speakAs(bot: Bot, text: string, after?: () => void) {
    if (!text) {
      after?.();
      return;
    }
    const token = ++speakTokenRef.current;
    const settings = settingsRef.current;
    const mode = settings.ttsMode ?? "browser";
    const voiceId = (settings.ttsVoiceId || settings.xaiVoiceId || "").trim();
    const hosted =
      mode === "xai" || mode === "elevenlabs" || mode === "fish" || mode === "chatterbox" || mode === "system";
    if (hosted && harnessRef.current && (voiceId || mode === "system")) {
      // The harness adds the voice provider's key; the page only checks that one is stored.
      const needs = mode === "xai" ? "XAI_API_KEY" : mode === "elevenlabs" ? "ELEVENLABS_API_KEY" : mode === "fish" ? "FISH_API_KEY" : "";
      if (needs && !keyNamesRef.current.has(needs)) {
        speakBrowser(text, bot, token, after);
        return;
      }
      if (mode === "chatterbox" && !(settings.chatterboxBaseUrl || "").trim()) {
        speakBrowser(text, bot, token, after);
        return;
      }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      void harnessTtsSpeak({
        provider: mode,
        text,
        voiceId,
        baseUrl: settings.chatterboxBaseUrl,
        model: settings.chatterboxModel,
        fishModel: settings.fishModel,
      })
        .then(async (blob) => {
          if (speakTokenRef.current !== token) return;
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          const done = () => {
            URL.revokeObjectURL(url);
            if (speakTokenRef.current === token) after?.();
          };
          audio.onended = done;
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            speakBrowser(text, bot, token, after);
          };
          try {
            await audio.play();
          } catch {
            URL.revokeObjectURL(url);
            speakBrowser(text, bot, token, after);
          }
        })
        .catch(() => speakBrowser(text, bot, token, after));
      return;
    }
    speakBrowser(text, bot, token, after);
  }

  function finishTurnAudio(bot: Bot, text: string) {
    const resume = callRef.current;
    if (!(resume || bot.speakReplies)) return;
    if (resume) {
      holdListenRef.current = true;
      if (speechRef.current) {
        try {
          speechRef.current.stop();
        } catch {
          // Already stopped.
        }
        speechRef.current = null;
        setListening(false);
      }
    }
    const spoken = speakable(text);
    if (!spoken) {
      holdListenRef.current = false;
      if (resume) scheduleListenForCall();
      return;
    }
    speakAs(bot, spoken, resume
      ? () => {
          holdListenRef.current = false;
          scheduleListenForCall();
        }
      : undefined);
  }

  async function refreshTriggers() {
    try {
      const info = await harnessTriggers();
      setHookPort(info.hookPort);
      setTriggerRuns((prev) => (JSON.stringify(prev) === JSON.stringify(info.runs) ? prev : info.runs));
    } catch {
      // History only shows while the harness is running.
    }
  }

  function receiptDone(receipt: Receipt | undefined, botId: string, started: number, status: "ok" | "failed") {
    if (!receipt || !harnessRef.current) return;
    void harnessRecordRun({ ...receipt, botId, status, ms: Date.now() - started })
      .then(() => refreshTriggers())
      .catch(() => undefined);
  }

  function createTrigger(draft: TriggerDraft, botId: string): TriggerRef {
    const id = crypto.randomUUID();
    if (draft.kind === "routine") {
      const routine: Routine = { id, botId, title: draft.title, schedule: draft.schedule, enabled: true, lastRunAt: Date.now() };
      routinesRef.current = [routine, ...routinesRef.current];
      setRoutines((prev) => [routine, ...prev]);
    } else {
      const hook: WebhookTrigger = { id, botId, name: draft.name, title: draft.title, enabled: true, createdAt: Date.now() };
      setStudio((prev) => ({ ...prev, webhooks: [hook, ...prev.webhooks] }));
    }
    return { kind: draft.kind, id };
  }

  async function addWebhook(botId: string, name: string, title: string) {
    const hook: WebhookTrigger = { id: crypto.randomUUID(), botId, name, title, enabled: true, createdAt: Date.now() };
    const next = [hook, ...studioRef.current.webhooks];
    setStudio((prev) => ({ ...prev, webhooks: next }));
    if (harnessRef.current) await rotateWebhookSecret(hook.id, next);
  }

  async function rotateWebhookSecret(id: string, list = studioRef.current.webhooks) {
    try {
      await harnessSyncWebhooks(list);
      const { secret, preview } = await harnessWebhookSecret(id);
      setFreshSecret({ id, secret });
      setStudio((prev) => ({ ...prev, webhooks: prev.webhooks.map((item) => (item.id === id ? { ...item, secretPreview: preview } : item)) }));
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error));
    }
  }

  function patchTrigger(ref: TriggerRef, patch: { enabled?: boolean; title?: string; schedule?: string; name?: string }) {
    if (ref.kind === "routine") {
      setRoutines((prev) =>
        prev.map((item) =>
          item.id === ref.id
            ? { ...item, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.title ? { title: patch.title } : {}), ...(patch.schedule ? { schedule: patch.schedule } : {}) }
            : item,
        ),
      );
    } else {
      setStudio((prev) => ({
        ...prev,
        webhooks: prev.webhooks.map((item) =>
          item.id === ref.id
            ? { ...item, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.title ? { title: patch.title } : {}), ...(patch.name ? { name: patch.name } : {}) }
            : item,
        ),
      }));
    }
  }

  function removeTrigger(ref: TriggerRef) {
    if (ref.kind === "routine") setRoutines((prev) => prev.filter((item) => item.id !== ref.id));
    else setStudio((prev) => ({ ...prev, webhooks: prev.webhooks.filter((item) => item.id !== ref.id) }));
    if (freshSecret?.id === ref.id) setFreshSecret(null);
  }

  function resolveAgentDriver(bot: Bot): AgentDriver | undefined {
    if (!harnessRef.current) return undefined;
    const list = driversRef.current;
    if (bot.driver) {
      const chosen = list.find((item) => item.id === bot.driver);
      return chosen?.ok ? chosen : undefined;
    }
    const settings = settingsRef.current;
    const route = routeFor(bot, settings, keyNamesRef.current);
    const pick = (id: string) => list.find((item) => item.id === id && item.ok);
    if (settings.defaultAgentDriver) {
      const chosen = pick(settings.defaultAgentDriver);
      if (chosen) return chosen;
    }
    if (route.provider === "anthropic" && route.ready) return pick("anthropic");
    if (route.provider === "openai_compat" && route.ready && bot.skills.includes("computer")) return pick("http");
    return undefined;
  }

  async function askBot(botId: string, text: string, options: AskOptions = {}): Promise<string[]> {
    const bot = botsRef.current.find((item) => item.id === botId);
    const files = options.unattended || options.skipUser ? [] : pendingRef.current;
    const cleaned = text.trim();
    if (sendingRef.current) return [];
    if (!bot || (!cleaned && files.length === 0)) {
      if (callRef.current) scheduleListenForCall();
      return [];
    }
    if (bot.modelChoice === "composer") {
      setBanner(translate(settingsRef.current.locale, "reaComposerOnly"));
      if (callRef.current) scheduleListenForCall();
      return [];
    }
    sendingRef.current = true;
    const started = Date.now();
    setWorkingBotId(botId);
    try {
      for (const file of files) await saveBlob(file.id, file.blob);
    } catch {
      sendingRef.current = false;
      setWorkingBotId(null);
      setBanner(translate(settingsRef.current.locale, "dbError"));
      if (callRef.current) scheduleListenForCall();
      return [];
    }
    if (files.length > 0) {
      for (const file of files) URL.revokeObjectURL(file.previewUrl);
      setPending([]);
    }
    if (!options.unattended && !options.skipUser) setDraft("");
    const attachments = files.map(({ id, kind, name, mime }) => ({ id, kind, name, mime }));
    const noted = [cleaned, attachments.length > 0 ? `Attached: ${attachments.map((item) => item.name).join(", ")}` : ""].filter(Boolean).join("\n");
    const currentStudio = studioRef.current;
    const library = await readLibrary(bot.id);
    const room = options.threadId ? threadsRef.current.find((thread) => thread.id === options.threadId && thread.memberIds) : undefined;
    const shared = room?.sharedInstructions?.trim() || undefined;
    const plan = planTurn(bot, noted, {
      plugins: [...BUILTIN_PLUGINS, ...currentStudio.plugins],
      files: currentStudio.files,
      connectors: currentStudio.connectors,
      harness: Boolean(harnessRef.current),
      autoRun: (command) => autoApproved(command, currentStudio.autoApprove),
      library,
      shared,
    });
    if (options.routed) plan.thinking.unshift(options.routed);
    if (roomFolder(room)) plan.thinking.push(`Work inside ${roomFolder(room)} in the workspace.`);
    const open = openThreadRef.current ? threadsRef.current.find((thread) => thread.id === openThreadRef.current && thread.botId === botId && !thread.memberIds) : undefined;
    const existing = options.threadId
      ? threadsRef.current.find((thread) => thread.id === options.threadId)
      : open ?? latestBotThread(threadsRef.current, botId);
    const threadId = existing?.id ?? options.threadId ?? crypto.randomUUID();
    const isChannel = Boolean(existing?.memberIds);
    const assistantId = crypto.randomUUID();
    let replyText = "";
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: cleaned,
      createdAt: Date.now(),
      attachments,
      status: "done",
      localStandIn: false,
      fresh: false,
    };
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      attachments: [],
      status: "streaming",
      localStandIn: !routeFor(bot, settingsRef.current, keyNamesRef.current).ready,
      fresh: true,
      thinking: [],
      authorBotId: botId,
    };
    const added = options.skipUser ? [assistantMessage] : [userMessage, assistantMessage];
    const title = cleaned.slice(0, 72);
    setThreads((prev) => {
      const current = prev.find((thread) => thread.id === threadId);
      const next: Thread = current
        ? {
            ...current,
            botId: isChannel ? current.botId : botId,
            title: isChannel ? current.title : current.messages.length === 0 ? title : current.title || title,
            updatedAt: Date.now(),
            messages: current.messages.map((message) => ({ ...message, fresh: false })).concat(added),
          }
        : { id: threadId, botId, title, updatedAt: Date.now(), messages: added };
      return [next, ...prev.filter((thread) => thread.id !== threadId)];
    });
    bumpUsage({ turns: 1, charsIn: options.skipUser ? 0 : cleaned.length });
    bumpBotUsage(botId, { turns: 1, charsIn: options.skipUser ? 0 : cleaned.length });
    setBots((prev) => prev.map((item) => (item.id === botId ? { ...item, lastThinking: [] } : item)));
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const generation = ++genRef.current;
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shown: string[] = [];
    const appendThinking = (step: string) => {
      if (genRef.current !== generation) return;
      shown.push(step);
      setBots((prev) => prev.map((item) => (item.id === botId ? { ...item, lastThinking: [...item.lastThinking, step] } : item)));
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id !== threadId
            ? thread
            : {
                ...thread,
                messages: thread.messages.map((message) =>
                  message.id === assistantId ? { ...message, thinking: [...(message.thinking ?? []), step] } : message,
                ),
              },
        ),
      );
    };
    const [skillLines, memoryDoc] = await Promise.all([skillLinesFor(bot), memoryDocFor(botId)]);
    try {
      const driver = resolveAgentDriver(bot);
      if ((bot.driver || settingsRef.current.defaultAgentDriver) && !driver) {
        plan.thinking.unshift("The chosen agent is not available right now, so the built-in planner answers.");
      }
      if (driver) {
        if (options.routed) appendThinking(options.routed);
        appendThinking(`Hand the turn to ${driver.label}.`);
        patchMessage(threadId, assistantId, (message) => ({ ...message, localStandIn: false }));
        const reply = await driveTurn({
          bot,
          driver: driver.id,
          threadId,
          assistantId,
          prompt: noted,
          system: assembleBotSystem({
            bot,
            sharedInstructions: shared,
            pluginLines: pluginLinesFor(bot),
            skillLines,
            memoryDoc,
            libraryLines: library.map((file) => `## ${file.name}\n${file.text.slice(0, 4000)}`),
            footer: "Commands run in PowerShell on the user's Windows computer, inside their Sandbench workspace folder, after the user approves each one.",
          }),
          history: (existing?.messages ?? [])
            .filter((message) => message.status === "done" && message.text.trim())
            .slice(-20)
            .map((message) => ({ role: message.role, content: message.text })),
          folder: roomFolder(room),
          unattended: Boolean(options.unattended),
          signal: controller.signal,
          appendThinking,
        });
        replyText = reply;
        bumpUsage({ charsOut: reply.length });
        bumpBotUsage(botId, { charsOut: reply.length });
        if (!isChannel && (openThreadRef.current !== threadId || document.hidden)) {
          setBots((prev) => prev.map((item) => (item.id === botId ? { ...item, unread: true } : item)));
        }
        const latest = botsRef.current.find((item) => item.id === botId) ?? bot;
        if (reply) finishTurnAudio(latest, reply);
        else if (callRef.current) scheduleListenForCall();
        receiptDone(options.receipt, botId, started, "ok");
        return shown;
      }
      await playTurn({
        plan,
        instant,
        signal: controller.signal,
        onThinking: appendThinking,
        onAction: (action) => {
          if (genRef.current !== generation) return;
          setComputer((prev) =>
            [{ id: crypto.randomUUID(), botId, at: Date.now(), ...action }, ...prev].slice(0, 40),
          );
        },
      });
      const route = routeFor(bot, settingsRef.current, keyNamesRef.current);
      if (bot.model?.trim() || bot.provider === "openai_compat" || bot.provider === "anthropic") {
        const label = route.provider === "xai" ? "xAI" : route.provider === "anthropic" ? "Anthropic" : "the OpenAI-compatible provider";
        appendThinking(`Answer with ${route.model} through ${label}.`);
      }
      const botConnectors = currentStudio.connectors.filter((item) => (bot.connectorIds ?? []).includes(item.id));
      let chosen = guardAction(bot, planAction(plan));
      let modelAnswer: string | undefined;
      let modelTrigger: TriggerDraft | undefined;
      if (route.ready) {
        try {
          const raw = await completeText({
            messages: [
              {
                role: "user",
                content: decisionPrompt({
                  bot,
                  request: cleaned,
                  connectors: botConnectors,
                  allow: currentStudio.autoApprove,
                  library,
                  pluginLines: pluginLinesFor(bot),
                  finished: [],
                  shared,
                }),
              },
            ],
            apiBase: route.apiBase,
            model: route.model,
            useProxy: route.useProxy,
            provider: route.provider,
            signal: controller.signal,
          });
          const decision = parseModelDecision(raw, botConnectors);
          if (decision && genRef.current === generation) {
            modelAnswer = decision.answer;
            modelTrigger = decision.trigger;
            chosen = guardAction(bot, decision.action);
            appendThinking(chosen ? `The model chose ${actionLabel(chosen)}.` : "The model answered without a computer action.");
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
        }
      }
      const writeReply = (chunk: string) => {
        if (genRef.current !== generation) return;
        replyText += chunk;
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id !== threadId
              ? thread
              : {
                  ...thread,
                  messages: thread.messages.map((message) => (message.id === assistantId ? { ...message, text: message.text + chunk } : message)),
                },
          ),
        );
      };
      if (modelAnswer !== undefined) {
        await streamText(modelAnswer, instant, controller.signal, writeReply);
      } else if (route.ready) {
        const prior = (existing?.messages ?? [])
          .filter((message) => message.status === "done" && message.text.trim())
          .map((message) => ({ role: message.role, content: message.text }));
        prior.push({
          role: "user" as const,
          content: [
            assembleBotSystem({
              bot,
              sharedInstructions: shared,
              pluginLines: pluginLinesFor(bot),
              skillLines,
              memoryDoc,
              libraryLines: library.map((file) => `## ${file.name}\n${file.text.slice(0, 4000)}`),
            }),
            chosen?.kind === "command" ? `You will ask the user to approve running \`${chosen.command}\` on their computer. Say so briefly.` : "",
            chosen?.kind === "tool" ? `You will ask the user to approve calling ${chosen.label}. ${chosen.why} Say so briefly.` : "",
            chosen?.kind === "pointer" ? `You will ask the user to approve ${chosen.label}. Say so briefly.` : "",
            cleaned,
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
        await streamReply({
          messages: prior,
          ready: route.ready,
          apiBase: route.apiBase,
          model: route.model,
          useProxy: route.useProxy,
          provider: route.provider,
          attachmentNames: attachments.map((item) => item.name),
          instant,
          signal: controller.signal,
          onDelta: writeReply,
        });
      } else {
        await streamText(plan.reply, instant, controller.signal, writeReply);
      }
      if (genRef.current === generation) {
        chosen = inFolder(chosen, roomFolder(room));
        const approval = chosen ? makeApproval(chosen, Boolean(options.unattended), bot) : undefined;
        const triggerDraft = options.unattended ? undefined : modelTrigger ?? plan.trigger;
        const trigger = triggerDraft ? createTrigger(triggerDraft, botId) : undefined;
        patchMessage(threadId, assistantId, (message) => ({ ...message, status: "done", approval, ...(trigger ? { trigger } : {}) }));
        if (!isChannel && (openThreadRef.current !== threadId || document.hidden)) {
          setBots((prev) => prev.map((item) => (item.id === botId ? { ...item, unread: true } : item)));
        }
        attachPrevious(threadId, assistantId, approval);
        if (plan.reminder) {
          const { title: reminderTitle, at } = plan.reminder;
          setReminders((prev) => [...prev, { id: crypto.randomUUID(), title: reminderTitle, at, done: false, botId }]);
        }
        bumpUsage({ charsOut: replyText.length });
        bumpBotUsage(botId, { charsOut: replyText.length });
        if (
          approval &&
          chosen &&
          (approval.status === "approved" ||
            (approval.status === "pending" && chosen.kind === "command" && autoApproved(chosen.command, studioRef.current.autoApprove)))
        ) {
          await runApproval(threadId, assistantId, approval, true, Boolean(options.unattended), controller.signal);
          bumpBotUsage(botId, { commands: 1 });
        }
        const latest = botsRef.current.find((item) => item.id === botId) ?? bot;
        finishTurnAudio(latest, replyText);
        if (!latest.muted && document.hidden && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(latest.name, { body: speakable(replyText).slice(0, 140) });
          } catch {
            // Notification construction can fail if permission changes mid-turn.
          }
        }
      }
      receiptDone(options.receipt, botId, started, "ok");
      return shown;
    } catch (error) {
      receiptDone(options.receipt, botId, started, "failed");
      if (genRef.current !== generation) return shown;
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const message = aborted ? translate(settingsRef.current.locale, "stopped") : error instanceof Error ? error.message : translate(settingsRef.current.locale, "dbError");
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id !== threadId
            ? thread
            : {
                ...thread,
                messages: thread.messages.map((item) => {
                  if (item.id !== assistantId) return item;
                  if (aborted) return { ...item, status: "done", text: item.text || message };
                  return { ...item, status: "error", text: item.text || message };
                }),
              },
        ),
      );
      if (!aborted) setBanner(message);
      if (!aborted && callRef.current) scheduleListenForCall();
      return shown;
    } finally {
      sendingRef.current = false;
      setWorkingBotId(null);
    }
  }

  async function startTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || sendingRef.current) return;
    setTasks((prev) => prev.map((item) => (item.id === taskId ? { ...item, status: "working", thinking: [] } : item)));
    const thinking = await askBot(task.botId, task.title);
    setTasks((prev) =>
      prev.map((item) => (item.id === taskId ? { ...item, status: thinking.length > 0 ? "done" : "queued", thinking } : item)),
    );
  }

  async function toggleRecording() {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        addPending(blob, `voice-${Date.now()}.webm`, "audio");
        setRecording(false);
        recorderRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setBanner(t("micFailed"));
      setRecording(false);
    }
  }

  function dictate() {
    if (callRef.current) {
      setBanner(t("callMicBusy"));
      return;
    }
    if (speechRef.current) {
      speechRef.current.stop();
      speechRef.current = null;
      setListening(false);
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setBanner(t("speechMissing"));
      return;
    }
    const recognition = new Ctor();
    recognition.lang = LOCALE_OPTIONS.find((item) => item.id === settings.locale)?.speech ?? "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        parts.push(event.results[index]?.[0].transcript ?? "");
      }
      const heard = parts.join(" ").trim();
      if (!heard) return;
      setDraft((value) => (value.trim() ? `${value.trim()} ${heard}` : heard));
    };
    recognition.onerror = () => {
      speechRef.current = null;
      setListening(false);
    };
    recognition.onend = () => {
      speechRef.current = null;
      setListening(false);
    };
    speechRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setBanner(t("speechMissing"));
    }
  }

  function addLocation() {
    if (!navigator.geolocation) {
      setBanner(t("geoFailed"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const line = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
        setDraft((value) => (value.trim() ? `${value.trim()}\n${line}` : line));
      },
      () => setBanner(t("geoFailed")),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }

  async function pickContacts() {
    if (!navigator.contacts) {
      setBanner(t("contactsMissing"));
      return;
    }
    try {
      const picked = await navigator.contacts.select(["name", "tel", "email"], { multiple: true });
      const next = picked
        .map((item) => ({
          id: crypto.randomUUID(),
          name: item.name?.[0]?.trim() ?? "",
          tel: item.tel?.[0]?.trim() ?? "",
          email: item.email?.[0]?.trim() ?? "",
        }))
        .filter((item) => item.name);
      if (next.length === 0) return;
      setContacts((prev) => [...prev, ...next]);
    } catch {
      setBanner(t("contactsMissing"));
    }
  }

  async function savePin(pin: string) {
    if (!/^\d{4,8}$/.test(pin)) {
      setBanner(t("pinRule"));
      return;
    }
    const salt = randomSalt();
    const pinHash = await hashPin(pin, salt);
    patchSettings({ pinSalt: salt, pinHash, lockEnabled: true });
    setBanner("");
  }

  async function unlockWithPin(pin: string) {
    const next = await hashPin(pin, settings.pinSalt);
    if (next === settings.pinHash) {
      setUnlocked(true);
      setLockError("");
      return;
    }
    setLockError(t("wrongPin"));
  }

  async function unlockWithPasskey() {
    try {
      const ok = await verifyPasskey(settings.credentialId);
      if (ok) {
        setUnlocked(true);
        setLockError("");
      } else setLockError(t("passkeyFailed"));
    } catch {
      setLockError(t("passkeyFailed"));
    }
  }

  if (!hydrated) {
    return (
      <main className="boot">
        <h1>Sandbench</h1>
        <p>{t("boot")}</p>
      </main>
    );
  }

  if (locked) {
    return (
      <LockScreen
        t={t}
        hasPin={Boolean(settings.pinHash)}
        hasPasskey={Boolean(settings.credentialId)}
        error={lockError}
        onPin={(pin) => {
          void unlockWithPin(pin);
        }}
        onPasskey={() => {
          void unlockWithPasskey();
        }}
      />
    );
  }

  const notifyText =
    notifyState === "granted" ? t("granted") : notifyState === "denied" ? t("denied") : notifyState === "default" ? t("prompt") : t("unknown");

  const channel = openThreadId ? threads.find((thread) => thread.id === openThreadId && thread.memberIds) ?? null : null;
  const activeThread = threads.find((thread) => thread.id === openThreadId) ?? null;

  return (
    <>
      {!studio.onboarded ? (
        <Onboarding
          t={t}
          onPick={(picked) => {
            addFromTemplates(picked);
            setStudio((prev) => ({ ...prev, onboarded: true }));
          }}
          onBlank={() => setStudio((prev) => ({ ...prev, onboarded: true }))}
        />
      ) : null}
      <Workspace
        t={t}
        wide={wide}
        inert={!studio.onboarded}
        focus={focus}
        overlay={overlay}
        createNonce={createNonce}
        bots={bots}
        tasks={tasks}
        routines={routines}
        computer={computer}
        reminders={reminders}
        threads={threads}
        selectedId={selectedBotId}
        openThreadId={openThreadId}
        channel={channel}
        workingBotId={workingBotId}
        studio={studio}
        harness={harness}
        callActive={callActive}
        messages={activeThread?.messages ?? []}
        onApproval={(messageId, approve, answer) => {
          if (activeThread) decideApproval(activeThread.id, messageId, approve, answer);
        }}
        onCreateChannel={createChannel}
        onSendChannel={(channelId, text) => {
          void sendToChannel(channelId, text);
        }}
        onSelectChannel={(channelId) => openThread(channelId)}
        onPatchChannel={(channelId, patch) => {
          const next = threadsRef.current.map((thread) => (thread.id === channelId ? { ...thread, ...patch } : thread));
          threadsRef.current = next;
          setThreads(next);
        }}
        onRemoveChannel={(channelId) => {
          const next = threadsRef.current.filter((thread) => thread.id !== channelId);
          threadsRef.current = next;
          setThreads(next);
          if (openThreadId === channelId) {
            const fallback = latestBotThread(next, selectedBotId ?? "") ?? next.find((thread) => thread.memberIds);
            if (fallback) openThread(fallback.id);
            else {
              setOpenThreadId(null);
              targetRef.current = null;
            }
          }
        }}
        onCall={toggleCall}
        onAddFiles={(botId, list) => {
          void addFiles(botId, list);
        }}
        onRemoveFile={removeFile}
        hub={
          <HubPanel
            t={t}
            bots={bots}
            bot={bots.find((item) => item.id === selectedBotId) ?? null}
            studio={studio}
            onStudio={(patch) => setStudio((prev) => ({ ...prev, ...patch }))}
            onPatchBot={patchBot}
            onAddBots={addFromTemplates}
            onNotice={setBanner}
            harnessReady={Boolean(harness)}
            channels={threads.filter((thread) => thread.memberIds)}
            routines={routines}
            onImportTeam={importTeam}
            onImportMigration={importMigration}
          />
        }
        draft={draft}
        hasPending={pending.length > 0}
        recording={recording}
        listening={listening}
        dragging={dragging}
        streaming={streaming}
        settings={settings}
        keys={keyNames}
        online={online}
        youLabel={youLabel}
        banner={banner}
        tools={
          <ToolsPanel
            t={t}
            locale={settings.locale}
            contacts={contacts}
            events={events}
            reminders={reminders}
            threads={threads}
            notifyLabel={notifyText}
            onAddContact={(contact) => {
              setContacts((prev) => [...prev, { id: crypto.randomUUID(), ...contact, name: contact.name.trim(), tel: contact.tel.trim(), email: contact.email.trim() }]);
            }}
            onRemoveContact={(id) => setContacts((prev) => prev.filter((item) => item.id !== id))}
            onPickContacts={() => {
              void pickContacts();
            }}
            onAddEvent={(event) => setEvents((prev) => [...prev, { id: crypto.randomUUID(), ...event }])}
            onRemoveEvent={(id) => setEvents((prev) => prev.filter((item) => item.id !== id))}
            onExport={() => downloadCalendar(events)}
            onAddReminder={(reminder) => setReminders((prev) => [...prev, { id: crypto.randomUUID(), ...reminder, done: false }])}
            onToggleReminder={(id) => setReminders((prev) => prev.map((item) => (item.id === id ? { ...item, done: true } : item)))}
            onRemoveReminder={(id) => setReminders((prev) => prev.filter((item) => item.id !== id))}
            onNotify={() => {
              if (!("Notification" in window)) return;
              void Notification.requestPermission().then((permission) => setNotifyState(permission));
            }}
          />
        }
        settingsPanel={
          <>
            <section className="account-card">
              <h3>{t("account")}</h3>
              <p className="hint">{user.email}</p>
              <p className="hint">{t("cloudSyncHint")}</p>
              {!harness ? <p className="hint">{t("harnessCloudHint")}</p> : null}
              <SignOutButton />
            </section>
            <SettingsPanel
            t={t}
            settings={settings}
            logs={logs}
            canInstall={canInstall}
            drivers={drivers}
            keys={secretInfo}
            keysAvailable={keysAvailable}
            onSaveKey={saveKey}
            onRemoveKey={removeKey}
            onApplyDefaultTestProfile={applyDefaultTestProfile}
            onChange={patchSettings}
            onSavePin={(pin) => {
              void savePin(pin);
            }}
            onClearLock={() => patchSettings({ lockEnabled: false, pinHash: "", pinSalt: "", credentialId: "" })}
            onLockNow={() => {
              setUnlocked(false);
              setLockError("");
            }}
            onPasskey={() => {
              void registerPasskey()
                .then((credentialId) => patchSettings({ credentialId, lockEnabled: true }))
                .catch(() => setBanner(t("passkeyFailed")));
            }}
            onErase={() => {
              if (!window.confirm(t("eraseConfirm"))) return;
              void eraseDatabase().finally(() => window.location.reload());
            }}
            onInstall={() => {
              void installRef.current?.prompt();
            }}
          />
          </>
        }
        onFocus={setFocus}
        onOverlay={setOverlay}
        onSelect={(botId) => openBot(botId)}
        onSelectThread={(threadId) => openThread(threadId)}
        onNewChat={(botId) => createChat(botId)}
        onRemoveThread={(threadId) => removeThread(threadId)}
        onCreate={createBot}
        onPatch={patchBot}
        onApplyTestProfile={applyTestProfileToBot}
        onDelete={deleteBot}
        onDuplicate={duplicateBot}
        onDraft={setDraft}
        onSend={(botId, text) => {
          void askBot(botId, text);
        }}
        onStop={stop}
        onAddSection={(section) => {
          if ((settings.sections ?? []).includes(section)) return;
          patchSettings({ sections: [...(settings.sections ?? []), section] });
        }}
        onPatchSettings={patchSettings}
        onAddTask={(botId, title) => {
          setTasks((prev) => [{ id: crypto.randomUUID(), botId, title, status: "queued", thinking: [], createdAt: Date.now() }, ...prev]);
        }}
        onStartTask={(taskId) => {
          void startTask(taskId);
        }}
        onRemoveTask={(taskId) => setTasks((prev) => prev.filter((item) => item.id !== taskId))}
        onAddRoutine={(botId, title, schedule) => {
          setRoutines((prev) => [{ id: crypto.randomUUID(), botId, title, schedule, enabled: true, lastRunAt: Date.now() }, ...prev]);
        }}
        onToggleRoutine={(id) => setRoutines((prev) => prev.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)))}
        onRemoveRoutine={(id) => setRoutines((prev) => prev.filter((item) => item.id !== id))}
        triggerRuns={triggerRuns}
        hookPort={hookPort}
        drivers={drivers}
        freshSecret={freshSecret}
        onAddWebhook={(botId, name, title) => {
          void addWebhook(botId, name, title);
        }}
        onRotateSecret={(id) => {
          void rotateWebhookSecret(id);
        }}
        onDismissSecret={() => setFreshSecret(null)}
        onPatchTrigger={patchTrigger}
        onRemoveTrigger={removeTrigger}
        onAddReminder={(botId, title, at) => {
          setReminders((prev) => [...prev, { id: crypto.randomUUID(), title, at, done: false, botId }]);
        }}
        onToggleReminder={(id) => setReminders((prev) => prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item)))}
        onRemoveReminder={(id) => setReminders((prev) => prev.filter((item) => item.id !== id))}
        onNotice={setBanner}
        onPhoto={() => photoRef.current?.click()}
        onCamera={() => cameraRef.current?.click()}
        onSwatch={() => {
          void makeSwatch()
            .then((blob) => addPending(blob, "swatch.png", "image"))
            .catch(() => setBanner(t("cameraFailed")));
        }}
        onVoice={() => {
          void toggleRecording();
        }}
        onDictate={dictate}
        onLocation={addLocation}
        onDragOver={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDrop={(files) => {
          setDragging(false);
          takeFiles(files);
        }}
        pending={
          pending.length > 0 ? (
            <ul className="pending">
              {pending.map((file) => (
                <li key={file.id}>
                  {file.kind === "image" ? <img src={file.previewUrl} alt={file.name} /> : <span>{file.name}</span>}
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(file.previewUrl);
                      setPending((prev) => prev.filter((item) => item.id !== file.id));
                    }}
                  >
                    {t("remove")} {file.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null
        }
      />
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          if (event.target.files) takeFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          if (event.target.files) takeFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}
