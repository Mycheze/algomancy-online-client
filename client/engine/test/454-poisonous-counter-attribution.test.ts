/* CR 708.8b, 802.18a — A POISONOUS HIT'S COUNTERS ARE PUT BY THE SEAT WHOSE UNIT DEALT IT.
 *
 * Reports #210 (Debeli) and #216 (the owner), room FFAH: Wandering Blightshell
 * ("When you put a counter on an enemy, [Switch1] Draw a card.") drew nothing
 * when Debeli's Poisonous unit's COMBAT damage put -1/-1 counters on an enemy
 * — twice in one game. Owner, #216: "all your stuff should count".
 *
 * Cause: `commitUnitDamage` called `addCounters(u, -received)` with no actor,
 * and combat damage is not a stack part, so the `partActor` fallback was null
 * and the event carried no `by`. Every "you put a counter" card was deaf to
 * it: Blightshell, Scrapyard Custodian, Flux Resonator ("by an allied
 * source"). The same seam, measured in saved games, left two other
 * placements actor-less: Skittering Blight's rot replacement and Phytochemical
 * Protection's "+1/+1 counter for each damage prevented".
 *
 * HOUSE RULES (120's): assertions on state and the event vocabulary, never on
 * log prose. Seeds 45400-45499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import {
  assignDefault, ent, give, giveResources, pass, pick, resolveAfterCombat, spawn, throughDamageWindows,
  toDeployment, toNextBattle, withE as whiteBox,
} from './util.ts';
import type { EngineEvent, Seat } from '../src/types.ts';

const handOf = (h: Harness, s: Seat): number => h.state.players[s]!.hand.length;
function during(h: Harness, fn: () => void): EngineEvent[] {
  const before = h.events.length;
  fn();
  return h.events.slice(before);
}
/** from blocks declared to the end of combat */
const fight = (h: Harness): void => { pass(h); pass(h); assignDefault(h); throughDamageWindows(h); resolveAfterCombat(h); };

test('Poisonous BLOCKER: its -1/-1 counters on the attacker are put by the defender, and Blightshell draws', () => {
  const h = new Harness(45401);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');              // 3/3
  const myc = spawn(h, D, 'Pestilent Mycelion');        // 1/3 {Poisonous}
  const shell = spawn(h, D, 'Wandering Blightshell');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [myc] } });
  assert.equal(ent(h, shell)!.region, h.state.battle!.region, 'Blightshell is present in the battle');
  const hand0 = handOf(h, D);
  const evs = during(h, () => fight(h));
  assert.equal(ent(h, atk)!.counters, -1, 'the poison counter landed on the enemy attacker');
  const cc = evs.filter(e => e.type === 'countersChanged' && e.data?.['unit'] === atk);
  assert.equal(cc.length, 1);
  assert.equal(cc[0]!.data?.['by'], D, 'CR 708.8b: put by the Poisonous unit\'s controller');
  assert.equal(handOf(h, D), hand0 + 1, 'Blightshell drew');
});

test('Poisonous ATTACKER: its -1/-1 counters on the blocker are put by the attacker, and Blightshell draws', () => {
  const h = new Harness(45402);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const myc = spawn(h, A, 'Pestilent Mycelion');
  const shell = spawn(h, A, 'Wandering Blightshell');
  const blk = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[myc], [shell]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const hand0 = handOf(h, A);
  const evs = during(h, () => fight(h));
  assert.equal(ent(h, blk)!.counters, -1, 'the poison counter landed on the blocker');
  const cc = evs.filter(e => e.type === 'countersChanged' && e.data?.['unit'] === blk);
  assert.equal(cc[0]!.data?.['by'], A, 'put by the attacking seat');
  assert.equal(handOf(h, A), hand0 + 1, 'Blightshell drew');
});

test('Flux Resonator: a Poisonous combat hit by your unit is an allied source, one counter more', () => {
  // CR 708.8a + 708.8b: "by an allied source" — your Poisonous unit's hit is
  // your placement, so 1 damage arrives as two -1/-1 counters.
  const h = new Harness(45403);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');              // 3/3
  const myc = spawn(h, D, 'Pestilent Mycelion');        // 1 power Poisonous
  spawn(h, D, 'Flux Resonator');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [myc] } });
  fight(h);
  assert.equal(ent(h, atk)?.counters, -2, '1 Poisonous damage, plus the allied Resonator\'s one');
});

test('Flux Resonator: an ENEMY Poisonous combat hit on your unit gets no extra counter', () => {
  // the other half of CR 708.8b — the counters land on MY unit but are not put by me
  const h = new Harness(45404);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, A, 'Flux Resonator');
  const myc = spawn(h, D, 'Pestilent Mycelion');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [myc] } });
  fight(h);
  assert.equal(ent(h, atk)?.counters, -1, 'exactly the one counter the enemy put');
});

test('Skittering Blight: the +1/+1 counters its rot replacement puts are put by its controller', () => {
  // replaceRotDamage runs at the start of deployment, outside any stack part,
  // so the placement had no actor and Scrapyard Custodian beside it was deaf
  const h = new Harness(45405);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const blight = spawn(h, A, 'Skittering Blight');
  const cust = spawn(h, A, 'Scrapyard Custodian');
  assert.equal(ent(h, blight)!.region, ent(h, cust)!.region);
  const c0 = ent(h, blight)!.counters;
  whiteBox(h, e => e.gainRot(A, 2));
  const hand0 = handOf(h, A);
  const evs = during(h, () => whiteBox(h, e => e.rotDamage()));
  assert.ok(ent(h, blight)!.counters > c0, 'the rot became +1/+1 counters on the Blight');
  const cc = evs.filter(e => e.type === 'countersChanged' && e.data?.['unit'] === blight);
  assert.equal(cc.length, 1);
  assert.equal(cc[0]!.data?.['by'], A, 'put by the Blight\'s controller');
  assert.equal(handOf(h, A), hand0 + 1, 'so Custodian draws: counters you put on an ally');
});

test('Phytochemical Protection: the +1/+1 counters for prevented COMBAT damage are put by its caster', () => {
  const h = new Harness(45406);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const cust = spawn(h, A, 'Scrapyard Custodian');
  const blk = spawn(h, D, 'The Foretold');
  giveResources(h, A, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [cust]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Phytochemical Protection') });
  pick(h, { unit: atk });
  pass(h); pass(h);                                      // resolve the shield
  assert.equal(ent(h, atk)!.damageShield, 'Phytochemical Protection', 'the shield is on');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const hand0 = handOf(h, A);
  const evs = during(h, () => fight(h));
  assert.equal(ent(h, atk)!.counters, 3, 'three damage prevented, three +1/+1 counters');
  const cc = evs.filter(e => e.type === 'countersChanged' && e.data?.['unit'] === atk);
  assert.equal(cc[0]!.data?.['by'], A, 'put by the shield caster — not by nobody, not by the dealer');
  assert.equal(handOf(h, A), hand0 + 1, 'so Custodian draws');
});
