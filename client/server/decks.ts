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
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeck } from '../engine/src/apply.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import type { CardName } from '../engine/src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** What the client gets to pick from / import: a named, attributed list. */
export interface DeckInfo {
  name: string;
  author: string;
  /** where it came from (an algomancer.cc link for imports/defaults) */
  url?: string;
  cards: CardName[];
  /** import trouble, human-readable — empty means the deck is playable */
  problems: string[];
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
  deck?: { name?: string; cards?: { cardId?: string; quantity?: number }[] };
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
  const cards: CardName[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    const raw = slugToName.get(entry.cardId ?? '') ?? entry.cardId ?? '';
    const hit = resolveName(raw);
    const qty = Math.max(1, Math.min(99, Number(entry.quantity) || 1));
    if (hit) for (let i = 0; i < qty; i++) cards.push(hit);
    else problems.push(`not in the scripted pool: ${raw || '(unnamed card)'}`);
  }
  problems.push(...ruleProblems(cards));
  return {
    name: data.deck?.name || `algomancer.cc deck ${id}`,
    author: data.user?.username || 'unknown builder',
    url: `https://www.algomancer.cc/decks/${id}`,
    cards, problems,
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
