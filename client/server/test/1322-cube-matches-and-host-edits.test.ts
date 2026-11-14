/* docs/25 §6–§8 — MATCHES AND THE HOST'S HAND.
 *
 *   §1 the host's Start in building drops whoever has no deck
 *   §2 a void match (its room closed unjoined) returns the pairing to "not started"; the next Play
 *      opens a fresh room
 *   §3 the host's result on a LIVE match voids the match and the host's result stands; clear puts it
 *      back; a swap in the break moves players; Post now posts at once
 *   §4 a drop hands the opponent the undecided match and the dropped player is never paired again
 *   §5 round robin posts its whole schedule and is done when every match is decided
 *   §6 exhibition pairs two Ready players who have not met, turns Ready back on after the match,
 *      and never pairs a rematch
 *   §7 Best of 3, Competitive: the match carries the event's settings and its game score
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeFixture } from './cube-fixture.ts';
import type { Actor } from '../cube.ts';

const X = await cubeFixture('t1322');
test.after(() => X.cleanup());
const { C, F, ev, ok, clock } = X;
const P = X.people(5);
const host = P[0]!;

/** an event of `who` (host first), drafted and (unless `build` is false) built */
function event(who: Actor[], config: Record<string, unknown>, build = true): string {
  const code = ok(C.createCube(host, { fillBots: false, ...config }, clock.T)).code;
  for (const p of who.slice(1)) ok(C.joinCube(ev(code), p, clock.T));
  ok(C.startCube(ev(code), host, clock.T));
  X.draftOut(code);
  if (build) X.buildAll(code);
  return code;
}

test('§1 Start in building drops whoever has no deck', () => {
  const code = event(P.slice(0, 3), {}, false);
  for (const p of P.slice(0, 2)) {
    const s = ok(C.suggestDeck(ev(code), p.id));
    ok(C.submitDeck(ev(code), p.id, s.main, s.side, clock.T));
  }
  assert.equal(ev(code).phase, 'building', 'one deck short');
  const r = ok(C.startCube(ev(code), host, clock.T));
  assert.deepEqual(r.dropped, [P[2]!.username]);
  assert.equal(ev(code).phase, 'playing');
  assert.ok(ev(code).players.find(p => p.user === P[2]!.id)!.dropped);
  X.toRound(code);
  assert.equal(ev(code).pairings.length, 1, 'two players: one pairing, the dropped one left out');
  ok(C.endCube(ev(code), host, clock.T));
});

test('§2 a void match returns its pairing; Play opens a fresh room', () => {
  const code = event(P.slice(0, 2), {});
  X.toRound(code);
  const p = ev(code).pairings[0]!;
  const first = ok(C.playMatch(ev(code), p.a, null, clock.T)).room;
  const m = F.S.getMatch(ev(code).pairings[0]!.match!.id)!;
  // the room closed unjoined → the match sweep voids its match → the ended hook
  F.M.voidMatch(m, 'its game room closed', clock.T);
  assert.equal(ev(code).pairings[0]!.match, undefined, 'back to not started');
  assert.equal(ev(code).pairings[0]!.result, undefined);
  assert.equal(C.viewFor(ev(code), p.a, clock.T).myMatch!.status, 'waiting');
  const second = ok(C.playMatch(ev(code), p.b!, null, clock.T)).room;
  assert.notEqual(second, first, 'a fresh room');
  const mid = ev(code).pairings[0]!.match!.id;
  ok(C.endCube(ev(code), host, clock.T));
  assert.equal(F.S.getMatch(mid)!.phase, 'void', 'ending the event voids a live match');
});

test('§3 the host: swap and Post now in the break, award a live match, clear a result', () => {
  const code = event(P.slice(0, 4), { swissRounds: 2 });
  const pend = ev(code).pairings.filter(p => !p.posted);
  assert.equal(pend.length, 2);
  const [p1, p2] = pend;
  ok(C.swapPairing(ev(code), host, p1!.a, p2!.a, clock.T));
  const moved = ev(code).pairings.find(x => x.id === p1!.id)!;
  assert.equal(moved.a, p2!.a, 'swapped');
  ok(C.postNow(ev(code), host, clock.T));
  assert.equal(ev(code).breakUntil, null);
  assert.equal(ev(code).round, 1);
  assert.equal(C.postNow(ev(code), host, clock.T).ok, false, 'nothing left to post');
  // award a live match
  const live = ev(code).pairings.find(x => x.id === p1!.id)!;
  const liveRoom = ok(C.playMatch(ev(code), live.a, null, clock.T)).room;
  const mid = ev(code).pairings.find(x => x.id === p1!.id)!.match!.id;
  assert.ok(F.R.getRoom(liveRoom), 'the game room is open');
  ok(C.setResult(ev(code), host, live.id, { kind: 'win', winner: live.b! }, clock.T));
  const after = ev(code).pairings.find(x => x.id === p1!.id)!;
  assert.equal(after.result?.kind === 'win' && after.result.winner, live.b);
  assert.equal(after.result?.by, 'host');
  assert.equal(F.S.getMatch(mid)!.phase, 'void', 'its match is void');
  assert.equal(F.R.getRoom(liveRoom), undefined, 'and its game room is closed, even mid-game: it can no longer count');
  // the other: a draw, then cleared, then played
  ok(C.setResult(ev(code), host, p2!.id, { kind: 'draw' }, clock.T));
  assert.ok(ev(code).breakUntil, 'round 1 decided → the break');
  ok(C.setResult(ev(code), host, p2!.id, { kind: 'clear' }, clock.T));
  assert.equal(ev(code).breakUntil, null, 'cleared: round 1 is not decided after all');
  assert.equal(ev(code).pairings.filter(p => !p.posted).length, 0, 'and round 2 is withdrawn');
  X.playOut(code, ev(code).pairings.find(x => x.id === p2!.id)!);
  assert.ok(ev(code).breakUntil, 'played: the break again');
  assert.equal(C.setResult(ev(code), host, 'nope', { kind: 'draw' }, clock.T).ok, false);
  assert.equal(C.setResult(ev(code), host, p2!.id, { kind: 'win', winner: 'someone-else' }, clock.T).ok, false);
  ok(C.endCube(ev(code), host, clock.T));
});

test('§4 a drop gives the opponent the match; the dropped player is not paired again', () => {
  const code = event(P.slice(0, 4), { swissRounds: 2 });
  X.toRound(code);
  const p = ev(code).pairings.find(x => x.round === 1)!;
  ok(C.playMatch(ev(code), p.a, null, clock.T));
  ok(C.leaveCube(ev(code), { id: p.a, username: '' }, clock.T));
  const r = ev(code).pairings.find(x => x.id === p.id)!;
  assert.equal(r.result?.kind === 'win' && r.result.winner, p.b);
  assert.equal(r.result?.by, 'drop');
  const other = ev(code).pairings.find(x => x.round === 1 && x.id !== p.id)!;
  X.playOut(code, other);
  X.toRound(code);
  const r2 = ev(code).pairings.filter(x => x.round === 2);
  assert.ok(r2.every(x => x.a !== p.a && x.b !== p.a), 'never paired again');
  assert.ok(r2.some(x => x.b === null), 'three players: a bye');
  ok(C.endCube(ev(code), host, clock.T));
});

test('§5 round robin: the whole schedule, done when every match is decided', () => {
  const code = event(P.slice(0, 4), { tournament: 'roundrobin' });
  assert.equal(ev(code).pairings.length, 6, '4 players: 6 matches, computed in the break');
  X.toRound(code);
  assert.ok(ev(code).pairings.every(p => p.posted));
  // a player with several matches open plays one at a time
  const me = P[1]!.id;
  const mine = ev(code).pairings.filter(p => p.a === me || p.b === me);
  assert.equal(mine.length, 3);
  for (const p of ev(code).pairings) X.playOut(code, ev(code).pairings.find(x => x.id === p.id)!);
  assert.equal(ev(code).phase, 'done');
  assert.equal(C.viewFor(ev(code), me, clock.T).standings.reduce((s, r) => s + r.w + r.l, 0), 12);
});

test('§6 exhibition: Ready players who have not met are paired; no rematch', () => {
  const code = event(P.slice(0, 3), { tournament: 'exhibition' });
  assert.equal(ev(code).pairings.length, 0);
  X.toRound(code);
  assert.ok(ev(code).players.every(p => p.ready), 'Ready on when the break ends');
  C.sweepCubes(clock.T + 1);
  assert.equal(ev(code).pairings.length, 1, 'three ready: one pair');
  const x1 = ev(code).pairings[0]!;
  assert.ok(X.matched.some(m => m.code === code && m.user === x1.a), 'both told');
  const odd = ev(code).players.find(p => p.user !== x1.a && p.user !== x1.b)!;
  ok(C.setReady(ev(code), odd.user, false, clock.T));
  X.playOut(code, x1);
  assert.ok(ev(code).players.find(p => p.user === x1.a)!.ready, 'Ready back on after the match');
  C.sweepCubes(clock.T + 2);
  assert.equal(ev(code).pairings.length, 1, 'the two who just met are not paired again; the third is off');
  ok(C.setReady(ev(code), odd.user, true, clock.T + 3));
  C.sweepCubes(clock.T + 4);
  assert.equal(ev(code).pairings.length, 2, 'the third is back: paired with one of them');
  assert.ok(ev(code).pairings[1]!.a === odd.user || ev(code).pairings[1]!.b === odd.user);
  ok(C.endCube(ev(code), host, clock.T));
  assert.equal(ev(code).phase, 'done');
});

test('§7 Best of 3, Competitive', () => {
  const code = event(P.slice(0, 2), { bestOf: 3, rules: 'competitive', swissRounds: 1 });
  X.toRound(code);
  const p = ev(code).pairings[0]!;
  ok(C.playMatch(ev(code), p.a, null, clock.T));
  const m = F.S.getMatch(ev(code).pairings[0]!.match!.id)!;
  assert.equal(m.bestOf, 3);
  assert.equal(m.casual, undefined, 'competitive');
  assert.deepEqual(F.M.matchSummary(m).cube, { event: code, pairing: p.id }, 'the post-game summary names the event');
  X.playOut(code, ev(code).pairings[0]!, p.b!);
  const r = ev(code).pairings[0]!.result!;
  assert.deepEqual(r.kind === 'win' && r.games, [2, 0], 'the game score, a\'s first');
  assert.equal(ev(code).phase, 'done', 'one round: done');
});
