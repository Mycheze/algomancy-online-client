/* PRESSING ATTACK! MUST NOT DROP THE FORMATION BEFORE THE SERVER ANSWERS —
 * CT-554, report #375.
 *
 * THE REPORT (mycheze, 2026-11-10), verbatim:
 *
 *   "when declaring attackers, the transition is no longer as smooth and the
 *    cards leap back for a single frame to your side of the battle field when
 *    you submit the attackers. They should just stay there and not redraw
 *    after hitting submit."
 *
 * WHAT WAS WRONG. `declareBuiltAttack` (ui/main.ts) sent the declaration and,
 * in the same tick, emptied the built plan. Over a socket `act()` only SENDS —
 * nothing is applied until the server's update arrives — so the board was
 * repainted on the old declare-step state with no plan, and every chosen
 * attacker stood back in its In Play row for one round trip. A refusal found
 * the plan already gone. The block side fixed exactly this as ledger #77
 * (86-ui-block-refusal); the attack side never got it.
 *
 * WHAT THESE ASSERT, driven the way a player meets it: build, press Attack!,
 * look at the board BEFORE the server answers; then a refusal; then the
 * landing, after which the units must come home when the battle is done.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';
import { finishBattle, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client, idsIn, zone } from './ui-driver.ts';

const ui = await client();

/** the declare step for `A`, with `n` of A's units free to attack */
function declareStep(seed: number, n: number): { h: Harness; A: Seat; units: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const units = Array.from({ length: n }, () => spawn(h, A, 'The Foretold'));
  toNextBattle(h, A);
  assert.equal(h.state.battle!.step, 'declare', 'the declare step is open');
  return { h, A, units };
}

/** seat A at its declare step and put each unit in a column of its own */
function buildAttack(h: Harness, A: Seat, units: EntityId[]): void {
  ui.join(h.state, A, legalActions(h.state, A));
  units.forEach((id, ci) => {
    ui.click({ act: 'unit', id: String(id) });
    ui.click({ act: 'slot', ci: String(ci), row: '0' });
  });
  ui.sent();
}

test('CT-554: after Attack! and before the server answers, the attackers stay in the fight', () => {
  const { h, A, units } = declareStep(12201, 2);
  buildAttack(h, A, units);
  assert.ok(!units.some(id => idsIn(zone(ui.html(), `field:${A}`)).includes(id)),
    'the fixture really took both units out of In Play while building');

  const board = ui.click({ btn: 'confirmattack' });
  const acts = ui.actions();
  assert.equal(acts.length, 1, 'exactly one declaration went out');
  assert.equal(acts[0]!.type, 'declareAttack');
  assert.deepEqual((acts[0] as { columns: EntityId[][] }).columns, units.map(id => [id]));

  const home = idsIn(zone(board, `field:${A}`));
  assert.deepEqual(units.filter(id => home.includes(id)), [],
    'an attacker leapt back into In Play the moment Attack! was pressed — the plan was dropped '
    + 'before the server had applied anything, which is report #375 verbatim');
});

test('CT-554: a refused attack leaves the formation standing, to amend and send again', () => {
  const { h, A, units } = declareStep(12202, 2);
  buildAttack(h, A, units);
  ui.click({ btn: 'confirmattack' });
  ui.sent();
  const board = ui.push({ t: 'error', msg: 'refused for the test' });
  const home = idsIn(zone(board, `field:${A}`));
  assert.deepEqual(units.filter(id => home.includes(id)), [],
    'the refusal arrived after the plan was gone, so the player rebuilds it from nothing');
  ui.click({ btn: 'confirmattack' });
  assert.equal(ui.actions().length, 1, 'and Attack! sends the same formation again');
});

test('CT-554: …and the plan is dropped once a state says the attack landed', () => {
  // holding it for ever would be its own bug: a unit the board still thinks
  // is placed is filtered out of its region, so it would never come home
  const { h, A, units } = declareStep(12203, 1);
  buildAttack(h, A, units);
  ui.click({ btn: 'confirmattack' });
  ui.sent();

  h.do({ type: 'declareAttack', seat: A, columns: [[units[0]!]] });
  assert.notEqual(h.state.battle?.step, 'declare', 'the declaration landed');
  ui.update(h.state, legalActions(h.state, A));
  finishBattle(h);
  assert.notEqual(h.state.phase, 'battle', 'the fixture really got past the battle');
  assert.ok(h.state.entities[units[0]!], 'and the attacker survived it, so it has a region to be in');

  const after = ui.update(h.state, legalActions(h.state, A));
  assert.ok(idsIn(zone(after, `field:${A}`)).includes(units[0]!),
    'the attacker never came home: the board is still holding an attack the engine consumed');
});
