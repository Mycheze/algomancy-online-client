/* 322 — THE CARD ZOOM'S GEOMETRY (ui/zoom.ts, owner 2026-09-23).
 *
 * The zoom itself is a mouse effect and test/ui-driver.ts dispatches no
 * mouseover, so what is pinned here is the decision: where the copy goes and
 * whether a card is worth zooming. The browser walk (a real hover on a field
 * card, a hand card at the bottom edge and a resource) is what proved the
 * wiring, 2026-09-23.
 *
 * Round 4 (owner, 2026-09-26) added two more decisions: room for the mod
 * strips that hang under a zoomed unit, and where a card's menu goes while the
 * card is held zoomed. The wiring — strips, dice, the hold, the pointer check —
 * was proved by a CDP walk with real mouse events (a draft-dock click that used
 * to strand the zoom, a right-click and a recycle menu held beside the card).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuBeside, zoomBox, ZOOM_W } from '../zoom.ts';

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

test('mod strips: the CARD stays centred on its source; the strips only count against the window edge', () => {
  const card = { left: 500, top: 300, width: 80, height: 112 };
  const bare = zoomBox(card, VIEW)!;
  const modded = zoomBox(card, VIEW, ZOOM_W, 0.3)!;
  assert.equal(modded.top, bare.top, 'mid-screen: the card is where it was, the strips just hang lower');
  assert.ok(Math.abs(modded.height - bare.height * 1.3) < 1e-9, 'the box is the whole copy, strips included');
  // a modded unit in the bottom row rises far enough to show its strips
  const low = zoomBox({ left: 500, top: 600, width: 80, height: 112 }, VIEW, ZOOM_W, 0.3)!;
  assert.ok(low.top + low.height <= VIEW.h - 8 + 0.01, 'strips inside the bottom edge');
  // and on a short window the whole stack is what must fit
  const short = zoomBox({ left: 100, top: 100, width: 60, height: 84 }, { w: 1000, h: 400 }, ZOOM_W, 0.5)!;
  assert.ok(short.height <= 400 - 16 + 0.01);
});

test('a held card\'s menu: at the click when that is clear of the zoom, else beside it', () => {
  const zoom = { left: 8, top: 300, width: 240, height: 333 };
  const menu = { width: 200, height: 150 };
  // the click is on the card, under the zoom: the menu goes to its right
  assert.deepEqual(menuBeside(zoom, menu, VIEW, { x: 60, y: 400 }), { left: 258, top: 400 });
  // clear of the zoom already: left alone
  assert.deepEqual(menuBeside(zoom, menu, VIEW, { x: 600, y: 400 }), { left: 600, top: 400 });
  // no room on the right: the left
  const right = { left: 1100, top: 300, width: 240, height: 333 };
  assert.deepEqual(menuBeside(right, menu, VIEW, { x: 1150, y: 400 }), { left: 1100 - 10 - 200, top: 400 });
  // near the bottom it is lifted inside the window, still level-ish with the click
  assert.equal(menuBeside(zoom, menu, VIEW, { x: 60, y: 760 }).top, VIEW.h - 150 - 8);
  // no room either side: stays put (it outranks the zoom layer, so it is still on top)
  const wide = { left: 100, top: 0, width: 1144, height: 700 };
  assert.deepEqual(menuBeside(wide, menu, VIEW, { x: 500, y: 200 }), { left: 500, top: 200 });
});
