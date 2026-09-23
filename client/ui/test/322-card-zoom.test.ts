/* 322 — THE CARD ZOOM'S GEOMETRY (ui/zoom.ts, owner 2026-09-23).
 *
 * The zoom itself is a mouse effect and test/ui-driver.ts dispatches no
 * mouseover, so what is pinned here is the decision: where the copy goes and
 * whether a card is worth zooming. The browser walk (a real hover on a field
 * card, a hand card at the bottom edge and a resource) is what proved the
 * wiring, 2026-09-23.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomBox, ZOOM_W } from '../zoom.ts';

const VIEW = { w: 1344, h: 768 };

test('a small card zooms to the zoom width, keeping its aspect, centred on itself', () => {
  const b = zoomBox({ left: 500, top: 300, width: 80, height: 112 }, VIEW)!;
  assert.equal(b.width, ZOOM_W);
  assert.equal(Math.round(b.height), Math.round(ZOOM_W * 1.4));
  assert.equal(Math.round(b.left + b.width / 2), 540);
  assert.equal(Math.round(b.top + b.height / 2), 356);
});

test('at the bottom edge it grows UP (a hand card), at the top edge DOWN, and never off the side', () => {
  const hand = zoomBox({ left: 10, top: 690, width: 76, height: 106 }, VIEW)!;
  assert.ok(hand.top + hand.height <= VIEW.h - 8 + 0.01, 'inside the bottom edge');
  assert.ok(hand.top < 690, 'it rose');
  assert.equal(hand.left, 8, 'pushed in from the left edge');
  const top = zoomBox({ left: 1300, top: 4, width: 40, height: 56 }, VIEW)!;
  assert.equal(top.top, 8);
  assert.ok(top.left + top.width <= VIEW.w - 8 + 0.01, 'pushed in from the right edge');
});

test('never taller than the window; nothing to do for a card already that big', () => {
  const short = zoomBox({ left: 100, top: 100, width: 60, height: 84 }, { w: 1000, h: 300 })!;
  assert.ok(short.height <= 300 - 16 + 0.01);
  assert.ok(Math.abs(short.height / short.width - 1.4) < 1e-9, 'aspect kept while shrinking');
  assert.equal(zoomBox({ left: 0, top: 0, width: 200, height: 280 }, VIEW), null, 'a dialog-sized card is left alone');
  assert.equal(zoomBox({ left: 0, top: 0, width: 0, height: 0 }, VIEW), null, 'an unmeasured card is left alone');
});
