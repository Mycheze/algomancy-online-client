/* CT-289 (report #206, Minor Kraken): every unit the Kraken could recall was
 * Debeli's own, and Curio Drifter was recalled with nothing asking. The "did
 * you mean your own unit?" question (CR D2.8) covered only the two-slot
 * ally-and-other spells. It now also covers one printed "up to one target
 * unit" slot whose every candidate is the caster's own — as a question on the
 * option, never a narrowing (CR D1.1a): the same options, the stop included.
 *
 * Seeds 62000-62099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import type { Seat } from '../../engine/src/types.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';

/** A attacks with Minor Kraken and Curio Drifter; D has `foe` in the region, or nobody */
function kraken(seed: number, foe?: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const k = spawn(h, A, 'Minor Kraken');
  const drifter = spawn(h, A, 'Curio Drifter');
  const enemy = foe ? spawn(h, D, foe) : undefined;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[k], [drifter]] });
  let guard = 0;
  while (h.state.decision?.kind !== 'targets' && guard++ < 20) {
    const d = h.state.decision;
    if (d) h.do({ type: 'decide', seat: d.seat, choice: 0 });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'targets', 'the fixture: the Kraken asks for its recall target');
  assert.equal(dec.seat, A);
  return { h, dec, A, drifter, enemy };
}

const unitOpts = (dec: NonNullable<Harness['state']['decision']>) =>
  dec.options.filter(o => typeof o.value === 'object' && o.value !== null && 'unit' in (o.value as object));

test('CR D2.8 / CT-289: an up to one recall whose every candidate is your own asks on each of them', () => {
  const { dec, drifter } = kraken(62000);
  const units = unitOpts(dec);
  assert.ok(units.some(o => (o.value as { unit: number }).unit === drifter), 'Curio Drifter is a candidate');
  for (const o of units) {
    assert.match(o.confirm ?? '', /^Every unit you can target right now is one of your own\. Did you mean to\?$/, o.label);
    assert.equal(o.confirmWhy, undefined, 'the ally question, worded as such by the client');
  }
});

test('CR D1.1a / CT-289: the question narrows nothing, the stop is still offered and asks nothing', () => {
  const { dec } = kraken(62001);
  const stop = dec.options.filter(o => typeof o.value === 'object' && o.value !== null && 'doneTargets' in (o.value as object));
  assert.equal(stop.length, 1, 'up to one: picking nobody is offered');
  assert.equal(stop[0]!.confirm, undefined);
});

test('CR D2.8 / CT-289: with an enemy in reach the pick is a choice, and nothing asks', () => {
  const { dec, enemy } = kraken(62002, 'The Foretold');
  const units = unitOpts(dec);
  assert.ok(units.some(o => (o.value as { unit: number }).unit === enemy), 'the fixture: the enemy is a candidate');
  assert.deepEqual(units.filter(o => o.confirm), []);
});
