# STATUS (rewritten by Claude at the end of every session; one screen)

**Last updated:** 2026-10-26 21:40 ET by Session 0 (Grok Bot executor) · **Last session number:** 0
**Window:** Tue Oct 27 → Thu Oct 29 morning, 2026. Bots return Thursday.
**Base branch:** `deploy/vercel`. Latest merged on it: #12 (handoff pack; sha in `gh pr view 12`).

## Tasks (state: todo · in progress · PR open · merged · blocked)

| Id | Item | State | Branch | PR | Notes |
|---|---|---|---|---|---|
| T01 | SB-09 workspaces and worktrees | todo | `sb-09-workspaces` | n/a | next |
| T02 | SB-08 profile memory and skills | todo | `sb-08-profile-memory` | n/a | needs T01 merged |
| T03 | SB-13 browser emulator | todo | `sb-13-browser-emulator` | n/a | independent (needs only SB-01) |
| T04 | SB-03 PR 1 contracts, `003_jobs.sql`, route registry | todo | `sb-03a-contracts` | n/a | needs T02 merged (migration order) |
| T05 | PLAN.md stale host text (docs only) | todo | `docs-plan-laptop-text` | n/a | independent |
| T06 | SB-15a team pack importer | todo | `sb-15a-team-pack-import` | n/a | needs T02 merged; live part blocked on Q7 (team pack location) |
| T07 | Retry runner-side bot-event delete | todo | `sb-fu-bot-event-delete` | n/a | independent |
| T08 | SB-06 slice A policy classifier | todo | `sb-06a-classifier` | n/a | independent, not wired |
| T09 | Prune dry run for logs and computer rows | todo | `sb-fu-prune-dry-run` | n/a | independent |
| T10 | SB-03 PR 2 turn engine (stretch) | todo | `sb-03b-turn-engine` | n/a | needs T01, T04 merged; live part blocked on Q1 (API key) |
| – | SB-04, SB-10, SB-11, SB-12, SB-06 wiring | blocked | – | – | not scheduled; Supervisor re-plans Thursday (see WORKPLAN §5) |

## Open PRs awaiting Vincent's merge
None from Claude yet. (PR #10 "Parity gap audit" is open and is **not** Claude's: leave it.)

## Blockers and questions
None yet.

## Live checks pending (Vincent, on the laptop runner)
See `WORKPLAN.md` §7. Plan boxes stay unticked until he confirms.
