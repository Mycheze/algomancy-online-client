/* Integration test for constructed rooms (run: node test-constructed.ts).
 *
 * Same harness as test-draft.ts: spawn the real server on an ephemeral port,
 * drive it with raw WebSockets. Covers:
 *   - /api/deck/defaults serves the bundled decks, playable and attributed
 *   - /api/deck/import parses a pasted list (and flags junk)
 *   - creating a constructed room needs a deck; the room then WAITS
 *   - the second deck starts the real game (both get a fresh 'joined')
 *   - per-seat decks: 8-card hands, hidden 22-card decks, bottoming open
 *   - bottomCards over the wire; planning gated until both put cards back
 *   - persistence: restart replays the constructed room (decks in the file)
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import type { Action, Seat } from '../engine/src/types.ts';
import { mintRoom } from './test-util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8500 + Math.floor(Math.random() * 400);
// minted from /api/new once the server is up: only a server-minted code may
// create a room (rooms.ts)
let ROOM = '';
const HIDDEN = '__HIDDEN__';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string; names?: string[];
  waiting?: { have: [boolean, boolean] };
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
  next(pred: (m: Msg) => boolean, timeoutMs = 5000, after = 0): Promise<Msg> {
    const past = this.msgs.slice(after).find(pred);
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

let { server, up } = startServer();
await up;
ROOM = await mintRoom(PORT);

try {
  console.log('\n[deck endpoints]');
  const defs = await (await fetch(`http://localhost:${PORT}/api/deck/defaults`)).json() as { decks: any[] };
  ok(defs.decks.length === 5, 'five bundled default decks');
  ok(defs.decks.every(d => d.author === 'aramsunat' && d.url?.includes('algomancer.cc')),
    'defaults attributed to their algomancer.cc builder');
  ok(defs.decks.every(d => d.cards.length === 30 && d.problems.length === 0),
    'defaults are 30 cards and playable');

  const pasted = await (await fetch(`http://localhost:${PORT}/api/deck/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: defs.decks[0].cards.map((c: string) => `1 ${c}`).join('\n') }),
  })).json() as { ok: boolean; deck: any };
  ok(pasted.ok && pasted.deck.cards.length === 30 && pasted.deck.problems.length === 0,
    'pasted list round-trips through /api/deck/import');
  const junk = await (await fetch(`http://localhost:${PORT}/api/deck/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '2 Not A Real Card' }),
  })).json() as { ok: boolean; deck: any };
  ok(junk.ok && junk.deck.problems.length > 0, 'junk paste reports problems');

  const deckA = defs.decks[0].cards as string[];
  const deckB = defs.decks[1].cards as string[];

  console.log('\n[constructed room: waiting for decks]');
  const noDeck = new Client(PORT);
  await noDeck.open();
  noDeck.send({ t: 'join', room: ROOM, seat: 0, mode: 'constructed' });
  const refuse = await noDeck.next(m => m.t === 'error');
  ok(/needs a deck/.test(refuse.msg ?? ''), 'creating a constructed room without a deck is refused');
  noDeck.ws.close();

  const c0 = new Client(PORT);
  await c0.open();
  c0.send({ t: 'join', room: ROOM, seat: 0, mode: 'constructed', name: 'Bena', deck: deckA });
  const j0 = await c0.next(m => m.t === 'joined');
  ok(!!j0.waiting && j0.waiting.have[0] === true && j0.waiting.have[1] === false,
    'creator joins into a waiting room (their deck registered)');
  ok(!j0.view, 'no game view while waiting');
  c0.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });
  const gated = await c0.next(m => m.t === 'error');
  ok(/not started/.test(gated.msg ?? ''), 'actions are gated while waiting');

  console.log('\n[second deck starts the game]');
  const c1 = new Client(PORT);
  await c1.open();
  c1.send({ t: 'join', room: ROOM, seat: 1, name: 'Guest', deck: deckB });
  const j1 = await c1.next(m => m.t === 'joined' && !!m.view);
  const s0 = await c0.next(m => m.t === 'joined' && !!m.view);
  ok(j1.view.mode === 'constructed' && s0.view.mode === 'constructed', 'both seats got the real game');
  ok(c0.view.players[0].hand.length === 8 && c0.view.players[0].hand.every((c: string) => c !== HIDDEN),
    'own 8-card hand visible (opening 4 + draw 4)');
  ok(c0.view.players[1].hand.every((c: string) => c === HIDDEN), 'opponent hand hidden');
  ok(c0.view.decks.length === 2 && c0.view.decks.every((d: string[]) => d.length === 22 && d.every(c => c === HIDDEN)),
    'both decks are 22 hidden cards (30 - 8)');
  ok(JSON.stringify(c0.view.bottomDone) === '[false,false]', 'the draw phase bottoming is open');
  ok(c0.legal.length > 0 && c0.legal.every(a => a.type === 'bottomCards'),
    'only bottomCards is legal while pending');

  console.log('\n[bottomCards over the wire]');
  c0.send({ t: 'action', action: { type: 'bottomCards', seat: 0, handIndices: [0, 1] } });
  await c0.next(m => m.t === 'update' && m.view?.bottomDone?.[0] === true);
  ok(c0.view.players[0].hand.length === 6 && c0.view.decks[0].length === 24,
    'seat 0 put 2 back: hand 6, deck 24');
  c1.send({ t: 'action', action: { type: 'bottomCards', seat: 1, handIndices: [4, 5] } });
  await c1.next(m => m.t === 'update' && m.view?.bottomDone === null);
  ok(c1.view.bottomDone === null, 'both done — planning proper opens');
  ok(c1.legal.some(a => a.type === 'donePlanning'), 'donePlanning now legal');

  console.log('\n[persistence: restart replays the constructed room]');
  const raw = JSON.parse(readFileSync(join(HERE, 'games', `${ROOM}.json`), 'utf8'));
  ok(raw.mode === 'constructed' && Array.isArray(raw.decks?.[0]) && Array.isArray(raw.decks?.[1]),
    'room file records mode + both decks');
  ok(raw.actions.some((a: Action) => a.type === 'bottomCards'), 'room file holds the bottoming actions');
  server.kill();
  await new Promise(res => server.on('exit', res));
  ({ server, up } = startServer());
  await up;
  const c2 = new Client(PORT);
  await c2.open();
  c2.send({ t: 'join', room: ROOM, seat: 0 });
  await c2.next(m => m.t === 'joined' && !!m.view);
  ok(c2.view.mode === 'constructed' && c2.view.bottomDone === null
    && c2.view.players[0].hand.length === 6 && c2.view.decks[0].length === 24,
    `restart restored the constructed room (hand=${c2.view.players[0].hand.length} deck=${c2.view.decks?.[0]?.length})`);

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
} finally {
  server.kill();
  rmSync(join(HERE, 'games', `${ROOM}.json`), { force: true });
}
process.exit(failures ? 1 : 0);
