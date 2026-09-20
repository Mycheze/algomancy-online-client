/* BL-06 — TEST MODE, END TO END (run: node test-sandbox.ts).
 *
 * The engine's half of this feature is `engine/test/274-sandbox.test.ts`. This
 * is the half that needs a real server, real WebSockets and a real saved room
 * file, and there are six things that can only be proved here:
 *
 *   §1 THE ROUTE IS OPEN. Deliberately the OPPOSITE of test-scenario.ts §1.
 *      The scenario tester 404s without ALGO_TESTER_TOKEN because it deals you
 *      a board of your choosing inside the tester; test mode deals you a board
 *      of your choosing inside a room that can never touch anybody's record,
 *      and the owner was asked directly (2026-08-25) whether it should be
 *      gated: *"Yes, for anyone."* So the absence of a gate is a REQUIREMENT
 *      here, and it is asserted rather than assumed.
 *
 *   §2 THE SANDBOX REACHES THE BROWSER. The seat's REDACTED VIEW — the channel
 *      the client actually renders from — carries `sandbox`, 1000 life and an
 *      empty hand. That matters twice: it is what makes the panel appear, and
 *      it is the reason no client-side flag can make the panel appear over a
 *      real game.
 *
 *   §3 ⚠ THE WIRE-LEVEL NEGATIVE CONTROL. The same cheat, sent into an
 *      ORDINARY room over the same socket, comes back refused. This is the
 *      security assertion of the feature at the layer an attacker would
 *      actually use, and it is the one test here that would matter on a public
 *      deploy.
 *
 *   §4 ⭐ A SANDBOX GAME REPLAYS. Play one, KILL the server, restore from the
 *      file, and compare the pushed views byte for byte — plus `replay-room.ts`
 *      run over the saved file with no divergence. The whole reason the cheats
 *      are actions rather than state mutation is that the first thing anybody
 *      will do with test mode is reproduce a bug and hand somebody the room
 *      code. If this fails, the design is wrong.
 *
 *   §5 NOTHING REACHES THE RECORD. Excluded at the SOURCE — `history.ts`'s
 *      `syncGamesDir` skips it and `main.ts`'s `recordFinishedGame` returns
 *      early — rather than filtered afterwards, so no second reader can pick
 *      it up by mistake. Asserted through the real fold, over the real file.
 *
 *   §6 THE SECOND SEAT IS A REAL SEAT. Somebody opens it in another tab and
 *      stocks it exactly the same way, and seat 0 sees what they built.
 *
 * Style follows test-scenario.ts: spawn the real server, drive it with raw
 * WebSockets, no test framework, print ✓/✗ and exit non-zero on any failure.
 */
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Action, Seat } from '../../engine/src/types.ts';
import { gameFile, mintRoom, spawnServer, type ServerHandle } from './test-util.ts';
import { SANDBOX_ID } from '../scenarios.ts';
import { analyze, type RoomFile } from '../replay-room.ts';
import { MIN_GAME_ACTIONS, summarizeGame } from '../stats.ts';

/* Same reasoning as test-scenario.ts's scratch files: var/games/ and
 * var/accounts/ are live data on the deploy box and `npm test` has to be safe
 * to run there. Set BEFORE the server is spawned — spawnServer passes
 * process.env through, so the child and the assertions read the same paths. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-sandbox-'));
process.env['ALGO_GAMES_DIR'] = process.env['ALGO_GAMES_DIR'] ?? join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = process.env['ALGO_ACCOUNTS_FILE'] ?? join(SCRATCH, 'accounts.json');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
function eq(a: unknown, b: unknown, label: string): void {
  if (JSON.stringify(a) === JSON.stringify(b)) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}\n      got:      ${JSON.stringify(a)}\n      expected: ${JSON.stringify(b)}`); failures++; }
}

const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

interface Msg { t: string; seat?: Seat; view?: any; legal?: Action[]; msg?: string; scenario?: any }

class Client {
  ws: WebSocket;
  view: any = null;
  legal: Action[] = [];
  scenario: any = null;
  msgs: Msg[] = [];
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
    if (m.scenario) this.scenario = m.scenario;
    const i = this.waiters.findIndex(w => w.pred(m));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
  }
  next(pred: (m: Msg) => boolean, timeoutMs = 8000): Promise<Msg> {
    const past = this.msgs.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for message')), timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  /** resolve once nothing has arrived for `quietMs` — the same "wait for the
   * wire to go quiet rather than sleep a magic number" as test-scenario.ts */
  async quiet(quietMs = 150, maxMs = 4000): Promise<void> {
    const deadline = Date.now() + maxMs;
    for (;;) {
      const since = Date.now() - this.lastAt;
      if (since >= quietMs || Date.now() >= deadline) return;
      await sleep(Math.min(quietMs - since, 40));
    }
  }
  async act(a: Action): Promise<void> {
    this.lastAt = Date.now();
    this.send({ t: 'action', action: a });
    await this.quiet();
  }
  async join(room: string, seat: Seat, name: string): Promise<void> {
    await this.open();
    this.send({ t: 'join', room, seat, name });
    await this.next(m => m.t === 'joined');
    await this.quiet();
  }
}

/** the units a seat's own REDACTED VIEW shows — the "is it really on screen"
 * channel, not a peek at the room's internals */
const unitsInView = (view: any, seat: Seat): string[] =>
  Object.values(view.entities ?? {})
    .filter((e: any) => e.kind === 'unit' && e.controller === seat && !e.absent)
    .map((e: any) => e.card)
    .sort();

async function main(): Promise<void> {
  let server: ServerHandle = await spawnServer();
  const base = (): string => `http://localhost:${server.port}`;

  // ── §1 the route is open ─────────────────────────────────────────────
  console.log('\n§1 test mode is open to everyone — no token, no flag, no badge');
  const open = await fetch(`${base()}/api/sandbox/open?json=1`);
  ok(open.status === 200, `/api/sandbox/open with no credentials of any kind → 200 (got ${open.status})`);
  const body = await open.json() as { ok: boolean; code: string; join: string };
  ok(body.ok === true, 'a sandbox room was dealt');
  const ROOM = body.code;
  ok(/^[A-Z0-9]{4,6}$/.test(ROOM), `room code looks like a room code (${ROOM})`);
  ok(body.join.includes(`room=${ROOM}`), 'and it hands back a link that lands on the board');
  // the scenario tester is still gated — test mode being open must not have
  // opened that (it deals a NAMED board and files verdicts against the queue)
  const scen = await fetch(`${base()}/api/scenario/list`);
  ok(scen.status === 404, `…and the scenario tester is still 404 without its token (got ${scen.status})`);

  // ── §2 the sandbox on the wire ───────────────────────────────────────
  console.log('\n§2 the board the browser is actually served');
  const you = new Client(server.port);
  await you.join(ROOM, 0, 'Tester');
  ok(you.view?.sandbox === true,
    'the seat\'s REDACTED VIEW says sandbox — which is what makes the panel appear, and why '
    + 'no client-side flag can make it appear over a real game');
  eq([you.view.players[0].life, you.view.players[1].life], [1000, 1000],
    'both seats are on 1000 life');
  eq(you.view.players[0].hand.length, 0, 'and your hand is empty — you summon what you want');
  ok(!you.scenario,
    'and NO verdict bar: a sandbox is not a scenario, so scenarioBrief() gives it no brief');

  console.log('\n   the four cheats, over the socket');
  await you.act({ type: 'sandboxSpawn', seat: 0, card: 'Towering Colossus', to: 'play' });
  eq(unitsInView(you.view, 0), ['Towering Colossus'], 'a card from the registry is on the board');
  await you.act({ type: 'sandboxSpawn', seat: 0, card: 'Luminous Arc', to: 'hand' });
  eq(you.view.players[0].hand, ['Luminous Arc'], 'another is in hand');
  await you.act({ type: 'sandboxSpawn', seat: 0, card: 'Lithoghul', to: 'bin' });
  eq(you.view.players[0].bin, ['Lithoghul'], 'and another in the bin');
  await you.act({ type: 'sandboxResources', seat: 0, pool: { fire: 3, light: 2 } });
  eq(you.view.players[0].resources.map((r: any) => `${r.kind}:${r.state}`),
    ['fire:open', 'fire:open', 'fire:open', 'light:open', 'light:open'],
    'the mana pool is exactly what was asked for, in canonical order');
  await you.act({ type: 'sandboxLife', seat: 0, life: 42 });
  eq(you.view.players[0].life, 42, 'and life is whatever you say');
  const phaseBefore = you.view.phase;
  await you.act({ type: 'sandboxAdvance', seat: 0 });
  ok(you.view.phase !== phaseBefore,
    `the phase advanced with nobody in the second seat (${phaseBefore} → ${you.view.phase})`);

  /* …and then some more, deliberately: §5 below has to prove that the DEAL ID
   * is what keeps this room out of the history, and `history.ts` skips a short
   * log for an entirely different reason (`MIN_GAME_ACTIONS`). A room under
   * that bar would pass §5 whatever the scenario guard did — a green test
   * about nothing, which is the docs/13 §5 shape this repo has paid for four
   * times. So the log is walked past the bar first. */
  for (const card of ['Ignis Sprite', 'Swirling Shardform', 'Lithoghul', 'Luminous Arc', 'The Foretold']) {
    await you.act({ type: 'sandboxSpawn', seat: 0, card, to: 'hand' });
  }
  ok(you.view.players[0].hand.length >= 5, 'five more cards summoned, to walk the log past MIN_GAME_ACTIONS');

  // ── §3 the wire-level negative control ───────────────────────────────
  console.log('\n§3 ⚠ the same cheat in an ORDINARY room is refused');
  {
    const plainCode = await mintRoom(server.port);
    const cheat = new Client(server.port);
    await cheat.join(plainCode, 0, 'Cheat');
    ok(cheat.view && cheat.view.sandbox === undefined,
      'an ordinary room\'s view carries no sandbox flag');
    const before = JSON.stringify(cheat.view);
    cheat.lastAt = Date.now();
    cheat.send({ t: 'action', action: { type: 'sandboxSpawn', seat: 0, card: 'Towering Colossus', to: 'play' } });
    const err = await cheat.next(m => m.t === 'error');
    ok(/only legal in a sandbox room/.test(err.msg ?? ''),
      `the server refused it, by name: "${err.msg}"`);
    await cheat.quiet();
    eq(JSON.stringify(cheat.view) === before, true,
      'and the board is untouched — the draft was discarded whole');
    // …and the OTHER three, so the gate is not one action deep
    for (const a of [
      { type: 'sandboxResources', seat: 0, pool: { fire: 9 } },
      { type: 'sandboxLife', seat: 0, life: 999 },
      { type: 'sandboxAdvance', seat: 0 },
    ] as Action[]) {
      cheat.lastAt = Date.now();
      cheat.msgs.length = 0;
      cheat.send({ t: 'action', action: a });
      const e2 = await cheat.next(m => m.t === 'error');
      ok(/only legal in a sandbox room/.test(e2.msg ?? ''), `   ${a.type} refused too`);
    }
    cheat.ws.close();
  }

  // ── §4 ⭐ it replays ─────────────────────────────────────────────────
  console.log('\n§4 ⭐ a sandbox game rebuilds and replays byte-identically');
  const played = JSON.stringify(you.view);
  const file = gameFile(ROOM);
  ok(existsSync(file), 'the room was persisted');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as RoomFile & { scenario?: string };
  eq(saved.scenario, SANDBOX_ID, 'the deal id is in the file, BESIDE the seed');
  ok(saved.actions.length >= 6, `and every cheat is IN the log (${saved.actions.length} actions)`);
  ok(saved.actions.some(a => a.type === 'sandboxSpawn'),
    'including the spawns — the cheats are actions, not out-of-band mutation');
  ok(!JSON.stringify(saved).includes('"entities"'),
    'and NO hand-built GameState was written — the file is still a seed and a log');

  you.ws.close();
  await server.stop();
  server = await spawnServer();
  const again = new Client(server.port);
  await again.join(ROOM, 0, 'Tester');
  const restored = JSON.stringify(again.view);
  if (restored === played) console.log('  ✓ the restored view is BYTE-IDENTICAL to the played one');
  else {
    failures++;
    console.error('  ✗ the restored view differs from the played one');
    for (let i = 0; i < Math.max(played.length, restored.length); i++) {
      if (played[i] !== restored[i]) {
        console.error(`      first difference at char ${i}:`);
        console.error(`      played:   …${played.slice(Math.max(0, i - 60), i + 60)}`);
        console.error(`      restored: …${restored.slice(Math.max(0, i - 60), i + 60)}`);
        break;
      }
    }
  }
  const forked = JSON.parse(readFileSync(file, 'utf8')) as RoomFile;
  ok(!forked.forks || forked.forks.length === 0,
    'the restore recorded no fork — nothing in the log was refused or changed meaning');

  console.log('\n   …and the forensic replay agrees (replay-room.ts, the SECOND deal site)');
  {
    const an = analyze(JSON.parse(readFileSync(file, 'utf8')) as RoomFile);
    eq(an.refusals.length, 0, 'runOnce() replayed every logged action, cheats included');
    ok(an.divergedAt === null, 'and found no divergence');
    ok(an.state.sandbox === true,
      'the replayed state is still a sandbox — the flag comes back from the DEAL at every one '
      + 'of the four deal sites, which is the whole reason it lives there and not in the log');
  }

  console.log('\n   …and so does the stats replay (stats.ts, the THIRD deal site)');
  {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as RoomFile & { scenario?: string; winner?: Seat | null };
    const sum = summarizeGame({
      code: ROOM, seed: raw.seed, mode: raw.mode ?? 'shared', els: raw.els,
      names: raw.names ?? ['Seat 1', 'Seat 2'], actions: raw.actions,
      winner: raw.winner ?? null, scenario: raw.scenario,
    });
    eq(sum.skipped, 0,
      'summarizeGame() replayed the sandbox log with nothing skipped — without the deal id it '
      + 'would have replayed onto a plain opening board and refused the first cheat');
  }

  // ── §5 nothing reaches the record ────────────────────────────────────
  console.log('\n§5 nothing from test mode reaches account stats or the metagame');
  {
    /* ⚠ WRITTEN AS A TWIN TEST, because the obvious version of this assertion
     * passes for the wrong reason. `history.ts` skips a saved room for TWO
     * reasons — it was dealt with an id, and it is too short to be a game — and
     * a sandbox room that tripped the second would satisfy "not imported" with
     * the scenario guard deleted. (Measured: it did. The first draft of this
     * section stayed green with `if (raw.scenario)` replaced by `if (false)`.)
     *
     * So the fold is shown BOTH rows: this room, and a byte-identical twin with
     * only the deal id removed. Same seed, same log, same length. The twin must
     * import and this one must not, which can only be true if the deal id is
     * what did it. */
    const raw = JSON.parse(readFileSync(file, 'utf8')) as
      { scenario?: string; actions: Action[]; [k: string]: unknown };
    ok(raw.actions.length >= MIN_GAME_ACTIONS,
      `the sandbox room logged ${raw.actions.length} actions, past history.ts's `
      + `MIN_GAME_ACTIONS of ${MIN_GAME_ACTIONS} — so the LENGTH guard is not what skips it`);

    const twinDir = mkdtempSync(join(SCRATCH, 'twin-'));
    writeFileSync(join(twinDir, `${ROOM}.json`), JSON.stringify(raw));
    const twin = { ...raw };
    delete twin['scenario'];
    writeFileSync(join(twinDir, 'TWIN.json'), JSON.stringify(twin));

    const { syncGamesDir } = await import('../history.ts');
    const report = syncGamesDir(twinDir, { force: true });
    ok(!report.rows.some(r => r.code === ROOM),
      'the history fold did not import the sandbox room');
    ok(report.rows.some(r => r.code === 'TWIN'),
      '…and it DID import the twin, which differs by nothing but the deal id — so the skip is '
      + 'the scenario guard doing its job, not the length guard doing somebody else\'s');
  }

  // ── §6 the second seat ───────────────────────────────────────────────
  console.log('\n§6 the second seat is a real seat, stocked the same way');
  {
    const them = new Client(server.port);
    await them.join(ROOM, 1, 'Other tab');
    ok(them.view?.sandbox === true, 'seat 2 gets the same sandbox view (this is the second tab)');
    await them.act({ type: 'sandboxSpawn', seat: 1, card: 'Ignis Sprite', to: 'play' });
    await them.act({ type: 'sandboxLife', seat: 1, life: 7 });
    await again.quiet();
    eq(unitsInView(again.view, 1), ['Ignis Sprite'],
      'and what THEY built shows up on seat 1\'s board in the first tab');
    eq(again.view.players[1].life, 7, 'life and all — an interaction across the table can be set up');
    // seat authority still holds: one tab may not stock the other's side
    them.msgs.length = 0;
    them.lastAt = Date.now();
    them.send({ t: 'action', action: { type: 'sandboxLife', seat: 0, life: 1 } });
    const e3 = await them.next(m => m.t === 'error');
    ok(/you are seat 1, not seat 0/.test(e3.msg ?? ''),
      `…and seat 2 still cannot act for seat 1: "${e3.msg}"`);
    them.ws.close();
  }

  again.ws.close();
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall good');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
