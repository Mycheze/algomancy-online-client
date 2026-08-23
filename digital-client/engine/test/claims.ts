/**
 * WHAT A CARD PROMISES — printed text turned into checkable claims.
 *
 * WHY THIS EXISTS
 *
 * The owner, 2026-08-23, on the first pass of the card drill:
 *
 *   "I don't just want cards to 'be played and do something'. They need to do
 *    what they're SUPPOSED to do."
 *
 * That is the right correction. The drill proves a card is reachable, runs and
 * emits something; it cannot tell "deals 3 damage" from "draws a card". Both
 * satisfy "did something". So this module reads the PRINTED TEXT — the same
 * `printed.json` the card files are built from, never a hand-copy — and turns
 * it into typed promises that the engine's own event stream can be checked
 * against.
 *
 * THE MATCH IS AGAINST EVENT TYPES, NOT LOG PROSE
 *
 * `EngineEvent.type` is a closed vocabulary the engine already maintains
 * (`damage`, `draw`, `lifeGained`, `tokenCreated`, `countersChanged`,
 * `negated`, `erased`, `rotGained`, …). Checking a claim against a TYPE is
 * stable under rewording; checking it against a log message would break every
 * time somebody improves a sentence, and a test that breaks on prose gets
 * deleted. Where the claim carries a number, the number is checked too — that
 * is what separates "it dealt damage" from "it dealt the RIGHT damage".
 *
 * CONDITIONAL vs UNCONDITIONAL, AND WHY IT MATTERS
 *
 * "Draw a card" must happen every time the card resolves. "When I die, draw a
 * card" must not — the drill's board may never kill it. Scoring those the same
 * way would either produce a wall of false failures or force the assertion
 * down to nothing. So every claim records whether it sits behind a trigger or
 * a condition, and the suite REQUIRES only the unconditional ones while
 * counting the rest, out loud, as unobserved.
 *
 * This is a FLOOR, not a proof of correctness. A card that prints "deal 3
 * damage to target unit" and deals 3 to the wrong unit satisfies its claim
 * here. Narrowing that is per-card work; what this catches is the much larger
 * class of card that promises a specific thing and delivers nothing like it.
 */
import { getCard } from '../src/cards/dsl.ts';
import type { EventType } from '../src/types.ts';

export type ClaimKind =
  | 'damage' | 'draw' | 'gainLife' | 'loseLife' | 'create' | 'pump' | 'counters'
  | 'destroy' | 'erase' | 'recall' | 'discard' | 'sacrifice' | 'glimpse'
  | 'control' | 'negate' | 'rot' | 'debt' | 'trash' | 'cache';

export interface Claim {
  kind: ClaimKind;
  /** the promised amount, when the text states one. 'X' means chosen at cast. */
  n?: number | 'X';
  /** the clause it came from, for the failure message */
  raw: string;
  /** true when the clause sits behind a trigger ("When…", "Whenever…"), a
   *  condition ("if…"), an activated ability (":") or an optional ("you may") */
  conditional: boolean;
}

/** the event type(s) that would evidence each kind of claim */
export const EVIDENCE: Record<ClaimKind, EventType[]> = {
  damage: ['damage', 'combatDamage'],
  draw: ['draw'],
  gainLife: ['lifeGained'],
  loseLife: ['lifeLost', 'damage'],
  // a created body is a 'spawned'; 'tokenCreated' is dispatched separately and
  // not every creation site emits it, so both count
  create: ['tokenCreated', 'spawned'],
  pump: ['statChanged'],
  counters: ['countersChanged', 'statChanged'],
  destroy: ['died', 'despawned', 'trashed'],
  erase: ['erased', 'despawned', 'trashed'],
  // recall has no event type of its own — it moves a card to hand, which is a
  // zone change the drill sees as a hand delta rather than an event
  recall: [],
  discard: ['trashed'],
  sacrifice: ['died', 'trashed'],
  glimpse: ['glimpsed', 'cached'],
  control: [],
  negate: ['negated', 'fizzled'],
  rot: ['rotGained'],
  debt: ['debtGained'],
  trash: ['trashed'],
  cache: ['cached', 'prophesied'],
};

/** claims whose evidence is a STATE delta rather than an event */
export const STATE_EVIDENCE: Partial<Record<ClaimKind, 'hand' | 'control' | 'stats' | 'counters'>> = {
  recall: 'hand',
  control: 'control',
  // a CONTINUOUS static ("Your units gain +1/+0 for each …") changes effective
  // stats without ever emitting a statChanged event — it is a layer, not an
  // action. Reading the stat delta is the only evidence such a clause can have.
  pump: 'stats',
  counters: 'counters',
};

const WORD_N: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
};
const num = (s: string | undefined): number | 'X' | undefined => {
  if (!s) return undefined;
  const k = s.toLowerCase();
  if (k === 'x') return 'X';
  if (k in WORD_N) return WORD_N[k];
  const v = Number(k);
  return Number.isFinite(v) ? v : undefined;
};

/**
 * The printed text with the parts that are NOT promises removed: reminder
 * text in parentheses (it restates an engine-side rule, it is not a clause the
 * card has to implement) and the markup tokens.
 */
export function rulesText(card: string): string {
  const c = getCard(card);
  return (c.text ?? '')
    .replace(/\{i\}\s*\([^)]*\)\s*(\{\/i\})?/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\{\/?[a-z0-9]+\}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this clause GATED — that is, can the card resolve without it happening?
 *
 * The first version of this asked only whether a condition appeared BEFORE the
 * clause in its sentence, and it was wrong three ways at once. All three were
 * found by running it: 66 cards reported an unmet promise and almost none of
 * them was a real defect.
 *
 *  · `[Augment]` text is only live when the card is used as an augment. The
 *    drill casts the body, so nothing in that text box is owed. (Animated
 *    Spark, Soul Swallower, Debt Blep, Spawning Ground …)
 *  · An ACTIVATED ability gates its whole line, including the cost that sits
 *    to the LEFT of the colon: "Sacrifice X units: Create X Fireball 1" owes
 *    neither the sacrifice nor the Fireballs until somebody activates it. The
 *    colon has to gate the sentence, not just what follows it — this alone was
 *    16 of the false sacrifices and 7 of the discards.
 *  · A bracketed `[…]` clause is a COST or a marker, never a promise.
 *  · Delayed triggers ("At the end of turn …") are gated on reaching that step.
 */
function isConditional(sentence: string, upto: number, fullText: string, at: number): boolean {
  const head = sentence.slice(0, upto).toLowerCase();
  const whole = sentence.toLowerCase();
  // "if" / "unless" / "up to" gate the clause from EITHER side — the qualifier
  // routinely trails it ("… unless its controller gains debt", "Negate up to
  // one target effect", "you also lose 3 life if playing a constructed format")
  if (/\b(unless|up to|if )\b/.test(whole)) return true;
  // [Augment] anywhere before this clause puts it in the augment text box
  if (/\[augment\]/i.test(fullText.slice(0, at))) return true;
  // An activated ability gates its entire line, cost included — and it gates
  // the sentences that FOLLOW it too. Prismatic Observer is "Sacrifice me:
  // [Switch1] Recall up to one target cached card. You gain 3 life." — the
  // life gain is a second sentence, so a per-sentence test alone declared it
  // owed on a card that has to be activated before anything happens at all.
  if (whole.includes(':') || fullText.slice(0, at).includes(':')) return true;
  // the clause is inside brackets — a cost, not an effect
  const open = fullText.lastIndexOf('[', at);
  const close = fullText.lastIndexOf(']', at);
  if (open > close) return true;
  return /\b(when|whenever|if|after|unless|may|instead|as long as|while|at the end|at the start|each turn|would)\b/
    .test(head);
}

const PATTERNS: { kind: ClaimKind; re: RegExp; amount?: number }[] = [
  { kind: 'damage', re: /deals?\s+(\d+|x)\s+damage/gi, amount: 1 },
  { kind: 'draw', re: /draws?\s+(a|an|one|two|three|\d+|x)\s+cards?/gi, amount: 1 },
  { kind: 'gainLife', re: /gains?\s+(\d+|x)\s+life/gi, amount: 1 },
  { kind: 'loseLife', re: /loses?\s+(\d+|x)\s+life/gi, amount: 1 },
  { kind: 'create', re: /creates?\s+(a|an|one|two|three|four|\d+|x)\b/gi, amount: 1 },
  { kind: 'counters', re: /([+-]\d+\/[+-]\d+)\s+counters?/gi },
  { kind: 'pump', re: /(?:gets?|gains?)\s+([+-]\d+)\/([+-]\d+)/gi },
  { kind: 'destroy', re: /\b(?:destroy|delete|deletes)\b/gi },
  { kind: 'erase', re: /\berase[sd]?\b/gi },
  { kind: 'recall', re: /\brecalls?\b/gi },
  { kind: 'discard', re: /\bdiscards?\b(?!\s+me)/gi },
  { kind: 'sacrifice', re: /\bsacrifices?\b/gi },
  { kind: 'glimpse', re: /\bglimpses?\s+(\d+|x)\b/gi, amount: 1 },
  { kind: 'control', re: /gains?\s+control\b/gi },
  { kind: 'negate', re: /\bnegates?\b/gi },
  { kind: 'rot', re: /\bgains?\s+(\d+|x)?\s*rot\b/gi, amount: 1 },
  { kind: 'debt', re: /\bgains?\s+(\d+|x)?\s*debt\b/gi, amount: 1 },
  { kind: 'cache', re: /\bcaches?\b|\bprophes(?:y|ies)\b/gi },
];

/** every promise this card's printed text makes */
export function claimsOf(card: string): Claim[] {
  const text = rulesText(card);
  if (!text) return [];
  const out: Claim[] = [];
  for (const { kind, re, amount } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      // THE WHOLE SENTENCE, both sides of the clause. The first version sliced
      // from the previous full stop to the END OF THE MATCH, so everything to
      // the right was invisible — which meant "Sacrifice me: Create a Poison 1"
      // never saw its own colon and "you also lose 3 life if playing a
      // constructed format" never saw its own "if". Nine of the first run's 24
      // survivors were that one bug. Conditions still do not carry across a
      // full stop, so "When I die, X. Draw a card." leaves the draw owed.
      const start = text.lastIndexOf('.', at) + 1;
      const endDot = text.indexOf('.', at + m[0].length);
      const sentence = text.slice(start, endDot === -1 ? text.length : endDot + 1);
      // a NEGATED verb is not a promise: Infernal Wispweaver's wisps "do not
      // sacrifice themselves after combat" promises the opposite of a sacrifice
      const before = text.slice(Math.max(0, at - 12), at).toLowerCase();
      if (/\b(not|never|don't|do)\s*$/.test(before)) continue;
      out.push({
        kind,
        n: amount ? num(m[amount]) : undefined,
        raw: m[0].trim(),
        conditional: isConditional(sentence, at - start, text, at),
      });
    }
  }
  // one claim per (kind, n) — "deals 2 damage … deals 2 damage" is one promise
  // as far as evidence goes, and duplicates would just inflate the tally
  const seen = new Set<string>();
  return out.filter(c => {
    const k = `${c.kind}:${c.n ?? ''}:${c.conditional}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
