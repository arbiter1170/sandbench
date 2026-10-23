# Wave A — TTS, soul/memory, skills, bot settings, native control

## Speech

Settings → Speech chooses browser, xAI, ElevenLabs, Fish Audio, Chatterbox, or macOS `say`. Hosted audio goes through the local harness (`/tts/voices`, `/tts/speak`). Call and spoken replies use the shared `speakable()` cleaner (code fences → spoken placeholders, links shortened, emoji stripped).

## Soul + MEMORY.md

Customize → Soul edits `soul` (mirrored to `~/.sandbench/bots/<id>/SOUL.md` when the harness is up). Rollback restores the previous revision from `soulHistory`. Memory documents live under the same bot folder (`MEMORY.md`, `memory/*.md`, `memory/log/YYYY-MM-DD.md`) and are injected into the system prompt on turns.

## Skills library

Folders with `SKILL.md` under `~/.sandbench/skills/` appear in Customize after Refresh. Assign via checkboxes (`librarySkillIds`). A sample `workspace-notes` skill is seeded on harness start. Org/cloud skills are out of scope.

## Bot settings

Per-bot approval mode (`ask` / `auto` / `full`), visibility (`team` / `hidden` / `primary_only`), usage counters, and soul rollback live on the Customize tab.

## Native control (not full CUA)

| Platform | Screen | Pointer |
|----------|--------|---------|
| Windows | PowerShell capture | Built-in click/type/key |
| macOS | `screencapture` | `cliclick` or AppleScript System Events |
| Linux | ImageMagick `import`, `gnome-screenshot`, or `scrot` | `xdotool` |

This is not OpenMausBot’s Electron `cua-driver` (no accessibility tree, no viewport model). Install optional tools on macOS/Linux for pointer reliability.
