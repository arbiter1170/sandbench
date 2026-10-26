# Claude Code: Sandbench parity work

This folder holds the plan to host the Walklings bot team in Sandbench with near-full parity with Grok Bot.

- **Start here:** `docs/parity/CLAUDE_CODE_PROMPT.md` has the goal, the context, the working rules, and where to stop and report.
- **The plan:** `docs/parity/PLAN.md` is the phased checklist (SB-01 to SB-28). Work on the first unchecked item whose dependencies are done. Tick its box and add a line to the Progress log in the same PR.

Rules in short:
- One small PR per item, with tests and CI.
- Never force-push, and never rebase a pushed branch.
- No secrets in code, Firestore or the page bundle.
- Never touch the Firebase projects `haven-57041`, `ourtime-529bd`, `studio-6245027179-b7f2d` or `walklings-4cc89`. Sandbench needs its own.
- Never commit private player data or private notes.
- Ask Vincent before destructive actions or anything that costs money.
