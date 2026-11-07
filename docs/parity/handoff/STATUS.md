# STATUS (rewritten by Claude at the end of every session; one screen)

**Last updated:** 2026-11-07 by Session 11 · **Last session number:** 11
**Base branch:** `deploy/vercel`. Merged since this file was last written: #20, #21, #26, #29 to #48. Open-work list: Claude's artifact "Sandbench open work" (private to Vincent). Rules for merging and closing: Vincent approves in chat, PR by PR.

## Open PRs
- **`claude/no-session-not-run`** (this PR): approved steps with no session to resume end as not run. Review and Vincent's approval pending at this writing.
- **#22** SB-03 PR 2 turn engine: held. Known defects (secret redaction, replay, duplicate replies); needs Vincent's go-ahead to repair.

## Tasks not started from WORKPLAN
T06 SB-15a importer, T07 bot-event delete retry, T08 SB-06 classifier, T09 prune dry run; SB-29 sandbox (decided in #16, not built; gates SB-04 and SB-10's acting tools). T10 is PR #22.

## Blockers and questions
1. **Docker on ThinkHelp:** the Windows event log shows the hypervisor failing to launch at boot (event 26, BalStatus 0x7) on the boots checked, with `hypervisorlaunchtype` Auto and firmware virtualization on. WSL has no distribution. Cause not established; last boot was Oct 29. Blocks the laptop runner, reachability from the phone, and the live parts of SB-01, SB-02, SB-05, SB-08, SB-09 and SB-13.
2. **Q1:** the runner's Claude CLI: API key or subscription login. Unanswered.
3. **Merge-author email:** GitHub merges carry Vincent's personal address on this public repo. He approved continuing in chat on 2026-11-06. History is not rewritten.
4. Runner image size (3.24 GB): a Chromium-only base is an open follow-up.

## Live checks pending (Vincent, on ThinkHelp)
Plan boxes stay unticked until he confirms. Local harness restart on the latest code (until then the page's harness calls get 401, so its agents read "not available"), then one connector call and an approve, deny and Monitor turn (the gate hook on real Windows). UX P1 to P5 device and screen-reader checks (spec §9). Everything needing the laptop runner (blocker 1).
