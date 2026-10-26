# Sandbench

Unofficial local demo of the capabilities observed in the iOS app (bundle `co.anysphere.sand`, version 1.17.0). The interface, copy, and code are a clean-room web rebuild. It does not include that app’s code, artwork, accounts, or service keys.

## Run

```bash
cd sandbench
npm install
cp .env.example .env.local   # Firebase + allowlist (see docs/deploy-vercel.md)
npm run dev
```

Open http://127.0.0.1:5173.

## Cloud deploy (private)

- Firebase Google Auth (email allowlist) + Firestore workspace sync
- Vercel SPA on branch `deploy/vercel`
- Details: [docs/deploy-vercel.md](docs/deploy-vercel.md)
- Hosted runner on a VM (SB-01, in progress): [docs/runner.md](docs/runner.md)

Attachments stay on-device (IndexedDB). Model API keys sync with the cloud snapshot under your Firebase UID — keep the allowlist tight.

**Test stack:** Settings and each bot’s **Test profile** switch between xAI, Claude API, Claude Code CLI, Ollama, and Groq. See [docs/test-stack.md](docs/test-stack.md).

To give bots this computer, start the local harness in a second terminal:

```bash
npm run harness
```

The harness listens on `127.0.0.1:8799` only. It writes a random token to `.harness-token`, and the Vite dev proxy adds that token to `/harness` calls from this page. Requests from other origins are refused. Commands run in PowerShell inside `~/.sandbench/workspace` (or a group chat's working folder under it), and only after you approve them in chat or they match an auto-review rule. Commands with pipes, redirects, or chaining always ask. Clicks, typed text, key presses, and file writes or deletes also wait for approval and are never on the auto-review list. File paths cannot leave the workspace. The harness can capture the primary screen, list the busiest processes, and talk to MCP servers for connectors.

### Webhooks

The harness also opens a second listener on `127.0.0.1:8801` (set `SANDBENCH_WEBHOOK_PORT` to change it) that serves only `GET /health` and `POST /hooks/<id>`. Add a webhook in a bot's Triggers panel, or ask in chat ("when a webhook arrives, summarize it"). The secret is shown once; the harness keeps only its SHA-256 hash.

```bash
curl -X POST http://127.0.0.1:8801/hooks/<id> -H "Authorization: Bearer sbh_..." -d "build 412 failed"
```

A delivery returns `202` and queues a turn with the first 4,000 characters of the body. A wrong secret returns `401`, a paused webhook `409`, and more than 20 waiting deliveries `429`. The bot runs the turn when the page is open, and each run appears under Recent runs. To reach it from the internet, put your own tunnel in front of port 8801.

`npm test` runs the unit tests: vitest for `src/` (`npm run test:web`) and `node --test` for `harness/` (`npm run test:node`). GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, both test sets, the build, a check that `dist/` holds no API keys, and a gitleaks secret scan on every PR.

`npm run build` typechecks and writes a static build to `dist/`. `npm run preview` serves that build with the service worker. The install control in Settings turns on when the browser fires its install prompt, which happens on that preview (or any https host), not on the dev server.

### Desktop (Electron MVP)

With the harness binary available as `node` on PATH:

```bash
npm run build
npm run electron:dev   # loads http://127.0.0.1:5173 if Vite is running, else dist/
```

`electron:dev` starts the harness child, waits for `/health`, and opens a window. Packaged layout: `npm run electron:pack` (Windows dir target). See also [docs/mcp-server.md](docs/mcp-server.md) and [docs/team-import.md](docs/team-import.md).

### Agents

By default a bot's turn is planned in the page: a local match or a JSON decision from the model picks one action. With the harness running, a bot's **Agent** setting (right column, under its model) can hand the whole turn to a driver in `harness/drivers/` instead:

- **Anthropic (API)**: a Messages API tool loop using the Anthropic key from Settings and the bot's model (or the default Claude model). Same `run_command` approval flow as the HTTP driver.
- **OpenAI-compatible tools (HTTP)**: an OpenAI-compatible tool-calling loop using the bot's model and key. The model calls `run_command` as often as it needs (up to six steps). Each call becomes an approval card, the approved command runs in the workspace (or the group chat's folder), and the output goes back to the model.
- **Claude Code (local CLI)**: runs `claude -p --output-format stream-json` with the prompt on stdin. Tools Claude is not allowed to use come back as permission denials; each one becomes an approval card, and approved ones are added to a per-turn settings file before the session resumes. Install with `npm i -g @anthropic-ai/claude-code` (Claude Desktop is not the CLI), run `claude` in a terminal and complete `/login`, then restart the harness. On Windows the harness also looks under `%APPDATA%\\npm\\claude.cmd`. It shows as "not installed" until that binary is found. Only `claude-*` model ids are passed through; other test-stack models are ignored so the CLI uses its default. This driver was written from Claude Code's public headless docs.
- **Codex (local CLI)**: runs `codex app-server` over NDJSON JSON-RPC (`thread/start` → `turn/start`). Shell and file approvals become Sandbench cards. Install the Codex CLI, sign in, then restart the harness. Override the binary with `SANDBENCH_CODEX_BIN`. Concurrent launches are capped on small hosts (`SANDBENCH_CODEX_LAUNCH_SLOTS`).
- **Grok (local CLI)**: runs `grok … agent stdio` over ACP. Requires `grok login` (subscription auth in `~/.grok/auth.json`), not an xAI API key. Install from https://x.ai/cli, then restart the harness. Override with `SANDBENCH_GROK_BIN`.

Settings can also set a **default agent** when a bot has no Agent field. Bots on Anthropic or OpenAI-compatible providers with the computer skill can auto-pick the matching driver when a key is present.

Drivers stream events to the page through `GET /events` (server-sent events with replay), and the page answers cards through `POST /permissions/<id>`. Auto-review rules still apply, Stop interrupts the turn, and unattended routines follow the "unattended" setting.

## What works in the browser

- A dark three-column workspace: bots on the left, the conversation in the middle, and computer usage, skills, and routines on the right
- A model picker in the top right
- First-run onboarding that builds a team from templates
- Teammates you create, with instructions, persona, skills, plugins, connectors, memories, and a file library
- Appearance (color, shape, or an uploaded photo) and a browser voice preview
- A thinking trace per turn, and with the harness running: live CPU, memory, busiest processes, and a live view of the screen. "Share a window" uses the browser's screen picker instead
- Approval cards: a bot proposes a command, a click or keystroke, a workspace file write or delete (with the new text or a diff), or an MCP tool call. You approve or deny, the result comes back, and the bot either answers or asks for the next step. With an API key, the model chooses that action. Without one, a local match does, including a chain written with "and then"
- Question cards: a bot asks you to pick an option or type an answer, and continues from your reply
- Activity chips under replies ("Ran Get-Date · exit 0", "Wrote notes.md", "Called search"), and a small screenshot after an approved click or keystroke
- Auto-review rules for read-only commands, and a choice of what unattended routines do
- A model for each bot, through xAI, Anthropic, or a second OpenAI-compatible provider set in Settings
- Team panel: templates, plugins (built-in and your own), MCP connectors with a test button and a Composio preset, write-only secrets for connector headers, auto-review, and a local usage meter
- Team sharing as `sandbench-team.json`: bots, group chats, routines (imported paused), and connector slots with the host only. The import shows a preview before anything is added. A Markdown export is also available. Chats, files, memories, secrets, and anything shaped like an API key are left out
- **Grok Bot migration**: on Windows, `node scripts/import-grok-desktop.mjs` reads `%APPDATA%\\Grok Bot\\sand-client-persistence\\` and writes `sandbench-migration.json`. In Team → **Import migration pack**, preview bots, chats, routines, and webhooks, then apply. Imported bots default to Anthropic provider and agent when you bring your own Claude key
- Group chats with an editable roster, shared instructions, a lead, and a working folder. Mention `@Name` to ask one bot, or leave auto-route on and the chat picks the best fit (the model when a key is set, otherwise a skill match, otherwise the lead)
- Bot list: pin, duplicate, hide, and mark unread, with an unread dot for replies you have not opened
- A saved draft for each bot and group chat
- Mermaid diagrams in replies
- Call mode: speak, the bot answers in its own voice, and it listens again. Use Chrome or Edge on `http://127.0.0.1:5173` or `http://localhost:5173`; the first Call may prompt for the microphone—allow it for that origin. Agent drivers and test-stack profiles stay in the same loop. Read replies aloud and mute are set for each bot
- Triggers: schedules and webhooks per bot, created in the side panel or from chat ("every weekday at 9:00, check the build"). A card in chat lets you edit, pause, or undo it, and Recent runs lists what ran or was skipped. While the local harness is running, schedules and webhook deliveries queue with the browser closed; open the page again and the bot runs the turns it missed. A Windows balloon says a routine is waiting.
- A handoff that sends a note from one teammate to another
- Conversations stored in IndexedDB, with streaming replies
- Markdown, fenced code, and keyword coloring
- Photo file, camera capture, drag-and-drop, and a generated swatch
- Voice notes and dictation where the browser allows them
- Manual contacts, plus the contact picker where it exists
- Calendar events and an `.ics` download
- Reminders and browser notifications
- One-time location inserted into the composer
- Optional PIN and a platform passkey
- Language switch for the shell
- Cursor and 1Password links
- A widget-shaped preview of the latest text
- Optional model calls: put your own API key in Settings

With no key, replies are a local stand-in and stay on this machine. With a key, leave the base URL empty and keep “Use the dev proxy for api.x.ai” on. The dev server forwards `/api-proxy` to `https://api.x.ai` so the browser is not blocked by CORS. The key is stored only in this browser’s local database.

## Still native-only or not built

Home screen widgets, HomeKit, Live Activities, background voice calls, and a real iOS build need a Mac with Xcode. Vendor push, analytics, Google sign-in, team accounts, Slack sharing, and billing need your own accounts and backend; none of those keys are included here. The desktop app's native helpers (device check, card text recognition, the WebAuthn signer, and VNC) are not rebuilt.

The approval-card and local-harness design follows the open-source [OpenMausBot](https://github.com/milind-soni/OpenMausBot) (Apache 2.0). No code was copied from it.
