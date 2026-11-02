/* CR D4.6 — COMPETITIVE CONSTRUCTED: UNDO UNTIL DONE (docs/22 §3.6, §8 answer 2).
 *
 * The owner, 2026-11-02: in a CC resource, haste or deploy step the player
 * taking it may take back their own actions in that step until they press
 * Done, and the opponent sees the take-back. A CC game has no hidden segment,
 * so today's undo (D4.1) never starts there; rooms.ts undoForSeat's CC branch
 * walks engine/src/ccundo.ts's marks instead, with the measured seen floor
 * beside them, through the same splice gates.
 *
 *   §1 bottoming (simultaneous, nobody's step) is not undoable in CC
 *   §2 the INT's resource step: each of their actions comes back, one per
 *      press, back to the start of the step and no further; the board after
 *      the take-back is exactly the board before the action
 *   §3 the NIT cannot undo during the INT's step, and is not offered it
 *   §4 Done is a wall: after it, the INT has nothing to undo; the NIT's own
 *      step is theirs to take back
 *   §5 the marks are re-derived by a rebuild (a restart keeps the window)
 *   §6 the push carries only a boolean (`ccUndo`), and the take-back's log
 *      line is everybody's (the source guard on main.ts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t823');
const { R } = F;
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const board = (s: GameState): string => JSON.stringify({ ...s, actionCount: 0 });

/** a resource-step action that is not Done (recycle / activate / exchange) */
function resourceMove(s: GameState, seat: Seat): Action | undefined {
  return legalActions(s, seat).find(a => a.type === 'recycleForResource' || a.type === 'activateResource' || a.type === 'exchangePrismite');
}

test('§1-§6 the INT takes back their own resource step until Done, and nobody else can', () => {
  const { room } = F.start(3);
  const int = room.state.initiative;
  const nit = other(int);
  // §1 bottoming
  const bottom = legalActions(room.state, int).find(a => a.type === 'bottomCards')!;
  R.applyToRoom(room, bottom);
  assert.equal(R.undoForSeat(room, int).ok, false, 'bottoming is nobody\'s step: it stands');
  R.applyToRoom(room, legalActions(room.state, nit).find(a => a.type === 'bottomCards')!);
  assert.ok(R.ccFloor(room, int) === room.actions.length, 'the step opens with nothing to undo');
  assert.equal(R.ccUndoOpen(room, int), false);

  // §2 the INT makes two resource moves
  const start = room.actions.length;
  const b0 = board(room.state);
  const m1 = resourceMove(room.state, int);
  assert.ok(m1, 'fixture: the INT has a resource move');
  R.applyToRoom(room, m1!);
  const b1 = board(room.state);
  const m2 = resourceMove(room.state, int);
  assert.ok(m2, 'fixture: and a second');
  R.applyToRoom(room, m2!);
  assert.equal(R.ccUndoOpen(room, int), true, 'the INT may undo');
  // §3 the NIT may not
  assert.equal(R.ccUndoOpen(room, nit), false, 'the NIT is not offered it');
  const refused = R.undoForSeat(room, nit);
  assert.equal(refused.ok, false, 'the NIT is refused');
  assert.equal(room.actions.length, start + 2, 'nothing moved');
  // back, one press at a time
  assert.deepEqual(R.undoForSeat(room, int), { ok: true });
  assert.equal(room.actions.length, start + 1);
  assert.equal(board(room.state), b1, 'exactly the board before the second move');
  assert.deepEqual(R.undoForSeat(room, int), { ok: true });
  assert.equal(board(room.state), b0, 'and before the first');
  const wall = R.undoForSeat(room, int);
  assert.equal(wall.ok, false, 'the start of the step is as far as it goes');
  assert.equal(room.actions.length, start, 'bottoming stands');

  // §4 Done is a wall
  R.applyToRoom(room, resourceMove(room.state, int)!);
  R.applyToRoom(room, { type: 'donePlanning', seat: int });
  assert.equal(R.ccUndoOpen(room, int), false, 'after Done, nothing of the INT');
  assert.equal(R.undoForSeat(room, int).ok, false);
  const n1 = resourceMove(room.state, nit);
  assert.ok(n1, 'fixture: now the NIT has a resource move');
  R.applyToRoom(room, n1!);
  assert.equal(R.ccUndoOpen(room, nit), true, 'the NIT takes back its own step');
  assert.equal(R.ccUndoOpen(room, int), false);

  // §5 a rebuild re-derives the marks (what a restart or an undo runs)
  const marks = JSON.stringify(room.ccMarks);
  assert.equal(room.ccMarks.length, room.actions.length, 'one mark per action');
  assert.deepEqual(R.undoForSeat(room, nit), { ok: true });
  R.applyToRoom(room, n1!);
  assert.equal(JSON.stringify(room.ccMarks), marks, 'the rebuilt marks are the marks it had');
  assert.equal(R.ccUndoOpen(room, nit), true);
});

test('§6 the wire carries a boolean, and the take-back note is public in CC', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'main.ts'), 'utf8');
  assert.match(main, /room\.state\.sequential \? \{ ccUndo: ccUndoOpen\(room, seat\) \} : \{\}/, 'baseView sends ccUndo, a boolean');
  assert.doesNotMatch(main, /ccMarks/, 'the marks never leave rooms.ts');
  assert.match(main, /data: room\.state\.sequential \? \{\} : \{ privateTo: conn\.seat \}/, 'the undo line is everybody\'s in CC');
});
