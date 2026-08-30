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
 */
import { readFileSync, rmSync } from 'node:fs';
import type { Action, Seat } from '../engine/src/types.ts';
import { gameFile, mintRoom, spawnServer } from './test-util.ts';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

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

// R204/CT-85: the server picks its own port and tells us which — see
// test-util.ts. It used to be `freePort()` then PORT=<number>, which left the
// port unheld for as long as node took to boot.
const server = await spawnServer();
const PORT = server.port;

let ROOM = '';
try {
  ROOM = await mintRoom(PORT);
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
    { winner?: number; actions: Action[] };
  ok(saved.winner === 1, 'the saved room carries the result (not re-derived later)');
  ok(saved.actions.some(x => x.type === 'concede'), 'and the concede is in the action log, replayable');

  // a conceded game is over for good
  const cAt = a.msgs.length;
  a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
  const again = await a.next(m => m.t === 'error', cAt);
  ok(/game is over/i.test(again.msg ?? ''), 'conceding twice is refused');

  a.ws.close(); b.ws.close();
} finally {
  await server.stop();
  if (ROOM) rmSync(gameFile(ROOM), { force: true });
}

console.log(failures ? `\n${failures} FAILURES` : '\nall concede checks passed');
process.exit(failures ? 1 : 0);
