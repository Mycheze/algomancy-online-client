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
import { buildDeckFile, deckFileText } from './deckformat.ts';
import { chooseDeck, chosenDeck, copyText, elIcon, esc } from './util.ts';
import { artUrl } from './assets.ts';

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
    if (img) return artUrl(img);
  } catch { /* not a registry card */ }
  return artUrl(name.replace(/ /g, '-') + '.jpg');
};

type Tab = 'cards' | 'mana' | 'maybe' | 'games';

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
/**
 * The export panel, and which of the two formats it is showing.
 *
 *   'text'  the card list — what you paste into a chat, into algomancer.cc,
 *           or back into the paste box here. Lossy on purpose: it is a list.
 *   'file'  the whole deck (ui/deckformat.ts) — the description, the cover,
 *           the maybeboard, who built it, where it came from.
 *
 * null is closed. Both are round-trippable through the paste box, which is
 * the property that makes them exports rather than screenshots.
 */
let exporting: 'text' | 'file' | null = null;
/** the description reads clipped until you ask for the rest — see descHtml */
let descOpen = false;
/**
 * THE THREE LAYERS OVER THE PAGE, and why they are layers.
 *
 * The Share tab is gone (owner, 2026-09-20: *"There doesn't need to be a whole
 * 'Share' tab. Instead, it should just be a settings button next to the 'Play
 * this deck' button"*). Everything that was on it — who may see the deck, the
 * link, the description — plus the three things that were scattered elsewhere
 * — duplicate, delete, and picking the cover art — now live behind one ⚙.
 *
 * They are drawn INSIDE the painted markup rather than as siblings of #app,
 * because this page repaints wholesale on every click and `alight()` already
 * knows how to put the scroll and the caret back. A layer that lived outside
 * #app would survive the paint and would then have to be told, by hand, every
 * time the deck under it changed.
 */
let settingsOpen = false;
/** the description editor, as a modal over the page */
let descEditing = false;
/** …and the "what can I write in here?" note inside it */
let syntaxOpen = false;
/**
 * WHAT IS IN THE DESCRIPTION BOX RIGHT NOW, and why it cannot live in the DOM.
 *
 * Every button on this page repaints the whole of #app, which destroys the
 * textarea and builds a new one from `d.description`. So pressing `?` inside
 * the editor threw away everything typed since the last save — reported
 * 2026-09-20: *"Clicking the ? in the deck description erases the actual text
 * that was written."* It was not the `?`; it was every repaint, and `?` was
 * simply the first button anybody pressed while the editor was open.
 *
 * The fix is that the draft is STATE, not markup: `handleButton` snapshots the
 * live box before it does anything (see `captureDraft`), and `descLayer`
 * renders from here rather than from the saved deck. null means "no editor
 * open", which is what makes an ordinary repaint elsewhere on the page leave
 * the saved description alone.
 */
let descDraft: string | null = null;
/** claim the caret for the description box on the NEXT paint only — see wire() */
let focusDesc = false;
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
             <button data-btn="deck-to-maybe" data-card="${esc(name)}" title="move one to the maybeboard">»</button>`
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
  /* ⚠ NO "use this art" HERE, AND NONE ON THE TILES EITHER. It was a ★ in the
     corner of all thirty tiles; it then moved here; the owner wanted neither
     (2026-09-20: *"The card art changer I actually DON'T want in the right
     hand panel. I want it only in the deck settings"*). Picking the deck's
     face is a once-per-deck decision and it lives with the other once-per-deck
     decisions, behind the ⚙ — where it gets a picker that shows every card at
     once instead of asking you to hunt for one and pin it. This panel is for
     the card you are thinking about, and every button on it changes the LIST. */
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
/**
 * How much of a description is shown before "read more".
 *
 * `clipDescription`'s own default is 220 characters, which is the metagame
 * list's budget — one line under a row. Here it is the top of the page you
 * build on, and 220 showed *"part of a single line"* (owner, 2026-09-20)
 * rather than a paragraph. 900 is about a screenful of prose on a laptop: long
 * enough that a normal primer's opening section is simply THERE, short enough
 * that a card-by-card write-up still gets a "read more" instead of pushing the
 * card grid off the bottom of the window.
 */
const DESC_BUDGET = 600;

function descHtml(d: DeckView): string {
  const src = d.description ?? '';
  if (!src.trim()) {
    // an empty description is not nothing: it is the one prompt that leads
    // somebody to write one, and it is now the only route to the editor that
    // does not go through the ⚙
    return `<div class="deckdesc empty">
      <button class="cblink" data-btn="deck-desc-edit">+ describe this deck</button>
      <span class="hint">what it is trying to do, what you keep, what beats it</span>
    </div>`;
  }
  const { text, clipped } = descOpen
    ? { text: src, clipped: false }
    : clipDescription(src, DESC_BUDGET);
  return `<div class="deckdesc${descOpen ? ' on' : ''}">
    <div class="deckdescbody">${mdToHtml(text, { inline: cardLinker({ focusBtn: 'deck-focus', art: true }) })}</div>
    <div class="deckdescfoot">
      ${clipped || descOpen
        ? `<button class="cblink" data-btn="deck-desc-toggle">${descOpen ? 'show less' : 'read more'}</button>`
        : ''}
      <button class="cblink" data-btn="deck-desc-edit">edit</button>
    </div>
  </div>`;
}

/**
 * THE ⚙ — everything about a deck that is not a card in it.
 *
 * This is the Share tab, plus the three buttons that used to be somewhere
 * else. The owner's own grouping, 2026-09-20: *"that settings/more menu can
 * also be where the Dupe or Delete buttons are and where the 'Choose deck art'
 * button is. Then it also has the share settings"*.
 *
 * WHY THE SHARE CONTROLS STILL SIT TOGETHER inside it. Visibility without a
 * link is a setting nobody can act on, and a link to a private deck is a dead
 * link — the two are one decision and are still drawn as one. What changed is
 * that the decision no longer costs a tab on a page you are using to build.
 */
function settingsLayer(d: DeckView): string {
  if (!settingsOpen) return '';
  const vis = visibilityOf(d);
  const link = shareLink(d);
  return `<div class="dkmodal" data-btn="deck-settings-close">
    <div class="dkmodalbox" data-btn="deck-stop">
      <div class="dkmodalhead">
        <h2>Deck settings</h2>
        <button class="dkicon" data-btn="deck-settings-close" title="close" aria-label="close">✕</button>
      </div>

      <h3>Name</h3>
      <input id="dk-name2" class="deckname" maxlength="60" value="${esc(d.name)}"
        aria-label="deck name" spellcheck="false">

      ${/* THREE WORDS, NOT THREE PARAGRAPHS. This was three cards carrying a
           sentence each — owner, 2026-09-20: *"Assume people know what that
           means rather than using 250 words to write it out."* The words are
           the standard ones and they mean the standard things; the tooltip
           holds the one clarification anybody actually needs. */ ''}
      <h3>Who can see it</h3>
      <div class="dkvisrow">
        <button class="dkvisb${vis === 'private' ? ' on' : ''}" data-btn="deck-visibility"
          data-visibility="private" title="only you">Private</button>
        <button class="dkvisb${vis === 'unlisted' ? ' on' : ''}" data-btn="deck-visibility"
          data-visibility="unlisted" title="anybody with the link; not listed anywhere">Unlisted</button>
        <button class="dkvisb${vis === 'public' ? ' on' : ''}" data-btn="deck-visibility"
          data-visibility="public" title="the link, your profile, and the metagame list">Public</button>
      </div>
      ${/* The link is ALWAYS here. It used to appear only once the deck was
           shared, which meant the copy button did not exist on any deck that
           had not been published yet — including all five starters, which is
           every deck a new account has: *"I don't see a copy link button
           anywhere."* Showing it while private, dimmed and labelled, is both
           honest and discoverable. */ ''}
      <div class="sharebar${vis === 'private' ? ' off' : ''}">
        <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
        <button class="dkicon" data-btn="copylink" data-link="${esc(link)}"
          title="copy the share link" aria-label="copy the share link">🔗</button>
      </div>
      ${vis === 'private'
        ? '<p class="hint">That link will not open for anybody else while this deck is private.</p>'
        : ''}

      <h3>Deck art</h3>
      ${coverPickerHtml(d)}

      <h3>Description</h3>
      <div class="dkmodalacts">
        <button data-btn="deck-desc-edit">${d.description?.trim() ? 'Edit it' : 'Write one'}</button>
      </div>

      <h3>Export</h3>
      <div class="dkmodalacts">
        <button data-btn="deck-export" data-format="text">As a card list</button>
        <button data-btn="deck-export" data-format="file">As a deck file (JSON)</button>
      </div>

      <h3>This deck</h3>
      <div class="dkmodalacts">
        <button data-btn="deck-duplicate">Duplicate it</button>
        ${confirmDelete === d.id
          ? `<button class="dkdanger" data-btn="deck-delete-yes">Delete “${esc(d.name)}” for good</button>
             <button data-btn="deck-delete-no">keep it</button>`
          : `<button class="dkdanger" data-btn="deck-delete">Delete it</button>`}
      </div>
    </div>
  </div>`;
}

/**
 * Which card's art the deck wears — every candidate at once.
 *
 * The distinct cards of the deck, as a grid you click. Two copies of a card is
 * one choice, so the grid is `a.copies` rather than the list, and a 30-card
 * deck is typically 20-odd tiles: small enough to show whole, which is the
 * point — the previous versions all made you go and FIND the card first
 * (hunt the tile for a ★, or pin it and use the side panel), which is a
 * strange way to ask "what should this look like".
 *
 * "Random from deck" is the owner's, and it is genuinely useful on a deck you
 * have just imported and have no opinion about yet.
 */
function coverPickerHtml(d: DeckView): string {
  const names = analyzeDeck(d.cards).copies
    .sort((x, y) => (y.facts?.mana ?? 0) - (x.facts?.mana ?? 0) || x.name.localeCompare(y.name))
    .map(c => c.name);
  if (!names.length) return '<p class="hint">Put some cards in it first.</p>';
  return `<div class="dkcoverbar">
      <button data-btn="deck-cover-random">🎲 Random from deck</button>
      <span class="hint">${d.cover ? `wearing <b>${esc(d.cover)}</b>` : 'nothing picked yet'}</span>
    </div>
    <div class="dkcovergrid">${names.map(n =>
      `<button class="dkcovertile${n === d.cover ? ' on' : ''}" data-btn="deck-cover"
        data-card="${esc(n)}" title="${esc(n)}">
        <img src="${esc(art(n))}" alt="${esc(n)}" loading="lazy"
          onerror="this.style.visibility='hidden'">
      </button>`).join('')}</div>`;
}

/**
 * The description editor, as a modal.
 *
 * The formatting rules used to be three lines of hint text above the box,
 * permanently, for a thing most people write once. They are now behind a `?`
 * (owner: *"make that a sorta ? thing to click on for 'Description Syntax' and
 * write out how it processes the description there, as additional info"*), and
 * saying it in one place let it say MORE than the three lines did — the
 * auto-linking rule is the part nobody could have guessed.
 */
function descLayer(d: DeckView): string {
  if (!descEditing) return '';
  return `<div class="dkmodal" data-btn="deck-desc-cancel">
    <div class="dkmodalbox wide" data-btn="deck-stop">
      <div class="dkmodalhead">
        <h2>${esc(d.name)} — description</h2>
        <button class="dkicon${syntaxOpen ? ' on' : ''}" data-btn="deck-desc-syntax"
          title="Description syntax" aria-label="Description syntax">?</button>
        <button class="dkicon" data-btn="deck-desc-cancel" title="close" aria-label="close">✕</button>
      </div>
      ${syntaxOpen ? syntaxHtml() : ''}
      ${/* FROM THE DRAFT, NEVER FROM THE SAVED DECK — see `descDraft`. Rendering
           `d.description` here is what made `?` erase everything typed. */ ''}
      <textarea id="dk-desc" class="dkdesctext" rows="18"
        placeholder="What is the deck trying to do? What do you keep? What beats it?"
        maxlength="6000">${esc(descDraft ?? d.description ?? '')}</textarea>
      <div class="dkaddrow">
        <button class="primary" data-btn="deck-desc-save">Save</button>
        <button data-btn="deck-desc-cancel">Cancel</button>
        <span class="hint">6000 characters, markdown, card names link themselves</span>
      </div>
    </div>
  </div>`;
}

/** What the `?` opens: how this client reads a description. Everything here is
 * a statement about ui/markdown.ts and ui/cardlinks.ts, and is true because
 * those two files are what render it. */
function syntaxHtml(): string {
  return `<div class="dksyntax">
    <h3>Description syntax</h3>
    <p>A description is <b>markdown</b>, and a deliberately small dialect of it — the renderer
      emits a closed set of tags and no attributes at all, which is what makes it safe to show
      your text on somebody else’s screen.</p>
    <table class="accttable">
      <thead><tr><th>write</th><th>get</th></tr></thead>
      <tbody>
        <tr><td><code>## A heading</code></td><td>a heading (<code>#</code> through <code>###</code>)</td></tr>
        <tr><td><code>**bold**</code> · <code>*italic*</code></td><td><b>bold</b> · <i>italic</i></td></tr>
        <tr><td><code>- a list item</code></td><td>a bulleted list</td></tr>
        <tr><td><code>1. a step</code></td><td>a numbered list</td></tr>
        <tr><td><code>&gt; a quote</code></td><td>an indented quote</td></tr>
        <tr><td><code>\`code\`</code></td><td>a monospaced run</td></tr>
        <tr><td>a blank line</td><td>a new paragraph</td></tr>
      </tbody>
    </table>
    <h3>Card names link themselves</h3>
    <p>Write a card’s name as it is printed — <code>Ignis Sprite</code> — and it becomes a link
      that shows the card when a reader hovers it, and pins it when they click. You do not mark it
      up; the client finds it.</p>
    <p>Two things that follow from that, and surprise people:</p>
    <ul>
      <li><b>Case matters.</b> “we fight early” is prose; <code>Fight</code> is the card.</li>
      <li><b>One-word names that are also rules words do not auto-link</b> — Battle, Trash, Graft
        and the rest. A strategy primer says those words constantly and a page full of links is
        unreadable.</li>
    </ul>
    <p>To link one of those anyway, or to name a card in your own words, write
      <code>[the two-drop](Ignis Sprite)</code> — any text, any card the client knows.</p>
    <p class="hint">Links are the only thing the renderer makes for you: a URL you paste stays
      plain text on purpose.</p>
  </div>`;
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
      <summary>…or paste a list, or a deck file</summary>
      <textarea id="dk-text" rows="5" spellcheck="false"
        placeholder="2 Ignis Sprite&#10;2 Rune Channeler&#10;…&#10;&#10;…or paste a whole deck file (JSON)"></textarea>
      <button data-btn="deck-import-text">Import it</button>
      <div class="hint">A card list one per line, or a deck file exported from here or from
        algomancer.cc — a deck file brings the description, the cover card and the maybeboard
        with it.</div>
    </details>
    ${importMsg ? `<div class="deckmsg">${esc(importMsg)}</div>` : ''}
    <button data-btn="deck-import-close">cancel</button>
  </div>`;
}

/** Whichever format the export panel is showing, as text. Named once: the
 * panel renders it and the copy and download buttons re-derive it, and three
 * copies of the same conditional is how a "copy" button ends up copying the
 * format you are not looking at. */
function exportBody(d: DeckView): string {
  return exporting === 'file'
    ? deckFileText(buildDeckFile(d, { origin: location.origin }))
    : deckListText(d.name, d.cards, d.maybe, d.url);
}

/** Hand the browser a file. An object URL rather than a `data:` one because a
 * 30-card deck file with a long description is bigger than some browsers will
 * accept in a URL, and revoking it is what keeps the blob from leaking. */
function downloadText(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * What this deck exports as, in both formats — see the `exporting` state.
 *
 * The text is built here and the file is built here, from the LOCAL copy of
 * the deck, which matters: the page edits locally and saves behind you (see
 * the header), so an export assembled from the server's answer would be one
 * click out of date every time. Both go into the same readonly textarea,
 * because plain http has no clipboard API and selecting the box is what
 * copying falls back to (util.ts's copyText).
 */
function exportLayer(d: DeckView): string {
  if (!exporting) return '';
  const file = exporting === 'file';
  const body = exportBody(d);
  const downloadName = `${d.name.replace(/[^\w. -]+/g, '').trim() || 'deck'}${file ? '.json' : '.txt'}`;
  return `<div class="dkmodal" data-btn="deck-export-close">
   <div class="dkmodalbox wide" data-btn="deck-stop">
    <div class="dkmodalhead">
      <h2>Export ${esc(d.name)}</h2>
      <button class="dkicon" data-btn="deck-export-close" title="close" aria-label="close">✕</button>
    </div>
    <div class="dkexport">
    <div class="dktoolbar">
      <button class="dkkind${file ? '' : ' on'}" data-btn="deck-export" data-format="text"
        title="just the card list">card list</button>
      <button class="dkkind${file ? ' on' : ''}" data-btn="deck-export" data-format="file"
        title="the whole deck: description, cover, maybeboard, attribution">whole deck (JSON)</button>
      <span class="dkfilterspacer"></span>
      <button data-btn="deck-copy-list">copy</button>
      <button data-btn="deck-download" data-name="${esc(downloadName)}">download</button>
      <button data-btn="deck-export-close">close</button>
    </div>
    <div class="hint">${file
      ? `Everything this deck is — the description, the cover card, the maybeboard, who built it
         and where it came from. Paste it back into the import box here, keep it as a backup, or
         hand it to anything else that reads the Algomancy deck format.`
      : `One line per card, the format the paste box reads and the one algomancer.cc understands.
         The description and the cover are <b>not</b> in it — switch to the JSON for those.`}</div>
    <textarea class="dkexporttext" rows="${file ? 16 : 10}" readonly
      onclick="this.select()">${esc(body)}</textarea>
    </div>
   </div>
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
  ] as [Tab, string][]).map(([t, label]) =>
    `<button class="accttab ${tab === t ? 'on' : ''}" data-btn="deck-tab" data-tab="${t}">${label}</button>`).join('');

  return `<div class="deckhero">
      <div class="deckcover">${d.cover
        ? `<img src="${esc(art(d.cover))}" alt="${esc(d.cover)}" onerror="this.style.visibility='hidden'">`
        : '<span class="hint">no art yet — pick one under ⚙</span>'}</div>
      <div class="deckheroinfo">
        <input id="dk-name" class="deckname" maxlength="60" value="${esc(d.name)}"
          aria-label="deck name" spellcheck="false">
        <div class="deckfacts">${a.total} cards · ${a.units} unit${a.units === 1 ? '' : 's'} /
          ${a.spells + a.spellUnits} spell${a.spells + a.spellUnits === 1 ? '' : 's'} ·
          avg ${a.avgMana.toFixed(1)} mana ${elChips(a)}</div>
        ${/* ONLY THE BAD NEWS. "✓ legal — 30 minimum, max 2 of a card" used to
             sit here on every legal deck, and the strip below the tabs says
             `legal` about the same deck three inches lower — owner,
             2026-09-20: *"It's redundant since 'legal' is also printed down
             below"*. What is NOT redundant is why a deck cannot be played:
             the strip has room for one problem, this has room for all of
             them, and it is the line the ▶ button's disabled state points at. */ ''}
        ${a.legal ? '' : `<div class="deckstatus bad">${esc(trouble.join(' · ') || 'not legal yet')}</div>`}
        <div class="deckrecline">${recordLine(d.record)}${
          d.author && d.author !== 'you' ? ` <span class="dim">· built by ${esc(d.author)}</span>` : ''}${
          d.url ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">algomancer.cc</a>` : ''}</div>
        ${/* the description belongs in the details box, beside the record and
             the attribution, rather than under the tabs — owner, 2026-09-20 */ ''}
        ${descHtml(d)}
      </div>
      ${/* The action column, on the side rather than under the facts, and icons
           rather than words (owner, 2026-09-20). Duplicate and Delete are not
           here at all any more — they are two of the six things behind the ⚙,
           because neither is something you reach for while building. */ ''}
      <div class="deckacts">
        <button class="dkicon play${isChosen ? ' on' : ''}" data-btn="deck-play" ${a.legal ? '' : 'disabled'}
          title="${isChosen ? 'this is the deck you are bringing' : a.legal
            ? 'bring this deck to your next constructed game' : 'not legal yet — see the line on the left'}"
          aria-label="${isChosen ? 'bringing this deck' : 'play this deck'}">${isChosen ? '✓' : '▶'}</button>
        <button class="dkicon" data-btn="deck-settings"
          title="deck settings — art, sharing, the description, duplicate, delete"
          aria-label="deck settings">⚙</button>
      </div>
    </div>
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
              <span class="hint">click a card to pin it · − cuts a copy · + adds one · » sends one to the maybeboard</span>
            </div>
            ${groupedTiles(a, d.cover, 'deck')}
            ${addDrawerHtml()}
           </div>
           ${focusHtml()}
          </div>
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
      : gamesTab(d)}</div>`
    + settingsLayer(d)
    + descLayer(d)
    + exportLayer(d);
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
        <button class="primary" data-btn="deck-close">Return to Lobby</button>
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

/**
 * Take whatever is in the description box into `descDraft`.
 *
 * Called at the top of every button, before anything can repaint. A no-op
 * unless the editor is open, and a no-op if the box is not in the document —
 * which it is not on the paint that first opens the editor.
 */
function captureDraft(): void {
  if (!descEditing) return;
  const box = document.getElementById('dk-desc') as HTMLTextAreaElement | null;
  if (box) descDraft = box.value;
}

/** the live inputs — they must not repaint the page under the cursor */
function wire(was: Perch | null): void {
  /** the name box, wherever it is: the hero has one and the ⚙ has one, and
   * they are the same field with two views of it */
  const renameFrom = (input: HTMLInputElement): void => {
    const d = current();
    if (!d) return;
    d.name = input.value;
    // every label that shows the name follows WITHOUT a repaint, so the caret
    // stays put: the rail row, and the other box if both are on screen
    const label = document.querySelector(`.deckrow.on .deckrowname`);
    if (label) label.textContent = input.value;
    for (const other of document.querySelectorAll<HTMLInputElement>('.deckname')) {
      if (other !== input) other.value = input.value;
    }
    scheduleSave(d.id);
  };
  for (const input of document.querySelectorAll<HTMLInputElement>('.deckname')) {
    input.addEventListener('input', () => renameFrom(input));
  }

  // the description box: typed into, never repainted from the DOM
  const desc = document.getElementById('dk-desc') as HTMLTextAreaElement | null;
  desc?.addEventListener('input', () => { descDraft = desc.value; });

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
  // …and the same for the description editor: the click that opened it claims
  // the caret, and NO later repaint does — a re-focus on every paint is the
  // 537px jump the Perch header is about, with the added cost here that it
  // would drag the caret to the end of the text mid-sentence.
  if (focusDesc && desc) {
    focusDesc = false;
    desc.focus();
    desc.selectionStart = desc.selectionEnd = desc.value.length;
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
  // ⚠ BEFORE ANYTHING ELSE. Almost every branch below repaints, and a repaint
  // rebuilds the description textarea from state — so whatever is in the live
  // box has to become state first, or it is gone. See `descDraft`.
  captureDraft();

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
      tab = 'cards'; confirmDelete = null; adding = false; exporting = null; msg = '';
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
    case 'deck-stop':
      return true;   // a click inside a modal box is not a click outside it

    // ── the add drawer ──
    // ── exporting ──
    // one button opens the panel and both format chips re-enter here, which is
    // why the format comes off the button rather than being toggled
    case 'deck-export':
      exporting = btn.dataset['format'] === 'file' ? 'file' : 'text';
      settingsOpen = false;
      paint();
      return true;
    case 'deck-export-close':
      exporting = null; paint(); return true;
    case 'deck-copy-list': {
      const d = current();
      if (!d) return true;
      // The textarea is right there and is what plain http copies FROM, so it
      // is handed over as the selection. No paint(): repainting here is what
      // used to throw the selection away — see copyText in ui/util.ts.
      copyText(exportBody(d), document.querySelector('.dkexporttext'), btn);
      return true;
    }
    case 'deck-download': {
      const d = current();
      if (!d) return true;
      downloadText(btn.dataset['name'] ?? 'deck.txt', exportBody(d));
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

    // ── the ⚙, and what the deck says about itself ──
    case 'deck-settings':
      settingsOpen = true; confirmDelete = null; exporting = null; paint(); return true;
    case 'deck-settings-close':
      // the backdrop carries this too, so a click anywhere outside the box
      // closes it — and `data-stop` on the box is what stops the box's own
      // background from counting as "outside" (main.ts asks closest())
      settingsOpen = false; confirmDelete = null; paint(); return true;

    case 'deck-visibility':
      edit(d => { d.visibility = (btn.dataset['visibility'] ?? 'private') as DeckView['visibility']; });
      return true;
    case 'deck-cover-random': {
      // a card the deck actually plays, chosen from the DISTINCT cards so a
      // four-of is not four times as likely to be the face
      const d = current();
      if (!d?.cards.length) return true;
      const names = [...new Set(d.cards)];
      const pick = names[Math.floor(Math.random() * names.length)]!;
      edit(x => { x.cover = pick; });
      return true;
    }
    case 'deck-desc-toggle':
      descOpen = !descOpen;
      paint();
      return true;
    case 'deck-desc-edit':
      // opening the editor closes the ⚙ behind it: two stacked modals is two
      // backdrops, and the top one's "click outside to close" would land on
      // the one below
      descEditing = true; settingsOpen = false; syntaxOpen = false;
      descDraft = current()?.description ?? '';
      focusDesc = true;
      paint();
      return true;
    case 'deck-desc-syntax':
      // `captureDraft()` at the top of this function already put the box's
      // contents somewhere the repaint cannot destroy them
      syntaxOpen = !syntaxOpen;
      paint();
      return true;
    case 'deck-desc-cancel':
      descEditing = false; syntaxOpen = false; descDraft = null;
      paint();
      return true;
    case 'deck-desc-save': {
      const text = descDraft ?? '';
      descEditing = false; syntaxOpen = false; descDraft = null;
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
