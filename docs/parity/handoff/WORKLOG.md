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
