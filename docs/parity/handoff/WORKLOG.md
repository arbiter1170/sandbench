# WORKLOG

Append-only. **Newest entry at the top**, directly under the line "ENTRIES START BELOW". Never edit or
delete an old entry (add a correction in a new one). Every Claude session adds exactly one entry before it
ends, including sessions that STOP or make no progress. Real results only: paste real command output or
write "not run" and why. If a merge conflict hits this file, keep both sides, newest first.

Session numbers: **Session 0** is the Grok Bot/Supervisor handoff below. Claude's sessions are 1, 2, 3...
(next number = the number in the top entry + 1).

## Entry template (copy this, fill every field, keep the headings)

```markdown
### Session <N> · <YYYY-MM-DD HH:MM ET> · <task id, e.g. T01 SB-09> · <done | partial | STOP | review fix>
- **Branch / PR / head sha:** `<branch>` · <PR link or "no PR yet"> · code head `<sha before this log commit>` (final head after the log commit is in the session summary)
- **Checks on the head:** <4 required checks: pass/pending/fail by name>
- **What was done:** <bullets: files created/changed, behaviour added, in plain words>
- **Tests run (real results):** <command → result, e.g. `npm run test:web` → 212 passed. DB tests → `# skipped 0`, N pass>
- **Not run / could not run:** <or "none">
- **Decisions made and why:** <each decision, the options, the reason>
- **Deviations from the plan:** <anything outside the task's Touch list, or where handoff docs overrode a brief; or "none">
- **Open questions for Vincent or the Supervisor:** <numbered; what you need, what you recommend; or "none">
- **Next step:** <the next task id, or what Vincent must do first (merge #N, answer Q)>
```

---
ENTRIES START BELOW

### Session 3 · 2026-10-26 22:55 ET · T03 SB-13 · done
- **Branch / PR / head sha:** `sb-13-browser-emulator` · https://github.com/arbiter1170/sandbench/pull/17 · code head `060b5d0` (final head after the log commit is in the session summary)
- **Checks on the head:** on `060b5d0`, all 4 required checks pass: Typecheck, test, build (1m38s); Secret scan; Runner sign-in checks (Auth emulator); Runner image and compose file (1m36s).
- **What was done:**
  - Merged #14 at Vincent's request (`264cf6d`). Brought #15 up to date with `deploy/vercel`, keeping both WORKLOG entries, newest first.
  - `runner/Dockerfile`: runtime on `mcr.microsoft.com/playwright:v1.64.1-noble`. That image ships Node 24, so NodeSource's `node_22.x` repo replaces the base's and `nodejs` is reinstalled. The build fails unless `node -v` is 22.
  - Also in the image: Java 21 (`openjdk-21-jre-headless`), `gh` from GitHub's apt repo, Python 3, tini and `firebase-tools@14.27.0`. It still runs as non-root (`pwuser`). `npm ci` uses `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. `playwright@1.64.1` (exact) is in `runner/package.json`.
  - `runner/browser/ssrf.mjs`:
    - `assertSafeUrl` allows only http(s), no credentials, and requires every resolved address to be public.
    - The ranges are separate IPv4 and IPv6 `BlockList`s, because one list with `::ffff:0:0/96` refuses every IPv4 address.
    - Also refused: `localhost` and `metadata.google.internal`, and odd numeric spellings.
    - `startSafeProxy` is a local proxy, used as Chromium's only way out. It checks every request and redirect hop and connects to the exact address it checked.
  - `runner/browser/screenshot.mjs`: 320/375/390 PNGs at scale 1, run through that proxy with loopback included (`<-loopback>`). `runner/browser/images.mjs`: the `saveImage({outDir, name, buffer}) → {path, bytes}` interface, for SB-18 to plug into.
  - `runner/browser/emulator.mjs`: `demo-*` only, refuses guarded ids (including `SANDBENCH_BLOCKED_PROJECTS`), always passes `--project`, and uses a temporary 0600 config that is removed on stop.
  - CI, inside existing jobs only: `npx playwright install --with-deps chromium` before `npm run test:node`, and `docker image ls` plus `node -v` after the image build.
  - `docs/runner.md` "Browser and emulator"; a `PLAN.md` log line (box not ticked).
- **Tests run (real results):**
  - Locally (Windows, Chromium from `npx playwright install chromium`): `node --test runner/test/ssrf.test.mjs runner/test/screenshot.test.mjs runner/test/emulator-wrapper.test.mjs` → 13 pass, 0 fail, 0 skipped.
  - CI on `060b5d0`: all 4 checks green. Image `sandbench-runner:ci` is **3.24GB**, Node in the image is **v22.23.4**, and the image job took 1m36s.
  - Mutation check: the required two are caught (traffic through the checking proxy, and the `demo-` check). Also caught: guarded id, link-local and metadata range, IPv4-mapped IPv6, every resolved address checked, credentials, http(s) only, loopback only when listed.
  - Setting `bypass` to `""` was not caught, because Playwright adds `<-loopback>` on its own. Setting `bypass` to `localhost,127.0.0.1,<local>` is caught (the redirect test fails).
- **Not run / could not run:** the local image build (Docker doesn't work on this machine; CI built it). Local typecheck (this worktree has no root `node_modules`; no `src/` change, CI passed). Only one image variant was built, so there is no size for the multi-stage alternative.
- **Decisions made and why:**
  - **The SSRF check is a proxy, not just `page.route`.** First try: check each request in `page.route`. Chromium followed a redirect without asking the route, and the test timed out reaching `169.254.169.254`. Second try: `route.fetch` with redirects off, checking `Location`. That still let a two-hop chain through: a safe first hop, then a 302 to a refused host, which was actually requested. The proxy closes both, and DNS rebinding too. That was the second and last attempt on that test (STOP point 8 not reached).
  - **Node 22 from NodeSource on the Playwright base**, the spec's first option. The multi-stage alternative was not tried, so its size is unknown.
- **Deviations from the plan:**
  - `startSafeProxy` lives in `ssrf.mjs`, because T03's Touch list has no proxy file.
  - The CI image step also prints the image size and Node version. That edit is inside the existing job, and the spec asks for the size.
  - Two failed image builds would have been a STOP; the first failed on Node 24 and the second passed.
- **Open questions for Vincent or the Supervisor:**
  1. The image is 3.24GB, since the base ships Chromium, Firefox and WebKit. A node:22-bookworm-slim build with only Chromium (`playwright install --with-deps chromium`) would likely be much smaller, but it moves off the planned base. Recommend trying it as a follow-up if laptop disk or build time matters.
  2. On the first run, the test job took 10m03s, against its 15-minute limit, because of `playwright install --with-deps chromium`. The rerun took 1m38s. Watch it; caching the browser is a possible follow-up.
- **Next step:** Vincent merges #17 when he's happy with the image size. T04 (SB-03 contracts) is unblocked, since #14 is merged. Other independent tasks: T05, T07, T08, T09.

### Session 2 · 2026-10-26 22:25 ET · T02 SB-08 · done
- **Branch / PR / head sha:** `sb-08-profile-memory` · https://github.com/arbiter1170/sandbench/pull/14 · code head `74b11ca` (final head after the log commit is in the session summary)
- **Checks on the head:** pending at the time of writing.
- **What was done:**
  - #14 was opened in Session 1 to the brief, before #12 landed, and has been a draft since. #13 (T01) merged as `d6b4b27`. This session merged `deploy/vercel` into #14 (taking base's `server.mjs` and `PLAN.md` for the SB-09 conflicts) and reworked it to the T02 spec with new commits.
  - `002_memory.sql`: `memory_items`, 8000-character items, `source_hash` with a unique `(owner, agent_id, source_hash)` index, plus the by-agent index and the GIN index.
  - `runner/agent/memory.mjs`: `createMemory` returns `save`, `search` (`websearch_to_tsquery` with rank, limit 1-50), `recent` and `profile`. Every query filters on owner and agent.
  - `runner/agent/skills.mjs`: `createSkills({dir})` returns `index` and `loadSkill`. Files are read on every call. Names follow `^[a-z0-9][a-z0-9-]{0,60}$`. A skill must be a real folder (checked with `lstat`) whose real path stays inside `.claude/skills`. With no folder it returns `[]` or `null`.
  - `runner/agent/prompt.mjs`: an async `buildSystemPrompt`. Order: profile, AGENTS.md, skills, profile memory, 10 newest journal items. Each section is cut at a word with a marker, the total is at most 40,000 characters, and the output is deterministic.
  - `runner/agent/memory-import.mjs` and `memory-backup.mjs`, both with CLIs.
  - `runner/api/memory.mjs`: `/api/memory` (GET and POST), `/api/skills`, `/api/skills/:name` and `/api/prompt/:agentId`. `server.mjs` mounts them next to the data routes and answers 503 for memory and prompt without a database.
  - `main.mjs`; camelCase `Bot` fields in `src/types.ts`.
  - The compose read-only mount `${SANDBENCH_TEAM_HOST_DIR:-./team-empty}:/srv/team:ro`, `deploy/team-empty/.gitkeep`, and a commented line in `.env.example`.
  - CI: two lines added inside the existing "datastore tests ran" step.
  - `data.test.mjs` migration list, `docs/runner.md`, and a `PLAN.md` log line. The box is not ticked.
  - Removed from the earlier version: `scripts/memory-*.mjs`, the Dockerfile change, `runner/api/agent.mjs`, and the separate CI step.
- **Tests run (real results):**
  - With `TEST_DATABASE_URL` pointing at PGlite (Postgres 17 in WASM, run from a scratch folder; Docker is not working on this machine): `node --test runner/test/memory.test.mjs runner/test/skills.test.mjs runner/test/prompt.test.mjs` → 18 pass, 0 fail, 0 skipped. `memory.test.mjs` ran 9 tests.
  - `npm run typecheck` → clean. `npm run test:web` → 35 passed.
  - Mutation check, all 13 caught: owner filter in search; agent filter in search; owner filter in profile; import dedupe; size limit; skill realpath containment; linked skill folder (lstat); re-read on every call; skill name rule; 40,000 cap; profile facts in prompt; owner from sign-in; 503 without a database.
  - CLI smoke test on PGlite:
    - The import refused with no agent record.
    - It then inserted 3 items; a second run inserted 0.
    - The backup wrote `qa/profile.md` (2 items) and `qa/journal.md` (1 item).
- **Not run / could not run:**
  - Stock Postgres 17, gitleaks, `docker compose config` and `docker build`. Docker Desktop doesn't start here (WSL has no distribution); CI runs them.
  - `data.test.mjs` on PGlite (it uses LISTEN/NOTIFY); CI runs it.
- **Decisions made and why:**
  - `buildSystemPrompt` takes `owner` as well as the agent record, because memory is owner-scoped and the record doesn't carry its owner.
  - Section budgets: description 8,000, AGENTS.md 12,000, skills 4,000, profile 10,000, journal 5,000, which adds up to under 40,000.
  - The import CLI picks the owner only when exactly one account has that agent; otherwise it asks for `--owner`.
- **Deviations from the plan:**
  - The importer also reads `memory/*.md` as profile items. The harness keeps topic memory there, and skipping it would lose memory.
  - `createRunner` builds skills from its `teamDir` option instead of taking a skills object.
  - Both CLIs live under `runner/agent/`, as the spec says. The brief's `scripts/memory-backup.mjs` is replaced, also as the spec says.
  - The rest stays inside T02's Touch list.
- **Open questions for Vincent or the Supervisor:** none new. Docker on Windows and the isolation decision (#16) are tracked in STATUS.
- **Next step:**
  - Vincent merges #14 when its 4 checks are green. It also needs the compose and image checks, because `deploy/compose.yml` changed; CI runs those.
  - #15 (iPhone sign-in) and #16 (isolation docs) are also waiting. Whichever of #14, #15 and #16 merges later gets a WORKLOG conflict that the next session resolves, keeping both entries with the newest first.
  - Next tasks: T03 (SB-13, independent), and T04 once #14 is merged.

### Session 1 · 2026-10-26 22:05 ET · T01 SB-09 · done
- **Branch / PR / head sha:** `sb-09-workspaces` · https://github.com/arbiter1170/sandbench/pull/13 · code head `4c6958d` (final head after the log commit is in the session summary). PR #12's merge commit on `deploy/vercel`: `4b69bd53bf7ee7df9403a627f4d7d358374e685a`.
- **Checks on the head:** pending at the time of writing (the first version of this PR had all 4 required checks green on `7fa061c`).
- **What was done:**
  - The session started from `CURSOR_AGENT_BRIEF.md`, before PR #12 merged. PR #13 was first built to the brief, with all 4 required checks green on `7fa061c`. Then #12 merged, so this session reworked #13 to the T01 spec with new commits (merge of `deploy/vercel`, no rebase, no force-push).
  - `runner/workspace/paths.mjs`:
    - `workspaceRoots(home)` returns `{legacy, shared, agents, wt}`.
    - Also exports `AGENT_SLUG` and `WorkspaceError` (`invalid | outside | forbidden`).
    - `resolveWorkspacePath(roots, agentSlug, path, {write})` throws on a refused path.
    - Owner context (`null`) is `workspace/` as before, plus link and null-byte checks.
    - Agents read `shared/`, write only under `shared/handoff/`, use their own folder, and use only their own `wt/<slug>/`.
    - `..`, absolute paths, drive letters, backslashes and null bytes are refused. Links are followed with `realpath`, and dangling links are refused.
  - `runner/workspace/worktrees.mjs`:
    - `createWorktrees({roots, repos, exec})` returns `{create, remove, prune}`.
    - `parseRepoAllowlist` parses `SANDBENCH_REPOS`.
    - Every input is checked before the first `git` call.
    - `create` uses `--no-track`. `remove` never uses `--force`.
    - `prune` checks merged plus folder mtime older than 7 days, keeps dirty worktrees, removes with `git branch -d` only, and is a dry run by default.
  - `runner/workspace/index.mjs` re-exports.
  - `runner/api/server.mjs` creates the four roots and resolves through the new rules in the owner context. `turns.start(body, { agentSlug: null })`.
  - `harness/turns.mjs`: `start(body, ctx = {})` passes `ctx` to `resolveFolder`.
  - `docs/runner.md`: a "Workspaces" section.
  - `PLAN.md`: one Progress log line. The box is not ticked.
  - `runner/shell.mjs` and `runner/test/server.test.mjs` are unchanged from base.
- **Tests run (real results):**
  - `node --test runner/test/workspace.test.mjs runner/test/worktrees.test.mjs harness/test/turns.test.mjs` → 16 pass, 0 fail, 0 skipped.
  - `node --test runner/test/server.test.mjs` → 13 pass. 1 fails only locally: `exec needs approval and runs in bash`, because Windows has no `/bin/bash`. It passed in CI on the first version.
  - Mutation check: all 12 caught. Required: symlink check, `..` check, slug owner check on `wt/`, unmerged-prune check. Extra: dangling link, null byte and backslash, shared write outside handoff, `--no-track`, branch check before git, dirty kept, dry-run default, young kept.
- **Not run / could not run:**
  - Docker Desktop does not start on this Windows machine (WSL has no distribution installed). Not run locally: Postgres, gitleaks, compose and image checks, and the bash exec test. CI runs them.
  - The local Node is 24, not 22. Test files were listed explicitly.
- **Decisions made and why:**
  - Worktrees live in `wt/<slug>/<repo>/<branch>`, not `wt/<slug>-<branch>`. With a `<slug>-` prefix check, agent `qa` would match `qa-lead-x` and could reach `qa-lead`'s worktree. Vincent chose this layout in chat on 2026-10-26.
  - `remove` takes `{agentSlug, repo, branch}` instead of `{agentSlug, name}`, which follows from the layout.
  - A dangling symlink is refused, which is stricter than "realpath of the deepest existing ancestor".
  - `create` fetches `origin` before branching off an `origin/...` base, so a worktree doesn't start from a stale base.
- **Deviations from the plan:**
  - `prune` defaults to `dryRun: true`, not `false`. STOP_POINTS §2 says deleting code ships dry-run by default, and STOP_POINTS wins over WORKPLAN.
  - Worktree layout as above, with Vincent's approval.
  - No files outside T01's Touch list (diff against `deploy/vercel`: `docs/parity/PLAN.md`, `docs/runner.md`, `harness/turns.mjs`, `runner/api/server.mjs`, `runner/workspace/*`, two new test files, plus this log and STATUS).
- **Open questions for Vincent or the Supervisor:**
  1. Real isolation between agents. These rules limit the runner's routes, not what a bash command can open. Recommend deciding before SB-10 gives agents `exec`: a separate OS user or container per agent.
  2. PR #14 (SB-08) was opened in this session before #12 landed. It is now a **draft** until #13 merges. It will then be reworked to the T02 spec in a later session, with new commits and no force-push.
- **Next step:** Vincent merges #13 when its 4 checks are green. Then T02 reworks #14 to the spec. Independent tasks T03, T05, T07, T08 and T09 can go meanwhile.

### Session 0 · 2026-10-26 21:40 ET · Handoff pack written · done
- **Branch / PR / head sha:** `sb-next-phase-brief` · PR #12 (next-phase brief + this handoff pack) · merged by Grok Bot executor on Vincent's approval; its merge commit is on `deploy/vercel` (find it with `gh pr view 12 --json mergeCommit -q .mergeCommit.oid`). **Session 1 must record that sha in its entry.**
- **Checks on the head:** all 4 required checks were green on the head that was merged.
- **What was done (by the Supervisor/Grok Bot executor, before leaving until Thu Oct 29):**
  - PRs merged into `deploy/vercel`, each verified with typecheck, vitest, node tests, DB tests on Postgres and the 4 required checks before merging:
    - #5 → `878e56cb9ead176e41e3685492deb42b0040d4a0`
    - #6 → `caeb5c71bf1bc78873f6f2ef2e0158466945f697`
    - #7 → `6c30e4b0bd8ec575141116c52e5d438af95a9537`
    - #8 → `02515f29706c49de0e09ec75ff0b0dd56b4c8859`
    - #9 → `84a3c1725e01d0ca730051956a97ebefeb08c91c`
    - #11 → `31d3ec339c7cab3dc92a1c23828903e8a13af98f`
  - PR #12 added `docs/parity/NEXT_PHASE_BRIEF.md` (what comes after SB-09, SB-08, SB-13: SB-03, SB-04, SB-10, SB-06 core, SB-11 core, SB-12, SB-15a; four tracks, at most 3 agents, 7 open questions with PROVISIONAL defaults because Vincent skipped the card) and this `docs/parity/handoff/` pack. Edited `CLAUDE.md` (pointer to the pack) and fixed the stale "PR #9 may not be merged" text in `CURSOR_AGENT_BRIEF.md`.
  - PR #10 ("Parity gap audit", docs only) is still **open**. It is not part of this work. Do not touch it.
- **Tests run (real results):** not applicable to this docs-only entry; PR #12 had all 4 required checks and Vercel green on its head before merge.
- **Decisions made and why:**
  - The handoff docs override the briefs and PLAN.md where they disagree (the briefs were written for chat-driven agents; Claude works alone).
  - Open questions Q1-Q7 of `NEXT_PHASE_BRIEF.md` use their provisional defaults. Claude may scaffold behind interfaces but must not do anything that needs Vincent (create a GitHub App, add or use an API key, spend money).
- **Deviations from the plan:** none.
- **Known follow-ups (all are tasks in `WORKPLAN.md` unless marked):**
  1. SB-09 → SB-08 → SB-13 from `CURSOR_AGENT_BRIEF.md` (T01-T03).
  2. SB-03 PR 1 contracts, migration `003_jobs.sql`, route registry, driver `extras` hook, tools auto-discovery (T04).
  3. `PLAN.md` still says Hetzner / Cloudflare in Q1, Q9, SB-01 and the diagram; the truth is the laptop runner via Tailscale Funnel (T05).
  4. Deleting a bot swallows a failed runner-side delete: `src/App.tsx` (the `removeWhere("computer", ...)` line) has `.catch(() => undefined)` (T07).
  5. No retention or pruning for `logs` and `computer` rows (T09, dry run only).
  6. `PLAN.md` SB-05 names `runner/secrets.mjs`; the real file is `harness/secrets.mjs`.
  7. `runner/test/data.test.mjs` hard-asserts the migration list (`["001_init.sql"]` today), so every migration PR must update it.
  8. CI's "datastore tests ran (not skipped)" step greps only `data.test.mjs`; new DB test files must be added to that step.
  9. The Dockerfile copies only `harness`, `runner` and `dist` into the image: code that must run in the container goes under `runner/` or `harness/`.
  10. Live acceptance checks of merged items are Vincent's (laptop runner); plan boxes stay unticked until he confirms (see `WORKPLAN.md` "Live checks pending").
- **Open questions for Vincent or the Supervisor:** the 7 in `NEXT_PHASE_BRIEF.md` (API key; which builders; GitHub App; a `jobs` compose service; laptop caps; no `pr_merge` now; team pack location). None blocks T01-T09.
- **Next step:** Session 1 starts at T01 (SB-09). Vincent merges PRs as they come (`MERGE_GUIDE.md`).
