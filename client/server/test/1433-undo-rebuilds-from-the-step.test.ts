/* 1433 — AN UNDO REBUILDS FROM THE START OF ITS STEP, NEVER FROM THE DEAL.
 *
 * The room keeps the starts of the last steps (rooms.ts `bases`); an undo
 * replays from the latest one before the action it takes back. What came
 * before is not read again — shown here by making it unreadable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, signature } from '../replay-probe.ts';

type Rooms = typeof import('../rooms.ts');
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-1433-'));
const R = await import(`../rooms.ts?r1433=${Math.random()}`) as Rooms;

test('an undo late in a game replays only its own step', () => {
  const room = R.createRoom('R1433', 143301, ['Ann', 'Bo'], 'shared');
  while (room.state.turn < 3) {
    const a = [...R.legalInRoom(room, 0), ...R.legalInRoom(room, 1)].find(x => x.type !== 'concede')!;
    const was = room.segKey;
    R.applyToRoom(room, a);
    if (R.segmentKey(room.state) !== was) R.openSegment(room);
  }
  const board = digest(signature(room.state));
  R.applyToRoom(room, R.legalInRoom(room, 0).find(a => a.type === 'recycleForResource')!);
  // the first turn's moves, as a replay from the deal would now read them
  for (let i = 0; i < 10; i++) room.actions[i] = { type: 'concede', seat: 0 };
  assert.deepEqual(R.undoForSeat(room, 0), { ok: true });
  assert.equal(digest(signature(room.state)), board, 'back to the board before the recycle');
});
