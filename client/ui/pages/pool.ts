/* THE POOL — every card a deck may hold, in a band over the builder's table
 * (BL-65, 2026-11-04; the design page's "The pool").
 *
 *   [ Search cards ] (●●●●●●●) (0 1 2 3 4 5 6 7+ X) (Unit Spell)   141 cards  More filters  Clear  Add to: Deck·Side·Maybe
 *   ┌────┐┌────┐┌────┐ …  a grid of scans that scrolls inside itself, 120 at a time (Show more)
 *
 * A TAP ON A CARD ADDS ONE COPY (`tt-add`, Q1) to where the switch says. A drag
 * goes exactly where it is dropped (the tile is a drag source of the table's one
 * provider: `data-tt-src="binder|<name>"` — the literal `binder` is what 536 and
 * 541 pin as the pool's source), and the band itself is the drop zone that means
 * "take it out" (`data-tt-zone="binder"`). Hold, or press the wheel, to read it
 * (`data-zoom`, ui/presszoom.ts) — and the line beside the count says so (BL-74).
 *
 * Each card says how many are in the deck; at the copy cap it is dimmed and
 * says 2/2 (a tap then refuses, with a note: §0 ruling 5), and a lavender S1
 * says one is in the sideboard.
 *
 * The chips here are OR within a group and AND between groups (fire OR metal;
 * cost 2 OR 3): ui/tabletop.ts keeps which are on and builds the search. The
 * full filter list is the More filters sheet (pages/cardfilters.ts).
 *
 * The search box: typing repaints only the results (`#tt-results`, and the
 * chips row) — ui/tabletop.ts's input listener — so the caret is never touched;
 * a full repaint carries it (pages/caret.ts).
 *
 * Pure (pages/README.md).
 */
import { button, segmented, toggle } from '../components/index.ts';
import { scanHtml } from '../piletable.ts';
import { esc } from '../util.ts';

export type PoolTarget = 'deck' | 'side' | 'maybe';
export const POOL_TARGET_LABEL: Record<PoolTarget, string> = { deck: 'Deck', side: 'Side', maybe: 'Maybe' };

export interface PoolTile {
  name: string;
  /** copies in the deck (constructed), on the strip (the challenge) */
  inDeck: number;
  inSide: number;
  /** the copy cap is reached across the deck and the sideboard: dimmed, n/cap */
  atCap: boolean;
  /** over the cap: the count in red */
  over: boolean;
}

export interface PoolChip {
  /** the group: OR inside it */
  group: 'el' | 'mana' | 'kind';
  value: string;
  label: string;
  /** trusted markup: an element's icon */
  iconHtml?: string;
  on: boolean;
}

export interface PoolView {
  /** what is typed in the box */
  query: string;
  chips: PoolChip[];
  /** any filter on: Clear shows */
  active: boolean;
  /** cards matching */
  total: number;
  /** the cards drawn (the first `shown`) */
  tiles: PoolTile[];
  /** the copy cap (constructed 2); absent = none (the count shows bare) */
  cap?: number;
  target: PoolTarget;
  /** where a tap can add: the switch shows when there is more than one */
  targets: PoolTarget[];
  /** the results region's scroll key: another query, another key (it starts at the top) */
  scrollKey: string;
}

/** one card of the pool */
function tileHtml(t: PoolTile, cap: number | undefined): string {
  const count = t.inDeck
    ? `<span class="ttpooln${t.over ? ' bad' : t.atCap ? ' cap' : ''}">${t.atCap && cap !== undefined ? `${t.inDeck}/${cap}` : t.inDeck}</span>` : '';
  const side = t.inSide ? `<span class="ttpools">S${t.inSide}</span>` : '';
  return `<div class="ttpooltile${t.atCap ? ' ttcap' : ''}" data-btn="tt-add" data-tt-src="binder|${esc(t.name)}" data-card="${esc(t.name)}" data-zoom>${
    scanHtml(t.name, 'ttart')}${count}${side}</div>`;
}

/** the results: the grid and its Show more. `#tt-results`'s inside, repainted alone while typing */
export function poolResultsHtml(v: PoolView): string {
  const more = v.total - v.tiles.length;
  return (v.tiles.length ? `<div class="ttpoolgrid">${v.tiles.map(t => tileHtml(t, v.cap)).join('')}</div>`
    : '<p class="dim ttpoolnone">No cards match.</p>')
    + (more > 0 ? button({ label: `Show more (${more})`, size: 'sm', dataBtn: 'tt-show', className: 'ttpoolmore' }) : '');
}

/** HOW TO READ A CARD UP CLOSE (BL-74, owner 2026-11-08: *"there needs to be a
 * tooltip or reminder of some kind on the "deck building" page that you can
 * hold down middle mouse button (the scroll wheel) to zoom in on cards"* —
 * players asked for a zoom they already had). One quiet line beside the count,
 * never over a card: the mouse's words, or — on a finger-first device
 * (`html.touch`, ui/touch.ts) — the finger's. The gestures are ui/presszoom.ts's. */
export const ZOOM_HINT = '<span class="ttpoolhint">'
  + '<span class="ttpoolhint--mouse">Hold the mouse wheel, or a click, on a card to zoom</span>'
  + '<span class="ttpoolhint--touch">Hold a card to zoom</span></span>';

/** the chips, the count, the zoom hint, More filters and Clear: `#tt-chips`'s inside, repainted with the results */
export function poolChipsHtml(v: PoolView): string {
  const group = (g: PoolChip['group']): string => `<div class="ttchipgroup" role="group">${v.chips.filter(c => c.group === g).map(c => toggle({
    label: c.iconHtml ? undefined : c.label, labelHtml: c.iconHtml, on: c.on, size: 'sm', dataBtn: 'tt-chip',
    className: `ttchip${c.group === 'el' ? ` ttelchip ${c.value}` : ''}`,
    attrs: { 'data-group': c.group, 'data-value': c.value, ...(c.iconHtml ? { 'aria-label': c.label, title: c.label } : {}) },
  })).join('')}</div>`;
  return `${group('el')}${group('mana')}${group('kind')}
    <span class="ttpoolcount">${v.total} card${v.total === 1 ? '' : 's'}</span>${ZOOM_HINT}
    ${button({ label: 'More filters', size: 'sm', dataBtn: 'tt-filters' })}
    ${v.active ? button({ label: 'Clear', size: 'sm', variant: 'ghost', dataBtn: 'tt-clear' }) : ''}`;
}

/** The pool band. Pure. */
export function poolHtml(v: PoolView): string {
  const to = v.targets.length > 1
    ? `<span class="ttpoolto"><span class="dim">Add to</span>${segmented({
      size: 'sm', ariaLabel: 'Add to', className: 'tttarget',
      options: v.targets.map(t => ({ label: POOL_TARGET_LABEL[t], value: t, on: t === v.target, dataBtn: 'tt-target', attrs: { 'data-to': t } })),
    })}</span>` : '';
  return `<section class="ttpool" data-tt-zone="binder" aria-label="Card pool">
    <div class="ttpoolbar">
      <input id="tt-q" class="ttq" type="search" spellcheck="false" autocomplete="off" placeholder="Search cards" aria-label="Search cards" value="${esc(v.query)}">
      <div class="ttpoolchips" id="tt-chips">${poolChipsHtml(v)}</div>
      ${to}
    </div>
    <div class="ttremove" aria-hidden="true">Drop to remove</div>
    <div class="ttpoolresults" id="tt-results" data-scroll="${esc(v.scrollKey)}">${poolResultsHtml(v)}</div>
  </section>`;
}
