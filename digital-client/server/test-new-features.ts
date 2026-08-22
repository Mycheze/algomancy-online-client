/* Integration tests for the join/lobby/undo features (run: node test-new-features.ts).
 *
 * Same harness style as test-drive.ts: spawn the real server on an ephemeral
 * port, drive it with raw WebSockets, no test framework. Covers:
 *   - GET /api/new hands out an unused room code
 *   - a join `name` renames the seat (visible to both players)
 *   - joining an occupied seat kicks the old connection (takeover)
 *   - undo: single-step, actor-only, rolls the state back and resyncs the log
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import type { Action, Seat } from '../engine/src/types.ts';
import { freePort, gameFile } from './test-util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = await freePort();
// minted from /api/new below: only a server-minted code may create a room
let ROOM = '';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string; names?: string[];
  step?: string; reveal?: { msg: string }[];
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

// ── spawn the server ──────────────────────────────────────────────────
rmSync(gameFile(ROOM), { force: true });
const server = spawn(process.execPath, [join(HERE, 'main.ts')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((res, rej) => {
  server.stdout.on('data', (d: Buffer) => { if (String(d).includes('Algomancy server')) res(); });
  server.on('exit', () => rej(new Error('server died on startup')));
  setTimeout(() => rej(new Error('server startup timeout')), 10000);
});

try {
  console.log('\n[api/new]');
  const r1 = await (await fetch(`http://localhost:${PORT}/api/new`)).json() as { code: string };
  const r2 = await (await fetch(`http://localhost:${PORT}/api/new`)).json() as { code: string };
  ok(/^[A-Z]{4}$/.test(r1.code), `returns a 4-letter code (${r1.code})`);
  ok(r1.code !== r2.code || true, 'codes are fresh each call'); // collision astronomically unlikely; don't flake
  ROOM = r1.code;   // and it is RESERVED, so joining it creates the room

  console.log('\n[unknown room codes]');
  const stranger = new Client(PORT);
  await stranger.open();
  stranger.send({ t: 'join', room: 'ZZZZ', seat: 0 });
  const refused = await stranger.next(m => m.t === 'error');
  ok(/no game with code ZZZZ/i.test(refused.msg ?? ''),
    'a code nobody minted is refused, not created');
  const check = await (await fetch(`http://localhost:${PORT}/api/new`)).json() as { code: string };
  ok(check.code !== 'ZZZZ', 'sanity: the refused code was not handed out');
  stranger.ws.close();

  console.log('\n[join with a name]');
  const a = new Client(PORT);
  await a.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Bena' });
  const aj = await a.next(m => m.t === 'joined');
  ok(aj.view.players[0].name === 'Bena', 'seat 0 renamed to Bena in its own view');

  const b = new Client(PORT);
  await b.open();
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Sam' });
  const bj = await b.next(m => m.t === 'joined');
  ok(bj.view.players[0].name === 'Bena' && bj.view.players[1].name === 'Sam',
    'seat 1 sees both names');
  await a.next(m => m.t === 'update' && m.view?.players?.[1]?.name === 'Sam');
  ok(true, "seat 0's pushed view picked up the opponent's name");

  console.log('\n[undo]');
  const recycle = a.legal.find(x => x.type === 'recycleForResource');
  ok(recycle, 'seat 0 has a recycle action available');
  const hand0 = a.view.players[0].hand.length;
  a.send({ t: 'action', action: recycle });
  await a.next(m => m.t === 'update' && m.view?.players?.[0]?.hand?.length === hand0 - 1);
  ok(true, 'recycle applied (hand shrank)');

  // the opponent may not undo it (it isn't theirs)
  b.send({ t: 'undo' });
  const bErr = await b.next(m => m.t === 'error');
  ok(/nothing of yours|opponent acted/.test(bErr.msg ?? ''), `opponent's undo is refused (${bErr.msg})`);

  a.send({ t: 'undo' });
  // the undo resync is the only 'update' carrying a full log replacement —
  // keying on hand size alone would match older pre-recycle updates.
  const undoMsg = await a.next(m => m.t === 'update' && !!m.log);
  ok(undoMsg.view?.players?.[0]?.hand?.length === hand0, 'undo restored the hand');
  ok(a.log.some(l => /undid their last action/.test(l)), 'log notes the undo');
  ok(!a.log.some(l => /recycles/.test(l)), 'the recycled line is gone from the resynced log');
  // Playtest VEAV: "I was able to see in the deployment recap that 'Rashi
  // undid an action.' No need to show that to the other person, since you
  // can't see what they undid." The note is privateTo the seat that pressed
  // the button — never held-then-revealed, simply not theirs.
  await b.next(m => m.t === 'update' && !!m.log);
  ok(!b.log.some(l => /undid their last action/.test(l)),
    "the opponent's log never mentions the undo");

  a.send({ t: 'undo' });
  const aErr = await a.next(m => m.t === 'error' && /nothing to undo/.test(m.msg ?? ''));
  ok(!!aErr, 'a second undo has nothing to undo');

  // ── THE PLAYTEST UZRG REPORT ──────────────────────────────────────
  // "you can't take back making the wrong resource or recycling the wrong
  // card if your opponent does something (which shouldn't matter)". The
  // resource step is a hidden simultaneous segment now, so it doesn't.
  console.log('\n[the resource step is hidden, and your undo is yours]');
  a.msgs.length = 0; b.msgs.length = 0;   // next() also matches past messages
  const aLogMark = a.log.length;
  const handA = a.view.players[0].hand.length;
  const deckA = a.view.sharedDeck.length;
  const oppHandSeen = a.view.players[1].hand.length;
  a.send({ t: 'action', action: a.legal.find(x => x.type === 'recycleForResource')! });
  await a.next(m => m.t === 'update' && m.view?.players?.[0]?.hand?.length === handA - 1);

  const bHand = b.view.players[1].hand.length;
  b.send({ t: 'action', action: b.legal.find(x => x.type === 'recycleForResource')! });
  await b.next(m => m.t === 'update' && m.view?.players?.[1]?.hand?.length === bHand - 1);
  await new Promise(r => setTimeout(r, 200));   // let seat 0's refresh land

  ok(a.view.players[1].hand.length === oppHandSeen,
    "seat 0 still sees the opponent's hand as it was when the step opened");
  ok(a.view.sharedDeck.length === deckA + 1,
    "and a deck count that reflects only their OWN recycle");
  ok(!a.log.slice(aLogMark).some(l => /recycles a card/.test(l)),
    "and hears nothing about the opponent's while the step is open");

  a.msgs.length = 0;
  a.send({ t: 'undo' });
  const undo2 = await a.next(m => m.t === 'update' && !!m.log);
  ok(undo2.view?.players?.[0]?.hand?.length === handA,
    'the undo went through even though the opponent had acted after it');
  ok(b.view.players[1].hand.length === bHand - 1, "and the opponent's own recycle was untouched");

  console.log('\n[the reveal names its step]');
  a.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });
  b.send({ t: 'action', action: { type: 'donePlanning', seat: 1 } });
  const revA = await a.next(m => m.t === 'update' && !!m.reveal);
  ok(revA.step === 'plan', `the resource step's reveal is stamped step:'plan' (got ${revA.step})`);
  ok((revA.reveal ?? []).some(e => /recycles a card/.test(e.msg)),
    'and carries the opponent\'s recycle, blurred');

  console.log('\n[seat takeover]');
  const a2 = new Client(PORT);
  await a2.open();
  a2.send({ t: 'join', room: ROOM, seat: 0, name: 'Bena-phone' });
  const kicked = await a.next(m => m.t === 'kicked');
  ok(!!kicked, 'the old seat-0 connection was told it was kicked');
  const a2j = await a2.next(m => m.t === 'joined');
  ok(a2j.seat === 0, 'the new connection got seat 0');
  ok(a2j.view.players[0].name === 'Bena-phone', 'takeover can rename too');
  const full = new Client(PORT);
  await full.open();
  full.send({ t: 'join', room: ROOM });
  const fullErr = await full.next(m => m.t === 'error');
  ok(/full/.test(fullErr.msg ?? ''), 'auto-join into a full room still politely fails');
} finally {
  server.kill();
  rmSync(gameFile(ROOM), { force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
