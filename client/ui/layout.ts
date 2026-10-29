/* THE BOARD LAYOUT PREFERENCE, AND THE TWO RULES THE REGIONS BOARD NEEDS.
 *
 * Owner, 2026-09-22: the middle play zone is being rebuilt as two interlocking
 * L-shaped regions (docs/18-board-layout-v2.md). It shipped behind a toggle —
 * "classic" the board everybody had played on, "regions" the new one — and
 * became the default on 2026-09-26; the toggle stays for classic. The
 * choice is a per-browser preference like sound and motion (ui/audio.ts,
 * ui/anim.ts): a localStorage key, a button in the side rail, a line on the
 * privacy page (ui/legal.ts BROWSER_KEYS, guarded by test/267).
 *
 * Nothing in the engine knows about any of this. Region ≠ control is a fact
 * the ENGINE has always had (Entity.region, Region.owner); the new board is
 * the first one that draws both.
 */
import type { GameState, Seat } from '../engine/src/types.ts';
import { FLOOR as CARD_FLOOR, RATIO, fitBattle, fitCards, fitRes, fitSendBox, planBattleBoard, type FitPlan } from './fit.ts';

const PREF = 'algoLayout';

/** is the regions board chosen in this browser? Default: yes — regions.
 * Owner, 2026-09-26: regions is the board for everyone now; classic stays one
 * click away. Only an explicit '1' (the toggle turned back to classic) keeps
 * classic, so a player who already chose it keeps it. */
export function layoutV2(): boolean {
  try { return localStorage.getItem(PREF) !== '1'; } catch { return true; }
}
export function setLayoutV2(on: boolean): void {
  try { localStorage.setItem(PREF, on ? '2' : '1'); } catch { /* private window */ }
}

/**
 * THE FOCUS REGION — the one region that matters right now.
 *
 * In a battle it is the region the battle is in (`battle.region`): round 1 is
 * fought in the defender's region, round 2 in the attacker's. Outside a
 * battle the opponent's region does not exist for you — nothing in it can be
 * touched from yours — so YOUR region is the focus. Owner, 2026-09-22:
 * "Outside battle, the opponent's region doesn't exist. Yours is the focus."
 *
 * The stack window sits over the OTHER region's battle band: the one place on
 * the board that is guaranteed idle while you are reading the stack.
 */
export function focusRegion(s: GameState, viewer: Seat): number {
  // …and a game that ended mid-battle stays focused on the fight it ended in,
  // which the regions board still draws (#172)
  if ((s.phase === 'battle' || s.phase === 'gameover') && s.battle) return s.battle.region;
  const home = s.regions.findIndex(r => r.owner === viewer);
  return home >= 0 ? home : 0;
}

/**
 * The fit pass over a painted regions board: measure every `[data-fit]` zone,
 * decide a card width for it (ui/fit.ts), write the answer back as CSS
 * variables. Runs after every paint and on resize (main.ts `relayout`).
 *
 * `root` is `document` in the browser. In test/ui-driver.ts nothing here has
 * a box, so every zone measures zero and the pass is a no-op by design — the
 * arithmetic is proven by test/317-fit-pass on the pure functions instead.
 *
 * Idempotent per (zone box, card count): a zone whose inputs have not changed
 * is not written to, so an `auto`-sized grid row cannot chase its own tail.
 */
const lastFit = new WeakMap<Element, string>();

/** how far past the base card width a zone with room to spare may grow its
 * cards (owner, 2026-09-23: "really small on the screen despite there being a
 * decent bit of empty space"). The field only — the battle has had its own
 * cap since round 7 (BATTLE_CAP): a one-row zone
 * in an auto-sized grid row would take the height it grew from the rows
 * around it. It was 1.5 for one round, and the owner's next word was "they're
 * huge now!" — cards on the table are meant to be fairly small, and the hover
 * zoom (ui/zoom.ts) is how one is read. So: a little room, and a hard cap. */
export const GROW = 1.1;

export function fitBoard(root: ParentNode, baseCw: number): void {
  shapeBoard(root, baseCw);
  const zones: Iterable<HTMLElement> = root.querySelectorAll?.('.lboard [data-fit]') ?? [];
  for (const el of zones) {
    const kind = el.dataset['fit'];
    if (kind === 'res') { resLine(el); continue; }
    const plan = kind === 'battle' ? battlePlan(el, baseCw)
      : cardsPlan(el, baseCw, kind === 'row' ? 'row' : kind === 'line' ? 'line' : kind === 'band' ? 'band' : 'box');
    if (!plan) continue;
    // a battle's key also counts its invaders: a second one — or a modded,
    // taller one — changes how the strip's cards overlap without changing the plan
    const inv = kind === 'battle' ? cardsIn(el, '.linvside .card') : [];
    const key = JSON.stringify(plan) + (kind === 'battle' ? `|${inv.length}|${inv.map(modhOf).join(',')}` : '');
    if (lastFit.get(el) === key) continue;
    lastFit.set(el, key);
    el.style.setProperty('--cw', `${plan.cw}px`);
    if (kind === 'battle') sideStrip(el, plan);
    if (plan.mode === 'fan') {
      el.dataset['fitmode'] = 'fan';
      el.style.setProperty('--fanstep', `${plan.step}px`);
    } else {
      delete el.dataset['fitmode'];
      el.style.removeProperty('--fanstep');
    }
  }
}

/** how much taller than a card a card here is: the mod strips a modded unit
 * hangs under it (main.ts fieldMods writes `data-modh`, in card heights) */
const modhOf = (card: Element | undefined): number => Number((card as HTMLElement | undefined)?.dataset?.['modh'] ?? 0) || 0;
/** the cards under `el` matching `sel`, as a list (a NodeList, or whatever
 * array-like a test's stand-in returns) */
const cardsIn = (el: Element | null | undefined, sel: string): Element[] => Array.from(el?.querySelectorAll?.(sel) ?? []);
/** the tallest card among `cards`, over a plain one */
const tallest = (cards: readonly (Element | undefined)[]): number => {
  let n = 0;
  for (const c of cards) n = Math.max(n, modhOf(c));
  return n;
};
/** a zone's card shape: a plain card's, stretched for its tallest card. A
 * fit for every card at the tallest one's height is never short, and a zone
 * holding a really modded unit shrinks all of its cards a little rather than
 * clipping one */
const zoneRatio = (cards: readonly (Element | undefined)[]): number => RATIO * (1 + tallest(cards));

function boxOf(el: Element | null): { w: number; h: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : null;
}

/** `box`: a field, wrapped in its block. `row`: a zone in an auto-sized grid row (the Invaders row of a region that
 * is not fighting, an idle band
 * with counterattackers in transit) — its height follows its content, so
 * measuring it would only ever confirm it; the fit is by width alone, one
 * row deep, and from the classic strips' two-thirds size (52px at the base
 * 78), because a row that grew to full-size cards would take that height
 * from the In Play and battle rows above and below it.
 * `line`: the counterattack send box, at up to FULL size — a formation in the
 * making, so its cards are battle-sized. It has a whole battle block's height
 * to stand in, and since report #196 it USES it: the box wraps, and the fit is
 * over the block's height, not one card's (ui/fit.ts fitSendBox) */
function cardsPlan(el: HTMLElement, baseCw: number, how: 'box' | 'row' | 'line' | 'band'): FitPlan | null {
  if (how === 'line') return sendPlan(el, baseCw);
  const maxCw = how === 'box' ? Math.round(baseCw * GROW) : Math.round(baseCw * 2 / 3);
  // `band` (round 7): the counterattackers heading for the idle block, in the
  // narrow column at the side of a battle. They wrap down its height at the
  // row size, so the fit is over the zone's whole box (style.css stretches it)
  const row = how === 'row';
  // the In Play block also holds the token corner, whose zone comes first in
  // the markup: the FIELD is what the fit is for (the corner is a [data-fit]
  // of its own, and finds its token zone by the fallback)
  const zone = el.querySelector('.regionmain .zone') ?? el.querySelector('.zone');
  const box = boxOf(zone);
  if (!zone || !box) return null;
  // the token corner (checkpoint 4) holds STACKS: each is one card wide plus
  // its deck edge (at most TOK_EDGES px, main.ts tokenStackHtml), and it may go
  // under the field's floor rather than lose a stack below the band's edge —
  // the die face and the count still read at TOK_FLOOR
  if (el.classList?.contains('ltok')) {
    const stacks = zone.querySelectorAll(':scope > .tokstack');
    const ratio = zoneRatio(cardsIn(zone, ':scope > .tokstack .card'));
    return fitCards(stacks.length, box, { cw: maxCw, gap: TOK_GAP + TOK_EDGES, ratio, floor: TOK_FLOOR });
  }
  const n = zone.querySelectorAll(':scope > .card, :scope > .slot').length;
  const ratio = zoneRatio(cardsIn(zone, ':scope > .card'));
  return fitCards(n, row ? { w: box.w, h: Math.round(maxCw * ratio) + 1 } : box, { cw: maxCw, gap: 6, ratio });
}

/** the token corner's spacing: style.css `.ltok > .tokenzone` gap, the most a
 * stack's deck edge adds (3 cards' worth, `--edge` ≤ 3px, plus the count's
 * overhang), and the smallest card it will draw */
const TOK_GAP = 4, TOK_EDGES = 10, TOK_FLOOR = 28;

/** the vertical (or horizontal) padding + border of an element, from its
 * computed style — what lies between its border box and its content */
function chrome(el: Element, axis: 'v' | 'h'): number {
  const cs = getComputedStyle(el);
  let n = 0;
  for (const side of axis === 'v' ? ['top', 'bottom'] : ['left', 'right']) {
    n += (parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0)
      + (parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0);
  }
  return n;
}

/** report #196: the send box's plan. Its width is the row's own content box;
 * its HEIGHT is the battle block's, less the block's padding and the box's
 * own — the block is a fixed grid cell (a `minmax(0, fr)` row), so this does
 * not move with the answer. The drop slot counts at its two-card width; the
 * watching seat's inert copy has no slot. */
function sendPlan(el: HTMLElement, baseCw: number): FitPlan | null {
  const zone = el.querySelector('.lsendrow');
  const wrap = zone?.parentElement;
  const block = boxOf(el), row = boxOf(zone ?? null);
  if (!zone || !wrap || !block || !row) return null;
  const box = {
    w: row.w - chrome(zone, 'h'),
    h: block.h - chrome(el, 'v') - chrome(wrap, 'v') - chrome(zone, 'v'),
  };
  const n = zone.querySelectorAll(':scope > .card').length;
  const o = { cw: baseCw, gap: 6, ratio: zoneRatio(cardsIn(zone, ':scope > .card')) };
  return zone.querySelector(':scope > [data-act="sendslot"]') ? fitSendBox(n, box, o) : fitCards(n, box, o);
}

/** the battle table's own spacing on this board, and style.css says the same
 * (`.lboard .lfight.focus .cols` gap, `.col` padding 3 + border 1 a side).
 * Owner, 2026-09-27: "Formations don't need quite as much space between
 * columns" — it was the classic 14 + 14, 28px from card to card. */
const COL_GAP = 2, COL_CHROME = 6;
/** the invader strip at the right of the fight (owner, 2026-09-27: invaders
 * "can actually be over on the right hand side of the battle area", "WAY
 * smaller", and "always smaller than the actual units in formation"): each
 * card this fraction of the formation's width, the strip `pad` wider */
const INV_FRAC = 0.6, INV_PAD = 8, INV_GAP = 2;
/** CT-192: the counterattack tray's caption, rule and margins (style.css
 * `.stagerow`), over what fitBattle already allows one rank below the line */
const STAGE_CHROME = 8;
/** the battle's card floor on this board */
const FLOOR = 40;
/** the battle's card CAP (owner, 2026-10-11, report #204: a moderate cap, not
 * unbounded — first "~120px", then on the board: "the 120px cap is a bit big.
 * I think it should cap at 100px/card during a fight"). It was the field's
 * GROW, 86px. */
export const BATTLE_CAP = 100;
/** a band in a battle — an In Play, full width, between its info line and
 * the middle (board round 8): `want` is what it stands at while the fight can
 * use the height, `least` as far as it gives before the battle's own floor
 * stops standing. Master's numbers (the info offshoot's two lines, 80, and its
 * one, 44, when the offshoot shared the band with In Play), kept as they were
 * (audit, board round 8). */
export const BAND = { want: 80, least: 44 } as const;

function battlePlan(el: HTMLElement, baseCw: number): FitPlan | null {
  const cols = el.querySelector<HTMLElement>('.cols');
  const box = boxOf(cols);
  // the strip is absolutely placed over the right of the block, so the
  // columns' box is the whole width whatever the strip is: its width is
  // taken out of the same box here, and nothing chases its own tail
  const inv = el.querySelectorAll('.linvside .card').length;
  // a lower floor than a field's: three ranks (attackers, front and back
  // blockers) have to stand in the block, and 40px still reads on the line
  const o = battleOpts(inv, cols ? extraOf(cols) : undefined);
  // Report #200: watching the other seat declare with nothing placed yet
  // draws no columns at all — the strip still needs its size
  if (!cols || !box) return inv ? fitBattle(0, 0, 0, { w: 0, h: 0 }, o) : null;
  const n = cols.querySelectorAll(':scope > .col').length;
  const stage = el.querySelector<HTMLElement>('.stagewrap > .stagerow');
  if (stage) return stagePlan(el, stage, n, battleOpts(inv, extraOf(cols, stage)));
  const ranks = ranksOf(cols);
  return fitBattle(n, ranks.top, ranks.bot, box, o);
}

/** the battle's fit options: the cap, its own spacing, the floor, the strip,
 * and the height its modded units add to each half (`extraOf`) */
function battleOpts(inv: number, extra?: { top: number; bot: number }): Parameters<typeof fitBattle>[4] {
  return {
    cw: BATTLE_CAP, gap: COL_GAP, chrome: COL_CHROME, floor: FLOOR, side: { n: inv, frac: INV_FRAC, pad: INV_PAD },
    ...(extra && (extra.top || extra.bot) ? { extra } : {}),
  };
}

/** how much longer than its plain ranks each half of the table stands: a
 * column's half is its cards one above another, so a modded unit lengthens
 * its own column by its strips, and the half is as long as its longest
 * column. The counterattack tray is one more row along the foot (CT-192), as
 * tall as its tallest card. */
function extraOf(cols: HTMLElement, stage?: HTMLElement | null): { top: number; bot: number } {
  let top = 0, bot = 0;
  for (const col of cardsIn(cols, ':scope > .col')) {
    const sum = (sel: string): number => cardsIn(col, `:scope > ${sel} .card`).reduce((n, c) => n + modhOf(c), 0);
    top = Math.max(top, sum('.bhalf.top'));
    bot = Math.max(bot, sum('.bhalf.bot'));
  }
  if (stage) bot += tallest(cardsIn(stage, '.card'));
  return { top, bot };
}

/** the battle table's ranks, off the variables battleHtml writes on `.cols`
 * (the declare step writes none: its flat two-slot columns stand two ranks
 * on one side, the same height as one on each) */
function ranksOf(cols: HTMLElement): { top: number; bot: number } {
  const rank = (v: string, dflt: number): number => {
    const x = parseInt(cols.style.getPropertyValue(v), 10);
    return Number.isFinite(x) ? x : dflt;
  };
  return { top: rank('--rowstop', 2), bot: rank('--rowsbot', 0) };
}

/**
 * ROUND 7 — THE BOARD'S SHAPE IN A BATTLE (report #204; ui/fit.ts
 * planBattleBoard decides it). Runs before any zone is fitted, since every
 * zone's box follows from it: the idle column's width and the two bands'
 * heights, written on `.lboard` as `--lidle`, `--lbandt`, `--lbandb` (style.css
 * `.lboard[data-fight]` makes the grid of them). Its inputs are the board's
 * own box (which the flex column sets, not its content), the info lines'
 * fixed heights, card counts and the stylesheet's paddings — nothing it
 * writes — so it cannot chase its tail. Outside a battle there is no
 * `data-fight` and the board is the grid it was.
 *
 * Board round 8: the bands are the two In Plays alone, full width — each
 * info line is a row of its own outside them.
 */
const lastShape = new WeakMap<Element, string>();
function shapeBoard(root: ParentNode, baseCw: number): void {
  const lb = root.querySelector?.<HTMLElement>('.lboard[data-fight]');
  const fight = lb?.querySelector<HTMLElement>('.lfight.focus');
  const idleEl = lb?.querySelector<HTMLElement>('.lfight:not(.focus)');
  const box = boxOf(lb ?? null);
  if (!lb || !fight || !idleEl || !box) return;
  const cs = getComputedStyle(lb);
  const gapY = parseFloat(cs.rowGap) || 0;
  // board round 8: the info lines are rows of their own, the full width —
  // the plan is over what lies between them (their heights are the
  // stylesheet's, not anything this writes)
  const lines = (boxOf(lb.querySelector('.linfo.theirs'))?.h ?? 0) + (boxOf(lb.querySelector('.linfo.mine'))?.h ?? 0);
  const cols = fight.querySelector<HTMLElement>('.cols');
  const stage = !!fight.querySelector('.stagewrap > .stagerow');
  const ranks = cols ? ranksOf(cols) : { top: 1, bot: 1 };
  const battle = fight.querySelector('.battle');
  const inv = fight.querySelectorAll('.linvside .card').length;
  const plan = planBattleBoard({
    board: { w: box.w - chrome(lb, 'h'), h: box.h - chrome(lb, 'v') - lines - (lines ? 2 * gapY : 0) },
    gapX: parseFloat(cs.columnGap) || 0, gapY,
    cols: cols ? cols.querySelectorAll(':scope > .col').length : 0,
    // the counterattack tray stands as a third rank under the columns
    ranksTop: stage ? 2 : ranks.top, ranksBot: stage ? 1 : ranks.bot,
    o: battleOpts(inv, cols ? extraOf(cols, fight.querySelector<HTMLElement>('.stagewrap > .stagerow')) : undefined),
    chrome: {
      w: chrome(fight, 'h') + (battle ? chrome(battle, 'h') : 0),
      h: chrome(fight, 'v') + (battle ? chrome(battle, 'v') : 0) + (stage ? STAGE_CHROME : 0),
    },
    bandMin: BAND.want, bandFloor: BAND.least,
    tall: bandsTall(lb),
    idle: { send: idleEl.classList.contains('sendhere'), pad: chrome(idleEl, 'h'), gap: 6, floor: CARD_FLOOR },
    // the units you can put in the declaration being built (ui/battle.ts
    // formationCandidates → `playable` on a standing unit)
    source: sourceOf(lb, baseCw),
  });
  if (!plan) return;
  const key = JSON.stringify(plan);
  if (lastShape.get(lb) === key) return;
  lastShape.set(lb, key);
  // a fight that fits in half the board keeps the half-and-half middle; a
  // wider one pushes the seam aside, the idle column  wide
  if (plan.wide) lb.dataset['wide'] = ''; else delete lb.dataset['wide'];
  lb.style.setProperty('--lidle', `${plan.idle}px`);
  lb.style.setProperty('--lbandt', `${plan.bandTop}px`);
  lb.style.setProperty('--lbandb', `${plan.bandBot}px`);
}

/** the tallest unit in each In Play band, over a plain card, for
 * planBattleBoard's `tall` */
function bandsTall(lb: HTMLElement): { top: number; bot: number; pad: number } | undefined {
  const top = tallest(cardsIn(lb, '.lplay.theirs .regionmain .card'));
  const bot = tallest(cardsIn(lb, '.lplay.mine .regionmain .card'));
  if (!top && !bot) return undefined;
  const play = lb.querySelector?.(top ? '.lplay.theirs' : '.lplay.mine');
  return { top, bot, pad: play ? chrome(play, 'v') : 12 };
}

/** the In Play bands holding units the viewer can put in the formation being
 * built, for planBattleBoard's `source` */
function sourceOf(lb: HTMLElement, baseCw: number): NonNullable<Parameters<typeof planBattleBoard>[0]['source']> | undefined {
  const cards = (side: string): Element[] => cardsIn(lb, `.lplay.${side} .regionmain .card.playable`);
  const theirs = cards('theirs'), mine = cards('mine');
  const top = theirs.length, bot = mine.length;
  if (!top && !bot) return undefined;
  const play = lb.querySelector(top ? '.lplay.theirs' : '.lplay.mine');
  // a band holding a modded unit stands as tall as that unit, or the fit
  // shrinks every unit in it to make the long one fit
  const extra = { top: tallest(theirs), bot: tallest(mine) };
  return { top, bot, cap: Math.round(baseCw * GROW), pad: play ? chrome(play, 'v') : 12,
    ...(extra.top || extra.bot ? { extra } : {}) };
}

/**
 * BOARD ROUND 8 — THE RESOURCES SPREAD (ui/fit.ts fitRes). The info line is
 * the table's width, so a run of one kind need not fan: its cards stand side
 * by side when the line has the room, and overlap only as far as they must.
 * Writes `--resstep` (and `data-spread` when nothing is hidden) on `.lres`.
 * The room is the line's own width less the mana text and any wake run —
 * neither moves with the answer.
 */
const RES_GAP = 10, RES_WAKE_GAP = 4, RES_MIN_STEP = 6;
/** style.css `.linfo .lres { --rcw: 30px }` — master's resource card */
const RES_CW = 30;
function resLine(el: HTMLElement): void {
  const row = el.querySelector<HTMLElement>('.lresrow');
  const box = boxOf(el);
  const info = el.closest?.('.linfo') ?? null;
  if (!row || !box || !info) return;
  const runs: number[] = [], wakes: number[] = [];
  for (const g of cardsIn(row, ':scope > .resgroup')) {
    const k = cardsIn(g, ':scope > .rescard').length;
    (g.classList.contains('wake') ? wakes : runs).push(k);
  }
  if (!runs.length && !wakes.length) return;
  const mana = row.querySelector('.resmana');
  const room = box.w - chrome(el, 'h') - (mana ? (boxOf(mana)?.w ?? 0) + RES_GAP : 0) - 2;
  const fit = fitRes({ runs, wakes, room, cw: RES_CW, minCw: 20, gap: RES_GAP, wakeGap: RES_WAKE_GAP, minStep: RES_MIN_STEP });
  const key = `${fit.cw}|${fit.step}|${fit.spread}`;
  if (lastFit.get(el) === key) return;
  lastFit.set(el, key);
  el.style.setProperty('--rcw', `${fit.cw}px`);
  el.style.setProperty('--resstep', `${fit.step}px`);
  if (fit.spread) el.dataset['spread'] = ''; else delete el.dataset['spread'];
}

/**
 * CT-192 — THE COUNTERATTACK TRAY'S PLACE, decided by the room there is.
 *
 * The owner's layout puts the sent units in a row of full-size cards along the
 * foot of the fight, under the columns: one more rank of the same cards. The
 * fit is over the columns and the tray together (`.stagewrap`, whose box does
 * not move with the answer), so a card size never chases its own tail.
 *
 * Where a third rank will not stand at the floor — a laptop's 768px, a tablet
 * — the row would cut the back slots off, and a slot you cannot see is a slot
 * you cannot use (never hide, never scroll). There the tray stands BESIDE the
 * columns instead, on the seam side (the crossing, the edge nearest the
 * builder's home column), two ranks deep like the columns, and reserves the
 * width of the whole pool so the cards do not grow as it empties.
 */
function stagePlan(el: HTMLElement, stage: HTMLElement, n: number, o: Parameters<typeof fitBattle>[4]): FitPlan | null {
  const wrap = boxOf(stage.parentElement);
  if (!wrap) return null;
  const under = { w: wrap.w, h: wrap.h - STAGE_CHROME };
  const fitsUnder = fitBattle(n, 2, 1, under, { ...o, floor: 1 }).cw >= FLOOR;
  el.dataset['stage'] = fitsUnder ? 'below' : 'beside';
  if (fitsUnder) return fitBattle(n, 2, 1, under, o);
  const trayCols = Math.max(1, Math.ceil(Number(stage.dataset['pool'] ?? 1) / 2));
  return fitBattle(n + trayCols, 2, 0, wrap, o);
}

/** write the invader strip's card width, its own width, and — when its cards
 * do not stand one above another in its height — how far each overlaps the
 * one before (the same "overlap, never scroll" rule as every other zone) */
function sideStrip(el: HTMLElement, plan: FitPlan): void {
  const strip = el.querySelector<HTMLElement>('.linvside');
  if (!strip || !plan.side) return;
  strip.style.setProperty('--cw', `${plan.side.cw}px`);
  strip.style.setProperty('--invw', `${plan.side.w}px`);
  // on the block too: the columns centre in the width the strip leaves them
  // (style.css pads `.cols` by it)
  el.style.setProperty('--invw', `${plan.side.w}px`);
  const cards = cardsIn(strip, '.card');
  const n = cards.length;
  // every card's own height: a modded invader is taller by its strips
  const tall = cards.reduce((t, c) => t + Math.round(plan.side!.cw * RATIO * (1 + modhOf(c))), 0);
  const h = boxOf(strip)?.h ?? 0;
  const over = n > 1 && h > 0 && tall + (n - 1) * INV_GAP > h;
  strip.style.setProperty('--invstep', over ? `${Math.floor((h - tall) / (n - 1))}px` : `${INV_GAP}px`);
}

/**
 * THE ACTIVE REGION'S RING (owner, 2026-09-23): one border round the whole L
 * of the focus region, drawn after the fit pass from the measured blocks.
 *
 * An L is not a rectangle, so no box on the board can carry the border: this
 * writes one SVG path, the outline of the union of the region's two tint
 * rectangles (`.lback.a` its foot — info line and In Play, the full width;
 * `.lback.b` its column of the middle) — extended, once a visitor has ENTERED
 * the region (`data-visit`: they declared the attack), over the part of the
 * VISITING player's info line that travels with them into the fight: their
 * name and life, cache and bin, the end of their line beyond this column.
 *
 * BOARD ROUND 8 (owner, 2026-10-27): YOUR region's ring does not close under
 * your info line. It runs on down both sides round the action bar and the
 * hand and off the bottom of the window — an open path with no bottom edge —
 * because the hand and the bar are yours too. Theirs closes as it always did.
 * The layer is fixed over the window (`#app > .lring`, see main.ts lringHtml)
 * because the bar and the dock are outside `.main`, which clips.
 *
 *   top (their region)              bottom (my region)
 *   ┌───────────────────┐                ┌────┐ ← their name/cache/bin,
 *   │ their line, In Play│               │    │   once they enter
 *   └──────┐            │                │    └───────┐
 *          │  middle    │                │            └────────────┐
 *          └──────┐     │ ← my name/     │ my In Play, line         │
 *                 └─────┘   cache/bin    │ bar · hand               │
 *                                        ╵                          ╵ (off the window)
 *
 * THE ENTRY (owner, 2026-09-26): when the visitor enters — or goes home while
 * the ring stays on the same region — the ring does not jump, it GROWS over
 * their info (or lets it go). Both shapes have the same points, so the path's
 * `d` tweens point for point. The attribute is always the final shape; the
 * tween only plays over it, and where a browser cannot animate `d` (Safari)
 * the ring simply snaps. `animate` is the viewer's motion pref.
 *
 * `root` is `document`; in test/ui-driver.ts nothing has a box and the path is
 * left empty, like the fit pass.
 */
const RING_MS = 420;
/** how far past the window's foot your region's open ring runs, so its ends
 * are never seen */
const RING_RUNOFF = 8;
/** the last ring drawn, and the entry tween in flight. Module state because
 * every paint replaces the board — and so the <path> — wholesale, and a
 * declaration is followed within milliseconds by more updates (the attack
 * window opening, triggers): the tween must carry on across the new element
 * rather than restart or snap. */
let ringWas: { key: string; visit: boolean; d: string } | null = null;
let ringTween: { key: string; visit: boolean; from: string; to: string; start: number } | null = null;

export function ringBoard(root: ParentNode, animate = false): void {
  const svg = root.querySelector?.<SVGSVGElement>('#app > .lring');
  const board = root.querySelector?.<HTMLElement>('.lboard');
  const path = svg?.querySelector('path');
  if (!svg || !board || !path) return;
  const o = boxAt(svg);
  const box = (sel: string) => boxAt(board.querySelector(sel), o);
  const top = svg.dataset['ring'] === 'top';
  const visit = svg.dataset['visit'] === '1';
  const a = box(top ? '.lback.theirs.a' : '.lback.mine.a');
  const b = box(top ? '.lback.theirs.b' : '.lback.mine.b');
  // the visitor's INFO LINE (theirs along the top, mine along the bottom)
  const far = visit ? box(top ? '.linfo.mine' : '.linfo.theirs') : null;
  if (!o || !a || !b || (visit && !far)) { path.removeAttribute('d'); return; }
  const i = 1.5;   // half the stroke: the line stands just inside the tint
  const L = a.l + i, R = a.r - i;
  // ONCE THE VISITOR HAS ENTERED, the ring grows over the part of their info
  // line that travels with them (master's ring took in their whole info
  // offshoot, which sat at the far end of the column): their name and life,
  // cache and bin — the end of their line that lies under (over) this
  // region's column, across the other region's In Play, whose cards pack
  // from the other side. The ring takes in that stretch's width and not the
  // column's, as it took the offshoot's. Not visiting, the same points stand
  // on the column's end, so the entry tween moves point for point.
  const lineSel = top ? '.linfo.mine' : '.linfo.theirs';
  const ends = Array.from(board.querySelectorAll?.(`${lineSel} .lid, ${lineSel} .lcache, ${lineSel} .lbin`) ?? [])
    .map(e => boxAt(e, o)).filter((x): x is Box => !!x);
  const ex = top
    ? Math.max(b.l, ends.length ? Math.min(...ends.map(x => x.l)) - 6 : b.l) + i
    : Math.min(b.r, ends.length ? Math.max(...ends.map(x => x.r)) + 6 : b.r) - i;
  const pts: Array<[number, number]> = top
    // their foot along the top, their column down the right of the middle,
    // and (visiting) on down round my name, cache and bin
    ? [[L, a.t + i], [R, a.t + i], [R, (far ?? b).b - i], [ex, (far ?? b).b - i], [ex, b.b - i],
      [b.l + i, b.b - i], [b.l + i, a.b - i], [L, a.b - i]]
    // mine: up the left from off the window's foot — (visiting) on up round
    // their name, cache and bin — round my column, across the top of my foot
    // and down the right off the foot again
    : [[L, (o.b - o.t) + RING_RUNOFF], [L, (far ?? b).t + i], [ex, (far ?? b).t + i], [ex, b.t + i],
      [b.r - i, b.t + i], [b.r - i, a.t + i], [R, a.t + i], [R, (o.b - o.t) + RING_RUNOFF]];
  const d = roundedPath(pts, 8, !top);
  path.setAttribute('d', d);

  const key = `${svg.getAttribute('class')} ${top}`;
  const now = performance.now();
  const was = ringWas;
  ringWas = { key, visit, d };
  const t = ringTween;
  if (animate && was && was.key === key && was.visit !== visit) {
    ringTween = { key, visit, from: was.d, to: d, start: now };
  } else if (animate && t && t.key === key && t.visit === visit && now - t.start < RING_MS) {
    t.to = d;   // a repaint mid-entry: same tween, onto the new shape
  } else { ringTween = null; return; }
  const tw = ringTween!;
  try {
    for (const an of path.getAnimations()) an.cancel();
    const an = path.animate([{ d: `path('${tw.from}')` }, { d: `path('${tw.to}')` }],
      { duration: RING_MS, easing: 'cubic-bezier(.2, .7, .2, 1)' });
    an.currentTime = now - tw.start;
  } catch { /* no CSS `d`: the attribute already holds the final ring */ }
}

interface Box { l: number; t: number; r: number; b: number }
/** an element's box, relative to `o` when given */
function boxAt(el: Element | null, o?: Box | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  const x = o?.l ?? 0, y = o?.t ?? 0;
  return { l: r.left - x, t: r.top - y, r: r.right - x, b: r.bottom - y };
}

/** a closed polygon with every corner rounded to `rad` (or less, on a short
 * side) — or, `open`, a polyline: its two ends are not corners and there is
 * no closing edge (your region's ring, which runs off the window's foot) */
export function roundedPath(pts: ReadonlyArray<readonly [number, number]>, rad: number, open = false): string {
  const n = pts.length;
  const f = (v: number): string => (Math.round(v * 10) / 10).toString();
  let d = '';
  for (let k = 0; k < n; k++) {
    if (open && (k === 0 || k === n - 1)) { d += `${k ? 'L' : 'M'}${f(pts[k]![0])} ${f(pts[k]![1])}`; continue; }
    const [px, py] = pts[(k + n - 1) % n]!, [cx, cy] = pts[k]!, [nx, ny] = pts[(k + 1) % n]!;
    const d1 = Math.hypot(cx - px, cy - py), d2 = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(rad, d1 / 2, d2 / 2);
    const ax = cx + (px - cx) * (r / (d1 || 1)), ay = cy + (py - cy) * (r / (d1 || 1));
    const bx = cx + (nx - cx) * (r / (d2 || 1)), by = cy + (ny - cy) * (r / (d2 || 1));
    d += `${k ? 'L' : 'M'}${f(ax)} ${f(ay)}Q${f(cx)} ${f(cy)} ${f(bx)} ${f(by)}`;
  }
  return open ? d : d + 'Z';
}
