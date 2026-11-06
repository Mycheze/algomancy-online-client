/* CT-533 — A FINISHED GAME IS SUMMARIZED FOR ITS RECORD OFF THE EVENT LOOP.
 *
 * When a game ended, main.ts recordFinishedGame recorded it (history.ts
 * recordLiveGame), and the record is a full replay of the game (stats.ts
 * summarizeGame): ~3.9 s for MCHQ on the home box after CT-529, ~23 s on the
 * steward's pinned cores, with the post-game screen and every other room on
 * the server waiting for it. The replay now runs in a worker
 * (summarize-worker.ts) and the record and the screen land when it is done.
 *
 *   §1 recordLiveGameOffThread: nothing is stashed until the worker answers,
 *      the worker answered (no fallback), and the row is the one the
 *      synchronous record makes
 *   §2 a worker that goes away mid-job hands its jobs to the main thread:
 *      the summaries still come back, identical
 *   §3 over the wire: a concede's update arrives, another room is served,
 *      and only then the post-game screen — to both seats, with real numbers
 *
 * Seeds 55000-55099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'algo-1155-'));
process.env['ALGO_VAR_DIR'] = DIR;
process.env['ALGO_GAMES_DIR'] = join(DIR, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(DIR, 'accounts.json');
const R = await import('../rooms.ts');
const H = await import('../history.ts');
const { gameHistory } = await import('../accounts.ts');
const { summarizeGame } = await import('../stats.ts');
const W = await import('../summarize-worker.ts');
const { mintRoom, opened, spawnServer } = await import('../e2e/test-util.ts');
test.after(async () => { await W.stopSummarizer(); rmSync(DIR, { recursive: true, force: true }); });

/** a room a few actions in, then conceded by seat 0 */
function finished(code: string, seed: number): import('../rooms.ts').Room {
  const room = R.createRoom(code, seed, ['Ann1155', 'Bo1155']);
  R.applyToRoom(room, { type: 'concede', seat: 0 });
  assert.equal(R.decidedWinner(room), 1, 'fixture: the concede decided it');
  return room;
}

/** a row without the two clocks it was stamped with */
const timeless = (g: Record<string, unknown>): Record<string, unknown> => {
  const { recordedAt: _r, playedAt: _p, ...rest } = g;
  return rest;
};

test('§1 the record is stashed only when the worker answers, and is the synchronous record\'s row', async () => {
  const room = finished('OFT1', 55000);
  let stashedBeforeLanding: boolean | undefined;
  const pending = H.recordLiveGameOffThread(room, () => {
    stashedBeforeLanding = gameHistory().some(g => g.code === 'OFT1');
  });
  assert.equal(gameHistory().some(g => g.code === 'OFT1'), false, 'nothing is recorded on the call: the replay has not run');
  assert.equal(stashedBeforeLanding, undefined, 'and nothing has landed yet');
  const row = await pending;
  assert.equal(stashedBeforeLanding, false, 'beforeLanding runs just ahead of the stash');
  assert.ok(gameHistory().some(g => g.code === 'OFT1'), 'the row is in the history once it lands');
  const st = W.summarizerStats();
  assert.ok(st.spawned >= 1, 'a worker was started');
  assert.equal(st.fellBack, 0, 'and it did the replay: nothing fell back to the main thread');

  const sync = H.recordLiveGame(room);
  assert.deepEqual(timeless(row.game as never), timeless(sync.game as never), 'the same row the synchronous record makes');
  assert.equal(row.game.winner, 1);
  assert.ok(row.game.finished);
});

test('§2 a worker stopped mid-job hands its jobs to the main thread, and they still come back right', async () => {
  const rooms = [finished('OFT2', 55001), finished('OFT3', 55002)];
  const recs = rooms.map(r => ({ code: r.code, seed: r.seed, mode: r.mode, els: r.els, names: r.names,
    actions: r.actions, winner: r.winner, playedAt: '2026-11-06T00:00:00.000Z' }));
  const before = W.summarizerStats().fellBack;
  const jobs = recs.map(rec => W.summarizeOffThread(rec));
  await W.stopSummarizer();
  const got = await Promise.all(jobs);
  assert.equal(W.summarizerStats().fellBack - before, 2, 'both jobs ran on the main thread');
  for (let i = 0; i < recs.length; i++) assert.deepEqual(got[i], summarizeGame(recs[i]!), `${recs[i]!.code}: the same summary`);
  assert.equal(W.summarizerStats().alive, false, 'and no worker is left up');
});

interface Msg { t: string; [k: string]: unknown }
function client(port: number): { ws: WebSocket; msgs: Msg[]; next: (pred: (m: Msg) => boolean, ms?: number) => Promise<Msg> } {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const msgs: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(String((ev as MessageEvent).data)) as Msg;
    msgs.push(m);
    for (const w of waiters.splice(0)) { if (w.pred(m)) w.res(m); else waiters.push(w); }
  });
  return {
    ws, msgs,
    next: (pred, ms = 20_000) => new Promise((res, rej) => {
      const had = msgs.find(pred);
      if (had) return res(had);
      const timer = setTimeout(() => rej(new Error('timed out waiting for a message')), ms);
      waiters.push({ pred, res: m => { clearTimeout(timer); res(m); } });
    }),
  };
}

test('§3 over the wire: the server serves another room before the post-game screen lands', async () => {
  // every game goes to the worker, however short
  const server = await spawnServer({ ALGO_RECORD_OFF_THREAD_FROM: '0' });
  try {
    const roomA = await mintRoom(server.port);
    const roomC = await mintRoom(server.port);
    const a = client(server.port), b = client(server.port), c = client(server.port);
    await Promise.all([opened(a.ws), opened(b.ws), opened(c.ws)]);
    a.ws.send(JSON.stringify({ t: 'join', room: roomA, seat: 0, name: 'Ann1155' }));
    await a.next(m => m.t === 'joined');
    b.ws.send(JSON.stringify({ t: 'join', room: roomA, seat: 1, name: 'Bo1155' }));
    await b.next(m => m.t === 'joined');

    const mark = a.msgs.length;
    a.ws.send(JSON.stringify({ t: 'action', action: { type: 'concede', seat: 0 } }));
    await a.next(m => m.t === 'update' && a.msgs.indexOf(m) >= mark);
    // the record is replaying in the worker now; the event loop is free
    c.ws.send(JSON.stringify({ t: 'join', room: roomC, seat: 0, name: 'Cy1155' }));
    await c.next(m => m.t === 'joined');
    assert.equal(a.msgs.some(m => m.t === 'gameover'), false,
      'another room was answered before the post-game screen: the replay did not hold the server');

    const [overA, overB] = await Promise.all([a.next(m => m.t === 'gameover'), b.next(m => m.t === 'gameover')]);
    for (const [who, over] of [['the conceder', overA], ['the winner', overB]] as const) {
      assert.equal(over['winner'], 1, `${who}'s screen names the winner`);
      assert.equal(typeof over['turns'], 'number', `${who}'s screen has the summary's numbers`);
      assert.ok(Array.isArray(over['seats']), `${who}'s screen has both seats' stats`);
    }
    assert.equal(a.msgs.filter(m => m.t === 'gameover').length, 1, 'one post-game screen, not two');
    for (const x of [a, b, c]) x.ws.close();
  } finally {
    await server.stop();
  }
});

test('§4 a row kept against the room as it was decided is not handed to the room once it has moved on', async () => {
  const { keepPostgameRow, postgameRow, postgameStamp } = await import('../postgame-row.ts');
  const room = finished('OFT4', 55003);
  const row = H.recordLiveGame(room).game;
  const asOf = postgameStamp(room);
  // the room moves on between the decision and the record's landing
  room.amendments.push({} as never);
  keepPostgameRow(room, row, asOf);
  let replays = 0;
  postgameRow(room, () => { replays++; return row; });
  assert.equal(replays, 1, 'the stale row is not reused: the screen is summarized again');
  room.amendments.pop();
  const fresh = finished('OFT5', 55004);
  keepPostgameRow(fresh, row, postgameStamp(fresh));
  postgameRow(fresh, () => { replays++; return row; });
  assert.equal(replays, 1, 'while a row kept against the room as it stands is reused');
});
