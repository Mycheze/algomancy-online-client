/* PUBLISHED DECKS: the share link, the profile shelf, and the metagame list.
 *
 * WHY THIS IS A SEPARATE FILE FROM collection.ts. That one answers "what are
 * MY decks", and every route into it is authed because a collection belongs to
 * an account by definition. Everything here is the opposite: it answers
 * questions asked by somebody who is not the owner, often by somebody who is
 * not logged in at all. Mixing the two would put an unauthed read behind the
 * 401 that guards /api/decks, or — far worse the other way — put an owner's
 * private list one missing check away from an open port.
 *
 * THREE THINGS IT COMMITS TO:
 *
 *  1. PRIVATE IS THE DEFAULT AND IS ENFORCED HERE, ONCE. `visibilityOf` reads
 *     an absent field as private, and every export below starts by asking it.
 *     There is no path in this file that returns a deck without having asked.
 *
 *  2. THE RECORD IS STILL DERIVED. collection.ts's first design commitment is
 *     that a deck's W/L is a fold over the game history and is never stored;
 *     that holds here too, with one difference — the fold is over the whole
 *     history rather than one account's, and it is grouped by LINEAGE.
 *
 *  3. IT LISTS PUBLISHED DECKS. It never reconstructs one. BL-13's standing
 *     note is that a "top decks" view which infers a list out of aggregate
 *     card play-rates is exactly what not to build, because the list it prints
 *     is one nobody registered. Everything on the meta page is a deck whose
 *     owner pressed publish.
 *
 * ON SCANNING EVERY ACCOUNT. `sharedDeck` and `metaList` walk all accounts and
 * all their decks: 3 accounts x <=20 decks today, and MAX_DECKS caps the second
 * factor forever. An id->deck index would be faster and would be one more
 * thing to invalidate on every create, delete and copy; when the account count
 * makes that trade worth taking, this comment is where to start.
 */
import type { CardName, Seat } from '../engine/src/types.ts';
import { accountById, allAccounts, gameHistory, type Account } from './accounts.ts';
import {
  deckProblems, decksOf, visibilityOf,
  type CollectionDeck, type DeckRecord, type DeckVisibility,
} from './collection.ts';

/** A published deck as anybody may see it: the list, who built it, what it
 * says about itself, and the record of the whole lineage. */
export interface PublicDeckView {
  id: string;
  name: string;
  cards: CardName[];
  cover: CardName | null;
  author: string;
  url?: string;
  description?: string;
  visibility: DeckVisibility;
  /** the account that published it */
  owner: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
  /** empty means it is legal to bring to a game */
  problems: string[];
  /** this deck and every copy of it, folded together — see lineageRecords */
  record: DeckRecord;
  /** how many decks are in the lineage, this one included */
  copies: number;
  /** the deck this was copied from, when that deck is itself published */
  copiedFrom?: { id: string; name: string; owner: string };
}

interface Located { deck: CollectionDeck; account: Account }

/** Every deck on every account, with the account that owns it. */
function everyDeck(): Located[] {
  const out: Located[] = [];
  for (const account of allAccounts()) {
    // `decksOf` seeds the starter five on first look, which is the behaviour
    // the deck page relies on; reading them here does the same thing a shade
    // earlier and nothing else.
    for (const deck of decksOf(account)) out.push({ deck, account });
  }
  return out;
}

const emptyRecord = (): DeckRecord =>
  ({ games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null });

/**
 * Which deck each deck ultimately descends from.
 *
 * A copy of a copy is still the same list going round, so the root is what the
 * meta page groups by. Two things make this safe to run over data nobody
 * validates:
 *
 *  - A MISSING PARENT ENDS THE WALK. Deleting the deck you copied from does
 *    not orphan yours; your deck simply becomes its own root. The alternative
 *    (dropping it) would lose games that really were played.
 *  - A CYCLE CANNOT HANG IT. `copiedFrom` is written only at copy time and
 *    always points at a deck that already existed, so a cycle should be
 *    impossible — which is precisely the kind of "should" that a `while` loop
 *    over hand-editable JSON must not rest on. The seen-set ends it.
 */
export function lineageRoots(decks: Map<string, CollectionDeck>): Map<string, string> {
  const root = new Map<string, string>();
  for (const id of decks.keys()) {
    const seen = new Set<string>();
    let at = id;
    for (;;) {
      if (seen.has(at)) break;              // a cycle: this one is its own root
      seen.add(at);
      const parent = decks.get(at)?.copiedFrom;
      if (!parent || !decks.has(parent)) break;
      at = parent;
    }
    root.set(id, at);
  }
  return root;
}

/**
 * The record of every lineage, keyed by root deck id.
 *
 * The same fold as collection.ts's `deckRecords`, with the account filter
 * taken off and the deck id mapped through its lineage first. A game counts
 * once, for the seat that brought the deck — a mirror match of two copies of
 * one list therefore counts twice, once as a win and once as a loss, which is
 * what it was.
 */
export function lineageRecords(
  byId: Map<string, CollectionDeck>,
  root = lineageRoots(byId),
): Map<string, DeckRecord> {
  const out = new Map<string, DeckRecord>();
  for (const game of gameHistory()) {
    // the same three exclusions as collection.ts's deckRecords, for the same
    // reasons — see the ⚠ there for why `mode` is checked rather than assumed
    if (game.mode !== 'constructed') continue;
    if (game.custom) continue;   // BL-43: a custom-rules game is in no lineage record
    if (game.single) continue;   // R298: nor is a single card duel
    for (const seat of [0, 1] as Seat[]) {
      const id = game.deckIds?.[seat];
      if (!id) continue;
      const key = root.get(id) ?? id;
      let rec = out.get(key);
      if (!rec) { rec = emptyRecord(); out.set(key, rec); }
      rec.games++;
      if (!game.finished) rec.unresolved++;
      else if (game.seats[seat]!.won) rec.wins++;
      else rec.losses++;
      if (!rec.lastPlayed || game.playedAt > rec.lastPlayed) rec.lastPlayed = game.playedAt;
    }
  }
  return out;
}

/** How many decks share each root. */
function lineageSizes(root: Map<string, string>): Map<string, number> {
  const n = new Map<string, number>();
  for (const key of root.values()) n.set(key, (n.get(key) ?? 0) + 1);
  return n;
}

/**
 * Everything the views need, computed ONCE per request.
 *
 * `view` used to derive the roots, the lineage sizes and the owning account
 * itself, from the deck map it was handed. That is correct and quadratic: a
 * meta page of sixty rows walked every deck on every account sixty times over,
 * three times per row. Nothing on this deploy would have noticed, which is
 * exactly why it would still have been here when something did.
 */
interface Ctx {
  all: Located[];
  byId: Map<string, CollectionDeck>;
  ownerOf: Map<string, Account>;
  root: Map<string, string>;
  sizes: Map<string, number>;
  records: Map<string, DeckRecord>;
}

function context(): Ctx {
  const all = everyDeck();
  const byId = new Map(all.map(l => [l.deck.id, l.deck]));
  const ownerOf = new Map(all.map(l => [l.deck.id, l.account]));
  const root = lineageRoots(byId);
  return { all, byId, ownerOf, root, sizes: lineageSizes(root), records: lineageRecords(byId, root) };
}

function view(loc: Located, ctx: Ctx): PublicDeckView {
  const { deck, account } = loc;
  const root = ctx.root.get(deck.id) ?? deck.id;
  const parent = deck.copiedFrom ? ctx.byId.get(deck.copiedFrom) : undefined;
  const parentOwner = parent ? ctx.ownerOf.get(parent.id) : undefined;
  return {
    id: deck.id,
    name: deck.name,
    cards: [...deck.cards],
    cover: deck.cover,
    author: deck.author,
    ...(deck.url ? { url: deck.url } : {}),
    ...(deck.description ? { description: deck.description } : {}),
    visibility: visibilityOf(deck),
    owner: { id: account.id, username: account.username },
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
    problems: deckProblems(deck.cards),
    record: ctx.records.get(root) ?? emptyRecord(),
    copies: ctx.sizes.get(root) ?? 1,
    // only named when the parent is itself published — attribution must not
    // become a way to learn that somebody has a private deck by this name
    ...(parent && parentOwner && visibilityOf(parent) !== 'private'
      ? { copiedFrom: { id: parent.id, name: parent.name, owner: parentOwner.username } }
      : {}),
  };
}

/**
 * One shared deck, by id — the share link's whole answer.
 *
 * Returns null for a deck that is private, and for one that does not exist.
 * THE SAME NULL ON PURPOSE: a distinguishable answer would turn this into an
 * oracle for "does this id exist", which is the one thing an unlisted link's
 * secrecy rests on.
 */
export function sharedDeck(id: string): PublicDeckView | null {
  if (!id) return null;
  const ctx = context();
  const loc = ctx.all.find(l => l.deck.id === id);
  if (!loc || visibilityOf(loc.deck) === 'private') return null;
  return view(loc, ctx);
}

export type MetaSort = 'winrate' | 'games' | 'new' | 'name';

export interface MetaOpts {
  /** below this many games a deck is not ranked by winrate — see metaList */
  minGames?: number;
  sort?: MetaSort;
  limit?: number;
}

/**
 * Games below which a deck is not on the metagame list AT ALL.
 *
 * Five is not a statistical claim; it is a floor low enough to be reachable
 * and high enough that one lucky game cannot put a deck on top.
 *
 * ⚠ IT USED TO BE A DIVIDER, NOT A FLOOR. Decks under it were listed anyway,
 * below a "not enough games yet" heading — on the reasoning that hiding them
 * was less honest than ranking them separately. Publishing by default
 * (2026-09-20) settled the argument the other way: when every deck anybody
 * makes is public from birth, the unranked half of that page is every empty
 * "New deck" on the deploy, and a metagame page that is mostly other people's
 * scratch space is not more honest, just worse. The owner: *"Decks should
 * also have at least 5 games to show up at all. No need to make everything
 * searchable all the time."*
 *
 * Nothing is lost that mattered: a deck below the floor is still public, still
 * on its owner's profile, and its share link still opens. It is off one
 * ranking page until it has been played.
 */
const MIN_RANKED_GAMES = 5;

export const winrate = (r: DeckRecord): number | null => {
  const decided = r.wins + r.losses;
  return decided ? r.wins / decided : null;
};

/**
 * The metagame list: the PUBLIC decks that are legal and have been played.
 *
 * THREE GATES, and each answers a different question about whether a deck
 * belongs on a ranking page:
 *
 *  · `public`   — its owner put it here. Unlisted decks are not on it; that is
 *    the whole difference between the two shared states.
 *  · LEGAL      — you could actually bring it to a game. A half-built list is
 *    not a deck yet, and a page of 4-card drafts-in-progress ranked by winrate
 *    is nonsense. `problems` is the same check `deckForPlay` enforces at the
 *    table, so "on the metagame list" and "playable" cannot come apart.
 *  · PLAYED     — at least MIN_RANKED_GAMES constructed games. See that
 *    constant for why this became a floor rather than a divider.
 *
 * A NOTE ON THE SAMPLE, because the page has to be able to say it. A deck's
 * record only counts CONSTRUCTED games played by a logged-in seat that brought
 * a saved deck (collection.ts's deckRecords enforces it), so a brand-new
 * deploy has an EMPTY metagame page rather than a long one full of decks with
 * no record. That is the truth about the data; the page says so.
 */
export function metaList(opts: MetaOpts = {}): PublicDeckView[] {
  const ctx = context();
  const min = opts.minGames ?? MIN_RANKED_GAMES;
  const rows = ctx.all
    .filter(l => visibilityOf(l.deck) === 'public')
    .map(l => view(l, ctx))
    .filter(d => !d.problems.length && d.record.games >= min);

  const sort = opts.sort ?? 'winrate';
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'new') return b.updatedAt.localeCompare(a.updatedAt);
    if (sort === 'games') return b.record.games - a.record.games || a.name.localeCompare(b.name);
    // winrate: everything here is over the floor now, so there is no second
    // tier to sort around — rate, then sample as the tiebreak
    const aw = winrate(a.record) ?? -1, bw = winrate(b.record) ?? -1;
    if (aw !== bw) return bw - aw;
    return b.record.games - a.record.games || a.name.localeCompare(b.name);
  });
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/** The floor, so the page can say what it is rather than hard-coding a 5. */
export const minRankedGames = (): number => MIN_RANKED_GAMES;

/** Somebody's public decks, for their profile. Unlisted ones are not on it —
 * a profile is a list, and being on a list is what `public` means. */
export function publicDecksOf(userId: string): PublicDeckView[] {
  const account = accountById(userId);
  if (!account) return [];
  const ctx = context();
  return ctx.all
    .filter(l => l.account.id === account.id && visibilityOf(l.deck) === 'public')
    .map(l => view(l, ctx))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** How many public decks play each card — what the card browser prints. Built
 * on every call; the whole corpus is a few hundred lists of thirty strings. */
export function publicDeckCounts(): Map<CardName, number> {
  const out = new Map<CardName, number>();
  for (const { deck } of everyDeck()) {
    if (visibilityOf(deck) !== 'public') continue;
    for (const name of new Set(deck.cards)) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

/**
 * The stored deck behind a shared id, or null if it may not be seen.
 *
 * `sharedDeck` above answers with a VIEW — the shape the wire carries, with
 * the list copied and the record folded in. Copying a deck needs the record
 * itself, so this is the same permission question answered with the object.
 * Both go through `visibilityOf`, which is the point: there is one rule and
 * two callers, not two rules.
 */
export function sourceDeck(id: string): CollectionDeck | null {
  if (!id) return null;
  const loc = everyDeck().find(l => l.deck.id === id);
  return loc && visibilityOf(loc.deck) !== 'private' ? loc.deck : null;
}
