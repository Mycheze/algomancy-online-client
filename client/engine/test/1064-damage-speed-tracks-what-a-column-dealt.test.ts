/**
 * CR 608.2f / CT-427 — after the Swift sub-step, the sub-step a half-column
 * strikes in follows what it has already DEALT, not the attributes it holds now.
 *
 * The engine read the column's attributes at each sub-step: normal for a column
 * with neither Swift nor Sluggish, Sluggish only for one with Sluggish. So a
 * column given {Swift} in the window after the Swift sub-step skipped the normal
 * sub-step, and a column that lost {Sluggish} in the window before the Sluggish
 * sub-step skipped that one. Either way it dealt no combat damage at all. The
 * designer settled both, in his final scheme for the split step
 * (rules-questions 2025-04-20 [1363287109401710603]):
 *
 *   "After swift priority<- remaining columns will deal normal damage unless
 *    sluggish (even if given swift in this step, they didn't hit for swift
 *    damage and aren't marked as swift)"
 *   "Before sluggish priority <- remaining columns will deal sluggish damange
 *    here (even if given swift or sluggish is removed here, they didn't hit
 *    for swift or normal damage)"
 *
 * and in one line: "If a column dealt swift damage, it won't deal normal
 * damage. / If a column dealt normal damage it won't deal sluggish damage."
 * [1363292630443626568]. The struck marks (CR 608.2e) were already the
 * column's memory; this makes them the whole answer once the Swift sub-step
 * has passed.
 *
 * Seeds 106400-106499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { finishBattle, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle(); h.state = g.s;
  return u.id;
}

test('CR 608.2f / CT-427: a column given Swift in the after-Swift window still deals normal damage', () => {
  const h = new Harness(106400);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');             // 2/1 {Swift}
  const late = tok(h, A, 3, 3);                         // normal, until it is given Swift
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [late]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const b = () => h.state.battle!;
  assert.equal(b().pendingSub, 'normal', 'this is the window after the Swift sub-step');
  assert.equal(h.state.players[D]!.life, 28, 'the Drifter has struck');

  withE(h, g => { g.addTempAttr(g.entity(late)!, 'Swift'); });
  pass(h); pass(h);                                     // the after-Swift window closes
  assert.equal(h.state.players[D]!.life, 25,
    '"even if given swift in this step, they didn\'t hit for swift damage": it strikes in the normal sub-step');
  assert.equal(b().step, 'afterWindow');
  finishBattle(h);
});

test('CR 608.2f / CT-427: a column that loses Sluggish in the before-Sluggish window still deals Sluggish damage', () => {
  const h = new Harness(106401);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const one = tok(h, A, 1, 1);                          // normal
  const slug = spawn(h, A, 'Ambling Mountaintop');      // 4/5 {Sluggish}, nothing else
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[one], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const b = () => h.state.battle!;
  assert.equal(b().pendingSub, 'Sluggish', 'the before-Sluggish window');
  assert.equal(h.state.players[D]!.life, 29, 'the normal column has struck');

  withE(h, g => { g.suppress(g.entity(slug)!, 'Suppression Field', { attrs: true }); });
  pass(h); pass(h);                                     // the before-Sluggish window closes
  assert.equal(h.state.players[D]!.life, 25,
    '"even if ... sluggish is removed here, they didn\'t hit for swift or normal damage": it strikes in the Sluggish sub-step');
  assert.equal(b().step, 'afterWindow');
  finishBattle(h);
});

test('CR 608.2f / CT-427: control -- a column that struck in the Swift sub-step does not strike in the Sluggish one without Sluggish', () => {
  const h = new Harness(106402);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');             // 2/1 {Swift}
  const slug = spawn(h, A, 'Ambling Mountaintop');      // 4/5 {Sluggish}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 28);
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 24, 'the Drifter struck once, the Mountaintop once');
});

test('CR 608.2f / CT-427: control -- a column that loses Sluggish in the after-Swift window strikes in the normal sub-step, once', () => {
  const h = new Harness(106403);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');             // 2/1 {Swift}
  const slug = spawn(h, A, 'Ambling Mountaintop');      // 4/5 {Sluggish}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const b = () => h.state.battle!;
  assert.equal(b().pendingSub, 'normal', 'the after-Swift window');
  withE(h, g => { g.suppress(g.entity(slug)!, 'Suppression Field', { attrs: true }); });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 24, '"should do regular damage in that case" [1363281743234207999]');
  assert.equal(b().step, 'afterWindow', '"and no sluggish priority window would be opened"');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 24, 'and it does not strike again');
});
