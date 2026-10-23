// xAI Grok TTS — list voices and synthesize MP3 (ported from OpenMausBot/server/tts/grok.ts).

const API = (process.env.SANDBENCH_XAI_TTS_API || process.env.OMB_XAI_TTS_API || "https://api.x.ai/v1").replace(/\/+$/, "");

function refusal(status) {
  if (status === 401 || status === 403) return "xAI rejected the key or its TTS permissions.";
  if (status === 402) return "The xAI account needs credits to generate speech.";
  if (status === 429) return "xAI is rate-limiting speech.";
  if (status === 404) return "xAI could not find that voice.";
  return `Grok voice failed (HTTP ${status}).`;
}

async function request(path, init) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...init, redirect: "error" });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Grok voice timed out.");
    }
    throw new Error("Could not reach Grok voice.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(refusal(response.status));
  }
  return response;
}

export async function listVoices(key) {
  const response = await request("/tts/voices", {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  const voices = Array.isArray(body?.voices) ? body.voices : [];
  return voices
    .filter((v) => typeof v?.voice_id === "string" && typeof v?.name === "string")
    .map((voice) => ({
      id: voice.voice_id,
      label: voice.name,
      description: typeof voice.description === "string" ? voice.description : undefined,
    }));
}

export async function synthesize(text, voiceId, key) {
  const response = await request("/tts", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, voice_id: voiceId, language: "auto", output_format: { codec: "mp3" } }),
    signal: AbortSignal.timeout(60_000),
  });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "audio/mpeg" && mime !== "audio/mp3") {
    await response.body?.cancel();
    throw new Error("Grok returned an unexpected audio format.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Grok returned empty audio.");
  return { bytes, mime: "audio/mpeg" };
}
