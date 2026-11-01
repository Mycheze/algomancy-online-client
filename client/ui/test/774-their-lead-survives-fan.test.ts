/* Their units start at the seam, fanned or not (owner, 2026-11-01, game EMNR).
 *
 * "Every action it was flickering over to the left, then back. When I
 * targeted her unit, I had to click it waaaay on the other side … Only once
 * she had that unit with a bunch of mods did it freak out." Installed app,
 * fullscreen 3:2, one notch of page zoom.
 *
 * Gember's band was 83px tall and her 2/2 with four mod strips needed 83px at
 * the floor card width, so a fraction of a pixel (110% zoom) tipped the fit
 * from grid to fan. A fan used to get NO lead (ui/layout.ts theirLead), so the
 * one card jumped from the seam to the far left. Reproduced in a real browser
 * on a slice of EMNR at action 237 with the band held to 82.4px: fitmode fan,
 * --lead 0px, the card at x 7 instead of at the seam (613).
 *
 *   §1 ⭐ a one-card fan gets the same lead as a one-card grid
 *   §2 a fan that spans the band leaves no room, so no lead
 *   §3 the lead is still capped by what the row leaves free, and never negative
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadPx } from '../layout.ts';

// EMNR at 1280×800: the seam 606px into a 1206px zone, one 46px card
const TO_SEAM = 606, ROOM = 1206;

test('§1 a one-card fan starts at the seam, as a one-card grid does', () => {
  const grid = leadPx(TO_SEAM, ROOM, 1, 46, null);
  assert.equal(grid, 606);
  assert.equal(leadPx(TO_SEAM, ROOM, 1, 46, 0), grid, 'the fan of one (step 0) is the same row');
});

test('§2 a fan that spans the band has no lead', () => {
  // fitCards: step = (w - floor) / (perRow - 1), so the row reaches the far edge
  const n = 40, step = Math.floor((ROOM - 46) / (n - 1));
  assert.equal(leadPx(TO_SEAM, ROOM, n, 46, step), 0);
});

test('§3 capped by the free room, never negative, nothing without cards', () => {
  // 12 cards of 46 + 11 gaps of 6 = 618; 1206 - 618 = 588 < 606
  assert.equal(leadPx(TO_SEAM, ROOM, 12, 46, null), 588);
  assert.equal(leadPx(TO_SEAM, ROOM, 30, 46, null), 0);
  assert.equal(leadPx(TO_SEAM, ROOM, 0, 46, null), 0);
  assert.equal(leadPx(TO_SEAM, ROOM, 3, 0, null), 0);
  // a short fan (5 cards, step 20) leaves room: row 46 + 4 × 26 = 150
  assert.equal(leadPx(TO_SEAM, ROOM, 5, 46, 20), 606);
});
