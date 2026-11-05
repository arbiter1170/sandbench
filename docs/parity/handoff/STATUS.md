# STATUS (rewritten by Claude at the end of every session; one screen)

**Last updated:** 2026-11-05 by Session 8 (Cursor cloud agent; T10 turn engine) · **Last session number:** 8
**Window:** the Tue Oct 27 → Thu Oct 29 handoff window has passed. `WORKPLAN.md` stays the task source until the Supervisor re-plans (`THURSDAY_RESUME.md` §1.7); Vincent approved T10 on 2026-11-05.
**Base branch:** `deploy/vercel`. Latest merged on it: #18 (SB-03 PR 1, `7068fc3`); before it #15 (`aa42aa0`), #10 (`506d0e4`), #19 (`04f237f`), #16 (`68128a4`), #17 (`8735ee8`). CI is green on `7068fc3`.

## Tasks (state: todo · in progress · PR open · merged · blocked)

| Id | Item | State | Branch | PR | Notes |
|---|---|---|---|---|---|
| T01 | SB-09 workspaces and worktrees | merged | `sb-09-workspaces` | #13 | `d6b4b27`; worktrees at `wt/<slug>/<repo>/<branch>` (Vincent's choice) |
| T02 | SB-08 profile memory and skills | merged | `sb-08-profile-memory` | #14 | `264cf6d` |
| T03 | SB-13 browser emulator | merged | `sb-13-browser-emulator` | #17 | `8735ee8`; image 3.24GB |
| T04 | SB-03 PR 1 contracts, `003_jobs.sql`, route registry | merged | `sb-03a-contracts` | #18 | `7068fc3`; no behaviour change |
| T05 | PLAN.md stale host text (docs only) | PR open | `cursor/docs-plan-laptop-text-93f7` | #20 | docs only; carries Session 7's STATUS/WORKPLAN refresh |
| T06 | SB-15a team pack importer | todo | `sb-15a-team-pack-import` | n/a | unblocked; live part blocked on Q7 (team pack location) |
| T07 | Retry runner-side bot-event delete | todo | `sb-fu-bot-event-delete` | n/a | independent |
| T08 | SB-06 slice A policy classifier | todo | `sb-06a-classifier` | n/a | independent, not wired |
| T09 | Prune dry run for logs and computer rows | todo | `sb-fu-prune-dry-run` | n/a | independent |
| T10 | SB-03 PR 2 turn engine | PR open | `cursor/sb-03b-turn-engine-93f7` | this PR | fake-driver tested on Postgres (16 engine, 4 queue, 5 jobs-api, 2 redaction, 10 vitest); tools in runner-mode turns denied until SB-29; live part blocked on Q1 and the laptop runner |
| – | SB-29 agent isolation (build) | todo | – | – | decided 2026-10-27 in PR #16, simplified 2026-10-28; gates SB-04, SB-10's acting tools and the engine's tools in runner mode |
| – | SB-04, SB-10, SB-11, SB-12, SB-06 wiring | blocked | – | – | not scheduled; Supervisor re-plans (WORKPLAN §5). After T10 merges: SB-06 wiring and SB-10 (read-only tools) are next by the brief's merge order |

## Open PRs awaiting Vincent's merge
- **#20** docs (T05 + STATUS/WORKPLAN refresh). Docs only.
- **This PR** (T10, SB-03 PR 2). The image job builds the pinned Claude Code CLI now; watch its runtime against the 20-minute limit.
- Both branches were cut from `deploy/vercel`; whichever merges second gets a WORKLOG/STATUS conflict: keep both entries, newest first, and take the newer STATUS.

## Blockers and questions
1. Docker Desktop does not start on Vincent's Windows machine (WSL has no distribution). Fix steps were given in chat: `wsl --update`, `wsl --install -d Ubuntu`, then restart Docker Desktop. Vincent has deferred this; the local harness with his own Claude Code subscription is his priority. Until then CI runs the Postgres, gitleaks and image checks.
2. Q1 (API key for the runner's Claude CLI) blocks every live check that needs a model turn, including T10's. The CLI reads `ANTHROPIC_API_KEY` from the runner's environment (`deploy/.env`); the engine never uses the subscription login and does not widen any auth.
3. SB-29 (sandbox) is decided, not built. Until it lands, runner-mode turns deny every tool request with a reason (the approval-card path exists and is tested but is off in `runner/main.mjs`).
4. `harness/drivers/claude.mjs` does not report its session id, so a retried CLI turn starts fresh instead of `--resume`; a one-line driver change (WORKLOG Session 8, question 2) is recommended for whoever next edits that file.
5. The runner image is 3.24GB with the Playwright base; a Chromium-only build would likely be much smaller. Still Vincent's call.
6. Local UI symptom (a reply that stays "Thinking" after the answer) is being checked separately on Vincent's machine. Not folded into T10; a scoped PR follows if evidence confirms it.

## Live checks pending (Vincent, on the laptop runner)
See `WORKPLAN.md` §7. Plan boxes stay unticked until he confirms. None has run yet (the laptop runner is not up: blocker 1). After T10 merges and Q1 is answered: ask QA a question from the phone, close the tab, find the reply later.
