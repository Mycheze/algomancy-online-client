/* THE BOARD LAYOUT PREFERENCE, AND THE TWO RULES THE REGIONS BOARD NEEDS.
 *
 * Owner, 2026-09-22: the middle play zone is being rebuilt as two interlocking
 * L-shaped regions (docs/18-board-layout-v2.md). It ships behind a toggle —
 * "classic" is the board everybody has played on, "regions" is the new one —
 * so the live site keeps working while the new board is playtested. The
 * choice is a per-browser preference like sound and motion (ui/audio.ts,
 * ui/anim.ts): a localStorage key, a button in the side rail, a line on the
 * privacy page (ui/legal.ts BROWSER_KEYS, guarded by test/267).
 *
 * Nothing in the engine knows about any of this. Region ≠ control is a fact
 * the ENGINE has always had (Entity.region, Region.owner); the new board is
 * the first one that draws both.
 */
import type { GameState, Seat } from '../engine/src/types.ts';
import { fitBattle, fitCards, type FitPlan } from './fit.ts';

const PREF = 'algoLayout';

/** is the regions board chosen in this browser? Default: no — classic. */
export function layoutV2(): boolean {
  try { return localStorage.getItem(PREF) === '2'; } catch { return false; }
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
  if (s.phase === 'battle' && s.battle) return s.battle.region;
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
    const key = JSON.stringify(plan);
    if (lastFit.get(el) === key) continue;
    lastFit.set(el, key);
    el.style.setProperty('--cw', `${plan.cw}px`);
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

/** `row`: a zone in an auto-sized grid row (the Invaders rows, an idle band
 * with counterattackers in transit) — its height follows its content, so
 * measuring it would only ever confirm it; the fit is by width alone, one
 * row deep, and from the classic strips' two-thirds size (52px at the base
 * 78), because a row that grew to full-size cards would take that height
 * from the In Play and battle rows above and below it.
 * `line`: the same one-row-deep fit at FULL size — the counterattack send box,
 * which has a whole battle block's height to stand in and is a formation in
 * the making, so its cards are battle-sized */
function cardsPlan(el: HTMLElement, baseCw: number, how: 'box' | 'row' | 'line'): FitPlan | null {
  const maxCw = how === 'box' ? Math.round(baseCw * GROW) : how === 'row' ? Math.round(baseCw * 2 / 3) : baseCw;
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

function battlePlan(el: HTMLElement, baseCw: number): FitPlan | null {
  const cols = el.querySelector<HTMLElement>('.cols');
  const box = boxOf(cols);
  if (!cols || !box) return null;
  const n = cols.querySelectorAll(':scope > .col').length;
  const rank = (v: string, dflt: number): number => {
    const x = parseInt(cols.style.getPropertyValue(v), 10);
    return Number.isFinite(x) ? x : dflt;
  };
  // the declare step draws flat two-slot columns and sets no rank variables:
  // two ranks on one side is the same height as one on each
  // a lower floor than a field's: three ranks (attackers, front and back
  // blockers) have to stand in the block, and 40px still reads on the line
  return fitBattle(n, rank('--rowstop', 2), rank('--rowsbot', 0), box, { cw: Math.round(baseCw * GROW), gap: 14, floor: 40 });
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
