/* CT-260 — a Pure interaction ignores the stat-layer attributes too.
 *
 * The owner, 2026-10-22: print wins. Pure's reminder is "Pure cards and cards
 * they are interacting with ignore all other attributes", and {Tough},
 * {Balanced}, {Inverted} and {Unaware} are attributes. CR 802.25e: "in an
 * interaction involving a Pure card they do not apply". CR 802.25f: Unaware
 * "does not apply in an exchange involving a Pure card". The engine kept
 * layers 4-6 on in a Pure pairing ("they are stat layers").
 *
 * Outside an interaction nothing changes: the state-based check still reads a
 * Pure unit's own Tough and Inverted (427, effects.state.no-damage-needed.pure).
 *
 * Seeds 55500-55599. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  h.state = g.s;
  return u.id;
}
function grant(h: Harness, id: EntityId, attr: Attr): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
  h.state = g.s;
}
/** effect damage from a unit source, outside combat */
function dealFrom(h: Harness, controller: Seat, sourceId: EntityId, tgt: EntityId, n: number): void {
  const g = new E(h.state);
  g.dealEffectDamageAll({
    controller, sourceName: g.entity(sourceId)!.card, sourceId, region: g.homeRegion(controller),
    targets: [], event: null, eraseSelf: () => {},
    choose: () => { throw new Error('no choice expected'); },
  } as never, [{ target: g.entity(tgt)!, n }]);
  g.settle();
  h.state = g.s;
}
function strikeAll(h: Harness): void {
  for (let i = 0; i < 10 && h.state.decision?.kind === 'assignDamage'; i++) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
}
function setup(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  return { h, A, D };
}

/* ── outside combat ─────────────────────────────────────────────────── */

test('CR 802.25e / CT-260: a Pure source dealing 5 to Rampart Guardian kills it, because its Tough is off in the pairing', () => {
  const { h, A, D } = setup(55501);
  const src = spawn(h, A, 'Just a Unit');          // 2/3 Pure
  const tgt = spawn(h, D, 'Rampart Guardian');     // 0/4 Tough, an 0/8 outside the pairing
  assert.deepEqual(effStats(h, tgt), [0, 8], 'setup: Tough doubles it outside any interaction');
  dealFrom(h, A, src, tgt, 5);
  assert.equal(ent(h, tgt), undefined, 'read as a 0/4 against a Pure source: 5 is lethal');
});

test('CR 802.25e / CT-260 PREMISE: the same 5 from a source that is not Pure leaves the Tough 0/8 alive', () => {
  const { h, A, D } = setup(55502);
  const src = tok(h, A, 2, 3);
  const tgt = spawn(h, D, 'Rampart Guardian');
  dealFrom(h, A, src, tgt, 5);
  assert.ok(ent(h, tgt), 'Tough applies in a plain pairing');
  assert.equal(ent(h, tgt)!.damage, 5);
});

test('CR 802.25e / CT-260: a Balanced 4/1 dealt 3 by a Pure source dies, because Balanced is off in the pairing', () => {
  const { h, A, D } = setup(55503);
  const src = spawn(h, A, 'Just a Unit');
  const tgt = tok(h, D, 4, 1);
  grant(h, tgt, 'Balanced');
  assert.deepEqual(effStats(h, tgt), [4, 4], 'setup: Balanced makes the 4/1 a 4/4');
  dealFrom(h, A, src, tgt, 3);
  assert.equal(ent(h, tgt), undefined, 'read as a 4/1: 3 is lethal');
});

test('CR 802.25e / CT-260: a Pure recipient ignores its own Tough, so a plain source dealing 5 to a Pure Tough 0/4 kills it', () => {
  const { h, A, D } = setup(55504);
  const src = tok(h, A, 2, 3);
  const tgt = tok(h, D, 0, 4);
  grant(h, tgt, 'Tough');
  grant(h, tgt, 'Pure');
  dealFrom(h, A, src, tgt, 5);
  assert.equal(ent(h, tgt), undefined, 'a Pure card ignores its own other attributes in the interaction too');
});

test('CR 802.25e / CT-260: in a Battle between Just a Unit and a Balanced 1/4, the Balanced unit deals 1, not 4', () => {
  const { h, A, D } = setup(55505);
  const jau = spawn(h, A, 'Just a Unit');          // 2/3 Pure
  const bal = tok(h, D, 1, 4);
  grant(h, bal, 'Balanced');                       // a 4/4 outside the fight
  giveResources(h, A, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[jau]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Battle') });
  pick(h, { unit: jau });
  pick(h, { unit: bal });
  pass(h); pass(h);
  assert.ok(ent(h, jau), 'Just a Unit survives the fight');
  assert.equal(ent(h, jau)!.damage, 1, 'the fight read the Balanced 1/4 at its 1 power');
});

/* ── combat ─────────────────────────────────────────────────────────── */

test('CR 802.25e / CT-260: in combat, Rampart Guardian blocking a 5-power Pure attacker has 4 defense, not 8, and dies', () => {
  const { h, A, D } = setup(55506);
  const atk = tok(h, A, 5, 20);
  const guard = spawn(h, D, 'Rampart Guardian');
  toNextBattle(h, A);
  grant(h, atk, 'Pure');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [guard] } });
  pass(h); pass(h);
  strikeAll(h);
  assert.equal(ent(h, guard), undefined, 'Tough was not read in the Pure exchange');
  finishBattle(h);
});

test('CR 802.25f / CT-260: in combat, Bubb blocking a Pure 3/3 with four +1/+1 counters collapses nobody: the 7/7 kills Bubb and survives', () => {
  const { h, A, D } = setup(55507);
  const atk = tok(h, A, 3, 3);
  ent(h, atk)!.counters = 4;                       // live 7/7, printed 3/3
  const bubb = spawn(h, D, 'Bubb');                // 5/6 Unaware
  toNextBattle(h, A);
  grant(h, atk, 'Pure');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);
  strikeAll(h);
  assert.equal(ent(h, bubb), undefined, 'the Pure attacker dealt its live 7: Unaware did not collapse the exchange');
  assert.ok(ent(h, atk), 'and it took 5 against its live 7 defense');
  assert.equal(ent(h, atk)!.damage, 5);
  finishBattle(h);
});
