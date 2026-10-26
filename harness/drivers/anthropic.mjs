// Anthropic Messages API driver with one tool, run_command (same approval flow as http.mjs).
export const id = "anthropic";
export const label = "Anthropic (API)";

const MAX_STEPS = 6;
const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
const TOOLS = [
  {
    name: "run_command",
    description:
      "Run one PowerShell command in the user's workspace folder on their Windows computer. The user approves every command before it runs. Returns the exit code and output.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "One PowerShell command." },
        reason: { type: "string", description: "One sentence on what it does and why." },
      },
      required: ["command"],
    },
  },
];

export async function available() {
  return { ok: true, detail: "Uses the Anthropic API key from Settings." };
}

function normalizeEvent(raw) {
  if (raw.type === "content_block_delta" && raw.delta?.type === "text_delta" && raw.delta.text) {
    return [{ type: "message_delta", text: raw.delta.text }];
  }
  if (raw.type === "content_block_start" && raw.content_block?.type === "tool_use") {
    return [{ type: "tool_call_delta", index: raw.index ?? 0, callId: raw.content_block.id, name: raw.content_block.name, args: "" }];
  }
  if (raw.type === "content_block_delta" && raw.delta?.type === "input_json_delta" && raw.delta.partial_json) {
    return [{ type: "tool_call_delta", index: raw.index ?? 0, args: raw.delta.partial_json }];
  }
  if (raw.type === "message_delta" && raw.delta?.stop_reason === "end_turn") return [];
  return [];
}

async function* sseData(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // Partial SSE chunk.
      }
    }
  }
}

function toAnthropicHistory(history) {
  return history.map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content }));
}

async function step(turn, messages, io) {
  const response = await fetch(API, {
    method: "POST",
    signal: io.signal,
    headers: {
      "x-api-key": turn.key,
      "anthropic-version": VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: turn.model || "claude-sonnet-5",
      max_tokens: 4096,
      system: turn.system,
      messages,
      tools: TOOLS,
      stream: true,
    }),
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 280) || `The model request failed (${response.status}).`);
  let text = "";
  const calls = [];
  const take = (event) => {
    if (event.type === "message_delta") {
      text += event.text;
      io.emit(event);
      return;
    }
    const call = (calls[event.index] ??= { id: "", name: "", args: "" });
    if (event.callId) call.id = event.callId;
    if (event.name) call.name = event.name;
    call.args += event.args;
  };
  for await (const raw of sseData(response)) normalizeEvent(raw).forEach(take);
  return { text, calls: calls.filter((c) => c.name || c.args) };
}

export function startTurn(turn, io) {
  const done = (async () => {
    if (!String(turn.key || "").trim()) throw new Error("Add ANTHROPIC_API_KEY under Settings > Keys; it is kept on the harness or runner, not in the page.");
    let messages = [...toAnthropicHistory(turn.history), { role: "user", content: turn.prompt }];
    io.emit({ type: "thinking", text: `Ask ${turn.model || "Claude"} with the run_command tool.` });
    for (let index = 0; index < MAX_STEPS; index += 1) {
      const { text, calls } = await step(turn, messages, io);
      if (calls.length === 0) return;
      const parsed = calls.map((call) => {
        try {
          return JSON.parse(call.args || "{}");
        } catch {
          return {};
        }
      });
      const blocks = [];
      if (text) blocks.push({ type: "text", text });
      for (const [n, call] of calls.entries()) {
        blocks.push({ type: "tool_use", id: call.id || `tool_${index}_${n}`, name: call.name, input: parsed[n] ?? {} });
      }
      messages.push({ role: "assistant", content: blocks.length === 1 && blocks[0].type === "text" ? text : blocks });
      const toolResults = [];
      for (const [n, call] of calls.entries()) {
        const toolId = call.id || `tool_${index}_${n}`;
        const args = parsed[n] ?? {};
        const command = typeof args.command === "string" ? args.command.trim() : "";
        let result;
        if (call.name !== "run_command" || !command) {
          result = `Unknown tool or missing command: ${call.name}.`;
        } else if (!(await io.requestPermission({ command, reason: typeof args.reason === "string" ? args.reason : "" }))) {
          result = "The user denied this command. Do not run it again; answer with what you know or suggest another step.";
        } else {
          const run = await io.runCommand(command);
          result = JSON.stringify({ exitCode: run.code, stdout: run.stdout.slice(0, 8000), stderr: run.stderr.slice(0, 2000) });
        }
        toolResults.push({ type: "tool_result", tool_use_id: toolId, content: result });
      }
      messages.push({ role: "user", content: toolResults });
      io.emit({ type: "thinking", text: "Send the result back to the model." });
    }
    io.emit({ type: "thinking", text: `Stopped after ${MAX_STEPS} steps.` });
  })();
  return { done, interrupt: () => undefined };
}
