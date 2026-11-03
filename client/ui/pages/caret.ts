/* The caret carry: which text box owns focus, and where its caret sits, read
 * before a repaint replaces the markup and handed back to the rebuilt box.
 *
 * Shared by the board (main.ts snapshotViewport) and the home screen
 * (pages/home.ts paintHome). It lived in main.ts until the design-system round
 * of 2026-11-03 moved the home screen out; a page module cannot import main.ts
 * (importing it boots the whole client), so the one copy moved here instead. */

/** a caretIn() snapshot: the box's id and its selection, or nothing focused */
export type CaretSnap = { id: string; start: number; end: number } | null;

/** The text box (one of `ids`) that owns focus, and where its caret sits — read
 * before a repaint replaces it, so the rebuilt box can be handed both back.
 * snapshotViewport (the board) and paintHome (the home screen) share it. */
export function caretIn(ids: readonly string[]): CaretSnap {
  const box = document.activeElement;
  return (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) && ids.includes(box.id)
    ? { id: box.id, start: box.selectionStart ?? 0, end: box.selectionEnd ?? 0 }
    : null;
}

/** put a caretIn() snapshot back on the rebuilt box, if it is still there */
export function restoreCaret(keep: CaretSnap): void {
  if (!keep) return;
  const box = document.getElementById(keep.id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!box) return;
  box.focus();
  box.setSelectionRange(keep.start, keep.end);
}
