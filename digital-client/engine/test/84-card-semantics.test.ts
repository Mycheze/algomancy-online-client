/**
 * DOES THE CARD DO WHAT IT SAYS?
 *
 * The owner, 2026-08-23, on the first pass of the card drill:
 *
 *   "I don't just want cards to 'be played and do something'. They need to do
 *    what they're SUPPOSED to do."
 *
 * `81-card-drill` proves a card is reachable, runs and emits something. It
 * cannot tell "deals 3 damage" from "draws a card" — both satisfy "did
 * something". This file closes that: `claims.ts` reads the PRINTED text out of
 * printed.json and turns it into typed promises, the drill plays the card, and
 * each promise is checked against the engine's own event vocabulary
 * (`damage`, `draw`, `tokenCreated`, `negated`, `erased`, …) plus the state
 * delta for the clauses that are continuous rather than eventful.
 *
 * WHAT IT FOUND — AND WHAT BECAME OF IT
 *
 * A whole dead CLASS that neither the shape sweep nor the drill could see:
 * **"Erase me" was unimplemented on four of the six cards that print it.**
 * Collect Remains, Temporal Rift, Suspend and Skybreaker all printed a
 * self-erase and none of them erased anything. The two that already worked
 * were Spore of Regenesis (where erasing is a COST) and Zephyrzoa (in its
 * [Augment] box), which is why the detection below reads augment and graft
 * text — and, since Skybreaker, activation COSTS — as well as the spell
 * effect: a narrower check would have accused a working card.
 * The card-ledger's shape sweep could not see it because those runs contained
 * real, working code for their other half, and the drill could not see it
 * because the card did do *something*.
 *
 * It mattered in a real game rather than only on paper: the erased pile is a
 * zone cards leave the game through (R65), so a spell that should erase itself
 * and instead goes to the bin stays recurrable and keeps counting toward every
 * "cards in your bin" effect. Collect Remains is a bin-recursion spell that is
 * supposed to remove itself, which made it the worst of the four.
 *
 * All four were fixed under CARD-TODO #15. The class-level assertion at the
 * bottom of this file is kept, inverted to "nobody prints a self-erase without
 * one", so a new card that forgets the clause fails on arrival and a deleted
 * implementation fails as a regression. 89-self-erase.test.ts holds the
 * per-card behaviour.
 *
 * HONEST LIMITS, STATED UP FRONT
 *
 * This is a FLOOR, not a proof of correctness. A card that prints "deal 3
 * damage to target unit" and deals 3 to the WRONG unit passes here. What it
 * catches is the far commoner defect: a card that promises a specific,
 * countable thing and delivers nothing of the kind. Only UNCONDITIONAL claims
 * are required — a clause behind "When…", "if…", an activated ability's colon
 * or an `[Augment]` box may legitimately not fire on the drill's board, and
 * demanding those would produce a wall of false failures. The conditional ones
 * are counted out loud instead.
 *
 * WHAT THE GATED COUNT IS FOR — CARD-TODO #49 (R171)
 *
 * "Counted out loud" was 316 promises in one heap, which is a number nobody
 * can plan against. Each gated claim now says WHY it is gated (`Claim.gate`),
 * and the tally prints the partition: 152 need a graft host, 110 need an event
 * fixture, 35 need an activation, 19 need a board. Stage 2 built the
 * activation — the drill pays the cost and takes `activateAbility` out of
 * `legalActions` like any other action — and all 35 are delivered.
 *
 * Evidence for a gated claim is ATTRIBUTED: it must come from a run that could
 * have satisfied the gate. That is a tightening. Scored the old loose way,
 * Oracle of the Flame's "Sacrifice me: Create a Fireball 1" was evidenced by
 * Oracle's own body arriving on a run where nothing was activated at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { drillCard, drillable } from './drill.ts';
import {
  claimsOf, EVIDENCE, STATE_EVIDENCE, rulesText, gateOf,
  TRIGGER_WORDS, CONDITION_WORDS, type Claim, type ClaimGate,
} from './claims.ts';
import { E } from '../src/engine.ts';
import type { GameState, Seat } from '../src/types.ts';

function lonelyBoard(s: GameState, seat: Seat): void {
  const e = new E(s);
  for (const b of ['Tidal Menace', 'The Foretold', 'Bubb', 'Curio Drifter']) {
    try { e.spawnUnit(seat, b, e.homeRegion(seat), {}); } catch { /* unregistered */ }
  }
  const p = s.players[seat]!;
  p.bin.push('Tidal Menace', 'The Foretold', 'Curio Drifter', 'Immolate');
  try { e.settle(); } catch { /* a spawn trigger may suspend */ }
}

const SCENARIOS: Parameters<typeof drillCard>[2][] = [
  { bait: true }, {}, { setup: lonelyBoard },
];

/** does the card declare an activated ability of its OWN — one somebody can
 *  pay for and put on the stack once the body is in play? Distinguished from
 *  the `[Augment]`-box activated abilities (29 cards), which need a HOST
 *  before anybody can activate anything, and from the twelve SPELLS whose
 *  colon is an additional CAST cost (`[Switch1] /[Sacrifice a unit]: Draw a
 *  card`) paid during the cast rather than by a later activation. */
function hasOwnActivated(card: string): boolean {
  return (getCard(card).abilities ?? []).some(a => a.type === 'activated');
}

/** what the card was observed doing, across every board state */
interface Observed {
  types: Set<string>; changed: Set<string>; played: boolean;
  /** evidence from strictly AFTER one of this card's own abilities was
   *  activated, and only up to that activation resolving — see `activateTypes`
   *  in drill.ts for why the window has to be cut at both ends */
  actTypes: Set<string>; actChanged: Set<string>;
  /** the drill actually paid for and activated an ability of this card */
  activated: boolean;
}

function observe(card: string): Observed {
  const types = new Set<string>();
  const changed = new Set<string>();
  const actTypes = new Set<string>();
  const actChanged = new Set<string>();
  let played = false;
  let activated = false;
  const runs = [...SCENARIOS];
  // CARD-TODO #49 stage 2. The extra run is targeted rather than universal:
  // it is only meaningful where something can be activated, and running the
  // patient activate loop over all 347 cards would pay for 600 steps of
  // phase-walking on every card that has no ability at all.
  const wantsActivation = hasOwnActivated(card) || claimsOf(card).some(c => c.gate === 'activated');
  if (wantsActivation) runs.push({ activate: true });
  for (const opts of runs) {
    let r;
    try { r = drillCard(card, 900_000, opts); } catch { continue; }
    if (r.played) played = true;
    for (const t of r.effectTypes) types.add(t);
    for (const c of r.changed) changed.add(c);
    if (r.newEntities.length) types.add('spawned');
    if (r.activated.length) activated = true;
    for (const t of r.activateTypes) actTypes.add(t);
    for (const c of r.activateChanged) actChanged.add(c);
  }
  return { types, changed, played, actTypes, actChanged, activated };
}

function evidenced(c: Claim, types: Set<string>, changed: Set<string>): boolean {
  if (EVIDENCE[c.kind].some(t => types.has(t))) return true;
  const st = STATE_EVIDENCE[c.kind];
  if (st === 'hand') return [...changed].some(x => x.startsWith('hand'));
  if (st === 'control') return [...changed].some(x => x.includes('control'));
  if (st === 'stats') return [...changed].some(x => x.includes('stats'));
  if (st === 'counters') return [...changed].some(x => x.includes('counters'));
  return false;
}

/**
 * Was this promise observed being delivered — by a run that could actually
 * satisfy its GATE?
 *
 * The attribution is the point, and it is a TIGHTENING, not a loosening. The
 * evidence a claim is scored against used to be "anything this card was seen
 * doing in any run", which for a gated clause is barely evidence at all:
 * Oracle of the Flame prints "Sacrifice me: Create a Fireball 1", and the
 * arrival of Oracle's own body is a `spawned`, so its ability read as
 * delivered on a run where nobody activated anything. So:
 *
 *  · `augment` — the clause is live only on a HOST. No scenario grafts yet
 *    (CARD-TODO #49 stage 4), so NOTHING can evidence these and they are
 *    scored 0 rather than credited to the body's own doings.
 *  · `activated`, on a card with an ability of its own — only the window that
 *    opens at the activation and closes when it resolves.
 *  · `activated`, on a spell whose colon is a CAST cost — the cost is paid
 *    during the cast, so the ordinary post-play window is the right one.
 *  · `trigger` / `condition` / ungated — the ordinary post-play window.
 */
function met(c: Claim, o: Observed, card: string): boolean {
  if (c.gate === 'augment') return false;
  if (c.gate === 'activated' && hasOwnActivated(card)) return evidenced(c, o.actTypes, o.actChanged);
  return evidenced(c, o.types, o.changed);
}

const POOL = allCardNames().filter(drillable);
const observations = new Map<string, Observed>();
const unmet = new Map<string, Claim[]>();
/** every GATED promise that no run could evidence, by gate — CARD-TODO #49 */
const unobserved = new Map<ClaimGate, { card: string; claim: Claim }[]>();
/** gate → [observed, total] */
const partition = new Map<ClaimGate | 'OWED', [number, number]>();

test('drive every card and check it against its printed promises', () => {
  for (const card of POOL) {
    const claims = claimsOf(card);
    if (!claims.length) continue;
    const o = observe(card);
    observations.set(card, o);
    const missing = claims.filter(c => !c.conditional && !met(c, o, card));
    if (missing.length) unmet.set(card, missing);
    for (const c of claims) {
      const g = c.gate ?? 'OWED';
      const row = partition.get(g) ?? [0, 0];
      row[1]++;
      if (met(c, o, card)) row[0]++;
      else if (c.gate) (unobserved.get(c.gate) ?? unobserved.set(c.gate, []).get(c.gate)!).push({ card, claim: c });
      partition.set(g, row);
    }
  }
  assert.ok(observations.size > 300, 'the semantic pass covers the pool');
});

/**
 * Every card whose unconditional promise the drill could not evidence, with
 * the reason. Two kinds live here and the difference is the whole point:
 *
 *   REAL   — the clause is not implemented. Each carries a CARD-TODO id.
 *   BOARD  — the clause is implemented but the drill's board cannot satisfy
 *            it (X resolves to 0, there are no mods to erase, both players
 *            have the same life). These are the limit of a generic driver,
 *            not defects, and each says which precondition is missing.
 *
 * The list is asserted to be EXACTLY right in both directions below, so a
 * card cannot quietly join it and an entry cannot outlive its reason.
 */
const KNOWN_UNMET: Record<string, string> = {
  // (The "Erase me" class — Collect Remains, Temporal Rift, Suspend — used to
  // head this list as REAL defects under CARD-TODO #15. They implement the
  // clause now: `ctx.eraseSelf()` redirects the spell's disposal to the erased
  // pile, so the drill observes the `erased` event and the entries are gone.
  // 89-self-erase.test.ts is what keeps them gone.)

  // ── BOARD: implemented, but the drill cannot create the precondition ──
  'Soul Siphon':
    'BOARD — "Create an X/X unit, where X is the life target player lost in this '
    + 'battle". No life has been lost on the drill\'s board, so X is 0 and creating '
    + 'nothing is correct. The card says so: "X = 0 — no unit created."',
  'Retribution Thing':
    'BOARD — X is "the life you have lost or gained in this battle", which is 0 here. '
    + 'The card announces it: "your life has not moved this battle — X is 0."',
  'Return to Nature':
    'BOARD — "Negate all effects. Erase all mods." The drill\'s board has no mods in '
    + 'play, and it announces the no-op rather than resolving in silence.',
  'Suppression Field':
    'BOARD — "Erase all of its mods and negate all of its effects" on a target that '
    + 'has neither. The attribute-stripping half IS observed.',
  'Containment Protocol':
    'BOARD — "Negate all activated and triggered effects". The bait on the stack is a '
    + 'SPELL effect, so there is correctly nothing of that kind to negate.',
  'Insatiable Want':
    'BOARD — "Each player with an even life total sacrifices a unit. Each player with '
    + 'an odd life total draws a card." Both players are on 30, so the sacrifice half '
    + 'fires and the draw half correctly does not.',
  'Calming Force':
    'BOARD — R100: "I can\'t be played from your hand", so it is never cast and its '
    + 'negate is never owed. Same exemption as UNREACHABLE in 81-card-drill.',
  Robot:
    'BOARD — "I spawn with X +1/+1 counters on me" is applied by the CREATING effect '
    + '(spawnUnit(..., { counters: X })), not by the token. The drill spawns it with '
    + 'X = 0. Already declared NOT_A_GAP in 71-card-ledger for the same reason.',
};

test('no card silently fails to deliver an unconditional printed promise', () => {
  const surprises: string[] = [];
  for (const [card, claims] of unmet) {
    if (card in KNOWN_UNMET) continue;
    surprises.push(`${card} — promises ${claims.map(c => `${c.kind}${c.n !== undefined ? `(${c.n})` : ''} "${c.raw}"`).join(', ')}`
      + `; printed: "${rulesText(card)}"`);
  }
  assert.deepEqual(surprises.sort(), [],
    'these cards print a promise that nothing in the game was observed delivering:\n  '
    + surprises.join('\n  ')
    + '\n\nEither the clause is unimplemented (open a CARD-TODO item and add it here as '
    + 'REAL), or the drill cannot create its precondition (add it here as BOARD, saying '
    + 'which precondition is missing). Do NOT widen claims.ts to make it disappear.');
});

test('every KNOWN_UNMET entry is still needed, and still says which kind it is', () => {
  const stale: string[] = [];
  for (const [card, why] of Object.entries(KNOWN_UNMET)) {
    if (!/^(REAL|BOARD)/.test(why)) stale.push(`${card}: must open with REAL or BOARD`);
    if (/^REAL/.test(why) && !/CARD-TODO #\d+/.test(why)) {
      stale.push(`${card}: a REAL entry must cite its CARD-TODO id`);
    }
    if (!unmet.has(card)) {
      stale.push(`${card} now delivers its promise — delete this entry`
        + (/^REAL/.test(why) ? ' and close its CARD-TODO item' : ''));
    }
  }
  assert.deepEqual(stale, []);
});

// ── the self-erase class, asserted directly ─────────────────────────────

test('the "Erase me" class is exactly the four cards CARD-TODO #15 names', () => {
  // Read off the printed text rather than the todo list, so a NEW card that
  // prints a self-erase and forgets to implement it fails here on arrival
  // instead of joining a class nobody is counting.
  const printsSelfErase = allCardNames().filter(n => /erase\s+(me|this spell|itself)/i.test(getCard(n).text ?? ''));
  const implementsIt = (n: string): boolean => {
    const c = getCard(n);
    const src = [c.spellEffect?.run, ...(c.abilities ?? []).map(a => a.effect?.run),
      ...(c.augmentText ?? []).map(a => a.effect?.run), c.graftEffect?.effect?.run]
      .map(f => (f ? f.toString() : '')).join('');
    // CARD-TODO #15: an "Erase me:" that is an activation COST is a DECLARATION
    // (`cost: { eraseSelf: true }`), not code inside a run(), so a source scan
    // alone cannot see it — Skybreaker would read as dead forever. Costs are
    // read too, on abilities and on [Augment]-box abilities alike.
    const costs = [...(c.abilities ?? []), ...(c.augmentText ?? [])]
      .some(a => a.type === 'activated' && a.cost.eraseSelf === true);
    return costs || /erase/i.test(src);
  };
  const dead = printsSelfErase.filter(n => !implementsIt(n)).sort();
  // NONE, as of CARD-TODO #15. This list used to read
  // ['Collect Remains', 'Skybreaker', 'Suspend', 'Temporal Rift'] — the four
  // cards that printed a self-erase and did not have one. All four implement
  // it now, by two different mechanisms: three are SPELLS redirecting their own
  // disposal (`ctx.eraseSelf()` → `StackItem.eraseSelf` → `E.dischargeItem`),
  // and Skybreaker's is an activation COST (`AbilityCost.eraseSelf`).
  //
  // The detection is unchanged and still reads augmentText and graftEffect as
  // well as the spell effect: Zephyrzoa prints "recall your bin and erase me"
  // in its [Augment] box and implements it there, and a narrower check would
  // accuse a working card. Skybreaker is the reason it also reads a cost —
  // see below.
  assert.deepEqual(dead, [],
    'the set of cards printing a self-erase with no erase in their code has changed. '
    + 'A card here either lost its implementation (a regression — 89-self-erase names '
    + 'which one) or is a NEW card that prints the clause and forgot to honour it.');
  // THE POSITIVE CONTROLS, so an empty `dead` cannot mean "the check broke".
  // The list must be non-empty and every card on it must be seen implementing
  // its clause — if `implementsIt` ever silently returned true for everything,
  // `dead` would be empty for the wrong reason and only this half would say so.
  assert.ok(printsSelfErase.length >= 6,
    `only ${printsSelfErase.length} cards read as printing a self-erase — the printed-text `
    + 'scan has lost its reach, so an empty `dead` above proves nothing');
  assert.ok(implementsIt('Spore of Regenesis'),
    'Spore of Regenesis erases as a COST and is the proof this detection works at all');
  assert.ok(implementsIt('Zephyrzoa'),
    'Zephyrzoa erases in its [Augment] box — the reason the check reads augmentText');
});

// ── CARD-TODO #49 stage 1: WHY each gated promise is gated ──────────────

/**
 * THE BLIND-CHECK ON THE PARTITION.
 *
 * Splitting `conditional` into four named gates is only safe if it is exactly
 * that — a split. If a future edit widened `TRIGGER_WORDS` or dropped a
 * predicate out of `gateOf`, claims would quietly move from "gated" to "owed"
 * (a wall of false failures) or, far worse, from "owed" to "gated", which is
 * the failure mode CARD-TODO #49 warns about twice: the unchecked count going
 * down because the EXTRACTOR got weaker rather than because coverage grew.
 *
 * So the OLD boolean is recomputed here from first principles — the same five
 * predicates, written out, in the order the pre-partition code used — and
 * asserted to agree with `gate !== null` on every claim in the pool.
 *
 * ⚠ THE ALTERNATION BELOW IS COPIED OUT ON PURPOSE and must never be rewritten
 * as `TRIGGER_WORDS.test(head) || CONDITION_WORDS.test(head)`. The first cut of
 * this test did exactly that, and it was BLIND: a deliberate `deals|` spliced
 * into `TRIGGER_WORDS` changed both the thing under test and the thing testing
 * it, and the suite stayed green. A reference implementation that imports the
 * value it is checking is not a reference implementation.
 */
const OLD_CONDITION_RE =
  /\b(when|whenever|if|after|unless|may|instead|as long as|while|at the end|at the start|each turn|would)\b/;

function oldConditional(sentence: string, upto: number, fullText: string, at: number): boolean {
  const head = sentence.slice(0, upto).toLowerCase();
  const whole = sentence.toLowerCase();
  if (/\b(unless|up to|if )\b/.test(whole)) return true;
  if (/\[augment\]/i.test(fullText.slice(0, at))) return true;
  if (whole.includes(':') || fullText.slice(0, at).includes(':')) return true;
  const open = fullText.lastIndexOf('[', at);
  const close = fullText.lastIndexOf(']', at);
  if (open > close) return true;
  return OLD_CONDITION_RE.test(head);
}

test('the gate partition covers exactly the claims the old boolean called conditional', () => {
  // THE UNION OF THE TWO WORD LISTS MUST STILL BE THE ONE ALTERNATION THEY
  // WERE SPLIT OUT OF. Read structurally, off the regex sources, because the
  // per-claim check below can only see words this pool happens to print: a
  // word ADDED to TRIGGER_WORDS that no card uses would sail through it, and
  // would then start silently re-gating claims the day a card prints it.
  const words = (re: RegExp): string[] =>
    (/\(([^)]*)\)/.exec(re.source)?.[1] ?? '').split('|').filter(Boolean).sort();
  assert.deepEqual(
    [...words(TRIGGER_WORDS), ...words(CONDITION_WORDS)].sort(), words(OLD_CONDITION_RE),
    'TRIGGER_WORDS ∪ CONDITION_WORDS is no longer exactly the alternation they were split '
    + 'out of. A word added to either one re-gates claims; a word dropped un-gates them.');
  for (const w of words(OLD_CONDITION_RE)) {
    assert.ok(TRIGGER_WORDS.test(` ${w} `) !== CONDITION_WORDS.test(` ${w} `),
      `"${w}" must be in exactly one of TRIGGER_WORDS / CONDITION_WORDS`);
  }
  const disagreements: string[] = [];
  for (const card of POOL) {
    const text = rulesText(card);
    for (const c of claimsOf(card)) {
      const at = text.indexOf(c.raw);
      if (at < 0) continue;
      const start = text.lastIndexOf('.', at) + 1;
      const endDot = text.indexOf('.', at + c.raw.length);
      const sentence = text.slice(start, endDot === -1 ? text.length : endDot + 1);
      const old = oldConditional(sentence, at - start, text, at);
      if (old !== (gateOf(sentence, at - start, text, at) !== null)) {
        disagreements.push(`${card}: "${c.raw}" — old=${old}, gate=${gateOf(sentence, at - start, text, at)}`);
      }
    }
  }
  assert.deepEqual(disagreements, [],
    'gateOf() no longer partitions the SAME set the boolean did. Either a predicate was '
    + 'dropped (claims moved to "owed") or one was widened (claims moved out of the required '
    + 'set) — the second is how CARD-TODO #49 gets closed by accident instead of by work.');
});

test('the gate partition keeps its floor in every category', () => {
  const at = (g: ClaimGate) => partition.get(g)?.[1] ?? 0;
  // FLOORS, the way `req >= 115` floors the unconditional count. Measured
  // 2026-08-25: augment 152, trigger 110, activated 35, condition 19, owed 123
  // — 439 promises over 347 cards. These are set a little below the measured
  // values so that adding cards or refining a pattern is free, and hollowing
  // out a category is not.
  assert.ok(at('augment') >= 140, `only ${at('augment')} [Augment]-box promises — the augment scan lost reach`);
  assert.ok(at('trigger') >= 100, `only ${at('trigger')} trigger-gated promises — the trigger scan lost reach`);
  assert.ok(at('activated') >= 30, `only ${at('activated')} activation-gated promises — the colon/cost scan lost reach`);
  assert.ok(at('condition') >= 15, `only ${at('condition')} condition-gated promises — the condition scan lost reach`);
  const cond = (['augment', 'trigger', 'activated', 'condition'] as ClaimGate[])
    .reduce((n, g) => n + at(g), 0);
  assert.ok(cond >= 300,
    `only ${cond} gated promises (was 316) — CARD-TODO #49's denominator has SHRUNK. That is `
    + 'the one way this ticket must never be closed: the number is meant to fall because more '
    + 'promises are observed, never because fewer are extracted.');
});

// ── CARD-TODO #49 stage 2: the activated abilities, driven ──────────────

/**
 * Cards whose activation-gated promise the drill still cannot evidence. EMPTY
 * as of stage 2 — all twelve cards that carry an activated ability of their own
 * AND print a countable promise behind it deliver what the far side of their
 * colon says, and so do the twelve spells whose colon is a cast cost.
 *
 * An entry here means one of two things and must say which: REAL (the ability
 * is not implemented — cite a CARD-TODO id) or BOARD (implemented, but the
 * drill cannot make the ability legal or cannot pay its cost).
 */
const KNOWN_UNACTIVATED: Record<string, string> = {};

test('every activation-gated promise is delivered when the drill pays and activates', () => {
  const surprises: string[] = [];
  for (const { card, claim } of unobserved.get('activated') ?? []) {
    if (card in KNOWN_UNACTIVATED) continue;
    surprises.push(`${card} — promises ${claim.kind}${claim.n !== undefined ? `(${claim.n})` : ''} `
      + `"${claim.raw}" behind an activation; the drill ${observations.get(card)?.activated
        ? 'DID activate an ability of this card and saw no such thing'
        : 'could not activate anything on this card'}; printed: "${rulesText(card)}"`);
  }
  assert.deepEqual(surprises.sort(), [],
    'these cards print a promise behind an activated ability or a paid cost and nothing '
    + 'delivered it:\n  ' + surprises.join('\n  '));

  // THE POSITIVE CONTROLS. An empty `surprises` is worth nothing unless the
  // drill really did pay for and resolve abilities — a broken `activate` loop
  // that activated NOTHING would leave `actTypes` empty, `met` false and the
  // list full, so this half guards the opposite blindness: an attribution that
  // silently fell back to the loose whole-run evidence and passed everything.
  // 12, not 13: thirteen cards declare an activated ability of their own, but
  // The Bonesculptor's ("You may play one unit with no abilities from your bin
  // each deployment") prints no countable promise, so it carries no claims and
  // never reaches `observations` at all.
  const activatedCards = [...observations].filter(([, o]) => o.activated).map(([n]) => n);
  assert.ok(activatedCards.length >= 12,
    `the drill activated an ability on only ${activatedCards.length} cards — it was 12 when `
    + 'stage 2 landed, so the activation path has stopped firing and the green above is empty');
  for (const control of ['Oracle of the Flame', 'Glararr', 'Prismatic Observer']) {
    assert.ok(activatedCards.includes(control),
      `${control} is a positive control for the activation path and was not activated`);
  }
  // and the window must be CUT: Oracle of the Flame's own body arriving is a
  // `spawned`, so an uncut window would evidence "Create a Fireball 1" on a
  // run where nothing was activated at all
  const oracle = observations.get('Oracle of the Flame')!;
  assert.ok(!oracle.actTypes.has('phase'),
    'the post-activation evidence window is not being closed when the activation resolves — '
    + 'it has swallowed a phase change, so it is collecting the rest of the game');
});

// ── the tally ───────────────────────────────────────────────────────────

test('the semantic pass reports honestly on what it could and could not check', () => {
  let total = 0, cond = 0;
  for (const card of POOL) {
    for (const c of claimsOf(card)) { total++; if (c.conditional) cond++; }
  }
  const req = total - cond;
  const unmetCount = [...unmet.values()].reduce((n, cs) => n + cs.length, 0);
  console.log(
    `    semantics: ${observations.size} cards carry ${total} printed promises `
    + `(${req} unconditional, ${cond} behind a trigger/condition/activation)`);
  console.log(
    `    ${req - unmetCount}/${req} unconditional promises were observed being delivered`);
  // ── UNITS. These two lines used to disagree without saying so ─────────
  // `unmetCount` counts CLAIMS (9); `KNOWN_UNMET` is keyed by CARD (8). The
  // old output printed "114/123" and then accounted for "0 REAL + 8 BOARD",
  // and a reader — the orchestrator, on this very ticket — went looking for a
  // tenth card that does not exist. One card carries TWO unmet claims:
  // Suppression Field, whose "erase all of its mods and negate all of its
  // effects" is two promises against a target that has neither. Both units are named now, and the relationship between them
  // is ASSERTED below rather than left to be inferred from a printed number,
  // because an unstated invariant is how this repo's tallies have rotted.
  const realCards = Object.entries(KNOWN_UNMET).filter(([, w]) => w.startsWith('REAL'));
  const boardCards = Object.entries(KNOWN_UNMET).filter(([, w]) => !w.startsWith('REAL'));
  const claimsIn = (cards: [string, string][]) =>
    cards.reduce((n, [c]) => n + (unmet.get(c)?.length ?? 0), 0);
  console.log(
    `    the other ${unmetCount} unconditional promises are carried by `
    + `${unmet.size} cards: ${realCards.length} cards (${claimsIn(realCards)} claims) are REAL `
    + `defects, each citing its CARD-TODO id; ${boardCards.length} cards `
    + `(${claimsIn(boardCards)} claims) are board preconditions the drill cannot make`);

  // EVERY unmet claim belongs to a card that KNOWN_UNMET accounts for. The
  // `no card silently fails…` test already refuses an unlisted CARD; this says
  // the CLAIM arithmetic closes too, so the two printed lines can be added up.
  assert.equal(unmet.size, Object.keys(KNOWN_UNMET).length,
    'the cards with an unmet unconditional promise and the KNOWN_UNMET keys have diverged');
  assert.equal(claimsIn(realCards) + claimsIn(boardCards), unmetCount,
    `${unmetCount} unmet claims but only ${claimsIn(realCards) + claimsIn(boardCards)} of them `
    + 'belong to a KNOWN_UNMET card — the honesty tally no longer adds up');

  // ── CARD-TODO #49: the gated promises, partitioned by WHAT THEY NEED ──
  // Until stage 1 these were one undifferentiated heap of 316 and the ticket
  // could not be planned against. The partition says which stage owns which
  // slice, and the per-gate delivered count says how far each has got.
  const GATE_NEEDS: Record<ClaimGate, string> = {
    augment: 'a graft HOST                (stage 4)',
    trigger: 'a fixture firing the EVENT  (stage 3)',
    activated: 'somebody to PAY & ACTIVATE  (stage 2 — done)',
    condition: 'a BOARD meeting the clause  (stage 3)',
  };
  let gTot = 0, gHit = 0;
  console.log('    gated promises, by what would have to happen before they are owed:');
  for (const g of ['augment', 'trigger', 'activated', 'condition'] as ClaimGate[]) {
    const [hit, tot] = partition.get(g) ?? [0, 0];
    gTot += tot; gHit += hit;
    console.log(`      ${g.padEnd(10)} ${String(tot).padStart(3)} — needs ${GATE_NEEDS[g]}  ·  ${hit} observed delivered`);
  }
  console.log(
    `    ${gHit}/${gTot} gated promises were observed being delivered by a run that could `
    + `satisfy their gate; ${gTot - gHit} have still never been observed`);
  // The delivered count is floored too, in the other direction: coverage that
  // has been paid for once must not be lost silently.
  assert.ok(gHit >= 90,
    `only ${gHit} gated promises observed delivered (was 98 when stage 2 landed) — coverage `
    + 'has regressed');
  assert.equal(partition.get('activated')?.[0], partition.get('activated')?.[1],
    'stage 2 delivered EVERY activation-gated promise; one has stopped being delivered');
  // A floor on the promises the suite actually REQUIRES. It is far below the
  // 439 total on purpose: tightening what counts as conditional (the [Augment]
  // box, an activated ability's colon, a bracketed cost, a trailing "unless")
  // moved 316 claims out of the required set, and every one of those moves
  // removed a false failure rather than weakening the check.
  assert.ok(req >= 115, `only ${req} unconditional promises — the claim extractor has lost its reach`);
});
