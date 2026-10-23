const API = (process.env.SANDBENCH_ELEVENLABS_API || "https://api.elevenlabs.io/v1").replace(/\/+$/, "");
const MODEL = "eleven_flash_v2_5";
const FORMAT = "mp3_44100_64";

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function message(status, what, body) {
  const theirs =
    (typeof body?.detail === "string" && body.detail.trim()) ||
    (typeof body?.detail?.message === "string" && body.detail.message.trim()) ||
    (typeof body?.message === "string" && body.message.trim()) ||
    "";
  if (status === 401 || status === 403) return "ElevenLabs rejected that key.";
  if (status === 429) return theirs || "ElevenLabs is rate-limiting this account.";
  if (status === 402) return theirs || "ElevenLabs says this account is out of credit.";
  return theirs ? `${what} failed: ${theirs}` : `${what} failed (${status})`;
}

export async function listVoices(key) {
  const res = await fetch(`${API}/voices`, {
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await safeJson(res);
  if (!res.ok) throw new Error(message(res.status, "listing voices", body));
  return (body?.voices ?? [])
    .map((v) => ({
      id: String(v.voice_id ?? ""),
      label: String(v.name ?? "Voice"),
      description: [v.labels?.accent, v.labels?.description].filter(Boolean).join(" · ") || undefined,
    }))
    .filter((v) => v.id);
}

export async function synthesize(text, voiceId, key) {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(message(res.status, "speaking", await safeJson(res)));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) throw new Error("ElevenLabs returned empty audio.");
  return { bytes, mime: "audio/mpeg" };
}
