/* Playtest round 7 (game BRDM, 2026-08-20) — the three rules-level reports.
 *
 *  - "Tempest Wrangler (with alluring) didn't trigger on attack": Alluring was
 *    in the Attr union and in the rules reference and enforced nowhere, so an
 *    Alluring attacker could simply be ignored. (The rule that landed here in
 *    round 7 was itself the WRONG rule, and the report came back in round 15
 *    from room UFAB — the whole Alluring half of this file was rebuilt for
 *    R84's targeted model; see the section header below.)
 *  - "Formless is broken here. It should have set Manablub to a 4/4, but it's
 *    combined with the other thing. Stats need to be able to be SET without
 *    using + or -.": the engine had no layer 2. Formless and Body Swap both
 *    write the BASE, and doing it with deltas made a Body-Swapped Bloated
 *    Manablub come out 6/9 instead of 4/4.
 *  - "Body Swap puts into the log that the units get -X/+X … it's supposed to
 *    be a pure swap": same cause, and the log now says what happened.
 *
 * Seeds 5200-5299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, legalActions, IllegalAction } from '../src/apply.ts';
import { shouldAutoYield } from '../ui/inspect.ts';
import {
  absorb, effStats, ent, finishBattle, give, giveResources, pass, pick,
  resolveAfterCombat, spawn,
  toDeployment, toNextBattle,
} from './util.ts';
import type { Action, Attr, EntityId, GameState, Seat } from '../src/types.ts';

/* ── layer 2: stats that are SET, not adjusted ─────────────────────────── */

test('Formless SETS the base — a second base-setter replaces, never compounds', () => {
  const h = new Harness(5200);
  toDeployment(h);
  const seat: Seat = 0;
  const u = spawn(h, seat, 'Good Whale');           // printed 7/5
  const e = () => new E(h.state);

  e().setBase(ent(h, u)!, 4, 4);
  assert.deepEqual(effStats(h, u), [4, 4], 'base rewritten, not nudged');

  // this is the reported bug: a SECOND base-setting effect on the same unit
  // must land on 3/3, not on 4/4 plus a delta to 3/3
  e().setBase(ent(h, u)!, 3, 3);
  assert.deepEqual(effStats(h, u), [3, 3]);
  assert.deepEqual(ent(h, u)!.baseSet, [3, 3]);
});

test('layer 3 still applies on top of a rewritten base', () => {
  const h = new Harness(5201);
  toDeployment(h);
  const u = spawn(h, 0, 'Good Whale');
  const e = new E(h.state);
  e.setBase(ent(h, u)!, 4, 4);
  e.addCounters(ent(h, u)!, 2);
  e.addTemp(ent(h, u)!, 1, 0);
  assert.deepEqual(effStats(h, u), [7, 6], '4/4 base, +2/+2 counters, +1/+0 temp');
});

test('a rewritten base is an until-regroup change and regroup clears it', () => {
  const h = new Harness(5202);
  toDeployment(h);
  const A = h.state.initiative;
  const u = spawn(h, A, 'Good Whale');
  new E(h.state).setBase(ent(h, u)!, 1, 1);
  assert.deepEqual(effStats(h, u), [1, 1]);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  while (h.state.phase === 'battle') {
    const b = h.state.battle!;
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  assert.equal(ent(h, u)!.baseSet, undefined, 'cleared with the other temp changes (R11 step 3)');
  assert.deepEqual(effStats(h, u), [7, 5], 'back to printed');
});

test('Body Swap exchanges bases, and says so in the log', () => {
  const h = new Harness(5203);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Good Whale');           // 7/5
  const theirs = spawn(h, D, 'Rune Channeler');     // 4/3
  const [mp, mt] = effStats(h, mine), [tp, tt] = effStats(h, theirs);
  giveResources(h, A, 'metal', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Body Swap') });
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  const from = h.log.length;
  pass(h); pass(h);

  assert.deepEqual(effStats(h, mine), [tp, tt], 'took the other unit’s stats');
  assert.deepEqual(effStats(h, theirs), [mp, mt], 'and vice versa');
  const said = h.log.slice(from).join('\n');
  assert.match(said, /base becomes/, 'the log describes a swap, not a ±delta');
  assert.doesNotMatch(said, /gets [+-]\d+\/[+-]\d+ until regroup/,
    '"gets -3/-2 until regroup" is not what a base exchange does');
});

test('Formless after Body Swap is a 4/4 — the exact BRDM position', () => {
  // Bloated Manablub came out of this sequence a 6/9 in the played game
  const h = new Harness(5204);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Good Whale');
  const other = spawn(h, A, 'Rune Channeler');
  const e = new E(h.state);
  // stand in for the earlier Body Swap: the victim's base is already rewritten
  e.setBase(ent(h, victim)!, e.effStats(ent(h, other)!)[0], e.effStats(ent(h, other)!)[1]);
  e.setBase(ent(h, victim)!, 4, 4);                 // …then Formless
  assert.deepEqual(effStats(h, victim), [4, 4],
    'a base 4/4 is a base 4/4 however many times the base was rewritten before');
});

/* ── R84 {Alluring} — the targeted on-attack trigger ────────────────────────
 *
 * Rebuilt 2026-08-22 (playtest room UFAB). The reported bug was "Tempest
 * Wrangler (with Alluring) didn't trigger on attacks": three columns, one of
 * them Alluring, the defender held exactly two units able to block, put both
 * of them on the OTHER two columns, and the engine accepted the declaration —
 * six unblocked damage, dead player.
 *
 * That was a real hole in the old rule (the duty's candidate pool was computed
 * AFTER subtracting the units already committed elsewhere, so the defender
 * could MANUFACTURE the "nobody is able" excuse), but the investigation found
 * the engine was implementing the wrong rule entirely. R76 read Alluring as
 * "every defender able to block this column must block it" and attributed the
 * wording to the Manual; `Rules/Algomancy-Manual.txt` contains no occurrence of
 * the word. Caleb's rulings say something simpler: it TARGETS ONE enemy unit,
 * that unit can't attack and must block this column if able, it goes on the
 * stack, it can be negated, and it does not stack. See docs/digital-rules.md
 * R84 for the sources.
 *
 * WHY THE OLD SUITE MISSED THE UFAB BUG: every scenario in it attacked with
 * ONLY Alluring columns, so there was never a plain column to dump blockers
 * onto. The first test below is that missing shape.
 */

/** answer everything an attack declaration raises — one target decision per
 * Alluring column, in the order the triggers resolve — and pass the attack
 * window down to the block step. */
function toBlockStep(h: Harness, targets: EntityId[] = []): void {
  const want = targets.slice();
  for (let guard = 0; guard < 80; guard++) {
    if (h.state.phase !== 'battle' || h.state.battle!.step === 'blocks') return;
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') {
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    } else if (dec) {
      const id = want.shift();
      if (id === undefined) throw new Error(`unexpected decision: ${dec.prompt}`);
      pick(h, { unit: id });
    } else {
      pass(h);
    }
  }
  throw new Error('never reached the block step');
}

/** mutate the live state through the engine, the way a card would */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  fn(e);
  e.settle();
  h.state = e.s;
  absorb(h, e.events);
}

function attrOn(h: Harness, id: EntityId, attr: Attr): void {
  new E(h.state).addTempAttr(ent(h, id)!, attr);
}

/** every declaration `legalActions` offers the defender, as concrete actions */
function blockOptions(h: Harness, D: Seat): Extract<Action, { type: 'declareBlocks' }>[] {
  return legalActions(h.state, D)
    .filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
}

/** every offer must be one apply() accepts — the fuzzer's "legalActions lied"
 * invariant, checked against its own copy of the position because one
 * declaration ends the step */
function offersAreHonest(h: Harness, D: Seat): void {
  const opts = blockOptions(h, D);
  assert.ok(opts.length, 'legalActions must always be able to offer SOMETHING at the block step');
  for (const a of opts) {
    assert.doesNotThrow(() => apply(structuredClone(h.state), a),
      `legalActions offered ${JSON.stringify(a)} but apply() refused it`);
  }
}

const refusedForAllure = (err: unknown) =>
  err instanceof IllegalAction && /Alluring/.test((err as Error).message);

/* ── the UFAB regression, and its minimal form ─────────────────────────── */

test('R84 UFAB: an Alluring column may not be side-stepped by blocking the OTHERS', () => {
  // THE REPORTED POSITION. Three attack columns, one Alluring; the defender
  // holds exactly two units able to block and puts both on the plain columns.
  const h = new Harness(5250);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');          // {Alluring}
  const plain = [0, 1].map(() => spawn(h, A, 'The Foretold'));
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain[0]!], [plain[1]!]] });
  toBlockStep(h, [d1!]);                                  // the Wrangler lures d1

  assert.deepEqual(ent(h, d1!)!.allured, { round: 1, columns: [0] });
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [d1!], 2: [d2!] } }),
    refusedForAllure,
    'both blockers spent elsewhere is exactly the excuse the old rule accepted');
  // and the honest half: d1 covers the lure, d2 goes wherever it likes
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1!], 2: [d2!] } });
  assert.deepEqual(h.state.battle!.blocks[0], [d1!]);
});

test('R84: the minimal form — two columns, one Alluring, one blocker', () => {
  const h = new Harness(5251);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const plain = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain]] });
  toBlockStep(h, [d1]);

  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [d1] } }),
    refusedForAllure, 'the lured unit may not go and block the plain column instead');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }),
    refusedForAllure, 'nor may it simply decline');
  offersAreHonest(h, D);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } });
  assert.deepEqual(h.state.battle!.blocks[0], [d1]);
});

test('R84: only the LURED unit is compelled — a second able blocker is free', () => {
  // "single unit … meaning target unit controlled by an opponent". The old
  // rule compelled EVERY able defender; this one compels exactly one.
  const h = new Harness(5252);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  assert.equal(ent(h, d2)!.allured, undefined, 'the other unit was never targeted');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] }, send: [d2] });
  assert.deepEqual(h.state.battle!.sentAttackers, [d2],
    'd2 is under no duty at all and may go and counterattack');
});

test('R84: a substitute is not good enough — the lured unit must be in the column', () => {
  // "If another unit B wants to block the alluring column then suddenly A can
  // and also has to."
  const h = new Harness(5253);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d2] } }),
    refusedForAllure, 'd2 cannot stand in for the unit that was actually lured');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1, d2] } });
  assert.deepEqual(h.state.battle!.blocks[0], [d1, d2], 'but d2 may join it');
});

/* ── the solved RAQ thread: Alluring AND Evasive ────────────────────────────
 *
 * "[Solved] Alluring AND Evasive column". The column needs TWO blockers and
 * lures exactly one unit, A. The thread pins three cases, and they are the
 * whole semantics: an Evasive column is something one unit cannot cover, so
 * "if able" is false for A alone — until a second unit volunteers, at which
 * point "suddenly A can and also has to".
 */

/** an Alluring + Evasive one-unit column, `n` plain 3/3s to answer it, and the
 * lure aimed at the first of them */
function evasiveLure(seed: number, n: number): {
  h: Harness; A: Seat; D: Seat; ds: EntityId[];
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const ds = Array.from({ length: n }, () => spawn(h, D, 'The Foretold'));
  attrOn(h, lure, 'Evasive');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [ds[0]!]);
  return { h, A, D, ds };
}

test('R84 RAQ 1/3: one unit — it cannot cover an Evasive column alone, so it is free', () => {
  const h = new Harness(5254);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const plain = spawn(h, A, 'The Foretold');
  const a = spawn(h, D, 'The Foretold');
  attrOn(h, lure, 'Evasive');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain]] });
  toBlockStep(h, [a]);
  offersAreHonest(h, D);
  // "A can not block that column alone, so no compulsion; A is free to block a
  // different column"
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [a] } });
  assert.deepEqual(h.state.battle!.blocks, { 1: [a] });
});

test('R84 RAQ 2/3: two units — block with both, or forgo the column; nothing else', () => {
  const { h, D, ds } = evasiveLure(5255, 2);
  const [a, b] = ds as [EntityId, EntityId];
  // forgo
  assert.doesNotThrow(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: {} }));
  // A + B
  assert.doesNotThrow(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: { 0: [a, b] } }));
  // B alone is refused by {Evasive} itself; A alone likewise
  assert.throws(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: { 0: [b] } }),
    (err: unknown) => err instanceof IllegalAction && /Evasive/.test((err as Error).message));
  assert.throws(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: { 0: [a] } }),
    (err: unknown) => err instanceof IllegalAction && /Evasive/.test((err as Error).message));
  offersAreHonest(h, D);
});

test('R84 RAQ 3/3: three units — forgo, or A+B, or A+C; B+C is illegal', () => {
  const { h, D, ds } = evasiveLure(5256, 3);
  const [a, b, c] = ds as [EntityId, EntityId, EntityId];
  const ok = (blocks: Record<number, EntityId[]>) =>
    assert.doesNotThrow(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks }));
  ok({});
  ok({ 0: [a, b] });
  ok({ 0: [a, c] });
  assert.throws(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: { 0: [b, c] } }),
    refusedForAllure,
    'two OTHER units may not cover the column the lured one was called to');
  offersAreHonest(h, D);
});

/* ── the other half of the attribute: it cannot attack ──────────────────── */

test('R84: a lured unit cannot be sent out to counterattack', () => {
  // "It won't be able to 'counter-attack' into your region" — going out at
  // block time IS attacking.
  const h = new Harness(5257);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] }, send: [d1] }),
    (err: unknown) => err instanceof IllegalAction);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d2] }, send: [d1] }),
    refusedForAllure);
  assert.ok(!blockOptions(h, D).some(a => (a.send ?? []).includes(d1)),
    'and legalActions never offers it either');
});

test('R84: a lured unit may not be declared as an attacker (a guard, by hand)', () => {
  // In the 1v1 battle structure this position cannot arise on its own: round
  // 2's attacker pool IS the units sent at block time, and a lured unit may
  // not be sent. The restriction is still real — it is the half of the
  // attribute that survives the allurer's death — so the guard is tested
  // against a pool built by hand.
  const h = new Harness(5258);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] }, send: [d2] });
  while (h.state.battle!.round === 1) pass(h);
  const b = h.state.battle!;
  assert.equal(b.attacker, D, 'round 2: the defender counterattacks');
  assert.ok(!b.attackerPool!.includes(d1), 'the lured unit was never eligible to be in the pool');
  b.attackerPool!.push(d1);
  ent(h, d1)!.absent = false;
  ent(h, d1)!.region = b.region;
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [[d1]] }), refusedForAllure);
  assert.ok(!legalActions(h.state, D).some(a =>
    a.type === 'declareAttack' && a.columns.flat().includes(d1)),
  'and legalActions does not offer it');
});

/* ── it is a real effect on a real stack ────────────────────────────────── */

test('R84: the trigger goes on the stack, targets at cast (R67), and can be NEGATED', () => {
  // "'Alluring' effect goes to stack and can be negated?" — "Yep!"
  const h = new Harness(5259);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'metal', 1);                            // Dematerialize: bm / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });

  const dec = h.state.decision!;
  assert.equal(dec.seat, A, 'the ATTACKER aims it, and does so before it reaches the stack');
  assert.deepEqual(dec.options.map(o => o.value), [{ unit: d1 }], 'legal targets: enemy units here');
  pick(h, { unit: d1 });
  const item = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(item.kind, 'triggered');
  assert.match(item.label, /Alluring/);

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: item.id });
  pass(h); pass(h);                                           // resolve Dematerialize
  h.do({ type: 'decide', seat: A, choice: 0 });               // its Glimpse 3
  assert.ok(h.log.some(m => /Alluring.*is negated/.test(m)), 'the trigger is negated');
  assert.equal(ent(h, d1)!.allured, undefined, 'so nothing was ever lured');
  toBlockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {}, 'and the defender is under no duty');
});

test('R84: killing the allurer while the trigger is ON the stack fizzles it', () => {
  // "this would stop the trigger if you kill the allurer while the effect is
  // on the stack"
  const h = new Harness(5260);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  pick(h, { unit: d1 });
  assert.equal(h.state.stack.length, 1, 'it is on the stack');
  whiteBox(h, e => { e.destroy(ent(h, lure)!, 'is deleted'); });
  toBlockStep(h);
  assert.equal(ent(h, d1)!.allured, undefined, 'nothing was lured');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {});
});

test('R84: killing the allurer AFTER it resolves frees the block but not the attack', () => {
  // "You can't attack but you can block other things" — the can't-attack half
  // is a mark on the unit and survives; the must-block duty names a column and
  // dies with it.
  const h = new Harness(5261);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const other = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [other]] });
  toBlockStep(h, [d1]);
  assert.deepEqual(ent(h, d1)!.allured, { round: 1, columns: [0] });

  whiteBox(h, e => { e.destroy(ent(h, lure)!, 'is deleted'); });
  assert.deepEqual(ent(h, d1)!.allured, { round: 1, columns: [] },
    'R72 closed the line, and the duty went with the column');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [d1] }),
    refusedForAllure, 'it still cannot attack');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {}, 'but it is free not to block');
});

test('R84: {Alluring} does not stack — two Alluring units in one column, ONE trigger', () => {
  // "Nah alluring doesn't stack … It's just one attribute … It's like how you
  // can't gain flying flying"
  const h = new Harness(5262);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Tempest Wrangler');
  const back = spawn(h, A, 'Tempest Wrangler');
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  assert.equal(h.log.filter(m => /Trigger: Tempest Wrangler — \{Alluring\}/.test(m)).length, 1,
    'one column, one trigger');
  pick(h, { unit: d1 });
  assert.equal(h.state.decision, null, 'and only one target is asked for');
  toBlockStep(h);
  assert.equal(ent(h, d2)!.allured, undefined);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] }, send: [d2] });
  assert.deepEqual(h.state.battle!.blocks[0], [d1]);
});

test('R84: two Alluring COLUMNS are two triggers, and may name the same unit', () => {
  // Alluring is shared to the column but does not stack WITHIN one; two
  // columns are two independent attributes and so two triggers.
  const h = new Harness(5263);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lures = [0, 1].map(() => spawn(h, A, 'Tempest Wrangler'));
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: lures.map(id => [id]) });
  toBlockStep(h, [d1, d1]);                                   // both aimed at the same unit
  assert.deepEqual(ent(h, d1)!.allured, { round: 1, columns: [0, 1] });

  // ⚠ the judgement call: one unit cannot block two columns, so discharging
  // either duty excuses the other — INCLUDING the "must be among its
  // blockers" half, or the position would have no legal declaration at all
  offersAreHonest(h, D);
  assert.throws(() => apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: {} }),
    refusedForAllure, 'it must still answer ONE of them');
  for (const ci of [0, 1]) {
    assert.doesNotThrow(() =>
      apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: { [ci]: [d1] } }),
    `blocking column ${ci} discharges both`);
  }
});

test('R84: two Alluring columns naming DIFFERENT units compel both', () => {
  const h = new Harness(5264);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lures = [0, 1].map(() => spawn(h, A, 'Tempest Wrangler'));
  const [d1, d2] = [spawn(h, D, 'The Foretold'), spawn(h, D, 'The Foretold')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: lures.map(id => [id]) });
  // the two triggers resolve in stack order, so which one aims at which unit
  // is read back off the marks rather than assumed
  toBlockStep(h, [d1, d2]);
  const col = (id: EntityId) => ent(h, id)!.allured!.columns[0]!;
  assert.notEqual(col(d1), col(d2), 'two columns, two different lured units');
  offersAreHonest(h, D);
  assert.ok(blockOptions(h, D).some(a => Object.keys(a.blocks).length === 2),
    'the compulsory core covers both columns at once (R76: a single-column offer cannot)');
  assert.throws(() =>
    apply(structuredClone(h.state), { type: 'declareBlocks', seat: D, blocks: { [col(d1)]: [d1] } }),
  refusedForAllure, 'answering one duty does not answer the other');
  h.do({ type: 'declareBlocks', seat: D, blocks: { [col(d1)]: [d1], [col(d2)]: [d2] } });
  assert.deepEqual(h.state.battle!.blocks, { [col(d1)]: [d1], [col(d2)]: [d2] });
});

/* ── "able" is a property of the unit and the column, and nothing else ──── */

test('R84: a {Feeble} lured unit is not able, so it is not compelled', () => {
  const h = new Harness(5265);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  attrOn(h, d1, 'Feeble');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  offersAreHonest(h, D);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {}, 'a Feeble unit can never block, so it is never able');
});

test('R84: a lured unit with no {Flying} is not able against a Flying column', () => {
  const h = new Harness(5266);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  attrOn(h, lure, 'Flying');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {});
});

test('R84: a lone {Sneaky} + {Alluring} attacker is not a stuck state', () => {
  // R20 forbids blocking it, so nobody is able and the compulsion is empty.
  // (Under the old rule this was a HANG: two rules, no legal declaration.)
  const h = new Harness(5267);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  attrOn(h, lure, 'Sneaky');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  offersAreHonest(h, D);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } }),
    (err: unknown) => err instanceof IllegalAction && /Sneaky/.test((err as Error).message));
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {});
});

/* ── R61 {Pure} still holds ─────────────────────────────────────────────── */

test('R84 + R61: an Alluring column that is itself {Pure} never even triggers', () => {
  // "an Alluring column that is itself Pure ignores its own Alluring and
  // compels nobody" — and under the new model that is upstream of the stack:
  // there is nothing to negate, because nothing fires.
  const h = new Harness(5268);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const pure = spawn(h, A, 'Just a Unit');                    // {Pure}
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure, pure]] });
  assert.equal(h.state.decision, null, 'no target is asked for');
  assert.ok(!h.log.some(m => /\{Alluring\}/.test(m)), 'nothing fired');
  toBlockStep(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {});
});

test('R84 + R61: a {Pure} lured unit is able against a Flying Alluring column', () => {
  // "a Pure blocker is 'able' against anything, so it can be compelled"
  const h = new Harness(5269);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const plain = spawn(h, A, 'The Foretold');
  const pure = spawn(h, D, 'Just a Unit');                    // {Pure}, no Flying
  attrOn(h, lure, 'Flying');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain]] });
  toBlockStep(h, [pure]);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }), refusedForAllure);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [pure] } }), refusedForAllure);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pure] } });
  assert.deepEqual(h.state.battle!.blocks[0], [pure]);
});

test('R84 + R61: a {Pure} lured unit discharges an EVASIVE Alluring column alone', () => {
  // Pure switches the whole attribute layer off for the exchange, Evasive
  // included, so "could it have covered the column alone?" answers yes.
  const h = new Harness(5270);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const pure = spawn(h, D, 'Just a Unit');
  attrOn(h, lure, 'Evasive');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [pure]);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }), refusedForAllure,
    'Evasive would need two — but a Pure blocker alone is enough, so it is compelled');
  offersAreHonest(h, D);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [pure] } });
  assert.deepEqual(h.state.battle!.blocks[0], [pure]);
});

/* ── the R76 hang guard, restated for the new model ─────────────────────── */

test('R84/R76: legalActions always offers a legal declaration (the fuzz-1993 hang)', () => {
  // The contract that exists because of a real hang: every offered declaration
  // was refused and the game locked up with no legal action for anyone. Each
  // shape below is checked for "there is something" AND "everything offered is
  // accepted"; the same-unit-two-duties case is the one the new model could
  // plausibly have re-broken.
  const shapes: [string, number, number, boolean][] = [
    // label, #Alluring columns, #defenders, aim both lures at the same unit
    ['one lure, no defenders', 1, 0, false],
    ['one lure, one defender', 1, 1, false],
    ['two lures, one defender', 2, 1, true],
    ['two lures, two defenders', 2, 2, false],
    ['two lures, both on one unit', 2, 2, true],
  ];
  shapes.forEach(([label, nLures, nDefs, sameTarget], i) => {
    const h = new Harness(5280 + i);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const lures = Array.from({ length: nLures }, () => spawn(h, A, 'Tempest Wrangler'));
    const ds = Array.from({ length: nDefs }, () => spawn(h, D, 'The Foretold'));
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: lures.map(id => [id]) });
    const aims = nDefs === 0 ? [] : lures.map((_, k) => (sameTarget ? ds[0]! : ds[k % nDefs]!));
    toBlockStep(h, aims);
    const anyone = [...legalActions(h.state, 0), ...legalActions(h.state, 1)];
    assert.ok(anyone.length > 0, `${label}: SOMEBODY must have something to do`);
    offersAreHonest(h, D);
  });
});

test('R84: an attack that has collapsed to nothing still lets the defender declare', () => {
  // R72: every attacking column can empty and close up before blocks, leaving
  // b.columns []. The defender must still have a way to say "no blocks".
  const h = new Harness(5285);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  toBlockStep(h);
  whiteBox(h, e => { e.destroy(ent(h, atk)!, 'is deleted'); });
  assert.deepEqual(h.state.battle!.columns, [], 'the whole attack collapsed away');
  offersAreHonest(h, D);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.equal(h.state.battle!.step, 'blockWindow', 'and the battle moves on');
  finishBattle(h);
});

test('R84: a duty is re-keyed when the formation closes ranks (R72)', () => {
  // The duty names an attack COLUMN, and a column's index is its identity, so
  // it has to move in the same commit as BattleState.blocks.
  const h = new Harness(5286);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const doomed = spawn(h, A, 'The Foretold');
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[doomed], [lure]] });
  toBlockStep(h, [d1]);
  assert.deepEqual(ent(h, d1)!.allured, { round: 1, columns: [1] });
  whiteBox(h, e => { e.destroy(ent(h, doomed)!, 'is deleted'); });
  assert.deepEqual(ent(h, d1)!.allured, { round: 1, columns: [0] }, 'the line closed up under it');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }), refusedForAllure);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } });
  assert.deepEqual(h.state.battle!.blocks[0], [d1]);
});

test('R84: the mark is an until-regroup change, and regroup clears it', () => {
  const h = new Harness(5287);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  toBlockStep(h, [d1]);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } });
  finishBattle(h);
  assert.equal(ent(h, d1)!.allured, undefined, 'cleared with the other temp changes (R11 step 3)');
});

/* ── auto-yield ────────────────────────────────────────────────────────── */

/** a state with `stack` on it, priority to seat 0 */
function stacked(kinds: { kind: string; sourceId?: EntityId }[]): GameState {
  const h = new Harness(5220);
  toDeployment(h);
  const s = h.state;
  s.priority = 0;
  s.decision = null;
  s.stack = kinds.map((k, i) => ({
    id: 100 + i, kind: k.kind as 'triggered' | 'spell', label: `item ${i}`,
    controller: 0, region: 0, negated: false, parts: [],
    ...(k.sourceId !== undefined ? { sourceId: k.sourceId } : {}),
  }));
  return s;
}

test('auto-yield fires on the TOP of the stack, whatever is underneath', () => {
  // the reported bug: the old test required the WHOLE stack to be yielded
  // triggers, so one unyielded item — the common case — disabled the chip entirely
  const s = stacked([
    { kind: 'spell' },                       // somebody else's spell, at the bottom
    { kind: 'triggered', sourceId: 9 },      // not yielded
    { kind: 'triggered', sourceId: 7 },      // TOP: yielded
  ]);
  assert.equal(shouldAutoYield(s, 0, new Set([7])), true);
});

test('auto-yield stays quiet when the top is not yours to skip', () => {
  const yielded = new Set([7]);
  assert.equal(shouldAutoYield(stacked([{ kind: 'triggered', sourceId: 9 }]), 0, yielded), false,
    'a different unit’s trigger still deserves a look');
  assert.equal(shouldAutoYield(stacked([{ kind: 'spell', sourceId: 7 }]), 0, yielded), false,
    'a spell is never auto-yielded, whoever cast it');
  assert.equal(shouldAutoYield(stacked([]), 0, yielded), false, 'an empty stack is not a yield');
  assert.equal(shouldAutoYield(stacked([{ kind: 'triggered', sourceId: 7 }]), 1, yielded), false,
    'not my priority, not my pass');
  assert.equal(shouldAutoYield(stacked([{ kind: 'triggered', sourceId: 7 }]), 0, new Set()), false,
    'nothing yielded, nothing skipped');
});

test('auto-yield never passes through a pending decision', () => {
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  s.decision = { id: 1, seat: 0, kind: 'targets', prompt: 'pick', options: [] };
  assert.equal(shouldAutoYield(s, 0, new Set([7])), false);
});

test('auto-yield does not skip a negated trigger (R68: unreachable, kept as a guard)', () => {
  // R68 made this state impossible to reach in play — negation splices the
  // item off the stack, so nothing on the stack is ever `negated`. The guard
  // stays because the flag stays on the type, and a stack item wearing it
  // should never be silently passed through.
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  s.stack[0]!.negated = true;
  assert.equal(shouldAutoYield(s, 0, new Set([7])), false,
    'a negated item is worth seeing resolve into nothing');
});

/* ── nothing to do while the opponent decides ──────────────────────────── */

test('a seat with a decision pending against the OTHER seat has no legal action', () => {
  // Playtest: "when a decision is pending for the other player I get the window
  // for priority and it asks me to pass, but I can't." The server redacts the
  // opponent's decision to null, so the client cannot see it — but it does not
  // need to: this is the fact the waiting bar is built on (main.ts promptHtml).
  const h = new Harness(5230);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Good Whale');
  giveResources(h, A, 'water', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leaping Lillik') });

  const dec = h.state.decision;
  assert.ok(dec, 'A owes a target decision');
  assert.equal(dec.seat, A);
  assert.deepEqual(legalActions(h.state, D), [],
    'the other seat has nothing legal — so no Pass button may be offered');
  assert.ok(legalActions(h.state, A).length, 'and the deciding seat does');
});

/* ── the round-7 deferral ledger ────────────────────────────────────────────
 *
 * The round-7 commit message closed with "Still open, deliberately:" and four
 * items, and left ZERO trace in the repo — no PARKED comment, no ⚠ header, no
 * { todo: true } test. The engine README's rule AT THE TIME was that the todo
 * count IS the backlog; these four sat outside it, which is exactly why two of
 * them came back as fresh reports. (That rule is retired as of R155 — a todo
 * can never fail, so it was never a backlog, and the count in test/ is now
 * asserted to be zero. A gap that cannot be built goes in card-ledger.ts or
 * card-todo.ts, both of which are checked.) The ledger lives here now
 * (park-hygiene audit, round 13, 2026-08-21):
 *
 *   · Necromorph's second target — CLOSED. R64 gave bin cards a real TargetRef
 *     (`BinRef`); test/43-dark-c.test.ts exercises the exchange end to end.
 *   · Formless's attribute-removal half — CLOSED. R62 is the suppression
 *     layer; batch-metal-b.ts calls `g.suppress(t, 'Formless', { attrs: true })`
 *     and test/59-base-stats.test.ts covers it.
 *   · the empty-column collapse — CLOSED. R72, test/64-formation-collapse.test.ts.
 *   · Eldritch Dreamtender's sacrifice timing — CLOSED. R73 (Bena, 2026-08-22):
 *     "sacrifice me" is a CAST COST, paid on the way to the stack, not at
 *     resolution. `sacrificeUnits` gained `from: 'self'` (resolved through
 *     item.sourceId, the `removeCounters` precedent) and the card carries it.
 *     Real tests, no longer todos: test/26-metal-a.test.ts for the card,
 *     test/32-cast-costs.test.ts for the primitive.
 *
 * ALL FOUR round-7 deferrals are now closed, and so is the fifth question that
 * outlived them: R73 settled WHETHER the sacrifice is a cost, and R117 (owner,
 * 2026-08-23) settled WHICH combat damage sub-step the trigger fires in —
 * **the sub-step its own column strikes in.** The `{ todo: true }` that used to
 * sit here, and the card-ledger entry that named it, are replaced by the real
 * tests below.
 */

/* ── R117: "when my column deals combat damage" fires in MY column's sub-step ──
 *
 * Printed: "[Augment] When my column deals combat damage to an opponent,
 * sacrifice me. If you do, look at that player's hand and discard a card from
 * it." The gap R117 closes is not the printed text but the READ: the trigger
 * listens on the aggregated combat `lifeLost`, and `commitPlayerDamage` folds
 * EVERY connecting column's face damage into one `loseLife` per seat per
 * sub-step. So a Dreamtender in a NORMAL column used to hear the SWIFT
 * sub-step's damage as its own, sacrifice itself a sub-step early, and never
 * be alive to deal its own column's damage at all.
 *
 * The gate is `E.strikesInCurrentSubStep`, and it lives in `when()`: `when()`
 * is evaluated at event time inside `combatSubStep(sub)`, while
 * `b.damageStep` is advanced only after `combatSubStep` returns — so it reads
 * the CURRENT sub-step there and the NEXT one by the time the trigger settles.
 *
 * ⚠ R261 (owner, 2026-08-30) LEFT THE GATE AND TOOK THE CLOCK, AND THAT IS
 * WHY THESE THREE TESTS HAD TO CHANGE THEIR INSTRUMENT.
 *
 * A combat-damage trigger no longer RESOLVES inside the damage sub-step: it is
 * announced there and held, and it goes on the stack in the after-combat
 * window with the afterCombat triggers, where both seats may answer it. R117's
 * finding — the trigger fires in the sub-step its own column strikes in — is
 * untouched. What died is the sentence these tests used to MEASURE it by.
 *
 * They measured the gate through the Dreamtender's sacrifice: fire a sub-step
 * early and the Dreamtender is in the bin before its own column strikes, so
 * the face damage comes out one lower. Under R261 the sacrifice is paid on the
 * way to the after-combat stack whichever sub-step announced the trigger, so
 * the Dreamtender is ALWAYS alive for its own column's damage and the life
 * total is the same number either way.
 *
 * MEASURED: with BOTH sub-step gates disabled in a scratch copy of the engine
 * (`strikesInCurrentSubStep` forced true AND R195's `faceDamageDealtBy`
 * column filter removed), all 40 tests in this file still passed. The
 * instrument is `dreamtenderTriggers` below — the COUNT of announcements,
 * which is the one thing the hold did not move.
 *
 * ⚠ AND "BOTH GATES" IS NOT A FIGURE OF SPEECH — R117 IS NOW THE REDUNDANT
 * ONE. `strikesInCurrentSubStep` can be replaced outright by `return true` and
 * NOTHING notices: not this file, not 115-literal-light, not
 * 134-column-and-substep (which is named after it), not
 * 239-damage-triggers-after-combat. R195 gave the aggregated `lifeLost` event a
 * per-column breakdown and `columnDealtCombatDamage`'s face arm now asks
 * `faceDamageDealtBy` — which already answers "did MY column deal any of
 * this?" and therefore already answers "is this my sub-step?", because a
 * column only ever deals face damage in a sub-step it strikes in. Either gate
 * alone holds the rule; only removing both moves a number. That is why the
 * assertions below are worded against the RULE and not against either
 * implementation of it.
 *
 * ⚠ NOT CLOSED, and deliberately out of scope: face damage still arrives as
 * ONE aggregated `lifeLost` per seat per sub-step, so two of the SAME player's
 * columns connecting in the SAME sub-step stay indistinguishable to card text.
 * Closing that means carrying live column ids on the combat ledger, which is a
 * separate job touching Amphivore, Vroot, Zephyrzoa and Blightmound too.
 */

/** answer whatever the combat pump raised (the Dreamtender's discard pick, a
 * trigger ordering) so the remaining sub-steps can run */
function answerAll(h: Harness): void {
  let guard = 20;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    h.do({
      type: 'decide', seat: d.seat,
      choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0,
    });
  }
  if (guard <= 0) throw new Error('answerAll did not terminate');
}

/**
 * How many times the Dreamtender's "when my column deals combat damage to an
 * opponent" was ANNOUNCED — `fireEvent` writes 'triggered' at QUEUE time, so
 * this counts firings and not resolutions, which is exactly the R117 question.
 *
 * ⚠ THIS IS THE ONLY NON-VACUOUS INSTRUMENT LEFT IN THESE THREE TESTS. See the
 * R261 note in the section header above: the life totals below are true, and
 * they are true whether or not the gate holds. Without the gate the aggregated
 * `lifeLost` of EVERY sub-step fires the trigger, so a normal column reports 2
 * and a Sluggish one 3; with it, always 1.
 */
function dreamtenderTriggers(h: Harness): number {
  return h.events.filter(
    ev => ev.type === 'triggered' && /Eldritch Dreamtender/.test(ev.msg)).length;
}

/* ⚠ THE OLD TITLE, and it is half superseded:
 *
 *     'R117: a Dreamtender in a NORMAL column survives the Swift sub-step and
 *      is sacrificed in its own'
 *
 * It still survives the Swift sub-step. It is no longer sacrificed IN ITS OWN
 * sub-step — R261 holds the trigger to the after-combat window and the
 * sacrifice, which is a cast cost (R73), is paid on the way to the stack
 * there. */
test('R117 + R261: a Dreamtender in a NORMAL column hears only its OWN column damage, and pays after combat', () => {
  const h = new Harness(5290);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const swift = spawn(h, A, 'Dune Drifter');                 // {Swift}, 2 power
  const dt = spawn(h, A, 'Eldritch Dreamtender');            // no speed attribute, 1 power
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[swift], [dt]] });
  assert.equal(h.q.combatSubStepOf(ent(h, swift)!), 'Swift');
  assert.equal(h.q.combatSubStepOf(ent(h, dt)!), 'normal',
    'my column has no Swift and no Sluggish in it, so it strikes in the normal sub-step');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  answerAll(h);
  // THE REGRESSION THIS USED TO PIN: before R117 the Swift column's aggregated
  // lifeLost fired the Dreamtender, so it was already in the bin when the
  // normal sub-step ran and its own 1 power evaporated — 2 damage, not 3.
  //
  // ⚠ AND THAT NUMBER NO LONGER PINS IT (R261). The sacrifice is paid after
  // combat now, so the Dreamtender is alive for the normal sub-step whether
  // the gate held or not, and this reads life0 - 3 either way. It is kept
  // because it is still TRUE and still the right description of the board;
  // the count below is what makes the test fail when the gate goes.
  assert.equal(h.state.players[D]!.life, life0 - 3,
    "2 from the Swift column and 1 from the Dreamtender's own — it was alive to deal it");
  assert.equal(dreamtenderTriggers(h), 1,
    'ONE announcement: the normal sub-step, its own. With the sub-step gating gone the Swift '
    + 'sub-step\'s aggregated lifeLost fires it as well and this reads 2');
  assert.equal(ent(h, dt), undefined,
    'and it has left the board — the sacrifice is a cast cost (R73), paid on the way to the '
    + 'after-combat stack rather than inside the sub-step');
  assert.ok(h.state.players[A]!.bin.includes('Eldritch Dreamtender'));
  // R261, POSITIVE CONTROL: the trigger is really ON THE STACK and really
  // resolves there. Every board assertion above would also hold on a board
  // where the trigger had been swallowed on the way out of the damage step.
  assert.ok(h.state.stack.some(it => /Eldritch Dreamtender/.test(it.label)),
    'the held trigger is on the after-combat stack, where the other seat can answer it');
  const hand0 = h.state.players[D]!.hand.length;
  resolveAfterCombat(h);
  assert.equal(h.state.players[D]!.hand.length, hand0 - 1,
    'and when it resolves it does what it prints: a card leaves the opponent\'s hand');
  finishBattle(h);
});

test('R117: a Dreamtender in a {Swift} column fires in the Swift sub-step', () => {
  const h = new Harness(5291);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const swift = spawn(h, A, 'Dune Drifter');                 // {Swift}, 2 power
  const dt = spawn(h, A, 'Eldritch Dreamtender');            // 1 power
  const plain = spawn(h, A, 'Unit Token');                   // 1 power, normal
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  // the mirror of the test above: {Swift} is shared vertically down a column
  // (E.colAttrs), so standing next to the Drifter moves the Dreamtender's
  // strike — and therefore its trigger — into the Swift sub-step.
  h.do({ type: 'declareAttack', seat: A, columns: [[swift, dt], [plain]] });
  assert.equal(h.q.combatSubStepOf(ent(h, dt)!), 'Swift',
    'the column carries Swift, so I strike in the Swift sub-step');
  assert.equal(h.q.combatSubStepOf(ent(h, plain)!), 'normal');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  answerAll(h);
  assert.equal(h.state.players[D]!.life, life0 - 4,
    '3 from the Swift column (2 + 1) and 1 from the normal one');
  assert.equal(dreamtenderTriggers(h), 1,
    'ONE announcement, in the Swift sub-step — the normal sub-step\'s lifeLost is not mine, '
    + 'and R261 did not widen what a trigger HEARS, only when it resolves');
  assert.equal(ent(h, dt), undefined,
    'sacrificed for its own column\'s damage — after combat, not in the sub-step (R261)');
  finishBattle(h);
});

test('R117: a Dreamtender in a {Sluggish} column waits out BOTH earlier sub-steps', () => {
  const h = new Harness(5292);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const swift = spawn(h, A, 'Dune Drifter');                 // {Swift}, 2 power
  const plain = spawn(h, A, 'Unit Token');                   // 1 power, normal
  const slow = spawn(h, A, 'Plodding Pebble');               // {Sluggish}, 0 power
  const dt = spawn(h, A, 'Eldritch Dreamtender');            // 1 power
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[swift], [plain], [slow, dt]] });
  assert.equal(h.q.combatSubStepOf(ent(h, dt)!), 'Sluggish');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  answerAll(h);
  // Two aggregated lifeLost events go past before mine: the sharpest form of
  // the bug, because the old read fired on the FIRST one it heard.
  assert.equal(h.state.players[D]!.life, life0 - 4, '2 Swift + 1 normal + 1 Sluggish');
  assert.equal(dreamtenderTriggers(h), 1,
    'ONE announcement out of THREE aggregated lifeLost events — the sharpest form of the '
    + 'measurement, and the only one of these three numbers R261 left able to fail');
  assert.equal(ent(h, dt), undefined);
  finishBattle(h);
});

test('R117 threads {Pure}: a printed {Swift} column blocked by a Pure unit strikes in the NORMAL sub-step', () => {
  // R61 collapses an attribute-blind exchange into the normal sub-step whatever
  // the columns are printed with, and it is a property of the PAIRING, not of
  // either column — which is why `combatSubStepOf` reconstructs `pure` the way
  // `assignCombatDamage` does instead of reading the column's own attributes.
  // Asked at the engine level: a column blocked by a Pure unit deals no face
  // damage at all (Pure switches Piercing off too), so there is no `lifeLost`
  // for the Dreamtender's trigger to hear either way. Two blockers because the
  // Dreamtender is {Evasive}.
  const subStepBlockedBy = (blocker: string): string | null => {
    const h = new Harness(5293);
    toDeployment(h);
    const A = h.state.deployPlayer!, D = (1 - A) as Seat;
    const swift = spawn(h, A, 'Dune Drifter');               // {Swift}
    const dt = spawn(h, A, 'Eldritch Dreamtender');
    const blk = spawn(h, D, blocker);
    const blk2 = spawn(h, D, 'Unit Token');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[swift, dt]] });
    pass(h); pass(h);
    h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk, blk2] } });
    return h.q.combatSubStepOf(ent(h, dt)!);
  };
  assert.equal(subStepBlockedBy('Unit Token'), 'Swift', 'an ordinary blocker changes nothing');
  assert.equal(subStepBlockedBy('Just a Unit'), 'normal',
    '{Pure} blinds the whole exchange to attributes, Swift included (R61)');
});

test('R117: combatSubStepOf answers null for a unit that is not in a column', () => {
  const h = new Harness(5294);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const dt = spawn(h, A, 'Eldritch Dreamtender');
  const bench = spawn(h, A, 'Unit Token');
  assert.equal(h.q.combatSubStepOf(ent(h, dt)!), null, 'no battle at all');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dt]] });
  assert.equal(h.q.combatSubStepOf(ent(h, bench)!), null, 'left at home, in no column');
  assert.equal(h.q.combatSubStepOf(ent(h, dt)!), 'normal');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  answerAll(h);
  finishBattle(h);
});
