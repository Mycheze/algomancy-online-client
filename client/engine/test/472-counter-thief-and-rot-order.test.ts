/**
 * CR 708.4a — the player orders replacement effects where the order changes
 * the outcome: two Counter Thieves (which one keeps the counters), two
 * Skittering Blights (which one grows). Caleb Gannon, rules-questions
 * 2025-11-25: "(you the player control how they stack)"; the owner,
 * 2026-10-16: "Ask the player now", and on two Counter Thieves, the counters
 * end on the SECOND thief when that is the order chosen.
 *
 * Who is asked: the player the event happens to — the controller of the unit
 * the counters were going to be put on; the player whose rot it is.
 *
 * Where: a Counter Thief question raised while a spell resolves is an ordinary
 * mid-resolution question; one raised by Poisonous combat damage, or by the rot
 * step, comes from outside any resolving part, and the step rewinds to its
 * start and asks there (E.orderSeamRun).
 *
 * RED before: nothing was ever asked; the counters always ended on the thief
 * with the higher id, and rot always went to the Blight with the lower id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { apply, IllegalAction } from '../src/apply.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  assignDefault, ent, finishBattle, give, pass, pick, spawn, toDeployment, toNextBattle,
  withE as whiteBox,
} from './util.ts';

registerSynthetic({
  name: 'T472 Growth', cost: '', mana: 0, power: 0, toughness: 0, type: '{Battle} Test Spell',
  kind: 'spell', timing: 'battle', attrs: [], virus: false, burst: false, augmentAttrs: [],
  text: 'Put two +1/+1 counters on target unit.', image: '',
} as Printed, {
  spellEffect: {
    targets: { what: 'unit', prompt: 'T472 Growth: put two +1/+1 counters on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      const u = t && 'id' in t ? g.entity(t.id) : undefined;
      if (u) g.addCounters(u, 2, ctx.controller);
    },
  },
});

/** answer the open question by clicking the unit `id` */
function choose(h: Harness, id: EntityId): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => (o.value as { unit?: number })?.unit === id);
  assert.ok(i !== -1, `the question offers unit ${id}: ${dec.options.map(o => o.label).join(', ')}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

// ── Counter Thief, mid-resolution ─────────────────────────────────────────

/** D holds two thieves and a unit in the battle region; A casts T472 Growth on that unit */
function growth(seed: number, thieves: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Mohruung');
  const ct = Array.from({ length: thieves }, () => spawn(h, D, 'Counter Thief'));
  const mark = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'T472 Growth') });
  pick(h, { unit: mark });
  pass(h); pass(h);                                  // it resolves
  return { h, A, D, ct, mark };
}

test('CR 708.4a: two Counter Thieves — the player whose unit the counters were for is asked which keeps them', () => {
  // RED before: no question, and the higher-id thief kept them
  const r = growth(47201, 2);
  const dec = r.h.state.decision;
  assert.ok(dec, 'a question is open as the spell resolves');
  assert.equal(dec!.seat, r.D, 'the controller of the unit the counters were going to');
  assert.match(dec!.prompt, /Counter Thief: which unit keeps the 2 counter\(s\) meant for The Foretold\?/);
  assert.deepEqual(dec!.options.map(o => (o.value as { unit: number }).unit).sort(), [...r.ct].sort(),
    'each thief is a choice, named by the unit on the board');
  choose(r.h, r.ct[0]!);
  assert.equal(r.h.state.decision, null);
  assert.equal(ent(r.h, r.ct[0]!)!.counters, 2, 'the chosen thief keeps them');
  assert.equal(ent(r.h, r.ct[1]!)!.counters, 0);
  assert.equal(ent(r.h, r.mark)!.counters, 0, 'none reach the unit they were aimed at');
});

test('CR 708.4a: two Counter Thieves — choosing the second puts them on the second (the owner, 2026-10-16)', () => {
  const r = growth(47202, 2);
  choose(r.h, r.ct[1]!);
  assert.equal(ent(r.h, r.ct[1]!)!.counters, 2);
  assert.equal(ent(r.h, r.ct[0]!)!.counters, 0);
});

test('CR 708.4a: one Counter Thief asks nothing', () => {
  const r = growth(47203, 1);
  assert.equal(r.h.state.decision, null, 'one redirect: nothing to order');
  assert.equal(ent(r.h, r.ct[0]!)!.counters, 2);
});

// ── Counter Thief, Poisonous combat damage (outside any resolving part) ──

test('CR 708.4a: Poisonous combat damage and two Counter Thieves — asked before the damage, and the answer decides it', () => {
  const h = new Harness(47204);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const myc = spawn(h, A, 'Pestilent Mycelion');          // 1/3 {Poisonous}
  const ct = [spawn(h, D, 'Counter Thief'), spawn(h, D, 'Counter Thief')];
  const blk = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[myc]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  assignDefault(h);
  const dec = h.state.decision;
  assert.ok(dec, 'a question is open');
  assert.equal(dec!.seat, D, 'the blocker\'s controller');
  assert.equal(ent(h, blk)!.damage, 0, 'asked before any of the combat damage is dealt');
  assert.equal(ent(h, myc)!.damage, 0);
  choose(h, ct[0]!);
  assert.equal(ent(h, ct[0]!)!.counters, -1, 'the chosen thief took the poison counter');
  assert.equal(ent(h, ct[1]!)!.counters, 0);
  assert.equal(ent(h, blk)!.counters, 0);
  assert.equal(ent(h, myc), undefined, 'and the rest of the exchange was dealt: the 3/3 blocker killed the 1/3');
});

// ── rot ───────────────────────────────────────────────────────────────────

/** P holds `blights` Skittering Blights (each spawn gains P a rot); the next
 * deployment's rot step is where the question comes */
function rotStep(seed: number, blights: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const P = h.state.initiative as Seat, O = (1 - P) as Seat;
  const bl = Array.from({ length: blights }, () => spawn(h, P, 'Skittering Blight'));
  whiteBox(h, e => { e.gainRot(P, 3 - e.rot(P)); });
  const life = h.state.players[P]!.life;
  toNextBattle(h, P);
  const saved = JSON.stringify(h.state);
  const from = h.actions.length;
  const logFrom = h.log.length;
  finishBattle(h);
  return { h, P, O, bl, life, saved, from, logFrom };
}

test('CR 708.4a: two Skittering Blights — the player is asked which takes their rot, before anyone deploys', () => {
  // RED before: no question; the lower-id Blight always took it
  const r = rotStep(47205, 2);
  const dec = r.h.state.decision;
  assert.equal(r.h.state.phase, 'deploy');
  assert.ok(dec, 'a question is open at the start of deployment');
  assert.equal(dec!.seat, r.P, 'the player whose rot it is');
  assert.match(dec!.prompt, /Your 3 rot would deal 3 damage to you — which card replaces it\?/);
  assert.equal(r.h.state.players[r.P]!.life, r.life, 'no rot has been dealt yet');
  assert.ok(!r.h.log.slice(r.logFrom).includes('Start of deployment.'),
    'the start-of-deployment event waits for the rot step');
  // CR 507.4: rot comes before anyone may deploy, so the other player waits
  assert.throws(() => r.h.do({ type: 'doneDeploying', seat: r.O }), IllegalAction);
  choose(r.h, r.bl[1]!);
  assert.equal(r.h.state.decision, null);
  assert.deepEqual(r.bl.map(id => ent(r.h, id)!.counters), [0, 3], 'the chosen Blight took the counters');
  assert.equal(r.h.state.players[r.P]!.life, r.life, 'and the rot dealt no damage');
  assert.equal(r.h.log.slice(r.logFrom).filter(l => l === 'Start of deployment.').length, 1,
    'then the start of deployment happened, once');
});

test('CR 708.4a: one Skittering Blight asks nothing at the rot step', () => {
  const r = rotStep(47206, 1);
  assert.equal(r.h.state.decision, null);
  assert.equal(ent(r.h, r.bl[0]!)!.counters, 3);
});

test('CR 708.4a: the rot answer replays — a saved game runs into the same question and the same result', () => {
  const r = rotStep(47207, 2);
  choose(r.h, r.bl[1]!);
  let again = JSON.parse(r.saved) as typeof r.h.state;
  for (const a of r.h.actions.slice(r.from)) again = apply(again, a).state;
  assert.equal(JSON.stringify(again), JSON.stringify(r.h.state), 'the replay is identical');
});
