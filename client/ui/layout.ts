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

export function fitBoard(root: ParentNode, baseCw: number): void {
  const zones: Iterable<HTMLElement> = root.querySelectorAll?.('.lboard [data-fit]') ?? [];
  for (const el of zones) {
    const kind = el.dataset['fit'];
    const plan = kind === 'battle' ? battlePlan(el, baseCw) : cardsPlan(el, baseCw, kind === 'row');
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
 * from the In Play and battle rows above and below it */
function cardsPlan(el: HTMLElement, baseCw: number, row = false): FitPlan | null {
  // the In Play block also holds the token corner, whose zone comes first in
  // the markup: the FIELD is what the fit is for
  const zone = el.querySelector('.regionmain .zone') ?? el.querySelector('.zone');
  const box = boxOf(zone);
  if (!zone || !box) return null;
  const n = zone.querySelectorAll(':scope > .card, :scope > .slot').length;
  const cw = row ? Math.round(baseCw * 2 / 3) : baseCw;
  return fitCards(n, row ? { w: box.w, h: Math.round(cw * 1.4) + 1 } : box, { cw, gap: 6 });
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
  return fitBattle(n, rank('--rowstop', 2), rank('--rowsbot', 0), box, { cw: baseCw, gap: 14, floor: 40 });
}
