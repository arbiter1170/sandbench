# Grok Bot parity: gap audit

This audit maps what Sandbench does today against the Grok Bot parity plan in `PLAN.md`. It is a
reference only. It ticks no plan item. Each gap names the plan item that closes it and what that
item waits on.

Status as of 2026-10-27:
- **Done in code, live check pending:** SB-01 (runner, PR #3, merged), SB-05 (keys off the page,
  PR #5 merged, follow-up PR #9 in review), SB-21 skeleton (CI and unit tests).
- **In review:** SB-02 (PR #7 merged for the store, PR #8 for the page sync).
- **Not started:** everything else.

## Corrections to the "Where Sandbench is today" table in PLAN.md

Some rows describe the code before SB-02b and SB-21 landed. They should read:

| Concern | Now |
|---|---|
| Tests and CI | Unit tests (vitest and node --test) and a Postgres-backed datastore test run in CI (`.github/workflows/ci.yml`). |
| Data | In runner mode (`VITE_RUNNER_URL`), the page syncs one record per entity to the runner's Postgres store and no longer reads or writes the Firestore snapshot. Local mode is unchanged. |
| API keys | In runner mode, keys live on the runner or the harness and never reach the page, IndexedDB sync, or Firestore (SB-05). |

## Gaps, by plan item

### Blocked on the turn engine (SB-03)

| Gap | Plan item | Waits on |
|---|---|---|
| Turns run in the browser; closing the tab kills the turn | SB-03 | SB-02 live check |
| Permissions are in memory and lost on restart | SB-03, SB-06 | SB-03 |
| Shell timeout 30 s; drivers stop after 6 steps | SB-04 | SB-03 |
| Approval layer: no Stop-all, auto-review matches only the first word | SB-06 | SB-03, SB-05 |
| Agent-to-agent messaging; only a manual hand-off button | SB-07 | SB-03, SB-10 |
| No MCP tool server for agents | SB-10 | SB-03 |
| Scheduler is an English-phrase parser that runs only while a page is open | SB-14 | SB-03 |
| Usage is character counts only | SB-19 | SB-03, SB-04 |

### Next in the queue

| Gap | Plan item | Dependencies | Status |
|---|---|---|---|
| Per-agent workspaces and git worktrees: none | SB-09 | SB-01 | Not started |
| Headless browser with phone viewports: none | SB-13 | SB-01, SB-06 | Not started |
| Notifications to Vincent: none | SB-16 | SB-06, SB-07 | Not started |
| A per-bot email inbox: none | SB-17 | SB-06, SB-15 | Not started |
| Agent memory and skills live on the harness's disk (`~/.sandbench/bots/<id>/`, `~/.sandbench/skills/`), not on the runner | SB-08 | SB-02, SB-10 | Not started |
| Attachments are image and audio only (`src/types.ts:3-8`) | SB-18 | SB-02 | Not started |

### Other gaps

| Gap | Plan item | Dependencies |
|---|---|---|
| Cloud coding-agent launches that open PRs: none | SB-12 | SB-04, SB-09, SB-11 |
| GitHub integration: none | SB-11 | SB-05, SB-06, SB-10 |
| Scheduler with cron in America/New_York: none | SB-14 | SB-03 |
| Importer is Windows-only and lossy: every routine is forced to "Weekdays at 9:00", and chats are assigned round-robin (`scripts/import-grok-desktop.mjs`) | SB-15a | SB-02, SB-08, SB-14 |
| Connector parity (Figma, Gmail as Vincent) | SB-22 | SB-05, SB-10 |

## Dependency order for the next items

Nothing in the table above can be built without its dependencies being done. Five of the six
items named for next need SB-02 or SB-06, and those are not done:

- SB-09 needs SB-01's live check.
- SB-13 needs SB-01's live check and SB-06, which is not started.
- SB-16 and SB-17 need SB-06 first, and SB-16 also needs SB-07.
- SB-08 and SB-18 need SB-02's live check. SB-08 also needs SB-10.

Work that could start before its dependency is ticked would sit on an unmerged base. It would
also need rework if the base changes. Each of these needs Vincent's decision on whether to stack
on the open PRs or wait.
