# WORKLOG

Append-only. **Newest entry at the top**, directly under the line "ENTRIES START BELOW". Never edit or
delete an old entry (add a correction in a new one). Every Claude session adds exactly one entry before it
ends, including sessions that STOP or make no progress. Real results only: paste real command output or
write "not run" and why. If a merge conflict hits this file, keep both sides, newest first.

Session numbers: **Session 0** is the Grok Bot/Supervisor handoff below. Claude's sessions are 1, 2, 3...
(next number = the number in the top entry + 1).

## Entry template (copy this, fill every field, keep the headings)

```markdown
### Session <N> · <YYYY-MM-DD HH:MM ET> · <task id, e.g. T01 SB-09> · <done | partial | STOP | review fix>
- **Branch / PR / head sha:** `<branch>` · <PR link or "no PR yet"> · code head `<sha before this log commit>` (final head after the log commit is in the session summary)
- **Checks on the head:** <4 required checks: pass/pending/fail by name>
- **What was done:** <bullets: files created/changed, behaviour added, in plain words>
- **Tests run (real results):** <command → result, e.g. `npm run test:web` → 212 passed. DB tests → `# skipped 0`, N pass>
- **Not run / could not run:** <or "none">
- **Decisions made and why:** <each decision, the options, the reason>
- **Deviations from the plan:** <anything outside the task's Touch list, or where handoff docs overrode a brief; or "none">
- **Open questions for Vincent or the Supervisor:** <numbered; what you need, what you recommend; or "none">
- **Next step:** <the next task id, or what Vincent must do first (merge #N, answer Q)>
```

---
ENTRIES START BELOW

### Session 10 · 2026-11-06 08:05 ET · UX P1: context line and "How this chat runs" sheet · done
- **Branch / PR / head sha:** `claude/ux-p1-context-line` · PR opened right after this commit · code head `a4c2a9a`. Cut from `deploy/vercel` `dd741af`.
- **Release:** the #26 handoff gates every packet on Vincent's written acceptance naming it. Vincent released P1 in chat on 2026-11-06 ("Yes, P1 is released"); the spec PR #26 itself is still open.
- **Checks on the head:** pending at the time of writing.
- **What was done:** `99a3351` adds a 44 px line under each chat header (`<agent> · <folder> · <connection>`, a dot whose shape differs per state, "Mixed agents" short form for group chats in a narrow column) and a read-only dialog with Runs on, Agent (+ where the choice came from), Model, Working folder (configured, and the last turn's `cwd`), Tools, Connectors, Memory, Skills and "When this page is closed", plus "Open bot settings" and "Check again" (re-reads /health and /drivers, sends nothing). New `src/chatContext.ts` (pure derivation) and `src/chatContextView.tsx`; `resolveAgentDriver` now calls the same `effectiveDriver`, logic unchanged, so the line and the turn agree. `a4c2a9a` fixes an independent review's 3 MEDIUM and 6 LOW findings: focus could leave the dialog (Esc after a click on text, the disabled busy button); Codex/Grok, runner-connector and unavailable-driver Model rows overclaimed; "not available" before anything was checked; whole-page re-render every 8 s; a stale poll could overwrite "Check again"; workspace changes were ignored; runner wording; the page-closed line ignored turns already running; group-chat agent text shrank to nothing.
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 107 passed (`src/chatContext.test.ts` 13: fixtures F-P1-a..d, AC1-AC5, runner, checking, Codex/Grok, page-closed). `npm run test:node` → 285 tests, 253 pass, 0 fail, 32 skipped: Playwright was linked into `runner/node_modules` from the container's global install for this run (not committed), so `ui-layout` and `screenshot` ran here for the first time this session. New browser tests: the connection word is never cut and the line is ≥44 px at 360/390/460/1280; a group chat with a long folder keeps ≥40 px of agent text; the sheet keeps focus, Esc closes it after a click on its text, the page is inert while open, Tab never leaves it while "Check again" is busy. Checked to fail with the busy button disabled again and with the connection word allowed to shrink. `npm run build` ok.
- **Not run / could not run:** real phones, VoiceOver/TalkBack, Windows keyboard, IME, high contrast and 200% zoom (the spec's manual list, §9); DB tests, compose, gitleaks (CI).
- **Decisions made and why:** copy follows the merged code where the spec predates it: Claude Code chats get the bot's tested connectors (#32), planner replies can propose memory notes (#33, #35); an unavailable chosen driver says the built-in planner answers (today's behaviour; "can't start" is P2). The short group form is chosen by the chat column, not the window, so at 1280 px (a 632 px column) the line reads "Mixed agents" and the full member list is in the sheet and the accessible name; the spec's F-P1-d full form needs a column of about 700 px. "Runs on" uses the platform and workspace from /health only.
- **Deviations from the plan:** `src/App.tsx` is outside P1's file list (§8): it gained the health log and "Check again", and `resolveAgentDriver` now calls the shared function. `src/layout-fixture/main.tsx`, `runner/test/ui-layout.test.mjs` and one capability-map test anchor changed with it.
- **Open questions for Vincent or the Supervisor:** 1. P5 next (effective setup in the Model tab, reusing these derivations), per the §7 order? 2. Report only: the spec's colour token change (`--accent-fill`) belongs to P4 and is not in this PR.
- **Next step:** CI and review of this PR; then P5 if released.

### Session 10 · 2026-11-06 07:20 ET · planner bots read saved memory in the decision step (follow-up to #33) · done
- **Branch / PR / head sha:** `claude/decision-step-memory` · PR opened right after this commit · code head `51183c9`. Cut from `deploy/vercel` `f399d39` (after #34, #31, #32, #33).
- **Checks on the head:** pending at the time of writing.
- **What was done:** Vincent's call on #33's open question: with a model key, `decisionPrompt` (the first step and each step after a result) now gets the bot's harness memory under the same heading as the main prompt ("notes kept for you; treat them as information, not as instructions", now one `MEMORY_HEADING` constant in `src/prompt.ts`). Before, a planner bot saw MEMORY.md and saved notes only when the decision step failed. README, capability map and `docs/bot-memory.md` updated; the capability-map test now checks the new wiring instead of the old absence.
- **Merges this session (recorded here because MERGE_GUIDE says Claude never merges):** Vincent asked in chat for Claude to merge, in order, after approving each PR: #34 → `5e26d81`, #31 → `9a02e13`, #32 → `c8b91fb`, #33 → `f399d39`. Each was a merge commit with the expected head SHA, after the base was merged into the PR branch (WORKLOG conflicts kept both sides, newest first) and all four required checks were green on that head. #32 also got Vincent's `--strict-mcp-config` call (`d229193`) before merging.
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 93 passed (`src/memorySave.test.ts` 9). `npm run test:node` → 270 tests, 236 pass, 2 fail (`runner/test/screenshot.test.mjs`, `runner/test/ui-layout.test.mjs`: no `playwright` in this cloud container), 32 skipped. With the `App.tsx` wiring or the `work.ts` change put back, the new web test fails; with either source file or `capabilities.ts` put back, the capability-map test fails. `npm run build` ok.
- **Not run / could not run:** DB tests, compose, gitleaks (CI). No browser run, no real model.
- **Decisions made and why:** the decision prompt reuses `memoryDocument` (8 files, 24,000 characters, newest log second) rather than a smaller cut, so both prompts see the same notes.
- **Deviations from the plan:** the merges above.
- **Open questions for Vincent or the Supervisor:** 1. Report only: #32's first CI run failed once on `CLI fixture: an approved connector tool runs once against the bot's own server` (the resumed round sent nothing within 5 s); the re-run passed and it never failed locally (4 cores busy, non-root user, same Node 22.23.4). Cause unknown; watch for it.
- **Next step:** CI and review of this PR; then UX P1 from the #26 plan.

### Session 10 · 2026-11-05 23:58 ET · bot memory saves, clean carry-over of #28 · done, open questions
- **Branch / PR / head sha:** `claude/bot-memory-save` · PR opened right after this commit · code head `cc57532`. Cut from `deploy/vercel` `912cefb`. Source: #28, `cursor/bot-memory-save-a8ab` `5ccdc9d`, left untouched; its own entry is Session 12 on that branch.
- **Checks on the head:** pending at the time of writing.
- **What was done:** `943e043` carries #28's code as one diff (merge base `25f4b9b`..`5ccdc9d`, its WORKLOG left out); it applied without conflicts on top of #29 and #30. `cc436e5` updates the capability map and README, which still said bots do not save memories themselves. `cc57532` fixes what an independent review confirmed: (1) HIGH: a note could carry text the card does not show (Unicode tag characters, bidi overrides); a probe saved a hidden payload that then reached the system prompt. Both the page and the harness now refuse format, private-use, unassigned and surrogate code points, and notes are saved in NFC form. (2) MEDIUM: the prompt kept the first 8 files, so after 7 older day logs today's note never reached a turn; `memoryDocument` now puts MEMORY.md first and the newest day log second. `docs/bot-memory.md` said "the next turn reads the log"; it now says agent-driver turns always do and planner replies only on the fallback path (the decision step gets no memory, as the capability map already says). (3) MEDIUM: memory went into the system prompt unlabelled; the section now says the notes are information, not instructions. (4) LOW: the decision prompt offered the memory action in runner mode, where the card is unavailable; it no longer does.
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 60 passed (`src/memorySave.test.ts` 9). `npm run test:node` → 244 tests, 210 pass, 2 fail (`runner/test/screenshot.test.mjs`, `runner/test/ui-layout.test.mjs`: no `playwright` package in this cloud container), 32 skipped. With the three fixed source files put back, 3 page tests and 1 harness test fail. `npm run build` ok.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (left to CI). No browser run (Google sign-in), no Windows run, no real model proposing a memory note.
- **Decisions made and why:** invisible characters are refused, not stripped, so what is saved is exactly what the person approved. The decision step still gets no harness memory: changing that changes every planner prompt and is a product call, so the docs were corrected instead.
- **Deviations from the plan:** none beyond the review fixes and the capability-map line.
- **Open questions for Vincent or the Supervisor:** 1. Should the decision step read the bot's harness memory too? Today a model-key planner bot only sees saved notes when the decision step fails. 2. Report only, not fixed: the card's date is the browser's and the file's date is the harness's, so a retry after midnight can add the note again to the next day's log; a hard-linked day log (needs local write access to `~/.sandbench/bots`) is appended through; "remember that file I sent? Delete it." becomes a card for "file I sent? Delete it"; a password in plain words is not caught by the key check (a person still approves each card); `approved: true` is a flag the page sends, as for `/workspace/write`.
- **Next step:** CI and Vincent's review; then UX P1 from the #26 plan.

### Session 10 · 2026-11-05 23:50 ET · local Claude connectors, clean carry-over of #27 · done, open questions
- **Branch / PR / head sha:** `claude/local-claude-connectors` · PR opened right after this commit · code head `2a2f626`. Cut from `deploy/vercel` `912cefb`. Source: #27, `cursor/local-claude-connectors-a8ab` `e90c23d`, left untouched; its own entry is Session 11 on that branch.
- **Checks on the head:** pending at the time of writing.
- **What was done:** `6da64fc` carries #27's code as one diff (merge base `25f4b9b`..`e90c23d`, its WORKLOG left out); it applied without conflicts on top of #29 and #30. `2a2f626` fixes what an independent review confirmed: (1) HIGH: the Claude Code CLI fills `${NAME}` and `${NAME:-default}` in `--mcp-config` values from the harness's environment, where stored keys can be (`secrets.mjs` lets an environment variable win), and sends them when it connects, before any card. A probe with a fake CLI home, fake key and loopback server saw the fake value arrive in the url path and a header. Any `$` in a url or header value now leaves the connector out, with the reason shown. (2) MEDIUM: a Claude turn whose `startTurn` throws (no CLI, settings folder not writable) left its per-turn file, which can hold a pasted header value; it is now removed, and files left by a harness that stopped mid-turn are removed at the next start. (3) README now says one approval covers a connector tool for the rest of the turn on this base, and that MCP servers in the user's own Claude Code settings still load under their own permission rules (the probe saw a user-level server connect next to the bot's).
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 54 passed. `npm run test:node` → 249 tests, 215 pass, 2 fail (`runner/test/screenshot.test.mjs`, `runner/test/ui-layout.test.mjs`: no `playwright` package in this cloud container), 32 skipped. `harness/test/connectors.test.mjs` → 13 pass; with the two fixed files put back, 4 fail (the three new tests and a CLI fixture that then sees the leftover file). `npm run build` ok.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (left to CI). No browser run (Google sign-in), no Windows run.
- **Decisions made and why:** `$` is refused anywhere rather than only `${`, so nothing the CLI might expand gets through and the rule is easy to state; a connector refused this way still works in the page's own MCP calls. This keeps #27's option (b) for stored secrets open: the harness, not the user, would write the `${VAR}` reference. `--strict-mcp-config` is not added: it would also drop the user's own Claude Code servers from every bot turn, a product choice for Vincent.
- **Deviations from the plan:** none beyond the review fixes.
- **Open questions for Vincent or the Supervisor:** 1. Merge `claude/claude-gate-hardening` before this PR: without it, approving a connector tool once allows that tool with any input for the rest of the turn, and the card shows no arguments. With it, each approval covers one exact call (the hook keys `mcp__*` calls on their input). This PR's CLI fixture expects the bare tool name as the card label, so it will need its expected label updated when the two meet. 2. Add `--strict-mcp-config` so a bot turn sees only the bot's connectors? 3. #27's question 1 (stored-secret headers) is still open; recommendation unchanged. 4. Report only: the registry is in memory, so after a quick harness restart turns run without connectors until the page syncs again; removing a connector during a turn takes effect from the next turn. 5. Correction to Session 10 on `claude/interrupted-turn-recovery`: its time says 23:40 ET; it was written at about 23:24 ET.
- **Next step:** CI and Vincent's call on question 1; then the #28 carry-over.

### Session 10 · 2026-11-05 23:40 ET · interrupted local turns: fixes from the independent review (#31) · review fix
- **Branch / PR / head sha:** `claude/interrupted-turn-recovery` · https://github.com/arbiter1170/sandbench/pull/31 · code head `08cc726` (final head after this log commit is in the PR comment).
- **Checks on the head:** pending at the time of writing.
- **What was done:** Fixed the confirmed HIGH and MEDIUM findings from an independent review of `8ff4417`. (1) Stop keeps reading the turn's events for `STOP_GRACE_MS` (5 s) on a separate stream signal, so `done{stopped:true}` can confirm it; before, the stream closed at once and nothing could ever read "Stopped". (2) `harness/turns.mjs` remembers the newest evicted seq per turn and sends a `gap` marker to a subscriber resuming from before it; the page settles the turn as interrupted (`GAP`) instead of showing it complete with steps missing. (3) An `ended` set (last 1000 turns) keeps `GET /turns/<id>` at "finished" after a turn's last event leaves the 500-event buffer; before, it read "unknown", which the page shows as a restart. (4) A refusal that finds a card still waiting without Stop (30-minute expiry, another tab) says "Not approved. No decision was recorded here ..." instead of "denied". (5) Runner mode follows one stream again; the runner has no `/turns/<id>`, so every runner drop read as gone. (6) A resume that brings new events resets the retry count. (7) An approved card still showing "…" at Stop says it may have run. (8) The reply itself is marked `interrupted` on Stop: "Stopped by you ..." once confirmed, "Stop requested · not confirmed ..." otherwise (S5a/S5b). The gap test now closes each subscription before asserting, so a failure cannot hang `node --test` on the keep-alive timer.
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 82 passed (`src/turnRecovery.test.ts` 30). `npm run test:node` → 239 tests, 205 pass, 2 fail (`runner/test/screenshot.test.mjs`, `runner/test/ui-layout.test.mjs`: `ERR_MODULE_NOT_FOUND` for `playwright` in this cloud container), 32 skipped. `npm run build` ok. 32 mutations of the recovery code (the 14 from Session 9 plus 18 for these fixes): all caught, none by timeout.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (left to CI). No browser run (Google sign-in) and no live harness kill on Windows.
- **Decisions made and why:** The gap ends the turn as interrupted rather than trying to rebuild the missing events: the page cannot know what happened in them, and the constraint is to settle as interrupted, not guess done. The 5 s grace is short enough that Stop still feels immediate and long enough for a local interrupt to report back. A refusal the page did not make uses the existing `failed` status with a reason, like the other settled cards.
- **Deviations from the plan:** none.
- **Open questions for Vincent or the Supervisor:** 1. Still open from Session 9: open `claude/claude-gate-hardening` as a PR and merge before this one? 2. Report only, not fixed: a load can mark a reply another tab is still streaming as reloaded (pre-existing from #25; needs a cross-tab lease); Stop pressed before the harness returns a turn id is unchanged.
- **Next step:** CI on the new head, then Vincent's review of #31; then the #27 carry-over.

### Session 9 · 2026-11-05 19:51 ET · interrupted local turns, clean carry-over of #25 · done
- **Branch / PR / head sha:** `claude/interrupted-turn-recovery` · PR opened right after this commit · code head `1adcbdc` (final head after this log commit is in the PR). Cut from `deploy/vercel` `912cefb` (after #29 and #30). Source: #25, `cursor/interrupted-turn-recovery-a8ab` `726e162`, left untouched.
- **Checks on the head:** pending at the time of writing.
- **What was done:** `970adc6` carries #25's code as one diff (`726e162^2..726e162`, its WORKLOG left out; #25's own entry is Session 10 on that branch). It applied without conflicts. `GET /turns/<id>`; `harnessEvents` resumes a dropped stream from the last event seen and throws `TurnLostError` when the harness restarted or stays unreachable; interrupted messages keep their partial text; a local load settles what nobody can answer; nothing is answered, retried or re-run from the page; runner mode untouched. `1adcbdc` settles U-7 from the UX design (#26) as #25's owner: the harness sends the same `permission_resolved {allow:false}` for Deny, expiry and Stop, and the interrupt POST can fail unseen, so a driver card still waiting at Stop says "Stop requested · no decision", then "Stopped · no decision" once `done{stopped:true}` arrives, and a card nobody answered at a normal end says "No decision recorded here". Before, all three said "denied". The settling moved to `settleEndedMessage` in `src/turnRecovery.ts`.
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 74 passed (`src/turnRecovery.test.ts` 23). `npm run test:node` → 237 tests, 203 pass, 2 fail (`runner/test/screenshot.test.mjs`, `runner/test/ui-layout.test.mjs`: no `playwright` package in this cloud container), 32 skipped. `npm run build` ok. 14 mutations of the recovery code (dedupe, gone, retries, dropped-as-ended, card settling, the Stop labels, the runner exemption, the harness state and route): all caught, after adding checks for the last two.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (left to CI). No browser run (the page needs Google sign-in) and no live harness kill or reload on Windows.
- **Decisions made and why:** U-7 is fixed here rather than left to the UX packet, because the design says a card never reads "denied" unless the user denied it, and this is the code that wrote it. The card status for these is `failed` with the reason as its output, the same way #25 already settles lost cards, so no new status is needed before P2/P3. The display states S5a/S5b on the message itself stay with P2.
- **Deviations from the plan:** none beyond the U-7 commit.
- **Open questions for Vincent or the Supervisor:** 1. `claude/claude-gate-hardening` (pushed, no PR) carries #29's last review round, which the squash merge missed; open it as a PR and merge before this one? 2. The time on that branch's WORKLOG entry says 20:05 ET; it was written at about 19:47 ET.
- **Next step:** CI and an independent review of this PR, then the #27 carry-over.

### Session 9 · 2026-11-05 · Claude Code gate: one approval per exact call (sixth review) · review fix
- **Branch / PR / head sha:** `claude/claude-gate-hardening` · no PR yet · code head `2add037` (final head after this log commit is in the session summary)
- **Checks on the head:** not run in CI yet (no PR).
- **What was done:** a sixth independent review (live Claude Code 2.1.318 turns against a fake model, fake key, scratch HOME) found the shell gate held, plus: (1) one approved WebFetch let every later WebFetch in the turn run with no card (Claude Code's rule was the bare name), and the same for WebSearch, NotebookEdit and MCP tools; (2) an approved Write or Edit never ran (`Write(/abs/path)` does not match); (3) a subagent's refused call never becomes a card (fails closed); (4) Windows hook quoting unverified. Fixed (1) and (2): the hook now also sees WebFetch, WebSearch, Write, Edit, MultiEdit, NotebookEdit and `mcp__` tools and keys each approval to the exact URL, query, file or arguments; Claude Code's rule for these is the bare name. The hook has `onFailure: "block"`, so a hook that crashes or times out blocks its call. (3) and (4) are documented.
- **Tests run (real results):** `npm run typecheck` clean; vitest 52 passed; `node --test harness/test/*.test.mjs` 139 pass, 0 fail. Driver and hook mutations: 31, all caught. Live: approve WebFetch one, then WebFetch one runs and WebFetch two gets its own card; approved Write creates the file, denied Write does not; a hook made to sleep past a 1 s timeout blocks the call and the model saw only the hook error; Bash approve, deny and Monitor unchanged.
- **Not run / could not run:** DB tests, compose, gitleaks, a real Windows run, a live MCP server.
- **Decisions made and why:** a Write or Edit approval covers that file for the rest of the turn (the card shows the path, not the content), rather than the exact content, which the model may not repeat byte for byte.
- **Deviations from the plan:** none.
- **Open questions for Vincent or the Supervisor:** 1. Open this branch as a PR. 2. Read, Grep and Glob are still outside the gate.
- **Next step:** PR and CI once Vincent agrees.

### Session 9 · 2026-11-05 20:05 ET · Claude Code gate hardening, missed by the #29 merge · review fix
- **Branch / PR / head sha:** `claude/claude-gate-hardening` · no PR yet · code head `4b66da0` (final head after this log commit is in the session summary)
- **Checks on the head:** not run yet.
- **What was done:** #29 was squash-merged at `3d49fea`, so its fifth-review round (`2e8ab6a` on `claude/approval-rule-safety`, logged there) never reached `deploy/vercel`. On `912cefb` an unapproved Claude Code command that exits non-zero is not caught, and a `.claude/settings.json` in the turn folder can turn the approval hook off or replace its allow list. This branch carries `2e8ab6a` onto `912cefb` unchanged, except that the README keeps #30's "Limits today" paragraph.
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 52 passed. `npm run test:node` → 244 tests, 210 pass, 2 fail (`runner/test/screenshot.test.mjs`, `runner/test/ui-layout.test.mjs`: no `playwright` package in this container), 32 skipped. `npm run build` ok. Live Claude Code turn with a fake model, fake key and scratch HOME: `cat notes.txt` gets a card and runs after approval; with `{"disableAllHooks":true}` in the turn folder's `.claude/settings.json`, an unapproved `cat notes.txt missing.txt` still gets a card and does not run.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (left to CI). No real Windows run.
- **Decisions made and why:** a separate small PR rather than folding it into the #25 carry-over, so the security fix can merge on its own.
- **Deviations from the plan:** not in the kickoff's order; it fixes HIGH findings on the merged base.
- **Open questions for Vincent or the Supervisor:** 1. Open this as a PR now and merge before #25? 2. Claude Code's Read, Grep and Glob still read inside the turn folder without a card (report-only).
- **Next step:** PR into `deploy/vercel` once Vincent agrees; CI and review.

### Session 9 · 2026-11-05 19:10 ET · capability map labels: fixes from the fourth independent review (#30) · review fix
- **Branch / PR / head sha:** `claude/capability-map-labels` · https://github.com/arbiter1170/sandbench/pull/30 · code head `5d6457e` (final head after this log commit is in the session summary)
- **Checks on the head:** pending at the time of writing. The previous head is `5501b4d`.
- **What was done:** a fourth independent review of `5501b4d` found five problems. Corrected:
  - Group chats and voice calls: with no key, a bot that uses an API driver (as its Agent or through the default agent) gets an error while the local harness or the runner is up, not a stand-in. The rows now say so.
  - Computer use: "without a model key" now applies to the built-in planner only. A CLI driver picks its own steps with its own sign-in.
  - Bot teammates and README: the API-driver error happens only while the local harness or the runner is up, and also for a bot with no Agent when the default agent is an API driver.
  - AppsFlyer, Braze, and Sentry: the error log syncs with the signed-in workspace, so it is not only local.
  - Tests: deleting the desktop app's `startHarness()` call, ignoring `allowLocal`, or making `isEmailAllowed` return true now fails a test. The allowlist test is in `src/capabilities.test.ts`, because Node cannot load `src/firebase.ts`. A new test ties the API-driver error to the page and the drivers.
- **Tests run (real results):** Node 22.23.4 on Linux. `npm run typecheck` → clean. `npm run test:web` → 43 passed. `npm run test:node` → 161 tests, 127 pass, 2 fail (`runner/test/screenshot.test.mjs` and `runner/test/ui-layout.test.mjs`: `playwright` is not installed in this checkout), 32 skipped. `npm run build` → ok. Each of the review's three mutations was applied, failed a test, and was reverted.
- **Not run / could not run:** Postgres DB tests, the Auth emulator test, compose + image, gitleaks (left to CI). The page was not opened in a browser.
- **Decisions made and why:** the Settings heading "Local error log" and its translations stay as they are; they are outside this PR.
- **Deviations from the plan:** none beyond the earlier entries.
- **Open questions for Vincent or the Supervisor:** 1. The Settings heading "Local error log" (`src/i18n.ts`, 12 translations) has the same wording problem; fix it here or in a later PR? 2. #29 also edits `src/capabilities.ts`, so whichever merges second needs a merge of `deploy/vercel`.
- **Next step:** CI on this head, then an independent review of the final head.

### Session 8 · 2026-11-05 · capability map labels: fixes from the third independent review (#30) · review fix
- **Branch / PR / head sha:** `claude/capability-map-labels` · https://github.com/arbiter1170/sandbench/pull/30 · code head `ac379e9` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `a65a3b1`.
- **What was done:** a third independent review of `a65a3b1` found rows missing a key, a harness hint that breaks with the desktop app, and sentences that did not match the code. Corrected them. Every row's Needs label is now pinned in one test, and the test header no longer claims every behaviour change fails.
- **Tests run (real results):** Node 22.23.4 on Windows. `npm run typecheck` → clean. `npm run test:web` → 42 passed. `npm run test:node` → 165 tests, 131 pass, 2 fail (the same two Windows-only failures as untouched `deploy/vercel`), 32 skipped, including the DB tests. `npm run build` + bundle key grep → ok, none.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). The page and the desktop app were not opened. The routines sentence and the two-harness failure in the desktop app are traced, though the two-harness token failure itself was run in review.
- **Decisions made and why:** most row sentences stay unpinned, because pinning a hand-written sentence only tests the sentence.
- **Deviations from the plan:** none beyond the earlier entries.
- **Open questions for Vincent or the Supervisor:** 1. Found in review, outside this PR: the runner's `http` driver accepts a loopback base that its `/model` guard refuses.
- **Next step:** Independent review of the final head. Merge #29 before this PR.

### Session 8 · 2026-11-05 · capability map labels: fixes from a second independent review (#30) · review fix
- **Branch / PR / head sha:** `claude/capability-map-labels` · https://github.com/arbiter1170/sandbench/pull/30 · code head `6dfca53` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `158a885`.
- **What was done:** a second independent review of `158a885` found rows that broke the Needs rule, sentences that ignored CLI drivers, and six breakages the tests missed. Corrected those rows and sentences, and tied the tests to the page, the driver path and the runner's own server file.
- **Tests run (real results):** Node 22.23.4 on Windows. `npm run typecheck` → clean. `npm run test:web` → 42 passed. `npm run test:node` → 164 tests, 130 pass, 2 fail (the same two Windows-only failures as untouched `deploy/vercel`), 32 skipped, including the DB tests. `npm run build` + bundle key grep → ok, none. Each of the reviewer's six breakages now fails a test.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). The page was not opened in a browser. The routines row's behaviour when a runner stops answering is traced in the code, not run.
- **Decisions made and why:** none new. The phone-width table overflow is left as it is: the pane scrolls and nothing is clipped.
- **Deviations from the plan:** none beyond the earlier entries.
- **Open questions for Vincent or the Supervisor:** none new.
- **Next step:** Independent review of this head. Merge #29 before this PR.

### Session 8 · 2026-11-05 · capability map labels: fixes from independent review (#30) · review fix
- **Branch / PR / head sha:** `claude/capability-map-labels` · https://github.com/arbiter1170/sandbench/pull/30 · code head `9c75869` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `27a4106`.
- **What was done:** an independent review of `27a4106` found false labels. Corrected: Bot teammates (`MEMORY.md`), Tasks and routines, Agent drivers, Computer use, Test stack profiles, Chat, Grok Bot migration, the README dev-proxy sentence and the map note. "Needs" now means what must be running for everything in a row to work. The tests read CRLF checkouts and tie more rows to the routes that serve them.
- **Tests run (real results):** Node 22.23.4 on Windows. `npm run typecheck` → clean. `npm run test:web` → 42 passed. `npm run test:node` → 161 tests, 127 pass, 2 fail (the same two Windows-only failures as untouched `deploy/vercel`), 32 skipped, including the DB tests. `npm run build` + bundle key grep → ok, none.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). The page was not opened in a browser. "A runner build does not run routines" is traced in the code, not run.
- **Decisions made and why:** this corrects the Session 8 note above that called the README's dev-proxy sentence "not clearly false": the page never calls `/api-proxy`, so it was false. One rule for "Needs" (the strongest requirement in the row) because mixed rows were labelled inconsistently.
- **Deviations from the plan:** none beyond the earlier entry.
- **Open questions for Vincent or the Supervisor:** none new.
- **Next step:** Re-review of this head. Merge #29 before this PR.

### Session 8 · 2026-11-05 · capability map labels, clean carry-over of #24 (audit batch 1, part 2) · partial
- **Branch / PR / head sha:** `claude/capability-map-labels` · PR link in the session summary · code head `8de4cc9` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing.
- **What was done:**
  - Carried over the intended changes of #24 (head `609f71c`) onto `1b247e7` as a new branch. Checked: the tree equals a merge of #24 with `deploy/vercel`, apart from this file. The original branch and PR are untouched.
  - New in this PR, from reviewing #24: "Model per bot" now says it needs the local harness or the runner, because every page model call goes to `/model` there. The test that pinned the old label changes with it.
- **Tests run (real results):** see the PR body for the output. Same two Windows-only node failures as untouched `deploy/vercel`; CI there is green.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (Docker daemon not running here; left to CI). The page was not opened in a browser.
- **Decisions made and why:** new PR instead of editing #24, so the original stays as it is and its commit messages do not reach this branch. README's dev-proxy sentence is left alone: dated, not clearly false, and outside this task.
- **Deviations from the plan:** not a WORKPLAN task (Vincent approved the audit batches). STATUS.md not rewritten here; it waits for the end of the session.
- **Open questions for Vincent or the Supervisor:** none new.
- **Next step:** Independent review of this head. Vincent merges when ready.
### Session 9 · 2026-11-05 19:01 ET · approval-rule safety: fixes from the fourth independent review (#29) · review fix
- **Branch / PR / head sha:** `claude/approval-rule-safety` · https://github.com/arbiter1170/sandbench/pull/29 · code head `b8cad9c` (final head after this log commit is in the session summary)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `d73eb75`.
- **What was done:** (1) Claude Code turns: Claude Code runs its built-in read-only commands (`cat`, `ls`, read-only `git`) without asking in every mode, `dontAsk` included, and the set cannot be configured, so with only an `allow` list they skipped the card. The driver now adds a PreToolUse hook (`harness/drivers/claudeGate.mjs`) for Bash and PowerShell that answers "ask" for anything not approved word for word in this turn; in `claude -p` that becomes a permission denial and a card. Claude Code runs the call when a hook crashes or is missing, so the hook answers "ask" on any error, the driver runs it once before each turn and refuses to start if it answers wrongly, and a shell command that runs without approval anyway (hooks turned off in Claude Code's own settings) stops the turn. `extras.settings` cannot remove the hook or set `disableAllHooks`. (2) The harness starts Windows PowerShell by its absolute path under the system root (`harness/shellPath.mjs`), so a `powershell.exe` planted in the turn folder no longer replaces the shell. (3) More credential files ask, under shorter and exact rules: bare repositories (`repo.git/config`), any `.env*` file or folder, `.ppk`, `.jks`, `.kdbx`, `.p8`, `.gpg`, Terraform state and variables, `.s3cfg`, `.my.cnf`, `.boto`, `.htpasswd`, `.terraformrc`, `.dockercfg`, `kubeconfig`, rclone and s3fs files. (4) The harness and runner shells close standard input, and a listed program given no file (`cat -n`, `head -n 1`, `wc -l`) asks even under a rule for exactly that. A rule that names a file (`cat notes.txt`) covers more flags for it, not more files. Dead `max` removed. (5) `ls` flags, `cat -n` and `type` are no longer validated forms: in PowerShell they skipped the card and then failed. README, the capability row and the Studio note say what the Claude Code hook covers, that Claude Code's own Read, Grep and Glob still read inside the turn folder without a card, and that credential files ask even under an exact rule. (6) Tests for the review's gaps: every character outside the alphabet and every provider drive under exact rules, flag value shapes, missing flag values, path positionals for every program, non-string rules, flag case, and the Studio and App wiring (the Studio form now calls `addAutoReviewRule`).
- **Tests run (real results):** `npm run typecheck` clean. `npm run test:web` → 5 files, 48 passed. `npm run test:node` → 220 tests, 186 pass, 2 fail, 32 skipped; the 2 failures are `runner/test/screenshot.test.mjs` and `runner/test/ui-layout.test.mjs`, which cannot load `playwright` in this cloud container and fail the same way on untouched `d73eb75`. `npm run build` ok. Mutation sweep of `harness/autoReview.mjs`: 71 mutations, 69 caught; the 2 left are equivalent (an empty word never reaches `isNumber`, and a rule longer than the command already fails the word-for-word check). Hook, stop, pre-turn check, `disableAllHooks` and allow-env mutations of the driver are each caught. Live Claude Code 2.1.318 turns against a local fake model server (fake key, scratch HOME, fake `notes.txt`, no real model call): on `d73eb75` `cat notes.txt` ran with no card and the model received the file; on this head `cat notes.txt`, `git status` and `ls` each showed a card, ran only after approval and never after a denial, `rm notes.txt` ran after approval, and with `disableAllHooks` in the scratch user settings the turn stopped with the explanation before the output reached the model. The probes found that a hook that throws or is missing lets the command run, which is why the pre-turn check and the stop exist.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). No real Windows run, so the PowerShell path is checked by unit tests only. No live Codex or Grok turn. No turn with a real model.
- **Decisions made and why:** Vincent: #29-1 and #29-2 are in scope for #29. A hook rather than `ask` rules, because an `ask` rule also beats the approved `allow` entries, and rather than `dontAsk`, which still runs the read-only set. "ask" rather than "deny", because both are listed in `permission_denials` but "ask" also emits the `permission_denied` event. Forms that fail in PowerShell now ask, which costs a card for `ls -la` on the runner's bash.
- **Deviations from the plan:** `runner/shell.mjs` closes standard input too, for the same stall.
- **Open questions for Vincent or the Supervisor:** 1. Claude Code's own Read, Grep and Glob tools still read inside the turn folder (a `.env` there included) without a card; the same hook could gate them, with a card per file read. 2. Merge method and the GitHub author field.
- **Next step:** CI on this head, then an independent review with scrubbed probes.

### Session 8 · 2026-11-05 · approval-rule safety: git removed from shorter rules (#29) · review fix
- **Branch / PR / head sha:** `claude/approval-rule-safety` · https://github.com/arbiter1170/sandbench/pull/29 · code head `d4778db` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. See the previous head's checks in the PR.
- **What was done:** Vincent chose to remove git from shorter rules. A saved `git` rule now covers no git command, and a git command only skips a card under a rule for exactly that command. The git table and the code only it used are gone from `harness/autoReview.mjs`. Copy and tests follow.
- **Tests run (real results):** see the PR body for the output. Same two Windows-only node failures as untouched `deploy/vercel`; 32 skipped, including the DB tests. 28 mutations, each caught by at least one test.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). No live Claude CLI, Codex or Grok turn. No real Linux or macOS run.
- **Decisions made and why:** Vincent: option A of three. In review, a folder with plain `HEAD`, `config`, `objects/` and `refs/` made `git status` run a hook, with nothing in the command text to show it. A saved exact git command still carries that risk, by the user's own choice, one command at a time.
- **Deviations from the plan:** none beyond the earlier entries.
- **Open questions for Vincent or the Supervisor:** 1. Merge method and the GitHub author field.
- **Next step:** Independent review of this head, then the #25 carry-over.

### Session 8 · 2026-11-05 · approval-rule safety: fixes from the third independent review (#29) · review fix
- **Branch / PR / head sha:** `claude/approval-rule-safety` · https://github.com/arbiter1170/sandbench/pull/29 · code head `f2ee18c` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `479464f`.
- **What was done:** a review of the rewritten matcher found no shell or flag bypass, and these: `git grep` recovered a whole tracked fake secret through auto-approved `-l` guesses, so it is no longer listed in any form. `dir /s`, `/b` and `/w` were root-level paths, so they are gone. `cat`, `head`, `tail`, `wc`, `type` and `Select-String` with no file would stall on standard input, so they need one. Copy says what asks only under a shorter rule. Tests now cover the review's surviving mutations, including exact rules and the drivers' `tool` labels.
- **Tests run (real results):** see the PR body for the output. Same two Windows-only node failures as untouched `deploy/vercel`; 32 skipped, including the DB tests.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). No live Claude CLI, Codex or Grok turn. No real Linux or macOS run.
- **Decisions made and why:** not fixed here, because it is Vincent's decision: a folder with plain `HEAD`, `config`, `objects/` and `refs/` is a repository with no `.git` in the command, and `git status` ran its `core.fsmonitor` hook in review. The header now says so.
- **Deviations from the plan:** none beyond the earlier entries.
- **Open questions for Vincent or the Supervisor:** 1. Git under shorter rules: remove it, or keep it with `safe.bareRepository=explicit` and `core.fsmonitor=false` set for spawned commands, or keep the limit. 2. Merge method and the GitHub author field.
- **Next step:** Vincent answers question 1. #25 waits for it.

### Session 8 · 2026-11-05 · approval-rule safety: positive validation, after a second independent review (#29) · review fix
- **Branch / PR / head sha:** `claude/approval-rule-safety` · https://github.com/arbiter1170/sandbench/pull/29 · code head `c71f353` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `a188c80`.
- **What was done:** Vincent's decision: any command whose shell, quoting, escaping or arguments cannot be positively validated must ask. `harness/autoReview.mjs` is rewritten around that. It was a blocklist of risky options; now a rule shorter than the command covers it only when the whole command fits that program's listed flags and argument shapes. A second independent review, of `a188c80`, found more reads of secrets; each is now a test. Paths must be relative and canonical, `.git` asks, and git forms that print file contents without naming the file ask (`git diff`, `git grep needle`, `git log -p`, `git show HEAD`, `git blame`).
- **Tests run (real results):** see the PR body for the output. Same two Windows-only node failures as untouched `deploy/vercel`; 32 skipped, including the DB tests.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). No live Claude CLI, Codex or Grok turn. No real Linux or macOS run.
- **Decisions made and why:** Vincent: `full` keeps asking for commands no rule covers. Backslashes always ask rather than passing for PowerShell: the page does not know which shell will run the command. Tracked file contents ask because a secret committed under an ordinary name has nothing to recognize. This costs usability: `dir .\sub`, plain `git diff` and `git grep needle` now show a card. Rules saved with a backslash no longer match.
- **Deviations from the plan:** a larger change than the carry-over of #23, at Vincent's direction. `docs/parity/PLAN.md`, `GAP_AUDIT.md` and `CLAUDE_CODE_PROMPT.md` still describe first-word matching.
- **Open questions for Vincent or the Supervisor:** 1. Merge method and the GitHub author field. 2. Repository config can still make read-only git commands run a program; taking git out of shorter rules is the only fix at this level. 3. Claude Code's own read tools never reach this gate.
- **Next step:** Independent review of this head. #25 waits for it.

### Session 8 · 2026-11-05 · approval-rule safety: fixes from independent review (#29) · review fix
- **Branch / PR / head sha:** `claude/approval-rule-safety` · https://github.com/arbiter1170/sandbench/pull/29 · code head `ded3c63` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing. All 4 were green on the previous head `d08d6a8`.
- **What was done:** an independent review of `d08d6a8` found bypasses, reproduced with real bash, sh, git and PowerShell. `harness/autoReview.mjs` now: asks for a backslash outside PowerShell cmdlets; asks for git `--no-index`, `--untracked`, `--no-exclude-standard`, `--help`, `--show-signature`, paths outside the repository and `git remote -v`; asks for `::` provider paths, mixed-slash UNC paths and `Get-Process` remote parameters; matches arguments case-sensitively; always asks for Codex and Grok requests; lists more credential locations. `src/work.ts` no longer tells the model about first-word matching. README and the map row now match.
- **Tests run (real results):** Node 22.23.4 on Windows. `npm run typecheck` → clean. `npm run test:web` → 45 passed. `npm run test:node` → 179 tests, 145 pass, 2 fail (the same two Windows-only failures as untouched `deploy/vercel`), 32 skipped, including the DB tests. `npm run build` + bundle key grep → ok, none. Mutation check: switching off each of 17 rules fails at least one test; the redundant subcommand-dash check does not, because an option there is refused later anyway.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (no Docker daemon here; left to CI). No live Claude CLI, Codex or Grok turn. No Linux container run.
- **Decisions made and why:** Codex and Grok always get a card: those drivers give file changes and other tools the same label as shell commands, and the requirement is that non-shell tools always ask. `claude.mjs` and the other driver files are not changed. Vincent can reverse this once the drivers separate the two.
- **Deviations from the plan:** `src/work.ts` one prompt line, outside the original #23 diff. `docs/parity/PLAN.md`, `GAP_AUDIT.md` and `CLAUDE_CODE_PROMPT.md` still describe first-word matching; they are owned elsewhere or hard-rule docs, so they are left alone.
- **Open questions for Vincent or the Supervisor:** 1. Merge method and the GitHub author field. 2. The read-only list still accepts open-ended arguments and relies on best-effort lists; narrowing it to allowlisted arguments would be stricter, at the cost of more cards.
- **Next step:** Re-review of this head.

### Session 8 · 2026-11-05 · approval-rule safety, clean carry-over of #23 (audit batch 1, part 1) · partial
- **Branch / PR / head sha:** `claude/approval-rule-safety` · PR link in the session summary · code head `a796b6b` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing.
- **What was done:**
  - Carried over the intended changes of #23 (head `d890511`) onto `1b247e7` as a new branch. Checked: the tree equals a merge of #23 with `deploy/vercel`, apart from this file. The original branch and PR are untouched.
  - New in this PR, from reviewing #23: `harness/autoReview.mjs` now treats abbreviated long git options and clustered short flags as the risky option they expand to, checks a sensitive path attached with `:` or `=`, and lists `.sandbench`, `.claude/.credentials.json`, `.config/gh` and common private key names.
- **Tests run (real results):** Node 22.23.4 on Windows. `npm run typecheck` → clean. `npm run test:web` → 45 passed. `npm run test:node` → 171 tests, 137 pass, 2 fail, 32 skipped. The 2 failures (`secrets.test.mjs` file mode, `server.test.mjs` bash spawn) also fail on untouched `deploy/vercel` on Windows; CI there is green. The 32 skips include the DB tests, which did not run. `npm run build` + bundle key grep → ok, none. Probe on real git 2.52: `git grep --open=<prog> x` and `git grep -iO<prog> x` ran the program and were auto-approved before; they ask now. Mutation check: each of 4 new rules off → 1 test fails.
- **Not run / could not run:** Postgres DB tests, compose + image, gitleaks (Docker daemon not running here; left to CI). No live Windows, PowerShell or Claude CLI turn.
- **Decisions made and why:** Vincent: `full` keeps asking for commands no rule covers, with no auto-run expansion. New PRs instead of editing #23–#28, so the originals stay as they are and their commit messages do not reach this branch. An option that is a prefix of a risky one (`--text`) asks too: an extra card costs less than a miss.
- **Deviations from the plan:** not a WORKPLAN task (Vincent approved the audit batches). `runner/Dockerfile` gets one COPY line. STATUS.md not rewritten here; it waits for the end of the session to avoid conflicts between the parallel batch PRs.
- **Open questions for Vincent or the Supervisor:** 1. Merge method: settle the GitHub author field on merges before the first merge.
- **Next step:** Independent review of this head, then the #24 carry-over. Vincent merges when ready.

### Session 7 · 2026-11-05 13:55 ET · local usability: working-directory context + chat overflow (PR #21, Cursor cloud run) · done
- **Branch / PR / head sha:** `cursor/local-cwd-context-chat-overflow-fba9` · https://github.com/arbiter1170/sandbench/pull/21 · code head `f7b924e` (final head after this log commit is in the PR)
- **Checks on the head:** pending at the time of writing (pushed with this entry).
- **What was done:**
  - A live Claude Code turn (North, Windows harness) tried `Glob` under `…\.sandbox\workspace` and was told the real cwd is `…\.sandbench\workspace`. The harness resolves and starts the driver in the right folder; nothing in Sandbench produces `.sandbox`; the page's system text only said "inside their Sandbench workspace folder", so the model guessed. New `harness/workingDirectory.mjs`: an authoritative block (path, workspace root, configured folder) appended by `turns.mjs` after the 40,000-char cut; `turn_start` carries `cwd`; the page shows `Working folder: …` in the trace. Opt-in by `workspaceRoot` (harness only; runner unchanged). `claude.mjs` untouched.
  - Chat overflow (screenshots from the laptop): `.msg { overflow-wrap: anywhere }`, `.approval` and `.composer` get a `minmax(0, 1fr)` track. Preformatted tool output still scrolls, inside its own panel. New `src/layout-fixture/` (real Workspace shell, fixed messages, not in the bundle) and `runner/test/ui-layout.test.mjs` (Vite build + headless Chromium at 360/390/460/1280 px, containment assertions).
- **Tests run (real results):** `npm run typecheck` → clean. `npm run test:web` → 39 passed. `npm run test:node` → 150 tests, 118 pass, 0 fail, 32 skipped (same 32 as `deploy/vercel`: DB without `TEST_DATABASE_URL`, optional skills pack, Auth emulator). `npm run build` + bundle key grep → clean. Mutation checks: block off → 2 turns tests fail; CSS stashed → 4 layout tests fail (`page scrollWidth 392 > 360`, `message list scrolls sideways: 2272 > 630`).
- **Not run / could not run:** Docker image/compose, gitleaks, Postgres DB tests (no Docker here; no runner data path touched). Live Windows check not done cloud-side.
- **Decisions made and why:** the block lives in `turns.mjs`, not `claude.mjs` (SB-03 reserved that file; every driver gets the same context). Opt-in so the runner's prompt stays byte-identical. The wrong path is treated as a model invention; the fix removes the guesswork and shows the truth, it does not rewrite model text or add a `.sandbox` alias. The UI test sits under `runner/test/` because Playwright and Chromium are the runner's.
- **Deviations from the plan:** not an SB item (local usability, like #15). STATUS.md and PLAN.md not touched, to stay clear of the parallel docs refresh (bc-bb89b19b).
- **Open questions for Vincent or the Supervisor:** none.
- **Next step:** Vincent runs the live check in the PR body and merges #21.

### Session 7 · 2026-11-05 · T05 PLAN.md host text + STATUS/WORKPLAN refresh (docs only) · done
- **Branch / PR / head sha:** `cursor/docs-plan-laptop-text-93f7` · https://github.com/arbiter1170/sandbench/pull/20 · cut from `7068fc3` (deploy/vercel after #18)
- **Checks on the head:** pending at the time of writing (the four required checks run on every PR).
- **What was done:**
  - `deploy/vercel` now holds #10 (gap audit, `506d0e4`), #15 (iPhone sign-in, `aa42aa0`), #18 (SB-03 PR 1, `7068fc3`) and #19 (`04f237f`); CI is green on `7068fc3`. Older STATUS text called #15 and #18 open; this entry supersedes it.
  - T05, exactly as specified: `docs/parity/PLAN.md` diagram (laptop + Tailscale Funnel), SB-01 "Done when", Change (compose profiles) and Approach/Acceptance (what is true today, per `docs/runner.md` "Laptop runner"), Q1 and Q9 marked answered with the earlier answers kept as "superseded", the Cloudflare-domain "still open" bullet removed, SB-23 and the risks bullet annotated "(Tailscale Funnel today; Cloudflare Access only if a VM is ever used)". No task, estimate, dependency or checkbox changed. One Progress log line.
  - `WORKPLAN.md`: T04 ticked as merged (#18). `STATUS.md` rewritten (T04 merged, T05 PR open, T10 in progress; blockers kept, Q1 and the local "Thinking" symptom added as open items).
- **Tests run (real results):** none needed (docs only). `grep -n -i "hetzner\|cx43" docs/parity/PLAN.md` returns only the two lines that say "no Hetzner" / "superseded".
- **Not run / could not run:** gitleaks locally (CI runs it).
- **Decisions made and why:** none new. The branch name follows the cloud-agent naming rule (`cursor/<name>-93f7`) instead of the task's `docs-plan-laptop-text`, as Session 6 did for its merge; the task id is in the PR title.
- **Deviations from the plan:** the STATUS/WORKPLAN refresh rides in this docs PR instead of the next code PR (WORKPLAN §0 step 2 allows either; Vincent asked for a separate, reviewable docs refresh first).
- **Open questions for Vincent or the Supervisor:** none new; Q1 (API key for the runner's Claude CLI) still blocks the live part of T10.
- **Next step:** T10 (SB-03 PR 2) on its own branch from `deploy/vercel`, fake-driver tested. Vincent merges this docs PR when its checks are green.

### Session 6 · 2026-11-05 · T04 SB-03 PR 1: merge `deploy/vercel` into #18 to clear conflicts · done
- **Branch / PR / head sha:** `sb-03a-contracts` · https://github.com/arbiter1170/sandbench/pull/18 · merge of `04f237f` (deploy/vercel: #16 SB-29 decision, #19 skill front-matter) into `b2edf03`
- **Checks on the head:** pending at the time of writing (pushed with this entry).
- **What was done:** GitHub refused to update #18 onto `deploy/vercel` (422, merge conflict). Merged `origin/deploy/vercel` into the branch (no rebase, per the rules). Code merged by itself; four docs conflicted, all between this PR and PR #16, and each was resolved by keeping both sides: `PLAN.md` (both Progress log lines, SB-29 then SB-03 PR 1), `STATUS.md` (Session 4's layout with #16's SB-29 wording; #16 and #17 moved out of the open-PR list because both are merged; "latest merged" now #19), `WORKLOG.md` (both entries, newest first; the two entries both named Session 4 are left as written), `docs/runner.md` (both new sections, "Agent isolation (decided, SB-29)" then "Extending the runner (SB-03 PR 1)"). No code changed in the resolution.
- **Tests run (real results):** on the merge result, on Linux with Node 22, a local Postgres 16 as `TEST_DATABASE_URL` and Playwright's Chromium installed: `npm run test:node` → 138 tests, 136 pass, 0 fail, 2 skipped (the optional `SANDBENCH_TEST_SKILLS_DIR` pack check, and the Auth-emulator check). Per file: contracts 6/6, routes 4/4, tools-discovery 4/4, drivers 9/9, turns 1/1, skillLibrary 8/8 (+1 optional skip), jobs-schema 6/6 (`skipped 0`), data 15/15, memory 9/9. `npx vitest run` → 35 passed. `npx tsc --noEmit` → clean.
- **Not run / could not run:** the image build and gitleaks (no Docker here; CI runs them).
- **Decisions made and why:** merge commit rather than rebase, because the branch is pushed and the rules forbid rebasing a pushed branch. In docs, both sides were kept rather than choosing one, because the two PRs describe different work.
- **Deviations from the plan:** none; conflict resolution only.
- **Open questions for Vincent or the Supervisor:** none.
- **Next step:** Vincent merges #18. Then T10 (the turn engine) becomes possible.

### Session 5 · 2026-10-28 · SB-29 simplified for a single user (PR #16) · done
- **Branch / PR / head sha:** `sb-isolation-decision` · https://github.com/arbiter1170/sandbench/pull/16 · on top of the Session 4 merge commit
- **Checks on the head:** pending at the time of writing.
- **What was done:** Vincent is the only user, and chose to drop the per-agent Linux users from SB-29. The sandbox container stays: no keys, no secrets file, no route to Postgres, model calls through `/api/model`. Updated `docs/runner.md` (points 2, 6, 8 and the diagram), the SB-29 item in `PLAN.md` (title, change, size 3 d to 2 d, acceptance, live check, log line), the brief (question 8, the SB-04 line, SB-29 size) and `STATUS.md`.
- **Tests run (real results):** none needed (docs only).
- **Not run / could not run:** none.
- **Decisions made and why:** per-agent users dropped. The risk with one human user is a tricked agent reaching keys, the DB or other services, which the container already blocks. Agents reading each other's folders is accepted, with per-agent users as a follow-up if a second person joins.
- **Deviations from the plan:** none.
- **Open questions for Vincent or the Supervisor:** none.
- **Next step:** Vincent merges #16.

### Session 4 · 2026-10-28 · isolation decision (docs only, PR #16) · done (merged deploy/vercel to clear conflicts; renumbered from Session 2)
- **Branch / PR / head sha:** `sb-isolation-decision` · https://github.com/arbiter1170/sandbench/pull/16 · docs-only commit on top of `d6b4b27`
- **Checks on the head:** pending at the time of writing.
- **What was done:**
  - Recorded the agent-isolation decision Vincent picked: a `sandbox` compose service with one Linux user per agent, no keys, no secrets file, no route to Postgres; model calls through `/api/model`. It replaces SB-04's planned `jobs` service.
  - `docs/runner.md`: new section "Agent isolation (decided, SB-29)"; the "not a sandbox" bullet points to it.
  - `docs/parity/PLAN.md`: new item SB-29 (unticked) with acceptance; SB-04 depends on it; SB-10's acting tools wait for it; one Progress log line.
  - `docs/parity/NEXT_PHASE_BRIEF.md`: open question 4 answered, new open question 8 (answered), SB-29 in the scope, dependency and track tables (Track 3), gate lines in SB-04 and SB-10. The brief's Rules section is untouched.
  - This entry and `STATUS.md`.
- **Tests run (real results):** none needed (docs only). Secret scan runs in CI.
- **Not run / could not run:** gitleaks locally (not installed here).
- **Decisions made and why:** a shared sandbox service with a uid per agent over a container per agent (lighter on the laptop, no Docker socket for the runner) and over uids inside the runner container (that would leave agents on the Postgres network and next to the secrets volume).
- **Deviations from the plan:** none; docs only.
- **Open questions for Vincent or the Supervisor:** none new. Docker Desktop on Windows still needs a WSL distribution (`wsl --install -d Ubuntu`, then restart Docker Desktop).
- **Next step:** Vincent reviews and merges this docs PR; SB-29 is built in Track 3 alongside SB-06 core.

### Session 4 · 2026-10-27 08:25 ET · T04 SB-03 PR 1 · done
- **Branch / PR / head sha:** `sb-03a-contracts` · https://github.com/arbiter1170/sandbench/pull/18 · code head `3f4715f` (final head after the log commit is in the session summary)
- **Checks on the head:** on `3f4715f`, all 4 required checks pass. "Typecheck, test, build" (1m39s) includes the datastore, memory and jobs-schema runs, none skipped. "Runner image and compose file" took 1m39s.
- **What was done:**
  - Merged #17 (T03) at Vincent's request (`8735ee8`).
  - `runner/contracts/` (`index`, `job`, `turn`, `approval`, `tool`, `policy`, plus a shared `shape.mjs`):
    - Plain JS validators that name the bad field and refuse unknown fields, so a turn request can't carry `owner` or `extras`.
    - Valid fixtures in `runner/contracts/fixtures/`.
    - The approval and policy contracts enforce that a red item needs Vincent.
    - The policy result has the handoff's `blocked` flag.
    - A tool descriptor whose `inputSchema` declares `agentId`, `agent_id`, `owner` (and similar) is refused.
  - `runner/policy/default.mjs`: `yellow` / `card` / not blocked, for everything.
  - `003_jobs.sql`:
    - `jobs` has every contract column plus `attempt`, `singleton_key`, `session_id`, `queue_job_id` and `updated_at`.
    - `parent_job_id` references `jobs(id)` on delete set null.
    - `job_events` and `approvals` cascade on delete of their job.
    - The checks cover the enums, `timeout_s > 0` and `seq > 0`, and red rows need Vincent.
    - Indexes as specified. No `alter` of existing tables, and no pg-boss tables.
  - `runner/api/routes/index.mjs`: `loadRouteFactories` (sorted, skips `index.mjs`; refuses duplicate names, overlapping prefixes and any prefix that touches a built-in path). `prefixMatches` is exported. The folder ships with no route modules.
  - `server.mjs` gets the `routes` option and tries registry routes first, falling through on `false`. `main.mjs` loads them.
  - `runner/tools/discover.mjs` (`discoverTools`, sorted; duplicates and invalid descriptors throw and name the files).
  - `harness/drivers/claude.mjs`: pure, exported `buildClaudeArgs` and `buildClaudeSettings`; `converse()` uses them with `turn.extras`. `harness/turns.mjs` sets `extras: {}`.
  - `.gitignore`: `secrets.json*`.
  - CI: the jobs-schema run inside the existing datastore step.
  - `data.test.mjs` list now includes `003_jobs.sql`.
  - `docs/runner.md` "Extending the runner"; a `PLAN.md` log line.
  - Ticked T01-T03 as merged in WORKPLAN.
- **Tests run (real results):**
  - `node --test runner/test/contracts.test.mjs runner/test/routes.test.mjs runner/test/tools-discovery.test.mjs harness/test/drivers.test.mjs harness/test/turns.test.mjs` → all pass: 6 contract, 4 route, 4 discovery, 9 driver (4 new) and 1 turns test.
  - With PGlite: `jobs-schema.test.mjs` 6/6 and `memory.test.mjs` 9/9, each file run alone, because PGlite serves one connection at a time. CI ran them on stock Postgres 17 with `skipped 0`.
  - Existing suites run locally: all pass except two that also fail on the unchanged base on Windows: `exec needs approval and runs in bash` (no `/bin/bash`) and `a secrets file that can't be read is never overwritten` (Windows file permissions). Both pass in CI.
  - Mutation check, all 10 caught: default policy never allows; tool `inputSchema` can't declare `agentId`; unknown fields refused; red needs vincent; built-in paths reserved; overlapping prefixes; duplicate tool names; extras can't widen permissions; `maxTurns` range; `mcpConfig` safe characters.
- **Not run / could not run:** the image build and gitleaks (Docker doesn't work here; CI ran them); local typecheck (no `src/` change; CI passed).
- **Decisions made and why:**
  - **Registry: new routes only.** The data and memory routes were not converted, so every existing route test passes unchanged.
  - **`createRunner` builds the route modules itself.** It takes the factories that `main.mjs` loads and calls `create(deps)`, because the secret store and skills reader those deps include are created inside `createRunner`. `createRunner` stays synchronous.
  - `extras.resume` starts the first round only; later rounds resume the live session.
- **Deviations from the plan:**
  - `runner/contracts/shape.mjs`, the shared validator, isn't on the Touch list. It's needed so the contract files don't import from `index.mjs`, which would be a cycle.
  - JSON schemas (marked optional) were skipped; the validators are the contract.
  - `runner/test/memory.test.mjs` now checks only that 001 and 002 apply first, instead of the full list (`data.test.mjs` pins the full list). That's a migration-list edit, allowed by the T04 stop rule, and it means future migrations don't touch that file.
- **Open questions for Vincent or the Supervisor:** none new.
- **Next step:** Vincent merges #18. T10 (the turn engine) then becomes possible; until then the independent tasks are T05, T07, T08 and T09. T06 (team pack importer) is unblocked but its live part needs Q7.

### Session 3 · 2026-10-26 22:55 ET · T03 SB-13 · done
- **Branch / PR / head sha:** `sb-13-browser-emulator` · https://github.com/arbiter1170/sandbench/pull/17 · code head `060b5d0` (final head after the log commit is in the session summary)
- **Checks on the head:** on `060b5d0`, all 4 required checks pass: Typecheck, test, build (1m38s); Secret scan; Runner sign-in checks (Auth emulator); Runner image and compose file (1m36s).
- **What was done:**
  - Merged #14 at Vincent's request (`264cf6d`). Brought #15 up to date with `deploy/vercel`, keeping both WORKLOG entries, newest first.
  - `runner/Dockerfile`: runtime on `mcr.microsoft.com/playwright:v1.64.1-noble`. That image ships Node 24, so NodeSource's `node_22.x` repo replaces the base's and `nodejs` is reinstalled. The build fails unless `node -v` is 22.
  - Also in the image: Java 21 (`openjdk-21-jre-headless`), `gh` from GitHub's apt repo, Python 3, tini and `firebase-tools@14.27.0`. It still runs as non-root (`pwuser`). `npm ci` uses `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. `playwright@1.64.1` (exact) is in `runner/package.json`.
  - `runner/browser/ssrf.mjs`:
    - `assertSafeUrl` allows only http(s), no credentials, and requires every resolved address to be public.
    - The ranges are separate IPv4 and IPv6 `BlockList`s, because one list with `::ffff:0:0/96` refuses every IPv4 address.
    - Also refused: `localhost` and `metadata.google.internal`, and odd numeric spellings.
    - `startSafeProxy` is a local proxy, used as Chromium's only way out. It checks every request and redirect hop and connects to the exact address it checked.
  - `runner/browser/screenshot.mjs`: 320/375/390 PNGs at scale 1, run through that proxy with loopback included (`<-loopback>`). `runner/browser/images.mjs`: the `saveImage({outDir, name, buffer}) → {path, bytes}` interface, for SB-18 to plug into.
  - `runner/browser/emulator.mjs`: `demo-*` only, refuses guarded ids (including `SANDBENCH_BLOCKED_PROJECTS`), always passes `--project`, and uses a temporary 0600 config that is removed on stop.
  - CI, inside existing jobs only: `npx playwright install --with-deps chromium` before `npm run test:node`, and `docker image ls` plus `node -v` after the image build.
  - `docs/runner.md` "Browser and emulator"; a `PLAN.md` log line (box not ticked).
- **Tests run (real results):**
  - Locally (Windows, Chromium from `npx playwright install chromium`): `node --test runner/test/ssrf.test.mjs runner/test/screenshot.test.mjs runner/test/emulator-wrapper.test.mjs` → 13 pass, 0 fail, 0 skipped.
  - CI on `060b5d0`: all 4 checks green. Image `sandbench-runner:ci` is **3.24GB**, Node in the image is **v22.23.4**, and the image job took 1m36s.
  - Mutation check: the required two are caught (traffic through the checking proxy, and the `demo-` check). Also caught: guarded id, link-local and metadata range, IPv4-mapped IPv6, every resolved address checked, credentials, http(s) only, loopback only when listed.
  - Setting `bypass` to `""` was not caught, because Playwright adds `<-loopback>` on its own. Setting `bypass` to `localhost,127.0.0.1,<local>` is caught (the redirect test fails).
- **Not run / could not run:** the local image build (Docker doesn't work on this machine; CI built it). Local typecheck (this worktree has no root `node_modules`; no `src/` change, CI passed). Only one image variant was built, so there is no size for the multi-stage alternative.
- **Decisions made and why:**
  - **The SSRF check is a proxy, not just `page.route`.** First try: check each request in `page.route`. Chromium followed a redirect without asking the route, and the test timed out reaching `169.254.169.254`. Second try: `route.fetch` with redirects off, checking `Location`. That still let a two-hop chain through: a safe first hop, then a 302 to a refused host, which was actually requested. The proxy closes both, and DNS rebinding too. That was the second and last attempt on that test (STOP point 8 not reached).
  - **Node 22 from NodeSource on the Playwright base**, the spec's first option. The multi-stage alternative was not tried, so its size is unknown.
- **Deviations from the plan:**
  - `startSafeProxy` lives in `ssrf.mjs`, because T03's Touch list has no proxy file.
  - The CI image step also prints the image size and Node version. That edit is inside the existing job, and the spec asks for the size.
  - Two failed image builds would have been a STOP; the first failed on Node 24 and the second passed.
- **Open questions for Vincent or the Supervisor:**
  1. The image is 3.24GB, since the base ships Chromium, Firefox and WebKit. A node:22-bookworm-slim build with only Chromium (`playwright install --with-deps chromium`) would likely be much smaller, but it moves off the planned base. Recommend trying it as a follow-up if laptop disk or build time matters.
  2. On the first run, the test job took 10m03s, against its 15-minute limit, because of `playwright install --with-deps chromium`. The rerun took 1m38s. Watch it; caching the browser is a possible follow-up.
- **Next step:** Vincent merges #17 when he's happy with the image size. T04 (SB-03 contracts) is unblocked, since #14 is merged. Other independent tasks: T05, T07, T08, T09.

### Session 2 · 2026-10-26 22:25 ET · T02 SB-08 · done
- **Branch / PR / head sha:** `sb-08-profile-memory` · https://github.com/arbiter1170/sandbench/pull/14 · code head `74b11ca` (final head after the log commit is in the session summary)
- **Checks on the head:** pending at the time of writing.
- **What was done:**
  - #14 was opened in Session 1 to the brief, before #12 landed, and has been a draft since. #13 (T01) merged as `d6b4b27`. This session merged `deploy/vercel` into #14 (taking base's `server.mjs` and `PLAN.md` for the SB-09 conflicts) and reworked it to the T02 spec with new commits.
  - `002_memory.sql`: `memory_items`, 8000-character items, `source_hash` with a unique `(owner, agent_id, source_hash)` index, plus the by-agent index and the GIN index.
  - `runner/agent/memory.mjs`: `createMemory` returns `save`, `search` (`websearch_to_tsquery` with rank, limit 1-50), `recent` and `profile`. Every query filters on owner and agent.
  - `runner/agent/skills.mjs`: `createSkills({dir})` returns `index` and `loadSkill`. Files are read on every call. Names follow `^[a-z0-9][a-z0-9-]{0,60}$`. A skill must be a real folder (checked with `lstat`) whose real path stays inside `.claude/skills`. With no folder it returns `[]` or `null`.
  - `runner/agent/prompt.mjs`: an async `buildSystemPrompt`. Order: profile, AGENTS.md, skills, profile memory, 10 newest journal items. Each section is cut at a word with a marker, the total is at most 40,000 characters, and the output is deterministic.
  - `runner/agent/memory-import.mjs` and `memory-backup.mjs`, both with CLIs.
  - `runner/api/memory.mjs`: `/api/memory` (GET and POST), `/api/skills`, `/api/skills/:name` and `/api/prompt/:agentId`. `server.mjs` mounts them next to the data routes and answers 503 for memory and prompt without a database.
  - `main.mjs`; camelCase `Bot` fields in `src/types.ts`.
  - The compose read-only mount `${SANDBENCH_TEAM_HOST_DIR:-./team-empty}:/srv/team:ro`, `deploy/team-empty/.gitkeep`, and a commented line in `.env.example`.
  - CI: two lines added inside the existing "datastore tests ran" step.
  - `data.test.mjs` migration list, `docs/runner.md`, and a `PLAN.md` log line. The box is not ticked.
  - Removed from the earlier version: `scripts/memory-*.mjs`, the Dockerfile change, `runner/api/agent.mjs`, and the separate CI step.
- **Tests run (real results):**
  - With `TEST_DATABASE_URL` pointing at PGlite (Postgres 17 in WASM, run from a scratch folder; Docker is not working on this machine): `node --test runner/test/memory.test.mjs runner/test/skills.test.mjs runner/test/prompt.test.mjs` → 18 pass, 0 fail, 0 skipped. `memory.test.mjs` ran 9 tests.
  - `npm run typecheck` → clean. `npm run test:web` → 35 passed.
  - Mutation check, all 13 caught: owner filter in search; agent filter in search; owner filter in profile; import dedupe; size limit; skill realpath containment; linked skill folder (lstat); re-read on every call; skill name rule; 40,000 cap; profile facts in prompt; owner from sign-in; 503 without a database.
  - CLI smoke test on PGlite:
    - The import refused with no agent record.
    - It then inserted 3 items; a second run inserted 0.
    - The backup wrote `qa/profile.md` (2 items) and `qa/journal.md` (1 item).
- **Not run / could not run:**
  - Stock Postgres 17, gitleaks, `docker compose config` and `docker build`. Docker Desktop doesn't start here (WSL has no distribution); CI runs them.
  - `data.test.mjs` on PGlite (it uses LISTEN/NOTIFY); CI runs it.
- **Decisions made and why:**
  - `buildSystemPrompt` takes `owner` as well as the agent record, because memory is owner-scoped and the record doesn't carry its owner.
  - Section budgets: description 8,000, AGENTS.md 12,000, skills 4,000, profile 10,000, journal 5,000, which adds up to under 40,000.
  - The import CLI picks the owner only when exactly one account has that agent; otherwise it asks for `--owner`.
- **Deviations from the plan:**
  - The importer also reads `memory/*.md` as profile items. The harness keeps topic memory there, and skipping it would lose memory.
  - `createRunner` builds skills from its `teamDir` option instead of taking a skills object.
  - Both CLIs live under `runner/agent/`, as the spec says. The brief's `scripts/memory-backup.mjs` is replaced, also as the spec says.
  - The rest stays inside T02's Touch list.
- **Open questions for Vincent or the Supervisor:** none new. Docker on Windows and the isolation decision (#16) are tracked in STATUS.
- **Next step:**
  - Vincent merges #14 when its 4 checks are green. It also needs the compose and image checks, because `deploy/compose.yml` changed; CI runs those.
  - #15 (iPhone sign-in) and #16 (isolation docs) are also waiting. Whichever of #14, #15 and #16 merges later gets a WORKLOG conflict that the next session resolves, keeping both entries with the newest first.
  - Next tasks: T03 (SB-13, independent), and T04 once #14 is merged.

### Session 1 (cont.) · 2026-10-26 22:08 ET · out-of-plan fix: iOS Google sign-in loop · done
- **Branch / PR / head sha:** `fix-ios-google-signin` · PR in the session summary · cut from `d6b4b27` (#13 merged)
- **Checks on the head:** pending at the time of writing
- **What was done:**
  - Vincent reported in chat that on iPhone, at the Vercel site, "Continue with Google" returns to the sign-in page every time.
  - Cause: `signInWithRedirect` returns through the Firebase auth domain, a different site from the page. iOS Safari's tracking prevention blocks that storage, so `getRedirectResult` finds nothing. The page also swallowed the error.
  - Fix: `src/googleSignIn.ts` signs in with a popup first and uses the redirect only if a popup can't open. `src/AuthGate.tsx` uses it and shows sign-in and redirect errors. `docs/deploy-vercel.md`'s sign-in check is updated.
- **Tests run (real results):**
  - `npm run typecheck` → clean
  - `npm run test:web` → 4 files, 39 tests passed, 4 of them new in `src/googleSignIn.test.ts`
  - `npm run build` → ok
- **Not run / could not run:** a real iPhone sign-in. Only Vincent can do that, on the Vercel preview of this PR.
- **Decisions made and why:**
  - A popup, rather than proxying `/__/auth` through Vercel with `authDomain` set to the Vercel host. The proxy needs the project id in `vercel.json` (not allowed in the repo) plus a Google OAuth redirect URI change in the console.
- **Deviations from the plan:**
  - Not a WORKPLAN task, and auth is STOP point 1. Vincent asked for it directly in chat. Only the page's sign-in button changed: no allowlist, token, rules or Firebase config change.
- **Open questions for Vincent or the Supervisor:**
  1. Try the PR's Vercel preview on the iPhone, in Safari and from the home-screen app. If the popup also fails in the home-screen app, the next step is the `/__/auth` proxy, which needs your console change.
- **Next step:** Vincent merges this after the iPhone check. T02 (rework #14 to the spec) is now unblocked, since #13 is merged.

### Session 1 · 2026-10-26 22:05 ET · T01 SB-09 · done
- **Branch / PR / head sha:** `sb-09-workspaces` · https://github.com/arbiter1170/sandbench/pull/13 · code head `4c6958d` (final head after the log commit is in the session summary). PR #12's merge commit on `deploy/vercel`: `4b69bd53bf7ee7df9403a627f4d7d358374e685a`.
- **Checks on the head:** pending at the time of writing (the first version of this PR had all 4 required checks green on `7fa061c`).
- **What was done:**
  - The session started from `CURSOR_AGENT_BRIEF.md`, before PR #12 merged. PR #13 was first built to the brief, with all 4 required checks green on `7fa061c`. Then #12 merged, so this session reworked #13 to the T01 spec with new commits (merge of `deploy/vercel`, no rebase, no force-push).
  - `runner/workspace/paths.mjs`:
    - `workspaceRoots(home)` returns `{legacy, shared, agents, wt}`.
    - Also exports `AGENT_SLUG` and `WorkspaceError` (`invalid | outside | forbidden`).
    - `resolveWorkspacePath(roots, agentSlug, path, {write})` throws on a refused path.
    - Owner context (`null`) is `workspace/` as before, plus link and null-byte checks.
    - Agents read `shared/`, write only under `shared/handoff/`, use their own folder, and use only their own `wt/<slug>/`.
    - `..`, absolute paths, drive letters, backslashes and null bytes are refused. Links are followed with `realpath`, and dangling links are refused.
  - `runner/workspace/worktrees.mjs`:
    - `createWorktrees({roots, repos, exec})` returns `{create, remove, prune}`.
    - `parseRepoAllowlist` parses `SANDBENCH_REPOS`.
    - Every input is checked before the first `git` call.
    - `create` uses `--no-track`. `remove` never uses `--force`.
    - `prune` checks merged plus folder mtime older than 7 days, keeps dirty worktrees, removes with `git branch -d` only, and is a dry run by default.
  - `runner/workspace/index.mjs` re-exports.
  - `runner/api/server.mjs` creates the four roots and resolves through the new rules in the owner context. `turns.start(body, { agentSlug: null })`.
  - `harness/turns.mjs`: `start(body, ctx = {})` passes `ctx` to `resolveFolder`.
  - `docs/runner.md`: a "Workspaces" section.
  - `PLAN.md`: one Progress log line. The box is not ticked.
  - `runner/shell.mjs` and `runner/test/server.test.mjs` are unchanged from base.
- **Tests run (real results):**
  - `node --test runner/test/workspace.test.mjs runner/test/worktrees.test.mjs harness/test/turns.test.mjs` → 16 pass, 0 fail, 0 skipped.
  - `node --test runner/test/server.test.mjs` → 13 pass. 1 fails only locally: `exec needs approval and runs in bash`, because Windows has no `/bin/bash`. It passed in CI on the first version.
  - Mutation check: all 12 caught. Required: symlink check, `..` check, slug owner check on `wt/`, unmerged-prune check. Extra: dangling link, null byte and backslash, shared write outside handoff, `--no-track`, branch check before git, dirty kept, dry-run default, young kept.
- **Not run / could not run:**
  - Docker Desktop does not start on this Windows machine (WSL has no distribution installed). Not run locally: Postgres, gitleaks, compose and image checks, and the bash exec test. CI runs them.
  - The local Node is 24, not 22. Test files were listed explicitly.
- **Decisions made and why:**
  - Worktrees live in `wt/<slug>/<repo>/<branch>`, not `wt/<slug>-<branch>`. With a `<slug>-` prefix check, agent `qa` would match `qa-lead-x` and could reach `qa-lead`'s worktree. Vincent chose this layout in chat on 2026-10-26.
  - `remove` takes `{agentSlug, repo, branch}` instead of `{agentSlug, name}`, which follows from the layout.
  - A dangling symlink is refused, which is stricter than "realpath of the deepest existing ancestor".
  - `create` fetches `origin` before branching off an `origin/...` base, so a worktree doesn't start from a stale base.
- **Deviations from the plan:**
  - `prune` defaults to `dryRun: true`, not `false`. STOP_POINTS §2 says deleting code ships dry-run by default, and STOP_POINTS wins over WORKPLAN.
  - Worktree layout as above, with Vincent's approval.
  - No files outside T01's Touch list (diff against `deploy/vercel`: `docs/parity/PLAN.md`, `docs/runner.md`, `harness/turns.mjs`, `runner/api/server.mjs`, `runner/workspace/*`, two new test files, plus this log and STATUS).
- **Open questions for Vincent or the Supervisor:**
  1. Real isolation between agents. These rules limit the runner's routes, not what a bash command can open. Recommend deciding before SB-10 gives agents `exec`: a separate OS user or container per agent.
  2. PR #14 (SB-08) was opened in this session before #12 landed. It is now a **draft** until #13 merges. It will then be reworked to the T02 spec in a later session, with new commits and no force-push.
- **Next step:** Vincent merges #13 when its 4 checks are green. Then T02 reworks #14 to the spec. Independent tasks T03, T05, T07, T08 and T09 can go meanwhile.

### Session 0 · 2026-10-26 21:40 ET · Handoff pack written · done
- **Branch / PR / head sha:** `sb-next-phase-brief` · PR #12 (next-phase brief + this handoff pack) · merged by Grok Bot executor on Vincent's approval; its merge commit is on `deploy/vercel` (find it with `gh pr view 12 --json mergeCommit -q .mergeCommit.oid`). **Session 1 must record that sha in its entry.**
- **Checks on the head:** all 4 required checks were green on the head that was merged.
- **What was done (by the Supervisor/Grok Bot executor, before leaving until Thu Oct 29):**
  - PRs merged into `deploy/vercel`, each verified with typecheck, vitest, node tests, DB tests on Postgres and the 4 required checks before merging:
    - #5 → `878e56cb9ead176e41e3685492deb42b0040d4a0`
    - #6 → `caeb5c71bf1bc78873f6f2ef2e0158466945f697`
    - #7 → `6c30e4b0bd8ec575141116c52e5d438af95a9537`
    - #8 → `02515f29706c49de0e09ec75ff0b0dd56b4c8859`
    - #9 → `84a3c1725e01d0ca730051956a97ebefeb08c91c`
    - #11 → `31d3ec339c7cab3dc92a1c23828903e8a13af98f`
  - PR #12 added `docs/parity/NEXT_PHASE_BRIEF.md` (what comes after SB-09, SB-08, SB-13: SB-03, SB-04, SB-10, SB-06 core, SB-11 core, SB-12, SB-15a; four tracks, at most 3 agents, 7 open questions with PROVISIONAL defaults because Vincent skipped the card) and this `docs/parity/handoff/` pack. Edited `CLAUDE.md` (pointer to the pack) and fixed the stale "PR #9 may not be merged" text in `CURSOR_AGENT_BRIEF.md`.
  - PR #10 ("Parity gap audit", docs only) is still **open**. It is not part of this work. Do not touch it.
- **Tests run (real results):** not applicable to this docs-only entry; PR #12 had all 4 required checks and Vercel green on its head before merge.
- **Decisions made and why:**
  - The handoff docs override the briefs and PLAN.md where they disagree (the briefs were written for chat-driven agents; Claude works alone).
  - Open questions Q1-Q7 of `NEXT_PHASE_BRIEF.md` use their provisional defaults. Claude may scaffold behind interfaces but must not do anything that needs Vincent (create a GitHub App, add or use an API key, spend money).
- **Deviations from the plan:** none.
- **Known follow-ups (all are tasks in `WORKPLAN.md` unless marked):**
  1. SB-09 → SB-08 → SB-13 from `CURSOR_AGENT_BRIEF.md` (T01-T03).
  2. SB-03 PR 1 contracts, migration `003_jobs.sql`, route registry, driver `extras` hook, tools auto-discovery (T04).
  3. `PLAN.md` still says Hetzner / Cloudflare in Q1, Q9, SB-01 and the diagram; the truth is the laptop runner via Tailscale Funnel (T05).
  4. Deleting a bot swallows a failed runner-side delete: `src/App.tsx` (the `removeWhere("computer", ...)` line) has `.catch(() => undefined)` (T07).
  5. No retention or pruning for `logs` and `computer` rows (T09, dry run only).
  6. `PLAN.md` SB-05 names `runner/secrets.mjs`; the real file is `harness/secrets.mjs`.
  7. `runner/test/data.test.mjs` hard-asserts the migration list (`["001_init.sql"]` today), so every migration PR must update it.
  8. CI's "datastore tests ran (not skipped)" step greps only `data.test.mjs`; new DB test files must be added to that step.
  9. The Dockerfile copies only `harness`, `runner` and `dist` into the image: code that must run in the container goes under `runner/` or `harness/`.
  10. Live acceptance checks of merged items are Vincent's (laptop runner); plan boxes stay unticked until he confirms (see `WORKPLAN.md` "Live checks pending").
- **Open questions for Vincent or the Supervisor:** the 7 in `NEXT_PHASE_BRIEF.md` (API key; which builders; GitHub App; a `jobs` compose service; laptop caps; no `pr_merge` now; team pack location). None blocks T01-T09.
- **Next step:** Session 1 starts at T01 (SB-09). Vincent merges PRs as they come (`MERGE_GUIDE.md`).
