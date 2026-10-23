import { useEffect, useRef, useState } from "react";
import { BotMark } from "./bots";
import { getBlob } from "./db";
import { connectorHeaders, harnessProbe, harnessProcesses, harnessScreen, type HarnessHealth, type ProcessReport } from "./harness";
import type { Key } from "./i18n";
import type { Bot, BotFile, ComputerEvent, Connector, Plugin, Routine, Secret, Studio, Thread } from "./types";
import {
  applyMigration,
  applyTeam,
  BUILTIN_PLUGINS,
  parseMigrationJson,
  parseTeamJson,
  TEMPLATES,
  openMausTeamFromMarkdown,
  teamFromMarkdown,
  teamToJson,
  teamToMarkdown,
  type BotTemplate,
  type MigrationApply,
  type MigrationPackage,
  type TeamApply,
  type TeamPackage,
} from "./work";

type Copy = (key: Key) => string;

export function ComputerPanel({
  t,
  bot,
  working,
  computer,
  health,
}: {
  t: Copy;
  bot: Bot;
  working: boolean;
  computer: ComputerEvent[];
  health: HarnessHealth | null;
}) {
  const [watching, setWatching] = useState(false);
  const [frame, setFrame] = useState("");
  const [report, setReport] = useState<ProcessReport | null>(null);
  const [error, setError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!health) {
      setReport(null);
      return;
    }
    let active = true;
    const tick = () => {
      void harnessProcesses()
        .then((next) => {
          if (active) setReport(next);
        })
        .catch(() => undefined);
    };
    tick();
    const handle = window.setInterval(tick, 5000);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [health]);

  useEffect(() => {
    if (!watching || !health) return;
    let active = true;
    let current = "";
    const tick = async () => {
      try {
        const blob = await harnessScreen();
        if (!active) return;
        const next = URL.createObjectURL(blob);
        if (current) URL.revokeObjectURL(current);
        current = next;
        setFrame(next);
        setError("");
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void tick();
    const handle = window.setInterval(() => void tick(), working ? 1500 : 3000);
    return () => {
      active = false;
      window.clearInterval(handle);
      if (current) URL.revokeObjectURL(current);
      setFrame("");
    };
  }, [watching, health, working]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    if (!stream) return;
    const [track] = stream.getVideoTracks();
    const onEnd = () => setStream(null);
    track?.addEventListener("ended", onEnd);
    return () => track?.removeEventListener("ended", onEnd);
  }, [stream]);

  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);

  const mine = computer.filter((event) => event.botId === bot.id);
  return (
    <section className="computer-panel">
      <h3>{t("computer")}</h3>
      <p className={health ? "status on" : "status"}>
        <i className={health ? "dot live" : "dot"} />
        {health ? `${t("harnessOn")} · ${health.host}` : t("harnessOff")}
      </p>
      {!health ? <p className="hint">{t("harnessHint")}</p> : null}
      <p>{working ? t("usingComputer") : t("computerIdle")}</p>
      <div className="row-actions">
        {health ? (
          <button type="button" aria-pressed={watching} onClick={() => setWatching((value) => !value)}>
            {watching ? t("stopWatching") : t("watchScreen")}
          </button>
        ) : null}
        {"getDisplayMedia" in (navigator.mediaDevices ?? {}) ? (
          <button
            type="button"
            onClick={() => {
              if (stream) {
                stream.getTracks().forEach((track) => track.stop());
                setStream(null);
                return;
              }
              void navigator.mediaDevices
                .getDisplayMedia({ video: true, audio: false })
                .then(setStream)
                .catch(() => undefined);
            }}
          >
            {stream ? t("stopWatching") : t("shareScreen")}
          </button>
        ) : null}
      </div>
      {watching && frame ? (
        <figure className="screen">
          <img src={frame} alt={t("screenOf")} />
          <figcaption>{t("screenOf")} · {health?.host}</figcaption>
        </figure>
      ) : null}
      {stream ? (
        <figure className="screen">
          <video ref={videoRef} autoPlay muted playsInline />
        </figure>
      ) : null}
      {error ? <p className="hint">{error}</p> : null}
      {report ? (
        <div className="usage-real">
          <p>
            <span>{t("cpuNow")}</span>
            <span className="meter" aria-hidden="true"><span style={{ width: `${report.cpu}%` }} /></span>
            <span>{report.cpu}%</span>
          </p>
          <p>
            <span>{t("memory")}</span>
            <span className="meter" aria-hidden="true"><span style={{ width: `${Math.round((100 * report.memUsed) / report.memTotal)}%` }} /></span>
            <span>{(report.memUsed / 1024).toFixed(1)} / {(report.memTotal / 1024).toFixed(0)} GB</span>
          </p>
          <details>
            <summary>{t("topProcesses")}</summary>
            <table className="proc-table">
              <thead>
                <tr><th>{t("name")}</th><th>{t("cpuSeconds")}</th><th>MB</th></tr>
              </thead>
              <tbody>
                {report.list.map((item, index) => (
                  <tr key={`${item.name}-${index}`}><td>{item.name}</td><td>{item.cpu}</td><td>{item.mem}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}
      <ol className="action-log">
        {mine.map((event) => (
          <li key={event.id}>
            <i className={working ? "dot live" : "dot"} />
            <div>
              <strong>{event.app}</strong>
              <span>{event.action}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AvatarEditor({ t, bot, onPatch }: { t: Copy; bot: Bot; onPatch: (patch: Partial<Bot>) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="avatar-editor">
      <BotMark bot={bot} size="3.2rem" />
      <button type="button" onClick={() => inputRef.current?.click()}>{t("uploadAvatar")}</button>
      {bot.avatar ? <button type="button" onClick={() => onPatch({ avatar: undefined })}>{t("removeAvatar")}</button> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void squareThumb(file, 160).then((avatar) => onPatch({ avatar }));
        }}
      />
    </div>
  );
}

async function squareThumb(file: Blob, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function LibraryPanel({
  t,
  files,
  onAdd,
  onRemove,
}: {
  t: Copy;
  files: BotFile[];
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [viewing, setViewing] = useState<BotFile | null>(null);
  return (
    <section>
      <h3>{t("files")}</h3>
      <button type="button" onClick={() => inputRef.current?.click()}>{t("addFiles")}</button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) onAdd(event.target.files);
          event.target.value = "";
        }}
      />
      {files.length === 0 ? <p className="hint">{t("noFiles")}</p> : null}
      <ul className="file-list">
        {files.map((file) => (
          <li key={file.id}>
            <button type="button" className="text-btn" onClick={() => setViewing(file)}>{file.name}</button>
            <small>{formatBytes(file.size)}</small>
            <button type="button" onClick={() => onRemove(file.id)}>{t("remove")}</button>
          </li>
        ))}
      </ul>
      {viewing ? <FileViewer t={t} file={viewing} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FileViewer({ t, file, onClose }: { t: Copy; file: BotFile; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let current = "";
    void getBlob(file.id).then(async (blob) => {
      if (!blob || !active) return;
      if (/^text\/|json|xml|javascript|typescript|markdown|csv/.test(file.mime) || /\.(md|txt|ts|tsx|js|json|csv|log|py|ps1)$/i.test(file.name)) {
        const value = await blob.text();
        if (active) setText(value.slice(0, 200_000));
        return;
      }
      current = URL.createObjectURL(blob);
      setUrl(current);
    });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [file]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={file.name}>
      <header>
        <strong>{file.name}</strong>
        <button type="button" onClick={onClose}>{t("close")}</button>
      </header>
      <div className="viewer-body">
        {text !== null ? <pre>{text}</pre> : null}
        {url && file.mime.startsWith("image/") ? <img src={url} alt={file.name} /> : null}
        {url && file.mime === "application/pdf" ? <iframe src={url} title={file.name} /> : null}
        {url && file.mime.startsWith("audio/") ? <audio controls src={url} /> : null}
        {url && file.mime.startsWith("video/") ? <video controls src={url} /> : null}
        {url && !/^(image|audio|video)\/|application\/pdf/.test(file.mime) ? (
          <a href={url} download={file.name}>{t("open")}</a>
        ) : null}
      </div>
    </div>
  );
}

type HubTab = "templates" | "plugins" | "connectors" | "secrets" | "review" | "usage";

export function HubPanel({
  t,
  bots,
  bot,
  studio,
  onStudio,
  onPatchBot,
  onAddBots,
  onNotice,
  harnessReady,
  channels,
  routines,
  onImportTeam,
  onImportMigration,
}: {
  t: Copy;
  bots: Bot[];
  bot: Bot | null;
  studio: Studio;
  onStudio: (patch: Partial<Studio>) => void;
  onPatchBot: (id: string, patch: Partial<Bot>) => void;
  onAddBots: (bots: Bot[] | BotTemplate[]) => void;
  onNotice: (message: string) => void;
  harnessReady: boolean;
  channels: Thread[];
  routines: Routine[];
  onImportTeam: (team: TeamApply) => void;
  onImportMigration: (pack: MigrationApply) => void;
}) {
  const [tab, setTab] = useState<HubTab>("templates");
  const plugins = [...BUILTIN_PLUGINS, ...studio.plugins];
  const tabs: { id: HubTab; label: Key }[] = [
    { id: "templates", label: "templates" },
    { id: "plugins", label: "plugins" },
    { id: "connectors", label: "connectors" },
    { id: "secrets", label: "secrets" },
    { id: "review", label: "autoReview" },
    { id: "usage", label: "usage" },
  ];
  return (
    <div className="hub">
      <h2>{t("hub")}</h2>
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {t(item.label)}
          </button>
        ))}
      </div>
      {tab === "templates" ? (
        <TemplatesTab
          t={t}
          bots={bots}
          plugins={plugins}
          connectors={studio.connectors}
          channels={channels}
          routines={routines}
          onAddBots={onAddBots}
          onImportTeam={onImportTeam}
          onImportMigration={onImportMigration}
          onNotice={onNotice}
        />
      ) : null}
      {tab === "plugins" ? <PluginsTab t={t} bot={bot} plugins={plugins} studio={studio} onStudio={onStudio} onPatchBot={onPatchBot} /> : null}
      {tab === "connectors" ? (
        <ConnectorsTab t={t} bot={bot} studio={studio} onStudio={onStudio} onPatchBot={onPatchBot} harnessReady={harnessReady} />
      ) : null}
      {tab === "secrets" ? <SecretsTab t={t} secrets={studio.secrets} onChange={(secrets) => onStudio({ secrets })} /> : null}
      {tab === "review" ? <ReviewTab t={t} studio={studio} onStudio={onStudio} /> : null}
      {tab === "usage" ? <UsageTab t={t} studio={studio} onStudio={onStudio} /> : null}
    </div>
  );
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TemplatesTab({
  t,
  bots,
  plugins,
  connectors,
  channels,
  routines,
  onAddBots,
  onImportTeam,
  onImportMigration,
  onNotice,
}: {
  t: Copy;
  bots: Bot[];
  plugins: Plugin[];
  connectors: Connector[];
  channels: Thread[];
  routines: Routine[];
  onAddBots: (bots: Bot[] | BotTemplate[]) => void;
  onImportTeam: (team: TeamApply) => void;
  onImportMigration: (pack: MigrationApply) => void;
  onNotice: (message: string) => void;
}) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const openMausRef = useRef<HTMLInputElement | null>(null);
  const jsonRef = useRef<HTMLInputElement | null>(null);
  const migrationRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<TeamPackage | null>(null);
  const [migrationPreview, setMigrationPreview] = useState<MigrationPackage | null>(null);
  const sections: { key: Key; names: string[] }[] = preview
    ? [
        { key: "teamBots", names: preview.bots.map((item) => item.name) },
        { key: "teamChannels", names: preview.channels.map((item) => `# ${item.name}`) },
        { key: "teamRoutines", names: preview.routines.map((item) => `${item.title} · ${item.schedule}`) },
        { key: "teamConnectors", names: preview.connectors.map((item) => `${item.name}${item.headerKeys.length ? ` (${item.headerKeys.join(", ")})` : ""}`) },
        { key: "teamPlugins", names: preview.plugins.map((item) => item.name) },
      ]
    : [];
  const migrationSections: { key: Key; names: string[] }[] = migrationPreview
    ? [
        { key: "teamBots", names: migrationPreview.bots.map((item) => item.name) },
        { key: "teamChannels", names: migrationPreview.channels.map((item) => `# ${item.name}`) },
        { key: "teamRoutines", names: migrationPreview.routines.map((item) => `${item.title} · ${item.schedule}`) },
        { key: "teamConnectors", names: migrationPreview.connectors.map((item) => `${item.name}${item.headerKeys.length ? ` (${item.headerKeys.join(", ")})` : ""}`) },
        { key: "teamPlugins", names: migrationPreview.plugins.map((item) => item.name) },
        ...(migrationPreview.threads?.length
          ? [{ key: "migrationThreads" as Key, names: migrationPreview.threads.map((item) => `${item.title} (${item.messages.length})`) }]
          : []),
        ...(migrationPreview.webhooks?.length
          ? [{ key: "migrationWebhooks" as Key, names: migrationPreview.webhooks.map((item) => item.title) }]
          : []),
      ]
    : [];
  return (
    <div className="stack">
      <ul className="template-grid">
        {TEMPLATES.map((template) => (
          <li key={template.id}>
            <BotMark bot={{ name: template.name, color: template.color, shape: template.shape }} size="2.4rem" />
            <strong>{template.name}</strong>
            <span>{template.role}</span>
            <small>{template.instructions}</small>
            <button type="button" onClick={() => onAddBots([template])}>{t("useTemplate")}</button>
          </li>
        ))}
      </ul>
      <h3>{t("share")}</h3>
      <p className="hint">{t("shareNote")}</p>
      <div className="row-actions">
        <button
          type="button"
          onClick={() => download("sandbench-team.json", teamToJson({ bots, plugins, connectors, channels, routines }), "application/json")}
        >
          {t("exportTeamJson")}
        </button>
        <button type="button" onClick={() => jsonRef.current?.click()}>{t("importTeamJson")}</button>
        <button type="button" onClick={() => migrationRef.current?.click()}>{t("importMigrationJson")}</button>
        <input
          ref={jsonRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.text().then((raw) => {
              const pack = parseTeamJson(raw);
              if (!pack) {
                onNotice(t("teamBadFile"));
                return;
              }
              setMigrationPreview(null);
              setPreview(pack);
            });
          }}
        />
        <input
          ref={migrationRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.text().then((raw) => {
              const pack = parseMigrationJson(raw);
              if (!pack) {
                onNotice(t("migrationBadFile"));
                return;
              }
              setPreview(null);
              setMigrationPreview(pack);
            });
          }}
        />
        <button type="button" onClick={() => download("sandbench-team.md", teamToMarkdown(bots, plugins), "text/markdown")}>
          {t("exportTeam")}
        </button>
        <button type="button" onClick={() => importRef.current?.click()}>{t("importTeam")}</button>
        <button type="button" onClick={() => openMausRef.current?.click()}>{t("importOpenMausMd")}</button>
        <input
          ref={importRef}
          type="file"
          accept=".md,text/markdown,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.text().then((text) => {
              const next = teamFromMarkdown(text, plugins);
              if (next.length === 0) return;
              onAddBots(next);
              onNotice(`${t("imported")}: ${next.map((item) => item.name).join(", ")}`);
            });
          }}
        />
        <input
          ref={openMausRef}
          type="file"
          accept=".md,text/markdown,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.text().then((text) => {
              const pack = openMausTeamFromMarkdown(text);
              if (pack.bots.length === 0) {
                onNotice(t("importOpenMausHint"));
                return;
              }
              if (pack.bots.length > 1 && pack.channelTitle) {
                onImportTeam({
                  bots: pack.bots,
                  plugins: [],
                  connectors: [],
                  channels: [
                    {
                      id: crypto.randomUUID(),
                      title: pack.channelTitle,
                      memberIds: pack.bots.map((bot) => bot.id),
                      sharedInstructions: pack.sharedInstructions,
                      autoRoute: true,
                      updatedAt: Date.now(),
                      messages: [],
                    },
                  ],
                  routines: [],
                });
              } else {
                onAddBots(pack.bots);
              }
              onNotice(`${t("imported")}: ${pack.bots.map((item) => item.name).join(", ")}`);
            });
          }}
        />
      </div>
      {preview ? (
        <section className="team-preview" aria-label={t("teamPreview")}>
          <strong>{t("teamPreview")}</strong>
          {sections
            .filter((section) => section.names.length > 0)
            .map((section) => (
              <div key={section.key}>
                <span>{t(section.key)} ({section.names.length})</span>
                <ul>
                  {section.names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
                </ul>
              </div>
            ))}
          <p className="hint">{t("teamRoutinesPaused")}</p>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                onImportTeam(applyTeam(preview, plugins));
                onNotice(`${t("imported")}: ${preview.bots.map((item) => item.name).join(", ")}`);
                setPreview(null);
              }}
            >
              {t("applyTeam")}
            </button>
            <button type="button" onClick={() => setPreview(null)}>{t("cancel")}</button>
          </div>
        </section>
      ) : null}
      {migrationPreview ? (
        <section className="team-preview" aria-label={t("migrationPreview")}>
          <strong>{t("migrationPreview")}</strong>
          {migrationPreview.source?.app ? <p className="hint">{t("migrationSource")}: {migrationPreview.source.app}{migrationPreview.source.version ? ` ${migrationPreview.source.version}` : ""}</p> : null}
          {migrationSections
            .filter((section) => section.names.length > 0)
            .map((section) => (
              <div key={section.key}>
                <span>{t(section.key)} ({section.names.length})</span>
                <ul>
                  {section.names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
                </ul>
              </div>
            ))}
          <p className="hint">{t("teamRoutinesPaused")}</p>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                onImportMigration(applyMigration(migrationPreview, plugins));
                onNotice(`${t("imported")}: ${migrationPreview.bots.map((item) => item.name).join(", ")}`);
                setMigrationPreview(null);
              }}
            >
              {t("applyMigration")}
            </button>
            <button type="button" onClick={() => setMigrationPreview(null)}>{t("cancel")}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PluginsTab({
  t,
  bot,
  plugins,
  studio,
  onStudio,
  onPatchBot,
}: {
  t: Copy;
  bot: Bot | null;
  plugins: Plugin[];
  studio: Studio;
  onStudio: (patch: Partial<Studio>) => void;
  onPatchBot: (id: string, patch: Partial<Bot>) => void;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const owned = bot?.plugins ?? [];
  return (
    <div className="stack">
      <ul className="plugin-list">
        {plugins.map((plugin) => {
          const on = owned.includes(plugin.id);
          return (
            <li key={plugin.id}>
              <div>
                <strong>{plugin.name}</strong>
                <span>{plugin.summary}</span>
              </div>
              {bot ? (
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPatchBot(bot.id, { plugins: on ? owned.filter((id) => id !== plugin.id) : [...owned, plugin.id] })}
                >
                  {on ? `${t("installed")} · ${bot.name}` : `${t("installPlugin")} · ${bot.name}`}
                </button>
              ) : null}
              {!plugin.builtIn ? (
                <button type="button" onClick={() => onStudio({ plugins: studio.plugins.filter((item) => item.id !== plugin.id) })}>{t("uninstall")}</button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !instructions.trim()) return;
          onStudio({
            plugins: [...studio.plugins, { id: crypto.randomUUID(), name: name.trim(), summary: summary.trim(), instructions: instructions.trim(), builtIn: false }],
          });
          setName("");
          setSummary("");
          setInstructions("");
        }}
      >
        <h3>{t("newPlugin")}</h3>
        <label>{t("pluginName")}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t("pluginSummary")}<input value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>{t("pluginInstructions")}<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <button type="submit">{t("add")}</button>
      </form>
    </div>
  );
}

function ConnectorsTab({
  t,
  bot,
  studio,
  onStudio,
  onPatchBot,
  harnessReady,
}: {
  t: Copy;
  bot: Bot | null;
  studio: Studio;
  onStudio: (patch: Partial<Studio>) => void;
  onPatchBot: (id: string, patch: Partial<Bot>) => void;
  harnessReady: boolean;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headerKey, setHeaderKey] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [busy, setBusy] = useState("");
  const owned = bot?.connectorIds ?? [];

  async function test(connector: Connector) {
    setBusy(connector.id);
    const headers = connectorHeaders(connector, studio.secrets);
    let next: Connector;
    try {
      const probe = await harnessProbe(connector.url, headers);
      next = { ...connector, status: "ok", serverName: probe.server?.name ?? "", tools: probe.tools, error: "", checkedAt: Date.now() };
    } catch (caught) {
      next = { ...connector, status: "failed", error: caught instanceof Error ? caught.message : String(caught), checkedAt: Date.now() };
    }
    onStudio({ connectors: studio.connectors.map((item) => (item.id === connector.id ? next : item)) });
    setBusy("");
  }

  return (
    <div className="stack">
      {!harnessReady ? <p className="hint">{t("harnessHint")}</p> : null}
      <ul className="plugin-list">
        {studio.connectors.map((connector) => (
          <li key={connector.id}>
            <div>
              <strong>{connector.name}</strong>
              <span>{connector.url}</span>
              <small className={`conn-${connector.status}`}>
                {connector.status === "ok"
                  ? `${t("connectorOk")} · ${connector.serverName || ""} · ${connector.tools.length} ${t("toolsFound")}`
                  : connector.status === "failed"
                    ? `${t("connectorFailed")}: ${connector.error}`
                    : t("connectorUntested")}
              </small>
              {connector.tools.length > 0 ? (
                <details>
                  <summary>{connector.tools.length} {t("toolsFound")}</summary>
                  <ul>{connector.tools.map((tool) => <li key={tool.name}><code>{tool.name}</code> {tool.description}</li>)}</ul>
                </details>
              ) : null}
            </div>
            <button type="button" disabled={!harnessReady || busy === connector.id} onClick={() => void test(connector)}>
              {busy === connector.id ? "…" : t("testConnector")}
            </button>
            {bot ? (
              <button
                type="button"
                aria-pressed={owned.includes(connector.id)}
                onClick={() =>
                  onPatchBot(bot.id, {
                    connectorIds: owned.includes(connector.id) ? owned.filter((id) => id !== connector.id) : [...owned, connector.id],
                  })
                }
              >
                {owned.includes(connector.id) ? `${t("installed")} · ${bot.name}` : t("attachConnector")}
              </button>
            ) : null}
            <button type="button" onClick={() => onStudio({ connectors: studio.connectors.filter((item) => item.id !== connector.id) })}>{t("remove")}</button>
          </li>
        ))}
      </ul>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !/^https?:\/\//.test(url.trim())) return;
          const value = headerValue.trim();
          const placeholder = /^\{\{\s*[A-Z0-9_]+\s*\}\}$/.test(value) || !value;
          const secretName = `${name.trim()}_${headerKey.trim()}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
          const connector: Connector = {
            id: crypto.randomUUID(),
            name: name.trim(),
            url: url.trim(),
            headers: value ? [{ key: headerKey.trim(), value: placeholder ? value : `{{${secretName}}}` }] : [],
            status: "untested",
            serverName: "",
            tools: [],
            error: "",
            checkedAt: 0,
          };
          const secrets = placeholder
            ? studio.secrets
            : [...studio.secrets.filter((item) => item.name !== secretName), { id: crypto.randomUUID(), name: secretName, value, createdAt: Date.now() }];
          onStudio({ connectors: [...studio.connectors, connector], secrets });
          setName("");
          setUrl("");
          setHeaderValue("");
        }}
      >
        <h3>{t("addConnector")}</h3>
        <label>{t("connectorName")}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t("connectorUrl")}<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>
        <div className="row-form">
          <input value={headerKey} onChange={(event) => setHeaderKey(event.target.value)} aria-label={t("headerKey")} />
          <input type="password" value={headerValue} onChange={(event) => setHeaderValue(event.target.value)} aria-label={t("headerValue")} placeholder={t("headerValue")} autoComplete="off" />
        </div>
        <p className="hint">{t("headerSecretNote")}</p>
        <button type="submit">{t("add")}</button>
      </form>
      <ComposioPreset t={t} studio={studio} onStudio={onStudio} />
    </div>
  );
}

const COMPOSIO_CARDS = [
  { id: "github", name: "GitHub", note: "Repos, issues, PRs", path: "/github" },
  { id: "gmail", name: "Gmail", note: "OAuth in Composio Connect", path: "/gmail" },
  { id: "slack", name: "Slack", note: "OAuth in Composio Connect", path: "/slack" },
  { id: "notion", name: "Notion", note: "Pages and databases", path: "/notion" },
  { id: "linear", name: "Linear", note: "Issues and projects", path: "/linear" },
] as const;

function ComposioPreset({ t, studio, onStudio }: { t: Copy; studio: Studio; onStudio: (patch: Partial<Studio>) => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const configured = studio.secrets.some((item) => item.name === "COMPOSIO_KEY");

  function addConnector(name: string, mcpUrl: string, apiKey: string) {
    if (!/^https:\/\//.test(mcpUrl.trim()) || (!apiKey.trim() && !configured)) return;
    const connector: Connector = {
      id: crypto.randomUUID(),
      name,
      url: mcpUrl.trim(),
      headers: [{ key: "x-api-key", value: "{{COMPOSIO_KEY}}" }],
      status: "untested",
      serverName: "",
      tools: [],
      error: "",
      checkedAt: 0,
    };
    const secrets = apiKey.trim()
      ? [...studio.secrets.filter((item) => item.name !== "COMPOSIO_KEY"), { id: crypto.randomUUID(), name: "COMPOSIO_KEY", value: apiKey.trim(), createdAt: Date.now() }]
      : studio.secrets;
    onStudio({ connectors: [...studio.connectors, connector], secrets });
  }

  return (
    <div className="stack">
      <h3>{t("composioMarketplace")}</h3>
      <p className="hint">{t("composioOauthNote")}</p>
      <div className="composio-cards">
        {COMPOSIO_CARDS.map((card) => (
          <div key={card.id} className="composio-card">
            <strong>{card.name}</strong>
            <p>{card.note}</p>
            <button
              type="button"
              disabled={!configured && !key.trim()}
              onClick={() => {
                const base = url.trim().replace(/\/+$/, "") || "https://mcp.composio.dev";
                addConnector(`Composio · ${card.name}`, `${base}${card.path}`, key);
              }}
            >
              {t("composioAddCard")} {card.name}
            </button>
          </div>
        ))}
      </div>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          addConnector(t("composio"), url, key);
          setUrl("");
          setKey("");
        }}
      >
        <h3>{t("composio")}</h3>
        <p className="hint">{t("composioNote")}</p>
        <label>{t("composioUrl")}<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" autoComplete="off" /></label>
        <label>
          {t("composioKey")}
          <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={configured ? t("secretConfigured") : ""} autoComplete="off" />
        </label>
        <button type="submit">{t("addComposio")}</button>
      </form>
    </div>
  );
}

function SecretsTab({ t, secrets, onChange }: { t: Copy; secrets: Secret[]; onChange: (secrets: Secret[]) => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  return (
    <div className="stack">
      <p className="hint">{t("secretNote")}</p>
      <ul className="plugin-list">
        {secrets.map((secret) => (
          <li key={secret.id}>
            <div>
              <strong><code>{secret.name}</code></strong>
              <span>{t("secretConfigured")}</span>
            </div>
            <button type="button" onClick={() => { setName(secret.name); setValue(""); }}>{t("replaceSecret")}</button>
            <button type="button" onClick={() => onChange(secrets.filter((item) => item.id !== secret.id))}>{t("remove")}</button>
          </li>
        ))}
      </ul>
      <form
        className="row-form"
        onSubmit={(event) => {
          event.preventDefault();
          const key = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
          if (!key || !value) return;
          onChange([...secrets.filter((item) => item.name !== key), { id: crypto.randomUUID(), name: key, value, createdAt: Date.now() }]);
          setName("");
          setValue("");
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} aria-label={t("secretName")} placeholder={t("secretName")} />
        <input type="password" value={value} onChange={(event) => setValue(event.target.value)} aria-label={t("secretValue")} placeholder={t("secretValue")} autoComplete="off" />
        <button type="submit">{t("add")}</button>
      </form>
    </div>
  );
}

function ReviewTab({ t, studio, onStudio }: { t: Copy; studio: Studio; onStudio: (patch: Partial<Studio>) => void }) {
  const [rule, setRule] = useState("");
  return (
    <div className="stack">
      <p className="hint">{t("autoReviewNote")}</p>
      <ul className="chip-list">
        {studio.autoApprove.map((item) => (
          <li key={item}>
            <code>{item}</code>
            <button type="button" aria-label={`${t("remove")} ${item}`} onClick={() => onStudio({ autoApprove: studio.autoApprove.filter((entry) => entry !== item) })}>×</button>
          </li>
        ))}
      </ul>
      <form
        className="row-form"
        onSubmit={(event) => {
          event.preventDefault();
          const next = rule.trim().split(/\s+/)[0];
          if (!next || studio.autoApprove.includes(next)) return;
          onStudio({ autoApprove: [...studio.autoApprove, next] });
          setRule("");
        }}
      >
        <input value={rule} onChange={(event) => setRule(event.target.value)} aria-label={t("addRule")} placeholder="Get-Content" />
        <button type="submit">{t("addRule")}</button>
      </form>
      <fieldset className="stack">
        <legend>{t("unattended")}</legend>
        <label className="check">
          <input type="radio" name="unattended" checked={studio.unattended === "ask"} onChange={() => onStudio({ unattended: "ask" })} />
          {t("unattendedAsk")}
        </label>
        <label className="check">
          <input type="radio" name="unattended" checked={studio.unattended === "skip"} onChange={() => onStudio({ unattended: "skip" })} />
          {t("unattendedSkip")}
        </label>
      </fieldset>
    </div>
  );
}

function UsageTab({ t, studio, onStudio }: { t: Copy; studio: Studio; onStudio: (patch: Partial<Studio>) => void }) {
  const rows: [Key, number][] = [
    ["turns", studio.usage.turns],
    ["charsIn", studio.usage.charsIn],
    ["charsOut", studio.usage.charsOut],
    ["commandsRun", studio.usage.commands],
  ];
  return (
    <div className="stack">
      <p className="hint">{t("usageNote")}</p>
      <dl className="usage-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">{new Date(studio.usage.since).toLocaleString()}</p>
      <button type="button" onClick={() => onStudio({ usage: { turns: 0, charsIn: 0, charsOut: 0, commands: 0, since: Date.now() } })}>{t("resetUsage")}</button>
    </div>
  );
}

export function Onboarding({ t, onPick, onBlank }: { t: Copy; onPick: (templates: BotTemplate[]) => void; onBlank: () => void }) {
  const [picked, setPicked] = useState<string[]>(["operator", "scheduler"]);
  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="onboarding-card">
        <h1 id="welcome-title">{t("welcome")}</h1>
        <p>{t("welcomeBody")}</p>
        <ul className="template-grid">
          {TEMPLATES.map((template) => {
            const on = picked.includes(template.id);
            return (
              <li key={template.id}>
                <button
                  type="button"
                  className={on ? "pick on" : "pick"}
                  aria-pressed={on}
                  onClick={() => setPicked((prev) => (on ? prev.filter((id) => id !== template.id) : [...prev, template.id]))}
                >
                  <BotMark bot={{ name: template.name, color: template.color, shape: template.shape }} size="2.6rem" />
                  <strong>{template.name}</strong>
                  <span>{template.role}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="row-actions">
          <button type="button" className="primary" disabled={picked.length === 0} onClick={() => onPick(TEMPLATES.filter((item) => picked.includes(item.id)))}>
            {t("continue")}
          </button>
          <button type="button" onClick={onBlank}>{t("startBlank")}</button>
        </div>
      </div>
    </div>
  );
}
