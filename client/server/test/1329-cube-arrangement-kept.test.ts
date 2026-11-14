/* docs/25 §6, §13 — MY DECK TABLE'S LAYOUT IS KEPT ON THE SERVER (owner 2026-11-14: "When building,
 * the layout you set during the draft should automatically be there, for you").
 *
 *   §1 while drafting: my piles, Sideboard and Maybe are kept on my player and come back in MY view
 *      only (never another player's); a card that is not one of my picks, or one copy too many, is
 *      refused and the last good layout stands; a pick not placed yet may be missing
 *   §2 the shape is checked: not lists of names, names and piles of different lengths, an unknown
 *      `from` — refused; signed-up but not seated, dropped — refused
 *   §3 after the draft the same layout is my view's, and the builder's may replace it (held to my
 *      drafted pool now); it survives a restart (the file is read back)
 *   §4 the route (api-cube.ts, called as main.ts calls it): POST /api/cube/<code>/arrange answers {ok}
 *      without a view, a refusal is a 400 with its sentence, signed out a 401
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeFixture } from './cube-fixture.ts';
import { Readable } from 'node:stream';
import { cubeRoutes } from '../api-cube.ts';

const X = await cubeFixture('t1329');
test.after(() => X.cleanup());
const { C, D, ST, ev, ok, clock } = X;
const DIR = process.env['ALGO_CUBE_DIR']!;
const P = X.people(3);
const host = P[0]!;

/** run the draft until `user` holds at least `n` picks */
function draftTo(code: string, user: string, n: number): string[] {
  for (let guard = 0; guard < 500; guard++) {
    const e = ev(code);
    const seat = e.draft!.seats.find(s => s.user === user)!;
    if (seat.picks.length >= n) return [...seat.picks];
    for (const p of e.players) {
      const v = C.viewFor(e, p.user, clock.T).draft;
      if (v?.pack) ok(C.pickCard(e, p.user, v.suggest ?? v.pack[0]!, clock.T));
    }
    const w = D.nextWake(ev(code).draft!);
    if (w !== null) clock.T = Math.max(clock.T, w);
    C.sweepCubes(clock.T);
  }
  throw new Error('never got there');
}

let CODE = '';

test('§1 kept while drafting, mine only; refused when not my cards', () => {
  CODE = ok(C.createCube(host, {}, clock.T)).code;
  for (const p of P.slice(1)) ok(C.joinCube(ev(CODE), p, clock.T));
  ok(C.startCube(ev(CODE), host, clock.T));
  const me = P[1]!.id;
  const picks = draftTo(CODE, me, 4);
  const layout = { piles: [[picks[0]!, picks[1]!], [picks[2]!]], names: ['2', 'Bombs'], side: [], maybe: [picks[3]!], from: 'draft' };
  ok(C.arrangeCards(ev(CODE), me, layout));
  assert.deepEqual(C.viewFor(ev(CODE), me, clock.T).myArrange, layout, 'in my view, as sent');
  assert.equal(C.viewFor(ev(CODE), P[2]!.id, clock.T).myArrange, null, 'another player sees none of it');
  assert.equal(C.viewFor(ev(CODE), null, clock.T).myArrange ?? null, null, 'nor does a visitor');
  // a pick still on its way (picks[3] left out) is fine: it lands by cost on the client
  ok(C.arrangeCards(ev(CODE), me, { piles: [[picks[0]!]], side: [picks[1]!], maybe: [] }));
  assert.equal(C.viewFor(ev(CODE), me, clock.T).myArrange!.from, 'draft', 'absent from = the draft’s');
  const theirs = ev(CODE).draft!.seats.find(s => s.user === P[2]!.id)!.picks[0]!;
  const not = theirs !== picks[0] && !picks.includes(theirs) ? theirs : 'Not A Card';
  const r1 = C.arrangeCards(ev(CODE), me, { piles: [[not]], side: [], maybe: [] });
  assert.equal(r1.ok, false, 'a card I did not pick');
  const held = ev(CODE).draft!.seats.find(s => s.user === me)!.picks.filter(x => x === picks[0]).length;
  const r2 = C.arrangeCards(ev(CODE), me, { piles: [Array(held + 1).fill(picks[0]!)], side: [], maybe: [] });
  assert.equal(r2.ok, false, 'one copy too many');
  assert.deepEqual(C.viewFor(ev(CODE), me, clock.T).myArrange!.piles, [[picks[0]]], 'the last good layout stands');
});

test('§2 the shape is checked; only a seated player', () => {
  const me = P[1]!.id;
  const pick = ev(CODE).draft!.seats.find(s => s.user === me)!.picks[0]!;
  for (const bad of [
    { piles: 'x', side: [], maybe: [] },
    { piles: [[1]], side: [], maybe: [] },
    { piles: [[pick]], side: 'x', maybe: [] },
    { piles: [[pick]], names: ['a', 'b'], side: [], maybe: [] },
    { piles: [[pick]], names: ['x'.repeat(41)], side: [], maybe: [] },
    { piles: [[pick]], side: [], maybe: [], from: 'elsewhere' },
    null,
  ]) assert.equal(C.arrangeCards(ev(CODE), me, bad).ok, false, JSON.stringify(bad));
  const outsider = X.people(1, 'Out')[0]!;
  assert.equal(C.arrangeCards(ev(CODE), outsider.id, { piles: [], side: [], maybe: [] }).ok, false, 'not in the event');
});

test('§3 after the draft: still mine, the builder’s replaces it, a restart keeps it', () => {
  const me = P[1]!.id;
  X.draftOut(CODE);
  assert.equal(ev(CODE).phase, 'building');
  const pool = ev(CODE).players.find(p => p.user === me)!.pool!;
  assert.deepEqual(C.viewFor(ev(CODE), me, clock.T).myArrange!.piles.flat().every(n => pool.includes(n)), true, 'the draft’s layout carries over');
  const built = { piles: [pool.slice(0, 20), pool.slice(20, 30)], names: ['Early', 'Late'], side: pool.slice(30, 33), maybe: [pool[33]!], from: 'build' };
  ok(C.arrangeCards(ev(CODE), me, built));
  ST.loadCubes(DIR);
  assert.deepEqual(C.viewFor(ev(CODE), me, clock.T).myArrange, built, 'read back from the file');
  assert.equal(C.arrangeCards(ev(CODE), me, { piles: [[...pool, pool[0]!]], side: [], maybe: [], from: 'build' }).ok, false,
    'held to my drafted pool now');
});

test('§4 the route', async () => {
  const me = P[1]!;
  const call = async (body: unknown, token = me.token): Promise<{ status: number; body: Record<string, unknown> }> => {
    let status = 200, text = '';
    const raw = JSON.stringify(body);
    const req = Object.assign(
      Readable.from([Buffer.from(raw)]),
      { method: 'POST', url: `/api/cube/${CODE}/arrange`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.1' } },
    );
    const res = {
      statusCode: 200, headers: {} as Record<string, unknown>,
      writeHead(s: number, h?: Record<string, unknown>) { status = s; if (h) Object.assign(this.headers, h); return this; },
      setHeader(k: string, v: unknown) { this.headers[k] = v; },
      end(b?: string) { text = b ?? ''; if (this.statusCode !== 200) status = this.statusCode; },
    };
    await cubeRoutes(req as never, res as never, `/api/cube/${CODE}/arrange`);
    return { status, body: JSON.parse(text || '{}') as Record<string, unknown> };
  };
  const pool = ev(CODE).players.find(p => p.user === me.id)!.pool!;
  const good = await call({ piles: [pool.slice(0, 5)], side: [], maybe: [], from: 'build' });
  assert.equal(good.status, 200);
  assert.deepEqual(good.body, { ok: true }, 'no view: the table that sent it shows it already');
  const bad = await call({ piles: [['Not A Card']], side: [], maybe: [] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body['ok'], false);
  assert.match(String(bad.body['error']), /did not draft Not A Card/);
  const out = await call({ piles: [], side: [], maybe: [] }, 'nobody');
  assert.equal(out.status, 401, 'signed out');
});
