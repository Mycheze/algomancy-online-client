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
import { fitBattle, fitCards, fitSendBox, type FitPlan } from './fit.ts';

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
 * decent bit of empty space"). The field and the battle only: a one-row zone
 * in an auto-sized grid row would take the height it grew from the rows
 * around it. It was 1.5 for one round, and the owner's next word was "they're
 * huge now!" — cards on the table are meant to be fairly small, and the hover
 * zoom (ui/zoom.ts) is how one is read. So: a little room, and a hard cap. */
export const GROW = 1.1;

export function fitBoard(root: ParentNode, baseCw: number): void {
  const zones: Iterable<HTMLElement> = root.querySelectorAll?.('.lboard [data-fit]') ?? [];
  for (const el of zones) {
    const kind = el.dataset['fit'];
    const plan = kind === 'battle' ? battlePlan(el, baseCw)
      : cardsPlan(el, baseCw, kind === 'row' ? 'row' : kind === 'line' ? 'line' : 'box');
    if (!plan) continue;
    // a battle's key also counts its invaders: a second one changes how the
    // strip's cards overlap without changing the plan
    const key = JSON.stringify(plan) + (kind === 'battle' ? `|${el.querySelectorAll('.linvside .card').length}` : '');
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

function boxOf(el: Element | null): { w: number; h: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : null;
}

/** `row`: a zone in an auto-sized grid row (the Invaders row of a region that
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
function cardsPlan(el: HTMLElement, baseCw: number, how: 'box' | 'row' | 'line'): FitPlan | null {
  if (how === 'line') return sendPlan(el, baseCw);
  const maxCw = how === 'box' ? Math.round(baseCw * GROW) : Math.round(baseCw * 2 / 3);
  const row = how !== 'box';
  // the In Play block also holds the token corner, whose zone comes first in
  // the markup: the FIELD is what the fit is for (the corner is a [data-fit]
  // of its own, and finds its token zone by the fallback)
  const zone = el.querySelector('.regionmain .zone') ?? el.querySelector('.zone');
  const box = boxOf(zone);
  if (!zone || !box) return null;
  const n = zone.querySelectorAll(':scope > .card, :scope > .slot').length;
  return fitCards(n, row ? { w: box.w, h: Math.round(maxCw * 1.4) + 1 } : box, { cw: maxCw, gap: 6 });
}

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
  const o = { cw: baseCw, gap: 6 };
  return zone.querySelector(':scope > [data-act="sendslot"]') ? fitSendBox(n, box, o) : fitCards(n, box, o);
}

/** the battle table's own spacing on this board, and style.css says the same
 * (`.lboard .lfight.focus .cols` gap, `.col` padding 3 + border 1 a side).
 * Owner, 2026-09-27: "Formations don't need quite as much space between
 * columns" — it was the classic 14 + 14, 28px from card to card. */
const COL_GAP = 6, COL_CHROME = 8;
/** the invader strip at the right of the fight (owner, 2026-09-27: invaders
 * "can actually be over on the right hand side of the battle area", "WAY
 * smaller", and "always smaller than the actual units in formation"): each
 * card this fraction of the formation's width, the strip `pad` wider */
const INV_FRAC = 0.6, INV_PAD = 12, INV_GAP = 4;
/** CT-192: the counterattack tray's caption, rule and margins (style.css
 * `.stagerow`), over what fitBattle already allows one rank below the line */
const STAGE_CHROME = 8;
/** the battle's card floor on this board */
const FLOOR = 40;

function battlePlan(el: HTMLElement, baseCw: number): FitPlan | null {
  const cols = el.querySelector<HTMLElement>('.cols');
  const box = boxOf(cols);
  if (!cols || !box) return null;
  const n = cols.querySelectorAll(':scope > .col').length;
  // the strip is absolutely placed over the right of the block, so the
  // columns' box is the whole width whatever the strip is: its width is
  // taken out of the same box here, and nothing chases its own tail
  const inv = el.querySelectorAll('.linvside .card').length;
  const rank = (v: string, dflt: number): number => {
    const x = parseInt(cols.style.getPropertyValue(v), 10);
    return Number.isFinite(x) ? x : dflt;
  };
  // a lower floor than a field's: three ranks (attackers, front and back
  // blockers) have to stand in the block, and 40px still reads on the line
  const o = {
    cw: Math.round(baseCw * GROW), gap: COL_GAP, chrome: COL_CHROME, floor: FLOOR,
    side: { n: inv, frac: INV_FRAC, pad: INV_PAD },
  };
  const stage = el.querySelector<HTMLElement>('.stagewrap > .stagerow');
  if (stage) return stagePlan(el, stage, n, o);
  // the declare step draws flat two-slot columns and sets no rank variables:
  // two ranks on one side is the same height as one on each
  return fitBattle(n, rank('--rowstop', 2), rank('--rowsbot', 0), box, o);
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
  const n = strip.querySelectorAll('.card').length;
  const ch = Math.round(plan.side.cw * 1.4);
  const h = boxOf(strip)?.h ?? 0;
  const over = n > 1 && h > 0 && n * ch + (n - 1) * INV_GAP > h;
  strip.style.setProperty('--invstep', over ? `${Math.floor((h - ch) / (n - 1)) - ch}px` : `${INV_GAP}px`);
}

/**
 * THE ACTIVE REGION'S RING (owner, 2026-09-23): one border round the whole L
 * of the focus region, drawn after the fit pass from the measured blocks.
 *
 * An L is not a rectangle, so no box on the board can carry the border: this
 * writes one SVG path, the outline of the union of the region's two tint
 * rectangles (`.lback.a` the band with the info offshoot, `.lback.b` the
 * column) — extended, once a visitor has ENTERED the region (`data-visit`: they
 * declared the attack), over the VISITING player's info offshoot, which sits at
 * the far end of the column on the other half of the board and whose life, hand
 * and mana travel with them into the fight.
 *
 *   top (their region)          bottom (my region)
 *   ┌───────────────┐           ┌───┐ ← visitor info (once they enter)
 *   └───────┐       │           │   │
 *           │       │           │   └───────┐
 *           └───────┘           └───────────┘
 *
 * THE ENTRY (owner, 2026-09-26): when the visitor enters — or goes home while
 * the ring stays on the same region — the ring does not jump, it GROWS over
 * their info (or lets it go). Both shapes are the same six rounded corners, so
 * the path's `d` tweens point for point. The attribute is always the final
 * shape; the tween only plays over it, and where a browser cannot animate `d`
 * (Safari) the ring simply snaps. `animate` is the viewer's motion pref.
 *
 * `root` is `document`; in test/ui-driver.ts nothing has a box and the path is
 * left empty, like the fit pass.
 */
const RING_MS = 420;
/** the last ring drawn, and the entry tween in flight. Module state because
 * every paint replaces the board — and so the <path> — wholesale, and a
 * declaration is followed within milliseconds by more updates (the attack
 * window opening, triggers): the tween must carry on across the new element
 * rather than restart or snap. */
let ringWas: { key: string; visit: boolean; d: string } | null = null;
let ringTween: { key: string; visit: boolean; from: string; to: string; start: number } | null = null;

export function ringBoard(root: ParentNode, animate = false): void {
  const svg = root.querySelector?.<SVGSVGElement>('.lboard > .lring');
  const board = svg?.parentElement;
  const path = svg?.querySelector('path');
  if (!svg || !board || !path) return;
  const o = boxAt(board);
  const box = (sel: string) => boxAt(board.querySelector(sel), o);
  const top = svg.dataset['ring'] === 'top';
  const visit = svg.dataset['visit'] === '1';
  const a = box(top ? '.lback.theirs.a' : '.lback.mine.a');
  const b = box(top ? '.lback.theirs.b' : '.lback.mine.b');
  const far = visit ? box(top ? '.lback.mine.a' : '.lback.theirs.a') : null;
  if (!o || !a || !b || (visit && !far)) { path.removeAttribute('d'); return; }
  const i = 1.5;   // half the stroke: the line stands just inside the tint
  const L = a.l + i, R = a.r - i;
  const pts: Array<[number, number]> = top
    ? [[L, a.t + i], [R, a.t + i], [R, (far ?? b).b - i], [b.l + i, (far ?? b).b - i], [b.l + i, a.b - i], [L, a.b - i]]
    : [[L, (far ?? b).t + i], [b.r - i, (far ?? b).t + i], [b.r - i, a.t + i], [R, a.t + i], [R, a.b - i], [L, a.b - i]];
  const d = roundedPath(pts, 8);
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

/** a closed polygon with every corner rounded to `rad` (or less, on a short side) */
export function roundedPath(pts: ReadonlyArray<readonly [number, number]>, rad: number): string {
  const n = pts.length;
  const f = (v: number): string => (Math.round(v * 10) / 10).toString();
  let d = '';
  for (let k = 0; k < n; k++) {
    const [px, py] = pts[(k + n - 1) % n]!, [cx, cy] = pts[k]!, [nx, ny] = pts[(k + 1) % n]!;
    const d1 = Math.hypot(cx - px, cy - py), d2 = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(rad, d1 / 2, d2 / 2);
    const ax = cx + (px - cx) * (r / (d1 || 1)), ay = cy + (py - cy) * (r / (d1 || 1));
    const bx = cx + (nx - cx) * (r / (d2 || 1)), by = cy + (ny - cy) * (r / (d2 || 1));
    d += `${k ? 'L' : 'M'}${f(ax)} ${f(ay)}Q${f(cx)} ${f(cy)} ${f(bx)} ${f(by)}`;
  }
  return d + 'Z';
}
