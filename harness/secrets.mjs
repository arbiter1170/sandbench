// Write-only secret store shared by the local harness and the hosted runner (SB-05).
// Values come from the process environment or a 0600 JSON file, and they never leave
// this process: list() returns only names, a short preview and the scope. The file is
// re-read on every lookup, so a key rotated on disk is used by the next call without a
// restart or a UI redeploy.
//
// File shape: { "secrets": { "ANTHROPIC_API_KEY": { "value": "...", "scope": "shared", "updatedAt": 0 } } }
// Scope is "shared" (any agent and the owner's page) or an agent slug (only that agent
// and the owner's page). An environment variable with the same name wins over the file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const SCOPE = /^(shared|[a-z0-9][a-z0-9-]{0,62})$/;
const MAX_VALUE = 8 * 1024;

/** The keys the page used to keep in Settings, and the names they live under now. */
export const KNOWN_SECRETS = {
  XAI_API_KEY: "xAI API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  COMPAT_API_KEY: "OpenAI-compatible API key",
  DECISION_API_KEY: "Decision model (OpenRouter) key",
  ELEVENLABS_API_KEY: "ElevenLabs key",
  FISH_API_KEY: "Fish Audio key",
};

export function preview(value) {
  const text = String(value || "");
  if (text.length < 12) return "set";
  return `${text.slice(0, 4)}…${text.slice(-2)}`;
}

export function createSecretStore({ file, env = process.env, envPrefix = "" } = {}) {
  function readFile() {
    if (!file || !existsSync(file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return parsed && typeof parsed.secrets === "object" && parsed.secrets ? parsed.secrets : {};
    } catch {
      return {};
    }
  }

  function writeFile(secrets) {
    if (!file) throw new Error("This store has no secrets file; set the value in the environment instead.");
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ secrets }, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }

  function fromEnv(name) {
    const value = env[`${envPrefix}${name}`];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function entry(name) {
    const envValue = fromEnv(name);
    if (envValue) return { value: envValue, scope: "shared", source: "env", updatedAt: 0 };
    const item = readFile()[name];
    if (!item || typeof item.value !== "string" || !item.value) return null;
    return { value: item.value, scope: SCOPE.test(item.scope || "") ? item.scope : "shared", source: "file", updatedAt: Number(item.updatedAt) || 0 };
  }

  return {
    /** Names, previews and scopes only. Never values. */
    list() {
      const names = new Set(Object.keys(readFile()).filter((name) => NAME.test(name)));
      for (const name of Object.keys(KNOWN_SECRETS)) if (fromEnv(name)) names.add(name);
      return [...names]
        .sort()
        .map((name) => {
          const item = entry(name);
          return item ? { name, preview: preview(item.value), scope: item.scope, source: item.source, updatedAt: item.updatedAt } : null;
        })
        .filter(Boolean);
    },

    /**
     * The value for server-side use. `agent` is the slug of the agent asking; without it the
     * caller is the signed-in owner. A secret scoped to one agent is hidden from the others.
     */
    get(name, { agent } = {}) {
      if (!NAME.test(String(name))) return null;
      const item = entry(name);
      if (!item) return null;
      if (agent && item.scope !== "shared" && item.scope !== agent) return null;
      return item.value;
    },

    set(name, value, scope = "shared") {
      if (!NAME.test(String(name))) throw new Error("Secret names use capital letters, digits and _ (for example ANTHROPIC_API_KEY).");
      if (typeof value !== "string" || !value.trim()) throw new Error("No secret value.");
      if (value.length > MAX_VALUE) throw new Error("That secret is too long.");
      if (!SCOPE.test(String(scope))) throw new Error("Scope is shared or an agent slug.");
      if (fromEnv(name)) throw new Error(`${name} is set in the server environment; change it there.`);
      const secrets = readFile();
      secrets[name] = { value: value.trim(), scope, updatedAt: Date.now() };
      writeFile(secrets);
      return { name, preview: preview(value.trim()), scope, source: "file", updatedAt: secrets[name].updatedAt };
    },

    remove(name) {
      if (fromEnv(name)) throw new Error(`${name} is set in the server environment; remove it there.`);
      const secrets = readFile();
      if (!secrets[name]) return false;
      delete secrets[name];
      writeFile(secrets);
      return true;
    },

    /** Fill {{NAME}} placeholders (connector headers) on the server. Unknown names stay as they are. */
    fill(template, opts) {
      return String(template).replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (match, name) => this.get(name, opts) ?? match);
    },
  };
}
