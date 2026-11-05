# Merge guide for Vincent (2 minutes per PR)

Claude opens PRs against `deploy/vercel`. Claude never merges its own PR. You merge, or you leave it.
Nothing is urgent: if you are busy, Claude works on other tasks marked "independent" and then waits.

## 1. The 2-minute safety check

Replace `N` with the PR number. Run from any clone of the repo.

```bash
# a) The head commit and the 4 required checks (all must say pass)
gh pr view N --repo arbiter1170/sandbench --json headRefOid,baseRefName,mergeable -q '.'
gh pr checks N --repo arbiter1170/sandbench
```

Required, all green on that head: `Typecheck, test, build`, `Runner sign-in checks (Auth emulator)`,
`Runner image and compose file`, `Secret scan`. `baseRefName` must be `deploy/vercel`.

```bash
# b) The diff stays inside the task's files
gh pr diff N --repo arbiter1170/sandbench --name-only
```

Compare to the "Touch" list of that task in `docs/parity/handoff/WORKPLAN.md`. Plus, always allowed:
`docs/parity/handoff/WORKLOG.md`, `docs/parity/handoff/STATUS.md`, one line in `docs/parity/PLAN.md`.
Be suspicious of: `.github/`, `runner/api/auth.mjs`, `runner/guard.mjs`, `firestore.rules`, `deploy/.env*`,
anything named `secrets`, and any file the task says not to touch. If any appears, **do not merge**; paste
the file list into the next Claude session and ask why.

```bash
# c) No new secrets or personal data in the added lines (no output = good)
gh pr diff N --repo arbiter1170/sandbench | grep -E '^\+' | grep -nEi \
  'sk-ant-|xai-[A-Za-z0-9]{10}|ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|@(gmail|yahoo|hotmail|outlook|icloud)\.|\.ts\.net'
```

(`sandbench.<your-tailnet>.ts.net` is the only `.ts.net` text that is fine.)

Also read the PR body: it must list real test output, a "Live check still needed" line and "Deviations".

## 2. Merge

Use a **merge commit**. Not squash. Not rebase.

```bash
HEAD=$(gh pr view N --repo arbiter1170/sandbench --json headRefOid -q .headRefOid)
gh pr merge N --repo arbiter1170/sandbench --merge --match-head-commit "$HEAD"
```

`--match-head-commit` makes GitHub refuse the merge if Claude pushed after you looked. If it refuses, rerun
the checks above on the new head. In the GitHub web page the button is **"Create a merge commit"** (open
the arrow next to the merge button if it shows squash or rebase).

After merging, nothing else is needed: the next Claude session reads the merged state, ticks the plan
checkbox and carries on. If you merge several PRs, merge them in the order of the task numbers.

## 3. Rules

- Claude never merges its own PR. If Claude says it did, something is wrong; tell the Supervisor on Thursday.
- Never use squash or rebase merge, and never force-push anything.
- Do not merge a PR with a red or pending required check, even "just a docs change".
- PR #10 (parity gap audit) is not Claude's. Leave it for the Supervisor.

## 4. If checks fail

1. Do not merge. Open the failing check on the PR page, or run `gh run list --repo arbiter1170/sandbench --branch <branch> -L 3`.
2. Start a Claude session with the **"PR got review feedback or a check failed"** variant in `SESSION_PROMPT.md`;
   paste the failing check's name. Claude fixes it with a new commit.
3. If the same check fails twice, Claude will STOP and write a question in `WORKLOG.md`. Leave the PR open; the
   Supervisor looks on Thursday.
4. A Vercel preview failure alone is not a required check. Tell Claude; do not merge a PR whose 4 required checks
   are not green.

## 5. Things only you can do

See "Vincent steps" in `WORKPLAN.md`. None of them is needed to get through Tuesday to Thursday morning.
