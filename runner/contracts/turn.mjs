// Turn request (SB-03): what the owner sends to start a turn. Only these fields; the engine fills
// everything else (owner from the sign-in, prompt from SB-08, key from SB-05).
import { validateShape } from "./shape.mjs";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** @typedef {{ threadId: string, text: string, agentId?: string, model?: string, folder?: string }} TurnRequest */
export const TURN_REQUEST_FIELDS = {
  threadId: { type: "string", required: true, pattern: ID },
  text: { type: "string", required: true, maxLength: 20_000 },
  agentId: { type: "string", pattern: ID },
  model: { type: "string", maxLength: 120, pattern: /^[\w.:/@-]+$/ },
  folder: { type: "string", maxLength: 240 },
};

export const validateTurnRequest = (value) => validateShape(TURN_REQUEST_FIELDS, value, "turn request");
