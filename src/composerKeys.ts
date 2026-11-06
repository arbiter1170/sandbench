// UX P4: what Enter does in the chat composer. On a phone or tablet (coarse primary pointer)
// Enter inserts a newline and only the Send button sends; on a desktop (fine pointer) Enter
// sends and Shift+Enter inserts a newline. Ctrl+Enter or Cmd+Enter sends on any device, so a
// tablet with a hardware keyboard (iPad with a Magic Keyboard, a Chromebook in tablet mode) can
// still send from the keyboard. While an IME composition is active (Japanese, Chinese,
// Korean input and some phone keyboards), Enter commits the composition and never sends. Safari
// reports the committing keydown with `isComposing` false but `keyCode` 229, so both are checked.

export type ComposerEnter = {
  key: string;
  shiftKey: boolean;
  /** Ctrl or Cmd held: send on any pointer. Optional so older callers read as "not held". */
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** `KeyboardEvent.isComposing` of the native event. */
  isComposing: boolean;
  /** `KeyboardEvent.keyCode`; 229 means the IME is handling the key. */
  keyCode: number;
  /** True when the primary pointer is coarse (`matchMedia("(pointer: coarse)")`). */
  coarse: boolean;
};

/** True when this keydown should send the draft. Otherwise the browser's default applies (a newline for Enter). */
export function enterSends(input: ComposerEnter): boolean {
  if (input.key !== "Enter") return false;
  if (input.isComposing || input.keyCode === 229) return false;
  if (input.ctrlKey || input.metaKey) return true;
  if (input.coarse) return false;
  return !input.shiftKey;
}

/** Read at keydown time, so a device that switches mode (a tablet docking a keyboard) follows. */
export function coarsePointer(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
