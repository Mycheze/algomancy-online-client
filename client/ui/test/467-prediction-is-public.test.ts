/* Discord, relayed by the owner: "The prediction made with a card like
 * Prediction Prophet is public information and needs to be displayed on the
 * card so all can see."
 *
 * Prediction Prophet — "During [Haste], predict your life total. At the start
 * of deployment, create a 5/5 unit if you matched the prediction." The engine
 * kept the number in `budgets.predictedLife` (+1, so 0 could be stored), and
 * viewFor already sent it to both seats — but nothing on the board read it; a
 * log line was the only place it appeared. It is `Entity.predicted` now
 * ({ life, turn }), and the board wears it the way The Everywhere wears what
 * it named: a "🔮 predicts N" chip (board and zoom dice, both seats) and a
 * "Predicted life: N" state line in the text box.
 *
 * Guards:
 *  · from the OPPONENT's view (viewFor), the prophet's card on the board
 *    carries the chip and its text box the line;
 *  · 0 is a real prediction and shows;
 *  · the prediction is read once, at that turn's start of deployment, and is
 *    gone after; a prediction stamped with an EARLIER turn neither shows nor
 *    pays out (what the per-turn budget wipe used to guarantee).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { entityTextBox, predictionOf } from '../cardtext.ts';
import { ent, finishBattle, skipHasteStep, spawn, toDeployment, unitsOf } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';

function toPrediction(h: Harness): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

function predicted(seed: number, n: (life: number) => number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const prophet = spawn(h, A, 'Prediction Prophet');
  toPrediction(h);
  assert.equal(h.state.decision?.kind, 'number', 'the prophet is asking for its prediction');
  const want = n(h.state.players[A]!.life);
  h.do({ type: 'decide', seat: A, choice: want });
  return { h, A, D, prophet, want };
}

/** the prophet's card on the board as `seat` is shown it */
function cardHtml(html: string, id: EntityId): string {
  const at = html.indexOf(`data-previd="${id}"`);
  assert.ok(at >= 0, 'the prophet is on the board');
  return html.slice(html.lastIndexOf('<div class="card', at), at + 2000);
}

test('Prediction Prophet - the opponent sees the prediction on the card', async () => {
  const ui = await client();
  const { h, D, prophet, want } = predicted(46701, life => life + 7);
  const view = viewFor(h.state, D) as GameState;
  assert.deepEqual(view.entities[prophet]?.predicted?.life, want, 'the opponent view carries it');
  const html = ui.join(view, D, legalActions(h.state, D));
  assert.ok(cardHtml(html, prophet).includes(`🔮 predicts ${want}`),
    'the chip is on the prophet card for the OTHER seat');
  const box = entityTextBox(new E(view), view.entities[prophet]!);
  assert.ok(box.state.includes(`Predicted life: ${want}`), `the text box says it too: ${JSON.stringify(box.state)}`);
});

test('Prediction Prophet - a prediction of 0 is a prediction and shows', async () => {
  const ui = await client();
  const { h, A, prophet } = predicted(46702, () => 0);
  assert.equal(predictionOf(ent(h, prophet)!, h.state.turn), 0);
  const html = ui.join(viewFor(h.state, A) as GameState, A, legalActions(h.state, A));
  assert.ok(cardHtml(html, prophet).includes('🔮 predicts 0'));
});

test('Prediction Prophet - the prediction is read once at deployment, and an old one never counts', () => {
  const { h, A, prophet, want } = predicted(46703, life => life);
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.log.some(l => l.includes(`the prediction of ${want} was matched`)), 'matched and paid');
  assert.equal(ent(h, prophet)!.predicted, undefined, 'and gone once read');

  // a prediction from an EARLIER turn: the budget wipe used to make it vanish
  const b = predicted(46704, life => life);
  b.h.state.entities[b.prophet]!.predicted!.turn -= 1;
  assert.equal(predictionOf(ent(b.h, b.prophet)!, b.h.state.turn), undefined, 'not shown');
  const before = unitsOf(b.h, b.A).filter(u => u.token && u.tokenStats?.[0] === 5).length;
  finishBattle(b.h);
  assert.ok(b.h.log.some(l => l.includes('no prediction was made during [Haste]')), 'and not counted');
  assert.equal(unitsOf(b.h, b.A).filter(u => u.token && u.tokenStats?.[0] === 5).length, before, 'no 5/5');
  void A;
});
