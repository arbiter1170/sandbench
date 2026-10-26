// API keys live on the local harness or the hosted runner, never in the page, IndexedDB
// sync or Firestore (SB-05). The page can add or remove a key and sees only its name, a
// short preview and its scope.
import { harnessCall } from "./harness";
import type { Snapshot } from "./types";

export type SecretInfo = { name: string; preview: string; scope: string; source: "env" | "file"; updatedAt: number };

/** The Settings fields that used to hold keys, and the server-side names they move to. */
export const LEGACY_SETTINGS_KEYS = {
  apiKey: "XAI_API_KEY",
  anthropicKey: "ANTHROPIC_API_KEY",
  compatKey: "COMPAT_API_KEY",
  decisionKey: "DECISION_API_KEY",
  elevenLabsKey: "ELEVENLABS_API_KEY",
  fishKey: "FISH_API_KEY",
} as const;

export type SecretName = (typeof LEGACY_SETTINGS_KEYS)[keyof typeof LEGACY_SETTINGS_KEYS];

export function listSecrets(): Promise<SecretInfo[]> {
  return harnessCall<{ secrets: SecretInfo[] }>("/secrets").then((body) => body.secrets);
}

export function saveSecret(name: string, value: string, scope = "shared"): Promise<SecretInfo> {
  return harnessCall<SecretInfo>(`/secrets/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ value, scope }) });
}

export function removeSecret(name: string): Promise<{ ok: boolean }> {
  return harnessCall<{ ok: boolean }>(`/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export type LegacySecret = { name: string; value: string };

/**
 * Pull key values out of a snapshot (old Settings fields and Studio secret values) and
 * return the snapshot without them. Runs on every snapshot the page loads or uploads, so a
 * Firestore document written by an older build loses its keys on the next save.
 */
export function extractLegacySecrets(snapshot: Snapshot): { snapshot: Snapshot; found: LegacySecret[] } {
  const found: LegacySecret[] = [];
  const settings = { ...(snapshot.settings as unknown as Record<string, unknown>) };
  for (const [field, name] of Object.entries(LEGACY_SETTINGS_KEYS)) {
    const value = settings[field];
    if (typeof value === "string" && value.trim() && value.trim() !== "mock") found.push({ name, value: value.trim() });
    delete settings[field];
  }
  const studio = snapshot.studio
    ? {
        ...snapshot.studio,
        secrets: (snapshot.studio.secrets ?? []).map((secret) => {
          const { value, ...rest } = secret as typeof secret & { value?: unknown };
          if (typeof value === "string" && value.trim()) found.push({ name: secret.name, value: value.trim() });
          return rest;
        }),
      }
    : snapshot.studio;
  return { snapshot: { ...snapshot, settings: settings as unknown as Snapshot["settings"], studio }, found };
}

/**
 * Move found keys into the server store. A key the server already has (from its file or
 * its environment) wins over an old copy from this browser, so a stale device never
 * overwrites a rotated key. Returns the ones that could not be saved (no harness or
 * runner reachable); the caller keeps those on this device only until a later try works.
 */
export async function moveLegacySecrets(found: LegacySecret[]): Promise<LegacySecret[]> {
  const existing = await listSecrets().catch(() => null);
  if (!existing) return found;
  const stored = new Set(existing.map((item) => item.name));
  const left: LegacySecret[] = [];
  for (const secret of found) {
    if (stored.has(secret.name)) continue;
    try {
      await saveSecret(secret.name, secret.value);
    } catch {
      left.push(secret);
    }
  }
  return left;
}
