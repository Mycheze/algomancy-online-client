/* 357 — THE CARD BEING PLAYED COVERS NOTHING (owner, 2026-09-30).
 *
 * "the little 'being cast' window can't overlap anything! It's impossible to
 * see right now" — the card waiting at the table's bottom-left sat on top of
 * the regions board's own units, one of them the sacrifice it was asking for.
 * ui/freespot.ts finds the nearest spot to that corner that overlaps nothing;
 * main.ts placeCasting feeds it the measured page. The page itself is checked
 * in a real browser (the review board vengeance-taxes-their-play); this pins
 * the geometry the browser run relies on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeSpot, type Rect } from '../freespot.ts';

const TABLE: Rect = { l: 0, t: 0, r: 1000, b: 600 };
const W = 80, H = 112;
const CORNER = { x: 14, y: 600 - 14 - H };
const hits = (x: number, y: number, o: Rect, gap = 6): boolean =>
  x < o.r + gap && x + W > o.l - gap && y < o.b + gap && y + H > o.t - gap;

test('357 §1 an empty corner is used as it is', () => {
  const at = freeSpot(TABLE, W, H, [], CORNER);
  assert.deepEqual([at.x, at.y, at.covered], [CORNER.x, CORNER.y, 0]);
});

test('357 §2 units standing in the corner push the card off them, not under them', () => {
  // the owner's board: two units along the bottom-left of the table
  const units: Rect[] = [{ l: 10, t: 440, r: 100, b: 580 }, { l: 104, t: 440, r: 194, b: 580 }];
  const at = freeSpot(TABLE, W, H, units, CORNER);
  assert.equal(at.covered, 0, 'there is room on this table, so the card covers nothing');
  for (const u of units) assert.ok(!hits(at.x, at.y, u), `the card at ${at.x},${at.y} touches a unit`);
  // and it stays as near the corner as it can: right beside or just above them
  assert.ok(Math.hypot(at.x - CORNER.x, at.y - CORNER.y) < 200, `it wandered to ${at.x},${at.y}`);
});

test('357 §3 a table with no free spot still shows the card, where it covers least', () => {
  const walls: Rect[] = [{ l: 0, t: 0, r: 1000, b: 300 }, { l: 0, t: 300, r: 1000, b: 600 }];
  const at = freeSpot(TABLE, W, H, walls, CORNER);
  assert.ok(at.covered > 0 && Number.isFinite(at.x) && Number.isFinite(at.y));
  assert.ok(at.x >= TABLE.l && at.x + W <= TABLE.r && at.y >= TABLE.t && at.y + H <= TABLE.b,
    'even with nowhere free, it stays on the table');
});

test('357 §4 a gap that only fits flush against the edge is found', () => {
  // everything covered except a strip exactly one card wide at the far right
  const block: Rect[] = [{ l: 0, t: 0, r: 1000 - W - 6, b: 600 }];
  const at = freeSpot(TABLE, W, H, block, CORNER);
  assert.equal(at.covered, 0);
  assert.equal(at.x, 1000 - W);
});
