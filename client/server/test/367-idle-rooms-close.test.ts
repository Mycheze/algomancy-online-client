/* 367 — IDLE ROOMS CLOSE THEMSELVES.
 *
 * The owner, 2026-10-04: "Any game that's started seems to be allowed to stay
 * open forever, even if no one has taken an action. Rooms that have fewer than
 * 5 actions should self 'complete' after just 1 hour of inaction. Rooms with
 * more actions than that should self complete after 12 hours of no further
 * action."
 *
 * Measured on the box first: 79 unfinished rooms resident, every file with
 * the same mtime — the last restart. Restore aged rooms by mtime and every
 * boot re-wrote every live file (the R200 version stamp), so nothing ever
 * aged out. The fix ages a room by `lastActionAt`, which a restart does not
 * touch, and closes it when nobody is in it and its window has passed.
 *
 * His settled reading, and what each test pins:
 *   §1  fewer than five actions: an hour (59m stays, 61m closes)
 *   §2  five or more: twelve hours (11h stays, 12h closes)
 *   §3  an open tab — a seat or a watcher — keeps it, and an empty room must
 *       STAY empty for the reconnect grace before it is believed
 *   §4  a closed room is never restored, and its link says what happened
 *   §5  a file from before the field is aged by its version stamps, not its mtime
 *   §6  a closed game has no result: no winner, not rated, unfinished
 *   §7  a closed game's code is never handed to a new room
 *   §8  the server really runs the sweep, and mints codes and answers
 *       watchers through the same two functions
 *
 * Every clock here is a parameter (`sweepIdleRooms(now)`, `restoreRooms(now)`);
 * nothing waits. Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import { summarizeGame } from '../stats.ts';
import { isRated } from '../rating.ts';

type Rooms = typeof import('../rooms.ts');
const MIN = 60_000;
const HOUR = 60 * MIN;

/** a fresh copy of rooms.ts pointed at `dir` — see 317's roomsAt */
async function roomsAt(dir: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?idle=${Math.random()}`) as Promise<Rooms>;
}

/** apply `n` real actions — the first legal one each time, never a concede */
function play(mod: Rooms, room: Room, n: number): void {
  const start = room.actions.length;
  for (let i = 0; i < n; i++) {
    const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)]
      .filter(a => a.type !== 'concede');
    assert.ok(legal.length, `no legal action after ${i}`);
    mod.applyToRoom(room, legal[0]!);
  }
  assert.equal(room.actions.length, start + n);
}

/** a room that has been empty long enough for the sweep to believe it */
function emptyFor(room: Room, now: number): void {
  room.unattendedSince = now - 10 * MIN;
}

const fileOf = (dir: string, code: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as Record<string, unknown>;

const scratch = (): string => mkdtempSync(join(tmpdir(), 'idle-'));

test('367 §1 a room with fewer than five actions closes after an hour without a move, not before', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('IDLA', 11, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    play(mod, room, 4);
    const now = Date.now();
    room.lastActionAt = now - 59 * MIN;
    emptyFor(room, now);
    assert.deepEqual(mod.sweepIdleRooms(now), [], 'closed a 4-action room after 59 minutes — the window is an hour');
    assert.ok(mod.getRoom('IDLA'));

    room.lastActionAt = now - 61 * MIN;
    assert.deepEqual(mod.sweepIdleRooms(now), ['IDLA'], 'a 4-action room idle 61 minutes with nobody in it was left open');
    assert.equal(mod.getRoom('IDLA'), undefined, 'closed, but still held in memory');
    assert.ok(existsSync(join(dir, 'IDLA.json')), 'the game file was deleted — it is the record and must stay');
    const f = fileOf(dir, 'IDLA');
    assert.deepEqual(f['closed'], { reason: 'idle', at: now, afterMs: HOUR });
    assert.equal(f['lastActionAt'], now - 61 * MIN);
    assert.equal((f['actions'] as unknown[]).length, 4, 'the log was not kept whole');
    assert.equal(Math.round(statSync(join(dir, 'IDLA.json')).mtimeMs), now - 61 * MIN,
      'the closing write moved the file date — history reads the mtime as when the game was played');

    // a room never played in counts from its creation
    const zero = mod.createRoom('IDLZ', 12, ['A', 'B'], 'draft');
    zero.lastActionAt = now;
    emptyFor(zero, now);
    assert.deepEqual(mod.sweepIdleRooms(now + 30 * MIN), [], 'a 0-action room closed half an hour after creation');
    assert.deepEqual(mod.sweepIdleRooms(now + 2 * HOUR), ['IDLZ'], 'a 0-action lobby nobody is in outlived its hour');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §2 a room with five or more actions closes after twelve hours without a move, not before', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('IDLB', 21, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    play(mod, room, 5);
    const now = Date.now();
    room.lastActionAt = now - 11 * HOUR;
    emptyFor(room, now);
    assert.deepEqual(mod.sweepIdleRooms(now), [],
      'a 5-action room closed after 11 hours — five actions is the long window, the short one is for fewer than five');
    // a move resets the window, and the file carries it across a restart
    room.lastActionAt = now - 13 * HOUR;
    play(mod, room, 1);
    assert.ok(room.lastActionAt >= now, 'a landed action did not restart the idle clock');
    assert.equal(fileOf(dir, 'IDLB')['lastActionAt'], room.lastActionAt, 'the idle clock is not persisted');
    assert.deepEqual(mod.sweepIdleRooms(now + HOUR), [], 'closed a room whose last move was an hour ago');
    // …and so does a take-back
    room.lastActionAt = now - 13 * HOUR;
    mod.undoLastAction(room);
    assert.ok(room.lastActionAt >= now, 'an undo did not restart the idle clock');
    assert.equal(room.actions.length, 5);

    room.lastActionAt = now - 12 * HOUR;
    assert.deepEqual(mod.sweepIdleRooms(now), ['IDLB'], 'a 5-action room idle twelve hours was left open');
    assert.equal((fileOf(dir, 'IDLB')['closed'] as { afterMs: number }).afterMs, 12 * HOUR);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §3 a connected seat or a watcher keeps an idle room open, and an empty one gets a grace to reconnect', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('IDLC', 31, ['A', 'B'], 'draft');
    const now = Date.now();
    room.lastActionAt = now - 3 * 24 * HOUR;   // long past either window

    room.sockets[1] = {} as Room['sockets'][1];
    assert.deepEqual(mod.sweepIdleRooms(now), [], 'closed a room with a player sitting in it');
    assert.equal(room.unattendedSince, null);
    room.sockets[1] = null;
    room.watchers.add({} as never);
    assert.deepEqual(mod.sweepIdleRooms(now), [], 'closed a room somebody is watching');
    room.watchers.clear();

    // empty now — but a phone that locked, or a deploy, drops every socket for
    // a moment; one tick of emptiness is not "nobody is here"
    assert.deepEqual(mod.sweepIdleRooms(now), [], 'closed on the first tick that saw it empty');
    assert.equal(room.unattendedSince, now);
    assert.deepEqual(mod.sweepIdleRooms(now + mod.RECONNECT_GRACE_MS - 1000), [], 'closed inside the reconnect grace');
    // a return inside the grace starts the count again
    room.sockets[0] = {} as Room['sockets'][0];
    mod.sweepIdleRooms(now + mod.RECONNECT_GRACE_MS);
    room.sockets[0] = null;
    assert.deepEqual(mod.sweepIdleRooms(now + mod.RECONNECT_GRACE_MS + 1000), [], 'a reconnect did not reset the grace');
    assert.deepEqual(mod.sweepIdleRooms(now + 2 * mod.RECONNECT_GRACE_MS + 2000), ['IDLC'],
      'empty for the whole grace and past its window, and still open');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §4 a closed room is not restored at boot and its link says it closed', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('IDLD', 41, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    play(mod, room, 2);
    const now = Date.now();
    room.lastActionAt = now - 2 * HOUR;
    emptyFor(room, now);
    // positive control: the same file restores while it is open
    const before = await roomsAt(dir);
    before.restoreRooms(now);
    assert.ok(before.getRoom('IDLD'), 'positive control: an open room restores');

    assert.deepEqual(mod.sweepIdleRooms(now), ['IDLD']);
    const after = await roomsAt(dir);
    after.restoreRooms(now);
    assert.equal(after.getRoom('IDLD'), undefined, 'a closed room came back at the next boot');
    assert.equal(after.joinRefusal('IDLD'),
      'Game IDLD closed after 1 hour without a move.');
    assert.match(after.joinRefusal('ZZZZ') ?? '', /^No game with code ZZZZ/, 'a typo is still a typo');
    // a path that would reach the very same file is still not a code
    assert.equal(after.closedNotice('X/../IDLD'), null, 'a code is a file name only when it looks like one');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §5 a file from before the field is aged by its version stamps and not by its mtime', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const now = Date.now();
    // the pure rule: the FIRST stamp whose `from` is the log length bounds the last move
    const stamps = [
      { at: new Date(now - 9 * HOUR).toISOString(), sha: 'a', from: 0 },
      { at: new Date(now - 5 * HOUR).toISOString(), sha: 'b', from: 3 },
      { at: new Date(now - 1 * HOUR).toISOString(), sha: 'c', from: 3 },
    ];
    assert.equal(mod.lastActionOf({ actions: [1, 2, 3], versions: stamps }, now), now - 5 * HOUR);
    assert.equal(mod.lastActionOf({ actions: [1, 2, 3, 4], versions: stamps }, now - 30 * MIN), now - 30 * MIN,
      'no stamp after the last move: the mtime is the last move');
    assert.equal(mod.lastActionOf({ actions: [], versions: stamps }, now), now - 9 * HOUR, 'a 0-action room counts from creation');
    assert.equal(mod.lastActionOf({ lastActionAt: now - 7 * MIN, actions: [1], versions: stamps }, now), now - 7 * MIN);

    // …and restore really uses it: a legacy 0-action room, created two hours
    // ago and re-written by every boot since (so its mtime is NOW)
    mod.createRoom('IDLE', 51, ['A', 'B'], 'draft');
    const path = join(dir, 'IDLE.json');
    const raw = fileOf(dir, 'IDLE');
    delete raw['lastActionAt'];
    (raw['versions'] as { at: string }[])[0]!.at = new Date(now - 2 * HOUR).toISOString();
    (raw['versions'] as unknown[]).push({ at: new Date(now - 10 * MIN).toISOString(), sha: 'later-boot', from: 0 });
    writeFileSync(path, JSON.stringify(raw));
    utimesSync(path, now / 1000, now / 1000);

    const boot = await roomsAt(dir);
    boot.restoreRooms(now);
    const r = boot.getRoom('IDLE');
    assert.ok(r, 'a 2-hour-old legacy room is restored (its tab may be coming back)');
    assert.equal(r.lastActionAt, now - 2 * HOUR, 'the legacy room was aged by its mtime — every boot resets that');
    assert.deepEqual(boot.sweepIdleRooms(now), [], 'closed on the first tick after boot, before any tab could reconnect');
    assert.deepEqual(boot.sweepIdleRooms(now + boot.RECONNECT_GRACE_MS), ['IDLE'],
      'a legacy room past its window outlived the grace after boot');

    // a week without a move: closed in its file at boot, never replayed
    boot.createRoom('IDLW', 52, ['A', 'B'], 'draft');
    const wraw = fileOf(dir, 'IDLW');
    wraw['lastActionAt'] = now - 8 * 24 * HOUR;
    writeFileSync(join(dir, 'IDLW.json'), JSON.stringify(wraw));
    const boot2 = await roomsAt(dir);
    boot2.restoreRooms(now);
    assert.equal(boot2.getRoom('IDLW'), undefined);
    assert.equal((fileOf(dir, 'IDLW')['closed'] as { reason: string }).reason, 'idle',
      'a week-old unfinished game was skipped without being marked closed — its link would say there is no such game');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §6 a closed game has no winner, is not rated and reads as unfinished', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createMatch({ userId: 'u-a', username: 'Ann' }, { userId: 'u-b', username: 'Bo' }, 'draft', 'IDLR');
    assert.equal(room.rated, true, 'positive control: the matchmaker made a rated room');
    const now = Date.now();
    room.lastActionAt = now - 2 * HOUR;
    emptyFor(room, now);
    assert.deepEqual(mod.sweepIdleRooms(now), ['IDLR']);
    const f = fileOf(dir, 'IDLR') as unknown as Parameters<typeof summarizeGame>[0] & { rated?: boolean; users: [string, string] };
    assert.equal(f.winner, null, 'closing stamped a result');
    assert.equal(f.rated, true, 'the file must still say what the game was');
    const s = summarizeGame({ ...f, code: 'IDLR', playedAt: new Date(now).toISOString() });
    assert.equal(s.finished, false);
    assert.equal(s.winner, null);
    assert.equal(isRated({
      code: 'IDLR', playedAt: '', mode: s.mode, finished: s.finished, winner: s.winner, users: f.users, rated: true,
    }), false, 'a closed rated game would move a rating');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §7 a closed game keeps its code and the sweep leaves finished games to their own sweep', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('IDLK', 71, ['A', 'B'], 'draft');
    const now = Date.now();
    room.lastActionAt = now - 2 * HOUR;
    emptyFor(room, now);
    assert.equal(mod.codeTaken('IDLK'), true);
    mod.sweepIdleRooms(now);
    assert.equal(mod.getRoom('IDLK'), undefined);
    assert.equal(mod.codeTaken('IDLK'), true,
      'a closed game code could be minted again — the new room would overwrite its record');
    assert.equal(mod.codeTaken('QQQQ'), false, 'positive control: a free code is free');

    // a DECIDED room is sweepFinished business, with its result
    const won = mod.createRoom('IDLF', 72, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
    play(mod, won, 1);
    won.winner = 0;
    won.lastActionAt = now - 2 * 24 * HOUR;
    emptyFor(won, now);
    assert.deepEqual(mod.sweepIdleRooms(now), [], 'the idle sweep closed a finished game');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('367 §8 the server runs the idle sweep on its tick and mints codes through codeTaken', () => {
  // Read, not driven: the tick and the minting live in main.ts, which binds a
  // port on import — the e2e suite is where a running server is exercised.
  const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const tick = /setInterval\(\(\) => \{([^}]*)\}, EXPIRY_TICK_MS\)/.exec(MAIN);
  assert.ok(tick, 'could not find the sweep tick');
  assert.match(tick[1]!, /\bsweepIdle\(\)/, 'nothing runs the idle sweep — rooms would never close');
  assert.match(MAIN, /function sweepIdle\(\): void \{\s*for \(const code of sweepIdleRooms\(Date\.now\(\)\)\)/);
  const mint = /function freshRoomCode\(\): string \{[^]*?\n\}/.exec(MAIN)?.[0] ?? '';
  assert.match(mint, /if \(!codeTaken\(code\)\) return code;/,
    'room codes are minted against the room map alone — a closed game code can be handed out again');
  assert.match(MAIN, /closedNotice\(code\) \?\? `No game with code \$\{code\}\. Nothing to watch yet\.`/,
    'a watcher of a closed game is told there is no such game');
});
