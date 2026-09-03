/* The deck collection: the page you build, cut and tune constructed decks on.
 *
 * Same contract as ui/account.ts, which main.ts already knows how to drive:
 * screen() says whether this page owns the app element, renderScreen() paints
 * it, handleButton() is offered every click first (everything here is prefixed
 * `deck-`), and the collection itself — the fetches, the pending edit, the
 * open deck — lives in this file and nowhere else.
 *
 * THE EDIT MODEL, which is the only genuinely tricky thing here. A deckbuilder
 * that asks you to press Save is a deckbuilder that loses work, so every click
 * edits the local copy at once and a debounced PUT follows. That means the
 * server's answer can arrive describing a deck you have since changed again,
 * so:
 *
 *   - the local copy is the truth WHILE anything is in flight or pending, and
 *     the server's list is adopted only once the queue is empty (`settled()`);
 *   - legality and every number on the page are computed HERE, from
 *     ui/deckstats.ts, never from the server's `problems` — so the count, the
 *     curve and the "not legal yet" line all move on the same click that made
 *     them true, with no round trip in between;
 *   - `record` is the one field only the server can know, and it does not
 *     change while you edit, so it survives the local copy untouched.
 *
 * Art is the point of the page — "I want to see my decks visually and make
 * cuts" — so the card grid is real card scans, and the deck list wears the
 * cover card you picked.
 */
import { getCard } from '../engine/src/cards/dsl.ts';
import * as cb from './cards.ts';
import { allRows, rowFor } from './cardindex.ts';
import { cardPanelHtml, deckStripHtml, similarQuery } from './cardpanel.ts';
import { cardLinker, clipDescription } from './cardlinks.ts';
import { mdToHtml } from './markdown.ts';
import { chipState, nextChipState, search as runSearch, withChip } from './cardsearch.ts';
import * as acct from './account.ts';
import { GROUPINGS, deckSections, needsCountBadge, stackLayers } from './decklayout.ts';
import type { DeckGrouping } from './decklayout.ts';
import { txtIcon } from './cardtext.ts';
import {
  ELEMENTS, analyzeDeck, cardFacts, deckElements, deckListText,
  type CardFacts, type DeckAnalysis,
} from './deckstats.ts';
import { chooseDeck, chosenDeck, copyText, elIcon, esc } from './util.ts';
import { ART_BASE as ART } from './assets.ts';

// ── the shapes the server sends (server/collection.ts) ────────────────

export interface DeckRecord {
  games: number; wins: number; losses: number; unresolved: number; lastPlayed: string | null;
}

export interface DeckView {
  id: string;
  name: string;
  cards: string[];
  maybe: string[];
  cover: string | null;
  author: string;
  url?: string;
  /** who may see it. ABSENT MEANS PRIVATE — see server/collection.ts */
  visibility?: 'private' | 'unlisted' | 'public';
  /** markdown, rendered by descHtml through ui/cardlinks.ts */
  description?: string;
  /** the deck this was copied from, if any — the server folds a record over
   * the whole lineage, which is what makes the metagame list mean anything */
  copiedFrom?: string;
  createdAt: string;
  updatedAt: string;
  /** the server's own legality read — this page recomputes it locally instead
   * (see the header), and keeps this only for the first paint after a load */
  problems: string[];
  record: DeckRecord;
}

// ── module state ──────────────────────────────────────────────────────

/** art for a card: the registry's own image override, else derived */
const art = (name: string): string => {
  try {
    const img = getCard(name).image;
    if (img) return ART + img;
  } catch { /* not a registry card */ }
  return ART + name.replace(/ /g, '-') + '.jpg';
};

type Tab = 'cards' | 'mana' | 'maybe' | 'games' | 'share';

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let decks: DeckView[] | null = null;
let loading = false;
let openId: string | null = null;
let tab: Tab = 'cards';
/** how the card grid is grouped — ui/decklayout.ts owns the vocabulary and the
 * bucketing, because the shared deck page shows the same deck and the two must
 * not come to disagree about what a section is. Default 'type' (units, then
 * spells), which is the split the owner asked for by name. */
let group: DeckGrouping = 'type';
/** the add-cards drawer. `search` is a QUERY, in the language of
 * ui/cardsearch.ts — the chips below it write into this same string rather
 * than holding filter state of their own, which is why they can never
 * disagree with what is typed. See ui/cards.ts's header. */
let adding = false;
let search = '';
/** the status line under the header */
let msg = '';
/** the delete button asks once — a 30-card deck is an hour of somebody's day */
let confirmDelete: string | null = null;
/** the import box */
let importing = false;
let importMsg = '';
/** the export panel — the deck as the text format the importer reads back */
let exporting = false;
/** the description reads clipped until you ask for the rest — see descHtml */
let descOpen = false;
/** the description editor is open (the writer's view, not the reader's) */
let descEditing = false;
/** the pinned card, or null. The same panel the browser pins (ui/cardpanel.ts)
 * — clicking a tile anywhere on this page puts the card in it. */
let focus: string | null = null;

export const screen = (): 'decks' | null => (open ? 'decks' : null);

/** Wire the page up. `rerender` repaints the home screen when this closes. */
export function initDecks(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
}

const current = (): DeckView | null => decks?.find(d => d.id === openId) ?? null;

// ── talking to the server ─────────────────────────────────────────────

const authHeaders = (): Record<string, string> => acct.authHeaders();

interface DecksReply { ok: boolean; error?: string; note?: string; decks?: DeckView[]; id?: string }

/** saves scheduled but not yet sent, plus saves sent but not yet answered —
 * while either is non-zero the LOCAL copy is the truth (see the header) */
let queued = 0;
let inflight = 0;
const settled = (): boolean => queued === 0 && inflight === 0;

/** Adopt a server list, but only if nothing local is newer than it. */
function adopt(reply: DecksReply): void {
  if (reply.decks && settled()) decks = reply.decks;
  else if (reply.decks && decks) {
    // keep our own cards/name, take the fields only the server knows
    const byId = new Map(reply.decks.map(d => [d.id, d]));
    decks = decks.map(d => {
      const server = byId.get(d.id);
      return server ? { ...d, record: server.record } : d;
    });
  }
}

/**
 * Load the collection, once. `then` fires ONLY when a fetch actually completed
 * — never on the nothing-to-do path.
 *
 * ⚠ THAT IS A RE-ENTRANCY CONTRACT, NOT A STYLE CHOICE, and getting it wrong
 * shipped a 2.3-second home screen. The home picker calls this from
 * `wireDeckPicker(renderHome)`, i.e. `then` IS `renderHome`, and `renderHome`
 * ends by calling `wireDeckPicker` again. So a version that called `then()`
 * when the collection was already loaded re-entered the render from inside the
 * render: one click on the home screen repainted it 2,696 times before the
 * stack gave out. `ensureDefaultDecks` in main.ts has always returned bare
 * here, for exactly this reason; this now matches it.
 *
 * Callers that need a paint regardless do it themselves — see renderScreen().
 */
export function ensureCollection(then: () => void = () => {}): void {
  if (decks || loading || !acct.token()) return;
  loading = true;
  fetch('/api/decks', { headers: authHeaders() })
    .then(r => r.json() as Promise<DecksReply>)
    .then(r => {
      loading = false;
      if (r.ok && r.decks) { decks = r.decks; if (!openId) openId = decks[0]?.id ?? null; }
      else msg = r.error ?? 'could not load your decks';
      then();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; then(); });
}

/** Forget everything (logging out). */
export function resetCollection(): void {
  decks = null; openId = null; open = false; msg = '';
}

/** The legal decks in the collection, for the home screen's picker. */
export function playableDecks(): { id: string; name: string; author: string; url?: string; cards: string[] }[] {
  return (decks ?? [])
    .filter(d => analyzeDeck(d.cards).legal)
    .map(d => ({ id: d.id, name: d.name, author: d.author, ...(d.url ? { url: d.url } : {}), cards: d.cards }));
}

const SAVE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePending: string | null = null;

/** Send whatever edit is waiting, now. */
function flushSave(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  queued--;
  const deck = decks?.find(d => d.id === savePending);
  savePending = null;
  if (!deck) return;
  inflight++;
  void post('/api/decks/update', {
    id: deck.id, name: deck.name, cards: deck.cards, maybe: deck.maybe, cover: deck.cover,
    // BL-35/36: these ride the same debounce as everything else. `updateDeck`
    // applies only the fields it is SENT, so leaving them out here would make
    // publishing a setting that never reached the server — and the local copy
    // is the truth while a save is pending, so it would have looked like it had.
    visibility: deck.visibility ?? 'private', description: deck.description ?? '',
  }).then(r => {
    inflight--;
    if (!r.ok) { msg = r.error ?? 'could not save that change'; paint(); return; }
    if (r.note) msg = r.note;
    adopt(r);
    // repaint only when the answer could have changed anything on screen — a
    // silent successful save must not steal the cursor out of the name box
    if (r.note) paint();
  }).catch(() => { inflight--; msg = 'could not reach the server — that change is not saved'; paint(); });
}

/**
 * Push the open deck's current local state, coalescing rapid edits — rapid is
 * the normal case, because cutting four cards is four clicks in three seconds.
 *
 * One pending save, deliberately, so an edit to a DIFFERENT deck flushes the
 * one already waiting rather than replacing it. Without that, cutting a card
 * and clicking another deck inside the debounce window silently threw the cut
 * away: the timer would fire against the new id and the old edit — still shown
 * on screen, because the local copy is the truth — would never be sent.
 */
function scheduleSave(id: string): void {
  if (savePending && savePending !== id) flushSave();
  savePending = id;
  if (saveTimer) clearTimeout(saveTimer);
  else queued++;
  saveTimer = setTimeout(flushSave, SAVE_MS);
}

async function post(path: string, body: unknown): Promise<DecksReply> {
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  return await res.json() as DecksReply;
}

// ── little pieces ─────────────────────────────────────────────────────

const shortDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** a card's printed cost as the game's own icons: [3][r][r] */
function costBadge(f: CardFacts): string {
  const mana = f.isX ? txtIcon('cost_x', 'X')
    // the icon set stops at 9; the pool's few double-digit costs print as text
    : f.mana <= 9 ? txtIcon(`cost_${f.mana}`, String(f.mana))
    : `<span class="costnum">${f.mana}</span>`;
  const pips = ELEMENTS.flatMap(el => Array.from({ length: f.pips[el] ?? 0 }, () => elIcon(el, el))).join('');
  return `<span class="costbox">${mana}${pips}</span>`;
}

const elChips = (a: DeckAnalysis): string => deckElements(a)
  .map(e => `<span class="acctel ${e.el}" title="${Math.round(e.share * 100)}% of the deck">${e.el}</span>`)
  .join('');

/** the record line: "3W–1L" and nothing at all before the first game */
function recordLine(r: DeckRecord): string {
  if (!r.games) return '<span class="dim">no games yet</span>';
  return `<b class="${r.wins >= r.losses ? 'good' : 'bad'}">${r.wins}W–${r.losses}L</b>` +
    `<span class="dim"> in ${r.games} game${r.games === 1 ? '' : 's'}${
      r.unresolved ? ` · ${r.unresolved} with no result` : ''}</span>`;
}

/**
 * One card tile: art, how many, and the controls that change that. `where`
 * decides which way the move arrow points.
 *
 * WHAT IT GAINED FROM THE BROWSER (BL-34). ui/cards.ts's tile lost its name
 * banner and its native `title`, and gained `data-prev`, when the owner first
 * read the shipped browse page; this tile is the same grid and got none of it,
 * so the deck page was the one place in the client where you could not read a
 * card without opening its art in another tab. The three changes are the same
 * three, for the same three reasons:
 *
 *  - NO NAME BANNER. It sits across the bottom of the scan and covers the
 *    printed text: *"The name banner is blocking the card text from being
 *    read. Better to just remove it."*
 *  - NO `title`. The native tooltip and the client's own hover box both fired:
 *    *"There are two hover texts that are competing. The one that shows the
 *    text (not just the card name) is more useful."*
 *  - `data-prev`, which IS that one. main.ts's document-level `mouseover`
 *    closes on `[data-prev]` and is not game-scoped, so the whole hover box
 *    works here for the cost of the attribute.
 *
 * And the whole tile is `deck-focus`, so a click pins the same panel the
 * browser pins. The add/cut buttons still work: main.ts's delegation asks
 * `closest('[data-btn]')` and they are nearer than the tile.
 *
 * THE COPY CAP IS AN AFFORDANCE, NOT A GATE. At two copies the tile stops
 * offering `+`. It does not refuse anything: `−` still works, a deck that
 * already holds three (an import, say) still shows `×3` in red, and it still
 * saves. server/collection.ts is explicit that a saved deck may be illegal
 * while you build — the rule bites when the deck is brought to a game.
 *
 * ⚠ THE GREY IS THE DRAWER'S, NOT THE DECK'S. `atCap` and the greying used to
 * be the same flag, so a deck of two-ofs — which is what a constructed deck
 * IS — rendered entirely in greyscale. Measured on a 30-card deck: 15 tiles,
 * 15 greyed. The owner read it as breakage: *"the cards are weirdly greyed
 * out, for some reason."* The grey answers "nothing more to take here", which
 * is a sentence about SHOPPING, so it belongs where you are shopping. In the
 * deck's own grid the copies are already drawn and the `+` is already gone;
 * greying it too says nothing and costs the whole deck its colour.
 *
 * The cap itself is unchanged, and so is what BL-34 asked for: at two copies
 * no `+` is offered anywhere, in the deck or in the drawer.
 */
function tile(name: string, n: number, where: 'deck' | 'maybe' | 'add', cover: string | null): string {
  const overCap = n > 2;
  const atCap = where !== 'maybe' && n >= 2;
  /** the grey — only where "you already have the most of this" is news */
  const shopping = atCap && where === 'add';
  // COPIES ARE DRAWN, NOT COUNTED (ui/decklayout.ts): two copies is two cards,
  // stacked. The badge comes back only OVER the cap, where "too many of this"
  // is exactly the thing that must not be left to counting corners by eye.
  // `--d` hands the stack DEPTH to the CSS, which derives the whole geometry
  // from it — see the .dkstack block in ui/style.css.
  const layers = stackLayers(n);
  return `<div class="dktile${layers.length ? ' dkstack' : ''}${name === cover ? ' iscover' : ''}${
      overCap ? ' overcap' : ''}${shopping ? ' atcap' : ''}"
      ${layers.length ? `style="--d:${layers.length}"` : ''}
      data-prev="${esc(name)}" data-btn="deck-focus" data-card="${esc(name)}"
      ${n > 1 ? `aria-label="${esc(name)} ×${n}"` : ''}>
    ${layers.map(i => `<span class="dkghostwrap" style="--i:${i}" aria-hidden="true"><img
      class="dkart" src="${esc(art(name))}" alt="" loading="lazy"
      onerror="this.style.visibility='hidden'"></span>`).join('')}
    <img class="dkart" src="${esc(art(name))}" alt="${esc(name)}" loading="lazy"
      onerror="this.style.visibility='hidden'">
    ${/* no cost badge here: the scan prints its own cost in this exact corner,
        and the two on top of each other made both unreadable */ ''}
    ${needsCountBadge(n) ? `<span class="dkn bad">×${n}</span>` : ''}
    <span class="dkbtns">
      ${where === 'add'
        ? `${atCap ? '' : `<button data-btn="deck-add" data-card="${esc(name)}" title="add a copy to the deck">+</button>`}
           <button data-btn="deck-add-maybe" data-card="${esc(name)}" title="add to the maybeboard">»</button>`
        : where === 'deck'
          ? `<button data-btn="deck-less" data-card="${esc(name)}" title="cut one">−</button>
             ${atCap ? '' : `<button data-btn="deck-more" data-card="${esc(name)}" title="another copy">+</button>`}
             <button data-btn="deck-to-maybe" data-card="${esc(name)}" title="move one to the maybeboard">»</button>
             <button data-btn="deck-cover" data-card="${esc(name)}" title="use this art for the deck">★</button>`
          : `<button data-btn="deck-maybe-less" data-card="${esc(name)}" title="drop one">−</button>
             <button data-btn="deck-maybe-more" data-card="${esc(name)}" title="another copy">+</button>
             <button data-btn="deck-from-maybe" data-card="${esc(name)}" title="move one into the deck">«</button>`}
    </span>
  </div>`;
}

/** the deck's cards, bucketed the way the toolbar says */
function groupedTiles(a: DeckAnalysis, cover: string | null, where: 'deck' | 'maybe'): string {
  if (!a.copies.length) {
    return `<div class="hint">${where === 'deck'
      ? 'Nothing in here yet — open “Add cards” below and start putting things in.'
      : 'Nothing on the maybeboard. It is the shelf for cards you are still thinking about; nothing here is ever shuffled into a game.'}</div>`;
  }
  // ui/decklayout.ts: the same sections, in the same order, with the same
  // cost sort inside them, as the shared deck page draws. This used to be an
  // inline bucketing here and NOTHING on the shared page, which is the whole
  // of what was reported.
  return deckSections(a, group).map(sec => `<div class="dkgroup">
      <div class="dkgrouphead">${esc(sec.label)} <span class="dim">${sec.cards} card${
    sec.cards === 1 ? '' : 's'}</span></div>
      <div class="dkgrid">${sec.entries
    .map(e => tile(e.name, e.n, where, cover)).join('')}</div>
    </div>`).join('');
}

// ── the add-cards drawer ──────────────────────────────────────────────

/**
 * The pool, filtered by the drawer's query.
 *
 * This used to be a private predicate: a substring over name/text/type, one
 * element chip and a unit/spell toggle. It is now the same parser and the same
 * rows the card browser runs (ui/cardsearch.ts over ui/cardindex.ts), because
 * two filters over one pool is two answers to "what is a fire spell" and the
 * drawer's answer was the one nobody could extend.
 *
 * The pool is narrowed to what is DECK-LEGAL before the query sees it, so
 * `class:token` here honestly returns nothing rather than offering you a
 * Fireball as a two-of. The full 537 live one button away, in the browser.
 *
 * Still capped, and the cap is still SAID — a silently truncated list reads as
 * "that is all there is".
 */
const SEARCH_CAP = 60;

const deckPool = (): ReturnType<typeof allRows> => allRows().filter(r => r.playable);

function searchResults(): { names: string[]; total: number } {
  const hits = runSearch(search, {
    pool: deckPool(),
    ctx: { copies: countIn, maybe: countInMaybe },
  }).rows.map(r => r.name);
  return { names: hits.slice(0, SEARCH_CAP), total: hits.length };
}

/**
 * The pinned card, beside the grid rather than under it.
 *
 * The same panel the card browser pins — one implementation in
 * ui/cardpanel.ts, because two would drift the way the two filters did. Its
 * buttons are this page's, though: "add a copy" is the thing you want from a
 * card you are looking at while building, and it obeys the same cap the tiles
 * do, so the panel cannot put in a third copy the tile has stopped offering.
 */
function focusHtml(): string {
  if (!focus) return '';
  const n = countIn(focus);
  const playable = !!rowFor(focus)?.playable;
  return cardPanelHtml(focus, {
    close: 'deck-unfocus',
    actions: `${playable && n < 2
      ? `<button class="primary" data-btn="deck-add" data-card="${esc(focus)}">add a copy</button>`
      : ''}
      ${n ? `<button data-btn="deck-less" data-card="${esc(focus)}">cut one</button>` : ''}
      <button data-btn="deck-add-maybe" data-card="${esc(focus)}">to the maybeboard</button>
      <button data-btn="deck-browse-card" data-card="${esc(focus)}" title="find cards like this one in the browser">find similar</button>`,
  });
}

/** copies of a card in the open deck / on its maybeboard — what `in:` and
 * `copies:` answer from, and what the browser's bridge lends out */
function countIn(name: string): number {
  return current()?.cards.filter(c => c === name).length ?? 0;
}
function countInMaybe(name: string): number {
  return current()?.maybe.filter(c => c === name).length ?? 0;
}

function addDrawerHtml(): string {
  if (!adding) {
    return `<div class="dkaddrow">
      <button class="dkadd" data-btn="deck-adding">+ Add cards</button>
      <button class="dkbrowse" data-btn="deck-browse" title="the full card browser, with the whole filter syntax">🔍 Browse all cards</button>
    </div>`;
  }
  const { names, total } = searchResults();
  const chip = (key: string, value: string, label: string, extra = ''): string => {
    const state = chipState(search, key, value);
    return `<button class="${extra}${state === 'on' ? ' on' : state === 'off' ? ' off' : ''}"
      data-btn="deck-chip" data-key="${esc(key)}" data-value="${esc(value)}"
      title="${state === 'on' ? 'click again to exclude' : state === 'off' ? 'click again to clear' : 'include'}"
      >${label}</button>`;
  };
  return `<section class="dkdrawer">
    <div class="dkdrawerhead">
      <input id="dk-search" class="dksearch" spellcheck="false"
        placeholder="search the pool — name, type, text, or a filter like  mana:2 -kw:virus"
        value="${esc(search)}">
      <button data-btn="deck-browse" title="the full browser, with the facet rail and the syntax help">🔍 browse</button>
      <button data-btn="deck-adding-close">done</button>
    </div>
    <div class="dkfilters">
      ${ELEMENTS.map(el => chip('el', el, `${elIcon(el)}${el}`, `elchip ${el}`)).join('')}
      <span class="dkfilterspacer"></span>
      ${chip('kind', 'unit', 'units', 'dkkind')}
      ${chip('kind', 'spell', 'spells', 'dkkind')}
      ${chip('in', 'deck', 'in the deck', 'dkkind')}
      ${search ? '<button data-btn="deck-filter-clear">clear</button>' : ''}
    </div>
    <div class="dkresultcount">${total} card${total === 1 ? '' : 's'}${
      total > names.length ? ` — showing the first ${names.length}, narrow the search or open the browser to see the rest` : ''}</div>
    <div id="dk-results" class="dkgrid">${names.map(n => tile(n, countIn(n), 'add', null)).join('')}</div>
  </section>`;
}

// ── the mana / curve tab ──────────────────────────────────────────────

function curveHtml(a: DeckAnalysis): string {
  const peak = Math.max(1, ...a.curve.map(c => c.total));
  return `<div class="dkcurve">${a.curve.map(c => `
    <div class="dkcurverow${c.total ? '' : ' empty'}">
      <span class="dkcurvem">${c.mana}</span>
      <span class="dkcurvebar">
        ${c.units ? `<span class="seg units" style="flex:${c.units}" title="${c.units} unit${c.units === 1 ? '' : 's'} at ${c.mana}"></span>` : ''}
        ${c.spellUnits ? `<span class="seg spellunits" style="flex:${c.spellUnits}" title="${c.spellUnits} spell unit${c.spellUnits === 1 ? '' : 's'} at ${c.mana}"></span>` : ''}
        ${c.spells ? `<span class="seg spells" style="flex:${c.spells}" title="${c.spells} spell${c.spells === 1 ? '' : 's'} at ${c.mana}"></span>` : ''}
        <span class="pad" style="flex:${peak - c.total}"></span>
      </span>
      <span class="dkcurven">${c.total || ''}</span>
    </div>`).join('')}
    ${a.xCards ? `<div class="dkcurverow x">
      <span class="dkcurvem">X</span>
      <span class="dkcurvebar"><span class="seg spells" style="flex:${a.xCards}"></span>
        <span class="pad" style="flex:${peak - a.xCards}"></span></span>
      <span class="dkcurven">${a.xCards}</span>
    </div>` : ''}
    <div class="dkcurvekey">
      <span><i class="seg units"></i> units</span>
      ${a.spellUnits ? '<span><i class="seg spellunits"></i> spell units</span>' : ''}
      <span><i class="seg spells"></i> spells</span>
      ${a.xCards ? '<span class="dim">X-cost cards sit on no rung — they cost what you pay</span>' : ''}
    </div>`;
}

/** A deck's visibility, read the way the server reads it: absent is private.
 * Duplicated as a one-liner rather than imported because the client and the
 * server share no code — and this is the safe direction to get wrong. */
const visibilityOf = (d: DeckView): 'private' | 'unlisted' | 'public' =>
  (d.visibility === 'public' || d.visibility === 'unlisted' ? d.visibility : 'private');

/** the link that opens this deck for somebody else */
const shareLink = (d: DeckView): string =>
  `${location.origin}${location.pathname}?deck=${encodeURIComponent(d.id)}`;

/**
 * The description, as a READER sees it: the first sentences, and the rest
 * behind a click.
 *
 * Card names in it hover and pin — that is ui/cardlinks.ts through
 * ui/markdown.ts's documented `inline` seam, so the markdown renderer itself
 * is untouched and still emits its own closed tag set. `deck-focus` is passed
 * so a name in the prose pins the same panel a tile does: the point of the
 * feature is that you can read about a deck without already knowing every card
 * in it.
 *
 * The clip is made on the SOURCE (clipDescription), never on the rendered
 * markup — cutting HTML at a character count is how a renderer starts emitting
 * half a tag.
 */
function descHtml(d: DeckView): string {
  const src = d.description ?? '';
  if (!src.trim()) return '';
  const { text, clipped } = descOpen ? { text: src, clipped: false } : clipDescription(src);
  return `<div class="deckdesc">
    <div class="deckdescbody">${mdToHtml(text, { inline: cardLinker({ focusBtn: 'deck-focus' }) })}</div>
    ${clipped || descOpen
      ? `<button class="cblink" data-btn="deck-desc-toggle">${descOpen ? 'show less' : 'read more'}</button>`
      : ''}
  </div>`;
}

/**
 * Publishing: who may see this deck, the link, and what it says about itself.
 *
 * ALL THREE ARE ONE TAB on purpose. Visibility without a link is a setting
 * nobody can act on, a link to a private deck is a dead link, and a public
 * deck with no description is a list of thirty names — the three decisions are
 * one decision, so they are one screen.
 *
 * PRIVATE IS WHERE EVERY DECK STARTS, including the starter five and anything
 * copied from somebody else. Publishing is a thing you do.
 */
function shareTab(d: DeckView): string {
  const vis = visibilityOf(d);
  const link = shareLink(d);
  const choices: [typeof vis, string, string][] = [
    ['private', 'Private', 'Only you. The link below will not open for anybody else.'],
    ['unlisted', 'Unlisted', 'Anybody holding the link. Not on your profile, not on the metagame list — the link is the permission.'],
    ['public', 'Public', 'The link, your profile, and the metagame list, where its record is ranked against everyone else’s.'],
  ];
  return `<section class="acctcard wide">
    <h3>Who can see this deck</h3>
    <div class="dkvis">${choices.map(([v, label, why]) =>
      `<button class="dkviso${vis === v ? ' on' : ''}" data-btn="deck-visibility" data-visibility="${v}">
         <b>${label}</b><span class="hint">${why}</span></button>`).join('')}</div>
    ${vis === 'private'
      ? '<p class="hint">Nothing is shared until you pick one of the other two.</p>'
      : `<div class="sharebar">Send somebody this link:
           <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
           <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>`}
    ${vis === 'public' && d.record.games < 5
      ? `<p class="hint">On the metagame list this sits under “not enough games yet” until it has
          five constructed games. Only games you played while signed in, with this deck picked
          from your collection, are counted.</p>`
      : ''}

    <h3>What it is, and how to play it</h3>
    <p class="hint">Markdown — <code>**bold**</code>, <code>## headings</code>, <code>- lists</code>.
      Card names are found automatically and become hoverable, so a reader who does not know the
      pool can see what you mean. To name a card in your own words, write
      <code>[the two-drop](Actual Card Name)</code>.</p>
    ${descEditing
      ? `<textarea id="dk-desc" class="dkdesctext" rows="14"
           placeholder="What is the deck trying to do? What do you keep? What beats it?"
           maxlength="6000">${esc(d.description ?? '')}</textarea>
         <div class="dkaddrow">
           <button class="primary" data-btn="deck-desc-save">Save</button>
           <button data-btn="deck-desc-cancel">Cancel</button>
         </div>`
      : `<div class="deckdesc">${d.description?.trim()
          ? `<div class="deckdescbody">${mdToHtml(d.description, { inline: cardLinker({ focusBtn: 'deck-focus' }) })}</div>`
          : '<p class="hint">Nothing written yet.</p>'}</div>
         <button class="dkadd" data-btn="deck-desc-edit">${
           d.description?.trim() ? 'Edit the description' : 'Write a description'}</button>`}
  </section>`;
}

/** The affinity table: what you must have OPEN, and by when. */
function affinityHtml(a: DeckAnalysis): string {
  const live = ELEMENTS.filter(el => (a.maxAffinity[el] ?? 0) > 0);
  if (!live.length) return '<div class="hint">Nothing in the deck asks for affinity yet.</div>';
  const rows = a.rows.filter(r => r.count > 0 || live.some(el => (r.need[el] ?? 0) > 0));
  const cell = (r: typeof a.rows[number], el: string): string => {
    const cum = r.cumulative[el] ?? 0;
    if (!cum) return '<td class="dknone">·</td>';
    const isNew = r.first.includes(el);
    return `<td class="${isNew ? 'dknew' : ''}" title="${isNew
      ? `a card at ${r.mana} mana is the first thing that needs ${cum} ${el}`
      : 'carried up from a cheaper card'}">${cum}</td>`;
  };
  return `<table class="dkaff">
    <thead><tr><th>by mana</th><th>cards</th>${live.map(el =>
      `<th class="acctel ${el}">${elIcon(el)}${el}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="dkmana">${r.mana}</td>
      <td class="dim">${r.count || ''}</td>
      ${live.map(el => cell(r, el)).join('')}
    </tr>`).join('')}
    <tr class="dkmaxrow"><td>everything</td><td class="dim">${a.total - a.unknown.length}</td>
      ${live.map(el => `<td><b>${a.maxAffinity[el] ?? 0}</b></td>`).join('')}</tr>
    </tbody>
  </table>
  <div class="hint">Each number is how much affinity of that element you need <b>open by then</b> to
    cast everything at that mana value or below — a requirement never goes down as you climb, so it
    is carried up the table. <b>Bold</b> is where a new requirement first appears. The bottom row is
    the ceiling: ${live.map(el => `${a.maxAffinity[el]} ${el}`).join(' + ')} —
    ${a.affinityFloor} resources of named elements — casts every card in the deck.</div>`;
}

/**
 * Everything a reader wants to know about a list: the curve and its average,
 * what is in it, the element share, and the affinity ceiling — *"basic stats
 * about the deck like element requirements and mana values"*.
 *
 * EXPORTED because the shared deck page (ui/meta.ts) shows the same deck to
 * somebody who cannot edit it, and growing a second, thinner stats panel there
 * is how the two come to disagree. It is a pure function of `DeckAnalysis`
 * and holds none of this page's state.
 */
export function deckStatsHtml(a: DeckAnalysis): string {
  const pct = (n: number): string => a.total ? `${Math.round((n / a.total) * 100)}%` : '0%';
  const elTotal = ELEMENTS.reduce((n, el) => n + (a.elements[el] ?? 0), 0);
  return `<section class="acctcard">
      <h3>Curve</h3>
      ${curveHtml(a)}
      <div class="hint">Average cost ${a.avgMana.toFixed(1)} mana${
        a.xCards ? `, not counting ${a.xCards} X-cost card${a.xCards === 1 ? '' : 's'}` : ''}.</div>
    </section>
    <section class="acctcard">
      <h3>What is in it</h3>
      <div class="statgrid">
        <div class="statcell"><div class="statval">${a.units}</div><div class="statlab">units (${pct(a.units)})</div></div>
        <div class="statcell"><div class="statval">${a.spells}</div><div class="statlab">spells (${pct(a.spells)})</div></div>
        ${a.spellUnits ? `<div class="statcell"><div class="statval">${a.spellUnits}</div><div class="statlab">spell units</div></div>` : ''}
        <div class="statcell" title="cards printed {Battle} — playable during a battle rather than in deployment"><div class="statval">${a.battle}</div><div class="statlab">battle cards</div></div>
        ${a.haste ? `<div class="statcell"><div class="statval">${a.haste}</div><div class="statlab">haste cards</div></div>` : ''}
        <div class="statcell"><div class="statval">${a.copies.length}</div><div class="statlab">different cards</div></div>
      </div>
    </section>
    <section class="acctcard">
      <h3>Elements</h3>
      ${elTotal ? `<div class="elbar">${ELEMENTS.map(el => {
        const w = a.elements[el] ?? 0;
        return w > 0 ? `<span class="elbarseg ${el}" style="flex:${w}"
          title="${el}: ${Math.round((w / elTotal) * 100)}%"></span>` : '';
      }).join('')}</div>
      <div class="ellegend">${deckElements(a).map(e =>
        `<span class="acctel ${e.el}">${e.el} ${Math.round(e.share * 100)}%</span>`).join('')}</div>`
      : '<div class="hint">Nothing in the deck yet.</div>'}
      <div class="hint">Share of the deck by card. A hybrid counts half to each of its elements.</div>
    </section>
    <section class="acctcard wide">
      <h3>Affinity — what you need open, and by when</h3>
      ${affinityHtml(a)}
    </section>
    ${a.demanding.length ? `<section class="acctcard wide">
      <h3>The greediest costs</h3>
      <div class="dkdemand">${a.demanding.slice(0, 8).map(d => {
        const f = cardFacts(d.name);
        return `<span class="dkdemandrow">${f ? costBadge(f) : ''} ${esc(d.name)}</span>`;
      }).join('')}</div>
      <div class="hint">These set the ceiling above. If a requirement is out of reach, this is the
        list to cut from.</div>
    </section>` : ''}`;
}

// ── the games tab ─────────────────────────────────────────────────────

function gamesTab(deck: DeckView): string {
  const rows = (acct.currentUser()?.history ?? []).filter(g => g.deckId === deck.id);
  if (!rows.length) {
    return `<section class="acctcard"><div class="hint">
      No recorded games with this deck yet. A game counts toward a deck when you were logged in and
      brought it from here — press <b>Play this deck</b>, then start a constructed game.
      ${deck.record.games ? `<br>(Your record with it is ${deck.record.wins}W–${deck.record.losses}L,
        but those games are older than the last 25 shown on your profile.)` : ''}
    </div></section>`;
  }
  return `<section class="acctcard wide">
    <h3>Games with this deck <span class="acctcount">${rows.length}</span></h3>
    <table class="accttable games"><thead><tr>
      <th>result</th><th>opponent</th><th>turns</th><th>life</th><th>played</th><th>room</th>
    </tr></thead><tbody>${rows.map(g => `<tr class="res-${g.result}">
      <td class="resultcell">${g.result === 'win' ? 'WIN' : g.result === 'loss' ? 'loss' : '?'}</td>
      <td>${esc(g.opponent)}</td>
      <td>${g.turns}</td>
      <td>${g.life[0]}–${g.life[1]}</td>
      <td>${shortDate(g.playedAt)}</td>
      <td class="roomcell">${esc(g.code)}</td>
    </tr>`).join('')}</tbody></table>
    <div class="hint">The last 25 games on your profile, filtered to this deck. Its full record is
      ${deck.record.wins}W–${deck.record.losses}L.</div>
  </section>`;
}

// ── the page ──────────────────────────────────────────────────────────

function deckRow(d: DeckView): string {
  const a = analyzeDeck(d.cards);
  const cover = d.cover ?? d.cards[0] ?? null;
  return `<button class="deckrow${d.id === openId ? ' on' : ''}" data-btn="deck-open" data-id="${esc(d.id)}">
    <span class="deckrowart">${cover
      ? `<img src="${esc(art(cover))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
      : ''}</span>
    <span class="deckrowbody">
      <span class="deckrowname">${esc(d.name)}</span>
      <span class="deckrowmeta">${a.total} card${a.total === 1 ? '' : 's'}${
        d.maybe.length ? ` · ${d.maybe.length} maybe` : ''}</span>
      <span class="deckrowmeta">${elChips(a) || '<span class="dim">empty</span>'}</span>
      <span class="deckrowrec">${d.record.games ? `${d.record.wins}W–${d.record.losses}L` : ''}</span>
    </span>
    <span class="deckflag ${a.legal ? 'ok' : 'bad'}"
      title="${a.legal ? 'legal — ready to play' : esc(a.problems.concat(a.unknown.length ? [`${a.unknown.length} card(s) this build cannot play`] : []).join(' · ') || 'not legal yet')}">${
      a.legal ? '✓' : '!'}</span>
  </button>`;
}

function importHtml(): string {
  if (!importing) {
    return `<div class="deckmakebtns">
      <button class="primary" data-btn="deck-new">+ New deck</button>
      <button data-btn="deck-import-open">Import…</button>
    </div>`;
  }
  return `<div class="deckimportbox">
    <div class="zonelabel">Import a deck</div>
    <div class="joinrow">
      <input id="dk-url" placeholder="algomancer.cc deck link" spellcheck="false">
      <button data-btn="deck-import-url">Load</button>
    </div>
    <details class="deckpaste" open>
      <summary>…or paste a list</summary>
      <textarea id="dk-text" rows="5" spellcheck="false"
        placeholder="2 Ignis Sprite&#10;2 Rune Channeler&#10;…"></textarea>
      <button data-btn="deck-import-text">Import the list</button>
    </details>
    ${importMsg ? `<div class="deckmsg">${esc(importMsg)}</div>` : ''}
    <button data-btn="deck-import-close">cancel</button>
  </div>`;
}

function detailHtml(d: DeckView): string {
  const a = analyzeDeck(d.cards);
  const maybe = analyzeDeck(d.maybe);
  const chosen = chosenDeck();
  const isChosen = chosen?.id === d.id;
  const trouble = [...a.problems, ...(a.unknown.length
    ? [`this build cannot play: ${a.unknown.slice(0, 3).join(', ')}${a.unknown.length > 3 ? ` (+${a.unknown.length - 3})` : ''}`]
    : [])];
  const tabs = ([
    ['cards', `cards <span class="acctcount">${a.total}</span>`],
    ['mana', 'curve &amp; affinity'],
    ['maybe', `maybeboard <span class="acctcount">${d.maybe.length}</span>`],
    ['games', `games <span class="acctcount">${d.record.games}</span>`],
    ['share', `share${visibilityOf(d) === 'private' ? '' : ' <span class="acctcount">on</span>'}`],
  ] as [Tab, string][]).map(([t, label]) =>
    `<button class="accttab ${tab === t ? 'on' : ''}" data-btn="deck-tab" data-tab="${t}">${label}</button>`).join('');

  return `<div class="deckhero">
      <div class="deckcover">${d.cover
        ? `<img src="${esc(art(d.cover))}" alt="${esc(d.cover)}" onerror="this.style.visibility='hidden'">`
        : '<span class="hint">no cover — press ★ on a card</span>'}</div>
      <div class="deckheroinfo">
        <input id="dk-name" class="deckname" maxlength="60" value="${esc(d.name)}"
          aria-label="deck name" spellcheck="false">
        <div class="deckfacts">${a.total} cards · ${a.units} unit${a.units === 1 ? '' : 's'} /
          ${a.spells + a.spellUnits} spell${a.spells + a.spellUnits === 1 ? '' : 's'} ·
          avg ${a.avgMana.toFixed(1)} mana ${elChips(a)}</div>
        <div class="deckstatus ${a.legal ? 'ok' : 'bad'}">${a.legal
          ? `✓ legal — 30 minimum, max 2 of a card${isChosen ? ' · <b>this is the deck you are bringing</b>' : ''}`
          : esc(trouble.join(' · ') || 'not legal yet')}</div>
        <div class="deckrecline">${recordLine(d.record)}${
          d.author && d.author !== 'you' ? ` <span class="dim">· built by ${esc(d.author)}</span>` : ''}${
          d.url ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">algomancer.cc</a>` : ''}</div>
        <div class="deckbtns">
          <button class="${isChosen ? '' : 'primary'}" data-btn="deck-play" ${a.legal ? '' : 'disabled'}>${
            isChosen ? 'Bringing this deck' : a.legal ? 'Play this deck' : 'not legal yet'}</button>
          <button data-btn="deck-duplicate">Duplicate</button>
          ${confirmDelete === d.id
            ? `<button class="dkdanger" data-btn="deck-delete-yes">Delete “${esc(d.name)}” for good</button>
               <button data-btn="deck-delete-no">keep it</button>`
            : `<button data-btn="deck-delete">Delete</button>`}
        </div>
      </div>
    </div>
    ${descHtml(d)}
    <div class="accttabs">${tabs}</div>
    <div class="acctbody deckbody">${
      tab === 'cards' ? `<section class="acctcard wide">
          ${deckStripHtml(d.name, a)}
          <div class="dkwork">
           <div class="dkworkmain">
            <div class="dktoolbar">
              <span class="zonelabel">group by</span>
              ${GROUPINGS.map(g =>
                `<button class="dkkind${group === g.id ? ' on' : ''}" data-btn="deck-group"
                  data-group="${g.id}" title="${esc(g.hint)}">${esc(g.label)}</button>`).join('')}
              <span class="dkfilterspacer"></span>
              <span class="hint">click a card to pin it · − cuts a copy · + adds one · » sends one to the maybeboard · ★ picks the cover</span>
            </div>
            ${groupedTiles(a, d.cover, 'deck')}
            ${addDrawerHtml()}
           </div>
           ${focusHtml()}
          </div>
          ${exporting
            ? `<div class="dkexport">
                 <div class="dktoolbar"><span class="zonelabel">the list as text</span>
                   <button data-btn="deck-copy-list">copy</button>
                   <button data-btn="deck-export-close">close</button>
                   <span class="hint">the same format the paste box reads — send it to
                     somebody, or paste it back in here</span></div>
                 <textarea class="dkexporttext" rows="10" readonly
                   onclick="this.select()">${esc(deckListText(d.name, d.cards, d.maybe, d.url))}</textarea>
               </div>`
            : '<button class="dkadd" data-btn="deck-export">Export as text</button>'}
        </section>`
      : tab === 'mana' ? deckStatsHtml(a)
      : tab === 'maybe' ? `<section class="acctcard wide">
          <h3>Maybeboard <span class="acctcount">${d.maybe.length}</span></h3>
          <div class="hint">Not a sideboard — Algomancy has none. This is the shelf: cards you cut and
            might put back, or cards you want to try. Nothing here is shuffled into any game, and no
            deck rules apply to it.</div>
          <div class="dkwork">
            <div class="dkworkmain">${groupedTiles(maybe, null, 'maybe')}</div>
            ${focusHtml()}
          </div>
        </section>`
      : tab === 'share' ? shareTab(d)
      : gamesTab(d)}</div>`;
}

/**
 * WHERE YOU WERE, ACROSS A REPAINT.
 *
 * Every edit on this page — one `+`, one `−`, a filter chip, pinning a card —
 * runs `edit()` → `paint()`, and `paint()` rewrites the whole of `#app`. That
 * is one write, not a storm (test/189, and measured again here at 1 write and
 * ~19ms per click), so the cost is not speed. The cost is PLACE: the new tree
 * has no scroll position and no focus, and the browser then puts both wherever
 * it likes. Measured over CDP before this: adding one card from the drawer
 * threw the page 537px up the document, so the card you clicked was no longer
 * under the cursor and the next click landed on something else. That, not
 * latency, is what "basically unusable" felt like.
 *
 * ⚠ THE JUMP CAME FROM `wire()`, NOT FROM THE INNERHTML. Restoring the scroll
 * alone does not fix it: `wire()` ended with an unconditional `box.focus()`,
 * and focusing an input scrolls it into view. It is there for a real reason —
 * opening the drawer should put the caret in the search box — but it was
 * re-taking focus on every repaint for the rest of the session, dragging the
 * viewport to the search box each time and stamping the caret to the end of
 * whatever was typed. So the focus is claimed ONCE, by the click that opens the
 * drawer (`focusSearch`), and otherwise restored to wherever it already was.
 *
 * Nothing is restored on the paint that OPENS the page: there is no deck page
 * in the document yet to have been anywhere, and inheriting the home screen's
 * scroll would be its own bug. That is read off the DOM, not tracked.
 */
interface Perch {
  scroll: number;
  /** the id of the focused field, and the caret in it — both or neither */
  focus: string | null;
  sel: [number, number] | null;
  /** where the add drawer began, in DOCUMENT coordinates — see anchorTop */
  anchor: number | null;
}

/**
 * ⚠ AND THE SCROLL ALONE IS NOT ENOUGH WHEN THE DRAWER IS OPEN. Adding a card
 * grows the DECK GRID, which sits ABOVE the drawer, so holding `scrollTop`
 * still slides the results down under the cursor — measured at 136px, a full
 * row, which is exactly far enough to make the next click land on the wrong
 * card. So when the drawer is on screen it is the drawer, not the document,
 * that is held still: the scroll is corrected by however far `#dk-results`
 * moved. One anchor, chosen because it is the thing being read; everywhere else
 * the plain scroll is right, because what changed size is below you.
 */
function anchorTop(): number | null {
  const el = document.getElementById('dk-results');
  if (!el) return null;
  return el.getBoundingClientRect().top + (document.scrollingElement?.scrollTop ?? 0);
}

function perch(): Perch | null {
  const doc = document.scrollingElement;
  if (!doc || !document.querySelector('.deckpage')) return null;
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const id = el?.id && $app?.contains(el) ? el.id : null;
  const sel = id && typeof el?.selectionStart === 'number' && typeof el.selectionEnd === 'number'
    ? [el.selectionStart, el.selectionEnd] as [number, number]
    : null;
  return { scroll: doc.scrollTop, focus: id, sel, anchor: anchorTop() };
}

function alight(p: Perch | null): void {
  const doc = document.scrollingElement;
  if (!p || !doc) return;
  if (p.focus) {
    const el = document.getElementById(p.focus) as HTMLInputElement | null;
    // preventScroll, or restoring the focus undoes the scroll we just restored
    el?.focus({ preventScroll: true });
    if (el && p.sel) { el.selectionStart = p.sel[0]; el.selectionEnd = p.sel[1]; }
  }
  const now = anchorTop();
  doc.scrollTop = p.scroll + (p.anchor !== null && now !== null ? now - p.anchor : 0);
}

/** set by the click that opens the add drawer; consumed by the next `wire()` */
let focusSearch = false;

function paint(): void {
  if (!$app) return;
  // THE CARD BROWSER CAN BE OPEN ON TOP OF THIS PAGE. When it is, this page is
  // still `open` — that is how `back()` is a repaint rather than a reload — so
  // every edit the browser made through the bridge landed here, painted the
  // DECK page into #app, and was immediately painted over by the browser.
  // Two writes per click instead of one, the second of them wrong.
  // Measured over CDP: 6 writes for 3 add-clicks, now 3. (The 2,696-write home
  // screen this repo shipped in BL-14 started exactly this way; see
  // test/189-collection-loading.test.ts.)
  if (cb.screen()) return;
  const was = perch();
  $app.classList.remove('board');
  if (!acct.token()) {
    $app.innerHTML = `<div class="joinscreen home acctscreen">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>Decks</h2>
      <p class="hint">A deck collection hangs off an account — that is what remembers your decks
        between machines and keeps your record with each of them. Log in and they will be here,
        starting with the five bundled decks.</p>
      <div class="homebtns">
        <button class="primary" data-btn="acct-open-auth">Log in / Sign up</button>
        <button data-btn="deck-close">Back</button>
      </div>
    </div>`;
    return;
  }
  const d = current();
  $app.innerHTML = `<div class="deckpage">
    <div class="accthead">
      <div>
        <h1>Decks</h1>
        <div class="hint">${decks
          ? `${decks.length} saved · edits save themselves${msg ? ` · ${esc(msg)}` : ''}`
          : loading ? 'loading…' : esc(msg || 'no decks loaded')}</div>
      </div>
      <div class="accthbtns">
        <button data-btn="deck-refresh" title="reload from the server">↻</button>
        <button class="primary" data-btn="deck-close">Back to games</button>
      </div>
    </div>
    <div class="deckmain">
      <aside class="decklist">
        ${importHtml()}
        ${decks?.length
          ? decks.map(deckRow).join('')
          : `<div class="hint">${loading ? 'loading…' : 'No decks yet — make one.'}</div>`}
      </aside>
      <section class="deckdetail">${d
        ? detailHtml(d)
        : '<div class="hint">Pick a deck on the left, or make a new one.</div>'}</section>
    </div>
  </div>`;
  wire(was);
}

/** the two live inputs — they must not repaint the page under the cursor */
function wire(was: Perch | null): void {
  const name = document.getElementById('dk-name') as HTMLInputElement | null;
  name?.addEventListener('input', () => {
    const d = current();
    if (!d) return;
    d.name = name.value;
    // the rail label follows without a repaint, so the caret stays put
    const label = document.querySelector(`.deckrow.on .deckrowname`);
    if (label) label.textContent = name.value;
    scheduleSave(d.id);
  });

  const box = document.getElementById('dk-search') as HTMLInputElement | null;
  box?.addEventListener('input', () => {
    search = box.value;
    const out = document.getElementById('dk-results');
    const count = document.querySelector('.dkresultcount');
    if (!out) return;
    const { names, total } = searchResults();
    out.innerHTML = names.map(n => tile(n, countIn(n), 'add', null)).join('');
    if (count) {
      count.textContent = `${total} card${total === 1 ? '' : 's'}` +
        (total > names.length ? ` — showing the first ${names.length}, narrow the search to see the rest` : '');
    }
  });

  // OPENING the drawer claims the caret — that is the whole point of the
  // button. Every LATER repaint must not: see the Perch header. Focusing here
  // deliberately scrolls the drawer into view, which is what you asked for.
  if (focusSearch && box) {
    focusSearch = false;
    box.focus();
    box.selectionStart = box.selectionEnd = box.value.length;
    return;
  }
  alight(was);
}

export function renderScreen(): void {
  ensureCollection(paint);
  paint();
}

// ── edits ─────────────────────────────────────────────────────────────

/** Change the open deck's card list, then save. Every editing button goes
 * through here so nothing can edit without scheduling the save. */
function edit(fn: (d: DeckView) => void): void {
  const d = current();
  if (!d) return;
  fn(d);
  d.updatedAt = new Date().toISOString();
  scheduleSave(d.id);
  paint();
}

const removeOne = (list: string[], name: string): string[] => {
  const i = list.indexOf(name);
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
};

/**
 * The handle the card browser builds through.
 *
 * EVERY mutation here goes through `edit()`, which is the file's single
 * funnel into `scheduleSave()`. That is the whole reason the browser is given
 * a bridge instead of the deck: a second writer touching `decks` directly
 * would sidestep the debounce rules in this file's header, and the bug those
 * rules exist to prevent (an edit to one deck thrown away by the pending save
 * of another) is invisible until somebody loses a cut.
 */
function bridgeToOpenDeck(): cb.DeckBridge {
  return {
    id: () => openId,
    name: () => current()?.name ?? 'this deck',
    copies: countIn,
    maybe: countInMaybe,
    add: name => edit(d => { d.cards = [...d.cards, name]; }),
    remove: name => edit(d => { d.cards = removeOne(d.cards, name); }),
    toMaybe: name => edit(d => { d.maybe = [...d.maybe, name]; }),
    summary: () => {
      const d = current();
      if (!d) return { total: 0, legal: false, problems: ['no deck open'], curve: [], elements: {} };
      const a = analyzeDeck(d.cards);
      return {
        total: a.total,
        legal: a.legal,
        problems: [...a.problems, ...(a.unknown.length
          ? [`${a.unknown.length} card(s) this build cannot play`] : [])],
        curve: a.curve.map(c => ({ mana: c.mana, total: c.total })),
        elements: a.elements,
      };
    },
    // the deck page never closed, so coming back is a repaint — and `paint()`
    // rather than `renderScreen()` so it does not re-enter the collection
    // loader (test/189: a `then()` on the already-loaded path repainted the
    // home screen 2,696 times)
    back: () => { cb.useDeck(null); paint(); },
  };
}

// ── clicks ────────────────────────────────────────────────────────────

/** main.ts offers every button here. Returns true when it was ours. */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('deck-')) return false;
  const card = btn.dataset['card'] ?? '';

  switch (b) {
    case 'deck-openpage':
      open = true; msg = ''; confirmDelete = null;
      renderScreen();
      return true;

    case 'deck-close':
      // leaving the page must not outrun the debounce — the next thing the
      // user does may be starting a game, which navigates this module away
      flushSave();
      open = false; adding = false; importing = false; confirmDelete = null;
      rerenderHost();
      return true;

    case 'deck-refresh':
      flushSave();
      decks = null; msg = '';
      renderScreen();
      return true;

    case 'deck-open':
      flushSave();
      openId = btn.dataset['id'] ?? null;
      tab = 'cards'; confirmDelete = null; adding = false; exporting = false; msg = '';
      focus = null;
      paint();
      return true;

    case 'deck-tab':
      tab = (btn.dataset['tab'] ?? 'cards') as Tab;
      paint();
      return true;

    case 'deck-group':
      group = (btn.dataset['group'] ?? 'type') as DeckGrouping;
      paint();
      return true;

    // ── making decks ──
    case 'deck-new':
      void post('/api/decks/create', { name: 'New deck', cards: [] }).then(r => {
        if (!r.ok) { msg = r.error ?? 'could not make a deck'; paint(); return; }
        adopt(r);
        openId = r.id ?? openId; tab = 'cards'; adding = true; msg = '';
        // a brand new deck is empty, so the caret belongs in the search box
        focusSearch = true;
        paint();
      }).catch(() => { msg = 'could not reach the server'; paint(); });
      return true;

    case 'deck-import-open':
      importing = true; importMsg = ''; paint(); return true;
    case 'deck-import-close':
      importing = false; importMsg = ''; paint(); return true;

    case 'deck-import-url':
    case 'deck-import-text': {
      const url = (document.getElementById('dk-url') as HTMLInputElement | null)?.value.trim() ?? '';
      const text = (document.getElementById('dk-text') as HTMLTextAreaElement | null)?.value.trim() ?? '';
      const body = b === 'deck-import-url' ? { url } : { text };
      if (!(b === 'deck-import-url' ? url : text)) return true;
      importMsg = 'importing…';
      paint();
      void post('/api/decks/import', body).then(r => {
        if (!r.ok) { importMsg = r.error ?? 'import failed'; paint(); return; }
        adopt(r);
        openId = r.id ?? openId;
        importing = false; tab = 'cards';
        // the import's own complaints (an unscripted card, 27 cards) are the
        // useful half of the answer and belong where they can be read
        msg = r.note ?? 'imported';
        paint();
      }).catch(() => { importMsg = 'could not reach the server'; paint(); });
      return true;
    }

    case 'deck-duplicate': {
      const d = current();
      if (!d) return true;
      void post('/api/decks/duplicate', { id: d.id }).then(r => {
        if (!r.ok) { msg = r.error ?? 'could not copy that deck'; paint(); return; }
        adopt(r);
        openId = r.id ?? openId;
        msg = 'copied';
        paint();
      }).catch(() => { msg = 'could not reach the server'; paint(); });
      return true;
    }

    case 'deck-delete':
      confirmDelete = current()?.id ?? null; paint(); return true;
    case 'deck-delete-no':
      confirmDelete = null; paint(); return true;
    case 'deck-delete-yes': {
      const d = current();
      if (!d) return true;
      confirmDelete = null;
      void post('/api/decks/delete', { id: d.id }).then(r => {
        if (!r.ok) { msg = r.error ?? 'could not delete that deck'; paint(); return; }
        adopt(r);
        openId = decks?.[0]?.id ?? null;
        msg = `deleted “${d.name}”`;
        paint();
      }).catch(() => { msg = 'could not reach the server'; paint(); });
      return true;
    }

    case 'deck-play': {
      flushSave();
      const d = current();
      if (!d) return true;
      chooseDeck({ id: d.id, name: d.name, author: d.author, ...(d.url ? { url: d.url } : {}), cards: d.cards });
      msg = `“${d.name}” is the deck you are bringing to constructed games`;
      paint();
      return true;
    }

    // ── editing the list ──
    case 'deck-more':
      edit(d => { d.cards = [...d.cards, card]; }); return true;
    case 'deck-less':
      edit(d => { d.cards = removeOne(d.cards, card); }); return true;
    case 'deck-add':
      edit(d => { d.cards = [...d.cards, card]; }); return true;
    case 'deck-add-maybe':
      edit(d => { d.maybe = [...d.maybe, card]; }); return true;
    case 'deck-to-maybe':
      edit(d => { d.cards = removeOne(d.cards, card); d.maybe = [...d.maybe, card]; }); return true;
    case 'deck-from-maybe':
      edit(d => { d.maybe = removeOne(d.maybe, card); d.cards = [...d.cards, card]; }); return true;
    case 'deck-maybe-more':
      edit(d => { d.maybe = [...d.maybe, card]; }); return true;
    case 'deck-maybe-less':
      edit(d => { d.maybe = removeOne(d.maybe, card); }); return true;
    case 'deck-cover':
      edit(d => { d.cover = card; }); return true;

    // ── the add drawer ──
    case 'deck-export':
      exporting = true; paint(); return true;
    case 'deck-export-close':
      exporting = false; paint(); return true;
    case 'deck-copy-list': {
      const d = current();
      if (!d) return true;
      // The textarea is right there and is what plain http copies FROM, so it
      // is handed over as the selection. No paint(): repainting here is what
      // used to throw the selection away — see copyText in ui/util.ts.
      copyText(
        deckListText(d.name, d.cards, d.maybe, d.url),
        document.querySelector('.dkexporttext'),
        btn,
      );
      return true;
    }

    case 'deck-adding':
      adding = true; focusSearch = true; paint(); return true;
    case 'deck-adding-close':
      adding = false; paint(); return true;
    case 'deck-chip': {
      const key = btn.dataset['key'] ?? '';
      const value = btn.dataset['value'] ?? '';
      search = withChip(search, key, value, nextChipState(chipState(search, key, value)));
      paint();
      return true;
    }
    case 'deck-filter-clear':
      search = ''; paint(); return true;

    // ── publishing, and what the deck says about itself ──
    case 'deck-visibility':
      edit(d => { d.visibility = (btn.dataset['visibility'] ?? 'private') as DeckView['visibility']; });
      return true;
    case 'deck-desc-toggle':
      descOpen = !descOpen;
      paint();
      return true;
    case 'deck-desc-edit':
      descEditing = true;
      paint();
      return true;
    case 'deck-desc-cancel':
      descEditing = false;
      paint();
      return true;
    case 'deck-desc-save': {
      // read the box BEFORE the repaint that edit() triggers throws it away
      const box = document.getElementById('dk-desc') as HTMLTextAreaElement | null;
      const text = box?.value ?? '';
      descEditing = false;
      descOpen = false;
      edit(d => { d.description = text; });
      return true;
    }

    // ── the pinned card ──
    // The whole tile carries this, so it fires for any click that was not on
    // one of the nearer add/cut buttons (main.ts asks closest('[data-btn]')).
    case 'deck-focus':
      focus = focus === card ? null : card;
      paint();
      return true;
    case 'deck-unfocus':
      focus = null;
      paint();
      return true;
    case 'deck-browse-card':
      // "find similar" means the same thing it means in the browser, and is
      // answered by the browser: hand it a query rather than growing a second
      // similarity notion here.
      flushSave();
      cb.useDeck(bridgeToOpenDeck());
      cb.openBrowser(similarQuery(card));
      return true;

    case 'deck-browse':
      // hand the browser this deck and step aside. The deck page stays `open`,
      // so `back()` is just a repaint — and every edit the browser makes still
      // goes through edit()/scheduleSave() below, never round the side.
      flushSave();
      cb.useDeck(bridgeToOpenDeck());
      cb.openBrowser(search);
      return true;
  }
  return false;
}
