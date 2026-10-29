/**
 * BOARD ROUND 8, CHECKPOINT 4 (owner, 2026-10-29) — the pure arithmetic behind
 * the invader pile and the token stacks.
 *
 *   "invaders tend to be way too big, when they're largely irrelevant and can
 *    be kept generally smaller/overlapping themselves and fan out when hovered
 *    over"
 *   "Tokens of the same value could stack and just have a single count or fan
 *    out when hovered."
 *
 * A pile shows a sliver of each card under the top one (ui/fit.ts pileStepFrac)
 * and never grows past PILE_MAX card widths; a piled or stacked card's zoom
 * clears its row so the fan it opened stays in sight (ui/zoom.ts clearRow);
 * the token corner's summary goes beside the corner, never over it
 * (ui/infotip.ts cornerBox); and the current-text panel stands beside every
 * zoom, never on it (ui/zoom.ts panelBox — owner: "we should just always show
 * it so that players know where to look"). The markup is pinned by test/233 (the stacks and
 * the tip's table) and test/318 (where the corner and the pile stand).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILE_MAX, PILE_STEP, pileSpan, pileStepFrac } from '../fit.ts';
import { clearRow, panelBox } from '../zoom.ts';
import { cornerBox } from '../infotip.ts';

test('a pile shows a sliver of each card, and never spans more than PILE_MAX cards', () => {
  assert.equal(pileStepFrac(1), 0, 'one card is no pile');
  assert.equal(pileSpan(0), 0);
  assert.equal(pileSpan(1), 1);
  assert.equal(pileStepFrac(2), PILE_STEP, 'a short pile shows the full sliver');
  for (let n = 2; n <= 30; n++) {
    assert.ok(pileSpan(n) <= PILE_MAX + 1e-9, `${n} cards span ${pileSpan(n)} card widths`);
    assert.ok(pileStepFrac(n) > 0, `${n} cards: every card still shows an edge`);
  }
});

const VIEW = { w: 1440, h: 900 };

test('a piled card\'s zoom clears its row: above when there is room, else below, else as it was', () => {
  const box = { left: 600, top: 500, width: 240, height: 336 };
  const low = clearRow(box, { top: 470, bottom: 560 }, VIEW);
  assert.ok(low.top + low.height <= 470, 'a row low on the screen: the zoom stands wholly above it');
  assert.equal(low.left, box.left, 'and stays centred on the card across');
  const high = clearRow(box, { top: 90, bottom: 180 }, VIEW);
  assert.ok(high.top >= 180, 'a row near the top: wholly below it');
  const squeezed = clearRow(box, { top: 300, bottom: 600 }, { w: 1440, h: 700 });
  assert.deepEqual(squeezed, box, 'no room either side: the ordinary zoom');
});

test('the token corner\'s summary stands beside the corner, toward the middle, inside the window', () => {
  const tip = { width: 300, height: 120 };
  const mine = { left: 1100, top: 470, width: 280, height: 120 };
  const a = cornerBox(mine, tip, VIEW);
  assert.ok(a.left + tip.width <= mine.left, 'my corner is at the right: the tip is to its left, not over it');
  assert.equal(a.top + tip.height, mine.top + mine.height, 'level with its bottom edge (the zoom clears the row upward)');
  const theirs = { left: 10, top: 60, width: 200, height: 100 };
  const b = cornerBox(theirs, tip, VIEW);
  assert.ok(b.left >= theirs.left + theirs.width, 'their corner is at the left: the tip is to its right');
  assert.equal(b.top, theirs.top, 'level with its top edge');
  const edge = cornerBox({ left: 0, top: 850, width: 300, height: 40 }, tip, VIEW);
  assert.ok(edge.top + tip.height <= VIEW.h && edge.left >= 0, 'kept inside the window');
});

const overlaps = (a: { left: number; top: number; width: number; height: number }, b: typeof a): boolean =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

test('the current-text panel stands beside the zoom — right, else left, else under — never on it, inside the window', () => {
  const panel = { width: 270, height: 360 };
  const cases = [
    { left: 8, top: 255, width: 240, height: 336 },      // a card at the left edge: right of it
    { left: 1150, top: 300, width: 240, height: 336 },   // at the right edge: left of it
    { left: 600, top: 520, width: 240, height: 336 },    // low: pushed up inside the window
  ];
  for (const z of cases) {
    const at = panelBox(z, panel, VIEW);
    const p = { ...at, ...panel };
    assert.equal(overlaps(p, z), false, `panel ${JSON.stringify(at)} covers the zoom ${JSON.stringify(z)}`);
    assert.ok(p.left >= 0 && p.top >= 0 && p.left + p.width <= VIEW.w && p.top + p.height <= VIEW.h, 'inside the window');
  }
  assert.ok(panelBox(cases[0]!, panel, VIEW).left > cases[0]!.left, 'room on the right: the right');
  assert.ok(panelBox(cases[1]!, panel, VIEW).left < cases[1]!.left, 'none there: the left');
  // a phone-narrow window: no room either side, so under (or over) the zoom
  const narrow = { w: 420, h: 900 };
  const z = { left: 90, top: 100, width: 240, height: 336 };
  const at = panelBox(z, panel, narrow);
  assert.equal(overlaps({ ...at, ...panel }, z), false, 'a narrow window still keeps the panel off the zoom');
});
