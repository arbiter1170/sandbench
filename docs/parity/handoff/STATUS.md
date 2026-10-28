# STATUS (rewritten by Claude at the end of every session; one screen)

**Last updated:** 2026-10-26 22:55 ET by Session 3 (Claude Code) · **Last session number:** 3
**Window:** Tue Oct 27 → Thu Oct 29 morning, 2026. Bots return Thursday.
**Base branch:** `deploy/vercel`. Latest merged on it: #14 (SB-08, `264cf6d`).

## Tasks (state: todo · in progress · PR open · merged · blocked)

| Id | Item | State | Branch | PR | Notes |
|---|---|---|---|---|---|
| T01 | SB-09 workspaces and worktrees | merged | `sb-09-workspaces` | #13 | `d6b4b27`; worktrees at `wt/<slug>/<repo>/<branch>` (Vincent's choice) |
| T02 | SB-08 profile memory and skills | merged | `sb-08-profile-memory` | #14 | `264cf6d` |
| T03 | SB-13 browser emulator | PR open | `sb-13-browser-emulator` | #17 | 4 checks green; image 3.24GB, Node 22 on the Playwright base; SSRF through a checking proxy |
| T04 | SB-03 PR 1 contracts, `003_jobs.sql`, route registry | todo | `sb-03a-contracts` | n/a | unblocked (#14 merged); next |
| T05 | PLAN.md stale host text (docs only) | todo | `docs-plan-laptop-text` | n/a | independent |
| T06 | SB-15a team pack importer | todo | `sb-15a-team-pack-import` | n/a | unblocked; live part blocked on Q7 (team pack location) |
| T07 | Retry runner-side bot-event delete | todo | `sb-fu-bot-event-delete` | n/a | independent |
| T08 | SB-06 slice A policy classifier | todo | `sb-06a-classifier` | n/a | independent, not wired |
| T09 | Prune dry run for logs and computer rows | todo | `sb-fu-prune-dry-run` | n/a | independent |
| T10 | SB-03 PR 2 turn engine (stretch) | todo | `sb-03b-turn-engine` | n/a | needs T04 merged; live part blocked on Q1 (API key) |
| – | SB-29 agent isolation (build) | todo | – | – | decided 2026-10-27 in PR #16; blocks SB-04 and SB-10's acting tools |
| – | SB-04, SB-10, SB-11, SB-12, SB-06 wiring | blocked | – | – | not scheduled; Supervisor re-plans Thursday (see WORKPLAN §5). PR #16 proposes SB-29 (sandbox) as a gate for SB-04 and SB-10 |

## Open PRs awaiting Vincent's merge
- **#17** SB-13 (T03): 4 checks green. Note the image is 3.24GB (see Blockers 3).
- **#15** iPhone Google sign-in fix (out of plan, Vincent asked): up to date with `deploy/vercel`. Check the Vercel preview on the iPhone, then merge.
- **#16** isolation decision, SB-29 (docs only; not opened by this session's Claude). It needs `deploy/vercel` merged in (WORKLOG conflict) before it can merge.
- Each merge after the first needs `deploy/vercel` merged into the next branch (WORKLOG: keep both entries, newest first).
- PR #10 "Parity gap audit" is open and is **not** Claude's: leave it.

## Blockers and questions
1. Docker Desktop does not start on Vincent's Windows machine (WSL has no distribution; Docker's backend VM never starts). Fix steps were given in chat: `wsl --update`, `wsl --install -d Ubuntu`, then restart Docker Desktop. Until then CI runs the Postgres, gitleaks and image checks, and PGlite runs the DB tests locally.
2. Agent isolation: answered in PR #16 (SB-29 sandbox container, one Linux user per agent), pending merge.
3. The runner image is 3.24GB with the Playwright base (Chromium, Firefox and WebKit). A Chromium-only build on node:22-bookworm-slim would likely be much smaller, at the cost of leaving the planned base. Decide whether that follow-up is worth it.

## Live checks pending (Vincent, on the laptop runner)
See `WORKPLAN.md` §7. Plan boxes stay unticked until he confirms.
