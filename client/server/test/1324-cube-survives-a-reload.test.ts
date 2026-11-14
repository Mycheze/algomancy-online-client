/* docs/25 §2 — AN EVENT SURVIVES A RESTART. One file per event, written on every change.
 *
 *   §1 mid-draft: the file is read back (a fresh object), and the draft carries on from where it
 *      stood — the same picks, the same packs — to its end
 *   §2 the boot reconcile: a match that ended while the cube's hook was not listening gives its
 *      pairing the result; a pairing whose match record is gone goes back to not started
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeFixture } from './cube-fixture.ts';

const X = await cubeFixture('t1324');
test.after(() => X.cleanup());
const { C, D, F, ST, LM, ev, ok, clock } = X;
const DIR = process.env['ALGO_CUBE_DIR']!;
const P = X.people(4);
const host = P[0]!;

test('§1 a draft reloaded mid-way carries on', () => {
  const code = ok(C.createCube(host, {}, clock.T)).code;
  for (const p of P.slice(1)) ok(C.joinCube(ev(code), p, clock.T));
  ok(C.startCube(ev(code), host, clock.T));
  // a few wake-ups' worth of the draft: the bots pick, nobody human does
  for (let i = 0; i < 6; i++) { clock.T = D.nextWake(ev(code).draft!)!; C.sweepCubes(clock.T); }
  const mine = ev(code).draft!.seats.find(s => s.user === P[1]!.id)!;
  const pack = C.viewFor(ev(code), P[1]!.id, clock.T).draft!.pack!;
  ok(C.reserveCard(ev(code), P[1]!.id, pack[1]!));
  const before = JSON.stringify(ev(code).draft);
  const picked = mine.picks.length;
  const old = ev(code);
  ST.loadCubes(DIR);
  assert.notEqual(ev(code), old, 'a fresh object, read from the file');
  assert.equal(JSON.stringify(ev(code).draft), before, 'the draft exactly as it stood');
  assert.equal(ev(code).draft!.seats.find(s => s.user === P[1]!.id)!.picks.length, picked);
  assert.equal(C.viewFor(ev(code), P[1]!.id, clock.T).draft!.reserved, pack[1], 'the reservation too');
  X.draftOut(code);
  assert.equal(ev(code).phase, 'building');
  assert.ok(ev(code).players.every(p => p.pool!.length === 39));
  ST.loadCubes(DIR);
  assert.equal(ev(code).phase, 'building', 'the phase is in the file');
  ok(C.cancelCube(ev(code), host, clock.T));
});

test('§2 the boot reconcile', () => {
  const code = ok(C.createCube(host, { fillBots: false, swissRounds: 1 }, clock.T)).code;
  for (const p of P.slice(1)) ok(C.joinCube(ev(code), p, clock.T));
  ok(C.startCube(ev(code), host, clock.T));
  X.draftOut(code);
  X.buildAll(code);
  X.toRound(code);
  const [p1, p2] = ev(code).pairings;
  // the server goes down with the cube's ended hook not listening (the crash between the writes)
  LM.installLeagueMatchHooks([]);
  X.playOut(code, p1!);
  ok(C.playMatch(ev(code), p2!.a, null, clock.T));
  LM.installLeagueMatchHooks([m => C.cubeMatchEnded(m, clock.T)]);
  assert.equal(ev(code).pairings.find(x => x.id === p1!.id)!.result, undefined, 'missed while down');
  // the boot: the stores read back from their files
  F.S.loadMatches(process.env['ALGO_MATCHES_DIR']!);
  ST.loadCubes(DIR);
  // …and p2's match record lost with the crash: its pairing names an id with no record
  ev(code).pairings.find(x => x.id === p2!.id)!.match = { id: 'MNOSUCHMATC', room: null };
  C.reconcileCubes(clock.T);
  const r1 = ev(code).pairings.find(x => x.id === p1!.id)!;
  assert.equal(r1.result?.kind === 'win' && r1.result.winner, p1!.a, 'the result was picked up at boot');
  assert.equal(ev(code).pairings.find(x => x.id === p2!.id)!.match, undefined, 'no record: back to not started');
  X.playOut(code, ev(code).pairings.find(x => x.id === p2!.id)!);
  assert.equal(ev(code).phase, 'done');
});
