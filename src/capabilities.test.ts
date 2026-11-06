import { describe, expect, it, vi } from "vitest";
import { CAPABILITIES, needsLabel } from "./capabilities";
import { isEmailAllowed } from "./firebase";

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
    const ON_THE_PAGE = "This page";
    const NATIVE = "Native app";
    const ANY_REPLY = "Local harness or runner + model key or signed-in CLI";
    const labels: Record<string, string> = {
      "Bot teammates": "Local harness + model key or signed-in CLI",
      "Appearance and voice": ON_THE_PAGE,
      "Thinking trace and computer usage": "Local harness",
      "Computer use (local exec daemon, window capture)": "Local harness + model key",
      "Agent drivers": "Local harness + model key or signed-in CLI",
      "Auto-review rules and approvals": "Local harness",
      "Connectors and custom MCP": "Local harness + model key",
      "Plugins, templates, and team sharing": ANY_REPLY,
      "Group chats": ANY_REPLY,
      "Model per bot": "Local harness + model key",
      "Test stack profiles": "Local harness + model key or signed-in CLI",
      "Grok Bot migration": "Local harness + model key",
      "Bot list": ON_THE_PAGE,
      "Bot file library and viewer": ON_THE_PAGE,
      "Tasks, routines, and reminders": "Local harness + model key or signed-in CLI",
      "Billing and top-up": ON_THE_PAGE,
      "Device check, card text recognition, WebAuthn signer, VNC, cloud computers": NATIVE,
      "Chat with markdown and code": ANY_REPLY,
      "Camera and photo library": ON_THE_PAGE,
      "Microphone and dictation": ON_THE_PAGE,
      Contacts: ON_THE_PAGE,
      Calendar: ON_THE_PAGE,
      Reminders: ON_THE_PAGE,
      "Location when requested": ON_THE_PAGE,
      "Face ID": ON_THE_PAGE,
      "Background audio and voice calls": ANY_REPLY,
      "Home screen widget": ON_THE_PAGE,
      "Notification service extension": ON_THE_PAGE,
      "Live Activities": NATIVE,
      HomeKit: NATIVE,
      "AppsFlyer, Braze, and Sentry": ON_THE_PAGE,
      "Google sign-in and 1Password": ON_THE_PAGE,
      "Listed interface languages": ON_THE_PAGE,
    };
    expect(Object.fromEntries(CAPABILITIES.map((item) => [item.observed, needsLabel(item)]))).toEqual(labels);
  });

  it("does not call sign-in omitted", () => {
    const row = CAPABILITIES.find((item) => item.observed === "Google sign-in and 1Password")!;
    expect(row.web).toMatch(/sign-in is required/i);
    expect(row.web).not.toMatch(/omitted/i);
  });

  it("lets in only allowlisted accounts, as the sign-in row says", () => {
    vi.stubEnv("VITE_ALLOWED_EMAILS", "Allowed@Example.test, second@example.test");
    try {
      expect(isEmailAllowed("allowed@example.test")).toBe(true);
      expect(isEmailAllowed(" SECOND@example.test ")).toBe(true);
      expect(isEmailAllowed("other@example.test")).toBe(false);
      expect(isEmailAllowed(null)).toBe(false);
      vi.stubEnv("VITE_ALLOWED_EMAILS", "");
      expect(isEmailAllowed("allowed@example.test")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
