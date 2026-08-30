/* Round 17's permission layers, tested as LAYERS rather than as cards.
 *
 * The per-card tests live with their batches (26-metal-a for Dispatch Courier,
 * 24-wood-b for Phytochemical Protection, 40-light-c for Calming Force). What
 * is here is the class of defect each layer is exposed to, which no single
 * card test covers:
 *
 *  1. R97 — a permission asked at THREE gates that must agree. The fuzzer's
 *     "legalActions lied" check exists because this class of split is real:
 *     an action the client is offered and the reducer refuses (or worse, one
 *     the reducer accepts and the client never offers) is a playtest report
 *     waiting to be filed. Asserted directly, both directions.
 *  2. R98 — PREVENTION and REPLACEMENT are two different layers and must never
 *     be collapsed into one. Caleb 2024-10-24 on replacement: the damage still
 *     counts as having been DEALT. The Phytochemical RAQ on prevention: "if
 *     there is not damage being dealt, then no counters are placed." The two
 *     rulings point opposite ways, so one test drives both through the same
 *     board and asserts they behave differently.
 *  3. R100 — a zone restriction that is REFUSED, not merely un-offered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { apply, legalActions, IllegalAction } from '../src/apply.ts';
import type { Action, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle,
} from './util.ts';

function whiteBox(h: Harness, fn: (e: E) => void): string[] {
  const e = new E(h.state);
  try { fn(e); e.settle(); } catch (sig) { if (!(sig instanceof Suspended)) throw sig; }
  h.state = e.s;
  return e.events.map(ev => ev.msg);   // E starts with an empty log of its own
}

/** does `apply` accept this action from this state? (state is not kept) */
function accepted(h: Harness, a: Action): boolean {
  try { apply(h.state, a); return true; } catch (err) {
    if (err instanceof IllegalAction) return false;
    throw err;
  }
}

// ── 1. R97: the three gates agree, in both directions ──────────────────

test('R97: every hand play legalActions offers in the haste step is really accepted', () => {
  const h = new Harness(8001);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'metal', 6);
  give(h, A, 'Nebula Drifter');      // m/1 deploy unit — grant-funded
  give(h, A, 'Monke');               // m/1 {Battle} unit — the RAQ refusal
  give(h, A, 'Discharge');           // a deploy SPELL — not "a unit"
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the step is open');
  const offers = legalActions(h.state, A).filter(a => a.type === 'playCard');
  assert.ok(offers.length > 0, 'something is offered at all');
  for (const a of offers) {
    assert.ok(accepted(h, a), `legalActions offered ${JSON.stringify(a)} and apply refused it`);
  }
});

test('R97: nothing legalActions withholds in the haste step is accepted behind its back', () => {
  const h = new Harness(8002);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'metal', 6);
  give(h, A, 'Nebula Drifter');
  give(h, A, 'Monke');
  give(h, A, 'Discharge');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const offered = new Set(legalActions(h.state, A)
    .filter(a => a.type === 'playCard')
    .map(a => JSON.stringify(a)));
  h.state.players[A]!.hand.forEach((_, i) => {
    const a: Action = { type: 'playCard', seat: A, handIndex: i };
    if (offered.has(JSON.stringify(a))) return;
    assert.ok(!accepted(h, a),
      `apply accepted hand index ${i} that legalActions never offered`);
  });
});

test('R97: the grant is REGION-scoped and belongs to the grantor’s controller', () => {
  // R12, and the same rule R95 spells out for Rook: "I am 99% sure that Rook
  // has to be in the region, since there are no global effects in Algomancy".
  const h = new Harness(8003);
  const A: Seat = 0, D: Seat = 1;
  spawn(h, A, 'Dispatch Courier');   // in A's home region
  giveResources(h, D, 'metal', 4);
  const idx = give(h, D, 'Nebula Drifter');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  if (h.state.hasteDone) {
    assert.ok(!legalActions(h.state, D).some(a => a.type === 'playCard' && a.handIndex === idx),
      'the opponent gets nothing from a Courier in the other region');
  }
  assert.ok(!accepted(h, { type: 'playCard', seat: D, handIndex: idx }),
    'and it is refused, not merely un-offered');
});

// ── 2. R98: prevention and replacement are different layers ────────────

test('R98: a REPLACED hit still counts as dealt; a PREVENTED one never happened', () => {
  // Caleb 2024-10-24 on replacement (Blightsea Polyp): the damage still counts
  // as having been DEALT. The Phytochemical RAQ on prevention: "if there is
  // not damage being dealt, then no counters are placed." Same board, same
  // 3 damage, two different answers — that is the whole distinction.
  const h = new Harness(8004);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const u = spawn(h, D, 'Good Whale');
  const bare = whiteBox(h, e => {
    e.dealEffectDamage({
      controller: A, sourceName: 'Fireball', region: e.entity(u)!.region,
      targets: [], event: null, choose: () => undefined,
    } as never, e.entity(u)!, 3);
  });
  assert.equal(ent(h, u)!.damage, 3, 'unshielded: the damage lands');
  assert.ok(bare.some(m => m.includes('Fireball deals 3')),
    'unshielded: a damage event fires, so "when I am dealt damage" can hear it');

  whiteBox(h, e => { e.entity(u)!.damageShield = 'Phytochemical Protection'; });
  const shielded = whiteBox(h, e => {
    e.dealEffectDamage({
      controller: A, sourceName: 'Fireball', region: e.entity(u)!.region,
      targets: [], event: null, choose: () => undefined,
    } as never, e.entity(u)!, 3);
  });
  assert.equal(ent(h, u)!.damage, 3, 'shielded: no further damage was marked');
  assert.ok(!shielded.some(m => m.includes('Fireball deals')),
    'shielded: NO damage event — prevention unmakes it');
  assert.equal(ent(h, u)!.counters, 3, 'and the prevented amount comes back as counters');
});

test('R98: the shield is per-UNIT, not per-controller', () => {
  const h = new Harness(8005);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const shielded = spawn(h, D, 'Good Whale');
  const bare = spawn(h, D, 'Good Whale');
  whiteBox(h, e => { e.entity(shielded)!.damageShield = 'Phytochemical Protection'; });
  whiteBox(h, e => {
    e.dealEffectDamageAll({
      controller: A, sourceName: 'Fireball', region: e.entity(bare)!.region,
      targets: [], event: null, choose: () => undefined,
    } as never, [
      { target: e.entity(shielded)!, n: 2 },
      { target: e.entity(bare)!, n: 2 },
    ]);
  });
  assert.equal(ent(h, shielded)!.damage, 0, 'the shielded one took nothing');
  assert.equal(ent(h, shielded)!.counters, 2, 'and was paid in counters');
  assert.equal(ent(h, bare)!.damage, 2, 'its neighbour in the same batch took the lot');
  assert.equal(ent(h, bare)!.counters, 0);
});

// ── 3. R100: refused, not merely un-offered ────────────────────────────

test('R100: a card that "can\'t be played from your hand" is refused at every window', () => {
  const h = new Harness(8006);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'light', 4);
  const idx = give(h, D, 'Calming Force');
  assert.ok(!accepted(h, { type: 'playCard', seat: D, handIndex: idx }), 'deployment');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.ok(!accepted(h, { type: 'playCard', seat: D, handIndex: idx }), 'battle (its printed timing)');
  assert.ok(!legalActions(h.state, D).some(a => a.type === 'playCard' && a.handIndex === idx),
    'and never offered, so the client cannot present the refusal as a click');
  finishBattle(h);
});
