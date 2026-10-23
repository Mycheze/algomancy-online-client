/* WEEKLY CHALLENGES — the HTTP API, over real HTTP (docs/21 "HTTP API").
 *
 * An in-process http server on an ephemeral port carries api-challenge.ts's
 * routes; the runs are REAL — played here through the engine's own
 * newChallengeGame and verified by the real worker thread. The clock is
 * ALGO_CHALLENGE_NOW, set in-process, exactly as the route reads it.
 *
 * §1 the calendar view: the open week, nothing about a future one
 * §2 ⭐ a run needs a named account: no session 401, a guest 403
 * §3 an unknown or not-yet-open challenge, and the caps, refused before any replay
 * §4 ⭐ a tampered run is refused by the replay
 * §5 ⭐ a valid run is accepted, scored by the server and ranked on each of
 *    the four boards, with the boards it is a new best on; the same run
 *    twice is one run; one verification in flight per account
 * §6 ⭐ while the week is open: names and numbers only; a run is its owner's
 * §7 ⭐ once it closes: decks, run ids and runs are public, and the three winners are frozen
 * §8 ⭐ a run sent to the closed week is ranked but cannot move the frozen winners
 * §9 the caller's own best and rank on each board, and par as the row commits it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, CardName } from '../../engine/src/types.ts';
import {
  BOARD_KINDS, PLAYER, TROPHY_KINDS, compareScores, foldRun, newChallengeGame, newRun, settleDummy, verifyRun,
  type BoardKind, type ChallengeDef, type RunScore,
} from '../../engine/src/challenge.ts';
import { apply } from '../../engine/src/apply.ts';
import { register, registerGuest, useAccountsFile } from '../accounts.ts';
import { challengeRoutes } from '../api-challenge.ts';
import { useChallengeDir } from '../challenge-store.ts';
import { stopChallengeWorker } from '../challenge-worker.ts';
import { weekWindow } from '../challenges.ts';

const root = mkdtempSync(join(tmpdir(), 'challenge-api-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
const restoreDir = useChallengeDir(join(root, 'challenges'));

const W1: ChallengeDef = { id: 'api-w1', week: '2026-10-25', title: 'One', blurb: 'Play two units.', goal: { kind: 'unitsPlayed', n: 2 }, seed: 7, par: 100 };
const W2: ChallengeDef = { id: 'api-w2', week: '2026-11-01', title: 'Two', blurb: 'Play two units.', goal: { kind: 'unitsPlayed', n: 2 }, seed: 8, par: 100 };
const ROWS = [W1, W2];
const w1 = weekWindow(W1);
const setNow = (ms: number): void => { process.env['ALGO_CHALLENGE_NOW'] = new Date(ms).toISOString(); };
setNow(w1.opens + 3_600_000);

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  challengeRoutes(req, res, url.pathname, url, { rows: ROWS }).then(handled => {
    if (!handled) { res.writeHead(404); res.end(); }
  }, err => { res.writeHead(500); res.end(String(err)); });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(async () => {
  delete process.env['ALGO_CHALLENGE_NOW'];
  await stopChallengeWorker();
  await new Promise<void>(r => server.close(() => r()));
  restoreDir(); restoreAccounts();
  rmSync(root, { recursive: true, force: true });
});

interface Answer { status: number; body: Record<string, unknown>; raw: string }
async function call(method: 'GET' | 'POST', path: string, token: string | null = null, body?: unknown): Promise<Answer> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  return { status: r.status, body: raw ? JSON.parse(raw) as Record<string, unknown> : {}, raw };
}

function named(name: string): { id: string; token: string } {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `register ${name}`);
  return { id: r.account.id, token: r.token };
}
const ALICE = named('Alice'), BOB = named('Bob'), CAROL = named('Carol');

/**
 * A real run, played here: an all-Bumblecrab deck (earth, costs two earth),
 * recycling up to `recycle` cards a turn into earth, waking every resource,
 * and playing a unit whenever one can be played. `recycle` changes how many
 * copies the run uses, so two settings give two different scores.
 */
function playRun(def: ChallengeDef, recycle: number, deckSize = 30): { deck: CardName[]; actions: Action[] } {
  const deck: CardName[] = Array<CardName>(deckSize).fill('Bumblecrab');
  const h = newChallengeGame(def, deck);
  let acc = newRun(def.goal, deck);
  const recycled = new Map<number, number>();
  const prio: Record<string, number> = { playCard: 0, activateResource: 1, recycleForResource: 2, bottomCards: 2, decide: 3, declareAttack: 4, declareBlocks: 4 };
  for (let step = 0; step < 2000 && !acc.met; step++) {
    settleDummy(h);
    const legal = h.legal(PLAYER).filter(a => a.type !== 'concede'
      && (a.type !== 'recycleForResource' || ((recycled.get(h.state.turn) ?? 0) < recycle && JSON.stringify(a).includes('earth'))));
    assert.ok(legal.length, `the player has no move at step ${step}`);
    const meets = legal.find(a => {
      try { const r = apply(h.state, a); return foldRun(acc, h.state, a, r.state, r.events).met; } catch { return false; }
    });
    const pick = meets ?? [...legal].sort((x, y) => (prio[x.type] ?? 9) - (prio[y.type] ?? 9))[0]!;
    if (pick.type === 'recycleForResource') recycled.set(h.state.turn, (recycled.get(h.state.turn) ?? 0) + 1);
    const before = h.state;
    const ev = h.do(pick);
    acc = foldRun(acc, before, pick, h.state, ev);
  }
  assert.ok(acc.met, 'the scripted run meets its goal');
  return { deck, actions: h.actions };
}

const RUN_A = playRun(W1, 2);     // Alice's
const RUN_B = playRun(W1, 3);     // Bob's: more copies used
const scoreOf = (r: { deck: CardName[]; actions: Action[] }, def = W1): RunScore => {
  const v = verifyRun(def, r.deck, r.actions);
  assert.ok(v.ok, v.ok ? '' : v.error);
  return v.score;
};
const SA = scoreOf(RUN_A), SB = scoreOf(RUN_B);

/** each board's rows from a board reply */
const boardRows = (body: Record<string, unknown>, k: BoardKind): Record<string, unknown>[] =>
  (body['boards'] as Record<BoardKind, Record<string, unknown>[]>)[k];
const allRanks = (n: number): Record<BoardKind, number> => ({ fastest: n, leanest: n, purest: n, overall: n });

test('challenge api §0 the two scripted runs score differently: Alice ahead of Bob on every board', () => {
  for (const k of BOARD_KINDS) assert.ok(compareScores(k, SA, SB) < 0, `${k}: Alice ${JSON.stringify(SA)} vs Bob ${JSON.stringify(SB)}`);
});

test('challenge api §1 the calendar view shows the open week and nothing of a future one', async () => {
  const r = await call('GET', '/api/challenge');
  assert.equal(r.status, 200);
  const cur = r.body['current'] as Record<string, unknown>;
  assert.equal(cur['id'], 'api-w1');
  assert.equal(cur['opens'], w1.opens);
  assert.equal(cur['closes'], w1.closes);
  assert.equal(cur['closed'], false);
  assert.equal(cur['entrants'], 0);
  assert.deepEqual(r.body['past'], []);
  assert.equal('mine' in r.body, false, 'a guest has no bests');
  assert.equal(r.raw.includes('api-w2'), false, 'a week that has not opened is not shown');
});

test('challenge api §2 a guest cannot submit a run', async () => {
  const none = await call('POST', '/api/challenge/run', null, { challengeId: W1.id, ...RUN_A });
  assert.equal(none.status, 401);
  assert.equal(none.body['ok'], false);
  const g = registerGuest();
  assert.ok(g.ok);
  const guest = await call('POST', '/api/challenge/run', g.token, { challengeId: W1.id, ...RUN_A });
  assert.equal(guest.status, 403);
  assert.match(String(guest.body['error']), /name your account/);
  assert.equal(((await call('GET', '/api/challenge')).body['current'] as Record<string, unknown>)['entrants'], 0, 'nothing was recorded');
});

test('challenge api §3 an unknown or future challenge, and the caps, are refused before a replay', async () => {
  for (const id of ['nope', W2.id]) {
    const r = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: id, ...RUN_A });
    assert.equal(r.status, 404, `${id} is refused`);
  }
  assert.equal((await call('GET', `/api/challenge/${W2.id}/board`)).status, 404, 'no board for a week that has not opened');
  const deck = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, deck: Array(201).fill('Bumblecrab'), actions: RUN_A.actions });
  assert.equal(deck.status, 400);
  assert.match(String(deck.body['error']), /200/);
  const acts = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, deck: RUN_A.deck, actions: Array(20_001).fill(0) });
  assert.equal(acts.status, 400);
  assert.match(String(acts.body['error']), /20000/);
  const huge = await call('POST', '/api/challenge/run', ALICE.token, `{"challengeId":"${W1.id}","pad":"${'x'.repeat(4 * 1024 * 1024)}"}`);
  assert.equal(huge.status, 413);
  const junk = await call('POST', '/api/challenge/run', ALICE.token, '{not json');
  assert.equal(junk.status, 400);
});

test('challenge api §4 a tampered run is refused by the replay', async () => {
  const short = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, deck: RUN_A.deck, actions: RUN_A.actions.slice(0, -1) });
  assert.equal(short.status, 422);
  assert.equal(short.body['ok'], false);
  assert.match(String(short.body['error']), /never meets the goal/);

  const dummyAt = RUN_A.actions.findIndex(a => a.seat === 1);
  assert.ok(dummyAt >= 0, 'the log holds a dummy move');
  const forged = RUN_A.actions.map((a, i) => i === dummyAt ? { type: 'concede', seat: 1 } as Action : a);
  const r = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, deck: RUN_A.deck, actions: forged });
  assert.equal(r.status, 422);
  assert.equal(r.body['at'], dummyAt, 'the refusal names the forged action');

  const wrongDeck = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, deck: ['Training Construct'], actions: RUN_A.actions });
  assert.equal(wrongDeck.status, 422, 'a lesson-only card is not a deck card');
  assert.equal(((await call('GET', '/api/challenge')).body['current'] as Record<string, unknown>)['entrants'], 0, 'no refused run was recorded');
});

let aliceRun = '';
let bobRun = '';

test('challenge api §5 a valid run is accepted, scored by the server and ranked', async () => {
  const a = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, ...RUN_A });
  assert.equal(a.status, 200, a.raw);
  assert.equal(a.body['ok'], true);
  assert.deepEqual(a.body['score'], SA, 'the server scored it itself');
  assert.equal(a.body['improved'], true, 'a first run is a new best');
  assert.deepEqual(a.body['newBest'], BOARD_KINDS, '…on every board');
  assert.deepEqual(a.body['ranks'], allRanks(1));
  aliceRun = String(a.body['runId']);

  const again = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W1.id, ...RUN_A });
  assert.equal(again.body['runId'], aliceRun, 'the same run sent twice is one run');
  assert.equal(again.body['improved'], false);
  assert.deepEqual(again.body['newBest'], []);

  // two at once from one account: one is checked, the other told to wait
  const both = await Promise.all([
    call('POST', '/api/challenge/run', BOB.token, { challengeId: W1.id, ...RUN_B }),
    call('POST', '/api/challenge/run', BOB.token, { challengeId: W1.id, ...RUN_B }),
  ]);
  const st = both.map(x => x.status).sort();
  assert.deepEqual(st, [200, 429], `one verification in flight per account (got ${st.join(', ')})`);
  const b = both.find(x => x.status === 200)!;
  assert.deepEqual(b.body['ranks'], allRanks(2), 'more cards, same turns and elements: second everywhere');
  bobRun = String(b.body['runId']);

  const board = await call('GET', `/api/challenge/${W1.id}/board`);
  for (const k of BOARD_KINDS) {
    assert.deepEqual(boardRows(board.body, k).map(r => [r['rank'], r['name'], r['score']]), [[1, 'Alice', SA], [2, 'Bob', SB]], k);
  }
  assert.equal(board.raw.includes(ALICE.id) || board.raw.includes(BOB.id), false, 'no account id on a board');
  assert.equal(((await call('GET', '/api/challenge')).body['current'] as Record<string, unknown>)['entrants'], 2);
});

test('challenge api §6 while the week is open: names and numbers only, a run is its owner', async () => {
  const board = await call('GET', `/api/challenge/${W1.id}/board?by=turns`);
  assert.equal(board.body['closed'], false);
  assert.equal('by' in board.body, false, 'every board comes at once: a category asked for is ignored');
  assert.deepEqual(boardRows(board.body, 'fastest').map(r => r['name']), ['Alice', 'Bob']);
  assert.equal('winners' in board.body, false);
  for (const row of BOARD_KINDS.flatMap(k => boardRows(board.body, k))) {
    assert.equal('deck' in row, false, 'no deck before the close');
    assert.equal('runId' in row, false, 'no run id before the close');
  }
  const own = await call('GET', `/api/challenge/run/${aliceRun}`, ALICE.token);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body['deck'], RUN_A.deck);
  assert.equal((own.body['actions'] as unknown[]).length, RUN_A.actions.length);
  assert.equal(own.body['name'], 'Alice');
  assert.equal((await call('GET', `/api/challenge/run/${aliceRun}`, BOB.token)).status, 404, 'not to another player');
  assert.equal((await call('GET', `/api/challenge/run/${aliceRun}`)).status, 404, 'not to a guest');
});

test('challenge api §7 once the week closes, decks and runs are public and the winner is frozen', async () => {
  setNow(w1.closes + 60_000);
  const board = await call('GET', `/api/challenge/${W1.id}/board`);
  assert.equal(board.body['closed'], true);
  const rows = boardRows(board.body, 'fastest');
  assert.deepEqual(rows[0]?.['deck'], RUN_A.deck, 'decks open at the close');
  assert.equal(rows[0]?.['runId'], aliceRun);
  const winners = board.body['winners'] as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(winners).sort(), ['fastest', 'leanest', 'purest'], 'three trophies; overall has none');
  for (const k of TROPHY_KINDS) assert.equal(winners[k]?.['name'], 'Alice', k);
  const pub = await call('GET', `/api/challenge/run/${bobRun}`);
  assert.equal(pub.status, 200, 'anybody can open a closed week run');
  assert.equal(pub.body['name'], 'Bob');
  assert.equal(pub.raw.includes(BOB.id), false, 'no account id in a run');
  const cal = await call('GET', '/api/challenge');
  assert.equal((cal.body['current'] as Record<string, unknown>)['id'], 'api-w2', 'the next week is open');
  assert.deepEqual((cal.body['past'] as Record<string, unknown>[]).map(p => [p['id'], p['closed'], p['entrants']]), [['api-w1', true, 2]]);
});

test('challenge api §8 a run sent to the closed week is ranked but cannot move the winner', async () => {
  // Carol finds a cheaper line than Alice after the close: fewer recycles still meet the goal
  const better = playRun(W1, 1);
  const sc = scoreOf(better);
  for (const k of BOARD_KINDS) assert.ok(compareScores(k, sc, SA) < 0, `${k}: Carol ${JSON.stringify(sc)} should beat Alice`);
  const r = await call('POST', '/api/challenge/run', CAROL.token, { challengeId: W1.id, ...better });
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual(r.body['ranks'], allRanks(1), 'ranked first on the live boards');
  const board = await call('GET', `/api/challenge/${W1.id}/board`);
  assert.equal(boardRows(board.body, 'leanest')[0]?.['name'], 'Carol');
  const winners = board.body['winners'] as Record<string, Record<string, unknown>>;
  for (const k of TROPHY_KINDS) assert.equal(winners[k]?.['name'], 'Alice', `the frozen ${k} winner stands`);
});

test('challenge api §9 my best, and par as the row commits it', async () => {
  const mine = (await call('GET', '/api/challenge', ALICE.token)).body['mine'] as Record<string, Record<BoardKind, { score: RunScore; rank: number }>>;
  assert.deepEqual(Object.keys(mine), ['api-w1']);
  for (const k of BOARD_KINDS) {
    assert.deepEqual(mine['api-w1']![k], { score: SA, rank: 2 }, `${k}: her best, and Carol's late run is ahead of it`);
  }
  assert.equal((await call('GET', '/api/challenge', CAROL.token)).body['mine'] !== undefined, true);
  const cal = await call('GET', '/api/challenge');
  assert.equal((cal.body['past'] as Record<string, unknown>[])[0]?.['par'], W1.par, 'par is the committed number, on the first ask');
  assert.equal((cal.body['current'] as Record<string, unknown>)['par'], W2.par);
  assert.equal(SA.skill, Math.floor((200 * W1.par + SA.raw) / (2 * SA.raw)), 'the stamped Skill is par ÷ raw × 100');
});
