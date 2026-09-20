/* Integration test for R65's concede (run: node test-concede.ts).
 *
 * Same harness style as the other server tests: spawn the real server on an
 * ephemeral port, drive it over raw WebSockets, no test framework.
 *
 * The playtest ask was "We need a way to right click -> concede match :(" and
 * the interesting part is not the button but what has to be true behind it:
 * conceding is a real Action, so it must reach the opponent as a normal
 * update, decide the game, be stamped into the saved room like any other
 * result, and survive a restart — and it must be refused when it is not yours
 * to concede.
 *
 * R290 (2026-09-05) added a second stamp beside the result: WHO conceded and
 * on WHICH TURN, because a turn-1 concede is a walkover and a turn-2 one a
 * half-weight game. §3 plays three real games to turn 1, 2 and 5 over the
 * socket, concedes each, and reads the stamp back off the room file and
 * through the history import — the fold must never have to replay to find
 * the turn, so the turn has to be on disk.
 */
import { readFileSync, rmSync } from 'node:fs';
import type { Action, Seat } from '../../engine/src/types.ts';
import { gameFile, mintRoom, spawnServer } from './test-util.ts';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; msg?: string;
}

class Client {
  ws: WebSocket;
  view: any = null;
  legal: Action[] = [];
  log: string[] = [];
  msgs: Msg[] = [];
  /** wall time of the last message — see quiesce() */
  lastAt = 0;
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.addEventListener('message', ev => this.onMsg(JSON.parse(String((ev as MessageEvent).data))));
  }
  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise(res => this.ws.addEventListener('open', () => res(), { once: true }));
  }
  private onMsg(m: Msg): void {
    this.msgs.push(m);
    this.lastAt = Date.now();
    if (m.view) this.view = m.view;
    if (m.legal) this.legal = m.legal;
    if (m.log) this.log = m.log;
    if (m.events) for (const e of m.events) this.log.push(e.msg);
    const i = this.waiters.findIndex(w => w.pred(m));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
  }
  /** wait for a message matching `pred` that arrived AFTER index `after` */
  next(pred: (m: Msg) => boolean, after = 0, timeoutMs = 5000): Promise<Msg> {
    const past = this.msgs.findIndex((m, i) => i >= after && pred(m));
    if (past >= 0) return Promise.resolve(this.msgs[past]!);
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for message')), timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Resolve once neither client has received a message for `quietMs` (the
 * R204/CT-85 shape from test-clock.ts: never read a view with a known-pending
 * successor). */
async function quiesce(a: Client, b: Client, quietMs = 120, maxMs = 3000): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const since = Date.now() - Math.max(a.lastAt, b.lastAt);
    if (since >= quietMs || Date.now() >= deadline) return;
    await sleep(Math.min(quietMs - since, 40));
  }
}

/** the no-op draft commit for a redacted view */
function noopCommit(view: any, seat: Seat): Action {
  const H = view.players[seat].hand.length;
  const packIndices = view.packs[seat].map((_: unknown, i: number) => H + i);
  return { type: 'draftCommit', seat, packIndices } as Action;
}

/** Drive both clients forward with mundane actions until pred(view) holds on
 * BOTH (test-clock.ts's advanceUntil, verbatim in shape). */
async function advanceUntil(a: Client, b: Client, pred: (v: any) => boolean, label: string): Promise<void> {
  const done = (): boolean => pred(a.view) && pred(b.view);
  for (let i = 0; i < 200; i++) {
    await quiesce(a, b);
    if (done()) return;
    let sent = false;
    for (const c of [a, b]) {
      await quiesce(a, b);
      if (done()) return;
      const pick =
        c.legal.find(x => x.type === 'draftCommit') ??
        c.legal.find(x => x.type === 'donePlanning') ??
        c.legal.find(x => x.type === 'doneHaste') ??
        c.legal.find(x => x.type === 'passPriority') ??
        c.legal.find(x => x.type === 'declareAttack' && (x as any).columns?.length === 0) ??
        c.legal.find(x => x.type === 'declareBlocks') ??
        c.legal.find(x => x.type === 'doneDeploying');
      if (!pick) continue;
      const action = pick.type === 'draftCommit' ? noopCommit(c.view, (pick as any).seat) : pick;
      const mark = c.msgs.length;
      c.send({ t: 'action', action });
      try { await c.next(m => m.t === 'update' || m.t === 'error', mark, 4000); } catch { /* keep driving */ }
      sent = true;
    }
    if (!sent) await sleep(100);
  }
  if (done()) return;
  throw new Error(`advanceUntil(${label}): gave up after 200 rounds`);
}

// R204/CT-85: the server picks its own port and tells us which — see
// test-util.ts. It used to be `freePort()` then PORT=<number>, which left the
// port unheld for as long as node took to boot.
const server = await spawnServer();
const PORT = server.port;

const rooms: string[] = [];
try {
  const ROOM = await mintRoom(PORT);
  rooms.push(ROOM);
  const a = new Client(PORT), b = new Client(PORT);
  await a.open(); await b.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Ben' });
  await a.next(m => m.t === 'joined');
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Rashi' });
  await b.next(m => m.t === 'joined');

  console.log('\n[concede]');
  ok(a.view.winner === null, 'the game starts undecided');
  ok(!a.legal.some(x => x.type === 'concede'), 'concede is never OFFERED as a legal action');

  // not yours to concede
  const before = a.msgs.length;
  a.send({ t: 'action', action: { type: 'concede', seat: 1 } });
  const refused = await a.next(m => m.t === 'error', before);
  ok(/you are seat 0/.test(refused.msg ?? ''), 'you cannot concede on your opponent\'s behalf');

  // the real thing
  const bAt = b.msgs.length;
  a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
  await b.next(m => m.t === 'update' && m.view?.winner === 1, bAt);
  ok(b.view.winner === 1, "the OPPONENT's view says they won");
  ok(a.view.winner === 1 && a.view.phase === 'gameover', 'and the conceder\'s says the game is over');
  ok(b.log.some(l => /conceded/.test(l)), 'the log says how it ended');

  console.log('\n[the result is stamped, and it survives a restart]');
  await new Promise(r => setTimeout(r, 300));   // the room file is written async
  const saved = JSON.parse(readFileSync(gameFile(ROOM), 'utf8')) as
    { winner?: number; actions: Action[]; concession?: { seat: number; turn: number } };
  ok(saved.winner === 1, 'the saved room carries the result (not re-derived later)');
  ok(saved.actions.some(x => x.type === 'concede'), 'and the concede is in the action log, replayable');

  // a conceded game is over for good
  const cAt = a.msgs.length;
  a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
  const again = await a.next(m => m.t === 'error', cAt);
  ok(/game is over/i.test(again.msg ?? ''), 'conceding twice is refused');

  // R290: the post-game payload says what the concession weighed
  const over = a.msgs.find(m => m.t === 'gameover') as (Msg & { concession?: { seat: number; turn: number; weight: string } }) | undefined;
  ok(!!over, 'the conceder got the post-game payload');
  eq(over?.concession?.weight, 'walkover', '⭐ and it says this turn-1 concede was a walkover');
  eq(over?.concession?.seat, 0, 'naming who conceded');
  eq(over?.concession?.turn, 1, 'and the turn');

  a.ws.close(); b.ws.close();

  // ── R290 §3: the stamp carries the TURN, and the turn decides the weight ──
  //
  // Three real games, over the socket, conceded on turn 1, 2 and 5. The file
  // must carry `{ seat, turn }`, and the history import must turn that into
  // walkover / early / normal WITHOUT replaying — so the assertion is on the
  // saved JSON first and the imported row second.
  console.log('\n[R290: who conceded, on which turn]');
  eq(saved.concession?.seat, 0, 'turn-1 game: the file names the conceder');
  eq(saved.concession?.turn, 1, '⭐ turn-1 game: the file carries turn 1');

  const playTo = async (turn: number, conceder: Seat): Promise<{ code: string; file: any; over: any }> => {
    const code = await mintRoom(PORT);
    rooms.push(code);
    const p = new Client(PORT), q = new Client(PORT);
    await p.open(); await q.open();
    p.send({ t: 'join', room: code, seat: 0, name: 'Ben' });
    await p.next(m => m.t === 'joined');
    q.send({ t: 'join', room: code, seat: 1, name: 'Rashi' });
    await q.next(m => m.t === 'joined');
    await advanceUntil(p, q, v => (v?.turn ?? 0) >= turn, `turn ${turn}`);
    await quiesce(p, q);
    const who = conceder === 0 ? p : q, other = conceder === 0 ? q : p;
    const at = other.msgs.length;
    who.send({ t: 'action', action: { type: 'concede', seat: conceder } });
    await other.next(m => m.t === 'update' && m.view?.winner !== null && m.view?.winner !== undefined, at);
    const over = await who.next(m => m.t === 'gameover', 0, 5000).catch(() => null);
    await sleep(300);
    const file = JSON.parse(readFileSync(gameFile(code), 'utf8'));
    p.ws.close(); q.ws.close();
    return { code, file, over };
  };

  const t2 = await playTo(2, 1);
  eq(t2.file.winner, 0, 'turn-2 game: seat 1 conceded, seat 0 won');
  eq(t2.file.concession?.seat, 1, 'the file names seat 1');
  eq(t2.file.concession?.turn, 2, '⭐ and carries turn 2');
  eq(t2.over?.concession?.weight, 'early', '⭐ the post-game payload calls it early');

  const t5 = await playTo(5, 0);
  eq(t5.file.concession?.seat, 0, 'turn-5 game: the file names seat 0');
  ok(t5.file.concession?.turn >= 5, `⭐ and carries turn ${t5.file.concession?.turn} (≥ 5)`);
  eq(t5.over?.concession?.weight, 'normal', '⭐ the post-game payload calls it normal');

  // …and the history import reads the stamp off the file, never the replay.
  // In-process, against a scratch store (the child server has its own).
  process.env['ALGO_ACCOUNTS_FILE'] = gameFile('__concede-test-accounts').replace(/\.json$/, '') + '.json';
  const { importGame } = await import('../history.ts');
  const { concessionWeight } = await import('../concession.ts');
  const rowFor = (code: string, file: any) => importGame(file, code, new Date().toISOString()).game;
  const r1 = rowFor(ROOM, saved), r2 = rowFor(t2.code, t2.file), r5 = rowFor(t5.code, t5.file);
  eq(r1.concession?.turn, 1, 'imported turn-1 row carries the stamp');
  eq(concessionWeight(r1), 'walkover', '⭐ and weighs as a walkover');
  eq(concessionWeight(r2), 'early', '⭐ the turn-2 row weighs as early');
  eq(concessionWeight(r5), 'normal', '⭐ the turn-5 row weighs as normal');
  ok(r1.finished && r2.finished && r5.finished, 'all three are decided games in the record');
  rmSync(process.env['ALGO_ACCOUNTS_FILE'], { force: true });
} finally {
  await server.stop();
  for (const code of rooms) rmSync(gameFile(code), { force: true });
}

console.log(failures ? `\n${failures} FAILURES` : '\nall concede checks passed');
process.exit(failures ? 1 : 0);
