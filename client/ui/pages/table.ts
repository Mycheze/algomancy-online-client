/* THE TABLE — the felt a deck lies on, drawn the same way everywhere a deck is
 * handled (BL-65, 2026-11-04): the builder (pages/builder.ts, hosted by
 * ui/tabletop.ts for a constructed deck and the weekly challenge) and the
 * Competitive sideboarding table between games (pages/match.ts).
 *
 *   ┌ tttablewrap ─────────────────────────────────────────┬ ttrail ──────┐
 *   │ headHtml (Main deck 30 · Re-sort ▾ · + Pile)          │ Sideboard n/7│
 *   │ ttrow: [gap] pile [gap] pile … [end: a new pile here] │ (empty slot) │
 *   │                                                       │ Maybe        │
 *   │                                                       │ dashed,      │
 *   │                                                       │ hatched,     │
 *   │                                                       │ Not in the   │
 *   │                                                       │ deck         │
 *   └───────────────────────────────────────────────────────┴──────────────┘
 *   footHtml (the stats strip, the challenge's deck strip)
 *   the card menu (a popover, OUTSIDE the table region)
 *
 * Every pile is ui/piletable.ts `pileHtml`, so the fan geometry the drag uses
 * (538) is the geometry drawn. The table region is `isolation: isolate`
 * (52-builder.css): a card lifted to z-index 500 to be read stays above its
 * neighbours and BELOW every sheet. The card menu is drawn after the region,
 * not in it, so it sits at --z-menu over the cards; the paint places it beside
 * the picked card (ui/tabletop.ts placeMenu) — markup cannot know where that is.
 *
 * Who takes the taps: by default the builder's (`tt-to` on the region, the
 * gaps and the end; the piles say their own through PileView). A host with
 * its own drag provider and buttons (the Competitive table: `data-cc-zone`,
 * `cc-move`) passes `zoneAttrs` / `rail.*Attrs` and PileViews with `tap`, and
 * `newPiles: null` (no new piles there).
 *
 * Pure (pages/README.md): no DOM, no state. Escaped: every name.
 */
import { button } from '../components/index.ts';
import { pileHtml, type PileView } from '../piletable.ts';
import { esc } from '../util.ts';

export type Attrs = Record<string, string | true>;

/** one entry of the card menu */
export interface TableMenuItem {
  /** its data-btn (tt-cut, tt-more, tt-toside …) */
  btn: string;
  label: string;
  attrs?: Attrs;
  disabled?: boolean;
}

/** the popover beside a picked card (or a picked pile) */
export interface TableMenu {
  /** the card's name (or the pile's), its heading */
  title: string;
  /** the picked card's `data-tt-src` (`head|<id>` for a pile): the paint
   * places the menu beside the element that carries it */
  for: string;
  items: TableMenuItem[];
  /** the close button's data-btn; default tt-putdown */
  closeBtn?: string;
}

export interface TableRail {
  /** the sideboard pile (pileHtml: `limit` 7, `slot` for the empty place) */
  side?: PileView | null;
  /** the maybeboard pile: dashed, hatched, "Not in the deck" under it */
  maybe?: PileView | null;
  /** attributes on the rail's sideboard / Maybe box (the CC table's data-cc-zone) */
  sideAttrs?: Attrs;
  maybeAttrs?: Attrs;
}

export interface TableView {
  /** the card width and height the piles are drawn at, px */
  cw: number;
  ch: number;
  /** the piles of the row, in order */
  piles: PileView[];
  /** the builder's row: a gap before every pile and the end slot, each a place
   * for a new pile (`data-tt-zone="gap|i"` / `"end"`, `tt-to`); `emptyText`
   * shows in the end slot while there are no piles. null/absent: the piles
   * alone (the Competitive table makes no piles) */
  newPiles?: { emptyText: string } | null;
  /** the table region's attributes; absent = the builder's: a drop or a tap on
   * the bare felt is a new pile at the end */
  zoneAttrs?: Attrs;
  /** trusted markup over the piles, inside the region: "Main deck 30", + Pile, Re-sort */
  headHtml?: string;
  rail?: TableRail | null;
  /** trusted markup under the table and the rail */
  footHtml?: string;
  /** the card menu, open; null/absent = closed */
  menu?: TableMenu | null;
  /** a card or a pile is picked up (a finger's route): `ttholding` on the root */
  holding?: boolean;
  /** extra classes on the root */
  className?: string;
  /** the region's data-scroll key (pages/frame.ts paintFrame keeps it) */
  scrollKey?: string;
}

/** attributes as markup, escaped; `true` = bare */
function attrs(a: Attrs | undefined): string {
  if (!a) return '';
  return Object.entries(a).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
}

/** the builder's region: the bare felt is "a new pile at the end" */
const BUILDER_ZONE: Attrs = { 'data-tt-zone': 'end', 'data-btn': 'tt-to' };

/** the card menu. Its buttons are the components' (ghost, small), one per line */
export function tableMenuHtml(m: TableMenu): string {
  const items = m.items.map(it => button({
    label: it.label, variant: 'ghost', size: 'sm', dataBtn: it.btn, disabled: it.disabled,
    className: 'ttpopitem', attrs: { ...(it.attrs ?? {}), role: 'menuitem' },
  })).join('');
  return `<div class="ttpop" role="menu" aria-label="${esc(m.title)}" data-tt-menu="${esc(m.for)}">`
    + `<div class="ttpophead"><b>${esc(m.title)}</b>${button({ label: '✕', variant: 'ghost', size: 'sm', dataBtn: m.closeBtn ?? 'tt-putdown',
      className: 'ttpopclose', attrs: { 'aria-label': 'Close' } })}</div>`
    + `<div class="ttpopitems">${items}</div></div>`;
}

/** the rail: the sideboard, then Maybe under it */
function railHtml(r: TableRail): string {
  const side = r.side
    ? `<div class="ttrailbox ttrailside"${attrs(r.sideAttrs)}>${pileHtml(r.side)}</div>` : '';
  const maybe = r.maybe
    ? `<div class="ttrailbox ttrailmaybe"${attrs(r.maybeAttrs)}>${pileHtml(r.maybe)}<p class="ttrailnote">Not in the deck</p></div>` : '';
  return side || maybe ? `<aside class="ttrail" data-scroll="tt-rail">${side}${maybe}</aside>` : '';
}

/** The table: the pile row, the rail, the menu. Pure. */
export function tableHtml(v: TableView): string {
  const builder = !!v.newPiles;
  const gap = (i: number): string => (builder ? `<div class="ttgutter" data-tt-zone="gap|${i}" data-btn="tt-to"></div>` : '');
  const row = v.piles.map((p, i) => gap(i) + pileHtml(p)).join('')
    + (builder ? `<div class="ttend" data-tt-zone="end" data-btn="tt-to">${v.piles.length ? '' : `<span class="dim">${esc(v.newPiles!.emptyText)}</span>`}</div>` : '');
  const zone = v.zoneAttrs ?? (builder ? BUILDER_ZONE : {});
  const cls = `tttablewrap${v.holding ? ' ttholding' : ''}${v.className ? ` ${v.className}` : ''}`;
  return `<div class="${cls}" style="--cw:${v.cw}px;--ch:${v.ch}px">`
    + `<div class="ttbody">`
    + `<div class="tttable" data-scroll="${esc(v.scrollKey ?? 'tt-table')}"${attrs(zone)}>${v.headHtml ?? ''}<div class="ttrow">${row}</div></div>`
    + (v.rail ? railHtml(v.rail) : '')
    + `</div>`
    + (v.footHtml ?? '')
    + `</div>`
    + (v.menu ? tableMenuHtml(v.menu) : '');
}
