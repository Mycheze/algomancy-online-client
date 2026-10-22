/**
 * CT-329 — THE EVERYWHERE NAMING "THE EVERYWHERE".
 *
 * "[Augment] During [Haste] name a card. My last named card loses all
 * abilities. (As long as I am in their region.)" invi named The Everywhere
 * with The Everywhere in RTPE [521]; CR 712.5 is silent on one source.
 *
 * OWNER, 2026-10-22: the strip KEEPS APPLYING — every The Everywhere in the
 * region loses its abilities, the namer included, and the namer's silence
 * stays on. This is what the engine already did; the test pins it.
 *
 * Seeds 58600-58699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ent, pick, skipHasteStep, spawn, toDeployment } from './util.ts';

/** deployment → the next turn's END-OF-HASTE naming (38-light-a's toNaming) */
function toNaming(h: Harness, attacker?: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  if (attacker !== undefined) h.state.initiative = attacker;
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

test('CT-329: The Everywhere that names The Everywhere strips itself and every copy beside it, and the strip keeps applying', () => {
  const h = new Harness(58600);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const namer = spawn(h, A, 'The Everywhere');
  const other = spawn(h, A, 'The Everywhere');
  toNaming(h, A);
  // two copies, two naming triggers: the first names itself
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  pick(h, 'The Everywhere');
  assert.ok(h.q.abilitiesSuppressed(ent(h, namer)!), 'the namer loses its own abilities');
  assert.ok(h.q.abilitiesSuppressed(ent(h, other)!), 'and so does the copy beside it');
  assert.ok(h.q.suppressionOf(ent(h, other)!).by.includes('The Everywhere'),
    'the copy names The Everywhere as the culprit');
  // the stripped namer's silence is not switched off by its own strip
  assert.equal(ent(h, namer)!.named, 'The Everywhere', 'the naming is still remembered');
  assert.ok(h.q.abilitiesSuppressed(ent(h, namer)!), 'and still applies after the batch settles');
});
