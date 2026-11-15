/* 1431 — A STORED STATE THIS ENGINE CANNOT TAKE CLOSES THE ROOM, WITH A NOTICE.
 *
 * A deploy whose GameState shape moved (STATE_SCHEMA), or whose engine throws
 * on the stored board, does not freeze or replay the game: the room is closed
 * as 'update', its file loses the dead state, and its link says why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATE_SCHEMA } from '../../engine/src/types.ts';

type Rooms = typeof import('../rooms.ts');
const DIR = mkdtempSync(join(tmpdir(), 'algo-1431-'));
process.env['ALGO_GAMES_DIR'] = DIR;
const load = (): Promise<Rooms> => import(`../rooms.ts?r1431=${Math.random()}`) as Promise<Rooms>;

test('a stored state of another schema, or one the engine throws on, closes its room as an update', async () => {
  const R = await load();
  const spoil: Record<string, (live: { schema: number; state: { players: unknown } }) => void> = {
    R1431A: live => { live.schema = STATE_SCHEMA + 1; },
    R1431B: live => { live.state.players = null; },
  };
  for (const [code, patch] of Object.entries(spoil)) {
    const room = R.createRoom(code, 143101, ['Ann', 'Bo'], 'shared');
    R.applyToRoom(room, R.legalInRoom(room, 0).find(a => a.type === 'recycleForResource')!);
    const path = join(DIR, `${code}.json`);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    patch(file.live);
    writeFileSync(path, JSON.stringify(file));
  }
  const R2 = await load();
  R2.restoreRooms();
  for (const code of Object.keys(spoil)) {
    assert.equal(R2.getRoom(code), undefined, `${code} is not resumed`);
    const file = JSON.parse(readFileSync(join(DIR, `${code}.json`), 'utf8')) as { closed?: { reason: string }; live?: unknown; actions: unknown[] };
    assert.equal(file.closed?.reason, 'update', 'it is closed by the update');
    assert.equal(file.live, undefined, 'without the state it could not take');
    assert.equal(file.actions.length, 1, 'and with its record');
    assert.match(R2.closedNotice(code) ?? '', /server update/, 'and its link says so');
  }
});
