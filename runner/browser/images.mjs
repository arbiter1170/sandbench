// Where screenshots go (SB-13). `saveImage({ outDir, name, buffer })` returns `{ path, bytes }`.
// Today it writes a file into the agent's own folder; attachments (SB-18) will plug in a second
// implementation with the same shape, so the screenshot code doesn't change.
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export async function fileSaver({ outDir, name, buffer }) {
  if (typeof outDir !== "string" || !outDir || !existsSync(outDir) || !statSync(outDir).isDirectory()) {
    throw new Error("The screenshot folder does not exist.");
  }
  // basename: a name can never climb out of outDir.
  const file = path.join(outDir, path.basename(String(name)));
  writeFileSync(file, buffer);
  return { path: file, bytes: buffer.length };
}
