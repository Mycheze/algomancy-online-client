/* THE FIT PASS (docs/18-board-layout-v2.md) — the arithmetic behind a board
 * that never scrolls. ui/fit.ts is DOM-free so this can prove it directly;
 * ui/layout.ts's fitBoard only measures and writes, and in the driver every
 * box is zero, so what it does is exactly what "zero box" is pinned to here.
 *
 * §1 nothing to fit is a no-op at the base width
 * §2 a zone with room keeps the base width; a crowded one shrinks, and never
 *    below the floor
 * §3 the answer is monotone in n (more cards never means bigger cards) and
 *    honours the height as well as the width (the 18/25 scans are taller than
 *    they are wide)
 * §4 past the floor the cards FAN: overlapped, never scrolled, never hidden —
 *    the owner's choice — and the step never drops under the 14px sliver
 * §5 the battle table counts columns and ranks
 * §6 the focus rule: the battle's region during a battle, yours otherwise
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBattle, fitCards } from '../fit.ts';
import { focusRegion } from '../layout.ts';
import type { GameState } from '../../engine/src/types.ts';

const O = { cw: 78, gap: 6 };

test('§1 no cards, or no box, is a no-op at the base width', () => {
  assert.deepEqual(fitCards(0, { w: 400, h: 200 }, O), { mode: 'grid', cw: 78, cols: 0, rows: 0 });
  assert.deepEqual(fitCards(5, { w: 0, h: 0 }, O), { mode: 'grid', cw: 78, cols: 0, rows: 0 });
  assert.deepEqual(fitBattle(3, 1, 1, { w: 0, h: 0 }, { cw: 78, gap: 14 }), { mode: 'grid', cw: 78, cols: 0, rows: 0 });
});

test('§2 room keeps the base width; a crowd shrinks it; the floor holds', () => {
  const roomy = fitCards(3, { w: 600, h: 300 }, O);
  assert.equal(roomy.mode, 'grid');
  assert.equal(roomy.cw, 78, 'three cards in a 600×300 box need no shrinking');
  const crowd = fitCards(12, { w: 400, h: 240 }, O);
  assert.equal(crowd.mode, 'grid');
  assert.ok(crowd.cw < 78 && crowd.cw >= 46, `12 cards in 400×240 shrink to ${crowd.cw}`);
  assert.ok(crowd.cols * crowd.rows >= 12, 'the grid it chose actually holds them');
  const tight = fitCards(20, { w: 300, h: 130 }, O);
  assert.ok(tight.cw >= 46, `never below the floor (got ${tight.cw})`);
});

test('§3 monotone in n, and the height counts as much as the width', () => {
  let last = Infinity;
  for (let n = 1; n <= 30; n++) {
    const p = fitCards(n, { w: 500, h: 260 }, O);
    assert.ok(p.cw <= last, `${n} cards got a bigger card (${p.cw}) than ${n - 1} did (${last})`);
    last = p.cw;
  }
  // a box that is wide enough for six abreast at 78 but only 60px tall
  const shallow = fitCards(6, { w: 600, h: 60 }, O);
  assert.ok(shallow.cw < 78, `a 60px-tall box cannot hold a 78px card (${Math.round(78 * 1.4)}px tall); got ${shallow.cw}`);
  assert.ok(shallow.mode === 'fan' || Math.round(shallow.cw * 1.4) <= 60);
});

test('§4 past the floor the cards fan, never scroll, never hide', () => {
  const p = fitCards(40, { w: 300, h: 120 }, O);
  assert.equal(p.mode, 'fan');
  assert.equal(p.cw, 46, 'fanned cards sit at the floor');
  assert.ok(p.step >= 14, `the fan step never drops under 14px (got ${p.step})`);
  assert.ok(p.rows >= 1 && p.cols * p.rows >= 40, 'every card has a place in the fan');
  // a fan whose row would fit at a wider step keeps the wider step
  const loose = fitCards(8, { w: 300, h: 60 }, O);
  assert.equal(loose.mode, 'fan');
  assert.ok(loose.step > 14, `8 cards across 300px step ${loose.step}px, not the minimum`);
});

test('§5 the battle table: columns across, ranks down', () => {
  const one = fitBattle(2, 1, 1, { w: 800, h: 300 }, { cw: 78, gap: 14 });
  assert.deepEqual(one, { mode: 'grid', cw: 78, cols: 2, rows: 2 });
  // two ranks a side is taller than one a side, so the same box gives a smaller card
  const deep = fitBattle(2, 2, 2, { w: 800, h: 300 }, { cw: 78, gap: 14 });
  assert.ok(deep.cw < one.cw, `four ranks in 300px shrink the card (${deep.cw} < ${one.cw})`);
  // nine columns in 500px cannot fit even at the floor: they fan
  const wide = fitBattle(9, 1, 1, { w: 500, h: 300 }, { cw: 78, gap: 14 });
  assert.equal(wide.mode, 'fan');
  assert.ok(wide.mode === 'fan' && wide.step >= 14);
});

test('§6 the focus region is the battle\'s during a battle, yours otherwise', () => {
  const base = {
    regions: [{ owner: 0, presentSeats: [0] }, { owner: 1, presentSeats: [1] }],
  } as unknown as GameState;
  const planning = { ...base, phase: 'planning', battle: null } as unknown as GameState;
  assert.equal(focusRegion(planning, 0), 0);
  assert.equal(focusRegion(planning, 1), 1);
  const battle = { ...base, phase: 'battle', battle: { region: 1 } } as unknown as GameState;
  assert.equal(focusRegion(battle, 0), 1, 'seat 0 attacking into region 1: the focus is region 1 for both seats');
  assert.equal(focusRegion(battle, 1), 1);
});
