/* Report #274 (room FVJQ, 2026-10-23): The Everywhere named "Unit Token".
 *
 * The Everywhere prints "[Augment] During [Haste] name a card. My last named
 * card loses all abilities." The menu was the card pool UNIONED with every
 * name standing in play, and the union put token faces back in — the comment
 * said so on purpose ("a Robot / Unit Token standing there is still
 * nameable"), as a promise to keep the options of the old board-built menu,
 * not as a reading of the card. In FVJQ the controller named "Unit Token" at
 * action 372 with five of the opponent's Unit Tokens on the board.
 *
 * CR 108.2a: "For card text, a token is not a card: text that refers to a
 * 'card' does not include a token". "Name a card" refers to a card, so a
 * token's name is not on the menu. The whole-pool menu (CR 712.6: "a card
 * that is not in play may be named") and "name no card" are unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { skipHasteStep, spawn, toDeployment } from './util.ts';

/** deployment → the next turn's [Haste] naming decision (115's helper) */
function toNaming(h: Harness, attacker: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = attacker;
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

test('CR 108.2a / report 274: The Everywhere cannot name a token standing in play', () => {
  const h = new Harness(60201);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'The Everywhere');
  spawn(h, D, 'Unit Token');
  spawn(h, D, 'Robot');
  spawn(h, A, 'Wisp');
  toNaming(h, A);
  const dec = h.state.decision!;
  assert.match(dec.prompt, /The Everywhere: name a card/);
  const menu = dec.options.map(o => o.value);
  for (const tok of ['Unit Token', 'Robot', 'Wisp']) {
    assert.ok(!menu.includes(tok), `${tok} is a token, and a token is not a card`);
  }
});

test('CR 712.6 / report 274: the menu still holds every card in play and out of it, and name no card', () => {
  const h = new Harness(60202);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'The Everywhere');
  spawn(h, D, 'Unit Token');
  spawn(h, D, 'Good Whale');
  toNaming(h, A);
  const menu = h.state.decision!.options.map(o => o.value);
  assert.ok(menu.includes('Good Whale'), 'a card standing in play is nameable');
  assert.ok(menu.includes('Arcane Concentrator'), 'a card nobody has played is nameable');
  assert.ok(menu.includes('The Everywhere'), 'and so is The Everywhere itself');
  assert.ok(menu.includes(''), 'name no card still releases a previous naming');
  assert.ok(menu.length > 100, 'the menu is still the card pool');
});
