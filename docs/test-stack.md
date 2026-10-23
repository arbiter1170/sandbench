# Test stack profiles

Sandbench can route each bot through **xAI**, **Claude (API or Code CLI)**, or **free OpenAI-compatible** backends. Use **Settings → Test stack** for defaults and the **Test profile** dropdown on each bot to switch quickly.

## Profiles

| Profile | What to configure | Agent driver |
|---------|-------------------|--------------|
| **xAI** | xAI API key; keep dev proxy on for `api.x.ai` | Built-in planner or HTTP on xAI |
| **Claude API** | [Anthropic console](https://console.anthropic.com) API key (billing separate from consumer Claude subscription) | Anthropic (API) |
| **Claude Code (CLI)** | Install the **Claude Code CLI** (`npm i -g @anthropic-ai/claude-code`), run `claude` once and complete `/login`, ensure `claude` is on PATH (or set `SANDBENCH_CLAUDE_BIN`), **restart the harness**. Claude Desktop is a different app and does not count. | Claude Code (local CLI) |
| **Ollama (local)** | [Ollama](https://ollama.com) running; `ollama pull llama3.1` (or another tool-capable model); compat key can be `ollama` | OpenAI-compatible tools |
| **Groq (free tier)** | [Groq](https://console.groq.com) API key in the **compat key** field. Model menu lists `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.6-27b` (`llama-3.3-70b-versatile` was removed from free accounts). | OpenAI-compatible tools |

Readiness hints under each profile in Settings list what is still missing.

Call mode (the Call button on a bot chat) uses the browser speech APIs in Chrome or Edge on localhost. The first Call may show a microphone prompt for `127.0.0.1` / `localhost`—allow it. After a reply, including one from an agent driver on these profiles, the microphone opens again until you end the call. Recognition needs internet in Chrome/Edge.

## Switching

1. **Default for new bots** — Settings → Test stack → pick a profile or **Set as default** on a row.
2. **This bot only** — Inspector → **Test profile** dropdown.
3. **Side-by-side** — Pin two bots and give each a different profile.

Ollama, Groq, and mock URLs share one global **OpenAI-compatible base URL**. Switching profiles may ask to overwrite that URL.

## Mock server (no cloud, agent smoke test)

```bash
npm run mock-openai
```

In Settings (or apply the **mock** profile manually):

- Base URL: `http://127.0.0.1:11435/v1`
- Key: `mock`
- Model: `mock-tools`
- Bot: OpenAI-compatible provider, Agent **OpenAI-compatible tools**, harness running

The mock server returns one `run_command` (`Get-Date`) then a short final message after the tool result.

## Harness

Computer use and agent drivers need the harness:

```bash
npm run harness
```

Restart it after installing Claude Code or changing `harness/drivers/`.

## Grok import

```bash
npm run import-grok
```

Then **Team → Import migration pack** in the app.
