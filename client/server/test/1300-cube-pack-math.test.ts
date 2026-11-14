/* Cube draft §3: the pack math (docs/25-cube-draft.md §1, §3).
 *
 * §1 the base five elements are 320 deck cards, and a full table of 8 gets 3 packs of 13
 * §2 a pool too small for the table is refused (pack size under 5), and the host's overrides are
 *    checked against the pool, never trusted
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftDeckList } from '../../engine/src/cards/registry.ts';
import { packMath } from '../cube-draft.ts';

const BASE = draftDeckList(['fire', 'water', 'earth', 'wood', 'metal']);

test('cube §1 base five → 320 cards → 8 seats get 3 packs of 13', () => {
  assert.equal(BASE.length, 320);
  assert.deepEqual(packMath(BASE.length, 8, null, null), { seats: 8, packs: 3, packSize: 13, ok: true });
  // a smaller table caps at 15 a pack
  assert.deepEqual(packMath(BASE.length, 2, null, null), { seats: 2, packs: 3, packSize: 15, ok: true });
  // 12 seats: floor(320 / 36) = 8
  assert.equal(packMath(BASE.length, 12, null, null).packSize, 8);
});

test('cube §2 too small a pool, or an override it cannot deal, is not ok', () => {
  assert.equal(packMath(40, 8, null, null).ok, false, '40 / 24 = 1 card a pack');
  assert.equal(packMath(40, 8, null, null).packSize, 1);
  assert.equal(packMath(120, 8, null, null).ok, false, '3 packs of 5 = 15 picks: nobody could build a 30-card deck');
  assert.equal(packMath(240, 8, null, null).ok, true, '3 packs of 10 = 30 picks, the fewest that build a deck');
  assert.equal(packMath(239, 8, null, null).ok, false, '3 packs of 9 = 27 picks');
  assert.equal(packMath(BASE.length, 8, 6, 5).ok, true, '6 packs of 5 = 30 picks is enough');
  assert.equal(packMath(BASE.length, 8, 3, 14).ok, false, '8 × 3 × 14 = 336 > 320');
  assert.equal(packMath(BASE.length, 8, 3, 4).ok, false, 'a pack of 4 is too small even when it fits');
  assert.deepEqual(packMath(BASE.length, 8, 4, null), { seats: 8, packs: 4, packSize: 10, ok: true });
  assert.equal(packMath(BASE.length, 0, null, null).ok, false, 'no seats');
  assert.equal(packMath(BASE.length, 8, 0, 10).ok, false, 'no packs');
});
