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
  /** battleMeasure: how much taller than its ranks of plain cards each half
   * of the table stands, in card heights — a modded unit hangs its mods under
   * it (main.ts fieldMods), so a column holding one is that much longer. The
   * tallest column's sum, a half. */
  extra?: { top: number; bot: number };
}

export type FitPlan =
  | { mode: 'grid'; cw: number; cols: number; rows: number; side?: FitSide }
  | { mode: 'fan'; cw: number; cols: number; rows: number; step: number; side?: FitSide };

/** the invader strip beside a battle: its card width and its own width */
export interface FitSide { cw: number; w: number }

export const RATIO = 1.4;
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
  const half = (n: number, cw: number, more = 0): number =>
    (n ? n * Math.round(cw * ratio) + Math.round(cw * ratio * more) + RANK_GAP * (n - 1) : GHOST);
  const sideCw = (cw: number): number => Math.max(1, Math.round(cw * (o.side?.frac ?? 0)));
  const sideW = (cw: number): number => (o.side && o.side.n > 0 ? sideCw(cw) + o.side.pad : 0);
  return {
    width: (cw: number): number => cols * (cw + COL_CHROME) + o.gap * (cols - 1) + sideW(cw),
    height: (cw: number): number =>
      LABEL + half(ranksTop, cw, o.extra?.top) + VS + half(ranksBot, cw, o.extra?.bot) + 12,
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
 * The owner's shape: the two Ls, the tints, the seam and the ring stay; the
 * fight gets the room it NEEDS. Their correction after the first build
 * (2026-10-11), which had given the fight three quarters of the board whatever
 * it held: *"it's taking up the space that it doesn't need … the horizontal
 * space should be expanded when needed"*, and *"the 120px cap is a bit big. I
 * think it should cap at 100px/card during a fight."* So, in order:
 *
 *   1. HEIGHT FIRST. The bands (the info offshoot and the In Play beside it,
 *      top and bottom) stand at `bandMin` — the info offshoot on two lines —
 *      while the fight can use the height; where even the fight's floor does
 *      not stand they give more, down to `bandFloor` (the name-and-life line:
 *      the info block clips its resources before its name, as it always has).
 *      The fight's cards are sized in that height, up to the cap (`o.cw`), as
 *      wide as the board could ever let them be. The one band that does not
 *      give way is the one you are building a formation FROM (`source`): it
 *      keeps your units at the size of the slots they are going to.
 *   2. THEN THE WIDTH IT NEEDS. The fight's column is as wide as its columns
 *      stand at that size (with their chrome and the invader strip) — and
 *      never narrower than half the board, the block it had before the round.
 *      A fight that fits in half keeps the old half-and-half board exactly
 *      (`wide: false`); only a wider one pushes the other region aside, by as
 *      much as it needs, and never past one card at the floor of the idle
 *      column (two for the send box's slot).
 *   3. Everything else stays where it was: the height the fight cannot use
 *      goes back to the bands, half each; the width to the other region.
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
  /** the tallest unit standing in each In Play band, over a plain card (its
   * mods hang under it — main.ts fieldMods), in card heights, and the band's
   * padding: a band never stands shorter than that unit at the field's floor
   * width, or the unit — and the fit of every card beside it — spills out */
  tall?: { top: number; bot: number; pad: number };
  /** the In Play bands that are the SOURCE of a formation being built (the
   * units the viewer can put in the declaration, `.card.playable`): how many
   * stand in each, the largest a field card grows (`cap`), and the band's
   * padding. While you build, they are the cards you are moving into the
   * fight, so their band keeps them at the fight's own size (up to `cap`). */
  source?: { top: number; bot: number; cap: number; pad: number;
    /** how much taller than a card the tallest of each band's units stands
     * (its mods hang under it), in card heights */
    extra?: { top: number; bot: number } };
  /** the idle block at its narrowest: whether it holds the send box (whose
   * slot is two cards wide), its padding across, the gap between its cards
   * and the floor card width */
  idle: { send: boolean; pad: number; gap: number; floor: number };
  /** CT-419: a spectator's view of the top seat's hand (`.lspect`): the top
   * band's height at which its cards stand at the hand dock's full size.
   * While the top band's even share of the spare height is under it, the top
   * band takes the spare first — never the fight's height, never the bottom
   * band's own (it keeps what step 1 gave it) */
  spect?: number;
}

/** `fight`: the fight column's width; `idle`: the other column's; `wide`:
 * whether the fight needs more than the half it always had (false = the
 * board's old half-and-half split, exactly) */
export interface BattleBoard { wide: boolean; fight: number; idle: number; bandTop: number; bandBot: number; cw: number }

/** the battle template's rows are band · row · fight · row · band, and the
 * fight block spans two of the middle three: the other three row gaps and
 * the one empty row are not the fight's */
const OUTER_GAPS = 3;

export function planBattleBoard(i: BattleBoardIn): BattleBoard | null {
  const W = i.board.w, H = i.board.h;
  if (!(W > 0 && H > 0)) return null;
  const id = i.idle;
  const idleMin = id.pad + (id.send ? SEND_SLOT_SPAN * (id.floor + id.gap) - id.gap : id.floor);
  // a fight with nothing placed yet is planned as one column a rank a side,
  // so the block does not collapse under the first unit placed
  const cols = Math.max(1, i.cols);
  const rt = i.cols > 0 ? i.ranksTop : 1, rb = i.cols > 0 ? i.ranksBot : 1;
  const m = battleMeasure(cols, rt, rb, i.o);
  const floor = Math.min(i.o.floor ?? FLOOR, i.o.cw);
  // 1. height first: the bands at two lines; less, down to one, if the floor needs it
  const room = H - OUTER_GAPS * i.gapY;
  const most = W - i.gapX - idleMin;
  const lift = (t: number): number =>
    (t > 0 && i.tall ? Math.round(FLOOR * (i.o.ratio ?? RATIO) * (1 + t)) + i.tall.pad : 0);
  const liftT = lift(i.tall?.top ?? 0), liftB = lift(i.tall?.bot ?? 0);
  const minT = Math.max(i.bandMin, liftT), minB = Math.max(i.bandMin, liftB);
  const short = Math.max(0, m.height(floor) + i.chrome.h - (room - minT - minB));
  let bandT = Math.max(i.bandFloor, liftT, minT - Math.ceil(short / 2));
  let bandB = Math.max(i.bandFloor, liftB, minB - Math.ceil(short / 2));
  // …but a band you are building a formation FROM holds its units at the
  // size of the slots they go to (owner's review board, 2026-10-11: the units
  // waiting to block stood at ~50px beside ~85px slots): the largest card
  // width at which the fight and that band both stand
  const src = i.source;
  if (src && (src.top > 0 || src.bot > 0)) {
    const ratio = i.o.ratio ?? RATIO;
    const tall = src.extra ?? { top: 0, bot: 0 };
    const bandFor = (n: number, cw: number, more: number, least: number): number =>
      (n > 0 ? Math.max(least, Math.round(Math.min(cw, src.cap) * ratio * (1 + more)) + src.pad) : least);
    const top = (x: number): number => bandFor(src.top, x, tall.top, minT);
    const bot = (x: number): number => bandFor(src.bot, x, tall.bot, minB);
    const cw = largest(floor, Math.floor(i.o.cw), x => m.height(x) + i.chrome.h + top(x) + bot(x) <= room
      && m.width(x) + i.chrome.w <= most);
    if (cw !== null) { bandT = top(cw); bandB = bot(cw); }
  }
  const fightH = room - bandT - bandB;
  const box = { w: most - i.chrome.w, h: fightH - i.chrome.h };
  const p = fitBattle(cols, rt, rb, box, i.o);
  // 2. then the width those columns need, never under the old half
  const half = (W - i.gapX) / 2;
  const needW = (p.mode === 'fan' ? box.w : m.width(p.cw)) + i.chrome.w;
  const wide = needW > half;
  // a wide fight is two grid tracks, so at least half and a gap
  const fight = wide ? Math.round(Math.min(most, Math.max(needW, half + i.gapX))) : half;
  // 3. the rest goes back: the height to the bands, the width to the other region
  const needH = m.height(p.cw) + i.chrome.h;
  const spareH = Math.max(0, Math.floor(fightH - needH));
  let top = Math.floor(spareH / 2);
  if (i.spect && bandT + top < i.spect) top = Math.min(spareH, i.spect - bandT);
  return { wide, fight, idle: Math.round(W - i.gapX - fight), bandTop: bandT + top, bandBot: bandB + spareH - top, cw: p.cw };
}
