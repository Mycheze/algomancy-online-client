/* A PILE ON THE TABLETOP — the fan of real card scans, and the arithmetic of
 * where a carried card would land in it.
 *
 * The tabletop deck builder (ui/tabletop.ts) lays a deck out as piles in a
 * wrapping row; the challenge builder's scratch table is the same component
 * with no Maybe. This file is the component: the markup of one pile, and the
 * pure geometry that both the markup and the drop use, so the gap the drag
 * preview opens and the index the drop commits are computed by the same
 * function (ui/test/538 pins it).
 *
 * THE FAN. Every copy is a card of its own, absolutely placed inside the
 * pile's fan box at `top = k·S`: card k shows its top strip (the scan's name
 * and cost band) and the last card shows whole. Later cards paint over
 * earlier ones by z-index = k, so a press on a strip finds THAT copy with
 * the browser's own hit-testing — no negative margins: the v1 cascade drew
 * each later sibling over the earlier ones by margin, and a card dropped
 * mid-pile showed only a sliver, which read as "it went to the back" (owner,
 * 2026-10-21). The dropped card is drawn in front instead (`ttfront`).
 *
 * Pure but for the markup: no DOM, no state.
 */
import { rowFor } from './cardindex.ts';
import { artHtml } from './cardpanel.ts';
import { esc } from './util.ts';

/** a scan's height over its width (the scans are 720 × 1000) */
export const CARD_ASPECT = 1000 / 720;
/** the narrowest strip a crowded pile shrinks to, in px */
export const MIN_STRIP = 14;
/** a strip's share of a card's height when there is room */
export const STRIP_SHARE = 0.2;

/** the card width the table draws at: 132 on a desktop, 108 on a touch
 * screen or a laptop, 88 under 900px */
export function cardWidth(o: { touch: boolean; width: number }): number {
  if (o.width < 900) return 88;
  return o.touch || o.width <= 1366 ? 108 : 132;
}

/** a card's height for its width */
export const cardHeight = (cw: number): number => Math.round(cw * CARD_ASPECT);

/**
 * The strip S each card of an n-card pile shows: a fifth of the card, shrunk
 * (never under MIN_STRIP) when the pile would be taller than the pane.
 * `S = clamp(MIN_STRIP, (paneH − ch) / (n − 1), STRIP_SHARE · ch)`.
 */
export function stripOf(n: number, paneH: number, ch: number): number {
  const most = Math.round(ch * STRIP_SHARE);
  if (n <= 1) return most;
  const fit = Math.floor((paneH - ch) / (n - 1));
  return Math.max(MIN_STRIP, Math.min(fit, most));
}

/** the fan's height for n cards at strip S */
export const fanHeight = (n: number, S: number, ch: number): number => (n <= 0 ? 0 : ch + (n - 1) * S);

/**
 * WHERE A DROP AT `y` LANDS in a pile whose fan starts at `fanTop`, holding
 * `n` cards NOT counting the carried one (so for a move inside one pile, n is
 * one fewer than it shows): the index the card is inserted at, counted the
 * way ui/deckarrange.ts counts it — after the card has left.
 *
 *  · over a card's strip, its upper half is "before it", its lower half
 *    "after it" — floor((y − top + S/2) / S);
 *  · over the last card's face (drawn whole), its upper half is still
 *    "before it" and only past its middle is the end of the pile;
 *  · clamped to 0…n.
 */
export function insertIndexAt(y: number, fanTop: number, S: number, n: number, ch: number): number {
  if (n <= 0) return 0;
  const rel = y - fanTop;
  const lastTop = (n - 1) * S;
  if (rel >= lastTop) return rel < lastTop + ch / 2 ? n - 1 : n;
  return Math.max(0, Math.min(Math.floor((rel + S / 2) / S), n - 1));
}

/**
 * The same, turned sideways: a deck strip fanned left to right, each card
 * showing a left strip `Sx` and the last one whole (`cw` wide). `x` is a
 * viewport px; `stripLeft` is where card 0's left edge would be with the box
 * unscrolled, and `scrollLeft` the box's scroll (pass the fan's own rect and
 * 0, as ui/tabletop.ts does, and the scroll is already in it).
 */
export function stripIndexAt(x: number, stripLeft: number, scrollLeft: number, Sx: number, n: number, cw: number): number {
  return insertIndexAt(x + scrollLeft, stripLeft, Sx, n, cw);
}

/**
 * THE DROP PREVIEW: how many strips card `k` (its index in the pile as drawn)
 * slides while a card is carried over the pile with the gap at `index`.
 * `src` is the carried card's own index when it comes from this pile (it is
 * hidden, and the cards under it close up), else -1. Returns a slot offset:
 * the card is drawn at (k + shift)·S.
 */
export function previewShift(k: number, src: number, index: number): number {
  if (k === src) return 0;
  const j = src >= 0 && k > src ? k - 1 : k;   // its index once the carried card has left
  return (j >= index ? j + 1 : j) - k;
}

/** a scan for the table or the binder — never the browser's own image drag
 * (Firefox ignores -webkit-user-drag; ui/drag.ts says why that matters) */
export function scanHtml(name: string, cls: string): string {
  const r = rowFor(name);
  return noImgDrag(r ? artHtml(r, cls) : `<div class="${cls} cbnoart">${esc(name)}</div>`);
}

/** every `<img` in this markup, never natively draggable — the page and the
 * binder pass all they draw through it (icons included: a press anywhere
 * near a card must not start the browser's drag) */
export const noImgDrag = (html: string): string => html.replace(/<img (?![^>]*\bdraggable=)/g, '<img draggable="false" ');

export interface PileCard {
  name: string;
  /** the drag source key (`data-tt-src`) */
  src: string;
}

export interface PileView {
  /** the drop zone key (`data-tt-zone`): 'pile|<id>', 'maybe', 'scratch|<id>' */
  zone: string;
  /** the pile's title: an editable name (`rename` set), or a fixed label */
  name: string;
  /** set = a click on the name renames this pile id */
  rename?: string;
  /** set = the header drags the pile (its id) */
  head?: string;
  cards: PileCard[];
  /** the strip, px */
  S: number;
  /** the card height, px */
  ch: number;
  /** the card drawn in front (just dropped), by index */
  front?: number;
  /** the card picked up by a tap (touch), by index */
  picked?: number;
  /** the deck's cover card, ringed */
  cover?: string | null;
  /** names over the copy cap in the deck, with their counts: a red ×n on
   * those cards and on the header — inside the header's one line, so a pile
   * never moves under the pointer when a card goes over the cap */
  over?: ReadonlyMap<string, number>;
  /** extra classes on the pile box */
  cls?: string;
  /** an empty pile the user named stays on the table: it offers a ✕ */
  deletable?: boolean;
}

/** One pile: its header, then its fan. */
export function pileHtml(p: PileView): string {
  const n = p.cards.length;
  const overHere = p.over
    ? [...new Set(p.cards.map(c => c.name))].filter(nm => p.over!.has(nm))
    : [];
  // the name is text you click to rename (the box appears then, in place):
  // the whole header stays a handle to drag the pile by
  const title = p.rename !== undefined
    ? `<span class="ttpilename" data-btn="tt-rename" data-tt-pile="${esc(p.rename)}" title="Rename">${esc(p.name)}</span>`
    : `<span class="ttpilelabel">${esc(p.name)}</span>`;
  // the grip: a finger taps it to pick the pile up (a mouse drags the header)
  const grip = p.head !== undefined
    ? `<span class="ttgrip" data-btn="tt-head" data-tt-pile="${esc(p.head)}" aria-label="move this pile">⠿</span>` : '';
  return `<section class="ttpile${p.cls ? ` ${p.cls}` : ''}" data-tt-zone="${esc(p.zone)}" data-tt-s="${p.S}" data-tt-n="${n}" data-btn="tt-to">
    <header class="ttpilehead"${p.head !== undefined ? ` data-tt-head="${esc(p.head)}"` : ''}>
      ${grip}${title}${overHere.length ? `<span class="ttovercap" title="${esc(overHere.map(nm =>
        `${nm} ×${p.over!.get(nm)}`).join(', '))}">×${Math.max(...overHere.map(nm => p.over!.get(nm)!))}</span>` : ''}<span
        class="ttpilecount">${n}</span>${p.deletable && p.head !== undefined
        ? `<button class="ttpiledel" data-btn="tt-delpile" data-tt-pile="${esc(p.head)}" aria-label="delete pile">✕</button>` : ''}
    </header>
    <div class="ttfan" style="height:${fanHeight(n, p.S, p.ch)}px">${p.cards.map((c, k) =>
      `<div class="ttcard${k === p.front ? ' ttfront' : ''}${k === p.picked ? ' ttpicked' : ''}${
        p.cover && c.name === p.cover ? ' iscover' : ''}" style="--k:${k};top:${k * p.S}px"
        data-btn="tt-card" data-tt-src="${esc(c.src)}" data-tt-i="${k}" data-card="${esc(c.name)}">${
        scanHtml(c.name, 'ttart')}${p.over?.has(c.name) ? `<span class="ttcapn">×${p.over.get(c.name)}</span>` : ''}</div>`).join('')}</div>
  </section>`;
}
