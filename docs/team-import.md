# Team import

## Sandbench Markdown

Team → Share → **Export team** writes `sandbench-team.md` (bots only; no chats, files, memories, or secrets). **Import team** reads that format.

## OpenMausBot Markdown (subset)

**Import OpenMaus Markdown** (or CLI below) accepts a BotMRR-style file:

- Optional YAML frontmatter with `name`, `tagline` / `summary`, and an `agents:` list (`key` / `name`, `title`, `description`, optional `color`).
- Or `## Bot Name` sections with `### Instructions` / `### Persona` (same as Sandbench Markdown).

Unknown fields are ignored. Chats, secrets, MCP credentials, and full playbook trees are **not** imported.

### CLI

```bash
node scripts/import-openmaus-team.mjs path/to/team.md sandbench-team-from-openmaus.json
```

Then use Team → **Import team file** on the JSON, or open the Markdown in the UI.
