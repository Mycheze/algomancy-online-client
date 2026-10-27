/* THE RING ROUND THE FOCUS REGION (ui/layout.ts ringBoard; docs/18 § The
 * ring, § Round 7, § Board round 8).
 *
 * One path round the focus region's L — its full-width foot (info line and
 * In Play) and its column of the middle — and, once the visiting player has
 * entered (owner 2026-09-23/26), round the part of THEIR info line that
 * travels with them: name and life, cache and bin. Board round 8 (owner,
 * 2026-10-27, after the first review) put that line across the other
 * region's In Play from the column, so it is a loop of its own — a point
 * until they enter, so the entry still tweens point for point. YOUR region's
 * ring is open: it runs on down round the action bar and the hand and off the
 * window's foot. The layer is fixed over the window (`#app > .lring`).
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
/** the path's two subpaths: the L, and the visitor's loop */
const parts = (d: string): [string, string] => { const i = d.lastIndexOf(' M'); return [d.slice(0, i), d.slice(i + 1)]; };

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

test('the visitor\'s name, cache and bin are ringed as a loop of their own, round their line only', () => {
  // their region, me in: a loop round MY name, cache and bin, along my line
  const [, mine] = parts(board(FIGHT_THEIRS, 'top', true));
  const pm = points(mine);
  assert.ok(Math.min(...pm.map(p => p[0])) >= 970 - 6 && Math.max(...pm.map(p => p[0])) <= 1290, 'from my bin to the line\'s end');
  assert.ok(pm.every(p => p[1] >= 516 && p[1] <= 584), 'on my info line, not across my In Play');
  assert.ok(mine.endsWith('Z'), 'a closed loop');
  // my region, them in: round THEIR name, cache and bin, along their line
  const [, theirs] = parts(board(FIGHT_MINE, 'bottom', true));
  const pt = points(theirs);
  assert.ok(Math.max(...pt.map(p => p[0])) <= 362 + 6 && pt.every(p => p[1] >= 2 && p[1] <= 70));
});

test('entering keeps the same points, so the entry tweens point for point', () => {
  for (const [boxes, ring] of [[FIGHT_MINE, 'bottom'], [FIGHT_THEIRS, 'top'], [HALVES, 'bottom'], [HALVES, 'top']] as const) {
    assert.equal(shape(board(boxes, ring, true)), shape(board(boxes, ring, false)), `${ring}: one command list in and out`);
  }
  // not visiting, the loop is a single point: nothing is drawn
  const [, loop] = parts(board(FIGHT_THEIRS, 'top', false));
  assert.equal(new Set(points(loop).map(p => p.join(','))).size, 1);
});

test('your region\'s ring runs off the window\'s foot with no bottom edge; theirs closes', () => {
  for (const visit of [false, true]) {
    const [l] = parts(board(HALVES, 'bottom', visit));
    assert.ok(!l.endsWith('Z'), 'an open path');
    const pts = points(l);
    assert.ok(pts[0]![1] > VIEW.b && pts[pts.length - 1]![1] > VIEW.b, 'both ends below the window');
    assert.equal(pts[0]![0], 3.5, 'up the board\'s left edge');
    assert.equal(pts[pts.length - 1]![0], 1288.5, 'and down its right edge');
  }
  assert.ok(parts(board(HALVES, 'top', false))[0].endsWith('Z'), 'their region\'s ring closes, as it always did');
});

test('outside a battle the ring is the L it always was — their foot and the band of the middle — and mine stays open below', () => {
  const i = 1.5;
  const ta = HALVES['.lback.theirs.a']!, tb = HALVES['.lback.theirs.b']!;
  assert.equal(parts(board(HALVES, 'top', false))[0],
    roundedPath([[ta.l + i, ta.t + i], [ta.r - i, ta.t + i], [ta.r - i, tb.b - i], [tb.l + i, tb.b - i], [tb.l + i, ta.b - i], [ta.l + i, ta.b - i]], 8));
  const a = HALVES['.lback.mine.a']!, b = HALVES['.lback.mine.b']!, Y = VIEW.b + 8;
  assert.equal(parts(board(HALVES, 'bottom', false))[0],
    roundedPath([[a.l + i, Y], [a.l + i, b.t + i], [b.r - i, b.t + i], [b.r - i, a.t + i], [a.r - i, a.t + i], [a.r - i, Y]], 8, true));
});
