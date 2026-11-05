export type CapabilityState = "working" | "partial" | "preview" | "nativeOnly" | "omitted";

/**
 * Where a row works, written by hand like the rest of this table (nothing here is detected at
 * runtime). `browser`: the signed-in page alone. `harness`: also needs the local harness on this
 * computer (`npm run harness`). `harnessOrRunner`: the local harness or the Docker runner.
 * `native`: the iOS app only. `none`: not built.
 */
export type CapabilityNeeds = "browser" | "harness" | "harnessOrRunner" | "native" | "none";

export type Capability = {
  observed: string;
  web: string;
  state: CapabilityState;
  needs: CapabilityNeeds;
  /** Needs a model API key, or a signed-in local CLI for the CLI drivers. */
  key?: true;
};

const NEEDS_LABEL: Record<CapabilityNeeds, string> = {
  browser: "This page",
  harness: "Local harness",
  harnessOrRunner: "Local harness or runner",
  native: "Native app",
  none: "—",
};

export function needsLabel(item: Capability): string {
  return item.key ? `${NEEDS_LABEL[item.needs]} + model key` : NEEDS_LABEL[item.needs];
}

export const CAPABILITIES: Capability[] = [
  {
    observed: "Bot teammates",
    web: "Create teammates, write instructions, persona, skills, and memories, and chat with each one. Bots read the memories you write (and, with the local harness, the MEMORY.md you edit on the Customize tab) on every turn; they do not save new memories themselves yet",
    state: "working",
    needs: "browser",
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
    web: "Bots propose one PowerShell command, click, keystroke, or workspace file change at a time, or ask you a question. You approve or answer, they read the result, and they can ask for the next step. File changes show the new text or a line diff first. Clicks use primary-screen pixels, are never automatic, and attach a small screenshot to the reply",
    state: "partial",
    needs: "harness",
  },
  {
    observed: "Agent drivers",
    web: "Five drivers: Anthropic (API), OpenAI-compatible tools, Claude Code (local CLI), Codex (local CLI), and Grok (local CLI). A CLI driver needs that CLI installed and signed in on the harness computer; the runner image ships none, so only the two API drivers can work there. The API drivers are listed as available before a key is stored and fail on the first turn without one. Commands use the same approval cards and auto-review rules as other turns. Driver turns do not get the bot's connectors yet, and a turn cut off by a harness restart is not resumed",
    state: "partial",
    needs: "harnessOrRunner",
    key: true,
  },
  {
    observed: "Auto-review rules and approvals",
    web: "Allow-list of read-only commands, plus a setting for unattended routines",
    state: "working",
    needs: "harnessOrRunner",
  },
  {
    observed: "Connectors and custom MCP",
    web: "Add a streamable HTTP MCP server or the Composio preset, test it, and give it to a bot. Calls go through the local harness. With an API key the model chooses the tool. Without one, a matching tool or /tool is proposed. You approve the call. Agent-driver turns (Claude Code and the others) do not get connectors yet. Header values are kept as write-only secrets",
    state: "working",
    needs: "harness",
  },
  {
    observed: "Plugins, templates, and team sharing",
    web: "Built-in and custom plugins per bot, starter templates, a sandbench-team.json file with bots, group chats, paused routines, and connector slots (previewed before it is added), and a Markdown export. Secrets are removed",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Group chats",
    web: "Group chats with an editable roster, shared instructions, a lead, and a working folder. Mention @Name to ask one, or let the chat pick one bot to answer",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Model per bot",
    web: "Each bot can use its own model id through xAI, Anthropic, or a second OpenAI-compatible provider",
    state: "working",
    needs: "browser",
    key: true,
  },
  {
    observed: "Test stack profiles",
    web: "Named profiles (xAI, Claude API, Claude Code CLI, Ollama, Groq) with readiness hints; default for new bots and a per-bot switcher",
    state: "working",
    needs: "browser",
  },
  {
    observed: "Grok Bot migration",
    web: "Import sandbench-migration.json (from Team → Import migration pack, or node scripts/import-grok-desktop.mjs on Windows) to bring bots, memories, chats, paused routines and webhooks, and connector slots without xAI. The Windows script is lossy: each bot's description becomes its only memory, chats are dealt out to bots in turn rather than matched to their bot, every routine gets a placeholder schedule (weekdays at 9:00), and it keeps at most 40 chats and 40 routines",
    state: "partial",
    needs: "browser",
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
    web: "Triggers: schedules and webhooks, created in the side panel or from chat, with pause, edit, undo, and recent runs. Nothing runs while every Sandbench tab is closed: with the local harness, due schedules and webhook deliveries wait in its queue and run once a tab is open; without it, schedules are only checked while the tab is open. The runner does not run routines. Bots set reminders from chat. Each bot keeps a task list",
    state: "partial",
    needs: "browser",
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
    web: "Local threads, streaming replies, fenced code, and an optional API key you supply",
    state: "working",
    needs: "browser",
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
