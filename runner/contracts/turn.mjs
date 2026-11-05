// Turn request (SB-03): what the owner sends to start a turn. Only these fields; the engine fills
// everything else (owner from the sign-in, prompt from SB-08, key from SB-05). PR 2 added the
// page's routing choices (driver, base, the *name* of the key) and the ids of the two message
// records the page already holds, so the engine never writes a duplicate. No field carries a key.
import { validateShape } from "./shape.mjs";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** The stored keys a turn may name; the value stays on the server (harness/turns.mjs has the same set). */
export const TURN_SECRET_NAMES = ["XAI_API_KEY", "ANTHROPIC_API_KEY", "COMPAT_API_KEY"];

/**
 * @typedef {object} TurnRequest
 * @property {string} threadId
 * @property {string} text
 * @property {string} [agentId]
 * @property {string} [model]
 * @property {string} [folder]
 * @property {string} [driver]     harness driver id (claude, anthropic, http, ...)
 * @property {string} [base]       API base URL for the http/anthropic drivers (https, or loopback)
 * @property {string} [secret]     which stored key to use, by name only
 * @property {string} [messageId]  the user message record the page created for this turn
 * @property {string} [replyId]    the assistant message record the reply is written into
 */
export const TURN_REQUEST_FIELDS = {
  threadId: { type: "string", required: true, pattern: ID },
  text: { type: "string", required: true, maxLength: 20_000 },
  agentId: { type: "string", pattern: ID },
  model: { type: "string", maxLength: 120, pattern: /^[\w.:/@-]+$/ },
  folder: { type: "string", maxLength: 240 },
  driver: { type: "string", pattern: /^[a-z][a-z0-9_-]{0,31}$/ },
  base: { type: "string", maxLength: 400, pattern: /^https:\/\/[^\s]+$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s]*)?$/ },
  secret: { type: "string", enum: TURN_SECRET_NAMES },
  messageId: { type: "string", pattern: ID },
  replyId: { type: "string", pattern: ID },
};

export const validateTurnRequest = (value) => validateShape(TURN_REQUEST_FIELDS, value, "turn request");
