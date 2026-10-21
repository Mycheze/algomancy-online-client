/* The deck collection: the decks an account has saved, and everything the
 * client asks about them that only the server can answer.
 *
 * WHY THIS IS NOT JUST "algoDeck IN localStorage" (which is what constructed
 * play used before this file): a deck you tune between games is a thing you
 * own, and the two useful questions about it — *what is my record with it?*
 * and *is it still the deck I played last week?* — are both questions about
 * the game record, which lives on the server. A browser-local deck also dies
 * with the browser, and the whole point of accounts here is that Ben and
 * Rashi play from two cities on two machines.
 *
 * Three design commitments, each of which pays for itself:
 *
 *  1. THE RECORD IS DERIVED, NEVER STORED. A deck's W/L is a fold over the
 *     account history filtered by deck id (deckRecords below), exactly the way
 *     a Profile is a fold over the same history. So `rebuildProfiles()` — the
 *     escape hatch the whole stats design rests on — keeps working, and a deck
 *     can never carry a win/loss count that disagrees with the games list.
 *
 *  2. A SAVED DECK MAY BE ILLEGAL. You cut a card, you are at 29, you go and
 *     find the replacement: refusing to save that is refusing to let anybody
 *     build a deck. Legality (30 minimum, max 2 copies — engine checkDeck) is
 *     reported on every read as `problems` and enforced only where it matters,
 *     which is the moment a deck is brought to a game.
 *
 *  3. THE STARTER FIVE ARE A SEED, NOT A LINK. A new account gets copies of
 *     the five bundled algomancer.cc decks, with their builder's name and link
 *     kept as attribution. They are then yours: rename them, cut from them,
 *     delete them. Nothing re-seeds a collection that exists — deleting all
 *     five is a decision, not damage to repair.
 */
import { randomUUID } from 'node:crypto';
import { checkDeck } from '../engine/src/apply.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { canonicalCardName, getCard } from '../engine/src/cards/dsl.ts';
import type { CardName, Seat } from '../engine/src/types.ts';
import { accountById, gameHistory, saveAccounts, type Account } from './accounts.ts';
import { defaultDecks } from './decks.ts';

/** One deck in somebody's collection. Everything here is EDITED by its owner;
 * everything derived from it (legality, curve, record) is computed on read. */
export interface CollectionDeck {
  id: string;
  name: string;
  /** the deck proper — what gets shuffled. May be illegal while you build. */
  cards: CardName[];
  /** the maybeboard: cards you are thinking about. No rules apply to it, it is
   * never shuffled into anything, and it is NOT a sideboard — Algomancy has
   * none, and calling it one would invite people to expect between-game swaps. */
  maybe: CardName[];
  /** the card whose art represents this deck in the list (null = pick one) */
  cover: CardName | null;
  /** who built it: the algomancer.cc username for an import, 'you' otherwise */
  author: string;
  /** the algomancer.cc deck it was imported from, if any */
  url?: string;
  /**
   * Who may see it.
   *
   *   private   nobody but the owner. The share link 404s.
   *   unlisted  anybody holding the link. Not on the meta page, not on the
   *             profile — the link IS the permission.
   *   public    the link, your profile, and the meta page.
   *
   * ⚠ TWO DIFFERENT DEFAULTS, AND THE DIFFERENCE IS THE POINT.
   *
   * ABSENT MEANS PRIVATE — `visibilityOf` reads it that way and always will.
   * That is the rule for a deck whose visibility nobody has ever set: every
   * deck that predates this field, and every deck seeded or copied by the
   * server on somebody's behalf. A deck the owner never published must not
   * become published because a field was missing.
   *
   * A DECK YOU MAKE IS CREATED `public`. `createDeck` writes the field
   * explicitly (2026-09-20, the owner's call: "make sure the share option is
   * ON by default for all new decks made"). This reverses the original
   * BL-13 reading, under which publishing was a second, separate act; the
   * reason it is safe to reverse is that it applies only to a deck somebody
   * deliberately made, and every such deck can be set back to private on the
   * share tab in one click. It is NOT applied to the starter five (nobody
   * made those — five copies of the same bundled deck per account would be
   * the metagame list), and it is NOT applied to a copy taken of somebody
   * else's shared deck (see duplicateDeck).
   */
  visibility?: DeckVisibility;
  /** what the deck is and how to play it — markdown, rendered by the client
   * (ui/markdown.ts + ui/cardlinks.ts). Only meaningful once shared, but it is
   * yours to write whenever. */
  description?: string;
  /**
   * The deck this one was copied from, if any — set by `duplicateDeck` and by
   * taking a copy of somebody's shared deck.
   *
   * This is what makes a metagame record possible at all. A deck's own record
   * is a fold over the games IT was brought to (deckRecords below), and a copy
   * is a different id with a different record, so without a link between them
   * a popular list would read as a dozen decks with two games each. With it,
   * publicdecks.ts can fold the whole lineage and still never merge two decks
   * that merely happen to hold the same cards.
   */
  copiedFrom?: string;
  /**
   * THE TABLETOP'S ARRANGEMENT (2026-10-21) — the piles the deck's cards lie
   * in on the tabletop builder, in order: where the cards sit, never which
   * cards there are. Arrangement ONLY: it may not add, remove or count a card,
   * and it is clamped to `cards` on every write (sanitizePiles below). The
   * client's mirror and the layout opinions are ui/deckarrange.ts.
   * ABSENT = never arranged; the tabletop seeds piles by cost on open.
   */
  piles?: DeckPile[];
  createdAt: string;
  updatedAt: string;
}

/** one tabletop pile: one entry per COPY, so a name may be split across piles */
export interface DeckPile {
  /** client-made, ≤ 16 chars [A-Za-z0-9_-] */
  id: string;
  /** ≤ 40 chars, trimmed; empty → "Pile" */
  name: string;
  cards: CardName[];
  /** the Re-sort bucket that made it ('cost:3', 'type:units'), if any */
  auto?: string;
  /** the user named it (it survives being emptied); absent = false */
  named?: true;
}

/** @see CollectionDeck.visibility */
export type DeckVisibility = 'private' | 'unlisted' | 'public';

const VISIBILITIES: readonly string[] = ['private', 'unlisted', 'public'];

/** The stored value, normalised. Anything unrecognised reads as private —
 * the safe direction for a field that decides who may see a list. */
export const visibilityOf = (deck: CollectionDeck): DeckVisibility =>
  (VISIBILITIES.includes(deck.visibility ?? '') ? deck.visibility! : 'private');

/** How long a description may be. Long enough for a real primer — a few
 * hundred words with a card-by-card section — and short enough that nobody
 * can grow accounts.json with one. */
export const MAX_DESCRIPTION = 6000;

/** A deck's record, folded out of the account's game history. */
export interface DeckRecord {
  games: number;
  wins: number;
  losses: number;
  /** games whose result the record does not know — see Profile.unresolved */
  unresolved: number;
  lastPlayed: string | null;
}

/** What the client is sent: the deck plus what only the server can say. */
export interface DeckView extends CollectionDeck {
  /** empty means it is legal to bring to a game */
  problems: string[];
  record: DeckRecord;
}

/* Twenty decks per account — the owner's number, and his stated reason was
 * tidiness rather than storage ("just to help people stay organized and not
 * overwhelm our db (despite deck lists being so tiny)", 2026-08-25), which is
 * why hitting it reads as a friendly sentence and not an error page. The other
 * two caps are the ordinary ones: a stuck client must not be able to grow
 * accounts.json without bound. */
const MAX_DECKS = 20;
const MAX_CARDS = 300;
const MAX_NAME = 60;

const POOL = new Set<string>(DECK_LIST);

/* The arrangement's caps. Thirty piles is more than anybody sorts thirty cards into. */
export const MAX_PILES = 30;
const MAX_PILE_NAME = 40;
const PILE_ID = /^[A-Za-z0-9_-]{1,16}$/;
/** a pile's Re-sort bucket: short, and from a closed alphabet. NO SEMANTIC
 * CHECK — what a bucket means is ui/decklayout.ts's knowledge, and the server
 * shares no layout code with the client; a meaningless one only fails to
 * attract newcomers on the client. */
const AUTO_KEY = /^[A-Za-z0-9/_:-]{1,24}$/;

/** deck-rule problems (30 minimum, max 2 copies) as human-readable lines */
export function deckProblems(cards: CardName[]): string[] {
  const c = checkDeck(cards);
  return c.ok ? [] : [c.error];
}

/** Keep only real pool cards, capped. Returns the survivors and what was
 * dropped, because silently losing a card out of somebody's deck is the one
 * failure mode a deck editor must never have. */
function sanitize(raw: unknown): { cards: CardName[]; dropped: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const cards: CardName[] = [];
  const dropped: string[] = [];
  for (const item of list.slice(0, MAX_CARDS)) {
    // an alias is the card it names (registerAlias: "Counter Theif", a renamed card)
    const name = canonicalCardName(String(item ?? ''));
    if (POOL.has(name)) cards.push(name);
    else if (name) dropped.push(name);
  }
  return { cards, dropped };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The tabletop piles a client sent, clamped to THIS deck. Undefined means
 * "no piles" (not an array, or an empty one).
 *
 *  · at most MAX_PILES; a name trimmed to 40 (empty → "Pile"); an id that is
 *    malformed or a duplicate is replaced with a fresh one;
 *  · every card canonicalised and in the pool, or dropped SILENTLY — a pile
 *    never holds a card the deck lacks, so nothing is lost to report;
 *  · per name, the copies across all piles are at most the copies in `cards`:
 *    the surplus comes out of the LAST pile holding it.
 *  · empty piles are kept — somebody made it to fill later.
 *
 * ⚠ A DEFICIT IS NOT FILLED. Where a copy that is in the deck but in no pile
 * should go is a layout opinion (ui/deckarrange.ts reconcilePiles), and the
 * client reconciles every time it reads. Filling here would be a second,
 * different answer to the same question.
 */
export function sanitizePiles(raw: unknown, cards: readonly CardName[]): DeckPile[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const piles: DeckPile[] = [];
  const ids = new Set<string>();
  for (const item of raw.slice(0, MAX_PILES)) {
    if (!isRecord(item)) continue;
    const list = Array.isArray(item['cards']) ? item['cards'] : [];
    const pileCards: CardName[] = [];
    for (const c of list.slice(0, MAX_CARDS)) {
      // a name that is not a card goes in the clamp below: `cards` holds pool
      // cards only, so a card the deck lacks and a non-card are the same case
      pileCards.push(canonicalCardName(String(c ?? '')));
    }
    let id = typeof item['id'] === 'string' ? item['id'] : '';
    if (!PILE_ID.test(id) || ids.has(id)) {
      let n = 1;
      while (ids.has(`s${n}`) || raw.some(o => isRecord(o) && o['id'] === `s${n}`)) n++;
      id = `s${n}`;
    }
    ids.add(id);
    const auto = item['auto'];
    piles.push({
      id,
      name: String(item['name'] ?? '').trim().slice(0, MAX_PILE_NAME) || 'Pile',
      cards: pileCards,
      ...(typeof auto === 'string' && AUTO_KEY.test(auto) ? { auto } : {}),
      ...(item['named'] === true ? { named: true as const } : {}),
    });
  }
  // the clamp: what the piles hold beyond the deck comes off the END
  const left = new Map<string, number>();
  for (const c of cards) left.set(c, (left.get(c) ?? 0) + 1);
  const keep = new Map<string, number>();
  for (const p of piles) for (const c of p.cards) keep.set(c, (keep.get(c) ?? 0) + 1);
  for (const [name, n] of keep) keep.set(name, Math.min(n, left.get(name) ?? 0));
  for (const p of piles) {
    p.cards = p.cards.filter(c => {
      const k = keep.get(c) ?? 0;
      if (k <= 0) return false;
      keep.set(c, k - 1);
      return true;
    });
  }
  return piles.length ? piles : undefined;
}

/** set or clear the optional field, so an absent arrangement is ABSENT, never `undefined`-valued */
function setPiles(deck: CollectionDeck, piles: DeckPile[] | undefined): void {
  if (piles) deck.piles = piles; else delete deck.piles;
}

/** The card a deck wears in the list when nobody has chosen one: its most
 * expensive card, which is very nearly always the one it is about. */
function defaultCover(cards: CardName[]): CardName | null {
  let best: CardName | null = null;
  let bestMana = -1;
  for (const n of cards) {
    let mana = 0;
    try { const m = getCard(n).mana; mana = m === 'X' ? 99 : m; } catch { /* not in the pool */ }
    if (mana > bestMana) { bestMana = mana; best = n; }
  }
  return best;
}

// ── the collection on an account ──────────────────────────────────────

/** The five bundled decks, copied into a brand-new collection.
 *
 * NO `visibility`, deliberately: these are seeded BY the server, not made by
 * anybody, so they read as private (see CollectionDeck.visibility). Giving
 * them `createDeck`'s published-by-default would publish five identical copies
 * of the same bundled list per account, and the metagame list would be those
 * copies. Anyone who wants to share a starter deck presses the button. */
function starterDecks(): CollectionDeck[] {
  const now = new Date().toISOString();
  return defaultDecks().map(d => ({
    id: randomUUID(),
    name: d.name,
    cards: [...d.cards],
    maybe: [],
    cover: defaultCover(d.cards),
    author: d.author,
    ...(d.url ? { url: d.url } : {}),
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * An account's decks, seeding the starter five the first time anybody looks.
 *
 * Seeding lazily rather than at registration is what lets the accounts that
 * existed before this feature pick the starters up on their next visit, and it
 * is why the field is `undefined` vs `[]` rather than a length check: an empty
 * collection is somebody who deleted all five, and re-seeding it would be the
 * server arguing with them.
 */
export function decksOf(account: Account): CollectionDeck[] {
  if (!account.decks) {
    account.decks = starterDecks();
    saveAccounts();
  }
  for (const d of account.decks) canonicalizeDeck(d);
  return account.decks;
}

/**
 * A stored deck in today's card names, IN PLACE. A card named by an alias
 * (registerAlias — the printed "Counter Theif", or a card renamed upstream,
 * which is still its old name in every deck saved before the rename) must be
 * respelled, because the editor, the cover art and the pool check all look
 * names up as they are now. Positions never move. Nothing
 * is written here: the store picks the new spelling up whenever it is next
 * saved for some other reason, and until then every read spells it this way.
 */
function canonicalizeDeck(d: CollectionDeck): void {
  const canon = (list: CardName[]): CardName[] =>
    list.some(n => canonicalCardName(n) !== n) ? list.map(canonicalCardName) : list;
  if (Array.isArray(d.cards)) d.cards = canon(d.cards);
  if (Array.isArray(d.maybe)) d.maybe = canon(d.maybe);
  if (typeof d.cover === 'string') d.cover = canonicalCardName(d.cover);
  // the arrangement names cards too, and must spell them the way `cards` now does
  if (Array.isArray(d.piles)) for (const p of d.piles) if (Array.isArray(p.cards)) p.cards = canon(p.cards);
}

export const deckById = (account: Account, id: string): CollectionDeck | undefined =>
  decksOf(account).find(d => d.id === id);

// ── the record, folded out of the game history ────────────────────────

const emptyRecord = (): DeckRecord => ({ games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null });

/**
 * Every deck's record, keyed by deck id: a fold over this account's games,
 * counting the seat that brought the deck.
 *
 * Games played before deck ids existed simply do not appear — their seats
 * brought a card list with no name on it, and inventing an attribution for
 * them (by matching the list, say) would silently credit a deck you have since
 * edited with games its current 30 cards never played.
 */
export function deckRecords(account: Account): Record<string, DeckRecord> {
  const out: Record<string, DeckRecord> = {};
  for (const game of gameHistory()) {
    // ⚠ CONSTRUCTED ONLY, AND STATED RATHER THAN TRUSTED (2026-09-20).
    //
    // This used to rest on "deckIds is stamped nowhere else", which was true
    // of the intent and false of the code: a live-draft join carrying the
    // browser's chosen deck stamped `deckIds` on a DRAFT room, and every such
    // game landed in that deck's record. rooms.ts's setRoomDeck is where that
    // was fixed; this is the line that makes the rule hold anyway — including
    // for the rows already written, which it repairs with no migration.
    if (game.mode !== 'constructed') continue;
    if (game.custom) continue;   // BL-43: a custom-rules game is in no deck record
    if (game.single) continue;   // CR D8.2e: nor is a single card duel
    for (const seat of [0, 1] as Seat[]) {
      if (game.users[seat] !== account.id) continue;
      const id = game.deckIds?.[seat];
      if (!id) continue;
      const rec = out[id] ?? (out[id] = emptyRecord());
      rec.games++;
      if (!game.finished) rec.unresolved++;
      else if (game.seats[seat]!.won) rec.wins++;
      else rec.losses++;
      if (!rec.lastPlayed || game.playedAt > rec.lastPlayed) rec.lastPlayed = game.playedAt;
    }
  }
  return out;
}

/** The whole collection as the client sees it, newest activity first. */
export function collectionView(account: Account): DeckView[] {
  const records = deckRecords(account);
  return decksOf(account).map(d => ({
    ...d,
    problems: deckProblems(d.cards),
    record: records[d.id] ?? emptyRecord(),
  }));
}

// ── edits ─────────────────────────────────────────────────────────────

export type EditResult = { ok: true; deck: CollectionDeck; note?: string } | { ok: false; error: string };

const trimName = (raw: unknown, fallback: string): string => {
  const s = String(raw ?? '').trim().slice(0, MAX_NAME);
  return s || fallback;
};

/** A name that is already taken gets a "(2)" rather than a refusal — two decks
 * called "fire" is a mild annoyance, being stopped mid-save is a real one. */
function uniqueName(account: Account, want: string, exceptId?: string): string {
  const taken = new Set(decksOf(account).filter(d => d.id !== exceptId).map(d => d.name.toLowerCase()));
  if (!taken.has(want.toLowerCase())) return want;
  for (let n = 2; n < 100; n++) {
    const tryName = `${want} (${n})`.slice(0, MAX_NAME);
    if (!taken.has(tryName.toLowerCase())) return tryName;
  }
  return want;
}

/**
 * What a deck a person MAKES is born as — see CollectionDeck.visibility.
 *
 * Named rather than written inline at the one call site, because the two other
 * ways a deck comes into existence (the starter seed, and taking a copy of
 * somebody else's shared deck) deliberately do NOT use it, and a bare
 * `'public'` in `createDeck` would read as if they had simply been forgotten.
 */
export const NEW_DECK_VISIBILITY: DeckVisibility = 'public';

export function createDeck(
  account: Account,
  init: {
    name?: unknown; cards?: unknown; maybe?: unknown;
    author?: string; url?: string; description?: string; cover?: string;
    /** `createDeck` publishes by default; a caller that is copying rather than
     * creating passes 'private' — nothing else ever overrides this. */
    visibility?: DeckVisibility;
  },
): EditResult {
  const decks = decksOf(account);
  if (decks.length >= MAX_DECKS) {
    return { ok: false, error: `You have ${MAX_DECKS} decks saved, which is the limit — delete one you are `
      + 'no longer playing and this will go through.' };
  }
  const { cards, dropped } = sanitize(init.cards);
  const { cards: maybe } = sanitize(init.maybe);
  const now = new Date().toISOString();
  // a cover the import named, but only if the card survived sanitising
  const wantCover = String(init.cover ?? '');
  const deck: CollectionDeck = {
    id: randomUUID(),
    name: uniqueName(account, trimName(init.name, 'New deck')),
    cards, maybe,
    cover: POOL.has(wantCover) && cards.includes(wantCover) ? wantCover : defaultCover(cards),
    author: init.author ?? 'you',
    ...(init.url ? { url: init.url } : {}),
    visibility: init.visibility ?? NEW_DECK_VISIBILITY,
    ...(init.description?.trim()
      ? { description: init.description.slice(0, MAX_DESCRIPTION) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  decks.push(deck);
  saveAccounts();
  return { ok: true, deck, ...(dropped.length ? { note: unscriptedNote(dropped) } : {}) };
}

const unscriptedNote = (dropped: string[]): string =>
  `${dropped.length} card${dropped.length === 1 ? '' : 's'} left out — not in the scripted pool: ${
    dropped.slice(0, 4).join(', ')}${dropped.length > 4 ? ` (+${dropped.length - 4} more)` : ''}`;

/** Apply whichever of name/cards/maybe/cover/visibility/description the client
 * sent. Absent fields are LEFT ALONE, so the rename button does not have to
 * send 30 card names — and so publishing does not have to send the list. */
export function updateDeck(
  account: Account,
  id: string,
  patch: {
    name?: unknown; cards?: unknown; maybe?: unknown; cover?: unknown;
    visibility?: unknown; description?: unknown;
    piles?: unknown;
  },
): EditResult {
  const deck = deckById(account, id);
  if (!deck) return { ok: false, error: 'no such deck' };
  let note: string | undefined;
  if (patch.name !== undefined) deck.name = uniqueName(account, trimName(patch.name, deck.name), deck.id);
  if (patch.cards !== undefined) {
    const { cards, dropped } = sanitize(patch.cards);
    deck.cards = cards;
    if (dropped.length) note = unscriptedNote(dropped);
    // a cover that has just been cut out of the deck stops being the cover
    if (deck.cover && !cards.includes(deck.cover)) deck.cover = defaultCover(cards);
  }
  if (patch.maybe !== undefined) deck.maybe = sanitize(patch.maybe).cards;
  if (patch.cover !== undefined) {
    const want = canonicalCardName(String(patch.cover ?? ''));
    deck.cover = POOL.has(want) ? want : defaultCover(deck.cards);
  }
  if (!deck.cover) deck.cover = defaultCover(deck.cards);
  if (patch.visibility !== undefined) {
    const want = String(patch.visibility ?? '');
    // unrecognised reads as private, the same way visibilityOf reads it
    deck.visibility = (VISIBILITIES.includes(want) ? want : 'private') as DeckVisibility;
  }
  if (patch.description !== undefined) {
    // Stored RAW. It is markdown, and the client is what renders it — escaping
    // here would put backslashes in somebody's prose and still not be a
    // sanitiser. What makes it safe is ui/markdown.ts's closed tag set, which
    // is the one place that decision belongs.
    deck.description = String(patch.description ?? '').slice(0, MAX_DESCRIPTION);
  }
  // The arrangement. Replaced only when SENT (null clears it), and clamped to
  // the deck as it now stands either way: `cards` sent alone (an older client,
  // another device cutting a card) re-clamps what is stored, so no pile ever
  // holds a phantom copy. An old client never sends `piles`, so it cannot wipe
  // them. Any other field a client sends (the never-deployed v1 `sortMoves`
  // and `view`) is simply not read.
  if (patch.piles !== undefined || patch.cards !== undefined) {
    setPiles(deck, sanitizePiles(patch.piles !== undefined ? patch.piles : deck.piles, deck.cards));
  }
  deck.updatedAt = new Date().toISOString();
  saveAccounts();
  return { ok: true, deck, ...(note ? { note } : {}) };
}

export function deleteDeck(account: Account, id: string): { ok: boolean; error?: string } {
  const decks = decksOf(account);
  const i = decks.findIndex(d => d.id === id);
  if (i < 0) return { ok: false, error: 'no such deck' };
  decks.splice(i, 1);
  saveAccounts();
  return { ok: true };
}

/**
 * Copy a deck — the "try a change without losing what works" button, and the
 * "take this one" button on somebody's shared deck.
 *
 * `src` may belong to another account: taking a copy is the whole point of a
 * shared list. The caller decides whether it was allowed to be seen; this only
 * decides what the copy is. Two things it deliberately does NOT inherit:
 *
 *  - VISIBILITY, WHEN THE SOURCE IS SOMEBODY ELSE'S. A taken copy starts
 *    private. Inheriting `public` — or taking `createDeck`'s new
 *    published-by-default — would put somebody else's list on YOUR profile and
 *    the metagame list the moment you clicked "take a copy", which is a
 *    decision about their deck that you did not make. Duplicating your OWN
 *    deck is just making a deck, and follows NEW_DECK_VISIBILITY like any
 *    other. `src` is what tells the two apart: only /api/decks/take passes it.
 *  - THE DESCRIPTION'S AUTHORSHIP. The text is copied because it is what makes
 *    the deck usable, but `copiedFrom` records where it came from, and that is
 *    what the shared view prints as attribution.
 */
export function duplicateDeck(account: Account, id: string, src?: CollectionDeck): EditResult {
  const from = src ?? deckById(account, id);
  if (!from) return { ok: false, error: 'no such deck' };
  const r = createDeck(account, {
    name: `${from.name} copy`, cards: from.cards, maybe: from.maybe,
    author: from.author, ...(from.url ? { url: from.url } : {}),
    ...(src ? { visibility: 'private' as DeckVisibility } : {}),
  });
  if (r.ok) {
    r.deck.cover = from.cover;
    r.deck.copiedFrom = from.id;
    if (from.description) r.deck.description = from.description;
    // ⚠ THE ARRANGEMENT IS COPIED FROM YOUR OWN DECK ONLY. Somebody else's
    // piles are their private way of looking at the list — the public view
    // never shows them (publicdecks.ts lists its fields), so a copy taken from
    // it must not smuggle them across either.
    if (!src) setPiles(r.deck, sanitizePiles(from.piles, r.deck.cards));
    saveAccounts();
  }
  return r;
}

/**
 * The deck a seat is bringing to a game, looked up by id and re-checked.
 *
 * The client sends the card list too (it has to — a logged-out player has no
 * collection), so this is not the only path in. What it adds is the ID, which
 * is what makes the game countable toward a deck's record, and a legality
 * check against the collection's own copy rather than whatever the client
 * says is in it.
 */
export function deckForPlay(userId: string | null, id: string | null): { id: string; cards: CardName[] } | null {
  if (!userId || !id) return null;
  const account = accountById(userId);
  if (!account) return null;
  const deck = deckById(account, id);
  if (!deck) return null;
  const c = checkDeck(deck.cards);
  return c.ok ? { id: deck.id, cards: c.cards } : null;
}
