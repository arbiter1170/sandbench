// A deterministic chat for the browser layout test (runner/test/ui-layout.test.mjs). It renders
// the real Workspace shell with the real styles and fixed messages: long inline Windows paths
// with spaces, Claude Code "Insight" separators, a long source link, an approval card with wide
// preformatted tool output, and a pending approval. Nothing here is live data: no harness, no
// sign-in, no real machine path. Not part of the app bundle (only this folder's index.html
// imports it).
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { translate, type Key } from "../i18n";
import { Workspace } from "../shell";
import { recordDeny } from "../approvalView";
import { DROPPED, IN_FLIGHT, REFUSED_ELSEWHERE, STOP_REQUESTED_REPLY, settleMessage, stoppedCard } from "../turnRecovery";
import { askAgainDraft, claimPlannerAnswer, promptFor, startPlannerAnswer } from "../turnStatus";
import { focusComposer } from "../views";
import { defaultSettings, defaultStudio, type Approval, type Bot, type BotTask, type Message, type Reminder, type Routine, type Thread } from "../types";
import { installViewportFit } from "../viewportFit";
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
// ?attach=1 (UX P4): a photo waits in the composer, so the Send button must send with no text.
const attached = new URLSearchParams(location.search).get("attach") === "1";
// The real soft-keyboard tracking, as in src/main.tsx (the test may stand in a visualViewport).
installViewportFit();
// ?scenario=cards: one approval card per ending (UX P3), for the card layout and contrast checks.
const cardsScenario = new URLSearchParams(location.search).get("scenario") === "cards";
// ?scenario=turns: one message per turn state of the status line (UX P2), with a turn running
// (so the planner choice is disabled) and the busy note under the composer. Synthetic data only.
const turnsScenario = new URLSearchParams(location.search).get("scenario") === "turns";
// &idle=1: no turn running, so the planner choice is enabled. The fixture's Ask again… and planner
// tap use the app's own helpers (askAgainDraft, focusComposer, startPlannerAnswer); its "planner
// turn" only records that it was asked for (window.plannerAsks).
const idle = new URLSearchParams(location.search).get("idle") === "1";
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
      command: "WebSearch Sandbench sandboxed agent workbench",
      reason: "Claude Code asked to use WebSearch.",
      agentTool: "WebSearch",
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

// Synthetic cards, one per ending the page can tell apart. The texts the harness or the page's
// turn recovery would leave on a card come from turnRecovery.ts, so they match the real ones.
const claude = (tool: string, command: string, patch: Partial<Approval>): Approval => ({ command, reason: `Claude Code asked to use ${tool}.`, agentTool: tool, status: "pending", permissionId: `p-${tool}-${at}`, ...patch });
const cardApprovals: Approval[] = [
  claude("WebFetch", "WebFetch https://example.org/guide", {}),
  claude("Bash", `Get-ChildItem -Force "${WIN_PATH}\\walklings-team"`, { status: "approved", exitCode: 0, output: `${WIDE_LINE}\nnotes.md` }),
  claude("Bash", "Get-ChildItem notes -Filter *.md", { status: "approved", output: "The agent ran this step itself; its result is in the reply." }),
  claude("Bash", "npm test", { status: "approved", output: IN_FLIGHT }),
  claude("Bash", "npm run lint", { status: "approved", exitCode: 2, output: "2 problems" }),
  claude("WebSearch", "WebSearch sandboxed agent workbench", { status: "denied" }),
  stoppedCard(claude("Write", "Write notes/today.md", {}), true),
  stoppedCard(claude("Edit", "Edit notes/today.md", {}), false),
  claude("mcp__docs__search", 'mcp__docs__search {"q":"agent sandbox"}', { status: "failed", output: REFUSED_ELSEWHERE }),
  settleMessage({ ...message({ role: "assistant", text: "" }), approval: claude("PowerShell", "Remove-Item notes\\old.md", {}) }, DROPPED).approval!,
  { command: "Write notes/plan.md", reason: "Save the plan.", status: "unavailable", file: { path: "notes/plan.md", op: "write", preview: "# Plan" } },
  claude("Bash", "git status", { status: "failed", output: "That request is no longer waiting." }),
  { command: "npm run report", reason: "Make the weekly report.", status: "denied", autoDenied: true },
  claude("Bash", "npm run build", { status: "approved", notRun: true, output: "Approved, but the turn ended before Claude Code was given this step." }),
];
const cardMessages: Message[] = cardApprovals.map((approval) => message({ role: "assistant", text: "", approval }));
// This card's Deny was pressed in this tab, so it reads "Denied by you".
recordDeny(cardMessages[5].id, at);

const REASON_DETAIL = "Install the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`), sign in, then restart the harness. Claude Desktop is not the CLI.";
const turnMessages: Message[] = [
  message({ role: "user", text: "List the files in the walklings-team folder" }),
  message({ id: "s9", role: "assistant", text: "", thinking: ["Claude Code couldn't start, so nothing was sent to it. The built-in planner did not answer."], startFailure: { kind: "unreachable", agent: "Claude Code" } }),
  message({ role: "user", text: "Try again with the folder listing" }),
  message({ id: "s9b", role: "assistant", text: "", startFailure: { kind: "unavailable", agent: "Claude Code", detail: REASON_DETAIL }, plannerAnswer: { messageId: "s12", at: 1_700_000_100_000 } }),
  message({ id: "s12", role: "assistant", text: "Here is what I can do without the agent: I can list the folder once you approve the command.", answeredBy: { kind: "planner-once", agent: "Claude Code", sourceId: "s9b" } }),
  message({ role: "user", text: "Run the build" }),
  message({ role: "assistant", text: "Starting the build now.", status: "done", interrupted: STOP_REQUESTED_REPLY, driverTurn: { agent: "Claude Code", id: "t1" } }),
  message({ role: "user", text: "And the tests" }),
  message({ role: "assistant", text: "", status: "error", failure: `Claude Code exited with 1. ${LONG_URL}`, driverTurn: { agent: "Claude Code", id: "t2" } }),
  message({ role: "user", text: "Check the logs" }),
  message({ role: "assistant", text: "Reading the logs…", status: "error", interrupted: DROPPED, driverTurn: { agent: "Claude Code", id: "t3" } }),
  message({ role: "user", text: "One more time" }),
  message({ role: "assistant", text: "", status: "error", startUnknown: { agent: "Claude Code", reason: "Failed to fetch" }, driverTurn: { agent: "Claude Code" } }),
  message({ role: "user", text: "Now" }),
  // M1: the running turn's newest reply has its step's real result, but the agent isn't done.
  message({
    role: "assistant",
    text: "Listing the folder.",
    thinking: ["Hand the turn to Claude Code (local CLI).", `Working folder: ${WIN_PATH}`],
    driverTurn: { agent: "Claude Code", id: "t4" },
    approval: { command: "ls", reason: "Claude Code asked to use Bash.", status: "approved", permissionId: "p4", output: "notes.txt", exitCode: 0 },
  }),
];

const thread: Thread = { id: "thread-1", title: "Layout fixture", updatedAt: at, messages: turnsScenario ? turnMessages : messages, botId: bot.id };
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
const voice: number[] = [];
Object.assign(window, { __sent: sent, __voice: voice });

function Fixture() {
  // The app's own breakpoint (App.tsx) decides rail + stage + inspector versus one pane.
  const wide = window.matchMedia("(min-width: 861px)").matches;
  // The dock and the composer work, so the test can reach the rail and side panel and type.
  const [focus, setFocus] = useState<"rail" | "chat" | "side">("chat");
  // The cards page answers its waiting card the way App.tsx decideApproval does, so a Deny click
  // can be checked end to end. The default page keeps its cards fixed.
  const [cards, setCards] = useState(cardMessages);
  const decide = (messageId: string, approve: boolean) =>
    setCards((prev) =>
      prev.map((item) =>
        item.id === messageId && item.approval?.status === "pending"
          ? { ...item, approval: { ...item.approval, status: approve ? "approved" : "denied", ...(approve ? { output: IN_FLIGHT } : {}) } }
          : item,
      ),
    );
  const [threads, setThreads] = useState<Thread[]>([thread]);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [note, setNote] = useState(turnsScenario && !idle ? "North is still replying. Your message is kept; send it when this turn ends." : "");
  const busy = turnsScenario && !idle;
  const record = (key: "asked" | "plannerAsks", value: string) => {
    const store = window as unknown as Record<string, string[] | undefined>;
    store[key] = [...(store[key] ?? []), value];
  };
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
      workingBotId={busy ? bot.id : null}
      workingThreadId={busy ? thread.id : null}
      studio={studio}
      harness={channelScenario ? health : null}
      healthLog={{ checkedAt: at }}
      healthChecked
      onRecheckHarness={() => new Promise((resolve) => setTimeout(() => resolve(false), 300))}
      onAskAgain={(id) => {
        record("asked", id);
        const next = askAgainDraft(draftRef.current, promptFor(threadsRef.current[0].messages, id));
        if (next.kept) setNote(t("tsAskAgainKept"));
        else setDraft(next.draft);
        focusComposer();
      }}
      onPlannerAnswer={(id) => {
        startPlannerAnswer({
          messageId: id,
          runner: false,
          busy: () => busy,
          onBusy: noop,
          threads: () => threadsRef.current,
          write: (claimed, claim) => {
            threadsRef.current = claimed;
            setThreads((prev) => claimPlannerAnswer(prev, claim.threadId, claim.sourceId, { messageId: claim.replyId, at: claim.at }) ?? prev);
          },
          newId: () => `reply-${Date.now()}`,
          now: () => 1_700_000_200_000,
          ask: async (request) => record("plannerAsks", request.prompt),
          refuse: noop,
        });
      }}
      busyNote={note}
      runner={false}
      callActive={false}
      messages={channelScenario ? [] : longScenario ? longMessages : cardsScenario ? cards : threads[0].messages}
      onApproval={cardsScenario ? decide : noop}
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
      hasPending={attached}
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
      onDraft={(value) => {
        setDraft(value);
        if (note === t("tsAskAgainKept")) setNote("");
      }}
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
      onVoice={() => voice.push(Date.now())}
      onDictate={noop}
      onLocation={noop}
      onDragOver={noop}
      onDragLeave={noop}
      onDrop={noop}
      pending={attached ? <ul className="pending"><li>photo.png</li></ul> : null}
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
