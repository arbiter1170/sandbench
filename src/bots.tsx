import { useState } from "react";
import type { Key } from "./i18n";
import type { Bot, BotTask, ComputerEvent, Reminder, Routine, SkillId } from "./types";
import { MessageBody } from "./views";
import type { Message } from "./types";
import { COLORS, SHAPES, SKILLS, VOICES } from "./work";

type Copy = (key: Key) => string;

const SKILL_KEY: Record<SkillId, Key> = {
  computer: "skillComputer",
  files: "skillFiles",
  reminders: "skillReminders",
  calendar: "skillCalendar",
  mail: "skillMail",
};

export function BotMark({ bot, size = "2.2rem" }: { bot: Pick<Bot, "shape" | "color" | "name" | "avatar">; size?: string }) {
  if (bot.avatar) {
    return <img className={`mark mark-photo mark-${bot.shape}`} src={bot.avatar} alt={bot.name} style={{ width: size, height: size }} />;
  }
  return (
    <span
      className={`mark mark-${bot.shape}`}
      style={{ background: bot.color, width: size, height: size }}
      role="img"
      aria-label={bot.name}
    />
  );
}

function speak(bot: Bot, line: string): boolean {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const tune = VOICES.find((item) => item.id === bot.voice) ?? VOICES[0];
  const utter = new SpeechSynthesisUtterance(line);
  utter.pitch = tune.pitch;
  utter.rate = tune.rate;
  window.speechSynthesis.speak(utter);
  return true;
}

export function BotsScreen({
  t,
  wide,
  bots,
  tasks,
  routines,
  computer,
  reminders,
  selectedId,
  workingBotId,
  messages,
  streaming,
  onSelect,
  onCreate,
  onPatch,
  onDelete,
  onAsk,
  onStop,
  onAddTask,
  onStartTask,
  onRemoveTask,
  onAddRoutine,
  onToggleRoutine,
  onRemoveRoutine,
  onAddReminder,
  onToggleReminder,
  onRemoveReminder,
  onNotice,
}: {
  t: Copy;
  wide: boolean;
  bots: Bot[];
  tasks: BotTask[];
  routines: Routine[];
  computer: ComputerEvent[];
  reminders: Reminder[];
  selectedId: string | null;
  workingBotId: string | null;
  messages: Message[];
  streaming: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string, role: string) => void;
  onPatch: (id: string, patch: Partial<Bot>) => void;
  onDelete: (id: string) => void;
  onAsk: (botId: string, text: string) => void;
  onStop: () => void;
  onAddTask: (botId: string, title: string) => void;
  onStartTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onAddRoutine: (botId: string, title: string, schedule: string) => void;
  onToggleRoutine: (id: string) => void;
  onRemoveRoutine: (id: string) => void;
  onAddReminder: (botId: string, title: string, at: number) => void;
  onToggleReminder: (id: string) => void;
  onRemoveReminder: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [rosterOnly, setRosterOnly] = useState(false);
  const [tab, setTab] = useState<"chat" | "profile" | "computer" | "tasks">("profile");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [draft, setDraft] = useState("");
  const [memory, setMemory] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [routineTitle, setRoutineTitle] = useState("");
  const [routineWhen, setRoutineWhen] = useState("Weekdays at 9:00");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState(() => {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  const [handoffId, setHandoffId] = useState("");
  const bot = bots.find((item) => item.id === selectedId) ?? null;
  const showDetail = Boolean(bot) && (wide || !rosterOnly);
  const botTasks = tasks.filter((item) => item.botId === bot?.id);
  const botRoutines = routines.filter((item) => item.botId === bot?.id);
  const botReminders = reminders.filter((item) => item.botId === bot?.id);
  const usage = new Map<string, { cpu: number; count: number }>();
  for (const event of computer) {
    const current = usage.get(event.app) ?? { cpu: 0, count: 0 };
    usage.set(event.app, { cpu: current.cpu + event.cpu, count: current.count + 1 });
  }

  return (
    <div className={showDetail ? "bots detail" : "bots"}>
      <section className="roster" aria-label={t("teammates")}>
        <h2>{t("teammates")}</h2>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              onNotice(t("needName"));
              return;
            }
            onCreate(name.trim(), role.trim());
            setName("");
            setRole("");
            setRosterOnly(false);
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
          <button type="submit" className="primary">
            {t("addBot")}
          </button>
        </form>
        <ul className="bot-list">
          {bots.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === bot?.id ? "bot-row active" : "bot-row"}
                aria-current={item.id === bot?.id ? "true" : undefined}
                onClick={() => {
                  onSelect(item.id);
                  setRosterOnly(false);
                }}
              >
                <BotMark bot={item} size="1.6rem" />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.role}
                    {item.primary ? ` · ${t("primary")}` : ""}
                    {item.hidden ? ` · ${t("hidden")}` : ""}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {bot ? (
        <section className="bot-detail">
          {!wide ? (
            <button type="button" onClick={() => setRosterOnly(true)}>
              {t("backToBots")}
            </button>
          ) : null}
          <header className="bot-head">
            <BotMark bot={bot} />
            <div>
              <h2>{bot.name}</h2>
              <p>{bot.role}</p>
            </div>
          </header>
          <div className="tabs" role="tablist">
            {(["profile", "chat", "computer", "tasks"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                onClick={() => setTab(item)}
              >
                {t(item === "profile" ? "profile" : item === "chat" ? "chat" : item === "computer" ? "computer" : "tasks")}
              </button>
            ))}
          </div>

          {tab === "profile" ? (
            <div className="stack">
              <label>
                {t("botName")}
                <input value={bot.name} onChange={(event) => onPatch(bot.id, { name: event.target.value })} />
              </label>
              <label>
                {t("botRole")}
                <input value={bot.role} onChange={(event) => onPatch(bot.id, { role: event.target.value })} />
              </label>
              <label>
                {t("whatItDoes")}
                <textarea value={bot.instructions} onChange={(event) => onPatch(bot.id, { instructions: event.target.value })} />
              </label>
              <label>
                {t("persona")}
                <textarea value={bot.persona} onChange={(event) => onPatch(bot.id, { persona: event.target.value })} />
              </label>
              <fieldset>
                <legend>{t("appearance")}</legend>
                <p>{t("color")}</p>
                <div className="swatches">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={bot.color === color ? "swatch on" : "swatch"}
                      style={{ background: color }}
                      aria-label={color}
                      aria-pressed={bot.color === color}
                      onClick={() => onPatch(bot.id, { color })}
                    />
                  ))}
                </div>
                <p>{t("shape")}</p>
                <div className="tabs">
                  {SHAPES.map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      aria-pressed={bot.shape === shape}
                      onClick={() => onPatch(bot.id, { shape })}
                    >
                      <BotMark bot={{ ...bot, shape }} size="1rem" />
                      {t(shape)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{t("botVoice")}</legend>
                <div className="tabs">
                  {VOICES.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      aria-pressed={bot.voice === voice.id}
                      onClick={() => onPatch(bot.id, { voice: voice.id })}
                    >
                      {t(voice.id)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ok = speak(bot, `${bot.name}. ${bot.persona}`);
                    if (!ok) onNotice(t("voiceMissing"));
                  }}
                >
                  {t("previewVoice")}
                </button>
              </fieldset>
              <fieldset>
                <legend>{t("skills")}</legend>
                {SKILLS.map((skill) => (
                  <label key={skill} className="check">
                    <input
                      type="checkbox"
                      checked={bot.skills.includes(skill)}
                      onChange={() => {
                        const skills = bot.skills.includes(skill)
                          ? bot.skills.filter((item) => item !== skill)
                          : [...bot.skills, skill];
                        onPatch(bot.id, { skills });
                      }}
                    />
                    {t(SKILL_KEY[skill])}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>{t("memories")}</legend>
                <ul>
                  {bot.memories.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      {item}{" "}
                      <button
                        type="button"
                        onClick={() => onPatch(bot.id, { memories: bot.memories.filter((_, itemIndex) => itemIndex !== index) })}
                      >
                        {t("remove")}
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="row-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!memory.trim()) return;
                    onPatch(bot.id, { memories: [...bot.memories, memory.trim()] });
                    setMemory("");
                  }}
                >
                  <input value={memory} onChange={(event) => setMemory(event.target.value)} aria-label={t("addMemory")} />
                  <button type="submit">{t("addMemory")}</button>
                </form>
              </fieldset>
              <label className="check">
                <input
                  type="checkbox"
                  checked={bot.hidden}
                  onChange={(event) => onPatch(bot.id, { hidden: event.target.checked })}
                />
                {t("hidden")}
              </label>
              {bot.primary ? <p>{t("primary")}</p> : (
                <button type="button" onClick={() => onPatch(bot.id, { primary: true })}>
                  {t("makePrimary")}
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (!window.confirm(t("deleteBotConfirm"))) return;
                  onDelete(bot.id);
                }}
              >
                {t("deleteBot")}
              </button>
            </div>
          ) : null}

          {tab === "chat" ? (
            <div className="bot-chat">
              {messages.length === 0 ? <p>{t("noThinking")}</p> : null}
              {messages.map((message) => (
                <MessageBody key={message.id} message={message} t={t} youLabel={t("you")} />
              ))}
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draft.trim()) return;
                  onAsk(bot.id, draft.trim());
                  setDraft("");
                }}
              >
                <label>
                  {t("botMessage")}
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
                </label>
                <div className="tabs">
                  {streaming && workingBotId === bot.id ? (
                    <button type="button" onClick={onStop}>
                      {t("stop")}
                    </button>
                  ) : (
                    <button type="submit" className="primary" disabled={!draft.trim()}>
                      {t("send")}
                    </button>
                  )}
                  {bots.filter((item) => item.id !== bot.id).length > 0 ? (
                    <>
                      <select value={handoffId} onChange={(event) => setHandoffId(event.target.value)} aria-label={t("handoff")}>
                        <option value="">{t("handoff")}</option>
                        {bots
                          .filter((item) => item.id !== bot.id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!draft.trim() || !handoffId}
                        onClick={() => {
                          onAsk(handoffId, `From ${bot.name}: ${draft.trim()}`);
                          setDraft("");
                          onSelect(handoffId);
                        }}
                      >
                        {t("handoff")}
                      </button>
                    </>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}

          {tab === "computer" ? (
            <div className="stack">
              <p>{workingBotId === bot.id ? t("usingComputer") : t("computerIdle")}</p>
              <p>{t("simulatedComputer")}</p>
              <h3>{t("thinkingThrough")}</h3>
              {bot.lastThinking.length === 0 ? <p>{t("noThinking")}</p> : (
                <ol className="trace">
                  {bot.lastThinking.map((step, index) => (
                    <li key={`${step}-${index}`}>{step}</li>
                  ))}
                </ol>
              )}
              <h3>{t("usageByApp")}</h3>
              <ul className="meters">
                {[...usage.entries()].map(([app, stat]) => {
                  const average = Math.round(stat.cpu / stat.count);
                  return (
                    <li key={app}>
                      <span>{app}</span>
                      <span className="meter" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, average * 3)}%` }} />
                      </span>
                      <span>{average}</span>
                    </li>
                  );
                })}
              </ul>
              <h3>{t("sharedComputer")}</h3>
              <ol className="action-log">
                {computer.map((event) => {
                  const owner = bots.find((item) => item.id === event.botId);
                  return (
                    <li key={event.id} className={event.botId === bot.id ? "mine" : ""}>
                      <strong>{event.app}</strong> {event.action}
                      <small>
                        {owner?.name ?? ""} · {t("load")} {event.cpu}
                      </small>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {tab === "tasks" ? (
            <div className="stack">
              <form
                className="row-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskTitle.trim()) {
                    onNotice(t("needTitle"));
                    return;
                  }
                  onAddTask(bot.id, taskTitle.trim());
                  setTaskTitle("");
                }}
              >
                <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} aria-label={t("addTask")} />
                <button type="submit">{t("addTask")}</button>
              </form>
              {botTasks.length === 0 ? <p>{t("noTasks")}</p> : null}
              <ul className="task-list">
                {botTasks.map((task) => (
                  <li key={task.id}>
                    <strong>{task.title}</strong>
                    <span>{task.status === "done" ? t("doneTask") : task.status === "working" ? t("usingComputer") : t("queued")}</span>
                    {task.thinking.length > 0 ? (
                      <ol className="trace">
                        {task.thinking.map((step, index) => (
                          <li key={`${step}-${index}`}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="tabs">
                      {task.status !== "working" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setTab("computer");
                            onStartTask(task.id);
                          }}
                        >
                          {t("startTask")}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => onRemoveTask(task.id)}>
                        {t("remove")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <h3>{t("routines")}</h3>
              <p>{t("routineNote")}</p>
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!routineTitle.trim()) {
                    onNotice(t("needTitle"));
                    return;
                  }
                  onAddRoutine(bot.id, routineTitle.trim(), routineWhen.trim());
                  setRoutineTitle("");
                }}
              >
                <label>
                  {t("addRoutine")}
                  <input value={routineTitle} onChange={(event) => setRoutineTitle(event.target.value)} />
                </label>
                <label>
                  {t("schedule")}
                  <input value={routineWhen} onChange={(event) => setRoutineWhen(event.target.value)} />
                </label>
                <button type="submit">{t("addRoutine")}</button>
              </form>
              <ul>
                {botRoutines.map((routine) => (
                  <li key={routine.id}>
                    <strong>{routine.title}</strong>
                    <span>{routine.schedule}</span>
                    <label className="check">
                      <input type="checkbox" checked={routine.enabled} onChange={() => onToggleRoutine(routine.id)} />
                      {t("enabled")}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setTab("computer");
                        onAsk(bot.id, routine.title);
                      }}
                    >
                      {t("runRoutine")}
                    </button>
                    <button type="button" onClick={() => onRemoveRoutine(routine.id)}>
                      {t("remove")}
                    </button>
                  </li>
                ))}
              </ul>
              <h3>{t("reminders")}</h3>
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!reminderTitle.trim()) {
                    onNotice(t("needTitle"));
                    return;
                  }
                  const at = new Date(reminderAt).getTime();
                  if (Number.isNaN(at)) return;
                  onAddReminder(bot.id, reminderTitle.trim(), at);
                  setReminderTitle("");
                }}
              >
                <label>
                  {t("reminders")}
                  <input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} />
                </label>
                <label>
                  {t("schedule")}
                  <input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} />
                </label>
                <button type="submit">{t("add")}</button>
              </form>
              <ul>
                {botReminders.map((item) => (
                  <li key={item.id}>
                    <label className="check">
                      <input type="checkbox" checked={item.done} onChange={() => onToggleReminder(item.id)} />
                      {item.title}
                    </label>
                    <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString()}</time>
                    <button type="button" onClick={() => onRemoveReminder(item.id)}>
                      {t("remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
