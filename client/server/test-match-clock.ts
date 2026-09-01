/* BL-37 — THE MATCH CLOCK: how long a game actually took. (run: node test-match-clock.ts)
 *
 * The owner, 2026-09-01: *"a global wall-clock match timer — literal elapsed
 * time, not double-counting per-player time — saved with the game to track
 * average game length and tune the clocks."*
 *
 * ⚠ WHY IT CANNOT BE DERIVED, which is the reason this is a field and a test
 * rather than a division. Two banks of 45 minutes are ninety minutes of clock
 * and one game, so adding the consumed halves answers "how much thinking
 * happened" and not "how long were we sitting here". And a room with the clock
 * OFF has no banks at all — which is exactly the room whose length you most
 * want to know when you are deciding what the banks should be. §2 is that
 * case, and it is the one a derived number could never have answered.
 *
 * §1  it counts UP, off the same stamp and interval as the two banks
 * §2  …including in a room with no clock at all
 * §3  it stops for the same reasons the banks stop — and `matchRunning` is
 *     the shared predicate rather than a second copy of the list
 * §4  it survives a save/restore, and the hours the server was DOWN are not
 *     billed to it
 * §5  `matchLengths` over a history: n is part of the answer, and a game that
 *     never measured itself is absent rather than zero
 *
 * In-process: no port, no socket. Everything here is `createRoom` and the two
 * pure-ish functions, which is what makes it safe to run beside anything else.
 */
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DIR = join(tmpdir(), `algo-matchclock-${process.pid}`);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
process.env['ALGO_GAMES_DIR'] = DIR;

const { applyToRoom, createRoom, getRoom, matchRunning, restoreRooms, settleClock } =
  await import('./rooms.ts');
const { matchLengths } = await import('./history.ts');
import type { Room } from './rooms.ts';
import type { RecordedGame } from './accounts.ts';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

const SEED = 3101;
/** a fake socket: `clockRunning`/`matchRunning` only ever ask whether one is
 *  there, so the cheapest honest stand-in is a truthy object */
const plug = (room: Room): void => { room.sockets = [{} as never, {} as never]; };
/** wind the room's stamp back by `ms` and settle — the only way to make time
 *  pass in a test without waiting for it */
function advance(room: Room, ms: number): void {
  room.clockStamp -= ms;
  settleClock(room);
}
/** ⚠ REAL WALL TIME PASSES BETWEEN `advance` AND THE SETTLE INSIDE IT, so
 *  every number here is the wound-back interval PLUS however long the process
 *  took to get there. A few milliseconds. Asserting equality would make this
 *  file flake on a loaded box, which is the failure mode a test about clocks
 *  can least afford — so the tolerance is explicit and generous, and every
 *  interval under test is orders of magnitude larger than it. */
const SLOP = 250;
const near = (got: number, want: number): boolean => Math.abs(got - want) <= SLOP;

// ══ 1 — it counts up, beside the banks ════════════════════════════════
console.log('\n[the table has a clock of its own]');
{
  const room = createRoom('MC01', SEED);
  plug(room);
  settleClock(room);                       // arm: matchRun/clockRun computed
  ok(matchRunning(room), 'fixture: a dealt room with both seats connected is a live match');
  ok(room.matchMs === 0, 'and it starts at nothing');
  advance(room, 90_000);
  ok(near(room.matchMs, 90_000), `ninety seconds of table time was billed (got ${room.matchMs})`);
  ok(room.startedAt !== null, 'and the raw wall stamp was taken');

  // ⚠ THE POINT OF THE WHOLE ENTRY: it is not the sum of the banks. Both
  // seats are waiting on the same simultaneous phase, so ninety seconds of
  // table time cost the two of them ninety seconds EACH.
  const spent = (room.clockStart! - room.clockMs[0]) + (room.clockStart! - room.clockMs[1]);
  ok(near(spent, 180_000), `both banks were billed the same interval (${spent}ms across the two)`);
  ok(!near(room.matchMs, spent),
    'the match clock is not the sum of the banks — which is the "not double-counting '
    + 'per-player time" half of the ask, and the reason this is measured rather than derived');
}

// ══ 2 — a room with NO clock still has a length ═══════════════════════
console.log('\n[the room whose length you most want to know]');
{
  const room = createRoom('MC02', SEED, ['A', 'B'], 'shared', undefined, undefined, undefined, null);
  plug(room);
  settleClock(room);
  ok(room.clockStart === null, 'fixture: BL-26 says off is a real setting, and this room is off');
  ok(room.clockRun[0] === false && room.clockRun[1] === false, 'so no bank runs');
  advance(room, 120_000);
  ok(near(room.matchMs, 120_000),
    `two minutes were still billed to the table (got ${room.matchMs}). A number derived from `
    + 'the banks would be zero here, and this is the room you are trying to choose a bank FOR');
}

// ══ 3 — it stops for the same reasons, from one predicate ═════════════
console.log('\n[it stops when the match stops]');
{
  const room = createRoom('MC03', SEED);
  plug(room);
  settleClock(room);
  advance(room, 10_000);
  const running = room.matchMs;

  // a seat drops
  room.sockets[1] = null;
  settleClock(room);
  ok(!matchRunning(room), 'one seat gone: the match is not running');
  advance(room, 60_000);
  ok(near(room.matchMs, running),
    `a minute with an empty chair was not billed (got ${room.matchMs}, was ${running})`);

  // …and it resumes
  plug(room);
  settleClock(room);
  advance(room, 5_000);
  ok(near(room.matchMs, running + 5_000), 'and it picks up again when they come back');

  // the game ends
  room.state.winner = 0;
  settleClock(room);
  ok(!matchRunning(room), 'a decided game is not a running match');
  const atEnd = room.matchMs;
  advance(room, 60_000);
  ok(near(room.matchMs, atEnd), 'and nothing is billed after the result');
  room.state.winner = null;

  // CT-160: a frozen room is waiting on nobody
  room.frozen = 'this game was rebuilt and cannot be trusted';
  settleClock(room);
  ok(!matchRunning(room), 'CT-160: a frozen room is not a running match either');
  room.frozen = null;
}

// ══ 4 — the save/restore round trip ═══════════════════════════════════
console.log('\n[it survives a restart, and the downtime is not billed]');
{
  const room = createRoom('MC04', SEED);
  plug(room);
  settleClock(room);
  advance(room, 300_000);
  const played = room.matchMs;
  // ⚠ persisted the way a game really persists — by an ACTION landing — rather
  // than by exporting the writer for a test. `applyToRoom` settles and writes,
  // which is the only path a live room's file is ever written down.
  applyToRoom(room, { type: 'donePlanning', seat: 0 });

  const raw = JSON.parse(readFileSync(join(DIR, 'MC04.json'), 'utf8')) as
    { matchMs?: number; startedAt?: number | null };
  ok(near(raw.matchMs ?? -1, played), `the file carries the match clock (${raw.matchMs})`);
  ok(typeof raw.startedAt === 'number', 'and the raw wall stamp beside it');

  restoreRooms();
  const back = getRoom('MC04')!;
  ok(!!back, 'the room restored');
  ok(near(back.matchMs, played), `with its match clock intact (${back.matchMs})`);
  ok(back.matchRun === false,
    'and NOT running: nobody is connected after a restart, so the very next settle bills '
    + 'nothing for however long the server was down');
  advance(back, 3_600_000);
  ok(near(back.matchMs, played),
    `an hour of downtime was not billed to the match (got ${back.matchMs})`);

  // a file written before the timer existed reads as UNKNOWN, not as zero-length
  const older = JSON.parse(readFileSync(join(DIR, 'MC04.json'), 'utf8')) as Record<string, unknown>;
  delete older['matchMs']; delete older['startedAt'];
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(DIR, 'MC05.json'), JSON.stringify({ ...older, code: 'MC05' }));
  restoreRooms();
  const old = getRoom('MC05');
  ok(!!old, 'a file written before the timer existed still restores');
  ok(old!.matchMs === 0 && old!.startedAt === null,
    'with no length and no start — which is "unknown", and why the post-game screen omits '
    + 'the line rather than printing 0:00 for every game ever played');
}

// ══ 5 — the average, and what it is honest about ══════════════════════
console.log('\n[what a game costs here]');
{
  const g = (code: string, matchMs?: number): RecordedGame => ({
    code, playedAt: '', recordedAt: '', mode: 'shared', els: [], finished: true,
    winner: 0, turns: 5, diverged: false, users: [null, null],
    names: ['A', 'B'], seats: [null as never, null as never],
    ...(matchMs === undefined ? {} : { matchMs }),
  });

  const none = matchLengths([g('A'), g('B')]);
  ok(none.n === 0 && none.mean === 0,
    'no game measured itself: n is 0, and a caller with n === 0 has no answer to print');

  const some = matchLengths([g('A'), g('B', 10 * 60_000), g('C', 20 * 60_000), g('D', 30 * 60_000)]);
  ok(some.n === 3,
    `n counts only the games that measured themselves (${some.n} of 4) — an unmeasured game `
    + 'folded in as 0 would drag the average toward nothing while looking like data');
  ok(some.mean === 20 * 60_000, `mean over those three (${Math.round(some.mean / 60_000)}m)`);
  ok(some.median === 20 * 60_000, `median (${Math.round(some.median / 60_000)}m)`);
  ok(some.longest === 30 * 60_000, `longest (${Math.round(some.longest / 60_000)}m)`);

  // the reason the median is carried at all
  const outlier = matchLengths([
    g('A', 20 * 60_000), g('B', 22 * 60_000), g('C', 21 * 60_000), g('D', 300 * 60_000),
  ]);
  ok(outlier.median <= 22 * 60_000 && outlier.mean > 60 * 60_000,
    `one game left open over lunch moved the mean to ${Math.round(outlier.mean / 60_000)}m and `
    + `the median to ${Math.round(outlier.median / 60_000)}m — which is why both are reported`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
rmSync(DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
