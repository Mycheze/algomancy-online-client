/* CT-310 — JJSE, Soul Siphon: the target question lit both life totals, and
 * the bar said "— click a highlighted card". A life total is not a card.
 * When any lit subject is a player, the bar says "target"; a question lit
 * only on cards keeps "card". The card names below are fixtures for the
 * three shapes (players only, both, units only), not a list being enforced.
 *
 * Seeds 51300-51309.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { isBoard, optionSubjects } from '../boardpick.ts';
import type { Seat } from '../../engine/src/types.ts';

const ui = await client();

const hint = (html: string): string => /class="pickhint">([^<]*)</.exec(html)?.[1] ?? '';

/** a priority window in battle (the defender, after combat: 295's fixture),
 * with `card` cast and its question open */
function asking(seed: number, card: string, setup: (h: Harness, me: Seat, them: Seat) => void): { h: Harness; me: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const them = h.state.initiative as Seat, me = (1 - them) as Seat;
  const atk = spawn(h, them, 'Good Whale');
  for (const el of ['fire', 'water', 'earth', 'light', 'metal'] as const) giveResources(h, me, el, 3);
  setup(h, me, them);
  toNextBattle(h, them);
  h.do({ type: 'declareAttack', seat: them, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: me, blocks: {} });
  pass(h); pass(h); pass(h);
  assert.equal(h.state.priority, me, 'the premise: my priority');
  h.do({ type: 'playCard', seat: me, handIndex: give(h, me, card) });
  assert.equal(h.state.decision?.seat, me, `the premise: ${card} asks its caster a question`);
  return { h, me };
}

test('CT-310: player targets (Soul Siphon) are a highlighted target, not a card', () => {
  const { h, me } = asking(51300, 'Soul Siphon', () => {});
  const subs = optionSubjects(h.state.decision!, h.state);
  assert.ok(subs.some(x => x.at === 'player'), `the premise: the life totals are lit: ${JSON.stringify(subs)}`);
  const html = ui.join(viewFor(h.state, me), me, legalActions(h.state, me));
  assert.match(hint(html), /highlighted target/, `the hint: ${hint(html)}`);
  assert.doesNotMatch(hint(html), /card/);
});

test('CT-310: units and players lit together (Fireball) are a highlighted target too', () => {
  const { h, me } = asking(51301, 'Fireball', (h, _me, them) => { spawn(h, them, 'Palewing'); });
  const subs = optionSubjects(h.state.decision!, h.state);
  assert.ok(subs.some(x => x.at === 'unit') && subs.some(x => x.at === 'player'),
    `the premise: a unit and the life totals are lit: ${JSON.stringify(subs)}`);
  const html = ui.join(viewFor(h.state, me), me, legalActions(h.state, me));
  assert.match(hint(html), /highlighted target/, `the hint: ${hint(html)}`);
});

test('CT-310: the control: a question lit only on units still says card', () => {
  const { h, me } = asking(51302, 'Accumulated Nucleation', (h, _me, them) => { spawn(h, them, 'Palewing'); });
  const subs = optionSubjects(h.state.decision!, h.state);
  assert.ok(subs.some(isBoard), 'the premise: something on the board is lit');
  assert.ok(!subs.some(x => x.at === 'player'), `the premise: no player is lit: ${JSON.stringify(subs)}`);
  const html = ui.join(viewFor(h.state, me), me, legalActions(h.state, me));
  assert.match(hint(html), /highlighted card/, `the hint: ${hint(html)}`);
});
