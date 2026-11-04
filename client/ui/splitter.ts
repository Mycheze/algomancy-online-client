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

/** the fraction a pointer at `y` makes, the builder spanning top…top+height */
export function splitAt(y: number, top: number, height: number): number {
  return height > 0 ? clampSplit((y - top) / height) : SPLIT_DEFAULT;
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
    if (!root) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* an old browser */ }
    const r = root.getBoundingClientRect();
    let f = readSplit();
    root.classList.add('ttsplitting');
    const move = (m: PointerEvent): void => {
      f = splitAt(m.clientY, r.top, r.height);
      root.style.setProperty('--pool-f', String(f));
    };
    const up = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      root.classList.remove('ttsplitting');
      writeSplit(f);
      done();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
}
