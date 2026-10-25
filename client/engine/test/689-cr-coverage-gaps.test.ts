/**
 * CR coverage gaps (CT-396, CT-397, CT-399, CT-400), 2026-10-25.
 *
 * Each of these rules was something the engine relied on and no comprehensive
 * rule stated. The rules are now drafted; these are the executed examples the
 * rules bind, for the cases no existing test demonstrated:
 *
 *   - a grafted part with a variable cost of its own uses the X paid for it;
 *   - a permission that states no number of uses (Slurpr) is not a count, and a
 *     second card granting it adds nothing;
 *   - a cost of gaining debt can be paid however much debt the player has;
 *   - Spell Excavation's permission covers the one copy it targeted, once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
  withE,
} from './util.ts';
import type { Seat } from '../src/types.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

/** answer a pending decision by label or value match */
function decide(h: Harness, match: (label: string, value: unknown) => boolean): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => match(String(o.label), o.value));
  assert.notEqual(idx, -1, `no option matching in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** finish deployment and planning, stopping inside the haste step after `setup` */
function intoHasteStep(h: Harness, setup: () => void): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  setup();
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
}

/** every mod action `seat` is offered right now, as `kind:zone:index->host` */
function modsOffered(h: Harness, seat: Seat): string[] {
  return legalActions(h.state, seat)
    .filter(a => a.type === 'augment' || a.type === 'graft')
    .map(a => {
      const m = a as { type: string; from: string; index: number; hostId?: number };
      return `${m.type}:${m.from}:${m.index}->${m.hostId}`;
    })
    .sort();
}

/** the bin indices `seat` is offered to play from right now */
function binPlaysOffered(h: Harness, seat: Seat): number[] {
  return legalActions(h.state, seat)
    .filter(a => a.type === 'playFromBin')
    .map(a => (a as { binIndex: number }).binIndex)
    .sort((x, y) => x - y);
}

// ── CT-396: a grafted part's variable cost sets that part's X ─────────────

test('CR 722.6c / CT-396: a grafted Discharge pays its own [Remove X +1/+1 counters] as the composite goes on the stack, and deals that X', () => {
  const h = new Harness(68901);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const host = spawn(h, A, 'Guardian of the Grotto');      // When I attack or block, [Switch] Your units gain +0/+1
  const ally = spawn(h, A, 'Unit Token');
  withE(h, e => { e.addCounters(e.entity(ally)!, 3); });
  const victim = spawn(h, D, 'Unit Token');
  withE(h, e => { e.addCounters(e.entity(victim)!, 5); });  // 6/6: survives what it is dealt
  giveResources(h, A, 'metal', 1);                          // Discharge: m / 1
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Discharge'), hostId: host, position: 0 });
  assert.equal(ent(h, host)!.mods.length, 1, 'setup: Discharge is grafted under the Guardian');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host], [ally]] });   // the ally fights too, so its counters are in reach
  // the grafted cost and the composite's target are both collected as it goes on the stack (CR 722.6b)
  pick(h, { counterFrom: ally });
  pick(h, { counterFrom: ally });
  pick(h, { doneCost: true });
  pick(h, { unit: victim });
  assert.equal(ent(h, ally)!.counters, 1, 'two counters were removed to pay the grafted cost');
  const item = h.state.stack.find(i => i.parts.some(p => p.costPaid?.x !== undefined));
  assert.ok(item, 'the composite is on the stack with a paid variable cost');
  const paid = item!.parts.find(p => p.costPaid?.x !== undefined)!;
  assert.equal(paid.costPaid!.x, 2, 'the grafted part carries X = 2, the amount paid for its own cost');
  const before = ent(h, victim)!.damage;
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage - before, 2, 'and the grafted part deals that X');
  finishBattle(h);
});

// ── CT-397: a permission with no count is not a number of uses ───────────

function slurprHaste(seed: number, slurprs: number): { h: Harness; A: Seat; host: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  for (let i = 0; i < slurprs; i++) spawn(h, A, 'Slurpr');
  const host = spawn(h, A, 'Rune Channeler');
  intoHasteStep(h, () => {
    h.state.players[A]!.hand.length = 0;
    h.state.players[D]!.hand.length = 0;
    giveResources(h, A, 'fire', 8);
    give(h, A, 'Ephemeral Skywalker');
    give(h, A, 'Ephemeral Skywalker');
  });
  return { h, A, host };
}

test('CR 707.10a / CT-397: under one Slurpr a player applies two mods in one haste step, and two Slurprs offer exactly what one does', () => {
  const one = slurprHaste(68902, 1);
  const two = slurprHaste(68902, 2);
  assert.equal(one.h.state.hasteDone![one.A], false, 'setup: the haste step is open for the Slurpr player');
  const onto = (x: { h: Harness; A: Seat; host: number }) => modsOffered(x.h, x.A).filter(m => m.endsWith(`->${x.host}`)).map(m => m.split('->')[0]);
  const offeredOne = onto(one);
  assert.equal(offeredOne.length, 2, 'one Slurpr: both augments in hand are offered onto the unit in the haste step');
  assert.deepEqual(onto(two), offeredOne, 'two Slurprs offer exactly the same mods onto that unit as one');

  const { h, A, host } = one;
  h.do({ type: 'augment', seat: A, from: 'hand', index: h.state.players[A]!.hand.indexOf('Ephemeral Skywalker'), hostId: host });
  assert.equal(onto({ h, A, host }).length, 1, 'after one mod, the second is still offered: the permission is not used up');
  h.do({ type: 'augment', seat: A, from: 'hand', index: h.state.players[A]!.hand.indexOf('Ephemeral Skywalker'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 2, 'both mods landed in the one haste step');
});

// ── CT-399: debt has no limit ────────────────────────────────────────────

test('CR 112.14d / CT-399: a player already carrying 40 debt can still pay the Gain 2 debt of Debt Blep', () => {
  const h = new Harness(68903);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const blep = spawn(h, A, 'Debt Blep');
  h.state.players[A]!.debt = 40;
  assert.ok(legalActions(h.state, A).some(a => a.type === 'activateAbility' && (a as { entityId: number }).entityId === blep),
    'the debt cost is offered whatever debt the player has');
  h.do({ type: 'activateAbility', seat: A, entityId: blep, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.debt, 42, 'the debt is gained: 40 + 2');
  assert.deepEqual(effStats(h, blep), [4, 4], 'and the ability resolved');
});

// ── CT-400: Spell Excavation's permission is for one copy, once ──────────

test('CR 405.9b / CT-400: Spell Excavation lets its caster play the card it targeted once, and no other spell in the bin; a second copy of that card is not playable after the first', () => {
  const h = new Harness(68904);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Curio Drifter');
  h.state.players[D]!.bin.push('Luminous Arc', 'Luminous Arc', 'Arc Lightning');
  giveResources(h, D, 'water', 2);                          // Excavation: bb / 1
  giveResources(h, D, 'fire', 8);                           // enough for two Arcs and an Arc Lightning
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.deepEqual(binPlaysOffered(h, D), [], 'no bin play before the permission');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spell Excavation') });
  decide(h, l => l.startsWith('Luminous Arc'));
  pass(h); pass(h);                                         // the Excavation resolves
  if (h.state.priority !== D) pass(h);
  const offered = binPlaysOffered(h, D);
  assert.ok(offered.length > 0, 'the targeted card may now be played from the bin');
  assert.ok(offered.every(i => h.state.players[D]!.bin[i] === 'Luminous Arc'),
    `only Luminous Arc is covered, not the other spell in the bin (offered: ${offered})`);
  h.do({ type: 'playFromBin', seat: D, binIndex: offered[0]! });
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.bin.filter(c => c === 'Luminous Arc').length, 1, 'the other copy is still in the bin');
  if (h.state.battle && h.state.priority !== D) pass(h);
  assert.deepEqual(binPlaysOffered(h, D), [], 'and the permission is used up: neither the other copy nor any other spell is offered');
  finishBattle(h);
});
