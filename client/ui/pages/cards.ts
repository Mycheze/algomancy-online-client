/* THE CARD BROWSER, DRAWN (`?cards`): browse, search, the syntax sheet, the
 * grid / list / text views and a pinned card. (Its deckbuilding mode is gone:
 * decks are built on the builder's pool, BL-65.)
 *
 * ui/cards.ts keeps the state (the query IS the page — see its header), the
 * fetches, the URL, the clicks and the keys; this file is the page contract
 * (pages/README.md): cardsView() gathers that state into a plain object,
 * cardsHtml(view) draws it and touches nothing else, paintCards() puts it on
 * the page and wires the query box and the sort menu.
 *
 * Moved out of cards.ts in the design-system round (2026-11-03), the
 * templates byte for byte. The tile's three deliberate absences (no name
 * banner, no `title`, no `i` button) are documented at tileHtml below; the
 * `data-prev` on every tile and row is what the hover text box reads
 * (test/907).
 */
import { iconizeText } from '../cardtext.ts';
import { artHtml, cardPanelHtml, costHtml } from '../cardpanel.ts';
import type { CardRow } from '../cardindex.ts';
import { allRows, rowFor } from '../cardindex.ts';
import { printsStats } from '../../engine/src/cards/dsl.ts';   // CR 206.2
import { SORTS, VIEWS, type SearchResult } from '../cardsearch.ts';
import { suggest } from '../cardsynonyms.ts';
import { esc } from '../util.ts';
import { icon, segmented, sheet } from '../components/index.ts';
import type { CardsState } from '../cards.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';
import { CARDS_BTNS, facets, filterRailHtml, syntaxHelpHtml, type Facet } from './cardfilters.ts';

// the rail and the syntax help live in pages/cardfilters.ts since BL-65 (the builder's pool draws them too);
// these were imported from here before the move
export { facets, type Facet };

/** How many tiles are painted before the "show the rest" button. Not a cap on
 * the SEARCH — the count above the grid is always the true total. */
export const CHUNK = 120;

/** Everything the page shows. */
export interface CardsView {
  q: string;
  /** the query, run */
  res: SearchResult;
  /** how many deck-legal cards there are ("The 450 cards.") */
  cardCount: number;
  facets: Facet[];
  railOpen: Record<string, boolean>;
  /** "did you mean" suggestions for the query */
  hints: ReturnType<typeof suggest>;
  saved: { name: string; q: string }[];
  helpOpen: boolean;
  focus: string | null;
  /** the pinned card's row, or null when it is not one the index knows */
  focusRow: CardRow | null;
  /** how many published decks play the pinned card */
  played: number;
  rulings: { name: string; lines: string[] } | null;
  /** the keyboard cursor into the painted results, or -1 */
  cursor: number;
  /** how many results are painted */
  shown: number;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

/** Gather the page from cards.ts's state. */
export function cardsView(st: CardsState): CardsView {
  return {
    q: st.q,
    res: st.res,
    cardCount: allRows().filter(r => r.cls === 'card').length,
    facets: facets(false),
    railOpen: { ...st.railOpen },
    hints: suggest(st.q),
    saved: st.saved,
    helpOpen: st.helpOpen,
    focus: st.focus,
    focusRow: st.focus ? rowFor(st.focus) ?? null : null,
    played: st.focus ? st.playedIn?.[rowFor(st.focus)?.name ?? ''] ?? 0 : 0,
    rulings: st.rulings,
    cursor: st.cursor,
    shown: st.shown,
    chrome: frameChromeView(),
  };
}

/* ── the facet rail (pages/cardfilters.ts) ────────────────────────────── */

function railHtml(v: CardsView): string {
  return filterRailHtml(v, CARDS_BTNS);
}

/* ── results ───────────────────────────────────────────────────────────── */

/**
 * One card tile.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT HAVE, all from the owner's first read
 * of the shipped page (2026-08-28):
 *
 *  - NO NAME BANNER. The deck page prints the card's name across the bottom of
 *    the scan, which is right there (you are looking for a card you chose) and
 *    wrong here (you are reading cards you have not chosen): *"The name banner
 *    is blocking the card text from being read. Better to just remove it."*
 *    The scan prints its own name at the top anyway.
 *  - NO `title`. The native tooltip and the client's own hover box were both
 *    firing: *"There are two hover texts that are competing. The one that shows
 *    the text (not just the card name) is more useful."* `data-prev` is that
 *    one, so the native one goes.
 *  - NO `i` BUTTON. The whole tile is the target: *"The i clicking doesn't need
 *    to be its own button, just clicking the card should pin it like that."*
 */
function tileHtml(v: CardsView, r: CardRow, at = -1): string {
  // the two empty slots are where deckbuilding mode drew the copies and the
  // add/cut buttons (BL-65); kept as '' so the page is the same, byte for byte
  return `<div class="dktile cbtile${r.cls === 'card' ? '' : ' noncard'}${at === v.cursor ? ' sel' : ''}"
      data-prev="${esc(r.name)}" data-btn="cards-focus" data-card="${esc(r.name)}">
    ${artHtml(r, 'dkart')}
    ${''}
    ${r.cls === 'card' ? '' : `<span class="cbclass">${esc(r.cls)}</span>`}
    ${''}
  </div>`;
}

/** A card's rules text on ONE line. `iconizeText` turns the printed `{/n}`
 * into a real `<br>`, which `white-space: nowrap` cannot flatten — so the list
 * rows grew to two and three lines each and the table stopped scanning. */
const oneLine = (text: string): string =>
  iconizeText(text).replace(/<br\s*\/?>/gi, ' ').replace(/\s{2,}/g, ' ');

function rowHtml(v: CardsView, r: CardRow, at = -1): string {
  return `<div class="cbrow${at === v.cursor ? ' sel' : ''}"
      data-prev="${esc(r.name)}" data-btn="cards-focus" data-card="${esc(r.name)}">
    <span class="cbrowcost">${costHtml(r)}</span>
    <span class="cbrowname">${esc(r.name)}</span>
    <span class="cbrowtype">${esc(r.type)}</span>
    ${/* ALWAYS emitted, empty for a spell. A spell has no power/toughness, and
        omitting the cell let CSS grid slide the rules text up into the 44px
        stats column, where every spell's text was clipped to "Gain c..." —
        which looked like a text bug and was a layout one. */ ''
    }<span class="cbpt">${printsStats(r.kind) ? `${r.power}/${r.toughness}` : ''}</span>
    <span class="cbrowtext">${oneLine(r.text)}</span>
    ${/* deckbuilding mode's copies and add/cut buttons were here (BL-65) */ ''}
    ${''}
  </div>`;
}

/** the count line: how many, how many painted, and what is not counted */
function countHtml(v: CardsView): string {
  const { res, q } = v;
  const { total } = res;
  const painted = Math.min(total, v.shown);
  return `<div class="cbcount">
      <b>${total}</b> card${total === 1 ? '' : 's'}${total > painted ? ` <span class="dim">· showing ${painted}</span>` : ''}
      ${res.implicitCards
    ? `<span class="cbimplicit">· tokens and reference cards not counted:
        <button class="cblink" data-btn="cards-try" data-q="${esc(q ? `${q} class:all` : 'class:all')}">class:all</button></span>`
    : ''}
    </div>`;
}

function resultsHtml(v: CardsView): string {
  const { res } = v;
  const { rows, total, query } = res;
  const page = rows.slice(0, v.shown);
  const rest = total - page.length;
  const body = query.view === 'text'
    ? `<textarea class="cbtext" readonly rows="${Math.min(30, Math.max(4, page.length))}"
        onclick="this.select()">${esc(page.map(r => r.name).join('\n'))}</textarea>`
    : query.view === 'list'
      ? `<div class="cblist">${page.map((r, i) => rowHtml(v, r, i)).join('')}</div>`
      : `<div class="dkgrid cbgrid">${page.map((r, i) => tileHtml(v, r, i)).join('')}</div>`;
  // the key names the VIEW: switching grid → list starts the list at the top
  return `<div class="cbscroll" data-scroll="cards-results-${esc(query.view)}">
    ${total === 0 ? '<p class="cbnone hint">Nothing matches. Loosen a filter, or check the syntax under \u201c?\u201d.</p>' : ''}
    ${body}
    ${rest > 0
    ? `<button class="cbmore" data-btn="cards-more">Show ${Math.min(rest, CHUNK)} more (${rest} left)</button>`
    : ''}
  </div>`;
}

/* ── the detail pane ───────────────────────────────────────────────────── */

/** This page's pinned card: the shared panel (ui/cardpanel.ts) plus the
 * buttons that only mean something here. */
function detailHtml(v: CardsView): string {
  const { focus, focusRow: r } = v;
  if (!focus) return '';
  if (!r) return '';
  const played = v.played;
  return cardPanelHtml(focus, {
    close: 'cards-unfocus',
    rulings: v.rulings,
    // Published decks only, and the link goes to the LIST rather than to a
    // filtered view of it: BL-13's note is that nothing may reconstruct a deck
    // out of an aggregate, and a count is the aggregate — the decks behind it
    // are on the metagame page, where each one is a list somebody published.
    extra: (played
      ? `<div class="cbfact">In ${played} published deck${played === 1 ? '' : 's'} —
          <button class="cblink" data-btn="meta-openpage">metagame</button></div>`
      : '')
      // how it has done in the games played here — the card stats tab, opened on it
      + `<div class="cbfact"><button class="cblink" data-btn="meta-stats-open" data-card="${esc(r.name)}">card stats</button></div>`,
    actions: `<button data-btn="cards-similar" data-card="${esc(r.name)}">Find similar</button>
      <button data-btn="cards-rulings" data-card="${esc(r.name)}">Rulings</button>
      <button data-btn="cards-copylink" data-card="${esc(r.name)}" title="a link to this card, to paste in Discord or anywhere">Copy link</button>
      ${/* deckbuilding mode's "add to <deck>" was here (BL-65) */ ''}`,
  });
}

/* ── the help sheet (its body: pages/cardfilters.ts, printed from the parser's own tables) ── */

function helpHtml(v: CardsView): string {
  if (!v.helpOpen) return '';
  // a sheet over the page (components/sheet.ts): the scrim, the ✕ and Esc
  // (cards.ts handleKey) all close it, as `cards-help` toggled it open
  return sheet({ open: true, id: 'cards-syntax', title: 'Search syntax', width: 'lg', dismissBtn: 'cards-help', className: 'cbhelp',
    bodyHtml: syntaxHelpHtml(CARDS_BTNS) });
}

/* ── the page ──────────────────────────────────────────────────────────── */

function barHtml(v: CardsView): string {
  const { res, q, hints, saved } = v;
  return `<div class="cbhead">
    <div class="cbbar">
      <span class="cbqicon" aria-hidden="true">${icon('search')}</span>
      <input id="cb-q" class="cbq" spellcheck="false" autocomplete="off"
        placeholder="search — try  el:wood kind:unit mana:2 -kw:virus"
        value="${esc(q)}">
      ${q ? '<button class="cbclear" data-btn="cards-clear" title="clear">×</button>' : ''}
      <button class="cbsyntax${v.helpOpen ? ' on' : ''}" data-btn="cards-help" title="search syntax">?</button>
    </div>
    ${res.query.errors.length
    ? `<div class="cberr">${res.query.errors.map(e => esc(e.message)).join(' · ')}</div>`
    : ''}
    ${hints.length
    ? `<div class="cbsuggest">did you mean ${hints.map(h =>
      `<button class="cblink" data-btn="cards-try" data-q="${esc(h.query)}" title="${esc(h.why)}"><code>${esc(h.query)}</code></button>`).join(' or ')}?</div>`
    : ''}
    <div class="cbtools">
      ${countHtml(v)}
      <span class="cbspacer"></span>
      ${saved.map(s => `<button class="cblink" data-btn="cards-try" data-q="${esc(s.q)}">${esc(s.name)}</button>`).join('')}
      ${q ? '<button class="cbsmall" data-btn="cards-save" title="keep this search">Save search</button>' : ''}
      ${saved.length ? '<button class="cbsmall" data-btn="cards-forget" title="drop the saved searches">Forget</button>' : ''}
      <label class="cbsort">sort
        <select id="cb-sort">${SORTS.map(s =>
    `<option value="${s}"${res.query.sort === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
      </label>
      <button class="cbdir" data-btn="cards-dir" title="reverse the order">${res.query.dir === 'asc' ? '↑' : '↓'}</button>
      ${segmented({
    ariaLabel: 'View', size: 'sm', className: 'cbviews',
    options: VIEWS.map(view => ({ label: view, value: view, on: res.query.view === view, dataBtn: 'cards-view', attrs: { 'data-view': view } })),
  })}
    </div>
  </div>`;
}

/** The page, in the app frame (pages/frame.ts): the facet rail, the results
 * (the search fixed over a grid that scrolls) and the pinned card, each
 * scrolling inside itself. The page never scrolls (docs/24, principle 2). */
export function cardsHtml(v: CardsView): string {
  const detail = detailHtml(v);
  return frameHtml({
    page: 'cbpage',
    title: 'Cards',
    back: { dataBtn: 'cards-close', label: 'Home' },
    chrome: v.chrome,
    fill: true,
    wide: true,
    mainHtml: `
    <div class="cbmain">
      ${railHtml(v)}
      <section class="cbresults">${barHtml(v)}${resultsHtml(v)}</section>
      ${detail ? `<div class="cbside" data-scroll="cards-detail-${esc(v.focus ?? '')}">${detail}</div>` : ''}
    </div>
    ${helpHtml(v)}`,
  });
}

/** What paintCards wires the query box and the sort menu to (cards.ts). */
export interface CardsHooks {
  /** the sort menu changed */
  onSort: (value: string) => void;
  /** a keystroke in the query box */
  onInput: (value: string) => void;
  /** true once after the page opens or the box is cleared: put the caret in the box */
  takeFocus: () => boolean;
}

/** Paint `v` into `app`, then wire the live query box — it must not repaint
 * the page under the cursor (cards.ts scheduleRepaint / repaintKeepingCaret). */
export function paintCards(app: HTMLElement, v: CardsView, h: CardsHooks): void {
  paintFrame(app, cardsHtml(v));
  // the sort menu answers to CHANGE, not to click. A click on a <select> is the
  // click that OPENS it, so a click handler reads the value you are replacing.
  const sort = document.getElementById('cb-sort') as HTMLSelectElement | null;
  sort?.addEventListener('change', () => h.onSort(sort.value));

  // keep the keyboard cursor on screen. Full-repaint rendering means the
  // browser's own scroll-into-view never fires, so it is done by hand.
  document.querySelector('.cbtile.sel, .cbrow.sel')?.scrollIntoView({ block: 'nearest' });

  const box = document.getElementById('cb-q') as HTMLInputElement | null;
  if (!box) return;
  box.addEventListener('input', () => h.onInput(box.value));
  if (h.takeFocus()) {
    box.focus();
    box.selectionStart = box.selectionEnd = box.value.length;
  }
}
