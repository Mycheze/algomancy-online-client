/* Playtest fixes: cast-time additional costs and cast-time X (CR 702.3), plus the
 * single-unit counterattack auto-formation.
 *
 *  - Bracketed [Sacrifice a unit] costs on SPELLS are chosen and PAID AT
 *    CAST, before the spell reaches the stack (the Immolate bug: it used to
 *    reach the stack with the cost still unpaid). No unit → the cast is
 *    ILLEGAL. Grafted riders pay (or decline) when the composite collects
 *    its cast-time decisions.
 *  - X spells: X is chosen AND paid at cast, stored on the stack item, and
 *    responses happen with X already fixed (the "Rashi paid 0" bug: X used
 *    to be chosen mid-resolution).
 *  - forcedAction(): attacks are never auto-declared for the player — the
 *    round-2 sole-counterattacker auto-form was removed 2026-08-24 (the
 *    decisions-for-the-player audit); only truly choiceless boards submit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { forcedAction, IllegalAction } from '../src/apply.ts';
import { E } from '../src/engine.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import {
  ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';

// ── cast-time additional costs (Immolate & friends) ───────────────────

test('Immolate: the sacrifice is chosen and paid AT CAST, before the stack push', () => {
  const h = new Harness(3200);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  // the cost decision arrives IMMEDIATELY — the spell is NOT on the stack yet
  assert.equal(h.state.stack.length, 0, 'nothing on the stack while the cost is unpaid');
  assert.equal(h.state.decision!.seat, A, 'the caster pays');
  assert.ok(h.state.decision!.prompt.includes('additional cost'));
  assert.ok(!h.state.decision!.options.some(o => o.label.startsWith("Don't pay")),
    "the spell's own cost is mandatory — no decline option");
  pick(h, { unit: atk });
  assert.ok(!ent(h, atk), 'sacrificed on the spot (a cost, not respondable)');
  assert.equal(h.state.stack.length, 1, 'NOW the spell is on the stack');
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                  // resolve → draw
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'drew a card');
  assert.ok(h.state.players[A]!.bin.includes('Immolate'));
});

test('Immolate: with no unit to sacrifice the cast is ILLEGAL and never offered', () => {
  // D holds Immolate + mana but has NO unit; A attacks into D's region
  const h = new Harness(3202);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, D, 'fire', 1);
  const idx = give(h, D, 'Immolate');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                           // priority → D (who has no unit anywhere)
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === idx),
    'legalActions never offers the unpayable cast');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: idx }),
    IllegalAction, 'apply rejects it too');
});

test('cast cost stays paid when the spell is negated (no refund)', () => {
  const h = new Harness(3203);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 1);
  giveResources(h, D, 'fire', 1);                    // Soul Tithe r/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pick(h, { unit: atk });                            // cost paid at cast; A now has 0 open
  const immId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Tithe') });
  pick(h, { stack: immId });
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                  // Tithe resolves: A cannot pay [1]…
  pick(h, false);                                    // …declines → Immolate negated, D draws
  assert.equal(h.state.stack.length, 0, 'CR 704.4: the negated Immolate left the stack at once');
  assert.ok(h.state.players[A]!.bin.includes('Immolate'), 'negated → bin');
  assert.ok(!ent(h, atk), 'the sacrifice is NOT refunded (CR 702.4b: costs are paid at cast)');
  assert.equal(h.state.players[A]!.hand.length, handBefore, 'and nothing was drawn');
});

// The mandatory grafted cost (CR 722.6, CT-216) INVERTS this test's second half. It was "— or declines": a
// grafted rider was opt-in, on no ruling. RAQ "Graft 101" point 11: the
// grafted [cost] "is non-optional (you MUST pay it, you can't opt out)".
test('grafted Immolate: the carrier must pay the cost at composite cast time — no decline (CR 722.6)', () => {
  const h = new Harness(3204);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const evoker = spawn(h, p, 'Omniwield Evoker');    // activated graft cause ([three])
  const fodder = spawn(h, p, 'Conduit of Pain');
  giveResources(h, p, 'fire', 1);                    // Immolate r/1 (graft payment)
  giveResources(h, p, 'metal', 3);                   // the [three] activation
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'Immolate'), hostId: evoker, position: 0 });
  h.do({ type: 'activateAbility', seat: p, entityId: evoker, abilityIndex: 0 });
  assert.equal(h.state.decision!.seat, p, 'the carrier controller pays');
  assert.ok(!h.state.decision!.options.some(o => /don.t pay|decline|skip/i.test(o.label)),
    'CR 722.6: a grafted [cost] is not optional — no decline is offered');
  const handBefore = h.state.players[p]!.hand.length;
  pick(h, { unit: fodder });
  assert.ok(!ent(h, fodder), 'the rider cost was paid at cast');
  assert.equal(ent(h, evoker)!.counters, 1, 'the base effect still resolved');
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'the rider drew');
});

test('Volatile Toxicity: X reads the defense snapshotted when the cost was paid', () => {
  const h = new Harness(3206);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');           // 7/5 → X = 5
  giveResources(h, D, 'fire', 1);
  giveResources(h, D, 'wood', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Volatile Toxicity') });
  pick(h, { unit: whale });                          // cost: defense 5 snapshotted now
  const item = h.state.stack.find(i => i.card === 'Volatile Toxicity')!;
  assert.equal(item.parts[0]!.costPaid!.sacrificed!.defense, 5, 'receipt on the part');
  pass(h); pass(h);                                  // resolve
  const toks = Object.values(h.state.entities).filter(e => e.kind === 'spellToken' && e.controller === D);
  assert.ok(toks.some(t => t.card === 'Poison' && t.x === 5), 'Poison 5');
  assert.ok(toks.some(t => t.card === 'Fireball' && t.x === 5), 'Fireball 5');
});

// ── cast-time X (Wildfire & friends) ──────────────────────────────────

test('Wildfire: X is chosen at cast from affordable values, paid, and stored on the item', () => {
  const h = new Harness(3210);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'fire', 3);                    // rr affinity + up to 3 mana
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  // X first, at cast — before the target, before the stack push
  assert.equal(h.state.stack.length, 0, 'not on the stack while X is unchosen');
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [0, 1, 2, 3],
    'only affordable values 0..openMana are offered');
  pick(h, 3);
  assert.equal(new E(h.state).openMana(D), 0, 'X was paid at cast');
  pick(h, { unit: whale });
  const wf = h.state.stack.find(i => i.card === 'Wildfire')!;
  assert.equal(wf.x, 3, 'X stored on the stack item');
  assert.ok(wf.label.includes('X=3'), 'the label announces X to the responder');
  pass(h); pass(h);                                  // responses happen AFTER X is fixed
  assert.equal(ent(h, whale)!.damage, 3, 'resolution reads the stored X');
});

test("Frosted Denial: xMin 1 — with no open mana the cast is illegal (X can't be zero)", () => {
  const h = new Harness(3211);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  // D: water affinity but ZERO open mana (expended still gives affinity;
  // granted after the turn flip so startTurn cannot refresh it)
  giveResources(h, D, 'water', 1, 'expended');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pick(h, { unit: atk });                            // something on the stack to target
  // the push handed priority to D
  const idx = give(h, D, 'Frosted Denial');
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === idx),
    'not offered: X ≥ 1 is unaffordable');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: idx }), IllegalAction);
});

test('X spells resolve from the stored X — a 0-mana caster may still cast for X = 0', () => {
  const h = new Harness(3212);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  // rr affinity, NO open mana (granted post-flip so startTurn cannot refresh)
  giveResources(h, D, 'fire', 2, 'expended');
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [0], 'X = 0 is the only option');
  pick(h, 0);
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.equal(ent(h, whale)!.damage, 0, 'X = 0 dealt nothing (and nobody was silently charged)');
});

// ── single-unit counterattack auto-formation ──────────────────────────

/** drive round 1 to its end: A attacks with `atk`, D blocks nothing and
 * sends `send`; all windows passed */
function throughRoundOne(h: Harness, A: number, atk: number, send: number[]): void {
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                  // attack window
  h.do({ type: 'declareBlocks', seat: 1 - A, blocks: {}, send });
  pass(h); pass(h);                                  // block window → damage
  while (h.state.phase === 'battle' && h.state.battle!.round === 1) pass(h);
}

test('forcedAction: a single sent counterattacker IS auto-formed — the unit was committed at block time', () => {
  // FLIPPED BACK 2026-10-16. It was flipped on 2026-08-24 because declining
  // (`columns: []`) was then still legal. The owner, 2026-10-16: "if you decide
  // to counterattack with something, it MUST be put into formation" — so there
  // is no decline, one unit has one shape, and nothing is left to decide
  // (CR 610.4b, CR D1.2c).
  const h = new Harness(3220);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');             // survives unblocked
  const d1 = spawn(h, D, 'Conduit of Pain');         // the lone counterattacker
  toNextBattle(h, A);
  throughRoundOne(h, A, atk, [d1]);
  const b = h.state.battle!;
  assert.equal(b.round, 2);
  assert.equal(b.attacker, D);
  assert.deepEqual(b.attackerPool, [d1], 'the pool holds exactly the sent unit');
  assert.deepEqual(forcedAction(h.state), { type: 'declareAttack', seat: D, columns: [[d1]] },
    'the one-unit formation is declared for the player');
  // the decline is refused…
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [] }), IllegalAction,
    'a sent counterattacker cannot be left out of the formation');
  // …and the forced action is accepted
  h.do(forcedAction(h.state)!);
  assert.ok(h.state.battle!.columns.flat().includes(d1), 'it attacks');
});

test('forcedAction: a lone counterattacker with a sent spell token is formed with the token riding', () => {
  // FLIPPED 2026-10-16. The owner: "counterattacking wiht spell tokens is the
  // same as attacking with them. You gotta take them with you THEN or never
  // have access to them in the other region." A sent token is owed like a sent
  // unit, so it leaves no choice either (CR 610.3, CR D1.2c).
  const h = new Harness(3221);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  const d1 = spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  // a spell token of D's, in the battle region (D's home), sendable at block time
  const e = new E(h.state);
  const tok = e.createSpellToken(D, 'Fireball', 2, e.homeRegion(D));
  throughRoundOne(h, A, atk, [d1, tok.id]);
  assert.equal(h.state.battle!.round, 2);
  assert.deepEqual(forcedAction(h.state), { type: 'declareAttack', seat: D, columns: [[d1]], spellTokens: [tok.id] },
    'the unit forms and the token rides — nothing is left to decide');
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [[d1]] }), IllegalAction,
    'leaving the sent token behind is refused');
  h.do(forcedAction(h.state)!);
  assert.equal(ent(h, tok.id)!.region, new E(h.state).homeRegion(A), 'the token rode along');
});

test('forcedAction: NOT forced with two sent units, nor in round 1 with one unit', () => {
  const h = new Harness(3222);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  const d1 = spawn(h, D, 'Conduit of Pain');
  const d2 = spawn(h, D, 'Stasis Sentry');
  toNextBattle(h, A);
  // round 1: A has exactly one unit — never forced (a fresh attack is a choice)
  assert.equal(forcedAction(h.state), null, 'round-1 attacks are never auto-formed');
  throughRoundOne(h, A, atk, [d1, d2]);
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attackerPool!.length, 2);
  assert.equal(forcedAction(h.state), null, 'two counterattackers → a real formation choice');
  // CR 610.4b: but the choice is the SHAPE only — leaving one out is refused
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [[d1]] }), IllegalAction,
    'both sent units must be in the formation');
  h.do({ type: 'declareAttack', seat: D, columns: [[d1, d2]] });
  assert.deepEqual(h.state.battle!.columns, [[d1, d2]], 'any shape that holds them all is legal');
});

/* ── "[Sacrifice me]" — a self-scoped sacrifice cast cost (the primitive) ──
 *
 * `CastCost` could say "sacrifice a unit" but not "sacrifice ME" —
 * castCostOptions offered every unit you control in the region, so the payer
 * could sacrifice something else entirely. `sacrificeUnits` takes
 * `from: 'self'`, resolved through `item.sourceId`, exactly as `removeCounters`
 * already resolves its own `from: 'self'`.
 *
 * It is the shape of a BRACKETED "[Sacrifice me]" — a printed cost. It was
 * built for the owner ruling of 2026-08-22 that read Eldritch Dreamtender's
 * "sacrifice me. If you do, …" as one; that ruling was reversed on 2026-10-21
 * (CR 111.8, Caleb: the sacrifice is part of the effect — CT-264), and no card
 * declares it today. 515-trigger-sacrifice-me guards that no triggered effect
 * carries a castCost its printed text does not mark. These two pin the
 * PRIMITIVE, on a synthetic card, where the source's life and death can be
 * controlled exactly.
 */

registerSynthetic({
  name: 'T32 Selfeater', cost: '', mana: 0, power: 1, toughness: 1,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], text: '', image: '',
}, {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'sacrifice me: gain a rot',
    effect: {
      castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 },
      run: (g, ctx) => { g.gainRot(ctx.controller, 1); },
    },
  }],
});

test('[Sacrifice me] is charged with NO decision — that is what makes it unrespondable', () => {
  const h = new Harness(3230);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const before = h.state.players[P]!.rot ?? 0;
  const e = new E(h.state);
  const u = e.spawnUnit(P, 'T32 Selfeater', e.homeRegion(P));
  e.settle();
  const log = e.events.map(x => x.msg);
  h.state = e.s;
  assert.equal(h.state.decision, null, 'no unit menu, no pay-or-decline: no decision at all');
  assert.ok(!ent(h, u.id), 'it sacrificed ITSELF');
  assert.ok(h.state.players[P]!.bin.includes('T32 Selfeater'), 'and went to its own bin');
  assert.equal(h.state.players[P]!.rot ?? 0, before + 1, 'the effect still resolved');
  // paid on the way to the stack: the sacrifice precedes the resolution
  const iPay = log.findIndex(l => l.includes('sacrifices T32 Selfeater'));
  const iRes = log.findIndex(l => l.startsWith('Resolving ') && l.includes('T32 Selfeater'));
  assert.ok(iPay !== -1 && iRes !== -1 && iPay < iRes, 'paid before it resolved');
});

test('a source that is already dead makes the cost UNPAYABLE, so the part is skipped', () => {
  // Deliberately NOT `unitsOf(seat, region).length >= 1`: another live unit
  // standing there must not stand in for the source. The part is then skipped,
  // which is the right answer for a trigger whose source died between firing
  // and settling.
  const h = new Harness(3231);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const before = h.state.players[P]!.rot ?? 0;
  spawn(h, P, 'Good Whale');                       // a live ally that must NOT be eaten
  const e = new E(h.state);
  const u = e.spawnUnit(P, 'T32 Selfeater', e.homeRegion(P));   // queues its trigger
  e.destroy(u, 'dies');                                         // …then dies before settle
  e.settle();
  const log = e.events.map(x => x.msg);
  h.state = e.s;
  assert.equal(h.state.players[P]!.rot ?? 0, before, 'the effect never resolved');
  assert.equal(
    h.q.unitsOf(P, h.q.homeRegion(P)).filter(x => x.card === 'Good Whale').length,
    1, 'and the ally standing beside it was NOT sacrificed in its place');
  assert.ok(log.some(l => l.includes('sacrifice me') && l.includes('cannot be paid')),
    'the log says why: the cost could not be paid');
});
