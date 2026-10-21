/* THE BINDER — every card, docked down the right of the tabletop.
 *
 * Owner, 2026-10-21: a "table top deck builder simulator" page, with a side
 * BINDER of all cards — drag a card out of it onto the table to add a copy,
 * drag one from the table back into it to take that copy out. Search, the
 * filter chips and a grid of scans; each tile says how many are in the deck.
 * Under 900px it is a bottom sheet whose search bar always shows.
 *
 * ⚠ A LAYER BESIDE #app, NOT MARKUP INSIDE IT (ui/report.ts is the model).
 * The tabletop repaints #app wholesale on every drop and the queue poll
 * repaints it besides; a binder inside it would lose its caret, its query and
 * its scroll on each of those. Out here they survive by construction: nothing
 * outside this file writes this element.
 *
 * So, the layer rules:
 *   · its own attributes, `data-dd`, never the board's button attribute —
 *     main.ts sends every one of those to handleButton, whose fallbacks can
 *     paint a board over the page;
 *   · its own capture-phase click listener, which claims the clicks inside it,
 *     and its own Escape (it unpins the pinned card; the page has no Escape of
 *     its own to close — it is a page, not a dialog);
 *   · no scrim on a wide screen; the bottom sheet's, at full height only, is
 *     `ddscrim`;
 *   · no fetch, ever — the pool is ui/cardindex.ts, already in the bundle;
 *   · no timers at all.
 *
 * The tabletop owns the deck and this file owns the search. A drag out of the
 * binder is ui/tabletop.ts's (the tiles are its drag sources, `data-tt-src`),
 * and so is a drop INTO it (the panel is its drop zone meaning "remove").
 */
import { allRows } from './cardindex.ts';
import { similarQuery } from './cardpanel.ts';
import { chipState, nextChipState, search as runSearch, withChip } from './cardsearch.ts';
import { ELEMENTS } from './deckstats.ts';
import { dragActive } from './drag.ts';
import { noImgDrag, scanHtml } from './piletable.ts';
import { touchSeen } from './touch.ts';
import { elIcon, esc } from './util.ts';

export interface BinderHost {
  /** copies in the deck: the ×n badge, and `in:`/`copies:` in a query */
  copies(name: string): number;
  /** copies on the maybeboard — absent = the host has none (the challenge) */
  maybe?(name: string): number;
  /** the copy cap (constructed 2): a badge over it is red. Absent = no cap */
  cap?: number;
  /** one copy onto the table — the tabletop sends it through its place() */
  add(name: string): void;
  /** one copy onto the Maybe pile */
  toMaybe?(name: string): void;
  /** the full card browser, with this query (or a card's "find similar") */
  fullBrowser(query: string): void;
}

/** results are paged, as ui/cards.ts pages its grid */
const PAGE = 120;
/** the page the binder belongs to: #app's root class while it is up */
const PAGE_CLASS = 'ttpage';

let layer: HTMLElement | null = null;
let host: BinderHost | null = null;
/** the search, in ui/cardsearch.ts's language — the chips write into it */
let query = '';
let shown = PAGE;
/** the card pinned in the binder's own panel */
let pinned: string | null = null;
/** the bottom sheet's height (narrow only) */
let full = false;
/** a paint asked for while a card was in the air */
let pending = false;
/** the key event this layer took, so the page's own Escape can stand aside */
let tookKey: Event | null = null;

/** did the binder take this key? (ui/tabletop.ts's Escape asks) */
export const binderTookKey = (e: Event): boolean => e === tookKey;

/** the pool, narrowed to what a deck may hold, then the query */
function results(): { names: string[]; total: number } {
  const h = host;
  const hits = runSearch(query, {
    pool: allRows().filter(r => r.playable),
    ctx: { copies: n => h?.copies(n) ?? 0, maybe: n => h?.maybe?.(n) ?? 0 },
  }).rows.map(r => r.name);
  return { names: hits.slice(0, shown), total: hits.length };
}

/** the ×n a tile and the pinned card carry: copies in the deck, red over the cap */
function badge(name: string): string {
  const n = host!.copies(name);
  if (!n) return '';
  const over = host!.cap !== undefined && n > host!.cap;
  return `<span class="dkn ${over ? 'bad' : 'ddin'}">×${n}</span>`;
}

/** a scan in the binder: drag it out, or + it in */
function tileHtml(name: string): string {
  const h = host!;
  return `<div class="dktile ddtile${name === pinned ? ' ddon' : ''}"
      data-dd="pin" data-card="${esc(name)}" data-tt-src="binder|${esc(name)}">
    ${scanHtml(name, 'dkart')}
    ${badge(name)}
    <span class="dkbtns">
      <button data-dd="add" data-card="${esc(name)}" aria-label="add a copy">+</button>
      ${h.toMaybe ? `<button data-dd="maybe" data-card="${esc(name)}" aria-label="to Maybe">»</button>` : ''}
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
  const n = h.copies(pinned);
  return `<div class="ddpinbox">
    ${scanHtml(pinned, 'ddpinart')}
    <div class="ddpinside">
      <b>${esc(pinned)}</b>
      ${n ? `<span class="dim">${n} in the deck</span>` : ''}
      <button class="primary" data-dd="add" data-card="${esc(pinned)}">+ Add</button>
      ${h.toMaybe ? `<button data-dd="maybe" data-card="${esc(pinned)}">» Maybe</button>` : ''}
      <button data-dd="similar" data-card="${esc(pinned)}">Find similar</button>
      <button class="dkicon" data-dd="unpin" aria-label="close">✕</button>
    </div>
  </div>`;
}

function countHtml(total: number): string {
  return `${total} card${total === 1 ? '' : 's'}
    <button class="cblink" data-dd="browse">All cards…</button>`;
}

function resultsHtml(r: { names: string[]; total: number }): string {
  return `<div class="ddgrid">${r.names.map(tileHtml).join('')}</div>`
    + (r.total > r.names.length
      ? `<button class="ddmore" data-dd="more">Show more (${r.total - r.names.length})</button>` : '');
}

/** the whole binder — built when it opens, and when its skeleton is gone */
function binderHtml(): string {
  const r = results();
  return `<div class="ddscrim" data-dd="half"></div>
  <aside class="ddpanel${full ? ' full' : ''}" data-tt-zone="binder" aria-label="Card binder">
    <div class="ddremove" aria-hidden="true">Drop to remove</div>
    <div class="ddhead">
      <button class="ddgrab" data-dd="size" aria-label="${full ? 'smaller' : 'taller'}">${full ? '▾' : '▴'}</button>
      <input id="dd-search" class="ddsearch" spellcheck="false" autocomplete="off"
        placeholder="Search cards" value="${esc(query)}">
    </div>
    <div class="ddchips" id="dd-chips">${chipsHtml()}</div>
    <div class="ddcount" id="dd-count">${countHtml(r.total)}</div>
    <div class="ddpin" id="dd-pin">${pinHtml()}</div>
    <div class="ddresults" id="dd-results">${resultsHtml(r)}</div>
  </aside>`;
}

/** a part of the binder, by id — null when the skeleton is not in the document */
const part = (id: string): HTMLElement | null =>
  (layer && typeof layer.querySelector === 'function' ? layer.querySelector<HTMLElement>(`#${id}`) : null);

/**
 * Repaint what changed, never the search box: the caret and what is typed
 * survive every repaint because the box is never rebuilt. If the skeleton is
 * not there (the first paint), the whole layer is written once.
 */
function paint(which: 'all' | 'results' = 'all'): void {
  if (!layer) return;
  if (dragActive()) { pending = true; return; }
  pending = false;
  if (!host) {
    layer.innerHTML = '';
    document.documentElement.classList.remove('binderup', 'ddfull');
    return;
  }
  document.documentElement.classList.add('binderup');
  document.documentElement.classList.toggle('ddfull', full);
  const box = part('dd-results');
  if (!box) { layer.innerHTML = noImgDrag(binderHtml()); return; }
  const r = results();
  const count = part('dd-count');
  if (count) count.innerHTML = noImgDrag(countHtml(r.total));
  box.innerHTML = noImgDrag(resultsHtml(r));
  if (which === 'results') return;
  const chips = part('dd-chips');
  if (chips) chips.innerHTML = noImgDrag(chipsHtml());
  const pin = part('dd-pin');
  if (pin) pin.innerHTML = noImgDrag(pinHtml());
  layer.querySelector('.ddpanel')?.classList.toggle('full', full);
  const grab = layer.querySelector('.ddgrab');
  if (grab) grab.textContent = full ? '▾' : '▴';
}

/** claim the caret — on a mouse only: on a tablet it would raise the keyboard
 * over the table every time the page opened */
function focusSearch(): void {
  if (touchSeen()) return;
  const box = part('dd-search') as HTMLInputElement | null;
  if (!box || typeof box.focus !== 'function') return;
  box.focus({ preventScroll: true });
  box.selectionStart = box.selectionEnd = box.value.length;
}

/** is #app showing the tabletop? */
function onTabletop(): boolean {
  return !!document.getElementById('app')?.firstElementChild?.classList?.contains(PAGE_CLASS);
}

/** Dock the binder for this host (the tabletop, on every paint: a no-op
 * repaint of the counts when it is already up). */
export function openBinder(h: BinderHost): void {
  const was = host;
  host = h;
  if (!was) { shown = PAGE; if (layer) layer.innerHTML = ''; paint(); focusSearch(); }
  else paint();
}

export function closeBinder(): void {
  if (!host) return;
  host = null;
  pinned = null;
  full = false;
  if (layer) layer.innerHTML = '';
  paint();
}

/** pin a card in the binder's panel (a click on a table card) */
export function pinCard(name: string): void {
  if (!host) return;
  pinned = name;
  paint();
}

/** a drag let go: paint what it held back (ui/tabletop.ts's `ended`) */
export function flushBinder(): void {
  if (pending) paint();
}

function onButton(what: string, el: HTMLElement): void {
  const h = host;
  if (!h) return;
  const card = el.dataset['card'] ?? '';
  switch (what) {
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
export function installBinder(): void {
  if (installed) return;
  const app = document.getElementById('app');
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'binderlayer';
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
    if (chips) chips.innerHTML = noImgDrag(chipsHtml());
  });

  // Escape: the pinned card, then the full-height sheet — ahead of the page
  window.addEventListener('keydown', e => {
    if (!host || e.key !== 'Escape' || (!pinned && !full)) return;
    tookKey = e;
    e.stopPropagation();
    if (pinned) pinned = null; else full = false;
    paint();
  }, { capture: true });

  // the binder belongs to the tabletop: when #app is repainted into another
  // page (Back, the full card browser, a game), it goes
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      if (host && !onTabletop()) closeBinder();
    }).observe(app, { childList: true });
  }
}
