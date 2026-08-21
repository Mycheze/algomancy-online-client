/* Tests for the post-game screen and the rematch (run: node test-postgame.ts).
 *
 * Driving a real game all the way to lethal would take a few hundred scripted
 * actions and would break every time a card changed, so the finished game here
 * is a SAVED one with its result stamped — exactly the shape rooms.ts writes at
 * game over, and the same path a restored game takes. What is actually under
 * test is everything downstream of "this game is decided": the payload the
 * post-game screen is built from, and the rematch handshake.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-postgame-test-'));
const GAMES = join(SCRATCH, 'games');
mkdirSync(GAMES, { recursive: true });
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = GAMES;

const { resolveTrio } = await import('./trio.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── 1. "run it back" ──────────────────────────────────────────────────

console.log('\n[trio: run it back]');
{
  const again = resolveTrio({
    method: 'again', submissions: [{}, {}], names: ['Ben', 'Rashi'],
    history: [], previousTrio: ['dark', 'fire', 'water'], rng: 1,
  });
  eq(again.els.join('+'), 'fire+water+dark', 'the previous trio comes back, in canonical order');
  ok(again.detail.some(d => /another game/.test(d)), 'and says why');

  // offered only on a rematch: without one it must not hand back an empty trio
  const noPrev = resolveTrio({
    method: 'again', submissions: [{ element: 'metal' }, { element: 'light' }],
    names: ['Ben', 'Rashi'], history: [], rng: 1,
  });
  eq(noPrev.els.length, 3, 'with nothing to run back it falls through to a real method');
  ok(noPrev.els.includes('metal') && noPrev.els.includes('light'), 'and uses the submissions it has');
}

// ── 2. the live server ────────────────────────────────────────────────

const PORT = 9600 + Math.floor(Math.random() * 300);

/** A finished game, saved the way rooms.ts saves one: a real (short) log plus
 * the winner stamped at the time. */
const FINISHED = 'OVER';
writeFileSync(join(GAMES, `${FINISHED}.json`), JSON.stringify({
  seed: 20260821, mode: 'shared', els: ['fire', 'water', 'earth'],
  names: ['Ben', 'Rashi'], users: [null, null], winner: 0,
  actions: [
    ...Array.from({ length: 5 }, () => ({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' })),
    ...Array.from({ length: 5 }, () => ({ type: 'recycleForResource', seat: 1, handIndex: 0, element: 'water' })),
  ],
}));

const server = spawn(process.execPath, [join(HERE, 'main.ts')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((res, rej) => {
  server.stdout.on('data', (d: Buffer) => { if (String(d).includes('Algomancy server')) res(); });
  server.on('exit', () => rej(new Error('server died on startup')));
  setTimeout(() => rej(new Error('server startup timeout')), 15000);
});

interface Msg { t: string; [k: string]: any }
class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  constructor() { this.ws = new WebSocket(`ws://localhost:${PORT}`); }
  open(): Promise<void> {
    return new Promise(res => {
      this.ws.addEventListener('message', ev => this.msgs.push(JSON.parse(String((ev as MessageEvent).data))));
      this.ws.addEventListener('open', () => res(), { once: true });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(t: string): Msg | undefined { return [...this.msgs].reverse().find(m => m.t === t); }
  settle(ms = 500): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
}

try {
  console.log('\n[server: the post-game payload]');
  const a = new Client(); await a.open();
  a.send({ t: 'join', room: FINISHED, seat: 0, name: 'Ben' });
  await a.settle(800);

  const over = a.last('gameover');
  ok(!!over, 'joining a decided game gets the post-game payload, not just a dead board');
  eq(over?.['winner'], 0, 'it names the winner');
  eq(over?.['seat'], 0, 'and tells you which seat you are, so it knows who "you" is');
  eq(over?.['names']?.[1], 'Rashi', 'both names travel');
  eq(over?.['mode'], 'shared', 'so does the format');
  ok(Array.isArray(over?.['seats']) && over!['seats'].length === 2, 'both seats\' stats are there');
  ok(over!['seats'][0].recycled.fire === 5, 'and they are REAL numbers off the replay');
  ok(over!['seats'][1].recycled.water === 5, 'for both players');
  eq(over?.['recorded'], false, 'nobody was signed in, so it says it was not recorded');
  eq(JSON.stringify(over?.['rematch']), '[false,false]', 'nobody has asked for a rematch yet');

  console.log('\n[server: the rematch handshake]');
  a.send({ t: 'rematch', want: true });
  await a.settle();
  eq(JSON.stringify(a.last('rematch')?.['rematch']), '[true,false]', 'one side asking is recorded');
  eq(a.last('rematch')?.['room'], null, 'and does not create a room on its own');

  // taking it back
  a.send({ t: 'rematch', want: false });
  await a.settle();
  eq(JSON.stringify(a.last('rematch')?.['rematch']), '[false,false]', 'and can be taken back');

  const b = new Client(); await b.open();
  b.send({ t: 'join', room: FINISHED, seat: 1, name: 'Rashi' });
  await b.settle();
  ok(!!b.last('gameover'), 'the other seat gets the post-game screen too');
  eq(b.last('gameover')?.['seat'], 1, 'from their own point of view');

  a.send({ t: 'rematch', want: true });
  await a.settle(300);
  ok(b.last('rematch')?.['rematch']?.[0], 'the request reaches the other player');
  b.send({ t: 'rematch', want: true });
  await b.settle(700);

  const newRoom = a.last('rematch')?.['room'] as string | undefined;
  ok(!!newRoom, 'both agreeing creates the rematch room');
  eq(b.last('rematch')?.['room'], newRoom, 'and both are sent to the SAME one');
  ok(newRoom !== FINISHED, 'which is not the old room');

  const saved = JSON.parse(readFileSync(join(GAMES, `${newRoom}.json`), 'utf8')) as {
    mode: string; names: [string, string]; seed: number; actions: unknown[];
  };
  eq(saved.mode, 'shared', 'the rematch keeps the format');
  eq(saved.names.join('/'), 'Ben/Rashi', 'and the players, in their seats');
  ok(saved.seed !== 20260821, 'with a new seed — a rematch is a new game, not a rerun');
  eq(saved.actions.length, 0, 'and no moves in it yet');

  // a late clicker must follow, not start a second empty rematch
  const c = new Client(); await c.open();
  c.send({ t: 'join', room: FINISHED, seat: 0, name: 'Ben' });
  await c.settle();
  c.send({ t: 'rematch', want: true });
  await c.settle();
  eq(c.last('rematch')?.['room'], newRoom, 'a late click follows the rematch already agreed');

  console.log('\n[server: a game still in progress]');
  const live = (await (await fetch(`http://localhost:${PORT}/api/new`)).json() as { code: string }).code;
  const d = new Client(); await d.open();
  d.send({ t: 'join', room: live, seat: 0, mode: 'shared', name: 'Ben' });
  await d.settle();
  ok(!d.last('gameover'), 'an unfinished game gets no post-game screen');
  d.send({ t: 'rematch', want: true });
  await d.settle();
  ok(/not over/.test(d.last('error')?.['msg'] ?? ''), 'and refuses a rematch request');

  console.log('\n[server: a draft rematch lands in a lobby that offers "run it back"]');
  const draftCode = 'DRFT';
  writeFileSync(join(GAMES, `${draftCode}.json`), JSON.stringify({
    seed: 777, mode: 'draft', els: ['water', 'metal', 'dark'],
    names: ['Ben', 'Rashi'], users: [null, null], winner: 1,
    actions: [],
  }));
  // restart so the room is restored from that file
  server.kill();
  await new Promise(r => setTimeout(r, 400));
  const server2 = spawn(process.execPath, [join(HERE, 'main.ts')], {
    env: { ...process.env, PORT: String(PORT + 1) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((res, rej) => {
    server2.stdout.on('data', (dd: Buffer) => { if (String(dd).includes('Algomancy server')) res(); });
    setTimeout(() => rej(new Error('server2 startup timeout')), 15000);
  });
  try {
    const mk = (): WebSocket => new WebSocket(`ws://localhost:${PORT + 1}`);
    const msgs: [Msg[], Msg[]] = [[], []];
    const socks = [mk(), mk()];
    await Promise.all(socks.map((w, i) => new Promise<void>(res => {
      w.addEventListener('message', ev => msgs[i as 0 | 1].push(JSON.parse(String((ev as MessageEvent).data))));
      w.addEventListener('open', () => res(), { once: true });
    })));
    socks.forEach((w, i) => w.send(JSON.stringify({ t: 'join', room: draftCode, seat: i, name: i ? 'Rashi' : 'Ben' })));
    await new Promise(r => setTimeout(r, 700));
    ok(msgs[0].some(m => m.t === 'gameover'), 'a decided draft game shows the post-game screen');
    socks.forEach(w => w.send(JSON.stringify({ t: 'rematch', want: true })));
    await new Promise(r => setTimeout(r, 900));
    const next = [...msgs[0]].reverse().find(m => m.t === 'rematch')?.['room'] as string | undefined;
    ok(!!next, 'the draft rematch room was created');
    const nextSaved = JSON.parse(readFileSync(join(GAMES, `${next}.json`), 'utf8')) as { lobby: any };
    ok(!!nextSaved.lobby && !nextSaved.lobby.result, 'and it opens in a lobby — a new trio is a choice');
    eq(nextSaved.lobby.previousTrio?.join('+'), 'water+metal+dark', 'which knows what you just played');
    eq(nextSaved.lobby.method, 'again', 'and starts on "run it back", the likeliest answer');
    socks.forEach(w => w.close());
  } finally {
    server2.kill();
  }
  a.ws.close(); b.ws.close(); c.ws.close(); d.ws.close();
} finally {
  server.kill();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
