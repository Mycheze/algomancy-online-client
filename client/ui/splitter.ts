/* THE DIVIDER BETWEEN THE POOL AND THE TABLE (BL-65): drag it, or tap ▲ ▼.
 *
 * The builder (pages/builder.ts) stacks the pool over the table; this sets how
 * much of the page the pool gets, as a FRACTION of the builder's height, and
 * the builder remembers it (localStorage `algoBuilderSplit`, a per-viewer
 * convenience: lost, it is the default again).
 *
 * Not a drag provider (ui/drag.ts): nothing is carried and nothing lands. A
 * press on the grip captures the pointer, the move sets `--pool-f` on the
 * builder's root LIVE (no repaint while dragging: the cards would be rebuilt
 * under the pointer), and the release stores the fraction and repaints once,
 * so the piles' strips refit the new height. The ▲ ▼ buttons are the tap
 * route (`tt-split`, data-by -1 / 1), handled in ui/tabletop.ts.
 *
 * The pool has a floor: its own filter bar and a strip of results
 * (52-builder.css). Below it the pool used to keep shrinking while its bar
 * spilled out over the divider, so at the smallest split on a 1024px window
 * the bar and the cards covered ▲ ▼ and the grip, and the pool could not be
 * brought back (2026-11-04, test 1137).
 *
 * No timers.
 */

export const SPLIT_KEY = 'algoBuilderSplit';
/** the pool's share of the builder when nothing is stored */
export const SPLIT_DEFAULT = 0.4;
export const SPLIT_MIN = 0.12;
export const SPLIT_MAX = 0.75;
/** one tap of ▲ or ▼ */
export const SPLIT_STEP = 0.15;

export const clampSplit = (f: number): number =>
  Number.isFinite(f) ? Math.round(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, f)) * 1000) / 1000 : SPLIT_DEFAULT;

/** ▲ (by -1: the pool smaller) or ▼ (by 1: the pool bigger) */
export const stepSplit = (f: number, by: number): number => clampSplit(f + by * SPLIT_STEP);

export function readSplit(): number {
  try {
    const v = localStorage.getItem(SPLIT_KEY);
    return v === null ? SPLIT_DEFAULT : clampSplit(Number(v));
  } catch { return SPLIT_DEFAULT; }
}

export function writeSplit(f: number): void {
  try { localStorage.setItem(SPLIT_KEY, String(clampSplit(f))); } catch { /* private window */ }
}

/** the fraction a pointer at `y` makes, the share spanning top…top+height */
export function splitAt(y: number, top: number, height: number): number {
  return height > 0 ? clampSplit((y - top) / height) : SPLIT_DEFAULT;
}

/** the builder's three parts: the pool, the divider, the table */
function parts(root: Element | null): { pool: Element; divider: Element; table: Element } | null {
  const q = (s: string): Element | null => root?.querySelector?.(s) ?? null;
  const pool = q(':scope > .ttpool'), divider = q(':scope > .ttdivider'), table = q(':scope > .tttablewrap');
  return pool && divider && table && typeof pool.getBoundingClientRect === 'function' ? { pool, divider, table } : null;
}

/** The pool's share as it is DRAWN, which is not always the stored one: the
 * pool never gets shorter than its own filter bar (52-builder.css), so a
 * small fraction on a narrow window draws bigger than it says. ▲ ▼ and a
 * release step from this, so a tap always moves the divider. null with no
 * layout (a test's DOM). */
export function shownSplit(root: Element | null): number | null {
  const p = parts(root);
  if (!p) return null;
  const a = p.pool.getBoundingClientRect().height, b = p.table.getBoundingClientRect().height;
  return a + b > 0 ? clampSplit(a / (a + b)) : null;
}

let installed = false;

/** Wire the grip's gesture once. `done` repaints after a release. */
export function installSplitter(done: () => void): void {
  if (installed || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  installed = true;
  document.addEventListener('pointerdown', e => {
    const grip = (e.target as HTMLElement | null)?.closest?.('[data-tt-grip]') as HTMLElement | null;
    if (!grip || e.button > 0) return;
    const root = grip.closest('.ttbuilder') as HTMLElement | null;
    const p = parts(root);
    if (!root || !p) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* an old browser */ }
    // the share is of the pool and the table together (the note and the
    // divider take none of it), measured from the pool's top; and the divider
    // keeps where on it the finger took hold, so it moves WITH the pointer
    const pool = p.pool.getBoundingClientRect(), table = p.table.getBoundingClientRect();
    const top = pool.top + (e.clientY - p.divider.getBoundingClientRect().top);
    const span = pool.height + table.height;
    let f = shownSplit(root) ?? readSplit();
    root.classList.add('ttsplitting');
    const move = (m: PointerEvent): void => {
      f = splitAt(m.clientY, top, span);
      root.style.setProperty('--pool-f', String(f));
    };
    let over = false;
    const up = (): void => {
      if (over) return;
      over = true;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.removeEventListener('lostpointercapture', up);
      root.classList.remove('ttsplitting');
      // dragged past the pool's floor, store what is drawn: the next ▼ grows it
      writeSplit(Math.max(f, shownSplit(root) ?? f));
      done();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    grip.addEventListener('lostpointercapture', up);
  });
}
