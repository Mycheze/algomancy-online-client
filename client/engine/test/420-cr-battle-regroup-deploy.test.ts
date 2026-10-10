/**
 * Comprehensive rules, unit U09 (battle phase overview, regroup, deployment, initiative) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U09
 * (data/comprehensive-rules/build/probes/U09/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U09.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { IllegalAction, legalActions } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, skipHasteStep, spawn, toDeployment,
  toNextBattle, withE,
} from './util.ts';

/** a draft commit that keeps the hand exactly (the pack cards go back as dealt) */
function noopCommit(h: Harness, seat: Seat): void {
  const H = h.state.players[seat]!.hand.length;
  h.do({ type: 'draftCommit', seat, packIndices: h.state.packs[seat]!.map((_, i) => H + i) });
}

/* ---------- the battle phase: regions, rounds, steps ---------- */

function regionPerRound(): void {
  const h = new Harness(90903);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  const counter = spawn(h, D, 'Rune Channeler');
  toNextBattle(h, A);
  const e = new E(h.state);
  assert.equal(h.state.battle!.round, 1);
  assert.equal(h.state.battle!.region, e.homeRegion(D), 'round 1 is fought in the non-initiative home region');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [counter] });
  pass(h); pass(h); pass(h); pass(h);
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.region, e.homeRegion(A), 'round 2 is fought in the initiative home region');
}

test('cr:turn.battle.region-order.one-v-one — round 1 is fought in the non-initiative home region, round 2 in the initiative home region', regionPerRound);

test('cr:turn.battle.region-order.clockwise — in 1v1 the initiative player home region is fought last, in round 2', regionPerRound);

function roundOneSteps(): void {
  const h = new Harness(90901);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Rune Channeler');
  const blk = spawn(h, D, 'Rune Channeler');
  toNextBattle(h, A);
  const steps: string[] = [h.state.battle!.step];
  assert.equal(h.state.battle!.region, new E(h.state).homeRegion(D), 'round 1 is fought in the non-initiative region');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  steps.push(h.state.battle!.step);
  pass(h); pass(h);
  steps.push(h.state.battle!.step);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  steps.push(h.state.battle!.step);
  pass(h); pass(h);
  steps.push(h.state.battle!.step);
  assert.deepEqual(steps, ['declare', 'attackWindow', 'blocks', 'blockWindow', 'afterWindow']);
}

test('cr:turn.battle.rounds.round-1 — round 1 walks declare, attack window, blocks, block window, then the after-combat window, in the non-initiative region', roundOneSteps);

test('cr:turn.battle.steps — a battle round steps through declare, attack window, blocks, block window, then the after-combat window', roundOneSteps);

test('cr:turn.battle.rounds.round-1 — combat damage is simultaneous: a 4/3 attacker and a 4/3 blocker both die', () => {
  const h = new Harness(90902);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Rune Channeler');   // 4/3
  const blk = spawn(h, D, 'Rune Channeler');   // 4/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  assert.ok(!ent(h, blk), 'blocker died');
  assert.ok(!ent(h, atk), 'attacker also died: the blocker dealt its damage although it died in the same step');
});

test('cr:turn.battle.rounds.one-attack-each — in round 2 the initiative player cannot send units out to counterattack, and the battle phase ends after round 2', () => {
  const h = new Harness(90904);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  const homeA = spawn(h, A, 'Rune Channeler');
  const counter = spawn(h, D, 'Rune Channeler');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [counter] });
  pass(h); pass(h); pass(h); pass(h);
  assert.equal(h.state.battle!.round, 2);
  h.do({ type: 'declareAttack', seat: D, columns: [[counter]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: A, blocks: {}, send: [homeA] }), IllegalAction,
    'no counter-counterattack');
  assert.ok(!legalActions(h.state, A).some(a => a.type === 'declareBlocks' && (a as { send?: number[] }).send?.length),
    'and legalActions offers no send');
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  pass(h); pass(h); pass(h); pass(h);
  assert.equal(h.state.phase, 'deploy', 'after round 2 the battle phase is over');
});

/* ---------- regroup ---------- */

test('cr:turn.regroup.what-it-is.no-actions — the last after-combat pass lands straight in deployment, with nobody holding priority', () => {
  const h = new Harness(90909);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  pass(h);
  const evs = h.do({ type: 'passPriority', seat: h.state.priority! });   // last after-combat pass (no round 2)
  assert.ok(evs.some(e => e.type === 'regroup'), 'regroup happened inside this one action');
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.priority, null);
});

test('cr:turn.regroup.what-it-is.before-deployment — an Overbloom buff from deployment is still on during the next battle and gone after its regroup', () => {
  const h = new Harness(90908);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const tok = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'wood', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Overbloom') });
  pick(h, { unit: tok });
  toNextBattle(h);
  assert.equal(h.state.phase, 'battle');
  assert.deepEqual(effStats(h, tok), [8, 8], 'still +7/+7 in the next battle');
  finishBattle(h);
  assert.deepEqual(effStats(h, tok), [1, 1]);
});

test('cr:turn.regroup.sequence.return — a unit token created in the enemy region does not stay there, it walks home at regroup', () => {
  const h = new Harness(90910);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  let made = -1;
  { const g = new E(h.state); made = g.spawnUnit(A, 'Unit Token', region, { token: true } as never).id; h.state = g.s; }
  assert.equal(ent(h, made)!.region, new E(h.state).homeRegion(D), 'created in the enemy region');
  finishBattle(h);
  assert.equal(ent(h, made)!.region, new E(h.state).homeRegion(A), 'back home after regroup');
});

/* ---------- deployment ---------- */

test('cr:turn.deploy.mods.graft-only — a graft of a Haste card is refused in the haste step when nothing grants it, not merely left unoffered', () => {
  const h = new Harness(90902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let host = -1;
  withE(h, e => { host = e.spawnUnit(A, 'Bellowing Boulder', e.homeRegion(A)).id; });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone && !h.state.hasteDone[A], 'haste step open');
  const idx = give(h, A, 'Molten Upheaval');
  giveResources(h, A, 'fire', 3);
  assert.throws(() => h.do({ type: 'graft', seat: A, from: 'hand', index: idx, hostId: host, position: 0 }),
    (err: unknown) => err instanceof IllegalAction && /grafting is a deployment action/.test(String((err as Error).message)));
});

/* ---------- the end of the turn and the initiative ---------- */

test('cr:turn.initiative.end-of-turn.no-responses — while an end-of-turn trigger is asking, no seat is offered a play and a play is refused', () => {
  const h = new Harness(9901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const walker = spawn(h, p, 'Mirage Walker');
  spawn(h, p, 'Conduit of Pain');
  giveResources(h, p, 'fire', 2);
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'General Smof'), hostId: walker, position: 0 });
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  for (const seat of [0, 1] as const) {
    giveResources(h, seat, 'fire', 3);
    give(h, seat, 'Ignis Sprite');
  }
  for (const seat of [0, 1] as const) if (!h.state.deployDone?.[seat]) h.do({ type: 'doneDeploying', seat });
  assert.ok(h.state.decision, 'the end-of-turn trigger is asking');
  assert.ok(h.state.turnEnding, 'inside the end-of-turn step');
  for (const seat of [0, 1] as Seat[]) {
    const acts = legalActions(h.state, seat).map(a => a.type);
    assert.ok(!acts.some(t => t === 'playCard' || t === 'castSpellToken' || t === 'activateAbility' || t === 'graft' || t === 'augment'),
      `seat ${seat} offered: ${acts.join(',')}`);
  }
  const other = (1 - p) as Seat;
  assert.throws(() => h.do({ type: 'playCard', seat: other, handIndex: h.state.players[other]!.hand.indexOf('Ignis Sprite') }));
});

function initiativeFlips(): void {
  const h = new Harness(90905);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const t = h.state.turn;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.initiative, D);
  assert.equal(h.state.turn, t + 1);
  assert.equal(h.state.phase, 'planning');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.battle!.attacker, D, 'the new initiative player is the round-1 attacker');
  h.do({ type: 'declareAttack', seat: D, columns: [] });
  if ((h.state.phase as string) === 'battle') h.do({ type: 'declareAttack', seat: A, columns: [] });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.initiative, A, 'and it alternates back');
}

test('cr:turn.initiative.pass — when the turn ends the initiative goes to the other player, who attacks first in the next battle, and it alternates back', initiativeFlips);

test('cr:turn.initiative.turn-over — when the turn ends the turn number goes up by one and the next turn opens in planning', initiativeFlips);

test('cr:turn.initiative.pass.packs — the packs pass once, in the draft step, and the end of the turn does not pass them again', () => {
  const h = new Harness(90901, undefined, 'draft');
  const dealt = [h.state.packs[0]!.slice(), h.state.packs[1]!.slice()];
  noopCommit(h, 0);
  assert.deepEqual(h.state.packs[0], dealt[0], 'one commit: not passed yet');
  noopCommit(h, 1);
  assert.deepEqual(h.state.packs[0], dealt[1], 'both committed: passed in the draft step');
  assert.deepEqual(h.state.packs[1], dealt[0]);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // end of turn: initiative passes
  assert.equal(h.state.turn, 2);
  assert.deepEqual(h.state.draftDone, [false, false], 'turn 2 draft step open');
  assert.deepEqual(h.state.packs[0], dealt[1], 'the end of the turn did not pass the packs a second time');
  assert.deepEqual(h.state.packs[1], dealt[0]);
});
