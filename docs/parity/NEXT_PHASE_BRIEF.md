# Next brief for coding agents: the rest of Vincent's Q10 path (SB-03, SB-04, SB-10, SB-06 core, SB-11 core, SB-12, SB-15a)

This is the brief that follows `docs/parity/CURSOR_AGENT_BRIEF.md` (SB-09, SB-08, SB-13). It is
written for up to three coding agents (Cursor cloud agents or Claude Code) working at the same
time. Vincent (the repo owner) is your only stakeholder. He reviews and merges every PR. Read
`docs/parity/PLAN.md` (the items below, "Top 3 risks" and the Progress log),
`docs/parity/CLAUDE.md`, `docs/parity/CLAUDE_CODE_PROMPT.md` and `docs/parity/CURSOR_AGENT_BRIEF.md`
before you change anything. If this brief and those files disagree, **this brief wins**.

> **Handoff note (2026-10-26):** for Oct 27-29 only one Claude Code agent works, from `docs/parity/handoff/WORKPLAN.md`,
> which schedules SB-03 PR 1, SB-15a and a few safe follow-ups and holds the rest for the Supervisor. Where that
> file and this brief disagree, the handoff wins.

This repo is **public**. Commit messages, PR text, logs and test fixtures are all public.

## Rules (they override anything else)

These are the same rules as in `CURSOR_AGENT_BRIEF.md`, with two additions about parallel work.

- **Never force-push. Never rebase** (not even a branch you have not pushed). To catch up, merge
  `deploy/vercel` into your branch.
- **One PR per item**, with tests. Branch from the latest `deploy/vercel` as `sb-xx-short-name`.
  Open the PR **against `deploy/vercel`**. Never push to `deploy/vercel` or `main`, and never merge
  your own PR. The one exception to "one PR per item" is SB-03, which is two PRs (see below).
- **All four required checks must be green on the PR's head commit:** `Typecheck, test, build`,
  `Secret scan`, `Runner sign-in checks (Auth emulator)`, `Runner image and compose file`. Do not
  rename them. Add steps inside them if you need to. CI may trigger only on `pull_request` and
  pushes. Never add `pull_request_target`, `workflow_run` or `issue_comment`. Keep
  `persist-credentials: false`.
- **Postgres and the DB tests must cover every new runner data path** (new tables, queries and
  routes). The datastore tests must run, not skip (see the checks below).
- **Firebase:** use only Sandbench's own project. Its id is `FIREBASE_PROJECT_ID` in `deploy/.env`
  on Vincent's machine, never in the repo. Never use, query, list or deploy to any other project.
  The four off-limits ones (the Walklings game's and three others) are blocked by hash in
  `runner/guard.mjs`. Do not write their ids anywhere, including this brief, commits, PRs and
  chat. Always pass `--project` explicitly to any `firebase` command. Tests and docs use `demo-*`
  project ids only. If a task seems to need another project, stop and report.
- **Project ids and any real hostname or address live in `deploy/.env`, not the repo.** Docs use
  placeholders such as `<your-tailnet>`.
- **No secrets and no personal data in commits**, PR text, tests, logs or docs: no API keys, tokens,
  private keys, personal emails, machine paths or player data. Tests and docs use `@example.test`
  addresses, and test keys are generated inside the test, never committed. Never put a secret in
  the repo, the page bundle or Firestore. Read secrets through the secret store
  (`harness/secrets.mjs`), never hard-code them, and never print one in a log or an event.
- **Where the runner runs:** on Vincent's laptop, reached through Tailscale Funnel
  (`https://sandbench.<your-tailnet>.ts.net`, see `docs/runner.md`, "Laptop runner"). That is the
  plan for now. **There is no Hetzner server, no Cloudflare tunnel setup and no other host planned.**
  Where `PLAN.md` says otherwise, treat it as old (see "Carried follow-ups"). Do not write
  deployment code for a new host. The runner is offline whenever the laptop sleeps.
- Ask first (stop and report) before anything that costs money, needs an account or credential,
  deletes data or branches, rotates keys, or changes DNS.
- Tick a plan item's box only when its acceptance passes against live infrastructure. Otherwise add
  a line to the Progress log in `PLAN.md` (same PR) that says what is built and what is pending,
  and leave the box unticked.
- **Parallel work (new):** stay inside the files your track owns (see "Parallel tracks"). If you
  need a change in a file another track owns, ask in your PR and wait, or make the smallest change
  that adds a new file instead. Never run two agents on the same track.
- **Parallel work (new):** the `PLAN.md` Progress log and the lockfiles are touched by every PR.
  On a merge conflict in the Progress log, keep both lines. On a lockfile conflict, merge the base,
  then run `npm install` again. Never edit a lockfile by hand.

## Starts when

All of these are true. Check with the GitHub tools; if one is not, report that and wait.

1. **SB-09, SB-08 and SB-13 are merged** into `deploy/vercel` (the previous brief). The SB-13 PR
   rewrites `runner/Dockerfile`, and SB-03 adds to it, so SB-13 must land first.
2. PR #9 (SB-05 follow-up) is merged. It is, at the time of writing.
3. The four required checks are green on the tip of `deploy/vercel`.
4. Vincent has answered, or accepted the default for, the open questions at the end of this brief
   that are marked **blocks start**. Nothing needs an answer to start SB-03 PR 1.

## Scope (Vincent's answer to Q10)

Builders first: Phase 0, Phase 1 and Phase 3, plus only the core of SB-06 and SB-11. QA, PixelPets,
Design and Sprites move to Sandbench first. The Supervisor, outside email and notifications to
Vincent stay in Grok Bot. The items, checked against `PLAN.md` on `deploy/vercel`:

| Item | Where in PLAN.md | In this brief |
|---|---|---|
| SB-03 turn engine and job queue | Phase 1 | Yes |
| SB-04 detached jobs, step cap | Phase 1 | Yes |
| SB-10 sandbench-tools MCP server | Phase 1 | Yes |
| SB-06 approval and safety layer | Phase 1 (core), Phase 2 (full) | **Core only** |
| SB-15a importer | Phase 1 (QA only), Phase 3 (all six) | Yes |
| SB-11 GitHub integration | Phase 2 | **Core only, no board** |
| SB-12 build launches that open PRs | Phase 3 | Yes |
| SB-01, SB-02, SB-05, SB-21 skeleton | Phase 0 | Built; boxes wait on live checks (see `PLAN.md`) |
| SB-09, SB-08, SB-13 | Phase 1 | The previous brief |
| SB-07, SB-14, SB-16, SB-17, SB-15, SB-18, SB-19, SB-21 (rest), SB-22, P2 | Phase 2, 4, P2 | **No** (see "Stays in Grok Bot") |

## Dependency graph

```mermaid
flowchart TD
  subgraph Built["Built (boxes wait on live checks)"]
    SB02["SB-02 records + change feed"]
    SB05["SB-05 secret store"]
  end
  subgraph Prev["Previous brief (libraries)"]
    SB09["SB-09 workspaces, worktrees"]
    SB08["SB-08 profile, skills, memory"]
    SB13["SB-13 browser, emulator"]
  end
  SB03["SB-03 turn engine + jobs schema"]
  SB04["SB-04 detached jobs, step cap"]
  SB10["SB-10 MCP tool server"]
  SB06["SB-06 core: policy, approvals, Stop all"]
  SB11["SB-11 core: GitHub App, PRs"]
  SB12["SB-12 build launches"]
  SB15a["SB-15a team-pack importer"]

  SB02 --> SB03
  SB09 -.->|"cwd per agent"| SB03
  SB08 -.->|"prompt builder"| SB03
  SB03 --> SB04
  SB03 --> SB10
  SB03 --> SB06
  SB05 --> SB06
  SB06 --> SB11
  SB10 --> SB11
  SB05 --> SB11
  SB04 --> SB12
  SB09 --> SB12
  SB11 --> SB12
  SB08 -.->|"AGENTS.md, skills"| SB12
  SB02 --> SB15a
  SB08 --> SB15a
  SB10 -.->|"exposes as tools"| SB09
  SB10 -.->|"exposes as tools"| SB08
  SB10 -.->|"exposes as tools"| SB13
  SB06 -.->|"policy gates"| SB13
```

Solid arrows are hard dependencies from `PLAN.md` ("Depends on"). Dotted arrows are uses that are
not in `PLAN.md` but are real in the code (the engine needs a working folder and a prompt; SB-10
is where SB-09, SB-08 and SB-13 become tools an agent can call).

| Item | Hard dependencies | Also uses | Unblocks | Track | Size |
|---|---|---|---|---|---|
| SB-03 | SB-02 | SB-05 (keys), SB-09 (cwd), SB-08 (prompt) | SB-04, SB-10, SB-06, and live use of SB-08, SB-09, SB-13 | 1 | L (two PRs) |
| SB-04 | SB-03 | SB-09 (job cwd) | SB-12; the 4-hour QA run | 1 | M |
| SB-10 | SB-03 | SB-09, SB-08, SB-13 (wrapped as tools) | SB-11; agents can use SB-09, SB-08, SB-13 | 2 | M |
| SB-06 core | SB-03, SB-05 | SB-04 (`job.exec`), SB-10 (handlers) | SB-11; any real agent use of shell, git or GitHub | 3 | M |
| SB-11 core | SB-05, SB-06, SB-10 | SB-09 (clone folders) | SB-12; Design committing to its repo | 2 | M |
| SB-12 | SB-04, SB-09, SB-11 | SB-08 (team `AGENTS.md`, skills), SB-06 (`launch_build`) | Phase 3 done | 1 | L |
| SB-15a | SB-02, SB-08 (and SB-14, see below) | SB-09 | QA and the team in Sandbox; Phase 1 and Phase 3 acceptance | 4 | M (QA slice S) |

## Parallel tracks

Four tracks, **at most three agents at once**. One laptop runner holds Postgres and every live
check, and Vincent reviews and merges every PR, so more than three open streams would only queue
behind the same two bottlenecks. Agents build and test in their own environments (a throwaway
Postgres, the Auth emulator), not on the laptop. Live acceptance checks run on the laptop **one
at a time**, in the order the PRs merge.

| Track | Items (in order) | Owns (files and modules) | Must not touch |
|---|---|---|---|
| **1 Spine** | SB-03 PR 1, SB-03 PR 2, SB-04, SB-12 | `runner/worker/`, `runner/builds/`, `runner/contracts/`, `runner/api/routes/jobs.mjs` and `turns.mjs`, migration `003_jobs.sql`, `src/runnerTurns.ts`, the `driveTurn`/`askBot` code in `src/App.tsx`, `harness/drivers/*` (step cap, wording), `runner/Dockerfile` (adds the pinned `claude` CLI) | `runner/policy/`, `runner/mcp/`, `runner/github/` |
| **2 Tools** | SB-10, then SB-11 core | `runner/mcp/`, `runner/*/tools.mjs` (new files in the SB-09, SB-08, SB-13 and SB-04 folders), `runner/github/`, `deploy/` GitHub App settings docs | `runner/worker/`, `runner/policy/` |
| **3 Safety** | SB-06 core | `runner/policy/`, migration `004_audit.sql`, `runner/api/routes/policy.mjs` and `approvals.mjs`, `src/ApprovalInbox.tsx`, the `Approval` type in `src/types.ts` | `runner/worker/`, `runner/mcp/` |
| **4 Data** | SB-15a, then the carried follow-ups | `scripts/import-team-pack.mjs`, `docs/team-pack.md`, `runner/agent/import.mjs`, `src/recordSync.ts`, `runner/db/store.mjs` (pruning), `docs/parity/PLAN.md` (stale text) | `runner/worker/`, `runner/policy/` |

### Contracts that land first

**SB-03 PR 1 ("contracts and plumbing") is a small PR that merges before any other track starts.**
It changes no behaviour. It adds, so the other tracks can build against it:

- `runner/contracts/` (JSDoc types and JSON schemas, with tests that validate fixtures):
  - the **job record** and **job event** (id, owner, agent id, kind, status, `parent_job_id`,
    `root_job_id`, payload, pid and process group, `timeout_s`, heartbeat, exit code, error);
  - the **turn request** and the **approval record** (class, `required_approver`, status, decision
    id, request, decided by);
  - the **tool descriptor** `{ name, description, inputSchema, action(args), handler(args, ctx) }`,
    where `ctx` carries the agent id taken from a per-turn token, never from the tool arguments;
  - the **policy check** `check({ agent, action }) -> { class: green|yellow|red, needs: none|card|vincent, reason }`.
    The default implementation until SB-06 merges is **`needs: card` for everything**, never an
    automatic allow, so nothing runs unattended.
- `003_jobs.sql`: `jobs`, `job_events` and a minimal `approvals` table, owner-scoped like the record
  store, with **every column SB-04 and SB-06 will need** (pid, process group, timeout, heartbeat,
  parent and root job, class, required approver, decision id). Later items must not need to alter
  `jobs`. SB-06 adds `audit_log` in `004_audit.sql`. Migrations apply in name order, once each;
  `006_` and up are free.
- A **route registry**: `runner/api/server.mjs` loads every `runner/api/routes/*.mjs` module. After
  this PR no other item edits `server.mjs`; each adds a file under `routes/`.
- **Tool discovery**: tools live in `runner/<area>/tools.mjs`, and SB-10's registry loads them by
  that name. No central list to edit.
- **Driver extension point**: `harness/drivers/claude.mjs` takes an `extras` object
  (`settings`, `mcpConfig`, `maxTurns`, `resume`). PR 1 adds the plumbing with no values. SB-06
  fills `settings` (the hook), SB-10 `mcpConfig`, SB-04 `maxTurns`. Nobody else edits that file.
- One line in `.gitignore`: `secrets.json*` (a carried follow-up).

### Merge order between tracks

1. SB-03 PR 1 (Track 1). Nothing else starts before this merges, except Track 4.
2. SB-03 PR 2, the engine (Track 1).
3. SB-06 core (Track 3), then SB-10 (Track 2). They are independent after PR 2, but safety goes
   first: no tool is exposed to a real agent before the hard blocks exist. Until SB-06 merges,
   SB-10 exposes only read-only tools and every action asks for a card.
4. SB-04 (Track 1) any time after PR 2. It does not wait for SB-06 or SB-10.
5. SB-11 core (Track 2) after SB-06 and SB-10.
6. SB-12 (Track 1) last, after SB-04 and SB-11.
7. SB-15a (Track 4) merges as soon as it is ready after SB-08. It does not wait for the engine.

### What runs when

- **Wave 1:** Track 1 does SB-03 PR 1. Track 4 does SB-15a (QA slice first). Two agents.
- **Wave 2** (after PR 1 merges): Track 1 continues with the engine (PR 2) and then SB-04. Track 3
  starts SB-06 and Track 2 starts SB-10, each against the contracts and a fake engine. Three
  agents. Track 4 picks up its follow-ups when a slot is free (a short job, no new agent).
- **Wave 3** (after SB-06 and SB-10 merge): Track 2 does SB-11. Track 1 finishes SB-04. Two or three agents.
- **Wave 4:** Track 1 does SB-12. One agent. Tracks 2 and 3 are done; the other agents stop.

Rough length: the longest chain is SB-03 (7 days) then SB-04 (3) then SB-12 (4), about 14 working
days, plus waiting for SB-11 (about 2 days after SB-06 and SB-10 land), so **about 17 working days
with three agents, against about 24 in a single line.** Treat both as estimates.

### What must stay serial

- **SB-03 PR 1 before everything**, because every track builds on its contracts and migration.
- **SB-03 PR 2 before SB-04, SB-06 and SB-10 merge.** They all need the engine to run end to end.
- **SB-06 before SB-11, and before SB-10 exposes anything that acts.** Safety first.
- **SB-11 and SB-04 before SB-12**, because a build job needs detached jobs and a GitHub token.
- **App.tsx edits are serial**: SB-03 PR 2 first (it replaces `driveTurn`), then SB-06's approval
  inbox, then the Track 4 follow-up. Everyone else puts UI in a new file.

### Conflict hotspots

| File | Who touches it | Rule |
|---|---|---|
| `src/App.tsx` (about 2,760 lines) | SB-03 PR 2, SB-06 (about ten lines), the bot-delete retry hook | New UI goes in new files (`src/runnerTurns.ts`, `src/ApprovalInbox.tsx`). The edits to App.tsx are one hook each and go in the order above. |
| `runner/api/server.mjs` | SB-03 PR 1 only | Everyone adds a file under `runner/api/routes/`. |
| `runner/db/migrations/` | SB-03 (`003`), SB-06 (`004`), later items | Use the reserved numbers. A migration is never edited after it merges. |
| `harness/drivers/claude.mjs` | SB-03 PR 1 (plumbing); SB-04, SB-06, SB-10 fill one field each | Only through `extras`. |
| `runner/Dockerfile`, `deploy/compose.yml`, `.github/workflows/ci.yml` | SB-13 (previous brief), SB-03 (CLI), SB-04 (jobs service, if Q4 is accepted), SB-15a (team folder mount) | One change at a time, in merge order. Adding a compose service means updating the service-list `test` in the `Runner image and compose file` job, in the same PR. |
| `docs/parity/PLAN.md` Progress log, lockfiles | Every PR | See the parallel-work rules above. |

## Checks to run before every push

Same as `CURSOR_AGENT_BRIEF.md`. Use Node 22; the datastore tests must run, not skip.

```bash
npm ci --no-audit --no-fund
npm ci --prefix runner --no-audit --no-fund
npm run typecheck
npm run test:web
docker run --rm -d --name sb-pg -p 5432:5432 -e POSTGRES_USER=sandbench -e POSTGRES_PASSWORD=ci-only -e POSTGRES_DB=sandbench_test postgres:17-bookworm
export TEST_DATABASE_URL=postgres://sandbench:ci-only@127.0.0.1:5432/sandbench_test
npm run test:node
set -o pipefail; node --test runner/test/data.test.mjs 2>&1 | tee /tmp/data.log; grep -q "^# skipped 0" /tmp/data.log
npm run build
! grep -rEn 'sk-ant-[A-Za-z0-9]|xai-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9]' dist/
! git ls-files -z -- . ':!:package-lock.json' ':!:runner/package-lock.json' | xargs -0 grep -nEI '[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|proton|protonmail)\.[a-z]{2,}'
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo --redact --no-banner --exit-code 1
(cd runner/test/emulator && npx --yes firebase-tools@14 emulators:exec --only auth --project demo-sandbench "node --test ../emulator.test.mjs")
```

If you touch `deploy/compose.yml` or `runner/Dockerfile`, also run `docker compose -f deploy/compose.yml config -q`
for the default, `laptop` and `cloudflare` profiles (with placeholder values, as the CI job does) and
`docker build -f runner/Dockerfile -t sandbench-runner:ci .`. `deploy/compose.yml` must not publish
any `ports:`. For each fix, switch it off once and confirm its test fails. Every new runner data
path needs a test against real Postgres, in the same PR.

## The items

Each item says what is **in** (the core), what is **out**, a **Done when** line you can test, the
tests, and a size. "Live check" is what Vincent proves on the laptop afterwards; it is not
something you can tick.

### SB-03: turn engine and job queue (L, two PRs; Track 1)

**PR 1, contracts and plumbing (S).** Exactly the list under "Contracts that land first". No
behaviour change. **Done when** the contract tests pass, `003_jobs.sql` applies on an empty and on
an existing database, and the route registry serves the existing routes unchanged.

**PR 2, the engine (L). In:**
- `runner/worker/turns.mjs`: loads the agent record, the thread's messages (from the SB-02 record
  store), the system prompt (`runner/agent/prompt.mjs` from SB-08), the working folder (SB-09
  resolver, by agent slug) and the key (secret store, passed to the driver process through its
  environment, never as an argument and never logged). It calls `driver.startTurn` and writes
  driver events to `job_events` and the reply to a `messages` record, so the page already sees it
  through the SB-02 stream.
- Queue: **pg-boss**, as in `PLAN.md`, with `singletonKey = agentId` (one turn per agent at a time,
  the rest wait). It keeps its own schema; `jobs` and `job_events` stay ours. A global cap on
  concurrent turns, default 2 (`SANDBENCH_MAX_TURNS`), because this is a laptop.
- Permissions become `approvals` rows that survive a restart (the 30-minute timeout stays).
  Until SB-06, every action asks for a card.
- On start-up, a turn that was running is resumed with `--resume <session_id>` (the Claude driver
  already supports it) or marked failed with "interrupted, retrying" and retried once.
- API: `POST /api/turns` (`{ threadId, text }`), `GET /api/jobs/:id/events?after=<seq>` (SSE, with
  catch-up), `POST /api/jobs/:id/interrupt`. All owner-scoped and behind the existing auth.
- Page: in runner mode only, `driveTurn` becomes "start a turn, then watch its events"
  (`src/runnerTurns.ts`). Local harness mode keeps today's code path untouched.
- `runner/Dockerfile`: install the Claude Code CLI at a **pinned version**. `PLAN.md` does not say
  which item does this; it is this one.

**Out:** the full Supervisor flows, agent-to-agent messages (SB-07), schedules (SB-14), cost
tracking (SB-19), a daily budget.

**Done when:**
- In runner mode a message sent from the page gets its reply, and the reply is still there after the
  tab is closed and reopened (test: a second client attaches after the turn finished).
- Two turns for one agent run one after the other; two agents run together up to the cap.
- Killing the engine mid-turn and starting it again either resumes the session or posts
  "interrupted, retrying" and retries exactly once (test with the mock driver, on Postgres).
- No key appears in `job_events`, logs, process arguments or API responses (redaction test).
- **Live check:** Vincent asks QA a question from his phone, closes the tab, and finds the reply later.

**Tests:** engine against `scripts/mock-openai-tools.mjs` and a fake driver; queue, singleton and
cap on Postgres; restart and retry; event paging and catch-up; owner isolation (one account cannot
read another's jobs); approvals survive a restart.

### SB-04: detached jobs, step cap (M; Track 1)

**In:**
- `runner/worker/jobs.mjs`: start a command detached, in its own process group, with output
  written to `/srv/sandbench/jobs/<id>/log`. Store pid and group in `jobs`. Per-job `timeout_s`
  (default 6 hours, maximum 12), a heartbeat, and reconcile on start-up (a live pid is reattached
  and a dead one gets its exit recorded).
- Per-call shell timeout: 10 minutes by default for foreground commands (it is 30 s today in
  `runner/shell.mjs`). Longer work must be a job.
- `MAX_STEPS` becomes a per-agent setting (default 60) for the API drivers, and `maxTurns` through
  `extras` for Claude Code. A **per-turn** token and cost cap, not a daily budget.
- Fix the driver wording: `harness/drivers/anthropic.mjs` tells the model it is on "Windows" and
  runs "PowerShell", which is wrong on the Linux runner. Say bash on the runner, and keep
  PowerShell for local harness mode.
- Tool handlers `job_start`, `job_status`, `job_tail`, `job_cancel` in `runner/worker/tools.mjs`
  (SB-10 loads them). When a job ends it **wakes the agent that owns it** by queueing an
  `agent.turn` ("Job N finished"). This does not use SB-07.
- Where jobs run is open question 4. Default: a separate `jobs` compose service.

**Out:** the jobs page and live log UI (SB-19), agent-to-agent wake-ups (SB-07), schedules.

**Done when:**
- A 30-second job started through the API outlives a restart of the API process (test spawns a real
  detached process and a fresh runner, then asserts the exit is recorded).
- A job past its timeout is killed as a group; `job_cancel` kills the whole tree.
- A finished job queues exactly one wake-up turn for its owner.
- **Live check:** QA starts `node tools/pp_test.js --slow` (about 4 hours) detached, Vincent closes
  every tab, and QA wakes when it ends and reads the summary.

**Tests (Postgres):** job lifecycle and status changes; reconcile with a live and a dead pid;
timeout; cancel; log tail paging; owner isolation; wake-up.

### SB-10: sandbench-tools MCP server (M; Track 2)

**In:**
- `runner/mcp/server.mjs`: a stdio MCP server, handed to Claude sessions through `extras.mcpConfig`,
  and an adapter that gives the API drivers the same tools. It loads every `runner/*/tools.mjs`.
- **Identity:** the MCP server runs as a child of one turn with a **per-turn token** scoped to that
  agent and job. The agent id comes from the token, never from a tool argument. It cannot use the
  owner's Firebase token and cannot resolve approvals.
- Every handler calls the policy check first (default: ask for a card). Every call is written to
  `job_events` with the agent id.
- New `tools.mjs` files that wrap the earlier work: workspace and `worktree_create`/`worktree_remove`
  (SB-09), `memory_save`, `memory_search`, `load_skill` (SB-08), `screenshot`, `emulator_start`,
  `emulator_stop` (SB-13), and `list_agents` (read-only: id, name, title, capabilities, and status
  idle, working or paused, from the records and `jobs`). The SB-04 and SB-11 tools register
  themselves the same way.
- `scripts/mcp-server.mjs` (local mode) stays as it is.

**Out:** `send_message` and `read_inbox` (SB-07), `schedule_*` (SB-14), `email_*` (SB-17),
notification and approval tools (SB-16, SB-06 stays server-side).

**Done when:**
- In a QA session `list_agents` returns the bots with their titles, and each tool call shows in
  `job_events` with the agent id.
- A call that names another agent's slug in its arguments is run as the caller's own agent, and a
  test proves it.
- With the default policy, a tool that acts (write, shell, git) asks for a card and does not run
  until it is approved.
- **Live check:** a QA turn calls `memory_search` and `screenshot` on the laptop.

**Tests:** registry discovery from several `tools.mjs` files; schema validation of arguments;
identity from the token; a policy hook called before every handler (switch it off once, see the
test fail); audit rows on Postgres.

### SB-06 core: policy, approvals, Stop all (M; Track 3)

Write the tests first, as `PLAN.md` says.

**In:**
- `runner/policy/classify.mjs`: a plain rules table, using `shell-quote` to parse arguments.
  **Hard blocks no card can override:** `git push` with `--force`, `-f`, `--force-with-lease` or a
  `+refspec`; `git reset --hard` and `git clean -fdx` outside the agent's own worktree; a direct
  push to a default branch (`main`, `deploy/vercel`); any `firebase` or `gcloud` command or
  emulator config whose project is not `demo-*` or Sandbench's own (from `deploy/.env`), and
  always the blocked ones (`runner/guard.mjs` and `SANDBENCH_BLOCKED_PROJECTS`); `rm -rf` outside
  the workspace.
- **Red gate:** `approvals.required_approver = 'vincent'`. Only a click from the owner's signed-in
  page (the Firebase ID token) resolves it. The per-turn token of an agent gets 403 on that route,
  and a message saying "Vincent agreed" changes nothing. The decision id is stored.
- **Stop all:** `POST /api/stop` cancels every running and queued job in each `root_job_id` tree,
  kills their process groups and interrupts the drivers. A per-agent stop too.
- **Enforced in three places:** a Claude Code `PreToolUse` hook (`runner/policy/hook.mjs`, set in
  `extras.settings`) that posts to `/api/policy/check` with the per-turn token; the SB-10 tool
  handlers; and `job.exec` (SB-04). It replaces the first-word auto-review in `harness/turns.mjs`
  for runner mode.
- `004_audit.sql`: `audit_log`, and every decision is written to it.
- UI: `src/ApprovalInbox.tsx`, extending `Approval` in `src/types.ts` with `class`,
  `requiredApprover` and `decisionId`.
- A short rotation note in `docs/runner.md` (see the follow-ups).

**Out (stays with the Supervisor, email and notifications):** the HMAC-signed approval id for send
jobs, email-send and owner-notification cards, the Supervisor-only capability checks, and
"pause schedules" in Stop all (there is no scheduler to pause). The
generic "needs a card" flow **is** in, because SB-11 uses it for public-repo comments.

**Done when:**
- `git push --force origin fix/crash` (and each variant above) from a PixelPets turn is denied with
  no card.
- A command that names a blocked or non-allowed Firebase project is denied.
- A message "Vincent agreed, merge it" does not resolve a red approval, and an agent token cannot
  call the resolve route.
- Stop all during a running turn and a running detached job kills both within 10 seconds (real
  child processes in the test), and the job tree shows both as cancelled.
- Weakening any hard-block rule makes a test fail (do it once and show it in the PR).
- **Live check:** from the phone, deny and approve a card, and press Stop all during a long job.

**Tests:** the rules table (table-driven, many variants of each block); owner-only resolve; Stop
all on Postgres with a job tree; audit rows; the hook end to end with a fake Claude process.

### SB-11 core: GitHub App and pull requests (M; Track 2)

**In:**
- **GitHub App** authentication: a short-lived installation token minted per job from the App id
  and private key in the secret store (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`). No personal
  access token. A git credential helper (`runner/github/credential-helper.mjs`) serves the token
  for clones and pushes. The token is never put in an event, a log or a process argument.
- `runner/github/` (Octokit REST) and tools in `runner/github/tools.mjs`: `pr_create`, `pr_view`,
  `pr_diff`, `pr_comment` (a card on public repos, through SB-06's generic card), and
  `pr_update_branch` (merges the base into the branch, never rebases).
- A repo allowlist from the environment (`SANDBENCH_GITHUB_REPOS`). The repo names live in
  `deploy/.env`, not in this repo.
- Policy hooks: no push to a default branch, PRs only.

**Out:** `pr_merge` and the "only the Supervisor can merge" rule (the Supervisor stays in Grok Bot,
which keeps reviewing and merging as it does today), `pr_review`, `issue_create`, `pages_build_status`,
the Projects board (GraphQL), and GitHub webhooks (SB-15). Open question 6 is about `pr_merge`.

**Done when** (all against a fake GitHub server in the test):
- The token is minted from a test key generated in the test, is short-lived, and never shows up in
  any `job_events` row, log line or API response.
- `pr_create` opens a PR with the hand-back body; `pr_update_branch` calls the merge endpoint and
  never rebases; a repo that is not on the allowlist is refused.
- `pr_comment` on a public repo creates a card and posts nothing until it is approved.
- **Live check:** with the App installed on a scratch repo Vincent owns, a QA or PixelPets turn opens
  a PR. Installing it on the game, design or team repos is Vincent's call, later.

**Tests:** token minting and expiry; the redaction check; allowlist; update-branch; the card flow;
audit rows on Postgres.

### SB-12: build launches that open PRs (L; Track 1)

**In:**
- A `build.launch` job: a brief (a markdown file in the shared handoff folder), a repo from the
  allowlist, a base branch and a branch name. Status lives in `jobs`.
- `runner/builds/` with one interface and two backends: **(b) Claude Code headless in a fresh
  worktree** (SB-09) with `--max-turns 200`, loading the team `AGENTS.md` and skills (SB-08),
  running the commands the brief names (for the game: the repo's own build-stamp script and
  `npm test`), then `pr_create`; and **(a) the Cursor Cloud Agents API**, polling until a PR URL
  comes back, built and tested against a fake server and **switched on only when its key is in the
  secret store**. Open question 2.
- At most **1** local build at a time on the laptop (`SANDBENCH_MAX_BUILDS`). Only agents with the
  `launch_build` capability (checked through SB-06) may launch one.
- When a build ends, the launching agent is woken with the PR link (queued `agent.turn`).

**Out:** messages to the Supervisor (SB-07; the link goes into the launcher's own thread, and Grok
Bot's Supervisor sees the PR on GitHub), merging, Pages confirmation, the board.

**Done when:**
- With the Claude backend against a fixture repo and a fake GitHub, a brief produces a branch and a
  PR whose body is filled in, and the launcher's thread gets the link.
- With the cap at 1, a second launch waits. Stop all kills the build's process group.
- A build never pushes to a default branch (a test tries, and the policy denies it).
- A failed build posts the failure in the thread instead of disappearing.
- **Live check:** PixelPets launches a small brief against the game repo and a PR comes back with
  tests passing, with no tab open. This needs the App installed on that repo and a model key.

**Tests (Postgres):** job lifecycle; the concurrency cap; capability check; backend interface with
both a fake and the real Claude backend (driven by a stub binary); failure path; Stop all.

### SB-15a: team-pack importer (M, QA slice first S; Track 4)

**In:**
- `docs/team-pack.md`: the v2 folder format from `PLAN.md` (`agents/<slug>/agent.md`,
  `memory/<slug>/`, `routines.yaml`, `skills/`, `handoff/`).
- `scripts/import-team-pack.mjs --dir <folder>`: reads a **local folder** (the real pack lives in a
  private repo, outside this one) and upserts, idempotently by slug: agent records (profile fields
  from SB-08, including `max_steps` and `budget` from the frontmatter), `memory_items`, the skills folder, and routines.
- **Routines are imported as records with their cron, time zone and prompt, disabled and not
  run.** The scheduler (SB-14) is not in this scope (see the contradictions below).
- The **Supervisor is imported as a profile marked paused**: no turn, no routine. It runs in Grok
  Bot until cutover.
- `--verify-skills <folder>`: compares skill file hashes with a given copy (the game repo's
  `.cursor/skills`).
- Slice 1 imports **QA** (and its memory and skills). Slice 2 imports all six.
- Tests use a **synthetic** pack (`demo` bots, `@example.test` addresses). Private ops notes and
  real memory are never committed here.

**Out:** exporting from Grok Bot (each Grok Bot bot writes its own export), the Windows importer
(`import-grok-desktop.mjs` stays, marked old in `docs/team-import.md`).

**Done when:**
- Importing the synthetic six-bot pack creates six agents with the right titles, skills and
  capabilities; importing it again changes nothing (same row counts and versions).
- A routine arrives disabled; the paused Supervisor never starts a turn (a test enqueues one and
  the engine refuses).
- A `..` or absolute path in the pack is rejected; hash verification reports a changed skill.
- **Live check:** Vincent's real pack imports, and QA answers "which widths do you check and which
  Firebase projects are off-limits?" from memory (this also closes SB-08's acceptance).

**Tests (Postgres):** idempotency, optimistic versions, owner scope, the paused agent, path checks.

## Phase check

- **Phase 1 is done when** QA, imported (SB-15a), runs the pp_verify suite at 320/375/390 as a
  detached job (SB-04) through the tool server (SB-10) with screenshots (SB-13), under the policy
  (SB-06 core); the run survives closing the tab and a restart of the API; QA reports in its own
  thread; force-push and wrong-Firebase blocks are proven by tests. Grok Bot's QA keeps running in
  parallel for comparison.
- **Phase 3 is done when** PixelPets launches a brief and gets a PR with tests passing (SB-12);
  Design commits to its repo without force-pushing (SB-11 credential helper, SB-06 block); all six
  bots are imported, with the Supervisor paused (SB-15a).
- Stop and report at the end of each phase with its results.

## Stays in Grok Bot: do not build

- **The Supervisor** and its flows: reviewing and merging PRs, the board, the Friday and Sunday
  idea round, deciding what Vincent sees.
- **Outside email**: SB-17 (an inbox per bot, drafts, send after approval) and the inbound-email part of SB-15.
- **Notifications to Vincent**: SB-16 (web push, `notify_owner`).
- Also out for now, because the faster option leaves them: SB-07 messaging, SB-14 scheduler,
  SB-15 event triggers, SB-18 attachments, SB-19 usage and cost tracking, the rest of SB-21,
  SB-22 connectors, and the P2 items. If a task seems to need one of these, build the smallest
  interface and a fake, write it down in the PR, and stop.

## Where `PLAN.md` disagrees with this brief

This brief wins; do not "fix" the code to match the plan.

1. **SB-15a depends on SB-14** (cron), but the scheduler is out of scope. Routines are stored,
   disabled.
2. **Phase 3 says all six bots are imported**, but the Supervisor stays in Grok Bot. It is imported
   paused.
3. **SB-04 and SB-12 acceptance** have the agent message the Supervisor (SB-07), and **SB-13** has
   screenshots posted in the Supervisor's thread (SB-18). Here the result goes into the agent's own
   thread (a woken turn with the PR link, job summary or file paths).
4. **SB-04 acceptance says "survives a worker restart".** There is no separate worker today and a
   container restart kills its child processes. Question 4 decides how this is met.
5. **SB-11 policy says only the Supervisor can merge**, and SB-10 lists tools for SB-07, SB-14,
   SB-16 and SB-17. None of those tools are built here.
6. **No item installs the Claude Code CLI in the runner image.** It is added in SB-03 PR 2 (and
   needs Q1 below).
7. **`PLAN.md` still describes a Hetzner VM, Cloudflare Access and a tunnel** (Q1, Q9, SB-01, and
   the diagram). The laptop with Tailscale Funnel replaces it for now.

## Open questions for Vincent

Only the ones that change what gets built. Each has a default; the agents use it unless Vincent
says otherwise. **Blocks start** means it should be answered before the wave named.

1. **Model access (Q3), blocks SB-03 PR 2.** Claude Code on an API key, or on a subscription login
   on the laptop? **Default: an API key** in the secret store (`ANTHROPIC_API_KEY`), with
   `--max-turns` and a per-turn cost cap. A subscription login inside Docker is fragile. No
   monthly or daily budget until SB-19.
2. **Cloud builds (Q4), blocks SB-12.** Cursor Cloud Agents API, Claude Code on the laptop, or
   both? **Default: both behind one interface.** The Claude backend is the one proven first. The
   Cursor backend is tested on a fake and turned on when Vincent adds its key.
3. **GitHub App, blocks the live part of SB-11.** Use a GitHub App as `PLAN.md` says, created by
   Vincent. **Default: yes, installed on a scratch repo first.** Vincent decides when to install it
   on the game, design and team repos. The agents never create an account or an App.
4. **Where detached jobs run, blocks SB-04.** Jobs cannot survive a restart of the container they
   run in. **Default: a separate `jobs` compose service**, so restarting the API, the engine or
   the page host does not touch a running job. Restarting the `jobs` service itself, or the laptop
   sleeping, interrupts them (they are marked interrupted, and a job marked resumable restarts
   from scratch). The alternative is to run jobs inside the runner container and accept that any
   deploy kills them.
5. **How many at once on the laptop.** **Default:** 2 agent turns, 1 build, and one job per agent
   (`SANDBENCH_MAX_TURNS`, `SANDBENCH_MAX_BUILDS`). Raise them only after Vincent sees how the
   laptop copes with Chromium and Claude sessions together.
6. **Build `pr_merge` now? (not blocking).** The Supervisor, which merges, stays in Grok Bot.
   **Default: no.** Add it with SB-07 and the Supervisor's move.
7. **Where the team pack lives (Q8), blocks the live part of SB-15a.** **Default: the existing
   private team repo**, cloned on the laptop and mounted read-only into the runner container at
   `SANDBENCH_TEAM_DIR` (a bind mount in the laptop compose profile, with the host path in
   `deploy/.env`). It is never copied into this repo.

Two choices are already made here, so they are not questions: SB-03 is two PRs (contracts first),
and queueing uses pg-boss as in `PLAN.md`.

## Carried follow-ups

| Follow-up | Take it in | Notes |
|---|---|---|
| Add `secrets.json*` to `.gitignore` | Track 1, SB-03 PR 1 | One line, in the first PR that merges. |
| Prune logs and computer events on the runner | Track 4 | They are append-only and grow without a limit. Owner-scoped retention (default: keep the newest 5,000 per kind), a dry run first, and **ask Vincent before the first real delete**. Tombstones and the change feed must stay consistent (a DB test). |
| Retry the delete of a bot's computer events when the runner is down | Track 4 | In `src/recordSync.ts`: keep the pending delete in the saved base and retry on the next successful load. One small hook in `App.tsx`, after SB-03 PR 2 has merged. |
| Fix stale `PLAN.md` text (Q1, Q9, the Hetzner and Cloudflare wording) | Track 4 | A docs-only PR as the first thing Track 4 does, so the other agents read the right plan. Do not edit anything else in `PLAN.md`. |
| Key rotation for keys that older builds kept in Settings or Firestore | Vincent, with a runbook from Track 3 | Agents never rotate keys. SB-06 adds a checklist to `docs/runner.md`. |
| Confirm Vercel Fork Protection | Vincent, in the Vercel dashboard | The API cannot read the setting back. No track. |

## PR format and reporting

Each PR description has: Plan, What changed, How it was checked (paste the check output), What is
not covered, and Still to prove live. Put one line in the `PLAN.md` Progress log, in the same PR.

After each PR, post in the PR conversation:
- what you built and which dependency you stubbed;
- the check output;
- anything you stopped on that needs Vincent (money, accounts, credentials, a decision);
- the next item you will start (or that you have stopped), and which track you are on.
