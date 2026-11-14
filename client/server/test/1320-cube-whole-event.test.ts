/* docs/25 — A WHOLE CUBE EVENT, IN-PROCESS, ON A FAKE CLOCK.
 *
 * Four registered accounts and four bots: create → join → start → the pod draft to its last pick
 * (two humans pick at once, two let every clock run out, one of them with a card reserved) →
 * every player submits the suggested deck → round 1 posts when the break runs out → Play opens a
 * match room with BOTH seats registered server-side → a concede records the result through the
 * composed `ended` hook → round 2 … round 3 → done, with the standings in the view.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeFixture } from './cube-fixture.ts';

const X = await cubeFixture('t1320');
test.after(() => X.cleanup());
const { C, F, ev, ok, clock } = X;
const [host, bea, cal, dee] = X.people(4);
let CODE = '';

test('create and join: the host sits, three join, the pack math is shown', () => {
  const r = ok(C.createCube(host!, { name: 'Friday cube', tournament: 'swiss', swissRounds: 3, bestOf: 1 }, clock.T));
  CODE = r.code;
  for (const p of [bea!, cal!, dee!]) ok(C.joinCube(ev(CODE), p, clock.T));
  ok(C.joinCube(ev(CODE), bea!, clock.T));   // a second join is a no-op
  const v = C.viewFor(ev(CODE), bea!.id, clock.T);
  assert.equal(v.phase, 'lobby');
  assert.equal(v.players.length, 4, 'four players, no duplicate');
  assert.equal(v.isHost, false);
  assert.equal(C.viewFor(ev(CODE), host!.id, clock.T).isHost, true);
  assert.equal(v.poolSize, 320, 'the five base elements');
  assert.deepEqual(v.packMath[0], { seats: 8, packs: 3, packSize: 13, ok: true }, 'bots fill to 8: 3 packs of 13');
});

test('start: 4 humans + 4 bots; each sees only its own picks', () => {
  assert.equal(C.startCube(ev(CODE), bea!, clock.T).ok, false, 'not the host');
  ok(C.startCube(ev(CODE), host!, clock.T));
  const e = ev(CODE);
  assert.equal(e.phase, 'drafting');
  assert.equal(e.draft!.seats.length, 8);
  assert.equal(e.draft!.seats.filter(s => s.user === null).length, 4, 'four bots');
  const v = C.viewFor(e, cal!.id, clock.T).draft!;
  assert.equal(v.pack!.length, 13);
  assert.ok(v.suggest && v.pack!.includes(v.suggest), 'a suggestion from the pack');
  assert.equal(v.deadline, clock.T + 13 * 6000, '6 s a card');
  assert.ok(e.notes!.some(n => n.to === dee!.id && n.kind === 'starting'), 'the bell: the draft is starting');
  // a reserved card is what a timeout takes
  const want = v.pack!.find(c => c !== v.suggest)!;
  ok(C.reserveCard(e, cal!.id, want));
  clock.T = v.deadline!;
  C.sweepCubes(clock.T);
  assert.equal(ev(CODE).draft!.seats.find(s => s.user === cal!.id)!.picks[0], want, 'the timeout took the reserved card');
});

test('the draft runs to its end; every player has 39 drafted cards', () => {
  X.draftOut(CODE, new Set([cal!.id, dee!.id]));
  const e = ev(CODE);
  assert.equal(e.phase, 'building');
  for (const p of e.players) assert.equal(p.pool!.length, 39, `${p.name}: 3 × 13 picks`);
  assert.equal(C.viewFor(e, bea!.id, clock.T).myPool!.length, 39);
  assert.equal(C.viewFor(e, bea!.id, clock.T).draft, null);
});

test('building: a deck must come from my own drafted cards', () => {
  const e = ev(CODE);
  const mine = e.players.find(p => p.user === bea!.id)!.pool!;
  const theirs = e.players.find(p => p.user === cal!.id)!.pool!;
  const r = C.submitDeck(e, bea!.id, [...mine.slice(0, 29), theirs[0]!], [], clock.T);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /did not draft/);
  assert.equal(C.submitDeck(e, bea!.id, mine.slice(0, 20), [], clock.T).ok, false, 'under 30 is refused');
  X.buildAll(CODE);
  const after = ev(CODE);
  assert.equal(after.phase, 'playing', 'every deck in → the tournament');
  assert.ok(after.breakUntil && after.breakUntil > clock.T, 'the break before round 1');
  const hv = C.viewFor(after, host!.id, clock.T);
  assert.equal(hv.pending!.length, 2, 'the host sees round 1 at once');
  assert.equal(C.viewFor(after, bea!.id, clock.T).pending, null, 'nobody else does');
  assert.equal(hv.matches.length, 0, 'nothing posted yet');
});

test('three Swiss rounds, each posted after its break, each match played in its own room', () => {
  for (let round = 1; round <= 3; round++) {
    X.matched.length = 0;
    X.toRound(CODE);
    const e = ev(CODE);
    assert.equal(e.round, round);
    const live = e.pairings.filter(p => p.round === round);
    assert.equal(live.length, 2);
    assert.ok(live.every(p => p.posted && !p.result));
    assert.equal(X.matched.length, 4, 'everybody told their match is ready');
    for (const p of live) {
      const v = C.viewFor(e, p.a, clock.T).myMatch!;
      assert.equal(v.pairing, p.id);
      assert.equal(v.status, 'waiting');
      // Play: a match room with both seats bound and registered, game 1 dealt
      const r = ok(C.playMatch(ev(CODE), p.b!, null, clock.T));
      const again = ok(C.playMatch(ev(CODE), p.a, null, clock.T));
      assert.equal(again.room, r.room, 'the other player gets the same room');
      const room = F.R.getRoom(r.room)!;
      assert.deepEqual(new Set(room.users), new Set([p.a, p.b]));
      const m = F.S.getMatch(ev(CODE).pairings.find(x => x.id === p.id)!.match!.id)!;
      assert.deepEqual(m.cube, { event: CODE, pairing: p.id });
      assert.equal(m.rated, undefined, 'unrated');
      assert.equal(m.casual, true, 'the default rules are Casual');
      assert.ok(m.registered[0] && m.registered[1], 'both seats registered server-side');
      assert.equal(F.R.roomWaiting(room), false, 'game 1 is dealt');
      assert.equal(C.viewFor(ev(CODE), p.a, clock.T).myMatch!.status, 'live');
      assert.ok(C.viewFor(ev(CODE), p.a, clock.T).players.find(x => x.user === p.a)!.inMatch);
      X.playOut(CODE, p, p.b!);
      const done = ev(CODE).pairings.find(x => x.id === p.id)!;
      assert.equal(done.result?.kind, 'win');
      assert.equal(done.result?.kind === 'win' && done.result.winner, p.a, 'the conceder lost');
      assert.equal(done.result?.by, 'play');
      // idempotent: the ended hook again changes nothing
      const at = done.result!.at;
      C.cubeMatchEnded(m, clock.T + 999);
      assert.equal(ev(CODE).pairings.find(x => x.id === p.id)!.result!.at, at);
    }
    if (round < 3) assert.ok(ev(CODE).breakUntil, `round ${round} decided → the next break`);
  }
  const e = ev(CODE);
  assert.equal(e.phase, 'done');
  const v = C.viewFor(e, bea!.id, clock.T);
  assert.equal(v.standings.length, 4);
  assert.equal(v.standings[0]!.points, 9, 'someone went 3–0');
  assert.equal(v.standings.reduce((s, r) => s + r.w, 0), 6, 'six matches');
  assert.equal(v.matches.length, 6);
  assert.ok(v.matches.every(m => m.status === 'done' && m.score === '1–0'), 'the winner is always a, the score a\'s–b\'s');
  assert.ok(e.notes!.some(n => n.kind === 'done' && n.to === bea!.id), 'the bell: the event is over');
  assert.ok(e.notes!.some(n => n.kind === 'round' && n.round === 2 && n.to === dee!.id));
  const mine = C.cubesFor(bea!.id, clock.T);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.phase, 'done');
});

test('the event file holds the whole record', () => {
  X.ST.loadCubes(process.env['ALGO_CUBE_DIR']!);
  const e = ev(CODE);
  assert.equal(e.phase, 'done');
  assert.equal(e.pairings.length, 6);
  assert.equal(e.draft!.seats.length, 8, 'the bots stay in the file');
});
