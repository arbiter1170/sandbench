# Session prompt for Claude Code

Vincent pastes the **main prompt** at the start of every Claude Code session, from the root of the
`arbiter1170/sandbench` repo. Use a variant below only when it fits.

## Main prompt

```text
You are Claude Code working alone on the Sandbench repo (arbiter1170/sandbench, PUBLIC) for Vincent. The bots are away until Thu Oct 29, 2026; the docs in docs/parity/handoff/ are your only source of truth. Where they conflict with PLAN.md or the briefs, handoff wins.

1. READ FIRST, in full: docs/parity/CLAUDE.md, docs/parity/handoff/STOP_POINTS.md (hard rules, never-do list, STOP points), docs/parity/handoff/WORKPLAN.md, docs/parity/handoff/STATUS.md, and the top 80 lines of docs/parity/handoff/WORKLOG.md.
2. Run `git fetch origin` and `gh pr list --state all --limit 20`. Update what is merged. Find the FIRST unchecked task in WORKPLAN.md whose dependencies are MERGED into deploy/vercel (an open PR is not merged). If the next task depends on an open PR, take the next task marked "independent"; if none, stop and tell Vincent which PR to merge.
3. Do ONE task: one branch (named in the task), one PR against deploy/vercel, cut from the latest origin/deploy/vercel. Touch only the files the task lists. Never force-push. Never rebase. Never merge your own PR.
4. Build it step by step as the task says, tests first where it says. Run docs/parity/handoff/PR_CHECKLIST.md top to bottom and paste REAL output. Wait for the 4 required checks on the final head sha.
5. Before ending, ALWAYS add a WORKLOG.md entry at the top (use its template; real results only) and rewrite STATUS.md. Commit both on the task's branch, push (normal push), and wait for checks again.
6. At any STOP point in STOP_POINTS.md, never guess: write the question in WORKLOG and STATUS, push, and END the session. Two failed fixes for the same test is a STOP.
7. Never invent results. If you could not run something, say so.

End with: task id, PR link and final head sha, check state, what Vincent must do next (merge command or a question), and the next task.
```

## Variant: resume after interruption

```text
Resume after interruption. Same rules as the main prompt (read STOP_POINTS.md, WORKPLAN.md, STATUS.md and the top 80 lines of WORKLOG.md first). Run `git status`, `git log --oneline -8`, `git branch --show-current` and `gh pr list --state open`. Find the task STATUS.md says is "in progress" and check out ITS branch (never recreate, reset or rebase it). Compare what exists with the task's steps, finish only the remaining steps, rerun PR_CHECKLIST.md from the top, then add the WORKLOG entry and rewrite STATUS.md. If the working tree has changes you did not make, or the branch has diverged from its remote, STOP.
```

## Variant: the PR got review feedback or a check failed

```text
PR #<N> got review feedback or a failing check. Feedback: <paste it, or "the check <name> failed">. Same rules as the main prompt (read STOP_POINTS.md, WORKPLAN.md, STATUS.md and the top of WORKLOG.md first). Check out the PR's branch, run `git fetch origin && git merge origin/deploy/vercel` (never rebase, never force-push), and address ONLY the feedback with new commits. For a failing check use `gh run view <run-id> --log-failed`. Rerun PR_CHECKLIST.md, reply in the PR conversation with what you changed, add a WORKLOG entry marked "review fix", and rewrite STATUS.md. If the feedback conflicts with WORKPLAN.md or a STOP point, or the same test still fails after two different fixes, STOP.
```
