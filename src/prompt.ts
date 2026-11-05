// Ordered system prompt for a bot turn: soul → instructions → channel → plugins → memories → files.
import type { Bot } from "./types";

/** A bot's harness memory files as one prompt section; each file is cut to 6,000 characters. */
export function memoryDocument(files: { path: string; content: string }[]): string {
  return files
    .slice(0, 8)
    .map((file) => `## ${file.path}\n${file.content.slice(0, 6000)}`)
    .join("\n\n")
    .slice(0, 24_000);
}

export function assembleBotSystem(input: {
  bot: Bot;
  sharedInstructions?: string;
  pluginLines?: string[];
  skillLines?: string[];
  memoryDoc?: string;
  libraryLines?: string[];
  footer?: string;
}): string {
  const { bot } = input;
  const soul = (bot.soul ?? bot.persona).trim();
  return [
    `You are ${bot.name}, ${bot.role}.`,
    soul ? `Soul:\n${soul}` : "",
    bot.persona.trim() && bot.soul?.trim() && bot.persona.trim() !== bot.soul.trim()
      ? `Persona note:\n${bot.persona.trim()}`
      : "",
    bot.instructions.trim() ? `Instructions:\n${bot.instructions.trim()}` : "",
    input.sharedInstructions?.trim() ? `Shared instructions for this group chat:\n${input.sharedInstructions.trim()}` : "",
    input.pluginLines?.length ? `Plugins:\n${input.pluginLines.map((line) => `- ${line}`).join("\n")}` : "",
    input.skillLines?.length ? `Skills:\n${input.skillLines.map((line) => `- ${line}`).join("\n")}` : "",
    bot.memories.length ? `Memories:\n${bot.memories.map((item) => `- ${item}`).join("\n")}` : "",
    input.memoryDoc?.trim() ? `Memory documents:\n${input.memoryDoc.trim()}` : "",
    input.libraryLines?.length ? `Files:\n${input.libraryLines.join("\n\n")}` : "",
    input.footer?.trim() || "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
