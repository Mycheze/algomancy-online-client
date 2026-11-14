/* docs/25 §3, §9 — THE LOBBY: who may do what, the settings it accepts, and the scheduled start.
 *
 *   §1 host-only ops answer 403 to anyone else; a full table refuses a join; leave and kick in the
 *      lobby take the player out; the host cannot be removed; cancel ends it
 *   §2 the config: defaults, ranges, a pasted list (bad names listed, copies capped at 2), an edit
 *      keeps what it does not name; a pool too small refuses the start with a sentence
 *   §3 a scheduled start fires on the sweep once enough players are in — and not before
 *   §4 an event's code is taken in the room code space
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeFixture } from './cube-fixture.ts';

const X = await cubeFixture('t1321');
test.after(() => X.cleanup());
const { C, ev, ok, clock } = X;
const [host, a, b, c] = X.people(4);

test('§1 permissions, a full table, leave, kick, cancel', () => {
  const code = ok(C.createCube(host!, { maxPlayers: 3, minPlayers: 2 }, clock.T)).code;
  ok(C.joinCube(ev(code), a!, clock.T));
  ok(C.joinCube(ev(code), b!, clock.T));
  const full = C.joinCube(ev(code), c!, clock.T);
  assert.equal(full.ok, false);
  assert.match(!full.ok ? full.error : '', /full/);
  for (const r of [C.startCube(ev(code), a!, clock.T), C.configCube(ev(code), a!, { name: 'x' }, clock.T),
    C.kickPlayer(ev(code), a!, b!.id, clock.T), C.cancelCube(ev(code), a!, clock.T), C.postNow(ev(code), a!, clock.T),
    C.endCube(ev(code), a!, clock.T), C.hostDrop(ev(code), a!, b!.id, true, clock.T)]) {
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 403, 'host only');
  }
  ok(C.leaveCube(ev(code), b!, clock.T));
  assert.equal(ev(code).players.length, 2, 'leaving the lobby frees the seat');
  ok(C.joinCube(ev(code), c!, clock.T));
  ok(C.kickPlayer(ev(code), host!, c!.id, clock.T));
  assert.ok(!ev(code).players.some(p => p.user === c!.id), 'kicked');
  assert.equal(C.kickPlayer(ev(code), host!, host!.id, clock.T).ok, false, 'the host cannot be removed');
  ok(C.cancelCube(ev(code), host!, clock.T));
  assert.equal(ev(code).phase, 'cancelled');
  assert.equal(C.joinCube(ev(code), c!, clock.T).ok, false, 'a cancelled event takes nobody');
  assert.equal(C.cubesFor(a!.id, clock.T).length, 0, 'and is not in anyone\'s list');
});

test('§2 the config is checked', () => {
  const d = C.parseConfig({}, 'Ann', clock.T);
  assert.ok(!('error' in d));
  if ('error' in d) return;
  assert.deepEqual({ ...d.config, source: undefined }, {
    name: "Ann's cube", source: undefined, packs: null, packSize: null, minPlayers: 2, maxPlayers: 8, fillBots: true,
    startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1,
  });
  assert.deepEqual(d.config.source, { kind: 'elements', elements: ['fire', 'water', 'earth', 'wood', 'metal'] });
  const bad = (raw: unknown, re: RegExp): void => {
    const r = C.parseConfig(raw, 'Ann', clock.T);
    assert.ok('error' in r, JSON.stringify(raw));
    if ('error' in r) assert.match(r.error, re);
  };
  bad({ maxPlayers: 13 }, /Max players/);
  bad({ maxPlayers: 4, minPlayers: 5 }, /Min players/);
  bad({ packSize: 3 }, /Pack size/);
  bad({ bestOf: 2 }, /best of/);
  bad({ tournament: 'sealed' }, /tournament/);
  bad({ startAt: clock.T - 1 }, /future/);
  bad({ source: { kind: 'elements', elements: ['plasma'] } }, /element/);
  bad({ source: { kind: 'list', text: 'Not A Card\nAlso Not One' } }, /not cards in the game: Not A Card, Also Not One/);
  // a pasted list: copies capped at 2
  const pool = C.parseConfig({}, 'Ann', clock.T);
  const first = !('error' in pool) ? pool.pool[0]! : '';
  const second = !('error' in pool) ? pool.pool[1]! : '';
  const l = C.parseConfig({ source: { kind: 'list', text: `4 ${first}\n${second}` } }, 'Ann', clock.T);
  assert.ok(!('error' in l));
  if (!('error' in l)) assert.deepEqual(l.pool, [first, first, second], 'capped at 2 copies');
  // an edit keeps what it does not name
  const code = ok(C.createCube(host!, { name: 'Small', source: { kind: 'list', text: `${first}\n${second}` } }, clock.T)).code;
  ok(C.configCube(ev(code), host!, { bestOf: 3 }, clock.T));
  assert.equal(ev(code).config.bestOf, 3);
  assert.equal(ev(code).config.name, 'Small');
  assert.equal(ev(code).pool.length, 2, 'the list is kept');
  ok(C.joinCube(ev(code), a!, clock.T));
  const r = C.startCube(ev(code), host!, clock.T);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /too small for 8 players/);
  assert.equal(ev(code).phase, 'lobby');
  assert.equal(C.viewFor(ev(code), host!.id, clock.T).packMath[0]!.ok, false, 'the view says so too');
  ok(C.cancelCube(ev(code), host!, clock.T));
});

test('§3 a scheduled start waits for enough players, then fires on the sweep', () => {
  const at = clock.T + 60_000;
  const code = ok(C.createCube(host!, { startAt: at, minPlayers: 3 }, clock.T)).code;
  ok(C.joinCube(ev(code), a!, clock.T));
  clock.T = at - 1;
  C.sweepCubes(clock.T);
  assert.equal(ev(code).phase, 'lobby', 'not yet');
  clock.T = at;
  C.sweepCubes(clock.T);
  assert.equal(ev(code).phase, 'lobby', 'two players, three needed: it waits');
  ok(C.joinCube(ev(code), b!, clock.T));
  clock.T += 1000;
  C.sweepCubes(clock.T);
  assert.equal(ev(code).phase, 'drafting', 'three in: the draft starts');
  assert.equal(ev(code).draft!.seats.length, 8);
  assert.equal(C.joinCube(ev(code), c!, clock.T).ok, false, 'too late to join');
  ok(C.cancelCube(ev(code), host!, clock.T));
});

test('§4 an event code is taken for rooms', () => {
  const code = ok(C.createCube(host!, {}, clock.T)).code;
  assert.equal(X.ST.cubeCodeTaken(code), true);
  assert.equal(X.ST.cubeCodeTaken('ZZZZ'), false);
  // rooms.ts asks through the predicate main.ts injects, so a room never takes it
  assert.equal(X.F.R.codeTaken(code), false, 'not before the predicate is installed');
  X.F.R.setCodeTakenAlso(X.ST.cubeCodeTaken);
  assert.equal(X.F.R.codeTaken(code), true, 'one code space');
  assert.equal(X.F.R.codeTaken('ZZZZ'), false);
  ok(C.cancelCube(ev(code), host!, clock.T));
});
