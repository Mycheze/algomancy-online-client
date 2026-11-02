/* docs/22 §2.5, §6.2 — A LEAGUE MATCH CLOSES AT ITS LEAGUE WEEK'S END.
 *
 * The owner, 2026-11-02, on how long a match may stay paused, chose "7 days,
 * then void" — the option that read: "Kept for a week. If not resumed by then
 * it closes with no result. League matches also close at the end of their
 * league week."
 *
 *   §0 before the week closes, nothing is voided
 *   §1 ⭐ the week closes: a PAUSED league match is voided, and so is one
 *      waiting BETWEEN games — no result, the waiting room closed, the league
 *      match left at the week's "unplayed"
 *   §2 ⭐ a game in progress at the boundary is played out: if it decides the
 *      match, the played result replaces "unplayed"
 *   §3 ⭐ …and if it does not, the match is voided once that game ends
 *   §4 a casual (non-league) match is no league week's business
 *   §5 CT-514 — "Your matches" and the paused screen give the week's end as
 *      the deadline when it comes before the 7-day pause limit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t829');
const A = await import('../accounts.ts');
const LS = await import('../league-store.ts');
const LG = await import('../league.ts');
const LM = await import('../league-match.ts');
const restoreAccounts = A.useAccountsFile(join(F.DIR, 'accounts.json'));
const restoreLeague = LS.useLeagueFile(join(F.DIR, 'league.json'));
test.after(() => { restoreLeague(); restoreAccounts(); rmSync(F.DIR, { recursive: true, force: true }); });
LM.installLeagueMatchHooks();

const OPEN = Date.parse('2026-12-01T10:00:00Z');
const WEEK1 = Date.parse('2026-12-06T07:00:00Z');
const WEEK2 = WEEK1 + LG.WEEK_MS;
const HOUR = 3_600_000;
function player(name: string) {
  assert.ok(A.register(name, 'correct horse battery').ok);
  const a = A.accountByName(name)!;
  const g = new Array<string>(LG.GRID_LEN).fill('0');
  for (let d = 0; d < 7; d++) for (let h = 18; h < 23; h++) g[d * 24 + h] = '1';
  A.setLeagueAvailability(a, 'Europe/London', g.join(''));
  A.setLeagueContact(a, `${name.toLowerCase()}_dc`);
  return a;
}

// eight players, four week-1 matches, one per scenario
assert.ok(LS.createSeason({
  id: 'cc-wk', name: 'Week end', signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(),
  weeks: 3, perWeek: 1, auto: false, hidden: false, format: 'competitive',
}, OPEN - HOUR).ok);
const season = () => LS.seasonById('cc-wk')!;
LS.advance(season(), OPEN);
for (const n of ['Wa', 'Wb', 'Wc', 'Wd', 'We', 'Wf', 'Wg', 'Wh']) LS.joinSeason(season(), player(`Wk${n}`), OPEN + HOUR);
LS.advance(season(), WEEK1);
const week1 = season().matches.filter(x => x.week === 1);
assert.equal(week1.length, 4, 'four week-1 matches');

let n = 0;
/** Play on a league match: its CC match, both seats registered, game 1 dealt */
function open(i: number) {
  const lm = week1[i]!;
  const name = (id: string) => ({ userId: id, username: A.accountById(id)!.username });
  const r = LM.openLeagueMatch({ existing: null, a: name(lm.a), b: name(lm.b), season: 'cc-wk', match: lm.id, rated: true },
    () => { const c = `WK${++n}X`; F.R.reserveRoomCode(c); return c; });
  const room = F.R.getRoom(r.code)!;
  for (const s of [0, 1] as Seat[]) {
    const reg = F.M.registerSeat(room, s, room.users[s]!, 'p', F.REG[s]!);
    assert.ok(reg.ok);
  }
  return { lm, m: F.S.getMatch(r.match)!, g1: room };
}
function dealNext(m: Parameters<typeof F.current>[0]) {
  const room = F.current(m);
  F.seatUp(room, 0, 1);
  F.M.matchSeatJoined(room);
  const chooser = m.between!.chooser;
  F.M.matchOp(room, chooser === 0 ? 1 : 0, 'ready', { ready: true });
  F.M.matchOp(room, chooser, 'ready', { ready: true, initiative: chooser });
  assert.equal(m.phase, 'game');
  return room;
}

const paused = open(0);
F.concede(paused.g1, 1);
const pRoom = F.current(paused.m);
F.seatUp(pRoom, 0, 1);
F.M.matchSeatJoined(pRoom);
F.M.matchOp(pRoom, 0, 'pause', {});
F.M.matchOp(pRoom, 1, 'pause', {});

const between = open(1);
F.concede(between.g1, 0);

const decider = open(2);       // 1-1, game 3 live at the boundary
F.concede(decider.g1, 0);
F.concede(dealNext(decider.m), 1);
const dG3 = dealNext(decider.m);

const live = open(3);          // game 1 live at the boundary

test('§0 before the week closes nothing is voided', () => {
  assert.equal(paused.m.phase, 'paused');
  assert.equal(between.m.phase, 'between');
  F.M.sweepMatches(Date.now());
  assert.deepEqual([paused.m.phase, between.m.phase, decider.m.phase, live.m.phase], ['paused', 'between', 'game', 'game']);
  assert.equal(LM.leagueWeekClosed(paused.m), false);
});

test('§5 Your matches and the paused screen give the league week end when it comes first', () => {
  const p = paused.m.pause!;
  const was = p.pausedAt;
  try {
    p.pausedAt = WEEK2 - 2 * 24 * HOUR;     // the 7 days would run past the week's end
    const row = (m: typeof paused.m) => F.M.matchesFor(m.users[0]!).find(x => x.id === m.id)!;
    assert.equal(row(paused.m).voidAt, WEEK2, 'a paused league match lapses with its week');
    assert.equal(F.M.matchLobbyInfo(F.current(paused.m), 0)?.pause?.voidAt, WEEK2, 'and its paused screen says so');
    assert.equal(row(between.m).voidAt, WEEK2, 'one waiting between games closes with its week too');
    p.pausedAt = WEEK2 - 9 * 24 * HOUR;     // …and the 7 days, when they come first
    assert.equal(row(paused.m).voidAt, WEEK2 - 2 * 24 * HOUR);
  } finally {
    p.pausedAt = was;
  }
});

test('§1 ⭐ the week closes: a paused and a between league match are voided with no result', () => {
  LS.advance(season(), WEEK2);
  const lm = (i: number) => season().matches.find(x => x.id === week1[i]!.id)!;
  assert.equal(lm(0).result?.outcome, 'unplayed', 'the week closed on it');
  assert.equal(LM.leagueWeekClosed(paused.m), true);
  const pWait = F.current(paused.m), bWait = F.current(between.m);
  F.M.sweepMatches(Date.now());
  assert.equal(paused.m.phase, 'void', '⭐ the paused match is closed');
  assert.match(paused.m.voided?.why ?? '', /league week/);
  assert.equal(between.m.phase, 'void', '⭐ so is the one waiting between games');
  assert.equal(paused.m.result, undefined, 'with no result');
  assert.equal(pWait.closed?.reason, 'void', 'its waiting room is closed');
  assert.equal(bWait.closed?.reason, 'void');
  assert.deepEqual([lm(0).result?.how, lm(1).result?.how], ['deadline', 'deadline'], 'the league match stays unplayed');
});

test('§2 ⭐ a game in progress plays out, and if it decides the match its result stands', () => {
  assert.equal(decider.m.phase, 'game', 'not voided while its game is live');
  assert.equal(live.m.phase, 'game');
  F.concede(dG3, 1);                    // game 3: seat 0 wins 2-1
  assert.equal(decider.m.phase, 'over');
  const lm = season().matches.find(x => x.id === week1[2]!.id)!;
  assert.equal(lm.result?.how, 'played', '⭐ the played result replaces unplayed');
  assert.equal(lm.result?.code, dG3.code);
});

test('§3 ⭐ a game at the boundary that does not decide the match: voided when it ends', () => {
  F.concede(live.g1, 0);
  assert.equal(live.m.phase, 'between', 'game 1 ended; the match moved on');
  F.M.sweepMatches(Date.now());
  assert.equal(live.m.phase, 'void', '⭐ and the next sweep closes it');
  const lm = season().matches.find(x => x.id === week1[3]!.id)!;
  assert.equal(lm.result?.how, 'deadline');
});

test('§4 a casual match is no league week business', () => {
  const { room, m } = F.start(3);
  F.concede(room, 0);
  assert.equal(LM.leagueWeekClosed(m), false);
  F.M.sweepMatches(Date.now());
  assert.equal(m.phase, 'between');
});
