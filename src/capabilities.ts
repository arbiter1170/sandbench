export type CapabilityState = "working" | "partial" | "preview" | "nativeOnly" | "omitted";

export type Capability = {
  observed: string;
  web: string;
  state: CapabilityState;
};

export const CAPABILITIES: Capability[] = [
  {
    observed: "Bot teammates",
    web: "Create teammates, write instructions, persona, skills, and memories, and chat with each one",
    state: "working",
  },
  {
    observed: "Appearance and voice",
    web: "Color, shape, and a browser voice preview with pitch and rate",
    state: "working",
  },
  {
    observed: "Thinking trace and computer usage",
    web: "Working trace per turn, live CPU, memory, and busiest processes, and a live screen view through the local harness",
    state: "working",
  },
  {
    observed: "Computer use (local exec daemon, window capture)",
    web: "Bots propose one PowerShell command, click, keystroke, or workspace file change at a time, or ask you a question. You approve or answer, they read the result, and they can ask for the next step. File changes show the new text or a line diff first. Clicks use primary-screen pixels, are never automatic, and attach a small screenshot to the reply",
    state: "partial",
  },
  {
    observed: "Agent drivers",
    web: "With the local harness, a bot can hand its turn to Anthropic (Messages API), an OpenAI-compatible tool loop, or Claude Code on this computer. Every command still waits on an approval card",
    state: "partial",
  },
  {
    observed: "Auto-review rules and approvals",
    web: "Allow-list of read-only commands, plus a setting for unattended routines",
    state: "working",
  },
  {
    observed: "Connectors and custom MCP",
    web: "Add a streamable HTTP MCP server or the Composio preset, test it, and give it to a bot. With an API key the model chooses the tool. Without one, a matching tool or /tool is proposed. You approve the call. Header values are kept as write-only secrets",
    state: "working",
  },
  {
    observed: "Plugins, templates, and team sharing",
    web: "Built-in and custom plugins per bot, starter templates, a sandbench-team.json file with bots, group chats, paused routines, and connector slots (previewed before it is added), and a Markdown export. Secrets are removed",
    state: "working",
  },
  {
    observed: "Group chats",
    web: "Group chats with an editable roster, shared instructions, a lead, and a working folder. Mention @Name to ask one, or let the chat pick one bot to answer",
    state: "working",
  },
  {
    observed: "Model per bot",
    web: "Each bot can use its own model id through xAI, Anthropic, or a second OpenAI-compatible provider",
    state: "working",
  },
  {
    observed: "Test stack profiles",
    web: "Named profiles (xAI, Claude API, Claude Code CLI, Ollama, Groq) with readiness hints; default for new bots and a per-bot switcher",
    state: "working",
  },
  {
    observed: "Grok Bot migration",
    web: "Import sandbench-migration.json (from Team → Import migration pack, or node scripts/import-grok-desktop.mjs on Windows) to bring bots, memories, chats, paused routines and webhooks, and connector slots without xAI",
    state: "working",
  },
  {
    observed: "Bot list",
    web: "Pin, duplicate, hide, and mark unread. A dot shows replies you have not opened",
    state: "working",
  },
  {
    observed: "Bot file library and viewer",
    web: "Files per bot stored in this browser, with a viewer for text, images, PDF, audio, and video",
    state: "working",
  },
  {
    observed: "Tasks, routines, and reminders",
    web: "Triggers: schedules and webhooks, created in the side panel or from chat, with pause, edit, undo, and recent runs. With the local harness running, schedules and webhook deliveries queue while the page is closed and run when it opens. Bots set reminders from chat. Each bot keeps a task list",
    state: "partial",
  },
  {
    observed: "Billing and top-up",
    web: "A local usage meter only. There is no billing",
    state: "omitted",
  },
  {
    observed: "Device check, card text recognition, WebAuthn signer, VNC, cloud computers",
    web: "Native helpers in the desktop app. Not rebuilt",
    state: "nativeOnly",
  },
  {
    observed: "Chat with markdown and code",
    web: "Local threads, streaming replies, fenced code, and an optional API key you supply",
    state: "working",
  },
  {
    observed: "Camera and photo library",
    web: "Photo file, camera capture, drag and drop, and a generated swatch",
    state: "working",
  },
  {
    observed: "Microphone and dictation",
    web: "Voice notes, playback, and speech recognition where the browser provides it",
    state: "working",
  },
  {
    observed: "Contacts",
    web: "Manual contacts, plus the contact picker on browsers that expose it",
    state: "partial",
  },
  {
    observed: "Calendar",
    web: "Events stored here, exported as an .ics file",
    state: "partial",
  },
  {
    observed: "Reminders",
    web: "Reminders on this page, with a browser notification when it is allowed",
    state: "partial",
  },
  {
    observed: "Location when requested",
    web: "A one-time location reading inserted into the composer",
    state: "working",
  },
  {
    observed: "Face ID",
    web: "Optional PIN and a platform passkey for this site",
    state: "partial",
  },
  {
    observed: "Background audio and voice calls",
    web: "A call mode that listens, sends, and reads replies in the bot's voice while the tab is open. No background audio session",
    state: "partial",
  },
  {
    observed: "Home screen widget",
    web: "A preview of the latest text. The widget extension itself is iOS-only",
    state: "preview",
  },
  {
    observed: "Notification service extension",
    web: "Page notifications only. Vendor push is not wired up",
    state: "partial",
  },
  {
    observed: "Live Activities",
    web: "No browser equivalent",
    state: "nativeOnly",
  },
  {
    observed: "HomeKit",
    web: "No browser equivalent",
    state: "nativeOnly",
  },
  {
    observed: "AppsFlyer, Braze, and Sentry",
    web: "Not included. Errors stay in a local log",
    state: "omitted",
  },
  {
    observed: "Google sign-in and 1Password",
    web: "Sign-in is omitted. A 1Password link and a Cursor link are available",
    state: "partial",
  },
  {
    observed: "Listed interface languages",
    web: "Language switch for the shell. Longer notes fall back to English",
    state: "working",
  },
];
