/**
 * CR 111.6b, 702.6b / report 273 — THE PAY-X-LIFE DIAL COUNTS THE POINTS ALREADY CHOSEN.
 *
 * Report 273 made "[Pay X life]" one life change: the points are counted into
 * X as they are answered and the X life is lost together when X closes (engine
 * test 590). The life total therefore still holds the chosen points while the
 * dial is open, and the dial's ceiling has to take them off — it used to read
 * "life − 1" as the room left ON TOP of what was paid, which was only true
 * while every point was lost on the spot.
 *
 * Seeds 59100-59149.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { give, giveResources, toDeployment } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';
import type { Decision } from '../../engine/src/types.ts';

const ui = await client();

const optIdx = (dec: Decision, key: string): number =>
  dec.options.findIndex(o => !!o.value && typeof o.value === 'object' && key in (o.value as object));

test('CR 111.6b / report 273: with 3 of 30 life chosen, the pay-X-life dial still tops out at X = 29', () => {
  const h = new Harness(59100);
  toDeployment(h);
  giveResources(h, 0, 'light', 8);
  h.do({ type: 'playCard', seat: 0, handIndex: give(h, 0, 'Flesh Tithe') });
  ui.join(h.state, 0, []);
  for (let i = 0; i < 3; i++) h.do({ type: 'decide', seat: 0, choice: optIdx(h.state.decision!, 'payLife1') });
  assert.equal(h.state.players[0]!.life, 30, 'the three points are chosen, not yet lost');
  const html = ui.update(h.state, []);
  assert.ok(html.includes('min="3"'), 'the dial floors at the 3 already chosen');
  assert.ok(html.includes('max="29"'), `the dial must top out at 29 (never the last life), not 3 + 29: ${html.match(/max="\d+"/)?.[0]}`);
});
