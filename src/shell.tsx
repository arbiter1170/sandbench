import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BotMark } from "./bots";
import { harnessBotMemory, harnessSkills, harnessWriteBotMemory, harnessWriteBotSoul, type AgentDriver, type HarnessHealth } from "./harness";
import type { Key } from "./i18n";
import { AvatarEditor, ComputerPanel, LibraryPanel } from "./studio";
import type { ApprovalMode, Bot, BotTask, BotVisibility, ComputerEvent, Message, Reminder, Routine, Settings, SkillId, Studio, TestProfileId, Thread, TriggerRef, TriggerRun } from "./types";
import { inferProfileFromBot, modelsForProfile, profileLabelKey, profileReadiness, profileTouchesCompatBase, TEST_PROFILE_IDS } from "./testProfiles";
import { MessageBody, type TriggerInfo, type TriggerPatch } from "./views";
import { applyReaModelChoice, BUILTIN_PLUGINS, COLORS, parseSchedule, REA_GROK_MODEL, REA_OPUS_MODEL, safeWorkspacePath, SHAPES, SKILLS, VOICES } from "./work";

type Copy = (key: Key) => string;
const SKILL_KEY: Record<SkillId, Key> = {
  computer: "skillComputer",
  files: "skillFiles",
  reminders: "skillReminders",
  calendar: "skillCalendar",
  mail: "skillMail",
};

export function Workspace(props: {
  t: Copy;
  wide: boolean;
  inert: boolean;
  focus: "rail" | "chat" | "side";
  overlay: null | "tools" | "settings" | "hub";
  createNonce: number;
  bots: Bot[];
  tasks: BotTask[];
  routines: Routine[];
  computer: ComputerEvent[];
  reminders: Reminder[];
  selectedId: string | null;
  openThreadId: string | null;
  channel: Thread | null;
  workingBotId: string | null;
  studio: Studio;
  harness: HarnessHealth | null;
  callActive: boolean;
  hub: ReactNode;
  onApproval: (messageId: string, approve: boolean, answer?: string) => void;
  onCreateChannel: (title: string, memberIds: string[]) => void;
  onSendChannel: (channelId: string, text: string) => void;
  onSelectChannel: (channelId: string) => void;
  onRemoveChannel: (channelId: string) => void;
  onPatchChannel: (channelId: string, patch: Partial<Thread>) => void;
  onCall: () => void;
  onAddFiles: (botId: string, files: FileList) => void;
  onRemoveFile: (id: string) => void;
  threads: Thread[];
  messages: Message[];
  draft: string;
  hasPending: boolean;
  recording: boolean;
  listening: boolean;
  dragging: boolean;
  streaming: boolean;
  settings: Settings;
  /** Names of the API keys stored on the harness or runner. */
  keys: ReadonlySet<string>;
  online: boolean;
  youLabel: string;
  banner: string;
  tools: ReactNode;
  settingsPanel: ReactNode;
  onFocus: (focus: "rail" | "chat" | "side") => void;
  onOverlay: (overlay: null | "tools" | "settings" | "hub") => void;
  onSelect: (id: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewChat: (botId: string) => void;
  onRemoveThread: (threadId: string) => void;
  onCreate: (name: string, role: string) => void;
  onPatch: (id: string, patch: Partial<Bot>) => void;
  onApplyTestProfile: (botId: string, profile: TestProfileId, syncSettings?: boolean) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDraft: (value: string) => void;
  onSend: (botId: string, text: string) => void;
  onStop: () => void;
  onAddSection: (name: string) => void;
  onPatchSettings: (patch: Partial<Settings>) => void;
  onAddTask: (botId: string, title: string) => void;
  onStartTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onAddRoutine: (botId: string, title: string, schedule: string) => void;
  onToggleRoutine: (id: string) => void;
  onRemoveRoutine: (id: string) => void;
  triggerRuns: TriggerRun[];
  drivers: AgentDriver[];
  hookPort: number | null;
  freshSecret: { id: string; secret: string } | null;
  onAddWebhook: (botId: string, name: string, title: string) => void;
  onRotateSecret: (id: string) => void;
  onDismissSecret: () => void;
  onPatchTrigger: (ref: TriggerRef, patch: TriggerPatch) => void;
  onRemoveTrigger: (ref: TriggerRef) => void;
  onAddReminder: (botId: string, title: string, at: number) => void;
  onToggleReminder: (id: string) => void;
  onRemoveReminder: (id: string) => void;
  onNotice: (message: string) => void;
  onPhoto: () => void;
  onCamera: () => void;
  onSwatch: () => void;
  onVoice: () => void;
  onDictate: () => void;
  onLocation: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (files: FileList) => void;
  pending: ReactNode;
}) {
  const {
    t, wide, focus, overlay, createNonce, bots, tasks, routines, computer, reminders, selectedId, workingBotId,
    messages, draft, recording, listening, dragging, streaming, settings, online, youLabel, banner, channel, studio,
  } = props;
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelMembers, setChannelMembers] = useState<string[]>([]);
  const channels = props.threads.filter((thread) => thread.memberIds);
  const names = useMemo(() => new Map(bots.map((item) => [item.id, item.name])), [bots]);
  const send = (text: string) => {
    if (!text.trim() && !props.hasPending) return;
    if (channel) props.onSendChannel(channel.id, text);
    else if (bot) props.onSend(bot.id, text);
  };
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [sectionDraft, setSectionDraft] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [routineTitle, setRoutineTitle] = useState("");
  const [routineWhen, setRoutineWhen] = useState("Weekdays at 9:00");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [hookName, setHookName] = useState("");
  const [hookTitle, setHookTitle] = useState("");
  const [copied, setCopied] = useState(false);
  const triggerInfo = (ref: TriggerRef): TriggerInfo | null => {
    if (ref.kind === "routine") {
      const routine = routines.find((item) => item.id === ref.id);
      return routine ? { kind: "routine", title: routine.title, detail: routine.schedule, enabled: routine.enabled } : null;
    }
    const hook = studio.webhooks.find((item) => item.id === ref.id);
    return hook ? { kind: "webhook", title: hook.title, detail: hook.name, enabled: hook.enabled } : null;
  };
  const [memory, setMemory] = useState("");
  const [memoryDoc, setMemoryDoc] = useState("");
  const [librarySkills, setLibrarySkills] = useState<{ id: string; title: string; summary: string }[]>([]);
  const [reminderTitle, setReminderTitle] = useState("");
  const [handoffId, setHandoffId] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [panel, setPanel] = useState<"model" | "customize" | "work">("model");
  const selectedBot = bots.find((item) => item.id === selectedId) ?? null;
  const bot = channel
    ? bots.find((item) => item.id === workingBotId && channel.memberIds?.includes(item.id)) ??
      bots.find((item) => channel.memberIds?.includes(item.id)) ??
      null
    : selectedBot;
  const models = useMemo(() => {
    const list = modelsForProfile(settings.defaultTestProfile);
    return list.includes(settings.model) ? list : [settings.model, ...list];
  }, [settings.defaultTestProfile, settings.model]);
  const ready = [
    props.keys.has("XAI_API_KEY") ? t("providerXai") : "",
    props.keys.has("COMPAT_API_KEY") && settings.compatBase?.trim() ? t("providerCompat") : "",
    props.keys.has("ANTHROPIC_API_KEY") ? t("providerAnthropic") : "",
  ].filter(Boolean);

  useEffect(() => {
    if (createNonce > 0) setCreating(true);
  }, [createNonce]);

  const needle = query.trim().toLowerCase();
  const visible = bots
    .filter((item) => {
      if (!needle) return !item.hidden || item.id === selectedId;
      return `${item.name} ${item.role} ${previewOf(props.threads, item.id)}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  const hiddenBots = bots.filter((item) => item.hidden && item.id !== selectedId);
  const sectionNames = Array.from(new Set(["", ...(settings.sections ?? []), ...bots.map((item) => item.section || "")]));

  return (
    <div className="app" data-focus={wide ? "all" : focus} inert={props.inert}>
      <a className="skip" href="#composer">{t("messageBot")}</a>
      <aside className="rail">
        <div className="rail-tools">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchBots")} aria-label={t("searchBots")} />
          <button type="button" className="icon-btn" aria-label={t("createBot")} onClick={() => setCreating((value) => !value)}>+</button>
        </div>
        {creating ? (
          <form
            className="create-bot"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) {
                props.onNotice(t("needName"));
                return;
              }
              props.onCreate(name.trim(), role.trim());
              setName("");
              setRole("");
              setCreating(false);
              props.onFocus("chat");
            }}
          >
            <label>
              {t("botName")}
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              {t("botRole")}
              <input value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
            <button type="submit" className="primary">{t("createBot")}</button>
          </form>
        ) : null}
        <div className="rail-scroll">
          <button type="button" className="text-btn" onClick={() => setAddingSection((value) => !value)}>{t("newSection")}</button>
          {addingSection ? (
            <form
              className="create-bot"
              onSubmit={(event) => {
                event.preventDefault();
                if (!sectionDraft.trim()) return;
                props.onAddSection(sectionDraft.trim());
                setSectionDraft("");
                setAddingSection(false);
              }}
            >
              <input value={sectionDraft} onChange={(event) => setSectionDraft(event.target.value)} aria-label={t("sectionName")} placeholder={t("sectionName")} />
              <button type="submit">{t("add")}</button>
            </form>
          ) : null}
          {sectionNames.map((section) => {
            const group = visible.filter((item) => (item.section || "") === section);
            return (
              <details
                key={section || "unassigned"}
                className="bot-section"
                open
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData("text/plain");
                  if (id) props.onPatch(id, { section });
                }}
              >
                <summary>{section || t("unassigned")}<span>{group.length}</span></summary>
                {group.length === 0 ? <p className="hint">{t("dragHere")}</p> : null}
                <ul>
                  {group.map((item) => {
                    const preview = previewOf(props.threads, item.id);
                    return (
                      <li key={item.id}>
                        <div className="bot-row-wrap">
                          <button
                            type="button"
                            draggable
                            className={!channel && item.id === selectedId ? "bot-link on" : "bot-link"}
                            aria-current={!channel && item.id === selectedId ? "true" : undefined}
                            onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
                            onClick={() => {
                              props.onSelect(item.id);
                              props.onOverlay(null);
                              props.onFocus("chat");
                            }}
                          >
                            <BotMark bot={item} size="1.7rem" />
                            <span>
                              <strong>
                                {item.pinned ? <span className="pin-mark" aria-label={t("pinBot")}>●</span> : null}
                                {item.name}
                              </strong>
                              <small>{pendingDraft(studio.drafts, props.threads, item.id, props.openThreadId) && item.id !== selectedId ? `${t("draftSaved")}: ${pendingDraft(studio.drafts, props.threads, item.id, props.openThreadId)}` : preview || item.role}</small>
                            </span>
                            {item.unread ? <i className="unread-dot" aria-label={t("markUnread")} /> : null}
                            {workingBotId === item.id ? <i className="live" /> : null}
                          </button>
                          <button
                            type="button"
                            className="bot-menu-btn"
                            aria-label={`${t("botMenu")}: ${item.name}`}
                            aria-expanded={menuFor === item.id}
                            onClick={() => setMenuFor((current) => (current === item.id ? null : item.id))}
                          >
                            ⋯
                          </button>
                          {menuFor === item.id ? (
                            <div className="bot-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => { props.onPatch(item.id, { pinned: !item.pinned }); setMenuFor(null); }}>
                                {item.pinned ? t("unpinBot") : t("pinBot")}
                              </button>
                              <button type="button" role="menuitem" onClick={() => { props.onDuplicate(item.id); setMenuFor(null); }}>{t("duplicateBot")}</button>
                              <button type="button" role="menuitem" onClick={() => { props.onPatch(item.id, { unread: true }); setMenuFor(null); }}>{t("markUnread")}</button>
                              <button type="button" role="menuitem" onClick={() => { props.onPatch(item.id, { hidden: true }); setMenuFor(null); }}>{t("hideBot")}</button>
                            </div>
                          ) : null}
                        </div>
                        {!channel && item.id === selectedId ? (
                          <ul className="chat-list">
                            {props.threads
                              .filter((thread) => thread.botId === item.id && !thread.memberIds)
                              .sort((a, b) => b.updatedAt - a.updatedAt)
                              .map((thread) => (
                                <li key={thread.id}>
                                  <button
                                    type="button"
                                    className={thread.id === props.openThreadId ? "on" : undefined}
                                    aria-current={thread.id === props.openThreadId ? "true" : undefined}
                                    onClick={() => {
                                      props.onSelectThread(thread.id);
                                      props.onOverlay(null);
                                      props.onFocus("chat");
                                    }}
                                  >
                                    {thread.messages.length === 0 ? t("newBotChat") : thread.title}
                                  </button>
                                  <button type="button" className="text-btn" aria-label={`${t("remove")} ${thread.title}`} onClick={() => props.onRemoveThread(thread.id)}>×</button>
                                </li>
                              ))}
                            <li>
                              <button type="button" className="text-btn" onClick={() => props.onNewChat(item.id)}>{t("newBotChat")}</button>
                            </li>
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
          {hiddenBots.length > 0 && !needle ? (
            <details className="hidden-bots">
              <summary>{t("hiddenBots")} ({hiddenBots.length})</summary>
              <ul>
                {hiddenBots.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <button type="button" className="text-btn" onClick={() => props.onPatch(item.id, { hidden: false })}>{t("showBot")}</button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <details className="bot-section channel-section">
            <summary>
              {t("channels")}
              <span>{channels.length}</span>
            </summary>
            <button type="button" className="text-btn" aria-expanded={channelOpen} onClick={() => setChannelOpen((value) => !value)}>{t("newChannel")}</button>
            {channelOpen ? (
              <form
                className="create-bot"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!channelName.trim() || channelMembers.length < 2) {
                    props.onNotice(t("mentionHint"));
                    return;
                  }
                  props.onCreateChannel(channelName.trim(), channelMembers);
                  setChannelName("");
                  setChannelMembers([]);
                  setChannelOpen(false);
                }}
              >
                <input value={channelName} onChange={(event) => setChannelName(event.target.value)} aria-label={t("channelName")} placeholder={t("channelName")} />
                <fieldset>
                  <legend>{t("members")}</legend>
                  {bots.map((item) => (
                    <label key={item.id} className="check">
                      <input
                        type="checkbox"
                        checked={channelMembers.includes(item.id)}
                        onChange={() =>
                          setChannelMembers((prev) => (prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]))
                        }
                      />
                      {item.name}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="primary">{t("newChannel")}</button>
              </form>
            ) : null}
            <ul>
              {channels.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={channel?.id === item.id ? "bot-link on" : "bot-link"}
                    aria-current={channel?.id === item.id ? "true" : undefined}
                    onClick={() => {
                      props.onSelectChannel(item.id);
                      props.onOverlay(null);
                      props.onFocus("chat");
                    }}
                  >
                    <span className="stack-marks">
                      {bots.filter((member) => item.memberIds?.includes(member.id)).slice(0, 3).map((member) => (
                        <BotMark key={member.id} bot={member} size="1.2rem" />
                      ))}
                    </span>
                    <span>
                      <strong># {item.title}</strong>
                      <small>{previewOf([item], undefined) || (item.memberIds ?? []).map((id) => names.get(id)).filter(Boolean).join(", ")}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
        <footer className="rail-foot">
          <button type="button" onClick={() => { props.onOverlay("hub"); props.onFocus("chat"); }}>{t("hub")}</button>
          <button type="button" onClick={() => { props.onOverlay("tools"); props.onFocus("chat"); }}>{t("tools")}</button>
          <button type="button" onClick={() => { props.onOverlay("settings"); props.onFocus("chat"); }}>{t("settings")}</button>
        </footer>
      </aside>

      <main className="stage">
        {banner ? <p className="banner" role="alert">{banner}</p> : null}
        {overlay === "tools" ? (
          <div className="overlay-pane">
            <button type="button" onClick={() => props.onOverlay(null)}>{t("backToBots")}</button>
            {props.tools}
          </div>
        ) : null}
        {overlay === "settings" ? (
          <div className="overlay-pane">
            <button type="button" onClick={() => props.onOverlay(null)}>{t("backToBots")}</button>
            {props.settingsPanel}
          </div>
        ) : null}
        {overlay === "hub" ? (
          <div className="overlay-pane">
            <button type="button" onClick={() => props.onOverlay(null)}>{t("backToBots")}</button>
            {props.hub}
          </div>
        ) : null}
        {overlay === null && (channel || bot) ? (
          <>
            {channel ? (
              <header className="chat-head">
                <span className="stack-marks">
                  {bots.filter((member) => channel.memberIds?.includes(member.id)).map((member) => <BotMark key={member.id} bot={member} size="1.5rem" />)}
                </span>
                <div>
                  <h2># {channel.title}</h2>
                  <p>{t("mentionHint")}</p>
                </div>
                <button type="button" className="text-btn" onClick={() => { if (window.confirm(t("remove"))) props.onRemoveChannel(channel.id); }}>{t("remove")}</button>
              </header>
            ) : bot ? (
              <header className="chat-head">
                <BotMark bot={bot} size="1.7rem" />
                <div>
                  <h2>{bot.name}</h2>
                  <p>{props.callActive ? (props.listening ? t("listening") : t("inCall")) : [...messages].reverse().find((message) => message.role === "user")?.text.slice(0, 90) || bot.role}</p>
                </div>
                <button type="button" className="text-btn" onClick={() => props.onNewChat(bot.id)}>{t("newBotChat")}</button>
                <button type="button" className={props.callActive ? "call-btn on" : "call-btn"} aria-pressed={props.callActive} onClick={props.onCall}>
                  {props.callActive ? t("endCall") : t("call")}
                </button>
              </header>
            ) : null}
            <div className="scroll">
              {messages.length === 0 ? (
                <div className="measure">
                  <h2>{channel ? `# ${channel.title}` : bot?.name}</h2>
                  <p>{channel ? t("mentionHint") : bot?.instructions}</p>
                </div>
              ) : (
                messages.map((message) => (
                  <MessageBody
                    key={message.id}
                    message={message}
                    t={t}
                    youLabel={youLabel}
                    author={message.authorBotId ? names.get(message.authorBotId) : undefined}
                    onApproval={(approve, answer) => props.onApproval(message.id, approve, answer)}
                    trigger={message.trigger ? triggerInfo(message.trigger) : undefined}
                    onTriggerPatch={(patch) => message.trigger && props.onPatchTrigger(message.trigger, patch)}
                    onTriggerUndo={() => message.trigger && props.onRemoveTrigger(message.trigger)}
                  />
                ))
              )}
            </div>
            <form
              className={dragging ? "composer drag" : "composer"}
              onSubmit={(event) => {
                event.preventDefault();
                send(draft);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                props.onDragOver();
              }}
              onDragLeave={props.onDragLeave}
              onDrop={(event) => {
                event.preventDefault();
                props.onDrop(event.dataTransfer.files);
              }}
            >
              {props.pending}
              <div className="composer-bar">
                <button type="button" className="icon-btn" aria-expanded={plusOpen} aria-label={t("attach")} onClick={() => setPlusOpen((value) => !value)}>+</button>
                <label className="sr-only" htmlFor="composer">{t("messageBot")}</label>
                <textarea
                  id="composer"
                  rows={1}
                  value={draft}
                  placeholder={t("messageBot")}
                  onChange={(event) => props.onDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send(draft);
                    }
                  }}
                />
                <button type="button" className="icon-btn" aria-pressed={listening} aria-label={listening ? t("listening") : t("dictate")} title={props.callActive ? t("callMicBusy") : undefined} disabled={props.callActive} onClick={props.onDictate}>{listening ? "…" : "Mic"}</button>
                {(streaming || bots.find((item) => item.id === workingBotId)?.driver) && workingBotId !== null && (channel ? channel.memberIds?.includes(workingBotId) : workingBotId === bot?.id) ? (
                  <button type="button" className="send-orb" onClick={props.onStop}>{t("stop")}</button>
                ) : (
                  <button type="submit" className="send-orb" aria-label={draft.trim() ? t("send") : t("voice")} onClick={(event) => {
                    if (!draft.trim()) {
                      event.preventDefault();
                      props.onVoice();
                    }
                  }}>
                    {recording ? "Stop" : draft.trim() ? t("send") : "Rec"}
                  </button>
                )}
              </div>
              {plusOpen ? (
                <div className="plus-row">
                  <button type="button" onClick={props.onPhoto}>{t("photo")}</button>
                  <button type="button" onClick={props.onCamera}>{t("camera")}</button>
                  <button type="button" onClick={props.onSwatch}>{t("swatch")}</button>
                  <button type="button" onClick={props.onLocation}>{t("location")}</button>
                  {bot && !channel && bots.filter((item) => item.id !== bot.id).length > 0 ? (
                    <>
                      <select value={handoffId} onChange={(event) => setHandoffId(event.target.value)} aria-label={t("handoff")}>
                        <option value="">{t("handoff")}</option>
                        {bots.filter((item) => item.id !== bot.id).map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!draft.trim() || !handoffId}
                        onClick={() => {
                          const text = `From ${bot.name}: ${draft.trim()}`;
                          props.onDraft("");
                          props.onSend(handoffId, text);
                          props.onSelect(handoffId);
                          props.onFocus("chat");
                        }}
                      >
                        {t("handoff")}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </form>
          </>
        ) : null}
        {overlay === null && !bot && !channel ? (
          <div className="measure empty-stage">
            <h2>{t("createBot")}</h2>
            <p>{t("dragHere")}</p>
          </div>
        ) : null}
      </main>

      <aside className="inspector">
        {bot ? (
          <>
            <header className="inspector-head">
              <BotMark bot={bot} size="2.6rem" />
              <div>
                <h2>{bot.name}</h2>
                <p>{bot.role}</p>
              </div>
            </header>
            <div className="panel-tabs" role="tablist" aria-label={bot.name}>
              {(["model", "customize", "work"] as const).map((id) => (
                <button key={id} type="button" role="tab" id={`panel-tab-${id}`} aria-selected={panel === id} aria-controls={`panel-${id}`} onClick={() => setPanel(id)}>
                  {t(id === "model" ? "model" : id === "customize" ? "panelCustomize" : "panelWork")}
                </button>
              ))}
            </div>
            <div className="inspector-scroll">
              {panel === "model" ? (
          <div className="model-row" role="tabpanel" id="panel-model" aria-labelledby="panel-tab-model">
            {bot.preset === "rea" ? (
              <div className="rea-chips" role="group" aria-label={t("reaModelChips")}>
                {(
                  [
                    { id: "opus" as const, label: t("reaOpus"), hint: t("reaOpusHint") },
                    { id: "grok" as const, label: t("reaGrok"), hint: t("reaGrokHint") },
                    { id: "composer" as const, label: t("reaComposer"), hint: t("reaComposerHint") },
                  ]
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={bot.modelChoice === chip.id ? "rea-chip on" : "rea-chip"}
                    aria-pressed={bot.modelChoice === chip.id}
                    onClick={() => {
                      setCustomModel(false);
                      props.onPatch(bot.id, applyReaModelChoice(chip.id));
                    }}
                  >
                    <strong>{chip.label}</strong>
                    <small>{chip.hint}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <label>
              {t("botModel")}
              <select
                value={
                  bot.modelChoice === "composer"
                    ? ""
                    : customModel || (bot.model && !modelsForProfile(inferProfileFromBot(bot, settings) || settings.defaultTestProfile).includes(bot.model))
                      ? "__custom"
                      : bot.model ?? ""
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "__custom") {
                    setCustomModel(true);
                    props.onPatch(bot.id, { modelChoice: undefined });
                    return;
                  }
                  setCustomModel(false);
                  const patch: Partial<Bot> = { model: value || undefined, modelChoice: undefined };
                  if (value === REA_OPUS_MODEL && bot.preset === "rea") Object.assign(patch, applyReaModelChoice("opus"));
                  else if (value === REA_GROK_MODEL && bot.preset === "rea") Object.assign(patch, applyReaModelChoice("grok"));
                  props.onPatch(bot.id, patch);
                }}
              >
                <option value="">{`${t("useDefaultModel")} (${settings.model})`}</option>
                {modelsForProfile(inferProfileFromBot(bot, settings) || settings.defaultTestProfile).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
                <option value="__custom">{t("customModel")}</option>
              </select>
            </label>
            {customModel || (bot.model && !modelsForProfile(inferProfileFromBot(bot, settings) || settings.defaultTestProfile).includes(bot.model)) ? (
              <label>
                {t("customModel")}
                <input
                  value={bot.model ?? ""}
                  placeholder="openai/gpt-oss-120b"
                  onChange={(event) => props.onPatch(bot.id, { model: event.target.value.trim() ? event.target.value : undefined })}
                  autoComplete="off"
                />
              </label>
            ) : null}
            {ready.length > 0 || bot.provider === "openai_compat" || bot.provider === "anthropic" ? (
              <label>
                {t("provider")}
                <select
                  value={bot.provider ?? "xai"}
                  onChange={(event) => {
                    const value = event.target.value;
                    props.onPatch(bot.id, {
                      provider: value === "openai_compat" ? "openai_compat" : value === "anthropic" ? "anthropic" : undefined,
                    });
                  }}
                >
                  <option value="xai">{t("providerXai")}</option>
                  <option value="openai_compat">{t("providerCompat")}</option>
                  <option value="anthropic">{t("providerAnthropic")}</option>
                </select>
              </label>
            ) : null}
            <button type="button" className="text-btn" disabled={bot.model === settings.model} onClick={() => props.onPatch(bot.id, { model: settings.model })}>{t("applyToBot")}: {settings.model}</button>
            {props.drivers.length > 0 || bot.driver ? (
              <label>
                {t("agentDriver")}
                <select value={bot.driver ?? ""} onChange={(event) => props.onPatch(bot.id, { driver: event.target.value || undefined })}>
                  <option value="">{t("builtinPlanner")}</option>
                  {props.drivers.map((driver) => (
                    <option key={driver.id} value={driver.id} disabled={!driver.ok && bot.driver !== driver.id}>
                      {driver.label}{driver.ok ? "" : ` · ${t("notInstalled")}`}
                    </option>
                  ))}
                  {bot.driver && !props.drivers.some((driver) => driver.id === bot.driver) ? <option value={bot.driver}>{bot.driver} · {t("offline")}</option> : null}
                </select>
              </label>
            ) : null}
            {bot.driver ? <p className="hint">{props.drivers.find((driver) => driver.id === bot.driver)?.detail ?? t("driverNeedsHarness")}</p> : null}
            <section className="provider-catalog" aria-label={t("providerCatalog")}>
              <h3>{t("providerCatalog")}</h3>
              <h4>{t("catalogLocalAgents")}</h4>
              <ul className="catalog-list">
                {(["claude", "codex", "grok"] as const).map((id) => {
                  const driver = props.drivers.find((item) => item.id === id);
                  const ok = Boolean(driver?.ok);
                  return (
                    <li key={id} className={ok ? "catalog-row" : "catalog-row dim"} title={driver?.detail || t("driverNeedsHarness")}>
                      <button
                        type="button"
                        disabled={!ok && bot.driver !== id}
                        onClick={() => props.onPatch(bot.id, { driver: id, testProfile: id === "claude" ? "claude-cli" : undefined })}
                      >
                        {driver?.label ?? id}
                        {!ok ? ` · ${t("catalogUnavailable")}` : ""}
                      </button>
                      {driver?.models?.length ? <small>{driver.models.slice(0, 3).join(", ")}</small> : null}
                    </li>
                  );
                })}
              </ul>
              <h4>{t("catalogCloud")}</h4>
              <ul className="catalog-list">
                <li className={props.keys.has("XAI_API_KEY") ? "catalog-row" : "catalog-row dim"}>
                  <button type="button" onClick={() => props.onApplyTestProfile(bot.id, "xai", true)}>{t("providerXai")}</button>
                </li>
                <li className={props.keys.has("ANTHROPIC_API_KEY") ? "catalog-row" : "catalog-row dim"}>
                  <button type="button" onClick={() => props.onApplyTestProfile(bot.id, "claude-api", true)}>{t("providerAnthropic")}</button>
                </li>
              </ul>
              <h4>{t("catalogCompat")}</h4>
              <ul className="catalog-list">
                {(["ollama", "groq"] as const).map((id) => (
                  <li key={id} className="catalog-row">
                    <button type="button" onClick={() => props.onApplyTestProfile(bot.id, id, true)}>{t(profileLabelKey(id))}</button>
                  </li>
                ))}
              </ul>
            </section>
            <label>
              {t("testProfileApplyBot")}
              <select
                value={inferProfileFromBot(bot, settings) || ""}
                onChange={(event) => {
                  const value = event.target.value as TestProfileId | "";
                  if (!value) return;
                  let syncSettings = true;
                  if (profileTouchesCompatBase(value) && settings.compatBase?.trim()) {
                    syncSettings = window.confirm(t("testProfileOverwriteCompat"));
                  }
                  props.onApplyTestProfile(bot.id, value, syncSettings);
                }}
              >
                <option value="">{t("testProfileCustom")}</option>
                {TEST_PROFILE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(profileLabelKey(id))}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const active = inferProfileFromBot(bot, settings);
              if (!active) return null;
              const status = profileReadiness(active, settings, props.drivers, props.keys);
              return (
                <p className="hint">
                  {status.ready ? t("testProfileReady") : status.missing.map((key) => t(key as Key)).join(" · ")}
                </p>
              );
            })()}
            <label className="model-picker">
              {t("defaultModelLabel")}
              <select value={settings.model} onChange={(event) => props.onPatchSettings({ model: event.target.value })} aria-describedby="default-model-note">
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <p className="hint" id="default-model-note">{props.keys.has("XAI_API_KEY") ? t("api") : t("local")} · {online ? t("online") : t("offline")}</p>
            <p className="hint provider-rail">{t("providersReady")}: {ready.length ? ready.join(", ") : t("noProviders")}</p>
          </div>
              ) : null}
              {panel === "work" ? (
                <div role="tabpanel" id="panel-work" aria-labelledby="panel-tab-work">
            {channel ? (
              <section>
                <h3>{t("members")}</h3>
                <ul className="member-list">
                  {bots.filter((member) => channel.memberIds?.includes(member.id)).map((member) => (
                    <li key={member.id}>
                      <BotMark bot={member} size="1.4rem" />
                      <span>{member.name}{channel.leadBotId === member.id ? ` · ${t("leadBot")}` : ""}</span>
                      {workingBotId === member.id ? <i className="live" /> : null}
                    </li>
                  ))}
                </ul>
                <details className="channel-settings">
                  <summary>{t("channelSettings")}</summary>
                  <fieldset className="stack">
                    <legend className="sr-only">{t("members")}</legend>
                    {bots.map((member) => (
                      <label key={member.id} className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(channel.memberIds?.includes(member.id))}
                          disabled={Boolean(channel.memberIds?.includes(member.id)) && (channel.memberIds?.length ?? 0) <= 1}
                          onChange={() => {
                            const current = channel.memberIds ?? [];
                            const memberIds = current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id];
                            props.onPatchChannel(channel.id, {
                              memberIds,
                              ...(channel.leadBotId && !memberIds.includes(channel.leadBotId) ? { leadBotId: undefined } : {}),
                            });
                          }}
                        />
                        {member.name}
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    {t("sharedInstructions")}
                    <textarea value={channel.sharedInstructions ?? ""} onChange={(event) => props.onPatchChannel(channel.id, { sharedInstructions: event.target.value })} />
                  </label>
                  <label>
                    {t("leadBot")}
                    <select value={channel.leadBotId ?? ""} onChange={(event) => props.onPatchChannel(channel.id, { leadBotId: event.target.value || undefined })}>
                      <option value="">—</option>
                      {bots.filter((member) => channel.memberIds?.includes(member.id)).map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("workingFolder")}
                    <input
                      value={channel.workingFolder ?? ""}
                      placeholder="launch"
                      aria-invalid={Boolean(channel.workingFolder) && !safeWorkspacePath(channel.workingFolder)}
                      onChange={(event) => props.onPatchChannel(channel.id, { workingFolder: event.target.value || undefined })}
                    />
                  </label>
                  {channel.workingFolder && !safeWorkspacePath(channel.workingFolder) ? <small className="hint">{t("folderInvalid")}</small> : null}
                  <label className="check">
                    <input type="checkbox" checked={Boolean(channel.autoRoute)} onChange={(event) => props.onPatchChannel(channel.id, { autoRoute: event.target.checked })} />
                    {t("autoRoute")}
                  </label>
                </details>
              </section>
            ) : null}
            <ComputerPanel t={t} bot={bot} working={workingBotId === bot.id} computer={computer} health={props.harness} />
            <section>
              {bot.lastThinking.length > 0 ? (
                <details open={workingBotId === bot.id}>
                  <summary>{t("thinkingThrough")}</summary>
                  <ol className="trace">
                    {bot.lastThinking.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
                  </ol>
                </details>
              ) : null}
            </section>
            <section>
              <h3>{t("skills")}</h3>
              {SKILLS.map((skill) => (
                <label key={skill} className="check">
                  <input
                    type="checkbox"
                    checked={bot.skills.includes(skill)}
                    onChange={() => {
                      const skills = bot.skills.includes(skill) ? bot.skills.filter((item) => item !== skill) : [...bot.skills, skill];
                      props.onPatch(bot.id, { skills });
                    }}
                  />
                  {t(SKILL_KEY[skill])}
                </label>
              ))}
              <p className="hint">
                {t("plugins")}:{" "}
                {[...BUILTIN_PLUGINS, ...studio.plugins].filter((item) => (bot.plugins ?? []).includes(item.id)).map((item) => item.name).join(", ") || "—"}
                {" · "}
                {t("connectors")}: {studio.connectors.filter((item) => (bot.connectorIds ?? []).includes(item.id)).map((item) => item.name).join(", ") || "—"}
              </p>
              <button type="button" className="text-btn" onClick={() => { props.onOverlay("hub"); props.onFocus("chat"); }}>{t("hub")}</button>
            </section>
            <LibraryPanel t={t} files={studio.files.filter((file) => file.botId === bot.id)} onAdd={(list) => props.onAddFiles(bot.id, list)} onRemove={props.onRemoveFile} />
            <section className="triggers" aria-label={t("triggers")}>
              <h3>{t("triggers")}</h3>
              <h4>{t("schedulesHeading")}</h4>
              <p className="hint">{t("routineNote")}</p>
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!routineTitle.trim()) {
                    props.onNotice(t("needTitle"));
                    return;
                  }
                  props.onAddRoutine(bot.id, routineTitle.trim(), routineWhen.trim());
                  setRoutineTitle("");
                }}
              >
                <input value={routineTitle} onChange={(event) => setRoutineTitle(event.target.value)} aria-label={t("addRoutine")} placeholder={t("addRoutine")} />
                <input value={routineWhen} onChange={(event) => setRoutineWhen(event.target.value)} aria-label={t("schedule")} />
                <button type="submit">{t("addRoutine")}</button>
              </form>
              <ul className="routine-list">
                {routines.filter((item) => item.botId === bot.id).map((routine) => (
                  <li key={routine.id}>
                    <div>
                      <strong>{routine.title}</strong>
                      <small>
                        {routine.schedule}
                        {parseSchedule(routine.schedule) ? "" : ` · ${t("badSchedule")}`}
                        {routine.lastRunAt ? ` · ${t("routineRan")} ${new Date(routine.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                      </small>
                    </div>
                    <button type="button" className={routine.enabled ? "switch on" : "switch"} aria-pressed={routine.enabled} onClick={() => props.onToggleRoutine(routine.id)}>
                      <i />
                      <span className="sr-only">{t("enabled")}</span>
                    </button>
                    <button type="button" onClick={() => { props.onFocus("chat"); props.onSend(bot.id, routine.title); }}>{t("runRoutine")}</button>
                    <button type="button" onClick={() => props.onRemoveRoutine(routine.id)}>{t("remove")}</button>
                  </li>
                ))}
              </ul>
              <h4>{t("webhooks")}</h4>
              <p className="hint">{props.harness ? `${t("webhookHint")} ${t("webhookQueued")}` : t("webhookNeedsHarness")}</p>
              {props.harness ? (
                <form
                  className="stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!hookName.trim() || !hookTitle.trim()) {
                      props.onNotice(t("needTitle"));
                      return;
                    }
                    props.onAddWebhook(bot.id, hookName.trim(), hookTitle.trim());
                    setHookName("");
                    setHookTitle("");
                  }}
                >
                  <input value={hookName} onChange={(event) => setHookName(event.target.value)} aria-label={t("webhookName")} placeholder={t("webhookName")} />
                  <input value={hookTitle} onChange={(event) => setHookTitle(event.target.value)} aria-label={t("webhookPrompt")} placeholder={t("webhookPrompt")} />
                  <button type="submit">{t("addWebhook")}</button>
                </form>
              ) : null}
              <ul className="trigger-list">
                {studio.webhooks.filter((item) => item.botId === bot.id).map((hook) => {
                  const address = props.hookPort ? `http://127.0.0.1:${props.hookPort}/hooks/${hook.id}` : "";
                  const fresh = props.freshSecret?.id === hook.id ? props.freshSecret.secret : "";
                  return (
                    <li key={hook.id}>
                      <div>
                        <strong>{hook.name}</strong>
                        <small>{hook.enabled ? hook.title : `${t("paused")} · ${hook.title}`}</small>
                        {address ? <code className="hook-address">{address}</code> : null}
                        <small>{hook.secretPreview ? `${t("secretConfigured")} ··${hook.secretPreview}` : ""}</small>
                      </div>
                      {fresh ? (
                        <div className="secret-once" role="status">
                          <p>{t("webhookSecretOnce")}</p>
                          <code>{fresh}</code>
                          <div className="approval-actions">
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(fresh).then(() => setCopied(true));
                              }}
                            >
                              {copied ? t("copied") : t("copy")}
                            </button>
                            <button type="button" onClick={() => { setCopied(false); props.onDismissSecret(); }}>{t("close")}</button>
                          </div>
                        </div>
                      ) : null}
                      <div className="approval-actions">
                        <button type="button" className={hook.enabled ? "switch on" : "switch"} aria-pressed={hook.enabled} onClick={() => props.onPatchTrigger({ kind: "webhook", id: hook.id }, { enabled: !hook.enabled })}>
                          <i />
                          <span className="sr-only">{t("enabled")}</span>
                        </button>
                        {props.harness ? <button type="button" onClick={() => { setCopied(false); props.onRotateSecret(hook.id); }}>{t("newSecret")}</button> : null}
                        <button type="button" onClick={() => props.onRemoveTrigger({ kind: "webhook", id: hook.id })}>{t("remove")}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <h4>{t("runHistory")}</h4>
              {props.triggerRuns.filter((run) => run.botId === bot.id).length === 0 ? (
                <p className="hint">{t("noRuns")}</p>
              ) : (
                <ul className="run-list">
                  {props.triggerRuns.filter((run) => run.botId === bot.id).slice(0, 20).map((run) => (
                    <li key={run.id}>
                      <i className={`run-dot ${run.status}`} aria-hidden="true" />
                      <span>
                        <strong>{run.status === "ok" ? t("runOk") : run.status === "failed" ? t("runFailed") : t("runSkipped")}</strong> {run.title}
                      </span>
                      <small>
                        {run.kind === "webhook" ? t("webhooks") : t("schedulesHeading")} · {new Date(run.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                        {run.ms !== undefined ? ` · ${(run.ms / 1000).toFixed(1)} s` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>{t("tasks")}</h3>
              <form
                className="row-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskTitle.trim()) return;
                  props.onAddTask(bot.id, taskTitle.trim());
                  setTaskTitle("");
                }}
              >
                <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} aria-label={t("addTask")} placeholder={t("addTask")} />
                <button type="submit">{t("add")}</button>
              </form>
              <ul className="task-list">
                {tasks.filter((item) => item.botId === bot.id).map((task) => (
                  <li key={task.id}>
                    <strong>{task.title}</strong>
                    <span>{task.status === "done" ? t("doneTask") : task.status === "working" ? t("usingComputer") : t("queued")}</span>
                    {task.status !== "working" ? <button type="button" onClick={() => props.onStartTask(task.id)}>{t("startTask")}</button> : null}
                    <button type="button" onClick={() => props.onRemoveTask(task.id)}>{t("remove")}</button>
                  </li>
                ))}
              </ul>
            </section>
                </div>
              ) : null}
              {panel === "customize" ? (
              <div className="stack" role="tabpanel" id="panel-customize" aria-labelledby="panel-tab-customize">
                <label>{t("botName")}<input value={bot.name} onChange={(event) => props.onPatch(bot.id, { name: event.target.value })} /></label>
                <label>{t("botRole")}<input value={bot.role} onChange={(event) => props.onPatch(bot.id, { role: event.target.value })} /></label>
                <section>
                  <h3>{t("soulSection")}</h3>
                  <p className="hint">{t("soulHint")}</p>
                  <label>
                    {t("soulFile")}
                    <textarea
                      value={bot.soul ?? bot.persona}
                      onChange={(event) => {
                        const after = event.target.value;
                        const before = bot.soul ?? bot.persona;
                        const history = [...(bot.soulHistory ?? []), { at: Date.now(), before, after }].slice(-20);
                        props.onPatch(bot.id, { soul: after, persona: after, soulHistory: history });
                        if (props.harness) void harnessWriteBotSoul(bot.id, after).catch(() => undefined);
                      }}
                    />
                  </label>
                  {(bot.soulHistory?.length ?? 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const last = bot.soulHistory?.[bot.soulHistory.length - 1];
                        if (!last) return;
                        props.onPatch(bot.id, {
                          soul: last.before,
                          persona: last.before,
                          soulHistory: (bot.soulHistory ?? []).slice(0, -1),
                        });
                        if (props.harness) void harnessWriteBotSoul(bot.id, last.before).catch(() => undefined);
                      }}
                    >
                      {t("soulRollback")}
                    </button>
                  ) : (
                    <p className="hint">{t("soulHistoryEmpty")}</p>
                  )}
                </section>
                <section>
                  <h3>{t("instructionsSection")}</h3>
                  <label>{t("whatItDoes")}<textarea value={bot.instructions} onChange={(event) => props.onPatch(bot.id, { instructions: event.target.value })} /></label>
                </section>
                <section>
                  <h3>{t("permissionMode")}</h3>
                  <label>
                    {t("permissionMode")}
                    <select
                      value={bot.approvalMode ?? "ask"}
                      onChange={(event) => props.onPatch(bot.id, { approvalMode: event.target.value as ApprovalMode })}
                    >
                      <option value="ask">{t("permissionAsk")}</option>
                      <option value="auto">{t("permissionAuto")}</option>
                      <option value="full">{t("permissionFull")}</option>
                    </select>
                  </label>
                  <label>
                    {t("botVisibility")}
                    <select
                      value={bot.visibility ?? (bot.hidden ? "hidden" : "team")}
                      onChange={(event) => {
                        const visibility = event.target.value as BotVisibility;
                        props.onPatch(bot.id, {
                          visibility,
                          hidden: visibility === "hidden",
                        });
                      }}
                    >
                      <option value="team">{t("visibilityTeam")}</option>
                      <option value="hidden">{t("visibilityHidden")}</option>
                      <option value="primary_only">{t("visibilityPrimary")}</option>
                    </select>
                  </label>
                </section>
                <section>
                  <h3>{t("botUsage")}</h3>
                  <p className="hint">
                    {(bot.usage?.turns ?? 0)} turns · {(bot.usage?.charsOut ?? 0)} chars out · {(bot.usage?.commands ?? 0)} commands
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      props.onPatch(bot.id, {
                        usage: { turns: 0, charsIn: 0, charsOut: 0, commands: 0, since: Date.now() },
                      })
                    }
                  >
                    {t("resetBotUsage")}
                  </button>
                </section>
                <section>
                  <h3>{t("skillsSection")}</h3>
                  <p className="hint">{t("skillsCustomizeHint")}</p>
                  {SKILLS.map((skill) => (
                    <label key={skill} className="check">
                      <input
                        type="checkbox"
                        checked={bot.skills.includes(skill)}
                        onChange={() => {
                          const skills = bot.skills.includes(skill) ? bot.skills.filter((item) => item !== skill) : [...bot.skills, skill];
                          props.onPatch(bot.id, { skills });
                        }}
                      />
                      {t(SKILL_KEY[skill])}
                    </label>
                  ))}
                  <p className="hint">{t("skillsLibraryHint")}</p>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      void harnessSkills()
                        .then((result) => setLibrarySkills(result.skills))
                        .catch(() => props.onNotice(t("offline")));
                    }}
                  >
                    {t("skillsLibrary")}
                  </button>
                  {librarySkills.map((skill) => {
                    const assigned = (bot.librarySkillIds ?? []).includes(skill.id);
                    return (
                      <label key={skill.id} className="check">
                        <input
                          type="checkbox"
                          checked={assigned}
                          onChange={() => {
                            const librarySkillIds = assigned
                              ? (bot.librarySkillIds ?? []).filter((id) => id !== skill.id)
                              : [...(bot.librarySkillIds ?? []), skill.id];
                            props.onPatch(bot.id, { librarySkillIds });
                          }}
                        />
                        {skill.title}
                        {skill.summary ? ` — ${skill.summary}` : ""}
                      </label>
                    );
                  })}
                  <button type="button" className="text-btn" onClick={() => { props.onOverlay("hub"); props.onFocus("chat"); }}>{t("hub")}</button>
                </section>
                <p>{t("avatar")}</p>
                <AvatarEditor t={t} bot={bot} onPatch={(patch) => props.onPatch(bot.id, patch)} />
                <p>{t("color")}</p>
                <div className="swatches">
                  {COLORS.map((color) => (
                    <button key={color} type="button" className={bot.color === color ? "swatch on" : "swatch"} style={{ background: color }} aria-label={color} aria-pressed={bot.color === color} onClick={() => props.onPatch(bot.id, { color })} />
                  ))}
                </div>
                <div className="tabs">
                  {SHAPES.map((shape) => (
                    <button key={shape} type="button" aria-pressed={bot.shape === shape} onClick={() => props.onPatch(bot.id, { shape })}>
                      <BotMark bot={{ ...bot, shape }} size="0.9rem" /> {t(shape)}
                    </button>
                  ))}
                </div>
                <p>{t("botVoice")}</p>
                <div className="tabs">
                  {VOICES.map((voice) => (
                    <button key={voice.id} type="button" aria-pressed={bot.voice === voice.id} onClick={() => props.onPatch(bot.id, { voice: voice.id })}>{t(voice.id)}</button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      if (!("speechSynthesis" in window)) {
                        props.onNotice(t("voiceMissing"));
                        return;
                      }
                      window.speechSynthesis.cancel();
                      const tune = VOICES.find((item) => item.id === bot.voice) ?? VOICES[0];
                      const utter = new SpeechSynthesisUtterance(`${bot.name}. ${bot.persona}`);
                      utter.pitch = tune.pitch;
                      utter.rate = tune.rate;
                      window.speechSynthesis.speak(utter);
                    }}
                  >
                    {t("previewVoice")}
                  </button>
                </div>
                <section>
                  <h3>{t("memoriesSection")}</h3>
                  <p className="hint">{t("memoriesHint")}</p>
                  <ul>
                    {bot.memories.map((item, index) => (
                      <li key={`${item}-${index}`}>
                        {item} <button type="button" onClick={() => props.onPatch(bot.id, { memories: bot.memories.filter((_, itemIndex) => itemIndex !== index) })}>{t("remove")}</button>
                      </li>
                    ))}
                  </ul>
                  <form className="row-form" onSubmit={(event) => {
                    event.preventDefault();
                    if (!memory.trim()) return;
                    props.onPatch(bot.id, { memories: [...bot.memories, memory.trim()] });
                    setMemory("");
                  }}>
                    <input value={memory} onChange={(event) => setMemory(event.target.value)} aria-label={t("addMemory")} />
                    <button type="submit">{t("addMemory")}</button>
                  </form>
                  <h4>{t("memoryDocs")}</h4>
                  <p className="hint">{t("memoryDocsHint")}</p>
                  <textarea value={memoryDoc} onChange={(event) => setMemoryDoc(event.target.value)} rows={6} />
                  <div className="row-form">
                    <button
                      type="button"
                      onClick={() => {
                        void harnessBotMemory(bot.id)
                          .then((result) => {
                            const main = result.files.find((file) => file.path === "MEMORY.md");
                            setMemoryDoc(main?.content ?? result.files.map((file) => `## ${file.path}\n${file.content}`).join("\n\n"));
                          })
                          .catch(() => props.onNotice(t("offline")));
                      }}
                    >
                      {t("syncMemory")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void harnessWriteBotMemory(bot.id, "MEMORY.md", memoryDoc)
                          .then(() => props.onNotice(t("saved")))
                          .catch(() => props.onNotice(t("offline")));
                      }}
                    >
                      {t("saveMemory")}
                    </button>
                  </div>
                </section>
                <h3>{t("reminders")}</h3>
                <form className="row-form" onSubmit={(event) => {
                  event.preventDefault();
                  if (!reminderTitle.trim()) return;
                  props.onAddReminder(bot.id, reminderTitle.trim(), Date.now() + 60 * 60 * 1000);
                  setReminderTitle("");
                }}>
                  <input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} aria-label={t("reminders")} />
                  <button type="submit">{t("add")}</button>
                </form>
                <ul>
                  {reminders.filter((item) => item.botId === bot.id).map((item) => (
                    <li key={item.id}>
                      <label className="check">
                        <input type="checkbox" checked={item.done} onChange={() => props.onToggleReminder(item.id)} />
                        {item.title}
                      </label>
                      <button type="button" onClick={() => props.onRemoveReminder(item.id)}>{t("remove")}</button>
                    </li>
                  ))}
                </ul>
                <h3>{t("notifications")}</h3>
                <label className="check">
                  <input type="checkbox" checked={Boolean(bot.muted)} onChange={(event) => props.onPatch(bot.id, { muted: event.target.checked })} />
                  {t("mute")}
                </label>
                <label className="check">
                  <input type="checkbox" checked={Boolean(bot.speakReplies)} onChange={(event) => props.onPatch(bot.id, { speakReplies: event.target.checked })} />
                  {t("speakReplies")}
                </label>
                <label className="check">
                  <input type="checkbox" checked={bot.hidden} onChange={(event) => props.onPatch(bot.id, { hidden: event.target.checked })} />
                  {t("hidden")}
                </label>
                {bot.primary ? <p>{t("primary")}</p> : <button type="button" onClick={() => props.onPatch(bot.id, { primary: true })}>{t("makePrimary")}</button>}
                <button type="button" className="danger" onClick={() => { if (window.confirm(t("deleteBotConfirm"))) props.onDelete(bot.id); }}>{t("deleteBot")}</button>
              </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="inspector-scroll">
            <label className="model-picker">
              {t("model")}
              <select value={settings.model} onChange={(event) => props.onPatchSettings({ model: event.target.value })} aria-describedby="default-model-note">
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <p className="hint" id="default-model-note">{t("defaultModelLabel")} · {props.keys.has("XAI_API_KEY") ? t("api") : t("local")} · {online ? t("online") : t("offline")}</p>
            <p className="hint">{t("createBot")}</p>
          </div>
        )}
      </aside>

      <nav className="dock" aria-label={t("bots")}>
        <button type="button" aria-current={focus === "rail" ? "page" : undefined} onClick={() => props.onFocus("rail")}>{t("bots")}</button>
        <button type="button" aria-current={focus === "chat" ? "page" : undefined} onClick={() => props.onFocus("chat")}>{bot?.name || t("chat")}</button>
        <button type="button" aria-current={focus === "side" ? "page" : undefined} onClick={() => props.onFocus("side")}>{t("computer")}</button>
      </nav>
    </div>
  );
}

function pendingDraft(drafts: Record<string, string>, threads: Thread[], botId: string, openId: string | null): string {
  for (const thread of threads) {
    if (thread.botId !== botId || thread.memberIds || thread.id === openId) continue;
    const value = drafts[thread.id]?.trim();
    if (value) return value;
  }
  return "";
}

function previewOf(threads: Thread[], id: string | undefined): string {
  const pool = id === undefined ? threads : threads.filter((item) => item.botId === id && !item.memberIds);
  const thread = [...pool].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const last = [...(thread?.messages ?? [])].reverse().find((message) => message.text.trim());
  return last ? last.text.replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim().slice(0, 72) : "";
}
