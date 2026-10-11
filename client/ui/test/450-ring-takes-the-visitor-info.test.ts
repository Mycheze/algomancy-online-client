/* ROUND 7 (report #204; docs/18 § Round 7): the ring round the focus region
 * takes in the VISITOR's info offshoot at that block's own width.
 *
 * The ring (ui/layout.ts ringBoard, owner 2026-09-23/26) is one path round
 * the focus region's L, grown over the visiting player's info offshoot once
 * they have entered. It used to run along the far band as wide as the fight's
 * column below it — the same thing, while every column was half the board.
 * In a battle the fight's column is now most of the board while the info
 * offshoots keep their half, so a ring that followed the column would close
 * round the other region's In Play as well.
 *
 * Driven on a stand-in DOM with the boxes of the HPTR s084 board at 1440×900
 * after the round (fight in my column, 1092px of 1166; their info 579px).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringBoard, roundedPath } from '../layout.ts';

type B = { l: number; t: number; r: number; b: number };
const rect = (x: B) => ({ left: x.l, top: x.t, right: x.r, bottom: x.b, width: x.r - x.l, height: x.b - x.t, x: x.l, y: x.t });

/** a board with these boxes, the ring on `ring`, the visitor in or not */
function board(boxes: Record<string, B>, ring: 'top' | 'bottom', visit: boolean) {
  const attrs = new Map<string, string>();
  const path = { setAttribute: (k: string, v: string) => { attrs.set(k, v); }, removeAttribute: (k: string) => { attrs.delete(k); }, getAnimations: () => [] };
  const el = (b: B | undefined) => (b ? { getBoundingClientRect: () => rect(b) } : null);
  const lboard = { getBoundingClientRect: () => rect(boxes['board']!), querySelector: (sel: string) => el(boxes[sel]) };
  const svg = {
    dataset: { ring, visit: visit ? '1' : '0' }, parentElement: lboard,
    querySelector: (sel: string) => (sel === 'path' ? path : null), getAttribute: () => `lring rc${ring === 'top' ? 1 : 0}`,
  };
  const root = { querySelector: (sel: string) => (sel === '.lboard > .lring' ? svg : null) } as unknown as ParentNode;
  ringBoard(root, false);
  return attrs.get('d') ?? '';
}
/** every point a path passes through (the ends of its lines and curves) */
const points = (d: string): Array<[number, number]> =>
  [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)|Q[\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+)/g)]
    .map(m => (m[1] !== undefined ? [+m[1], +m[2]!] : [+m[3]!, +m[4]!]) as [number, number]);
const corners = (d: string): number => (d.match(/Q/g) ?? []).length;

/** HPTR s084 at 1440×900, round 7: the fight in my (left) column */
const FIGHT_MINE: Record<string, B> = {
  board: { l: 0, t: 0, r: 1166, b: 628 },
  '.lback.theirs.a': { l: 0, t: 2, r: 1166, b: 84 },
  '.lback.theirs.b': { l: 1100, t: 84, r: 1166, b: 540 },
  '.lback.mine.a': { l: 0, t: 546, r: 1166, b: 626 },
  '.lback.mine.b': { l: 0, t: 90, r: 1092, b: 546 },
  '.linfo.theirs': { l: 0, t: 2, r: 579, b: 84 },
  '.linfo.mine': { l: 587, t: 546, r: 1166, b: 626 },
};
/** the same board with the fight in THEIR (right) column */
const FIGHT_THEIRS: Record<string, B> = {
  board: { l: 0, t: 0, r: 1166, b: 628 },
  '.lback.theirs.a': { l: 0, t: 2, r: 1166, b: 84 },
  '.lback.theirs.b': { l: 74, t: 84, r: 1166, b: 540 },
  '.lback.mine.a': { l: 0, t: 546, r: 1166, b: 626 },
  '.lback.mine.b': { l: 0, t: 90, r: 66, b: 546 },
  '.linfo.theirs': { l: 0, t: 2, r: 579, b: 84 },
  '.linfo.mine': { l: 587, t: 546, r: 1166, b: 626 },
};
/** outside a battle: every column half the board, as it always was */
const HALVES: Record<string, B> = {
  board: { l: 0, t: 0, r: 1166, b: 628 },
  '.lback.theirs.a': { l: 0, t: 2, r: 1166, b: 200 },
  '.lback.theirs.b': { l: 587, t: 200, r: 1166, b: 420 },
  '.lback.mine.a': { l: 0, t: 426, r: 1166, b: 626 },
  '.lback.mine.b': { l: 0, t: 206, r: 579, b: 426 },
  '.linfo.theirs': { l: 0, t: 2, r: 579, b: 200 },
  '.linfo.mine': { l: 587, t: 426, r: 1166, b: 626 },
};

test('the ring takes in the visitor info at its own width, not the fight column', () => {
  // bottom ring (my region, the fight in my column), the attacker in: the ring
  // runs along the top of THEIR info, and no further right than its edge
  const d = board(FIGHT_MINE, 'bottom', true);
  const pts = points(d);
  const top = Math.min(...pts.map(p => p[1]));
  assert.ok(top < 10, `the ring reaches the top band (${top})`);
  const alongTop = pts.filter(p => p[1] < 10).map(p => p[0]);
  assert.ok(Math.max(...alongTop) <= 579, `…only as far as their info offshoot goes (reached ${Math.max(...alongTop)}px, the info ends at 579)`);
  assert.ok(pts.some(p => p[0] > 1080 && p[1] > 90 && p[1] < 546), 'and still round the whole fight column');
  // top ring (their region, the fight in their column), me in: along the
  // bottom of MY info, no further left than its edge
  const dt = board(FIGHT_THEIRS, 'top', true);
  const pb = points(dt);
  const alongBottom = pb.filter(p => p[1] > 615).map(p => p[0]);
  assert.ok(alongBottom.length && Math.min(...alongBottom) >= 587, `…from my info offshoot's edge (reached ${Math.min(...alongBottom)}px)`);
});

test('the ring keeps eight corners round a wide fight either way, so the entry still tweens point for point', () => {
  assert.equal(corners(board(FIGHT_MINE, 'bottom', false)), 8, 'not yet entered');
  assert.equal(corners(board(FIGHT_MINE, 'bottom', true)), 8, 'entered');
  assert.equal(corners(board(FIGHT_THEIRS, 'top', false)), 8);
  assert.equal(corners(board(FIGHT_THEIRS, 'top', true)), 8);
});

test('outside a battle, or round a fight that fits in half, the ring is the six-cornered L it always was', () => {
  // the L as ringBoard drew it before round 7, corner for corner
  const i = 1.5, a = HALVES['.lback.mine.a']!, b = HALVES['.lback.mine.b']!;
  const before = roundedPath([[a.l + i, b.t + i], [b.r - i, b.t + i], [b.r - i, a.t + i], [a.r - i, a.t + i], [a.r - i, a.b - i], [a.l + i, a.b - i]], 8);
  assert.equal(board(HALVES, 'bottom', false), before);
  const ta = HALVES['.lback.theirs.a']!, tb = HALVES['.lback.theirs.b']!;
  const beforeTop = roundedPath([[ta.l + i, ta.t + i], [ta.r - i, ta.t + i], [ta.r - i, tb.b - i], [tb.l + i, tb.b - i], [tb.l + i, ta.b - i], [ta.l + i, ta.b - i]], 8);
  assert.equal(board(HALVES, 'top', false), beforeTop);
  // a fight that fits in half keeps the half-and-half board, and with the
  // visitor in, the ring it always drew: the column straight up over their info
  const far = HALVES['.lback.theirs.a']!;
  const visited = roundedPath([[a.l + i, far.t + i], [b.r - i, far.t + i], [b.r - i, a.t + i], [a.r - i, a.t + i], [a.r - i, a.b - i], [a.l + i, a.b - i]], 8);
  assert.equal(board(HALVES, 'bottom', true), visited);
});
