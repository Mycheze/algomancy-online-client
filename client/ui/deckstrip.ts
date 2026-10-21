/* THE DECK STRIP — a weekly challenge's deck on the tabletop, in deal order.
 *
 * A challenge deck is dealt exactly as arranged (docs/21-weekly-challenges.md),
 * so on the tabletop (ui/tabletop.ts) it is not a pile but a STRIP under the
 * scratch table: one card per copy, fanned sideways, LEFT TO RIGHT = TOP TO
 * BOTTOM of the deck. Each card shows its left edge (`Sx`, the cost orb and
 * the start of the name) and the last one shows whole; a position number sits
 * under every card, and the Turn-1 hand is bracketed over the cards that are
 * in it.
 *
 * ⚠ THE BRACKET IS THE ENGINE'S ANSWER. Its length is the opening hand a
 * game dealt by `newChallengeGame` holds (ui/challengebuild.ts `openingHand`,
 * a real deal read back) — never the constructed card step re-derived here.
 * The caller passes that number in; this file only draws it.
 *
 * THE DRAG IS THE TABLETOP'S. This is markup only: the strip is the zone
 * `strip` (sideways, `data-tt-axis="x"`) and every card a `data-tt-src` the
 * tabletop's one drag provider already owns — so Firefox's own image drag is
 * cancelled for it like every other card (ui/drag.ts), the gap preview slides
 * these cards along, and a drop or a tap lands through the table's one door,
 * `place()`. A drop between two cards inserts there; past the last, at the
 * end; a strip card dropped on the scratch table leaves the deck, one dropped
 * on the binder is cut.
 *
 * Pure: no DOM, no state.
 */
import { scanHtml } from './piletable.ts';
import { esc } from './util.ts';

/** the share of a card's width each strip card shows (the cost orb and the
 * start of the name) */
export const STRIP_X_SHARE = 0.32;

/** the sideways strip for a card width */
export const stripStep = (cw: number): number => Math.round(cw * STRIP_X_SHARE);

/** the fan's width: every card's strip, and the last one whole */
export const stripWidth = (n: number, Sx: number, cw: number): number => (n <= 0 ? 0 : (n - 1) * Sx + cw);

/** how wide the hand bracket is: over the first `hand` cards as they show */
export const bracketWidth = (hand: number, n: number, Sx: number, cw: number): number =>
  hand <= 0 ? 0 : hand >= n ? stripWidth(n, Sx, cw) : hand * Sx;

export interface StripView {
  /** the deck, top first */
  list: readonly string[];
  /** the opening hand's size, as the engine deals it; null = cannot be dealt */
  hand: number | null;
  /** why the deck cannot be played yet, or null */
  problem: string | null;
  /** the card width and height the page draws at */
  cw: number;
  ch: number;
  /** the card just dropped here, drawn in front */
  front?: number;
  /** the card a finger has picked up */
  picked?: number;
}

/** The deck strip, with its Play button: the markup under the scratch table. */
export function challengeStripHtml(v: StripView): string {
  const n = v.list.length;
  const Sx = stripStep(v.cw);
  const W = stripWidth(n, Sx, v.cw);
  const cards = v.list.map((name, k) =>
    `<div class="ttcard${k === v.front ? ' ttfront' : ''}${k === v.picked ? ' ttpicked' : ''}" style="--k:${k};left:${k * Sx}px;top:0"
      data-btn="tt-card" data-tt-src="${esc(`strip|${k}|${name}`)}" data-tt-i="${k}" data-card="${esc(name)}">${scanHtml(name, 'ttart')}</div>`).join('');
  const nums = v.list.map((_, k) => `<span style="left:${k * Sx}px">${k + 1}</span>`).join('');
  const hand = v.hand && n ? Math.min(v.hand, n) : 0;
  const bracket = hand
    ? `<div class="ttbracket" style="width:${bracketWidth(hand, n, Sx, v.cw)}px" title="the cards you start with, as the game deals them"><span>Turn 1 hand · you bottom 2</span></div>`
    : '<div class="ttbracket ttnohand"></div>';
  return `<section class="ttdeck">
    <div class="ttdeckhead">
      <b>Your deck</b><span class="dim">dealt left to right, 1 on top · ${n} card${n === 1 ? '' : 's'}</span>
      ${v.problem ? `<span class="chproblem">${esc(v.problem)}</span>` : ''}
      <button class="cta primary ttplay" data-btn="ch-play" ${v.problem ? 'disabled' : ''}>Play</button>
    </div>
    <div class="ttstripbox">
      <div class="ttstripzone" data-tt-zone="strip" data-tt-axis="x" data-tt-s="${Sx}" data-tt-n="${n}" data-btn="tt-to">
        ${bracket}
        <div class="ttfan" style="width:${W}px;height:${v.ch}px">${cards}</div>
        <div class="ttstripnums" style="width:${W}px">${nums}</div>
        ${n ? '' : '<span class="dim ttstripempty">Drag cards here from the binder or the table.</span>'}
      </div>
    </div>
  </section>`;
}
