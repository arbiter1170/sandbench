# Thursday resume (for the Supervisor and Grok Bot on return, Thu Oct 29, 2026)

Claude Code works alone from Tue Oct 27 to Thu Oct 29 morning. Vincent pastes prompts (`SESSION_PROMPT.md`)
and merges (`MERGE_GUIDE.md`). This file says what to do on return and what Claude was **not** allowed to do.

## 1. What the Supervisor does on return (in order)

1. Read `docs/parity/handoff/STATUS.md` (current state) and every `WORKLOG.md` entry dated 2026-10-26 or later.
   Note every entry marked `STOP` or with "Open questions".
2. `git fetch origin` then `gh pr list --repo arbiter1170/sandbench --state all --limit 30`. For each PR merged since
   Oct 26: **review it post hoc** (it was merged by Vincent on the 2-minute check only):
   - `gh pr diff <n> --name-only` against the task's Touch list in `WORKPLAN.md`; look for anything under
     `.github/`, `runner/api/auth.mjs`, `runner/guard.mjs`, `firestore.rules`, `deploy/`, and any new dependency.
   - Re-run the checks on the merged tip of `deploy/vercel` with the commands in `PR_CHECKLIST.md` §C, including the DB
     tests with `# skipped 0`.
   - Read each PR's "Deviations" and the WORKLOG "Decisions". Accept, or open a fix task.
   - Confirm the PLAN.md Progress log lines match what was built, and that **no plan box was ticked** without a live check.
3. For each open PR from Claude: review and decide merge or send back (the Supervisor merges after review).
4. Re-check the open questions in `NEXT_PHASE_BRIEF.md` (Q1-Q7) with Vincent. Their defaults were provisional. Record
   the answers in `WORKLOG.md` and unblock the BLOCKED items in `WORKPLAN.md` §5 (SB-04, SB-11, SB-12, live SB-03 PR 2,
   live SB-15a).
5. Run or schedule the "Live checks pending" (`WORKPLAN.md` §7) with Vincent; tick plan boxes only for those that pass.
6. Check the public repo is clean: `gitleaks` full history, the personal-email grep, the guard-hash scan, no real tailnet name.
7. Re-plan: write the next `WORKPLAN.md` (SB-06 wiring, SB-10, SB-04, SB-11, SB-12 in the merge order from
   `NEXT_PHASE_BRIEF.md`), reset `STATUS.md`, and add a Session entry saying the handoff window is over.

## 2. What Claude must NOT do (same list as `STOP_POINTS.md` §2)

- Build or run the **Supervisor** or any of its flows (reviewing and merging PRs, the board, idea rounds).
- Anything with **outside email** (SB-17, inbound email) or **notifications to Vincent** (SB-16).
- **`pr_merge`**, or any tool or code path that merges a PR. Claude never merges its own PR either.
- **SB-16, SB-17, SB-18** (notifications, outside email, attachments), and also SB-07 (agent messaging), SB-14
  (scheduler), SB-19 (usage and cost).
- Anything in **Grok Bot's domain**: messaging Vincent or others, the project board, idea rounds, reviewing or
  merging other PRs, touching PR #10.
- **Edit the hard rules**: `STOP_POINTS.md`, `CLAUDE.md`, the "Rules" sections of the briefs, `CLAUDE_CODE_PROMPT.md`,
  the hashes in `runner/guard.mjs`.
- **Delete data on the runner** (rows, files, branches, worktrees), or run anything against the production runner.
- Create accounts, GitHub Apps or API keys, spend money, or put a secret anywhere.
- Change CI triggers or permissions, job names, branch protection or rulesets; touch auth, Firebase rules or
  off-limits projects.

## 3. If something went wrong

- A STOP is expected and fine: the question is in WORKLOG and STATUS. Answer it, then tell Claude with a normal
  session prompt.
- A secret or personal email found in the repo: do not rewrite history. Rotate the secret, open a fix PR, tell Vincent.
- Claude merged something itself or pushed to `deploy/vercel` directly: treat as an incident, check `git log
  origin/deploy/vercel` against the PR list, and tell Vincent.
