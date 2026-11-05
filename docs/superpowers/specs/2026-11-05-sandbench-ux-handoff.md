# Sandbench UX handoff brief (Cursor / Claude)

**Date:** 2026-11-05
**Status:** Waiting for Vincent's written-spec review. **No implementation is authorized yet.** Neither prompt below should be run until Vincent approves the spec and names a packet.
**Design spec:** [2026-11-05-sandbench-ux-design.md](2026-11-05-sandbench-ux-design.md)
**Boards:** [`assets/2026-11-05-sandbench-ux/`](assets/2026-11-05-sandbench-ux/)

---

## Entry prompt (copy-paste)

```text
You are working in arbiter1170/sandbench. Target branch: deploy/vercel.
Read, in order:
  1. docs/parity/CLAUDE.md and docs/parity/handoff/STOP_POINTS.md (hard rules).
  2. docs/superpowers/specs/2026-11-05-sandbench-ux-design.md (this design).
  3. docs/superpowers/specs/2026-11-05-sandbench-ux-handoff.md (this brief).
Vincent has approved packet: <P1|P2|P3|P4|P5>. Work on that packet only.
Before editing, re-fetch deploy/vercel and the PRs listed under "Pinned snapshot",
and report any difference from the pinned SHAs or merged status. Never assume a PR is merged.
Keep the invariants I-1..I-9 in §4 of the spec. Edit only the files the spec's §8 assigns to
the packet. If you need a signal listed as D-5..D-8, or from #21/#22/#23/#24/#25, and it
isn't merged, stop and report. Don't build a substitute.
One PR per packet, based on deploy/vercel, not stacked. No force-push, no rebase of pushed
history, never push to deploy/vercel or main, never merge your own PR.
Stop when the packet's acceptance tests pass, and report: PR URL, head SHA, tests run (real
output), tests pending (native/manual), and anything you withheld.
```

---

## Pinned snapshot (re-fetched 2026-11-05)

| Ref | SHA | State | Relevant to |
| --- | --- | --- | --- |
| `deploy/vercel` | `7068fc3e6bfe2bbebf05b1ba5c61fdf5c87e0c6e` | base | all |
| PR #20, docs: runner on the laptop | `3e1f7af` | open | none (docs) |
| PR #21, working-dir context + narrow-screen bubbles | `68ff1de` | open | P1 (last-turn folder), P4 (wrapping, Playwright fixture) |
| PR #22, SB-03 turn engine, jobs API | `f61431f` | open | P2 mode R (withheld) |
| PR #23, approval-rule safety | `c491641` | open | P3 (labels), P5 (mode labels) |
| PR #24, capability map labels | `b934154` | open | P1 (wording must match) |
| PR #25, interrupted local turns | `f04749d` | open | P2 S8, P3 lost cards |

PRs #20–#22 are under separate checks by another agent. This spec PR is not part of any merge authorization.

**Dependencies:** Node 22 and `npm ci` (existing `package.json`; no new packages). Tests: `npm run typecheck`, `npm run test:web` (vitest), `npm run test:node`. Some node tests need a local Postgres (see the PR #23 notes). Browser layout tests need #21's Playwright setup, which isn't at base.

---

## Outcome and non-goals

See §1 of the spec. In one line: make "who answers, where, is it connected, what is it doing, what am I approving" readable on a phone. Don't change approval rules, recovery logic, the capability table or the visual style.

---

## Locked decision: chosen agent can't start

- No silent fallback.
- Show "Couldn't start" with the reason, a read-only **Check connection**, and a one-time **Answer with the built-in planner this time**.
- That choice starts at most one new, explicit planner turn. It doesn't change bot or default settings and doesn't carry approvals.
- If a turn may already have run tools, there is never a fallback, retry or replay.
- The no-duplicate and no-concurrency rules are invariants I-1, I-3, I-4 and I-5 in the spec.

## Things the implementer must not get wrong

1. **"Not run"** only with a correlated dispatch record (D-6). It doesn't exist yet, so don't show "Not run" at all.
2. **Denied by you ≠ Expired ≠ Stopped ≠ Connection lost ≠ Unattended.** The harness sends the same `permission_resolved {allow:false}` for the first three, so use page-local facts and "No decision recorded here" until D-5.
3. **Scope copy follows the real grant.** WebFetch/WebSearch approvals grant the whole tool for the rest of the reply (F4-S, D-7). Say so; don't promise "only this address".
4. **A synthetic Claude `tool_end` without `code`** ("ran this step itself") is not a recorded result.
5. **Capability rows come from runtime evidence.** #24's table is static. Queued or planned work is never shown as ready.
6. **Bot chats use the workspace root. Group chats use the channel folder** (`roomFolder`).
7. **Attachments are images only**; audio is dictation. Files are SB-18.
8. **No secrets or real paths** in fixtures. Use `C:\Users\<you>\...` and synthetic names.

---

## Model roles

The live model catalog for this run listed `claude-opus-5-5`, `claude-fable-5-1` and `claude-fable-5`. That a model is present doesn't verify its permissions, tools or features in another run. Check them when launching.

- **Opus 5.5** owns behaviour, state, routing, the approval boundary, integration with other PRs, and final responsibility for every packet PR.
- **Fable 5.1** does bounded reviews: visual, copy, accessibility and fixtures. Later, it may take a well-isolated UI slice that Opus assigns. It never edits the same files as Opus at the same time.

**Status:** Opus 5.5 wrote this packet. **Fable has not reviewed it yet.** Morgan will request the Fable 5.1 review. No agents have been launched for implementation.

### Fable 5.1 review prompt (copy-paste)

```text
Review only. Don't edit files, push, or open PRs.
Repo arbiter1170/sandbench. Read docs/superpowers/specs/2026-11-05-sandbench-ux-design.md,
the handoff brief next to it, and the PNG boards in assets/2026-11-05-sandbench-ux/.
Scope:
  (1) copy: plain, accurate, no overclaims;
  (2) visual consistency with the existing dark style;
  (3) accessibility: contrast table in §11, the primary-button token choice (#c83a3a vs
      dark ink on #e24b4b), 44 px targets, focus, screen reader announcements;
  (4) fixtures: synthetic, no secrets or real paths.
Scrutinize in particular:
  - any place that could read as "Not run" or "nothing executed" without a D-6 record;
  - Denied by you vs Expired vs Stopped vs Connection lost staying distinct;
  - any scope copy promising "one command"/"only this address" beyond the grant table in §6 P3;
  - F4-S kept as a dependency, not hidden by wording;
  - board labels copied from 7068fc3 that the spec now overrides (see "Board notes").
Output: a numbered list of findings, each with location, problem, and proposed fix, marked
must-fix / should-fix / nit. Then stop.
```

### Opus 5.5 implementation prompt (per packet, only after Vincent approves)

```text
Use the entry prompt in docs/superpowers/specs/2026-11-05-sandbench-ux-handoff.md with
packet = <Pn>. You own behaviour, state and integration for this packet.
Scope: only the files §8 assigns to <Pn>. No changes to approval rules, grants, auto-review,
turn recovery, the capability table, harness events, runner, packages or CI.
Write the packet's Given/When/Then tests first (vitest/node --test, synthetic events),
then the UI. Keep I-1..I-9.
Stop and report instead of continuing if:
  - a needed signal is from an unmerged PR or a D-item;
  - the code no longer matches the spec's "Observed" notes;
  - the packet would need a file outside §8;
  - any test would need a live CLI, network, credentials or the user's machine.
Finish: one PR against deploy/vercel. Report the PR URL, head SHA, tests run (real output),
pending native tests from §9, and withheld items. Then stop.
```

### Opus 5.5 stop prompt (use if a run drifts)

```text
Stop. Don't push further changes. Report: branch, head SHA, files changed vs the packet's §8
list, tests run, and anything outside scope. Wait for Vincent.
```

---

## Packet order

Run P1 → P5 → P2 → P3 → P4, one packet at a time. P4 goes after #21 merges or closes. P2 S8 and the lost-card states in P3 render #25's states only once #25 is merged. The dependency graph is in §7 of the spec.

## Awaiting owner review

- Vincent: approve or edit the spec; choose the primary-button token (§11); approve each packet before work starts.
- Approval-safety owner: D-5 to D-8 and U-3 (none started by this design).
- Runner owner: U-6 (`extras.resume` vs I-5 before SB-29 enables tools).
- Morgan: request the Fable 5.1 review.
