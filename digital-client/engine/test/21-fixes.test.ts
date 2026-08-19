/* Fixes from the first live human playtest (2026-08-18):
 *  - the round-2 FRESH attack (initiative player had nothing in round 1) —
 *    units attack out of their home region and travel ("that unit is in
 *    another region" regression)
 *  - forcedAction(): empty boards attack/block by themselves
 *  - Shards (Manual p.18): activating an element resource at ≥3 affinity
 *    grants a free dormant Shard; shards give mana but no affinity
 *  - game-element restriction: no wood/metal resources in a fwe draft
 *  - simultaneous deployment (house rule): both seats deploy at once
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ALL_ELEMENTS, forcedAction, IllegalAction, legalActions } from '../src/apply.ts';
import { give, giveResources, skipHasteStep, spawn, unitsOf } from './util.ts';
import type { Seat } from '../src/types.ts';

/** into battle with pinned initiative */
function toBattle(h: Harness, initiative: Seat): void {
  h.state.initiative = initiative;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
}

// ── the major one: fresh round-2 attack ───────────────────────────────

test('REGRESSION: NIT can attack in round 2 when IT had no units in round 1', () => {
  const h = new Harness(2100);
  const it: Seat = 0, nit: Seat = 1;
  const u = spawn(h, nit, 'Ignis Sprite');   // only the NON-initiative player has a unit
  toBattle(h, it);
  // IT has nothing: the forced empty declare is what the server would submit
  const f1 = forcedAction(h.state);
  assert.deepEqual(f1, { type: 'declareAttack', seat: it, columns: [] });
  h.do(f1!);
  // round 2: NIT attacks FRESH from home — this used to throw
  // "that unit is in another region"
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attacker, nit);
  const legal = legalActions(h.state, nit);
  assert.ok(legal.some(a => a.type === 'declareAttack' && a.columns.length === 1),
    'legalActions offers the fresh round-2 attack');
  h.do({ type: 'declareAttack', seat: nit, columns: [[u]] });
  // the unit traveled into IT's home region
  assert.equal(h.state.entities[u]!.region, h.q.homeRegion(it));
  // pass the attack window; then the defender (IT) has no blockers → forced
  const lifeBefore = h.state.players[it]!.life;
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  const f2 = forcedAction(h.state);
  assert.deepEqual(f2, { type: 'declareBlocks', seat: it, blocks: {} });
  h.do(f2!);
  // remaining windows → combat damage goes to IT's face
  let guard = 12;
  while (h.state.phase === 'battle' && guard-- > 0) {
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.ok(h.state.players[it]!.life < lifeBefore, 'combat damage landed');
});

test('round 2 after a real round-1 battle still restricts to the sent counterattackers', () => {
  const h = new Harness(2101);
  const it: Seat = 0, nit: Seat = 1;
  const atk = spawn(h, it, 'Ignis Sprite');
  const home = spawn(h, nit, 'Geode');      // stays home, does NOT get sent
  toBattle(h, it);
  h.do({ type: 'declareAttack', seat: it, columns: [[atk]] });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'declareBlocks', seat: nit, blocks: {} });   // no send
  // ... battle round 1 finishes; with no counterattackers sent, round 2 is skipped
  while (h.state.phase === 'battle' && h.state.battle?.round === 1) {
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.notEqual(h.state.phase, 'battle', 'no counterattackers → battle over');
  assert.ok(h.state.entities[home], 'home unit untouched');
});

// ── forcedAction ──────────────────────────────────────────────────────

test('forcedAction is null whenever a real choice exists', () => {
  const h = new Harness(2102);
  const it: Seat = 0;
  spawn(h, it, 'Ignis Sprite');
  toBattle(h, it);
  assert.equal(forcedAction(h.state), null, 'attacker with a unit chooses');
});

test('a whole empty-board battle drains through forced actions to deployment', () => {
  const h = new Harness(2103);
  toBattle(h, 0);
  let guard = 10;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const f = forcedAction(h.state);
    assert.ok(f, 'empty board must force its way through the battle');
    h.do(f);
  }
  assert.equal(h.state.phase, 'deploy');
});

// ── shards ────────────────────────────────────────────────────────────

test('activating the 3rd element resource grants a free dormant Shard (Manual p.18)', () => {
  const h = new Harness(2104);
  giveResources(h, 0, 'fire', 2, 'open');
  giveResources(h, 0, 'fire', 1, 'dormant');
  const idx = h.state.players[0]!.resources.findIndex(r => r.kind === 'fire' && r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: idx });
  const shards = h.state.players[0]!.resources.filter(r => r.kind === 'shard');
  assert.equal(shards.length, 1, 'one shard granted');
  assert.equal(shards[0]!.state, 'dormant', 'the shard arrives dormant');
  // a 4th activation at affinity 4 grants another
  giveResources(h, 0, 'fire', 1, 'dormant');
  const idx2 = h.state.players[0]!.resources.findIndex(r => r.kind === 'fire' && r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: idx2 });
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 2);
});

test('below 3 affinity no shard; shards give mana but never affinity', () => {
  const h = new Harness(2105);
  giveResources(h, 0, 'fire', 1, 'open');
  giveResources(h, 0, 'fire', 1, 'dormant');
  const idx = h.state.players[0]!.resources.findIndex(r => r.kind === 'fire' && r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: idx });   // affinity now 2
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 0);
  giveResources(h, 0, 'shard' as never, 3, 'open');
  assert.equal(h.q.affinity(0, 'fire'), 2, 'shards add no affinity');
  assert.ok(h.q.openMana(0) >= 5, 'shards are mana like any resource');
});

test('exchanging a Prismite into your 3rd element copy also grants the shard', () => {
  const h = new Harness(2106);
  giveResources(h, 0, 'water', 2, 'open');
  giveResources(h, 0, 'prismite', 1, 'open');
  const idx = h.state.players[0]!.resources.findIndex(r => r.kind === 'prismite' && r.state === 'open');
  h.do({ type: 'exchangePrismite', seat: 0, index: idx, element: 'water' });
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 1);
});

// ── game elements ─────────────────────────────────────────────────────

test('a fwe draft game refuses wood/metal resources and never offers them', () => {
  const h = new Harness(2107, undefined, 'draft');
  const H = h.state.players[0]!.hand.length;
  h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'wood' }), IllegalAction);
  const els = new Set(legalActions(h.state, 0)
    .filter(a => a.type === 'recycleForResource')
    .map(a => (a as { element: string }).element));
  assert.deepEqual([...els].sort(), ['earth', 'fire', 'water']);
  // shared games still offer every element (7 since Light & Dark)
  const shared = new Harness(2107);
  const els2 = new Set(legalActions(shared.state, 0)
    .filter(a => a.type === 'recycleForResource')
    .map(a => (a as { element: string }).element));
  assert.deepEqual([...els2].sort(), [...ALL_ELEMENTS].sort());
  assert.equal(els2.size, ALL_ELEMENTS.length);
});

// ── simultaneous deployment ───────────────────────────────────────────

test('both seats deploy at once: NIT may act and finish before IT', () => {
  const h = new Harness(2108);
  toBattle(h, 0);
  h.do({ type: 'declareAttack', seat: 0, columns: [] });
  h.do({ type: 'declareAttack', seat: 1, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  assert.deepEqual(h.state.deployDone, [false, false]);
  const nit: Seat = 1;
  // NIT plays a card FIRST (was impossible under sequential deployment)
  giveResources(h, nit, 'fire', 1, 'open');
  const i = give(h, nit, 'Ignis Sprite');
  h.do({ type: 'playCard', seat: nit, handIndex: i });
  assert.equal(unitsOf(h, nit).length, 1);
  // NIT finishes before IT — fine; turn only ends when both are done
  h.do({ type: 'doneDeploying', seat: nit });
  assert.equal(h.state.phase, 'deploy');
  assert.throws(() => h.do({ type: 'doneDeploying', seat: nit }), IllegalAction);
  const turn = h.state.turn;
  h.do({ type: 'doneDeploying', seat: 0 });
  assert.equal(h.state.turn, turn + 1, 'both done → next turn');
});

// ── Swift trigger timing (R3 sub-step drain) ──────────────────────────

test('Flowstone Arcanite: Swift-step counters land BEFORE normal combat damage', () => {
  const h = new Harness(2110);
  const A: Seat = 0, D: Seat = 1;
  h.state.initiative = A;
  const arc = spawn(h, A, 'Flowstone Arcanite');   // {Swift} 1/3
  const ally = spawn(h, A, 'Unit Token');          // 1/1 — becomes 2/2 mid-combat
  const blocker = spawn(h, D, 'Unit Token');       // 1/1 — blocks the ally
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: A, columns: [[arc], [ally]] });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blocker] } });
  let guard = 12;
  while (h.state.phase === 'battle' && guard-- > 0) {
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  // Swift: the Arcanite hits the player → trigger resolves at once → the ally
  // is a 2/2 when NORMAL damage happens: it kills the 1/1 blocker and lives.
  assert.equal(h.state.entities[ally]!.counters, 1, 'the ally got its counter mid-combat');
  assert.ok(h.state.entities[ally], 'the buffed 2/2 survived the 1/1 blocker');
  assert.ok(!h.state.entities[blocker], 'the blocker died to the buffed 2 power');
});

// ── multi-target casts ────────────────────────────────────────────────

test('multi-target validation: no duplicate targets, done only after the minimum', () => {
  const h = new Harness(2111);
  const A: Seat = 0, D: Seat = 1;
  h.state.initiative = A;
  const u1 = spawn(h, A, 'Unit Token');
  const u2 = spawn(h, A, 'Bubb');
  giveResources(h, D, 'fire', 3);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: A, columns: [[u1], [u2]] });
  h.do({ type: 'passPriority', seat: A });
  const i = h.state.players[D]!.hand.push('Twin Flame') - 1;
  h.do({ type: 'playCard', seat: D, handIndex: i });
  const first = h.state.decision!;
  assert.ok(!first.options.some(o => o.label === 'No more targets'), 'no done before the min');
  h.do({ type: 'decide', seat: D, choice: 0 });
  const second = h.state.decision!;
  const firstVal = JSON.stringify(first.options[0]!.value);
  assert.ok(!second.options.some(o => JSON.stringify(o.value) === firstVal), 'no duplicate targets');
  assert.ok(second.options.some(o => o.label === 'No more targets'), 'done offered after the min');
  const done = second.options.findIndex(o => o.label === 'No more targets');
  h.do({ type: 'decide', seat: D, choice: done });   // stop at one target
  assert.equal(h.state.decision, null, 'cast complete with a single target');
});

test('legalActions OFFERS deploy plays to both seats at once (not just initiative)', () => {
  const h = new Harness(2112);
  h.state.initiative = 0;
  const nit: Seat = 1;   // the seat that was starved in the live game
  giveResources(h, nit, 'fire', 2);
  give(h, nit, 'Ignis Sprite');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: 0, columns: [] });
  h.do({ type: 'declareAttack', seat: 1, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.deployPlayer, 0, 'initiative marker points at seat 0');
  for (const seat of [0, 1] as Seat[]) {
    const legal = legalActions(h.state, seat);
    assert.ok(legal.some(a => a.type === 'doneDeploying'), `seat ${seat} can finish`);
  }
  const nitLegal = legalActions(h.state, nit);
  assert.ok(nitLegal.some(a => a.type === 'playCard'),
    'the NON-initiative seat is offered its affordable plays immediately');
  // and once done, no more offers
  h.do({ type: 'doneDeploying', seat: nit });
  assert.equal(legalActions(h.state, nit).length, 0, 'a done seat gets nothing');
  assert.ok(legalActions(h.state, 0).some(a => a.type === 'doneDeploying'), 'the other seat still acts');
});

test('deployPlayer stays a valid sequential marker for old drivers', () => {
  const h = new Harness(2109);
  toBattle(h, 1);
  h.do({ type: 'declareAttack', seat: 1, columns: [] });
  h.do({ type: 'declareAttack', seat: 0, columns: [] });
  assert.equal(h.state.deployPlayer, 1, 'initiative first');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.deployPlayer, 0, 'then the other seat');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.phase, 'planning');
});
