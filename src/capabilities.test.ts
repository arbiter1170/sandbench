import { describe, expect, it } from "vitest";
import { CAPABILITIES, needsLabel } from "./capabilities";

// Every row the map has carried so far; a row may be reworded but not silently dropped.
const OBSERVED = [
  "Bot teammates",
  "Appearance and voice",
  "Thinking trace and computer usage",
  "Computer use (local exec daemon, window capture)",
  "Agent drivers",
  "Auto-review rules and approvals",
  "Connectors and custom MCP",
  "Plugins, templates, and team sharing",
  "Group chats",
  "Model per bot",
  "Test stack profiles",
  "Grok Bot migration",
  "Bot list",
  "Bot file library and viewer",
  "Tasks, routines, and reminders",
  "Billing and top-up",
  "Device check, card text recognition, WebAuthn signer, VNC, cloud computers",
  "Chat with markdown and code",
  "Camera and photo library",
  "Microphone and dictation",
  "Contacts",
  "Calendar",
  "Reminders",
  "Location when requested",
  "Face ID",
  "Background audio and voice calls",
  "Home screen widget",
  "Notification service extension",
  "Live Activities",
  "HomeKit",
  "AppsFlyer, Braze, and Sentry",
  "Google sign-in and 1Password",
  "Listed interface languages",
];

describe("capability map", () => {
  it("keeps all 33 rows, once each", () => {
    expect(CAPABILITIES.map((item) => item.observed)).toEqual(OBSERVED);
  });

  it("says where each row works, consistently with its status", () => {
    for (const item of CAPABILITIES) {
      if (item.state === "nativeOnly") expect(item.needs, item.observed).toBe("native");
      else if (item.state === "omitted") expect(["none", "browser"], item.observed).toContain(item.needs);
      else expect(["browser", "harness", "harnessOrRunner"], item.observed).toContain(item.needs);
    }
    expect(needsLabel(CAPABILITIES.find((item) => item.observed === "Model per bot")!)).toBe("This page + model key");
    expect(needsLabel(CAPABILITIES.find((item) => item.observed === "Connectors and custom MCP")!)).toBe("Local harness");
  });

  it("does not call sign-in omitted", () => {
    const row = CAPABILITIES.find((item) => item.observed === "Google sign-in and 1Password")!;
    expect(row.web).toMatch(/sign-in is required/i);
    expect(row.web).not.toMatch(/omitted/i);
  });
});
