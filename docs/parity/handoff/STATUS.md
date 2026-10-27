# STATUS (rewritten by Claude at the end of every session; one screen)

**Last updated:** 2026-10-26 22:05 ET by Session 1 (Claude Code) · **Last session number:** 1
**Window:** Tue Oct 27 → Thu Oct 29 morning, 2026. Bots return Thursday.
**Base branch:** `deploy/vercel`. Latest merged on it: #12 (handoff pack, `4b69bd5`).

## Tasks (state: todo · in progress · PR open · merged · blocked)

| Id | Item | State | Branch | PR | Notes |
|---|---|---|---|---|---|
| T01 | SB-09 workspaces and worktrees | PR open | `sb-09-workspaces` | #13 | reworked to the T01 spec; worktrees at `wt/<slug>/<repo>/<branch>` (Vincent's choice) |
| T02 | SB-08 profile memory and skills | PR open (draft) | `sb-08-profile-memory` | #14 | built to the brief before #12 landed; draft until T01 merges, then reworked to the T02 spec |
| T03 | SB-13 browser emulator | todo | `sb-13-browser-emulator` | n/a | independent (needs only SB-01) |
| T04 | SB-03 PR 1 contracts, `003_jobs.sql`, route registry | todo | `sb-03a-contracts` | n/a | needs T02 merged (migration order) |
| T05 | PLAN.md stale host text (docs only) | todo | `docs-plan-laptop-text` | n/a | independent |
| T06 | SB-15a team pack importer | todo | `sb-15a-team-pack-import` | n/a | needs T02 merged; live part blocked on Q7 (team pack location) |
| T07 | Retry runner-side bot-event delete | todo | `sb-fu-bot-event-delete` | n/a | independent |
| T08 | SB-06 slice A policy classifier | todo | `sb-06a-classifier` | n/a | independent, not wired |
| T09 | Prune dry run for logs and computer rows | todo | `sb-fu-prune-dry-run` | n/a | independent |
| T10 | SB-03 PR 2 turn engine (stretch) | todo | `sb-03b-turn-engine` | n/a | needs T01, T04 merged; live part blocked on Q1 (API key) |
| – | SB-29 agent isolation (build) | todo | – | – | decided 2026-10-27; blocks SB-04 and SB-10's acting tools |
| – | SB-04, SB-10, SB-11, SB-12, SB-06 wiring | blocked | – | – | not scheduled; Supervisor re-plans Thursday (see WORKPLAN §5) |

## Open PRs awaiting Vincent's merge
- **#13** SB-09 (T01): merge when the 4 required checks are green on its head.
- **#14** SB-08 (T02): **draft, do not merge yet**. It is reworked to the T02 spec after #13 merges.
- PR #10 "Parity gap audit" is open and is **not** Claude's: leave it.

## Blockers and questions
1. Docker Desktop does not start on Vincent's Windows machine (WSL has no distribution installed). Local Postgres, gitleaks and image checks rely on CI until it is fixed. Postgres tests can run locally against PGlite (WASM Postgres) as a stopgap.
2. Agent isolation: **decided 2026-10-27** (branch `sb-isolation-decision`, docs only). A `sandbox` compose service with one Linux user per agent, no keys and no route to Postgres, built as new item SB-29 (Track 3). SB-04 and SB-10's acting tools wait for it. Design: `docs/runner.md`, "Agent isolation".

## Live checks pending (Vincent, on the laptop runner)
See `WORKPLAN.md` §7. Plan boxes stay unticked until he confirms.
