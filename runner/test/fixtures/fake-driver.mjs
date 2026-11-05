// A scripted driver for the engine tests (SB-03 PR 2). It follows the driver contract in
// harness/drivers/index.mjs and does what its script says: emit text, ask for a permission, run a
// command, echo its key (to prove redaction), hang until released (to simulate a crash mid-turn),
// or fail. Every call is recorded so a test can assert what the engine passed in.
//
// A turn's script is picked by the first line of its prompt (`#<name>`), or `defaultScript`.
export function createFakeDriver({ id = "fake", scripts = {}, defaultScript = "reply" } = {}) {
  const calls = [];
  const holds = new Map(); // turn id -> release()
  const waiters = new Map(); // turn id -> resolve() when the turn is held
  let sessions = 0;

  function scriptFor(turn) {
    const match = /^#([\w-]+)/.exec(turn.prompt);
    return scripts[match?.[1] ?? defaultScript] ?? scripts[defaultScript] ?? [{ say: "ok" }];
  }

  function hold(turnId) {
    return new Promise((resolve) => {
      holds.set(turnId, resolve);
      waiters.get(turnId)?.();
    });
  }

  const driver = {
    id,
    label: "Fake driver",
    async available() {
      return { ok: true, detail: "fake" };
    },
    startTurn(turn, io) {
      const record = { turn: structuredClone({ ...turn, key: turn.key ? `<${turn.key.length} chars>` : "" }), rawKey: turn.key, events: [], permissions: [], commands: [], aborted: false };
      calls.push(record);
      const steps = scriptFor(turn);
      let stopped = false;
      const done = (async () => {
        const sessionId = `sess-${turn.id}-${++sessions}`;
        io.emit({ type: "session", sessionId });
        io.emit({ type: "thinking", text: `fake turn ${turn.extras?.resume ? `resumed ${turn.extras.resume}` : "started"}` });
        for (const step of steps) {
          if (stopped || io.signal?.aborted) throw new DOMException("Stopped.", "AbortError");
          if (step.say) io.emit({ type: "message_delta", text: step.say });
          if (step.echoKey) io.emit({ type: "message_delta", text: `key=${turn.key} Bearer ${turn.key}` });
          if (step.ask) {
            const allowed = await io.requestPermission({ command: step.ask, reason: step.reason ?? "fake asks", tool: step.tool });
            record.permissions.push({ command: step.ask, allowed });
            if (allowed && step.run !== false) {
              const result = await io.runCommand(step.ask);
              record.commands.push(result);
              io.emit({ type: "message_delta", text: ` [exit ${result.code}]` });
            } else if (!allowed) {
              io.emit({ type: "message_delta", text: " [denied]" });
            }
          }
          if (step.hang) {
            await Promise.race([
              hold(turn.id),
              new Promise((_, reject) => io.signal?.addEventListener("abort", () => reject(new DOMException("Stopped.", "AbortError")), { once: true })),
            ]);
          }
          if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
          if (step.fail) throw new Error(step.fail);
        }
      })();
      return {
        done,
        interrupt: () => {
          stopped = true;
          record.aborted = true;
        },
      };
    },
    normalizeEvent: () => [],
  };

  return {
    driver,
    calls,
    /** Resolves when the turn with this id reaches its `hang` step. */
    held: (turnId) => (holds.has(turnId) ? Promise.resolve() : new Promise((resolve) => waiters.set(turnId, resolve))),
    /** Lets a hanging turn continue. */
    release: (turnId) => {
      holds.get(turnId)?.();
      holds.delete(turnId);
    },
    driverById: (wanted) => (wanted === id ? driver : undefined),
  };
}
