/**
 * THE CORRECTNESS SAMPLE — R212, `docs/13-assessment.md` §7.1.
 *
 * WHAT THIS FILE IS FOR
 *
 * `docs/13-assessment.md` §1 makes three claims about the card pool and grades
 * them. The third — *"Cards do what they print — right target, right amount,
 * right timing"* — is graded **UNMEASURED**, and the document says so in the
 * strongest terms it uses anywhere:
 *
 *   "Not 'we measured it and it is bad'. We have never measured it. This is
 *    the honest answer to 'are the cards working as printed', and it is the
 *    single most important line in this document."
 *
 * The reason is §2. `84-card-semantics` counts *evidence of the right KIND*,
 * and states its own limit in its header: "A card that prints 'deal 3 damage
 * to target unit' and deals 3 to the WRONG unit passes here." 278/316 is a
 * floor, not a ceiling.
 *
 * So §7.1 asks for the missing number: take **thirty cards at random**, write
 * *exact* assertions — right target, right amount, right timing, right
 * duration — and count how many clauses are actually right.
 *
 * **This file is that measurement.** The tally at the bottom prints it.
 *
 * HOW THE SAMPLE WAS DRAWN (and why you can audit it)
 *
 *   `rngShuffle(allCardNames().sort(), 212).slice(0, 30)`
 *
 * Seed **212** = the ruling number of the round that produced this file. The
 * pool is `allCardNames()` — 495 — taken AFTER importing `apply.ts` as well as
 * the registry, because three cards reach the registry through
 * `registerSynthetic` and a sweep driven off `printed.json` alone silently
 * misses them (that is how an earlier sweep skipped the exact card in a
 * report). `.sort()` before shuffling makes the draw independent of
 * registration order, which R150 showed is not stable.
 *
 * `test('the sample is the one seed 212 draws')` below RE-DERIVES the list at
 * run time and asserts it equals the hard-coded `SAMPLE`. The sample cannot be
 * quietly curated after the fact: change a name and that test goes red.
 *
 * **Nothing was re-rolled and nothing was skipped for being awkward.** A
 * sample you steered is an advertisement, not a measurement.
 *
 * HOW THE ASSERTIONS WERE WRITTEN
 *
 * From the PRINTED TEXT, never from the implementation. A test derived from
 * the code cannot disagree with the code — that is §5's whole complaint about
 * this repository's instruments. For each card the printed clause is quoted
 * verbatim above its test, the board the clause needs is built, and the real
 * game is driven through the real `Harness`. Where the printed text is
 * genuinely ambiguous the ambiguity is recorded as a question for the owner
 * (see `OPEN_QUESTIONS` at the foot of this file) rather than resolved
 * silently in the engine's favour.
 *
 * The standing steer (R157, `card-ruling-steer` memory): take the PERMISSIVE
 * reading, and **printed text beats engine defaults**. If the engine narrows
 * what the card says, the engine is probably wrong.
 *
 * WHY THE FAILURES DO NOT MAKE THE SUITE RED
 *
 * A clause found genuinely WRONG is recorded in `KNOWN_WRONG` with what it
 * should do and what it does, and the test asserts the CURRENT (wrong)
 * behaviour. `test('KNOWN_WRONG has exactly these members')` then pins the
 * list, so the file goes red the moment somebody fixes one — the `card-todo.ts`
 * proof pattern. Clauses found CORRECT are asserted normally and are
 * red-on-regression forever.
 *
 * WHAT IT FOUND — AND HOW MUCH THE NUMBER IS WORTH
 *
 * **As first run: 125 of 127 clauses correct (98.4%).** Both misses were the
 * same sentence of Torrential Reclamation, and both were raised as ruling
 * questions rather than assumed to be bugs. That was the right call, because
 * the owner's answer (R221, 2026-08-28) split them:
 *
 *  · the AMOUNT clause was CORRECT ALL ALONG — the "for each" does distribute
 *    over the sacrifice. This file was wrong about the card, and said so in a
 *    `wrong()` row for two days.
 *  · the TIMING clause was genuinely broken and is now fixed.
 *
 * **So the file now reads 127 of 127, and that is NOT a 100% correctness
 * claim.** One of the two points came from fixing the game and the other from
 * correcting this test. Quoting "127/127" without that sentence would be the
 * exact failure docs/13 §5 catalogues — an instrument reporting more sight
 * than it has, in the flattering direction. The honest summary of this sample
 * is: 30 cards, 127 clauses, ONE real defect found and fixed, ONE false
 * positive raised by the sample itself.
 *
 * A number that high is itself a finding to be suspicious of, and §7.1 says so:
 * *"the most likely explanation for 30/30 is that the assertions are too weak."*
 * Six assertions were therefore break-tested — the clause's implementation was
 * broken in a mirrored copy of the tree, the test watched to go red, and the
 * break reverted (§8.2): Luminous Arc's 6, Throw off a Cliff's `defense >= 4`,
 * Jelly's until-regroup, Visage of Ruin's `Math.ceil`, Counter Thief's "during
 * battle" guard, Scrapyard Custodian's "YOU put" guard. Every one reddened, and
 * every one went green again on revert.
 *
 * WHAT THIS FILE STILL CANNOT SEE, stated so the number is not over-read:
 *
 *  · **Fizzle and target loss.** Nothing here kills a target between cast and
 *    resolution (R86), so "the amount is right" is measured only on the happy
 *    path.
 *  · **The donated path, for ten of the eleven [Augment] cards.** A card's own
 *    [Augment] text is live while it stands as a unit (docs/08), which is what
 *    most of these tests drive. "Me" and "you" resolve differently when the
 *    same text is donated to a HOST (R131). Only Biomass Devourer is checked
 *    both ways.
 *  · **Trigger ORDER.** Where several triggers queue, the tests answer the
 *    ordering question with the identity order and assert only the outcome.
 *  · **More than two players.** "Each opponent" and "each player" are measured
 *    against the one opponent `createGame` builds.
 *  · **Copies and projected faces (R118).**
 *
 * Seeds 18200-18299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import '../src/cards/registry.ts';
import '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { rngShuffle } from '../src/rng.ts';
import type { Decision, Seat, EntityId } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, logFor, offered, notOffered, ownAttrs,
  pass, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

// ── the sample ────────────────────────────────────────────────────────────

const SEED = 212;

/** The thirty. Recorded BEFORE a single assertion was written. */
const SAMPLE = [
  'A Fast Pile of Rocks', 'All-Consuming Blight', 'Biomass Devourer', 'Capture',
  'Counter Thief', 'Finality', 'Flzzz', 'Forager of the Fallen', 'Ghord',
  'Hand Peeper', 'Jelly', 'Life Plant', 'Linked Extinction', 'Luminous Arc',
  'Murkdrop Distiller', 'Omniwield Evoker', 'Pallid Gorger', 'Plague Bellower',
  'Scavenging Sentry', 'Scrapyard Custodian', 'Shoreline Specter', 'Soul Tithe',
  'Spewing Mushroom', 'Stoneborn Progenitor', 'The Omniphage', 'Throw off a Cliff',
  'Torrential Reclamation', 'Trashling', 'Visage of Ruin', 'Wandering Blightshell',
];

test('the sample is the one seed 212 draws — nobody curated it', () => {
  const pool = allCardNames().slice().sort();
  assert.equal(pool.length, 495,
    'the pool is 495 = 492 printed + 3 synthetics; a smaller number means a '
    + 'registerSynthetic card is missing and the draw is off a different population');
  const [shuffled] = rngShuffle(pool, SEED);
  assert.deepEqual(shuffled.slice(0, 30).sort(), SAMPLE.slice().sort());
});

// ── the ledger ────────────────────────────────────────────────────────────

type Verdict = 'ok' | 'wrong';
interface Rec { card: string; clause: string; verdict: Verdict; detail?: string }
const LEDGER: Rec[] = [];

/** this clause is implemented as printed — asserted normally above this call */
function ok(card: string, clause: string): void {
  LEDGER.push({ card, clause, verdict: 'ok' });
}
/** this clause DIVERGES from print. The assertion above pins what it does now. */
function wrong(card: string, clause: string, detail: string): void {
  LEDGER.push({ card, clause, verdict: 'wrong', detail });
}
// ⚠ `wrong` HAS NO CALLERS AS OF R221 AND IS KEPT ON PURPOSE. Both of this
// sample's divergences resolved on 2026-08-28 — one fixed, one ruled correct —
// so KNOWN_WRONG is empty and nothing calls this. Deleting it would mean the
// next agent who finds a real divergence has to re-invent the recording half of
// this file's design, and would probably just assert the printed behaviour and
// watch it fail instead. The `void` is the same idiom R219 used to stop
// `opts.leavesGame` being tidied away while its seam was still needed.
void wrong;

/**
 * The divergences this sample found, as `Card :: clause`. Pinned by the test at
 * the foot of the file: fixing one turns this file red, which is the point.
 * Filled in as the file was written; see the report for expected/actual/line.
 */
/**
 * ⚠ EMPTY AS OF R221 (2026-08-28), AND THE TWO ROWS LEFT FOR DIFFERENT REASONS.
 * Do not read `[]` as "the sample found nothing wrong" — it found two things
 * and they resolved in opposite directions:
 *
 *  · the AMOUNT row was NEVER A DEFECT. The owner ruled the engine right and
 *    this file wrong. Deleting it did not improve the game by one line of code.
 *  · the TIMING row WAS a defect and was fixed in batch-hybrids-fwe.ts.
 *
 * So of the sample's 2 misses, ONE was a real bug and ONE was the instrument
 * misreading a card — a 50% false-positive rate on a two-item sample, which is
 * the number actually worth carrying forward out of this round. See the header.
 */
const KNOWN_WRONG: string[] = [];

// ── shared board helpers ─────────────────────────────────────────────────

/** a plain 3/3 with no printed text at all — board furniture that cannot
 *  perturb the clause under test */
const VANILLA = 'The Foretold';

/** a REAL unit token. `spawn()` puts the CARD "Unit Token" into play as an
 *  ordinary nontoken unit, which is not the same thing and silently defeats
 *  every "nontoken" restriction test written against it. */
function spawnToken(h: Harness, seat: Seat, name = 'Unit Token', stats: [number, number] = [1, 1]): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, name, e.homeRegion(seat), { token: true, tokenStats: stats });
  e.settle();
  return u.id;
}

/** a unit big enough to be shot without dying, so `damage` reads the AMOUNT */
const ANVIL = 'Triskaidekaphage';        // 0/13, no static, no spawn trigger

/**
 * Pass priority until the stack is empty — and REFUSE to walk past an
 * unanswered question. Without that refusal a pending `choose` looks exactly
 * like a clause that never ran (Capture's "then discard a card" reads as
 * missing until you notice the decision sitting there), which is precisely the
 * false negative §5 warns about.
 */
const drain = (h: Harness): void => {
  let guard = 200;
  while (h.state.stack.length && guard-- > 0) {
    if (h.state.decision) {
      throw new Error(`unanswered decision while draining: ${h.state.decision.prompt}`);
    }
    pass(h);
  }
  if (guard <= 0) throw new Error('drain did not terminate');
};

/** drain until the stack empties OR a question is raised, whichever comes first */
const drain0 = (h: Harness): void => {
  let guard = 200;
  while (h.state.stack.length && !h.state.decision && guard-- > 0) pass(h);
};
const passUntil = (h: Harness, seat: Seat): void => { while (h.state.priority !== seat) pass(h); };

/**
 * A game parked in DEPLOYMENT with `A` on the clock. `A` is the deploy player,
 * which `toNextBattle(h, A)` then makes the round-1 attacker, so `A`'s units
 * reach the battle region by attacking into it and `D`'s are already there.
 */
function open(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer as Seat;
  return { h, A, D: (1 - A) as Seat };
}

/** deployment → battle round 1, `A` attacking with `cols`, priority handed to `who`. */
function intoBattle(h: Harness, A: Seat, cols: EntityId[][], who: Seat = A): void {
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: cols });
  passUntil(h, who);
}


// ════════════════════════════════════════════════════════════════════════
// LUMINOUS ARC — r/2 {Battle} Elemental Spell
//   "I deal 6 damage to target unit."
// ════════════════════════════════════════════════════════════════════════

test('Luminous Arc: exactly 6 damage, to the ONE unit chosen, and any unit is choosable', () => {
  const { h, A, D } = open(18201);
  const attacker = spawn(h, A, ANVIL);        // 0/13 — survives 6, so `damage` reads the AMOUNT
  const victim = spawn(h, D, ANVIL);
  const bystander = spawn(h, D, ANVIL);
  giveResources(h, A, 'fire', 2);
  intoBattle(h, A, [[attacker]]);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });

  // TARGET — "target unit" carries no qualifier, so every unit in reach is
  // legal, my own attacker included (R125: do not invent a qualifier).
  assert.ok(offered(h).includes(JSON.stringify({ unit: victim })), 'an enemy unit is targetable');
  assert.ok(offered(h).includes(JSON.stringify({ unit: attacker })),
    '"target unit" is unqualified — my own unit is a legal target too');
  assert.equal(offered(h).length, 3, 'exactly the three units in the battle region');
  ok('Luminous Arc', 'target: "target unit" — unqualified, either side');

  pick(h, { unit: victim });
  drain(h);

  // AMOUNT — exactly 6. Not 5, not 7, not "enough".
  assert.equal(ent(h, victim)!.damage, 6, 'the chosen unit is dealt exactly 6');
  ok('Luminous Arc', 'amount: exactly 6 damage');

  // and nothing else is touched
  assert.equal(ent(h, bystander)!.damage, 0, 'the unchosen enemy unit takes nothing');
  assert.equal(ent(h, attacker)!.damage, 0, 'my own unit takes nothing');
  ok('Luminous Arc', 'target discipline: only the chosen unit is damaged');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// THROW OFF A CLIFF — e/2 {Battle} Rock Spell
//   "Delete target unit with 4 or more defense."
// ════════════════════════════════════════════════════════════════════════

test('Throw off a Cliff: only defense>=4 is offered, and the target is DELETED (bin, a death)', () => {
  const { h, A, D } = open(18202);
  const big = spawn(h, D, ANVIL);                     // 0/13 — qualifies
  const small = spawn(h, D, 'Unit Token');            // 1/1 — does NOT qualify
  const attacker = spawn(h, A, 'Unit Token');
  const myBig = spawn(h, A, ANVIL);                   // mine, and it qualifies
  giveResources(h, A, 'earth', 2);
  intoBattle(h, A, [[attacker], [myBig]]);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Throw off a Cliff') });

  // TARGET RESTRICTION — an illegal target is never OFFERED (R64).
  assert.ok(offered(h).includes(JSON.stringify({ unit: big })), 'a 0/13 has 4+ defense');
  notOffered(h, { unit: small }, 'a 1/1 has 1 defense, not 4 or more');
  notOffered(h, { unit: attacker }, 'my own 1/1 has 1 defense either');
  ok('Throw off a Cliff', 'target restriction: defense >= 4 only');
  assert.ok(offered(h).includes(JSON.stringify({ unit: myBig })),
    '"target unit with 4 or more defense" names no side — my own 4+ unit is legal (R125)');
  ok('Throw off a Cliff', 'target: unqualified as to side — my own unit is choosable');

  pick(h, { unit: big });
  drain(h);

  // EFFECT — Delete = to the bin, and it counts as a death (mechanics §6).
  assert.equal(ent(h, big), undefined, 'the target left play');
  assert.ok(h.state.players[D]!.bin.includes(ANVIL), 'DELETE puts the card in its owner’s bin');
  ok('Throw off a Cliff', 'effect: delete = to the bin');
  assert.ok(ent(h, small), 'the unchosen unit is untouched');
  finishBattle(h);
});

test('Throw off a Cliff: "4 or more defense" reads the unit’s CURRENT defense, not its printed one', () => {
  const { h, A, D } = open(18203);
  const grown = spawn(h, D, 'Unit Token');            // printed 1/1
  new E(h.state).addCounters(h.state.entities[grown]!, 3);   // +3/+3 → 4/4 right now
  const attacker = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 2);
  intoBattle(h, A, [[attacker]]);
  assert.deepEqual(effStats(h, grown), [4, 4], 'the board is what the test claims: a 4/4');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Throw off a Cliff') });
  assert.ok(offered(h).includes(JSON.stringify({ unit: grown })),
    'a printed 1/1 standing at 4 defense HAS 4 defense — the card says "with 4 or more defense", '
    + 'not "printed defense 4 or more"');
  ok('Throw off a Cliff', 'target restriction reads CURRENT defense');
  pick(h, { unit: grown });
  drain(h);
  assert.equal(ent(h, grown), undefined, 'and it is deleted');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// JELLY — b/3 {Battle} Jellyfish SPELL UNIT, 2/1
//   "Target unit gains -2/-2 until regroup."
// ════════════════════════════════════════════════════════════════════════

test('Jelly: -2/-2 on the chosen unit, until REGROUP, and the 2/1 body still arrives', () => {
  const { h, A, D } = open(18204);
  const victim = spawn(h, D, ANVIL);          // 0/13 → 0/11 (survives, so the delta is readable)
  const bystander = spawn(h, D, ANVIL);
  const attacker = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 3);
  intoBattle(h, A, [[attacker]]);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Jelly') });
  assert.ok(offered(h).includes(JSON.stringify({ unit: victim })), '"target unit": unqualified');
  pick(h, { unit: victim });
  drain(h);

  // AMOUNT
  assert.deepEqual(effStats(h, victim), [-2, 11], '-2/-2, exactly');
  ok('Jelly', 'amount: -2/-2');
  assert.deepEqual(effStats(h, bystander), [0, 13], 'nobody else shrank');
  ok('Jelly', 'target discipline: only the chosen unit');

  // the spell-unit BODY
  assert.ok(unitsOf(h, A).some(u => u.card === 'Jelly'), 'the 2/1 Jellyfish body spawned');
  ok('Jelly', 'body: the spell unit spawns after its spell half');

  // DURATION — "until regroup": still there for the rest of the battle …
  finishBattle(h);
  // … and gone once regroup has run (the phase after battle).
  assert.deepEqual(effStats(h, victim), [0, 13], '"until regroup" ended AT regroup');
  ok('Jelly', 'duration: until regroup');
});

// ════════════════════════════════════════════════════════════════════════
// CAPTURE — bd/4 {Battle} Mystic Spell
//   "Put target unit into your hand, then discard a card."
// ════════════════════════════════════════════════════════════════════════

test('Capture: the target goes to the CASTER’s hand, then the caster discards one', () => {
  const { h, A, D } = open(18205);
  const victim = spawn(h, D, ANVIL);
  const attacker = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 2);
  giveResources(h, A, 'dark', 2);
  intoBattle(h, A, [[attacker]]);
  h.state.players[A]!.hand = ['Unit Token'];  // one spare card, to discard
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Capture') });
  assert.ok(offered(h).includes(JSON.stringify({ unit: victim })), 'an enemy unit is targetable');
  pick(h, { unit: victim });
  pass(h); pass(h);                           // resolve

  assert.equal(ent(h, victim), undefined, 'the target left play');
  // "into YOUR hand" — the caster's, not the owner's. This is a STEAL.
  const inMine = h.state.players[A]!.hand.filter(c => c === ANVIL).length;
  const inTheirs = h.state.players[D]!.hand.filter(c => c === ANVIL).length;
  assert.equal(inMine + inTheirs, 1, 'the card went to exactly one hand');
  assert.equal(inMine, 1, '"put target unit into YOUR hand" — the CASTER’s hand');
  ok('Capture', 'destination: the caster’s hand, not the owner’s');

  // "THEN discard a card" — the order is load-bearing: the captured card is
  // already in hand when the discard is chosen, so it is itself discardable.
  const dec = h.state.decision!;
  assert.equal(dec.prompt, 'Capture: discard a card', 'the discard is asked, not skipped');
  assert.equal(dec.seat, A, 'the CASTER discards');
  assert.deepEqual(dec.options.map(o => o.card).sort(), [ANVIL, 'Unit Token'].sort(),
    'the just-captured card is on the discard menu — "put … THEN discard"');
  ok('Capture', 'timing: capture resolves BEFORE the discard is chosen');
  assert.ok(!dec.options.some(o => o.label === 'Decline' || o.value === -1),
    'the discard is mandatory — there is no way out of it');
  h.do({ type: 'decide', seat: A, choice: dec.options.findIndex(o => o.card === 'Unit Token') });

  assert.equal(h.state.players[A]!.hand.length, 1,
    'exactly one card left: 1 spare + 1 captured - 1 discarded');
  assert.deepEqual(h.state.players[A]!.hand, [ANVIL], 'and it is the captured one');
  assert.ok(h.state.players[A]!.bin.includes('Unit Token') || h.state.players[A]!.erased?.includes('Unit Token'),
    'the discarded card is gone from hand');
  ok('Capture', 'rider: the caster discards exactly one card, mandatorily');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// ALL-CONSUMING BLIGHT — gg/4 Ancient Blight Spell (deploy)
//   "Create a Poison 1 for each of your units."
// ════════════════════════════════════════════════════════════════════════

test('All-Consuming Blight: one Poison 1 per unit of MINE — not the enemy’s, not per anything else', () => {
  const { h, A, D } = open(18206);
  spawn(h, A, 'Unit Token');
  spawn(h, A, 'Unit Token');
  spawn(h, A, ANVIL);                          // three units of mine, one a nontoken
  spawn(h, D, 'Unit Token');                   // …and two of theirs, which must not count
  spawn(h, D, ANVIL);
  giveResources(h, A, 'wood', 4);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'All-Consuming Blight') });
  drain(h);

  const poisons = tokensOf(h, A).filter(t => t.card === 'Poison');
  assert.equal(poisons.length, 3,
    'three units of mine → three Poisons ("for each of YOUR units"); five would mean it counted the whole board');
  ok('All-Consuming Blight', 'count: one per unit of the CASTER’s');
  assert.ok(poisons.every(p => p.x === 1), `every token is a Poison 1, not a Poison N (saw ${poisons.map(p => p.x)})`);
  ok('All-Consuming Blight', 'amount: each token is a Poison 1');
  assert.equal(tokensOf(h, D).filter(t => t.card === 'Poison').length, 0,
    'the Poisons are the caster’s');
  ok('All-Consuming Blight', 'controller: the tokens are the caster’s');
});

// ════════════════════════════════════════════════════════════════════════
// LINKED EXTINCTION — m/1 {Battle} Technology Spell
//   "[Switch1] /[Sacrifice a unit]: Each opponent sacrifices a unit."
//   (`/[…]` is a printed cost panel — R142/docs 12 §"/[…]". Malevolent
//    Machinations prints the same panel with no [Switch] at all, so the panel
//    is a COST of playing the card, and [Switch1] only marks it graftable.)
// ════════════════════════════════════════════════════════════════════════

test('Linked Extinction: I sacrifice one to make each opponent sacrifice one', () => {
  const { h, A, D } = open(18207);
  const mine1 = spawn(h, A, 'Unit Token');
  const mine2 = spawn(h, A, 'Unit Token');
  const theirs1 = spawn(h, D, 'Unit Token');
  const theirs2 = spawn(h, D, ANVIL);
  giveResources(h, A, 'metal', 1);
  intoBattle(h, A, [[mine1], [mine2]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Linked Extinction') });

  // COST — the printed panel is paid by ME, and it is a unit of mine.
  const cost = h.state.decision!;
  assert.equal(cost.seat, A, 'the sacrifice is the CASTER’s cost');
  assert.ok(cost.options.every(o => {
    const id = (o.value as { unit?: EntityId }).unit;
    return id === undefined || h.state.entities[id]!.controller === A;
  }), `the cost sacrifices one of MY units; menu was [${cost.options.map(o => o.label)}]`);
  pick(h, { unit: mine1 });
  ok('Linked Extinction', 'cost: the caster sacrifices one of their own units');
  drain0(h);

  assert.equal(ent(h, mine1), undefined, 'my unit was sacrificed');
  // EFFECT — each opponent sacrifices ONE unit, and THEY pick it.
  const theirChoice = h.state.decision;
  assert.ok(theirChoice, 'the opponent is asked which unit to sacrifice');
  assert.equal(theirChoice!.seat, D, 'the OPPONENT chooses their own sacrifice');
  ok('Linked Extinction', 'target: each opponent chooses their own sacrifice');
  h.do({ type: 'decide', seat: D, choice: 0 });
  drain(h);
  const theirsLeft = [theirs1, theirs2].filter(id => ent(h, id)).length;
  assert.equal(theirsLeft, 1, 'the opponent sacrificed exactly ONE unit, not all of them');
  ok('Linked Extinction', 'amount: exactly one unit per opponent');
  assert.ok(ent(h, mine2), 'and only the one unit of mine paid as the cost is gone');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// FINALITY — dd/5 {Battle} Blight Spell
//   "Negate all other effects. Erase all cards in bins."
// ════════════════════════════════════════════════════════════════════════

test('Finality: every OTHER effect on the stack is negated — mine included — and it survives itself', () => {
  const { h, A, D } = open(18208);
  const anvil = spawn(h, D, ANVIL);
  const mine = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 5);
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'fire', 2);
  intoBattle(h, A, [[mine]]);
  h.state.players[A]!.hand = []; h.state.players[D]!.hand = [];

  // one effect of MINE and one of THEIRS waiting on the stack
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: anvil });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: mine });
  assert.equal(h.state.stack.length, 2, 'two effects are waiting');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Finality') });
  assert.equal(h.state.stack.length, 3, '…and Finality on top of them');
  drain(h);

  assert.equal(ent(h, anvil)!.damage, 0, 'my own Luminous Arc was negated too — "all OTHER effects"');
  assert.ok(ent(h, mine), 'and so was theirs');
  ok('Finality', 'scope: all other effects on the stack, both players’');
  assert.equal(h.state.stack.length, 0, 'Finality did not negate itself');
  ok('Finality', 'scope: "other" excludes Finality itself');
  finishBattle(h);
});

test('Finality: EVERY bin is erased — both players’, and the cards go to the erased pile, not nowhere', () => {
  const { h, A, D } = open(18209);
  const mine = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 5);
  h.state.players[A]!.bin = ['Unit Token', 'Luminous Arc'];
  h.state.players[D]!.bin = ['Jelly'];
  intoBattle(h, A, [[mine]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Finality') });
  drain(h);

  // Finality itself reaches a bin only AFTER it has finished resolving, so it
  // is not a card "in bins" when the clause runs — the two cards that were.
  assert.deepEqual(h.state.players[A]!.bin, ['Finality'],
    'my bin holds only Finality, which arrived after the erase');
  assert.equal(h.state.players[D]!.bin.length, 0, '"all cards in bins" — the opponent’s too');
  ok('Finality', 'scope: both players’ bins');
  // ERASE, not delete: R65's erased pile is where a card leaves the game through.
  assert.deepEqual(h.state.players[A]!.erased?.slice().sort(), ['Luminous Arc', 'Unit Token'],
    'my bin’s cards are in my ERASED pile');
  assert.ok(h.state.players[D]!.erased?.includes('Jelly'), 'and theirs in theirs');
  ok('Finality', 'effect: ERASE (out of the game), not simply discarded');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// SOUL TITHE — r/1 {Battle} Arcane Spell
//   "The controller of target effect may pay [one]. If they don't, negate
//    that effect and draw a card."
// ════════════════════════════════════════════════════════════════════════

test('Soul Tithe: they decline → that effect is negated and I draw exactly one', () => {
  const { h, A, D } = open(18210);
  const mine = spawn(h, A, 'Unit Token');     // their Arc's victim: dies iff the Arc resolves
  giveResources(h, A, 'fire', 1);
  giveResources(h, D, 'fire', 2);
  intoBattle(h, A, [[mine]], D);
  h.state.players[A]!.hand = []; h.state.players[D]!.hand = [];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: mine });
  const arc = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Soul Tithe') });
  const menu = h.state.decision!;
  assert.equal(menu.seat, A, 'the caster chooses the target effect');
  assert.ok(offered(h).includes(JSON.stringify({ stack: arc })),
    '"target effect" reaches the opponent’s effect waiting on the stack');
  ok('Soul Tithe', 'target: an effect on the stack');
  pick(h, { stack: arc });
  drain0(h);

  // the TOLL is offered to the effect's CONTROLLER, not to me
  const toll = h.state.decision!;
  assert.equal(toll.seat, D, 'the toll is put to the controller of the targeted effect');
  ok('Soul Tithe', 'timing/agent: the effect’s controller is the one asked to pay');
  const decline = toll.options.findIndex(o => o.value === false || o.value === -1);
  assert.ok(decline >= 0, `declining is an option; menu was [${toll.options.map(o => o.label)}]`);
  const drawnBefore = h.state.players[A]!.hand.length;
  h.do({ type: 'decide', seat: D, choice: decline });
  drain(h);

  assert.ok(ent(h, mine), 'they declined, so their Luminous Arc was negated — its victim lives');
  ok('Soul Tithe', 'effect: unpaid → the targeted effect is negated');
  assert.equal(h.state.players[A]!.hand.length - drawnBefore, 1,
    'and the SOUL TITHE’s controller draws exactly one card');
  ok('Soul Tithe', 'rider: unpaid → the caster draws exactly one');
  finishBattle(h);
});

test('Soul Tithe: they pay [one] → their effect resolves and NOBODY draws', () => {
  const { h, A, D } = open(18211);
  const mine = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, D, 'fire', 3);
  intoBattle(h, A, [[mine]], D);
  h.state.players[A]!.hand = []; h.state.players[D]!.hand = [];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: mine });
  const arc = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Soul Tithe') });
  pick(h, { stack: arc });
  drain0(h);
  const toll = h.state.decision!;
  const pay = toll.options.findIndex(o => o.value === true || o.value === 1);
  assert.ok(pay >= 0, `paying is an option; menu was [${toll.options.map(o => o.label)}]`);
  const openBefore = h.state.players[D]!.resources.filter(r => r.state === 'open').length;
  const handBefore = h.state.players[A]!.hand.length;
  h.do({ type: 'decide', seat: D, choice: pay });
  drain(h);

  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, openBefore - 1,
    'exactly ONE resource was spent on the toll — [one], not [two]');
  ok('Soul Tithe', 'amount: the toll is exactly [one]');
  assert.equal(ent(h, mine), undefined, 'the paid-for Luminous Arc resolved and killed its 1/1 victim');
  ok('Soul Tithe', 'effect: paid → the targeted effect is NOT negated');
  assert.equal(h.state.players[A]!.hand.length, handBefore,
    'the draw is conditional on the toll going unpaid — "If they don\'t, … and draw a card"');
  ok('Soul Tithe', 'rider: paid → no draw');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// TORRENTIAL RECLAMATION — br/X {Battle} Elemental Spell
//   "Recall X target nontoken allies. Then each player sacrifices a unit and
//    you lose 1 life for each ally recalled this way."
// ════════════════════════════════════════════════════════════════════════

test('Torrential Reclamation: the targets are X NONTOKEN ALLIES, recalled to my hand', () => {
  const { h, A, D } = open(18212);
  const mine1 = spawn(h, A, VANILLA);
  const mine2 = spawn(h, A, VANILLA);
  const myToken = spawnToken(h, A);           // an ally, but a TOKEN
  const theirs = spawn(h, D, VANILLA);        // nontoken, but not an ally
  giveResources(h, A, 'water', 4); giveResources(h, A, 'fire', 4);
  intoBattle(h, A, [[mine1], [mine2], [myToken]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });

  // X is chosen and paid at cast (R35)
  const xq = h.state.decision!;
  assert.ok(xq.prompt.includes('choose X'), 'X is chosen at cast');
  h.do({ type: 'decide', seat: A, choice: xq.options.findIndex(o => o.value === 2) });

  // TARGET RESTRICTION — "nontoken allies", both words
  assert.ok(offered(h).includes(JSON.stringify({ unit: mine1 })), 'a nontoken ally is targetable');
  notOffered(h, { unit: myToken }, 'a TOKEN ally is not a "nontoken ally"');
  notOffered(h, { unit: theirs }, 'an enemy unit is not an "ally"');
  ok('Torrential Reclamation', 'target restriction: nontoken allies only');

  // COUNT — X of them
  pick(h, { unit: mine1 });
  assert.ok(h.state.decision!.prompt.includes('target 2 of up to 2'),
    'X = 2 means exactly two targets are asked for');
  pick(h, { unit: mine2 });
  ok('Torrential Reclamation', 'count: X targets');

  const lifeBefore = h.state.players[A]!.life;
  let guard = 30;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }

  // RECALL — to the controller's hand, as cards
  assert.deepEqual(h.state.players[A]!.hand, [VANILLA, VANILLA],
    'both recalled allies are cards in my hand');
  assert.equal(ent(h, mine1), undefined, 'and they left play');
  ok('Torrential Reclamation', 'effect: recall = the card to its controller’s hand');

  // LIFE — 1 per ally recalled this way, so 2
  assert.equal(lifeBefore - h.state.players[A]!.life, 2,
    '"you lose 1 life for each ally recalled this way": two recalled, two life');
  ok('Torrential Reclamation', 'amount: 1 life lost per ally recalled');
  finishBattle(h);
});

test('Torrential Reclamation: "each player sacrifices a unit" happens ONCE PER RECALLED ALLY (R221)', () => {
  // PRINTED: "Recall X target nontoken allies. Then each player sacrifices a
  // unit and you lose 1 life for each ally recalled this way."
  //
  // ⚠ THIS TEST USED TO BE A `wrong()` ROW AND IT SHOULD NEVER HAVE BEEN ONE.
  // It read "for each ally recalled this way" as modifying only the LIFE LOSS
  // it is attached to, on the evidence that every other scaled sacrifice in
  // the pool puts the scaling inline (Structural Collapse, No Hand Killer).
  // That was a reasonable reading and it was WRONG. The owner was asked
  // directly on 2026-08-28 and ruled that the "for each" distributes over
  // BOTH clauses — which is what the card file had said deliberately all
  // along, in the comment this test talked itself out of believing.
  //
  // ⚠ SO THE NUMBER AT THE TOP OF THIS FILE MOVED WITHOUT ANY CODE BEING
  // FIXED. Read §"WHAT IT FOUND" before quoting it: one of the two clauses
  // this sample called wrong was the sample being wrong about the card. That
  // is a finding about the INSTRUMENT, of exactly the kind docs/13 §5 is
  // about, and it is the reason the tally is not allowed to quietly become a
  // better-looking percentage.
  const { h, A, D } = open(18213);
  const mine1 = spawn(h, A, VANILLA), mine2 = spawn(h, A, VANILLA);
  const spare1 = spawn(h, A, VANILLA), spare2 = spawn(h, A, VANILLA), spare3 = spawn(h, A, VANILLA);
  spawn(h, D, VANILLA); spawn(h, D, VANILLA); spawn(h, D, VANILLA);
  giveResources(h, A, 'water', 4); giveResources(h, A, 'fire', 4);
  intoBattle(h, A, [[mine1], [mine2], [spare1], [spare2], [spare3]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });
  h.do({ type: 'decide', seat: A, choice: h.state.decision!.options.findIndex(o => o.value === 2) });
  pick(h, { unit: mine1 }); pick(h, { unit: mine2 });
  let guard = 40;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(unitsOf(h, A).length, 1,
    'A: 5 units − 2 recalled − 2 sacrificed = 1. R221: the sacrifice scales with X, so X=2 is TWO.');
  assert.equal(unitsOf(h, D).length, 1,
    'D: 3 units − 2 sacrificed = 1. R221: the opponent scales too — "each player".');
  ok('Torrential Reclamation', 'amount: the sacrifice scales per ally recalled (R221)');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// OMNIWIELD EVOKER — mmm/3 Cosmic Robot Unit 2/1
//   "[three]: [Switch] Put a +1/+1 counter on me."
// ════════════════════════════════════════════════════════════════════════

test('Omniwield Evoker: [three] buys exactly one +1/+1 counter, on ITSELF, repeatably', () => {
  const { h, A } = open(18214);
  const evoker = spawn(h, A, 'Omniwield Evoker');     // 2/1
  const bystander = spawn(h, A, VANILLA);
  giveResources(h, A, 'metal', 7);
  assert.deepEqual(effStats(h, evoker), [2, 1], 'printed 2/1 to start');

  h.do({ type: 'activateAbility', seat: A, entityId: evoker, abilityIndex: 0 });
  drain(h);
  // AMOUNT — one counter, not two, and it is a +1/+1 counter (net +1/+1).
  assert.equal(ent(h, evoker)!.counters, 1, 'exactly one counter');
  assert.deepEqual(effStats(h, evoker), [3, 2], '+1/+1');
  ok('Omniwield Evoker', 'amount: exactly one +1/+1 counter');
  // TARGET — "on ME".
  assert.equal(ent(h, bystander)!.counters, 0, 'nobody else got one');
  ok('Omniwield Evoker', 'target: the counter goes on the Evoker itself');
  // COST — exactly [three].
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 4,
    '7 open − 3 = 4: the cost is [three], not [two] and not [four]');
  ok('Omniwield Evoker', 'cost: exactly [three]');
  // NO BUDGET — the card prints no [once] and no [Switch1], so it repeats.
  h.do({ type: 'activateAbility', seat: A, entityId: evoker, abilityIndex: 0 });
  drain(h);
  assert.equal(ent(h, evoker)!.counters, 2,
    'the card prints no [once] and no bounded-graft marker, so the ability repeats');
  ok('Omniwield Evoker', 'timing: unbounded — no once-per-turn limit is printed');
});

// ════════════════════════════════════════════════════════════════════════
// SCAVENGING SENTRY — mm/2 Occult Scrap Unit 2/2
//   "[Augment] Sacrifice another unit: Put a +1/+1 counter on me."
// ════════════════════════════════════════════════════════════════════════

test('Scavenging Sentry: the cost is ANOTHER unit — never itself — and it pays one counter', () => {
  const { h, A, D } = open(18215);
  const sentry = spawn(h, A, 'Scavenging Sentry');
  const food = spawn(h, A, VANILLA);
  const theirs = spawn(h, D, VANILLA);
  h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' });

  const cost = h.state.decision!;
  const menu = cost.options.map(o => JSON.stringify(o.value));
  assert.ok(menu.includes(JSON.stringify({ unit: food })) || menu.includes(String(food)),
    `another unit of mine is a legal sacrifice; menu was [${cost.options.map(o => o.label)}]`);
  assert.ok(!menu.includes(JSON.stringify({ unit: sentry })) && !menu.includes(String(sentry)),
    '"ANOTHER unit" — the Sentry may never eat itself');
  ok('Scavenging Sentry', 'cost: "another unit" excludes the Sentry itself');
  assert.ok(!menu.includes(JSON.stringify({ unit: theirs })) && !menu.includes(String(theirs)),
    'you sacrifice your OWN units — an enemy unit is not a cost you can pay');
  ok('Scavenging Sentry', 'cost: the sacrifice is one of the activator’s own units');

  h.do({ type: 'decide', seat: A, choice: cost.options.findIndex(o => JSON.stringify(o.value).includes(String(food))) });
  drain(h);
  assert.equal(ent(h, food), undefined, 'the cost was actually paid');
  assert.equal(ent(h, sentry)!.counters, 1, 'exactly one +1/+1 counter, on the Sentry');
  assert.deepEqual(effStats(h, sentry), [3, 3], '2/2 → 3/3');
  ok('Scavenging Sentry', 'effect: exactly one +1/+1 counter on the Sentry');
});

// ════════════════════════════════════════════════════════════════════════
// PALLID GORGER — d/2 {Virus} Alien Unit 1/1
//   "[Augment] Discard a card or sacrifice a nontoken unit: I gain +2/+2
//    until regroup."
// ════════════════════════════════════════════════════════════════════════

test('Pallid Gorger: either cost is offered, and +2/+2 lasts until REGROUP (not permanently)', () => {
  const { h, A } = open(18216);
  const gorger = spawn(h, A, 'Pallid Gorger');        // 1/1
  const food = spawn(h, A, VANILLA);
  h.state.players[A]!.hand = ['Unit Token'];
  h.do({ type: 'activateAbility', seat: A, entityId: gorger, abilityIndex: 0, via: 'augment' });

  const cost = h.state.decision!;
  const labels = cost.options.map(o => String(o.label));
  assert.ok(labels.some(l => /discard/i.test(l)), `"Discard a card" is one of the costs; saw [${labels}]`);
  assert.ok(labels.some(l => /sacrifice/i.test(l)), `"or sacrifice a nontoken unit" is the other; saw [${labels}]`);
  ok('Pallid Gorger', 'cost: BOTH printed modes are offered, as a choice');

  h.do({ type: 'decide', seat: A, choice: labels.findIndex(l => /discard/i.test(l)) });
  let guard = 20;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.hand.length, 0, 'the discard cost was paid');
  assert.ok(ent(h, food), 'and paying the discard did NOT also sacrifice a unit');
  ok('Pallid Gorger', 'cost: paying one mode does not also charge the other');

  // AMOUNT + KIND — "gains +2/+2", a temporary buff, not counters.
  assert.deepEqual(effStats(h, gorger), [3, 3], '1/1 → 3/3');
  assert.equal(ent(h, gorger)!.counters, 0, '"gains +2/+2" is not "put two +1/+1 counters"');
  ok('Pallid Gorger', 'amount: +2/+2');

  // DURATION — until regroup.
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  finishBattle(h);
  assert.deepEqual(effStats(h, gorger), [1, 1], '"until regroup" ended at regroup');
  ok('Pallid Gorger', 'duration: until regroup');
});

// ════════════════════════════════════════════════════════════════════════
// PLAGUE BELLOWER — g/2 Insect Plant Unit 2/2
//   "[Augment] [three]: Each opponent chooses one of their units. Put a
//    -1/-1 counter on each of the chosen units."
// ════════════════════════════════════════════════════════════════════════

test('Plague Bellower: the OPPONENT picks, one of THEIRS, and it takes exactly one -1/-1 counter', () => {
  const { h, A, D } = open(18217);
  const bellower = spawn(h, A, 'Plague Bellower');
  const mine = spawn(h, A, VANILLA);   // the attacker, so A is present in D's region
  const t1 = spawn(h, D, VANILLA);
  const t2 = spawn(h, D, VANILLA);
  giveResources(h, A, 'wood', 3);
  // in BATTLE, so both players are present in the region an effect reaches
  // (R25). During deployment the opponent is in their own region and the
  // ability finds nobody — an engine-wide presence rule, not this card.
  intoBattle(h, A, [[bellower, mine]]);
  h.do({ type: 'activateAbility', seat: A, entityId: bellower, abilityIndex: 0, via: 'augment' });
  drain0(h);

  const pickDec = h.state.decision!;
  assert.equal(pickDec.seat, D, 'the OPPONENT chooses — not me');
  ok('Plague Bellower', 'agent: each opponent chooses');
  const vals = pickDec.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.some(v => v.includes(String(t1))) && vals.some(v => v.includes(String(t2))),
    'they choose among THEIR units');
  assert.ok(!vals.some(v => v.includes(String(mine))) && !vals.some(v => v.includes(String(bellower))),
    '"one of THEIR units" — my units are not on their menu');
  ok('Plague Bellower', 'target: one of the opponent’s own units');

  h.do({ type: 'decide', seat: D, choice: vals.findIndex(v => v.includes(String(t1))) });
  drain(h);
  assert.equal(ent(h, t1)!.counters, -1, 'exactly one -1/-1 counter on the chosen unit');
  assert.deepEqual(effStats(h, t1), [2, 2], '3/3 → 2/2');
  ok('Plague Bellower', 'amount: one -1/-1 counter');
  assert.equal(ent(h, t2)!.counters, 0, 'and only ONE of their units — the chosen one');
  assert.equal(ent(h, mine)!.counters, 0, 'nothing of mine is touched');
  assert.equal(ent(h, bellower)!.counters, 0, 'including the Bellower');
  ok('Plague Bellower', 'target discipline: only the chosen unit');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// HAND PEEPER — l/1 Horror Unit 0/2
//   "[Augment] Pay 3 life: Look at target player's hand."
// ════════════════════════════════════════════════════════════════════════

test('Hand Peeper: exactly 3 life, any player is targetable, and only I see the hand', () => {
  const { h, A, D } = open(18218);
  const peeper = spawn(h, A, 'Hand Peeper');
  intoBattle(h, A, [[peeper]]);            // both players present (R25)
  h.state.players[D]!.hand = ['Luminous Arc', 'Jelly'];
  h.state.players[A]!.hand = [];
  const lifeBefore = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: peeper, abilityIndex: 0, via: 'augment' });

  // TARGET — "target player" carries no qualifier: either player.
  assert.ok(offered(h).includes(JSON.stringify({ player: D })), 'the opponent is targetable');
  assert.ok(offered(h).includes(JSON.stringify({ player: A })),
    '"target player" is unqualified — I may look at my own hand');
  ok('Hand Peeper', 'target: "target player" — either player');
  pick(h, { player: D });
  drain(h);

  // COST — exactly 3 life.
  assert.equal(lifeBefore - h.state.players[A]!.life, 3, 'the cost is 3 life, exactly');
  ok('Hand Peeper', 'cost: exactly 3 life');

  // EFFECT — the ACTIVATOR is shown the hand. `seenHand` is the private
  // channel a client renders; the log is the public one (R197b), so the look
  // is read off the former and the absence of a leak off the latter.
  assert.deepEqual(h.state.seenHand[A]?.cards, ['Luminous Arc', 'Jelly'],
    'the activator is actually shown the cards — "LOOK AT target player\'s hand"');
  ok('Hand Peeper', 'effect: the activator sees the whole hand');
  assert.ok(!h.state.seenHand[D], 'the hand’s owner learns nothing new about mine');
  // "LOOK AT", not "reveals": the cards must not reach the table (R197b).
  for (const s of [A, D] as Seat[]) {
    assert.deepEqual(logFor(h, s).filter(l => l.includes('Luminous Arc')), [],
      `a LOOK is private — no log line names the hand to seat ${s}`);
  }
  ok('Hand Peeper', 'effect: "look at" is private, not a public reveal');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// A FAST PILE OF ROCKS — e/2 {Haste} Rock Pile Unit 2/1
//   "When I die, [Switch] Rockfall 4. {i}(Each player chooses one of their
//    units. I deal 4 damage to each of the chosen units.)"
// ════════════════════════════════════════════════════════════════════════

test('A Fast Pile of Rocks: on MY death each player picks one of THEIR OWN units for exactly 4', () => {
  const { h, A, D } = open(18219);
  const rocks = spawn(h, A, 'A Fast Pile of Rocks');   // 2/1
  const myAnvil = spawn(h, A, ANVIL);
  const mySpare = spawn(h, A, ANVIL);                  // so I am ASKED, not auto-picked
  const theirAnvil = spawn(h, D, ANVIL);
  const theirSpare = spawn(h, D, ANVIL);
  giveResources(h, A, 'fire', 2);
  intoBattle(h, A, [[rocks], [myAnvil], [mySpare]]);
  h.state.players[A]!.hand = [];

  // TIMING — nothing happens until it dies.
  assert.equal(ent(h, theirAnvil)!.damage, 0, 'no Rockfall while the Rock Pile is alive');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: rocks });                            // 6 damage kills the 2/1
  drain0(h);
  assert.equal(ent(h, rocks), undefined, 'the Rock Pile died');
  ok('A Fast Pile of Rocks', 'timing: the trigger is "when I DIE"');

  // TARGET — "EACH PLAYER chooses one of THEIR units": two questions, each
  // asking its own controller, each offering only that controller's units.
  const seen: Seat[] = [];
  let guard = 20;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    seen.push(dec.seat);
    for (const o of dec.options) {
      const raw = JSON.stringify(o.value);
      const id = Number(raw.replace(/[^0-9]/g, ''));
      const u = h.state.entities[id];
      if (u) {
        assert.equal(u.controller, dec.seat,
          `seat ${dec.seat} is offered ${u.card} controlled by ${u.controller} — "one of THEIR units"`);
      }
    }
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => JSON.stringify(o.value).includes(
      dec.seat === A ? String(myAnvil) : String(theirAnvil))) });
    if (!h.state.decision && h.state.stack.length) drain0(h);
  }
  assert.deepEqual(seen.slice().sort(), [A, D].sort(), 'BOTH players were asked, exactly once each');
  ok('A Fast Pile of Rocks', 'target: each player chooses one of their OWN units');
  drain(h);

  // AMOUNT — 4 to each chosen unit, and to nothing else.
  assert.equal(ent(h, myAnvil)!.damage, 4, 'my chosen unit took exactly 4 — I am a "player" too');
  assert.equal(ent(h, theirAnvil)!.damage, 4, 'and so did theirs');
  ok('A Fast Pile of Rocks', 'amount: exactly 4 damage to each chosen unit');
  assert.equal(ent(h, theirSpare)!.damage, 0, 'their unchosen unit took nothing');
  assert.equal(ent(h, mySpare)!.damage, 0, 'and my unchosen unit took nothing');
  ok('A Fast Pile of Rocks', 'target discipline: only the two chosen units');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// FORAGER OF THE FALLEN — gg/2 Fungus Druid Unit 2/2
//   "When an enemy dies, [Switch1] Create a 2/2 unit."
// ════════════════════════════════════════════════════════════════════════

test('Forager of the Fallen: an ENEMY death makes one 2/2 — an ally death makes none', () => {
  const { h, A, D } = open(18220);
  const forager = spawn(h, A, 'Forager of the Fallen');
  const myFodder = spawn(h, A, 'Unit Token');
  const theirFodder = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 4);
  intoBattle(h, A, [[forager, myFodder]]);
  h.state.players[A]!.hand = [];

  // an ALLY dying is not "an enemy" dying.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: myFodder });
  drain(h);
  assert.equal(ent(h, myFodder), undefined, 'my own unit died');
  assert.equal(unitsOf(h, A).filter(u => u.tokenStats?.[0] === 2).length, 0,
    '"when an ENEMY dies" — my own unit dying makes nothing');
  ok('Forager of the Fallen', 'trigger: an ALLY death does not fire it');

  // an ENEMY dying does.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: theirFodder });
  drain(h);
  assert.equal(ent(h, theirFodder), undefined, 'their unit died');
  const made = unitsOf(h, A).filter(u => u.tokenStats?.[0] === 2 && u.tokenStats?.[1] === 2);
  assert.equal(made.length, 1, 'exactly ONE 2/2 unit, and it is mine');
  ok('Forager of the Fallen', 'trigger: an ENEMY death fires it');
  ok('Forager of the Fallen', 'amount: exactly one 2/2 unit');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// GHORD — rr/3 Infernal Beast Unit 4/3
//   "When you sacrifice a unit, [Switch1] Each opponent sacrifices a
//    nontoken unit."
// ════════════════════════════════════════════════════════════════════════

test('Ghord: my sacrifice makes each opponent sacrifice one NONTOKEN unit', () => {
  const { h, A, D } = open(18221);
  const ghord = spawn(h, A, 'Ghord');
  const sentry = spawn(h, A, 'Scavenging Sentry');    // its cost is a sacrifice
  const food = spawn(h, A, VANILLA);
  const theirToken = spawnToken(h, D);
  const theirReal = spawn(h, D, VANILLA);
  intoBattle(h, A, [[ghord], [sentry], [food]]);

  h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: food });                             // I sacrifice a unit …
  drain0(h);
  const dec = h.state.decision;
  assert.ok(dec, 'Ghord heard the sacrifice and the opponent is asked to pick');
  assert.equal(dec!.seat, D, 'the OPPONENT chooses their own sacrifice');
  ok('Ghord', 'trigger: fires when the controller sacrifices a unit');

  // "a NONTOKEN unit" — their token is not a legal sacrifice.
  const vals = dec!.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.some(v => v.includes(String(theirReal))), 'their nontoken unit is on the menu');
  assert.ok(!vals.some(v => v.includes(String(theirToken))),
    '"a NONTOKEN unit" — their token unit is not');
  ok('Ghord', 'restriction: the opponent’s sacrifice must be a nontoken unit');
  h.do({ type: 'decide', seat: D, choice: vals.findIndex(v => v.includes(String(theirReal))) });
  drain(h);
  assert.equal(ent(h, theirReal), undefined, 'and they really sacrificed it');
  assert.ok(ent(h, theirToken), 'exactly one unit, and not the token');
  ok('Ghord', 'amount: exactly one unit per opponent');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// STONEBORN PROGENITOR — ee/2 Mystic Rock Unit 1/3
//   "When one of your units survives damage, [Switch1] Create a 2/2 unit."
// ════════════════════════════════════════════════════════════════════════

test('Stoneborn Progenitor: my unit SURVIVING damage makes one 2/2 — a death makes none', () => {
  const { h, A } = open(18222);
  const stone = spawn(h, A, 'Stoneborn Progenitor');
  const tough = spawn(h, A, ANVIL);                    // 0/13 — survives 6
  const frail = spawn(h, A, 'Unit Token');             // 1/1 — does not
  giveResources(h, A, 'fire', 4);
  intoBattle(h, A, [[stone], [tough], [frail]]);
  h.state.players[A]!.hand = [];

  // a unit of mine that DIES to the damage is not one that "survives damage"
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: frail });
  drain(h);
  assert.equal(ent(h, frail), undefined, 'it died');
  assert.equal(unitsOf(h, A).filter(u => u.tokenStats?.[0] === 2).length, 0,
    'dying is not surviving');
  ok('Stoneborn Progenitor', 'trigger: a unit that dies to the damage does not fire it');

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: tough });
  drain(h);
  assert.equal(ent(h, tough)!.damage, 6, 'it took the damage and lived');
  const made = unitsOf(h, A).filter(u => u.tokenStats?.[0] === 2 && u.tokenStats?.[1] === 2);
  assert.equal(made.length, 1, 'exactly one 2/2 unit');
  ok('Stoneborn Progenitor', 'trigger: a unit of mine surviving damage fires it');
  ok('Stoneborn Progenitor', 'amount: exactly one 2/2 unit');
  finishBattle(h);
});

test('Torrential Reclamation: with X = 0 the sacrifice STILL happens, and costs no life (R221)', () => {
  // The same sentence, the other end of it, and the half of the ticket that
  // survived the ruling. "Recall X target nontoken allies. THEN each player
  // sacrifices a unit …" — the sacrifice is not GATED on the recall, so X = 0
  // still costs every player a unit and costs me 0 life. The engine used to
  // return early on `x <= 0` and skip the printed sentence entirely.
  //
  // ⚠ WHY THIS SURVIVED WHEN THE ROW ABOVE DID NOT. The owner was offered
  // "both clauses scale, and therefore X = 0 does nothing" — which would have
  // closed this ticket outright — and did NOT take it. He took "both scale,
  // and still fire the second sentence at X = 0". So the sacrifice clause is
  // UNCONDITIONAL with the scaling on top: max(1, recalled) rounds. The life
  // loss is purely scaled and stays at zero here, which is what separates the
  // two halves of the sentence and is asserted below.
  const { h, A, D } = open(18256);
  const mine = spawn(h, A, VANILLA), spare = spawn(h, A, VANILLA);
  spawn(h, D, VANILLA); spawn(h, D, VANILLA);
  giveResources(h, A, 'water', 4); giveResources(h, A, 'fire', 4);
  intoBattle(h, A, [[mine], [spare]]);
  h.state.players[A]!.hand = [];
  const lifeBefore = h.state.players[A]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });
  h.do({ type: 'decide', seat: A, choice: h.state.decision!.options.findIndex(o => o.value === 0) });
  let guard = 25;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(unitsOf(h, A).length, 1, 'R221: the sacrifice is not gated on the recall — 2 → 1');
  assert.equal(unitsOf(h, D).length, 1, 'R221: "EACH player" — the opponent sacrifices at X=0 too, 2 → 1');
  assert.equal(h.state.players[A]!.life, lifeBefore,
    'no ally recalled, no life lost. THIS IS THE ASSERTION THAT SEPARATES THE TWO CLAUSES: the '
    + 'sacrifice is unconditional, the life loss is purely scaled. If a future change makes X=0 '
    + 'cost life, it has collapsed them back together.');
  ok('Torrential Reclamation', 'timing: the sacrifice clause is not gated on X > 0 (R221)');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// SCRAPYARD CUSTODIAN — me/3 Robot Druid Unit 3/3
//   "When you put one or more counters on an ally, [Switch1] Draw a card."
// ════════════════════════════════════════════════════════════════════════

test('Scrapyard Custodian: counters on an ALLY draw ONE card — "one or more", once per turn', () => {
  const { h, A, D } = open(18223);
  const cust = spawn(h, A, 'Scrapyard Custodian');
  const myUnit = spawn(h, A, ANVIL);
  const theirUnit = spawn(h, D, ANVIL);
  giveResources(h, A, 'dark', 4);
  intoBattle(h, A, [[cust], [myUnit]]);
  h.state.players[A]!.hand = [];

  // a counter on an ENEMY is not a counter on an ALLY
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });   // two -1/-1 counters
  pick(h, { unit: theirUnit });
  drain(h);
  assert.equal(ent(h, theirUnit)!.counters, -2, 'the counters landed on the enemy');
  assert.equal(h.state.players[A]!.hand.length, 0, '"on an ALLY" — an enemy does not fire it');
  ok('Scrapyard Custodian', 'trigger: counters on an ENEMY do not fire it');

  // two counters on an ally in one event = ONE card, not two
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });
  pick(h, { unit: myUnit });
  drain(h);
  assert.equal(ent(h, myUnit)!.counters, -2, 'two counters, one event');
  assert.equal(h.state.players[A]!.hand.length, 1,
    '"ONE OR MORE counters … draw A card" — one card for the event, not one per counter');
  ok('Scrapyard Custodian', 'trigger: counters on an ally fire it');
  ok('Scrapyard Custodian', 'amount: one card per EVENT, not per counter');

  // [Switch1] is the bounded marker: once per turn
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });
  pick(h, { unit: myUnit });
  drain(h);
  assert.equal(ent(h, myUnit)!.counters, -4, 'a third Umbral Decay landed');
  assert.equal(h.state.players[A]!.hand.length, 1,
    '[Switch1] is the BOUNDED marker (docs 12 §graft) — once per turn, so no second draw');
  ok('Scrapyard Custodian', 'timing: [Switch1] bounds it to once per turn');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// WANDERING BLIGHTSHELL — g/2 Blight Turtle Unit 1/2
//   "When you put a counter on an enemy, [Switch1] Draw a card."
// ════════════════════════════════════════════════════════════════════════

test('Wandering Blightshell: the mirror of the Custodian — an ENEMY counter draws, an ally’s does not', () => {
  const { h, A, D } = open(18224);
  const shell = spawn(h, A, 'Wandering Blightshell');
  const myUnit = spawn(h, A, ANVIL);
  const theirUnit = spawn(h, D, ANVIL);
  giveResources(h, A, 'dark', 4);
  intoBattle(h, A, [[shell], [myUnit]]);
  h.state.players[A]!.hand = [];

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });
  pick(h, { unit: myUnit });
  drain(h);
  assert.equal(h.state.players[A]!.hand.length, 0, '"on an ENEMY" — my own unit does not fire it');
  ok('Wandering Blightshell', 'trigger: counters on an ALLY do not fire it');

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });
  pick(h, { unit: theirUnit });
  drain(h);
  assert.equal(h.state.players[A]!.hand.length, 1, 'exactly one card');
  ok('Wandering Blightshell', 'trigger: counters on an ENEMY fire it');
  ok('Wandering Blightshell', 'amount: exactly one card');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// SPEWING MUSHROOM — g/2 Fungus Slime Unit 1/3
//   "When I attack or block, [Switch] Create a Poison X, where X is my power."
// ════════════════════════════════════════════════════════════════════════

test('Spewing Mushroom: attacking makes a Poison X where X is its power AT THAT MOMENT', () => {
  const { h, A } = open(18225);
  const mush = spawn(h, A, 'Spewing Mushroom');        // printed 1/3
  intoBattle(h, A, [[mush]]);
  drain(h);
  let poisons = tokensOf(h, A).filter(t => t.card === 'Poison');
  assert.equal(poisons.length, 1, 'attacking created exactly one Poison');
  assert.equal(poisons[0]!.x, 1, 'X is my power, and my power is 1');
  ok('Spewing Mushroom', 'trigger: "when I attack" fires on the attack');
  ok('Spewing Mushroom', 'amount: X = the Mushroom’s power');
  finishBattle(h);
});

test('Spewing Mushroom: X tracks the CURRENT power — a 3/5 Mushroom makes a Poison 3', () => {
  const { h, A } = open(18226);
  const mush = spawn(h, A, 'Spewing Mushroom');
  new E(h.state).addCounters(h.state.entities[mush]!, 2);    // 1/3 → 3/5
  assert.deepEqual(effStats(h, mush), [3, 5], 'the board is what the test claims');
  intoBattle(h, A, [[mush]]);
  drain(h);
  const poisons = tokensOf(h, A).filter(t => t.card === 'Poison');
  assert.equal(poisons.length, 1, 'one Poison');
  assert.equal(poisons[0]!.x, 3,
    '"where X is MY POWER" — the power it has now, not the 1 it was printed with');
  ok('Spewing Mushroom', 'amount: X reads current power, not printed power');
  finishBattle(h);
});

test('Spewing Mushroom: BLOCKING fires it too — the clause is "attack OR block"', () => {
  const { h, A, D } = open(18227);
  const mush = spawn(h, D, 'Spewing Mushroom');        // D is the defender, so it BLOCKS
  const raider = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  let g0 = 20;
  while (h.state.battle!.step !== 'blocks' && g0-- > 0) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [mush] } });
  let guard = 30;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  const poisons = tokensOf(h, D).filter(t => t.card === 'Poison');
  assert.equal(poisons.length, 1, 'blocking created a Poison too');
  assert.equal(poisons[0]!.x, 1, 'X = its power');
  ok('Spewing Mushroom', 'trigger: "or BLOCK" is implemented, not only the attack half');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// VISAGE OF RUIN — lll/6 Spirit Anima Unit 4/5
//   "[Augment] When I attack or block, each player loses half of their life
//    total, rounded up."
// ════════════════════════════════════════════════════════════════════════

test('Visage of Ruin: EACH player — its own controller included — loses half its OWN total, rounded up', () => {
  const { h, A, D } = open(18228);
  const visage = spawn(h, A, 'Visage of Ruin');
  h.state.players[A]!.life = 30;
  h.state.players[D]!.life = 25;                       // odd, to pin "rounded UP"
  intoBattle(h, A, [[visage]]);
  drain(h);
  assert.equal(h.state.players[A]!.life, 15, 'the attacker’s own controller loses half of 30 = 15');
  ok('Visage of Ruin', 'scope: "each player" includes the controller');
  assert.equal(h.state.players[D]!.life, 12,
    'the opponent loses half of THEIR OWN 25, rounded up = 13 → 12 left '
    + '(not half of 30, and not 12 rounded down)');
  ok('Visage of Ruin', 'amount: half of each player’s OWN total, rounded up');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// THE OMNIPHAGE — ed/8 Ancient Primordial Horror Unit 5/5
//   "[Augment] I gain all attributes of units in your bin."
// ════════════════════════════════════════════════════════════════════════

test('The Omniphage: attributes of UNITS in MY bin — not of spells, not of the opponent’s bin', () => {
  const { h, A, D } = open(18229);
  const phage = spawn(h, A, 'The Omniphage');
  assert.deepEqual([...ownAttrs(h, phage)], [], 'an empty bin grants nothing');

  h.state.players[A]!.bin = ['Carapace Devourer'];       // e/2 3/3 {Deadly} UNIT, no text
  assert.ok(ownAttrs(h, phage).has('Deadly'),
    'a unit in my bin donates its attribute — and it is a STATIC, so it is live at once');
  ok('The Omniphage', 'effect: gains the attributes of units in the controller’s bin');

  h.state.players[A]!.bin = ['Umbral Decay'];            // d/1 {Afflicting} SPELL
  assert.ok(!ownAttrs(h, phage).has('Afflicting'),
    '"attributes of UNITS in your bin" — a SPELL in the bin donates nothing');
  ok('The Omniphage', 'restriction: units only, not spells');

  h.state.players[A]!.bin = [];
  h.state.players[D]!.bin = ['Carapace Devourer'];
  assert.ok(!ownAttrs(h, phage).has('Deadly'),
    '"in YOUR bin" — the opponent’s bin is not mine');
  ok('The Omniphage', 'restriction: the controller’s bin, not any bin');

  // ALL attributes, plural — two different units donate both
  h.state.players[D]!.bin = [];
  h.state.players[A]!.bin = ['Carapace Devourer', 'Bumblecrab'];   // {Deadly} + {Piercing}
  const got = ownAttrs(h, phage);
  assert.ok(got.has('Deadly') && got.has('Piercing'), `"ALL attributes"; got [${[...got]}]`);
  ok('The Omniphage', 'scope: ALL of them, from every unit in the bin');
});

// ════════════════════════════════════════════════════════════════════════
// TRASHLING — m/2 2/2, type line "[Augment] {Unaware} Scrap Robot {Virus} Unit"
//   No text box at all: the whole card is its type line.
// ════════════════════════════════════════════════════════════════════════

test('Trashling: {Unaware} on its own body, and donated to a host when it is applied as an augment', () => {
  const { h, A } = open(18230);
  const trashling = spawn(h, A, 'Trashling');
  assert.ok(ownAttrs(h, trashling).has('Unaware'), 'the printed body has {Unaware}');
  ok('Trashling', 'body: the type line’s {Unaware} is on the card itself');

  const host = spawn(h, A, VANILLA);
  assert.ok(!ownAttrs(h, host).has('Unaware'), 'the host starts without it');
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Trashling'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'),
    'the [Augment] marker on the type line donates the type line’s attributes (R55/mods.py rule)');
  ok('Trashling', 'augment: applying it donates {Unaware} to the host');
});

test('Trashling: the type line’s {Virus} is live — only a Virus may augment a SPELL ON THE STACK', () => {
  // R79 / Caleb 2025-04-06: "you can augment a spell with a virus, such as
  // applying Chitin Shredder as an augment on Arc Lightning — yes". Asserting
  // `getCard('Trashling').virus` would only prove printed.json agrees with
  // itself, so the flag is checked through the permission it is supposed to buy
  // — with the non-Virus control that shows the permission is not free.
  const { h, A, D } = open(18249);
  const host = spawn(h, A, VANILLA);
  giveResources(h, A, 'metal', 2); giveResources(h, A, 'earth', 4);
  giveResources(h, A, 'water', 2);
  giveResources(h, D, 'fire', 2);
  intoBattle(h, A, [[host]], D);
  h.state.players[A]!.hand = []; h.state.players[D]!.hand = [];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: host });
  const spell = h.state.stack[0]!.id;

  // ⚠ the control card has to be a NON-Virus augment. Rampart Guardian looks
  // like one and is not: its type line reads "[Augment] {Tough} Rock Guardian
  // {Virus} Unit". Curio Drifter is "[Augment] {Evasive} Cosmic Sprite Unit".
  const nonVirus = give(h, A, 'Curio Drifter');          // b/1, no {Virus}
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: nonVirus, hostStack: spell }),
    /only Virus cards can augment from hand during battle/,
    'the control: a non-Virus augment cannot touch a spell on the stack');
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Trashling'), hostStack: spell });
  assert.ok(h.state.stack.some(it => it.kind === 'virus' && it.card === 'Trashling'),
    'a {Virus} may — the augment is itself on the stack, above the spell it rides');
  ok('Trashling', 'type line: {Virus} buys the augment-a-spell-on-the-stack permission');
  drain(h);
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// COUNTER THIEF — md/4 {Virus} Infection Unit 0/5
//   "[Augment] If one or more counters would be placed on one or more units
//    during battle, those counters are placed on me instead."
// ════════════════════════════════════════════════════════════════════════

test('Counter Thief: DURING BATTLE the counters land on it instead — and it takes them all', () => {
  const { h, A, D } = open(18231);
  const thief = spawn(h, A, 'Counter Thief');
  const victim = spawn(h, D, ANVIL);
  giveResources(h, A, 'dark', 1);
  intoBattle(h, A, [[thief]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });   // two -1/-1
  pick(h, { unit: victim });
  drain(h);
  assert.equal(ent(h, victim)!.counters, 0, 'the unit the counters were aimed at got none');
  assert.equal(ent(h, thief)!.counters, -2,
    'BOTH counters were redirected — "one or MORE counters", not one of them');
  ok('Counter Thief', 'effect: counters headed for a unit land on the Thief instead');
  ok('Counter Thief', 'amount: all of them, not one');
  finishBattle(h);
});

test('Counter Thief: OUTSIDE battle it does nothing — "during battle" is a real qualifier', () => {
  const { h, A } = open(18232);
  const thief = spawn(h, A, 'Counter Thief');
  const evoker = spawn(h, A, 'Omniwield Evoker');       // "[three]: put a +1/+1 counter on me"
  giveResources(h, A, 'metal', 3);
  h.do({ type: 'activateAbility', seat: A, entityId: evoker, abilityIndex: 0 });
  drain(h);
  assert.equal(ent(h, evoker)!.counters, 1,
    'this is DEPLOYMENT, so the counter stays where the card put it');
  assert.equal(ent(h, thief)!.counters, 0, 'the Thief takes nothing outside battle');
  ok('Counter Thief', 'timing: the replacement is restricted to the battle phase');
});

// ════════════════════════════════════════════════════════════════════════
// FLZZZ — lll/4 {Blessed} Horror Unit 1/3, "[2] Prophecy — Two Turns Pass"
//   "[Augment] Whenever you gain life, each opponent loses that much life."
// ════════════════════════════════════════════════════════════════════════

test('Flzzz: {Blessed} is live on the body, and its own drain fires off the life it heals', () => {
  // Reading the attribute off `getCard` would only assert that printed.json
  // agrees with itself. The clause is checked through the BEHAVIOUR its
  // reminder text defines: "Damage dealt by a blessed source causes its
  // controller to gain that much life" — which then feeds the [Augment] drain,
  // so both halves of the card are proved by one unblocked attack.
  const { h, A, D } = open(18248);
  const flzzz = spawn(h, A, 'Flzzz');                 // 1/3 {Blessed}
  toNextBattle(h, A);
  h.state.players[A]!.life = 20; h.state.players[D]!.life = 20;
  h.do({ type: 'declareAttack', seat: A, columns: [[flzzz]] });
  let guard = 60;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      h.do({ type: 'decide', seat: dec.seat,
        choice: dec.kind === 'orderTriggers' ? dec.options.map((_, i) => i) as never : 0 });
      continue;
    }
    if (h.state.phase !== 'battle') break;
    const b = h.state.battle!;
    if (b.step === 'declare') { if (b.round === 2) break; h.do({ type: 'declareAttack', seat: b.attacker, columns: [] }); }
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.life, 21,
    '{Blessed}: the 1 damage it dealt healed its controller for 1');
  ok('Flzzz', 'type line: {Blessed} is live on the body');
  assert.equal(h.state.players[D]!.life, 18,
    '20 − 1 combat damage − 1 drain: the drain is exactly the life gained, and it '
    + 'is a SECOND loss on top of the damage, not the same one counted once');
  ok('Flzzz', 'chain: the {Blessed} gain feeds the [Augment] drain');
});

test('Flzzz: the printed prophecy banner is carried', () => {
  assert.deepEqual(getCard('Flzzz').prophecy, { mana: 2, condition: 'Two Turns Pass' },
    'the printed banner is "[2] Prophecy — Two Turns Pass"');
  ok('Flzzz', 'banner: prophecy cost 2, condition "Two Turns Pass"');
});

test('Flzzz: I gain 3 → each opponent loses exactly 3, and the drain is mine to take', () => {
  const { h, A, D } = open(18233);
  const flzzz = spawn(h, A, 'Flzzz');
  const target = spawn(h, A, VANILLA);
  giveResources(h, A, 'light', 2);
  intoBattle(h, A, [[flzzz], [target]]);
  h.state.players[A]!.hand = [];
  h.state.players[A]!.life = 20; h.state.players[D]!.life = 20;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Life Channel') });   // "You gain 3 life"
  let guard = 25;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.life, 23, 'the board is what the test claims: I gained 3');
  assert.equal(h.state.players[D]!.life, 17,
    '"each opponent loses THAT MUCH life" — 3, the amount gained, not a flat number');
  ok('Flzzz', 'trigger: fires on a life gain');
  ok('Flzzz', 'amount: the opponent loses exactly what was gained');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// LIFE PLANT — lg/7 Cosmic Fungus Unit 7/3
//   "[Augment][once] When you gain or lose life, create that many 1/1 units.
//    {i}(Damage causes loss of life)"
// ════════════════════════════════════════════════════════════════════════

test('Life Plant: a GAIN of 3 makes exactly three 1/1s, and [once] stops the second one', () => {
  const { h, A } = open(18234);
  const plant = spawn(h, A, 'Life Plant');
  const target = spawn(h, A, VANILLA);
  giveResources(h, A, 'light', 4);
  intoBattle(h, A, [[plant], [target]]);
  h.state.players[A]!.hand = [];
  const before = unitsOf(h, A).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Life Channel') });   // gain 3
  let guard = 30;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  const ones = unitsOf(h, A).filter(u => u.tokenStats?.[0] === 1 && u.tokenStats?.[1] === 1);
  assert.equal(ones.length, 3, '"create THAT MANY 1/1 units" — three life gained, three units');
  ok('Life Plant', 'trigger: fires on a life GAIN');
  ok('Life Plant', 'amount: one 1/1 per point of life');

  // [once] — a second life change this turn creates nothing
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Life Channel') });
  guard = 30;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.life, 36, 'the second gain really happened');
  assert.equal(unitsOf(h, A).filter(u => u.tokenStats?.[0] === 1).length, 3,
    '[once] is a per-turn limiter — no second batch');
  ok('Life Plant', 'timing: [once] bounds it to once per turn');
  assert.equal(unitsOf(h, A).length, before + 3, 'and nothing else was created');
  finishBattle(h);
});

test('Life Plant: a LOSS fires it too — the clause is "gain OR lose"', () => {
  const { h, A } = open(18235);
  const plant = spawn(h, A, 'Life Plant');
  const visage = spawn(h, A, 'Visage of Ruin');    // "each player loses half their life total"
  h.state.players[A]!.life = 8;                    // → A loses 4
  intoBattle(h, A, [[plant], [visage]]);
  let guard = 30;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.life, 4, 'the board is what the test claims: I lost 4');
  assert.equal(unitsOf(h, A).filter(u => u.tokenStats?.[0] === 1 && u.tokenStats?.[1] === 1).length, 4,
    '"when you gain OR LOSE life, create that many 1/1 units" — four lost, four units');
  ok('Life Plant', 'trigger: fires on a life LOSS as well as a gain');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// BIOMASS DEVOURER — m/2 Alien Robot Unit 3/2
//   "[Augment] Whenever a nontoken unit dies, you may pay [two] to erase it
//    and put two +1/+1 counters on me."
// ════════════════════════════════════════════════════════════════════════

test('Biomass Devourer: a NONTOKEN death offers the deal; paying erases the card and pays TWO counters', () => {
  const { h, A, D } = open(18236);
  const devourer = spawn(h, A, 'Biomass Devourer');       // 3/2
  const doomed = spawn(h, D, 'Unit Token');               // the CARD "Unit Token" — a nontoken unit
  giveResources(h, A, 'metal', 2);
  giveResources(h, A, 'fire', 2);
  intoBattle(h, A, [[devourer]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: doomed });
  drain0(h);

  const offer = h.state.decision!;
  assert.equal(offer.seat, A, 'the Devourer’s controller is offered the deal');
  assert.ok(offer.options.some(o => /declin/i.test(String(o.label))),
    `"you MAY pay" — declining is on the menu; saw [${offer.options.map(o => o.label)}]`);
  ok('Biomass Devourer', 'trigger: a nontoken unit dying offers the deal');
  const openBefore = h.state.players[A]!.resources.filter(r => r.state === 'open').length;
  h.do({ type: 'decide', seat: A, choice: offer.options.findIndex(o => /pay/i.test(String(o.label))) });
  drain(h);

  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, openBefore - 2,
    'the cost is [two], exactly');
  ok('Biomass Devourer', 'cost: exactly [two]');
  assert.equal(ent(h, devourer)!.counters, 2, 'TWO +1/+1 counters, not one');
  assert.deepEqual(effStats(h, devourer), [5, 4], '3/2 → 5/4');
  ok('Biomass Devourer', 'amount: two +1/+1 counters');
  assert.ok(h.state.players[D]!.erased?.includes('Unit Token'),
    '"to ERASE IT" — the dead card leaves the game');
  assert.ok(!h.state.players[D]!.bin.includes('Unit Token'), '…and is not sitting in the bin');
  ok('Biomass Devourer', 'effect: the dying card is erased, not binned');
  finishBattle(h);
});

test('Biomass Devourer: a TOKEN unit dying offers nothing — "a NONTOKEN unit dies"', () => {
  const { h, A, D } = open(18237);
  const devourer = spawn(h, A, 'Biomass Devourer');
  const doomed = spawnToken(h, D);                        // a REAL token
  giveResources(h, A, 'metal', 2);
  giveResources(h, A, 'fire', 2);
  intoBattle(h, A, [[devourer]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: doomed });
  drain(h);                                               // drain THROWS on an unanswered question
  assert.equal(ent(h, doomed), undefined, 'the token died');
  assert.equal(ent(h, devourer)!.counters, 0, 'and the Devourer was never offered the deal');
  ok('Biomass Devourer', 'restriction: a token death does not fire it');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// SHORELINE SPECTER — bb/2 Spirit Unit 3/2
//   "[Augment] After combat, you may recall target ally.
//    If you do, each opponent loses 2 life."
// ════════════════════════════════════════════════════════════════════════

test('Shoreline Specter: AFTER COMBAT, an ALLY (never an enemy) is recalled and the drain is 2', () => {
  const { h, A, D } = open(18238);
  const specter = spawn(h, A, 'Shoreline Specter');
  const friend = spawn(h, A, VANILLA);
  const foe = spawn(h, D, VANILLA);
  h.state.players[D]!.life = 20;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[specter], [friend]] });

  // TIMING — nothing before the combat step has run.
  let guard = 40;
  while (h.state.battle!.step !== 'blocks' && guard-- > 0) pass(h);
  const pending = h.state.decision;   // hoisted: assert.equal narrows in place
  assert.equal(pending, null, 'the Specter is silent until after combat');
  assert.ok(ent(h, friend), 'and nobody has been recalled yet');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });

  let offer: Decision | null = null;
  guard = 40;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec && /Shoreline Specter/.test(dec.prompt)) { offer = dec; break; }
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: dec.kind === 'orderTriggers' ? dec.options.map((_, i) => i) as never : 0 }); continue; }
    if (h.state.phase !== 'battle') break;
    if (h.state.battle!.step === 'declare') break;
    pass(h);
  }
  assert.ok(offer, 'the "after combat" trigger really fired');
  ok('Shoreline Specter', 'timing: the trigger is AFTER COMBAT');

  // TARGET — "target ALLY": the opponent's unit is not on the menu.
  const vals = offer!.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.some(v => v.includes(String(friend))), 'an ally is targetable');
  assert.ok(!vals.some(v => v.includes(String(foe))), '"target ALLY" — an enemy unit is not');
  ok('Shoreline Specter', 'target: allies only');
  const lifeBefore = h.state.players[D]!.life;
  h.do({ type: 'decide', seat: A, choice: vals.findIndex(v => v.includes(String(friend))) });

  // "you MAY recall" — the confirmation is a separate question, asked after
  // the target is named and the trigger has resolved off the stack.
  guard = 20;
  while (!h.state.decision && guard-- > 0) pass(h);
  const mayQ = h.state.decision!;
  assert.equal(mayQ.kind, 'payOrDecline', 'the "may" is asked, not assumed');
  assert.ok(mayQ.options.some(o => /^decline$/i.test(String(o.label))),
    `declining is on the menu; saw [${mayQ.options.map(o => o.label)}]`);
  ok('Shoreline Specter', 'timing: the recall is optional ("you may")');
  h.do({ type: 'decide', seat: A, choice: mayQ.options.findIndex(o => o.value === true) });
  guard = 40;
  while ((h.state.stack.length || (h.state.decision && !/Shoreline/.test(h.state.decision.prompt))) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(ent(h, friend), undefined, 'the ally left play');
  assert.ok(h.state.players[A]!.hand.includes(VANILLA), 'a RECALL puts the card in its controller’s hand');
  ok('Shoreline Specter', 'effect: recall = to hand');
  assert.equal(lifeBefore - h.state.players[D]!.life, 2,
    '"If you do, each opponent loses 2 life" — 2, exactly');
  ok('Shoreline Specter', 'rider: each opponent loses exactly 2 life');
});

// ════════════════════════════════════════════════════════════════════════
// MURKDROP DISTILLER — d/3 Alien Unit 2/3
//   "[once] When you trash another card, you may cache it. If you do, you
//    may play it until end of turn."
// ════════════════════════════════════════════════════════════════════════

test('Murkdrop Distiller: a trashed card may be cached, and cached is where it goes', () => {
  const { h, A } = open(18239);
  spawn(h, A, 'Murkdrop Distiller');
  const gorger = spawn(h, A, 'Pallid Gorger');    // its cost is "Discard a card" — R40: a trash
  h.state.players[A]!.hand = ['Luminous Arc'];
  h.do({ type: 'activateAbility', seat: A, entityId: gorger, abilityIndex: 0, via: 'augment' });
  const cost = h.state.decision!;
  h.do({ type: 'decide', seat: A, choice: cost.options.findIndex(o => /discard/i.test(String(o.label))) });

  let offer: Decision | null = null;
  let guard = 25;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec && /Murkdrop/i.test(dec.prompt)) { offer = dec; break; }
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: 0 }); continue; }
    if (!h.state.stack.length) break;
    pass(h);
  }
  assert.ok(offer, 'trashing a card fired the Distiller');
  assert.equal(offer!.seat, A, 'the Distiller’s controller is asked');
  ok('Murkdrop Distiller', 'trigger: fires when the controller trashes a card');
  assert.ok(offer!.options.some(o => /^decline$/i.test(String(o.label))),
    `"you MAY cache it" — declining is on the menu; saw [${offer!.options.map(o => o.label)}]`);
  ok('Murkdrop Distiller', 'timing: the cache is optional');

  h.do({ type: 'decide', seat: A, choice: offer!.options.findIndex(o => o.card === 'Luminous Arc') });
  guard = 25;
  while (h.state.stack.length && !h.state.decision && guard-- > 0) pass(h);

  assert.deepEqual((h.state.players[A]!.cache ?? []).map(c => c.card), ['Luminous Arc'],
    'the trashed card is in the CACHE (R41), not the bin');
  assert.ok(!h.state.players[A]!.bin.includes('Luminous Arc'), '…and not in the bin');
  ok('Murkdrop Distiller', 'effect: the trashed card is cached');

  // "you may play it UNTIL END OF TURN" — the permission carries an expiry,
  // and the expiry is THIS turn.
  assert.equal(h.state.players[A]!.cache![0]!.playableUntilTurn, h.state.turn,
    'the play permission expires at the end of the turn it was granted in');
  ok('Murkdrop Distiller', 'duration: playable until end of turn');
});

// ── "whose action is it?" — the possessive in each printed trigger ────────
//
// Three of the sampled cards gate their trigger on the word "YOU". A trigger
// that also fires on the OPPONENT doing the same thing is the commonest
// widening there is, and none of the three floor tests in the repo can see it.

test('Scrapyard Custodian: "When YOU put counters on an ally" — the OPPONENT doing it draws nothing', () => {
  const { h, A, D } = open(18240);
  const cust = spawn(h, A, 'Scrapyard Custodian');
  giveResources(h, D, 'dark', 1);
  intoBattle(h, A, [[cust]], D);
  h.state.players[A]!.hand = []; h.state.players[D]!.hand = [];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Umbral Decay') });
  pick(h, { unit: cust });                       // the opponent counters MY ally
  drain(h);
  assert.equal(ent(h, cust)!.counters, -2, 'the counters really landed on my ally');
  assert.equal(h.state.players[A]!.hand.length, 0,
    '"when YOU put" — the opponent putting them is not you');
  ok('Scrapyard Custodian', 'agent: "you", not "a player"');
  finishBattle(h);
});

test('Ghord: "When YOU sacrifice a unit" — the OPPONENT sacrificing does not fire it', () => {
  const { h, A, D } = open(18241);
  const ghord = spawn(h, A, 'Ghord');
  const mine = spawn(h, A, VANILLA);
  const theirSentry = spawn(h, D, 'Scavenging Sentry');
  const theirFood = spawn(h, D, VANILLA);
  intoBattle(h, A, [[ghord], [mine]], D);
  h.do({ type: 'activateAbility', seat: D, entityId: theirSentry, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: theirFood });                  // THEY sacrifice one of theirs
  drain(h);                                      // drain throws on an unanswered question
  assert.equal(ent(h, theirFood), undefined, 'they really sacrificed');
  assert.equal(unitsOf(h, A).length, 2, '"when YOU sacrifice" — none of mine was touched');
  ok('Ghord', 'agent: "you", not "a player"');
  finishBattle(h);
});

test('Flzzz: "Whenever YOU gain life" — the opponent gaining life drains nobody', () => {
  const { h, A, D } = open(18242);
  const flzzz = spawn(h, A, 'Flzzz');
  spawn(h, D, VANILLA);
  giveResources(h, D, 'light', 2);
  intoBattle(h, A, [[flzzz]], D);
  h.state.players[A]!.life = 20; h.state.players[D]!.life = 20;
  h.state.players[D]!.hand = [];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Life Channel') });
  let guard = 25;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.players[D]!.life, 23, 'THEY gained 3');
  assert.equal(h.state.players[A]!.life, 20,
    '"whenever YOU gain life" — their gain is not mine, so nobody is drained');
  ok('Flzzz', 'agent: "you", not "a player"');
  finishBattle(h);
});

// ── the two remaining per-turn budgets ───────────────────────────────────

test('Forager of the Fallen: [Switch1] is bounded — two enemy deaths in one turn make ONE 2/2', () => {
  const { h, A, D } = open(18243);
  const forager = spawn(h, A, 'Forager of the Fallen');
  const e1 = spawn(h, D, 'Unit Token'), e2 = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 4);
  intoBattle(h, A, [[forager]]);
  h.state.players[A]!.hand = [];
  for (const victim of [e1, e2]) {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
    pick(h, { unit: victim });
    drain(h);
    assert.equal(ent(h, victim), undefined, 'the enemy died');
  }
  assert.equal(unitsOf(h, A).filter(u => u.tokenStats?.[0] === 2).length, 1,
    '[Switch1] is the bounded marker — one 2/2 per turn, not one per death');
  ok('Forager of the Fallen', 'timing: [Switch1] bounds it to once per turn');
  finishBattle(h);
});

test('Murkdrop Distiller: [once] is a per-turn budget — the second trash is not offered a cache', () => {
  const { h, A } = open(18246);
  spawn(h, A, 'Murkdrop Distiller');
  const g1 = spawn(h, A, 'Pallid Gorger'), g2 = spawn(h, A, 'Pallid Gorger');
  h.state.players[A]!.hand = ['Luminous Arc', 'Jelly'];
  for (const gorger of [g1, g2]) {
    h.do({ type: 'activateAbility', seat: A, entityId: gorger, abilityIndex: 0, via: 'augment' });
    let guard = 20;
    while (guard-- > 0) {
      const dec = h.state.decision;
      if (dec) {
        const want = dec.options.findIndex(o => /^Discard |^Cache /.test(String(o.label)));
        h.do({ type: 'decide', seat: dec.seat, choice: want >= 0 ? want : 0 });
        continue;
      }
      if (!h.state.stack.length) break;
      pass(h);
    }
  }
  assert.deepEqual((h.state.players[A]!.cache ?? []).map(c => c.card), ['Luminous Arc'],
    'only the FIRST trash was cacheable');
  assert.deepEqual(h.state.players[A]!.bin, ['Jelly'],
    'the second trashed card went to the bin — [once] had already been spent');
  ok('Murkdrop Distiller', 'timing: [once] bounds it to once per turn');
});

test('All-Consuming Blight: a unit TOKEN is one of "your units" — the word is unqualified', () => {
  const { h, A } = open(18245);
  spawn(h, A, VANILLA);
  spawnToken(h, A); spawnToken(h, A);
  giveResources(h, A, 'wood', 4);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'All-Consuming Blight') });
  drain(h);
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Poison').length, 3,
    '"for each of YOUR UNITS" carries no "nontoken" — 1 real + 2 tokens = 3 (R125)');
  ok('All-Consuming Blight', 'scope: "your units" includes token units');
});

test('Plague Bellower: the printed cost is [three] — not two, not four', () => {
  const { h, A, D } = open(18247);
  const bellower = spawn(h, A, 'Plague Bellower');
  spawn(h, D, VANILLA);
  giveResources(h, A, 'wood', 7);
  intoBattle(h, A, [[bellower]]);
  h.do({ type: 'activateAbility', seat: A, entityId: bellower, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 4,
    '7 open − 3 = 4');
  ok('Plague Bellower', 'cost: exactly [three]');
  let guard = 20;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  finishBattle(h);
});

// ── "if you do" — the conditional half of two optional clauses ────────────

test('Shoreline Specter: DECLINE the recall and the 2-life drain does not happen — "IF YOU DO"', () => {
  const { h, A, D } = open(18253);
  const specter = spawn(h, A, 'Shoreline Specter');
  const friend = spawn(h, A, VANILLA);
  h.state.players[D]!.life = 20;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[specter], [friend]] });
  let guard = 40;
  while (h.state.battle!.step !== 'blocks' && guard-- > 0) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });

  guard = 40;
  let declined = false;
  let lifeBefore = -1;                       // read AFTER combat damage lands
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec && /Shoreline Specter/.test(dec.prompt)) {
      if (lifeBefore < 0) lifeBefore = h.state.players[D]!.life;
      const no = dec.options.findIndex(o => o.value === false);
      if (no >= 0) { h.do({ type: 'decide', seat: dec.seat, choice: no }); declined = true; continue; }
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => JSON.stringify(o.value).includes(String(friend))) });
      continue;
    }
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: dec.kind === 'orderTriggers' ? dec.options.map((_, i) => i) as never : 0 }); continue; }
    if (h.state.phase !== 'battle' || h.state.battle!.step === 'declare') break;
    pass(h);
  }
  assert.ok(declined, 'the decline was actually taken');
  assert.ok(ent(h, friend), 'nothing was recalled');
  assert.equal(h.state.players[D]!.life, lifeBefore,
    '"IF YOU DO, each opponent loses 2 life" — no recall, no drain');
  ok('Shoreline Specter', 'condition: the drain is gated on the recall happening');
});

test('Biomass Devourer: DECLINE and nothing happens — no erase, no counters, no mana spent', () => {
  const { h, A, D } = open(18254);
  const devourer = spawn(h, A, 'Biomass Devourer');
  const doomed = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'metal', 2);
  giveResources(h, A, 'fire', 2);
  intoBattle(h, A, [[devourer]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: doomed });
  drain0(h);
  const offer = h.state.decision!;
  const openBefore = h.state.players[A]!.resources.filter(r => r.state === 'open').length;
  h.do({ type: 'decide', seat: A, choice: offer.options.findIndex(o => /declin/i.test(String(o.label))) });
  drain(h);
  assert.equal(ent(h, devourer)!.counters, 0, 'no counters');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, openBefore,
    'the [two] was not spent');
  assert.ok(h.state.players[D]!.bin.includes('Unit Token'),
    'and the dead card went to the bin as normal — it was not erased');
  ok('Biomass Devourer', 'condition: declining costs nothing and erases nothing');
  finishBattle(h);
});

// ── the DONATED path: [Augment] text living on somebody else's body ───────

test('Biomass Devourer as a MOD: "put two +1/+1 counters on ME" means the HOST (R131)', () => {
  // Eleven of the thirty sampled cards carry [Augment] text and this file
  // exercises it on their own bodies, which docs/08 says is live. The DONATED
  // path is a different resolution of "me" and "you" (R131), so at least one
  // card is checked there too.
  const { h, A, D } = open(18252);
  const host = spawn(h, A, VANILLA);                 // 3/3
  giveResources(h, A, 'metal', 4); giveResources(h, A, 'fire', 2);
  h.state.players[A]!.hand = [];
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Biomass Devourer'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the Devourer is riding as a mod, not standing as a unit');
  const doomed = spawn(h, D, 'Unit Token');
  intoBattle(h, A, [[host]]);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: doomed });
  drain0(h);
  const offer = h.state.decision!;
  h.do({ type: 'decide', seat: A, choice: offer.options.findIndex(o => /pay/i.test(String(o.label))) });
  drain(h);
  assert.equal(ent(h, host)!.counters, 2, 'the two counters landed on the HOST');
  assert.deepEqual(effStats(h, host), [5, 5], '3/3 → 5/5');
  const modEntity = h.state.entities[ent(h, host)!.mods[0]!]!;
  assert.equal(modEntity.counters, 0, '…and not on the mod card itself');
  ok('Biomass Devourer', 'donated: "me" resolves to the host, not to the mod');
  finishBattle(h);
});

// ── "one or more UNITS", plural ──────────────────────────────────────────

test('Counter Thief: a spell countering THREE units at once hands it all three', () => {
  const { h, A } = open(18251);
  const thief = spawn(h, A, 'Counter Thief');
  const a1 = spawn(h, A, VANILLA), a2 = spawn(h, A, VANILLA);
  giveResources(h, A, 'wood', 2); giveResources(h, A, 'metal', 2);
  intoBattle(h, A, [[thief], [a1], [a2]]);
  h.state.players[A]!.hand = [];
  // "[Switch1] /[Put a -1/-1 counter on each enemy or put a +1/+1 counter on
  //  each of your units.]" — the Bloom half touches all three of my units.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wither and Bloom') });
  let guard = 20;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      const bloom = dec.options.findIndex(o => /\+1/.test(String(o.label)));
      h.do({ type: 'decide', seat: dec.seat, choice: bloom >= 0 ? bloom : 0 });
      continue;
    }
    if (!h.state.stack.length) break;
    pass(h);
  }
  assert.equal(ent(h, thief)!.counters, 3,
    '"one or more counters would be placed on ONE OR MORE UNITS" — all three, on the Thief');
  assert.equal(ent(h, a1)!.counters, 0, 'and none stayed on the units they were aimed at');
  assert.equal(ent(h, a2)!.counters, 0);
  ok('Counter Thief', 'scope: counters bound for SEVERAL units are all redirected');
  finishBattle(h);
});

test('Ghord: [Switch1] is bounded — my SECOND sacrifice this turn does not fire it again', () => {
  const { h, A, D } = open(18255);
  const ghord = spawn(h, A, 'Ghord');
  const s1 = spawn(h, A, 'Scavenging Sentry'), s2 = spawn(h, A, 'Scavenging Sentry');
  const f1 = spawn(h, A, VANILLA), f2 = spawn(h, A, VANILLA);
  const t1 = spawn(h, D, VANILLA), t2 = spawn(h, D, VANILLA);
  intoBattle(h, A, [[ghord], [s1], [s2], [f1], [f2]]);
  for (const [sentry, food] of [[s1, f1], [s2, f2]] as const) {
    h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' });
    pick(h, { unit: food });
    let guard = 25;
    while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
      if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
      else pass(h);
    }
  }
  assert.equal([t1, t2].filter(id => ent(h, id)).length, 1,
    'two sacrifices of mine in one turn, one Ghord trigger — [Switch1] is the bounded marker');
  ok('Ghord', 'timing: [Switch1] bounds it to once per turn');
  finishBattle(h);
});

// ════════════════════════════════════════════════════════════════════════
// THE NUMBER
// ════════════════════════════════════════════════════════════════════════

/**
 * Ambiguities this sample could not settle from the printed text alone. Each
 * is phrased so the owner can answer it in one line. Recorded rather than
 * decided in the engine's favour — §7.1's whole point is that a measurement
 * which quietly agrees with the implementation measures nothing.
 */
const OPEN_QUESTIONS = [
  'Torrential Reclamation — "Recall X target nontoken allies. Then each player '
  + 'sacrifices a unit and you lose 1 life for each ally recalled this way." Does '
  + '"for each ally recalled this way" scale the SACRIFICE too, or only the life '
  + 'loss? (Engine today: both. This file reads: only the life loss.)',

  'Shoreline Specter — "After combat, you may recall target ALLY." The Specter is '
  + 'offered as a target of its own trigger. Intended (it is an ally of its '
  + 'controller), or should "target ally" exclude the source?',

  'Hand Peeper / Bripp / Thought Extraction — "Look at target PLAYER\'s hand" lets '
  + 'you aim at yourself. Confirmed deliberate for Bripp and Thought Extraction '
  + '(R197b); assumed the same here. Correct?',
];

test('THE NUMBER — clauses asserted vs clauses correct, printed for the next round to quote', () => {
  const total = LEDGER.length;
  const wrongs = LEDGER.filter(r => r.verdict === 'wrong');
  const cards = new Set(LEDGER.map(r => r.card));

  // every sampled card must appear: a card cannot be quietly dropped
  const missing = SAMPLE.filter(n => !cards.has(n));
  assert.deepEqual(missing, [], `sampled cards with no clause asserted: ${missing.join(', ')}`);
  // …and no clause may be double-counted
  const keys = LEDGER.map(r => `${r.card} :: ${r.clause}`);
  assert.equal(new Set(keys).size, keys.length,
    `duplicate clause rows would inflate the denominator: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);

  const lines: string[] = [];
  lines.push('');
  lines.push('══ R212 · CORRECTNESS SAMPLE (docs/13-assessment.md §7.1) ═══════════════');
  lines.push(`  sample          : 30 cards drawn from allCardNames() (495) with seed ${SEED}`);
  lines.push(`  cards checked   : ${cards.size} / 30`);
  lines.push(`  clauses asserted: ${total}`);
  lines.push(`  clauses CORRECT : ${total - wrongs.length} / ${total}`
    + `  (${((total - wrongs.length) / total * 100).toFixed(1)}%)`);
  lines.push(`  clauses WRONG   : ${wrongs.length}`);
  for (const w of wrongs) lines.push(`      ✗ ${w.card} — ${w.clause}`), lines.push(`          ${w.detail}`);
  lines.push(`  open questions  : ${OPEN_QUESTIONS.length} (see OPEN_QUESTIONS in this file)`);
  lines.push('════════════════════════════════════════════════════════════════════════');
  console.log(lines.join('\n'));

  // the card-todo.ts proof pattern: this list is PINNED. Fix one and this
  // reddens, which is how a fix gets noticed instead of silently un-counted.
  assert.deepEqual(
    wrongs.map(w => `${w.card} :: ${w.clause}`).sort(), KNOWN_WRONG.slice().sort(),
    'KNOWN_WRONG must name exactly the divergences this file still finds — add a row '
    + 'when you find a new one, delete a row when you FIX one');
});
