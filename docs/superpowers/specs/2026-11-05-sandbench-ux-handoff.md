# Sandbench UX handoff brief (Cursor / Claude)

**Date:** 2026-11-05
**Status:** Waiting for Vincent's written-spec review. **No implementation is authorized yet.** Neither implementation prompt below should be run until Vincent accepts the spec in writing and names the packets released. The Fable 5.1 bounded review ran on 2026-11-05 (see "Fable 5.1 review" at the end); its corrections are in PR #26.
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
Vincent's written acceptance of the spec released packet(s): <P1|P2|P3|P4|P5>. Work on one
packet at a time, in the §7 order, and only on packets that acceptance named.
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

## Pinned snapshot (re-fetched 2026-11-05, 20:07 UTC)

All six PRs below were **open at these SHAs** when last checked. Treat them as open and unverified at any later time until you re-fetch. PR #26 (this packet) is docs-only and is **not** part of Vincent's earlier conditional merge authorization for #20–#22.

| Ref | SHA | State | Relevant to |
| --- | --- | --- | --- |
| `deploy/vercel` | `7068fc3e6bfe2bbebf05b1ba5c61fdf5c87e0c6e` | base | all |
| PR #20, docs: runner on the laptop | `3e1f7af` | open | none (docs) |
| PR #21, working-dir context + narrow-screen bubbles | `68ff1de` | open | P1 (last-turn folder), P4 (wrapping, Playwright fixture) |
| PR #22, SB-03 turn engine, jobs API | `f61431f` | open | P2 mode R (withheld) |
| PR #23, approval-rule safety | `c491641` | open | P3 (labels), P5 (mode labels) |
| PR #24, capability map labels | `b934154` | open | P1 (wording must match) |
| PR #25, interrupted local turns | `f04749d` | open | P2 S8, P3 lost cards |

PRs #20–#22 are under separate checks by another agent. PRs #23–#25 come from the approval-safety and recovery owner and were not part of that check.

**Dependencies:** Node 22 (`package.json` pins no engine; #23 and #25 report Node v22.23.4 locally) and `npm ci` (existing `package.json`; no new packages). Tests: `npm run typecheck`, `npm run test:web` (vitest), `npm run test:node`. Some node tests need a local Postgres (see the PR #23 notes). Browser layout tests need #21's Playwright setup, which isn't at base.

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

1. **"Not run"** only with a correlated dispatch record (D-6). It doesn't exist yet, so don't show "Not run" at all. An `allow:false` resolution, a timeout, a lost stream or a reload is never proof of non-dispatch.
2. **Denied by you ≠ Expired ≠ Stopped ≠ Stop requested ≠ Connection lost ≠ Unattended.** The harness sends the same `permission_resolved {allow:false}` for deny, expiry and Stop, so use page-local facts and "No decision recorded here" until D-5. "Expired" is not shown before D-5.
3. **Stop is confirmed only by `done{stopped:true}`.** The interrupt POST's failure is swallowed at base. Until the event arrives, say "Stop requested · not confirmed" (S5b).
4. **Scope copy follows the real grant.** WebFetch/WebSearch approvals grant the whole tool for the rest of the reply (F4-S, D-7). Say so; don't promise "only this address". Bash grants are `Bash(<exact command>)` for the rest of the reply; harness `runCommand` drivers ask per request.
5. **A synthetic Claude `tool_end` without `code`** ("ran this step itself") is not a recorded result.
6. **No absolute safety words.** Not "changes nothing", "read-only", "safe", "asks every time", "can't run", "nothing ran". Every such claim in the spec is qualified to its evidence; keep it that way.
7. **"Signed in" is unknowable.** `available()` finds the CLI binary only.
8. **Capability rows come from runtime evidence.** #24's table is static. Queued or planned work is never shown as ready. The page cannot tell "no harness installed" from "harness offline"; never label a page "browser-only".
9. **Bot chats use the workspace root. Group chats use the channel folder** (`roomFolder`).
10. **Attachments are images only**; audio is dictation. Files are SB-18.
11. **No secrets or real paths** in fixtures. Use `C:\Users\<you>\...` and synthetic names.

---

## Model roles

The live model catalog for this run listed `claude-opus-5-5`, `claude-fable-5-1` and `claude-fable-5`. That a model is present doesn't verify its permissions, tools or features in another run. Check them when launching.

- **Opus 5.5** owns behaviour, state, routing, the approval boundary, integration with other PRs, and final responsibility for every packet PR.
- **Fable 5.1** does bounded reviews: visual, copy, accessibility and fixtures. Later, it may take a well-isolated UI slice that **Vincent** assigns (Opus proposes the slice; it does not authorize it). It never edits the same files as Opus at the same time; §8 of the spec is the ownership map.

**Status:** Opus 5.5 wrote this packet. Fable 5.1 reviewed it on 2026-11-05 (findings below). No agents have been launched for implementation, and none may be until Vincent's written acceptance.

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

Run P1 → P5 → P2 → P3 → P4, one packet at a time. This is design sequencing, not authorization; only packets named in Vincent's written acceptance may start. P4 goes after #21 merges or closes. P2 S8 and the lost-card states in P3 render #25's states only once #25 is merged. The dependency graph is in §7 of the spec.

## Awaiting owner review

- **Vincent (blocking):** accept or edit the spec in writing, naming which packets are released. That single acceptance is the gate; after it, each packet PR gets normal PR review and no extra pre-work approval unless Vincent asks for one.
- **Vincent (minor, not blocking):** the primary-button fill token (§11). The recommendation is `--accent-fill #c83a3a` with hover `#b83232`; dark ink on the current red also meets P4-AC5. If no choice is made, P4 implements the recommendation and says so in its PR.
- **Approval-safety / recovery owner:** D-5 to D-8, U-3, and the U-7 contract point about Stop labels in #25 (none started by this design).
- **Runner owner:** U-6 (`extras.resume` vs I-5 before SB-29 enables tools).

## Fable 5.1 review (2026-11-05)

Bounded review of the spec, this brief and all six boards, done against head `39fcf52b162a39528258c29df53892b2455f1d34` of PR #26 and the code at `7068fc3`. Evidence was read from the code, not from the spec's own claims.

**Addressed in PR #26 (docs and boards only):**
1. Stop was treated as confirmed. The interrupt POST's failure is swallowed (`App.tsx` ~1659). Spec now has S5a (confirmed by `done{stopped:true}`) and S5b (requested, unconfirmed), plus matching card states and tests.
2. I-4(b) counted any `POST /turns` error response as "no turn created". The server's catch-all returns 500 for later errors too. Narrowed to the three pre-start validation messages; everything else is S10.
3. "Signed in" appeared in S9 copy. `available()` finds the binary only. Removed everywhere; §3 and the brief say why.
4. "Browser only" was a UI label, but the page can't tell an absent harness from an offline one. Replaced with "Local harness not reachable"; the planner row gained a connection word that P1-AC1 already required.
5. Boards 01, 02 and 04 carried absolute claims: "Changes nothing (read-only)", "Anything else asks you", "The bot can't save memory", "no API key". Boards re-rendered with qualified copy; spec P1 and P3 now define those rows.
6. Board 03 copied the base label "Ask every time", which overclaims at `7068fc3`. Board re-rendered with a display-only qualifier; spec P5 says not to show the base string.
7. "Expired" could be shown from a page-local 30-minute inference. Now withheld until D-5; before that, "No decision recorded here · after <elapsed>".
8. "Approved · no separate result" body blamed Claude Code for not reporting; the synthetic `tool_end` also covers errored CLI results. Body made neutral.
9. Board 05 note 4 claimed cross-tab protection that U-4 denies. Re-rendered. Board 05 also dimmed the used S9 card to 0.6 opacity (muted text 3.4:1); now full opacity with muted colour.
10. §11 measured only the rest fill. Added hover (`#c43838`, 5.05:1), disabled (0.45 opacity, exempt), focus ring on each surface, pending/approved/denied card states, and the proposed token's hover. Token marked pending owner approval; all boards carry a footer saying they draw today's fill.
11. Added: no-focus-theft rule, 200%/320 px reflow (P4-AC6), Check-connection announcement, "dimmed states carry no information".
12. Brief: "approve each packet" replaced by a single written acceptance that names released packets; §7 order marked as sequencing, not authorization; Fable slices are assigned by Vincent; snapshot re-verified with a timestamp; Node version qualified.
13. #25's Stop-as-denied labelling conflicts with the spec; recorded as U-7 for the owner, not changed here.

**Remaining, not fixable in docs:**
- D-5 to D-8 (new harness signals), U-7 (#25 contract), U-2 (no `MAX_ROUNDS` signal), U-4 (cross-tab claim), U-6 (runner retry vs I-5).
- Native/manual tests in §9 are pending and were not run.
- Board 02's "Browser-only page" tile and board 04's "Expired · no decision" chip are drawn but overridden by the spec text (Board notes). Left as-is to avoid redrawing proposals before Vincent's review; the notes name them.

**Checks performed for the review:** relative links resolve; placeholder/TBD scan; secrets and personal-path scan; docs-only diff against `deploy/vercel`; every rendered board opened and read. No typecheck or test suites were run (docs-only change).
