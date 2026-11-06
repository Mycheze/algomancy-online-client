/**
 * CT-329 — THE EVERYWHERE NAMING "THE EVERYWHERE".
 *
 * "[Augment] During [Haste] name a card. My last named card loses all
 * abilities. (As long as I am in their region.)" invi named The Everywhere
 * with The Everywhere in RTPE [521]; CR 712.5 is silent on one source. Since
 * the designer's 2026-11-06 errata it names "As I am played or modded", so the
 * namer here is PLAYED and names as it is played (CR 702.3g).
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
import { ent, playEverywhere, spawn, toDeployment } from './util.ts';

test('CT-329: The Everywhere that names The Everywhere strips itself and every copy beside it, and the strip keeps applying', () => {
  const h = new Harness(58600);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const other = spawn(h, A, 'The Everywhere');               // put into play: names nothing
  const namer = playEverywhere(h, A, 'The Everywhere');      // played: names itself as it is played
  assert.ok(h.q.abilitiesSuppressed(ent(h, namer)!), 'the namer loses its own abilities');
  assert.ok(h.q.abilitiesSuppressed(ent(h, other)!), 'and so does the copy beside it');
  assert.ok(h.q.suppressionOf(ent(h, other)!).by.includes('The Everywhere'),
    'the copy names The Everywhere as the culprit');
  // the stripped namer's silence is not switched off by its own strip
  assert.equal(ent(h, namer)!.named, 'The Everywhere', 'the naming is still remembered');
  assert.ok(h.q.abilitiesSuppressed(ent(h, namer)!), 'and still applies after the batch settles');
});
