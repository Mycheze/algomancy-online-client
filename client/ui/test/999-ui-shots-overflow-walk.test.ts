/* 999 — UI-SHOTS' OVERFLOW WALK SAYS WHAT IS REALLY PAST THE SCREEN
 * (design-system round, 2026-11-03, stream ds-w3b).
 *
 * client/server/e2e/ui-shots-overflow.mjs is the walk ui-shots runs in every
 * shot. Two things made its list untrue (its header says how):
 *  - every column of a deliberately scrolling table was "past the right edge"
 *    (card stats, the challenge boards, the admin tables on a phone);
 *  - it measured against innerWidth, which a touch viewport grows to fit a page
 *    that is too wide, so the page running past the screen (the league's open
 *    time form on a phone) never showed.
 *
 * Here the walk runs on a made-up page, as the SOURCE TEXT ui-shots ships to
 * Chrome (so it closes over nothing), in a context with no DOM but the fake.
 *
 * §1 inside a scroller that fits, a far column is not an overflow; scrolled
 *    away entirely, neither; a scroller that is itself past the screen still is
 * §2 with no scroller, past the edge is past the edge; an ancestor that CLIPS
 *    is still reported as clipping
 * §3 the window is the width ui-shots set, not innerWidth, and ui-shots passes it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { overflowJs } from '../../server/e2e/ui-shots-overflow.mjs';

interface Box { left: number; right: number }
interface Fake { cls: string; box: Box; ox?: string; text?: string; kids?: Fake[] }
interface El {
  className: string; textContent: string; parentElement: El | null; ox: string;
  getBoundingClientRect(): { left: number; right: number; width: number; height: number };
}

/** run the walk over a tree of made-up elements under body; the leaves are the controls */
function walk(tree: Fake[], W: number, page: { scrollW?: number; innerWidth?: number } = {}) {
  const body: El = { className: '', textContent: '', parentElement: null, ox: 'visible', getBoundingClientRect: () => ({ left: 0, right: W, width: W, height: 10 }) };
  const controls: El[] = [];
  const build = (f: Fake, parent: El): void => {
    const el: El = {
      className: f.cls, textContent: f.text ?? f.cls, parentElement: parent, ox: f.ox ?? 'visible',
      getBoundingClientRect: () => ({ left: f.box.left, right: f.box.right, width: f.box.right - f.box.left, height: 20 }),
    };
    if (f.kids?.length) for (const k of f.kids) build(k, el);
    else controls.push(el);
  };
  for (const f of tree) build(f, body);
  const sandbox = {
    document: { body, documentElement: { scrollWidth: page.scrollW ?? W, scrollHeight: 900 }, querySelectorAll: () => controls },
    getComputedStyle: (e: El) => ({ overflowX: e.ox }),
    innerHeight: 900, innerWidth: page.innerWidth ?? W,
  };
  return runInNewContext(overflowJs(W), sandbox) as { scrollW: number; W: number; bad: { text: string; why: string }[] };
}
// Array.from: the walk's arrays are the vm context's, which deepEqual will not take for this realm's
const flagged = (r: ReturnType<typeof walk>): string[] => Array.from(r.bad, b => `${b.text}:${b.why}`);

test('999 §1 a deliberate scroller is not an overflow; a scroller past the screen is', () => {
  const table = (scroller: Box, cell: Box): Fake[] =>
    [{ cls: 'cstablewrap', ox: 'auto', box: scroller, kids: [{ cls: 'row', box: { left: 0, right: 900 }, kids: [{ cls: 'cssort', box: cell }] }] }];
  assert.deepEqual(flagged(walk(table({ left: 16, right: 374 }, { left: 600, right: 680 }), 390)), [],
    'a far column of a table that scrolls inside the screen');
  assert.deepEqual(flagged(walk(table({ left: 16, right: 374 }, { left: 300, right: 420 }), 390)), [],
    'a column half under the scroller\'s edge');
  assert.deepEqual(flagged(walk(table({ left: 16, right: 480 }, { left: 400, right: 470 }), 390)), ['cssort:right>W'],
    'the scroller itself runs past the screen: what it shows is past it too');
  assert.deepEqual(flagged(walk(table({ left: 16, right: 374 }, { left: -300, right: -200 }), 390)), [],
    'scrolled out of view to the left: reached by scrolling back');
  // overflow-x computes to auto when only overflow-y is set (a max-height list): it scrolls, so the same
  assert.deepEqual(flagged(walk([{ cls: 'lglog', ox: 'scroll', box: { left: 0, right: 380 }, kids: [{ cls: 'x', box: { left: 370, right: 395 } }] }], 390)), []);
});

test('999 §2 with no scroller, past the edge is past the edge; a clipping ancestor is reported', () => {
  assert.deepEqual(flagged(walk([{ cls: 'lgtimeform', box: { left: 250, right: 480 }, kids: [{ cls: 'primary', box: { left: 400, right: 460 } }] }], 390)),
    ['primary:right>W'], 'the league\'s Suggest button past a phone\'s edge');
  assert.deepEqual(flagged(walk([{ cls: 'x', box: { left: -10, right: 50 } }], 390)), ['x:left<0']);
  assert.deepEqual(flagged(walk([{ cls: 'card', ox: 'hidden', box: { left: 0, right: 300 }, kids: [{ cls: 'b', box: { left: 280, right: 350 } }] }], 390)),
    ['b:clipped by .card'], 'cut off by a box that hides its overflow');
  assert.deepEqual(flagged(walk([{ cls: 'card', ox: 'clip', box: { left: 0, right: 420 }, kids: [{ cls: 'b', box: { left: 380, right: 440 } }] }], 390)),
    ['b:right>W,clipped by .card'], 'both, as before');
  assert.deepEqual(flagged(walk([{ cls: 'fits', box: { left: 16, right: 374 } }], 390)), [], 'positive control: a control that fits');
});

test('999 §3 the window is the viewport ui-shots set, not a zoomed-out innerWidth', () => {
  const r = walk([{ cls: 'lgtimeform', box: { left: 250, right: 470 }, kids: [{ cls: 'go', box: { left: 400, right: 460 } }] }],
    390, { scrollW: 481, innerWidth: 481 });
  assert.equal(r.W, 390, 'the width it was given');
  assert.ok(r.scrollW > r.W, 'so ui-shots\' horizontal (scrollW > W) is true for a 481px page on a 390px phone');
  assert.deepEqual(flagged(r), ['go:right>W'], 'and the button at 460px is past the phone\'s edge');
  const shots = readFileSync(new URL('../../server/e2e/ui-shots.mjs', import.meta.url), 'utf8');
  assert.match(shots, /P\.ev\(overflowJs\(P\.vp\.w\)\)/, 'ui-shots runs the walk with the viewport it emulates');
  assert.match(shots, /horizontal: ov\.scrollW > ov\.W/);
  assert.doesNotMatch(shots, /const OVERFLOW_JS/, 'and keeps no second copy of the walk');
});
