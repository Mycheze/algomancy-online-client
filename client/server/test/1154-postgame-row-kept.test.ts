/* CT-530 — A FINISHED GAME IS REPLAYED FOR ITS POST-GAME SCREEN ONCE, NOT ON
 * EVERY REJOIN.
 *
 * main.ts sendGameOver built the post-game payload from summarizeRoom(room), a
 * full replay of the game, on every rejoin or reload into a finished room (and
 * once per seat when the game was not recorded). After CT-529, MCHQ (600
 * actions, ~75 units) still took ~4 s per replay on the home box, with every
 * other room on the server waiting.
 *
 *   §1 one replay per finished room, however many times the screen is sent
 *   §2 the live record's row is the screen's row: no replay at all after it
 *   §3 anything the summary reads changing makes the next send replay again
 *   §4 main.ts reaches the summary only through the kept row
 *
 * Seeds 54000-54099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RecordedGame } from '../accounts.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-1154-'));
process.env['ALGO_GAMES_DIR'] = join(DIR, 'games');
const R = await import('../rooms.ts');
const { summarizeGame } = await import('../stats.ts');
const { keepPostgameRow, postgameRow } = await import('../postgame-row.ts');
test.after(() => { rmSync(DIR, { recursive: true, force: true }); });

/** a finished room: seat `loser` concedes */
function finished(code: string, seed: number, loser: 0 | 1 = 0): import('../rooms.ts').Room {
  const room = R.createRoom(code, seed, ['Ann1154', 'Bo1154']);
  R.applyToRoom(room, { type: 'concede', seat: loser });
  assert.equal(R.decidedWinner(room), loser === 0 ? 1 : 0, 'fixture: the concede decided it');
  return room;
}

/** summarizeRoom's shape, with a count of how many replays it took */
function counting(room: import('../rooms.ts').Room): { replays: number; summarize: () => RecordedGame } {
  const c = {
    replays: 0,
    summarize: (): RecordedGame => {
      c.replays++;
      const s = summarizeGame({ code: room.code, seed: room.seed, mode: room.mode, els: room.els,
        names: room.names, actions: room.actions, winner: room.winner });
      return { code: s.code, playedAt: s.playedAt, recordedAt: s.playedAt, mode: s.mode, els: s.els,
        finished: s.finished, winner: s.winner, turns: s.turns, diverged: s.skipped > 0,
        users: [...room.users], names: [...room.names], seats: s.seats } as RecordedGame;
    },
  };
  return c;
}

test('§1 a finished room is replayed once however many times its post-game screen is sent', () => {
  const room = finished('PGR1', 54000);
  const c = counting(room);
  const first = postgameRow(room, c.summarize);
  for (let i = 0; i < 5; i++) assert.equal(postgameRow(room, c.summarize), first, `send ${i + 2}: the same row`);
  assert.equal(c.replays, 1, 'six sends (two seats, four rejoins), one replay');
  assert.equal(first.winner, 1, 'and it is the real summary');
  // another room keeps its own
  const other = finished('PGR2', 54001, 1);
  const d = counting(other);
  assert.equal(postgameRow(other, d.summarize).winner, 0);
  assert.equal(d.replays, 1);
  assert.equal(postgameRow(room, c.summarize), first, 'the first room still has its row');
});

test('§2 the row the live record made is the one every later send reads', () => {
  const room = finished('PGR3', 54002);
  const c = counting(room);
  const recorded = { ...counting(room).summarize(), recordedAt: 'the live record' };
  keepPostgameRow(room, recorded);
  assert.equal(postgameRow(room, c.summarize), recorded);
  assert.equal(postgameRow(room, c.summarize), recorded);
  assert.equal(c.replays, 0, 'no replay after the game was recorded');
});

test('§3 a change to anything the summary reads replays it again', () => {
  const room = finished('PGR4', 54003);
  const c = counting(room);
  postgameRow(room, c.summarize);
  const changes: [string, () => void][] = [
    ['the log grows', () => { room.actions.push({ type: 'concede', seat: 1 }); }],
    ['the log is replaced', () => { room.actions = [...room.actions]; }],
    ['the result changes', () => { room.winner = 0; }],
    ['the concession stamp changes', () => { room.concession = { seat: 1, turn: 99 } as NonNullable<typeof room.concession>; }],
    ['an agreed fix lands', () => { room.amendments.push({} as (typeof room.amendments)[number]); }],
    ['a seat is claimed', () => { room.users = ['someone', room.users[1]]; }],
  ];
  for (const [what, change] of changes) {
    const before = c.replays;
    change();
    postgameRow(room, c.summarize);
    assert.equal(c.replays, before + 1, `${what}: replayed`);
    postgameRow(room, c.summarize);
    assert.equal(c.replays, before + 1, `${what}: and kept again`);
  }
  // a send, a rejoin and a dispute change none of those: still kept
  room.disputes.push({} as (typeof room.disputes)[number]);
  room.rematch[0] = true;
  const before = c.replays;
  postgameRow(room, c.summarize);
  assert.equal(c.replays, before, 'a dispute or a rematch offer does not replay the game');
});

test('§4 main.ts builds the post-game screen only from the kept row', () => {
  const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const calls = [...MAIN.matchAll(/summarizeRoom\(room\)/g)].map(m => MAIN.slice(Math.max(0, m.index! - 40), m.index! + 20));
  assert.deepEqual(calls.length, 1, 'summarizeRoom is called from exactly one place');
  assert.match(calls[0]!, /postgameRow\(room, \(\) => summarizeRoom\(room\)\)/, 'and that place is the kept row');
  assert.match(MAIN, /keepPostgameRow\(room, row\.game\)/, 'recordFinishedGame keeps the live record\'s row');
});
