/* BL-38 §2 — `GET /api/replay/<CODE>`: who may watch, and what they are told.
 *
 * Two jobs, and they fail in opposite directions.
 *
 * THE GATE. A saved game names two accounts and carries both their decks. So
 * "you may not watch this" and "there is no such game" have to be the same
 * answer — api-admin.ts's 404-never-403 rule, applied a fourth time, and for a
 * second reason on top of its usual one: a distinguishable refusal turns a
 * four-character room code into an oracle for which games somebody has played.
 * §1–§4 are that gate from every side.
 *
 * THE VERDICT. The viewer draws whatever it is given, so if this route says a
 * game is faithful, the person watching believes it. §5–§8 pin the four things
 * it can say and, in particular, that a file WITHOUT fingerprints is reported
 * as `unverified` rather than as `as-recorded` — the failure that would matter
 * most, because it is the comfortable answer and it is wrong about every game
 * played before BL-38 landed.
 *
 *   §1 signed out is 404
 *   §2 a stranger is 404, byte-identical to a game that does not exist
 *   §3 a player gets their own game, and is told which seat they sat in
 *   §4 an admin gets anybody's, and is told that is why
 *   §5 a file with matching fingerprints is `as-recorded`
 *   §6 a file whose fingerprints disagree is `reconstruction`, AT THE FIRST
 *      INDEX THAT DIFFERS — not at the first refusal, which is a later number
 *   §7 a file with no fingerprints is `unverified`, never `as-recorded`
 *   §8 a file that can never be replayed says so instead of vanishing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SCRATCH = mkdtempSync(join(tmpdir(), 'bl38-route-'));
const GAMES = join(SCRATCH, 'games');
mkdirSync(GAMES, { recursive: true });
process.env['ALGO_GAMES_DIR'] = GAMES;
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');

const { register, setAdmin, accountForToken } = await import('../accounts.ts');
const { replayRoutes, resetReplayCache } = await import('../api-replay.ts');
const { createRoom, applyToRoom } = await import('../rooms.ts');
const { legalActions } = await import('../../engine/src/apply.ts');

/* ── fixtures ───────────────────────────────────────────────────────── */

function account(name: string): { id: string; token: string } {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `could not register ${name}`);
  return { id: r.account.id, token: r.token };
}

const ALICE = account('alice');
const BOB = account('bob');
const CAROL = account('carol');
const OPS = account('ops');
setAdmin(accountForToken(OPS.token)!, true);

/** A real game, played here, so its fingerprints are genuine. */
function playGame(code: string, seats: [string | null, string | null], actions = 40): void {
  const room = createRoom(code, 4242, ['alice', 'bob'], 'shared');
  room.users = seats;
  for (let i = 0; i < actions; i++) {
    if (room.state.winner !== null) break;
    const legal = [...legalActions(room.state, 0), ...legalActions(room.state, 1)];
    if (!legal.length) break;
    applyToRoom(room, legal[0]!);
  }
}

/** Edit a saved game on disk, and forget whatever the route concluded about it. */
function patch(code: string, f: (raw: Record<string, unknown>) => void): void {
  const path = join(GAMES, `${code}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  f(raw);
  writeFileSync(path, JSON.stringify(raw));
  resetReplayCache();
}

/* ── a request, and what came back ───────────────────────────────────── */

interface Answer { status: number; body: unknown; handled: boolean }

async function get(code: string, token: string | null): Promise<Answer> {
  const req = {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as IncomingMessage;
  let status = 0;
  let payload = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string) { payload = b ?? ''; return res; },
    setHeader() { /* unused */ },
  } as unknown as ServerResponse;
  const handled = await replayRoutes(req, res, `/api/replay/${code}`, { liveRoom: () => false });
  let body: unknown = payload;
  try { body = JSON.parse(payload); } catch { /* the 404 is text/plain */ }
  return { status: status || 200, body, handled };
}

playGame('GAME', [ALICE.id, BOB.id]);
playGame('NOSIG', [ALICE.id, null]);
patch('NOSIG', raw => { delete raw['sigs']; });

/* ══ the gate ═════════════════════════════════════════════════════════ */

test('BL-38 §1 signed out gets nothing, and learns nothing', async () => {
  const r = await get('GAME', null);
  assert.equal(r.handled, true, 'the route must answer, not fall through to the file handler');
  assert.equal(r.status, 404);
});

test('BL-38 §2 a stranger is refused exactly as a missing game is', async () => {
  const stranger = await get('GAME', CAROL.token);
  const missing = await get('ZZZZ', CAROL.token);
  assert.equal(stranger.status, 404);
  assert.deepEqual(stranger.body, missing.body,
    'a distinguishable refusal makes a room code an oracle for who played what');
});

test('BL-38 §3 a player gets their own game and is told which seat they sat in', async () => {
  const a = await get('GAME', ALICE.token) as { body: { ok: boolean; mySeat: number; asAdmin: boolean; file: { actions: unknown[] } } };
  assert.equal(a.body.ok, true);
  assert.equal(a.body.mySeat, 0);
  assert.equal(a.body.asAdmin, false);
  assert.ok(a.body.file.actions.length > 10, 'the log came with it');

  const b = await get('GAME', BOB.token) as { body: { mySeat: number } };
  assert.equal(b.body.mySeat, 1, 'and the other seat is told it is the other seat');
});

test('BL-38 §4 an admin gets anybody\'s game, and the answer says that is why', async () => {
  const r = await get('GAME', OPS.token) as { body: { ok: boolean; mySeat: number | null; asAdmin: boolean } };
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mySeat, null, 'they did not play it');
  assert.equal(r.body.asAdmin, true,
    'the viewer opens omniscient for an operator and needs to know it is one');
});

/* ══ the verdict ══════════════════════════════════════════════════════ */

test('BL-38 §5 a game whose fingerprints all match is `as-recorded`', async () => {
  const r = await get('GAME', ALICE.token) as { body: { verdict: string; partedAt: number | null; forked: boolean } };
  assert.equal(r.body.verdict, 'as-recorded');
  assert.equal(r.body.partedAt, null);
  assert.equal(r.body.forked, false);
});

test('BL-38 §6 a disagreement is `reconstruction`, at the FIRST index that differs', async () => {
  patch('GAME', raw => {
    const sigs = raw['sigs'] as string[];
    sigs[12] = 'f'.repeat(16);
    sigs[30] = 'e'.repeat(16);
  });
  const r = await get('GAME', ALICE.token) as { body: { verdict: string; partedAt: number; refusedAt: number | null } };
  assert.equal(r.body.verdict, 'reconstruction');
  assert.equal(r.body.partedAt, 12,
    'from the first difference on, the replay is running a board the recorded game '
    + 'never had — a later difference is cascade, not a second finding');
  assert.equal(r.body.refusedAt, null,
    'and NOTHING WAS REFUSED. This is the KAWJ case: a refusal count would have '
    + 'called this game faithful. If this assertion ever has to change, check '
    + 'that partedAt still leads it.');
  // put it back for anybody reading the file afterwards
  resetReplayCache();
});

test('BL-38 §7 a game with no fingerprints is `unverified`, never `as-recorded`', async () => {
  const r = await get('NOSIG', ALICE.token) as { body: { verdict: string; partedAt: number | null } };
  assert.equal(r.body.verdict, 'unverified',
    'every game played before BL-38 landed looks like this, and calling them '
    + 'faithful would be the comfortable answer and a false one');
  assert.equal(r.body.partedAt, null, 'there is nothing to have parted from');
});

test('BL-38 §7b a verdict is not cached past the file it is about', async () => {
  // The cache exists because a verdict costs a full replay and a scrubber asks
  // for the file once per open. Its FIRST key was engine + action count, which
  // is stale the moment a file changes without growing — and a browser check
  // caught it within the hour: a fingerprint was edited on disk and the route
  // went on serving the blessing it had already given. The reassuring answer,
  // from a cache, about a file that had changed underneath it. That is
  // replay-room.ts's own stale-copy lesson one layer up.
  playGame('CACHE', [ALICE.id, null]);
  const first = await get('CACHE', ALICE.token) as { body: { verdict: string } };
  assert.equal(first.body.verdict, 'as-recorded');

  const path = join(GAMES, 'CACHE.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { sigs: string[] };
  raw.sigs[9] = 'deadbeefdeadbeef';
  writeFileSync(path, JSON.stringify(raw));
  // deliberately NOT resetReplayCache(): the cache is what is under test

  const second = await get('CACHE', ALICE.token) as { body: { verdict: string; partedAt: number | null } };
  assert.equal(second.body.verdict, 'reconstruction',
    'the route served a cached verdict about a file that has since changed');
  assert.equal(second.body.partedAt, 9);
});

test('BL-38 §8 a game that can never be replayed says why instead of vanishing', async () => {
  writeFileSync(join(GAMES, 'BROK.json'), JSON.stringify({
    seed: 1, mode: 'draft', actions: [], users: [ALICE.id, null],
    // a draft game that never recorded its trio: unreplayable by anything,
    // ever, and the corpus has two of these (GAXG, HDGG)
  }));
  resetReplayCache();
  const r = await get('BROK', ALICE.token) as { body: { ok: boolean; verdict: string; reason?: string } };
  assert.equal(r.body.ok, true, 'listed, not absent — BL-38 asks for exactly this');
  assert.equal(r.body.verdict, 'unreplayable');
  assert.ok((r.body.reason ?? '').length > 0, 'and it says why');
});

test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));
