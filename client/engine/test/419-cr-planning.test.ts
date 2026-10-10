/**
 * Comprehensive rules, unit U08 (the turn, planning, resource, draw and draft, haste) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U08
 * (data/comprehensive-rules/build/probes/U08/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U08.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The four tests titled "engine differs" are the exception: their rules state
 * printed law and carry an engineDiffers mark, and these tests pin the
 * divergence the mark describes. They are deliberately NOT listed in those
 * rules' sources. When one goes red the engine has been brought in line with
 * print: drop the engineDiffers mark and the test, and bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { IllegalAction } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import type { CardName, Seat } from '../src/types.ts';
import {
  effStats, ent, give, giveResources, handIdx, skipHasteStep, spawn, toDeployment, unitsOf,
} from './util.ts';

/** a draft commit that keeps the hand exactly (the pack cards go back as dealt) */
function noopCommit(h: Harness, seat: Seat): void {
  const H = h.state.players[seat]!.hand.length;
  h.do({ type: 'draftCommit', seat, packIndices: h.state.packs[seat]!.map((_, i) => H + i) });
}

const constructed = (seed = 808): Harness => new Harness(seed, undefined, 'constructed', undefined,
  [DECK_LIST.slice(0, 30) as CardName[], DECK_LIST.slice(30, 60) as CardName[]]);

/* ---------- the turn ---------- */

test('cr:turn.general.next-turn — the initiative passes to the other player at the turn flip, and turn 2 opens in planning with the draft step open', () => {
  const h = new Harness(80803, undefined, 'draft');
  const it1 = h.state.initiative;
  noopCommit(h, 0); noopCommit(h, 1);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, 2);
  assert.equal(h.state.initiative, 1 - it1);
  assert.equal(h.state.phase, 'planning');
  assert.deepEqual(h.state.draftDone, [false, false]);
});

test('cr:turn.general.interactive — planning and deployment give nobody priority; the battle phase does once an attack is declared', () => {
  const p = new Harness(80808);
  assert.equal(p.state.priority, null, 'no priority in the resource step');
  for (const s of [0, 1] as Seat[]) assert.ok(!p.legal(s).some(a => a.type === 'passPriority'), 'no pass in planning');
  const d = new Harness(80808);
  toDeployment(d);
  assert.equal(d.state.phase, 'deploy');
  assert.equal(d.state.priority, null, 'no priority in deployment');
  for (const s of [0, 1] as Seat[]) assert.ok(!d.legal(s).some(a => a.type === 'passPriority'), 'no pass in deployment');
  const b = new Harness(80808);
  const it = b.state.initiative;
  spawn(b, it, 'Nebula Drifter');
  b.do({ type: 'donePlanning', seat: 0 });
  b.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(b);
  assert.equal(b.state.phase, 'battle');
  b.do({ type: 'declareAttack', seat: it, columns: [[1]] });
  assert.equal(b.state.priority, it, 'battle: the attacking player now holds priority');
  assert.ok(b.legal(it).some(a => a.type === 'passPriority'));
});

/* The probe for the next three: measured on the engine, which runs the
 * resource and haste steps as a hidden simultaneous segment, per seat. */
function nonInitiativeActsFirst(): void {
  const h = new Harness(80811);
  const it = h.state.initiative, nit = (1 - it) as Seat;
  h.do({ type: 'activateResource', seat: nit, index: 0 });     // NIT acts before IT has done anything
  h.do({ type: 'donePlanning', seat: nit });
  h.do({ type: 'donePlanning', seat: it });
  give(h, nit, 'Tidal Menace');
  giveResources(h, nit, 'water', 3);
  h.do({ type: 'playCard', seat: nit, handIndex: handIdx(h, nit, 'Tidal Menace') });
  assert.ok(unitsOf(h, nit).some(u => u.card === 'Tidal Menace'), 'NIT played a haste card before IT finished the step');
  assert.equal(h.state.hasteDone![it], false);
}

test('cr:turn.general.initiative — engine differs: the non-initiative player may act first in the resource and haste steps', nonInitiativeActsFirst);

test('cr:turn.planning.order — engine differs: the non-initiative player may act first in the resource and haste steps', nonInitiativeActsFirst);

test('cr:turn.general.global — engine differs: a player who has drafted may act in and finish the resource step while the other still drafts', () => {
  const h = new Harness(80810, undefined, 'draft');
  noopCommit(h, 0);
  assert.deepEqual(h.state.draftDone, [true, false], 'seat 1 has not finished the draft step');
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  h.do({ type: 'donePlanning', seat: 0 });
  assert.equal(h.state.planningDone[0], true, 'seat 0 finished its resource step before the draft step ended');
});

test('cr:turn.planning.order.sync — engine differs: a seat that finished the draft step creates and activates resources while the other seat still drafts', () => {
  const h = new Harness(80833, undefined, 'draft');
  noopCommit(h, 0);
  assert.deepEqual(h.state.draftDone, [true, false]);
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: h.state.elements[0]! });
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  h.do({ type: 'donePlanning', seat: 0 });
  assert.equal(h.state.planningDone[0], true, 'seat 0 finished its resource step before the draft step ended for all');
  assert.equal(h.state.draftDone![1], false, 'seat 1 is still drafting');
  assert.throws(() => h.do({ type: 'activateResource', seat: 1, index: 0 }), IllegalAction, 'the drafting seat itself is gated');
});

/* ---------- planning: no interaction ---------- */

test('cr:turn.planning.no-interaction — nobody holds priority in the resource step, and passing priority there is refused', () => {
  const h = new Harness(80808);
  assert.equal(h.state.priority, null);
  assert.ok(!h.legal(0).some(a => a.type === 'passPriority'), 'passPriority is not on the menu in planning');
  assert.throws(() => h.do({ type: 'passPriority', seat: 0 }), IllegalAction);
});

/* ---------- the resource step ---------- */

test('cr:turn.resource.actions.create — five resources created in one resource step, each entering dormant', () => {
  const h = new Harness(80812);
  const n0 = h.state.players[0]!.resources.length;
  for (let i = 0; i < 5; i++) h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' });
  assert.equal(h.state.players[0]!.resources.length, n0 + 5);
  assert.ok(h.state.players[0]!.resources.slice(n0).every(r => r.state === 'dormant'));
});

test('cr:turn.resource.ends — one player finishing does not end the resource step; the haste step opens only when every player is done', () => {
  const h = new Harness(80821);
  assert.equal(h.state.hasteDone, null, 'resource step');
  h.do({ type: 'donePlanning', seat: 0 });
  assert.equal(h.state.hasteDone, null, 'still the resource step: seat 1 has not finished');
  h.do({ type: 'activateResource', seat: 1, index: 0 });   // seat 1 may still activate
  h.do({ type: 'donePlanning', seat: 1 });
  assert.deepEqual(h.state.hasteDone, [false, false], 'the haste step opens once both are done');
});

/* ---------- draw and draft ---------- */

test('cr:turn.draw.draw.order — turn draws come off the shared deck clockwise from the initiative player', () => {
  const h = new Harness(80802, undefined, 'draft');
  noopCommit(h, 0); noopCommit(h, 1);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  const deckTop = h.state.sharedDeck.slice(0, 4);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // turn 2 starts here
  assert.equal(h.state.turn, 2);
  const it = h.state.initiative, nit = (1 - it) as Seat;
  assert.deepEqual(h.state.players[it]!.hand.slice(-2), deckTop.slice(0, 2), 'the initiative player draws first');
  assert.deepEqual(h.state.players[nit]!.hand.slice(-2), deckTop.slice(2, 4), 'then the next seat');
});

test('cr:turn.draw.draft.free — a player may exchange the whole hand for pack cards', () => {
  const h = new Harness(80801, undefined, 'draft');
  const hand = [...h.state.players[0]!.hand];
  const pack = [...h.state.packs[0]!];
  // pile = hand (0..5) + pack (6..15): all six hand cards and pack cards 0..3 go back
  h.do({ type: 'draftCommit', seat: 0, packIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  assert.deepEqual(h.state.players[0]!.hand, pack.slice(4), 'the new hand is six pack cards');
  assert.ok(hand.every(c => h.state.packs[0]!.includes(c)), 'every old hand card is in the pack');
  assert.equal(h.state.packs[0]!.length, 10);
});

test('cr:turn.draw.constructed.first-turn — turn 1 of constructed: the 4 are already drawn, the recycle of 2 is owed, and nothing more is drawn after it', () => {
  const h = constructed();
  assert.equal(h.state.players[0]!.hand.length, 8, 'opening 4 plus the 4 of the draw step');
  assert.equal(h.state.decks![0]!.length, 22, '30 less the 8 drawn');
  assert.deepEqual(h.state.bottomDone, [false, false], 'with the recycle of 2 still owed');
  h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  assert.equal(h.state.players[0]!.hand.length, 6);
  assert.equal(h.state.decks![0]!.length, 22, 'nothing more is drawn after the recycle');
});

test('cr:turn.draw.state-checks — in a live draft the turn draw that zeroes a Dreadspawn Horror kills it before the draft', () => {
  const h = new Harness(80809, undefined, 'draft');
  noopCommit(h, 0); noopCommit(h, 1);
  toDeployment(h);
  h.state.players[0]!.hand = h.state.players[0]!.hand.slice(0, 3);
  const id = spawn(h, 0, 'Dreadspawn Horror');
  assert.deepEqual(effStats(h, id), [4, 2], '3 cards in hand');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // turn 2: draws 2, so 5 cards
  assert.equal(h.state.turn, 2);
  assert.equal(h.state.players[0]!.hand.length, 5);
  assert.ok(h.state.draftDone && !h.state.draftDone[0], 'the draft step is still open');
  assert.equal(ent(h, id), undefined, 'dead before any draft commit');
});

/* ---------- the haste step ---------- */

test('cr:turn.haste.immediate — a haste play leaves nothing on the stack and gives nobody priority', () => {
  const h = new Harness(80808);
  give(h, 0, 'Molten Upheaval');
  giveResources(h, 0, 'fire', 1);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'playCard', seat: 0, handIndex: handIdx(h, 0, 'Molten Upheaval') });
  assert.equal(h.state.stack.length, 0, 'nothing waits on a stack');
  assert.equal(h.state.priority, null, 'and nobody holds priority');
  assert.ok(!h.legal(1).some(a => a.type === 'passPriority'), 'the opponent has no response window');
});

test('cr:turn.haste.ends — one player finishing does not end the haste step; both must', () => {
  const h = new Harness(80805);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.deepEqual(h.state.hasteDone, [false, false]);
  h.do({ type: 'doneHaste', seat: 0 });
  assert.equal(h.state.phase, 'planning', 'still the haste step');
  assert.deepEqual(h.state.hasteDone, [true, false]);
  h.do({ type: 'doneHaste', seat: 1 });
  assert.equal(h.state.phase, 'battle');
});

test('cr:turn.haste.always.no-auto-done — a player holding nothing playable is not marked done and may stay in the step', () => {
  const h = new Harness(80806);
  h.state.players[1]!.hand = ['Monke'];                // {Battle}: nothing playable at haste timing
  give(h, 0, 'Tidal Menace');
  giveResources(h, 0, 'water', 3);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.deepEqual(h.state.hasteDone, [false, false], 'nobody pre-marked done');
  assert.deepEqual(h.legal(1).map(a => a.type), ['doneHaste'], 'the empty-handed player is offered only done');
  h.do({ type: 'playCard', seat: 0, handIndex: handIdx(h, 0, 'Tidal Menace') });
  h.do({ type: 'doneHaste', seat: 0 });
  assert.equal(h.state.phase, 'planning', 'the step waits for the player with nothing');
  assert.equal(h.state.hasteDone![1], false);
});

test('cr:turn.haste.end-event — endOfHaste fires exactly once, before battle, in a step where nothing was played', () => {
  const h = new Harness(80807);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.events.filter(e => e.type === 'endOfHaste').length, 0);
  h.do({ type: 'doneHaste', seat: 0 });
  assert.equal(h.events.filter(e => e.type === 'endOfHaste').length, 0, 'not on the first done');
  h.do({ type: 'doneHaste', seat: 1 });
  const idxEnd = h.events.findIndex(e => e.type === 'endOfHaste');
  assert.equal(h.events.filter(e => e.type === 'endOfHaste').length, 1, 'exactly once');
  const idxBattle = h.events.findIndex((e, i) => i > idxEnd && e.type === 'phase');
  assert.ok(idxBattle > idxEnd, 'the battle phase opens after it');
  assert.equal(h.state.phase, 'battle');
});

test('cr:turn.haste.grants.each-turn — two Dispatch Couriers fund two haste-step plays, and a third is refused', () => {
  const h = new Harness(80804);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'metal', 8);
  give(h, A, 'Nebula Drifter');
  give(h, A, 'Nebula Drifter');
  give(h, A, 'Nebula Drifter');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Nebula Drifter') });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Nebula Drifter') });   // accepted: the second play
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Nebula Drifter').length, 2, 'two plays under two Couriers');
  assert.throws(() => h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Nebula Drifter') }),
    IllegalAction, 'and a third is refused');
});

test('cr:turn.haste.mods — a Haste card with Augment may be played in the haste step but not applied as a mod there', () => {
  const h = new Harness(80813);
  const A: Seat = 0;
  const host = spawn(h, A, 'Nebula Drifter');
  giveResources(h, A, 'light', 4);
  give(h, A, 'The Everywhere');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const idx = handIdx(h, A, 'The Everywhere');
  assert.ok(!h.legal(A).some(a => a.type === 'augment'), 'no augment offered in the haste step');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: host }), IllegalAction);
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.handIndex === idx), 'but the card itself is playable');
});

test('cr:turn.haste.mods — the same Haste augment is offered as a mod in deployment', () => {
  const h = new Harness(80813);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Nebula Drifter');
  giveResources(h, A, 'light', 4);
  const idx = give(h, A, 'The Everywhere');
  assert.ok(h.legal(A).some(a => a.type === 'augment' && (a as { index?: number }).index === idx
    && (a as { hostId?: number }).hostId === host), 'deployment: the augment is offered');
});

/* ---------- the turn's phases, the planning steps, the resource step ---------- */

test('cr:turn.general.phases — one turn runs planning, battle, regroup, deployment, then the next turn opens in planning', () => {
  const h = new Harness(80814);
  assert.equal(h.state.phase, 'planning');
  const from = h.events.length;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.state.phase, 'planning', 'the haste step is still planning');
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  const ev = h.events.slice(from);
  const battleAt = ev.findIndex(e => e.type === 'phase' && e.msg.startsWith('Battle:'));
  const regroupAt = ev.findIndex(e => e.type === 'regroup');
  const deployAt = ev.findIndex(e => e.type === 'phase' && e.msg.startsWith('Deployment:'));
  assert.ok(battleAt >= 0 && regroupAt > battleAt && deployAt > regroupAt, 'battle, then regroup, then deployment');
  const turn = h.state.turn;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, turn + 1);
  assert.equal(h.state.phase, 'planning', 'deployment is the last phase: the next turn starts in planning');
});

test('cr:turn.planning.what — a turn opens in planning, where the only actions are curating the hand and preparing resources', () => {
  const h = new Harness(80815, undefined, 'draft');
  assert.equal(h.state.phase, 'planning');
  assert.deepEqual([...new Set(h.legal(0).map(a => a.type))], ['draftCommit'], 'the hand is curated first');
  noopCommit(h, 0);
  const kinds = new Set(h.legal(0).map(a => a.type));
  assert.deepEqual([...kinds].sort(), ['activateResource', 'donePlanning', 'recycleForResource'],
    'then only resource actions and done');
});

test('cr:turn.planning.steps — refresh and draw at the turn start, then the draft, then resources, then the haste step', () => {
  const h = new Harness(80816, undefined, 'draft');
  noopCommit(h, 0); noopCommit(h, 1);
  toDeployment(h);
  giveResources(h, 0, 'fire', 2, 'expended');
  const hand0 = h.state.players[0]!.hand.length;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, 2);
  // 1 refresh
  assert.ok(!h.state.players[0]!.resources.some(r => r.state === 'expended'), 'expended resources refreshed');
  // 2 draw
  assert.equal(h.state.players[0]!.hand.length, hand0 + 2, 'two cards drawn');
  // 3 draft: open, and resource actions wait for it
  assert.equal(h.state.draftDone![0], false, 'the draft step is open');
  assert.ok(!h.legal(0).some(a => a.type === 'activateResource' || a.type === 'recycleForResource'));
  assert.throws(() => h.do({ type: 'donePlanning', seat: 0 }), IllegalAction);
  noopCommit(h, 0); noopCommit(h, 1);
  // 4 resource step
  assert.ok(h.legal(0).some(a => a.type === 'recycleForResource'), 'the resource step follows the draft');
  assert.equal(h.state.hasteDone, null, 'no haste step yet');
  give(h, 0, 'Molten Upheaval');
  giveResources(h, 0, 'fire', 1);
  assert.ok(!h.legal(0).some(a => a.type === 'playCard'), 'no haste play during the resource step');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  // 5 haste step
  assert.deepEqual(h.state.hasteDone, [false, false], 'the haste step comes last');
  assert.equal(h.state.phase, 'planning');
  assert.ok(h.legal(0).some(a => a.type === 'playCard' && a.handIndex === handIdx(h, 0, 'Molten Upheaval')));
});

test('cr:turn.planning.steps.draft — in constructed the draft step adds a draw of 2 to the draw step, and then 2 cards are recycled', () => {
  const h = constructed(80817);
  h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  h.do({ type: 'bottomCards', seat: 1, handIndices: [0, 1] });
  toDeployment(h);
  const hand0 = h.state.players[0]!.hand.length;
  const deck0 = h.state.decks![0]!.length;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, 2);
  assert.equal(h.state.players[0]!.hand.length, hand0 + 4, '2 for the draw step and 2 for the draft step');
  assert.equal(h.state.decks![0]!.length, deck0 - 4);
  assert.equal(h.state.bottomDone![0], false, 'the recycle of 2 is owed');
  const bottom = h.state.players[0]!.hand.slice(0, 2);
  h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  assert.equal(h.state.players[0]!.hand.length, hand0 + 2, 'net: 2 cards gained');
  assert.deepEqual(h.state.recycled![0]!.slice(-2), bottom, 'the 2 are recycled');
});

test('cr:turn.resource.what — resources are created and activated in the resource step and refused in the haste step', () => {
  const h = new Harness(80818);
  const n0 = h.state.players[0]!.resources.length;
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' });
  assert.equal(h.state.players[0]!.resources.length, n0 + 1, 'created');
  const dormant = h.state.players[0]!.resources.findIndex(r => r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: dormant });
  assert.notEqual(h.state.players[0]!.resources[dormant]!.state, 'dormant', 'activated');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step');
  assert.ok(!h.legal(0).some(a => a.type === 'recycleForResource' || a.type === 'activateResource'));
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }), IllegalAction);
  const d2 = h.state.players[0]!.resources.findIndex(r => r.state === 'dormant');
  if (d2 >= 0) assert.throws(() => h.do({ type: 'activateResource', seat: 0, index: d2 }), IllegalAction);
});

test('cr:turn.resource.actions — the resource step menu offers creating, activating and exchanging a Prismite', () => {
  const h = new Harness(80819);
  giveResources(h, 0, 'prismite', 1, 'open');
  const kinds = new Set(h.legal(0).map(a => a.type));
  for (const k of ['recycleForResource', 'activateResource', 'exchangePrismite'] as const) assert.ok(kinds.has(k), k);
});
