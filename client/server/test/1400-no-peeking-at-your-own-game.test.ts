// A player must not read the hidden half of a game they are in: replay, watch and the watcher payload. Over the wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ccWire, type Client, type Msg } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const A = '198.51.100.1', B = '198.51.100.2', C = '198.51.100.3';

test('1400 the replay, the watch and the watching payload', async () => {
  const w = await ccWire('t1400');
  const [ann, bo, cy] = w.people as [typeof w.people[0], typeof w.people[0], typeof w.people[0]];
  const replay = (code: string, token: string): Promise<number> =>
    fetch(`http://localhost:${w.port}/api/replay/${code}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => { await r.arrayBuffer(); return r.status; });
  const watch = async (room: string, token: string | undefined, from?: string): Promise<{ c: Client; got: Msg }> => {
    const c = await w.client(from);
    const got = await c.ask({ t: 'watch', room, ...(token ? { token } : {}) }, m => m.t === 'watching' || m.t === 'error');
    return { c, got };
  };
  try {
    // ⭐ /api/replay of a live game is refused to its own seat, and opens once the game is decided
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    await a.ask({ t: 'join', room: code, seat: 0, token: ann.token }, m => m.t === 'joined');
    await b.ask({ t: 'join', room: code, seat: 1, token: bo.token }, m => m.t === 'joined' && !!m['view']);
    assert.equal(await replay(code, ann.token), 404, 'a seat cannot open its own live game');
    a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    await a.next(m => m.t === 'gameover');
    let after = 0;
    for (let i = 0; i < 50 && after !== 200; i++) { after = await replay(code, ann.token); if (after !== 200) await sleep(100); }
    assert.equal(after, 200, 'once decided, the game is the player\'s to watch back');

    // ⭐ a friend room is watchable signed out, and the watcher gets no seed or RNG state
    const code3 = await w.mint();
    const a3 = await w.client(), b3 = await w.client();
    await a3.ask({ t: 'join', room: code3, seat: 0, token: ann.token }, m => m.t === 'joined');
    await b3.ask({ t: 'join', room: code3, seat: 1, token: bo.token }, m => m.t === 'joined' && !!m['view']);
    const friend = await watch(code3, undefined);
    assert.equal(friend.got.t, 'watching', `a friend room is watchable signed out (got ${friend.got.msg ?? ''})`);
    const view = friend.got['view'] as { seed: number; rngState: number };
    const saved = JSON.parse(readFileSync(join(w.env.ALGO_GAMES_DIR, `${code3}.json`), 'utf8')) as { seed: number };
    assert.notEqual(saved.seed, 0, 'fixture: the game has a real seed to leak');
    assert.equal(view.seed, 0, 'the watcher is not sent the seed');
    assert.equal(view.rngState, 0, 'nor the RNG state');

    // ⭐ a rated game: only a signed-in non-seat from another address watches; a watcher at a seat's address is dropped
    const qa = await w.client(), qb = await w.client();
    qa.send({ t: 'queue', q: 'join', mode: 'draft', ranked: true, token: ann.token });
    await qa.next(m => m.t === 'queue');
    qb.send({ t: 'queue', q: 'join', mode: 'draft', ranked: true, token: bo.token });
    await qa.next(m => m.t === 'queue' && !!m['offer']);
    qa.send({ t: 'queue', q: 'accept', token: ann.token });
    qb.send({ t: 'queue', q: 'accept', token: bo.token });
    const rated = ((await qa.next(m => m.t === 'queue' && !!m['matched']))['matched'] as { room: string }).room;

    const early = await watch(rated, cy.token, A);
    assert.equal(early.got.t, 'watching', `fixture: an early watcher gets in (got ${early.got.msg ?? ''})`);
    const ra = await w.client(A), rb = await w.client(B);
    const mark = early.c.msgs.length;
    await ra.ask({ t: 'join', room: rated, token: ann.token }, m => m.t === 'joined');
    await early.c.next(m => m.t === 'kicked', mark);
    await rb.ask({ t: 'join', room: rated, token: bo.token }, m => m.t === 'joined');

    const refused = async (label: string, token: string | undefined, from: string): Promise<void> => {
      const { got } = await watch(rated, token, from);
      assert.equal(got.t, 'error', `${label} may not watch a rated game`);
      assert.match(String(got.msg), /rated, league or match/, `${label}: refused for the wrong reason`);
    };
    await refused('a signed-out socket', undefined, C);
    await refused('a seat\'s own account from elsewhere', ann.token, C);
    await refused('another account from a seat\'s address', cy.token, A);
    const fine = await watch(rated, cy.token, C);
    assert.equal(fine.got.t, 'watching', `another account from another address may watch (got ${fine.got.msg ?? ''})`);
  } finally {
    await w.stop();
  }
});

test('1400 ⭐ unknown room codes are limited per address, across watch and join', async () => {
  const w = await ccWire('t1400b');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  const M = '203.0.113.5', N = '203.0.113.6';
  // codes the server never mints: link.ts leaves I out of its alphabet
  const miss = (i: number): string => 'QI' + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
  try {
    const live = await w.mint();
    const a = await w.client(), b = await w.client();
    await a.ask({ t: 'join', room: live, seat: 0, token: ann.token }, m => m.t === 'joined');
    await b.ask({ t: 'join', room: live, seat: 1, token: bo.token }, m => m.t === 'joined' && !!m['view']);

    // twenty misses from one address, half watch and half join, each on its own socket
    for (let i = 0; i < 20; i++) {
      const c = await w.client(M);
      const got = await c.ask({ t: i < 10 ? 'watch' : 'join', room: miss(i) }, m => m.t === 'error');
      assert.match(String(got.msg), /No game with code/);
      c.close();
    }
    const joinGot = await (await w.client(M)).ask({ t: 'join', room: live }, m => m.t === 'error' || m.t === 'joined');
    assert.match(String(joinGot.msg), /too many unknown room codes/, 'a join of a live code is refused like a miss');
    const wc = await w.client(M);
    const closed = new Promise<number>(res => wc.ws.addEventListener('close', ev => res((ev as CloseEvent).code), { once: true }));
    wc.send({ t: 'watch', room: live });
    assert.equal(await Promise.race([closed, sleep(3000).then(() => -1)]), 1008, 'a watch of a live code closes the socket');
    assert.ok(!wc.msgs.some(m => m.t === 'watching'), 'and sends no board');
    const fine = await (await w.client(N)).ask({ t: 'watch', room: live }, m => m.t === 'watching' || m.t === 'error');
    assert.equal(fine.t, 'watching', 'another address still watches');
  } finally {
    await w.stop();
  }
});
