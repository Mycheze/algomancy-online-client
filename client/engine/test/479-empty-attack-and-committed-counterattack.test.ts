/**
 * Two combat rulings of the owner, 2026-10-16.
 *
 * CT-297 — an attacking formation emptied before the block step (every
 * attacker died, was bounced...) cannot be blocked at all, head-on or to the
 * side: "If there's no attacking formation (everyone died or something), no
 * blocking can occur. It does still need to allow counter attackers, but you
 * can't put something in to block".
 *
 * CT-298 / CT-251 — a sent counterattacker is committed: "if you decide to
 * counterattack with something, it MUST be put into formation, you cannot
 * change your mind and leave a unit off to the side/not attacking in the new
 * region. But you don't decide the shape of that formation until the attack
 * step of the second battle." So in round 2 every living sent unit goes into
 * the formation (any shape), there is no decline, and a lone one with no
 * ridable token is formed for the player (CR 610.4b, CR D1.2c).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { forcedAction, IllegalAction, legalActions } from '../src/apply.ts';
import type { Action, EntityId, Seat } from '../src/types.ts';
import { absorb, ent, pass, spawn, toDeployment, toNextBattle } from './util.ts';

type Blocks = Extract<Action, { type: 'declareBlocks' }>;
type Attack = Extract<Action, { type: 'declareAttack' }>;

function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state); fn(e); e.settle(); h.state = e.s; absorb(h, e.events);
}

/** A attacks with one unit, which is then deleted in the attack window: the block step opens on an empty formation */
function emptiedAttack(seed: number): { h: Harness; A: Seat; D: Seat; d1: EntityId; d2: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  const d2 = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  whiteBox(h, e => { e.destroy(ent(h, atk)!, 'is deleted'); });
  assert.deepEqual(h.state.battle!.columns, [], 'the attacking formation is empty');
  return { h, A, D, d1, d2 };
}

test('CT-297 an emptied attacking formation cannot be blocked head-on or to the side, but counterattackers may still be sent', () => {
  const { h, D, d1, d2 } = emptiedAttack(5285);
  const fork = structuredClone(h.state);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } }), IllegalAction,
    'a side-block on the right is a block too');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { [-1]: [d1] } }), IllegalAction,
    'a side-block on the left is a block too');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] }, send: [d2] }), IllegalAction,
    'sending does not license a block');
  // a real choice is left (send or not), so nothing is forced
  assert.equal(forcedAction(h.state), null, 'sending counterattackers is still a choice');
  const offered = legalActions(h.state, D).filter(a => a.type === 'declareBlocks') as Blocks[];
  assert.ok(offered.every(a => Object.keys(a.blocks).length === 0), 'no offered declaration blocks anything');
  assert.ok(offered.some(a => (a.send ?? []).includes(d2)), 'sending is offered');
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [d2] });
  assert.deepEqual(h.state.battle!.sentAttackers, [d2], 'the counterattacker went out');
  h.state = fork;
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.notEqual(h.state.battle?.step, 'blocks', 'the empty declaration is accepted');
});

test('CT-297 an emptied counterattack in round 2 leaves the defender nothing to declare', () => {
  const h = new Harness(5286);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const home = spawn(h, A, 'The Foretold');          // stays home: present to defend in round 2
  const c = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] });
  let g = 30;
  while (h.state.phase === 'battle' && h.state.battle!.round === 1 && g-- > 0) pass(h);
  h.do(forcedAction(h.state)!);                       // the lone counterattacker forms
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  assert.equal(h.state.battle!.defender, A);
  whiteBox(h, e => { e.destroy(ent(h, c)!, 'is deleted'); });
  assert.deepEqual(forcedAction(h.state), { type: 'declareBlocks', seat: A, blocks: {} },
    'no blocks are possible and no counterattack can be sent in round 2');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: A, blocks: { 0: [home] } }), IllegalAction);
});

/** round 1: A attacks, D sends `sent`; returns at the round-2 declare step */
function toCounterattack(seed: number, names: string[], token = false): { h: Harness; D: Seat; A: Seat; sent: EntityId[]; tok?: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const sent = names.map(n => spawn(h, D, n));
  toNextBattle(h, A);
  let tok: EntityId | undefined;
  if (token) {
    const e = new E(h.state);
    tok = e.createSpellToken(D, 'Fireball', 2, e.homeRegion(D)).id;
  }
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: sent, ...(tok ? { spellTokens: [tok] } : {}) } as Action);
  let g = 30;
  while (h.state.phase === 'battle' && h.state.battle!.round === 1 && g-- > 0) pass(h);
  const b = h.state.battle!;
  assert.equal(b.round, 2);
  assert.equal(b.step, 'declare');
  assert.equal(b.attacker, D);
  return { h, A, D, sent, tok };
}

test('CT-298 every sent counterattacker must be in the formation and the counterattack cannot be declined', () => {
  const { h, D, sent: [d1, d2, d3] } = toCounterattack(3222, ['Conduit of Pain', 'The Foretold', 'Good Whale']);
  assert.equal(forcedAction(h.state), null, 'three units: the shape is a real choice');
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [] }), IllegalAction, 'no decline');
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [[d1!], [d2!]] }), IllegalAction,
    'no leaving one off to the side');
  const offered = legalActions(h.state, D).filter(a => a.type === 'declareAttack') as Attack[];
  assert.ok(offered.length >= 2, 'more than one shape is offered');
  for (const a of offered) {
    assert.deepEqual(a.columns.flat().slice().sort(), [d1, d2, d3].sort(), 'every offered shape holds all three');
  }
  // any shape is fine
  h.do({ type: 'declareAttack', seat: D, columns: [[d3!, d1!], [d2!]] });
  assert.deepEqual(h.state.battle!.columns, [[d3, d1], [d2]]);
});

test('CT-251 a lone sent counterattacker is formed for the player and one that died on arrival is owed nothing', () => {
  const { h, D, sent: [d1, d2] } = toCounterattack(3223, ['Conduit of Pain', 'The Foretold']);
  assert.equal(forcedAction(h.state), null, 'two units: still a shape to choose');
  whiteBox(h, e => { e.destroy(ent(h, d2!)!, 'is deleted'); });
  assert.deepEqual(forcedAction(h.state), { type: 'declareAttack', seat: D, columns: [[d1]] },
    'with one left, its formation is declared for the player');
  h.do(forcedAction(h.state)!);
  assert.deepEqual(h.state.battle!.columns, [[d1]]);
});

test('CT-251 a lone counterattacker with a ridable token is asked, but still may not decline', () => {
  const { h, A, D, sent: [d1], tok } = toCounterattack(3221, ['Conduit of Pain'], true);
  assert.equal(forcedAction(h.state), null, 'whether the token rides is a real choice');
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [] }), IllegalAction, 'no decline');
  const fork = structuredClone(h.state);
  h.do({ type: 'declareAttack', seat: D, columns: [[d1!]] });
  assert.ok(h.state.battle!.columns.flat().includes(d1!), 'without the token');
  h.state = fork;
  h.do({ type: 'declareAttack', seat: D, columns: [[d1!]], spellTokens: [tok!] });
  assert.equal(ent(h, tok!)!.region, new E(h.state).homeRegion(A), 'with the token');
});

test('CT-298 a second round after a first round with no attack is a fresh attack and may still be declined', () => {
  const h2 = new Harness(3224);
  toDeployment(h2);
  const A = h2.state.initiative as Seat, D = (1 - A) as Seat;
  spawn(h2, A, 'Good Whale');
  const d1 = spawn(h2, D, 'Good Whale');
  toNextBattle(h2, A);
  h2.do({ type: 'declareAttack', seat: A, columns: [] });
  const b = h2.state.battle!;
  assert.equal(b.round, 2);
  assert.equal(b.attackerPool, null, 'no counterattack pool: round 1 had no battle');
  const offered = legalActions(h2.state, D).filter(a => a.type === 'declareAttack') as Attack[];
  assert.ok(offered.some(a => a.columns.length === 0), 'declining a fresh attack is offered');
  assert.ok(offered.some(a => a.columns.flat().includes(d1)), 'attacking is offered');
  assert.equal(forcedAction(h2.state), null);
  h2.do({ type: 'declareAttack', seat: D, columns: [] });
  assert.notEqual(h2.state.phase, 'battle');
});
