/**
 * CT-6 — Organic Exchange aimed at two units one player controls is a swap of
 * positions, and its line names that player once. The bug read "P1 takes X, P1
 * takes Y", an exchange of control with nobody; the other guards in 85 compare
 * the same-side line with the across line, which differed even then.
 *
 * The second unit is the opponent's card under the caster's control, so owner
 * and controller differ: the line must follow control.
 *
 * Seeds 147000-147099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCard } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { spawn, toDeployment } from './util.ts';

test('CT-6: Organic Exchange on two units one player controls names that player once, not as a trade with themself', () => {
  const h = new Harness(147001);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  const mine = g.entity(spawn(h, A, 'Tidal Menace'))!;
  const theirs = g.entity(spawn(h, D, 'The Foretold'))!;
  theirs.controller = A;
  const before = g.events.length;
  getCard('Organic Exchange').spellEffect!.run(g, {
    controller: A, sourceName: 'Organic Exchange', region: g.homeRegion(A),
    targets: [mine, theirs], event: null,
    choose: () => { throw new Error('no choice is asked'); },
  } as never);
  const said = g.events.slice(before).map(e => e.msg ?? '').join(' ');
  assert.ok(said.trim(), 'the swap is announced');
  assert.equal(said.split(g.pname(A)).length - 1, 1, `the controller is named once: ${said}`);
  assert.equal(mine.controller, A);
  assert.equal(theirs.controller, A, 'and no control changes hands');
});
