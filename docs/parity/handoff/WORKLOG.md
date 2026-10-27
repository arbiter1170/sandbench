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

### Session 2 · 2026-10-27 · isolation decision (docs only) · done
- **Branch / PR / head sha:** `sb-isolation-decision` · PR link in the session summary · docs-only commit on top of `d6b4b27`
- **Checks on the head:** pending at the time of writing.
- **What was done:**
  - Recorded the agent-isolation decision Vincent picked: a `sandbox` compose service with one Linux user per agent, no keys, no secrets file, no route to Postgres; model calls through `/api/model`. It replaces SB-04's planned `jobs` service.
  - `docs/runner.md`: new section "Agent isolation (decided, SB-29)"; the "not a sandbox" bullet points to it.
  - `docs/parity/PLAN.md`: new item SB-29 (unticked) with acceptance; SB-04 depends on it; SB-10's acting tools wait for it; one Progress log line.
  - `docs/parity/NEXT_PHASE_BRIEF.md`: open question 4 answered, new open question 8 (answered), SB-29 in the scope, dependency and track tables (Track 3), gate lines in SB-04 and SB-10. The brief's Rules section is untouched.
  - This entry and `STATUS.md`.
- **Tests run (real results):** none needed (docs only). Secret scan runs in CI.
- **Not run / could not run:** gitleaks locally (not installed here).
- **Decisions made and why:** a shared sandbox service with a uid per agent over a container per agent (lighter on the laptop, no Docker socket for the runner) and over uids inside the runner container (that would leave agents on the Postgres network and next to the secrets volume).
- **Deviations from the plan:** none; docs only.
- **Open questions for Vincent or the Supervisor:** none new. Docker Desktop on Windows still needs a WSL distribution (`wsl --install -d Ubuntu`, then restart Docker Desktop).
- **Next step:** Vincent reviews and merges this docs PR; SB-29 is built in Track 3 alongside SB-06 core.

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
