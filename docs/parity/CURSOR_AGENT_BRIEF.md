# Brief for a coding agent (Cursor cloud agent or Claude Code): SB-09, SB-08, SB-13

You are an outside coding agent working on the Sandbench parity plan. Vincent (the repo owner) is
your only stakeholder. He reviews and merges every PR. Read `docs/parity/PLAN.md` (the three items
below, "Top 3 risks" and the Progress log), `docs/parity/CLAUDE.md` and
`docs/parity/CLAUDE_CODE_PROMPT.md` before you change anything. If this brief and those files
disagree, **this brief wins**.

> **Handoff note (2026-10-26):** while `docs/parity/handoff/` is in use, its `WORKPLAN.md` sets the order and
> the exact steps for SB-09, SB-08 and SB-13 (tasks T01-T03), and its `STOP_POINTS.md` wins over this brief.

This repo is **public**. Commit messages, PR text, logs and test fixtures are all public.

## Rules (they override anything else)

- **Never force-push. Never rebase** (not even a branch you have not pushed). To catch up, merge
  `deploy/vercel` into your branch.
- **One PR per item**, with tests. Branch from the latest `deploy/vercel` as `sb-xx-short-name`.
  Open the PR **against `deploy/vercel`**. Never push to `deploy/vercel` or `main`, and never merge
  your own PR.
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
  personal emails, machine paths or player data. Tests and docs use `@example.test` addresses.
  Never put a secret in the repo, the page bundle or Firestore. Read new secrets through the
  secret store (`harness/secrets.mjs`), never hard-code them.
- **Where the runner runs:** on Vincent's laptop, reached through Tailscale Funnel
  (`https://sandbench.<your-tailnet>.ts.net`, see `docs/runner.md`, "Laptop runner"). That is the
  plan for now. **There is no Hetzner server, no Cloudflare tunnel setup and no other host planned.**
  Where `PLAN.md` says otherwise (Q1, Q9, the VM and Cloudflare Access wording), treat it as old.
  Do not write deployment code for a new host. Keep the laptop compose profile working, and note
  that the runner is offline whenever the laptop sleeps.
- Ask first (stop and report) before anything that costs money, needs an account or credential,
  deletes data or branches, rotates keys, or changes DNS.
- Tick a plan item's box only when its acceptance passes against live infrastructure. Otherwise add
  a line to the Progress log in `PLAN.md` (same PR) that says what is built and what is pending,
  and leave the box unticked. This replaces step 6 of `CLAUDE_CODE_PROMPT.md`.

## Where the project is (2026-10-26)

Built and merged into `deploy/vercel`, with their `PLAN.md` boxes **still unticked** because each
waits on a live check on Vincent's laptop:

- **SB-01** hosted runner (PR #3 and the laptop profile, PR #6)
- **SB-02** Postgres record store and change feed (PR #7), and the page's per-record sync in runner
  mode (PR #8, merged 2026-10-26, merge commit `02515f2`)
- **SB-05** secret store, `/model` proxy and key migration (PR #5)
- **SB-21 (skeleton)** CI (PR #2), ticked

**SB-05 follow-up (PR #9)** is merged (merge commit `84a3c17`, 2026-10-26): a broken `secrets.json` is
never overwritten, and migrated keys are saved before any copy is rewritten without them. PR #8 is
merged too (`02515f2`).

**Not built:** the turn engine (SB-03), detached jobs (SB-04), the MCP tool server (SB-10), the
approval and policy layer (SB-06), GitHub integration (SB-11), cloud builds (SB-12), the importer
(SB-15a) and everything in Phase 2 and Phase 4. Several things below depend on those. For each, build
the part that does not need the missing piece, put the missing piece behind a small interface with a
fake implementation, and write the interface down in the PR.

Behaviour to know about in runner mode: logs and computer events are append-only on the runner (the
page shows only the newest 40), and Firestore is read-only.

## Scope (Vincent's answer to Q10)

Vincent chose the faster option: **builders first.** That means Phase 0, Phase 1 and Phase 3, plus
only the core of SB-06 and SB-11 (no Projects board). QA, PixelPets, Design and Sprites move to
Sandbench first.

**Stays in Grok Bot, do not build:** the Supervisor, outside email (SB-17 and inbound email in
SB-15), and notifications to Vincent (SB-16). Also out of scope for now: SB-07 messaging, SB-14
scheduler, SB-18 attachments and the rest of Phase 4.

**This brief covers three items only: SB-09, SB-08 and SB-13.** They are the Phase 1 items that can
be built before the turn engine. Do **not** build SB-03, SB-04, SB-06, SB-10, SB-11 or SB-12 in this
brief. They are next on the Q10 path (with SB-15a for QA) and Vincent will send a separate brief.

## Start condition

PR #8 and PR #9 are both merged into `deploy/vercel` (`02515f2`, `84a3c17`), so this brief can start
now. Check that the tip of `deploy/vercel` has green checks first.

## Order

1. **SB-09** workspaces and worktrees
2. **SB-08** profile, skills and memory
3. **SB-13** headless browser and the emulator tools (needs the SB-09 resolver)

One PR each, in this order. Open the next one only after you have reported on the last. After
SB-13, stop and report.

## Checks to run before every push

Run these in the repo and show the output in the PR. Use Node 22 (CI does); on Node 20 the
`test:node` glob does not expand.

```bash
npm ci --no-audit --no-fund
npm ci --prefix runner --no-audit --no-fund
npm run typecheck
npm run test:web
# The datastore tests need a throwaway Postgres whose database name ends in _test (CI uses 17):
docker run --rm -d --name sb-pg -p 5432:5432 -e POSTGRES_USER=sandbench -e POSTGRES_PASSWORD=ci-only -e POSTGRES_DB=sandbench_test postgres:17-bookworm
export TEST_DATABASE_URL=postgres://sandbench:ci-only@127.0.0.1:5432/sandbench_test
npm run test:node
# the datastore tests must run, not skip:
set -o pipefail; node --test runner/test/data.test.mjs 2>&1 | tee /tmp/data.log; grep -q "^# skipped 0" /tmp/data.log
npm run build
# no API keys in the page bundle:
! grep -rEn 'sk-ant-[A-Za-z0-9]|xai-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9]' dist/
# no personal email addresses in tracked files:
! git ls-files -z -- . ':!:package-lock.json' ':!:runner/package-lock.json' | xargs -0 grep -nEI '[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|proton|protonmail)\.[a-z]{2,}'
# secrets in the full history (needs Docker):
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo --redact --no-banner --exit-code 1
# sign-in checks against real tokens from the Auth emulator:
(cd runner/test/emulator && npx --yes firebase-tools@14 emulators:exec --only auth --project demo-sandbench "node --test ../emulator.test.mjs")
```

If you touch `deploy/compose.yml` or `runner/Dockerfile`, also run
`docker compose -f deploy/compose.yml config -q` for the default, `laptop` and `cloudflare` profiles
(with placeholder values, as the `Runner image and compose file` job does) and
`docker build -f runner/Dockerfile -t sandbench-runner:ci .`. `deploy/compose.yml` must not publish
any `ports:`.

For each fix, switch it off once and confirm its test fails.

## SB-09: per-agent workspaces and git worktrees (2 d)

**Build**
- `runner/workspace/paths.mjs`: `resolveWorkspacePath(root, agentSlug, requested, { write })`. An
  agent may read the shared folder and its own folder, and write to its own folder (and to the
  shared folder only where the plan allows). It may never write into another agent's folder. Reject
  `..`, absolute paths outside the roots, symlink escapes (resolve with `realpath`) and null bytes.
  Roots come from `SANDBENCH_HOME` (shared, agents, wt), not hard-coded paths.
- `runner/workspace/worktrees.mjs`: `worktreeCreate({ repo, branch, base = "origin/main" })` and
  `worktreeRemove`. Use `execFile` with argument arrays, never a shell string. Repos come from an
  allowlist in config. Branch names are validated (`^[A-Za-z0-9._/-]{1,100}$`, no leading `-`, no
  `..`). Worktrees live in `wt/<slug>-<branch>`. `pruneWorktrees({ olderThanDays: 7 })` removes
  only merged ones.
- Wire the resolver into the runner's file and exec routes in `runner/api/server.mjs` and
  `runner/shell.mjs` (`insideRoot` is the starting point). Routes take the agent slug from the server-side context. A request body must
  not be able to choose its own slug (agents do not carry an id on tool calls yet; leave a clear
  seam for SB-03/SB-10 to pass it).

**Tests (real `git` in temp dirs)**
- Two agents build in separate worktrees off the same base and do not touch each other's checkout.
- One agent cannot write into another's folder or worktree, including via `..` and a symlink.
- QA can read the shared handoff folder. Design cannot write into PixelPets' worktree.
- Branch names with `-`, `..`, spaces or shell characters are refused. Prune removes only merged
  worktrees older than 7 days.

**Done when** the tests above pass in CI, the resolver is wired into the runner's file and exec
routes, and the PR says what is still to prove live (PixelPets and a review agent in real
worktrees needs SB-03 and SB-10).

**Stop and report if** the work needs a real game or team repo clone. Use local fixture repos.

## SB-08: agent profile, skills and memory (4 d)

Depends on SB-10 for tool exposure. Build the parts below as plain modules and HTTP routes.

**Build**
- The agent's profile fields (`slug`, `title`, `description`, `capabilities[]`, `model`, `driver`,
  `max_steps`, `budget_usd_day`, `workspace`) go in the existing agent record's `data`. The
  `agents` table already stores the Bot as JSON, so this needs no column change. Add them to
  `Bot` in `src/types.ts` as optional fields so old saves load.
- `runner/db/migrations/002_memory.sql` (`001_init.sql` is the only migration so far): `memory_items(owner, agent_id, kind profile|journal,
  text, created_at, tsv)` with a full-text index. `runner/agent/memory.mjs`: `memorySave`,
  `memorySearch` (Postgres full-text search). Owner-scoped, like the record store.
- `runner/agent/skills.mjs`: reads `.claude/skills/*/SKILL.md` from a configured team checkout
  (`SANDBENCH_TEAM_DIR`), returns name and description for the index, and `loadSkill(name)`. Re-read
  on every call so an edit changes behaviour on the next turn without a redeploy. Reject names that
  are not a plain skill directory.
- `runner/agent/prompt.mjs`: builds the system prompt from the profile description, the team
  `AGENTS.md`, the skills index, the profile memory and recent journal entries.
- The old file memory (`harness/server.mjs` `/bots/:id/memory`) becomes import-only: a one-time
  importer into `memory_items`. Do not remove the harness route.
- A `scripts/memory-backup.mjs` that exports memory to a directory. Do not schedule it (that is
  SB-14).

**Tests (Postgres)**
- Save and search memory, with owner isolation. A profile fact appears in the next prompt.
- Editing a skill file changes `loadSkill` output on the next call. `../` and absolute skill names
  are refused.
- The importer is idempotent.

**Done when** the Postgres tests above pass in CI and the PR says what is still to prove live.

**Live acceptance (needs the turn engine, so do not tick):** after import, QA answers "which widths do
you check and which Firebase projects are off-limits?" from memory.

## SB-13: headless browser and emulator tools (2 d)

Depends on SB-06 (policy) for tool exposure. Build the library and the image.

**Build**
- Switch `runner/Dockerfile` to a pinned `mcr.microsoft.com/playwright` base. Add Java 21, a
  pinned `firebase-tools`, Python 3 and `gh`. Keep the image small enough that the
  `Runner image and compose file` job stays under its 20-minute timeout. Report the image size.
- `runner/browser/screenshot.mjs`: `screenshot({ url, widths = [320, 375, 390], fullPage, waitFor })`
  saves PNGs into the calling agent's own workspace folder (SB-09 resolver) and returns their
  paths. Attachments (SB-18) are not built and are out of scope: put the save step behind a small
  `saveImage` interface so SB-18 can plug in later, and write the interface down in the PR.
  **Block SSRF:** allow only
  `http`/`https`, resolve the host and refuse loopback, link-local, private and cloud-metadata
  addresses unless the host is on an explicit allowlist (the live game URL and `localhost` for
  tests). Re-check after redirects.
- `runner/browser/emulator.mjs`: `emulatorStart`/`emulatorStop` wrap
  `firebase emulators:start --project demo-walklings` on the ports in the game repo's
  `firebase.json` (9099, 8180, 9000). Refuse any project id that does not start with `demo-`, and
  check ids against `runner/guard.mjs`.
- Do not remove `/screen` and `/input` from the harness. Only the runner path changes.

**Done when** the tests below pass in CI, `docker build` of the new image passes, and the PR
reports the image size and what is still to prove live (QA screenshotting the live build and
posting it needs SB-03, SB-06 and SB-10).

**Tests**
- Screenshot a local static page at the three widths and check image dimensions.
- SSRF: loopback, `169.254.169.254`, a private address, a redirect to a private address and a
  `file://` URL are all refused.
- The emulator wrapper refuses a non-`demo-` id and a guarded id, and accepts `demo-walklings`.

## Open follow-ups (known, not part of this brief)

Do not start these unless Vincent asks. Do not make them worse (for example, do not add another
unbounded table without a note in the PR).

- **Prune logs and computer events on the runner.** They are append-only and grow without a limit.
- **Retry the delete of a bot's computer events when the runner is down.** Today that delete is sent
  once and not retried, so the events stay on the runner.
- **Vercel Fork Protection:** confirm it is on (the setting cannot be read back through the API;
  Vincent checks it in the dashboard).
- **Rotate old keys.** Keys that older builds kept in Settings or in the Firestore copy should be
  rotated by Vincent. You never rotate keys.

## PR format and reporting

Each PR description has: Plan, What changed, How it was checked (paste the check output), What is
not covered, and Still to prove live. Put one line in the `PLAN.md` Progress log, in the same PR.

After each PR, post in the PR conversation:
- what you built and which dependency you stubbed;
- the check output;
- anything you stopped on that needs Vincent (money, accounts, credentials, a decision);
- the next item you will start (or, after SB-13, that you have stopped).
