// Connectors a local Claude Code turn may use. The page syncs which tested connectors each
// bot is assigned; a turn names only its bot, and the harness writes that bot's servers into
// a per-turn `--mcp-config` file (the claude.mjs `extras.mcpConfig` hook). The turn request
// can't carry connector urls, headers or extras of its own.
//
// Header secrets ({{NAME}} values from the secret store) are never resolved here: the CLI
// would read them from that file on disk. A connector whose headers need one is left out of
// Claude turns, with the reason shown, until there is a decided way to hand secrets to the CLI.
// The runner passes no registry, so runner turns get no connectors from this module.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_CONNECTORS = 50;
const MAX_HEADERS = 20;
const ID = /^[\w-]{1,80}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const SECRET_REF = /\{\{/;
const SAFE_PATH = /^[\w.:\\/@-]+$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Why a connector url can't go to the CLI, or "" when it can (https, or http on this computer). */
export function urlProblem(raw) {
  if (typeof raw !== "string" || raw.length > 2000) return "The url is missing or too long.";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "The url is not valid.";
  }
  if (url.username || url.password) return "The url has a user name or password in it.";
  if (url.protocol === "https:") return "";
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return "";
  return "Only https urls, or http on this computer, can be used.";
}

function serverName(connector) {
  const slug = connector.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "connector";
  return `sb_${slug}_${connector.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toLowerCase()}`;
}

function readConnector(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !ID.test(item.id)) return { problem: "The connector id is not valid." };
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 80) : item.id;
  const entry = { id: item.id, name, url: item.url, headers: {}, skip: "" };
  if (item.status !== "ok") entry.skip = "Test the connector first.";
  const bad = urlProblem(item.url);
  if (bad) entry.skip = bad;
  const headers = Array.isArray(item.headers) ? item.headers : [];
  if (headers.length > MAX_HEADERS) entry.skip = "The connector has too many headers.";
  for (const header of headers.slice(0, MAX_HEADERS)) {
    const key = typeof header?.key === "string" ? header.key.trim() : "";
    if (!key) continue;
    const value = typeof header.value === "string" ? header.value : "";
    if (!HEADER_NAME.test(key) || value.length > 4000 || /[\r\n]/.test(value)) {
      entry.skip = "A header name or value is not valid.";
      continue;
    }
    if (SECRET_REF.test(value)) {
      entry.skip ||= "It needs a stored secret, and local Claude turns don't pass secrets to the CLI yet.";
      continue;
    }
    entry.headers[key] = value;
  }
  if (entry.skip) entry.headers = {};
  return { entry };
}

export function createConnectorRegistry({ dir }) {
  let connectors = new Map();
  let bots = new Map();

  /** Replace everything with what the page sent. Returns counts; never echoes urls or headers. */
  function sync(body) {
    const list = Array.isArray(body?.connectors) ? body.connectors.slice(0, MAX_CONNECTORS) : [];
    const next = new Map();
    let rejected = 0;
    for (const item of list) {
      const { entry } = readConnector(item);
      if (entry) next.set(entry.id, entry);
      else rejected += 1;
    }
    const nextBots = new Map();
    const assigned = body?.bots && typeof body.bots === "object" && !Array.isArray(body.bots) ? body.bots : {};
    for (const [botId, ids] of Object.entries(assigned)) {
      if (!ID.test(botId) || !Array.isArray(ids)) continue;
      nextBots.set(botId, [...new Set(ids.filter((id) => typeof id === "string" && next.has(id)))]);
    }
    connectors = next;
    bots = nextBots;
    return { ok: true, connectors: next.size, rejected };
  }

  /**
   * The `--mcp-config` file for one turn. `servers` is what the bot gets, `skipped` what it was
   * assigned but can't use (with the reason). `release()` deletes the file.
   */
  function attach({ turnId, botId }) {
    const none = { file: "", servers: [], skipped: [], release: () => undefined };
    if (typeof botId !== "string" || !bots.has(botId) || typeof turnId !== "string" || !ID.test(turnId)) return none;
    const servers = [];
    const skipped = [];
    const config = {};
    for (const id of bots.get(botId)) {
      const connector = connectors.get(id);
      if (!connector) continue;
      if (connector.skip) {
        skipped.push({ name: connector.name, reason: connector.skip });
        continue;
      }
      const name = serverName(connector);
      config[name] = { type: "http", url: connector.url, ...(Object.keys(connector.headers).length ? { headers: connector.headers } : {}) };
      servers.push({ name, connector: connector.name });
    }
    if (servers.length === 0) return { ...none, skipped };
    const file = path.join(dir, `${turnId}.mcp.json`);
    if (!SAFE_PATH.test(file)) {
      return { ...none, skipped: [...skipped, ...servers.map((item) => ({ name: item.connector, reason: "The settings folder path has characters the CLI cannot take." }))] };
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: config }, null, 2), { mode: 0o600 });
    return { file, servers, skipped, release: () => rmSync(file, { force: true }) };
  }

  return { sync, attach };
}
