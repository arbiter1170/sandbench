#!/usr/bin/env node
// Minimal OpenAI-compatible server for Sandbench http driver testing (run_command tool loop).
import http from "node:http";

const PORT = Number(process.env.SANDBENCH_MOCK_PORT || 11435);
const HOST = "127.0.0.1";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function wantsStream(body) {
  return Boolean(body.stream);
}

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return String(messages[i].content ?? "");
  }
  return "";
}

function hasToolResults(messages) {
  return messages.some((item) => item.role === "tool");
}

function sseToolThenAnswer(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const id = "call_mock_1";
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name: "run_command", arguments: "" } }] } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command: "Get-Date", reason: "Mock server asks for the clock." }) } }],
          },
        },
      ],
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function sseFinalText(res, text) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function handleChat(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolMode = tools.some((item) => item?.function?.name === "run_command");
  if (toolMode && !hasToolResults(messages)) {
    return { stream: "tool" };
  }
  const note = lastUser(messages).slice(0, 120);
  return {
    stream: "text",
    text: `Mock model finished.${note ? ` You asked: ${note}` : ""} Exit code from the harness is in the tool message above.`,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON." });
      }
      const plan = handleChat(body);
      if (wantsStream(body)) {
        if (plan.stream === "tool") return sseToolThenAnswer(res);
        return sseFinalText(res, plan.text);
      }
      if (plan.stream === "tool") {
        return json(res, 200, {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_mock_1",
                    type: "function",
                    function: {
                      name: "run_command",
                      arguments: JSON.stringify({ command: "Get-Date", reason: "Mock server asks for the clock." }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      }
      return json(res, 200, { choices: [{ message: { role: "assistant", content: plan.text }, finish_reason: "stop" }] });
    });
    return;
  }
  json(res, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`Mock OpenAI tools server on http://${HOST}:${PORT}/v1`);
  console.log("Settings compat base: http://127.0.0.1:" + PORT + "/v1  key: mock  model: mock-tools");
});
