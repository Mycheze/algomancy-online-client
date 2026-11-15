/* 1430 — A LIVE ROOM RESUMES FROM ITS STORED POINT, NOT FROM ITS LOG.
 *
 * The file's `live` block is the board, the event history and the open hidden
 * step. A restart loads it; the action log is a record nobody replays. The
 * point is written mid-tick, before main.ts opens the next step, so a file
 * written on a step's closing action must resume inside the step it opened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { digest, signature } from '../replay-probe.ts';

type Rooms = typeof import('../rooms.ts');
const DIR = mkdtempSync(join(tmpdir(), 'algo-1430-'));
process.env['ALGO_GAMES_DIR'] = DIR;
const load = (): Promise<Rooms> => import(`../rooms.ts?r1430=${Math.random()}`) as Promise<Rooms>;

test('a restart resumes the stored board even when the log no longer replays, and inside the step the last action opened', async () => {
  const R = await load();
  const room = R.createRoom('R1430', 143001, ['Ann', 'Bo'], 'shared');
  // two turns of the first legal move, each step opened as main.ts opens it…
  while (room.state.turn < 3) {
    const a = [...R.legalInRoom(room, 0), ...R.legalInRoom(room, 1)].find(x => x.type !== 'concede')!;
    const was = room.segKey;
    R.applyToRoom(room, a);
    if (R.segmentKey(room.state) !== was) R.openSegment(room);
  }
  // …and then the step's closing action, persisted before anything opens the next one
  assert.equal(room.segKey, 'plan');
  for (const seat of [0, 1] as Seat[]) R.applyToRoom(room, { type: 'donePlanning', seat });
  assert.equal(R.segmentKey(room.state), 'haste', 'fixture: the haste step has begun');
  assert.equal(room.segKey, 'plan', 'fixture: and the room has not opened it yet');

  const path = join(DIR, 'R1430.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as { actions: unknown[] };
  file.actions = file.actions.map(() => ({ type: 'concede', seat: 0 }));   // a log nothing can replay
  writeFileSync(path, JSON.stringify(file));

  const R2 = await load();
  R2.restoreRooms();
  const back = R2.getRoom('R1430')!;
  assert.equal(digest(signature(back.state)), digest(signature(room.state)), 'the board as it stood');
  assert.equal(back.state.winner, null, 'not the board the log would give');
  assert.equal(back.frozen, null);
  assert.equal(back.segKey, 'haste', 'inside the step the last action opened');
  assert.equal(back.segStartIndex, back.actions.length, 'which starts here');
  assert.deepEqual(back.heldEvents, [[], []], 'holding nothing yet');
  assert.equal(digest(signature(back.segSnapshot!)), digest(signature(room.state)), 'frozen at this board');
  R2.applyToRoom(back, { type: 'doneHaste', seat: 0 });
  assert.equal(back.actions.length, file.actions.length + 1, 'and play goes on');
});
