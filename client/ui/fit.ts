/* THE FIT PASS — how big a card can be in a zone that must not scroll.
 *
 * The regions board (ui/layout.ts, docs/18-board-layout-v2.md) pins the whole
 * play zone between the top bar and the action bar and never scrolls it. So
 * every zone has a fixed box, and the question "how wide is a card here?" has
 * to be answered from the box and the number of cards, not from a stylesheet
 * constant. This module answers it. It is DOM-free on purpose — main.ts
 * measures, this decides, main.ts writes the answer back as CSS variables —
 * so the arithmetic is unit-testable and the owner's overflow choice is a
 * value in the plan, not a colour in the stylesheet.
 *
 * Two modes, in order:
 *   grid — the largest card width, floor..cw, at which cols × rows holds n.
 *   fan  — below the floor the cards OVERLAP instead (owner, 2026-09-22:
 *          "overlap the cards; nothing scrolls, nothing hides"): every card
 *          after the first is stepped `step` px along, hover or tap raises
 *          one. The step never drops below `minStep`, the width of the sliver
 *          the hand dock's card backs already show.
 * There is no scroll mode and no "+N" pile — those were offered and declined.
 */

export interface FitBox { w: number; h: number }

export interface FitOpts {
  /** the base card width — the computed `--cw` (78, or 62 under 1100px) */
  cw: number;
  /** the gap between cards in the zone (6 in a .zone, 14 between .cols) */
  gap: number;
  /** card height ÷ width. The scans are 18/25 ≈ 1.389; `.slot` reserves 1.4 —
   * take the taller so a fit is never a hair short. */
  ratio?: number;
  /** the smallest card that still reads (the bin thumb's 46px) */
  floor?: number;
  /** the narrowest fan step (the 14px sliver of a docked card back) */
  minStep?: number;
}

export type FitPlan =
  | { mode: 'grid'; cw: number; cols: number; rows: number }
  | { mode: 'fan'; cw: number; cols: number; rows: number; step: number };

const RATIO = 1.4;
const FLOOR = 46;
const MIN_STEP = 14;

/** how many cards of width `cw` a `box` holds in a wrapped grid */
function capacity(cw: number, box: FitBox, gap: number, ratio: number): { cols: number; rows: number } {
  const cols = Math.max(0, Math.floor((box.w + gap) / (cw + gap)));
  const rows = Math.max(0, Math.floor((box.h + gap) / (Math.round(cw * ratio) + gap)));
  return { cols, rows };
}

/** the largest integer in [lo, hi] for which `ok` holds, or null; `ok` must be
 * monotone (true below some point, false above) — capacity is */
function largest(lo: number, hi: number, ok: (x: number) => boolean): number | null {
  if (hi < lo || !ok(lo)) return null;
  let a = lo, b = hi;
  while (a < b) {
    const mid = Math.ceil((a + b) / 2);
    if (ok(mid)) a = mid; else b = mid - 1;
  }
  return a;
}

/** `n` cards in a flex-wrap zone whose content box is `box` */
export function fitCards(n: number, box: FitBox, o: FitOpts): FitPlan {
  const ratio = o.ratio ?? RATIO, floor = Math.min(o.floor ?? FLOOR, o.cw), minStep = o.minStep ?? MIN_STEP;
  if (n <= 0 || box.w <= 0 || box.h <= 0) return { mode: 'grid', cw: o.cw, cols: 0, rows: 0 };
  const fits = (cw: number): boolean => {
    const c = capacity(cw, box, o.gap, ratio);
    return c.cols * c.rows >= n;
  };
  const cw = largest(floor, Math.floor(o.cw), fits);
  if (cw !== null) {
    const c = capacity(cw, box, o.gap, ratio);
    return { mode: 'grid', cw, cols: Math.min(n, c.cols), rows: Math.ceil(n / Math.max(1, c.cols)) };
  }
  // fan: as many rows as the height allows at the floor, the cards of each
  // row overlapping so the row spans the width and no more
  const rows = Math.max(1, capacity(floor, box, o.gap, ratio).rows);
  const perRow = Math.ceil(n / rows);
  const step = perRow > 1 ? Math.max(minStep, Math.floor((box.w - floor) / (perRow - 1))) : 0;
  return { mode: 'fan', cw: floor, cols: perRow, rows, step };
}

/** the battle table: one row of `cols` columns, each `ranksTop` cards above
 * the vs line and `ranksBot` below. The constants are the panel's own
 * chrome: `.col` padding 6 + border 1 a side, its label, the `.vs` rule. */
export function fitBattle(cols: number, ranksTop: number, ranksBot: number, box: FitBox, o: FitOpts): FitPlan {
  const ratio = o.ratio ?? RATIO, floor = Math.min(o.floor ?? FLOOR, o.cw), minStep = o.minStep ?? MIN_STEP;
  if (cols <= 0 || box.w <= 0 || box.h <= 0) return { mode: 'grid', cw: o.cw, cols: 0, rows: 0 };
  // the column's chrome, measured off style.css: `.col` padding and border,
  // its label, the `.vs` rule with its margins, and the "unblocked" ghost
  // slot an empty blocking half still draws
  const COL_CHROME = 14, LABEL = 18, VS = 17, GHOST = 22, RANK_GAP = 4;
  const ranks = Math.max(1, ranksTop + ranksBot);
  const half = (n: number, cw: number): number => (n ? n * Math.round(cw * ratio) + RANK_GAP * (n - 1) : GHOST);
  const height = (cw: number): number => LABEL + half(ranksTop, cw) + VS + half(ranksBot, cw) + 12;
  const width = (cw: number): number => cols * (cw + COL_CHROME) + o.gap * (cols - 1);
  const cw = largest(floor, Math.floor(o.cw), x => width(x) <= box.w && height(x) <= box.h);
  if (cw !== null) return { mode: 'grid', cw, cols, rows: ranks };
  // the width fits at the floor and only the height is short: there is
  // nothing a fan can do about height, so the floor it is (the band clips the
  // back rank's feet rather than hiding a whole column under its neighbour)
  if (width(floor) <= box.w) return { mode: 'grid', cw: floor, cols, rows: ranks };
  // too many columns for the width even at the floor: the columns overlap
  const colW = floor + COL_CHROME;
  const step = cols > 1 ? Math.max(minStep, Math.floor((box.w - colW) / (cols - 1))) : 0;
  return { mode: 'fan', cw: floor, cols, rows: ranks, step };
}
