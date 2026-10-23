# Coordination MVP + Windows CUA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Approach B coordination (Chief, managedSections, peer ask/delegate, harness `coordinate_bots` + outbox) then Windows Electron real cua-driver with harness MCP mount.

**Architecture:** Pure peer access helpers in `src/peers.ts`; App owns IndexedDB handoffs via `coordinateBots()`; harness writes outbox JSON for CLI/MCP agents; Electron starts TryCUA on Windows and writes `cua-connection.json` for the harness MCP client. No `RuntimeCoordinator` tree. macOS/Linux CUA are docs-only follow-ups.

**Tech Stack:** Vite + React + TypeScript (Sandbench), Node harness (`harness/server.mjs`), stdio MCP (`scripts/mcp-server.mjs`), Electron (`electron/main.mjs`), Node built-in test runner (`node --experimental-strip-types --test`).

**Spec:** `docs/superpowers/specs/2026-10-23-coord-and-cua-design.md`

## Global Constraints

- No full `RuntimeCoordinator` / assignment_status / room job lanes.
- Coordination Approach **B** (UI + harness tool + outbox).
- CUA: **real** TryCUA `cua-driver`, **Windows only** first.
- Delivery order: **Phase 1 coord complete and build-green before Phase 2 CUA**.
- Do not commit unless the user explicitly asks (ignore per-task commit steps when commits are not requested; still mark the step done after verifying build/tests).
- Do not edit files under `.cursor/plans/` unless asked.
- Keys and tokens never leave harness/Electron for CUA MCP.

## File map

| File | Responsibility |
|------|----------------|
| `src/peers.ts` | `canAccessTeam`, `canReachPeer`, `reachablePeers`, `setChiefOfStaff`, `peerProvenance`, `normalizeSection` |
| `src/peers.test.ts` | Unit tests for peers helpers |
| `src/types.ts` | `Bot` chief/managed/peers/approvePeerComms; `Message.peerAsk` |
| `src/coordination.ts` | Pure delivery planning: `planCoordinateDeliveries` (ids → status, provenance text) |
| `src/App.tsx` | `coordinateBots`, outbox poll, `pickResponder` chief preference, `askBot` peerAsk option |
| `src/shell.tsx` | Chief UI, managed teams, peers, Ask/Delegate, badges |
| `src/i18n.ts` | English strings for new UI |
| `src/harness.ts` | Client wrappers for `/coordinate-bots`, outbox, `/cua/*` |
| `harness/server.mjs` | Outbox write on POST `/coordinate-bots`; GET/ack outbox; later `/cua/*` |
| `harness/cua-client.mjs` | Read connection JSON; MCP call helper (Phase 2) |
| `scripts/mcp-server.mjs` | Tool `coordinate_bots` (Phase 1); optional `cua_call` (Phase 2) |
| `electron/cua.mjs` | Windows driver resolve/start + write connection (Phase 2) |
| `electron/main.mjs` | Call `startCua` / IPC (Phase 2) |
| `docs/coordination.md` | Phase 1 operator docs |
| `docs/cua-windows.md` | Phase 2 install + status docs |
| `package.json` | Add `"test": "node --experimental-strip-types --test src/peers.test.ts"` |

---

## Phase 1 — Coordination

### Task 1: Peer access helpers + tests

**Files:**
- Create: `src/peers.ts`
- Create: `src/peers.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: `Bot` from `./types` (will add fields in Task 2; tests use inline shapes)
- Produces:
  - `normalizeSection(section: string | undefined): string`
  - `canAccessTeam(from: Pick<Bot, "section" | "chiefOfStaff" | "managedSections">, targetSection: string | undefined): boolean`
  - `canReachPeer(from: Bot, target: Bot): boolean`
  - `reachablePeers(from: Bot, bots: Bot[]): Bot[]`
  - `setChiefOfStaff(bots: Bot[], id: string): Bot[]`
  - `clearChief(bots: Bot[], id: string): Bot[]`
  - `peerProvenance(fromName: string, consult: boolean): string` → `"Message from X:"` or `"Delegated by X:"`

- [ ] **Step 1: Add test script**

In `package.json` scripts:

```json
"test": "node --experimental-strip-types --test src/peers.test.ts"
```

- [ ] **Step 2: Write failing tests**

Create `src/peers.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessTeam,
  canReachPeer,
  clearChief,
  normalizeSection,
  peerProvenance,
  reachablePeers,
  setChiefOfStaff,
} from "./peers.ts";
import type { Bot } from "./types.ts";

function bot(partial: Partial<Bot> & Pick<Bot, "id" | "name">): Bot {
  return {
    role: "Teammate",
    instructions: "",
    persona: "",
    color: "#000",
    shape: "pebble",
    voice: "cove",
    primary: false,
    hidden: false,
    skills: [],
    memories: [],
    section: "",
    lastThinking: [],
    createdAt: 0,
    ...partial,
  };
}

test("normalizeSection treats undefined as empty", () => {
  assert.equal(normalizeSection(undefined), "");
  assert.equal(normalizeSection("Ops"), "Ops");
});

test("canAccessTeam: same section", () => {
  const from = bot({ id: "a", name: "A", section: "Ops" });
  assert.equal(canAccessTeam(from, "Ops"), true);
  assert.equal(canAccessTeam(from, "Sales"), false);
});

test("canAccessTeam: chief managedSections", () => {
  const from = bot({
    id: "a",
    name: "A",
    section: "Ops",
    chiefOfStaff: true,
    managedSections: ["Sales"],
  });
  assert.equal(canAccessTeam(from, "Sales"), true);
  assert.equal(canAccessTeam(from, "Legal"), false);
});

test("canReachPeer excludes self, hidden, and non-allowed peers list", () => {
  const from = bot({ id: "a", name: "A", section: "Ops", peers: ["b"] });
  const b = bot({ id: "b", name: "B", section: "Ops" });
  const c = bot({ id: "c", name: "C", section: "Ops" });
  const hidden = bot({ id: "b2", name: "H", section: "Ops", hidden: true });
  assert.equal(canReachPeer(from, from), false);
  assert.equal(canReachPeer(from, b), true);
  assert.equal(canReachPeer(from, c), false);
  assert.equal(canReachPeer(from, hidden), false);
});

test("setChiefOfStaff exclusive per section and clears demoted managedSections", () => {
  const bots = [
    bot({ id: "a", name: "A", section: "Ops", chiefOfStaff: true, managedSections: ["Sales"] }),
    bot({ id: "b", name: "B", section: "Ops" }),
    bot({ id: "c", name: "C", section: "Sales", chiefOfStaff: true }),
  ];
  const next = setChiefOfStaff(bots, "b");
  assert.equal(next.find((x) => x.id === "b")?.chiefOfStaff, true);
  assert.equal(next.find((x) => x.id === "a")?.chiefOfStaff, false);
  assert.deepEqual(next.find((x) => x.id === "a")?.managedSections ?? [], []);
  assert.equal(next.find((x) => x.id === "c")?.chiefOfStaff, true);
});

test("clearChief removes flag and managedSections", () => {
  const bots = [bot({ id: "a", name: "A", section: "Ops", chiefOfStaff: true, managedSections: ["Sales"] })];
  const next = clearChief(bots, "a");
  assert.equal(next[0].chiefOfStaff, false);
  assert.deepEqual(next[0].managedSections ?? [], []);
});

test("peerProvenance", () => {
  assert.equal(peerProvenance("Ada", true), "Message from Ada:");
  assert.equal(peerProvenance("Ada", false), "Delegated by Ada:");
});

test("reachablePeers filters", () => {
  const from = bot({ id: "a", name: "A", section: "Ops", chiefOfStaff: true, managedSections: ["Sales"] });
  const bots = [
    from,
    bot({ id: "b", name: "B", section: "Sales" }),
    bot({ id: "c", name: "C", section: "Legal" }),
  ];
  assert.deepEqual(
    reachablePeers(from, bots).map((x) => x.id),
    ["b"],
  );
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test`  
Expected: FAIL (cannot find module `./peers.ts` or exports missing)

- [ ] **Step 4: Implement `src/peers.ts`**

```ts
import type { Bot } from "./types";

export function normalizeSection(section: string | undefined): string {
  return (section ?? "").trim();
}

export function canAccessTeam(
  from: Pick<Bot, "section" | "chiefOfStaff" | "managedSections">,
  targetSection: string | undefined,
): boolean {
  const mine = normalizeSection(from.section);
  const theirs = normalizeSection(targetSection);
  if (mine === theirs) return true;
  if (!from.chiefOfStaff) return false;
  return (from.managedSections ?? []).some((name) => normalizeSection(name) === theirs);
}

export function canReachPeer(from: Bot, target: Bot): boolean {
  if (from.id === target.id) return false;
  if (target.hidden) return false;
  if (!canAccessTeam(from, target.section)) return false;
  if (from.peers !== undefined && !from.peers.includes(target.id)) return false;
  return true;
}

export function reachablePeers(from: Bot, bots: Bot[]): Bot[] {
  return bots.filter((bot) => canReachPeer(from, bot));
}

export function setChiefOfStaff(bots: Bot[], id: string): Bot[] {
  const chosen = bots.find((bot) => bot.id === id);
  if (!chosen) return bots;
  const section = normalizeSection(chosen.section);
  return bots.map((bot) => {
    if (bot.id === id) {
      return { ...bot, chiefOfStaff: true, hidden: false };
    }
    if (normalizeSection(bot.section) === section && bot.chiefOfStaff) {
      return { ...bot, chiefOfStaff: false, managedSections: [] };
    }
    return bot;
  });
}

export function clearChief(bots: Bot[], id: string): Bot[] {
  return bots.map((bot) =>
    bot.id === id ? { ...bot, chiefOfStaff: false, managedSections: [] } : bot,
  );
}

export function peerProvenance(fromName: string, consult: boolean): string {
  const name = fromName.trim() || "Teammate";
  return consult ? `Message from ${name}:` : `Delegated by ${name}:`;
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`  
Expected: all tests PASS

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add package.json src/peers.ts src/peers.test.ts
git commit -m "feat: add peer access helpers for coordination MVP"
```

---

### Task 2: Types for chief, peers, peerAsk

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: none new
- Produces: fields used by Tasks 3–6

- [ ] **Step 1: Extend `Message`**

After `screenThumb?: string;` add:

```ts
  /** Injected when another bot asks or delegates to this thread. */
  peerAsk?: { botId: string; name: string; consult?: boolean };
```

- [ ] **Step 2: Extend `Bot`**

After `visibility?: BotVisibility;` (or near `section`) add:

```ts
  chiefOfStaff?: boolean;
  managedSections?: string[];
  peers?: string[];
  approvePeerComms?: boolean;
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS (optional fields; no call sites yet)

- [ ] **Step 4: Commit (only if user asked)**

```bash
git add src/types.ts
git commit -m "feat: add chief/managedSections/peerAsk types"
```

---

### Task 3: Delivery planner (`coordination.ts`)

**Files:**
- Create: `src/coordination.ts`
- Create: `src/coordination.test.ts`
- Modify: `package.json` test script to include both test files

**Interfaces:**
- Consumes: `canReachPeer`, `peerProvenance` from `./peers`
- Produces:
  - `export type CoordinateDelivery = { botId: string; status: "ok" | "pending_approval" | "error"; error?: string; text?: string; peerAsk?: Message["peerAsk"] }`
  - `export function planCoordinateDeliveries(input: { from: Bot; bots: Bot[]; botIds: string[]; message: string; consult: boolean }): CoordinateDelivery[]`

- [ ] **Step 1: Update test script**

```json
"test": "node --experimental-strip-types --test src/peers.test.ts src/coordination.test.ts"
```

- [ ] **Step 2: Write failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { planCoordinateDeliveries } from "./coordination.ts";
import type { Bot } from "./types.ts";

function bot(partial: Partial<Bot> & Pick<Bot, "id" | "name">): Bot {
  return {
    role: "T",
    instructions: "",
    persona: "",
    color: "#000",
    shape: "pebble",
    voice: "cove",
    primary: false,
    hidden: false,
    skills: [],
    memories: [],
    section: "Ops",
    lastThinking: [],
    createdAt: 0,
    ...partial,
  };
}

test("planCoordinateDeliveries marks unreachable and wraps text", () => {
  const from = bot({ id: "a", name: "Ada" });
  const b = bot({ id: "b", name: "Bea" });
  const planned = planCoordinateDeliveries({
    from,
    bots: [from, b],
    botIds: ["b", "missing"],
    message: "Need a summary",
    consult: true,
  });
  assert.equal(planned[0].status, "ok");
  assert.match(planned[0].text ?? "", /^Message from Ada:/);
  assert.equal(planned[0].peerAsk?.consult, true);
  assert.equal(planned[1].status, "error");
});

test("approvePeerComms yields pending_approval", () => {
  const from = bot({ id: "a", name: "Ada", approvePeerComms: true });
  const b = bot({ id: "b", name: "Bea" });
  const planned = planCoordinateDeliveries({
    from,
    bots: [from, b],
    botIds: ["b"],
    message: "Go",
    consult: false,
  });
  assert.equal(planned[0].status, "pending_approval");
  assert.match(planned[0].text ?? "", /^Delegated by Ada:/);
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npm test`  
Expected: FAIL missing `./coordination.ts`

- [ ] **Step 4: Implement**

```ts
import { canReachPeer, peerProvenance } from "./peers";
import type { Bot, Message } from "./types";

export type CoordinateDelivery = {
  botId: string;
  status: "ok" | "pending_approval" | "error";
  error?: string;
  text?: string;
  peerAsk?: Message["peerAsk"];
};

export function planCoordinateDeliveries(input: {
  from: Bot;
  bots: Bot[];
  botIds: string[];
  message: string;
  consult: boolean;
}): CoordinateDelivery[] {
  const body = input.message.trim();
  const prefix = peerProvenance(input.from.name, input.consult);
  return input.botIds.map((botId) => {
    const target = input.bots.find((bot) => bot.id === botId);
    if (!target) return { botId, status: "error", error: "Unknown bot." };
    if (!canReachPeer(input.from, target)) {
      return { botId, status: "error", error: "That teammate is not reachable." };
    }
    if (!body) return { botId, status: "error", error: "Missing message." };
    const peerAsk = { botId: input.from.id, name: input.from.name, consult: input.consult || undefined };
    const text = `${prefix}\n\n${body}`;
    if (input.from.approvePeerComms) {
      return { botId, status: "pending_approval", text, peerAsk };
    }
    return { botId, status: "ok", text, peerAsk };
  });
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test`  
Expected: PASS

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add src/coordination.ts src/coordination.test.ts package.json
git commit -m "feat: plan coordinate_bots deliveries"
```

---

### Task 4: App `coordinateBots` + askBot peerAsk + routing

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/harness.ts` (stubs for outbox poll — implement client GET)

**Interfaces:**
- Consumes: `planCoordinateDeliveries`, `setChiefOfStaff`, `clearChief`, `reachablePeers`
- Produces:
  - `coordinateBots({ fromBotId, botIds, message, consult }): Promise<CoordinateDelivery[]>` inside App
  - `askBot(..., options: { peerAsk?, skipUser?, ... })` attaches `peerAsk` on the user message when provided
  - `pickResponder` prefers lead, then chief member, then existing logic

- [ ] **Step 1: Extend `AskOptions`**

Near top of `App.tsx` where `AskOptions` is defined, add:

```ts
type AskOptions = {
  threadId?: string;
  skipUser?: boolean;
  unattended?: boolean;
  receipt?: Receipt;
  routed?: string;
  peerAsk?: Message["peerAsk"];
  userTextOverride?: string;
};
```

- [ ] **Step 2: When creating the user message in `askBot`, attach peerAsk**

Where the user `Message` object is built, include:

```ts
peerAsk: options.peerAsk,
text: options.userTextOverride ?? cleaned,
```

(Use existing cleaned text if no override; for handoffs pass full provenance text as `userTextOverride` and `skipUser: false`.)

- [ ] **Step 3: Add `coordinateBots` in App**

```ts
async function coordinateBots(input: {
  fromBotId: string;
  botIds: string[];
  message: string;
  consult: boolean;
}): Promise<CoordinateDelivery[]> {
  const from = botsRef.current.find((bot) => bot.id === input.fromBotId);
  if (!from) return input.botIds.map((botId) => ({ botId, status: "error" as const, error: "Unknown caller." }));
  const planned = planCoordinateDeliveries({
    from,
    bots: botsRef.current,
    botIds: input.botIds,
    message: input.message,
    consult: input.consult,
  });
  for (const item of planned) {
    if (item.status !== "ok" || !item.text || !item.peerAsk) continue;
    await askBot(item.botId, item.text, {
      peerAsk: item.peerAsk,
      userTextOverride: item.text,
    });
  }
  // pending_approval: leave a notice on caller's latest DM (Task 5 UI can refine)
  return planned;
}
```

Wire `patchBot` for chief:

```ts
function patchBot(id: string, patch: Partial<Bot>) {
  setBots((prev) => {
    let next = prev.map((bot) => (bot.id === id ? { ...bot, ...patch } : bot));
    if (patch.chiefOfStaff === true) next = setChiefOfStaff(next, id);
    if (patch.chiefOfStaff === false) next = clearChief(next, id);
    if (patch.managedSections && !next.find((b) => b.id === id)?.chiefOfStaff) {
      next = next.map((bot) => (bot.id === id ? { ...bot, managedSections: [] } : bot));
    }
    return next;
  });
}
```

- [ ] **Step 4: Update `pickResponder` fallback**

Replace the final `return routeLocally(...) ?? { bot: lead, ...}` path so that **before** local route, if no decision/model pick:

```ts
    const chief = members.find((bot) => bot.chiefOfStaff);
    const preferred = members.find((bot) => bot.id === channel.leadBotId) ?? chief ?? members[0];
    // keep decision + model attempts using `preferred` as lead fallback
    return routeLocally(members, text) ?? { bot: preferred, reason: preferred.chiefOfStaff ? "section chief" : "no clear match, so the lead answers" };
```

Ensure `lead` variable at top becomes:  
`const lead = members.find((bot) => bot.id === channel.leadBotId) ?? members.find((bot) => bot.chiefOfStaff) ?? members[0];`

- [ ] **Step 5: Build**

Run: `npm run build`  
Expected: PASS

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add src/App.tsx
git commit -m "feat: coordinateBots handoffs and chief-aware channel routing"
```

---

### Task 5: Customize + channel UI + i18n + badges

**Files:**
- Modify: `src/shell.tsx`
- Modify: `src/i18n.ts` (English keys)
- Modify: `src/views.tsx` or message renderer for `peerAsk` badge (wherever `MessageBody` lives — `src/views.tsx`)

**Interfaces:**
- Consumes: `reachablePeers`, `patchBot` chief fields, new App callback `onCoordinateBots`
- Produces: UI only

- [ ] **Step 1: Add English i18n keys** in the primary `en` dictionary in `src/i18n.ts`:

```ts
  makeChief: "Make Chief of Staff",
  removeChief: "Remove Chief of Staff",
  chiefBadge: "Chief of Staff",
  managedTeams: "Managed teams",
  managedTeamsHint: "Other sections this chief may coordinate.",
  peerAllowlist: "Peer allowlist",
  peerAllowlistHint: "Leave empty to allow all reachable teammates. Check bots to restrict.",
  approvePeerComms: "Approve peer messages before send",
  askPeer: "Ask teammate",
  delegatePeer: "Delegate to teammate",
  peerAskBadge: "Ask from",
  peerDelegateBadge: "Delegated by",
  pickPeer: "Teammate",
  peerMessage: "Message",
  sendHandoff: "Send",
```

- [ ] **Step 2: Customize section** in `shell.tsx` (near permission mode): Chief toggle calling `onPatch` with `chiefOfStaff: true|false`; if chief, checkboxes for `settings.sections.filter(s => s !== bot.section)` writing `managedSections`; peer checkboxes for other bots; `approvePeerComms` checkbox.

- [ ] **Step 3: Pass `onCoordinateBots` from App → Workspace → channel panel**

Signature:

```ts
onCoordinateBots: (input: { fromBotId: string; botIds: string[]; message: string; consult: boolean }) => Promise<void>
```

Add a small form when a channel is open: select peer from `reachablePeers(activeBot, bots)`, message field, Ask / Delegate buttons.

- [ ] **Step 4: Message badge** in `MessageBody` when `message.peerAsk`:

```tsx
{message.peerAsk ? (
  <span className="chip">{message.peerAsk.consult ? t("peerAskBadge") : t("peerDelegateBadge")} {message.peerAsk.name}</span>
) : null}
```

- [ ] **Step 5: Build**

Run: `npm run build`  
Expected: PASS

- [ ] **Step 6: Manual check** — promote chief, manage a section, Ask peer, see badge on target thread.

- [ ] **Step 7: Commit (only if user asked)**

```bash
git add src/shell.tsx src/i18n.ts src/views.tsx src/App.tsx
git commit -m "feat: Chief UI, managed teams, and peer handoff controls"
```

---

### Task 6: Harness outbox + MCP `coordinate_bots`

**Files:**
- Modify: `harness/server.mjs`
- Modify: `scripts/mcp-server.mjs`
- Modify: `src/harness.ts`
- Modify: `src/App.tsx` (poll outbox when harness up)
- Create: `docs/coordination.md`

**Interfaces:**
- Consumes: none from React (outbox is file-based)
- Produces:
  - `POST /coordinate-bots` → writes `~/.sandbench/outbox/<uuid>.json`
  - `GET /coordinate-outbox` → `{ items: [...] }`
  - `POST /coordinate-outbox/ack` → `{ ids: string[] }`
  - MCP tool `coordinate_bots`
  - App applies items via `coordinateBots` then acks

Outbox file shape:

```json
{
  "id": "uuid",
  "at": 0,
  "fromBotId": "...",
  "bot_ids": ["..."],
  "message": "...",
  "consult": false,
  "reason": "",
  "approved": true
}
```

- [ ] **Step 1: Harness routes**

Add `OUTBOX_DIR = path.join(SANDBENCH_HOME, "outbox")`, `mkdirSync`.

`POST /coordinate-bots`: require `approved === true`, validate `fromBotId` / `bot_ids` / `message`, write file, return `{ id, status: "queued" }`.

`GET /coordinate-outbox`: list json files (max 50), parse, return `{ items }`.

`POST /coordinate-outbox/ack`: body `{ ids: string[] }`, delete those files.

- [ ] **Step 2: Client wrappers in `src/harness.ts`**

```ts
export function harnessCoordinateBots(body: {
  fromBotId: string;
  bot_ids: string[];
  message: string;
  consult?: boolean;
  reason?: string;
  approved: true;
}) {
  return call<{ id: string; status: string }>("/coordinate-bots", { method: "POST", body: JSON.stringify(body) });
}

export function harnessCoordinateOutbox() {
  return call<{ items: { id: string; fromBotId: string; bot_ids: string[]; message: string; consult?: boolean }[] }>(
    "/coordinate-outbox",
  );
}

export function harnessAckCoordinateOutbox(ids: string[]) {
  return call("/coordinate-outbox/ack", { method: "POST", body: JSON.stringify({ ids }) });
}
```

- [ ] **Step 3: Poll in App** when `harness` health is ok — every 2s (or piggyback existing health interval): fetch outbox, for each item `await coordinateBots(...)`, then ack ids.

- [ ] **Step 4: MCP tool** in `scripts/mcp-server.mjs` — add tool schema matching POST body; handler calls harness `POST /coordinate-bots`.

- [ ] **Step 5: Write `docs/coordination.md`** covering Chief, managed sections, UI handoffs, outbox, MCP example.

- [ ] **Step 6: Build + restart harness; smoke MCP**

Run: `npm run build`  
Manual: queue via curl to harness with token; confirm UI applies delivery.

- [ ] **Step 7: Commit (only if user asked)**

```bash
git add harness/server.mjs scripts/mcp-server.mjs src/harness.ts src/App.tsx docs/coordination.md
git commit -m "feat: coordinate_bots harness outbox and MCP tool"
```

---

## Phase 2 — Windows CUA (start only after Phase 1 is green)

### Task 7: Electron cua host + connection descriptor

**Files:**
- Create: `electron/cua.mjs` (Windows-focused port of OpenMausBot patterns)
- Create: `electron/cua-connection.mjs` (read/write JSON)
- Modify: `electron/main.mjs`
- Create: `docs/cua-windows.md`

**Interfaces:**
- Consumes: OpenMausBot `electron/cua.mjs` as reference (do not copy Linux runtime)
- Produces:
  - `startCua(): Promise<{ status: "ready"|"missing_binary"|"error"; message?: string; connectionPath: string }>`
  - `stopCua(): Promise<void>`
  - Writes `%APPDATA%/sandbench/cua-connection.json` (or `app.getPath("userData")/cua-connection.json`) with `{ mcpCommand, mcpArgs, mcpEnv, platform: "win32", mode: "embedded"|"external" }`
  - IPC: `cua:status`, `cua:connection`

- [ ] **Step 1: Implement binary resolve**

Order: `process.resourcesPath/cua-driver.exe` → `path.join(process.env.LOCALAPPDATA || "", "Programs", "CuaDriver", "cua-driver.exe")` → env `SANDBENCH_CUA_DRIVER`. If none: status `missing_binary`, write nothing or write `{ status: "missing_binary" }`.

- [ ] **Step 2: On ready, write connection JSON** the harness can spawn (stdio MCP). Prefer documenting the exact argv OpenMausBot uses on Windows for embedded MCP; if `@trycua/cua-driver` is not a dependency, use external binary CLI `cua-driver mcp` (or equivalent from TryCUA docs / OMB `cua.mjs`).

- [ ] **Step 3: Hook `main.mjs`** after window create: `void startCua()`; set `process.env.SANDBENCH_CUA_CONNECTION` for child harness to the connection file path; pass same env into harness spawn.

- [ ] **Step 4: Docs** `docs/cua-windows.md` — install CuaDriver, expected paths, how to confirm status.

- [ ] **Step 5: Manual** — run `npm run electron:dev` without binary → missing_binary; with binary present → connection file exists.

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add electron/cua.mjs electron/cua-connection.mjs electron/main.mjs docs/cua-windows.md
git commit -m "feat: Windows Electron cua-driver host and connection descriptor"
```

---

### Task 8: Harness `/cua/status` + `/cua/call` + App status

**Files:**
- Create: `harness/cua-client.mjs`
- Modify: `harness/server.mjs`
- Modify: `src/harness.ts`
- Modify: `src/views.tsx` or Work panel for status line
- Modify: `scripts/mcp-server.mjs` optional `cua_status` / `cua_call`

**Interfaces:**
- Consumes: connection JSON from Task 7
- Produces:
  - `GET /cua/status` → `{ ready: boolean, tools: string[], error?: string }`
  - `POST /cua/call` → `{ tool: string, arguments: object, approved: true }` → MCP tool result JSON
  - Mutating tools require `approved: true` (same as `/input`)

- [ ] **Step 1: `harness/cua-client.mjs`** — read `process.env.SANDBENCH_CUA_CONNECTION` or default path; if missing/not ready return null; else spawn MCP with stdio using Node child_process and a minimal JSON-RPC helper (list tools + call tool). Keep implementation small; timeout 60s.

- [ ] **Step 2: Routes on server** as above; if client null, status `ready: false`.

- [ ] **Step 3: Frontend** — `harnessCuaStatus()`; show in Settings/Work: Ready / Missing driver / Error.

- [ ] **Step 4: Approval path** — when a bot turn requests CUA click/type via harness, reuse existing approval card pattern (`PointerAction`-like or generic tool approval). Minimum: only allow `/cua/call` from UI after user clicks Approve on a message that embeds `{ kind: "cua", tool, arguments }`. Auto-approve when `bot.approvalMode === "full"` or (`auto` and tool is in a small allowlist: `get_desktop_state`, `get_screen_size` only for auto).

- [ ] **Step 5: Build + manual** with driver: `get_desktop_state` after approve.

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add harness/cua-client.mjs harness/server.mjs src/harness.ts src/views.tsx scripts/mcp-server.mjs
git commit -m "feat: harness CUA MCP status and approved tool calls"
```

---

### Task 9: Driver tool advertising + planner footer

**Files:**
- Modify: `harness/turns.mjs` or driver prompt assembly in `App.tsx` / `src/prompt.ts`
- Modify: `docs/cua-windows.md`

- [ ] **Step 1:** When `/cua/status` ready, append system footer: prefer accessibility element refs; list available tool names (cap 20).

- [ ] **Step 2:** Document fallback: `/screen` + `/input` still work when CUA not ready.

- [ ] **Step 3:** `npm run build` PASS; update spec status line in design doc to “Implemented” only after manual Windows verification.

- [ ] **Step 4: Commit (only if user asked)**

```bash
git add src/prompt.ts docs/cua-windows.md docs/superpowers/specs/2026-10-23-coord-and-cua-design.md
git commit -m "feat: advertise CUA tools in agent prompts when ready"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Bot chiefOfStaff / managedSections / peers / approvePeerComms | 2, 5 |
| Message.peerAsk | 2, 4 |
| peers.ts helpers | 1 |
| Single-hop handoff + provenance | 3, 4 |
| Channel routing lead → chief | 4 |
| Customize + badges + Ask/Delegate UI | 5 |
| Harness POST + outbox + MCP coordinate_bots | 6 |
| docs/coordination.md | 6 |
| Electron Windows cua-driver + connection JSON | 7 |
| Harness /cua/* + approval | 8 |
| docs/cua-windows.md | 7–8 |
| Prompt footer when CUA ready | 9 |
| No RuntimeCoordinator | (global — not implemented) |
| macOS/Linux CUA deferred | docs only in 7 |

## Self-review notes

- No TBD placeholders in task steps.
- Types (`CoordinateDelivery`, `peerAsk`) consistent across Tasks 2–6.
- Commit steps are optional per user git rules.
- Phase 2 depends on TryCUA binary availability on the machine; Task 7 must degrade to `missing_binary` without failing the app.
