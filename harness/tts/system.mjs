import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const SAY = "/usr/bin/say";
const execFileAsync = promisify(execFile);

export function systemVoicesAvailable(platform = process.platform) {
  return platform === "darwin";
}

export function parseVoiceList(stdout) {
  const voices = [];
  for (const line of stdout.split("\n")) {
    const match = /^(.+?)\s{2,}(\S+)\s+#\s*(.+)$/.exec(line.trimEnd());
    if (!match) continue;
    const id = match[1].trim();
    if (!id) continue;
    voices.push({ id, label: id, description: `${match[2]} — ${match[3].trim()}` });
  }
  return voices;
}

export async function listSystemVoices() {
  if (!systemVoicesAvailable()) return [];
  try {
    const { stdout } = await execFileAsync(SAY, ["-v", "?"], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
    return parseVoiceList(stdout);
  } catch {
    return [];
  }
}

export async function synthesizeSystem(text, voiceId) {
  if (!systemVoicesAvailable()) throw new Error("Mac system voices are only available on macOS.");
  const trimmed = text.trim();
  if (!trimmed) return { bytes: new Uint8Array(), mime: "audio/wav" };
  const dir = await mkdtemp(join(tmpdir(), "sandbench-say-"));
  const out = join(dir, "utterance.wav");
  try {
    const args = ["-o", out, "--data-format=LEI16@22050"];
    if (voiceId?.trim()) args.push("-v", voiceId.trim());
    args.push(trimmed);
    await execFileAsync(SAY, args, { timeout: 30_000 });
    return { bytes: new Uint8Array(await readFile(out)), mime: "audio/wav" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
