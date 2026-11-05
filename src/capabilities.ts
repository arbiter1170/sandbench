export type CapabilityState = "working" | "partial" | "preview" | "nativeOnly" | "omitted";

/**
 * What must be running for everything in a row to work, written by hand like the rest of this
 * table (nothing here is detected at runtime). The row's text says what works with less.
 * `browser`: the signed-in page alone. `harness`: also needs the local harness on this computer
 * (`npm run harness`). `harnessOrRunner`: the local harness or the Docker runner. `native`: a
 * native app only. `none`: nothing to run here.
 */
export type CapabilityNeeds = "browser" | "harness" | "harnessOrRunner" | "native" | "none";

export type Capability = {
  observed: string;
  web: string;
  state: CapabilityState;
  needs: CapabilityNeeds;
  /** `true`: needs a model API key. `"orCli"`: a model API key or a signed-in local CLI. */
  key?: true | "orCli";
};

const NEEDS_LABEL: Record<CapabilityNeeds, string> = {
  browser: "This page",
  harness: "Local harness",
  harnessOrRunner: "Local harness or runner",
  native: "Native app",
  none: "—",
};

export function needsLabel(item: Capability): string {
  if (item.key === "orCli") return `${NEEDS_LABEL[item.needs]} + model key or signed-in CLI`;
  return item.key ? `${NEEDS_LABEL[item.needs]} + model key` : NEEDS_LABEL[item.needs];
}

export const CAPABILITIES: Capability[] = [
  {
    observed: "Bot teammates",
    web: "Create teammates, write instructions, persona, skills, and memories, and chat with each one. With a model key or a signed-in CLI driver, bots read the memories you write. The MEMORY.md you edit on the Customize tab (local harness) reaches agent-driver turns, and planner replies only when the decision step fails. Without a key or a signed-in CLI driver, replies are local stand-ins. Bots do not save new memories themselves yet",
    state: "working",
    needs: "harness",
    key: "orCli",
  },
  {
    observed: "Appearance and voice",
    web: "Color, shape, and a browser voice preview with pitch and rate",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Thinking trace and computer usage",
    web: "Working trace per turn in the page. Live CPU, memory, busiest processes, and the screen view come from the local harness only; the runner does not serve them",
    state: "working",
    needs: "harness",
  },
  {
    observed: "Computer use (local exec daemon, window capture)",
    web: "Bots propose one PowerShell command, click, keystroke, or workspace file change at a time, or ask you a question. You approve or answer, they read the result, and they can ask for the next step. File changes show the new text or a line diff first. Clicks use primary-screen pixels, are never automatic, and attach a small screenshot to the reply. On the runner, commands run in bash and file changes work; clicks, keystrokes and screenshots need the local harness",
    state: "partial",
    needs: "harness",
  },
  {
    observed: "Agent drivers",
    web: "Five drivers: Anthropic (API), OpenAI-compatible tools, Claude Code (local CLI), Codex (local CLI), and Grok (local CLI). A CLI driver needs that CLI installed and signed in on the harness computer; the runner image ships none, so only the two API drivers can work there. The API drivers are listed as available before a key is stored and fail on the first turn without one. Commands use approval cards and auto-review rules, but tools a CLI permits on its own show no card, and a bot's permission mode does not apply to driver turns. Driver turns do not get the bot's connectors yet, and a turn cut off by a harness restart is not resumed",
    state: "partial",
    needs: "harness",
    key: "orCli",
  },
  {
    observed: "Auto-review rules and approvals",
    web: "Allow-list of read-only commands, plus a setting for unattended routines. Command cards also work on the runner; clicks and routines need the local harness",
    state: "working",
    needs: "harness",
  },
  {
    observed: "Connectors and custom MCP",
    web: "Add a streamable HTTP MCP server or the Composio preset, test it, and give it to a bot. Calls go through the local harness. With an API key the model chooses the tool. Without one, a matching tool or /tool is proposed. You approve the call. Agent-driver turns (Claude Code and the others) do not get connectors yet. Header values are kept as write-only secrets",
    state: "working",
    needs: "harness",
    key: true,
  },
  {
    observed: "Plugins, templates, and team sharing",
    web: "Built-in and custom plugins per bot, starter templates, a sandbench-team.json file with bots, group chats, paused routines, and connector slots (previewed before it is added), and a Markdown export. Secrets are removed",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Group chats",
    web: "Group chats with an editable roster, shared instructions, a lead, and a working folder. Mention @Name to ask one, or let the chat pick one bot to answer. The working folder only acts through the local harness or the runner",
    state: "working",
    needs: "harnessOrRunner",
  },
  {
    observed: "Model per bot",
    web: "Each bot can use its own model id through xAI, Anthropic, or a second OpenAI-compatible provider. The local harness or the runner holds the key and makes the call; a local provider address works only with the local harness",
    state: "working",
    needs: "harness",
    key: true,
  },
  {
    observed: "Test stack profiles",
    web: "Named profiles (xAI, Claude API, Claude Code CLI, Ollama, Groq) with readiness hints; default for new bots and a per-bot switcher. Choosing a profile works in the page; its key and driver hints come from the local harness or the runner, and without one a profile can show as ready when it is not. Ready does not check that a local server such as Ollama is running. The CLI and Ollama profiles work only with the local harness",
    state: "working",
    needs: "harness",
    key: "orCli",
  },
  {
    observed: "Grok Bot migration",
    web: "Import sandbench-migration.json (from Team → Import migration pack, or node scripts/import-grok-desktop.mjs on Windows) to bring bots, memories, chats, paused routines and webhooks, and connector slots without xAI. The Windows script is lossy: each bot's description becomes its only memory, chats are dealt out to bots in turn rather than matched to their bot, every routine gets a placeholder schedule (weekdays at 9:00), it keeps at most 40 chats and 40 routines, and it writes no connectors or webhooks. The import itself runs in the page; imported webhooks need the local harness, and imported bots need a model key",
    state: "partial",
    needs: "harness",
    key: true,
  },
  {
    observed: "Bot list",
    web: "Pin, duplicate, hide, and mark unread. A dot shows replies you have not opened",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Bot file library and viewer",
    web: "Files per bot stored in this browser, with a viewer for text, images, PDF, audio, and video",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Tasks, routines, and reminders",
    web: "Triggers: schedules and webhooks, created in the side panel or from chat, with pause, edit, undo, and recent runs. Webhooks and recent runs need the local harness. Nothing runs while every Sandbench tab is closed: with the local harness, due schedules and webhook deliveries wait in its queue and run once a tab is open; without it, schedules are only checked while the tab is open. While a runner answers, a runner build does not run routines, even with a tab open; if it stops answering, the page's own check can fire a due routine with a stand-in reply. Bots set reminders from chat. Each bot keeps a task list",
    state: "partial",
    needs: "harness",
  },
  {
    observed: "Billing and top-up",
    web: "A local usage meter only. There is no billing",
    state: "omitted",
    needs: "none",
  },
  {
    observed: "Device check, card text recognition, WebAuthn signer, VNC, cloud computers",
    web: "Native helpers in the desktop app. Not rebuilt",
    state: "nativeOnly",
    needs: "native",
  },
  {
    observed: "Chat with markdown and code",
    web: "Local threads, fenced code, and stand-in replies work in the page alone. Real streaming replies need a model key held by the local harness or the runner, or a signed-in CLI driver on the local harness",
    state: "working",
    needs: "harnessOrRunner",
    key: "orCli",
  },
  {
    observed: "Camera and photo library",
    web: "Photo file, camera capture, drag and drop, and a generated swatch",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Microphone and dictation",
    web: "Voice notes, playback, and speech recognition where the browser provides it",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Contacts",
    web: "Manual contacts, plus the contact picker on browsers that expose it",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Calendar",
    web: "Events stored here, exported as an .ics file",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Reminders",
    web: "Reminders on this page, with a browser notification when it is allowed",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Location when requested",
    web: "A one-time location reading inserted into the composer",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Face ID",
    web: "Optional PIN and a platform passkey for this site",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Background audio and voice calls",
    web: "A call mode that listens, sends, and reads replies in the bot's voice while the tab is open. No background audio session",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Home screen widget",
    web: "A preview of the latest text. The widget extension itself is iOS-only",
    state: "preview",
    needs: "browser",
  },
  {
    observed: "Notification service extension",
    web: "Page notifications only. Vendor push is not wired up",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Live Activities",
    web: "No browser equivalent",
    state: "nativeOnly",
    needs: "native",
  },
  {
    observed: "HomeKit",
    web: "No browser equivalent",
    state: "nativeOnly",
    needs: "native",
  },
  {
    observed: "AppsFlyer, Braze, and Sentry",
    web: "Not included. Errors stay in a local log",
    state: "omitted",
    needs: "none",
  },
  {
    observed: "Google sign-in and 1Password",
    web: "Google sign-in is required before the app opens, and only allowlisted accounts get in. 1Password and Cursor are links only",
    state: "partial",
    needs: "browser",
  },
  {
    observed: "Listed interface languages",
    web: "Language switch for the shell. Longer notes fall back to English",
    state: "working",
    needs: "browser",
  },
];
