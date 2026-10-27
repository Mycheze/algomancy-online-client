/* THE RING ROUND THE FOCUS REGION (ui/layout.ts ringBoard; docs/18 § The
 * ring, § Round 7, § Board round 8).
 *
 * One path round the focus region's L — its info line (the foot) and its
 * column — grown over the visiting player's info line once they have entered
 * (owner 2026-09-23/26). Board round 8 (owner, 2026-10-27) changed two things:
 *
 *   - the info lines are the board's full width, so the ring takes in the
 *     visitor's line only where it runs under (over) the region's column —
 *     round the whole line it would box the other region's column in on
 *     three sides. Entering only lengthens the column: six points either way,
 *     so the entry still tweens point for point.
 *   - YOUR region's ring is open: it runs on down both sides, round the
 *     action bar and the hand, and off the window's foot, with no bottom edge.
 *     The layer is fixed over the window (`#app > .lring`), outside the board.
 *
 * Driven on a stand-in DOM with the boxes of a board8 review board at
 * 1344×768 (the board 1088 wide, the lines 60 tall, the window 768 tall).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringBoard, roundedPath } from '../layout.ts';

type B = { l: number; t: number; r: number; b: number };
const rect = (x: B) => ({ left: x.l, top: x.t, right: x.r, bottom: x.b, width: x.r - x.l, height: x.b - x.t, x: x.l, y: x.t });
const VIEW: B = { l: 0, t: 0, r: 1344, b: 768 };

/** a board with these boxes, the ring on `ring`, the visitor in or not */
function board(boxes: Record<string, B>, ring: 'top' | 'bottom', visit: boolean) {
  const attrs = new Map<string, string>();
  const path = { setAttribute: (k: string, v: string) => { attrs.set(k, v); }, removeAttribute: (k: string) => { attrs.delete(k); }, getAnimations: () => [] };
  const el = (b: B | undefined) => (b ? { getBoundingClientRect: () => rect(b) } : null);
  const lboard = { getBoundingClientRect: () => rect(boxes['board']!), querySelector: (sel: string) => el(boxes[sel]) };
  const svg = {
    dataset: { ring, visit: visit ? '1' : '0' }, getBoundingClientRect: () => rect(VIEW),
    querySelector: (sel: string) => (sel === 'path' ? path : null), getAttribute: () => `lring rc${ring === 'top' ? 1 : 0}`,
  };
  const root = { querySelector: (sel: string) => (sel === '#app > .lring' ? svg : sel === '.lboard' ? lboard : null) } as unknown as ParentNode;
  ringBoard(root, false);
  return attrs.get('d') ?? '';
}
/** every point a path passes through (the ends of its lines and curves) */
const points = (d: string): Array<[number, number]> =>
  [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)|Q[\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+)/g)]
    .map(m => (m[1] !== undefined ? [+m[1], +m[2]!] : [+m[3]!, +m[4]!]) as [number, number]);
const shape = (d: string): string => d.replace(/[\d.-]+/g, '');

/** the fight in my (left) column, wide */
const FIGHT_MINE: Record<string, B> = {
  board: { l: 2, t: 2, r: 1090, b: 584 },
  '.lback.theirs.a': { l: 2, t: 2, r: 1090, b: 62 },
  '.lback.theirs.b': { l: 820, t: 62, r: 1090, b: 522 },
  '.lback.mine.a': { l: 2, t: 524, r: 1090, b: 584 },
  '.lback.mine.b': { l: 2, t: 64, r: 818, b: 524 },
};
/** the fight in THEIR (right) column, wide */
const FIGHT_THEIRS: Record<string, B> = {
  board: { l: 2, t: 2, r: 1090, b: 584 },
  '.lback.theirs.a': { l: 2, t: 2, r: 1090, b: 62 },
  '.lback.theirs.b': { l: 276, t: 62, r: 1090, b: 522 },
  '.lback.mine.a': { l: 2, t: 524, r: 1090, b: 584 },
  '.lback.mine.b': { l: 2, t: 64, r: 274, b: 524 },
};
/** outside a battle: the columns half and half */
const HALVES: Record<string, B> = {
  board: { l: 2, t: 2, r: 1090, b: 594 },
  '.lback.theirs.a': { l: 2, t: 2, r: 1090, b: 62 },
  '.lback.theirs.b': { l: 547, t: 62, r: 1090, b: 532 },
  '.lback.mine.a': { l: 2, t: 534, r: 1090, b: 594 },
  '.lback.mine.b': { l: 2, t: 64, r: 545, b: 534 },
};

test('the ring takes in the visitor\'s line only where it runs under the region\'s column', () => {
  // my region, the attacker in: up over THEIR line, but no further right than my column
  const pts = points(board(FIGHT_MINE, 'bottom', true));
  const alongTop = pts.filter(p => p[1] < 10).map(p => p[0]);
  assert.ok(alongTop.length, 'the ring reaches their line');
  assert.ok(Math.max(...alongTop) <= 818, `…only over my column (reached ${Math.max(...alongTop)}px, the column ends at 818)`);
  // their region, me in: down over MY line, from their column's edge
  const pb = points(board(FIGHT_THEIRS, 'top', true));
  const alongBottom = pb.filter(p => p[1] > 575 && p[1] < 600).map(p => p[0]);
  assert.ok(alongBottom.length && Math.min(...alongBottom) >= 276, `…from their column's edge (reached ${Math.min(...alongBottom)}px)`);
});

test('entering keeps the same points, so the entry tweens point for point', () => {
  for (const [boxes, ring] of [[FIGHT_MINE, 'bottom'], [FIGHT_THEIRS, 'top'], [HALVES, 'bottom'], [HALVES, 'top']] as const) {
    assert.equal(shape(board(boxes, ring, true)), shape(board(boxes, ring, false)), `${ring}: one command list in and out`);
  }
});

test('your region\'s ring runs off the window\'s foot with no bottom edge; theirs closes', () => {
  for (const visit of [false, true]) {
    const d = board(HALVES, 'bottom', visit);
    assert.ok(!d.endsWith('Z'), 'an open path');
    const pts = points(d);
    assert.ok(pts[0]![1] > VIEW.b && pts[pts.length - 1]![1] > VIEW.b, 'both ends below the window');
    assert.equal(pts[0]![0], 3.5, 'up the board\'s left edge');
    assert.equal(pts[pts.length - 1]![0], 1088.5, 'and down its right edge');
  }
  assert.ok(board(HALVES, 'top', false).endsWith('Z'), 'their region\'s ring closes, as it always did');
});

test('outside a battle the ring is the L it always was — and mine stays open below', () => {
  const i = 1.5;
  const ta = HALVES['.lback.theirs.a']!, tb = HALVES['.lback.theirs.b']!;
  assert.equal(board(HALVES, 'top', false),
    roundedPath([[ta.l + i, ta.t + i], [ta.r - i, ta.t + i], [ta.r - i, tb.b - i], [tb.l + i, tb.b - i], [tb.l + i, ta.b - i], [ta.l + i, ta.b - i]], 8));
  const a = HALVES['.lback.mine.a']!, b = HALVES['.lback.mine.b']!, Y = VIEW.b + 8;
  assert.equal(board(HALVES, 'bottom', false),
    roundedPath([[a.l + i, Y], [a.l + i, b.t + i], [b.r - i, b.t + i], [b.r - i, a.t + i], [a.r - i, a.t + i], [a.r - i, Y]], 8, true));
});
