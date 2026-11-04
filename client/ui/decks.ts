/* The deck collection: the Decks page, and the host that lends a deck to the builder.
 *
 * Same contract as ui/account.ts, which main.ts already knows how to drive:
 * screen() says whether this page owns the app element, renderScreen() paints
 * it, handleButton() is offered every click first (everything here is prefixed
 * `deck-`), and the collection itself — the fetches, the pending edit, the
 * open deck — lives in this file and nowhere else.
 *
 * THE PAGE (BL-65, 2026-11-04) is drawn by pages/decks.ts: a shelf of deck
 * boxes, the chosen deck's preview beside it, and every action a button that
 * opens a side sheet (Import, Share, Export, Delete, Games, a card). The deck
 * page that was here — five tabs, a tile grid with − + » SB on every card, an
 * add drawer and four modals — is gone; its editing moved to the builder.
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
 *     pill and the "not legal yet" line all move on the same click that made
 *     them true, with no round trip in between;
 *   - `record` is the one field only the server can know, and it does not
 *     change while you edit, so it survives the local copy untouched.
 *
 * THE BUILDER (ui/tabletop.ts) is where a deck is edited. This file lends it
 * the open deck as a TableHost (`tabletopHost`): every edit the table makes
 * comes back through `edit()`, and its arrangement rides the same debounced
 * save as `piles`. The host also gives the builder its count pill, its Deck
 * info button and the Deck info sheet (name, cover, description, who can see
 * it). The Decks page stays `open` underneath and paints nothing while the
 * table is up.
 */
import * as cb from './cards.ts';
import * as acct from './account.ts';
import { analyzeDeck, deckListText } from './deckstats.ts';
import { buildDeckFile, deckFileText } from './deckformat.ts';
import { deckStatsHtml } from './pages/deckstats.ts';
import {
  DECK_SORTS, deckInfoButtonHtml, deckInfoHtml, deckInfoView, deckPill, decksView, paintDecks,
  type DeckSort, type DecksStateSheet,
} from './pages/decks.ts';
import { chooseDeck, chosenDeck, copyText } from './util.ts';
import * as tt from './tabletop.ts';
import type { DeckPile } from './deckarrange.ts';
import { MATCH_COPY_CAP, SIDEBOARD_MAX, checkMatchDeck, type MatchConfig } from '../engine/src/matchdeck.ts';

// ── the shapes the server sends (server/collection.ts) ────────────────

export interface DeckRecord {
  games: number; wins: number; losses: number; unresolved: number; lastPlayed: string | null;
}

export interface DeckView {
  id: string;
  name: string;
  cards: string[];
  maybe: string[];
  /** THE SIDEBOARD (docs/22 §4.3): up to 7 cards swapped with `cards` between
   * the games of a Competitive Constructed match. The server always sends it;
   * read through `sideOf`, which is also right for a reply that predates it */
  sideboard?: string[];
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
  /** the tabletop's piles (ui/deckarrange.ts) — NEVER what is in the deck.
   * Absent = never arranged: the tabletop seeds piles by cost on open */
  piles?: DeckPile[];
  createdAt: string;
  updatedAt: string;
  /** the server's own legality read — this page recomputes it locally instead
   * (see the header), and keeps this only for the first paint after a load */
  problems: string[];
  /** the server's Competitive Constructed read — recomputed here, as above */
  ccProblems?: string[];
  record: DeckRecord;
}

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let decks: DeckView[] | null = null;
let loading = false;
let openId: string | null = null;
/** the shelf bar's note: a refusal, a save's or an import's answer */
let msg = '';
/** the shelf's order — kept in this browser (`algoDeckSort`) */
const SORT_KEY = 'algoDeckSort';
let sort: DeckSort = readSort();
/** the description reads clipped until you ask for the rest */
let descOpen = false;
/** the Decks page's open sheet (one at a time) */
let pageSheet: DecksStateSheet | null = null;
/** the builder's Deck info sheet */
let infoOpen = false;
/** the description editor inside it, and the "what can I write?" note */
let descEditing = false;
let syntaxOpen = false;
/**
 * WHAT IS IN THE DESCRIPTION BOX RIGHT NOW, and why it cannot live in the DOM.
 *
 * Every repaint rebuilds the textarea from state, so whatever was typed since
 * the last save is gone unless it is state — reported 2026-09-20: *"Clicking
 * the ? in the deck description erases the actual text that was written."*
 * So the draft is STATE: the box's `input` keeps it here (ensureListeners) and
 * `handleButton` snapshots the live box before it does anything
 * (`captureDraft`). null means "no editor open".
 */
let descDraft: string | null = null;
/** the builder's note for an import, until the next edit (TableHost.note) */
let hostNote: string | null = null;

function readSort(): DeckSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return (DECK_SORTS as readonly string[]).includes(v ?? '') ? v as DeckSort : 'recent';
  } catch { return 'recent'; }
}

export const screen = (): 'decks' | null => (open ? 'decks' : null);

/** Wire the page up. `rerender` repaints the home screen when this closes. */
export function initDecks(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  ensureListeners();
}

const current = (): DeckView | null => decks?.find(d => d.id === openId) ?? null;

/** a deck's sideboard: absent (a deck saved before there was one) is empty */
const sideOf = (d: DeckView): string[] => d.sideboard ?? [];
const boardsOf = (d: DeckView): MatchConfig => ({ main: d.cards, side: sideOf(d) });

/**
 * THE COPY CAP ACROSS BOTH BOARDS (docs/22 §4.1), as a refusal: the reason a
 * move may not happen, or null. A move that raises a card above two copies
 * counted over the deck AND the sideboard is refused when the sideboard holds
 * that card — moving a copy between the boards never changes the count, so
 * it is never refused. A third copy in the deck alone is NOT refused here:
 * that stays what it always was, an affordance (the `+` goes at two) and a
 * red ×3, because a saved deck may be illegal while you build.
 */
export function crossCapRefusal(before: MatchConfig, after: MatchConfig): string | null {
  const tally = (b: MatchConfig): Map<string, number> => {
    const m = new Map<string, number>();
    for (const n of [...b.main, ...b.side]) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const was = tally(before);
  for (const [n, c] of tally(after)) {
    if (c > MATCH_COPY_CAP && c > (was.get(n) ?? 0) && after.side.includes(n)) {
      return `Max ${MATCH_COPY_CAP} of ${n} across the deck and sideboard.`;
    }
  }
  return null;
}

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
    // keep our own cards/name — and our own PILES: a drop on the tabletop is
    // an edit like any other, and a reply to an older save must not put the
    // card back where it was — and take the fields only the server knows
    // — while the server's list says which decks there ARE: a deck just made
    // or imported is in it and not here yet, and it must be, because the
    // builder opens on it at once (BL-65; the old page showed "Pick a deck")
    const mine = new Map(decks.map(d => [d.id, d]));
    decks = reply.decks.map(server => {
      const d = mine.get(server.id);
      return d ? { ...d, record: server.record } : server;
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
      // a reload on `?table=<id>` asked for the table before the decks were here
      const want = pendingTable;
      pendingTable = null;
      const host = want ? tabletopHostFor(want) : null;
      if (host) tt.openTabletop(host);
      then();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; then(); });
}

/** Forget everything (logging out). */
export function resetCollection(): void {
  decks = null; openId = null; open = false; msg = ''; pendingTable = null;
}

/** The legal decks in the collection, for the home screen's picker. */
export function playableDecks(): { id: string; name: string; author: string; url?: string; cards: string[] }[] {
  return (decks ?? [])
    .filter(d => analyzeDeck(d.cards).legal)
    .map(d => ({ id: d.id, name: d.name, author: d.author, ...(d.url ? { url: d.url } : {}), cards: d.cards }));
}

/** Every deck in the collection with its Competitive Constructed verdict
 * (checkMatchDeck, as the CC chip), for the Competitive card's picker
 * (ui/match.ts) — which lists an illegal deck greyed, with this reason.
 * Null until the collection has loaded. */
export function competitiveDecks(): { id: string; name: string; error: string | null }[] | null {
  if (!decks) return null;
  return decks.map(d => {
    const c = checkMatchDeck(d.cards, sideOf(d));
    return { id: d.id, name: d.name, error: c.ok ? null : c.error };
  });
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
    // the tabletop's arrangement, the same way — null clears it on the server,
    // which clamps it to `cards` either way (an add here leaves a deficit the
    // table reconciles on open; a cut, a surplus the server trims)
    piles: deck.piles ?? null,
    // the sideboard rides along like the maybeboard
    sideboard: sideOf(deck),
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

// deckStatsHtml lives in pages/deckstats.ts since BL-65 (the builder's Stats sheet draws it too);
// re-exported for the shared deck page (pages/meta.ts), which imports it from here
export { deckStatsHtml };

// ── exporting ─────────────────────────────────────────────────────────

/**
 * What this deck exports as, in the Export sheet's format.
 *
 *   'text'  the card list — what you paste into a chat, into algomancer.cc,
 *           or back into the paste box here. Lossy on purpose: it is a list.
 *   'file'  the whole deck (ui/deckformat.ts) — the description, the cover,
 *           the maybeboard, who built it, where it came from.
 *
 * Built from the LOCAL copy: the page edits locally and saves behind you, so
 * an export assembled from the server's answer would be a click out of date.
 * Named once — the sheet shows it and the copy and download buttons re-derive
 * it — because three copies of one conditional is how a "copy" button ends up
 * copying the format you are not looking at.
 */
function exportBody(d: DeckView): string {
  const file = pageSheet?.kind === 'export' && pageSheet.format === 'file';
  return file
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

// ── the page ──────────────────────────────────────────────────────────

/** where a share link points: this page, with `?deck=` */
const base = (): string => {
  try { return `${location.origin}${location.pathname}`; } catch { return ''; }
};

/** Everything the Decks page shows, for pages/decks.ts decksView. */
function snapshot(): Parameters<typeof decksView>[0] {
  const d = current();
  return {
    signedIn: !!acct.token(),
    loading,
    decks,
    openId,
    sort,
    msg,
    descOpen,
    chosenId: chosenDeck()?.id ?? null,
    sheet: pageSheet,
    history: acct.currentUser()?.history ?? [],
    base: base(),
    exportBody: d && pageSheet?.kind === 'export' ? exportBody(d) : '',
  };
}

function paint(): void {
  if (!$app) return;
  // THE CARD BROWSER CAN BE OPEN ON TOP OF THIS PAGE (it stays `open` under
  // it, so Back is a repaint): painting here would be a second write per
  // click, and the wrong one (test/189).
  if (cb.screen()) return;
  // …AND THE BUILDER, for the same reason: every drop goes through edit(),
  // and the table repaints itself (tt.tabletopChanged).
  if (tt.screen()) return;
  paintDecks($app, decksView(snapshot()));
}

/** repaint whichever of the two is up: the builder (its host's sheet changed) or the Decks page */
function repaint(): void {
  if (tt.screen()) tt.tabletopChanged(); else paint();
}

/**
 * Take whatever is in the description box into `descDraft`.
 *
 * Called at the top of every button, before anything can repaint. A no-op
 * unless the editor is open, and a no-op if the box is not in the document.
 */
function captureDraft(): void {
  if (!descEditing || typeof document === 'undefined') return;
  const box = document.getElementById('dk-desc') as HTMLTextAreaElement | null;
  if (box && typeof box.value === 'string') descDraft = box.value;
}

let listening = false;
/** The live boxes, once for the document: they must not repaint under the cursor. */
function ensureListeners(): void {
  if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  listening = true;
  document.addEventListener('input', e => {
    const box = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!box?.id) return;
    if (box.id === 'dk-desc') { descDraft = box.value; return; }
    if (box.id !== 'dk-name') return;
    const d = current();
    if (!d) return;
    d.name = box.value;
    // the builder's title follows without a repaint, so the caret stays put
    const title = document.querySelector?.('.tttitlebtn');
    if (title?.firstChild?.nodeType === 3) title.firstChild.nodeValue = `${box.value} `;
    scheduleSave(d.id);
  });
  // Esc closes the open sheet. The builder's own sheets and its pick take Esc
  // first (tabletop.ts listens in the capture phase and stops it)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !open) return;
    if (tt.screen()) {
      if (!infoOpen) return;
      closeInfo();
      tt.tabletopChanged();
      return;
    }
    if (!pageSheet) return;
    pageSheet = null;
    paint();
  });
}

export function renderScreen(): void {
  ensureCollection(paint);
  paint();
}

// ── edits ─────────────────────────────────────────────────────────────

/** Change the open deck, then save. Every edit goes through here so nothing
 * can edit without scheduling the save. `quiet`: the caller repaints. */
function edit(fn: (d: DeckView) => void, quiet = false): void {
  const d = current();
  if (!d) return;
  fn(d);
  d.updatedAt = new Date().toISOString();
  scheduleSave(d.id);
  if (!quiet) repaint();
}

/** Deck info down, and its editor with it */
function closeInfo(): void { infoOpen = false; descEditing = false; syntaxOpen = false; descDraft = null; }

/** a `?table=<id>` reload that arrived before the collection did */
let pendingTable: string | null = null;

/**
 * THE BUILDER'S HOST — deck `id`, lent to ui/tabletop.ts.
 *
 * `commit` is `edit()`: the file's one funnel into `scheduleSave()`, so the
 * table can only reach the deck the way a button here does. It edits the OPEN
 * deck, which is why the host is only ever made by `tabletopHostFor`, which
 * opens this one first.
 */
function tabletopHost(id: string): tt.TableHost {
  const deck = (): DeckView | null => decks?.find(d => d.id === id) ?? null;
  return {
    kind: 'deck',
    key: id,
    title: () => deck()?.name ?? 'this deck',
    backLabel: 'Decks',
    cards: () => deck()?.cards ?? [],
    maybe: () => deck()?.maybe ?? [],
    side: () => { const d = deck(); return d ? sideOf(d) : []; },
    sideMax: SIDEBOARD_MAX,
    // the cap across both boards: the table shows the reason it refused
    refuse: next => {
      const d = deck();
      return d ? crossCapRefusal(boardsOf(d), { main: next.cards ?? d.cards, side: next.sideboard ?? sideOf(d) }) : null;
    },
    piles: () => deck()?.piles ?? null,
    cover: () => deck()?.cover ?? null,
    cap: MATCH_COPY_CAP,
    pool: true,
    pill: () => deckPill(deck() ?? { id, name: '', cards: [], cover: null }),
    titleBtn: 'deck-settings',
    toolsHtml: () => deckInfoButtonHtml(infoOpen),
    sheetHtml: () => {
      const d = deck();
      return infoOpen && d ? deckInfoHtml(deckInfoView(d, { editing: descEditing, draft: descDraft, syntax: syntaxOpen, base: base() })) : '';
    },
    // the import's answer, shown in the builder's note row until the first edit
    note: () => hostNote,
    commit: next => {
      if (openId !== id) return;
      hostNote = null;
      edit(d => {
        if (next.cards) d.cards = next.cards;
        if (next.maybe) d.maybe = next.maybe;
        if (next.sideboard) d.sideboard = next.sideboard;
        if ('piles' in next) { if (next.piles) d.piles = next.piles; else delete d.piles; }
      }, true);
      tt.tabletopChanged();
    },
    // the table has already left the screen, so this paints the Decks page
    close: () => { flushSave(); closeInfo(); hostNote = null; open = true; openId = id; paint(); },
  };
}

/**
 * The builder for deck `id`, with the Decks page opened underneath it (so
 * Back lands on that deck) — or null: no login, no such deck, or the
 * collection not loaded yet. In that last case the load is started, and when
 * it lands the table is opened from here (`tt.openTabletop`), so a reload on
 * `?table=<id>` comes back to the table either way.
 */
export function tabletopHostFor(id: string): tt.TableHost | null {
  if (!acct.token()) return null;
  if (!decks) { pendingTable = id; ensureCollection(rerenderHost); return null; }
  if (!decks.some(d => d.id === id)) return null;
  if (openId !== id) { flushSave(); descOpen = false; }
  open = true; openId = id; pageSheet = null; closeInfo();
  return tabletopHost(id);
}

/** open deck `id` on the table, carrying `note` (an import's answer) */
function openBuilder(id: string, note: string | null = null): void {
  const host = tabletopHostFor(id);
  if (!host) { paint(); return; }
  hostNote = note;
  tt.openTabletop(host);
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
      open = true; msg = ''; pageSheet = null;
      renderScreen();
      return true;

    case 'deck-close':
      // leaving the page must not outrun the debounce — the next thing the
      // user does may be starting a game, which navigates this module away
      flushSave();
      open = false; pageSheet = null;
      rerenderHost();
      return true;

    case 'deck-tabletop':
      // the debounce must not outrun the page change (the table reads the
      // local copy, but a reload on it must find the server agreeing)
      flushSave();
      if (openId) openBuilder(openId);
      return true;

    case 'deck-refresh':
      flushSave();
      decks = null; msg = ''; pageSheet = null;
      tt.clearHistory();
      renderScreen();
      return true;

    case 'deck-open':
      flushSave();
      openId = btn.dataset['id'] ?? null;
      pageSheet = null; descOpen = false; msg = '';
      paint();
      return true;

    case 'deck-sort': {
      const s = btn.dataset['sort'] ?? '';
      if ((DECK_SORTS as readonly string[]).includes(s)) {
        sort = s as DeckSort;
        try { localStorage.setItem(SORT_KEY, sort); } catch { /* private window */ }
      }
      paint();
      return true;
    }

    // ── making decks: both open the builder straight away ──
    case 'deck-new':
      void post('/api/decks/create', { name: 'New deck', cards: [] }).then(r => {
        if (!r.ok) { msg = r.error ?? 'could not make a deck'; paint(); return; }
        adopt(r);
        msg = '';
        if (!r.id) { paint(); return; }
        openBuilder(r.id);
        // a brand new deck is empty, so the caret belongs in the pool's search (a mouse only)
        tt.focusPool();
      }).catch(() => { msg = 'could not reach the server'; paint(); });
      return true;

    case 'deck-import-open':
      pageSheet = { kind: 'import', msg: '' }; paint(); return true;
    case 'deck-import-close':
      pageSheet = null; paint(); return true;

    case 'deck-import-url':
    case 'deck-import-text': {
      const url = (document.getElementById('dk-url') as HTMLInputElement | null)?.value?.trim() ?? '';
      const text = (document.getElementById('dk-text') as HTMLTextAreaElement | null)?.value?.trim() ?? '';
      const body = b === 'deck-import-url' ? { url } : { text };
      if (!(b === 'deck-import-url' ? url : text)) return true;
      pageSheet = { kind: 'import', msg: 'Importing…' };
      paint();
      void post('/api/decks/import', body).then(r => {
        if (!r.ok) { pageSheet = { kind: 'import', msg: r.error ?? 'import failed' }; paint(); return; }
        adopt(r);
        pageSheet = null;
        // the import's own complaints (an unscripted card, 27 cards) are the
        // useful half of the answer and belong where they can be read
        msg = r.note ?? '';
        if (r.id) openBuilder(r.id, r.note ?? null); else paint();
      }).catch(() => { pageSheet = { kind: 'import', msg: 'could not reach the server' }; paint(); });
      return true;
    }

    case 'deck-duplicate': {
      const d = current();
      if (!d) return true;
      flushSave();
      void post('/api/decks/duplicate', { id: d.id }).then(r => {
        if (!r.ok) { msg = r.error ?? 'could not copy that deck'; paint(); return; }
        adopt(r);
        openId = r.id ?? openId;
        msg = 'Copied.';
        paint();
      }).catch(() => { msg = 'could not reach the server'; paint(); });
      return true;
    }

    // ── delete asks once, inside its sheet ──
    case 'deck-delete':
      if (current()) pageSheet = { kind: 'delete' };
      paint();
      return true;
    case 'deck-delete-no':
      pageSheet = null; paint(); return true;
    case 'deck-delete-yes': {
      const d = current();
      pageSheet = null;
      if (!d) { paint(); return true; }
      void post('/api/decks/delete', { id: d.id }).then(r => {
        if (!r.ok) { msg = r.error ?? 'could not delete that deck'; paint(); return; }
        adopt(r);
        openId = decks?.[0]?.id ?? null;
        msg = `Deleted “${d.name}”.`;
        paint();
      }).catch(() => { msg = 'could not reach the server'; paint(); });
      return true;
    }

    case 'deck-play': {
      flushSave();
      const d = current();
      if (!d) return true;
      chooseDeck({ id: d.id, name: d.name, author: d.author, ...(d.url ? { url: d.url } : {}), cards: d.cards });
      msg = `“${d.name}” is the deck you bring to constructed games.`;
      paint();
      return true;
    }

    // ── the preview's sheets ──
    case 'deck-share':
      if (current()) pageSheet = { kind: 'share' };
      paint();
      return true;
    case 'deck-share-close':
      pageSheet = null; paint(); return true;
    case 'deck-games':
      if (current()) pageSheet = { kind: 'games' };
      paint();
      return true;
    case 'deck-games-close':
      pageSheet = null; paint(); return true;

    // one button opens the sheet and both format choices re-enter here, which
    // is why the format comes off the button rather than being toggled
    case 'deck-export':
      if (current()) pageSheet = { kind: 'export', format: btn.dataset['format'] === 'file' ? 'file' : 'text' };
      paint();
      return true;
    case 'deck-export-close':
      pageSheet = null; paint(); return true;
    case 'deck-copy-list': {
      const d = current();
      if (!d) return true;
      // The textarea is right there and is what plain http copies FROM, so it
      // is handed over as the selection. No repaint: repainting here is what
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

    // a card in the preview's list or its description: its panel, in a sheet
    case 'deck-focus':
      pageSheet = card ? { kind: 'card', name: card } : null;
      paint();
      return true;
    case 'deck-unfocus':
      pageSheet = null; paint(); return true;

    case 'deck-desc-toggle':
      descOpen = !descOpen;
      paint();
      return true;

    // ── the builder's Deck info ──
    case 'deck-settings':
      infoOpen = true; repaint(); return true;
    case 'deck-settings-close':
      closeInfo(); repaint(); return true;

    case 'deck-visibility':
      edit(d => { d.visibility = (btn.dataset['visibility'] ?? 'private') as DeckView['visibility']; });
      return true;
    case 'deck-cover':
      edit(d => { d.cover = card; });
      return true;
    case 'deck-cover-random': {
      // a card the deck actually plays, chosen from the DISTINCT cards so a
      // two-of is not twice as likely to be the face
      const d = current();
      if (!d?.cards.length) return true;
      const names = [...new Set(d.cards)];
      const pick = names[Math.floor(Math.random() * names.length)]!;
      edit(x => { x.cover = pick; });
      return true;
    }
    case 'deck-desc-edit':
      descEditing = true; syntaxOpen = false;
      descDraft = current()?.description ?? '';
      repaint();
      // the click that opened the editor claims the caret; no later repaint does
      (document.getElementById('dk-desc') as HTMLTextAreaElement | null)?.focus?.();
      return true;
    case 'deck-desc-syntax':
      // `captureDraft()` at the top already put the box's contents somewhere
      // the repaint cannot destroy them
      syntaxOpen = !syntaxOpen;
      repaint();
      return true;
    case 'deck-desc-cancel':
      descEditing = false; syntaxOpen = false; descDraft = null;
      repaint();
      return true;
    case 'deck-desc-save': {
      const text = descDraft ?? '';
      descEditing = false; syntaxOpen = false; descDraft = null;
      descOpen = false;
      edit(d => { d.description = text; });
      return true;
    }
  }
  return false;
}
