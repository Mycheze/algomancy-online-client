// The post-game payload names the game a seat can watch back, and only when the replay route admits that seat. Over the wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

test('1512 a signed-in seat is offered its replay and the route opens it; a signed-out seat is offered none', async () => {
  const w = await ccWire('t1512');
  const [ann] = w.people as [typeof w.people[0]];
  const replay = (code: string, token: string): Promise<number> =>
    fetch(`http://localhost:${w.port}/api/replay/${code}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => { await r.arrayBuffer(); return r.status; });
  try {
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    await a.ask({ t: 'join', room: code, seat: 0, token: ann.token }, m => m.t === 'joined');
    await b.ask({ t: 'join', room: code, seat: 1, name: 'Guestless' }, m => m.t === 'joined' && !!m['view']);
    const markB = b.msgs.length;
    a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    const overA = await a.next(m => m.t === 'gameover');
    const overB = await b.next(m => m.t === 'gameover', markB);
    assert.equal(overA['replay'], code, 'the signed-in seat is offered this game');
    assert.equal(overB['replay'], undefined, 'a signed-out seat has nothing the route would open');
    let status = 0;
    for (let i = 0; i < 50 && status !== 200; i++) { status = await replay(code, ann.token); if (status !== 200) await sleep(100); }
    assert.equal(status, 200, 'what the screen offers, the replay route opens');
  } finally {
    await w.stop();
  }
});
