# Sandbench UX: clear setup, honest turn status, readable approvals, and a usable phone layout

**Date:** 2026-11-05
**Status:** Proposed design, waiting for Vincent's written-spec review. Nothing here is implemented. Implementation is not authorized by this document.
**Repo:** `arbiter1170/sandbench`. Target branch `deploy/vercel`.
**Source snapshot:** `deploy/vercel` at `7068fc3e6bfe2bbebf05b1ba5c61fdf5c87e0c6e`, re-fetched 2026-11-05. Open, unmerged PRs read for this spec: #20 `3e1f7af`, #21 `68ff1de`, #22 `f61431f`, #23 `c491641`, #24 `b934154`, #25 `f04749d`. Nothing below assumes any of them is merged.
**Handoff brief:** [2026-11-05-sandbench-ux-handoff.md](2026-11-05-sandbench-ux-handoff.md). It has the copy-paste prompts.
**Boards:** [`assets/2026-11-05-sandbench-ux/`](assets/2026-11-05-sandbench-ux/). The boards are static proposals with synthetic data. If a board and this text disagree, this text wins (see [Board notes](#board-notes)).

---

## 1. Outcome

Someone using Sandbench on a phone or laptop should be able to answer these questions without opening Settings or reading a trace:

1. **Who answers in this chat**, on which computer, in which folder, and is it connected? (P1, P5)
2. **What is the turn doing right now**, and does it need me? (P2)
3. **If it stopped, did it finish, fail, get interrupted, or never start?** If it never started, what can I do, without anything being chosen for me? (P2)
4. **What exactly am I approving**, where does it go, what changes, and how far does "approve" reach? (P3)
5. **Can I do all of this at 360–460 px with a phone keyboard open?** (P4)

### Non-goals

- No change to approval rules, permission modes, auto-review matching or grants. PR #23 owns those. The cards only display what the approval contract reports.
- No change to the Capability map table. PR #24 owns it.
- No turn recovery, reattach, resume or retry logic. PR #25 owns local recovery and PR #22 owns runner jobs. This design only labels the states they produce.
- No local MCP for driver turns, no memory saving, no Docker/WSL, no runner credentials (Q1), no engine tools (SB-29). These belong to queued work by other owners.
- No file attachments. Only images exist today (`accept="image/*"`) and audio is dictation. Non-image files are SB-18 and are not designed here.
- No new tab, dashboard, colour scheme or visual identity. The existing dark style, tokens and layout stay.
- No metrics, timings or effort estimates.

---

## 2. Decisions locked in

| Decision | Choice | Source |
| --- | --- | --- |
| Approach | **A: clarity in place.** Add a context line, a turn status line, labelled approval fields and an effective-setup summary to the existing screens. No new tab or wizard. | Vincent approved the review direction. |
| Chosen agent can't start | **No silent fallback.** Show "Couldn't start" with the reason, a read-only **Check connection**, and a one-time explicit **Answer with the built-in planner this time**. | Owner decision, 2026-11-05 2:53 PM ET. |
| Planner choice scope | Starts **at most one** new planner turn. It doesn't change bot or default settings, doesn't carry approvals from the earlier turn, doesn't widen approvals, and never routes to another model or service. | Same decision. |
| Uncertain execution | If the agent may already have run tools, there is **never** an automatic fallback, retry or replay. | Same decision. |
| "Not run" wording | Used **only** when an authoritative, correlated execution or approval record proves the step was not dispatched, including that no earlier rule or grant could cover it. Otherwise: **"Execution status unknown"**, partial output kept, nothing replayed. | Vincent's correction, turn 2. |
| Deny vs other endings | "Denied by you", "Expired", "Stopped", "Connection lost" and "Denied automatically (unattended)" stay distinct, in wording and in data. | Vincent's correction, turn 2. |
| Grant wording | Any "only this one…" promise must match the grant the code actually installs. Board copy marked ILLUSTRATIVE is a placeholder until it is bound to the real contract. | Vincent's correction, turn 2. |
| F4-S (WebFetch/WebSearch tool-wide grant) | Stays a safety dependency for the approval owner. Better wording does not fix it. | Vincent's correction, turn 2. |
| Capability rows | Come from runtime evidence for the current mode. "Queued" or "planned" never reads as ready. | Coordination note. |
| Enter key | Phone: Enter inserts a newline and the Send button sends. Desktop: Enter sends and Shift+Enter inserts a newline. Never send while an IME composition is active. | Review, F11. |

### Approaches considered

- **A. Clarity in place (chosen).** Smallest surface. Every change sits on a screen people already use. It can ship as five separately reviewable slices, and it doesn't compete with the Tools tab work in #24.
- **B. A new "Status" or "Setup" tab.** Rejected because it adds navigation on a phone that already has a three-button dock, and splits information people need while reading the chat.
- **C. Guided setup wizard.** Rejected for now because most of the confusion is mid-chat (what is running, what am I approving), not first-run, and a wizard would need settings writes this design avoids.

---

## 3. Run modes and what the page can actually know

| Mode | How it's enabled | What answers | Evidence the page has today |
| --- | --- | --- | --- |
| **B: browser only** | No harness reachable, no `VITE_RUNNER_URL` | Built-in planner with local stand-ins; no agent drivers | Harness health fails (polled every 8 s, `App.tsx` ~480–493). |
| **L: local harness** (Vincent's mode) | `npm run harness` on the PC | Chosen driver (for example Claude Code CLI on the user's subscription), else built-in planner | `/health` returns `{ok, platform, host, workspace}`; `/drivers` returns `{id, label, ok, detail}` per driver (`available()`). |
| **R: runner** | `VITE_RUNNER_URL` at build time (`runnerMode` in `src/harness.ts`) | Runner jobs (#22, not merged; engine tools gated off until SB-29) | Runner health only. Job states come from #22's `/api/jobs` once merged. |

Two facts limit how strongly the page may speak:

- `/drivers` `ok:true` is not proof a turn will start. #24 records that the API drivers report available before a key is stored, and the CLI drivers only check that the binary answers.
- The capability map in #24 is hand-written and static ("Needs" column). It describes requirements, not current state. P1 and P5 must not present it as live evidence.

---

## 4. Invariants

Every packet must keep these. Each one has a test in §10.

- **I-1. One turn in flight per chat.** A chat never has two running turns, whether agent or planner. Today the page enforces this per tab with `sendingRef` (`App.tsx` ~1958, ~1968); a send during a turn returns early and keeps the draft. P2 adds visible feedback for that early return, but doesn't change the guard.
- **I-2. No silent substitution.** If the chosen agent can't start, the page never answers with another agent, the planner, a different model or a different service unless the user taps the one-time planner choice. This replaces today's behaviour at `App.tsx` ~2076–2078, where the planner answers with only a trace line.
- **I-3. Planner choice is single-use and idempotent.** It is keyed to the "Couldn't start" message id. Once used, the message stores the id of the planner reply and the button is replaced by "Planner answer chosen at <time> ↓". A second tap, a reload, or a stale render can't start another turn for the same message. Across two tabs on the same workspace, storage is last-writer-wins (noted in #25), so cross-tab uniqueness is **not guaranteed** today; see U-4.
- **I-4. Couldn't start means no turn was created.** The state is shown only when the page can prove no turn exists:
  - (a) it didn't call `POST /turns` because the harness is unreachable or the chosen driver is listed `ok:false`/missing; or
  - (b) `POST /turns` returned an error response. The harness throws before it creates a turn id: unknown driver, no prompt, or folder outside the workspace (`harness/turns.mjs` `start`).

  A network failure *during* `POST /turns` is not proof. The harness may have created the turn. Show **"Start status unknown"** with no planner choice.
- **I-5. Once started, never auto-fallback, retry or replay.** If a turn id was returned, or any `turn_start`, `thinking`, `permission_request`, `tool_start` or `tool_end` event was seen, the turn counts as started. A failure after that is "Failed after starting" or "Interrupted · execution status unknown". There is no planner choice, no automatic retry, no replay of approvals or commands, and no resubmission. "Ask again…" only refills the composer for the user to edit and send.
- **I-6. No approval widening.** A new turn, including a one-time planner turn, starts with no approvals from any earlier turn. It uses the bot's normal rules and mode, never wider. The page doesn't add allow rules to reduce friction. There is no "always allow" or "allow all" control.
- **I-7. "Not run" needs proof.** See §2. Lost streams, expiry, Stop and reloads are not proof.
- **I-8. Endings stay distinct.** Denied by you, Expired, Stopped, Connection lost, Denied automatically (unattended), Approved with a recorded result, Approved without a separate result, and Approved but failed are separate display states. Where the data can't tell them apart (see D-5), the card says what is known ("No decision recorded") rather than guessing.
- **I-9. Labels follow evidence.** A row or badge says "Connected", "Not reachable", "Unknown", "Not available here" or "Planned" from current-mode evidence. Last-known-good values are never shown as current (show the age: "Checked 5 s ago").

---

## 5. Current code signals vs new signals needed

| Need | Enough today? | Signal | Owner if new |
| --- | --- | --- | --- |
| Harness reachable | Yes | `/health` poll, 8 s | — |
| Driver installed/ready | Partly | `/drivers` `ok` + `detail`; not proof of start (§3) | — |
| Effective agent for a bot | Yes (derivable) | `bot.driver` → `settings.defaultAgentDriver` → route rules (`resolveAgentDriver`) | — |
| Effective working folder | Yes for planner; yes for driver turns after #21 | `roomFolder` (channels set `workingFolder`; bot chats use workspace root); #21 adds `cwd` on `turn_start` | PR #21 |
| Couldn't start vs started | Yes, page-local | Whether `POST /turns` was called and returned an id (I-4) | — |
| Turn finished / stopped / error | Partly | `done`, `done{stopped:true}` (the page ignores `stopped` today), `error` | — |
| Stream lost vs harness gone | Not at base; yes with #25 | `GET /turns/<id>` → `running`/`finished`/`unknown`; `TurnLostError`; `Message.interrupted` | PR #25 |
| Why an approval ended without approval | **No** | `permission_resolved {allow:false}` is published identically for user deny, 30-min expiry and Stop (`harness/turns.mjs` ~84–98). Only the clicking tab knows its own Deny/Stop. | **D-5**, approval-safety owner |
| Proof a step was not dispatched | **No** | Absence of `tool_start` isn't proof (lost streams, CLI-run tools). No event asserts "not dispatched". | **D-6**, approval-safety/recovery owner |
| Step result for Claude tools | Partly | Real `tool_end` with `code` when the CLI's `tool_result` matches. Otherwise the harness emits a synthetic `tool_end` *without* `code`: "The agent ran this step itself; its result is in the reply." That text is not proof it ran. | — (display honestly) |
| What an approval grants | Partly | Claude Bash: exact `Bash(<command>)` rule for the rest of the turn. Claude file tools: `Tool(<path>)`. **WebFetch/WebSearch: the whole tool for the rest of the turn** (F4-S). Harness `runCommand` drivers: this request only. #23 narrows auto-review but not these grants. | **D-7** (F4-S), approval-safety owner |
| WebSearch query on the card | **No** | `denialCommand` includes `file_path`/`path`/`url` only, so WebSearch shows its name only | **D-8**, approval-safety owner |
| Turn finish time (duration) | **No** | Not stored | P2 may add a page-side timestamp, or omit duration |
| Skills missing / memory read failed | Derivable | `skillLinesFor`/`memoryDocFor` drop them silently (`App.tsx` ~1270–1294) | P5 surfaces a count only |
| MCP in driver turns | Known: not used | `extras: {}` in `createTurns` | Queued local-MCP owner |
| Runner job state | Not at base | #22 `/api/jobs` | PR #22 |

---

## 6. Packets

Each packet is a separately reviewable slice with its own PR. Order and dependencies are in §7, file ownership in §8.

### P1: Context line and "How this chat runs" sheet

**Boards:** [02 mobile setup sheet](assets/2026-11-05-sandbench-ux/02-mobile-setup-sheet.png), [03 desktop](assets/2026-11-05-sandbench-ux/03-desktop-side-panel.png) (pin 1), [01](assets/2026-11-05-sandbench-ux/01-mobile-turn-states.png) (pin 1).

**Observed (at `7068fc3`):** the chat header shows the bot name only. Whether the harness is up is visible only in Settings or the trace. The working folder is invisible. Group chats don't show which member runs which agent.

**Proposed:**
- A one-line **context line** on its own row under the chat header (≥44 px tall, full width at 390 px): `● <Agent> · <folder> · <Connection>` plus "Details ›".
- Tapping it opens a **read-only sheet** ("How this chat runs") with these rows: Runs on, Agent (+ source badge), Model, Working folder, Tools, Connectors (MCP), Memory, Skills, When this page is closed. The sheet has two buttons: "Open bot settings" (link) and "Check again" (re-reads health and drivers).

**Context-line states (mode L):**

| State | Inputs | Line | Dot | Sheet "Runs on" |
| --- | --- | --- | --- | --- |
| Connected | health ok; effective driver `ok:true` | `Claude Code · workspace root · Connected` | green, plus word | "Local harness on this PC (<platform>) · Connected · Checked N s ago" |
| Agent not installed | health ok; driver `ok:false` | `Codex · not installed · can't start` | red, plus word | "Local harness · Connected"; the Agent row shows `detail` from `/drivers` |
| Harness not reachable | health failing | `Claude Code · Local harness not reachable` | red, plus word | "Unknown: harness offline", with the age of the last good check |
| Checking | first poll not back | `Claude Code · Checking…` | grey | "Checking…" |
| Planner by choice | no driver set anywhere | `Built-in planner · <folder>` | none | "This page" |

Mode B shows `Browser only · local stand-in replies · no agent`. Mode R shows `Runner · <reachable|not reachable>`; runner-only rows say "Runner" and are never shown as ready in mode L.

**Group chats:** `Claude Code (Pip, Moss) · Built-in planner (Fern) · folder walklings-team · Connected`. When this doesn't fit the line, it collapses to `Mixed agents · <folder> · <connection>`.

**Copy for unknown and unavailable rows:**
- Model before any reply: "Chosen by Claude Code · known after a reply".
- After a reply: "last reply: <model from trace>".
- Connectors in a driver chat: "Not used in Claude Code chats" (true while `extras: {}`).
- Memory: "Read at the start of each reply. The bot can't save memory." Shown with the "Read-only" badge; memory saving is queued work, so at most a "Planned" badge, never a toggle.
- When this page is closed: "Replies and routines only run while this page is open" (mode L/B; matches #24's wording).

**Data:** health and drivers polling (exists), `resolveAgentDriver` (exists), `roomFolder` (exists), and the cwd from `turn_start` (#21) for the "folder of the last turn".

**Fixtures:**
- **F-P1-a:** Mode L. North, a bot chat, has no `driver`; `settings.defaultAgentDriver = "claude"`; `/drivers` has claude `ok:true`; workspace `C:\Users\<you>\.sandbench\workspace` (synthetic).
- **F-P1-b:** Same, but health fails.
- **F-P1-c:** Codex chosen, `/drivers` codex `{ok:false, detail:"codex not found"}`.
- **F-P1-d:** Channel `walklings-team` with members Pip (claude), Moss (claude), Fern (no driver, no default).

**Acceptance:**
- **P1-AC1.** The context line renders in every mode with agent, folder (when known) and a connection word. Colour is never the only signal.
- **P1-AC2.** The values match `resolveAgentDriver` and `roomFolder` for the same inputs. A bot chat shows the workspace root and a channel shows its folder.
- **P1-AC3.** The sheet is read-only. It has no inputs, no toggles and no credential fields.
- **P1-AC4.** When health fails, rows that need the harness show "Unknown: harness offline", not the last good values.
- **P1-AC5.** At 360 px the line doesn't truncate the connection word. The agent name truncates first.

**Tests (Given/When/Then):**
- Given F-P1-a, when the chat opens, then the line reads `Claude Code · workspace root · Connected` and the sheet's Agent row has the badge "From Settings default".
- Given F-P1-b, when health fails twice, then the line reads `Local harness not reachable` and the sheet's Model row reads "Unknown: harness offline".
- Given F-P1-d, when the channel opens at 1280 px, then the line lists both agents by member. At 360 px it reads `Mixed agents · walklings-team · Connected`.
- Given any fixture, when the sheet is open, then it contains no `input`, `select` or `textarea`.

### P2: Turn status line, Couldn't start, and the one-time planner answer

**Boards:** [01](assets/2026-11-05-sandbench-ux/01-mobile-turn-states.png), [03](assets/2026-11-05-sandbench-ux/03-desktop-side-panel.png) (pins 2–3), [05](assets/2026-11-05-sandbench-ux/05-couldnt-start-planner-choice.png). Baseline: [00](assets/2026-11-05-sandbench-ux/00-baseline-message-states-390.png).

**Observed (at `7068fc3`):**
- A streaming message shows "Receiving" whatever the turn is doing, including while it waits on a card.
- An `error` message looks like a normal reply.
- `done{stopped:true}` is ignored.
- If the chosen agent is unavailable, the planner answers silently (I-2).
- A send during a turn is ignored with no feedback.
- When `MAX_ROUNDS` (4) runs out in a Claude turn, the turn ends with no message.

**Proposed:** one status line per assistant message, below the text: an icon, a status word and the next action. The message meta replaces "Receiving" with the same status word.

**Turn state table** (inputs are page-local unless marked):

| # | State | Entered when (input) | Status line copy | Actions | Exits to |
| --- | --- | --- | --- | --- | --- |
| S1 | Starting | Send accepted; before `POST /turns` returns | "Starting <Agent>…" | Stop | S2, S9, S10, S11 |
| S2 | Working | Turn id returned or `turn_start` seen | "Working · <last trace step>" | Stop | S3, S4, S5, S6, S7, S8 |
| S3 | Waiting for you | A `permission_request` (not auto) is pending | "Waiting for you · <bot> is paused until you choose." | (card buttons) | S2, S5, S6, S8 |
| S4 | Finished | `done` (not stopped) | "Finished" (+ "· 1 approval: <title> (approved by you)" when present). Add "· N s" only if a finish time is stored. | — | — |
| S5 | Stopped | User pressed Stop and `done{stopped:true}` arrived, or the abort was handled locally | "Stopped by you. Steps above with a recorded result ran; others have unknown status." | Ask again… | — |
| S6 | Failed after starting | `error` event after S2 | "Failed · <short reason>. The agent had started. Steps without a recorded result have unknown status. No retry, no fallback." | Show error details · Ask again… | — |
| S7 | Ended without finishing | Claude driver used all rounds (`MAX_ROUNDS`) with denials still open; needs a driver signal (U-2) | "Ended after <n> approval rounds without a final answer." | Ask again… | — |
| S8 | Interrupted · execution status unknown | #25: `TurnLostError`, or `Message.interrupted` set on load | "Interrupted · execution status unknown. Sandbench lost contact with the local harness at <time>. It can't confirm what ran after that. Partial text is kept." | Check connection · Ask again… | — |
| S9 | Couldn't start | I-4 (a) or (b) | Card: "Couldn't start · <Agent> isn't available". Reason line (below). "Nothing was sent to <Agent> and no tools were requested." | Check connection · Answer with the built-in planner this time | S12 |
| S10 | Start status unknown | Network failure during `POST /turns` | "Couldn't confirm the start. <Agent> may have started this reply. Nothing will be retried automatically." | Check connection · Ask again… | — |
| S11 | Busy (send refused) | Send while `sendingRef` is set | Under the composer: "<bot> is still replying. Your message is kept; send it when this turn ends." | — | (stays in draft) |
| S12 | Planner answer chosen | User tapped the planner choice once (I-3) | On the S9 message: "Planner answer chosen at <time> ↓". New reply labelled "Built-in planner · one time". Its own S2→S4/S6 lifecycle. Final line "You chose this for one reply. Next message uses <Agent> again." | — | — |

Notes on the table:
- "Ask again…" (S5, S6, S8, S10) refills the composer with the original prompt and focuses it. It never sends. The note under it says "Earlier steps may already have run, so check before you send."
- **Check connection** re-reads `/health` and `/drivers` and updates P1. It never sends, retries or resumes.
- **S9 reasons**, from the inputs:
  - "the local harness isn't reachable";
  - "<Agent> isn't installed or signed in on this PC (<detail from /drivers>)";
  - "the harness refused the start: <error text>";
  - "this page is browser-only, so agents can't run here".
- **S9 → S12** is the only path to the planner. The planner turn:
  - is a new turn with a new message;
  - uses the bot's normal rules and mode (I-6);
  - is disabled while any turn in the chat is running (I-1);
  - doesn't change `bot.driver` or `settings.defaultAgentDriver`.
- **S9 in mode R:** shown only when the runner refused to enqueue. A queued job is never "started" or "ready" for UI purposes until #22 reports it running. The planner choice in mode R is **withheld** until #22's contract is merged (W-3).
- **S8 vs S5 vs S6** come from #25's outcomes. This packet only renders them; it doesn't change #25's settling logic.

**Data needed:**
- Page-local: whether `POST /turns` was called and returned an id.
- Events: `done.stopped`, `error`, and `Message.interrupted` (#25).
- New on `Message` (proposed fields, names to be fixed in the implementation PR):
  - `startFailure?: { reason: string }` for S9;
  - `plannerAnswer?: { messageId: string; at: number }` for I-3;
  - `answeredBy?: "planner-once"` on the planner reply.
- Optional: a finish timestamp for duration.

**Fixtures:**
- **F-P2-a:** North (claude), health failing → S9 with reason "local harness isn't reachable".
- **F-P2-b:** Same, after the planner choice → S12 plus a planner reply.
- **F-P2-c:** Claude turn with an `error` event after one approved Bash card with a real `tool_end` → S6.
- **F-P2-d:** #25 lost stream with partial text and a pending driver card → S8.
- **F-P2-e:** `POST /turns` rejects with a network `TypeError` → S10.
- **F-P2-f:** Turn running; user presses Send with a draft → S11.

**Acceptance:**
- **P2-AC1.** "Receiving" no longer appears. Every assistant message in S1–S12 shows the state word from the table.
- **P2-AC2.** With a chosen agent unavailable, sending produces S9 and no planner text. The trace line at `App.tsx` ~2076 is removed or replaced.
- **P2-AC3.** The planner choice appears only in S9. It never appears in S5, S6, S8 or S10.
- **P2-AC4.** Tapping the planner choice twice, or re-rendering after one tap, starts exactly one planner turn. After a reload the S9 message still shows "Planner answer chosen".
- **P2-AC5.** After S12, `bot.driver` and `settings.defaultAgentDriver` are unchanged, and the next send tries the chosen agent first.
- **P2-AC6.** The planner turn has no approvals pre-approved from the earlier turn and uses the bot's rules unchanged.
- **P2-AC7.** Check connection makes only `GET /health` and `GET /drivers` requests.
- **P2-AC8.** "Ask again…" never sends. It fills the composer and focuses it.
- **P2-AC9.** S11 shows the busy note, and the draft is kept.
- **P2-AC10.** Error and interrupted messages are visually distinct from finished ones by icon and word, not colour alone.

**Tests:**
- Given F-P2-a, when the user sends, then no `POST /turns` is made, the message shows "Couldn't start · Claude Code isn't available", and no planner text appears.
- Given F-P2-a, when the user taps "Answer with the built-in planner this time" twice quickly, then exactly one planner turn starts and the S9 message links to it.
- Given F-P2-b, when the page reloads, then the planner button is still replaced by "Planner answer chosen at <time>".
- Given F-P2-b, when the user sends the next message with the harness still down, then a new S9 appears. The planner does not answer.
- Given F-P2-c, then the message shows S6 and has no planner button, and nothing is re-sent.
- Given F-P2-d, then the message shows S8 with partial text and "Check connection" and "Ask again…", and no request other than health/drivers is made.
- Given F-P2-e, then S10 is shown with no planner choice.
- Given F-P2-f, when Send is pressed, then no request is made, the draft is kept, and the busy note is announced politely to screen readers.

### P3: Approval cards that say what, where, what changes, and what approving grants

**Board:** [04](assets/2026-11-05-sandbench-ux/04-approval-card-anatomy.png). Also [01](assets/2026-11-05-sandbench-ux/01-mobile-turn-states.png) (pins 3, 4, 8).

**Observed (at `7068fc3`):**
- Cards show a raw command or tool name ("WebSearch") and "Approve and run" / "Deny".
- The WebSearch query isn't available (D-8).
- WebFetch shows one URL, but approving grants the whole tool for the rest of the turn (F4-S, D-7).
- `driveTurn`'s `finally` relabels any still-pending card "denied", even when nobody denied it. #25 changes this to "Not answered" (`failed`) for lost streams.

**Proposed card anatomy** (same card, colours and two buttons; Approve first, Deny second, both full size):
1. **Title:** a plain verb ("Search the web", "Open a web page", "Run a command", "Replace a file").
2. **Labelled fields:** Tool (+ agent), Query/Address/Command/File, Sends to, Runs in / On this PC.
3. **Scope box:** "If you approve: <grant>". The text must be generated from the grant the approval contract reports for this request. Until that contract exists, the box shows only grants verified in code:

| Request kind | Grant at `7068fc3` (verified in code) | Scope copy allowed now |
| --- | --- | --- |
| Harness `runCommand` drivers (codex, grok, http, anthropic) | This request only; the next request asks again (#23 tests one-time approval) | "If you approve: this one request runs. The next one asks again." |
| Claude Code Bash/PowerShell | `Bash(<exact command>)` allow rule for the rest of this reply | "If you approve: Claude Code may run this exact command again until this reply ends." |
| Claude Code file tools | `Tool(<path>)` for the rest of this reply | "If you approve: Claude Code may use <Tool> on this file until this reply ends." |
| Claude Code WebFetch/WebSearch | **Whole tool for the rest of this reply** (F4-S) | "If you approve: Claude Code may use <Tool> for any address/query until this reply ends." This stays until D-7 changes the grant; the copy must then follow the new grant. |
| Planner actions | One action per card | "If you approve: this one action runs." |

4. **Button verbs** name the action: "Approve search", "Approve page", "Approve and run", "Approve change", and "Deny".
5. **Timeout note** on pending driver cards: "No answer in 30 min: the request expires."

**Card outcome states:**

| State | Input | Label | Body |
| --- | --- | --- | --- |
| Waiting for you | `permission_request`, not auto, pending | "Waiting for you" | fields + scope + buttons |
| Approved · result recorded | approved; `tool_end` with `code` 0 | "Approved · result recorded" | output in its own scroll box |
| Approved · failed (exit n) | approved; `tool_end` with `code` ≠ 0 | "Approved · failed (exit n)" | output |
| Approved · no separate result | approved; synthetic `tool_end` without `code` | "Approved · no separate result" | "Claude Code didn't report a separate result for this step. Check the reply." |
| Approved · waiting for result | approved; nothing yet | "Approved · running" | — |
| Auto-approved by rule | `permission_request {auto:true}` | "Auto-approved by rule" | "Matched '<rule>' in Settings › Auto-review." |
| Denied by you | This tab sent `permit(false)` from a user click | "Denied by you" | "You chose Deny at <time>." No claim about what else ran. |
| Denied automatically (unattended) | `permission_request {denied:true}` | "Denied automatically (unattended)" | "A routine ran with 'skip' set. No card was shown." |
| Stopped · no decision | This tab pressed Stop while the card was pending | "Stopped · no decision" | "You pressed Stop before choosing. Execution status: unknown." |
| Expired · no decision | `permission_resolved {allow:false}` with no local click or Stop, and ≥30 min pending. **Exact only after D-5.** | "Expired · no decision" | "No answer within 30 min. Execution status: unknown unless a result is recorded." |
| No decision recorded | `permission_resolved {allow:false}` this tab can't attribute (another tab, before D-5) | "No decision recorded here" | "The harness closed this request. This page didn't record who or what closed it." |
| Connection lost · status unknown | #25 `settleCard` on a pending or in-flight card | "Connection lost · status unknown" | Pending: "Sandbench never received your choice." In flight: "No result came back. It may have run; check before running it again." |
| Not run | **Only with D-6** (correlated record proving no dispatch and no covering rule/grant) | "Not run" | Withheld until D-6 exists. |

Rules:
- A card never says "denied" unless the user denied it, or the unattended rule denied it.
- After D-5, the harness reason replaces the page-local inference for Expired, Stopped and Denied.
- The "Approved · result recorded" outline stays green. Every other ending uses word + border style; colour is never the only cue.

**Data:**
- Existing events.
- Page-local: which tab clicked Deny or Stop.
- D-5: a resolution reason.
- D-6: a dispatch record.
- D-8: the query on WebSearch denials.
- PR #23's matcher output for the auto-review rule text, if the event carries it. The auto-approved event carries no rule text today (U-3).

**Fixtures:**
- **F-P3-a:** Claude WebSearch denial, query unavailable → Query row "Not shown by Claude Code", scope per the table.
- **F-P3-b:** Claude WebFetch `https://example.org/guide` (synthetic).
- **F-P3-c:** Claude Bash `Get-ChildItem notes -Filter *.md`, approved, real `tool_end code:0`.
- **F-P3-d:** Same approved, synthetic `tool_end` (no `code`).
- **F-P3-e:** Pending card, user taps Deny.
- **F-P3-f:** Pending card, user presses Stop.
- **F-P3-g:** Pending card, `permission_resolved {allow:false}` with no local action.
- **F-P3-h:** `permission_request {denied:true}`.
- **F-P3-i:** #25 lost stream with a pending card.

**Acceptance:**
- **P3-AC1.** Every pending card shows a verb title, a Tool field and a scope box whose text matches the grant table for its request kind.
- **P3-AC2.** No card displays "Not run" before D-6 is merged.
- **P3-AC3.** F-P3-e, f, g, h and i produce five different labels.
- **P3-AC4.** F-P3-d never shows "result recorded".
- **P3-AC5.** WebFetch/WebSearch scope copy states the tool-wide grant while F4-S is open.
- **P3-AC6.** Approve stays first and Deny second, both ≥44×44 px, with visible focus.

**Tests:**
- Given F-P3-b, when the card renders, then the scope reads "Claude Code may use WebFetch for any address until this reply ends."
- Given F-P3-e, when Deny is tapped, then the label is "Denied by you" and the body makes no claim about other steps.
- Given F-P3-g, then the label is "No decision recorded here" (before D-5) and never "Denied by you".
- Given F-P3-i, then the label is "Connection lost · status unknown" and the approve button is not shown (matches #25: a reloaded driver card is not approvable).
- Given F-P3-d, then the label is "Approved · no separate result".

### P4: Phone basics (360–460 px)

**Boards:** [01](assets/2026-11-05-sandbench-ux/01-mobile-turn-states.png), [02](assets/2026-11-05-sandbench-ux/02-mobile-setup-sheet.png), [05](assets/2026-11-05-sandbench-ux/05-couldnt-start-planner-choice.png).

**Observed (at `7068fc3`):**
- Below 899 px the layout is a single pane with a 3-button dock.
- `icon-btn` is 2.2rem and `panel-tabs` is 2rem, both under 44 px.
- The bot menu button is invisible until hover (opacity 0), so on touch it is invisible.
- Long commands and URLs overflow bubbles and cards. #21 fixes the wrapping but isn't merged.
- Enter sends on every device, with no IME check (`shell.tsx` ~517–521).
- The primary button contrast is 3.75:1.

**Proposed:**
- **Touch targets:** every interactive control is ≥44×44 px on coarse pointers. The bot menu button is always visible on touch.
- **Context line** on its own row (P1). The header stays bot name + "New chat".
- **Wrapping:** depends on #21's `overflow-wrap:anywhere` and `minmax(0,1fr)` grid fix. Commands and paths wrap inside cards; output scrolls inside its own box.
- **Enter key:**

| Device / state | Enter | Shift+Enter | Send button |
| --- | --- | --- | --- |
| Coarse pointer (phone, tablet) | newline | newline | sends |
| Fine pointer (desktop) | sends | newline | sends |
| Any, `isComposing` true or `keyCode 229` | never sends (IME commits) | — | — |

  The detection rule is `matchMedia("(pointer: coarse)")`. On phones, `enterkeyhint` stays "enter".
- **Composer while waiting (S3):** "Answer the card first. Your draft is kept." Stop stays available.
- **Soft keyboard:** the composer stays above the keyboard using the visual viewport. Pending cards stay reachable by scrolling. This needs native testing (§9).
- **Primary button token:** see §11.

**Fixtures:** **F-P4-a** is a long synthetic command (≥120 chars, no spaces) in a pending card. **F-P4-b** is a 60-char synthetic Windows path under `C:\Users\<you>\`.

**Acceptance:**
- **P4-AC1.** At 360, 390 and 460 px there is no horizontal page scroll with F-P4-a or F-P4-b.
- **P4-AC2.** Every control in the chat, composer, dock, sheet and cards measures ≥44×44 px under `pointer: coarse`.
- **P4-AC3.** The Enter behaviour matches the table, including no send during IME composition.
- **P4-AC4.** The bot menu button is visible without hover on touch.
- **P4-AC5.** Primary button text contrast is ≥4.5:1.

**Tests:**
- Given a coarse pointer, when Enter is pressed with a draft, then a newline is inserted and nothing is sent.
- Given a fine pointer, when Enter is pressed, then the draft is sent. When Shift+Enter is pressed, a newline is inserted.
- Given `isComposing` true, when Enter is pressed on any device, then nothing is sent.
- Given F-P4-a at 360 px, then `document.scrollingElement.scrollWidth <= innerWidth`.

### P5: Effective setup in the Model tab; inherited vs explicit settings

**Board:** [03](assets/2026-11-05-sandbench-ux/03-desktop-side-panel.png) (pins 4–7). Also [02](assets/2026-11-05-sandbench-ux/02-mobile-setup-sheet.png) (pin 2).

**Observed (at `7068fc3`):**
- The bot's Agent select shows "Built-in planner" for an empty value (`shell.tsx` ~690, `views.tsx` ~930), even when `settings.defaultAgentDriver` makes Claude Code the effective agent (F6).
- Missing skills and memory read failures are dropped silently.

**Proposed:**
- An **"Effective setup"** block at the top of the existing Model tab. Each row shows the value, a source badge ("Set on this bot", "From Settings default", "From group chat"), and one link to where it's changed. The rows are Agent, Model, Working folder, Permission mode, Auto-review list, Shared instructions, Skills, Memory and Connectors.
- **Agent select:** the empty option reads "Use default · <effective default>", or "Use default · Built-in planner" when no default is set. The value semantics don't change.
- **Working folder:**
  - In a group chat: "<channel folder> · in bot chats: workspace root".
  - In a bot chat: "workspace root", which matches `roomFolder`.
- **Skills:** "4 assigned · 1 not found on disk" when `skillLinesFor` drops one. **Memory:** "MEMORY.md + N files · read each reply", plus "1 couldn't be read" when `memoryDocFor` fails. Both are display only and never block a send.
- **Permission mode:** shows the mode label exactly as #23 defines it ("Ask (auto-review rules still apply)", "Auto (same as Ask for now)", "Full (same as Ask for now)") once #23 is merged. Until then it shows the base labels. It is display only.

**Fixtures:** **F-P5-a** is Pip with `driver` unset and the Settings default claude. **F-P5-b** is Pip with `driver:"claude"`. **F-P5-c** has a skill id that doesn't exist on disk. **F-P5-d** is a memory read that throws.

**Acceptance:**
- **P5-AC1.** With F-P5-a, the select shows "Use default · Claude Code (CLI)" and the Agent row badge reads "From Settings default".
- **P5-AC2.** The badges match the actual resolution order of `resolveAgentDriver` and `roomFolder`.
- **P5-AC3.** F-P5-c and F-P5-d show counts without blocking sends.
- **P5-AC4.** No new tab is added. Changing values still happens where it does today.

**Tests:**
- Given F-P5-a, then the Agent row shows "Claude Code (CLI)" with "From Settings default".
- Given F-P5-b, then the badge is "Set on this bot".
- Given F-P5-c, then the Skills row shows "1 not found on disk".
- Given a channel, then the Working folder row says "From group chat".

---

## 7. Safe order and dependency graph

```text
PR #21 (cwd, wrapping CSS, layout fixture) ──┐
PR #23 (approval matcher, mode labels) ──────┼──► P3 ──┐
PR #24 (capability labels) ─────► P1 ──► P5           │
PR #25 (turn recovery) ─────────► P2 ─────────────────┼──► P4 (final layout pass at 360/390/460)
D-5, D-6, D-7, D-8 (approval-safety owner) ─► P3 states that need them (stay withheld until then)
PR #22 + SB-29 (runner) ─► P2 mode R (withheld)
```

Recommended order:
1. **P1.** It reads only existing signals and touches no turn logic.
2. **P5.** It reuses P1's derivations.
3. **P2.** S1–S7 and S9–S12 can land at base. S8 needs #25.
4. **P3.** Only the states that current signals support; the rest stay withheld per §6.
5. **P4.** A final layout pass after #21.

P1 and P5 are independent of all open PRs except for the folder-of-last-turn row (#21). P2's S9/S12 path is independent of #25. Each packet is its own PR, based on `deploy/vercel` and not stacked, unless Vincent says otherwise.

---

## 8. File-area ownership (bounded)

| Packet | May edit | Must not edit (owned elsewhere) |
| --- | --- | --- |
| P1 | `src/shell.tsx` (chat header region), new view file for the sheet, `src/i18n.ts` (new keys), `src/styles.css` (new classes) | `src/capabilities.ts` (#24), harness files |
| P2 | `src/App.tsx` (`askBot` routing near `resolveAgentDriver`, the S9/S12 path, the busy note), `src/views.tsx` (`MessageBody` status line), `src/types.ts` (new optional `Message` fields), `src/i18n.ts`, `src/styles.css` | `src/turnRecovery.ts` and #25's settling; `harness/turns.mjs`; runner files |
| P3 | `src/views.tsx` (`ApprovalCard`), `src/i18n.ts`, `src/styles.css` | `harness/autoReview.mjs`, `src/approvalPolicy.ts` (#23); `harness/drivers/claude.mjs` grants and denial text (D-7/D-8 owner); `harness/turns.mjs` events (D-5/D-6 owner) |
| P4 | `src/styles.css`, composer `onKeyDown` in `src/shell.tsx` | anything #21 already changes, until #21 is merged or closed |
| P5 | Model tab region in `src/shell.tsx`, the agent `<option>` labels in `src/shell.tsx`/`src/views.tsx`, `src/i18n.ts` | `src/studio.tsx` settings forms; approval mode values |

Two agents never edit the same file region at the same time. If a packet needs a field from another owner's area, it stops and records the dependency.

---

## 9. Test matrix

| | B browser-only | L local harness | R runner |
| --- | --- | --- | --- |
| P1 line + sheet | ✓ | ✓ (connected, not reachable, not installed) | ✓ reachable/not reachable only |
| P2 S1–S7, S11 | — (no agent) | ✓ | pending #22 |
| P2 S8 | — | ✓ with #25 | pending #22 |
| P2 S9/S12 | ✓ (bot has a driver, no harness) | ✓ | withheld (W-3) |
| P3 states | planner cards | ✓ driver + planner cards | pending #22/SB-29 |
| P4 | ✓ | ✓ | ✓ |
| P5 | ✓ | ✓ | ✓ |

**Widths:** 360, 390 and 460 px (single pane, dock) and 1280 px (three columns with side panel), for every packet with UI. Automated layout checks can use #21's Playwright fixture once merged. Until then they are manual, recorded with screenshots.

**Automated where possible:**
- `vitest` for pure state functions: status derivation, I-3 idempotency, label selection.
- `node --test` for anything that reads harness events.
- No live CLI or network in tests; use synthetic events.

**Pending native/manual tests (not run by this design; must be run by a human on real devices):**
- iOS Safari and Android Chrome: soft keyboard, visual viewport, composer stays visible, Enter newline.
- iOS VoiceOver and Android TalkBack: status line announcements, card reading order, sheet focus trap.
- Windows: keyboard-only navigation (Tab, Shift+Tab, Enter, Esc closes the sheet), Windows IME (Japanese/Chinese) composition, high-contrast mode.
- Windows + Claude Code CLI on the user's subscription: real S9 (CLI not installed), real S6/S8 (kill the harness mid-turn).

---

## 10. Invariant tests

- **I-1.** Given a running turn, when a planner choice or Send is attempted, then no second `POST /turns` and no planner turn starts.
- **I-2.** Given a chosen driver listed `ok:false`, when the user sends, then no planner text is produced without the explicit tap.
- **I-3.** Given an S9 message, when the planner action runs twice (double tap, or a re-render plus tap), then exactly one planner message is created. After a reload the action is unavailable.
- **I-4.** Given `POST /turns` fails with a network error, then S10 is shown, not S9.
- **I-5.** Given any `turn_start` or later event was seen, when the turn errors or is lost, then the planner choice is absent and no request other than `GET /health`, `GET /drivers` or `GET /turns/<id>` (#25) is made.
- **I-6.** Given the planner turn starts after S9, then its request carries no approvals or allow rules from the failed turn.
- **I-7.** Grep the UI copy: "Not run" appears only behind the D-6 condition.
- **I-8.** F-P3-e to i yield distinct labels.
- **I-9.** Given health fails after being ok, then no row shows the previous connected value without its age.

---

## 11. Accessibility

**Contrast** (computed from tokens in `src/styles.css`; WCAG 2.x relative luminance):

| Pair | Ratio | Result |
| --- | --- | --- |
| Primary button: `--accent-ink #fff8f8` on `--accent #e24b4b` | 3.75:1 | **Fails** AA for normal text |
| Proposed: `#fff8f8` on `#c83a3a` (new `--accent-fill`) | 4.86:1 | Passes AA. The button still shows against panel (3.52:1) and bubble (3.05:1) |
| Alternative: `#101010` on `#e24b4b` | 4.84:1 | Passes, but changes the look to dark-on-red |
| Muted `#a3a3a3` on bubble `#242424` | 6.15:1 | Pass |
| Failed `#ff8b9a` on bubble | 6.96:1 | Pass |
| Proposed Interrupted `#e8a25a` on bubble | 7.2:1 | Pass |
| Waiting `#f3d48a` on bubble | 10.79:1 | Pass |
| Card border `--line-strong #3d3d3d` on panel | 1.59:1 | Decorative only; state must not depend on it |

**Recommendation:** add `--accent-fill: #c83a3a` for filled primary buttons, and keep `--accent #e24b4b` for outlines, links and focus accents. The boards still render the old `#e24b4b` fill (see Board notes). This choice is for Fable's review and Vincent's sign-off.

**Other rules:**
- **Targets:** ≥44×44 px on coarse pointers (P4-AC2).
- **Focus:** visible 2 px ring on every control (`#4ea1ff` on ground is 7.13:1). The sheet traps focus while open, Esc closes it, and focus returns to the context line.
- **Screen readers:**
  - The status line is an `aria-live="polite"` region per message; only state changes are announced, not every token.
  - Cards are a group labelled by their title.
  - The scope box is in the card's accessible description.
  - Couldn't start and the busy note are polite announcements; nothing uses `assertive` except errors the user must act on.
- **Never colour alone:** every state has a word and an icon shape.

---

## 12. Withheld scope and unknowns

**Withheld (deliberately not designed here):**
- **W-1.** Reattaching to a running turn after reload (#25 limits).
- **W-2.** "Not run" display (needs D-6).
- **W-3.** Planner choice and S9 in runner mode (needs #22 merged and its enqueue-refusal contract).
- **W-4.** File attachments beyond images (SB-18).
- **W-5.** Local MCP rows becoming live (queued owner).
- **W-6.** Memory saving controls (queued owner).
- **W-7.** Docker/WSL modes.
- **W-8.** Changes to approval grants (D-7) or modes (#23's open decision on `full`).

**Unknowns (evidence gaps, not decisions):**
- **U-1.** Whether #25's `Message.interrupted` field name and `settleCard` copy survive review. P2/P3 render whatever #25 merges.
- **U-2.** No driver event exists for "ran out of approval rounds" (`MAX_ROUNDS`). S7 needs one from the driver owner, or S7 is dropped and the turn shows S4 with "ended without a final answer" only if the text is empty.
- **U-3.** The auto-approved event doesn't carry the matched rule. "Matched '<rule>'" needs that field from #23's owner; until then: "Auto-approved by a Settings rule".
- **U-4.** Cross-tab uniqueness for I-3 isn't enforceable with last-writer-wins storage. Single-tab and reload are covered. Two-tab double use stays possible until there is a shared claim. This is noted, not a user decision.
- **U-5.** The live Windows/Claude CLI behaviour for S9 detail text (`/drivers` `detail` wording) hasn't been observed on the user's machine.
- **U-6.** #22's "restart = retry once" (`extras.resume`) must satisfy I-5 before engine tools are enabled (SB-29). This is flagged for the runner owner, not designed here.

**Dependencies (new signals from other owners):**
- **D-5.** `permission_resolved` reason: `user` | `expired` | `stopped` | `unattended`.
- **D-6.** A per-permission dispatch record that proves "not dispatched and no covering grant".
- **D-7.** F4-S: per-URL/per-query grants for WebFetch/WebSearch, or explicit tool-wide wording in the contract.
- **D-8.** The query/target on Claude WebSearch denials.

All four belong to the approval-safety owner. This design doesn't implement them.

---

## 13. Traceability

| Acceptance | Packet | Depends on |
| --- | --- | --- |
| P1-AC1–5 | P1 | base signals; #21 for last-turn folder |
| P2-AC1–3, 5–10 | P2 | base signals |
| P2-AC4 (reload) | P2 | new `Message` fields (in P2) |
| P2 S8 | P2 | #25 |
| P3-AC1, 3–6 | P3 | base signals, #25 (lost card), #23 (labels) |
| P3-AC2 and "Expired" exactness | P3 | D-6, D-5 |
| P3 query row | P3 | D-8 |
| P4-AC1 | P4 | #21 |
| P4-AC2–5 | P4 | base |
| P5-AC1–4 | P5 | base; #23 for mode labels |
| I-1–I-9 | all | as above |

---

## Board notes

The boards are proposals with synthetic data. They were drawn against `7068fc3`. Labels were refreshed for this spec (banner "SPEC v1"), but where a board and this text differ, **this text wins**:

- **00** is the real baseline render at `7068fc3`. Its labels ("Receiving", "Approve and run") are today's, not proposals.
- **01, 02, 04:** boxes marked ILLUSTRATIVE are placeholders for the grant table in P3.
  - Board 01's "No decision · connection lost" corresponds to "Connection lost · status unknown" in §6 P3.
  - Board 04's "Denied by you", "Expired · no decision" and "Stopped · no decision" need D-5 for exactness; "No decision recorded here" isn't drawn.
- **01 note 9** and **02 notes 5–6** refer to "queued" recovery and capability-label work. That work is now PRs #25 and #24 (open).
- **03** shows "Finished · 14 s". Duration needs a stored finish time (§5); without one it's omitted.
- **04, Claude command card:** "Approved · result recorded" applies only with a real `tool_end` code (§6 P3).
- **All boards** render the primary button with today's `#e24b4b` fill. §11 proposes `#c83a3a`.
- **05** follows §6 P2 S9/S12 and the contrast case S6.
