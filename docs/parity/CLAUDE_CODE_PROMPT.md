# Kickoff prompt for Claude Code: Sandbench parity

> Paste everything below the line into Claude Code, started from the root of the `arbiter1170/sandbench` repo.

---

You are the engineer building **Sandbench parity**. Vincent (the repo owner) is your only stakeholder. Read this whole prompt, then `docs/parity/PLAN.md`, before you change anything.

## 1. Goal

Host the **Walklings bot team** in Sandbench with near-full parity with Grok Bot, where the team runs today. The team is:
- Supervisor (coordinates, reviews and merges PRs, the only bot that messages Vincent);
- PixelPets (lead engineer, launches cloud coding agents for builds);
- Design (writes specs in a private design repo);
- QA (Playwright suites at phone widths);
- Token Engineer;
- Sprites.

Parity means the bots can:
- run without any browser tab open;
- run 4-hour test suites in the background;
- message and wake each other;
- launch builds that open pull requests;
- review and merge with a head-commit check;
- take screenshots at 320/375/390 px;
- remember things between sessions;
- run on a schedule in America/New_York time;
- send email only after Vincent approves;

all under Vincent's approval rules.

## 2. What Sandbench is today

Cite and change these files. The line numbers are at commit `65349ec` and will drift, so find code by name.

- A React 19 + Vite PWA deployed to Vercel (`vercel.json`), behind Firebase Google sign-in (`src/AuthGate.tsx`, `src/firebase.ts`). **The allowlist is only checked in the browser bundle** (`VITE_ALLOWED_EMAILS`, `src/firebase.ts:18-30`), and `firestore.rules` doesn't check it.
- The whole workspace is **one Firestore document**, and the newer write wins (`src/cloudSync.ts`, used at `src/App.tsx:269-315`). Logs are capped at 40. Attachments stay in IndexedDB on the device (`src/db.ts`).
- **API keys** live in `Settings` (`src/types.ts:298-335`), sync to Firestore, and are sent from the browser on every turn (`src/App.tsx:1418`). Connector secrets are stored in plain text (`src/types.ts:184-189`).
- **The browser runs every turn.** `askBot` (`src/App.tsx:1725`) builds the prompt and drives the harness (`src/App.tsx:1404-1440`, `src/harness.ts`). Close the tab and the turn stops.
- Anything that acts goes through a **local Node harness bound to 127.0.0.1** (`harness/server.mjs:608-611`). Only the Vite dev proxy can reach it (`vite.config.ts:49-68`). It covers shell (`/exec`, **30-second timeout**, `harness/server.mjs:83`), files, screen capture, MCP calls, schedules and webhooks.
- Agent drivers live in `harness/drivers/`: Anthropic API and OpenAI-compatible (both **capped at 6 steps**: `anthropic.mjs:5`, `http.mjs:7`), plus the Claude Code CLI (`claude.mjs`, with `--resume` support), Codex and Grok CLI. The driver contract is in `harness/drivers/index.mjs`.
- Permissions are held in memory with a 30-minute timeout (`harness/turns.mjs`). Auto-review only matches the first word of a command (`harness/turns.mjs:26-31`).
- The scheduler parses plain English and **only runs when the page is open** (`harness/server.mjs:458-544`, `src/App.tsx:378-444`).
- Multi-agent support is a manual "Hand off" button (`src/bots.tsx:388-407`). The coordination MVP is only a plan (`docs/superpowers/plans/2026-10-23-coord-and-cua.md`).
- Memory and skills are local files under `~/.sandbench/` (`docs/wave-a.md`).
- **There are no tests and no CI.** `npm run build` (tsc + vite) is the only check.

## 3. Architecture target

Build a **runner service** on a VM: Docker compose with the runner, Postgres and cloudflared. The UI talks to it over HTTPS and SSE with a Firebase ID token. Firebase is used only for sign-in.

```mermaid
flowchart LR
  subgraph Client["Browser / PWA (Vercel or same VM)"]
    UI["Sandbench UI\n(src/*) — views, approval cards,\nchat, job logs"]
  end
  subgraph Edge["Edge"]
    CF["Cloudflare Tunnel + Access\n(Google IdP, allowlist)"]
  end
  subgraph VM["Runner VM (Docker compose)"]
    API["runner/api\nHTTPS + SSE\nFirebase ID-token verify\n+ server allowlist"]
    Q[("Postgres\nentities + pg-boss queue\n+ FTS memory")]
    W["runner/worker\nturn engine, job supervisor,\nscheduler (cron TZ=America/New_York)"]
    POL["runner/policy\napproval classes, red gate,\nforce-push / Firebase allowlist,\nsend-after-approval, stop-all"]
    MCP["runner/mcp (sandbench-tools)\nsend_message, list_agents,\nmemory_*, job_*, github_*,\nemail_draft, screenshot, schedule_*"]
    DRV["drivers (from harness/drivers)\nclaude -p | anthropic | codex | grok"]
    FS["/srv/sandbench\nshared/ + agents/<id>/\n+ git worktrees"]
    PW["Playwright + Chromium\nphone viewports\nFirebase emulator (Java)"]
    SEC["secrets: age/SOPS file or\ncloud secret manager → env"]
  end
  subgraph Ext["External"]
    GH["GitHub App"]
    CUR["Cursor Cloud Agents API\n(or Claude Code on VM)"]
    MAIL["Email provider"]
    PUSH["Web Push → Vincent only"]
    LLM["Anthropic / xAI APIs"]
  end
  UI <-->|"HTTPS + SSE"| CF <--> API
  API <--> Q
  W <--> Q
  W --> DRV --> LLM
  DRV <-->|"MCP stdio"| MCP
  DRV -->|"PreToolUse hook"| POL
  MCP --> POL
  W --> FS
  W --> PW
  SEC -.-> W
  GH -->|"webhooks (HMAC)"| API
  MAIL -->|"inbound webhook"| API
  W --> GH
  W --> CUR
  POL -->|"approved sends only"| MAIL
  W --> PUSH
```

Main choices:
- **pg-boss** on Postgres for durable jobs and cron with a time zone.
- **Claude Code headless (`claude -p`)** as the main agent engine.
- A **GitHub App** instead of personal tokens.
- **Playwright and the Firebase emulator** in the runner image.
- Keep `harness/` working as a local-mode adapter.

## 4. Working rules (not optional)

1. **One small PR per backlog item** (`SB-xx`), on its own branch named `sb-xx-short-name` off the default branch `deploy/vercel`. Don't bundle items together.
2. **Tests and CI with every item.** Each PR adds or updates tests (vitest for `src/`, `node --test` for `runner/`, Playwright for UI flows) and keeps the GitHub Actions workflow green. Write the policy tests (SB-06) before the policy code.
3. **Never force-push. Never rebase a branch that has been pushed.** To catch up, merge the base into your branch. Never push directly to `deploy/vercel` or `main`; open a PR.
4. **No secrets in code, Firestore or the page bundle.** Secrets come from the runner environment or the secrets store. Never print a secret in logs, PRs or chat. Run a secret scan (for example gitleaks) in CI.
5. **Firebase projects:** never touch the off-limits projects (the Walklings game's project and three others; their ids are kept out of this public repo and the runner blocks them by hash in `runner/guard.mjs`). Sandbench needs **its own** Firebase project, so ask Vincent for it. Tests use the emulator with a `demo-*` project id.
6. **Never commit private player data or private ops notes**, such as save files or private logs, to any repo, Sandbench included. The game repo is public.
7. **Ask Vincent first** before any destructive action (deleting data or branches, dropping tables, rotating keys, changing DNS or Cloudflare) and before adding any paid service or anything that costs money.
8. Keep Sandbench's existing safety habits: approval cards, workspace path limits, no inbound ports.
9. Plain, clear English in docs, PR bodies and UI text.

## 5. How to work through PLAN.md

1. Open `docs/parity/PLAN.md`. Pick the **first unchecked item whose dependencies are all checked**, in phase order.
2. Read its **Change**, **Approach** and **Acceptance** lines and the files it cites. Confirm the code is still where the plan says (search by name).
3. Write a short plan in the PR description: files to touch, tests to add, and how you'll prove the acceptance test.
4. Build it, with tests. Run `npm run build` and all tests locally.
5. Prove the **acceptance test**. If it needs live infrastructure you don't have yet, prove it against the mock driver (`scripts/mock-openai-tools.mjs`), local Postgres and the emulator, and say in the PR exactly what's still left to prove live.
6. In the same PR, tick the item's box in `PLAN.md` and add a line to the **Progress log** at the bottom: `YYYY-MM-DD · SB-xx · PR #n · what changed · acceptance result`.
7. Open the PR as ready for review. Vincent merges. Then move to the next item.

## 6. Definition of done per phase

- **Phase 0, Foundation:**
  - the runner is live behind Cloudflare Access with server-side ID-token checks;
  - an account that isn't on the allowlist gets 403 from the runner;
  - no API keys are in Firestore or `dist/`;
  - per-record Postgres data stays in sync across two devices without lost edits;
  - CI is green.
- **Phase 1, QA runs fully in Sandbench:**
  - QA is imported with its memory and skills;
  - it runs the pp_verify suite at 320/375/390 detached for about 4 hours;
  - the run survives the tab closing and a worker restart;
  - it posts screenshots and reports back;
  - force-push and wrong-Firebase-project blocks are proven by tests.
- **Phase 2, Supervisor and review loop:**
  - messages between bots wake the recipient;
  - the Supervisor merges a real PR only when the head sha matches what it reviewed, then confirms the Pages build and updates the board;
  - the Friday/Sunday 10:00 ET idea round fires with no browser open;
  - only the Supervisor can notify Vincent;
  - red items are resolved only by Vincent's click.
- **Phase 3, Builders:**
  - PixelPets launches a brief and gets a PR with the build stamped and tests passing;
  - Design commits to the design repo without force-pushing;
  - all six bots are imported from the team pack.
- **Phase 4, Parity polish:**
  - GitHub PR events wake the Supervisor;
  - outside email works as draft, then approve, then send;
  - attachments sync across devices;
  - token and cost tracking with per-bot budgets.
- **Cutover:** two weeks of Walklings work with nothing that needs Grok Bot.

## 7. Where to stop and report to Vincent

Stop, write a short status (what's done, what's blocked, what you need), and wait when any of these happens:
- **at the end of each phase**, with its definition-of-done results;
- **before anything that needs an account, money or credentials**: the VM, Cloudflare, the Postgres host, the Firebase project, the GitHub App, the email provider, model API keys, Cursor API access. The open questions at the bottom of `PLAN.md` list these;
- **before any destructive action** (rule 7);
- when an **acceptance test can't pass** as written, or an estimate is running more than 50% over;
- when a **safety rule would have to be weakened** to make something work. Don't weaken it; report it;
- when you're unsure whether something is private.

Start now with Phase 0. Your first step is to read `docs/parity/PLAN.md`, list the open questions you need Vincent to answer before SB-01, and propose the SB-21 CI skeleton and the SB-01 runner layout as your first PRs.
