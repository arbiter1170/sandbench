const API = (process.env.SANDBENCH_FISH_AUDIO_API || "https://api.fish.audio").replace(/\/+$/, "");
export const DEFAULT_FISH_MODEL = "s2.1-pro";

async function safeBody(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  } catch {
    return null;
  }
}

function errorMessage(status, action, body) {
  const detail =
    (typeof body?.detail === "string" && body.detail) ||
    (typeof body?.message === "string" && body.message) ||
    "";
  if (status === 401 || status === 403) return "Fish Audio rejected that API key.";
  if (status === 402) return detail || "Fish Audio says this account has insufficient balance.";
  if (status === 429) return detail || "Fish Audio is rate-limiting this account.";
  return detail ? `${action} failed: ${detail}` : `${action} failed (${status})`;
}

export async function listVoices(key) {
  const res = await fetch(`${API}/model?page_size=100&self=true&sort_by=created_at`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await safeBody(res);
  if (!res.ok) throw new Error(errorMessage(res.status, "listing voices", body));
  const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
  return items
    .filter((item) => item && item.type === "tts" && item.state === "trained" && typeof item._id === "string")
    .map((item) => ({
      id: item._id,
      label: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Voice",
      description: typeof item.description === "string" ? item.description.slice(0, 240) : undefined,
    }));
}

export async function synthesize(text, voiceId, key, model = DEFAULT_FISH_MODEL) {
  const res = await fetch(`${API}/v1/tts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "audio/mpeg",
      model,
    },
    body: JSON.stringify({
      text,
      reference_id: voiceId,
      format: "mp3",
      sample_rate: 44_100,
      mp3_bitrate: 64,
      latency: "normal",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(errorMessage(res.status, "speaking", await safeBody(res)));
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: "audio/mpeg" };
}
