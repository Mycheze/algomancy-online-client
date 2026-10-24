/* 630 — guards for two hygiene tickets whose fix was text no other test reads.
 *
 * CT-293: CT-286 split counter removals out of 'countersChanged' into their own
 * 'countersRemoved' event, and ledgers/claims.ts's EVIDENCE table (which says
 * what event proves a card's "counters" clause did something) did not know the
 * new type. The guard is DERIVED: every event type in types.ts whose name
 * starts with "counters" must be evidence for a counters claim, so the next
 * split cannot be missed either.
 *
 * CT-347: docs/16 and docs/12 described Wake the Dead and The Bonesculptor as
 * they were before CT-245 and CT-255. Nothing read either file, so nothing
 * noticed. The guard reads the two corrected sentences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_DOCS_DIR, ENGINE_SRC_DIR } from '../scripts/paths.mjs';
import { EVIDENCE } from '../../ledgers/claims.ts';

test('CT-293: every counters event type in types.ts is evidence for a counters claim', () => {
  const types = readFileSync(join(ENGINE_SRC_DIR, 'types.ts'), 'utf8');
  const counterEvents = [...new Set([...types.matchAll(/\|\s*'(counters[A-Z]\w*)'/g)].map(m => m[1]!))].sort();
  // positive control: the derivation sees both the old event and the split-off one
  assert.ok(counterEvents.includes('countersChanged') && counterEvents.includes('countersRemoved'),
    `the derivation reads the event union (found ${counterEvents.join(', ') || 'nothing'})`);
  const missing = counterEvents.filter(t => !(EVIDENCE.counters as string[]).includes(t));
  assert.deepEqual(missing, [], 'a counters event that EVIDENCE.counters does not list');
});

test('CT-347: docs/16 marks PLAY-VS-PUT-INTO-PLAY fixed, and docs/12 says no card reaches the [Once] fallback', () => {
  const inventory = readFileSync(join(CLIENT_DOCS_DIR, '16-divergence-inventory.md'), 'utf8');
  const row = inventory.split('\n').find(l => l.startsWith('| **PLAY-VS-PUT-INTO-PLAY**'));
  assert.ok(row, 'the PLAY-VS-PUT-INTO-PLAY row is in the inventory table');
  assert.match(row!, /FIXED 2026-10-22 \(CT-245, CT-255\)/, 'and it is marked fixed');
  const cardText = readFileSync(join(CLIENT_DOCS_DIR, '12-card-text.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(cardText, /but no card reaches that fallback any more/, 'docs/12 no longer sends two cards to [Once]');
});
