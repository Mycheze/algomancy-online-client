/* Constructed deck sources: the bundled default decks (with attribution to
 * their algomancer.cc builders) and the importer that turns an algomancer.cc
 * deck link or a pasted list into engine card names.
 *
 * algomancer.cc's own format is the source of truth here — a deck page
 * https://www.algomancer.cc/decks/<24-hex-id> is backed by the JSON API
 * /api/decks/<id>, whose response carries the deck ({cardId, quantity}), a
 * cards[] array mapping each cardId slug to its display name, and the
 * builder's username. Display names match the engine's card names, so the
 * mapping below is a normalize-and-look-up, not a hand-kept table.
 *
 * THREE WAYS IN, ONE WAY OUT. A link (importDeckUrl), a pasted card list
 * (importDeckText) and a pasted deck FILE (importDeckFile) all end as a
 * `DeckInfo`, and `importDeckPaste` is the dispatcher the API routes call so
 * that "the paste box" is one box rather than three. What every one of them
 * shares is `resolveName`: a card is matched by its printed NAME, normalised,
 * against the pool this build actually scripts. No id, ours or anybody's,
 * crosses the boundary — see ui/deckformat.ts's second commitment.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeck } from '../engine/src/apply.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import type { CardName } from '../engine/src/types.ts';
import { expandEntries, looksLikeDeckFile, parseDeckFile, type DeckFile } from '../ui/deckformat.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * What the client gets to pick from / import: a named, attributed list —
 * plus, since the deck file format, everything ELSE a deck carries.
 *
 * The three fields below the line are the ones a rich import brings and a
 * text import cannot. They are optional because the text importer really does
 * know none of them, and a caller that writes `description ?? ''` into a new
 * deck would quietly blank the field on every pasted list.
 */
export interface DeckInfo {
  name: string;
  author: string;
  /** where it came from (an algomancer.cc link for imports/defaults) */
  url?: string;
  cards: CardName[];
  /** import trouble, human-readable — empty means the deck is playable */
  problems: string[];

  /** markdown; what the deck is and how to play it */
  description?: string;
  /** the card whose art represents the deck */
  cover?: CardName;
  /** the maybeboard — algomancer.cc's `sideboard` lands here */
  maybe?: CardName[];
}

/** "A Pile of Runes" and "a-pile-of-runes" both normalize to "apileofrunes" */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const POOL = new Map<string, CardName>();
for (const n of DECK_LIST) POOL.set(norm(n), n);

/** engine name for an algomancer card name/slug, or null if unscripted */
const resolveName = (raw: string): CardName | null => POOL.get(norm(raw)) ?? null;

/** deck-rule problems (min 30 / max 2) as warnings appended to `problems` */
function ruleProblems(cards: CardName[]): string[] {
  const c = checkDeck(cards);
  return c.ok ? [] : [c.error];
}

// ── bundled default decks ─────────────────────────────────────────────

let defaults: DeckInfo[] | null = null;

/** The checked-in test decks (server/default-decks.json — built by aramsunat
 * on algomancer.cc). Re-validated against the live pool at first use so a
 * card-pool change shows up as a problem instead of a broken game. */
export function defaultDecks(): DeckInfo[] {
  if (defaults) return defaults;
  const raw = JSON.parse(readFileSync(join(HERE, 'default-decks.json'), 'utf8')) as
    { url: string; name: string; author: string; cards: string[] }[];
  defaults = raw.map(d => {
    const cards: CardName[] = [];
    const problems: string[] = [];
    for (const nm of d.cards) {
      const hit = resolveName(nm);
      if (hit) cards.push(hit);
      else problems.push(`not in the scripted pool: ${nm}`);
    }
    problems.push(...ruleProblems(cards));
    return { name: d.name, author: d.author, url: d.url, cards, problems };
  });
  return defaults;
}

// ── importing ─────────────────────────────────────────────────────────

/** the deck id in an algomancer.cc link (or a bare pasted id) */
export function algomancerDeckId(url: string): string | null {
  const m = /(?:^|\/decks\/)([0-9a-f]{24})(?:$|[/?#])/.exec(url.trim());
  return m ? m[1]! : null;
}

interface AlgomancerDeckResponse {
  deck?: {
    name?: string;
    /** plain text over there, which is valid markdown over here */
    description?: string;
    cards?: { cardId?: string; quantity?: number }[];
    /** their sideboard is our maybeboard — neither is a sideboard in the
     * Magic sense, because Algomancy has none */
    sideboard?: { cardId?: string; quantity?: number }[];
  };
  cards?: { id?: string; name?: string }[];
  user?: { username?: string };
}

/** Fetch a deck from algomancer.cc by link/id. Throws on network trouble. */
export async function importDeckUrl(url: string): Promise<DeckInfo> {
  const id = algomancerDeckId(url);
  if (!id) throw new Error('that does not look like an algomancer.cc deck link (…/decks/<id>)');
  const resp = await fetch(`https://www.algomancer.cc/api/decks/${id}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`algomancer.cc answered ${resp.status} for deck ${id}`);
  const data = await resp.json() as AlgomancerDeckResponse;
  const entries = data.deck?.cards;
  if (!Array.isArray(entries) || !entries.length) throw new Error('algomancer.cc returned no card list for that deck');
  const slugToName = new Map<string, string>();
  for (const c of data.cards ?? []) {
    if (c.id && c.name) slugToName.set(c.id, c.name);
  }
  /** their card entries → our names, collecting what we cannot script */
  const resolveEntries = (
    list: { cardId?: string; quantity?: number }[], problems: string[],
  ): CardName[] => {
    const out: CardName[] = [];
    for (const entry of list) {
      const raw = slugToName.get(entry.cardId ?? '') ?? entry.cardId ?? '';
      const hit = resolveName(raw);
      const qty = Math.max(1, Math.min(99, Number(entry.quantity) || 1));
      if (hit) for (let i = 0; i < qty; i++) out.push(hit);
      else problems.push(`not in the scripted pool: ${raw || '(unnamed card)'}`);
    }
    return out;
  };
  const problems: string[] = [];
  const cards = resolveEntries(entries, problems);
  // A card missing from the SHELF is not worth a complaint — the deck is still
  // the deck — so the maybeboard's misses go nowhere.
  const maybe = resolveEntries(data.deck?.sideboard ?? [], []);
  problems.push(...ruleProblems(cards));
  const description = (data.deck?.description ?? '').trim();
  return {
    name: data.deck?.name || `algomancer.cc deck ${id}`,
    author: data.user?.username || 'unknown builder',
    url: `https://www.algomancer.cc/decks/${id}`,
    cards, problems,
    ...(description ? { description } : {}),
    ...(maybe.length ? { maybe } : {}),
  };
}

/** Parse a pasted list: one card per line, optional leading count
 * ("2 Ignis Sprite", "2x Ignis Sprite", or just "Ignis Sprite"). Blank lines
 * and #/// comments are skipped. */
export function importDeckText(text: string): DeckInfo {
  const cards: CardName[] = [];
  const problems: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = /^(\d+)\s*[xX]?\s+(.+)$/.exec(line);
    const qty = m ? Math.max(1, Math.min(99, Number(m[1]))) : 1;
    const name = (m ? m[2]! : line).trim();
    const hit = resolveName(name);
    if (hit) for (let i = 0; i < qty; i++) cards.push(hit);
    else problems.push(`unknown card: ${name}`);
  }
  if (!cards.length && !problems.length) problems.push('the pasted list is empty');
  problems.push(...ruleProblems(cards));
  return { name: 'Pasted deck', author: 'you', cards, problems };
}

/**
 * Import a deck FILE — the rich format (ui/deckformat.ts), and algomancer.cc's
 * own `/api/decks/<id>` response, which that module also reads.
 *
 * Everything the file says about itself survives except two things, and both
 * omissions are deliberate:
 *
 *  - VISIBILITY DOES NOT TRANSFER. A file that was public where it was written
 *    says so, and this reads it as history rather than as an instruction. Who
 *    may see the deck on THIS system is decided by the account that imports it
 *    (collection.ts), not by a string in a pasted file.
 *  - NEITHER DOES THE RECORD. A win rate belongs to the games that produced it.
 *
 * A card the file names and this build does not script is a note, not a
 * failure — same as every other importer here.
 */
export function importDeckFile(text: string): DeckInfo {
  const parsed = parseDeckFile(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return deckInfoOf(parsed.file, parsed.notes);
}

/** A parsed deck file, resolved against the pool this build scripts. */
function deckInfoOf(file: DeckFile, notes: string[] = []): DeckInfo {
  const problems = [...notes];
  const resolve = (names: string[], complain: boolean): CardName[] => {
    const out: CardName[] = [];
    for (const raw of names) {
      const hit = resolveName(raw);
      if (hit) out.push(hit);
      else if (complain) problems.push(`not in the scripted pool: ${raw}`);
    }
    return out;
  };
  const cards = resolve(expandEntries(file.cards), true);
  const maybe = resolve(expandEntries(file.maybe ?? []), false);
  problems.push(...ruleProblems(cards));
  const cover = file.cover ? resolveName(file.cover) : null;
  return {
    name: file.name,
    author: file.author || 'you',
    ...(file.source ? { url: file.source } : {}),
    cards, problems,
    ...(file.description?.trim() ? { description: file.description } : {}),
    // a cover naming a card that was left out of the list would be a deck
    // wearing art it does not play; collection.ts picks a new one for us
    ...(cover && cards.includes(cover) ? { cover } : {}),
    ...(maybe.length ? { maybe } : {}),
  };
}

/**
 * What the paste box means by "paste a deck": a deck file, or a card list.
 *
 * ONE DISPATCHER, because there is one box. `looksLikeDeckFile` decides on the
 * leading `{` alone and never falls back: text that opens a JSON object and
 * then fails to parse must say so, rather than being handed to the list parser
 * — which would dutifully report thirty unknown cards named `"name":` and tell
 * nobody that the real problem was a missing brace.
 */
export function importDeckPaste(text: string): DeckInfo {
  return looksLikeDeckFile(text) ? importDeckFile(text) : importDeckText(text);
}
