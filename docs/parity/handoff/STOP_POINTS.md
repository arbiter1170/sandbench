# Hard rules, never-do list and STOP points

Canonical for every Claude Code session while the bots are away (Oct 26 to Oct 29, 2026) and after,
until Vincent or the Supervisor replaces it. Read it in full at the start of every session.

This repo is **public**. Commits, PR text, logs, tests and docs are all public.

## 1. Hard rules (they override everything else)

1. **Never force-push. Never rebase** (not even a branch you have not pushed). To catch up, merge
   `deploy/vercel` into your branch. Never push to `deploy/vercel` or `main`. Never merge your own PR.
2. **One PR per task**, one branch per PR, branch named in the task, cut from the latest
   `origin/deploy/vercel`, PR opened **against `deploy/vercel`**. Never stack a branch on another
   unmerged branch.
3. **All four required checks green on the PR's head commit:** `Typecheck, test, build`,
   `Secret scan`, `Runner sign-in checks (Auth emulator)`, `Runner image and compose file`.
4. **Postgres and the DB tests cover every new runner data path.** The DB tests must run, not skip.
5. **Firebase.** HARD RULE: never read, query, list, deploy to, or otherwise touch any off-limits
   Firebase project (the ones guarded by `runner/guard.mjs`). Never write their ids anywhere in
   the repo, a commit, a PR, a log or chat. Only Sandbench's own project may be used; its id is
   `FIREBASE_PROJECT_ID` in `deploy/.env` on Vincent's machine and **never** in the repo. Always
   pass `--project` explicitly to any `firebase` command. Tests and docs use `demo-*` ids only.
6. **No secrets and no personal data in the repo**: no API keys, tokens, private keys, personal
   emails, machine paths, player data, and **no real tailnet name** (write
   `sandbench.<your-tailnet>.ts.net`). Test keys are generated inside the test. Test emails end in
   `@example.test`. Read secrets through the secret store (`harness/secrets.mjs`); never print one.
7. **Project ids and real hostnames live in `deploy/.env`, not the repo.** Never read, print or edit
   `deploy/.env`, `secrets.json` or anything under `~/.sandbench`. Tests use temp directories.
8. **The runner runs on Vincent's laptop** behind Tailscale Funnel. There is no Hetzner, no
   Cloudflare tunnel setup and no other host planned. Where `PLAN.md` says otherwise it is old. The
   runner is offline when the laptop sleeps. Write no deployment code for another host.
9. **Ask before** anything that costs money, needs an account or credential, deletes data or
   branches, rotates keys, or changes DNS. (See the STOP points.)
10. **A plan box is ticked only when its acceptance passes against live infrastructure.** You cannot
    do that. Add a line to the `PLAN.md` Progress log that says what is built and what is pending,
    and leave the box unticked.

## 2. Never do (also listed in `THURSDAY_RESUME.md`)

- **Do not build** the Supervisor or its flows (reviewing and merging PRs, the board, the idea
  round), **outside email** (SB-17 and inbound email in SB-15), **notifications to Vincent**
  (SB-16), **attachments** (SB-18), `pr_merge`, agent-to-agent messaging (SB-07), the scheduler
  (SB-14), usage and cost tracking (SB-19), or anything else that is Grok Bot's job. If a task seems
  to need one of these, build the smallest interface and a fake, write it down in the PR, and stop.
- **Do not edit the hard rules**: this file, the "Rules" sections of the briefs, `CLAUDE.md`,
  `CLAUDE_CODE_PROMPT.md`, or the hashes in `runner/guard.mjs`.
- **Do not delete data on the runner** (rows, files, branches, worktrees) or run anything against the
  production runner or its database. Code that deletes is built and tested on a throwaway database
  and temp directories only, and ships dry-run by default.
- **Do not create accounts, GitHub Apps, API keys or services**, and do not paste a secret anywhere.
- **Do not merge, close, edit or comment on PRs you did not open**, including PR #10.
- **Do not touch** `.github/workflows/` triggers, permissions, job names or `persist-credentials`,
  branch protection, or rulesets (see STOP point 4 for what you may add inside a job).
- **Do not tick a plan box**, and do not claim a live check passed.

## 3. STOP points

Stop and ask Vincent, never guess, when any of these is true:

1. **Auth or Firebase:** anything touching sign-in, the allowlist, token checks
   (`runner/api/auth.mjs`), CORS origin handling, `firestore.rules`, Firebase config or projects, or
   `runner/guard.mjs`.
2. **A destructive migration:** drop, rename, type change, row deletes, or any edit to a migration that
   has already merged. New tables, columns with defaults and indexes are fine.
3. **Deleting runner data** (see the never-do list).
4. **Changing CI or the ruleset:** triggers, `permissions`, job names, `persist-credentials`,
   `pull_request_target`, `workflow_run`, `issue_comment`, required checks, secret handling, branch
   protection. **Allowed without stopping:** adding or editing steps inside an existing job for the
   task's own tests (for example installing a browser, or a `# skipped 0` assertion for a new DB test
   file), if the job names stay the same.
5. **A cost:** a paid service, a real API call with a real key, a larger machine, a new account.
6. **A credential or account Vincent must create or supply.**
7. **A decision not covered** by `PLAN.md`, the two briefs, the handoff `WORKPLAN.md` or its
   provisional defaults, or two docs that disagree in a way the precedence rule does not settle.
8. **Tests that cannot be made to pass within 2 attempts** (two genuinely different fixes). Never
   skip, delete or weaken a test to get green.
9. **A safety rule would have to be weakened** to make something work.
10. **You are unsure whether something is private.** Also: you find a secret, a personal email or an
    off-limits id already in the repo or its history (do not rewrite history; report it).
11. **The repo is not as the plan says** in a way that changes the design (a dependency merged in a
    different shape, a file moved), or the task is running more than 50% over its size estimate.
12. **Unexpected local state:** uncommitted changes you did not make, a branch that has diverged
    from its remote, or a failing check on `deploy/vercel` itself.

## 4. What to do at a STOP

1. Stop working on the task. Do not try a workaround.
2. Commit what is safe on the task's branch (normal commit, normal push). No force-push.
3. Write the question in `WORKLOG.md` (new entry, "Open questions") and `STATUS.md` (state
   `blocked`, with the question under Blockers). Say what you need, what you recommend, and what you
   will do for each answer.
4. **End the session.** Do not start another task in the same session.

## 5. Precedence

If these handoff documents disagree with `PLAN.md`, `CURSOR_AGENT_BRIEF.md`,
`NEXT_PHASE_BRIEF.md` or `CLAUDE_CODE_PROMPT.md`, **the handoff documents win**, and you write the
disagreement in the WORKLOG entry. Between handoff documents, this file wins over `WORKPLAN.md`,
and `WORKPLAN.md` wins over the rest.
