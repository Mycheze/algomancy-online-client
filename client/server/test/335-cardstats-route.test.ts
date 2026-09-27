/* CARD STATS §6 — `GET /api/cardstats`: what anybody may ask, and what only
 * you may.
 *
 * Public aggregates, like the metagame list — and a public answer has to BE
 * an aggregate. A filter narrow enough to match one game would print what was
 * in somebody's hand in it, which /api/replay refuses a non-participant; so a
 * public filter under the floor is refused. "My games" folds only the
 * caller's own seats and needs a session. No account id ever goes out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Action } from '../../engine/src/types.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'cardstats-route-'));
const GAMES = join(SCRATCH, 'games');
mkdirSync(GAMES, { recursive: true });
process.env['ALGO_GAMES_DIR'] = GAMES;
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');

const { register, stashHistory } = await import('../accounts.ts');
const { cardStatsRoutes, PUBLIC_FLOOR } = await import('../api-cardstats.ts');
const { createRoom, applyToRoom } = await import('../rooms.ts');
const { legalActions } = await import('../../engine/src/apply.ts');
type RecordedGame = import('../accounts.ts').RecordedGame;

const account = (name: string): { id: string; token: string } => {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok);
  return { id: r.account.id, token: r.token };
};
const ALICE = account('alice');
const BOB = account('bob');

const WEIGHT: Partial<Record<Action['type'], number>> = { playCard: 12, augment: 6, graft: 6, recycleForResource: 1 };

/** A real draft game played here (so its file carries a live card log), then
 * stamped decided and put in the history the way a finished game is. */
function played(code: string, users: [string | null, string | null], winner: 0 | 1, day: string): void {
  const room = createRoom(code, code.charCodeAt(0) * 97 + code.charCodeAt(1), ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
  room.users = users;
  let x = code.charCodeAt(1);
  const rnd = (k: number): number => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % k; };
  for (let i = 0; i < 60 && room.state.winner === null; i++) {
    const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)].filter(a => a.type !== 'concede');
    if (!legal.length) break;
    const w = legal.flatMap(a => Array<Action>(WEIGHT[a.type] ?? 2).fill(a));
    applyToRoom(room, w[rnd(w.length)]!);
  }
  stashHistory({
    code, playedAt: `${day}T12:00:00.000Z`, recordedAt: `${day}T12:00:00.000Z`, mode: 'draft', els: ['fire', 'water', 'earth'],
    finished: true, winner, turns: room.state.turn, diverged: false, users, names: ['A', 'B'],
  } as unknown as RecordedGame);
}

for (const [i, code] of ['GA', 'GB', 'GC', 'GD', 'GE'].entries()) played(code, [ALICE.id, BOB.id], (i % 2) as 0 | 1, '2026-09-20');
played('GF', [BOB.id, null], 0, '2026-09-26');

interface Answer { status: number; body: Record<string, unknown>; raw: string; handled: boolean }
function get(query: string, token: string | null = null): Answer {
  const req = { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as IncomingMessage;
  let status = 0, raw = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string | Buffer) { raw = String(b ?? ''); return res; },
  } as unknown as ServerResponse;
  const handled = cardStatsRoutes(req, res, '/api/cardstats', new URL(`http://x/api/cardstats${query}`));
  return { status, body: JSON.parse(raw) as Record<string, unknown>, raw, handled };
}

test('the public answer folds every counted game, recorded as played, and names nobody', () => {
  const r = get('');
  assert.equal(r.handled, true);
  assert.equal(r.body['ok'], true);
  assert.equal(r.body['games'], 6);
  assert.deepEqual(r.body['sources'], { live: 6 }, 'every game here recorded its own card log');
  assert.ok((r.body['cards'] as unknown[]).length > 10);
  for (const id of [ALICE.id, BOB.id]) assert.ok(!r.raw.includes(id), 'an account id went out in a public answer');
});

test('a public filter narrow enough to show one game\'s hands is refused', () => {
  const r = get('?from=2026-09-26');
  assert.equal(r.body['ok'], false);
  assert.equal(r.body['games'], 1);
  assert.equal(r.body['floor'], PUBLIC_FLOOR);
  assert.ok(!('cards' in r.body), 'refused means no rows, not rows with a warning');
});

test('"my games" needs a session, and is only ever my own seats', () => {
  assert.equal(get('?me=1').status, 401);
  const alice = get('?me=1', ALICE.token);
  assert.equal(alice.body['ok'], true, 'my own games have no floor — they are only my cards');
  assert.equal(alice.body['games'], 5);
  assert.equal(alice.body['seatGames'], 5, 'one seat per game: mine');
  assert.deepEqual((alice.body['filter'] as { me?: string }).me, 'me');
  assert.ok(!alice.raw.includes(ALICE.id), 'not even my own id is echoed back');
  const bob = get('?me=1&from=2026-09-26', BOB.token);
  assert.equal(bob.body['games'], 1);
});

test('the route answers only its own path', () => {
  const req = { method: 'GET', headers: {} } as unknown as IncomingMessage;
  assert.equal(cardStatsRoutes(req, {} as ServerResponse, '/api/cardladder', new URL('http://x/api/cardladder')), false);
});
