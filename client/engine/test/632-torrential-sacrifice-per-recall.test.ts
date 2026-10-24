/**
 * CT-375 — Torrential Reclamation: "Recall X target nontoken allies. Then each
 * player sacrifices a unit and you lose 1 life for each ally recalled this
 * way." The sacrifice is once per ally ACTUALLY recalled, so recalling none
 * means nobody sacrifices.
 *
 * The designer (rules-questions 1064279804741955646): asked "does the
 * sacrificing also happen once for each returned unit?", "Yeah"
 * [1222932669516615743]; "That's why we allow X and the "for each" to be
 * different" [1223287609388957737]; "So you can remove targets to prevent the
 * sacrifice" [1223287683804037202]. The engine floored it at one round
 * (max(1, recalled)), so X = 0 still cost every player a unit.
 *
 * Seeds 63200-63299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

const VANILLA = 'The Foretold';

function board(seed: number, mine: number, theirs: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer as Seat, D = (1 - A) as Seat;
  const ids: EntityId[] = [];
  for (let i = 0; i < mine; i++) ids.push(spawn(h, A, VANILLA));
  for (let i = 0; i < theirs; i++) spawn(h, D, VANILLA);
  giveResources(h, A, 'water', 4); giveResources(h, A, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  let guard = 10;
  while (h.state.priority !== A && guard-- > 0) pass(h);
  h.state.players[A]!.hand = [];
  return { h, A, D, ids };
}
function cast(h: Harness, A: Seat, x: number, targets: EntityId[]): void {
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });
  h.do({ type: 'decide', seat: A, choice: h.state.decision!.options.findIndex(o => o.value === x) });
  for (const t of targets) pick(h, { unit: t });
}
function resolveAll(h: Harness): void {
  let guard = 40;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
}

test('CT-375: Torrential Reclamation for X = 0 recalls nothing, so nobody sacrifices and no life is lost', () => {
  const { h, A, D } = board(63200, 2, 2);
  const life = h.state.players[A]!.life;
  cast(h, A, 0, []);
  resolveAll(h);
  assert.equal(unitsOf(h, A).length, 2, 'no ally recalled, so no sacrifice: 2 stay 2');
  assert.equal(unitsOf(h, D).length, 2, 'and the opponent sacrifices nothing either');
  assert.equal(h.state.players[A]!.life, life, 'and no life is lost');
  finishBattle(h);
});

test('CT-375: Torrential Reclamation for X = 2 with one target removed recalls one, so each player sacrifices one', () => {
  const { h, A, D, ids } = board(63201, 4, 3);
  const life = h.state.players[A]!.life;
  cast(h, A, 2, [ids[0]!, ids[1]!]);
  // the opponent answers by removing one of the targets before it resolves
  withE(h, e => { e.destroy(e.entity(ids[0]!)!, 'dies'); e.settle(); });
  resolveAll(h);
  assert.equal(unitsOf(h, A).length, 1, 'A: 4 − 1 removed − 1 recalled − 1 sacrificed = 1');
  assert.equal(unitsOf(h, D).length, 2, 'D: 3 − 1 sacrificed = 2 ("remove targets to prevent the sacrifice")');
  assert.equal(h.state.players[A]!.life, life - 1, 'one ally recalled, 1 life');
  finishBattle(h);
});
