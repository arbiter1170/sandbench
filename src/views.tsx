import { useEffect, useState } from "react";
import { CAPABILITIES, type CapabilityState } from "./capabilities";
import { getBlob } from "./db";
import { fromDateTimeLocal, toDateTimeLocal } from "./device";
import { highlight } from "./highlight";
import { testDecisionModel } from "./decision";
import { harnessTtsVoices, type AgentDriver, type TtsProvider } from "./harness";
import type { Key } from "./i18n";
import { parseMarkdown, type Inline } from "./markdown";
import { profileLabelKey, profileReadiness, TEST_PROFILE_IDS, type TestProfileId } from "./testProfiles";
import type { Approval, CalEvent, Contact, Locale, LogItem, Message, Reminder, Settings, Thread } from "./types";
import { LOCALE_OPTIONS } from "./types";
import { lineDiff, parseSchedule } from "./work";

type Copy = (key: Key) => string;

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((item, index) => {
        if (item.type === "strong") return <strong key={index}>{item.text}</strong>;
        if (item.type === "em") return <em key={index}>{item.text}</em>;
        if (item.type === "code") return <code key={index}>{item.text}</code>;
        if (item.type === "link") {
          return (
            <a key={index} href={item.href} target="_blank" rel="noreferrer">
              {item.text}
            </a>
          );
        }
        return <span key={index}>{item.text}</span>;
      })}
    </>
  );
}

function CodeBlock({
  lang,
  text,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  lang: string;
  text: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const tokens = highlight(text);
  return (
    <figure className="codeblock">
      <figcaption>
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => {
                setState("copied");
                window.setTimeout(() => setState("idle"), 1400);
              },
              () => setState("failed"),
            );
          }}
        >
          {state === "copied" ? copiedLabel : state === "failed" ? failedLabel : copyLabel}
        </button>
      </figcaption>
      <pre>
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={token.kind === "plain" ? undefined : `tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

let diagramCount = 0;

function Diagram({ source }: { source: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        diagramCount += 1;
        const result = await mermaid.render(`sb-diagram-${diagramCount}`, source);
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [source]);
  if (failed) return <pre className="diagram-source">{source}</pre>;
  if (!svg) return <p className="hint">…</p>;
  return <figure className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function MarkdownView({ text, t, streaming }: { text: string; t: Copy; streaming?: boolean }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        if (block.type === "code" && block.lang === "mermaid" && !streaming) return <Diagram key={index} source={block.text} />;
        if (block.type === "code") {
          return (
            <CodeBlock
              key={index}
              lang={block.lang}
              text={block.text}
              copyLabel={t("copy")}
              copiedLabel={t("copied")}
              failedLabel={t("copyFailed")}
            />
          );
        }
        if (block.type === "h") return <h3 key={index}><Inlines items={block.inlines} /></h3>;
        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines items={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={index}>
              <Inlines items={block.inlines} />
            </blockquote>
          );
        }
        return (
          <p key={index}>
            <Inlines items={block.inlines} />
          </p>
        );
      })}
    </div>
  );
}

export function BlobMedia({ id, name, kind }: { id: string; name: string; kind: "image" | "audio" }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let current = "";
    void getBlob(id).then((blob) => {
      if (!blob || !active) return;
      current = URL.createObjectURL(blob);
      setUrl(current);
    });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [id]);
  if (!url) return <p>{name}</p>;
  if (kind === "audio") return <audio controls src={url} preload="metadata" />;
  return <img src={url} alt={name} />;
}

function QuestionCard({ approval, t, onDecide }: { approval: Approval; t: Copy; onDecide?: (approve: boolean, answer?: string) => void }) {
  const question = approval.question!;
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const options = question.options ?? [];
  const chosen = options.filter((option) => picked.includes(option.id)).map((option) => option.label);
  const answer = [...chosen, typed.trim()].filter(Boolean).join(", ");
  const toggle = (id: string) =>
    setPicked((prev) => (question.multi ? (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]) : [id]));
  const label =
    approval.status === "pending" ? t("questionPending") : approval.status === "approved" ? t("questionAnswered") : t("questionDismissed");
  return (
    <section className={`approval question ${approval.status}`} aria-label={t("question")}>
      <header>
        <strong>{t("question")}</strong>
        <span>{label}</span>
      </header>
      <p className="question-prompt">{question.prompt}</p>
      {approval.status === "pending" && onDecide ? (
        <form
          className="question-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer) onDecide(true, answer);
          }}
        >
          {options.length > 0 ? (
            <fieldset>
              <legend className="sr-only">{question.prompt}</legend>
              {options.map((option) => (
                <label key={option.id} className="choice">
                  <input
                    type={question.multi ? "checkbox" : "radio"}
                    name={`q-${question.prompt}`}
                    checked={picked.includes(option.id)}
                    onChange={() => toggle(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <input
            type="text"
            value={typed}
            placeholder={options.length > 0 ? t("questionOther") : t("questionAnswer")}
            aria-label={options.length > 0 ? t("questionOther") : t("questionAnswer")}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="approval-actions">
            <button type="submit" className="primary" disabled={!answer}>{t("questionSend")}</button>
            <button type="button" onClick={() => onDecide(false)}>{t("questionDismiss")}</button>
          </div>
        </form>
      ) : approval.status === "approved" ? (
        <p className="question-answer">{approval.output}</p>
      ) : null}
    </section>
  );
}

function FilePreview({ approval, t }: { approval: Approval; t: Copy }) {
  const file = approval.file!;
  if (file.op === "delete") {
    return (
      <details open={approval.status === "pending"}>
        <summary>{file.existed === false ? t("fileMissing") : t("fileDeletePreview")}</summary>
        {file.previous ? <pre className="wrap">{file.previous.slice(0, 4000)}</pre> : null}
      </details>
    );
  }
  const diff = file.existed && file.previous !== undefined ? lineDiff(file.previous, file.preview) : "";
  return (
    <details open={approval.status === "pending"}>
      <summary>{file.existed ? t("fileReplacePreview") : t("fileNewPreview")}</summary>
      <pre className="wrap file-diff">
        {diff
          ? diff.split("\n").map((line, index) => (
              <span key={index} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : undefined}>
                {line}
                {"\n"}
              </span>
            ))
          : file.preview.slice(0, 8000) || t("noOutput")}
      </pre>
    </details>
  );
}

function ApprovalCard({ approval, t, onDecide }: { approval: Approval; t: Copy; onDecide?: (approve: boolean, answer?: string) => void }) {
  if (approval.question) return <QuestionCard approval={approval} t={t} onDecide={onDecide} />;
  const label =
    approval.status === "pending"
      ? t("approvalPending")
      : approval.status === "approved"
        ? approval.auto
          ? t("approvalAuto")
          : t("approvalApproved")
        : approval.status === "denied"
          ? t("approvalDenied")
          : approval.status === "failed"
            ? t("approvalFailed")
            : t("harnessOff");
  return (
    <section className={`approval ${approval.status}`} aria-label={t("approval")}>
      <header>
        <strong>{t("approval")}</strong>
        <span>{label}</span>
      </header>
      <code>{approval.command}</code>
      <p>{approval.reason}</p>
      {approval.file ? <FilePreview approval={approval} t={t} /> : null}
      {approval.status === "pending" && onDecide ? (
        <div className="approval-actions">
          <button type="button" className="primary" onClick={() => onDecide(true)}>{t("approve")}</button>
          <button type="button" onClick={() => onDecide(false)}>{t("deny")}</button>
        </div>
      ) : null}
      {approval.output !== undefined ? (
        <details open>
          <summary>{t("output")}{approval.exitCode !== undefined ? ` · ${t("exitCode")} ${approval.exitCode}` : ""}</summary>
          <pre className={approval.tool ? "wrap" : undefined}>{approval.output || t("noOutput")}</pre>
        </details>
      ) : null}
    </section>
  );
}

export type TriggerInfo = { kind: "routine" | "webhook"; title: string; detail: string; enabled: boolean };
export type TriggerPatch = { enabled?: boolean; title?: string; schedule?: string; name?: string };

function TriggerCard({ info, t, onPatch, onUndo }: { info: TriggerInfo | null; t: Copy; onPatch: (patch: TriggerPatch) => void; onUndo: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(info?.title ?? "");
  const [detail, setDetail] = useState(info?.detail ?? "");
  if (!info) {
    return (
      <section className="approval trigger-card denied" aria-label={t("triggers")}>
        <header><strong>{t("triggers")}</strong><span>{t("triggerRemoved")}</span></header>
      </section>
    );
  }
  const badSchedule = info.kind === "routine" && !parseSchedule(detail);
  return (
    <section className={info.enabled ? "approval trigger-card" : "approval trigger-card denied"} aria-label={t("triggers")}>
      <header>
        <strong>{info.kind === "routine" ? t("schedulesHeading") : t("webhooks")}</strong>
        <span>{info.enabled ? t("triggerCreated") : t("paused")}</span>
      </header>
      {editing ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || badSchedule) return;
            onPatch(info.kind === "routine" ? { title: title.trim(), schedule: detail.trim() } : { title: title.trim(), name: detail.trim() || info.detail });
            setEditing(false);
          }}
        >
          <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label={info.kind === "routine" ? t("addRoutine") : t("webhookPrompt")} />
          <input value={detail} onChange={(event) => setDetail(event.target.value)} aria-label={info.kind === "routine" ? t("schedule") : t("webhookName")} aria-invalid={badSchedule} />
          {badSchedule ? <small className="hint">{t("badSchedule")}</small> : null}
          <div className="approval-actions">
            <button type="submit" className="primary" disabled={!title.trim() || badSchedule}>{t("save")}</button>
            <button type="button" onClick={() => setEditing(false)}>{t("cancel")}</button>
          </div>
        </form>
      ) : (
        <>
          <p><strong>{info.title}</strong></p>
          <p className="hint">{info.detail}</p>
          <div className="approval-actions">
            <button type="button" onClick={() => { setTitle(info.title); setDetail(info.detail); setEditing(true); }}>{t("edit")}</button>
            <button type="button" onClick={() => onPatch({ enabled: !info.enabled })}>{info.enabled ? t("pause") : t("resume")}</button>
            <button type="button" onClick={onUndo}>{t("undo")}</button>
          </div>
        </>
      )}
    </section>
  );
}

export function MessageBody({
  message,
  t,
  youLabel,
  author,
  onApproval,
  trigger,
  onTriggerPatch,
  onTriggerUndo,
}: {
  message: Message;
  t: Copy;
  youLabel: string;
  author?: string;
  onApproval?: (approve: boolean, answer?: string) => void;
  trigger?: TriggerInfo | null;
  onTriggerPatch?: (patch: TriggerPatch) => void;
  onTriggerUndo?: () => void;
}) {
  return (
    <article className={message.role === "user" ? "msg user" : message.fresh ? "msg fresh" : "msg"} aria-live={message.status === "streaming" ? "polite" : undefined}>
      {message.role === "assistant" && message.fresh ? <div className="draw" /> : null}
      <header className="who">
        <span>{message.role === "user" ? youLabel : author || t("assistant")}</span>
        {message.localStandIn ? <span className="meta">{t("local")}</span> : null}
        {message.status === "streaming" ? <span className="meta">{t("receiving")}</span> : null}
      </header>
      {message.attachments.length > 0 ? (
        <div className="attachments">
          {message.attachments.map((item) => (
            <BlobMedia key={item.id} id={item.id} name={item.name} kind={item.kind} />
          ))}
        </div>
      ) : null}
      {message.thinking && message.thinking.length > 0 ? (
        <details className="trace-fold" open={message.status === "streaming"}>
          <summary>{t("thinkingThrough")}</summary>
          <ol className="trace">
            {message.thinking.map((step, index) => (
              <li key={`${step}-${index}`}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}
      {message.text ? <MarkdownView text={message.text} t={t} streaming={message.status === "streaming"} /> : null}
      {message.approval ? <ApprovalCard approval={message.approval} t={t} onDecide={onApproval} /> : null}
      {message.trigger && trigger !== undefined ? (
        <TriggerCard info={trigger} t={t} onPatch={(patch) => onTriggerPatch?.(patch)} onUndo={() => onTriggerUndo?.()} />
      ) : null}
      {message.activity && message.activity.length > 0 ? (
        <ul className="activity-chips" aria-label={t("activity")}>
          {message.activity.map((chip, index) => (
            <li key={`${chip.label}-${index}`}>
              {chip.label}
              {chip.ms !== undefined ? ` · ${chip.ms < 1000 ? `${chip.ms} ms` : `${(chip.ms / 1000).toFixed(1)} s`}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {message.screenThumb ? (
        <figure className="screen-thumb">
          <img src={message.screenThumb} alt={t("screenAfter")} loading="lazy" />
          <figcaption>{t("screenAfter")}</figcaption>
        </figure>
      ) : null}
    </article>
  );
}

function stateLabel(t: Copy, state: CapabilityState): string {
  if (state === "working") return t("working");
  if (state === "partial") return t("partial");
  if (state === "preview") return t("preview");
  if (state === "nativeOnly") return t("nativeOnly");
  return t("omitted");
}

export function ToolsPanel({
  t,
  locale,
  contacts,
  events,
  reminders,
  threads,
  notifyLabel,
  onAddContact,
  onRemoveContact,
  onPickContacts,
  onAddEvent,
  onRemoveEvent,
  onExport,
  onAddReminder,
  onToggleReminder,
  onRemoveReminder,
  onNotify,
}: {
  t: Copy;
  locale: string;
  contacts: Contact[];
  events: CalEvent[];
  reminders: Reminder[];
  threads: Thread[];
  notifyLabel: string;
  onAddContact: (contact: { name: string; tel: string; email: string }) => void;
  onRemoveContact: (id: string) => void;
  onPickContacts: () => void;
  onAddEvent: (event: { title: string; start: number; end: number; notes: string }) => void;
  onRemoveEvent: (id: string) => void;
  onExport: () => void;
  onAddReminder: (reminder: { title: string; at: number }) => void;
  onToggleReminder: (id: string) => void;
  onRemoveReminder: (id: string) => void;
  onNotify: () => void;
}) {
  const [contact, setContact] = useState({ name: "", tel: "", email: "" });
  const [eventTitle, setEventTitle] = useState("");
  const [eventStart, setEventStart] = useState(() => toDateTimeLocal(Date.now() + 60 * 60 * 1000));
  const [eventEnd, setEventEnd] = useState(() => toDateTimeLocal(Date.now() + 2 * 60 * 60 * 1000));
  const [eventNotes, setEventNotes] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState(() => toDateTimeLocal(Date.now() + 5 * 60 * 1000));
  const [formError, setFormError] = useState("");
  const [perms, setPerms] = useState<Record<string, string>>({});

  useEffect(() => {
    const names = [
      ["camera", "cameraLabel"],
      ["microphone", "micLabel"],
      ["geolocation", "geoLabel"],
      ["notifications", "notifyLabel"],
    ] as const;
    let active = true;
    void Promise.all(
      names.map(async ([name]) => {
        try {
          const status = await navigator.permissions.query({ name: name as PermissionName });
          return [name, status.state] as const;
        } catch {
          return [name, "unknown"] as const;
        }
      }),
    ).then((rows) => {
      if (!active) return;
      setPerms(Object.fromEntries(rows));
    });
    return () => {
      active = false;
    };
  }, []);

  const latest = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const snippet = [...(latest?.messages ?? [])].reverse().find((item) => item.text.trim());
  const snippetText = snippet
    ? snippet.text.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 140)
    : "";
  const when = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="screen">
      <h2>{t("browser")}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("status")}</th>
            <th scope="col">{t("browser")}</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["camera", "cameraLabel"],
              ["microphone", "micLabel"],
              ["geolocation", "geoLabel"],
              ["notifications", "notifyLabel"],
            ] as const
          ).map(([name, label]) => {
            const value = perms[name] ?? "unknown";
            const text =
              value === "granted" ? t("granted") : value === "denied" ? t("denied") : value === "prompt" ? t("prompt") : t("unknown");
            return (
              <tr key={name}>
                <th scope="row">{t(label)}</th>
                <td>{text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        <button type="button" onClick={onNotify}>
          {t("allowNotifications")}
        </button>{" "}
        <span>{notifyLabel}</span>
      </p>

      <h2>{t("people")}</h2>
      <h3>{t("contacts")}</h3>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!contact.name.trim()) {
            setFormError(t("needName"));
            return;
          }
          setFormError("");
          onAddContact(contact);
          setContact({ name: "", tel: "", email: "" });
        }}
      >
        <label>
          {t("name")}
          <input value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
        </label>
        <label>
          {t("phone")}
          <input value={contact.tel} onChange={(event) => setContact({ ...contact, tel: event.target.value })} inputMode="tel" />
        </label>
        <label>
          {t("email")}
          <input value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} inputMode="email" />
        </label>
        <div className="actions">
          <button type="submit">{t("add")}</button>
          <button type="button" onClick={onPickContacts}>
            {t("fromDevice")}
          </button>
        </div>
      </form>
      <ul className="plain">
        {contacts.map((item) => (
          <li key={item.id}>
            <span>
              {item.name}
              {item.tel ? ` · ${item.tel}` : ""}
              {item.email ? ` · ${item.email}` : ""}
            </span>
            <button type="button" onClick={() => onRemoveContact(item.id)}>
              {t("remove")}
            </button>
          </li>
        ))}
      </ul>

      <h3>{t("calendar")}</h3>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!eventTitle.trim()) {
            setFormError(t("needTitle"));
            return;
          }
          setFormError("");
          onAddEvent({
            title: eventTitle.trim(),
            start: fromDateTimeLocal(eventStart),
            end: fromDateTimeLocal(eventEnd),
            notes: eventNotes.trim(),
          });
          setEventTitle("");
          setEventNotes("");
        }}
      >
        <label>
          {t("title")}
          <input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} />
        </label>
        <label>
          {t("starts")}
          <input type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} />
        </label>
        <label>
          {t("ends")}
          <input type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} />
        </label>
        <label>
          {t("notes")}
          <input value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} />
        </label>
        <div className="actions">
          <button type="submit">{t("add")}</button>
          <button type="button" onClick={onExport} disabled={events.length === 0}>
            {t("exportCalendar")}
          </button>
        </div>
      </form>
      <ul className="plain">
        {events.map((item) => (
          <li key={item.id}>
            <span>
              {item.title} · <time dateTime={new Date(item.start).toISOString()}>{when.format(item.start)}</time>
            </span>
            <button type="button" onClick={() => onRemoveEvent(item.id)}>
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
            setFormError(t("needTitle"));
            return;
          }
          setFormError("");
          onAddReminder({ title: reminderTitle.trim(), at: fromDateTimeLocal(reminderAt) });
          setReminderTitle("");
        }}
      >
        <label>
          {t("title")}
          <input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} />
        </label>
        <label>
          {t("due")}
          <input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} />
        </label>
        <button type="submit">{t("add")}</button>
      </form>
      {formError ? <p role="alert">{formError}</p> : null}
      <ul className="plain">
        {reminders.map((item) => (
          <li key={item.id}>
            <span>
              {item.title} · <time dateTime={new Date(item.at).toISOString()}>{when.format(item.at)}</time>
              {item.done ? ` · ${t("markDone")}` : ""}
            </span>
            <button type="button" onClick={() => onToggleReminder(item.id)}>
              {t("markDone")}
            </button>
            <button type="button" onClick={() => onRemoveReminder(item.id)}>
              {t("remove")}
            </button>
          </li>
        ))}
      </ul>

      <h2>{t("widget")}</h2>
      <div className="widget" aria-label={t("widget")}>
        <p>{t("latest")}</p>
        <strong>{latest?.title || t("noneYet")}</strong>
        <p>{snippetText || t("noneYet")}</p>
      </div>
      <p>{t("widgetNote")}</p>

      <h2>{t("links")}</h2>
      <div className="actions">
        <a className="action" href="cursorapp://">
          {t("openCursor")}
        </a>
        <a className="action" href="onepassword://">
          {t("openPassword")}
        </a>
      </div>

      <h2>{t("capabilityMap")}</h2>
      <p>{t("mapNote")}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("observed")}</th>
            <th scope="col">{t("webHere")}</th>
            <th scope="col">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map((item) => (
            <tr key={item.observed}>
              <th scope="row">{item.observed}</th>
              <td>{item.web}</td>
              <td>{stateLabel(t, item.state)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsPanel({
  t,
  settings,
  logs,
  canInstall,
  drivers,
  onApplyDefaultTestProfile,
  onChange,
  onSavePin,
  onClearLock,
  onLockNow,
  onPasskey,
  onErase,
  onInstall,
}: {
  t: Copy;
  settings: Settings;
  logs: LogItem[];
  canInstall: boolean;
  drivers: AgentDriver[];
  onApplyDefaultTestProfile: (profile: TestProfileId) => void;
  onChange: (partial: Partial<Settings>) => void;
  onSavePin: (pin: string) => void;
  onClearLock: () => void;
  onLockNow: () => void;
  onPasskey: () => void;
  onErase: () => void;
  onInstall: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [pin, setPin] = useState("");
  const [decisionTest, setDecisionTest] = useState("");
  const [ttsVoices, setTtsVoices] = useState<{ id: string; label: string }[]>([]);
  const [ttsVoiceError, setTtsVoiceError] = useState("");
  const when = new Intl.DateTimeFormat(settings.locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="screen">
      <h2>{t("about")}</h2>
      <p className="measure">{t("aboutBody")}</p>

      <h2>{t("language")}</h2>
      <div className="stack">
        <label>
          {t("language")}
          <select
            value={settings.locale}
            onChange={(event) => onChange({ locale: event.target.value as Locale })}
          >
            {LOCALE_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("yourName")}
          <input
            value={settings.displayName}
            autoComplete="nickname"
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </label>
      </div>

      <h2>{t("connection")}</h2>
      <div className="stack">
        <label>
          {t("model")}
          <input value={settings.model} onChange={(event) => onChange({ model: event.target.value })} />
        </label>
        <label>
          {t("apiBase")}
          <input
            value={settings.apiBase}
            placeholder="https://"
            onChange={(event) => onChange({ apiBase: event.target.value })}
            autoComplete="off"
          />
        </label>
        <label>
          {t("apiKey")}
          <input
            type={showKey ? "text" : "password"}
            value={settings.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            autoComplete="off"
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => setShowKey((value) => !value)}>
            {showKey ? t("hideKey") : t("showKey")}
          </button>
          <button type="button" onClick={() => onChange({ apiKey: "" })}>
            {t("clearKey")}
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.useProxy}
            onChange={(event) => onChange({ useProxy: event.target.checked })}
          />
          {t("useProxy")}
        </label>
        <p className="measure">{t("proxyHint")}</p>
        <h3>{t("providerCompat")}</h3>
        <p className="measure">{t("compatHint")}</p>
        <label>
          {t("apiBase")}
          <input
            value={settings.compatBase ?? ""}
            placeholder="https://"
            onChange={(event) => onChange({ compatBase: event.target.value })}
            autoComplete="off"
          />
        </label>
        <label>
          {t("apiKey")}
          <input
            type={showKey ? "text" : "password"}
            value={settings.compatKey ?? ""}
            onChange={(event) => onChange({ compatKey: event.target.value })}
            autoComplete="off"
          />
        </label>
        <h3>{t("providerAnthropic")}</h3>
        <p className="measure">{t("anthropicHint")}</p>
        <label>
          {t("defaultModelLabel")}
          <input
            value={settings.anthropicModel ?? ""}
            placeholder="claude-sonnet-5"
            onChange={(event) => onChange({ anthropicModel: event.target.value.trim() || undefined })}
            autoComplete="off"
          />
        </label>
        <label>
          {t("apiKey")}
          <input
            type={showKey ? "text" : "password"}
            value={settings.anthropicKey ?? ""}
            onChange={(event) => onChange({ anthropicKey: event.target.value })}
            autoComplete="off"
          />
        </label>
        <label>
          {t("defaultAgentDriver")}
          <select value={settings.defaultAgentDriver ?? ""} onChange={(event) => onChange({ defaultAgentDriver: (event.target.value || undefined) as Settings["defaultAgentDriver"] })}>
            <option value="">{t("builtinPlanner")}</option>
            <option value="anthropic">{t("providerAnthropic")}</option>
            <option value="http">{t("providerCompat")}</option>
            <option value="claude">Claude Code (CLI)</option>
            <option value="codex">Codex (CLI)</option>
            <option value="grok">Grok (CLI)</option>
          </select>
        </label>
        <h3>{t("ttsMode")}</h3>
        <p className="measure">{t("ttsXaiHint")}</p>
        <label>
          {t("ttsMode")}
          <select
            value={settings.ttsMode ?? "browser"}
            onChange={(event) => {
              onChange({ ttsMode: event.target.value as Settings["ttsMode"] });
              setTtsVoices([]);
              setTtsVoiceError("");
            }}
          >
            <option value="browser">{t("ttsBrowser")}</option>
            <option value="xai">{t("ttsXai")}</option>
            <option value="elevenlabs">{t("ttsElevenLabs")}</option>
            <option value="fish">{t("ttsFish")}</option>
            <option value="chatterbox">{t("ttsChatterbox")}</option>
            <option value="system">{t("ttsSystem")}</option>
          </select>
        </label>
        {settings.ttsMode === "elevenlabs" ? (
          <label>
            {t("elevenLabsKey")}
            <input
              type={showKey ? "text" : "password"}
              value={settings.elevenLabsKey ?? ""}
              onChange={(event) => onChange({ elevenLabsKey: event.target.value })}
              autoComplete="off"
            />
          </label>
        ) : null}
        {settings.ttsMode === "fish" ? (
          <>
            <label>
              {t("fishKey")}
              <input
                type={showKey ? "text" : "password"}
                value={settings.fishKey ?? ""}
                onChange={(event) => onChange({ fishKey: event.target.value })}
                autoComplete="off"
              />
            </label>
            <label>
              {t("fishModel")}
              <input
                value={settings.fishModel ?? "s2.1-pro"}
                onChange={(event) => onChange({ fishModel: event.target.value.trim() || undefined })}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}
        {settings.ttsMode === "chatterbox" ? (
          <>
            <label>
              {t("chatterboxBaseUrl")}
              <input
                value={settings.chatterboxBaseUrl ?? ""}
                placeholder="http://127.0.0.1:8000"
                onChange={(event) => onChange({ chatterboxBaseUrl: event.target.value.trim() || undefined })}
                autoComplete="off"
              />
            </label>
            <label>
              {t("chatterboxModel")}
              <input
                value={settings.chatterboxModel ?? "chatterbox-turbo"}
                onChange={(event) => onChange({ chatterboxModel: event.target.value.trim() || undefined })}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}
        {settings.ttsMode && settings.ttsMode !== "browser" ? (
          <>
            <label>
              {t("ttsVoiceId")}
              {ttsVoices.length > 0 ? (
                <select
                  value={settings.ttsVoiceId || settings.xaiVoiceId || ""}
                  onChange={(event) => onChange({ ttsVoiceId: event.target.value || undefined, xaiVoiceId: event.target.value || undefined })}
                >
                  <option value="">—</option>
                  {ttsVoices.map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={settings.ttsVoiceId || settings.xaiVoiceId || ""}
                  placeholder="voice id"
                  onChange={(event) => onChange({ ttsVoiceId: event.target.value.trim() || undefined, xaiVoiceId: event.target.value.trim() || undefined })}
                  autoComplete="off"
                />
              )}
            </label>
            <button
              type="button"
              onClick={() => {
                const provider = (settings.ttsMode === "browser" ? "xai" : settings.ttsMode) as TtsProvider;
                const key =
                  provider === "xai"
                    ? settings.apiKey
                    : provider === "elevenlabs"
                      ? settings.elevenLabsKey
                      : provider === "fish"
                        ? settings.fishKey
                        : undefined;
                void harnessTtsVoices(provider, { key, baseUrl: settings.chatterboxBaseUrl })
                  .then((result) => {
                    setTtsVoices(result.voices);
                    setTtsVoiceError("");
                    if (!settings.ttsVoiceId && result.voices[0]) {
                      onChange({ ttsVoiceId: result.voices[0].id, xaiVoiceId: result.voices[0].id });
                    }
                  })
                  .catch((error) => setTtsVoiceError(error instanceof Error ? error.message : String(error)));
              }}
            >
              {t("ttsRefreshVoices")}
            </button>
            {ttsVoiceError ? <p className="hint">{ttsVoiceError}</p> : null}
          </>
        ) : null}
        <h3>{t("decisionModel")}</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(settings.decisionEnabled)}
            onChange={(event) => onChange({ decisionEnabled: event.target.checked })}
          />
          {t("decisionEnabled")}
        </label>
        <label>
          {t("decisionProvider")}
          <select
            value={settings.decisionProvider ?? "openrouter"}
            onChange={(event) => onChange({ decisionProvider: event.target.value as Settings["decisionProvider"] })}
          >
            <option value="openrouter">{t("decisionProviderOpenrouter")}</option>
            <option value="typesafe">{t("decisionProviderTypesafe")}</option>
          </select>
        </label>
        <label>
          {t("decisionModelId")}
          <input
            value={settings.decisionModel ?? "typesafe/jev-1.13"}
            onChange={(event) => onChange({ decisionModel: event.target.value.trim() || undefined })}
            autoComplete="off"
          />
        </label>
        <label>
          {t("decisionKey")}
          <input
            type={showKey ? "text" : "password"}
            value={settings.decisionKey ?? ""}
            onChange={(event) => onChange({ decisionKey: event.target.value })}
            autoComplete="off"
          />
        </label>
        <p className="hint">{t("decisionKeyHint")}</p>
        <button
          type="button"
          onClick={() => {
            void testDecisionModel(settings).then((result) => {
              if (!result.ok) setDecisionTest(`${t("decisionTestFail")} ${result.detail}`);
              else {
                const slow = result.ms > 1500 ? ` ${t("decisionTestSlow")}` : "";
                setDecisionTest(`${t("decisionTestOk")} ${result.ms}ms · ${result.detail}.${slow}`);
              }
            });
          }}
        >
          {t("decisionTest")}
        </button>
        {decisionTest ? <p className="hint">{decisionTest}</p> : null}
        <label className="check">
          <input
            type="checkbox"
            checked={settings.attachWorkScreenshots !== false}
            onChange={(event) => onChange({ attachWorkScreenshots: event.target.checked })}
          />
          {t("attachWorkScreenshots")}
        </label>
        <h3>{t("testStack")}</h3>
        <p className="measure">{t("testStackHint")}</p>
        <label>
          {t("testProfileDefault")}
          <select
            value={settings.defaultTestProfile ?? ""}
            onChange={(event) => {
              const value = event.target.value as TestProfileId | "";
              if (!value) onChange({ defaultTestProfile: undefined });
              else onApplyDefaultTestProfile(value);
            }}
          >
            <option value="">{t("useDefaultModel")}</option>
            {TEST_PROFILE_IDS.map((id) => (
              <option key={id} value={id}>
                {t(profileLabelKey(id))}
              </option>
            ))}
          </select>
        </label>
        <ul className="profile-readiness">
          {TEST_PROFILE_IDS.map((id) => {
            const status = profileReadiness(id, settings, drivers);
            return (
              <li key={id}>
                <strong>{t(profileLabelKey(id))}</strong>
                <span>{status.ready ? t("testProfileReady") : status.missing.map((key) => t(key as Key)).join(" · ")}</span>
                <button type="button" onClick={() => onApplyDefaultTestProfile(id)}>
                  {t("testProfileApplyDefault")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <h2>{t("lock")}</h2>
      <p className="measure">{t("pinHint")}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSavePin(pin);
          setPin("");
        }}
      >
        <label>
          {t("pin")}
          <input value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" autoComplete="off" />
        </label>
        <div className="actions">
          <button type="submit">{t("savePin")}</button>
          <button type="button" onClick={onPasskey}>
            {t("passkey")}
          </button>
          <button type="button" onClick={onLockNow} disabled={!settings.lockEnabled}>
            {t("lockNow")}
          </button>
          <button type="button" onClick={onClearLock} disabled={!settings.lockEnabled}>
            {t("disableLock")}
          </button>
        </div>
      </form>
      {settings.credentialId ? <p>{t("passkeyOn")}</p> : null}

      <h2>{t("install")}</h2>
      <p className="measure">{canInstall ? t("installReady") : t("installLater")}</p>
      <button type="button" onClick={onInstall} disabled={!canInstall}>
        {t("install")}
      </button>

      <h2>{t("errors")}</h2>
      {logs.length === 0 ? <p>{t("noErrors")}</p> : null}
      <ul className="plain">
        {logs.map((item) => (
          <li key={item.id}>
            <span>
              <time dateTime={new Date(item.at).toISOString()}>{when.format(item.at)}</time> {item.message}
            </span>
          </li>
        ))}
      </ul>

      <h2>{t("erase")}</h2>
      <button type="button" className="danger" onClick={onErase}>
        {t("erase")}
      </button>
    </div>
  );
}

export function LockScreen({
  t,
  hasPin,
  hasPasskey,
  error,
  onPin,
  onPasskey,
}: {
  t: Copy;
  hasPin: boolean;
  hasPasskey: boolean;
  error: string;
  onPin: (pin: string) => void;
  onPasskey: () => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <main className="lock">
      <h1>Sandbench</h1>
      <p>{t("lockedLead")}</p>
      {hasPin ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            onPin(pin);
          }}
        >
          <label>
            {t("pin")}
            <input value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" autoComplete="off" />
          </label>
          <button type="submit" className="primary">
            {t("unlock")}
          </button>
        </form>
      ) : null}
      {hasPasskey ? (
        <button type="button" onClick={onPasskey}>
          {t("passkey")}
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
