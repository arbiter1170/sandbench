// The context line under the chat header and its read-only "How this chat runs" sheet (UX P1).
// The sheet has no inputs: it reports, and links to the bot's settings for changes.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { contextLine, sheetRows, type Connection, type ContextKey, type MemberAgent, type SheetRow } from "./chatContext";
import type { Thread } from "./types";

type Copy = (key: ContextKey | "ctxDetails" | "ctxSheetTitle" | "ctxOpenSettings" | "ctxCheckAgain" | "ctxRecheckOk" | "ctxRecheckFail" | "ctxRecheckRunnerOk" | "ctxRecheckRunnerFail" | "ctxClose" | "ctxThisChat") => string;

export type ContextSection = { title?: string; rows: SheetRow[] };
type SheetInput = Parameters<typeof sheetRows>[0];
export type ContextMember = MemberAgent & { sheet: Omit<SheetInput, "connection" | "t" | "agent" | "channel"> };

/** The sheet's contents: one section for a bot chat; shared rows, then one per member, for a group chat. */
export function contextSections(input: { members: ContextMember[]; channel?: Thread; connection: Connection; t: Copy }): ContextSection[] {
  const all = input.members.map((member) => ({
    name: member.name,
    rows: sheetRows({ ...member.sheet, agent: member.agent, channel: input.channel, connection: input.connection, t: input.t }),
  }));
  if (!input.channel || all.length === 0) return all.slice(0, 1).map((item) => ({ rows: item.rows }));
  const shared = new Set(["runsOn", "folder", "closed"]);
  return [
    { title: input.t("ctxThisChat"), rows: all[0].rows.filter((row) => shared.has(row.id)) },
    ...all.map((item) => ({ title: item.name, rows: item.rows.filter((row) => !shared.has(row.id)) })),
  ];
}

export function ChatContext(props: {
  t: Copy;
  members: ContextMember[];
  channel?: Thread;
  /** `log` is the page's live health log; its times are read at each render. */
  connection: Omit<Connection, "now" | "checkedAt" | "lastOkAt"> & { log: { checkedAt?: number; lastOkAt?: number } };
  onOpenSettings?: () => void;
  onRecheck: () => Promise<boolean>;
}) {
  const { t } = props;
  const [open, setOpen] = useState(false);
  // Ages in the sheet ("checked 12 s ago") stay current while it is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const handle = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(handle);
  }, [open]);
  const { log, ...rest } = props.connection;
  const connection: Connection = { ...rest, checkedAt: log.checkedAt, lastOkAt: log.lastOkAt, now };
  const line = contextLine({ members: props.members, channel: props.channel, connection, t });
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const parts = [line.agent, line.folder ? `${line.folderPrefix}${line.folder}` : "", line.connection].filter(Boolean);

  // Focus returns to the line in the effect below, once the page is no longer inert.
  const close = () => {
    setOpen(false);
    setResult("");
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // While the sheet is open: focus moves into it (the user opened it), the rest of the page is
  // inert, and Esc closes it from anywhere, even after a click on its text. Focus then returns
  // to the line.
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const host = dialog.current?.closest(".ctx-backdrop");
    const others = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== host && !node.inert);
    for (const node of others) node.inert = true;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
      for (const node of others) node.inert = false;
      trigger.current?.focus();
    };
  }, [open]);

  // Tab and Shift+Tab stay inside the sheet.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`chat-context ${line.tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${parts.join(", ")}. ${t("ctxDetails")}: ${t("ctxSheetTitle")}`}
        onClick={() => setOpen(true)}
      >
        <span className="ctx-dot" aria-hidden="true">{line.tone === "ok" ? "●" : line.tone === "bad" ? "▲" : "○"}</span>
        <span className="ctx-agent ctx-full">{line.agent}</span>
        {line.short !== line.agent ? <span className="ctx-agent ctx-short">{line.short}</span> : null}
        {line.folder ? <span className="ctx-folder">· {line.folderPrefix ? <span className="ctx-full">{line.folderPrefix}</span> : null}{line.folder}</span> : null}
        <span className="ctx-conn">· {line.connection}</span>
        <span className="ctx-more"><span className="ctx-more-word">{t("ctxDetails")}</span> ›</span>
      </button>
      {open ? createPortal(
        <div className="ctx-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
          <div ref={dialog} className="ctx-sheet" role="dialog" aria-modal="true" aria-labelledby="ctx-sheet-title" tabIndex={-1} onKeyDown={onKeyDown}>
            <header>
              <h2 id="ctx-sheet-title">{t("ctxSheetTitle")}</h2>
              <button type="button" className="text-btn" onClick={close}>{t("ctxClose")}</button>
            </header>
            <p className="ctx-summary">{parts.join(" · ")}</p>
            {contextSections({ members: props.members, channel: props.channel, connection, t }).map((section, index) => (
              <section key={section.title ?? index} aria-label={section.title}>
                {section.title ? <h3>{section.title}</h3> : null}
                <dl>
                  {section.rows.map((row) => (
                    <div key={row.id} className="ctx-row">
                      <dt>{row.label}</dt>
                      <dd>
                        {row.value}
                        {row.badge ? <span className="ctx-badge">{row.badge}</span> : null}
                        {row.detail ? <span className="ctx-detail">{row.detail}</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <footer>
              {props.onOpenSettings ? (
                <button type="button" onClick={() => { const go = props.onOpenSettings!; close(); go(); }}>{t("ctxOpenSettings")}</button>
              ) : null}
              {/* aria-busy rather than disabled: the button keeps focus while the check runs. */}
              <button
                type="button"
                aria-busy={busy}
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  setResult("");
                  void props.onRecheck().then((ok) => {
                    setResult(t(props.connection.runner ? (ok ? "ctxRecheckRunnerOk" : "ctxRecheckRunnerFail") : ok ? "ctxRecheckOk" : "ctxRecheckFail"));
                    setBusy(false);
                  });
                }}
              >
                {t("ctxCheckAgain")}
              </button>
              <span className="ctx-result" role="status" aria-live="polite">{result}</span>
            </footer>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
