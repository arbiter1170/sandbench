// A deterministic chat for the browser layout test (runner/test/ui-layout.test.mjs). It renders
// the real Workspace shell with the real styles and fixed messages: long inline Windows paths
// with spaces, Claude Code "Insight" separators, a long source link, an approval card with wide
// preformatted tool output, and a pending approval. Nothing here is live data: no harness, no
// sign-in, no real machine path. Not part of the app bundle (only this folder's index.html
// imports it).
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { translate, type Key } from "../i18n";
import { Workspace } from "../shell";
import { defaultSettings, defaultStudio, type Bot, type BotTask, type Message, type Reminder, type Routine, type Thread } from "../types";
import { blankBot } from "../work";
import "../styles.css";

const t = (key: Key) => translate("en", key);
const bot: Bot = { ...blankBot("North", "General", true), id: "north", createdAt: 1_700_000_000_000 };
// ?scenario=channel: a group chat with mixed agents, a long folder name and a reachable harness
// (synthetic), for the context line's layout. The default page has no harness.
const channelScenario = new URLSearchParams(location.search).get("scenario") === "channel";
// ?scenario=long (UX P4): F-P4-a, a pending card whose command is one 175-character run with no
// spaces, and F-P4-b, a 60-character Windows path under C:\Users\<you>\. Synthetic.
const longScenario = new URLSearchParams(location.search).get("scenario") === "long";
const members: Bot[] = [
  { ...blankBot("Pip", "Builder", true), id: "pip", createdAt: 1, driver: "claude" },
  { ...blankBot("Moss", "Tester", true), id: "moss", createdAt: 2, driver: "claude" },
  { ...blankBot("Fern", "Writer", true), id: "fern", createdAt: 3 },
];

const WIN_PATH = "C:\\Users\\Some Body\\.sandbench\\workspace";
const LONG_URL = "https://example.test/articles/2026/11/a-rather-long-slug-that-has-no-spaces-anywhere-in-it-so-it-cannot-wrap-by-itself/sandboxed-agent-workbench";
const WIDE_LINE = "The search didn't turn up anything under the exact name; the closest match is a project called Sandboxed Agent Workbench at " + LONG_URL + " and nothing else matched.";

let at = 1_700_000_000_000;
function message(partial: Partial<Message> & Pick<Message, "role" | "text">): Message {
  at += 1000;
  return { id: `m-${at}`, createdAt: at, attachments: [], status: "done", localStandIn: false, fresh: false, authorBotId: partial.role === "assistant" ? bot.id : undefined, ...partial };
}

const messages: Message[] = [
  message({ role: "user", text: "Show me something you can do, try to call some tools or use functionality you have" }),
  message({
    role: "assistant",
    text: [
      "I tried two tools. The first came back empty, and the second is waiting on your permission.",
      "",
      `**File search:** I searched your workspace folder (\`${WIN_PATH}\`) for any files and got no results. My first attempt used a mistyped path (\`.sandbox\`), which I corrected.`,
      "",
      "`★ Insight ─────────────────────────────────────`",
      "Glob matches file names and paths, but it doesn't read file contents. Searching inside files is a separate job for a content-search tool.",
      "`─────────────────────────────────────────────────`",
      "",
      "═══════════════════════════════════════════════════════════",
      "",
      `To see exactly what's in the workspace, including hidden files, I can run a PowerShell listing on your computer: \`Get-ChildItem -Force "${WIN_PATH}\\walklings-team\\notes\\today"\`.`,
      "",
      "```powershell",
      `Get-ChildItem -Force -Recurse "${WIN_PATH}" | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize`,
      "```",
    ].join("\n"),
    thinking: [
      "Hand the turn to Claude Code (local CLI).",
      `Working folder: ${WIN_PATH}`,
      "Claude wants Glob.",
      `Tool error: Directory does not exist: C:\\Users\\Some Body\\.sandbox\\workspace. Note: your current working directory is ${WIN_PATH}.`,
      "Claude wants WebSearch.",
    ],
  }),
  message({
    role: "assistant",
    text: "",
    approval: {
      command: "WebSearch",
      reason: "Claude Code asked to use WebSearch.",
      status: "approved",
      permissionId: "p1",
      exitCode: 0,
      output: [WIDE_LINE, "", "Other results describe the category more generally:", `- **Tangle:** one definition frames an agent sandbox as an isolated workspace: ${LONG_URL}`, "- **Buddy:** offers isolated Linux machines in the cloud.", "", "REMINDER: You MUST include the sources above in your reply."].join("\n"),
    },
    activity: [{ label: "Ran WebSearch · exit 0", ms: 4120 }],
  }),
  message({
    role: "assistant",
    text: [
      'The web search ran, but it didn\'t find anything called "Sandbench." If you share a URL, company name, or GitHub link for Sandbench, I can search for that directly.',
      "",
      "Sources:",
      "",
      `- [Sandboxed Agent Workbench](${LONG_URL})`,
      "- [Tangle: AI agent sandbox](https://example.test/tangle)",
      `- Bare link: ${LONG_URL}`,
      "",
      "`★ Insight ─────────────────────────────────────`",
      "A web search returns pages that match the words in your query.",
      "`─────────────────────────────────────────────────`",
    ].join("\n"),
  }),
  message({
    role: "assistant",
    text: "",
    approval: {
      command: `Get-ChildItem -Force "${WIN_PATH}\\walklings-team"`,
      reason: "List the bot workspace folder.",
      status: "pending",
      permissionId: "p2",
    },
  }),
];

const P4_COMMAND = `curl.exe--fail--silent--output=C:/Users/you/.sandbench/workspace/${"a".repeat(40)}/download.bin--url=https://example.test/${"b".repeat(30)}`;
const P4_PATH = "C:\\Users\\<you>\\.sandbench\\workspace\\walkling-team\\notes\\a.md";
const longMessages: Message[] = [
  message({ role: "user", text: `Open \`${P4_PATH}\` and fetch the file` }),
  message({ role: "assistant", text: `Reading ${P4_PATH} first.` }),
  message({ role: "assistant", text: "", approval: { command: P4_COMMAND, reason: "Download the file.", status: "pending", permissionId: "p4" } }),
];

const thread: Thread = { id: "thread-1", title: "Layout fixture", updatedAt: at, messages, botId: bot.id };
const channel: Thread = { id: "channel-1", title: "walklings-team", updatedAt: at, messages: [], memberIds: members.map((item) => item.id), workingFolder: "walklings-team/a-rather-long-project-folder-name" };
const health = { ok: true, platform: "win32", host: "fixture", workspace: "C:\\Users\\<you>\\.sandbench\\workspace" };
const drivers = [{ id: "claude", label: "Claude Code (local CLI)", ok: true, detail: "" }];
// Work-tab rows (UX P4 measures their switches, checkboxes and buttons on touch).
const routines: Routine[] = [
  { id: "r1", botId: bot.id, title: "Morning summary", schedule: "daily 09:00", enabled: true },
  { id: "r2", botId: bot.id, title: "Weekly tidy", schedule: "weekly mon 10:00", enabled: false },
];
const tasks: BotTask[] = [{ id: "k1", botId: bot.id, title: "Draft the notes", status: "queued", thinking: [], createdAt: 1 }];
const reminders: Reminder[] = [{ id: "n1", title: "Water the plants", at: 1_700_000_600_000, done: false, botId: bot.id }];
const settings = defaultSettings();
const studio = { ...defaultStudio(), onboarded: true };
const noop = () => undefined;

// What the composer sent, for the UX P4 key checks (read by the layout test).
const sent: string[] = [];
(window as unknown as { __sent: string[] }).__sent = sent;

function Fixture() {
  // The app's own breakpoint (App.tsx) decides rail + stage + inspector versus one pane.
  const wide = window.matchMedia("(min-width: 861px)").matches;
  // The dock and the composer work, so the test can reach the rail and side panel and type.
  const [focus, setFocus] = useState<"rail" | "chat" | "side">("chat");
  const [draft, setDraft] = useState("");
  return (
    <Workspace
      t={t}
      wide={wide}
      inert={false}
      focus={focus}
      overlay={null}
      createNonce={0}
      bots={channelScenario ? [bot, ...members] : [bot]}
      tasks={tasks}
      routines={routines}
      computer={[]}
      reminders={reminders}
      threads={channelScenario ? [thread, channel] : [thread]}
      selectedId={bot.id}
      openThreadId={thread.id}
      channel={channelScenario ? channel : null}
      workingBotId={null}
      studio={studio}
      harness={channelScenario ? health : null}
      healthLog={{ checkedAt: at }}
      healthChecked
      onRecheckHarness={() => new Promise((resolve) => setTimeout(() => resolve(false), 300))}
      runner={false}
      callActive={false}
      messages={channelScenario ? [] : longScenario ? longMessages : messages}
      onApproval={noop}
      onCreateChannel={noop}
      onSendChannel={noop}
      onSelectChannel={noop}
      onRemoveChannel={noop}
      onPatchChannel={noop}
      onCall={noop}
      onAddFiles={noop}
      onRemoveFile={noop}
      hub={null}
      draft={draft}
      hasPending={false}
      recording={false}
      listening={false}
      dragging={false}
      streaming={false}
      settings={settings}
      keys={new Set()}
      online
      youLabel="You"
      banner=""
      tools={null}
      settingsPanel={null}
      onFocus={setFocus}
      onOverlay={noop}
      onSelect={noop}
      onSelectThread={noop}
      onNewChat={noop}
      onRemoveThread={noop}
      onCreate={noop}
      onPatch={noop}
      onApplyTestProfile={noop}
      onDelete={noop}
      onDuplicate={noop}
      onDraft={setDraft}
      onSend={(_botId, text) => {
        sent.push(text);
        setDraft("");
      }}
      onStop={noop}
      onAddSection={noop}
      onPatchSettings={noop}
      onAddTask={noop}
      onStartTask={noop}
      onRemoveTask={noop}
      onAddRoutine={noop}
      onToggleRoutine={noop}
      onRemoveRoutine={noop}
      triggerRuns={[]}
      drivers={channelScenario ? drivers : []}
      hookPort={null}
      freshSecret={null}
      onAddWebhook={noop}
      onRotateSecret={noop}
      onDismissSecret={noop}
      onPatchTrigger={noop}
      onRemoveTrigger={noop}
      onAddReminder={noop}
      onToggleReminder={noop}
      onRemoveReminder={noop}
      onNotice={noop}
      onPhoto={noop}
      onCamera={noop}
      onSwatch={noop}
      onVoice={noop}
      onDictate={noop}
      onLocation={noop}
      onDragOver={noop}
      onDragLeave={noop}
      onDrop={noop}
      pending={null}
    />
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
}
