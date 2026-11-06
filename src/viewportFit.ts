// UX P4: keep the composer above a phone's soft keyboard. Where the browser shrinks the page for
// the keyboard (Chrome and Firefox on Android with `interactive-widget=resizes-content`, or
// their default on older versions) this measures 0 and does nothing. Where the keyboard only
// shrinks the visual viewport and leaves the layout viewport full height (iOS Safari, Chrome's
// newer default), it publishes how much of the layout viewport the keyboard covers as
// `--keyboard-inset` on <html>, plus `data-keyboard="open"`; styles.css pads the app by that
// much. Real-device behaviour is a manual check (spec §9).

export type ViewportFacts = {
  /** Layout viewport height: `document.documentElement.clientHeight`. */
  layoutHeight: number;
  /** `visualViewport.height`, `offsetTop` and `scale`. */
  height: number;
  offsetTop: number;
  scale: number;
};

/** Smaller gaps are browser chrome settling or rounding, not a keyboard. */
export const KEYBOARD_MIN_PX = 80;

/** Pixels of the layout viewport hidden below the visual viewport, or 0 when that is not a keyboard. */
export function keyboardInset(facts: ViewportFacts): number {
  // Pinch zoom also shrinks the visual viewport; leave the layout alone then.
  if (!Number.isFinite(facts.scale) || Math.abs(facts.scale - 1) > 0.01) return 0;
  const hidden = Math.round(facts.layoutHeight - (facts.height + facts.offsetTop));
  return hidden >= KEYBOARD_MIN_PX ? hidden : 0;
}

type ViewportWindow = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame"> & {
  visualViewport: Pick<VisualViewport, "height" | "offsetTop" | "scale" | "addEventListener" | "removeEventListener"> | null;
  document: { documentElement: Pick<HTMLElement, "clientHeight" | "dataset"> & { style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> } };
};

/** Starts tracking; returns a function that stops it and clears what it set. No-op without `visualViewport`. */
export function installViewportFit(win: ViewportWindow | undefined = typeof window === "undefined" ? undefined : window): () => void {
  const viewport = win?.visualViewport;
  if (!win || !viewport) return () => undefined;
  const root = win.document.documentElement;
  let frame = 0;
  let current = -1;
  const apply = () => {
    frame = 0;
    const inset = keyboardInset({ layoutHeight: root.clientHeight, height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale });
    if (inset === current) return;
    current = inset;
    if (inset > 0) {
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      root.dataset.keyboard = "open";
    } else {
      root.style.removeProperty("--keyboard-inset");
      delete root.dataset.keyboard;
    }
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(apply);
  };
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  apply();
  return () => {
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    if (frame) win.cancelAnimationFrame(frame);
    root.style.removeProperty("--keyboard-inset");
    delete root.dataset.keyboard;
  };
}
