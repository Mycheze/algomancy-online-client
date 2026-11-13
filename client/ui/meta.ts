/* THE METAGAME: published decks, and one shared deck at the end of a link.
 *
 * Same contract as ui/decks.ts, ui/cards.ts and ui/account.ts, which main.ts
 * already knows how to drive: screen() says whether this page owns the app
 * element, renderScreen() paints it, handleButton() is offered every click
 * (everything here is prefixed `meta-`), and the state lives in this file.
 * The markup is pages/meta.ts (metaView / metaHtml / paintMeta, the page
 * contract); paint() hands it the state.
 *
 * TWO SCREENS, ONE MODULE, because they are one subject: a row on the list IS
 * a link to the deck view, and the deck view is what a share link opens. The
 * only thing they do not share is who may be on them — the list is `public`
 * decks, the deck view also opens for `unlisted` ones. That distinction is
 * decided on the SERVER (server/publicdecks.ts) and this file never re-derives
 * it; it asks and paints the answer.
 *
 * NOTHING HERE IS AN AGGREGATE THAT INVENTS A LIST. BL-13's standing note is
 * that a "top decks" view which reconstructs a decklist out of card play-rates
 * prints a deck nobody registered. Every row on this page is a deck whose
 * owner pressed publish, and the only thing computed about it is the record,
 * which is folded from real games.
 *
 * THE URL IS THE PAGE, the way it is for the card browser: `?meta=1` for the
 * list, `?deck=<id>` for one deck, both written with replaceState (never push
 * — one back-button step per filter click would bury the rest of the app).
 */
import * as acct from './account.ts';
import * as dk from './decks.ts';
import type { DeckGrouping } from './decklayout.ts';
import { buildDeckFile, deckFileText } from './deckformat.ts';
import { deckListText } from './deckstats.ts';
import { copyText } from './util.ts';
import * as cardstats from './cardstats.ts';
import { metaView, paintMeta } from './pages/meta.ts';
import type { StatusTone } from './components/status.ts';

/** the card art for a name (the profile's deck rows use it too) */
export { artFor } from './pages/meta.ts';

/** the shape server/publicdecks.ts sends */
export interface PublicDeck {
  id: string;
  name: string;
  cards: string[];
  /** the sideboard — part of the list, so a shared deck shows and exports it */
  sideboard?: string[];
  cover: string | null;
  author: string;
  url?: string;
  description?: string;
  visibility: 'private' | 'unlisted' | 'public';
  owner: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
  problems: string[];
  record: { games: number; wins: number; losses: number; unresolved: number; lastPlayed: string | null };
  copies: number;
  copiedFrom?: { id: string; name: string; owner: string };
}

export type Sort = 'winrate' | 'games' | 'new' | 'name';

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
/** which screen owns the page, or null for neither */
let view: 'list' | 'deck' | 'ladder' | 'stats' | null = null;
let rows: PublicDeck[] | null = null;
let minGames = 5;
let one: PublicDeck | null = null;
let wantId: string | null = null;
let loading = false;
let msg = '';
/** how `msg` reads: a result (ok), a refusal (error), a step on its way (note) — set only through say() */
let msgTone: StatusTone = 'error';
const say = (text: string, tone: StatusTone): void => { msg = text; msgTone = tone; loadMissed = false; };
/** BL-10 (docs/23-ui-inventory/02 §8.5 item 28, "the league `msg` never clears"):
 * the line is a LOAD that failed, not something the player did — so the next
 * load that works takes it away (a refusal or a result stays: say() resets this) */
let loadMissed = false;
const missed = (text: string): void => { say(text, 'error'); loadMissed = true; };
/** a load worked: a load's own failure line is no longer true */
const loaded = (): void => { if (loadMissed) { msg = ''; loadMissed = false; } };
let sort: Sort = 'winrate';
/** element filter — chips, not a query language: this page is for browsing */
const els = new Set<string>();
/** the published-deck list's search (a deck's name, builder, or a card in it) */
let text = '';
/** the card ladder's "find a card" — its own: the two boxes share an id and a
 * place on the bar, never a meaning, and a card typed on the ladder used to
 * come back on the list as a deck search (BL-63) */
let ladderText = '';
let focus: string | null = null;
/** how the shared deck's grid is split. Same vocabulary and same bucketing as
 * the builder (ui/decklayout.ts) — one deck must not look like two decks
 * depending on whose page it is on. */
let deckGroup: DeckGrouping = 'type';
/** the stats panel, folded away by default: this is a page you arrive at to
 * LOOK at a deck, and a wall of tables above the cards would bury the thing
 * you came for */
let statsOpen = false;
let descOpen = false;
/** the export panel on a SHARED deck, and which format — see ui/deckformat.ts.
 * A published deck anybody can read is a deck anybody should be able to take
 * away as a file; the builder's own page (ui/decks.ts) offers the same two. */
let exporting: 'text' | 'file' | null = null;
/** where a shared deck's Back button goes (inbox-1568909425371127962: the
 * owner opened a deck off the list and found only Home, when what he wanted
 * was the list again). 'list' — opened off the published-deck list, or cold
 * off a share link: the list is the deck's parent. 'host' — opened from a
 * profile's Published decks, which is still up underneath, so closing the
 * metagame (meta-close) puts that profile back. */
let backTo: 'list' | 'host' = 'list';
/** how far down the published-deck list was when a deck was opened off it,
 * so Back lands on the row you clicked rather than at the top */
let listTop = 0;
const LIST_SCROLL = '[data-scroll="meta-decks"]';

export const screen = (): 'meta' | null => (view ? 'meta' : null);

/**
 * Wire the page up, and take the URL seriously.
 *
 * A share link has to work on a COLD LOAD — that is the entire point of it —
 * so `?deck=` is read here and the fetch starts before anybody clicks
 * anything. `?meta=1` is the same idea for the list.
 */
export function initMeta(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  cardstats.initCardStats({ repaint: HOOKS.statsRepaint });
  const url = new URLSearchParams(location.search);
  const id = url.get('deck');
  if (id) { view = 'deck'; wantId = id; loadOne(id); }
  else if (url.has('meta')) { view = 'list'; loadList(); }
  else if (url.has('cardladder')) { view = 'ladder'; loadLadder(); }
  else if (url.has('cardstats')) {
    // `?cardstats=1` is the page; any other value is a card to open on it
    const card = url.get('cardstats');
    view = 'stats';
    cardstats.open(card && card !== '1' ? card : null);
  }
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('meta');
    url.searchParams.delete('deck');
    url.searchParams.delete('cardladder');
    url.searchParams.delete('cardstats');
    if (view === 'list') url.searchParams.set('meta', '1');
    else if (view === 'ladder') url.searchParams.set('cardladder', '1');
    else if (view === 'stats') url.searchParams.set('cardstats', cardstats.focused() ?? '1');
    else if (view === 'deck' && one) url.searchParams.set('deck', one.id);
    else if (view === 'deck' && wantId) url.searchParams.set('deck', wantId);
    history.replaceState(null, '', url.toString());
  } catch { /* file:// and the like */ }
}

const authHeaders = (): Record<string, string> => acct.authHeaders();

function loadList(): void {
  loading = true;
  fetch(`/api/deck/meta?sort=${encodeURIComponent(sort)}`)
    .then(r => r.json() as Promise<{ ok: boolean; decks?: PublicDeck[]; minGames?: number; error?: string }>)
    .then(r => {
      loading = false;
      if (r.ok && r.decks) { rows = r.decks; minGames = r.minGames ?? minGames; loaded(); }
      else missed(r.error ?? 'could not load the metagame list');
      paint();
    })
    .catch(() => { loading = false; missed('could not reach the server'); paint(); });
}

function loadOne(id: string): void {
  loading = true;
  fetch(`/api/deck/shared?id=${encodeURIComponent(id)}`)
    .then(r => r.json() as Promise<{ ok: boolean; deck?: PublicDeck; error?: string }>)
    .then(r => {
      loading = false;
      if (r.ok && r.deck) { one = r.deck; msg = ''; }
      else { one = null; say('That deck is not shared, or the link is wrong.', 'error'); }
      paint();
    })
    .catch(() => { loading = false; missed('could not reach the server'); paint(); });
}

// ── CR D8.2f: the card ladder ─────────────────────────────────────────────

/** the shape server/cardladder.ts sends, one row per card that has duelled */
export interface CardStanding {
  card: string; rating: number; games: number; wins: number; losses: number; mirrors: number;
}
let ladder: { cards: CardStanding[]; rankedAfter: number; duels: number } | null = null;

function loadLadder(): void {
  loading = true;
  fetch('/api/cardladder')
    .then(r => r.json() as Promise<{ ok: boolean; cards?: CardStanding[]; rankedAfter?: number; duels?: number }>)
    .then(r => {
      loading = false;
      if (r.ok && r.cards) { ladder = { cards: r.cards, rankedAfter: r.rankedAfter ?? 5, duels: r.duels ?? 0 }; loaded(); }
      else missed('could not load the card ladder');
      paint();
    })
    .catch(() => { loading = false; missed('could not reach the server'); paint(); });
}

export function openLadder(): void {
  view = 'ladder'; one = null; focus = null; msg = '';
  syncUrl();
  loadLadder();   // always fresh: a duel just finished is the usual reason to look
  paint();
}

/** Open the card stats tab — on one card's numbers when `card` is given
 * (the card browser's "card stats" link). */
export function openStats(card?: string | null): void {
  view = 'stats'; one = null; focus = null; msg = '';
  cardstats.open(card ?? null);   // always fresh, like the ladder
  syncUrl();
  paint();
}

// ── opening it ────────────────────────────────────────────────────────

export function openMeta(): void {
  view = 'list'; one = null; focus = null; msg = '';
  syncUrl();
  if (!rows) loadList(); else paint();
}

function openDeck(id: string): void {
  backTo = acct.screen() ? 'host' : 'list';
  listTop = view === 'list' ? (document.querySelector(LIST_SCROLL) as HTMLElement | null)?.scrollTop ?? 0 : 0;
  view = 'deck'; wantId = id; one = null; focus = null; descOpen = false; msg = ''; exporting = null;
  syncUrl();
  loadOne(id);
}

function close(): void {
  leave();
  rerenderHost();
}

/** give up the page — the state and the URL — without painting anything:
 * close() repaints Home; a copy taken to the builder has already painted it */
function leave(): void {
  view = null; one = null; focus = null;
  try {
    const url = new URL(location.href);
    url.searchParams.delete('meta');
    url.searchParams.delete('deck');
    url.searchParams.delete('cardladder');
    url.searchParams.delete('cardstats');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

// ── painting ──────────────────────────────────────────────────────────

/** The state the page is drawn from — pages/meta.ts metaView() gathers it,
 * metaHtml() draws it. */
export interface MetaState {
  view: 'list' | 'deck' | 'ladder' | 'stats' | null;
  rows: PublicDeck[] | null;
  minGames: number;
  one: PublicDeck | null;
  loading: boolean;
  msg: string;
  /** a result (ok), a refusal in red (error), a step on its way (note) */
  msgTone: StatusTone;
  sort: Sort;
  els: ReadonlySet<string>;
  /** the deck list's search */
  text: string;
  /** the card ladder's search — see `ladderText` */
  ladderText: string;
  focus: string | null;
  deckGroup: DeckGrouping;
  statsOpen: boolean;
  descOpen: boolean;
  exporting: 'text' | 'file' | null;
  /** where the shared deck's Back button goes — see `backTo` */
  backTo: 'list' | 'host';
  ladder: { cards: CardStanding[]; rankedAfter: number; duels: number } | null;
}

const state = (): MetaState => ({
  view, rows, minGames, one, loading, msg, msgTone, sort, els, text, ladderText, focus, deckGroup, statsOpen, descOpen, exporting, backTo, ladder,
});

/** Whichever export format is showing, as text. A shared deck has no
 * maybeboard — the shelf is not published — so the file simply has no `maybe`,
 * which is the same thing a deck without one exports. */
function exportBody(d: PublicDeck): string {
  return exporting === 'file'
    ? deckFileText(buildDeckFile(d, { origin: location.origin }))
    : deckListText(d.name, d.cards, { sideboard: d.sideboard ?? [], ...(d.url ? { url: d.url } : {}) });
}

const HOOKS = {
  // the box on the page belongs to whichever tab is up
  setText: (t: string): void => { if (view === 'ladder') ladderText = t; else text = t; },
  setStatsText: cardstats.setText,
  repaint: (): void => paint(),
  statsRepaint: (): void => { syncUrl(); paint(); },
};

function paint(): void {
  if (!$app || !view) return;
  paintMeta($app, metaView(state(), one && exporting ? exportBody(one) : '', cardstats.state()), HOOKS);
}

export function renderScreen(): void { paint(); }

// ── clicks ────────────────────────────────────────────────────────────

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('meta-')) return false;
  const card = btn.dataset['card'] ?? '';
  if (cardstats.handle(btn)) return true;

  switch (b) {
    case 'meta-openpage':
      openMeta();
      return true;
    case 'meta-close':
      close();
      return true;
    case 'meta-list': {
      // the deck page's Back (and the lit Published decks tab under it):
      // the list again, scrolled to where it was when the deck was opened
      const fromDeck = view === 'deck' && backTo === 'list';
      openMeta();
      const box = fromDeck && rows ? document.querySelector(LIST_SCROLL) as HTMLElement | null : null;
      if (box) box.scrollTop = listTop;
      return true;
    }
    case 'meta-ladder':   // CR D8.2f
      openLadder();
      return true;
    case 'meta-stats-open':
      openStats(btn.dataset['card'] || null);
      return true;
    case 'meta-group':
      deckGroup = (btn.dataset['group'] ?? 'type') as DeckGrouping;
      paint();
      return true;

    case 'meta-stats':
      statsOpen = !statsOpen;
      paint();
      return true;

    // ── exporting a deck somebody else published ──
    case 'meta-export':
      exporting = btn.dataset['format'] === 'file' ? 'file' : 'text';
      paint();
      return true;
    case 'meta-export-close':
      exporting = null;
      paint();
      return true;
    case 'meta-copy-export':
      // no paint(): repainting throws the selection away, which is what plain
      // http falls back to — see copyText in ui/util.ts
      if (one) copyText(exportBody(one), document.querySelector('.dkexporttext'), btn);
      return true;

    case 'meta-open':
      openDeck(btn.dataset['id'] ?? '');
      return true;
    case 'meta-sort':
      sort = (btn.dataset['sort'] ?? 'winrate') as Sort;
      // the ranking is the server's — asking again is what keeps this page
      // from growing a second opinion about what "best" means
      loadList();
      paint();
      return true;
    case 'meta-el': {
      const el = btn.dataset['el'] ?? '';
      if (els.has(el)) els.delete(el); else els.add(el);
      paint();
      return true;
    }
    case 'meta-clear':
      els.clear(); text = '';
      paint();
      return true;
    case 'meta-focus':
      focus = focus === card ? null : card;
      paint();
      return true;
    case 'meta-unfocus':
      focus = null;
      paint();
      return true;
    case 'meta-desc-toggle':
      descOpen = !descOpen;
      paint();
      return true;
    case 'meta-take': {
      if (!one) return true;
      const id = one.id;
      say('copying…', 'note');
      paint();
      void fetch('/api/decks/take', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }),
      })
        .then(r => r.json() as Promise<Parameters<typeof dk.openTaken>[0] & { error?: string }>)
        .then(r => {
          // inbox-1568909829345644666: the copy goes straight into the
          // collection's list (the reply carries it) and opens in the
          // builder, the way + New deck and Import do — this page, and a
          // profile it was opened from, step aside for it (main.ts render
          // checks the profile before the builder, so one left open would
          // take the page back on the next repaint) — Back from the builder
          // is the Decks page, and Back from that is Home
          if (r.ok && dk.openTaken(r)) { msg = ''; acct.leaveScreen(); leave(); return; }
          if (r.ok) say(`Copied into your collection${r.note ? ` — ${r.note}` : ''}. It starts private.`, 'ok');
          else say(r.error ?? 'could not copy that deck', 'error');
          paint();
        })
        .catch(() => { say('could not reach the server', 'error'); paint(); });
      return true;
    }
  }
  return false;
}
