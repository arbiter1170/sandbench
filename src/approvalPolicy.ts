import { normalizeRule, reviewCommand } from "../harness/autoReview.mjs";
import type { Approval, ApprovalMode } from "./types";
import { needsHarness, type StepAction } from "./work";

/**
 * True when a planner command may run without a card: the same check the harness applies to
 * driver turns (harness/autoReview.mjs).
 */
export function autoApproved(command: string, rules: readonly string[]): boolean {
  return reviewCommand(command, rules).auto;
}

/**
 * The rule list after the user adds `text` under Studio > Auto-review, or null when there is
 * nothing to add (unusable text, or the rule is already there).
 */
export function addAutoReviewRule(rules: readonly string[], text: string): string[] | null {
  const next = normalizeRule(text);
  if (!next || rules.includes(next)) return null;
  return [...rules, next];
}

/**
 * The starting status of a planner approval card.
 *
 * Only shell commands covered by an auto-review rule start approved. Clicks and keystrokes,
 * file writes and deletes, connector (MCP) tool calls and questions always wait for the user,
 * whatever the bot's permission mode. `auto` and `full` currently behave like `ask`, because
 * the rules already decide which commands skip the card; the stored mode is left as it is.
 * A routine running with nobody there denies whatever would wait when the Studio setting
 * says to skip.
 */
export function initialApprovalStatus(input: {
  action: StepAction;
  rules: readonly string[];
  mode?: ApprovalMode;
  harness: boolean;
  unattended: boolean;
  unattendedPolicy: "ask" | "skip";
}): Approval["status"] {
  const { action } = input;
  if (needsHarness(action) && !input.harness) return "unavailable";
  if (action.kind === "command" && autoApproved(action.command, input.rules)) return "approved";
  if (input.unattended && input.unattendedPolicy === "skip") return "denied";
  return "pending";
}
