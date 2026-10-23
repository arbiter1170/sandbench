import * as chatterbox from "./chatterbox.mjs";
import * as elevenlabs from "./elevenlabs.mjs";
import * as fish from "./fish.mjs";
import * as grok from "./grok.mjs";
import * as systemVoices from "./system.mjs";

export const TTS_PROVIDERS = ["browser", "xai", "elevenlabs", "fish", "chatterbox", "system"];

export async function listVoices(provider, opts = {}) {
  if (provider === "xai") {
    if (!opts.key) throw new Error("Missing xAI key.");
    return grok.listVoices(opts.key);
  }
  if (provider === "elevenlabs") {
    if (!opts.key) throw new Error("Missing ElevenLabs key.");
    return elevenlabs.listVoices(opts.key);
  }
  if (provider === "fish") {
    if (!opts.key) throw new Error("Missing Fish Audio key.");
    return fish.listVoices(opts.key);
  }
  if (provider === "chatterbox") {
    if (!opts.baseUrl?.trim()) throw new Error("Missing Chatterbox base URL.");
    return chatterbox.listChatterboxVoices(opts.baseUrl);
  }
  if (provider === "system") {
    if (!systemVoices.systemVoicesAvailable()) throw new Error("Mac system voices need macOS.");
    return systemVoices.listSystemVoices();
  }
  throw new Error(`Unknown TTS provider: ${provider}`);
}

export async function speak(provider, opts = {}) {
  const text = String(opts.text || "").slice(0, 500);
  const voiceId = String(opts.voiceId || "").trim();
  if (!text) throw new Error("Missing text.");
  if (!voiceId && provider !== "system") throw new Error("Missing voiceId.");

  if (provider === "xai") {
    if (!opts.key) throw new Error("Missing xAI key.");
    return grok.synthesize(text, voiceId, opts.key);
  }
  if (provider === "elevenlabs") {
    if (!opts.key) throw new Error("Missing ElevenLabs key.");
    return elevenlabs.synthesize(text, voiceId, opts.key);
  }
  if (provider === "fish") {
    if (!opts.key) throw new Error("Missing Fish Audio key.");
    return fish.synthesize(text, voiceId, opts.key, opts.fishModel || fish.DEFAULT_FISH_MODEL);
  }
  if (provider === "chatterbox") {
    if (!opts.baseUrl?.trim()) throw new Error("Missing Chatterbox base URL.");
    return chatterbox.synthesizeChatterbox(text, voiceId || "default", opts.baseUrl, opts.model);
  }
  if (provider === "system") {
    return systemVoices.synthesizeSystem(text, voiceId);
  }
  throw new Error(`Unknown TTS provider: ${provider}`);
}

export function providerMeta() {
  return {
    providers: TTS_PROVIDERS.filter((p) => p !== "browser"),
    systemAvailable: systemVoices.systemVoicesAvailable(),
  };
}
