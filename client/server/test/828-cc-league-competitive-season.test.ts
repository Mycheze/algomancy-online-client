/* docs/22 §6.2 — A COMPETITIVE LEAGUE SEASON: EACH MATCH IS A BEST OF THREE.
 *
 * The owner, 2026-11-02: CC is "for the upcoming league", and the spec's
 * default (not objected to) is that the December league is CC Bo3.
 *
 *   §1 ⭐ 'competitive' is a format: formatOf reads it as itself (it used to read
 *      anything not 'constructed' as a draft), a season keeps it across a reload,
 *      the organizer can pick it, and an unknown format is still refused
 *   §2 ⭐ Play on a week-1 match opens a CC MATCH — Best of 3, rated (week 1 and
 *      on, as every league room), both accounts bound — and the league
 *      remembers the match, not a room code; Play again opens the same room
 *   §3 ⭐ a game of it reports nothing; Play then opens the match's CURRENT room;
 *      the decided match reports ONCE, with every game's code, and moves the
 *      rating once
 *   §4 a dispute is accepted from any game of the match, and refused from a
 *      room that was not one of them
 *   §5 the per-game league report in main.ts stays off for a match room
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t828');
const A = await import('../accounts.ts');
const LS = await import('../league-store.ts');
const LG = await import('../league.ts');
const LM = await import('../league-match.ts');
const API = await import('../api-league.ts');
const restoreAccounts = A.useAccountsFile(join(F.DIR, 'accounts.json'));
const restoreLeague = LS.useLeagueFile(join(F.DIR, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(F.DIR, { recursive: true, force: true }); });
LM.installLeagueMatchHooks();

const OPEN = Date.parse('2026-12-01T10:00:00Z');
const WEEK1 = Date.parse('2026-12-06T07:00:00Z');
const HOUR = 3_600_000;
const PASS = 'correct horse battery';
const base = { signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(), weeks: 3, perWeek: 1, auto: false, hidden: false };
function player(name: string) {
  assert.ok(A.register(name, PASS).ok);
  const a = A.accountByName(name)!;
  const g = new Array<string>(LG.GRID_LEN).fill('0');
  for (let d = 0; d < 7; d++) for (let h = 18; h < 23; h++) g[d * 24 + h] = '1';
  A.setLeagueAvailability(a, 'Europe/London', g.join(''));
  A.setLeagueContact(a, `${name.toLowerCase()}_dc`);
  return a;
}
/** a request to leagueRoutes, as main.ts would hand it over (752's shape),
 * with main.ts's opener for a competitive season */
async function call(path: string, body: unknown, token: string) {
  const req = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  Object.assign(req, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  let text = '';
  const res = { writeHead() { return this; }, end(t?: string) { text = t ?? ''; } } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  let n = 0;
  await API.leagueRoutes(req, res, url.pathname, url, {
    botAllowed: false, now: () => WEEK1 + HOUR,
    openRoom: r => {
      assert.equal(r.mode, 'competitive', 'the opener is told the season is competitive');
      return LM.openLeagueMatch(r, () => { const c = `LGM${++n}${Math.random().toString(36).slice(2, 5).toUpperCase()}`; F.R.reserveRoomCode(c); return c; });
    },
  });
  return JSON.parse(text) as Record<string, unknown>;
}

test('§1 ⭐ competitive is a format of its own', () => {
  assert.deepEqual([...LS.LEAGUE_FORMATS], ['draft', 'constructed', 'competitive']);
  assert.equal(LS.formatOf({ format: 'competitive' }), 'competitive', '⭐ not read as a draft');
  assert.equal(LS.formatOf({}), 'draft', 'a row with no format is still a draft');
  assert.equal(LS.formatOf({ format: 'sealed' }), 'draft');
  assert.equal(LS.roomModeOf('competitive'), 'constructed', 'its games are constructed games');
  const r = LS.createSeason({ id: 'cc-fmt', name: 'Fmt', ...base, format: 'competitive' }, OPEN - HOUR);
  assert.ok(r.ok, r.ok ? '' : r.error);
  const raw = (JSON.parse(readFileSync(join(F.DIR, 'league.json'), 'utf8')) as { seasons: Record<string, unknown>[] })
    .seasons.find(s => s['id'] === 'cc-fmt')!;
  assert.equal(raw['format'], 'competitive', 'written as itself');
  LS.loadLeague();
  assert.equal(LS.formatOf(LS.seasonById('cc-fmt')!), 'competitive', 'and read back after a reload');
  assert.equal(LS.seasonView(LS.seasonById('cc-fmt')!, undefined, { admin: false }).format, 'competitive');
  assert.ok(LS.createSeason({ id: 'cc-flip', name: 'Flip', ...base }, OPEN - HOUR).ok);
  assert.ok(LS.updateSeason('cc-flip', { format: 'competitive' }, OPEN).ok, 'the organizer can make a season competitive');
  assert.equal(LS.formatOf(LS.seasonById('cc-flip')!), 'competitive');
  assert.equal(LS.createSeason({ id: 'cc-bad', name: 'Bad', ...base, format: 'sealed' as never }, OPEN).ok, false,
    'an unknown format is still refused');
});

// one competitive season, two players, paired in week 1
assert.ok(LS.createSeason({ id: 'cc-dec', name: 'December', ...base, format: 'competitive' }, OPEN - HOUR).ok);
LS.advance(LS.seasonById('cc-dec')!, OPEN);
const ANN = player('CcAnn'), BO = player('CcBo');
LS.joinSeason(LS.seasonById('cc-dec')!, ANN, OPEN + HOUR);
LS.joinSeason(LS.seasonById('cc-dec')!, BO, OPEN + HOUR);
LS.advance(LS.seasonById('cc-dec')!, WEEK1);
const LMATCH_ID = LS.seasonById('cc-dec')!.matches.find(x => x.week === 1)!.id;
// read through the store every time: §1 reloads it from its file
const season = () => LS.seasonById('cc-dec')!;
const lmatch = () => season().matches.find(x => x.id === LMATCH_ID)!;
const TOKEN = (() => { const r = A.login('CcAnn', PASS); assert.ok(r.ok); return r.token!; })();

/** each seat registers its fixture deck for game 1 (what the CC join does) */
function register(room: ReturnType<typeof F.current>): void {
  for (const s of [0, 1] as Seat[]) {
    const uid = room.users[s]!;
    const r = F.M.registerSeat(room, s, uid, A.accountById(uid)!.username, F.REG[s]!);
    assert.ok(r.ok, r.ok ? '' : r.why);
  }
}

let MATCH_ID = '';
let G1 = '';
test('§2 ⭐ Play opens a rated Bo3 match and the league remembers the match', async () => {
  assert.ok(lmatch(), 'week 1 paired the two');
  const r = await call('/api/league/play', { season: 'cc-dec', match: LMATCH_ID }, TOKEN);
  assert.equal(r['ok'], true, String(r['error']));
  assert.equal(r['mode'], 'competitive', 'the client is told the format');
  const room = F.R.getRoom(String(r['room']))!;
  assert.ok(room, 'a room exists');
  assert.equal(room.mode, 'constructed');
  assert.deepEqual(room.rules, { sequential: true }, 'a CC game: sequential steps, game 1 rolls');
  const m = F.M.matchOfRoom(room)!;
  assert.ok(m, '⭐ the room is game 1 of a CC match');
  assert.deepEqual(room.match, { id: m.id, game: 1 });
  assert.equal(m.bestOf, 3, '⭐ best of three');
  assert.equal(m.rated, true, '⭐ rated: a week-1 league match');
  assert.equal(room.rated, true);
  assert.deepEqual(room.league, { season: 'cc-dec', match: LMATCH_ID });
  assert.deepEqual(new Set(m.users), new Set([ANN.id, BO.id]), 'both accounts bound to the match');
  assert.deepEqual(new Set(room.users), new Set([ANN.id, BO.id]), 'and to the room');
  assert.equal(r['seat'], room.users.indexOf(ANN.id));
  assert.equal(lmatch().room, m.id, '⭐ the league remembers the MATCH, not a room code');
  const again = await call('/api/league/play', { season: 'cc-dec', match: LMATCH_ID }, TOKEN);
  assert.equal(again['room'], room.code, 'Play again opens the same room');
  MATCH_ID = m.id;
  G1 = room.code;
});

test('§3 ⭐ a game reports nothing; Play follows the match; the decided match reports once', async () => {
  const m = F.S.getMatch(MATCH_ID)!;
  const g1 = F.R.getRoom(G1)!;
  register(g1);
  assert.equal(F.R.roomWaiting(g1), false, 'game 1 dealt');
  const annSeat = g1.users.indexOf(ANN.id) as Seat;
  const boSeat = (annSeat === 0 ? 1 : 0) as Seat;
  F.concede(g1, boSeat);                       // Ann takes game 1
  assert.equal(m.phase, 'between');
  assert.equal(lmatch().result, undefined, '⭐ a game of the match reports nothing to the league');

  const play = await call('/api/league/play', { season: 'cc-dec', match: LMATCH_ID }, TOKEN);
  assert.equal(play['room'], m.room, '⭐ Play opens where the match stands');
  assert.notEqual(play['room'], G1, 'never game 1’s room once it is played');

  const g2 = F.current(m);
  F.seatUp(g2, 0, 1);
  F.M.matchSeatJoined(g2);
  F.M.matchOp(g2, annSeat, 'ready', { ready: true });
  F.M.matchOp(g2, boSeat, 'ready', { ready: true, initiative: boSeat });
  F.concede(g2, boSeat);                       // and game 2: 2-0
  assert.equal(m.phase, 'over');
  const res = lmatch().result;
  assert.deepEqual(res && { outcome: res.outcome, how: res.how, code: res.code, codes: res.codes },
    { outcome: lmatch().a === ANN.id ? 'a' : 'b', how: 'played', code: g2.code, codes: [G1, g2.code] },
    '⭐ the match reported once, as a match, with every game');
  assert.equal(LS.recordPlayed(LMATCH_ID, BO.id, g2.code, Date.now()), false, 'a second report changes nothing');
  assert.equal(LS.table(season()).find(r => r.id === ANN.id)?.w, 1, 'one win in the table, not two');
  // the rating: the match row (the games were walkovers, which rate nothing on their own)
  assert.equal(A.accountById(ANN.id)!.profile.ratedGames.constructed, 1, '⭐ the rating moved once');
});

test('§4 a dispute is accepted from any game of the match', () => {
  const m = F.S.getMatch(MATCH_ID)!;
  assert.equal(LS.flagDispute(LMATCH_ID, BO.id, G1, 'game 1 went wrong', Date.now()), true, 'from game 1, which did not end the match');
  assert.equal(LS.flagDispute(LMATCH_ID, ANN.id, m.games[1]!.code, 'and game 2', Date.now()), true, 'from the deciding game');
  assert.equal(LS.flagDispute(LMATCH_ID, BO.id, 'ZZZZ', 'elsewhere', Date.now()), false, 'not from a room outside the match');
  assert.equal(lmatch().disputes?.length, 2);
});

test('§5 the per-game league report stays off for a match room', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'main.ts'), 'utf8');
  const body = main.slice(main.indexOf('function recordFinishedGame('), main.indexOf('function sendGameOver('));
  const calls = body.split('leagueRecordPlayed(').length - 1;
  assert.equal(calls, 1, 'one per-game league report in recordFinishedGame');
  assert.match(body, /if \(room\.league && !room\.match\)/, 'and it is skipped for a game of a match');
});
