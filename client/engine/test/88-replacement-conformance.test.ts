/* REPLACEMENT CONFORMANCE — a card that prints a replacement must be BUILT as
 * one, and must never reach the stack.
 *
 * THE RULE, in the owner's own words (playtest ledger #75, WEHH 2026-08-22):
 *
 *   "Replacement effects and triggered effects and static effects are being
 *    handled wrong by the system, still. The only cards that should ever
 *    produce effects that go onto the stack are cards that say 'When' or
 *    'Whenever' or have a ':' activated ability. All cards that say 'instead'
 *    or 'as' or 'if' shouldn't go onto the stack."
 *
 * Refined by him on 2026-08-23, and the refinement is the load-bearing half:
 *
 *   "Not an exception since it says 'target'. I guess I meant 'cards that say
 *    instead, as or if and don't mention targets'. Plus, rot damage is a
 *    trigger to deal you that damage anyway."
 *
 * So the printed word decides the mechanism, and "target" is the switch.
 *
 * WHY THIS IS A TEST AND NOT A SWEEP
 *
 * The owner reported this THREE TIMES. First as one card — #46, VEAV: "The 'I
 * get -2/-2' isn't a trigger that should go on the stack. It's a static
 * effect" — which was closed with a one-card fix to Bulborb. Then as a class,
 * twice: #60 ("We need a whole layer that deals with replacement effects") and
 * #75 above. A one-card fix is what makes a class of bug recur, and the pool
 * is 494 cards where the eye is not a search. 68-target-conformance exists for
 * exactly this reason and is the house pattern this file follows: every
 * exemption carries its reason inline, the exemption list is asserted to be
 * EXACTLY right, and an exemption that outlives its cause fails as loudly as a
 * card that breaks the rule.
 *
 * WHAT IT READS
 *
 * `getCard(name).text`, which is `printed.json` for every printed card and the
 * registered `Printed` block for a synthetic (Beyond, Codex Incarnate). Never
 * a hand-copy — that is the same rule the card files and card-ledger.ts run on,
 * and it is what makes this fail when a NEW card arrives printing "instead".
 *
 * ── THE TEXT PASS, AND THE FOUR ROUNDS OF NARROWING IT TOOK ──────────────
 *
 * The sibling extractor in claims.ts took four rounds to stop over-reporting,
 * and its header records them. This one took four too, measured over the whole
 * 494-card pool:
 *
 *  1. The owner's words taken literally — any sentence containing "instead",
 *     "as" or "if" — flags 63 CARDS. Almost none is a replacement. "if" is the
 *     commonest conditional word in the game ("if you do", "if I am in your
 *     bin", "if playing a constructed format") and "as" is mostly "as if it
 *     was in your hand" (Rook, Dispatch Courier, Slurpr, Abyssal Evocation) or
 *     "as an additional cost" — permissions and costs, not replacements.
 *  2. Dropping bare "if": 19 cards. Still wrong. "as" alone still catches every
 *     play-permission on the board, and "instead" alone catches Maelstrom
 *     Charger's and Insidious Invitation's ordinary effect text.
 *  3. Requiring the word "WOULD": 11 cards, and now they are nearly all real.
 *     "Would" is the game's word for a thing that has not happened yet, which
 *     is precisely what a replacement intercepts. The one survivor that is not
 *     a replacement is Phytochemical Protection, and R98 is explicit about why
 *     — PREVENTION IS NOT REPLACEMENT ("if there is not damage being dealt,
 *     then no counters are placed"), so it needs no "instead" and gets none.
 *  4. Requiring "would" AND "instead" in the SAME SENTENCE: 10 cards, all
 *     genuine, Phytochemical Protection correctly gone. The sentence bound
 *     matters — conditions do not carry across a full stop, and Skittering
 *     Blight's "When I spawn, gain a rot." must not be dragged into its
 *     [Augment] replacement.
 *
 * Then one ADDITION rather than a narrowing, for the owner's "as": the
 * substitution shape "deals X as Y" (Blightsea Polyp, "Columns deal combat
 * damage to players as 1 rot") is a replacement that never says "would". It is
 * verb-anchored — `deal|deals|dealt` … `as` — precisely so it cannot catch
 * "as if it was in your hand", and over the whole pool it matches exactly one
 * card. 11 cards in total.
 *
 * ── WHAT IT ASSERTS ─────────────────────────────────────────────────────
 *
 * For a replacement clause that names NO target:
 *   (a) the card declares a member of the R104 replacement layer, and
 *   (b) if EVERY sentence it prints is a replacement clause, the card declares
 *       no triggered and no activated abilities AT ALL — the only two things
 *       that can reach the stack from a unit in play.
 *
 * (b) is per-CARD rather than per-clause on purpose, and it needs no exemption
 * list to let Skittering Blight through: that card prints "When I spawn, gain a
 * rot." as a separate sentence, so its text is not all replacement and it is
 * allowed the trigger that sentence names. A card whose WHOLE text is a
 * replacement has nothing a stack item could be for.
 *
 * For a replacement clause that DOES name a target, the assertion inverts:
 * the card must declare a triggered ability, because a target has to be chosen
 * and choosing is public and respondable. That is R102 (Beyond, Codex
 * Incarnate), and this file is what stops somebody "fixing" it into the other
 * shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// R214: the PUBLIC entry point, not `cards/registry.ts`. registry.ts registers
// only 494 of the 495 cards — the third synthetic (`Alluring Attribute`) is
// registered by `src/apply.ts`, which index.ts pulls. See the pool-sight floor
// at the foot of this file and test/180-pool-sight.test.ts.
import '../src/index.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { CardDef } from '../src/cards/dsl.ts';

// ── the text pass ───────────────────────────────────────────────────────

/**
 * Printed text with REMINDER TEXT REMOVED, exactly as claims.ts and
 * 71-card-ledger's `meaningfulText` do it. Italic parentheticals restate rules
 * rather than adding them — Cosmic Conspirator's "(With the same X value.)" is
 * a note about the swap the sentence already described — and counting one
 * would be counting the same clause twice.
 */
function rulesText(c: CardDef): string {
  return (c.text ?? '')
    .replace(/\{i\}\s*\([^)]*\)\s*(\{\/i\})?/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\{\/?[a-z0-9]+\}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** the card's rules text as sentences. A condition does not carry across a
 *  full stop (claims.ts learned the same thing the same way), so the sentence
 *  is the unit a clause is judged in. */
const sentences = (t: string): string[] => t.split(/(?<=\.)\s+/).filter(s => s.trim());

/**
 * Is this sentence a REPLACEMENT CLAUSE? See the four rounds in the header.
 *
 *  · "would" + "instead" — the substitution shape, and 10 of the 11.
 *  · "deal(s|t) … as …" — the same substitution said without "would"
 *    (Blightsea Polyp). Verb-anchored so "as if it was in your hand" cannot
 *    match it.
 */
export function isReplacementClause(s: string): boolean {
  if (/\bwould\b/i.test(s) && /\binstead\b/i.test(s)) return true;
  return /\b(?:deals?|dealt)\b[^.]*\bas\b/i.test(s);
}

/** does the clause NAME A TARGET? The owner's switch, in one predicate. */
const namesTarget = (s: string): boolean => /\btargets?\b/i.test(s);

/** every replacement clause a card prints */
function replacementClauses(name: string): string[] {
  return sentences(rulesText(getCard(name))).filter(isReplacementClause);
}

// ── the declaration side ────────────────────────────────────────────────

/** R104: the whole replacement layer, as a list. A card that prints a
 *  replacement must be built out of one of these. Adding a hook to
 *  `CardBehavior` and forgetting this line makes the sweep report a card that
 *  really was fixed, which is the failure direction that gets noticed. */
const REPLACEMENT_KEYS = [
  // R162: the MULTIPLICATIVE amount family, beside R104's additive one. Same
  // reason as the comment above — a hook added to CardBehavior and left out of
  // this line makes the sweep report a card that really was fixed.
  'amountMods', 'amountMultipliers', 'replaceLifeGain', 'replaceCounters',
  'replaceTokenCreation', 'replaceTokenBatch',
  'replaceRotDamage', 'replaceCombatDamageToPlayer',
] as const;

const declaresReplacement = (name: string): boolean => {
  const c = getCard(name) as unknown as Record<string, unknown>;
  // R268: nine of the eleven cards in this class print their whole text inside
  // an [Augment] box, so the hook is declared in `augmentBox`. Reading only the
  // body half turned this sweep's population into "nobody builds replacements".
  const box = (c.augmentBox ?? {}) as Record<string, unknown>;
  return REPLACEMENT_KEYS.some(k => c[k] !== undefined || box[k] !== undefined);
};

/** the two things that can put an item on the stack from a card in play: a
 *  triggered ability ("When"/"Whenever") and an activated one (":"). */
function stackReachingAbilities(name: string): string[] {
  const c = getCard(name);
  return [
    ...(c.abilities ?? []).map((a, i) => `abilities[${i}] (${a.type})`),
    ...(c.augmentText ?? []).map((a, i) => `augmentText[${i}] (${a.type})`),
  ];
}

/** every card in the pool that prints at least one replacement clause */
const REPLACEMENT_CARDS = allCardNames().filter(n => replacementClauses(n).length > 0);

// ── exemptions ──────────────────────────────────────────────────────────

/**
 * Cards the classifier flags whose SHAPE is nonetheless correct, each with the
 * reason. Kept tiny on purpose: every name here is a hole in the net.
 *
 * The list is asserted to be EXACTLY right below — 68-target-conformance's
 * rule — so an entry that stops being needed fails just as loudly as a card
 * that stops obeying the rule.
 */
const EXEMPT: Record<string, string> = {
  'Skittering Blight':
    'Not an exemption from the RULE, only from the "whole text is a replacement" '
    + 'shortcut. It prints TWO sentences — "When I spawn, gain a rot." and the '
    + '[Augment] rot replacement — so the trigger it declares belongs to the first '
    + 'one and the replacement to `replaceRotDamage`. The sweep still requires the '
    + 'replacement half to be declared, and it is.',
};

/**
 * Cards whose replacement clause NAMES A TARGET, and which therefore DO use
 * the stack. R102, and the reason it is not an exception: "A target has to be
 * chosen, and a choice is public and respondable — there is nowhere else for
 * it to happen." Listed rather than derived so that a new one has to be
 * justified out loud.
 */
const TARGETED: Record<string, string> = {
  'Beyond, Codex Incarnate':
    '"If you would take damage from rot, put that many -1/-1 counters on TARGET unit '
    + 'instead." — R102. The hook (`replaceRotDamage`) returns true and fires a '
    + '`rotReplaced` EVENT; an ordinary `self: true` triggered ability listens for it '
    + 'and the existing R67 machinery does the asking. The owner ruled it in as many '
    + 'words: "It would trigger, ask you what you want to target, then put the -1/-1 '
    + 'counters on during deployment (which still has and uses a stack)."',
};

// ── the assertions ──────────────────────────────────────────────────────

test('the classifier finds the replacement clauses, and only those', () => {
  // A floor on the CLASSIFIER itself. If a narrowing round ever goes one step
  // too far, the assertions below all pass vacuously and nobody notices — so
  // the eleven cards the owner's two reports are about are named here, and the
  // sweep has to still see every one of them.
  const known = [
    // playtest ledger #60's list, verbatim
    'Automaton of Abundance', 'Cosmic Conspirator', 'Nullbringer', 'Counter Thief',
    'Flux Resonator', 'Proliferating Slime', 'Conduit of Pain',
    // the three the engine already had (R38/R98/R102)
    'Skittering Blight', 'Blightsea Polyp', 'Oorblak', 'Beyond, Codex Incarnate',
  ];
  const missed = known.filter(n => !REPLACEMENT_CARDS.includes(n));
  assert.deepEqual(missed, [],
    'the text pass stopped recognising these as replacements:\n  ' + missed.join('\n  ')
    + '\n\nIf a narrowing round did this, it went too far — every assertion below '
    + 'would now pass by seeing nothing.');
  assert.equal(REPLACEMENT_CARDS.length, known.length,
    `the pool has ${REPLACEMENT_CARDS.length} cards printing a replacement clause and this `
    + `test knows about ${known.length}: ${REPLACEMENT_CARDS.filter(n => !known.includes(n)).join(', ')}`
    + '. A NEW card printing "would … instead" is a new member of this class — add it here '
    + 'and make sure it is built as a replacement, not as a trigger.');
});

test('a replacement that names NO target is built out of the replacement layer', () => {
  const problems: string[] = [];
  for (const name of REPLACEMENT_CARDS) {
    const untargeted = replacementClauses(name).filter(s => !namesTarget(s));
    if (!untargeted.length) continue;
    if (declaresReplacement(name)) continue;
    problems.push(
      `${name} prints "${untargeted[0]}" and declares none of ${REPLACEMENT_KEYS.join('/')}`);
  }
  assert.deepEqual(problems, [],
    'these cards print a replacement with no target and are not built as replacements:\n  '
    + problems.join('\n  ')
    + '\n\nThe owner, playtest ledger #75: "All cards that say instead, as or if [and '
    + 'don\'t mention targets] shouldn\'t go onto the stack." Build it with an AmountMod '
    + '(the quantity changes) or a named replaceX hook (the thing itself changes) — see '
    + 'R104. Do NOT reach for a trigger; that is the bug being reported.');
});

test('a card whose whole text is an untargeted replacement declares NO ability at all', () => {
  // The negative half, and the one that actually catches the reported bug: a
  // triggered or activated ability is the only way a unit in play puts an item
  // on the stack, and a card that prints nothing but a targetless replacement
  // has nothing for such an item to be.
  const problems: string[] = [];
  for (const name of REPLACEMENT_CARDS) {
    if (name in EXEMPT || name in TARGETED) continue;
    const all = sentences(rulesText(getCard(name)));
    if (!all.every(isReplacementClause)) continue;          // mixed text: see EXEMPT
    if (all.some(namesTarget)) continue;                    // see TARGETED
    const abilities = stackReachingAbilities(name);
    if (abilities.length) problems.push(`${name} declares ${abilities.join(', ')}`);
  }
  assert.deepEqual(problems, [],
    'these cards print ONLY a targetless replacement and still declare something that '
    + 'reaches the stack:\n  ' + problems.join('\n  ')
    + '\n\nThat is playtest ledger #60 and #75, and the live consequence is that '
    + 'Containment Protocol ("negate all activated and triggered effects") and Nothyr '
    + '("negate up to one target nonspell effect") can NEGATE a replacement, which never '
    + 'uses the stack and cannot be responded to.');
});

test('a replacement that DOES name a target still uses the stack (R102 stays R102)', () => {
  // The other direction, and the reason it is a test: "target" is the owner's
  // switch, so a well-meaning sweep of "no replacement may be a trigger" would
  // break Beyond, Codex Incarnate. This is what stops that.
  const problems: string[] = [];
  for (const name of Object.keys(TARGETED)) {
    const targeted = replacementClauses(name).filter(namesTarget);
    if (!targeted.length) {
      problems.push(`${name} is listed as a TARGETED replacement but prints no target in one`);
      continue;
    }
    if (!declaresReplacement(name)) {
      problems.push(`${name} names a target but declares no replacement hook to fire from`);
    }
    const triggers = (getCard(name).abilities ?? []).filter(a => a.type === 'triggered');
    if (!triggers.length) {
      problems.push(
        `${name} prints "${targeted[0]}" and declares no triggered ability — a target has to `
        + 'be CHOSEN, and choosing is public and respondable, so this one belongs on the stack');
    }
  }
  assert.deepEqual(problems, []);
});

test('every exemption is still needed — one that outlives its cause fails here', () => {
  // 68-target-conformance's rule, for 68's reason: an exemption list nobody
  // re-reads becomes a list of things that used to be true.
  const problems: string[] = [];
  for (const [name, why] of Object.entries(EXEMPT)) {
    if (!why.trim()) problems.push(`${name} is exempt with no reason given`);
    if (!REPLACEMENT_CARDS.includes(name)) {
      problems.push(`${name} is exempt but no longer prints a replacement clause at all — `
        + 'the exemption has outlived its cause; delete it');
      continue;
    }
    // the exemption is "its text is not ALL replacement". If that stops being
    // true the card is back in the strict class and the entry has to go.
    const all = sentences(rulesText(getCard(name)));
    if (all.every(isReplacementClause)) {
      problems.push(`${name}'s whole text is a replacement now, so the "mixed text" exemption `
        + 'no longer applies — either it obeys the strict rule or the reason has to be rewritten');
    }
  }
  for (const [name, why] of Object.entries(TARGETED)) {
    if (!why.trim()) problems.push(`${name} is listed as targeted with no reason given`);
    if (!REPLACEMENT_CARDS.includes(name)) {
      problems.push(`${name} no longer prints a replacement clause — delete its TARGETED entry`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the layer is NARROW on purpose: every replaceX hook has a consulting site in the engine', () => {
  // `replaceRotDamage`'s own comment argues for this and R104 keeps it:
  // "Deliberately a one-off hook, not a replacement framework". A hook nothing
  // consults is worse than no hook — it reads as implemented. This is the
  // greppability of the layer, asserted.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const engine = fs.readFileSync(path.join(here, '..', 'src', 'engine.ts'), 'utf8');
  const orphans = REPLACEMENT_KEYS.filter(k => !engine.includes(`.${k}`));
  assert.deepEqual(orphans, [],
    'these replacement hooks are declared on CardBehavior and read nowhere in the engine:\n  '
    + orphans.join('\n  ')
    + '\n\nA card that declares one would look implemented and do nothing, which is the '
    + 'exact shape of the Harbinger of Immolation incident (see ledgers/card-ledger.ts).');
});

test('the tally: how much of the pool is a replacement, printed on every run', () => {
  const untargeted = REPLACEMENT_CARDS.filter(n => replacementClauses(n).some(s => !namesTarget(s)));
  const targeted = REPLACEMENT_CARDS.filter(n => replacementClauses(n).some(namesTarget));
  console.log(
    `    REPLACEMENTS: ${REPLACEMENT_CARDS.length} of ${allCardNames().length} cards — `
    + `${untargeted.length} never reach the stack, ${targeted.length} do (they name a target)`);
  console.log(`    exemptions: ${Object.keys(EXEMPT).length}`);
  assert.ok(REPLACEMENT_CARDS.length > 0, 'the classifier found nothing at all');
});

// ── R214 · POOL SIGHT ───────────────────────────────────────────────────
//
// This file sweeps the WHOLE card pool. `src/cards/registry.ts` is the natural
// card entry point and it registers 494 of the 495 cards: two of the three
// `registerSynthetic` calls are its own, and the third — `Alluring Attribute`
// — is in `src/apply.ts`. Eight sweeps imported registry.ts alone, saw 494,
// and NOT ONE OF THEM ASSERTED A POOL SIZE, so every clean sheet they produced
// silently covered one card fewer than it claimed.
//
// The floor is what stops that being reintroduced by an import change nobody
// reads as a behaviour change. `test/180-pool-sight.test.ts` holds the same
// floor for the whole suite and the guard that catches a ninth sweep.
test('R214: this sweep sees the whole card pool', () => {
  const n = allCardNames().length;
  assert.ok(n >= 496,
    `this sweep sees ${n} cards, not the full 496 — its imports reach src/cards/registry.ts `
    + 'but not src/apply.ts, so the synthetic Alluring Attribute is invisible to it and every '
    + 'verdict above covers one card fewer than it says. Import ../src/index.ts.');
  assert.ok(allCardNames().includes('Alluring Attribute'),
    'the pool is big enough but Alluring Attribute is not in it — the count floor above has '
    + 'been satisfied by some other card, which is not the thing being guarded');
});
