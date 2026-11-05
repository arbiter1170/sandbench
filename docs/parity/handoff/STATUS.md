# STATUS (rewritten by Claude at the end of every session; one screen)

**Last updated:** 2026-11-05 by Session 7 (Cursor cloud agent; docs refresh + T05) · **Last session number:** 7
**Window:** the Tue Oct 27 → Thu Oct 29 handoff window has passed. `WORKPLAN.md` stays the task source until the Supervisor re-plans (`THURSDAY_RESUME.md` §1.7); Vincent approved continuing with T10 on 2026-11-05.
**Base branch:** `deploy/vercel`. Latest merged on it: #18 (SB-03 PR 1, `7068fc3`); before it #15 (iPhone sign-in, `aa42aa0`), #10 (gap audit, `506d0e4`), #19 (skill front matter, `04f237f`), #16 (SB-29 decision, `68128a4`), #17 (SB-13, `8735ee8`). CI is green on `7068fc3`. No PR is open apart from this session's.

## Tasks (state: todo · in progress · PR open · merged · blocked)

| Id | Item | State | Branch | PR | Notes |
|---|---|---|---|---|---|
| T01 | SB-09 workspaces and worktrees | merged | `sb-09-workspaces` | #13 | `d6b4b27`; worktrees at `wt/<slug>/<repo>/<branch>` (Vincent's choice) |
| T02 | SB-08 profile memory and skills | merged | `sb-08-profile-memory` | #14 | `264cf6d` |
| T03 | SB-13 browser emulator | merged | `sb-13-browser-emulator` | #17 | `8735ee8`; image 3.24GB |
| T04 | SB-03 PR 1 contracts, `003_jobs.sql`, route registry | merged | `sb-03a-contracts` | #18 | `7068fc3`; no behaviour change |
| T05 | PLAN.md stale host text (docs only) | PR open | `cursor/docs-plan-laptop-text-93f7` | #20 | docs only; carries this STATUS/WORKPLAN refresh |
| T06 | SB-15a team pack importer | todo | `sb-15a-team-pack-import` | n/a | unblocked; live part blocked on Q7 (team pack location) |
| T07 | Retry runner-side bot-event delete | todo | `sb-fu-bot-event-delete` | n/a | independent |
| T08 | SB-06 slice A policy classifier | todo | `sb-06a-classifier` | n/a | independent, not wired |
| T09 | Prune dry run for logs and computer rows | todo | `sb-fu-prune-dry-run` | n/a | independent |
| T10 | SB-03 PR 2 turn engine | in progress | `cursor/sb-03b-turn-engine-93f7` | next PR | T01, T02, T04 merged; Vincent approved the build 2026-11-05; live part blocked on Q1 (API key) and the laptop runner |
| – | SB-29 agent isolation (build) | todo | – | – | decided 2026-10-27 in PR #16, simplified 2026-10-28 (one sandbox, no per-agent users); blocks SB-04 and SB-10's acting tools, and the engine's own shell tool in runner mode |
| – | SB-04, SB-10, SB-11, SB-12, SB-06 wiring | blocked | – | – | not scheduled; Supervisor re-plans (see WORKPLAN §5). SB-29 (sandbox) gates SB-04 and SB-10's acting tools |

## Open PRs awaiting Vincent's merge
- **#20** docs PR (T05 + this refresh). Docs only; the four required checks run on it like any PR.
- The T10 engine PR follows on its own branch cut from `deploy/vercel` (not stacked). Whichever merges second gets a WORKLOG/STATUS conflict; keep both entries, newest first.
- #15 and #18 are merged; prior STATUS text that calls them open is superseded by this one.

## Blockers and questions
1. Docker Desktop does not start on Vincent's Windows machine (WSL has no distribution; Docker's backend VM never starts). Fix steps were given in chat: `wsl --update`, `wsl --install -d Ubuntu`, then restart Docker Desktop. Vincent has deferred this; the existing local harness with his own Claude Code subscription is his priority. Until then CI runs the Postgres, gitleaks and image checks.
2. Agent isolation: answered in PR #16 (SB-29: one sandbox container with no keys and no route to Postgres; no per-agent users, since Vincent is the only user), merged (`68128a4`). Not built yet.
3. The runner image is 3.24GB with the Playwright base (Chromium, Firefox and WebKit). A Chromium-only build on node:22-bookworm-slim would likely be much smaller, at the cost of leaving the planned base. Decide whether that follow-up is worth it.
4. Q1 (model access for the runner's Claude CLI: API key vs subscription login) is still unanswered; the T10 live check needs it. Vincent uses his own Claude Code subscription on the local harness; the engine does not use it and does not widen any auth.
5. Local UI symptom (a reply that stays "Thinking" after the answer) is being checked separately on Vincent's machine. Not folded into T10; a scoped PR follows if evidence confirms it.

## Live checks pending (Vincent, on the laptop runner)
See `WORKPLAN.md` §7. Plan boxes stay unticked until he confirms. None has run yet (the laptop runner is not up: Docker Desktop, blocker 1).
