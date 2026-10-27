# WORKPLAN: Tue Oct 27 → Thu Oct 29 morning, 2026 (Claude Code, working alone)

Source of truth for the next sessions. Vincent pastes `SESSION_PROMPT.md`; Claude does the **first unchecked
task whose dependencies are merged**, one task per session, one PR per task. Rules and STOP points:
`STOP_POINTS.md`. Per-PR steps and commands: `PR_CHECKLIST.md`. Log: `WORKLOG.md`. Dashboard: `STATUS.md`.

**Authority.** Where this file disagrees with `PLAN.md`, `CURSOR_AGENT_BRIEF.md`, `NEXT_PHASE_BRIEF.md` or
`CLAUDE_CODE_PROMPT.md`, **this file wins** (and say so in the WORKLOG entry). The known disagreements are in §2.

## 0. How a session runs

1. Read the docs listed in the prompt. `git fetch origin`; `gh pr list --state all --limit 20`.
2. If a task you did last time is now merged: tick its box here (`- [x]`), set it to `merged` in `STATUS.md`.
   (That edit rides in your next task's PR; it is allowed in `WORKPLAN.md` and `STATUS.md`.)
3. Pick the first unchecked task whose **Depends** are merged. "Merged" means in `origin/deploy/vercel`.
   If it depends on an open PR, take the next task marked **Independent**. If none is left, write STATUS and
   WORKLOG ("waiting for Vincent to merge #N") and end the session.
4. Follow the task. Run `PR_CHECKLIST.md`. Open the PR. Write WORKLOG and STATUS. Wait for the checks.
5. Never start a second task in a session that hit a STOP. A session that finishes early may start the next
   Independent task only if the first one's PR is open and green; otherwise end.
6. Order of work Tue → Thu: T01 → T02 → T03, then T04 → T05 → T06 → T07 → T08 → T09, then T10 (stretch).
   Expect Vincent to merge in between; do not wait idle if an Independent task is available.

**Size key** (Claude working time, not calendar): S = under 2 h, M = 2-5 h, L = 5-10 h. If a task passes
1.5x its estimate, STOP point 11.

## 1. What every task shares

- Repo layout (verified on `deploy/vercel` at `84a3c17`):
  `runner/{main.mjs,shell.mjs,guard.mjs,api/{server,data,http,auth,static}.mjs,db/{migrate,store}.mjs,db/migrations/001_init.sql,test/*.test.mjs,Dockerfile}`,
  `harness/{turns.mjs,secrets.mjs,server.mjs,drivers/{claude,anthropic,http,find-bin}.mjs,test/*.test.mjs}`,
  `src/{App.tsx,types.ts,work.ts,recordSync.ts,...}` (the page), `deploy/{compose.yml,.env.example,tailscale/serve.json}`,
  `docs/runner.md`, `docs/parity/*`.
- `createRunner({home, uiDir, allowedEmails, verifyIdToken, publicOrigin, allowedOrigins, store, secretsFile, env})`
  in `runner/api/server.mjs` is synchronous and builds the HTTP server; `runner/main.mjs` reads env, runs
  `migrate(sql)` and `createStore(sql)`, then calls `createRunner`. The runner must still **start with no
  `DATABASE_URL` and no secrets** (the CI image job requires `/api/health` → 401 on a bare container).
- The record store (`runner/db/store.mjs`): `KINDS`, owner-scoped (`owner` = Firebase uid), versioned (409 on stale),
  tombstones, `changes` feed, `ID = /^[A-Za-z0-9_-]{1,80}$/`; methods `list, get, create, patch, remove, changesSince,
  head, subscribe`; `get` throws `StoreError(404)` when missing.
- Migrations: files in `runner/db/migrations/` matching `^\d+_[\w-]+\.sql$`, applied once each in name order under an
  advisory lock, tracked by name. `runner/test/data.test.mjs` asserts `migrate(sql)` equals the full list, so **every
  migration PR edits that assertion**.
- Test style: `node:test` + `node:assert/strict` for `runner/test/*.test.mjs` and `harness/test/*.test.mjs`; DB tests
  read `TEST_DATABASE_URL` and skip when it is unset (so you must set it, `PR_CHECKLIST.md` §C step 4);
  vitest for `src/**/*.test.ts(x)`.
- Auth is the runner's job and **not yours** (STOP point 1). New routes just receive `user` (`{uid, email}`) from the
  existing dispatcher; they never read tokens.
- "Standard checks" below means `PR_CHECKLIST.md` §C steps 1-5, 3 (build), 8 and 9. Add step 7 (compose and image) whenever the task touches `runner/Dockerfile`, `deploy/` or `runner/package.json`. Step 6 is for auth changes, which are a STOP point.

## 2. Known disagreements between the docs (handoff wins)

| Where | Says | This pack says |
|---|---|---|
| `PLAN.md` Q1, Q9, SB-01, diagram, SB-23 | Hetzner VM, Cloudflare Tunnel as the plan | The runner is on Vincent's laptop via Tailscale Funnel; no other host is planned (T05 fixes the text) |
| `PLAN.md` SB-05 | `runner/secrets.mjs` | The secret store is `harness/secrets.mjs` |
| `CLAUDE_CODE_PROMPT.md` step 6 | tick the box in the same PR | Never tick a box; only after a live check (STOP_POINTS rule 10) |
| Briefs | "report to Vincent in chat", "post in the PR" | A STOP is written in WORKLOG and STATUS and the session ends |
| `CURSOR_AGENT_BRIEF.md` | one agent, wait for PR #9 | #8 and #9 are merged (`02515f2`, `84a3c17`); this file sets the order |
| `NEXT_PHASE_BRIEF.md` contracts | policy result `{class, needs, reason}` | adds `blocked: boolean` (hard block, no card is offered) |
| `NEXT_PHASE_BRIEF.md` SB-15a done-when | "engine refuses a paused agent" | built in T10; T06 only sets `paused: true` (so SB-15a's engine check is pending) |
| `NEXT_PHASE_BRIEF.md` SB-06 | one PR | split: T08 = classifier and tests (not wired); the wiring PR is scheduled on Thursday |
| Briefs' CI rule | "do not change CI" | steps may be added **inside existing jobs** for the task's own tests (STOP_POINTS §3.4) |

## 3. Provisional decisions (Vincent has not answered; use these, never act on them)

Vincent skipped the question card. These are the defaults from `NEXT_PHASE_BRIEF.md` "Open questions for Vincent" (numbers 1-7 below are that list; `PLAN.md`'s own numbers are in brackets). Claude may **build behind
interfaces and fakes** using them, but must not do anything that needs Vincent's action (creating a GitHub App, adding or
using an API key, spending money). Real-key and real-GitHub behaviour is "pending live" in the PR body.

| Q | Provisional default | What Claude may do | What Claude must not do |
|---|---|---|---|
| Q1 (PLAN Q3) model access | Anthropic API key for the Claude CLI on the runner | Pass a key through the secret store (`harness/secrets.mjs`) when present; code reads `ANTHROPIC_API_KEY` | Create, request, store or use a key; call the API in tests |
| Q2 (PLAN Q4) cloud builds | Both Claude CLI and Cursor, Claude first | Driver interface and `extras` hook; Claude driver only | Build a Cursor driver |
| Q3 GitHub access | A GitHub App (not a personal token) | Define the `GitHubClient` interface and a fake | Create the App; add `GITHUB_APP_*`; call GitHub |
| Q4 jobs service | A separate `jobs` compose service later | Keep the engine importable as a module (`runner/jobs/engine.mjs`) so it can run in-process or in a service | Add a compose service (breaks the CI service-list test); it is SB-04 |
| Q5 caps | 2 agent turns, 1 build, one job per agent | `runner/jobs/limits.mjs` reads `SANDBENCH_MAX_TURNS` (default 2) and `SANDBENCH_MAX_BUILDS` (default 1) | Raise the defaults |
| Q6 `pr_merge` | Not now | Nothing | Any merge tool |
| Q7 (PLAN Q8) team pack | The existing private team repo, read on the laptop | Importer reads a directory path from `SANDBENCH_TEAM_DIR`; read-only mount in compose | Name, clone or read the private repo; commit any of its content |

## 4. Task index

| Id | Item | Depends (merged) | Branch | Size | Independent? |
|---|---|---|---|---|---|
| T01 | SB-09 workspaces and worktrees | none | `sb-09-workspaces` | M | yes |
| T02 | SB-08 profile memory and skills | T01 (shared `server.mjs`) | `sb-08-profile-memory` | L | no |
| T03 | SB-13 browser emulator | none | `sb-13-browser-emulator` | M | yes |
| T04 | SB-03 PR 1 contracts, `003_jobs.sql`, route registry | T02 (migration number, `server.mjs`) | `sb-03a-contracts` | M | no |
| T05 | `PLAN.md` stale host text, docs only | none | `docs-plan-laptop-text` | S | yes |
| T06 | SB-15a team pack importer | T02 | `sb-15a-team-pack-import` | M | no |
| T07 | Retry the runner-side bot-event delete | none | `sb-fu-bot-event-delete` | S | yes |
| T08 | SB-06 slice A: policy classifier + tests | none (pure code) | `sb-06a-classifier` | M | yes |
| T09 | Prune dry run for `logs` and `computer` rows | none | `sb-fu-prune-dry-run` | M | yes |
| T10 | SB-03 PR 2 turn engine behind a fake (stretch) | T01, T04 | `sb-03b-turn-engine` | L | no |

"Depends" is a sequencing rule (avoid merge conflicts), not always a code dependency.

---

## T01 · SB-09 per-agent workspaces and git worktrees

- [ ] **Merged** · Size **M** · Depends: none · Independent: yes · Branch `sb-09-workspaces`
- PR title: `SB-09: per-agent workspace paths and git worktrees`

**Touch (create):** `runner/workspace/paths.mjs`, `runner/workspace/worktrees.mjs`, `runner/workspace/index.mjs`,
`runner/test/workspace.test.mjs`, `runner/test/worktrees.test.mjs`.
**Touch (edit):** `runner/api/server.mjs` (use the resolver; nothing else), `harness/turns.mjs` (only: `start(body, ctx = {})` and
`resolveFolder(body.folder, ctx)`), `runner/shell.mjs` (only if you need to export a helper; keep `insideRoot` and
`createShell` behaviour), `docs/runner.md` (new "Workspaces" section), `docs/parity/PLAN.md` (one Progress log line), plus
`WORKLOG.md`/`STATUS.md`.
**Do NOT touch:** `src/**`, `runner/db/**`, `runner/api/data.mjs`, `runner/api/auth.mjs`, `runner/guard.mjs`,
`runner/Dockerfile`, `deploy/**`, `.github/**`, `harness/server.mjs` (the local harness keeps its own paths), drivers.

**Steps**
1. Read, before writing: `runner/shell.mjs` (`insideRoot(root, relative)`: lexical check only, no `realpath`;
   `createShell(workspace)`, 30 s default timeout), and in `runner/api/server.mjs` the lines that define `workspace`
   (`path.join(home, "workspace")`), `workspacePath`, the `createTurns({ runShell, secrets, resolveFolder })` call, and the routes
   `/workspace/read`, `/workspace/write`, `/exec`. Read `runner/test/server.test.mjs` tests for those routes: they must pass
   **unchanged**.
2. `paths.mjs`: export
   - `workspaceRoots(home)` → `{ legacy: <home>/workspace, shared: <home>/shared, agents: <home>/agents, wt: <home>/wt }`
     (all derived from `home`, which is `SANDBENCH_HOME`; no absolute literals);
   - `AGENT_SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/`;
   - `class WorkspaceError extends Error { code }` with codes `invalid | outside | forbidden`;
   - `resolveWorkspacePath(roots, agentSlug, requested, { write = false } = {})` returning an absolute path or throwing
     `WorkspaceError`.
   Rules (decisions, record them in the PR): `agentSlug === null` is the **owner context**: base is `roots.legacy`, exactly today's
   behaviour plus symlink and null-byte checks. A string slug (must match `AGENT_SLUG`) is an agent: a `requested` path starting
   `shared/` resolves under `roots.shared` (**read for everyone; write only under `shared/handoff/`**); starting `wt/<name>/` resolves
   under `roots.wt` and `<name>` must start with `<slug>-` for **read and write** (another agent's worktree is neither readable nor
   writable); anything else is relative to `roots.agents/<slug>/`. Reject: non-string, empty, longer than 240 chars, null byte,
   absolute paths (POSIX or `C:\`), backslashes, any `..` segment. After joining, check lexical containment, then compute
   `realpath` of the deepest **existing** ancestor and check it is inside `realpath(base)`. This catches a symlink inside an agent
   folder that points out. Do not create the target; callers `mkdirSync`.
3. `worktrees.mjs`: `createWorktrees({ roots, repos, exec })` returns `{ create, remove, prune }`.
   - `repos` is an allowlist `{ name: { path, base } }` parsed by exported `parseRepoAllowlist(text)` from
     `SANDBENCH_REPOS` (format `name=/abs/path[#base],name2=...`, base defaults to `origin/main`). **No repo names or paths in the
     repo**; tests build fixture repos in `fs.mkdtempSync(os.tmpdir())`.
   - `exec` defaults to `promisify(execFile)`. **Always `execFile("git", [args])`, never a shell string.**
   - `BRANCH = /^[A-Za-z0-9._/-]{1,100}$/` plus: no leading `-`, no `..`, no `//`, no trailing `/` or `.lock`.
   - `create({ agentSlug, repo, branch, base })`: validate; destination `roots.wt/<slug>-<branch with "/" replaced by "_">`; refuse if it
     exists; run `git -C <repo.path> worktree add -b <branch> <dest> <base>`; return `{ path, branch }`.
   - `remove({ agentSlug, name })`: `name` matches `^[A-Za-z0-9._-]+$` and starts with `<slug>-`; run `git worktree remove <dest>`
     (**never `--force`**); return `{ removed: true }`.
   - `prune({ olderThanDays = 7, now = Date.now(), dryRun = false })`: for each directory in `roots.wt`: find its repo
     (`git -C <dir> rev-parse --git-common-dir`), skip if not an allowlisted repo, skip if directory mtime is newer than the cutoff, skip
     if the branch is **not merged** (`git merge-base --is-ancestor <branch> <repo.base>` exit 0 means merged); otherwise remove with
     `git worktree remove <dir>` then `git branch -d <branch>` (**never `-D`**, never `--force`). Return `{ removed: [], kept: [{name, reason}] }`.
     Pruning real worktrees on Vincent's machine is not part of this PR (nothing calls `prune` yet).
4. `index.mjs` re-exports. In `server.mjs`: `const roots = workspaceRoots(home)`; `mkdirSync` the four roots; replace `workspacePath` by
   `const resolve = (rel, write) => { try { return resolveWorkspacePath(roots, null, rel, { write }); } catch { return null; } }` so the
   existing 400 responses and messages do not change; `resolveFolder: (folder, ctx = {}) => ...` uses `ctx.agentSlug ?? null`;
   call `turns.start(await readJson(req), { agentSlug: null })` with a comment: "SB-03 passes the slug from the job, never from the
   request body". A request body can never set `ctx`.
5. In `harness/turns.mjs` `start(body, ctx = {})` passes `ctx` to `resolveFolder(body.folder, ctx)`; nothing else changes. The harness
   server (`harness/server.mjs`) calls `start(body)` so it keeps working.
6. `docs/runner.md`: add "Workspaces" (roots, the rules, `SANDBENCH_REPOS` format with a fake example, what is still to prove live).

**Tests** (`node:test`, real `git`, `fs.mkdtempSync`; no DB needed)
- `workspace.test.mjs`: owner context behaves like before (inside OK; `..`, absolute, null byte refused; symlink to outside refused); agent
  reads `shared/` and its own folder; agent write to own folder OK; write to `shared/notes` refused, to `shared/handoff/x.md` OK;
  `agents/<other>/x` impossible to express (a request `../other/x` is refused); another agent's `wt/<other>-branch/` refused for read and
  write; bad slugs (`../x`, `A`, empty, 41+ chars) refused; **a body cannot choose a slug** (call `createRunner` via the existing test
  helper, send `{ folder: "../agents/other" }` and `{ agentSlug: "x" }` to `/api/turns` or `/api/exec`, expect 400/ignored).
- `worktrees.test.mjs`: two agents each `create` off the same fixture repo base; each commits in its own worktree and the other's
  checkout is untouched (`git status --porcelain` clean, file absent); QA reads `shared/handoff`; Design cannot write into
  PixelPets' worktree (use slugs `design` and `pixelpets` as test labels only); branch names `-x`, `a..b`, `a b`, `a;b`, `$(x)`, `a\nb`
  refused before any `git` call (assert with a fake `exec` that records calls); `prune` removes only merged worktrees older than 7 days
  (set mtime with `fs.utimesSync`) and keeps unmerged and young ones with a reason; `prune` with `dryRun` removes nothing; repos not
  on the allowlist are refused.
- **Mutation check** (brief rule): for each of the symlink check, the `..` check, the slug prefix check and the unmerged-prune check,
  disable it once, see the named test fail, restore it. Paste the four results.

**Commands:** Standard checks, plus `node --test runner/test/workspace.test.mjs runner/test/worktrees.test.mjs runner/test/server.test.mjs`.
**Done when:** the new and existing tests pass locally and in CI; the resolver is wired into the file and exec routes (owner context);
the PR says what is still to prove live: PixelPets and a review agent in real worktrees needs SB-03 (the slug) and SB-10.
**PR body extras:** list the two decisions (shared write only under `shared/handoff/`; other agents' worktrees unreadable).
**STOP if:** a test needs a real game or team repo; the `/workspace/*` or `/exec` tests in `server.test.mjs` need to change.

---

## T02 · SB-08 agent profile, skills and memory

- [ ] **Merged** · Size **L** · Depends: T01 merged (both edit `server.mjs`) · Independent: no · Branch `sb-08-profile-memory`
- PR title: `SB-08: agent profile fields, Postgres memory, skills reader, prompt builder`

**Touch (create):** `runner/db/migrations/002_memory.sql`, `runner/agent/memory.mjs`, `runner/agent/skills.mjs`, `runner/agent/prompt.mjs`,
`runner/agent/memory-import.mjs`, `runner/agent/memory-backup.mjs`, `runner/api/memory.mjs`, `runner/test/memory.test.mjs`,
`runner/test/skills.test.mjs`, `runner/test/prompt.test.mjs`, `deploy/team-empty/.gitkeep`.
**Touch (edit):** `runner/api/server.mjs` (mount the memory routes next to `dataRoute`; new options `memory`, `teamDir`),
`runner/main.mjs` (build `createMemory(sql)` when `DATABASE_URL`, read `SANDBENCH_TEAM_DIR`), `src/types.ts` (optional `Bot` fields),
`runner/test/data.test.mjs` (the migration list), `.github/workflows/ci.yml` (**one extra DB-test line inside the existing step
"The datastore tests ran (not skipped)"**, nothing else), `deploy/compose.yml` (the read-only team mount, below), `deploy/.env.example`
(two commented lines), `docs/runner.md`, `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `harness/server.mjs` (the old `/bots/:id/memory` route stays), `src/App.tsx`, `runner/api/data.mjs`, `runner/db/store.mjs`,
`runner/db/migrate.mjs`, `001_init.sql`, `runner/api/auth.mjs`, `runner/guard.mjs`, `runner/Dockerfile`.

**Steps**
1. Read `runner/db/migrate.mjs` and `001_init.sql` (owner column, tables, indexes), `runner/db/store.mjs` (`checkId`, `ID`, owner scoping),
   `runner/test/data.test.mjs` (how it builds a throwaway schema from `TEST_DATABASE_URL`, and the `migrate(sql)` deepEqual).
2. `002_memory.sql` (additive only):
   `memory_items(id bigserial primary key, owner text not null, agent_id text not null, kind text not null check (kind in ('profile','journal')),
   text text not null check (length(text) between 1 and 8000), created_at timestamptz not null default now(),
   source_hash text, tsv tsvector generated always as (to_tsvector('english', text)) stored)`; a unique index on `(owner, agent_id, source_hash)` (nulls repeat freely, imported rows carry a hash); index `(owner, agent_id, kind, created_at desc)`; GIN index on `tsv`.
   Check `agent_id` against the same `ID` regex in code.
3. `memory.mjs`: `createMemory(sql)` → `{ save({ owner, agentId, kind, text }), search({ owner, agentId, query, kind, limit = 10 }), recent({ owner, agentId, kind, limit }),
   profile({ owner, agentId }) }`. Search uses `websearch_to_tsquery('english', $q)` with `ts_rank`; limit 1-50. Every query filters on `owner`
   **and** `agent_id` (an agent never reads another agent's memory; owner never crosses). Use `postgres`'s tagged templates (no string
   concatenation); this is how `store.mjs` does it.
4. `skills.mjs`: `createSkills({ dir })` → `{ index(), loadSkill(name) }`. `dir` = `SANDBENCH_TEAM_DIR`. Read `<dir>/.claude/skills/*/SKILL.md` **on every
   call** (no cache). Name must match `^[a-z0-9][a-z0-9-]{0,60}$` and be a real directory directly under `skills/` (`lstat`, not a symlink
   out of the tree: `realpath` must stay inside `<dir>/.claude/skills`). Parse the front matter `name:` and `description:` lines; if absent, use the
   directory name and the first non-empty body line. If `dir` is empty or missing return `[]`/`null` (no throw).
5. `prompt.mjs`: `buildSystemPrompt({ agent, memory, skills, teamDir })` (async) returns a string of at most 40,000 chars (the limit
   `harness/turns.mjs` applies to `system`), made of, in this order: the profile description (`agent.data.description` or `agent.data.instructions`), the team
   `<teamDir>/AGENTS.md` if present, the skills index (one line each: name, description), profile memory items, and the 10 most recent journal items. Truncate each
   section with a marker rather than cutting mid-word. Deterministic output for the same inputs (tests compare strings).
6. Profile fields: add optional `slug?, title?, description?, capabilities?: string[], model?, driver?, maxSteps?, budgetUsdDay?, workspace?` to `Bot` in
   `src/types.ts` (camelCase to match the existing `Bot`; the team pack stays snake_case and the importer in T06 maps it). They are stored in the existing agent
   record's `data`; no column change. `npm run typecheck` must still pass with `src/work.ts` `blankBot` untouched (all new fields optional).
7. Routes (`runner/api/memory.mjs`, `createMemoryRoutes({ memory, skills, buildPrompt })` returns an `async (req,res,route,url,user) => boolean` like
   `createDataRoutes` in `runner/api/data.mjs`; use `readJson`/`send` from `runner/api/http.mjs`; owner = `user.uid`):
   `GET /api/memory?agent=&q=&kind=&limit=`, `POST /api/memory {agentId, kind, text}` (201), `GET /api/skills`, `GET /api/skills/:name`,
   `GET /api/prompt/:agentId` (returns `{ prompt }`; reads the agent record via `store.get(owner,"agents",id)` and treats a 404 as 404). In `server.mjs` add
   a regexp branch next to the data one: `/^\/(memory|skills|prompt)(\/|$)/`, 503 "no database" for memory/prompt when `store` is null; skills work without a DB.
8. `memory-import.mjs`: `importFileMemory({ dir, owner, agentId, memory })` reads the old files (`<dir>/MEMORY.md` as one `profile` item per
   non-empty paragraph, `<dir>/memory/log/*.md` as `journal` items in filename order). Idempotent: each imported item carries `source_hash` (sha256 hex of `<file name>\n<paragraph text>`) and is inserted with
   `on conflict (owner, agent_id, source_hash) do nothing`. Returns `{ inserted, skipped }`. The harness route is untouched.
9. `memory-backup.mjs`: `exportMemory({ sql or memory, owner, dir })` writes `<dir>/<agent_id>/profile.md` and `journal.md`; has a tiny CLI guard
   (`if (import.meta.url === ...)`) that reads `DATABASE_URL` and `--out <dir>`; **lives under `runner/`** (the image copies only `harness`, `runner`, `dist`;
   the DB is not reachable from the host, so it runs as `docker compose exec runner node runner/agent/memory-backup.mjs --out /srv/sandbench/backup`). This replaces the
   brief's `scripts/memory-backup.mjs` (note it under Deviations). Not scheduled (SB-14).
10. Compose wiring for the team folder (Q7 provisional default, read-only, harmless when unused): in `deploy/compose.yml` under the `runner` service add
    `environment: SANDBENCH_TEAM_DIR: /srv/team` and `volumes: - ${SANDBENCH_TEAM_HOST_DIR:-./team-empty}:/srv/team:ro`; commit `deploy/team-empty/.gitkeep`. In `.env.example` add
    `# SANDBENCH_TEAM_HOST_DIR=` with a comment (a host path on the laptop; never commit it). Do **not** add a service or `ports:`. Run the compose checks (`PR_CHECKLIST` §C step 7);
    the service lists `postgres runner tailscale ` and `cloudflared postgres runner ` must be unchanged. If the existing mounts block already uses `volumes:` extend that list.
11. `main.mjs`: `const memory = sql ? createMemory(sql) : null`; `createSkills({ dir: env.SANDBENCH_TEAM_DIR })`; pass to `createRunner`.
12. CI: add `memory.test.mjs` to the "ran (not skipped)" step with the same two-line pattern (`node --test runner/test/memory.test.mjs 2>&1 | tee /tmp/memory.log; grep -q "^# skipped 0" /tmp/memory.log`).
    Job names must not change. Update `data.test.mjs` to expect `["001_init.sql","002_memory.sql"]`.

**Tests**
- `memory.test.mjs` (Postgres; skip only when `TEST_DATABASE_URL` is unset, same as `data.test.mjs`): save then search finds it; ranking returns the matching item first; **owner isolation**
  (owner B sees nothing of owner A, same agent id); **agent isolation** (agent B sees nothing of agent A); kind filter; limit clamp; `text` over 8000 chars refused by the
  `check`; importer idempotent (second run `inserted: 0`); backup writes files with the expected content; migration applies on an empty DB and `migrate(sql)` is a no-op the second time.
- `skills.test.mjs` (temp dir, no DB): index lists names and descriptions; **editing a SKILL.md changes `loadSkill` output on the next call without recreating the object**; `../x`,
  `/abs`, `a/b`, empty, a symlinked skill dir pointing outside, uppercase, 61+ chars all refused; missing team dir returns `[]`.
- `prompt.test.mjs`: profile fact saved through `memory` appears in the next `buildSystemPrompt`; total length ≤ 40,000; section order; deterministic.
- Route tests (add to `memory.test.mjs` or a new file using `createRunner` with a fake `verifyIdToken` like `runner/test/server.test.mjs`): 401 without token; 503 without DB; owner isolation through HTTP.

**Commands:** Standard checks (+ step 7 because `deploy/compose.yml` changes), plus
`node --test runner/test/memory.test.mjs runner/test/skills.test.mjs runner/test/prompt.test.mjs` (with `TEST_DATABASE_URL`; show `# skipped 0` for `memory.test.mjs`).
**Done when:** the Postgres tests pass in CI with `skipped 0`; the PR says what is still to prove live: after import, QA answers "which widths do you check and which Firebase projects are
off-limits?" from memory (needs the turn engine, T10 and later). **Do not tick the plan box.**
**PR body extras:** the compose change and why it is harmless; `memory-backup` location deviation; the camelCase decision.
**STOP if:** the tests need a real team repo; you need to change `store.mjs` or an existing migration; the compose service lists change.

---

## T03 · SB-13 headless browser and emulator tools

- [ ] **Merged** · Size **M** · Depends: none (needs T01's resolver only for the live wiring; the library takes an output directory argument) · Independent: yes · Branch `sb-13-browser-emulator`
- PR title: `SB-13: Playwright image, SSRF-safe screenshots, demo-only emulator wrapper`

**Touch (create):** `runner/browser/screenshot.mjs`, `runner/browser/ssrf.mjs`, `runner/browser/emulator.mjs`, `runner/browser/images.mjs` (the `saveImage` interface + a file implementation),
`runner/test/ssrf.test.mjs`, `runner/test/screenshot.test.mjs`, `runner/test/emulator-wrapper.test.mjs` (not `emulator.test.mjs`: that name already exists for the auth-emulator sign-in test).
**Touch (edit):** `runner/Dockerfile`, `runner/package.json` and `runner/package-lock.json` (add `playwright-core` or `playwright` to **dependencies**), `.github/workflows/ci.yml` (**only**: inside the existing
"Typecheck, test, build" job, a step that installs chromium before `npm run test:node` so the screenshot tests run; inside the existing image job nothing unless the build needs it),
`docs/runner.md`, `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `harness/**` (do not remove `/screen` or `/input`), `runner/api/server.mjs` (no route yet: SB-10 exposes it), `runner/db/**`, `runner/guard.mjs` (import `isBlockedProject` from it, do not edit),
auth, `deploy/compose.yml`, `src/**`.

**Steps**
1. Read `runner/Dockerfile` (it copies only `harness`, `runner`, `dist`; `npm ci --omit=dev` from `runner/package.json`), `runner/guard.mjs` (`isBlockedProject(id, extra)`), `.github/workflows/ci.yml` image job
   (20-minute timeout; it builds `sandbench-runner:ci` and starts it with no database).
2. Dockerfile: base `mcr.microsoft.com/playwright:v<pinned>-noble` (look up the current pinned tag on Microsoft's registry page for Playwright Docker images; pin the **exact** tag, not `latest`). Make sure the
   image provides **Node 22**; if the Playwright image's Node is not 22, either install Node 22 from the NodeSource apt repo in a layer and note it, or use a multi-stage build that copies Playwright's browsers.
   Pick the smaller one and report both sizes. If neither works within 2 attempts: STOP. Install Java 21 (`openjdk-21-jre-headless`), `python3`, `gh` (from the official apt repo), and `firebase-tools` pinned
   (`npm i -g firebase-tools@14`, the same major CI uses). Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` for `npm ci` (browsers come from the base image); the npm `playwright` version must equal the image's Playwright
   version. Keep the final stage running as a non-root user if the current Dockerfile does. Report `docker image ls sandbench-runner:ci` size in the PR and WORKLOG, and the CI image job's runtime.
3. `ssrf.mjs`: `assertSafeUrl(url, { allowHosts = [], allowLoopbackFor = [], lookup = dns.promises.lookup })` → returns the parsed `URL`; throws `SsrfError` unless protocol is `http:`/`https:`, no credentials in the URL, port 1-65535,
   and **every** resolved address (use `lookup(host, { all: true })`) is public. Refused ranges: `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (includes `169.254.169.254`), `100.64/10`, `0.0.0.0/8`, `224/4` and above,
   `::1`, `fe80::/10`, `fc00::/7`, `::ffff:` mapped forms of the above, plus the hostnames `metadata.google.internal` and `localhost` unless the hostname is exactly in `allowLoopbackFor`/`allowHosts`. Handle decimal/octal/hex IPv4
   spellings by letting `URL` normalise and by treating any non-dotted-quad numeric host as refused. Implement the range check with `node:net` `BlockList` (no new dependency).
4. `screenshot.mjs`: `screenshot({ url, outDir, widths = [320,375,390], fullPage = true, waitFor, saveImage = fileSaver, allow })`. Launch chromium via `playwright` with `headless: true`; for each width open a new context at `{width, height: 800}`;
   `page.route("**/*", route => assertSafeUrl(route.request().url(), allow) ... route.continue() | route.abort())` so **every request and redirect is re-checked**, not just the first URL; `page.goto(url, { timeout: 20000 })`; optional
   `waitFor` (CSS selector, 10 s). `saveImage({ name, buffer })` writes `<outDir>/<slugified host>-<width>.png` (file implementation checks `outDir` exists and uses `path.basename` on the name). Return `[{ width, path, bytes }]`.
   `outDir` is passed by the caller (SB-10 will pass the agent's folder resolved via T01's `resolveWorkspacePath`). Write the `saveImage` interface in the PR body (SB-18 attachments plug in there).
5. `emulator.mjs`: `emulatorStart({ project, ports = { auth: 9099, firestore: 8180, database: 9000 }, spawn, cwd })` and `emulatorStop(handle)`. Refuse if `!project.startsWith("demo-")` **or** `isBlockedProject(project)`. Write a temp `firebase.json`
   (`os.tmpdir()`, mode 0600, removed on stop) with the three ports, and spawn `firebase emulators:start --only auth,firestore,database --project <project> --config <file>` using `child_process.spawn` with an args array. Always pass
   `--project`. `spawn` is injectable so tests never need Java or `firebase-tools`. (The brief says "ports in the game repo's firebase.json"; there is no game repo clone here, so the ports are parameters with those defaults.)
6. `docs/runner.md`: a "Browser and emulator" section (what exists, what is not exposed yet, SSRF rules).

**Tests**
- `ssrf.test.mjs` (fake `lookup`, no network): loopback (`127.0.0.1`, `[::1]`, `localhost`), `169.254.169.254`, `10.0.0.5`, `192.168.1.2`, `100.64.0.1`, IPv4-mapped IPv6, decimal `http://2130706433/`, hostname resolving to a private address,
  hostname with one public and one private address, `file:///etc/passwd`, `ftp://`, `javascript:`, URL with credentials: all refused; public address accepted; allowlisted `localhost` accepted only when listed.
- `screenshot.test.mjs`: start a local `http.createServer` serving a static page and a redirect to `http://169.254.169.254/` (never actually contacted: the route handler aborts it); screenshot the page at 320/375/390 with `allow: { allowLoopbackFor: ["127.0.0.1"] }`;
  read PNG width from the IHDR bytes and assert `width * deviceScaleFactor` equals the viewport width (use scale 1); the redirect case rejects with `SsrfError`. If Chromium is not installed the test **fails with a clear message** (do not silently skip);
  CI installs it (step above); locally `npx playwright install chromium`.
- `emulator-wrapper.test.mjs`: non-`demo-` id refused; a guarded id refused (use a hash-guarded id **by constructing it from `SANDBENCH_BLOCKED_PROJECTS`** with a fake id like `demo-blocked-x` passed as the `extra` argument of `isBlockedProject`, never a real off-limits id);
  `demo-walklings` accepted; fake `spawn` receives `--project demo-walklings`, `--only auth,firestore,database` and a config file whose ports match; the temp config is deleted on stop.
- **Mutation check:** disable the redirect re-check and the `demo-` check once each; the named tests must fail.

**Commands:** Standard checks + step 7 (image and compose, **required**), plus `npx playwright install chromium` once locally and
`node --test runner/test/ssrf.test.mjs runner/test/screenshot.test.mjs runner/test/emulator-wrapper.test.mjs`.
**Done when:** tests pass in CI, `docker build` of the new image passes, the image still starts bare (health 401), and the PR reports the image size and runtime and what is still to prove live: QA screenshotting the live build and
posting it needs SB-03, SB-06, SB-10 (and SB-18 for attachments).
**STOP if:** the image job would exceed 20 minutes; the Playwright base cannot give Node 22 in two attempts; any `compose.yml` change seems needed; you would need to add a CI job.

---

## T04 · SB-03 PR 1: contracts and plumbing (no behaviour change)

- [ ] **Merged** · Size **M** · Depends: T02 merged (migration order `002` then `003`; `server.mjs`, `main.mjs`) · Independent: no · Branch `sb-03a-contracts`
- PR title: `SB-03 PR 1: contracts, 003_jobs.sql, route registry, driver extras hook, tools discovery`

**Touch (create):** `runner/contracts/{index,job,turn,approval,tool,policy}.mjs`, `runner/contracts/schemas/*.json` (optional JSON schemas, one per contract),
`runner/contracts/fixtures/*.json`, `runner/api/routes/index.mjs`, `runner/tools/discover.mjs`, `runner/policy/default.mjs` (the "needs a card for everything" implementation),
`runner/db/migrations/003_jobs.sql`, `runner/test/contracts.test.mjs`, `runner/test/routes.test.mjs`, `runner/test/jobs-schema.test.mjs`, `runner/test/tools-discovery.test.mjs`,
`runner/test/fixtures/tools/` (fake `tools.mjs` modules for the discovery test).
**Touch (edit):** `runner/api/server.mjs` (the registry, **only**), `runner/main.mjs` (load factories and pass them in), `harness/drivers/claude.mjs` (export a pure `buildClaudeArgs` and accept `turn.extras`),
`harness/turns.mjs` (only: pass `body.extras`-less `turn.extras = {}` through; no new behaviour), `harness/test/drivers.test.mjs` (add tests), `runner/test/data.test.mjs` (migration list),
`.github/workflows/ci.yml` (**one DB-test line** in the existing "ran (not skipped)" step for `jobs-schema.test.mjs`), `.gitignore` (add `secrets.json*`), `docs/runner.md`, `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `src/**`, `runner/api/data.mjs`, `runner/db/store.mjs`, `001_init.sql`, `002_memory.sql`, auth, `guard.mjs`, `deploy/**`, `runner/Dockerfile`. **Do not create** `runner/worker/`, `runner/policy/classify.mjs`, `runner/mcp/` or any engine code: those are later PRs.

**Steps**
1. Read `NEXT_PHASE_BRIEF.md` "Contracts that land first" in full. Read `runner/api/server.mjs` `api()` (the regexp branch for `/data|changes|stream` and the sequence of `if (req.method === ... && route === ...)` blocks),
   `runner/api/data.mjs` (`createDataRoutes` returns `async (req,res,route,url,user) => boolean`), `harness/drivers/claude.mjs` `converse()` (`args = ["-p","--output-format","stream-json","--verbose","--settings",settingsFile]`, `--model`,
   `--resume`, `SAFE_ARG`), `harness/turns.mjs` `start(body, ctx)` (the `turn` object).
2. **Contracts** (`runner/contracts/*.mjs`): plain JS, **no new dependency**. Each file exports a JSDoc typedef, a `validateX(value)` returning `{ ok: true, value }` or `{ ok: false, errors: string[] }`, and constants for the enums.
   - `job.mjs`: `JOB_KINDS = ["turn","exec","build"]`, `JOB_STATUS = ["queued","running","done","failed","cancelled","interrupted"]`; record fields `id, owner, agent_id, kind, status, parent_job_id, root_job_id, payload, pid, pgid, timeout_s,
     heartbeat_at, exit_code, error, resumable, created_at, started_at, finished_at`; event: `{ job_id, seq, type, data, at }`.
   - `turn.mjs`: request `{ threadId, text, agentId?, model?, folder? }` (owner-supplied only; engine fills the rest).
   - `approval.mjs`: `{ id, owner, job_id, agent_id, class: green|yellow|red, required_approver: owner|vincent, status: pending|approved|denied|expired, decision_id, request, decided_by, created_at, decided_at }`.
   - `tool.mjs`: descriptor `{ name, description, inputSchema, action(args), handler(args, ctx) }`, `validateTool`; `ctx = { agentId, owner, ... }` where `agentId` comes from the per-turn token, never from `args` (a validator test rejects a descriptor whose `inputSchema` has an `agentId` property).
   - `policy.mjs`: `check({ agent, action }) → { class: "green"|"yellow"|"red", needs: "none"|"card"|"vincent", reason: string, blocked?: boolean }` (`blocked: true` = hard block, no card is offered; **this field is the handoff's addition**).
   - `policy/default.mjs`: `check()` always returns `{ class: "yellow", needs: "card", reason: "No policy installed yet", blocked: false }`. It is never an allow.
3. **`003_jobs.sql`** (additive; no `alter` of existing tables): tables `jobs`, `job_events`, `approvals`, owner-scoped like `001_init.sql` (read it for the pattern: `owner text not null`, ids text). `jobs` has every column from step 2 plus `attempt int not null default 0`,
   `singleton_key text`, `session_id text`, `queue_job_id text` (pg-boss link), `created_at/updated_at`. Checks: `kind`, `status` enums; `timeout_s > 0`. `job_events(job_id references jobs on delete cascade, seq int, type text, data jsonb, at timestamptz, primary key (job_id, seq))`.
   `approvals(... references jobs(id) on delete cascade ...)`. Indexes: `jobs(owner, status)`, `jobs(root_job_id)`, `jobs(agent_id, status)`, `approvals(owner, status)`. **No pg-boss tables** (pg-boss creates its own schema in PR 2). Update `data.test.mjs` to expect `["001_init.sql","002_memory.sql","003_jobs.sql"]`.
4. **Route registry.** `runner/api/routes/index.mjs` exports `async function loadRouteFactories(dir = new URL(".", import.meta.url))`: reads `*.mjs` files in `runner/api/routes/` except `index.mjs`, dynamic-imports each, and each module default-exports
   `{ name, prefix: RegExp-or-string, create(deps) → async (req,res,route,url,user) => boolean }`. Deterministic order (sorted by file name); duplicate `name` or overlapping `prefix` throws at load. In `createRunner` add an option `routes = []` (already-created handlers, built by `main.mjs` with the deps
   `{ store, memory, skills, secrets, env, home }`); `api()` tries each registry handler whose prefix matches, **before** the legacy `if` blocks, falling through on `false`. The existing data and memory routes keep working: you may convert `/data|changes|stream` and
   `/memory|skills|prompt` to registry modules **only if** every existing route test passes unchanged; otherwise leave them and register only new routes (record the choice). The `runner/api/routes/` directory ships with only `index.mjs` (zero route modules; tests use a fixture directory). After this PR, the rule is: new routes are new files under `runner/api/routes/`; nobody edits `server.mjs` again.
   `createRunner` must stay synchronous; `main.mjs` does `const routes = await loadRouteFactories()` and builds them.
5. **Driver extras hook.** In `claude.mjs`, extract `buildClaudeArgs({ settingsFile, model, sessionId, extras })` (pure, exported). `extras = { settings?, mcpConfig?, maxTurns?, resume? }`. With empty extras the args are **byte-identical** to today's. With extras: `mcpConfig` → `--mcp-config <path>` (validate with `SAFE_ARG`),
   `maxTurns` → `--max-turns <int 1-200>`, `settings` object merged into the settings JSON next to `permissions` (written by `converse()` as `{ ...extras.settings, permissions: { allow } }`, so `extras.settings.permissions` is **ignored** and can never widen `allow`; document it and test it), `resume` overrides `sessionId`. Nothing sets extras yet (`turn.extras ?? {}`).
6. **Tools discovery.** `runner/tools/discover.mjs`: `discoverTools({ root = runnerDir })` scans `runner/*/tools.mjs`, imports each, expects `export const tools = [descriptor...]`, validates with `validateTool`, rejects duplicate names (throws with both file names), returns tools sorted by name. No central list.
7. `.gitignore`: add `secrets.json*` on its own line (no other change).
8. `docs/runner.md`: a short "Extending the runner" section: add a route = a file in `runner/api/routes/`; add tools = `runner/<area>/tools.mjs`; migration numbers taken: 001, 002, 003; 004 is SB-06's `004_audit.sql`; driver `extras`.

**Tests**
- `contracts.test.mjs`: valid fixtures pass; each required field missing/bad enum fails with a message naming the field; tool descriptor with `agentId` in `inputSchema` is rejected; default policy never returns `needs: "none"`.
- `routes.test.mjs`: with a fixture routes dir (`runner/test/fixtures/routes/`), the loader sorts, rejects duplicates and overlapping prefixes; a fixture route is reachable through `createRunner` behind sign-in (401 without a token, 200 with); **all existing `server.test.mjs` and `data.test.mjs` tests pass unchanged**; unknown path still 404.
- `jobs-schema.test.mjs` (Postgres, `skipped 0` required, add to CI step): `migrate` on an **empty** database applies 001-003; on a database already at 002 applies only 003; re-running is a no-op; inserts into `jobs`/`job_events`/`approvals` work; bad `status`/`kind` rejected by the check; deleting a job cascades to events and approvals; two owners' rows are separable by `owner`.
- `drivers.test.mjs`: `buildClaudeArgs` with empty extras equals the expected current array exactly; with `maxTurns: 5` includes `--max-turns 5`; `maxTurns: 0` and `"; rm"` rejected; `mcpConfig` with a space or `;` rejected; `resume` replaces `--resume`.
- `tools-discovery.test.mjs`: two fixture `tools.mjs` files are found; duplicate names throw; an invalid descriptor throws naming the file.
- A bare-start check: the runner (via `main.mjs`-equivalent `createRunner` with no store) still starts and `/api/health` answers 401 without a token (existing test; keep it).

**Commands:** Standard checks + step 7 (compose/image: the image must still start bare), plus
`node --test runner/test/contracts.test.mjs runner/test/routes.test.mjs runner/test/jobs-schema.test.mjs runner/test/tools-discovery.test.mjs harness/test/drivers.test.mjs`.
**Done when:** contract tests pass; `003_jobs.sql` applies on empty and on an existing database; the registry serves every existing route unchanged; `buildClaudeArgs` output unchanged for empty extras.
**PR body extras:** the contract field lists; the `blocked` addition; the registry choice (converted or not); "no behaviour change".
**STOP if:** an existing test has to change to pass (other than the migration list); you think a column is missing from `jobs` but adding it needs `alter` later: add it now instead, and tell Vincent in the PR.

---

## T05 · `PLAN.md` stale host text (docs only)

- [ ] **Merged** · Size **S** · Depends: none · Independent: yes (do it early, and any time a session has spare time) · Branch `docs-plan-laptop-text`
- PR title: `docs: PLAN.md now says the runner is on the laptop (Tailscale Funnel), not a Hetzner VM`

**Touch (edit):** `docs/parity/PLAN.md` only (plus `WORKLOG.md`, `STATUS.md`). **Do NOT touch** anything else, and **do not change** any task, estimate, dependency, checkbox or the Progress log (except adding one line for this PR at the end).

**Steps** (find each place with `grep -n -i "hetzner\|cloudflare\|CX43\|Q1\b\|Q9\b" docs/parity/PLAN.md`; line numbers at `84a3c17`: 50, 101, 108, 113, 116, 423, 451, 461, 469, 476, 479, 482)
1. Mermaid diagram (~line 45-53): relabel the host node to `Vincent's laptop\n(Docker: runner + Postgres)` and the edge/node `CF` from "Cloudflare Tunnel + Access" to `Tailscale Funnel\n(Firebase sign-in + allowlist)`. Keep the diagram valid Mermaid (render check not available; keep quotes and `\n` exactly as the other nodes use).
2. SB-01 "Done when" (~101) and Approach (~108, 113, ~116 acceptance): rewrite as what is true: the runner runs in Docker on Vincent's laptop (`deploy/compose.yml` profile `laptop`: runner, postgres, tailscale sidecar); reachable through Tailscale Funnel; sign-in is Firebase ID token + server email allowlist + exact-origin CORS; **no VM, no Cloudflare Access today**; the runner is offline when the laptop sleeps. Keep the `cloudflare` profile mentioned as "kept, unused".
3. Open questions: Q1 (461) and Q9 (469): leave the question text but add `(answered; see "Answers so far")`. "Answers so far" Q1 (476, the Hetzner CX43 text) and Q9 (479): replace the answer with: Q1: Vincent's laptop (Windows), no cloud VM, no Hetzner; Q9: the page stays on Vercel and calls the runner over Tailscale Funnel with exact-origin CORS (`SANDBENCH_ALLOWED_ORIGINS`). Keep the original answers in a one-line "Earlier answer (superseded 2026-10-26): ..." so history is not lost.
4. "Still open" (482): remove the "domain on Cloudflare for the tunnel hostname" bullet (not needed with Tailscale Funnel); leave the other open items.
5. SB-23 (423) and the risks bullet (451): where they say "behind Cloudflare Access" add "(Tailscale Funnel today; Cloudflare Access only if a VM is ever used)". Do not change SB-23's scope or estimate.
6. Do **not** touch SB-24, R2 (line ~375 is object storage, unrelated), or anything not listed.
7. Add one Progress log line: `- 2026-10-2x · docs · PR #N · PLAN.md host text now says laptop + Tailscale Funnel (no task or estimate changed)`.

**Tests/commands:** no code. Run `git diff --stat` (only `PLAN.md`, WORKLOG, STATUS), the email grep, a `grep -rn "ts.net"` on your diff (only `<your-tailnet>` is allowed), and wait for the four required checks (they run on any PR). Paste `git diff origin/deploy/vercel -- docs/parity/PLAN.md | head -150`.
**Done when:** `grep -n -i "hetzner\|cx43" docs/parity/PLAN.md` returns only lines that say "superseded" or "no Hetzner", and no Cloudflare text describes the current setup.
**STOP if:** you find the text contradicts something in code you cannot reconcile (for example a compose service you do not recognise).

---

## T06 · SB-15a team pack importer (QA slice first)

- [ ] **Merged** · Size **M** · Depends: T02 merged (profile fields, `memory_items`, skills) · Independent: no · Branch `sb-15a-team-pack-import`
- PR title: `SB-15a: team pack importer (synthetic pack, idempotent, paused Supervisor)`
- **Live part BLOCKED on Q7** (where the real pack lives). Build and test on a synthetic pack only.

**Touch (create):** `runner/import/team-pack.mjs` (library), `runner/import/cli.mjs` (CLI), `runner/import/botDefaults.mjs`, `runner/import/yaml-lite.mjs` (only if no YAML parser is already a dependency; otherwise add **one** pinned dependency `yaml` to `runner/package.json`: it
is small, widely used, and the only addition allowed), `docs/team-pack.md`, `runner/test/import.test.mjs`, `runner/test/fixtures/team-pack-demo/**` (synthetic: six bots `demo-qa`, `demo-supervisor`, ... with addresses at `@example.test`), `src/botDefaults.test.ts`.
**Touch (edit):** `src/types.ts` (add optional `paused?: boolean`, `pausedReason?: string` to `Bot`), `.github/workflows/ci.yml` (one DB-test line in the existing "ran (not skipped)" step), `docs/team-import.md` (one line marking the Windows importer as old), `docs/runner.md`, `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `scripts/import-grok-desktop.mjs` (stays), `runner/db/**`, `runner/agent/**` (call them, do not edit), `src/App.tsx`, `src/work.ts`, deploy, auth, `runner/Dockerfile`. **Never** add real team content, real memory or real addresses anywhere.

**Steps**
1. Read `PLAN.md` SB-15a (~line 326, "team pack v2 format"), `docs/team-import.md`, `runner/agent/memory.mjs` + `skills.mjs` (from T02), `runner/db/store.mjs` `create/patch/get/list` and the optimistic `version` rule, and `blankBot` in `src/work.ts:1376` (the fields a page needs from a Bot).
2. Format (`docs/team-pack.md`): folder `agents/<slug>/agent.md` (YAML front matter then body), `memory/<slug>/MEMORY.md` and `memory/<slug>/log/*.md`, `routines.yaml`, `skills/<name>/SKILL.md`, `handoff/*.md`. Front matter keys (snake_case in the pack; camelCase in records): `slug, title, description, capabilities, model, driver, max_steps,
   budget_usd_day, workspace, color?, voice?, paused?`. Document each key and its limits, and the path rules.
3. `botDefaults.mjs` exports `BOT_DEFAULTS` (a plain object with every required `Bot` field and a sensible default; copy from `blankBot`: `instructions, persona, soul, color, shape, voice, primary, hidden, skills, librarySkillIds, memories, section, lastThinking, approvalMode, visibility, usage, soulHistory, createdAt`). An imported agent record's `data` is
   `{ ...BOT_DEFAULTS, id: slug, name: title-or-slug, role: title, instructions: body, description, capabilities, ... }` so the page can render it. **`src/botDefaults.test.ts`** (vitest) loads `BOT_DEFAULTS` with a **dynamic import via a string variable** (so `tsc --noEmit` does not need types for `.mjs`) and asserts every key `blankBot("x","y",false)` returns exists
   in `BOT_DEFAULTS` with the same JS type (ignoring `id`, `name`, `role`, `createdAt`). This test fails when someone adds a Bot field and forgets the importer.
4. `team-pack.mjs`: `importTeamPack({ dir, owner, store, memory, only = null, dryRun = false })` returns a report `{ agents: {created, updated, unchanged}, memory: {inserted, skipped}, skills: n, routines: {created, updated, unchanged}, rejected: [{path, reason}] }`.
   - **Path safety:** `dir` resolved once with `realpath`; every file read must `realpath` inside it; reject `..`, absolute, null byte, symlinks leaving the tree, slugs not matching `/^[a-z0-9][a-z0-9-]{0,40}$/`; rejected paths go to `rejected`, never throw halfway through a write.
   - **Idempotent by slug:** agent id = slug; if the record exists, compare the imported fields with `data` and `store.patch` **only the changed fields** with the current `version` (re-read on 409 once, then report `conflict`); unchanged = no write and no version bump.
   - Memory goes through T02's importer pattern (`source_hash` makes it idempotent). Skills: **read-only**: the importer reports the skill index and does not copy skills into the DB (the runner reads them from the team dir at turn time via `skills.mjs`); `--verify-skills <folder>` compares sha256 per file and reports `changed/missing/extra`.
   - **Routines** become `routines` records `{ id, botId, title, schedule (cron string), timezone, prompt, enabled: false, lastRunAt: undefined }` (mirror the `Routine` type in `src/types.ts` ~228: `{id, botId, title, schedule, enabled, lastRunAt?}`; extra keys `timezone`, `prompt` allowed in `data`). **Always disabled. Nothing runs them** (the scheduler is SB-14, out of scope).
   - **Supervisor** (the agent whose front matter has `paused: true`, or slug `supervisor`) is imported with `paused: true, pausedReason: "Runs in Grok Bot until cutover"`; its routines are imported disabled like all others.
   - `--only qa` (slugs, comma separated) implements "QA slice first"; with no `--only` all agents import. `dryRun` writes nothing and returns the same report.
5. `cli.mjs`: `node runner/import/cli.mjs --dir <path> [--only a,b] [--owner <uid>|auto] [--dry-run] [--verify-skills <path>]`. Reads `DATABASE_URL`. `--owner auto` succeeds only when exactly one distinct owner exists in the `agents`/`settings` records (Vincent's page has synced);
   zero or several → exit 2 with a message telling him to pass `--owner <uid>`. It runs **inside the container** (`docker compose exec runner node runner/import/cli.mjs --dir /srv/team --owner auto --dry-run`), because the database is not reachable from the host and the image copies only `harness`, `runner`, `dist`.
   This replaces the brief's `scripts/import-team-pack.mjs` (list it under Deviations). Always default to `--dry-run` unless `--apply` is given.
6. CI: add `import.test.mjs` to the "ran (not skipped)" step.

**Tests** (`import.test.mjs`, Postgres, plus fixtures)
- Synthetic six-bot pack: six agents with right titles, capabilities, `driver`, `max_steps`; skill index has the right names; run twice → second report has `created: 0, updated: 0` and `version` of every record unchanged (assert from `store.get`).
- Edit one front matter field and rerun → exactly that record's version +1, other fields untouched; a page-side edit of a field the importer does not own (e.g. `color` changed through `store.patch`) survives a re-import.
- Routines arrive `enabled: false`; the Supervisor has `paused: true`; owner isolation (owner B has no rows); `--only qa` imports only QA; dry-run writes nothing.
- Path checks: `..`, absolute, null byte, symlink out, bad slug → in `rejected`, nothing written for that item, rest imported.
- `--verify-skills` reports a changed file.
- `src/botDefaults.test.ts` passes under `npm run test:web`.
- **Pending (state it in the PR):** "a paused Supervisor never starts a turn" is enforced by the engine in T10; here only the flag is tested.

**Commands:** Standard checks + `node --test runner/test/import.test.mjs` with `TEST_DATABASE_URL` (`# skipped 0`) + `npx vitest run src/botDefaults.test.ts`.
**Done when:** the Postgres tests pass in CI with `skipped 0`; the PR states what is pending live: Vincent's real pack imports and QA answers the widths/off-limits question from memory (also closes SB-08's acceptance), plus the paused-engine check.
**STOP if:** you need real pack content to make a test pass; you want to add more than the one `yaml` dependency; Vincent's page needs a Bot field the importer cannot default.

---

## T07 · Follow-up: retry the runner-side delete of a bot's computer events

- [ ] **Merged** · Size **S** · Depends: none · Independent: yes · Branch `sb-fu-bot-event-delete`
- PR title: `Retry the runner-side delete of a deleted bot's computer events`

**Problem (verified):** `src/App.tsx` (~line 963, inside the delete-bot handler) calls `recordSyncRef.current?.removeWhere("computer", (data) => data.botId === id).catch(() => undefined)`. If the runner is down (laptop asleep) or the call fails, the events stay on the runner and nothing retries.
`RecordSync.removeWhere(kind, match)` in `src/recordSync.ts` (~line 377) returns early (`if (!this.ready) return Promise.resolve()`) and deletes only records in `this.synced`.

**Touch (edit):** `src/recordSync.ts`, `src/recordSync.test.ts`, `src/App.tsx` (only that one call site, and wiring for the pending store if needed), `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`. Possibly `src/db.ts` or wherever the IndexedDB base store is created (find it with
`grep -rn "memoryBaseStore\|BaseStore" src`), only to persist the pending list the same way.
**Do NOT touch:** the runner (`runner/**`), `APPEND_ONLY` semantics, anything about other kinds, auth.

**Steps**
1. Read `recordSync.ts` top comment (lines 1-30: how the base is saved and replayed), `BaseStore` (~line 45) and `memoryBaseStore` (~239), `open()` (~320-360), `removeWhere` and the existing test "deleting a bot removes its computer events on the runner, including ones this page trimmed" (`recordSync.test.ts` ~line 440).
2. Add a serialisable **pending removals** list: `type PendingRemoval = { kind: RecordKind; field: string; value: string }` (a function cannot be saved). New method `removeWhereEquals(kind, field, value)`: adds the removal to the list (persisted through a new optional `PendingStore { load(): Promise<PendingRemoval[]>; save(list): Promise<void> }`
   with a memory implementation for tests and a `localStorage`/IndexedDB one for the page, whichever the base store already uses), then tries to run it (the existing deletion loop, matching `data[field] === value`). A removal leaves the list **only after** the runner confirmed it (no throw). Run pending removals on `open()` after the base loads, and after each successful reconnect/sync (find the existing reconnect hook).
   Keep `removeWhere(kind, fn)` as is (other callers/tests).
3. Idempotence: deleting an already-deleted record is not an error (a 404 on remove counts as done). Cap the pending list (e.g. 50 entries) and drop duplicates.
4. App.tsx: replace the one call with `removeWhereEquals("computer", "botId", id)`; keep the `.catch(() => undefined)` out (errors now stay pending). Show nothing new in the UI.
5. Do not claim anything about the live runner.

**Tests** (vitest, using the fake runner already in `recordSync.test.ts`)
- Runner fails the delete (`failPath` control or a thrown fetch) → the removal stays pending; after the fake runner recovers and the page reconnects/reopens, the events are deleted and the pending list is empty.
- Page closed and reopened between failure and recovery (new `device()` with the same pending store) → still deleted.
- Existing test still passes unchanged; a second call with the same arguments does not double-queue; a 404 counts as done.
- A removal for bot A never deletes bot B's events.

**Commands:** `npm run typecheck`, `npm run test:web` (+ `npx vitest run src/recordSync.test.ts` first), then the rest of the Standard checks.
**Done when:** the new tests pass; the PR says what is still to prove live: delete a bot while the laptop runner is off, turn it on, and confirm its computer events disappear (Vincent).
**STOP if:** the fix needs a runner route change (it should not), or the base store cannot persist a second list without a data migration of existing saved bases.

---

## T08 · SB-06 slice A: policy classifier and tests (not wired in)

- [ ] **Merged** · Size **M** · Depends: none (pure code; it only depends on `runner/guard.mjs`, which exists) · Independent: yes · Branch `sb-06a-classifier`
- PR title: `SB-06 slice A: policy classifier with table-driven tests (not wired)`
- This is **tests first**: write the table, see it fail, then write the rules.

**Touch (create):** `runner/policy/classify.mjs`, `runner/policy/rules.mjs`, `runner/policy/unwrap.mjs`, `runner/test/policy.test.mjs`, `runner/test/policy-table.mjs` (the cases, imported by the test).
**Touch (edit):** `runner/package.json` and `runner/package-lock.json` (add pinned `shell-quote` to dependencies; nothing else), `docs/runner.md` (a "Policy classifier" section), `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `harness/turns.mjs` (the first-word auto-review stays until wiring), `runner/api/**`, `runner/db/**`, `runner/guard.mjs` (call `isBlockedProject`, never edit), drivers, `src/**`. **Do not** create approvals, hooks, routes, `audit_log` or Stop all: that is the Thursday wiring PR.

**Steps**
1. Read `runner/guard.mjs` (`isBlockedProject(id, extra)`), `NEXT_PHASE_BRIEF.md` "SB-06 core" and `PLAN.md` SB-06 (~line 225), `harness/turns.mjs` `autoAllowed` (what the old first-word rule did).
2. API: `classify({ kind, command, tool, args, ctx })` → `{ class, needs, reason, rule, blocked }` using the contract from T04 (`blocked: true` ⇒ `class: "red"`, `needs: "vincent"`, and the caller must not offer a card). `kind` is `shell | tool`. `ctx = { cwd, worktreeRoots: string[], agentSlug, ownProject, extraBlocked, defaultBranches = ["main","deploy/vercel"], workspaceRoots }`. All inputs explicit; no env reads, no filesystem reads except `path.resolve`.
   Defaults when nothing matches: `{ class: "yellow", needs: "card" }` for anything not on a small **green allowlist** (read-only commands: `ls, cat, head, tail, pwd, echo, git status, git log, git diff, git show, git branch --list, rg, grep, find` without `-exec/-delete`, `node --version`, `npm test` inside a worktree); never an automatic allow outside that list.
3. Parsing: `unwrap.mjs` uses `shell-quote`'s `parse` to split the command into simple commands on `; && || | &` (control operators), unwrapping at most 3 levels of `env VAR=x`, `sudo`, `command`, `nice`, `time`, `nohup`, `xargs`, `bash -c "…"`, `sh -c "…"`, `eval "…"`, and leading `VAR=value` assignments. A command containing `$(`, backticks, `<(`, an unparseable quote, or an unresolved variable in command position is **at least yellow/card**, and is **blocked** if any
   fragment of it matches a hard-block rule when re-parsed. If depth > 3 → yellow/card with reason "too nested" (never green).
4. Hard blocks (`blocked: true`; the rule name goes in `rule`):
   - `git-force-push`: `git push` with `--force`, `-f`, `--force-with-lease[=…]`, `--force-if-includes`, `--mirror`, a combined short flag containing `f` (`-fu`), a `+refspec` (`+main`, `+HEAD:main`, `origin +x`), or a delete refspec `:main`/`--delete main`. Also behind `git -C dir push …`, `git -c k=v push …`, `GIT_X=1 git push …`, and flags placed **after** the arguments (`git push origin main -f`).
   - `git-push-default`: `git push` whose refspec resolves to a default branch (`main`, `deploy/vercel`), including `HEAD:main`, `HEAD:refs/heads/deploy/vercel`, and a bare `git push` when `ctx.currentBranch` is a default branch.
   - `git-destructive-local`: `git reset --hard`, and `git clean` with `-f`/`--force` together with `-d` and/or `-x` (any order, combined forms like `-fdx`). **Blocked unless `ctx.cwd` is inside one of `ctx.worktreeRoots`** (the agent's own worktree); inside it they are yellow/card. `git checkout -- .` is yellow/card everywhere.
   - `firebase-project`: any `firebase` or `gcloud` command (and `npx firebase`, `firebase-tools`) whose project is not `demo-*` or `ctx.ownProject`, is blocked; **no explicit project at all is blocked** (the rule is "always pass `--project`"); project sources: `--project X`, `--project=X`, `-P X`, `FIREBASE_PROJECT=`, `GOOGLE_CLOUD_PROJECT=`, `CLOUDSDK_CORE_PROJECT=`, `firebase use X`, `gcloud config set project X`, and `.firebaserc` writes via `>`. Any project for which `isBlockedProject(id, ctx.extraBlocked)` is true is blocked even if equal to `ownProject`.
   - `rm-outside`: `rm` with `-r`/`-R`/`--recursive` (any combo with `f`) whose resolved targets (relative to `ctx.cwd`) are `/`, `~`, `$HOME`, `..` paths escaping, or absolute outside `ctx.workspaceRoots`; `rm -rf *` with `cwd` outside the roots; also `find … -delete` and `shred`, `mkfs`, `dd of=/dev/…`, `chmod -R 777 /`.
   - Never block on word `main` inside a quoted message (`git commit -m "fix push to main"` is not a push).
5. Yellow/card (non-blocked, ask): `git push` to a non-default branch, `git commit`, `npm install`, `curl`/`wget` (any), `docker`, anything writing outside cwd, any tool call whose `tool` name is not in a green list. Everything else not green is yellow/card. `class: "red"` is reserved for blocked plus the later "Vincent must click" actions (`pr_merge`, send email) which have no shell form here; classify returns `{ class: "red", needs: "vincent", blocked: false }` for `kind: "tool"` with `tool` in `["pr_merge","email_send","notify_owner"]` (names only; no tool exists).
6. Write `policy-table.mjs` first: **at least 80 rows**, each `{ name, input, expect: { blocked, class, needs, rule? } }`, at least 6 variants per hard-block rule plus 4 "must not block" lookalikes for each (for example `git push origin fix/crash`, `echo "git push --force"`, `rm -rf ./build` inside a worktree → yellow, `firebase emulators:start --project demo-x` → allowed yellow).

**Tests** (`node --test runner/test/policy.test.mjs`)
- Table-driven pass over every row (test names include the row name).
- Unwrapping: `bash -c "git push -f"`, `sh -c 'cd x && git push --force'`, `env FOO=1 git push -f`, `sudo git push -f`, `xargs git push -f` blocked; `$(…)` containing a block pattern blocked; unmatched quote → yellow/card; depth-4 nesting → yellow/card.
- Purity: `classify` does not touch the filesystem or env (call it with a stubbed `process.env` and an unreadable cwd path; assert same result). Never returns an allow (`needs: "none"`) for anything off the green list (property test over the whole table's yellow rows).
- **Mutation check (required by the brief):** weaken three rules once each (drop `-f` handling, drop the `+refspec` check, drop the explicit-project requirement); the named rows must fail; paste the three failures in the PR; restore.

**Commands:** Standard checks (no DB or image needed beyond them) + `node --test runner/test/policy.test.mjs`.
**Done when:** the table (≥80 rows) passes in CI; the mutation check is pasted; the PR says nothing is wired, so no live behaviour changes. The wiring PR (approvals, red gate, Stop all, hook, `004_audit.sql`, `ApprovalInbox`) is scheduled by the Supervisor on Thursday.
**STOP if:** a rule needs a decision (for example whether `git push origin HEAD` from a non-default branch is yellow or blocked: default yellow/card, note it); two rows contradict each other.

---

## T09 · Follow-up: prune `logs` and `computer` rows (dry run only)

- [ ] **Merged** · Size **M** · Depends: none · Independent: yes · Branch `sb-fu-prune-dry-run`
- PR title: `Retention for logs and computer rows: dry-run command (no deletion enabled)`
- **Deleting for real is Vincent's call.** This PR ships the tool, a throwaway-DB test of the apply path, and dry-run as the only default. It never runs against the real database.

**Problem (verified):** `logs` and `computer` records are append-only on the runner (`APPEND_ONLY` in `src/recordSync.ts`; the page keeps the newest 40) and grow without a limit. Plan: keep the newest N per owner and kind, plus anything newer than D days.

**Touch (create):** `runner/db/prune.mjs` (library), `runner/db/prune-cli.mjs` (CLI), `runner/test/prune.test.mjs`.
**Touch (edit):** `.github/workflows/ci.yml` (one DB-test line in the existing step), `docs/runner.md` ("Retention" section: what it keeps, how to dry-run with `docker compose exec runner node runner/db/prune-cli.mjs --dry-run`, and that applying needs Vincent), `docs/parity/PLAN.md` (Progress log line), `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `store.mjs` behaviour (call its public methods only; if you cannot, STOP), `001_init.sql`, any migration (no new table needed), `src/**`, auth, deploy.

**Steps**
1. Read `store.mjs` `remove()` (tombstone semantics: what stays in the row, what is appended to `changes`) and `changesSince`, `001_init.sql` for `workspace_items` columns, and the `Log` / computer-event types in `src/types.ts` for the timestamp field (`at`).
2. `pruneRecords({ sql, store, kinds = ["logs","computer"], keepNewest = 500, keepDays = 30, now, dryRun = true })`: per owner and kind, order by the record's `data->>'at'` (fall back to the row's updated time), keep the newest `keepNewest` and everything newer than `keepDays`; the rest are candidates. Return `{ perOwner: [{ owner, kind, total, keep, candidates }], bytesEstimate }` (use `pg_column_size(data)` sum).
3. Apply path (`dryRun: false`) exists **only** for tests and for a future Vincent decision: it requires the explicit option `apply: "yes"` **and** env `SANDBENCH_PRUNE_APPLY=yes`; it deletes through `store.remove(owner, kind, id, version)` (tombstones + `changes` row, so other devices learn of it) in batches of 200 inside a loop with a **hard cap** `maxDelete` (default 5,000 per run). The CLI never sets `apply`: `--apply` prints "Applying retention is disabled in this build; ask Vincent" and exits 2.
   Decide, from the step-1 reading, whether a tombstone keeps `data`; if it does, say so in the PR (disk is not reclaimed by tombstones; reclaiming needs a later, separate, Vincent-approved step). Do not clear `data` yourself (that needs a store change).
4. CLI: `--dry-run` (default) prints a table per owner/kind; `--keep-newest`, `--keep-days` flags with the same limits; output has no record contents, only counts and ids' counts (**never print record data**).
5. Docs.

**Tests** (`prune.test.mjs`, Postgres, `skipped 0`, added to the CI step)
- Seed 1,200 `computer` rows for owner A and 100 for owner B across ages; dry run reports the right candidate counts, **deletes nothing** (row count unchanged, `changes` head unchanged).
- Apply path on the throwaway DB with both gates set: deletes exactly the candidates, never rows newer than `keepDays` or within `keepNewest`, never another owner's, never other kinds (`messages`, `agents`); `changesSince` shows the deletions; a second device's snapshot would remove them (assert via `changesSince`).
- Apply without the env gate or without `apply: "yes"` throws and deletes nothing; `maxDelete` caps one run; a 409 on one row does not abort the batch.
- CLI test: `--dry-run` exits 0 and prints counts; `--apply` exits 2 and deletes nothing.

**Commands:** Standard checks + `node --test runner/test/prune.test.mjs` (`# skipped 0`).
**Done when:** the tests pass in CI with `skipped 0`, dry run works, apply is gated and capped; the PR says "not run against the real database; real pruning needs Vincent".
**STOP if:** pruning cannot go through the store's public methods, or you want to add a column or index (a migration) to make it fast.

---

## T10 · SB-03 PR 2: the turn engine behind a fake driver (stretch)

- [ ] **Merged** · Size **L** · Depends: T01 and T04 merged (T02 too) · Independent: no · Branch `sb-03b-turn-engine`
- PR title: `SB-03 PR 2: turn engine, pg-boss queue, jobs API, runner-mode turns (fake-driver tested)`
- **Open as a draft PR early and push checkpoint commits** (normal commits); it is expected that this task may not finish by Thursday. At a STOP or the end of the window, leave a clear WORKLOG "where I stopped, what is next".
- **Live part BLOCKED on Q1** (API key) and on Vincent starting the runner. Everything is tested with a fake driver and `scripts/mock-openai-tools.mjs` (check it exists; it is the brief's named mock). **No real model call, no key.**

**Touch (create):** `runner/worker/engine.mjs`, `runner/worker/turns.mjs`, `runner/jobs/queue.mjs` (pg-boss wrapper), `runner/jobs/limits.mjs` (`SANDBENCH_MAX_TURNS` default 2, `SANDBENCH_MAX_BUILDS` default 1), `runner/jobs/events.mjs`, `runner/jobs/approvals.mjs`,
`runner/api/routes/turns.mjs`, `runner/api/routes/jobs.mjs`, `src/runnerTurns.ts` (+ `src/runnerTurns.test.ts`), `runner/test/engine.test.mjs`, `runner/test/queue.test.mjs`, `runner/test/jobs-api.test.mjs`, `runner/test/redaction.test.mjs`, `runner/test/fixtures/fake-driver.mjs`.
**Touch (edit):** `runner/main.mjs` (start the engine when there is a database), `runner/package.json` + lockfile (pin `pg-boss`; check its Node 22 and Postgres 17 support and its current API in its own README before coding), `runner/Dockerfile` (install the Claude Code CLI at a **pinned** version, `npm i -g @anthropic-ai/claude-code@<exact>`; see its own docs for the name and a current version), `src/App.tsx` (only `driveTurn` in runner mode and what it needs),
`.github/workflows/ci.yml` (DB-test lines in the existing step), `docs/runner.md`, `docs/parity/PLAN.md`, `WORKLOG.md`, `STATUS.md`.
**Do NOT touch:** `runner/api/server.mjs` (use the registry: a new file under `routes/`; if you must edit it, STOP), `runner/db/store.mjs`, auth, `guard.mjs`, `deploy/compose.yml` (no jobs service: Q4), drivers other than via the `extras` hook, the local-harness code path in `App.tsx` (`driveTurn` outside runner mode stays byte-for-byte).

**Steps** (do them in this order; commit after each)
1. **Engine core with a fake driver.** `runner/worker/turns.mjs` `runTurn({ job, deps })`: load the agent record (`store.get(owner,"agents",agentId)`), the thread's messages (`store.list(owner,"messages",{thread})`), the system prompt (`buildSystemPrompt` from T02), the working folder (`resolveWorkspacePath(roots, slug, folder)` from T01 with the **agent's slug from the job**, never from the request), and the key from the secret store (`harness/secrets.mjs` `get`),
   passed to the driver **through its environment**, never an argument, never logged. Call `driver.startTurn(turn, io)`; map each driver event to a `job_events` row (`seq` increments per job) and the final reply to a `messages` record (so SB-02's stream already shows it).
2. **Redaction.** `events.mjs` scrubs any known secret value (all values from the secret store plus `Bearer …`, `sk-ant-…`, `xai-…`, `ghp_…`, `github_pat_…` patterns) from event data **before** insert and from error text; test with a driver that echoes the key.
3. **Queue.** `queue.mjs` wraps pg-boss: `enqueueTurn(job)` with `singletonKey = agentId` (one turn per agent at a time; the rest wait), a global concurrency cap from `limits.mjs`, separate caps for turns (`SANDBENCH_MAX_TURNS`) and builds (`SANDBENCH_MAX_BUILDS`). pg-boss keeps its own schema; `jobs` and `job_events` stay ours (link by `queue_job_id`). Unit-test the wrapper against Postgres.
4. **Approvals** survive a restart: `approvals.mjs` writes `approvals` rows (`T04` contract) for permission requests; the default policy from T04 (`needs: card`) applies to **every** action; the 30-minute timeout stays; on restart, pending approvals are still pending or expired by time.
5. **Restart behaviour.** On engine start: running turns whose heartbeat is stale are either resumed with `--resume <session_id>` (the Claude driver supports it) or marked failed `interrupted, retrying` and retried **exactly once** (`attempt` column). Tested with the fake driver on Postgres by killing the engine object mid-turn.
6. **API** (files under `runner/api/routes/`, owner-scoped, behind existing auth): `POST /api/turns {threadId, text}` (creates the user message, a `jobs` row, enqueues, returns `{ jobId }`), `GET /api/jobs/:id/events?after=<seq>` (SSE with catch-up from `after`; 404 for other owners), `POST /api/jobs/:id/interrupt`. The paused-agent rule: a turn for an agent with `data.paused === true` is refused with 409 "paused" (this is what T06's flag is for).
7. **Page, runner mode only:** `src/runnerTurns.ts` (start a turn, then watch its events; reconnect with `after`); `driveTurn` in `src/App.tsx` calls it only when runner mode is on (find the existing `runnerMode` flag with `grep -n "runner" src/App.tsx | head`). **Local harness mode must stay untouched**, with a test that proves the old path is still used when the flag is off.
8. **Dockerfile:** the pinned Claude Code CLI; keep the image start check (`/api/health` → 401 with no DB); report the image size.

**Tests** (all with fakes; Postgres for queue, jobs, restart)
- A message through the API gets its reply, and a **second client attaching after the turn finished** still reads the full event stream and the reply.
- Two turns for one agent run one after the other; two agents run together up to the cap (assert max concurrency with timing-free counters).
- Kill the engine mid-turn and start it again: resumes or posts "interrupted, retrying" and retries exactly once; a second kill → failed.
- Redaction: the key never appears in `job_events`, logs, process arguments (assert `spawn` args from the driver), or any API response.
- Owner isolation: owner B gets 404 on owner A's job and events; approvals survive a restart; paused agent refused; `agentSlug` in a request body is ignored.
- Vitest for `runnerTurns.ts` with a fake fetch/EventSource.

**Commands:** Standard checks + step 7 (image) + `node --test runner/test/engine.test.mjs runner/test/queue.test.mjs runner/test/jobs-api.test.mjs runner/test/redaction.test.mjs` (`skipped 0` for each; add to CI step).
**Done when (as far as testable):** the tests above pass in CI. **Pending live:** Vincent asks QA a question from his phone, closes the tab, finds the reply later (needs Q1's key and a running laptop runner). Do **not** tick the plan box.
**STOP if:** pg-boss will not run on the CI Postgres in two attempts; you need `compose.yml` changes (a jobs service, Q4); you need a real key; the page change would touch local-harness behaviour; or the task passes 1.5x its estimate.

---

## 5. Not scheduled: BLOCKED or left for the Supervisor on Thursday

| Item | State | Waiting for |
|---|---|---|
| SB-06 wiring (approvals, red gate, Stop all, `PreToolUse` hook, `004_audit.sql`, `ApprovalInbox.tsx`) | after T04, T08, T10 | The Supervisor schedules it (safety before tools) |
| SB-10 sandbench-tools MCP server | after T10 and the SB-06 wiring | Supervisor |
| SB-04 detached jobs, step cap | BLOCKED | Q4: a separate `jobs` compose service vs in-runner (changes the CI service-list test) |
| SB-11 core (GitHub App) | BLOCKED | Vincent creates the GitHub App (Vincent steps V3); interface and fake can be built after SB-10 |
| SB-12 build launches that open PRs | BLOCKED | Q2 (which builders), SB-04, SB-11 |
| Live part of SB-03 PR 2, the Claude CLI | BLOCKED | Q1: an API key (Vincent step V2) |
| Live part of SB-15a | BLOCKED | Q7: where the real team pack lives, and Vincent mounting it |
| Plan boxes for SB-02, SB-05, SB-08, SB-09, SB-13, SB-15a | unticked | Vincent's live checks (§7) |

If every task T01-T10 is done or blocked, write STATUS and WORKLOG and end the session. **Do not invent more work and do not start anything in this table.**

## 6. Vincent steps (only you can do these; none is needed for T01-T10 to be built and merged)

**V1. Merge PRs as they open.** `MERGE_GUIDE.md` has the 2-minute check and the exact command. Merge in task order.

**V2. An API key for the Claude CLI on the runner (needed before the live part of T10; Q1 default).**
Create an API key in the Anthropic Console (https://console.anthropic.com). I could not verify the console's current menu labels, so use its own navigation; set a spend limit there if it offers one.
Put it where the runner reads it, without pasting it into chat or the repo: either the **Anthropic key field** in the Sandbench page (the field for `ANTHROPIC_API_KEY`, defined in `src/views.tsx`; I have not opened the page, so the menu path to it is not verified), or `ANTHROPIC_API_KEY=` in `deploy/.env` on the laptop followed by `docker compose -f deploy/compose.yml --profile laptop up -d` (both are documented in `docs/runner.md` "API keys"). A key set in `deploy/.env` wins over one saved from the page.

**V3. A GitHub App (needed only for the live part of SB-11, after Thursday).** Docs: https://docs.github.com/en/apps/creating-github-apps and "Installing your own GitHub App".
Path: your profile picture → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**. Repository permissions: **Contents** and **Pull requests** = Read and write (Metadata read is automatic).
"Where can this GitHub App be installed?" → **Only on this account**. No webhook is needed for the core. After creating it, use **Install App** and pick only a scratch repository first. I have not seen the live pages, so labels for generating the private key may differ; follow the GitHub docs page above.
Do not paste the private key into chat or the repo; the SB-11 PR will say where the runner reads it.

**V4. Vercel Fork Protection.** Open the Vercel project → **Settings** → the **Security** section and check that Git Fork Protection is on (default is on). The API cannot read this back. Docs: https://vercel.com/docs/project-configuration/security-settings. I have not seen the live dashboard, so labels may differ slightly.

**V5. Rotate old keys.** Keys that older builds kept in Settings or in the Firestore copy should be rotated: create a new key at the provider (its own console), save it through the page's key field or `deploy/.env` (see V2), then revoke the old one at the provider. Never write a key into chat or the repo.

**V6. The team pack for SB-15a live (Q7).** Clone your private team repo on the laptop, then set `SANDBENCH_TEAM_HOST_DIR=<that folder on the laptop>` in `deploy/.env` (added to `.env.example` by T02) and restart the runner. Then run the dry run:
`docker compose -f deploy/compose.yml --profile laptop exec runner node runner/import/cli.mjs --dir /srv/team --owner auto --dry-run` and, once the report looks right, ask the Supervisor on Thursday to apply it.

**V7. Answer the open questions** (`NEXT_PHASE_BRIEF.md`, 7 of them) when you can; the Supervisor re-checks them on Thursday. Until then the defaults in §3 hold.

**V8. Keep the laptop awake** while you run live checks; the runner is offline when it sleeps.

## 7. Live checks pending (Vincent, on the laptop runner; the Supervisor helps on Thursday)

Tick a plan box only after the check passes. Do not let Claude tick them.
- After T01: nothing user-visible; confirm `/api/health` still works and a turn in a folder still runs (owner context unchanged).
- After T02: import step (V6) then ask QA "which widths do you check and which Firebase projects are off-limits?" (also needs T10 and Q1).
- After T03: from a shell in the runner container, `docker compose ... exec runner node -e` a screenshot of a public page (command will be in the PR) and read the image size.
- After T04: bare start still works; `/api/health` 401 without a token; nothing else changes.
- After T07: delete a bot while the laptop runner is off, turn it on, confirm the events disappear.
- After T09: run the dry run in the container and read the counts.
- After T10: ask QA a question from the phone, close the tab, find the reply later.
