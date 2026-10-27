/* THE RING ROUND THE FOCUS REGION (ui/layout.ts ringBoard; docs/18 § The
 * ring, § Round 7, § Board round 8).
 *
 * One path round the focus region's L — its full-width foot (info line and
 * In Play) and its column of the middle — GROWN, once the visiting player has
 * entered (owner 2026-09-23/26), over the part of THEIR info line that
 * travels with them: name and life, cache and bin. As before round 8 it is
 * one shape, and it takes in that stretch's width, not the column's (round
 * 7). Board round 8 put the visitor's line across the other region's In Play
 * from the column, so the ring reaches it through the far end of that In
 * Play, where its cards do not pack (theirs pack from the right, mine from
 * the left). Not visiting, the same points stand on the column's end, so the
 * entry tweens point for point. YOUR region's ring is open: it runs on down
 * round the action bar and the hand and off the window's foot (owner,
 * 2026-10-27). The layer is fixed over the window (`#app > .lring`).
 *
 * Driven on a stand-in DOM with the boxes of a board8 review board at
 * 1344×768 (the board 1288 wide, the lines 68 tall, the window 768 tall).
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
  const lboard = {
    getBoundingClientRect: () => rect(boxes['board']!), querySelector: (sel: string) => el(boxes[sel]),
    // the visitor line's name, cache and bin (`.linfo.X .lid, .linfo.X .lcache, .linfo.X .lbin`)
    querySelectorAll: (sel: string) => sel.split(', ').map(one => el(boxes[one])).filter(Boolean),
  };
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
const corners = (d: string): number => (d.match(/Q/g) ?? []).length;

/** a battle, the board 1288 wide: their foot (line + In Play) on top, mine at the bottom */
const FEET = {
  board: { l: 2, t: 2, r: 1290, b: 584 },
  '.lback.theirs.a': { l: 2, t: 2, r: 1290, b: 170 },
  '.lback.mine.a': { l: 2, t: 412, r: 1290, b: 584 },
  '.linfo.theirs': { l: 2, t: 2, r: 1290, b: 70 },
  '.linfo.mine': { l: 2, t: 516, r: 1290, b: 584 },
  // their name, cache and bin at the left of their line; mine at the right of mine
  '.linfo.theirs .lid': { l: 7, t: 10, r: 160, b: 60 }, '.linfo.theirs .lcache': { l: 168, t: 7, r: 296, b: 65 },
  '.linfo.theirs .lbin': { l: 306, t: 7, r: 362, b: 65 },
  '.linfo.mine .lbin': { l: 970, t: 521, r: 1026, b: 579 }, '.linfo.mine .lcache': { l: 1036, t: 521, r: 1164, b: 579 },
  '.linfo.mine .lid': { l: 1172, t: 530, r: 1285, b: 570 },
};
const FIGHT_THEIRS: Record<string, B> = { ...FEET,
  '.lback.theirs.b': { l: 648, t: 170, r: 1290, b: 410 }, '.lback.mine.b': { l: 2, t: 172, r: 646, b: 412 } };
const FIGHT_MINE: Record<string, B> = { ...FEET,
  '.lback.theirs.b': { l: 648, t: 170, r: 1290, b: 410 }, '.lback.mine.b': { l: 2, t: 172, r: 646, b: 412 } };
/** outside a battle: the middle collapsed to a band, each foot about half */
const HALVES: Record<string, B> = { ...FEET,
  '.lback.theirs.a': { l: 2, t: 2, r: 1290, b: 292 }, '.lback.theirs.b': { l: 647, t: 292, r: 1290, b: 298 },
  '.lback.mine.b': { l: 2, t: 296, r: 645, b: 302 }, '.lback.mine.a': { l: 2, t: 302, r: 1290, b: 594 } };

test('the ring grows over the visitor\'s name, cache and bin as ONE shape, at that stretch\'s width', () => {
  // their region, me in: down from their column round MY name, cache and bin,
  // no further left than my bin (and never left of the column)
  const d = board(FIGHT_THEIRS, 'top', true);
  assert.equal((d.match(/M/g) ?? []).length, 1, 'one path, no loop of its own');
  const pts = points(d);
  const low = pts.filter(p => p[1] > 580);
  assert.ok(low.length && Math.min(...low.map(p => p[0])) >= 970 - 6, `along the foot of my line from my bin (${Math.min(...low.map(p => p[0]))})`);
  assert.ok(pts.some(p => p[0] > 1280 && p[1] > 580), 'down the right edge to my line\'s foot');
  assert.ok(pts.some(p => p[0] < 660 && p[1] > 400 && p[1] < 412), 'and still round the whole column');
  assert.ok(d.endsWith('Z'), 'their region\'s ring closes');
  // my region, them in: up from my column round THEIR name, cache and bin,
  // no further right than their bin
  const m = board(FIGHT_MINE, 'bottom', true);
  assert.equal((m.match(/M/g) ?? []).length, 1);
  const up = points(m).filter(p => p[1] < 10);
  assert.ok(up.length && Math.max(...up.map(p => p[0])) <= 362 + 6, `along the top of their line to their bin (${Math.max(...up.map(p => p[0]))})`);
});

test('entering keeps the same points, so the entry tweens point for point', () => {
  for (const [boxes, ring] of [[FIGHT_MINE, 'bottom'], [FIGHT_THEIRS, 'top'], [HALVES, 'bottom'], [HALVES, 'top']] as const) {
    assert.equal(shape(board(boxes, ring, true)), shape(board(boxes, ring, false)), `${ring}: one command list in and out`);
    assert.equal(corners(board(boxes, ring, true)), corners(board(boxes, ring, false)));
  }
});

test('your region\'s ring runs off the window\'s foot with no bottom edge; theirs closes', () => {
  for (const visit of [false, true]) {
    const l = board(HALVES, 'bottom', visit);
    assert.ok(!l.endsWith('Z'), 'an open path');
    const pts = points(l);
    assert.ok(pts[0]![1] > VIEW.b && pts[pts.length - 1]![1] > VIEW.b, 'both ends below the window');
    assert.equal(pts[0]![0], 3.5, 'up the board\'s left edge');
    assert.equal(pts[pts.length - 1]![0], 1288.5, 'and down its right edge');
  }
  assert.ok(board(HALVES, 'top', false).endsWith('Z'), 'their region\'s ring closes, as it always did');
});

test('not visited, the ring is the L it always was — the visitor\'s points stand on the column\'s end', () => {
  const i = 1.5;
  const ta = HALVES['.lback.theirs.a']!, tb = HALVES['.lback.theirs.b']!;
  const ex = 970 - 6 + i;
  assert.equal(board(HALVES, 'top', false),
    roundedPath([[ta.l + i, ta.t + i], [ta.r - i, ta.t + i], [ta.r - i, tb.b - i], [ex, tb.b - i], [ex, tb.b - i],
      [tb.l + i, tb.b - i], [tb.l + i, ta.b - i], [ta.l + i, ta.b - i]], 8));
  const a = HALVES['.lback.mine.a']!, b = HALVES['.lback.mine.b']!, Y = VIEW.b + 8;
  const exm = 362 + 6 - i;
  assert.equal(board(HALVES, 'bottom', false),
    roundedPath([[a.l + i, Y], [a.l + i, b.t + i], [exm, b.t + i], [exm, b.t + i], [b.r - i, b.t + i], [b.r - i, a.t + i],
      [a.r - i, a.t + i], [a.r - i, Y]], 8, true));
});
