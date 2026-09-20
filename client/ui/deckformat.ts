/* THE DECK INTERCHANGE FORMAT — a whole deck, not just its list.
 *
 * ui/deckstats.ts's `deckListText` is the OTHER export, and it stays: a plain
 * "2 Ignis Sprite" list is what you paste into a Discord message, into
 * algomancer.cc, or back into the paste box here, and every one of those
 * readers is a human or a two-line parser. What it cannot carry is everything
 * else a deck in this system actually is — the description, the cover card,
 * who built it, where it came from, the maybeboard, when it was made. Those
 * were exported by dropping them.
 *
 * So there are two formats and they answer different questions:
 *
 *   TEXT   "what cards are in it" — paste-anywhere, lossy, unversioned
 *   JSON   "what IS this deck"    — every stored field, versioned, round-trips
 *
 * THREE COMMITMENTS, because this file is about to be read by somebody who
 * does not work on this codebase (algomancer.cc — see client/docs/deck-format.md,
 * which is this file written as a spec rather than as code):
 *
 *  1. STRICT ON WRITE, PERMISSIVE ON READ. `buildDeckFile` emits exactly the
 *     documented shape. `parseDeckFile` accepts that shape, the same shape
 *     from a newer version (unknown fields are ignored, not refused), a card
 *     entry written as a bare string, and — deliberately — algomancer.cc's own
 *     `/api/decks/<id>` response, because "paste the thing you have" is the
 *     whole point of an interchange format.
 *
 *  2. NAMES, NOT IDS, ARE THE CARD KEY. A deck file names cards the way the
 *     card is printed. Neither side's internal id survives the trip, and
 *     neither side has to know the other's. Resolving a name to a card this
 *     build can actually shuffle is the READER's job — server/decks.ts does it
 *     with the same normalise-and-look-up the text importer uses — so a deck
 *     file naming a card nobody scripts is a deck file with a note attached,
 *     never a failed import.
 *
 *  3. NOTHING DERIVED IS WRITTEN. If a field can be recomputed from `cards`
 *     by anybody holding card data, it is not in the file.
 *
 *     This started out the other way — v1 carried a `stats` block with the
 *     curve, the element share, the affinity ceiling and the legality, on the
 *     theory that a reader with no card database could use it for a link
 *     preview. Cut before it ever shipped (owner, 2026-09-20: *"do we need to
 *     export the stats? Those should be able to be calculated by any system,
 *     right?"*), and the reasoning is worth keeping because the same
 *     temptation will come back:
 *
 *       · the reader this format exists for HAS a card database — a better
 *         one than this build's, in algomancer.cc's case. The hypothetical
 *         reader without one was never anybody.
 *       · it roughly doubled the file for a 30-card deck, all of it
 *         restatement.
 *       · a copy of derived data is a copy that can be WRONG. A hand-edited
 *         or third-party file could say `legal: true` over an illegal list,
 *         and the only defence is to ignore the field — at which point why
 *         write it. There was a test whose whole job was to prove the list
 *         wins over the stats; the field it defended against is gone and so
 *         is the failure mode.
 *
 *     `record` is NOT an exception to this: a deck's win/loss where it was
 *     exported from cannot be recomputed from its card list by anyone. It is
 *     data, not restatement — advisory only because nobody's win rate means
 *     anything on another system's games.
 *
 * PURE AND DOM-FREE. server/decks.ts imports this module to read a pasted
 * file, so it compiles without `lib: DOM` — engine/test/282-dom-free-trio
 * is what says so out loud. That is also why `buildDeckFile` is handed an
 * `origin` rather than reaching for `location`.
 */
import { analyzeDeck } from './deckstats.ts';
import { rowFor } from './cardindex.ts';

/** The `format` field. A file without it is still read (see the header); a
 * file with a DIFFERENT one is refused, because it is somebody else's format
 * that happens to be JSON. */
export const DECK_FORMAT = 'algomancy-deck';

/** Bumped only for a change a version-1 reader could not survive. Adding a
 * field is not one of those — unknown fields are ignored on read, on purpose,
 * so that growing the format never breaks an older reader. */
export const DECK_FORMAT_VERSION = 1;

export type DeckVisibility = 'private' | 'unlisted' | 'public';

/** One distinct card and how many of it. */
export interface DeckFileEntry {
  name: string;
  quantity: number;
}

/** A deck as a file. Everything but `format`, `version`, `name` and `cards` is
 * optional: a writer omits what it does not have rather than writing a blank. */
export interface DeckFile {
  format: typeof DECK_FORMAT;
  version: number;
  name: string;
  /** the deck proper, one entry per distinct card */
  cards: DeckFileEntry[];
  /** the maybeboard — cards being considered. NOT a sideboard: Algomancy has
   * none, nothing here is shuffled into anything, and no deck rule applies to
   * it. algomancer.cc's `sideboard` is read into this field. */
  maybe?: DeckFileEntry[];
  /** what the deck is and how to play it. Markdown here; algomancer.cc's own
   * descriptions are plain text, which is valid markdown. */
  description?: string;
  /** who built it */
  author?: string;
  /** the card whose art represents the deck — its box, its thumbnail */
  cover?: string;
  /** …and a URL for that art, for a reader with no card images of its own.
   * `cover` is the field that means something; this is a convenience, and it
   * is NOT derived data — nobody outside this deploy can work out where its
   * scans live or what they are called. */
  coverImage?: string;
  /** where the list came from, when it came from somewhere (an algomancer.cc
   * deck link for a deck imported from there) */
  source?: string;
  /** who may see it ON THE SYSTEM THAT EXPORTED IT. A reader importing a file
   * decides its own visibility; this is history, not an instruction. */
  visibility?: DeckVisibility;
  /** the exporting system's own id for the deck, and a link that opens it */
  id?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  exportedAt?: string;
  /** what wrote the file */
  generator?: { app: string; version?: number };
  /** the deck's record where it was exported from, if it has one. Advisory:
   * nobody's win rate transfers to another system, and the importer here
   * drops it. Not derived — see the header's third commitment. */
  record?: { games: number; wins: number; losses: number };
}

// ── writing ───────────────────────────────────────────────────────────

/** What `buildDeckFile` needs: the stored deck, whatever shape holds it. */
export interface DeckSource {
  name: string;
  cards: readonly string[];
  maybe?: readonly string[];
  cover?: string | null;
  author?: string;
  description?: string;
  url?: string;
  visibility?: DeckVisibility;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  record?: { games: number; wins: number; losses: number };
}

export interface BuildOpts {
  /** where this deck lives, e.g. "https://algomancy.online" — used to make
   * `url` and `coverImage` absolute. Omitted, both are left out rather than
   * written as a relative path nobody else can resolve. */
  origin?: string;
  /** the scan filename for a card, when the caller can resolve one. Given
   * `origin`, it becomes `coverImage`. */
  artFile?: (name: string) => string;
  /** frozen in tests; defaults to now */
  now?: string;
}

/** Distinct cards and counts, cheapest first then alphabetical — the same
 * order `deckListText` writes, so the two exports read alike. */
export function entriesOf(cards: readonly string[]): DeckFileEntry[] {
  return analyzeDeck(cards).copies
    .sort((x, y) => (x.facts?.mana ?? 99) - (y.facts?.mana ?? 99) || x.name.localeCompare(y.name))
    .map(c => ({ name: c.name, quantity: c.n }));
}

/** The flat list a deck file's entries stand for — `entriesOf` undone. */
export function expandEntries(entries: readonly DeckFileEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    for (let i = 0; i < e.quantity; i++) out.push(e.name);
  }
  return out;
}

/** The scan filename for a card as this repo names them: the catalogue's own
 * `image` when it has one, else the name with spaces hyphenated. The same
 * derivation ui/decks.ts and ui/meta.ts use for a tile. */
export function artFileFor(name: string): string {
  return rowFor(name)?.image || name.replace(/ /g, '-') + '.jpg';
}

/** A deck as a deck file. */
export function buildDeckFile(deck: DeckSource, opts: BuildOpts = {}): DeckFile {
  const origin = (opts.origin ?? '').replace(/\/+$/, '');
  const cover = deck.cover ?? deck.cards[0] ?? undefined;
  const artFile = opts.artFile ?? artFileFor;
  const maybe = entriesOf(deck.maybe ?? []);
  return {
    format: DECK_FORMAT,
    version: DECK_FORMAT_VERSION,
    name: deck.name,
    cards: entriesOf(deck.cards),
    ...(maybe.length ? { maybe } : {}),
    ...(deck.description?.trim() ? { description: deck.description } : {}),
    ...(deck.author ? { author: deck.author } : {}),
    ...(cover ? { cover } : {}),
    ...(cover && origin ? { coverImage: `${origin}/data/cards/${artFile(cover)}` } : {}),
    ...(deck.url ? { source: deck.url } : {}),
    ...(deck.visibility ? { visibility: deck.visibility } : {}),
    ...(deck.id ? { id: deck.id } : {}),
    ...(deck.id && origin ? { url: `${origin}/?deck=${encodeURIComponent(deck.id)}` } : {}),
    ...(deck.createdAt ? { createdAt: deck.createdAt } : {}),
    ...(deck.updatedAt ? { updatedAt: deck.updatedAt } : {}),
    exportedAt: opts.now ?? new Date().toISOString(),
    generator: { app: 'algomancy.online', version: DECK_FORMAT_VERSION },
    ...(deck.record && deck.record.games
      ? { record: { games: deck.record.games, wins: deck.record.wins, losses: deck.record.losses } }
      : {}),
  };
}

/** A deck file as the text somebody copies. Indented: it is read by people. */
export const deckFileText = (file: DeckFile): string => JSON.stringify(file, null, 2);

// ── reading ───────────────────────────────────────────────────────────

/**
 * Is this text meant to be a deck file?
 *
 * Asked BEFORE parsing, by a caller that has a text list parser as its other
 * option (server/decks.ts). A leading `{` is the whole test on purpose: a card
 * list never starts with one, and anything that does and then fails to parse
 * should say "that JSON is broken" rather than be fed to a list parser that
 * will report thirty unknown cards.
 */
export const looksLikeDeckFile = (text: string): boolean => text.trim().startsWith('{');

export type ParseResult =
  | { ok: true; file: DeckFile; notes: string[] }
  | { ok: false; error: string };

const str = (v: unknown, max = 100_000): string =>
  typeof v === 'string' ? v.slice(0, max) : '';

const MAX_ENTRIES = 400;

/** One card entry, in any shape a reader might be handed it:
 *   "Ignis Sprite" · { name, quantity } · { name } · { cardId, quantity }
 * `slugs` maps an algomancer.cc cardId to its printed name when the payload
 * carried the mapping; an unmapped slug is passed through as a name, which is
 * exactly what the pool look-up normalises away. */
function entryOf(raw: unknown, slugs: Map<string, string>): DeckFileEntry | null {
  if (typeof raw === 'string') return raw.trim() ? { name: raw.trim(), quantity: 1 } : null;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o['cardId'] ?? o['id'], 200).trim();
  const name = (str(o['name'], 200).trim() || slugs.get(id) || id).trim();
  if (!name) return null;
  const n = Number(o['quantity'] ?? o['count'] ?? o['n'] ?? 1);
  return { name, quantity: Math.max(1, Math.min(99, Number.isFinite(n) ? Math.floor(n) : 1)) };
}

const entriesFrom = (raw: unknown, slugs: Map<string, string>): DeckFileEntry[] =>
  (Array.isArray(raw) ? raw.slice(0, MAX_ENTRIES) : [])
    .map(x => entryOf(x, slugs))
    .filter((x): x is DeckFileEntry => x !== null);

const VISIBILITIES: readonly string[] = ['private', 'unlisted', 'public'];

/**
 * Read a deck file.
 *
 * Accepts, in this order:
 *   · a deck file this module wrote (any version — see DECK_FORMAT_VERSION)
 *   · anything else carrying a top-level `cards` array of entries
 *   · algomancer.cc's `/api/decks/<id>` response, recognised by `deck.cards`
 *
 * `notes` is what a human should be told about the read but which did not stop
 * it — a newer format version, say. An empty `notes` is the ordinary case.
 */
export function parseDeckFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'that is not valid JSON — a deck file is a JSON object' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'a deck file is a JSON object, with a "cards" list in it' };
  }
  const o = raw as Record<string, unknown>;
  const notes: string[] = [];

  const format = str(o['format'], 100).trim();
  if (format && format !== DECK_FORMAT) {
    return { ok: false, error: `that is a "${format}" file, not an ${DECK_FORMAT} one` };
  }
  const version = Number(o['version'] ?? DECK_FORMAT_VERSION);
  if (Number.isFinite(version) && version > DECK_FORMAT_VERSION) {
    notes.push(`the file says format version ${version} and this build reads ${DECK_FORMAT_VERSION}`
      + ' — anything it does not recognise was left out');
  }

  // algomancer.cc's own deck payload: { deck: {...}, cards: [{id,name}], user }
  const inner = o['deck'];
  const isAlgomancer = !!inner && typeof inner === 'object' && !Array.isArray(inner)
    && Array.isArray((inner as Record<string, unknown>)['cards']);
  const deck = (isAlgomancer ? inner : o) as Record<string, unknown>;

  const slugs = new Map<string, string>();
  if (isAlgomancer && Array.isArray(o['cards'])) {
    for (const c of o['cards'] as Record<string, unknown>[]) {
      const id = str(c?.['id'], 200), name = str(c?.['name'], 200);
      if (id && name) slugs.set(id, name);
    }
  }

  const cards = entriesFrom(deck['cards'], slugs);
  if (!cards.length) return { ok: false, error: 'that deck file lists no cards' };
  const maybe = entriesFrom(deck['maybe'] ?? deck['sideboard'], slugs);

  const user = o['user'] as Record<string, unknown> | undefined;
  const author = str(deck['author'], 120).trim()
    || str(user?.['username'] ?? user?.['name'], 120).trim();

  const source = str(deck['source'] ?? deck['url'], 500).trim();
  const id = str(deck['id'] ?? deck['_id'], 120).trim();
  const vis = str(deck['visibility'], 40).trim();

  const file: DeckFile = {
    format: DECK_FORMAT,
    version: DECK_FORMAT_VERSION,
    name: str(deck['name'], 200).trim() || 'Imported deck',
    cards,
    ...(maybe.length ? { maybe } : {}),
    ...(str(deck['description'], 20_000).trim() ? { description: str(deck['description'], 20_000) } : {}),
    ...(author ? { author } : {}),
    ...(str(deck['cover'], 200).trim() ? { cover: str(deck['cover'], 200).trim() } : {}),
    ...(str(deck['coverImage'], 500).trim() ? { coverImage: str(deck['coverImage'], 500).trim() } : {}),
    // an algomancer.cc payload has no `source`, but its id IS the deck page
    ...(source ? { source }
      : isAlgomancer && /^[0-9a-f]{24}$/.test(id) ? { source: `https://www.algomancer.cc/decks/${id}` }
      : {}),
    ...(VISIBILITIES.includes(vis) ? { visibility: vis as DeckVisibility } : {}),
    ...(str(deck['createdAt'], 40) ? { createdAt: str(deck['createdAt'], 40) } : {}),
    ...(str(deck['updatedAt'], 40) ? { updatedAt: str(deck['updatedAt'], 40) } : {}),
  };
  return { ok: true, file, notes };
}
