import { describe, expect, it } from "vitest";
import { autoApproved, initialApprovalStatus } from "./approvalPolicy";
import { CAPABILITIES } from "./capabilities";
import type { ApprovalMode } from "./types";
import type { StepAction } from "./work";

const RULES = ["Get-ChildItem", "Get-Date", "git"];
const MODES: ApprovalMode[] = ["ask", "auto", "full"];

const command = (text: string): StepAction => ({ kind: "command", command: text, reason: "test" });
const click: StepAction = { kind: "pointer", pointer: { action: "click", x: 10, y: 20 }, label: "Click", reason: "test" };
const typing: StepAction = { kind: "pointer", pointer: { action: "type", text: "hello" }, label: "Type", reason: "test" };
const write: StepAction = { kind: "file", file: { path: "notes.txt", op: "write", preview: "x" }, label: "Write notes.txt", reason: "test" };
const remove: StepAction = { kind: "file", file: { path: "notes.txt", op: "delete", preview: "" }, label: "Delete notes.txt", reason: "test" };
const tool: StepAction = { kind: "tool", connectorId: "c1", name: "write_file", args: { path: "x" }, label: "write_file", why: "test" };
const question: StepAction = { kind: "question", question: { prompt: "Which one?" }, label: "Question: Which one?", reason: "test" };

function status(action: StepAction, mode?: ApprovalMode, extra: Partial<Parameters<typeof initialApprovalStatus>[0]> = {}) {
  return initialApprovalStatus({ action, rules: RULES, mode, harness: true, unattended: false, unattendedPolicy: "ask", ...extra });
}

describe("planner approvals", () => {
  it("only an unattended turn is denied by the skip setting; someone present still gets a card", () => {
    expect(status(click, "ask", { unattended: false, unattendedPolicy: "skip" })).toBe("pending");
    expect(status(click, "ask", { unattended: true, unattendedPolicy: "skip" })).toBe("denied");
    expect(status(click, "ask", { unattended: true, unattendedPolicy: "ask" })).toBe("pending");
  });

  it("auto-runs only rule-covered read-only commands, in every mode", () => {
    for (const mode of [undefined, ...MODES]) {
      expect(status(command("Get-Date"), mode)).toBe("approved");
      expect(status(command("git status"), mode)).toBe("approved");
      expect(status(command("git push origin main"), mode)).toBe("pending");
      expect(status(command("Get-Date; Remove-Item x"), mode)).toBe("pending");
      expect(status(command("Remove-Item -Recurse build"), mode)).toBe("pending");
    }
  });

  it("never auto-approves clicks, typing, file writes or deletes, connector tools or questions, even in full mode", () => {
    for (const mode of MODES) {
      for (const action of [click, typing, write, remove, tool, question]) {
        expect(status(action, mode), `${mode} ${action.kind}`).toBe("pending");
      }
    }
  });

  it("an unattended routine set to skip denies whatever would have waited, and still runs rule-covered commands", () => {
    const unattended = { unattended: true, unattendedPolicy: "skip" as const };
    expect(status(command("Get-Date"), "full", unattended)).toBe("approved");
    for (const action of [command("git push"), click, write, tool, question]) {
      expect(status(action, "full", unattended)).toBe("denied");
    }
    expect(status(command("git push"), "full", { unattended: true, unattendedPolicy: "ask" })).toBe("pending");
  });

  it("actions that need the harness are unavailable without it; questions do not need it", () => {
    for (const action of [command("Get-Date"), click, write, tool]) expect(status(action, "full", { harness: false })).toBe("unavailable");
    expect(status(question, "full", { harness: false })).toBe("pending");
  });

  it("uses the same matcher as the harness gate", () => {
    expect(autoApproved("git status", ["git"])).toBe(true);
    expect(autoApproved("git push", ["git"])).toBe(false);
    expect(autoApproved("npm test", ["npm test"])).toBe(true);
    expect(autoApproved("npm install", ["npm"])).toBe(false);
  });
});

describe("capability map approval rows", () => {
  const row = (name: string) => CAPABILITIES.find((item) => item.observed === name)!.web;

  it("claims only what the approval code does", () => {
    expect(row("Auto-review rules and approvals")).toMatch(/git status, not git push/);
    expect(autoApproved("git status", ["git"]) && !autoApproved("git push", ["git"])).toBe(true);
    expect(row("Computer use (local exec daemon, window capture)")).toMatch(/always wait, whatever the bot's permission mode/);
    for (const action of [click, typing, write, tool, question]) expect(status(action, "full")).toBe("pending");
  });
});
