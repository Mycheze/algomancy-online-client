/* docs/25 §14 — A SEALED CUBE EVENT, IN-PROCESS, ON A FAKE CLOCK.
 *
 * §1 the pure dealing: the cube is each distinct card × copies; unique pools never share a copy;
 *    the same pool is the same for everyone; the math refuses what the cube cannot deal
 * §2 the lobby: the view carries the sealed math (people only, no bots); Start refuses a table the
 *    cube cannot deal, and the host's edit (repeats) fixes it
 * §3 Start deals every player a pool and goes straight to building — no draft, no bots, the bell
 * §4 building: a deck must come from my own pool; the suggested decks put the event into play
 * §5 the same pool for everyone, and a scheduled start that deals by itself
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeFixture } from './cube-fixture.ts';
import { dealSealed, sealedCube, sealedMath } from '../cube-sealed.ts';

const X = await cubeFixture('t1332');
test.after(() => X.cleanup());
const { C, ev, ok, clock } = X;
const [host, bea, cal, dee, eve] = X.people(5);

const tally = (xs: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

test('§1 the cube, the math and the deal', () => {
  assert.deepEqual(sealedCube(['a', 'b', 'a', 'c'], 1), ['a', 'b', 'c'], 'singleton: one of each name');
  assert.deepEqual(sealedCube(['a', 'b', 'a'], 2), ['a', 'a', 'b', 'b'], 'repeats: two of each name');
  assert.deepEqual(sealedMath(320, 4, 75, false), { seats: 4, cards: 75, need: 300, have: 320, ok: true });
  assert.equal(sealedMath(320, 5, 75, false).ok, false, '5 × 75 > 320');
  assert.equal(sealedMath(320, 12, 75, true).ok, true, 'one shared pool needs only 75');
  assert.equal(sealedMath(320, 2, 29, false).ok, false, 'a pool smaller than a deck');

  const cube = Array.from({ length: 100 }, (_, i) => `c${i}`);
  const pools = dealSealed(cube, 3, 30, false, 7);
  assert.equal(pools.length, 3);
  const all = pools.flat();
  assert.equal(all.length, 90);
  assert.equal(new Set(all).size, 90, 'unique pools are dealt without replacement');
  assert.deepEqual(dealSealed(cube, 3, 30, false, 7), pools, 'the seed decides the deal');
  const same = dealSealed(cube, 3, 30, true, 7);
  assert.deepEqual(same[1], same[0]);
  assert.deepEqual(same[2], same[0], 'everyone the same pool');
  assert.throws(() => dealSealed(cube, 4, 30, false, 7), /cannot deal/);
});

let CODE = '';

test('§2 the lobby: the sealed math; Start refuses what the cube cannot deal', () => {
  const r = ok(C.createCube(host!, { name: 'Sealed night', format: 'sealed', maxPlayers: 6, sealed: { cards: 75 } }, clock.T));
  CODE = r.code;
  for (const p of [bea!, cal!, dee!, eve!]) ok(C.joinCube(ev(CODE), p, clock.T));
  const v = C.viewFor(ev(CODE), host!.id, clock.T);
  assert.equal(v.config.format, 'sealed');
  assert.deepEqual(v.config.sealed, { cards: 75, copies: 1, same: false });
  assert.deepEqual(v.sealedMath![0], { seats: 5, cards: 75, need: 375, have: 320, ok: false }, 'five people, no bots');
  assert.equal(v.sealedMath![1]!.seats, 6, 'a full table');
  const no = C.startCube(ev(CODE), host!, clock.T);
  assert.equal(no.ok, false);
  assert.match(!no.ok ? no.error : '', /too small for 5 pools of 75/);
  assert.equal(ev(CODE).phase, 'lobby');
  // repeats double the cube: 640 cards deal five pools of 75
  ok(C.configCube(ev(CODE), host!, { sealed: { copies: 2 } }, clock.T));
  assert.deepEqual(ev(CODE).config.sealed, { cards: 75, copies: 2, same: false }, 'an edit keeps the sealed numbers it does not name');
  assert.equal(C.viewFor(ev(CODE), host!.id, clock.T).sealedMath![0]!.ok, true);
});

test('§3 Start deals the pools and goes straight to building', () => {
  ok(C.startCube(ev(CODE), host!, clock.T));
  const e = ev(CODE);
  assert.equal(e.phase, 'building', 'no draft');
  assert.equal(e.draft, undefined, 'no draft state, so no bots');
  const cube = tally(sealedCube(e.pool, 2));
  const used = new Map<string, number>();
  for (const p of e.players) {
    assert.equal(p.pool!.length, 75, `${p.name}: 75 cards`);
    for (const [n, k] of tally(p.pool!)) {
      assert.ok(k <= 2, 'never more than the copy cap of one card');
      used.set(n, (used.get(n) ?? 0) + k);
    }
  }
  for (const [n, k] of used) assert.ok(k <= cube.get(n)!, `${n}: dealt no more copies than the cube holds`);
  const v = C.viewFor(e, bea!.id, clock.T);
  assert.equal(v.myPool!.length, 75);
  assert.equal(v.draft, null);
  assert.ok(e.notes!.some(n => n.to === dee!.id && n.kind === 'starting'), 'the bell: the pools are open');
  assert.equal(C.configCube(e, host!, { bestOf: 3 }, clock.T).ok, false, 'settings are fixed once it starts');
});

test('§4 building: a deck from my own pool; every deck in → the tournament', () => {
  const e = ev(CODE);
  const mine = e.players.find(p => p.user === bea!.id)!.pool!;
  const outside = e.pool.find(n => !mine.includes(n))!;
  const r = C.submitDeck(e, bea!.id, [...mine.slice(0, 29), outside], [], clock.T);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /is not in your pool/);
  X.buildAll(CODE);
  const after = ev(CODE);
  assert.equal(after.phase, 'playing');
  assert.ok(after.breakUntil && after.breakUntil > clock.T, 'the break before round 1, as after a draft');
});

test('§5 everyone the same pool, at a scheduled start', () => {
  const at = clock.T + 60_000;
  const code = ok(C.createCube(cal!, { name: 'Same pools', format: 'sealed', startAt: at, sealed: { cards: 60, same: true } }, clock.T)).code;
  ok(C.joinCube(ev(code), dee!, clock.T));
  ok(C.joinCube(ev(code), eve!, clock.T));
  clock.T = at;
  C.sweepCubes(clock.T);
  const e = ev(code);
  assert.equal(e.phase, 'building', 'the scheduled start dealt the pools');
  const pools = e.players.map(p => p.pool!);
  assert.equal(pools[0]!.length, 60);
  for (const p of pools) assert.deepEqual(p, pools[0], 'the exact same pool');
});
