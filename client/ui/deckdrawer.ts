/* THE CARD DRAWER — the pool, beside the deck table, open while you build.
 *
 * Owner, 2026-10-21: *"a sorta drag and drop style of deck building where the
 * cards feel like they're physically on a table, you can open the browser in a
 * modal"*. So the search that used to sit INSIDE the deck page, under a grid
 * that grew every time you added a card, is a drawer down the right-hand side
 * (a bottom sheet under 900px). You drag a card out of it onto the table, or
 * press its +, and either way exactly ONE copy goes in (owner, Q2).
 *
 * ⚠ A LAYER BESIDE #app, NOT MARKUP INSIDE IT (ui/report.ts is the model).
 * The table repaints #app wholesale on every edit and the queue poll repaints
 * it besides; a drawer inside it would lose its caret, its query and its
 * scroll on each of those, which is what `anchorTop` and the 537px / 136px
 * jump fixes in ui/decks.ts existed to patch. Out here they survive by
 * construction: nothing outside this file writes this element.
 *
 * So, the layer rules:
 *   · its own attributes, `data-dd`, never the board's button attribute —
 *     main.ts sends every one of those to handleButton, whose fallbacks can
 *     paint a board over the page;
 *   · its own capture-phase click listener, which claims the clicks inside it,
 *     and its own Escape, ahead of the page's;
 *   · no scrim on a wide screen (the table stays usable beside it); the bottom
 *     sheet's scrim, at full height only, is `ddscrim`;
 *   · no fetch, ever — the pool is ui/cardindex.ts, already in the bundle;
 *   · no timers at all.
 *
 * It serves two hosts (the constructed builder, ui/decks.ts, and the
 * challenge builder) through `DrawerHost`. The host owns the deck; this file
 * owns the search. A drag out of the drawer is ui/decktable.ts's (the tiles
 * are its drag sources), and so is a drop INTO it, which means "cut".
 */
import { allRows, rowFor } from './cardindex.ts';
import { artHtml, similarQuery } from './cardpanel.ts';
import { chipState, nextChipState, search as runSearch, withChip } from './cardsearch.ts';
import { ELEMENTS } from './deckstats.ts';
import { dragActive } from './drag.ts';
import { touchSeen } from './touch.ts';
import { elIcon, esc } from './util.ts';

export interface DrawerHost {
  /** the deck's name, for the drawer's heading */
  title(): string;
  /** copies in the deck: the ×n badge, `in:`/`copies:`, and the cap's grey */
  copies(name: string): number;
  /** copies on the maybeboard — absent = the host has none (the challenge) */
  maybe?(name: string): number;
  /** grey a card at two copies (constructed, BL-34); false where there is no cap */
  capGrey: boolean;
  /** one copy into the deck — the host sends it to decktable's place() */
  add(name: string): void;
  /** one copy onto the maybeboard */
  toMaybe?(name: string): void;
  /** the full card browser, with this query (or a card's "find similar") */
  fullBrowser(query: string): void;
}

/** results are paged, as ui/cards.ts pages its grid */
const PAGE = 120;

let layer: HTMLElement | null = null;
let host: DrawerHost | null = null;
/** the search, in ui/cardsearch.ts's language — the chips write into it */
let query = '';
let shown = PAGE;
/** the card pinned in the drawer's own panel */
let pinned: string | null = null;
/** the bottom sheet's height (narrow only) */
let full = false;
/** #app's page class when the drawer opened — leaving that page closes it */
let page: string | null = null;
/** a paint asked for while a card was in the air */
let pending = false;
/** the key event this layer took, so the table's own Escape can stand aside */
let tookKey: Event | null = null;

export const drawerOpen = (): boolean => host !== null;

/** did the drawer take this key? (ui/decktable.ts's Escape asks) */
export const drawerTookKey = (e: Event): boolean => e === tookKey;

/** the pool, narrowed to what a deck may hold, then the query */
function results(): { names: string[]; total: number } {
  const h = host;
  const hits = runSearch(query, {
    pool: allRows().filter(r => r.playable),
    ctx: { copies: n => h?.copies(n) ?? 0, maybe: n => h?.maybe?.(n) ?? 0 },
  }).rows.map(r => r.name);
  return { names: hits.slice(0, shown), total: hits.length };
}

/** a scan in the drawer: drag it out, or + it in. The grey is the cap's, and
 * it is news only HERE, where you are shopping (BL-34; 222 §5) */
function tileHtml(name: string): string {
  const h = host!;
  const n = h.copies(name);
  /** the cap withholds the + … */
  const atCap = h.capGrey && n >= 2;
  /** …and greys the scan, here and only here */
  const shopping = atCap;
  const r = rowFor(name);
  return `<div class="dktile ddtile${shopping ? ' atcap' : ''}${n > 2 ? ' overcap' : ''}${name === pinned ? ' ddon' : ''}"
      data-prev="${esc(name)}" data-dd="pin" data-card="${esc(name)}" data-dt-src="drawer|${esc(name)}">
    ${r ? artHtml(r, 'dkart') : `<div class="dkart cbnoart">${esc(name)}</div>`}
    ${n ? `<span class="dkn${n > 2 ? ' bad' : ' ddin'}">×${n}</span>` : ''}
    <span class="dkbtns">
      ${atCap ? '' : `<button data-dd="add" data-card="${esc(name)}" aria-label="add a copy">+</button>`}
      ${h.toMaybe ? `<button data-dd="maybe" data-card="${esc(name)}" aria-label="to the maybeboard">»</button>` : ''}
    </span>
  </div>`;
}

function chipsHtml(): string {
  const chip = (key: string, value: string, label: string, cls = ''): string => {
    const state = chipState(query, key, value);
    return `<button class="${cls}${state === 'on' ? ' on' : state === 'off' ? ' off' : ''}"
      data-dd="chip" data-key="${esc(key)}" data-value="${esc(value)}">${label}</button>`;
  };
  return `${ELEMENTS.map(el => chip('el', el, elIcon(el, el), `elchip ddel ${el}`)).join('')}
    ${chip('kind', 'unit', 'units', 'dkkind')}
    ${chip('kind', 'spell', 'spells', 'dkkind')}
    ${chip('in', 'deck', 'in deck', 'dkkind')}
    ${query ? '<button class="dkkind" data-dd="clear">clear</button>' : ''}`;
}

function pinHtml(): string {
  const h = host!;
  if (!pinned) return '';
  const r = rowFor(pinned);
  const n = h.copies(pinned);
  const atCap = h.capGrey && n >= 2;
  return `<div class="ddpinbox">
    ${r ? artHtml(r, 'ddpinart') : ''}
    <div class="ddpinside">
      <b>${esc(pinned)}</b>
      ${n ? `<span class="dim">${n} in the deck</span>` : ''}
      ${atCap ? '' : `<button class="primary" data-dd="add" data-card="${esc(pinned)}">+ Add</button>`}
      ${h.toMaybe ? `<button data-dd="maybe" data-card="${esc(pinned)}">» Maybe</button>` : ''}
      <button data-dd="similar" data-card="${esc(pinned)}">Find similar</button>
      <button class="dkicon" data-dd="unpin" aria-label="close">✕</button>
    </div>
  </div>`;
}

function countHtml(total: number): string {
  return `${total} card${total === 1 ? '' : 's'}
    <button class="cblink" data-dd="browse">Full browser</button>`;
}

function resultsHtml(r: { names: string[]; total: number }): string {
  return `<div class="ddgrid">${r.names.map(tileHtml).join('')}</div>`
    + (r.total > r.names.length
      ? `<button class="ddmore" data-dd="more">Show more (${r.total - r.names.length})</button>` : '');
}

/** the whole drawer — built when it opens, and when its skeleton is gone */
function drawerHtml(): string {
  const r = results();
  return `<div class="ddscrim" data-dd="half"></div>
  <aside class="ddpanel${full ? ' full' : ''}" data-dt-zone="drawer" aria-label="Add cards">
    <div class="ddhead">
      <button class="ddgrab" data-dd="size" aria-label="${full ? 'smaller' : 'taller'}">${full ? '▾' : '▴'}</button>
      <input id="dd-search" class="ddsearch" spellcheck="false" autocomplete="off"
        placeholder="Search cards — name, text, mana:2…" value="${esc(query)}">
      <button class="dkicon" data-dd="close" aria-label="close">✕</button>
    </div>
    <div class="ddchips" id="dd-chips">${chipsHtml()}</div>
    <div class="ddcount" id="dd-count">${countHtml(r.total)}</div>
    <div class="ddpin" id="dd-pin">${pinHtml()}</div>
    <div class="ddresults" id="dd-results">${resultsHtml(r)}</div>
  </aside>`;
}

/** a part of the drawer, by id — null when the skeleton is not in the document */
const part = (id: string): HTMLElement | null =>
  (layer && typeof layer.querySelector === 'function' ? layer.querySelector<HTMLElement>(`#${id}`) : null);

/**
 * Repaint what changed, never the search box: the caret and what is typed
 * survive every repaint because the box is never rebuilt. If the skeleton is
 * not there (the first paint, or a page that has none), the whole layer is
 * written once.
 */
function paint(which: 'all' | 'results' = 'all'): void {
  if (!layer) return;
  if (dragActive()) { pending = true; return; }
  pending = false;
  if (!host) {
    layer.innerHTML = '';
    document.documentElement.classList.remove('drawerup', 'ddfull');
    return;
  }
  document.documentElement.classList.add('drawerup');
  document.documentElement.classList.toggle('ddfull', full);
  const box = part('dd-results');
  if (!box) { layer.innerHTML = drawerHtml(); return; }
  const r = results();
  const count = part('dd-count');
  if (count) count.innerHTML = countHtml(r.total);
  box.innerHTML = resultsHtml(r);
  if (which === 'results') return;
  const chips = part('dd-chips');
  if (chips) chips.innerHTML = chipsHtml();
  const pin = part('dd-pin');
  if (pin) pin.innerHTML = pinHtml();
  layer.querySelector('.ddpanel')?.classList.toggle('full', full);
  const grab = part('dd-search')?.parentElement?.querySelector('.ddgrab');
  if (grab) grab.textContent = full ? '▾' : '▴';
}

/** claim the caret — on a mouse only: on a tablet it would raise the keyboard
 * over the table every time the drawer opened */
function focusSearch(): void {
  if (touchSeen()) return;
  const box = part('dd-search') as HTMLInputElement | null;
  if (!box || typeof box.focus !== 'function') return;
  box.focus({ preventScroll: true });
  box.selectionStart = box.selectionEnd = box.value.length;
}

/** #app's root page class (deckpage, chpage…) */
function pageNow(): string | null {
  const root = document.getElementById('app')?.firstElementChild;
  return root?.classList?.[0] ?? null;
}

/** Open the drawer for this host (or switch it to another host). */
export function openDrawer(h: DrawerHost): void {
  const was = host;
  host = h;
  page = pageNow();
  shown = PAGE;
  if (!was) { if (layer) layer.innerHTML = ''; paint(); focusSearch(); }
  else paint();
}

export function closeDrawer(): void {
  if (!host) return;
  host = null;
  pinned = null;
  if (layer) layer.innerHTML = '';
  paint();
}

/** the host committed an edit: the counts, the cap's grey and `in:` move */
export function drawerChanged(): void {
  if (host) paint();
}

/** a drag let go: paint what it held back (ui/decktable.ts's `ended`) */
export function flushDrawer(): void {
  if (pending) paint();
}

function onButton(what: string, el: HTMLElement): void {
  const h = host;
  if (!h) return;
  const card = el.dataset['card'] ?? '';
  switch (what) {
    case 'close': closeDrawer(); return;
    case 'size': full = !full; paint(); return;
    case 'half': full = false; paint(); return;
    case 'add': if (card) h.add(card); return;
    case 'maybe': if (card) h.toMaybe?.(card); return;
    case 'pin': pinned = pinned === card ? null : card; paint(); return;
    case 'unpin': pinned = null; paint(); return;
    case 'similar': if (card) h.fullBrowser(similarQuery(card)); return;
    case 'browse': h.fullBrowser(query); return;
    case 'more': shown += PAGE; paint('results'); return;
    case 'clear': query = ''; shown = PAGE; rebuildSearch(); return;
    case 'chip': {
      const key = el.dataset['key'] ?? '';
      const value = el.dataset['value'] ?? '';
      query = withChip(query, key, value, nextChipState(chipState(query, key, value)));
      shown = PAGE;
      rebuildSearch();
      return;
    }
    default: return;
  }
}

/** a chip wrote the query: the box shows it (the one time it is set from here) */
function rebuildSearch(): void {
  const box = part('dd-search') as HTMLInputElement | null;
  if (box) box.value = query;
  paint();
}

let installed = false;

/** Mount the layer beside #app (main.ts, at boot, beside installReport). */
export function installDeckDrawer(): void {
  if (installed) return;
  const app = document.getElementById('app');
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'decklayer';
  document.body.appendChild(layer);

  // our own clicks, claimed in capture before main.ts's delegator sees them
  document.addEventListener('click', e => {
    if (!host) return;
    // `data-dd` exists only in this layer, so finding one is being inside it
    const t = (e.target as HTMLElement | null)?.closest?.('[data-dd]') as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    onButton(t.dataset['dd']!, t);
  }, { capture: true });

  // the search box, typed into — results only, so the caret is never touched
  document.addEventListener('input', e => {
    const box = e.target as HTMLInputElement | null;
    if (!host || box?.id !== 'dd-search') return;
    query = box.value;
    shown = PAGE;
    paint('results');
    const chips = part('dd-chips');
    if (chips) chips.innerHTML = chipsHtml();
  });

  // Escape: the pinned card, then the drawer — before the page's own Escape
  window.addEventListener('keydown', e => {
    if (!host || e.key !== 'Escape') return;
    tookKey = e;
    e.stopPropagation();
    if (pinned) { pinned = null; paint(); return; }
    closeDrawer();
  }, { capture: true });

  // the drawer belongs to the page it was opened on: when #app is repainted
  // into another page (the card browser, the lobby, a game), it goes
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      if (host && page && pageNow() !== page) closeDrawer();
    }).observe(app, { childList: true });
  }
}
