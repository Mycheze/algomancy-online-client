/* What a move no longer does more than once.
 *
 * §1 one board builds each seat's legal list once: the clock and the update
 *    ask for the same list.
 * §2 a finished game past the hour the sweep keeps it for is left on disk at a
 *    restart; a game finished more recently still comes back for its post-game.
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

type Rooms = typeof import('../rooms.ts');
const MIN = 60_000;

async function roomsAt(dir: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?once=${Math.random()}`) as Promise<Rooms>;
}

function play(mod: Rooms, room: Room, n: number): void {
  for (let i = 0; i < n; i++) {
    const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)]
      .filter(a => a.type !== 'concede');
    mod.applyToRoom(room, legal[0]!);
  }
}

const scratch = (): string => mkdtempSync(join(tmpdir(), 'algo-once-'));

test('1191 §1 the clock and the update read one list for one board', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('ONCA', 1191, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    play(mod, room, 2);
    const first = mod.legalActions(room.state, 0);
    assert.equal(mod.legalActions(room.state, 0), first, 'a second ask builds nothing');
    assert.equal(mod.legalInRoom(room, 0), first, 'and the update is sent that same list');
    assert.deepEqual(first, legalActions(room.state, 0), 'which is the engine answer');
    play(mod, room, 1);
    assert.notEqual(mod.legalActions(room.state, 0), first, 'a new board asks again');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function finishedRoom(mod: Rooms, dir: string, code: string, seed: number, lastActionAt: number): void {
  const room = mod.createRoom(code, seed, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
  play(mod, room, 2);
  const file = join(dir, `${code}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), winner: 0, lastActionAt }));
}

test('1191 §2 a restart leaves a long finished game on disk and brings back a recent one', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const now = Date.now();
    finishedRoom(mod, dir, 'ONCB', 1192, now - mod.FORGET_AFTER_MS - MIN);
    finishedRoom(mod, dir, 'ONCC', 1193, now - mod.FORGET_AFTER_MS + MIN);
    const open = mod.createRoom('ONCD', 1194, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    play(mod, open, 2);
    const file = join(dir, 'ONCD.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), lastActionAt: now - mod.FORGET_AFTER_MS - MIN }));

    const after = await roomsAt(dir);
    after.restoreRooms(now);
    assert.equal(after.getRoom('ONCB'), undefined, 'past the hour: not replayed');
    assert.ok(after.getRoom('ONCC'), 'inside the hour: restored for its post-game');
    assert.ok(after.getRoom('ONCD'), 'an unfinished game of the same age is restored');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
