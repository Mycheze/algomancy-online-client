/* R297 — LEARN TO PLAY: THE LEARNER'S DECK.
 *
 * The owner: *"Their 'deck' is just all the cards from a color, with the 'gold'
 * complex cards removed"* — and, from the planning interview, one of the five
 * base elements (no Light, no Dark), with cards whose mechanics no lesson
 * teaches left out (augment and graft stay: they are on nearly everything).
 *
 * One continuous game teaches every lesson, so the deck is STACKED: the top
 * of it is laid out turn by turn so that the card a lesson is about is in hand
 * around the turn that lesson is written for. The rest is a seeded shuffle of
 * the element's pool. A lesson still waits for its real moment in play (see
 * lessonflow.ts) — the stack only makes sure the moment comes.
 *
 * Pure: reads the card index, which may read the catalogue; the engine may not.
 */
import type { CardName } from '../engine/src/types.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { rngShuffle } from '../engine/src/rng.ts';
import { rowFor, type CardRow } from './cardindex.ts';

export const LEARN_ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal'] as const;
export type LearnElement = typeof LEARN_ELEMENTS[number];

export const LEARN_DECK_SIZE = 30;

/** Mechanics no lesson teaches. A card carrying one stays out of the deck. */
const UNTAUGHT_KEYWORDS = ['ambush', 'discard me', 'prophecy', 'unstable', 'debt', 'burst'];
/** …and two that are only in rules text. */
const UNTAUGHT_TEXT = /\b(glimpse|cache|cached)\b/i;

export const isLearnElement = (v: unknown): v is LearnElement =>
  typeof v === 'string' && (LEARN_ELEMENTS as readonly string[]).includes(v);

/** Every card the learner's deck may hold for this element. DECK_LIST order. */
export function learnerPool(el: LearnElement): CardRow[] {
  const out: CardRow[] = [];
  for (const n of DECK_LIST) {
    const r = rowFor(n);
    if (!r || r.factions.length !== 1 || r.factions[0] !== el) continue;
    if (r.complexityLc !== 'simple') continue;
    if (r.keywords.some(k => UNTAUGHT_KEYWORDS.includes(k))) continue;
    if (UNTAUGHT_TEXT.test(r.text)) continue;
    out.push(r);
  }
  return out;
}

/* What each lesson's card looks like. Exported for lessonflow.ts and the tests,
 * so "a battle spell" means one thing in the deck and in the trigger. */
export const isPlainUnit = (r: CardRow): boolean =>
  r.kind === 'unit' && r.timing === 'deploy' && !r.virus && !r.keywords.includes('graft');
export const hasAttribute = (r: CardRow): boolean => r.kind === 'unit' && r.attrs.length > 0;
export const isBattleCard = (r: CardRow): boolean => r.timing === 'battle' && !r.virus;
export const isVirus = (r: CardRow): boolean => r.virus;
export const isAugmentCard = (r: CardRow): boolean => r.augment || r.keywords.includes('augment');
export const isGraftCard = (r: CardRow): boolean => r.keywords.includes('graft');
export const isHasteCard = (r: CardRow): boolean => r.timing === 'haste';

/* The schedule's picks are EXCLUSIVE — a card is scheduled for the one lesson
 * it is about. Without this the "augment card" slot took the cheapest card
 * with [Augment] text, which was as often a haste unit, and the haste lesson
 * then fired on turn 3. */
const deployTiming = (r: CardRow): boolean => r.timing === 'deploy' && !r.virus;
const forAugment = (r: CardRow): boolean => isAugmentCard(r) && deployTiming(r) && !isGraftCard(r);
const forGraft = (r: CardRow): boolean => isGraftCard(r) && deployTiming(r);
const forHaste = (r: CardRow): boolean => isHasteCard(r) && !r.virus;

/** The stacked top of the deck, turn by turn. The learner starts with TWO
 * cards (the owner, after the first playtest: "so they aren't tempted to read
 * all the cards at first") and draws two a turn, so each turn is a pair. */
export const DECK_SCHEDULE: readonly { turn: number; want: ((r: CardRow) => boolean)[] }[] = [
  { turn: 1, want: [hasAttribute, isPlainUnit] },  // lesson 3b rides on the first
  { turn: 2, want: [isPlainUnit, isPlainUnit] },   // lesson 4: combat
  { turn: 3, want: [isBattleCard, isPlainUnit] },  // lesson 5: battle spells and the stack
  { turn: 4, want: [forAugment, isPlainUnit] },    // lesson 6: augmenting
  { turn: 5, want: [isVirus, forGraft] },          // lesson 6b viruses (after augmenting), 7 grafts
  { turn: 6, want: [forHaste, isPlainUnit] },      // lesson 8: haste
];

/**
 * The learner's 30 cards, top first. The schedule picks from the pool (cheapest
 * first, at most two copies), falling back to a plain unit when an element has
 * no card of a kind; the rest is the remaining pool, shuffled with `seed`, and
 * padded with second copies to the full size.
 */
export function buildLearnerDeck(el: LearnElement, seed: number): CardName[] {
  const pool = learnerPool(el);
  const byCost = [...pool].sort((a, b) => a.mana + a.pipCount - (b.mana + b.pipCount) || a.name.localeCompare(b.name));
  const used = new Map<string, number>();
  const take = (want: (r: CardRow) => boolean): CardName | null => {
    const r = byCost.find(c => want(c) && (used.get(c.name) ?? 0) < 1)
      ?? byCost.find(c => want(c) && (used.get(c.name) ?? 0) < 2);
    if (!r) return null;
    used.set(r.name, (used.get(r.name) ?? 0) + 1);
    return r.name;
  };
  const top: CardName[] = [];
  for (const { want } of DECK_SCHEDULE) {
    for (const w of want) {
      const n = take(w) ?? take(isPlainUnit) ?? take(() => true);
      if (n) top.push(n);
    }
  }
  const rest = pool.map(r => r.name).filter(n => !used.has(n));
  let [shuffled] = rngShuffle(rest, seed >>> 0);
  const deck = [...top, ...shuffled];
  // pad with second copies, still in a seeded order
  const seconds = pool.map(r => r.name).filter(n => (used.get(n) ?? 0) < 2);
  [shuffled] = rngShuffle(seconds, (seed ^ 0x5eed) >>> 0);
  for (const n of shuffled) {
    if (deck.length >= LEARN_DECK_SIZE) break;
    deck.push(n);
  }
  return deck.slice(0, LEARN_DECK_SIZE);
}
