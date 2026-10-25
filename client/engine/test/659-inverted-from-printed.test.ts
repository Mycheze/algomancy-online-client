/**
 * CR 802.8c / CT-379 — {Inverted} inverts the difference between a unit's
 * PRINTED stats and its current stats, and a base rewrite is one of the stat
 * changes it inverts.
 *
 * The engine used to invert from layers 1-2 (`2 * base - current`), so a base
 * rewrite was the thing inverted FROM and never moved. The designer answered
 * the question the other way, rules-questions:
 *
 *   2023-10-26, to "I assume inverted does NOT interact with stat "setting"
 *   like Reshape": "It does because it applies in a later layer" /
 *   "Basically you just look at the stats printed on the card, then look at
 *   its current stats. Take the difference"; to "I guess ANY changes are
 *   changes from printed. including BASE ones.": "yeah and it lets me be more
 *   cavalier with base stat changes".
 *   2025-11-26, on Bubb and Statweaver: "base stat changes are still stat changes".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { effStats, ent, ownAttrs, spawn, toDeployment } from './util.ts';

function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle(); h.state = e.s;
  return u.id;
}

test('CR 802.8c / CT-379: the designer example -- a printed 7/5 made base 3/3 by Aberrant Statweaver is an 11/7 while Inverted', () => {
  const h = new Harness(65901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawnToken(h, p, 7, 5);
  spawn(h, p, 'Aberrant Statweaver');                 // "[Augment] Your units are base 3/3."
  assert.deepEqual(effStats(h, u), [3, 3], 'control: the rewrite alone is a 3/3');
  const e = new E(h.state);
  e.addTempAttr(e.entity(u)!, 'Inverted');
  e.settle(); h.state = e.s;
  assert.deepEqual(effStats(h, u), [11, 7], 'the -4/-2 the rewrite made is inverted to +4/+2');
});

test('CR 802.8c / CT-379: Its Dark Bubb (printed 4/6, Inverted) beside Aberrant Statweaver is a 5/9, not a 3/3', () => {
  // No test hook: Bubb prints {Inverted}, Statweaver prints the rewrite. Bubb is
  // made base 3/3, a -1/-3 change from its printed 4/6, and inverts it.
  const h = new Harness(65902);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bubb = spawn(h, p, 'Its Dark Bubb');
  assert.ok(ownAttrs(h, bubb).has('Inverted'), 'Bubb is Inverted');
  assert.deepEqual(effStats(h, bubb), [4, 6], 'control: no change yet, so nothing to invert');
  spawn(h, p, 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, bubb), [5, 9], '"base stat changes are still stat changes"');
});

test('CR 802.8c / CT-379: a one-shot base rewrite (an until-regroup baseSet) is inverted too, with counters in the same net change', () => {
  const h = new Harness(65903);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawnToken(h, p, 7, 5);
  const e = new E(h.state);
  e.addTempAttr(e.entity(u)!, 'Inverted');
  e.settle(); h.state = e.s;
  assert.deepEqual(effStats(h, u), [7, 5], 'Inverted, no change: itself');
  // "becomes a base 2/8" — the one-shot stamp layer 2 reads (Formless, Body Swap,
  // Unstable Refactor and Celestial Shifter all write it)
  ent(h, u)!.baseSet = [2, 8];
  assert.deepEqual(effStats(h, u), [12, 2], 'a -5/+3 change from the printed 7/5, inverted to +5/-3');
  ent(h, u)!.counters = 1;
  assert.deepEqual(effStats(h, u), [11, 1], 'a -4/+4 net change with the counter, inverted to +4/-4');
});
