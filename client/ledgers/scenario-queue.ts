/* R217 — THE SCENARIO QUEUE: which cards a human should test by hand, in order.
 *
 * `docs/14-scenario-tester.md` §7. The owner can judge roughly 40 cards an hour
 * and there are 495, so the order is the whole design: twelve hours of clicking
 * is not a plan, and three hours aimed at the right 120 is.
 *
 * ── WHY A HUMAN AT ALL ────────────────────────────────────────────────
 *
 * Every test in this repository can only assert what its author already
 * believed — `84-card-semantics.test.ts` says so in its own header, and the
 * round-28 correctness sample reaches 30 cards on the happy path. The owner is
 * the rules authority, so his verdict is ground truth in a way no assertion is.
 * This module decides what to put in front of him first.
 *
 * ── THE RANKING, AND WHERE EACH SIGNAL COMES FROM ─────────────────────
 *
 *   UNREACHED   the card has a printed promise the drill has NEVER observed
 *               being delivered. Imported from `unreached.ts`. 25 of the 37 are
 *               `BOARD` — "implemented, but the drill cannot build the
 *               precondition" — which is exactly what a human placing cards
 *               solves in seconds and a fixture cannot solve at all.
 *   AUGMENT     the card has an `[Augment]` box. R212 named the DONATED host
 *               path its single biggest hole: ten of the eleven augment cards
 *               in its sample are only ever checked on their own body, and
 *               "me"/"you" resolve differently on a host (R131).
 *   ruled×N     a ruling in digital-rules.md names the card N times. Cards that
 *               needed a ruling are weird by construction — that is why
 *               somebody had to rule on them.
 *   shapes      printed-text patterns that keep producing bugs: "that effect",
 *               "this way", "instead", "for each".
 *
 * ── THE BLINDNESS THIS MODULE WAS BORN FROM, AND THE RULE IT ENFORCES ──
 *
 * The first version of this ranking scraped `UNREACHED` out of
 * `84-card-semantics.test.ts` with `/^  '([^']+)':/` and read **32 keys where
 * the object has 37**. Five entries — Worldbender, Nothyr, Proph, Skybreaker,
 * Vengeance — are single-word card names written as BARE JS IDENTIFIERS, and
 * the pattern demanded a quote. Two independent scrapes agreed on 32; they
 * shared the assumption, not the answer.
 *
 * ⚠ **All five it dropped were `BOARD` entries, and two of them rank 3rd and
 * 4th.** A silent scrape failure was deleting the queue's best cards — which
 * would have cost the OWNER an hour of clicking, the one resource here that
 * cannot be parallelised.
 *
 * So: **this module imports the ledger and never parses a file.**
 * docs/13-assessment.md §7.2, and `187-scenario-queue.test.ts` asserts the
 * count so a drifted ledger fails loudly instead of shrinking the queue.
 */
import { allCardNames, getCard } from '../engine/src/cards/dsl.ts';
import { UNREACHED_CARDS, UNWITNESSED_CARDS, unreachedOpener } from './unreached.ts';

export interface QueueEntry {
  card: string;
  /** higher is more worth a human's ninety seconds */
  score: number;
  /** every signal that fired, for the runner to show and for a human to argue with */
  why: string[];
  /** carries an [Augment] box — used to interleave, see below */
  augment: boolean;
  /** the UNREACHED opener (BOARD / CHOICE / VOCAB / …), or null */
  unreached: string | null;
  /**
   * A human has already watched this card's unreached promise deliver, and
   * ruled on it (`unreached.ts` WITNESSED). Reported, deliberately NOT scored:
   * the ranking is round 28's and re-weighting it here would quietly reorder a
   * queue whose interleave and top-20 shape are asserted in 187. What this
   * does is stop the next author spending ninety seconds of the owner's time
   * re-confirming a card he confirmed on 2026-08-27.
   */
  witnessed: boolean;
}

/** Printed-text shapes that keep producing bugs. Deliberately coarse: this
 *  ranks, it does not diagnose. */
const SHAPES: readonly (readonly [string, RegExp])[] = [
  ['pronoun', /\bthat (effect|card|unit|spell|damage)\b|\bthis way\b/i],
  ['instead', /\binstead\b/i],
  ['foreach', /\bfor each\b|\bequal to\b/i],
  ['choose', /\bchoose\b|\bany target\b/i],
  ['zone', /\bbin\b|\bcache\b|\brecycle\b|\berase\b|\bgraft\b/i],
] as const;

/**
 * How many times the rules register names this card.
 *
 * ⚠ Word-boundary matched, and names shorter than five characters score ZERO.
 * "Rook", "Jelly", "Proph" and friends appear inside ordinary prose constantly,
 * and an unbounded substring count put Rook near the top of the first draft for
 * no reason at all. A signal that fires on the wrong thing is worse than a
 * missing one, because it looks like evidence.
 */
export function rulingWeight(card: string, register: string): number {
  if (card.length < 5) return 0;
  const re = new RegExp(`\\b${card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return (register.match(re) ?? []).length;
}

/** Score every card in the pool. `register` is docs/digital-rules.md's text. */
export function rankCards(register: string): QueueEntry[] {
  const unreached = new Map(UNREACHED_CARDS.map(c => [c, unreachedOpener(c)]));
  // DERIVED from the witness record, never a second hand-kept list — the
  // header of unreached.ts is a post-mortem of exactly that mistake.
  const unwitnessed = new Set(UNWITNESSED_CARDS);
  const out: QueueEntry[] = [];
  for (const card of allCardNames()) {
    const text = (getCard(card) as { text?: string }).text ?? '';
    const why: string[] = [];
    let score = 0;

    const opener = unreached.get(card) ?? null;
    if (opener) { score += 25; why.push(`UNREACHED:${opener}`); }
    // reported, not scored — see QueueEntry.witnessed
    const witnessed = opener !== null && !unwitnessed.has(card);
    if (witnessed) why.push('WITNESSED');

    const ruled = rulingWeight(card, register);
    if (ruled >= 2) { score += Math.min(ruled, 8) * 2; why.push(`ruled×${ruled}`); }

    const augment = /\[Augment\]/i.test(text);
    if (augment) { score += 8; why.push('AUGMENT-HOST'); }

    for (const [tag, re] of SHAPES) if (re.test(text)) { score += 3; why.push(tag); }
    if (text.split(/\s+/).length > 30) score += 2;

    if (score > 0) out.push({ card, score, why, augment, unreached: opener, witnessed });
  }
  out.sort((a, b) => b.score - a.score || a.card.localeCompare(b.card));
  return out;
}

/**
 * The queue the runner deals from.
 *
 * ⚠ INTERLEAVED, AND THAT IS NOT COSMETIC. Ranked purely by score the top is
 * almost solid `[Augment]` cards — the ranking agreeing with R212's independent
 * finding, not a coincidence. But a session that proves one mechanism deeply
 * and touches no others is a worse use of an hour than one that spreads: the
 * owner is looking for the cards that "only come up in game", and those are
 * distributed across mechanics. So never more than two augment cards in a row.
 */
export function buildQueue(register: string, limit = 120): QueueEntry[] {
  const ranked = rankCards(register);
  const aug = ranked.filter(r => r.augment);
  const non = ranked.filter(r => !r.augment);
  const queue: QueueEntry[] = [];
  let ai = 0, ni = 0, run = 0;
  while (queue.length < limit && (ai < aug.length || ni < non.length)) {
    const takeAug = run < 2 && ai < aug.length
      && (ni >= non.length || aug[ai]!.score >= non[ni]!.score);
    if (takeAug) { queue.push(aug[ai++]!); run++; }
    else if (ni < non.length) { queue.push(non[ni++]!); run = 0; }
    else { queue.push(aug[ai++]!); run++; }
  }
  return queue;
}
