/* 379 — SIGN-UP WEEK GAMES, AND THE ROOM A LEAGUE MATCH IS PLAYED IN.
 *
 * The owner, 2026-10-04, launching the October league: sign-up week has no
 * pairings, but "it will give you recommendations of who's got time matching
 * yours so that you can play with them and it sorta gets added to the week".
 * Settled: at most `perWeek` each and one per opponent; one never played
 * vanishes at week 1; it is not rated (the weekly pairings are). A Discord
 * NAME is typed, never verified.
 *
 * It no longer COUNTS (owner, 2026-11-10, #steward): "League matches played
 * outside of the league paired matches shouldn't count to your overall
 * record. Some players are getting competitive and want things to be
 * perfectly fair." Until then a sign-up week game went into the table like
 * any match. It is practice now: no win, loss or points, no record in its
 * result message (none is sent), nothing towards OMW or head to head.
 *
 *   §1  ⭐ the recommendations: everybody else in, best overlap first, with a
 *       Discord name only an entrant sees
 *   §2  ⭐ a sign-up week game: the cap, one per pair, only in sign-up week,
 *       call-off, and once played it is NOT in the table
 *   §3  week 1 drops the unplayed ones and pairs as if they never existed
 *   §4  which match a player may open, and when
 *   §5  ⭐ the league room: both seats bound, the trio method fixed to random
 *       and drawn only once both are ready, the tag and `rated` survive a
 *       restart, and a rematch is a friendly
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, register, setLeagueAvailability, setLeagueContact, useAccountsFile, type Account } from '../accounts.ts';
import { GRID_LEN, WEEK_MS } from '../league.ts';
import {
  advance, cancelChallenge, challenge, createSeason, matchOpened, matchToOpen, outboxRows, recordPlayed,
  seasonById, seasonView, table, useLeagueFile, joinSeason, type Season,
} from '../league-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'league0-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
const restoreLeague = useLeagueFile(join(dir, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

// the real calendar: sign-ups Sun 4 Oct, week 1 Sun 11 Oct 07:00 UTC
const OPEN = Date.parse('2026-10-04T09:00:00Z');
const WEEK1 = Date.parse('2026-10-11T07:00:00Z');
const HOUR = 3_600_000;

/** a grid with these local hours on every day */
function everyDay(from: number, to: number): string {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (let d = 0; d < 7; d++) for (let h = from; h < to; h++) g[d * 24 + h] = '1';
  return g.join('');
}

function player(name: string, tz: string, grid: string): Account {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `register ${name}`);
  const a = accountByName(name)!;
  setLeagueAvailability(a, tz, grid);
  setLeagueContact(a, `${name.toLowerCase()}_dc`);
  return a;
}

function season(id: string): Season {
  const r = createSeason({
    id, name: `Test ${id}`, signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(),
    weeks: 3, perWeek: 2, auto: false, hidden: false,
  }, OPEN - HOUR);
  assert.ok(r.ok, r.ok ? '' : r.error);
  const s = seasonById(id)!;
  advance(s, OPEN);
  return s;
}

test('league week 0 §1 the recommendations put the best overlap first', () => {
  const s = season('w0a');
  const me = player('Lon1', 'Europe/London', everyDay(18, 23));
  const near = player('Par1', 'Europe/Paris', everyDay(19, 24));      // = London 18–23: all of it
  const half = player('Ny1', 'America/New_York', everyDay(14, 18));   // = London 19–23: most of it
  const none = player('Syd1', 'Australia/Sydney', everyDay(18, 23));  // London 07–12: nothing
  const outsider = player('Out1', 'Europe/London', everyDay(18, 23));
  for (const a of [me, near, half, none]) assert.deepEqual(joinSeason(s, a, OPEN + 1), { ok: true });

  const now = OPEN + HOUR;
  const v = seasonView(s, me, { admin: false, now });
  const sug = v.me!.suggestions;
  assert.deepEqual(sug.map(x => x.name), ['Par1', 'Ny1', 'Syd1'], 'best overlap first, nobody left out');
  assert.ok(sug[0]!.days >= 6 && sug[0]!.hours > sug[1]!.hours, 'Paris shares more hours than New York');
  assert.equal(sug[2]!.days, 0, 'Sydney shares nothing, and is still listed');
  assert.ok(sug.every(x => x.windows.every(w => w.start + w.hours * HOUR > now)), 'only windows still ahead');
  assert.ok(sug.every(x => x.windows.every(w => w.start < WEEK1)), 'and only inside sign-up week');
  assert.equal(sug[0]!.contact, 'par1_dc', 'an entrant sees the Discord name');

  // a passer-by sees the sign-ups but no Discord names and no recommendations
  const out = seasonView(s, outsider, { admin: false, now });
  assert.ok(out.entrants.every(e => !('contact' in e)), '⭐ a Discord name is for the league, not for passers-by');
  assert.deepEqual(out.me!.suggestions, []);
  // …and an organizer sees every name, to post the pairings
  assert.ok(seasonView(s, undefined, { admin: true, now }).entrants.every(e => typeof e.contact === 'string'));
});

test('league week 0 §2 a sign-up week game: the cap, one per pair, call-off, and it is not in the record', () => {
  const s = season('w0b');
  const [a, b, c, d] = ['Ann0', 'Bob0', 'Cat0', 'Dan0'].map(n => player(n, 'Europe/London', everyDay(18, 23)));
  const late = player('Eve0', 'Europe/London', everyDay(18, 23));
  for (const x of [a, b, c, d]) joinSeason(s, x!, OPEN + 1);

  const ab = challenge(s, a!, b!.id, OPEN + HOUR);
  assert.ok(ab.ok);
  assert.equal(challenge(s, b!, a!.id, OPEN + HOUR).ok, false, 'one game per pair, whoever asks');
  assert.equal(challenge(s, a!, late.id, OPEN + HOUR).ok, false, 'only with somebody in the league');
  assert.ok(challenge(s, a!, c!.id, OPEN + HOUR).ok);
  const capped = challenge(s, a!, d!.id, OPEN + HOUR);
  assert.match(capped.ok ? '' : capped.error, /already have 2 games/, '⭐ perWeek games each, like a normal week');
  const theirs = challenge(s, d!, a!.id, OPEN + HOUR);
  assert.match(theirs.ok ? '' : theirs.error, /they already have 2/);

  // the opponent is told, with who and how to reach them
  const row = outboxRows().find(r => r.season === s.id && r.kind === 'challenge' && r.to === b!.id)!;
  assert.equal((row.data['from'] as { contact: string }).contact, 'ann0_dc');

  // calling one off frees the slot — either player may, a stranger may not
  const ac = s.matches.find(m => m.week === 0 && m.b === c!.id)!;
  assert.equal(cancelChallenge(s, d!, ac.id, OPEN + HOUR).ok, false);
  assert.ok(cancelChallenge(s, c!, ac.id, OPEN + HOUR).ok);
  assert.ok(challenge(s, a!, d!.id, OPEN + HOUR).ok, 'the freed slot can be used again');

  // played, it is recorded on the match — and a decided one cannot be called
  // off — but it is not in anybody's record (owner, 2026-11-10)
  const abId = ab.ok ? ab.match : '';
  assert.ok(recordPlayed(abId, b!.id, 'ROOM', OPEN + 2 * HOUR));
  assert.equal(s.matches.find(m => m.id === abId)!.result?.outcome, 'b', 'the match still knows who won');
  assert.equal(cancelChallenge(s, a!, abId, OPEN + 3 * HOUR).ok, false);
  const rowB = table(s).find(r => r.id === b!.id)!, rowA = table(s).find(r => r.id === a!.id)!;
  assert.deepEqual([rowB.w, rowB.l, rowB.points, rowA.w, rowA.l, rowA.points], [0, 0, 0, 0, 0, 0],
    '⭐ a sign-up week game is not in the standings: no win, no loss, no points');
  assert.equal(outboxRows().filter(r => r.season === s.id && r.kind === 'result' && r.data['match'] === abId).length, 0,
    'and no result message tells either player a "new record"');
});

test('league week 0 §2b a sign-up week win is not one of the season wins', () => {
  const s = season('w0e');
  const [a, b, c, d] = ['Ann5', 'Bob5', 'Cat5', 'Dan5'].map(n => player(n, 'Europe/London', everyDay(18, 23)));
  for (const x of [a, b, c, d]) joinSeason(s, x!, OPEN + 1);
  const ab = challenge(s, a!, b!.id, OPEN + HOUR);
  assert.ok(ab.ok);
  recordPlayed(ab.match, a!.id, 'R0', OPEN + 2 * HOUR);
  advance(s, WEEK1);
  // week 1: a and b each win one paired match, against the same two players
  const w1 = s.matches.filter(m => m.week === 1);
  for (const m of w1) {
    const winner = [a!.id, b!.id].includes(m.a) ? m.a : [a!.id, b!.id].includes(m.b) ? m.b : m.a;
    recordPlayed(m.id, winner, `R-${m.id}`, WEEK1 + HOUR);
  }
  const rows = table(s);
  const ra = rows.find(r => r.id === a!.id)!, rb = rows.find(r => r.id === b!.id)!;
  const paired = (id: string): number => w1.filter(m => m.result && (m.result.outcome === 'a' ? m.a : m.b) === id).length;
  assert.deepEqual([ra.w, rb.w], [paired(a!.id), paired(b!.id)], '⭐ wins are the paired wins only');
  assert.equal(ra.l + ra.w + rb.l + rb.w,
    w1.filter(m => [m.a, m.b].includes(a!.id)).length + w1.filter(m => [m.a, m.b].includes(b!.id)).length,
    'every counted result is a week-1 match');
});

test('league week 0 §3 week 1 drops the unplayed and pairs as if they never were', () => {
  const s = season('w0c');
  const ps = ['Ann3', 'Bob3', 'Cat3', 'Dan3'].map(n => player(n, 'Europe/London', everyDay(18, 23)));
  for (const x of ps) joinSeason(s, x, OPEN + 1);
  const played = challenge(s, ps[0]!, ps[1]!.id, OPEN + HOUR);
  const open = challenge(s, ps[2]!, ps[3]!.id, OPEN + HOUR);
  assert.ok(played.ok && open.ok);
  recordPlayed(played.match, ps[0]!.id, 'R', OPEN + 2 * HOUR);
  assert.equal(challenge(s, ps[0]!, ps[2]!.id, WEEK1).ok, true, 'still sign-up week until Advance');
  advance(s, WEEK1);
  assert.equal(s.matches.filter(m => m.week === 0).length, 1, 'the played one stays, both unplayed ones go');
  assert.ok(s.matches.every(m => m.week !== 0 || m.result), 'no unplayed sign-up week game survives');
  assert.equal(table(s).find(r => r.id === ps[0]!.id)!.unplayed, 0, 'and none reads as "not played"');
  assert.equal(challenge(s, ps[1]!, ps[3]!.id, WEEK1 + HOUR).ok, false, 'no new ones once week 1 is out');
});

test('league week 0 §4 a player opens only their own match, only in its week', () => {
  const s = season('w0d');
  const [a, b, c] = ['Ann4', 'Bob4', 'Cat4'].map(n => player(n, 'Europe/London', everyDay(18, 23)));
  for (const x of [a, b, c]) joinSeason(s, x!, OPEN + 1);
  const r = challenge(s, a!, b!.id, OPEN + HOUR);
  assert.ok(r.ok);
  assert.ok(matchToOpen(s, b!, r.match).ok, 'either player');
  assert.equal(matchToOpen(s, c!, r.match).ok, false, 'never a third');
  const m = s.matches.find(x => x.id === r.match)!;
  matchOpened(s, m, a!, 'ABCD', OPEN + HOUR);
  matchOpened(s, m, a!, 'ABCD', OPEN + HOUR + 60_000);
  assert.equal(m.room, 'ABCD');
  assert.equal(outboxRows().filter(x => x.kind === 'waiting' && x.to === b!.id).length, 1,
    'the "waiting for you" ping goes once per half hour');
  recordPlayed(r.match, a!.id, 'ABCD', OPEN + 2 * HOUR);
  assert.match((matchToOpen(s, a!, r.match) as { error: string }).error, /decided/);

  advance(s, WEEK1);
  const w1 = s.matches.find(x => x.week === 1)!;
  const p1 = [w1.a, w1.b].map(id => [a, b, c].find(x => x!.id === id)!);
  assert.ok(matchToOpen(s, p1[0]!, w1.id).ok, 'a week match while its week runs');
  advance(s, WEEK1 + WEEK_MS);
  assert.match((matchToOpen(s, p1[0]!, w1.id) as { error: string }).error, /decided|over/, 'and not after');
});

// ── the room ──────────────────────────────────────────────────────────

type Rooms = typeof import('../rooms.ts');
async function roomsAt(d: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = d;
  return import(`../rooms.ts?league=${Math.random()}`) as Promise<Rooms>;
}

test('league week 0 §5 ⭐ the league room: bound seats, a random trio, and a tag that survives', async () => {
  const games = mkdtempSync(join(tmpdir(), 'league-rooms-'));
  try {
    const R = await roomsAt(games);
    const room = R.createLeagueRoom({ userId: 'u-a', username: 'Ann' }, { userId: 'u-b', username: 'Bob' },
      'LGA1', { season: 'oct', match: 'oct-w1-1' }, true);
    assert.deepEqual(room.users, ['u-a', 'u-b'], 'both seats bound before anybody joins');
    assert.ok('refuse' in R.seatVerdict(room, undefined, 'u-x'), 'a third account is refused');
    assert.equal(room.mode, 'draft');
    assert.equal(room.rated, true);
    assert.deepEqual(room.league, { season: 'oct', match: 'oct-w1-1' });
    assert.ok(R.roomWaiting(room), 'nothing is dealt at creation');
    assert.equal(R.roomLobby(room)!.method, 'random');
    assert.equal(R.setLobbyMethod(room, 'pick-one'), false, '⭐ the method cannot be changed in a league room');

    R.setLobbySubmission(room, 0, {}, true);
    assert.equal(R.resolveLobby(room, []), null, 'one ready player is not enough');
    R.setLobbySubmission(room, 1, {}, true);
    const trio = R.resolveLobby(room, [])!;
    assert.equal(new Set(trio.els).size, 3, 'three distinct elements');
    assert.match(trio.how, /at random/);

    // a week-0 room is not rated
    const w0 = R.createLeagueRoom({ userId: 'u-a', username: 'Ann' }, { userId: 'u-b', username: 'Bob' },
      'LGA2', { season: 'oct', match: 'oct-w0-1' }, false);
    assert.equal(w0.rated, undefined);

    // a restart keeps the tag, the rating and the fixed method
    const R2 = await roomsAt(games);
    R2.restoreRooms(Date.now());
    const back = R2.getRoom('LGA2')!;
    assert.deepEqual(back.league, { season: 'oct', match: 'oct-w0-1' });
    assert.equal(R2.roomLobby(back)!.method, 'random', 'an unresolved league lobby restores as one');
    assert.equal(R2.setLobbyMethod(back, 'rank'), false);
    assert.equal(R2.getRoom('LGA1')!.rated, true);
    assert.deepEqual(R2.getRoom('LGA1')!.league, { season: 'oct', match: 'oct-w1-1' });

    // a rematch is a friendly: no tag, not rated, an ordinary lobby
    const again = R2.createRematch(R2.getRoom('LGA1')!, 'LGA3');
    assert.equal(again.league, undefined, '⭐ a rematch never settles the league match again');
    assert.equal(again.rated, undefined);
    assert.notEqual(R2.roomLobby(again)?.method, 'random');
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});
