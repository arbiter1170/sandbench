export const DEFAULT_MODEL = "chatterbox-turbo";
export const FALLBACK_VOICES = [{ id: "default", label: "Default", description: "built-in Chatterbox voice" }];

export function apiRoot(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function listChatterboxVoices(baseUrl) {
  try {
    const res = await fetch(`${apiRoot(baseUrl)}/audio/voices`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const body = await safeJson(res);
      const voices = (body?.voices ?? [])
        .map((entry) => {
          if (typeof entry === "string") return { id: entry, label: entry };
          const id = String(entry?.filename ?? entry?.id ?? "");
          return { id, label: String(entry?.display_name ?? entry?.name ?? id) };
        })
        .filter((v) => v.id);
      if (voices.length) return voices;
    }
  } catch {
    // fall through
  }
  return FALLBACK_VOICES;
}

export async function synthesizeChatterbox(text, voiceId, baseUrl, model) {
  const res = await fetch(`${apiRoot(baseUrl)}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/wav" },
    body: JSON.stringify({
      model: model?.trim() || DEFAULT_MODEL,
      input: text,
      voice: voiceId,
      response_format: "wav",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.message || body?.detail || `Chatterbox speak failed (${res.status})`);
  }
  const header = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const mime =
    header === "audio/mpeg" || header === "audio/mp3"
      ? "audio/mpeg"
      : header.startsWith("audio/")
        ? header
        : "audio/wav";
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
}
