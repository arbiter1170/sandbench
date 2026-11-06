// UX P4-AC3: the composer's Enter key, per the table in §6 P4 of
// docs/superpowers/specs/2026-11-05-sandbench-ux-design.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import { coarsePointer, enterSends, type ComposerEnter } from "./composerKeys";

const enter = (patch: Partial<ComposerEnter> = {}): ComposerEnter => ({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13, coarse: false, ...patch });

describe("enterSends", () => {
  it("fine pointer: Enter sends the draft", () => {
    expect(enterSends(enter())).toBe(true);
  });

  it("fine pointer: Shift+Enter inserts a newline", () => {
    expect(enterSends(enter({ shiftKey: true }))).toBe(false);
  });

  it("coarse pointer: Enter inserts a newline and nothing is sent", () => {
    expect(enterSends(enter({ coarse: true }))).toBe(false);
  });

  it("coarse pointer: Shift+Enter inserts a newline", () => {
    expect(enterSends(enter({ coarse: true, shiftKey: true }))).toBe(false);
  });

  it("Ctrl+Enter and Cmd+Enter send on any pointer, so a tablet with a hardware keyboard can send", () => {
    for (const coarse of [false, true]) {
      for (const shiftKey of [false, true]) {
        expect(enterSends(enter({ coarse, shiftKey, ctrlKey: true }))).toBe(true);
        expect(enterSends(enter({ coarse, shiftKey, metaKey: true }))).toBe(true);
      }
    }
  });

  it("Ctrl/Cmd+Enter never sends during IME composition", () => {
    for (const coarse of [false, true]) {
      expect(enterSends(enter({ coarse, ctrlKey: true, isComposing: true }))).toBe(false);
      expect(enterSends(enter({ coarse, metaKey: true, keyCode: 229 }))).toBe(false);
    }
  });

  it("Ctrl/Cmd with another key never sends", () => {
    expect(enterSends(enter({ key: "a", ctrlKey: true }))).toBe(false);
    expect(enterSends(enter({ key: "s", metaKey: true, coarse: true }))).toBe(false);
  });

  it("never sends while an IME composition is active, on any device", () => {
    for (const coarse of [false, true]) {
      for (const shiftKey of [false, true]) {
        expect(enterSends(enter({ coarse, shiftKey, isComposing: true }))).toBe(false);
        // Safari's composition-committing keydown: isComposing false, keyCode 229.
        expect(enterSends(enter({ coarse, shiftKey, keyCode: 229 }))).toBe(false);
        expect(enterSends(enter({ coarse, shiftKey, isComposing: true, keyCode: 229 }))).toBe(false);
      }
    }
  });

  it("other keys never send", () => {
    for (const key of ["a", " ", "Tab", "Escape", "Process"]) {
      expect(enterSends(enter({ key }))).toBe(false);
    }
  });
});

describe("coarsePointer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows matchMedia('(pointer: coarse)')", () => {
    const queries: string[] = [];
    for (const matches of [true, false]) {
      vi.stubGlobal("window", { matchMedia: (query: string) => (queries.push(query), { matches }) });
      expect(coarsePointer()).toBe(matches);
    }
    expect(queries).toEqual(["(pointer: coarse)", "(pointer: coarse)"]);
  });

  it("is false without a window or matchMedia (desktop behaviour is the fallback)", () => {
    expect(coarsePointer()).toBe(false);
    vi.stubGlobal("window", {});
    expect(coarsePointer()).toBe(false);
    vi.stubGlobal("window", { matchMedia: () => { throw new Error("blocked"); } });
    expect(coarsePointer()).toBe(false);
  });
});
