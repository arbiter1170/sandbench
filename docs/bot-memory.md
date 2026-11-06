# Bot memory

Each bot has a memory folder on the computer running the local harness: `~/.sandbench/bots/<bot id>/`. At the start of a turn the page reads it (`GET /bots/<id>/memory`) and puts it into the bot's system prompt under "Memory documents". That covers `MEMORY.md`, `memory/*.md` and up to 14 day logs from `memory/log/`. At most 8 files go in, each cut to 6,000 characters: `MEMORY.md` first, then the newest day log, then the other memory files, then older logs, newest first. The section says the notes are information, not instructions.

Which turns read it: agent-driver turns (Claude Code, Codex, Grok CLI) always do. A planner reply with a model key reads it in the step that picks the next action (the first step and each one after a result) and in the plain-reply fallback. Without a model key, the built-in planner does not read it. A routine or webhook the model proposes is created only when your own message asks for something that repeats, so a schedule written in a note cannot set one up.

There are three ways to change a file, and they are kept apart on purpose:

| | Who starts it | Route | What it may touch | Approval |
|---|---|---|---|---|
| Workspace file edit | the bot (a "file" card) | `POST /workspace/write` | files under `~/.sandbench/workspace` | a card, every time |
| Memory panel | the person, in the bot's Memory panel | `POST /bots/<id>/memory` | `MEMORY.md`, `memory/<name>.md`, `memory/log/<date>.md`: write or delete | the person is the one editing |
| Bot memory save | the bot (a "memory" card) | `POST /bots/<id>/memory/save` | appends one line to that bot's `memory/log/<today>.md` | a card, every time; no approval mode or auto-review rule skips it |

## Bot memory saves

A bot proposes a note in one of two ways:
- With a model key, the model replies with `{"kind":"memory","note":"…"}`.
- Without one, the request starts with "remember that …" or "remember: …". Questions and "remember to …" don't count.

The card shows the note and the file it goes into. Nothing is written until the person approves, and a denied card writes nothing.

When the person approves:
- The page sends the note with the card's message id, for the bot that wrote the card. The model can't name another bot or a path.
- The harness appends `- <note> <!-- save:<card id> -->` to `memory/log/<today>.md`. A retry with the same card id finds the marker and adds nothing.
- Nothing already in the folder is rewritten, moved or deleted.

The harness refuses a save, and writes nothing, when:
- the bot id is not plain letters, digits, `-` or `_`;
- the save id is not hex;
- the note is empty, over 1,000 characters, has control characters, invisible characters (format, private-use or unassigned code points, such as tag characters or bidi overrides) or comment markers, is not in NFC form, or looks like an API key or token;
- the day's log would pass 6,000 characters;
- any folder on the way, or the log itself, is a symlink.

Later turns read the log like any other memory file, as described at the top.

## Where it works

- **Local harness:** all of the above.
- **Runner (`VITE_RUNNER_URL`):** the runner has no memory-save route yet, so the card shows as unavailable and nothing is sent. Memory in runner mode belongs to SB-08 and is not covered here.
- **Agent drivers (Claude Code, Codex, Grok CLI):** they read memory through the system prompt but can't propose a memory card. Their own file tools go through their own permission prompts, not this route.
