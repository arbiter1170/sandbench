// Agent drivers. Each driver module exports:
//
//   id, label
//   available(): Promise<{ ok: boolean, detail: string }>
//   startTurn(turn, io): { done: Promise<void>, interrupt(): void }
//     turn: { id, prompt, system, history: [{ role, content }], model, base, key, cwd }
//     io.emit(event)                       sends a Sandbench event for this turn
//     io.requestPermission({ command, reason, tool }) resolves true when the user approves
//     io.runCommand(command)               runs an approved PowerShell command in turn.cwd
//     io.signal                            aborts when the user presses Stop
//   normalizeEvent(raw): Sandbench events for one provider event
//
// Sandbench events: thinking { text }, message_delta { text }, permission_request
// { permissionId, command, reason, auto }, tool_start { permissionId, command },
// tool_end { permissionId, code, output, ms }, done {}, error { message }.
import * as anthropic from "./anthropic.mjs";
import * as claude from "./claude.mjs";
import * as codex from "./codex.mjs";
import * as grok from "./grok.mjs";
import * as http from "./http.mjs";

export const DRIVERS = [anthropic, http, claude, codex, grok];

export function driverById(id) {
  return DRIVERS.find((driver) => driver.id === id);
}

export async function listDrivers() {
  return Promise.all(
    DRIVERS.map(async (driver) => {
      const state = await driver.available().catch((error) => ({ ok: false, detail: String(error) }));
      return {
        id: driver.id,
        label: driver.label,
        ok: state.ok,
        detail: state.detail,
        ...(Array.isArray(state.models) ? { models: state.models } : {}),
      };
    }),
  );
}
