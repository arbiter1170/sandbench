// HTTP driver: an OpenAI-compatible chat completions loop with one tool, run_command.
// The model asks for a command, the user approves it on a card, the harness runs it,
// and the output goes back to the model until it answers without a tool call.
export const id = "http";
export const label = "OpenAI-compatible tools";

const MAX_STEPS = 6;
const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run one PowerShell command in the user's workspace folder on their Windows computer. The user approves every command before it runs. Returns the exit code and output.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "One PowerShell command." },
          reason: { type: "string", description: "One sentence on what it does and why." },
        },
        required: ["command"],
      },
    },
  },
];

export async function available() {
  return { ok: true, detail: "Uses the bot's model and API key." };
}

export function baseUrl(base) {
  const trimmed = String(base || "").trim().replace(/\/$/, "");
  if (!trimmed || trimmed === "/api-proxy/v1" || trimmed === "/api-proxy") return "https://api.x.ai/v1";
  if (trimmed.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(trimmed)) return trimmed;
  throw new Error("The API base URL must start with https:// or point at this computer.");
}

export function normalizeEvent(raw) {
  const choice = raw?.choices?.[0];
  if (!choice) return [];
  const out = [];
  const delta = choice.delta ?? choice.message ?? {};
  if (typeof delta.content === "string" && delta.content) out.push({ type: "message_delta", text: delta.content });
  for (const call of delta.tool_calls ?? []) {
    out.push({
      type: "tool_call_delta",
      index: Number.isInteger(call.index) ? call.index : 0,
      callId: call.id,
      name: call.function?.name,
      args: call.function?.arguments ?? "",
    });
  }
  return out;
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
        // A partial chunk waits for the next line.
      }
    }
  }
}

async function step(turn, messages, io) {
  const response = await fetch(`${baseUrl(turn.base)}/chat/completions`, {
    method: "POST",
    signal: io.signal,
    headers: { Authorization: `Bearer ${turn.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: turn.model || "grok-3", stream: true, messages, tools: TOOLS }),
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
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json") && !type.includes("text/event-stream")) {
    normalizeEvent(await response.json()).forEach(take);
  } else {
    for await (const raw of sseData(response)) normalizeEvent(raw).forEach(take);
  }
  return { text, calls: calls.filter(Boolean) };
}

export function startTurn(turn, io) {
  const done = (async () => {
    if (!String(turn.key || "").trim()) throw new Error("This driver needs an API key in Settings.");
    const messages = [{ role: "system", content: turn.system }, ...turn.history, { role: "user", content: turn.prompt }];
    io.emit({ type: "thinking", text: `Ask ${turn.model || "grok-3"} with the run_command tool.` });
    for (let index = 0; index < MAX_STEPS; index += 1) {
      const { text, calls } = await step(turn, messages, io);
      if (calls.length === 0) return;
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((call, n) => ({ id: call.id || `call_${index}_${n}`, type: "function", function: { name: call.name, arguments: call.args } })),
      });
      for (const [n, call] of calls.entries()) {
        const callId = call.id || `call_${index}_${n}`;
        let args = {};
        try {
          args = JSON.parse(call.args || "{}");
        } catch {
          // Unparseable arguments are reported back to the model below.
        }
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
        messages.push({ role: "tool", tool_call_id: callId, content: result });
      }
      io.emit({ type: "thinking", text: "Send the result back to the model." });
    }
    io.emit({ type: "thinking", text: `Stopped after ${MAX_STEPS} steps.` });
  })();
  return { done, interrupt: () => undefined };
}
