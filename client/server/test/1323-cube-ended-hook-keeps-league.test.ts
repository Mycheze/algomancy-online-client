/* docs/25 §8 — ONE `ended` HOOK, COMPOSED. match.ts keeps one function per hook key, so a cube
 * module setting its own `ended` would silently replace the league's. installLeagueMatchHooks
 * takes the cube's handler and calls both (main.ts does exactly this). Regression guard:
 *
 *   §1 a Competitive LEAGUE match decided with the cube's handler installed still reports to the
 *      league, once
 *   §2 a cube match decided in the same process reports to its event, and the league ignores it
 *   §3 a handler that throws does not stop the other
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { cubeFixture } from './cube-fixture.ts';

const X = await cubeFixture('t1323');
const { C, F, A, LM, ev, ok, clock } = X;
const LS = await import('../league-store.ts');
const LG = await import('../league.ts');
const restoreLeague = LS.useLeagueFile(join(F.DIR, 'league.json'));
test.after(() => { restoreLeague(); X.cleanup(); });

const OPEN = Date.parse('2026-12-01T10:00:00Z');
const WEEK1 = Date.parse('2026-12-06T07:00:00Z');
const HOUR = 3_600_000;
const [ann, bo] = X.people(2, 'Lg');

test('§1 a league match still reports through the composed hook', () => {
  assert.ok(LS.createSeason({
    id: 'cube-reg', name: 'Reg', signupOpens: new Date(OPEN).toISOString(), start: new Date(WEEK1).toISOString(),
    weeks: 3, perWeek: 1, auto: false, hidden: false, format: 'competitive',
  }, OPEN - HOUR).ok);
  const season = () => LS.seasonById('cube-reg')!;
  LS.advance(season(), OPEN);
  // what the league asks of an entrant (828's player())
  for (const who of [ann!, bo!]) {
    const a = A.accountById(who.id)!;
    const g = new Array<string>(LG.GRID_LEN).fill('0');
    for (let d = 0; d < 7; d++) for (let h = 18; h < 23; h++) g[d * 24 + h] = '1';
    A.setLeagueAvailability(a, 'Europe/London', g.join(''));
    A.setLeagueContact(a, `${who.username.toLowerCase()}_dc`);
  }
  LS.joinSeason(season(), A.accountById(ann!.id)!, OPEN + HOUR);
  LS.joinSeason(season(), A.accountById(bo!.id)!, OPEN + HOUR);
  LS.advance(season(), WEEK1);
  const lm = season().matches.find(x => x.week === 1)!;
  assert.ok(lm, 'week 1 paired them');
  let n = 0;
  const opened = LM.openLeagueMatch({
    existing: null, a: { userId: ann!.id, username: ann!.username }, b: { userId: bo!.id, username: bo!.username },
    season: 'cube-reg', match: lm.id, rated: false,
  }, () => { const c = `LGX${++n}`; F.R.reserveRoomCode(c); return c; });
  const room = F.R.getRoom(opened.code)!;
  for (const s of [0, 1] as Seat[]) {
    const uid = room.users[s]!;
    assert.ok(F.M.registerSeat(room, s, uid, A.accountById(uid)!.username, F.REG[s]!).ok);
  }
  const m = F.M.matchOfRoom(room)!;
  const boSeat = room.users.indexOf(bo!.id) as Seat;
  F.concede(room, boSeat);
  F.seatUp(F.current(m), 0, 1);
  const annSeat = (boSeat === 0 ? 1 : 0) as Seat;
  F.M.matchOp(F.current(m), annSeat, 'ready', { ready: true });
  F.M.matchOp(F.current(m), boSeat, 'ready', { ready: true, initiative: boSeat });
  F.concede(F.current(m), boSeat);
  assert.equal(m.phase, 'over');
  const res = season().matches.find(x => x.id === lm.id)!.result;
  assert.ok(res, '⭐ the league got its result with the cube handler installed');
  assert.equal(res!.outcome, season().matches.find(x => x.id === lm.id)!.a === ann!.id ? 'a' : 'b');
});

test('§2 a cube match reports to its event; the league ignores it', () => {
  const [h, p] = X.people(2, 'Cb');
  const code = ok(C.createCube(h!, { fillBots: false, swissRounds: 1 }, clock.T)).code;
  ok(C.joinCube(ev(code), p!, clock.T));
  ok(C.startCube(ev(code), h!, clock.T));
  X.draftOut(code);
  X.buildAll(code);
  X.toRound(code);
  const before = JSON.stringify(LS.seasonById('cube-reg')!.matches);
  X.playOut(code, ev(code).pairings[0]!);
  assert.equal(ev(code).pairings[0]!.result?.by, 'play', 'the event has its result');
  assert.equal(ev(code).phase, 'done');
  assert.equal(JSON.stringify(LS.seasonById('cube-reg')!.matches), before, 'the league did not move');
});

test('§3 one handler throwing does not stop the other', () => {
  const seen: string[] = [];
  LM.installLeagueMatchHooks([() => { throw new Error('boom'); }, m => seen.push(m.id)]);
  const { m } = F.start(1, [ann!.id, bo!.id]);
  F.concede(F.current(m), 1);
  assert.deepEqual(seen, [m.id]);
  LM.installLeagueMatchHooks([m2 => C.cubeMatchEnded(m2, clock.T)]);
});
