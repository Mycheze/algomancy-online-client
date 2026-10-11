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
  /** fitBattle: one column's own chrome, its padding and border both sides */
  chrome?: number;
  /** fitBattle: a strip of `n` invaders standing at the right of the block
   * (owner, 2026-09-27): each card `frac` of the formation's width — ALWAYS
   * smaller than the units in the line — plus `pad` px of strip around it.
   * Its width comes out of the same box the columns stand in. */
  side?: { n: number; frac: number; pad: number };
}

export type FitPlan =
  | { mode: 'grid'; cw: number; cols: number; rows: number; side?: FitSide }
  | { mode: 'fan'; cw: number; cols: number; rows: number; step: number; side?: FitSide };

/** the invader strip beside a battle: its card width and its own width */
export interface FitSide { cw: number; w: number }

const RATIO = 1.4;
/** the smallest card a zone draws before it fans (the bin thumb's 46px) */
export const FLOOR = 46;
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

/** the counterattack send box's drop slot spans this many card widths
 * (style.css `.lsendslot`, `min-width: calc(var(--cw) * 2)`) */
export const SEND_SLOT_SPAN = 2;

/**
 * Report #196 (EMCU, owner): *"There literally isn't enough space on screen to
 * counter attack beyond ~10 units … use 2 rows for counter attacking."* The
 * send box on the regions board was one row deep at a fixed card height, so
 * the fit could only shrink the cards along it; at the floor the slot, two
 * cards wide and drawn last, was pushed out of the clipped row and nothing
 * more could be sent. The box WRAPS now, as many rows as the battle block it
 * stands in has height for, and the slot is counted at the width it takes —
 * so the last row always has room for it, and a slot that cannot fit on the
 * last row of cards is planned onto a row of its own.
 *
 * `cards` is the units and tokens already in the box; `box` is the block's
 * room for the box (both dimensions — this is the change).
 *
 * Past the floor it fans like any zone, but a fan that WRAPS has to give
 * every card the same footprint, the first of each row included, or the rows
 * break in the wrong places: style.css steps each card in this box `step`
 * along with no gap, so the step is capped at the width over the cards a row
 * must hold.
 */
export function fitSendBox(cards: number, box: FitBox, o: FitOpts): FitPlan {
  const plan = fitCards(cards + SEND_SLOT_SPAN, box, o);
  return plan.mode === 'fan' ? { ...plan, step: Math.min(plan.step, Math.floor(box.w / plan.cols)) } : plan;
}

/** the battle table's two measures at a card width `cw`: how wide its row of
 * `cols` columns (and the invader strip, with `o.side`) stands, and how tall
 * its `ranksTop` + `ranksBot` ranks and the vs line between them stand. One
 * source for fitBattle and for planBattleBoard, which sizes the block the
 * table stands in from the same arithmetic. */
export function battleMeasure(cols: number, ranksTop: number, ranksBot: number, o: FitOpts):
  { width: (cw: number) => number; height: (cw: number) => number; sideW: (cw: number) => number; sideCw: (cw: number) => number } {
  const ratio = o.ratio ?? RATIO;
  // the column's chrome, measured off style.css: `.col` padding and border,
  // its label, the `.vs` rule with its margins, and the "unblocked" ghost
  // slot an empty blocking half still draws
  const COL_CHROME = o.chrome ?? 14, LABEL = 18, VS = 17, GHOST = 22, RANK_GAP = 4;
  const half = (n: number, cw: number): number => (n ? n * Math.round(cw * ratio) + RANK_GAP * (n - 1) : GHOST);
  const sideCw = (cw: number): number => Math.max(1, Math.round(cw * (o.side?.frac ?? 0)));
  const sideW = (cw: number): number => (o.side && o.side.n > 0 ? sideCw(cw) + o.side.pad : 0);
  return {
    width: (cw: number): number => cols * (cw + COL_CHROME) + o.gap * (cols - 1) + sideW(cw),
    height: (cw: number): number => LABEL + half(ranksTop, cw) + VS + half(ranksBot, cw) + 12,
    sideW, sideCw,
  };
}

/** the battle table: one row of `cols` columns, each `ranksTop` cards above
 * the vs line and `ranksBot` below. The constants are the panel's own
 * chrome: `.col` padding + border a side (`o.chrome`), its label, the `.vs`
 * rule. With `o.side`, an invader strip at the right shares the width. */
export function fitBattle(cols: number, ranksTop: number, ranksBot: number, box: FitBox, o: FitOpts): FitPlan {
  const floor = Math.min(o.floor ?? FLOOR, o.cw), minStep = o.minStep ?? MIN_STEP;
  const COL_CHROME = o.chrome ?? 14;
  const ranks = Math.max(1, ranksTop + ranksBot);
  const { width, height, sideW, sideCw } = battleMeasure(cols, ranksTop, ranksBot, o);
  const side = (cw: number): { side?: FitSide } =>
    (o.side && o.side.n > 0 ? { side: { cw: sideCw(cw), w: sideW(cw) } } : {});
  // Report #200: no columns yet (the other seat has placed nothing) is still
  // a plan for the invader strip, or its cards keep their full size in a
  // strip 36px wide and stand clipped down the edge of the fight
  if (cols <= 0 || box.w <= 0 || box.h <= 0) return { mode: 'grid', cw: o.cw, cols: 0, rows: 0, ...side(Math.floor(o.cw)) };
  const cw = largest(floor, Math.floor(o.cw), x => width(x) <= box.w && height(x) <= box.h);
  if (cw !== null) return { mode: 'grid', cw, cols, rows: ranks, ...side(cw) };
  // the width fits at the floor and only the height is short: there is
  // nothing a fan can do about height, so the floor it is (the band clips the
  // back rank's feet rather than hiding a whole column under its neighbour)
  if (width(floor) <= box.w) return { mode: 'grid', cw: floor, cols, rows: ranks, ...side(floor) };
  // too many columns for the width even at the floor: the columns overlap
  const colW = floor + COL_CHROME;
  const room = box.w - sideW(floor);
  const step = cols > 1 ? Math.max(minStep, Math.floor((room - colW) / (cols - 1))) : 0;
  return { mode: 'fan', cw: floor, cols, rows: ranks, step, ...side(floor) };
}

/**
 * ROUND 7 — THE FIGHT BLOCK GROWS (report #204, owner 2026-10-11).
 *
 * *"There are so many moments where there is an absolute ton of unused space
 * on screen, but the units and the 'important' area is all scrunched into the
 * side of the screen."* Measured: in every battle the cards covered 5–13% of
 * the board. The fight's block was half the board's width and a fixed share
 * of its height, the other region's battle block — empty in every slice —
 * took the other half, and the columns stood at the left of their block.
 *
 * The owner's shape: the two Ls, the tints, the seam and the ring stay; while
 * a battle is on, the block holding the fight takes most of the board, and the
 * region not in use is "smooshed to the side". This decides that shape from
 * the room there is, before any card is sized (ui/layout.ts writes it back as
 * three grid tracks, style.css `.lboard[data-fight]`):
 *
 *   - THE BANDS (the info offshoot and the In Play beside it, top and bottom)
 *     stand at `bandMin` — the info offshoot on two lines — while the fight
 *     can use the height. Whatever the fight cannot use (its cards at the cap,
 *     or held back by its width) goes back to the bands, half each. Where even
 *     the fight's floor does not stand, the bands give more, down to
 *     `bandFloor` (the name-and-life line: the info block clips its resources
 *     before its name, as it always has).
 *   - THE IDLE COLUMN (the other region's battle block and Invaders row) is as
 *     wide as what it holds wants — its cards one row deep at the row size, the
 *     send box's cards and slot at the line size — but never under one card at
 *     the floor (two for the send slot), never over a quarter of the board,
 *     and never into width the fight's columns need.
 *   - THE FIGHT takes the rest, and its cards grow to `o.cw` (the owner's
 *     ~120px cap) where the room allows.
 *
 * The board's own split between the info offshoot and In Play stays at half
 * (the edges do not move); only the column below it changes width.
 */
export interface BattleBoardIn {
  /** the board grid's content box */
  board: FitBox;
  /** the grid's column gap and row gap */
  gapX: number; gapY: number;
  /** the battle table, as fitBattle takes it; `o.cw` is the cap */
  cols: number; ranksTop: number; ranksBot: number; o: FitOpts;
  /** the fight block's chrome around the columns' box */
  chrome: FitBox;
  /** a band's height: the info offshoot's two lines, and its one line */
  bandMin: number; bandFloor: number;
  /** the idle block: the send box (and how many it holds), the counterattackers
   * heading for it, the invaders in its region's row; its padding across, the
   * gap between its cards, and the card widths it draws them at */
  idle: { send: boolean; cards: number; invaders: number; pad: number; gap: number; rowCw: number; lineCw: number; floor: number };
}

export interface BattleBoard { idle: number; bandTop: number; bandBot: number; cw: number }

/** the idle column is a narrow band at the side: never more than this share
 * of the board's width (owner, 2026-10-11: "smooshed to the side while not in
 * use") */
export const IDLE_SHARE = 0.25;
/** the battle template's rows are band · row · fight · row · band, and the
 * fight block spans two of the middle three: the other three row gaps and
 * the one empty row are not the fight's */
const OUTER_GAPS = 3;

export function planBattleBoard(i: BattleBoardIn): BattleBoard | null {
  const W = i.board.w, H = i.board.h;
  if (!(W > 0 && H > 0)) return null;
  const id = i.idle;
  const span = (k: number, cw: number): number => (k > 0 ? k * (cw + id.gap) - id.gap : 0);
  const idleMin = id.pad + (id.send ? span(SEND_SLOT_SPAN, id.floor) : id.floor);
  const idleWant = id.pad + Math.max(
    id.send ? span(id.cards + SEND_SLOT_SPAN, id.lineCw) : span(id.cards, id.rowCw),
    span(id.invaders, id.rowCw));
  // a fight with nothing placed yet is planned as one column a rank a side,
  // so the block does not collapse under the first unit placed
  const cols = Math.max(1, i.cols);
  const rt = i.cols > 0 ? i.ranksTop : 1, rb = i.cols > 0 ? i.ranksBot : 1;
  const m = battleMeasure(cols, rt, rb, i.o);
  const floor = Math.min(i.o.floor ?? FLOOR, i.o.cw);
  const fightW = W - i.gapX - idleMin;
  // the bands at two lines; less, down to one, if the floor needs it
  const room = H - OUTER_GAPS * i.gapY;
  const short = Math.max(0, m.height(floor) + i.chrome.h - (room - 2 * i.bandMin));
  const band = Math.max(i.bandFloor, i.bandMin - Math.ceil(short / 2));
  const fightH = room - 2 * band;
  const box = { w: fightW - i.chrome.w, h: fightH - i.chrome.h };
  const p = fitBattle(cols, rt, rb, box, i.o);
  const needW = (p.mode === 'fan' ? box.w : m.width(p.cw)) + i.chrome.w;
  const needH = m.height(p.cw) + i.chrome.h;
  const spareW = Math.max(0, W - i.gapX - needW);
  const idle = Math.round(Math.max(idleMin, Math.min(idleWant, W * IDLE_SHARE, spareW)));
  const spareH = Math.max(0, Math.floor(fightH - needH));
  const top = Math.floor(spareH / 2);
  return { idle, bandTop: band + top, bandBot: band + spareH - top, cw: p.cw };
}
