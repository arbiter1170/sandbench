// UX P4: the soft-keyboard inset. Synthetic viewport numbers only; real keyboards are a manual
// check on iOS Safari and Android Chrome (spec §9).
import { describe, expect, it } from "vitest";
import { installViewportFit, keyboardInset, KEYBOARD_MIN_PX } from "./viewportFit";

describe("keyboardInset", () => {
  it("is the part of the layout viewport below the visual viewport (keyboard over the page)", () => {
    expect(keyboardInset({ layoutHeight: 844, height: 508, offsetTop: 0, scale: 1 })).toBe(336);
  });

  it("is 0 when the browser already panned or resized the page for the keyboard", () => {
    expect(keyboardInset({ layoutHeight: 844, height: 508, offsetTop: 336, scale: 1 })).toBe(0);
    expect(keyboardInset({ layoutHeight: 508, height: 508, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is 0 with no keyboard, for small gaps, and when the visual viewport is taller", () => {
    expect(keyboardInset({ layoutHeight: 800, height: 800, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset({ layoutHeight: 800, height: 800 - (KEYBOARD_MIN_PX - 1), offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset({ layoutHeight: 760, height: 800, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is 0 while pinch-zoomed, so zoom never squeezes the app", () => {
    expect(keyboardInset({ layoutHeight: 844, height: 422, offsetTop: 0, scale: 2 })).toBe(0);
    expect(keyboardInset({ layoutHeight: 844, height: 422, offsetTop: 0, scale: Number.NaN })).toBe(0);
  });
});

function fakeWindow(start: { layoutHeight: number; height: number; offsetTop?: number }) {
  const listeners = new Map<string, Set<() => void>>();
  const props = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const frames: Array<() => void> = [];
  const viewport = {
    height: start.height,
    offsetTop: start.offsetTop ?? 0,
    scale: 1,
    addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
  };
  const win = {
    visualViewport: viewport,
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    cancelAnimationFrame: () => undefined,
    document: {
      documentElement: {
        clientHeight: start.layoutHeight,
        dataset,
        style: { setProperty: (name: string, value: string) => void props.set(name, value), removeProperty: (name: string) => (props.delete(name), "") },
      },
    },
  };
  const fire = (type: string) => {
    for (const fn of listeners.get(type) ?? []) fn();
    while (frames.length) frames.shift()!();
  };
  return { win: win as unknown as Parameters<typeof installViewportFit>[0], viewport, props, dataset, listeners, fire };
}

describe("installViewportFit", () => {
  it("publishes the inset while the keyboard is open and clears it when it closes", () => {
    const fake = fakeWindow({ layoutHeight: 844, height: 844 });
    const stop = installViewportFit(fake.win);
    expect(fake.props.has("--keyboard-inset")).toBe(false);
    expect(fake.dataset.keyboard).toBeUndefined();

    fake.viewport.height = 508;
    fake.fire("resize");
    expect(fake.props.get("--keyboard-inset")).toBe("336px");
    expect(fake.dataset.keyboard).toBe("open");

    fake.viewport.height = 844;
    fake.fire("resize");
    expect(fake.props.has("--keyboard-inset")).toBe(false);
    expect(fake.dataset.keyboard).toBeUndefined();

    fake.viewport.height = 508;
    fake.fire("scroll");
    expect(fake.dataset.keyboard).toBe("open");
    stop();
    expect(fake.props.has("--keyboard-inset")).toBe(false);
    expect(fake.dataset.keyboard).toBeUndefined();
    expect([...fake.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it("does nothing without a visual viewport or a window", () => {
    expect(() => installViewportFit(undefined)()).not.toThrow();
    const fake = fakeWindow({ layoutHeight: 800, height: 400 });
    const bare = { ...(fake.win as object), visualViewport: null } as unknown as Parameters<typeof installViewportFit>[0];
    installViewportFit(bare)();
    expect(fake.props.size).toBe(0);
  });
});
