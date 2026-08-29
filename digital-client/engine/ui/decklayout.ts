/* HOW A DECK IS LAID OUT — one answer, for every surface that shows one.
 *
 * The owner, 2026-08-29:
 *
 *   "When viewing other people's decks, it's hard to really visualize things
 *    since it's just a flat list: the decks should be auto sorted by cost, and
 *    split by spells/units, with a few other view options. And instead of
 *    showing a x2 for cards with 2 copies, actually show two of those cards,
 *    just stacked. But this should actually be default on deck building pages
 *    too."
 *
 * ⚠ WHY THIS IS A MODULE AND NOT A FUNCTION IN `ui/meta.ts`. The bucketing it
 * replaces already existed — inline, in `ui/decks.ts::groupedTiles` — and the
 * shared deck page had NONE, which is exactly the complaint. Copying the
 * builder's version into the meta page would have made two projections of one
 * idea, and `ui/deckstats.ts`'s own header says what that costs: *"two
 * projections of one record is how the deck page and the browser end up
 * disagreeing about what a card costs."* One module, both callers.
 *
 * ⚠ AND SORTING IS NOT PART OF THE GROUPING CHOICE. "Auto sorted by cost" is
 * unconditional: whatever you group by, the cards inside a section are in cost
 * order. The old inline version sorted alphabetically inside every bucket,
 * which is why a "3 mana" bucket read fine and a "fire" bucket read as noise.
 */
import type { CardFacts, DeckAnalysis } from './deckstats.ts';
import { ELEMENTS } from './deckstats.ts';

/**
 * How the cards are split into sections.
 *
 *  · `type`    — units, then spells, then spell units. THE DEFAULT, and the
 *                shape the owner asked for by name.
 *  · `cost`    — one section per mana value, cheapest first.
 *  · `element` — one per element (or element pair).
 *  · `flat`    — one section. Still cost-ordered; this is "no grouping", not
 *                "no sorting", because an unsorted list is the thing being fixed.
 */
export type DeckGrouping = 'type' | 'cost' | 'element' | 'flat';

export const GROUPINGS: { id: DeckGrouping; label: string; hint: string }[] = [
  { id: 'type', label: 'Units / spells', hint: 'split by what the card is, then cost order' },
  { id: 'cost', label: 'Cost', hint: 'one row per mana value' },
  { id: 'element', label: 'Element', hint: 'split by element, then cost order' },
  { id: 'flat', label: 'One list', hint: 'no split — still in cost order' },
];

export interface DeckEntry {
  name: string;
  /** how many copies — the thing that used to be a "×2" chip */
  n: number;
  facts: CardFacts | null;
}

export interface DeckSection {
  key: string;
  label: string;
  /** total CARDS, copies counted — not distinct names */
  cards: number;
  entries: DeckEntry[];
}

/**
 * Cost order, and the two edges that make it a real comparator rather than a
 * subtraction:
 *
 *  · an X card has no mana value to sort by (`mana` is 0 for one, which would
 *    file it with the free cards and read as a lie), so X sorts AFTER
 *    everything numbered — you can always pay more into it.
 *  · a card the engine does not script has no facts at all and sorts last, so
 *    an unknown never silently claims to be a 0-drop.
 *
 * Ties break on name so the order is stable and a repaint never reshuffles.
 */
export function byCost(a: DeckEntry, b: DeckEntry): number {
  const rank = (e: DeckEntry): number => (!e.facts ? 1e6 : e.facts.isX ? 1e5 : e.facts.mana);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

/** which section a card belongs to, and where that section sorts */
function bucketOf(f: CardFacts | null, grouping: DeckGrouping): { key: string; label: string; sort: number } {
  if (grouping === 'flat') return { key: 'all', label: 'All cards', sort: 0 };
  if (grouping === 'cost') {
    if (!f) return { key: 'unknown', label: 'not in this build', sort: 999 };
    if (f.isX) return { key: 'X', label: 'X cost', sort: 998 };
    return { key: String(f.mana), label: `${f.mana} mana`, sort: f.mana };
  }
  if (grouping === 'element') {
    if (!f || !f.factions.length) return { key: 'none', label: 'no element', sort: 99 };
    const key = f.factions.join('/');
    // a hybrid sorts after both of its single-element neighbours, so the
    // mono sections read down the element order and the pairs follow
    return { key, label: key, sort: ELEMENTS.indexOf(f.factions[0] ?? '') * 10 + (f.factions.length - 1) };
  }
  // 'type' — the owner's "split by spells/units". A spell unit is neither, and
  // gets its own section rather than being filed under a half-truth.
  if (!f) return { key: 'unknown', label: 'not in this build', sort: 9 };
  if (f.kind === 'spellUnit') return { key: 'spellUnits', label: 'Spell units', sort: 2 };
  if (f.kind === 'spell') return { key: 'spells', label: 'Spells', sort: 1 };
  return { key: 'units', label: 'Units', sort: 0 };
}

/**
 * The deck, in sections, in the order they should be drawn.
 *
 * Empty sections do not appear — a deck with no spell units has no "Spell
 * units" heading. (Contrast `DeckAnalysis.curve`, which is deliberately dense
 * because a GAP in a curve is information; a missing section is not.)
 */
export function deckSections(a: DeckAnalysis, grouping: DeckGrouping): DeckSection[] {
  const byKey = new Map<string, DeckSection & { sort: number }>();
  for (const c of a.copies) {
    const b = bucketOf(c.facts, grouping);
    const sec = byKey.get(b.key)
      ?? { key: b.key, label: b.label, sort: b.sort, cards: 0, entries: [] };
    sec.entries.push({ name: c.name, n: c.n, facts: c.facts });
    sec.cards += c.n;
    byKey.set(b.key, sec);
  }
  return [...byKey.values()]
    .sort((x, y) => x.sort - y.sort || x.label.localeCompare(y.label))
    .map(({ sort: _sort, ...sec }) => ({ ...sec, entries: sec.entries.sort(byCost) }));
}

/**
 * COPIES ARE DRAWN, NOT COUNTED.
 *
 * *"instead of showing a x2 for cards with 2 copies, actually show two of those
 * cards, just stacked."* So a tile with N copies gets N−1 offset layers behind
 * its art, and the badge that used to say the number goes away.
 *
 * ⚠ THE BADGE STAYS FOR AN ILLEGAL COUNT. Two copies is the cap, and a deck
 * holding three (an import, say) draws three cards — but three overlapping
 * corners is not a thing anybody counts at a glance, and "you have too many of
 * this" is precisely the case that must not be left to the eye. Over the cap
 * the number comes back, in red, ON TOP of the stack. `ui/decks.ts` documents
 * the same rule for the greyed tile: the cap is an affordance, not a gate.
 *
 * Returns the layer indexes to draw BEHIND the front card, nearest last.
 */
export function stackLayers(n: number, cap = 3): number[] {
  // ⚠ capped at TWO ghosts, and the cap is geometric rather than aesthetic:
  // each copy steps half a card to the right inside a tile two columns wide,
  // so a third ghost would translate 150% and hang off the end of the cell.
  // Anything past the cap is illegal anyway and is reported as a number.
  const behind = Math.max(0, Math.min(n, cap) - 1);
  return Array.from({ length: behind }, (_, i) => behind - i);
}

/** does this tile still need a number on it? */
export const needsCountBadge = (n: number, cap = 2): boolean => n > cap;
