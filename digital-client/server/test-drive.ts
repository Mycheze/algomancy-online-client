/* Integration test-drive for the M2 server (run: node test-drive.ts).
 *
 * Starts the real server on an ephemeral port, connects two WebSocket clients
 * (seat 0 and seat 1), plays a scripted sequence, and asserts:
 *   - redaction: seat 0 NEVER sees the opponent's hand contents, the deck
 *     order, the opponent's dormant resource elements, or the seed — checked
 *     on EVERY view pushed for the whole session (a running invariant).
 *   - event redaction: a recycle shows the real card to the actor but "a card"
 *     to the opponent.
 *   - server authority: an action with the wrong seat is rejected.
 *   - reconnect: dropping and rejoining room+seat resyncs a full redacted view.
 *
 * Uses Node's built-in global WebSocket + fetch (Node 22). No test framework.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import type { Action, Seat } from '../engine/src/types.ts';
import { HIDDEN_CARD } from './view.ts';
import { freePort, gameFile, mintRoom } from './test-util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = await freePort();
// minted from /api/new once the server is up: only a server-minted code may
// create a room (rooms.ts)
let ROOM = '';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
}

/** A scripted WS client that records state and lets tests await messages. */
class Client {
  ws: WebSocket;
  seat: Seat;
  view: any = null;
  legal: Action[] = [];
  log: string[] = [];
  leaks: string[] = [];
  errors: string[] = [];
  oppSeat: Seat;
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];

  constructor(port: number, oppSeat: Seat, expectSeat: Seat) {
    this.oppSeat = oppSeat;
    this.seat = expectSeat;
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.addEventListener('message', ev => this.onMsg(JSON.parse(String((ev as MessageEvent).data))));
  }
  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise(res => this.ws.addEventListener('open', () => res(), { once: true }));
  }
  private onMsg(m: Msg): void {
    if (m.t === 'error') this.errors.push(m.msg ?? 'error');
    if (m.t === 'joined' || m.t === 'update') {
      if (m.view) { this.view = m.view; this.checkRedaction(m.view); }
      if (m.t === 'joined') { this.seat = m.seat!; this.log = m.log ? [...m.log] : []; }
      if (m.events) for (const e of m.events) this.log.push(e.msg);
      if (m.legal) this.legal = m.legal;
    }
    for (const w of this.waiters.splice(0).filter(w => { if (w.pred(m)) { w.resolve(m); return false; } return true; }))
      this.waiters.push(w);
  }
  private checkRedaction(view: any): void {
    const opp = view.players?.[this.oppSeat];
    if (opp && !opp.hand.every((n: string) => n === HIDDEN_CARD)) this.leaks.push('opponent hand contents');
    if (opp) for (const r of opp.resources) {
      if (r.state === 'dormant' && r.kind !== 'hidden') this.leaks.push(`opponent dormant resource kind (${r.kind})`);
    }
    if (!view.sharedDeck.every((n: string) => n === HIDDEN_CARD)) this.leaks.push('shared deck contents');
    if (view.seed !== 0 || view.rngState !== 0) this.leaks.push('seed/rngState');
    // R85: a 'resolve' suspension carries the engine's rollback snapshot — a
    // WHOLE unredacted GameState, both hands and the deck order included. It
    // is server-internal and must never appear in a view, not even the view of
    // the seat whose decision it is.
    if (view.suspension?.snapshot) this.leaks.push('suspension rollback snapshot (R85)');
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  waitFor(pred: (m: Msg) => boolean): Promise<Msg> {
    return new Promise(res => this.waiters.push({ pred, resolve: res }));
  }
  nextUpdate(): Promise<Msg> { return this.waitFor(m => m.t === 'update'); }
  close(): void { this.ws.close(); }
}

/** the "do nothing" action for whichever step we're in — advances the game. */
function passAction(legal: Action[]): Action | null {
  const noop = (a: Action): boolean =>
    a.type === 'donePlanning' || a.type === 'doneHaste' || a.type === 'doneDeploying' ||
    a.type === 'passPriority' ||
    (a.type === 'declareAttack' && a.columns.length === 0) ||
    (a.type === 'declareBlocks' && Object.keys(a.blocks).length === 0);
  return legal.find(noop) ?? null;
}

async function main(): Promise<void> {
  setTimeout(() => { console.error('TEST TIMEOUT (something hung)'); process.exit(3); }, 45000).unref();
  // ── boot the server on an ephemeral port ─────────────────────────────
  const srv = spawn(process.execPath, [join(HERE, 'main.ts')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  srv.stdout.on('data', () => {});
  await waitForServer(PORT);
  ROOM = await mintRoom(PORT);
  console.log(`server up on :${PORT}, room ${ROOM}`);

  try {
    // ── connect two clients ────────────────────────────────────────────
    const a = new Client(PORT, 1, 0);   // seat 0, opponent is seat 1
    const b = new Client(PORT, 0, 1);   // seat 1, opponent is seat 0
    await a.open(); a.send({ t: 'join', room: ROOM, seat: 0 });
    const aJoin = await a.waitFor(m => m.t === 'joined');
    await b.open(); b.send({ t: 'join', room: ROOM, seat: 1 });
    await b.waitFor(m => m.t === 'joined');

    console.log('\n[join redaction]');
    ok(aJoin.seat === 0, 'seat 0 assigned to client A');
    ok(a.view.players[0].hand.length > 0 && a.view.players[0].hand.every((n: string) => n !== HIDDEN_CARD),
      `A sees its OWN ${a.view.players[0].hand.length} hand cards face-up`);
    ok(a.view.players[1].hand.length > 0 && a.view.players[1].hand.every((n: string) => n === HIDDEN_CARD),
      `A sees opponent's ${a.view.players[1].hand.length} hand cards as backs (count only)`);
    ok(a.view.sharedDeck.every((n: string) => n === HIDDEN_CARD), 'A sees deck as count only');
    ok(a.view.players[0].resources.every((r: any) => r.kind !== 'hidden'),
      "A sees its OWN dormant resource elements");
    ok(a.view.players[1].resources.some((r: any) => r.state === 'dormant' && r.kind === 'hidden'),
      "A cannot see opponent's dormant resource elements");
    ok(a.view.seed === 0 && a.view.rngState === 0, 'seed / rngState stripped from A view');
    ok(Array.isArray(a.legal) && a.legal.length > 0, 'A received server-computed legalActions');

    // ── event redaction: a recycle names the card only to its owner ─────
    console.log('\n[event redaction: recycle]');
    const recycle = a.legal.find(x => x.type === 'recycleForResource') as Action | undefined;
    ok(!!recycle, 'A has a recycle action available');
    const aUpd = a.nextUpdate(), bUpd = b.nextUpdate();
    a.send({ t: 'action', action: recycle });
    await Promise.all([aUpd, bUpd]);
    const aLast = a.log[a.log.length - 1] ?? '';
    const bLast = b.log[b.log.length - 1] ?? '';
    ok(/recycles .+ for a dormant/.test(aLast) && !/recycles a card/.test(aLast),
      `actor sees the card name  ("${aLast}")`);
    // ...and while the resource step is still open the opponent is shown
    // NOTHING: the whole step is a hidden simultaneous segment now (rooms.ts
    // segmentKey), so the blurred line only arrives with the reveal below.
    ok(!b.log.some(l => /recycles/.test(l)),
      `opponent sees nothing at all mid-resource-step  (last: "${bLast}")`);

    // ── server authority: wrong-seat action is rejected ─────────────────
    console.log('\n[server authority]');
    b.errors.length = 0;
    const bErr = b.waitFor(m => m.t === 'error');
    b.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });   // b is seat 1
    await bErr;
    ok(b.errors.some(e => /seat/.test(e)), 'action with a foreign seat is rejected');

    // ── advance a full turn by both players passing everything ──────────
    console.log('\n[advance turn: both decline / pass]');
    let steps = 0;
    for (; steps < 40; steps++) {
      const actor = passAction(a.legal) ? a : passAction(b.legal) ? b : null;
      if (!actor) break;
      const act = passAction(actor.legal)!;
      const wait = Promise.all([a.nextUpdate(), b.nextUpdate()]);
      actor.send({ t: 'action', action: act });
      await wait;
    }
    ok(steps > 3, `game advanced through ${steps} pass-actions without a stall`);
    // both pressed done, so the resource step's reveal has been flushed —
    // blurred, exactly as it used to arrive live
    ok(b.log.some(l => /recycles a card for a dormant/.test(l)),
      'the reveal brings the opponent the recycle, blurred');
    ok(!b.log.some(l => /recycles [A-Z]/.test(l)), 'and never names the card');
    ok(a.leaks.length === 0, `A view stayed redacted all session (${a.leaks.length} leaks)`);
    ok(b.leaks.length === 0, `B view stayed redacted all session (${b.leaks.length} leaks)`);
    if (a.leaks.length) console.error('    A leaks:', [...new Set(a.leaks)]);

    // ── reconnect: drop seat 0 and rejoin, expect a full redacted resync ─
    console.log('\n[reconnect]');
    a.close();
    await new Promise(r => setTimeout(r, 100));
    const a2 = new Client(PORT, 1, 0);
    await a2.open(); a2.send({ t: 'join', room: ROOM, seat: 0 });
    const a2Join = await a2.waitFor(m => m.t === 'joined');
    ok(a2Join.seat === 0, 'reconnected into seat 0');
    ok(a2.log.length > 0, `resynced the full game log (${a2.log.length} lines)`);
    ok(a2.view.players[1].hand.every((n: string) => n === HIDDEN_CARD), 'resynced view is still redacted');
    ok(a2.view.turn >= a.view?.turn ?? 0, 'resynced state reflects prior progress');
    ok(a2.leaks.length === 0, 'reconnect view had no leaks');

    b.close(); a2.close();
  } finally {
    srv.kill('SIGTERM');
    try { rmSync(gameFile(ROOM)); } catch { /* ignore */ }
  }

  console.log(`\n${failures === 0 ? 'ALL PASS ✓' : `${failures} FAILURE(S) ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function waitForServer(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/index.html`);
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

main().catch(err => { console.error(err); process.exit(1); });
