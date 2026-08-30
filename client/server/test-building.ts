/* Integration test for the live formation relay (run: node test-building.ts).
 *
 * Playtest ask 2026-08-20: "when your opponent is declaring blocks/attacks,
 * it'd be cool to see their thought process and see where they're putting the
 * units, live, while declaring."
 *
 * The relay is deliberately NOT a game action: it never touches the engine,
 * never enters the action log, and is dropped the moment a real action lands.
 * That makes it cheap, but it also means the engine's own tests say nothing
 * about it — hence this. Spawns the real server on a random port and drives
 * two sockets, same harness style as test-clock.ts.
 */
import { WebSocket } from 'ws';
import { mintRoom, spawnServer } from './test-util.ts';
// minted from /api/new once the server is up: only a server-minted code may
// create a room (rooms.ts)
let ROOM = '';
let failures = 0;
const ok = (cond: unknown, what: string): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${what}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class Client {
  ws: WebSocket;
  msgs: Record<string, unknown>[] = [];
  seat = -1;
  constructor(port: number) { this.ws = new WebSocket(`ws://127.0.0.1:${port}`); }
  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
      this.ws.on('message', d => {
        const m = JSON.parse(String(d)) as Record<string, unknown>;
        this.msgs.push(m);
        if (m['t'] === 'joined') this.seat = m['seat'] as number;
      });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  /** the most recent message of a kind, or undefined */
  last(t: string): Record<string, unknown> | undefined {
    return [...this.msgs].reverse().find(m => m['t'] === t);
  }
  countOf(t: string): number { return this.msgs.filter(m => m['t'] === t).length; }
  close(): void { this.ws.close(); }
}

/* R204/CT-85: this file was the one the flake was reported against, and it had
 * TWO reasons to be. It took a port from the old freePort() — which released
 * the port before the child bound it — and then, instead of waiting for the
 * server to say it was listening, it slept 1200ms and started making requests.
 * Both are the same mistake: a number that is true on an idle box. Under four
 * concurrent suites the boot is slower and the port may already be gone, and
 * the symptom is the ECONNREFUSED in the report. spawnServer() waits for the
 * server's own ready line and reads the port out of it. */
const srv = await spawnServer();
const PORT = srv.port;

try {
  ROOM = await mintRoom(PORT);
  console.log(`[live formation relay on :${PORT}, room ${ROOM}]`);

  const a = new Client(PORT); await a.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Watcher', mode: 'draft', els: ['water', 'metal', 'dark'] });
  await sleep(300);
  const b = new Client(PORT); await b.open();
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Builder' });
  await sleep(500);
  ok(a.seat === 0 && b.seat === 1, `both seats joined (${a.seat} / ${b.seat})`);

  // ── the relay ───────────────────────────────────────────────────────
  b.send({ t: 'building', cols: [[11], [12, 13]], send: [] });
  await sleep(300);
  const got = a.last('building');
  ok(!!got, 'the watcher is told what the builder is placing');
  ok(got?.['seat'] === 1, 'tagged with whose formation it is');
  ok(JSON.stringify(got?.['cols']) === '[[11],[12,13]]', `the columns arrive intact (${JSON.stringify(got?.['cols'])})`);
  ok(b.countOf('building') === 0, 'the builder is not sent their own formation back');

  // ── it updates as they keep building ────────────────────────────────
  b.send({ t: 'building', cols: [[11], [12, 13], [14]], send: [15] });
  await sleep(300);
  const got2 = a.last('building');
  ok(JSON.stringify(got2?.['cols']) === '[[11],[12,13],[14]]', 'a later placement replaces the earlier one');
  ok(JSON.stringify(got2?.['send']) === '[15]', 'counterattackers being set aside come through too');

  // ── clearing ────────────────────────────────────────────────────────
  b.send({ t: 'building', cols: [], send: [] });
  await sleep(300);
  const cleared = a.last('building');
  ok(JSON.stringify(cleared?.['cols']) === '[]' && JSON.stringify(cleared?.['send']) === '[]',
    'taking everything back out clears the watcher too');

  // ── a reconnect picks up the formation in progress ──────────────────
  b.send({ t: 'building', cols: [[21, 22]], send: [] });
  await sleep(300);
  a.close();
  await sleep(300);
  const a2 = new Client(PORT); await a2.open();
  a2.send({ t: 'join', room: ROOM, seat: 0, name: 'Watcher' });
  await sleep(500);
  const rejoined = a2.last('joined');
  ok(JSON.stringify((rejoined?.['building'] as { cols: number[][] })?.cols) === '[[21,22]]',
    'rejoining mid-declaration shows what is already placed, without waiting for the next move');

  // ── a real action supersedes it ─────────────────────────────────────
  const view = rejoined?.['view'] as { players: { hand: string[] }[]; packs: string[][] };
  const hand = view.players[1]!.hand.length;
  b.send({ t: 'action', action: { type: 'draftCommit', seat: 1, packIndices: [] } });   // illegal on purpose
  await sleep(300);
  ok(!!b.last('error'), 'an illegal action is still refused (the relay changed nothing about that)');

  const a3n = a2.msgs.length;
  b.send({ t: 'building', cols: [[31]], send: [] });
  await sleep(200);
  // the builder commits their draft for real; the server must forget the draft formation
  const packLen = (rejoined?.['view'] as { packs: string[][] }).packs[1]?.length ?? 10;
  b.send({ t: 'action', action: { type: 'draftCommit', seat: 1, packIndices: Array.from({ length: packLen }, (_, i) => hand + i) } });
  await sleep(500);
  const a4 = new Client(PORT); await a4.open();
  a4.send({ t: 'join', room: ROOM, seat: 0, name: 'Watcher' });
  await sleep(500);
  ok(a4.last('joined')?.['building'] == null,
    'a committed action drops the in-progress formation — the real declaration supersedes it');
  void a3n;

  a2.close(); a4.close(); b.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
} finally {
  await srv.stop();
}
process.exit(failures ? 1 : 0);
