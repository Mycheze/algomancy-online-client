/* 614 — WHAT A RESTART, AND A FORGOTTEN ROOM, DO TO THE SAVED GAMES.
 *
 * Four tickets found by the CT-193 (idle rooms) and BL-46 (agreed fixes)
 * agents, all about rooms that are on disk and not, or no longer, in memory:
 *
 *   §1 CT-195  a FINISHED room main.ts forgot after an hour (or a restart did
 *              not load) answered its link "No game with code X". It now says
 *              the game is over and who won.
 *   §2 CT-196  every restart under a new engine re-wrote each unfinished room
 *              (the version stamp), and history.ts reads the file mtime as the
 *              day the game was played — so the restart re-dated it. The
 *              restart's write now keeps the file's date.
 *   §3 CT-197  the 50-room sandbox cap lived in memory only, so the sandboxes a
 *              restart restored were never counted, and never evicted.
 *   §4 CT-335  a run of agreed fixes not yet filed sat in a file the restore
 *              does not load (closed, or a week without a move) and was never
 *              filed. Boot now files it and takes it out of the file.
 *
 * §1 and §2 run rooms.ts in-process over a throwaway directory; §3 and §4 boot
 * the real server over another (spawnServer), because the cap and the filing
 * are main.ts's. Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import { spawnServer, type ServerHandle } from '../e2e/test-util.ts';

type Rooms = typeof import('../rooms.ts');
const DAY = 24 * 3600_000;

/** a fresh copy of rooms.ts pointed at `dir` — what a restarted server is */
async function roomsAt(dir: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?r614=${Math.random()}`) as Promise<Rooms>;
}

/** `n` real actions, the first legal one each time, never a concede */
function play(mod: Rooms, room: Room, n: number): void {
  for (let i = 0; i < n; i++) {
    const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)]
      .filter(a => a.type !== 'concede');
    assert.ok(legal.length, `no legal action after ${i}`);
    mod.applyToRoom(room, legal[0]!);
  }
}

const fileOf = (dir: string, code: string): Record<string, any> =>
  JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as Record<string, any>;
const writeFile = (dir: string, code: string, raw: Record<string, unknown>): void =>
  writeFileSync(join(dir, `${code}.json`), JSON.stringify(raw));

test('CR D7.5 / CT-195: a finished game forgotten from memory answers its link with its result, not No game with code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'algo-614a-'));
  const mod = await roomsAt(dir);
  const room = mod.createRoom('R614A', 61401, ['Rashi', 'Bena'], 'shared');
  play(mod, room, 6);
  mod.applyToRoom(room, { type: 'concede', seat: 1 });
  assert.equal(mod.decidedWinner(room), 0, 'Rashi won');
  assert.equal(mod.joinRefusal('R614A'), null, 'while the room is in memory the join goes ahead');
  mod.dropRoom('R614A');   // what sweepFinished does an hour after the last visitor left
  const said = mod.joinRefusal('R614A');
  assert.ok(said, 'the link is refused — there is no room to join');
  assert.doesNotMatch(said!, /No game with code/, 'and not as a typo');
  assert.match(said!, /^Game R614A is over: Rashi won\./, 'it says the game is over and who won');
  assert.match(said!, /match history/, 'and where its replay is');
  // a game nobody finished and nobody closed is still the typo answer: the
  // sentence is about a result, and there is none to state
  const open = mod.createRoom('R614B', 61402, ['Rashi', 'Bena'], 'shared');
  play(mod, open, 3);
  mod.dropRoom('R614B');
  assert.match(mod.joinRefusal('R614B')!, /No game with code R614B/);
  assert.equal(mod.closedNotice('R614Z'), null, 'and a code with no file names nothing');
});

test('CT-196: a restart under a new engine keeps the date of an unfinished game file, so history does not re-date it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'algo-614b-'));
  const mod = await roomsAt(dir);
  const room = mod.createRoom('R614C', 61403, ['Rashi', 'Bena'], 'shared');
  play(mod, room, 8);
  const path = join(dir, 'R614C.json');
  // played three days ago, on an engine that is no longer deployed
  const raw = fileOf(dir, 'R614C');
  const playedAt = Date.now() - 3 * DAY;
  raw['lastActionAt'] = playedAt;
  raw['versions'] = (raw['versions'] as { sha: string }[]).map(v => ({ ...v, sha: 'an-older-engine' }));
  writeFile(dir, 'R614C', raw);
  utimesSync(path, playedAt / 1000, playedAt / 1000);
  const before = statSync(path).mtime.toISOString();

  const restarted = await roomsAt(dir);
  restarted.restoreRooms();
  const back = restarted.getRoom('R614C');
  assert.ok(back, 'the unfinished game came back');
  const versions = fileOf(dir, 'R614C')['versions'] as { sha: string }[];
  assert.notEqual(versions.at(-1)!.sha, 'an-older-engine', 'the restart DID write the file: the new engine is stamped');
  assert.equal(statSync(path).mtime.toISOString(), before,
    'and the file still reads as played three days ago — history.ts takes this as the day played');
  // a real move afterwards dates it as before
  play(restarted, back!, 1);
  assert.ok(statSync(path).mtimeMs > playedAt + DAY, 'a move is a move: it dates the file now');
});

/* ── §3 and §4: the real server, one boot over one prepared directory ── */

const DIR = mkdtempSync(join(tmpdir(), 'algo-614-boot-'));
const GAMES = join(DIR, 'games');
mkdirSync(GAMES, { recursive: true });
const ISSUES = join(DIR, 'issues.jsonl');
const SANDBOXES = 50;
const sbCode = (i: number): string => `SB${String(i).padStart(2, '0')}`;
const now = Date.now();

const OLD = now - 8 * DAY;
const STRAYS = { finished: 'FX614F', unfinished: 'FX614U', closed: 'FX614C' } as const;
let server: ServerHandle | null = null;
after(async () => { await server?.stop(); server = null; });

/** Prepare the directory and boot the server over it, once. Run from inside
 * a test, never at module scope: node:test runs the tests above while the
 * module is still evaluating, and both write ALGO_GAMES_DIR before importing. */
async function booted(): Promise<ServerHandle> {
  if (server) return server;
  const mod = await roomsAt(GAMES);
  // fifty sandboxes, SB00 the least recently played
  for (let i = 0; i < SANDBOXES; i++) mod.createRoom(sbCode(i), 61410 + i, ['Seat 1', 'Seat 2'], 'shared', undefined, undefined, 'sandbox');
  for (let i = 0; i < SANDBOXES; i++) {
    const raw = fileOf(GAMES, sbCode(i));
    raw['lastActionAt'] = now - (SANDBOXES - i) * 60_000;
    writeFile(GAMES, sbCode(i), raw);
  }
  // three games a restore does not load, each with a run of fixes nobody filed
  for (const [kind, code] of Object.entries(STRAYS)) {
    const room = mod.createRoom(code, 61470, ['Rashi', 'Bena'], 'shared');
    play(mod, room, 7);
    if (kind === 'finished') mod.applyToRoom(room, { type: 'concede', seat: 1 });
    const raw = fileOf(GAMES, code);
    const n = (raw['actions'] as unknown[]).length;
    raw['lastActionAt'] = OLD;
    raw['amendments'] = [
      { kind: 'edit', at: n - 2, seat: 0, by: 1, what: `seat 1 gets 3 life back in ${code}`, reason: 'the engine took it twice' },
      { kind: 'edit', at: n - 2, seat: 0, by: 1, what: 'and one more', reason: 'still off by one' },
    ];
    raw['fixRun'] = { from: 0, at: n - 2, len: n, last: OLD };
    if (kind === 'closed') raw['closed'] = { reason: 'idle', at: OLD + 3600_000, afterMs: 12 * 3600_000 };
    writeFile(GAMES, code, raw);
    utimesSync(join(GAMES, `${code}.json`), OLD / 1000, OLD / 1000);
  }
  server = await spawnServer({
    ALGO_GAMES_DIR: GAMES, ALGO_ISSUES_FILE: ISSUES, ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'),
  });
  return server;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const fixRows = (): any[] => existsSync(ISSUES)
  ? readFileSync(ISSUES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.fix) : [];

test('CT-197: the sandbox cap counts the sandboxes a restart restored, so the next one evicts the oldest of them', async () => {
  await booted();
  for (let i = 0; i < SANDBOXES; i++) assert.ok(existsSync(join(GAMES, `${sbCode(i)}.json`)), `${sbCode(i)} restored with its file`);
  const res = await fetch(`http://localhost:${server!.port}/api/sandbox/open?json=1`);
  assert.equal(res.status, 200);
  const { code } = await res.json() as { code: string };
  assert.ok(existsSync(join(GAMES, `${code}.json`)), 'the new sandbox is saved');
  assert.ok(!existsSync(join(GAMES, `${sbCode(0)}.json`)),
    'the fifty-first sandbox evicted the least recently played restored one, file and all');
  for (let i = 1; i < SANDBOXES; i++) assert.ok(existsSync(join(GAMES, `${sbCode(i)}.json`)), `${sbCode(i)} is kept`);
});

test('CR D4.5 / CT-335: a run of agreed fixes in a game too old or closed to restore is filed at boot and leaves the file', async () => {
  await booted();
  let rows: any[] = [];
  for (let k = 0; k < 40 && rows.length < 3; k++) { await sleep(100); rows = fixRows(); }
  assert.equal(rows.length, 3, 'one row for each of the three unrestored games');
  for (const code of Object.values(STRAYS)) {
    const row = rows.find(r => r.room === code);
    assert.ok(row, `${code} filed its run`);
    assert.equal(row.fix.run, 2, 'the run of two, as one row');
    assert.match(row.note, /^\[Agreed fix\] seat 1 gets 3 life back in .*What went wrong: the engine took it twice\n\[and then\] and one more/);
    const raw = fileOf(GAMES, code);
    assert.equal(raw['fixRun'], undefined, `${code}: the filed run is out of the file, so the next boot does not file it again`);
    assert.equal((raw['amendments'] as unknown[]).length, 2, 'the fixes themselves stay — the row points at them');
  }
  assert.equal(fileOf(GAMES, STRAYS.finished)['winner'], 0, 'the finished game keeps its result');
  assert.ok(fileOf(GAMES, STRAYS.unfinished)['closed'], 'the unfinished one is closed on the way past, as before');
  assert.equal(Math.round(statSync(join(GAMES, `${STRAYS.finished}.json`)).mtimeMs), Math.round(OLD),
    'and filing is not a move: the finished file keeps its date (CT-196)');
});
