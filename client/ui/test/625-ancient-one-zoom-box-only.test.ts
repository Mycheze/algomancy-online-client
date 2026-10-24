/**
 * CR 721.1c, 710.7 / CT-349 — the card zoom of an Ancient One beside an ally
 * wearing an augment mod shows the mod's [Augment] text, not the mod card's
 * whole text: the box is all the ally has of it, so it is all the Ancient One
 * borrows (engine test 625 holds the rule; this holds what the player reads).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { entityTextBox } from '../cardtext.ts';
import type { Seat } from '../../engine/src/types.ts';
import { finishBattle, spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';

test('CR 721.1c, 710.7 / CT-349: the Ancient One zoom shows only the [Augment] text of a neighbour mod (Infernal Wispweaver)', () => {
  const h = new Harness(62510);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(whale)!, 'Infernal Wispweaver', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale], [ancient]] });
  const e = new E(h.state);
  const lines = entityTextBox(e, e.entity(ancient)!).lines.filter(l => l.from === 'Infernal Wispweaver');
  assert.equal(lines.length, 1, 'one borrowed line from the Wispweaver mod');
  assert.match(lines[0]!.text, /end of turn/i, 'its [Augment] text is there');
  assert.doesNotMatch(lines[0]!.text, /wisps gain/i, 'its body text is not: the Whale does not have it');
  finishBattle(h);
});
