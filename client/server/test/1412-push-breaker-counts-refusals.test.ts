// A refused queue push (non-2xx) counts toward the circuit breaker like a dead socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

test('⭐ five 404s open the breaker: the next event is not sent', async () => {
  let hits = 0;
  const bot = createServer((req, res) => {
    req.resume();
    req.on('end', () => { hits++; res.writeHead(404, { 'content-type': 'text/plain' }); res.end('x'); });
  });
  await new Promise<void>(r => bot.listen(0, '127.0.0.1', r));
  process.env['ALGO_BOT_PUSH_URL'] = `http://127.0.0.1:${(bot.address() as AddressInfo).port}/events`;
  process.env['ALGO_BOT_TOKEN'] = 'test-1412';
  const hooks = await import('../hooks.ts');   // reads both at import
  const settle = async (want: number): Promise<void> => {
    const end = Date.now() + 5000;
    while (hits < want && Date.now() < end) await new Promise(r => setTimeout(r, 5));
    await new Promise(r => setTimeout(r, 50));    // let the client's .then/.catch run
  };
  const event = () => hooks.emit({ t: 'queue.lapse', mode: 'm', backInLine: [], dropped: [] });
  try {
    for (let i = 1; i <= 5; i++) { event(); await settle(i); }
    assert.equal(hits, 5);
    event();
    await new Promise(r => setTimeout(r, 300));
    assert.equal(hits, 5, 'after five refusals the breaker is open and nothing more is sent');
  } finally {
    hooks.resetHooks();
    await new Promise<void>(r => bot.close(() => r()));
  }
});
