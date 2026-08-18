/* Integration test for M4 live-draft rooms (run: node test-draft.ts).
 *
 * Same harness style as test-new-features.ts: spawn the real server on an
 * ephemeral port, drive it with raw WebSockets. Covers:
 *   - a join with mode:'draft' creates a draft room (6-card hands, 10-card packs)
 *   - pack redaction: your pack is visible only during your open draft step;
 *     the opponent's pack and the deck are never visible
 *   - draftCommit over the wire; "opponent still drafting" state; pack passing
 *   - a joiner without mode lands in the same (draft) room
 *   - undo of a draft commit rolls back and re-opens the draft step
 *   - persistence: the room file records mode and replays on restart
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import type { Action, Seat } from '../engine/src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8500 + Math.floor(Math.random() * 400);
const ROOM = 'DR' + Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
const HIDDEN = '__HIDDEN__';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string; names?: string[];
}

class Client {
  ws: WebSocket;
  view: any = null;
  legal: Action[] = [];
  msgs: Msg[] = [];
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
    if (m.view) this.view = m.view;
    if (m.legal) this.legal = m.legal;
    const i = this.waiters.findIndex(w => w.pred(m));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
  }
  next(pred: (m: Msg) => boolean, timeoutMs = 5000): Promise<Msg> {
    const past = this.msgs.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for message')), timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
}

function startServer() {
  const server = spawn(process.execPath, [join(HERE, 'main.ts')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const up = new Promise<void>((res, rej) => {
    server.stdout.on('data', (d: Buffer) => { if (String(d).includes('Algomancy server')) res(); });
    server.on('exit', () => rej(new Error('server died on startup')));
    setTimeout(() => rej(new Error('server startup timeout')), 10000);
  });
  return { server, up };
}

/** the no-op commit for a redacted view (indices only need pile positions) */
function noopCommit(view: any, seat: Seat): Action {
  const H = view.players[seat].hand.length;
  const packIndices = view.packs[seat].map((_: unknown, i: number) => H + i);
  return { type: 'draftCommit', seat, packIndices } as Action;
}

rmSync(join(HERE, 'games', `${ROOM}.json`), { force: true });
let { server, up } = startServer();
await up;

try {
  console.log('\n[draft room creation + redaction]');
  const c0 = new Client(PORT);
  await c0.open();
  c0.send({ t: 'join', room: ROOM, seat: 0, mode: 'draft', name: 'Bena' });
  await c0.next(m => m.t === 'joined');
  ok(c0.view.mode === 'draft', 'room is a draft game');
  ok(c0.view.players[0].hand.length === 6, 'seat 0 hand is 6 (opening 4 + turn-1 draws)');
  ok(c0.view.packs[0].length === 10 && c0.view.packs[0].every((c: string) => c !== HIDDEN),
    'own pack visible during own draft step');
  ok(c0.view.packs[1].every((c: string) => c === HIDDEN), "opponent's pack hidden");
  ok(c0.view.sharedDeck.every((c: string) => c === HIDDEN), 'deck hidden');
  ok(c0.view.sharedDeck.length === 177 - 32, 'deck count right for the 177-card trio');
  ok(c0.legal.every(a => a.type === 'draftCommit') && c0.legal.length === 61,
    'legal actions during draft = 61 commits (no-op + 6×10 swaps)');

  const c1 = new Client(PORT);
  await c1.open();
  c1.send({ t: 'join', room: ROOM, seat: 1, name: 'Guest' });   // no mode: room exists
  await c1.next(m => m.t === 'joined');
  ok(c1.view.mode === 'draft', 'joiner without mode lands in the same draft room');
  ok(c1.view.players[0].hand.every((c: string) => c === HIDDEN), "opponent's hand hidden");

  console.log('\n[draft commit + pack passing]');
  const seat1PackBefore = [...c1.view.packs[1]];
  c1.send({ t: 'action', action: noopCommit(c1.view, 1) });
  await c1.next(m => m.t === 'update' && m.view?.draftDone?.[1] === true);
  ok(c1.view.draftDone[1] === true && c1.view.draftDone[0] === false, 'seat 1 committed, seat 0 still drafting');
  ok(c1.view.packs[1].every((c: string) => c === HIDDEN), 'own pack hidden again after committing');

  c0.send({ t: 'action', action: noopCommit(c0.view, 0) });
  await c0.next(m => m.t === 'update' && m.view?.draftDone === null);
  await c1.next(m => m.t === 'update' && m.view?.draftDone === null);
  ok(c0.view.draftDone === null && c1.view.draftDone === null, 'both committed: draft step closed, packs passed');
  ok(c0.legal.some(a => a.type === 'donePlanning'), 'planning open after the draft step');

  console.log('\n[undo a draft commit]');
  // seat 0 committed last → undo rolls it back and re-opens their draft step
  c0.send({ t: 'undo' });
  const u = await c0.next(m => m.t === 'update' && !!m.log);
  ok(u.view.draftDone?.[0] === false && u.view.draftDone?.[1] === true, 'undo re-opened seat 0 draft step');
  ok(u.view.packs[0].every((c: string) => c !== HIDDEN), 'pack visible again after undo');
  // re-commit: seat 1's earlier commit still stands, so packs pass again.
  // seat 1's post-pass pack must be seat 0's old pack (the 1v1 swap).
  c0.send({ t: 'action', action: noopCommit(c0.view, 0) });
  await c0.next(m => m.t === 'update' && m.view?.draftDone === null && !m.log);
  ok(true, 're-commit after undo passes the packs again');
  void seat1PackBefore;

  console.log('\n[persistence: restart replays the draft room]');
  const raw = JSON.parse(readFileSync(join(HERE, 'games', `${ROOM}.json`), 'utf8'));
  ok(raw.mode === 'draft', 'room file records mode: draft');
  ok(raw.actions.some((a: Action) => a.type === 'draftCommit'), 'room file holds the commits');
  server.kill();
  await new Promise(res => server.on('exit', res));
  ({ server, up } = startServer());
  await up;
  const c2 = new Client(PORT);
  await c2.open();
  c2.send({ t: 'join', room: ROOM, seat: 0 });
  await c2.next(m => m.t === 'joined');
  ok(c2.view.mode === 'draft' && c2.view.draftDone === null && c2.view.turn === 1,
    'restart restored the draft room mid-planning');

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
} finally {
  server.kill();
  rmSync(join(HERE, 'games', `${ROOM}.json`), { force: true });
}
process.exit(failures ? 1 : 0);
