# Sandbench coordination MVP + Windows CUA design

**Date:** 2026-10-23  
**Status:** Approved; implementation plan at `docs/superpowers/plans/2026-10-23-coord-and-cua.md`  
**Repo:** `grokbot-poc` (Sandbench)  
**Reference:** OpenMausBot (`OpenMausBot/`)

## Goal

Bring Sandbench closer to OpenMausBot on two fronts, in order:

1. **Coordination MVP (Approach B)** — Chief of Staff, managed sections, peer ask/delegate handoffs, plus a harness/`coordinate_bots` tool agents can call. No full `RuntimeCoordinator` tree.
2. **Windows real cua-driver** — Electron hosts TryCUA `cua-driver`, writes a connection descriptor; harness mounts MCP tools. macOS/Linux CUA documented as follow-ups only.

Wave A (multi-TTS, soul/MEMORY.md, local skills, bot settings, deeper pointer/screenshot paths) is already shipped and is a dependency, not redo work.

## Decisions locked in

| Topic | Choice |
|--------|--------|
| Coordination approach | **B** — model + UI + harness tool (not client-only A, not full coordinator C) |
| CUA | **Real** TryCUA `cua-driver` (not a11y-lite without the binary) |
| CUA platforms (first cut) | **Windows only** |
| Delivery order | **Coord first**, then CUA |

---

## Phase 1 — Coordination MVP

### Data model (`src/types.ts`)

Extend `Bot`:

| Field | Type | Semantics |
|--------|------|-----------|
| `chiefOfStaff?` | `boolean` | At most one `true` per `section` string. Promoting bot X demotes every other bot with the same `section` and clears their `managedSections`. |
| `managedSections?` | `string[]` | Extra sidebar section names this chief may coordinate. Own `section` is always allowed. Only meaningful when `chiefOfStaff`. Demotion clears the list. |
| `peers?` | `string[]` | Optional allowlist of bot ids. `undefined` / omit = all visible bots in allowed sections. Empty array = nobody. |
| `approvePeerComms?` | `boolean` | When true, handoffs require an in-chat approval chip before send. Default `false` for MVP. |

Extend `Message`:

| Field | Type | Semantics |
|--------|------|-----------|
| `peerAsk?` | `{ botId: string; name: string; consult?: boolean }` | Present on the **user** line injected into the target bot’s thread. `consult: true` = ask; omit/false = delegate. |

No new thread kinds. Handoffs use existing DM threads (`botId`, no `memberIds`) or continue the target’s latest DM.

### Access helpers (`src/peers.ts`)

Port a thin subset of OpenMausBot `server/peer-roster.ts`:

- `canAccessTeam(from, targetSection)` — same section, or chief with `managedSections` containing target (normalize empty section as `""`).
- `canReachPeer(from, target, allBots)` — not self, not `hidden`, `canAccessTeam`, and if `from.peers` is defined, `target.id` must be listed.
- `reachablePeers(from, allBots)` — filter.
- `setChiefOfStaff(bots, id)` — pure function returning updated bot list with section-scoped exclusivity.

Sections come from `Settings.sections` plus any `bot.section` values already in use. Invalid `managedSections` entries (unknown names) are dropped on patch.

### Handoff semantics (single-hop)

One shared implementation used by UI and the harness tool:

1. Resolve **caller** bot (channel member or DM owner).
2. Resolve each `bot_id` via `reachablePeers` / name match; reject unreachable ids with a clear error string.
3. If `approvePeerComms` on the caller: create a pending approval message in the **caller** thread; do not deliver until approved. Tool response: `{ status: "pending_approval", … }`.
4. Else deliver immediately: for each target, append a user message on the target’s DM thread with provenance prefix (`Message from X:` / `Delegated by X:`) and `peerAsk`, then run `askBot` (same path as a normal user turn). Unattended/routines: respect existing `unattended` settings; handoffs from tools default to attended unless the driver session is already unattended.

**Explicitly not in MVP:** assignment trees, `assignment_status` long-poll, room job lanes, standing-thread resume graphs, rework chains, Chief-only `create_bot` / `retry_thread` MCP.

### Channel routing tweak

In `sendToChannel` / `pickResponder`:

1. Explicit `@mentions` unchanged (all mentioned).
2. Else if `autoRoute` and multiple members: prefer `channel.leadBotId` if still a member; else prefer a member with `chiefOfStaff` whose `section` matches the lead’s section or any member’s section (first match); else existing decision-model / local / lead fallback.

### UI

- **Customize:** Chief toggle; when chief, checkbox list of other sections → `managedSections`; optional peers multi-select; `approvePeerComms` checkbox.
- **Sidebar / bot menu:** Make chief / Remove chief (same invariants).
- **Channel / chat:** Ask peer / Delegate peer control that picks from `reachablePeers` and calls the shared handoff.
- **Messages:** Badge for `peerAsk` (Ask vs Delegated).
- **Bot header:** Small Chief badge when `chiefOfStaff`.

### Harness / MCP tool `coordinate_bots`

**HTTP (harness):** `POST /coordinate-bots` with body:

```json
{
  "fromBotId": "<uuid>",
  "bot_ids": ["<uuid>", "..."],
  "message": "...",
  "consult": false,
  "reason": "optional",
  "approved": true
}
```

- `consult: true` → ask; `false`/omit → delegate.
- `approved` must be true for mutating delivery when the harness token is used from an agent (same pattern as `/input`). UI-originated calls that already passed an in-app approval chip send `approved: true`.
- Response: `{ deliveries: [{ botId, threadId, status: "ok"|"pending_approval"|"error", error? }] }`.

**MCP:** Extend `scripts/mcp-server.mjs` with tool `coordinate_bots` that proxies to that route (caller identity: argument `fromBotId` required; agents must pass the bot they are running as).

**Driver wiring:** Claude/Codex/Grok turns that already talk to the harness get the tool description in system/tool catalog when harness health reports coordination available (always-on if harness up). Tool results are text summaries the model can read.

The **browser** does not need the harness for UI handoffs: UI calls an App-level `coordinateBots(...)` that mutates IndexedDB state. The harness endpoint exists so **CLI agents** can trigger the same behavior; the harness will need a way to signal the renderer or apply deliveries itself.

**Harness ↔ renderer bridge (required for Approach B):**

Agents run outside the React store. Choose the smallest bridge that works:

- **Preferred:** Harness writes a delivery request to `~/.sandbench/outbox/coordinate-<id>.json`; the Vite/Electron app already polling harness health also polls `GET /coordinate-outbox`, applies deliveries via `coordinateBots` in App, then `DELETE`/`ack`. This keeps IndexedDB as source of truth.
- **Not preferred for MVP:** Duplicating thread storage on disk.

Document this outbox contract in `docs/wave-a.md` successor or `docs/coordination.md`.

### Errors

- Unknown / unreachable bot → per-id error in `deliveries`, HTTP 200 with mixed statuses (or 400 if *all* fail).
- Non-chief setting `managedSections` → ignored / cleared on patch.
- Missing harness for MCP tool → MCP error; UI handoffs still work offline.

### Testing (Phase 1)

- Unit: `setChiefOfStaff`, `canReachPeer` (same section, managed section, peers allowlist, hidden).
- Unit: provenance prefix for consult vs delegate.
- Manual: promote chief, assign managed section, Ask/Delegate from channel, see badge + target reply; with harness MCP, call `coordinate_bots` and see outbox apply.

---

## Phase 2 — Windows real cua-driver

### Electron host

Port the **Windows** path from OpenMausBot `electron/cua.mjs` / `cua-connection.cjs` into Sandbench `electron/`:

1. Resolve driver binary: packaged `resources/cua-driver.exe`, else `%LOCALAPPDATA%\Programs\CuaDriver\`, else documented install path.
2. Start embedded host when Electron launches (or on first “Enable CUA”).
3. Write `userData/cua-connection.json` (mode `0600` where applicable) with fields the harness can read: `mcpCommand`, `mcpArgs`, `mcpEnv`, and any socket/pipe needed.
4. IPC to renderer: `cua:connection`, `cua:status` (`ready` | `missing_binary` | `error` + message).

If the binary is missing: status `missing_binary`; do not crash the app; keep `/screen` + `/input` fallback.

### Harness

- On boot and on `GET /cua/status`: locate Electron’s `cua-connection.json` (path via env `SANDBENCH_CUA_CONNECTION` or default under Electron `userData` when `SANDBENCH_ELECTRON=1`, else skip).
- If ready: spawn/attach MCP client for desktop tools (`get_desktop_state`, `click`, `type_text`, and other tools present in the Windows driver schema we wire).
- Expose:
  - `GET /cua/status` → `{ ready, tools[], error? }`
  - `POST /cua/call` → `{ tool, arguments, approved: true }` → MCP tool result (mutating tools require `approved: true` unless policy says otherwise).
- Agent drivers: when CUA ready, advertise CUA tools alongside shell/pointer; mutating calls create the same approval UX as today’s pointer/shell (or auto when bot `approvalMode` is `auto`/`full` with existing allowlist rules).

### App / Settings

- Work or Settings panel: CUA status, short install blurb, link to `docs/cua-windows.md`.
- Planner/system footer: when CUA ready, prefer accessibility/element refs over raw coordinates (mirror OpenMausBot guidance at a high level).

### Fallback

`/screen` and `/input` remain. If CUA call fails, surface error; do not silently fall back mid-action unless the tool explicitly chooses screenshot-only recovery.

### Non-goals (Phase 2)

- macOS / Linux cua-driver runtimes
- Full browser_* CUA tool surface unless already in the Windows schema we mount
- Shipping the TryCUA binary inside git (document install / optional copy into `electron/resources/`)

### Testing (Phase 2)

- Manual on Windows + Electron: missing binary → status; with binary → `get_desktop_state` via `/cua/call` after approval.
- Harness without Electron: `/cua/status` → not ready; app still usable.

---

## Architecture sketch

```text
Phase 1:
  UI / MCP coordinate_bots
       → coordinateBots() [App]  OR  harness outbox → App apply
       → peerAsk message + askBot(target)

Phase 2:
  Electron → cua-driver → cua-connection.json
  Harness reads descriptor → MCP client
  Drivers / App → POST /cua/call (approved) → desktop tools
  Fallback: /screen + /input
```

## Docs to add

- `docs/coordination.md` — Chief, managed sections, handoffs, outbox, MCP tool.
- `docs/cua-windows.md` — install paths, Electron enablement, harness status, approval.

## Implementation order

1. Types + `peers.ts` + Customize/sidebar UI + message badges.
2. App `coordinateBots` + channel routing tweak + Ask/Delegate UI.
3. Harness `POST /coordinate-bots` + outbox + MCP tool + driver tool catalog hint.
4. Electron CUA host + connection file + IPC status.
5. Harness `/cua/*` + approval wiring + Settings status + docs.

## Success criteria

- A chief can manage another section and Ask/Delegate to a reachable peer; target sees provenance + badge and answers.
- An agent connected through harness MCP can call `coordinate_bots` and the handoff appears in the UI after outbox apply.
- On Windows Electron with cua-driver installed, `/cua/status` is ready and an approved `get_desktop_state` (or equivalent) returns structured desktop state; without the binary, the app degrades cleanly to screenshot/pointer.

