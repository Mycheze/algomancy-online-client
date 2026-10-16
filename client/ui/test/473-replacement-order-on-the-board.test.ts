/* CR 708.4a — "which replacement effect applies first?" is answered on the
 * board, like every other in-play selection (the owner, 2026-09-30: "All
 * selections should be done by tapping/clicking the unit or player that is
 * actually on the board").
 *
 * The engine asks it (471/472): two Oorblaks and a hit — which takes it; two
 * Skittering Blights and rot — which grows. Each choice names the unit, so:
 *   · every choice glows on the board and is NOT a button in the bar,
 *   · clicking the unit sends that choice,
 *   · the prompt says plainly what is being chosen,
 *   · the player who is NOT asked sees that a question is open, not the
 *     question — and at the rot step cannot deploy ahead of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { E } from '../../engine/src/engine.ts';
import { viewFor } from '../../server/view.ts';
import { finishBattle, pass, spawn, toDeployment, toNextBattle, withE as whiteBox } from '../../engine/test/util.ts';
import { isBoard, optionSubjects } from '../boardpick.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

/** the prompt bar's markup alone (the board carries its own data-i's) */
const barOf = (html: string): string => {
  const at = html.indexOf('<div class="promptbar');
  return at < 0 ? '' : html.slice(at, html.indexOf('<div class="side"', at) >>> 0);
};

/** two Oorblaks for D, and A's 3-power token unblocked: the question is open */
function oorblakQuestion(seed: number): { h: Harness; A: Seat; D: Seat; oo: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const g = new E(h.state);
  const atk = g.spawnUnit(A, 'Unit Token', g.homeRegion(A), { token: true, tokenStats: [3, 10] }).id;
  g.settle();
  const oo = [spawn(h, D, 'Oorblak'), spawn(h, D, 'Oorblak')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  return { h, A, D, oo };
}

/** draw the asker's view; every option is on the board and only there */
function drawnOnBoard(state: GameState): string {
  const dec = state.decision!;
  const view = viewFor(state, dec.seat);
  const html = ui.join(view, dec.seat, legalActions(state, dec.seat));
  const bar = barOf(html);
  const subs = optionSubjects(view.decision!, view);
  subs.forEach((sub, i) => {
    assert.ok(isBoard(sub) && sub.at === 'unit', `option ${i} "${dec.options[i]!.label}" names a unit on the board`);
    assert.ok(!new RegExp(`data-btn="decide" data-i="${i}"`).test(bar), `option ${i} is not ALSO a button in the bar`);
    assert.ok(ui.has({ act: 'unit', id: (sub as { id: number }).id }), `the unit for option ${i} is drawn`);
  });
  return bar;
}

test('two Oorblaks: the question is drawn on the board, says what it asks, and a click on an Oorblak answers it', () => {
  const { h, D, oo } = oorblakQuestion(47301);
  assert.equal(h.state.decision?.seat, D);
  const bar = drawnOnBoard(h.state);
  assert.match(bar, /Which Oorblak takes the 3 combat damage first\?/, 'the prompt says plainly what is being chosen');
  ui.sent();
  ui.click({ act: 'unit', id: oo[1]! });
  const sent = ui.actions().filter(a => a.type === 'decide');
  const want = h.state.decision!.options.findIndex(o => (o.value as { unit: number }).unit === oo[1]);
  assert.deepEqual(sent.map(a => (a as { choice: unknown }).choice), [want], 'clicking the second Oorblak chooses it');
  h.do(sent[0]!);
  assert.equal(h.state.entities[oo[1]!]!.damage, 3, 'and the engine does what was clicked');
});

test('two Oorblaks: the attacker sees that a question is open, and not the question', () => {
  const { h, A, D } = oorblakQuestion(47302);
  const view = viewFor(h.state, A);
  assert.equal(view.decision, null, 'the question is the defender\'s alone');
  assert.equal(view.pendingAsk?.seat, D, 'but that one is open is public');
});

test('two Skittering Blights at the rot step: drawn on the board, and the other player waits', () => {
  const h = new Harness(47303);
  toDeployment(h);
  const P = h.state.initiative as Seat, O = (1 - P) as Seat;
  const bl = [spawn(h, P, 'Skittering Blight'), spawn(h, P, 'Skittering Blight')];
  whiteBox(h, e => { e.gainRot(P, 2 - e.rot(P)); });
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(h.state.decision?.seat, P, 'the rot question is open');
  const bar = drawnOnBoard(h.state);
  assert.match(bar, /Your 2 rot would deal 2 damage to you — which card replaces it\?/);
  assert.equal(legalActions(h.state, O).length, 0, 'the other player cannot deploy before the rot is dealt');
  ui.sent();
  ui.click({ act: 'unit', id: bl[0]! });
  const sent = ui.actions().filter(a => a.type === 'decide');
  assert.equal(sent.length, 1, 'the click answers it');
  h.do(sent[0]!);
  assert.equal(h.state.entities[bl[0]!]!.counters, 2);
  assert.ok(legalActions(h.state, O).length > 0, 'and then the other player may deploy');
});
