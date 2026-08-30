/* R162 — THE MULTIPLICATIVE AMOUNT LAYER, and 'shared' is constructed.
 *
 * Three of the owner's answers of 2026-08-25 (R157) land here.
 *
 * §2, verbatim: *"Shared mode isn't a real thing. You invented it for testing.
 * So I guess it'd be constructed?"* — Worldbender took the constructed branch
 * in draft and constructed and DECLINED in 'shared', which is the engine's
 * default mode, so a 2-mana 2/2 {Feeble} was a blank card in most games. The
 * card was only half the problem: `replaceCardStep` was reached from
 * `startDraftStep` / `startConstructedDraw` and neither runs in shared, so the
 * hook was never consulted at all. `E.startTurn` consults it now, at the flat
 * 2-card turn draw, which is the whole of shared's card step.
 *
 * §23, verbatim: *"quadruple it!! So always n*2*v (n is num of arbiters, v is
 * original damage/life gain value)"* — Arbiter of Vitality was a pair of
 * triggers dealing a SECOND helping after the first landed. Two of them gave
 * 3×, and a loss that was already lethal ended the game before the doubling
 * resolved. It is one `AmountMultiplier` now (dsl.ts), consulted by
 * `E.gainLife` / `E.loseLife` through `E.lifeAmount` before the total moves.
 *
 * §25 is a printed-data correction with no behaviour — guarded at the bottom.
 *
 * ⚠ TWO THINGS HERE ARE NOT RULED, and both are pinned deliberately so that a
 * future ruling has a failing test rather than a silent drift:
 *   - n ≥ 3. `v × 2 × n` is LINEAR, so three Arbiters sextuple where a purely
 *     multiplicative reading would give 2^n = ×8. The owner wrote the formula
 *     out while answering about TWO.
 *   - composition with an ADDITIVE `AmountMod`. R157 §23 records the interim
 *     decision — multiplier AFTER the additive layer, `(v + Σdelta) × factor`.
 *
 * Seeds 13700-13799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { AmountMod, EffectCtx } from '../src/cards/dsl.ts';
import { E, GameEnded, Suspended } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { give, giveResources, spawn, toDeployment, absorb } from './util.ts';
import type { CardName, Seat } from '../src/types.ts';
import printedJson from '../src/cards/printed.json' with { type: 'json' };

const PRINTED = printedJson as unknown as Record<string, { type: string }>;

/** the file-local white-box driver (45-hybrids-ld-b's, plus GameEnded — this
 *  file kills a player on purpose, and loseLife throws when it does) */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended) && !(sig instanceof GameEnded)) throw sig;
  }
  h.state = e.s;
  absorb(h, e.events);
}

/** a direct-run EffectCtx, as 18-earth-c builds one */
const ctxFor = (seat: Seat, region: number, sourceName: CardName = 'Luminous Arc'): EffectCtx => ({
  controller: seat, sourceName, region, targets: [], event: null,
  eraseSelf: () => {},
  choose: () => { throw new Error('no choice expected'); },
});

// ── §2: 'shared' is constructed ──────────────────────────────────────────

/** empty battle, empty deployment — the turn rolls over into the next one,
 *  which is where the card step (and any replacement of it) happens.
 *  28-metal-c.test.ts's helper, which is what these numbers are compared to. */
function rollTurn(h: Harness): void {
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
}

const tally = (h: Harness): { hand: number; life: number }[] =>
  h.state.players.map(p => ({ hand: p.hand.length, life: p.life }));

test("Worldbender in 'shared': the default mode takes the CONSTRUCTED branch — +3 cards and 3 life", () => {
  // R157 §2. `new Harness(seed)` with no mode IS shared — the mode the engine
  // defaults to and the one the card used to do nothing in.
  const h = new Harness(13700);
  assert.equal(h.state.mode, 'shared', 'the default mode, which is the point');
  const A: Seat = 0, B: Seat = 1;
  spawn(h, A, 'Worldbender');
  const before = tally(h);
  const deck = [...h.state.sharedDeck];
  rollTurn(h);

  assert.equal(h.state.turn, 2);
  // the constructed LINE, reached by the constructed ARITHMETIC: shared's
  // whole card step is the flat 2 for the turn, so the replacement owes all
  // three cards, exactly as constructed's draw phase does.
  assert.equal(h.state.players[A]!.hand.length - before[A]!.hand, 3,
    'A: 2 for the turn + 1 for Worldbender, all out of the card');
  assert.equal(h.state.players[A]!.life, before[A]!.life - 3,
    'and 3 life with them — "I guess it\'d be constructed"');
  assert.equal(h.state.players[A]!.hand.at(-1), deck[2],
    'the three cards really came off the deck, in order');
  assert.ok(h.log.some(l => l.includes('Worldbender')), 'and it is logged');

  // the opponent's step is untouched: the replacement is scoped to a seat
  assert.equal(h.state.players[B]!.hand.length - before[B]!.hand, 2, 'B: just the flat 2');
  assert.equal(h.state.players[B]!.life, before[B]!.life);
});

test("Worldbender in 'shared': the negative control — no Worldbender, nothing moves", () => {
  // The proof that consulting `replaceCardStep` from startTurn changed only
  // what it meant to: same seed, same turn, no card.
  const h = new Harness(13700);
  const before = tally(h);
  rollTurn(h);
  for (const seat of [0, 1] as Seat[]) {
    assert.equal(h.state.players[seat]!.hand.length - before[seat]!.hand, 2, 'the flat 2 for the turn');
    assert.equal(h.state.players[seat]!.life, before[seat]!.life, 'and no life paid');
  }
  assert.ok(!h.log.some(l => l.includes('Worldbender')));
});

test("Worldbender in 'shared': it replaces the step EVERY turn, and two of them replace it ONCE", () => {
  // "First true consumes" (the R104 rule `replaceCardStep` documents) has to
  // hold on the new call site too, or two copies would draw 6 and pay 6.
  const h = new Harness(13701);
  const A: Seat = 0;
  spawn(h, A, 'Worldbender');
  spawn(h, A, 'Worldbender');
  for (let turn = 2; turn <= 4; turn++) {
    const before = tally(h);
    rollTurn(h);
    assert.equal(h.state.turn, turn);
    assert.equal(h.state.players[A]!.hand.length - before[A]!.hand, 3,
      `turn ${turn}: 3 cards — two Worldbenders replace the step once, not twice`);
    assert.equal(h.state.players[A]!.life, before[A]!.life - 3, `turn ${turn}: 3 life, once`);
  }
});

// ── §23: the multiplicative amount layer ─────────────────────────────────

/** put `n` Arbiters in the deploy player's region and hand back their seat */
function arbiters(h: Harness, n: number): Seat {
  const p = h.state.deployPlayer!;
  for (let i = 0; i < n; i++) spawn(h, p, 'Arbiter of Vitality');
  return p;
}

test('Arbiter of Vitality: ONE doubles a gain and a loss — v × 2 × 1', () => {
  const h = new Harness(13710);
  toDeployment(h);
  const p = arbiters(h, 1);
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.gainLife(p, 3, 'a test'));
  assert.equal(h.state.players[p]!.life, 46, '3 × 2 = 6 gained');
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, 36, '5 × 2 = 10 lost');
});

test('Arbiter of Vitality: TWO QUADRUPLE — "quadruple it!! So always n*2*v"', () => {
  // THE REPORTED BUG. The trigger pair gave 3×: each Arbiter heard only the
  // original event, because the guard that stopped a doubling doubling itself
  // also stopped the second Arbiter hearing the first. Summing the claiming
  // factors (2 + 2) is the owner's own arithmetic.
  const h = new Harness(13711);
  toDeployment(h);
  const p = arbiters(h, 2);
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.gainLife(p, 3, 'a test'));
  assert.equal(h.state.players[p]!.life, 52, '3 × 2 × 2 = 12 gained, not 9');
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, 32, '5 × 2 × 2 = 20 lost, not 15');
  assert.ok(h.log.some(m => m.includes('Arbiter of Vitality') && m.includes('×4')),
    'and the log says ×4, so a reader can see which number was used');
});

test('R264: THREE Arbiters multiply — the fold is EXPONENTIAL in n', () => {
  // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and it was right to, so the old
  // expectation is kept here rather than deleted:
  //
  //     'Arbiter of Vitality: THREE sextuple — the formula is LINEAR in n
  //      (⚠ n ≥ 3 unconfirmed)'
  //     assert.equal(life, 28, '2 × 2 × 3 = 12 lost — not 16 (2^3 × 2)');
  //
  // It pinned R157 §23's formula *"always n*2*v"* AS WRITTEN, and flagged in
  // its own title that n ≥ 3 had never actually been put to the owner — the
  // formula was written while he was answering a question about TWO. Round-32
  // Q4 put it to him and the answer was one sentence: *"Make it exponential."*
  // So three Arbiters give 2^3 = ×8, and 2 life lost becomes 16.
  //
  // ⚠ WHAT DID NOT CHANGE, and why the round-31 tests below still pass: at
  // n = 2 the two readings are ARITHMETICALLY IDENTICAL (2 + 2 = 2 × 2 = 4).
  // R157 §23's own worked example is untouched. n = 3 is the smallest board
  // that can tell them apart, which is why this is the only test that moved.
  const h = new Harness(13712);
  toDeployment(h);
  const p = arbiters(h, 3);
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.loseLife(p, 2, 'a test'));
  assert.equal(h.state.players[p]!.life, 24, '2 × 2^3 = 16 lost — not 12 (the old n*2*v)');
});

test('R264: TWO Arbiters are the case the two readings AGREE on, and it still quadruples', () => {
  // The control for the test above. If this ever moves, R264 has been applied
  // somewhere it does not reach: the owner answered R157 §23 about two, and
  // that answer is not reopened by "make it exponential" — it is the fixed
  // point both formulas share.
  const h = new Harness(13713);
  toDeployment(h);
  const p = arbiters(h, 2);
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.loseLife(p, 2, 'a test'));
  assert.equal(h.state.players[p]!.life, 32,
    '2 × 4 = 8 lost, and 2+2 = 2×2 = 4 — the sum and the product agree at n = 2');
});

test('R264: ONE Arbiter is the other fixed point, so neither reading is being applied twice', () => {
  const h = new Harness(13714);
  toDeployment(h);
  const p = arbiters(h, 1);
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.loseLife(p, 2, 'a test'));
  assert.equal(h.state.players[p]!.life, 36, '2 × 2 = 4 lost');
});

test('Arbiter of Vitality: a LETHAL loss is multiplied BEFORE the lethal check', () => {
  // The ordering fix, and the reason this had to stop being a trigger. Under
  // the old shape the first helping landed, `loseLife` ran the lethal check,
  // the game ended, and the SECOND helping never resolved: the player died at
  // -1 having lost 5, when the card says they lost 10. The winner was right
  // and every number a human reads was wrong.
  const h = new Harness(13713);
  toDeployment(h);
  const p = arbiters(h, 1);
  const foe = (1 - p) as Seat;
  h.state.players[p]!.life = 4;
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, -6,
    '5 doubled to 10 in one commit — not 4 - 5 = -1 with the second helping lost to the game ending');
  assert.equal(h.state.winner, foe, 'and it is still lethal');
  assert.equal(h.state.phase, 'gameover');
});

test('Arbiter of Vitality: a gain is multiplied for EITHER player — "all" is unqualified', () => {
  const h = new Harness(13714);
  toDeployment(h);
  const p = arbiters(h, 1);
  const foe = (1 - p) as Seat;
  const before = h.state.players[foe]!.life;
  whiteBox(h, e => e.gainLife(foe, 4, 'a test'));
  assert.equal(h.state.players[foe]!.life, before + 8,
    "the opponent's gain doubles too — the card says ALL life gain");
});

// ── §23's UNRULED half: composing with an additive AmountMod ─────────────

test('the multiplier applies AFTER an additive AmountMod on the SAME quantity (⚠ INTERIM, unruled)', () => {
  // R157 §23 answers how multipliers compose with EACH OTHER and explicitly
  // does not answer how one composes with R104's additive family. The interim
  // decision is `(v + Σdelta) × factor`, written down in `E.lifeAmount`.
  //
  // No printed card adds to a life amount yet, so the additive half is a
  // STAND-IN: one extra `AmountMod` bolted onto a card that already radiates
  // that channel (Proliferating Slime), removed again in the finally. It is a
  // stand-in for the card that will exist, not a claim about this one — what is
  // being pinned is the ORDER, which belongs to the engine and not to either
  // card.
  const h = new Harness(13720);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Arbiter of Vitality');
  spawn(h, p, 'Proliferating Slime');
  h.state.players[p]!.life = 40;

  // R268: Proliferating Slime's whole printed text is its [Augment] line, so
  // its AmountMod lives in `augmentBox`. This has to be the LIVE array (the
  // stand-in is pushed and spliced), not `radiantList`'s copy.
  const mods = getCard('Proliferating Slime').augmentBox!.amountMods!;
  const standIn: AmountMod = {
    delta: (_g, _self, ctx) => (ctx.kind === 'lifeLoss' ? 1 : 0),
  };
  mods.push(standIn);
  try {
    whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  } finally {
    mods.splice(mods.indexOf(standIn), 1);
  }

  // (5 + 1) × 2 = 12 — NOT 5 × 2 + 1 = 11, which is what the other order gives.
  // A ruling that reverses the interim decision fails exactly here.
  assert.equal(h.state.players[p]!.life, 28,
    'additive first, then the multiplier: (5 + 1) × 2 = 12 lost, not 11');
});

test('the multiplier composes with a REAL additive mod end to end: Conduit of Pain + Arbiter', () => {
  // The same order over two printed cards and the real damage path. Conduit of
  // Pain — "[Augment] If an allied source would deal noncombat damage, it deals
  // that much damage plus 1 instead" — is an `AmountMod` on 'effectDamage',
  // priced at the damage site; the Arbiter is the multiplier on the 'lifeLoss'
  // that damage to a player becomes ("Damage causes loss of life").
  const h = new Harness(13721);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  spawn(h, A, 'Conduit of Pain');
  spawn(h, A, 'Arbiter of Vitality');
  const region = new E(h.state).homeRegion(A);
  const before = h.state.players[D]!.life;

  whiteBox(h, e => e.dealEffectDamage(ctxFor(A, region), { player: D }, 2));

  assert.equal(h.state.players[D]!.life, before - 6,
    '2 damage + Conduit\'s 1 = 3, then the Arbiter doubles the life LOSS = 6');
});

test('the multiplier is a REPLACEMENT, not a second helping: one lifeLost event carries the whole number', () => {
  // What the old trigger shape could not do, and the observable difference a
  // "when a player loses life" card would see: ONE event, with the multiplied
  // `n` on it, rather than two events of half the size each.
  const h = new Harness(13722);
  toDeployment(h);
  const p = arbiters(h, 2);
  h.state.players[p]!.life = 40;
  const from = h.events.length;
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  const lost = h.events.slice(from).filter(e => e.type === 'lifeLost');
  assert.equal(lost.length, 1, 'exactly one life-loss event');
  assert.equal(lost[0]!.data?.n, 20, 'and it carries the full 20, not 5 (or 5 then 5 then 10)');
});

test('a board with no multiplier on it pays nothing: amounts are untouched', () => {
  // `E.amountFactor`'s identity. The negative control for the whole layer.
  const h = new Harness(13723);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.gainLife(p, 3, 'a test'));
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, 38, '3 gained, 5 lost, nothing scaled');
  assert.ok(!h.log.some(m => m.includes('×')), 'and nothing is logged as a multiplication');
});

test('R62: a suppressed Arbiter multiplies nothing', () => {
  // Every other radiating query drops a suppressed holder; so does this one.
  const h = new Harness(13724);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const arb = spawn(h, p, 'Arbiter of Vitality');
  h.state.entities[arb]!.suppressed = { abilities: 'Suppression Field' };
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, 35, 'the printed text is off, so 5 is 5');
});

// ── §25: Arbiter of Armistice has no {Switch} ────────────────────────────

test('R157 §25: Arbiter of Armistice\'s printed type line has no {Switch}, and nothing else moved', () => {
  // Owner, verbatim: "That's an error on your part. The card does not have a
  // [Switch] thing. It just adds an additional cost to all spells cast in
  // battle to pay 2 life."
  //
  // printed.json is GENERATED, so the correction is a named override in
  // scripts/extract-printed.mjs; this asserts the generated result, which is
  // what every reader of the pool actually sees.
  assert.equal(PRINTED['Arbiter of Armistice']!.type, '{Haste} Holy Unit');
  assert.equal(getCard('Arbiter of Armistice').timing, 'haste', 'the {Haste} marker still parses');
  assert.equal(getCard('Arbiter of Armistice').kind, 'unit');

  // it was the ONLY bare {Switch} in a type line, and the pool now has none:
  // every [Switch] in the game is a rules-text marker on a graftable effect.
  const stillSwitched = Object.entries(PRINTED).filter(([, c]) => /\{Switch/.test(c.type));
  assert.deepEqual(stillSwitched.map(([n]) => n), [], 'no type line prints {Switch}');
});

test('the two malformed type lines are repaired, and no type line is malformed any more', () => {
  // ⚠ RULED 2026-08-28 (R240), AND THE ORIGINAL REPAIR WAS HALF WRONG — which
  // is the point worth keeping. This sweep found Interdiction Rift by a LAYOUT
  // signature (`}` glued to a letter) and therefore repaired the layout: it
  // inserted the missing space and left `AI` standing, because a brace-gluing
  // rule has nothing to say about a stray token. The owner: "that's a typo in
  // the oracle text. {Battle} Cosmic Spell is correct. AI shouldn't be there."
  //
  // So the derivation reached the RIGHT CARD FOR THE WRONG REASON, and a
  // derivation that does that is not validated by having hit its target. That
  // is the generalisable lesson of R240 and it is why 209 pins this line from
  // three sides — against the registered card, against the upstream file, and
  // against the override table's silence — plus a singleton-subtype sweep that
  // catches a stray token INDEPENDENTLY of the spacing.
  //
  // Might of the Grove's repair was sound: a glued brace AND a duplicated
  // "Tree", both pure layout, both fixed here.
  assert.equal(PRINTED['Interdiction Rift']!.type, '{Battle} Cosmic Spell');
  assert.equal(PRINTED['Might of the Grove']!.type, '{Battle} Tree Druid Spell');
  for (const [name, c] of Object.entries(PRINTED)) {
    assert.ok(!/\}[A-Za-z]/.test(c.type), `${name}: a marker is glued to the next word: ${c.type}`);
    const words = c.type.split(' ');
    for (let i = 1; i < words.length; i++) {
      assert.notEqual(words[i], words[i - 1], `${name}: duplicated word in ${c.type}`);
    }
  }
});

test('§25 is data only: the life tax still works, and it is still not graftable', () => {
  // "No behaviour change should result" — the marker was inert, because
  // graftability is `CardDef.graftEffect` and nothing reads a type-line
  // {Switch}. Both halves asserted, so a future reader can see WHY it was inert.
  assert.equal(getCard('Arbiter of Armistice').graftEffect, undefined,
    'it was never graftable — the marker granted nothing');

  const h = new Harness(13730);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Arbiter of Armistice');
  const life = h.state.players[A]!.life;
  giveResources(h, A, 'fire', 4);
  const region = new E(h.state).homeRegion(A);
  assert.ok(region >= 0);
  // outside a battle the tax does not apply (38-light-a covers the battle
  // case); what is asserted here is only that the card still radiates a cost
  // modifier at all, i.e. it did not become a vanilla body.
  const cardName: CardName = 'Arbiter of Armistice';
  assert.ok(getCard(cardName).costMods, 'it still declares the life tax');
  assert.equal(h.state.players[A]!.life, life, 'and spawning it costs nothing');
  give(h, A, cardName);
});
