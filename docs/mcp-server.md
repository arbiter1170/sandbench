# Sandbench MCP server

A small stdio MCP server that talks to the **local harness** (`127.0.0.1:8799`) with the harness token. Do not expose the harness beyond localhost.

## Run

```bash
npm run harness   # terminal 1 — writes .harness-token
npm run mcp       # terminal 2 — or point Cursor at this script
```

Environment:

| Variable | Purpose |
|----------|---------|
| `SANDBENCH_URL` | Harness origin (default `http://127.0.0.1:8799`) |
| `SANDBENCH_HARNESS_TOKEN` | Token (else reads `.harness-token` or `~/.sandbench/harness-token`) |
| `SANDBENCH_TEAM_FILE` | Path for `list_bots` (default `./sandbench-team.json`) |

## Cursor MCP config example

```json
{
  "mcpServers": {
    "sandbench": {
      "command": "node",
      "args": ["C:/Users/you/rea-work/grokbot-poc/scripts/mcp-server.mjs"],
      "env": {
        "SANDBENCH_URL": "http://127.0.0.1:8799"
      }
    }
  }
}
```

## Tools

- `health` — harness `/health`
- `list_bots` — bots from an exported team JSON file
- `send_message` — `POST /agent/turn` (driver required; approvals denied when unattended)
- `get_screen` — JPEG of the primary display

Security: the harness refuses non-loopback hosts and requires `x-sandbench-token`. Never put that token in a public repo or remote MCP host.
