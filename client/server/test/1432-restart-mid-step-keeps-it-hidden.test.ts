/* 1432 — A RESTART INSIDE A HIDDEN STEP KEEPS IT HIDDEN.
 *
 * A live room resumes from its stored point (rooms.ts `live`), which carries
 * the step's frozen board and the events held from each seat. Over the wire,
 * across a real restart: the other seat is still served the frozen half, and
 * the reveal at the barrier still brings what was held before the restart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, Seat } from '../../engine/src/types.ts';
import { mintRoom, spawnServer } from '../e2e/test-util.ts';
import { Client, type Msg } from './cc-wire.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-1432-'));
const ENV = { ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'), ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl') };

async function sit(port: number, code: string, seat: Seat): Promise<{ c: Client; joined: Msg }> {
  const c = new Client(port);
  await c.open();
  return { c, joined: await c.ask({ t: 'join', room: code, seat, name: seat ? 'Bo' : 'Ann' }, m => m.t === 'joined') };
}
const resources = (m: Msg): number => m.view.players[0].resources.length;

test('a restart inside the hidden planning step keeps seat 0 hidden from seat 1, and the reveal still carries it', async () => {
  let server = await spawnServer(ENV);
  try {
    const code = await mintRoom(server.port);
    let a = await sit(server.port, code, 0), b = await sit(server.port, code, 1);
    const frozen = resources(b.joined);
    const recycle = (a.joined.legal as Action[]).find(x => x.type === 'recycleForResource' && x.seat === 0);
    await a.c.ask({ t: 'action', action: recycle }, m => m.t === 'update' && resources(m) === frozen + 1);
    a.c.close(); b.c.close();
    await server.stop();

    server = await spawnServer(ENV);
    a = await sit(server.port, code, 0); b = await sit(server.port, code, 1);
    assert.equal(resources(a.joined), frozen + 1, 'seat 0 still sees its own recycle');
    assert.equal(resources(b.joined), frozen, 'seat 1 is served the frozen half');
    assert.ok(!JSON.stringify(b.joined).includes('recycles'), 'and is not told of the recycle');

    await a.c.ask({ t: 'action', action: { type: 'donePlanning', seat: 0 } }, m => m.t === 'update');
    const close = await b.c.ask({ t: 'action', action: { type: 'donePlanning', seat: 1 } }, m => m.t === 'update' && m.step === 'plan');
    assert.ok(close.reveal.some((e: { type: string; data?: { seat?: Seat } }) => e.type === 'recycle' && e.data?.seat === 0),
      "the reveal brings seat 0's recycle from before the restart");
    assert.equal(resources(close), frozen + 1, "and seat 0's half is shown after it");
    a.c.close(); b.c.close();
  } finally {
    await server.stop();
  }
});
