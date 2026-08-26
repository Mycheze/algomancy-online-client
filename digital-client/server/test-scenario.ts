/* R216 — THE SCENARIO TESTER, END TO END (run: node test-scenario.ts).
 *
 * `docs/14-scenario-tester.md` §8 steps 1–4, against the real server over real
 * WebSockets. Five things are proved here and nowhere else:
 *
 *   §1 THE ADMIN GATE HOLDS. This client is heading for a PUBLIC deploy
 *      (docs/05, BL-28): a route that deals you a board of your choosing is a
 *      cheating vector. No token → the route 404s. Wrong token → 404. Right
 *      token → a room. Tested in that order, because a gate nobody has watched
 *      refuse is not a gate.
 *
 *   §2 THE BOARD IS REALLY ON SCREEN. Not "the code ran": the REDACTED VIEW
 *      the owner's client is served is asserted, card by card and unit by
 *      unit. docs/13 §7.4 requires every observation channel to prove it can
 *      see, and docs/14 §9 names this build's specific way of failing —
 *      "freezing a `works` verdict into a test that cannot fail is §5 with
 *      extra steps". `185-scenario-determinism.test.ts` holds the break-and-
 *      revert evidence for the same claim in-process.
 *
 *   §3 THE SCRIPTED OPPONENT MOVES THE GAME. One human, one seat, and the
 *      whole scenario resolves.
 *
 *   §4 ⭐ THE ONE THAT DECIDES WHETHER THE DESIGN IS RIGHT (docs/14 §8.1).
 *      A scenario room is played, the server is KILLED, and the room is
 *      restored from its file — which re-deals from `(seed, mode, els,
 *      scenario)` and replays the log. The restored state must be
 *      BYTE-IDENTICAL to the state that was played. If that does not hold,
 *      the scenario mechanism has broken `rebuild()`, `replay-room.ts`, undo
 *      and the R200 divergence diff for exactly the games we most want to
 *      re-examine, and everything built on it is wrong.
 *
 *   §5 THE VERDICT RECORD. One JSON line, stamped with the scenario id, the
 *      engine SHA (R200), the room code and the action index — server-stamped,
 *      never trusted from the client. Written to ALGO_VERDICTS_FILE, honouring
 *      ALGO_ISSUES_FILE's pattern for the same reason: on the deploy box the
 *      real file is the only copy of the owner's judgements.
 *
 * Style follows test-clock.ts: spawn the real server, drive it with raw
 * WebSockets, no test framework, print ✓/✗ and exit non-zero on any failure.
 */
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Action, Seat } from '../engine/src/types.ts';
import { gameFile, spawnServer, type ServerHandle } from './test-util.ts';
import { SCENARIOS, VERDICTS } from './scenarios.ts';

const SCENARIO = 'lithoghul-donated';
const TOKEN = 'r216-test-token-not-a-secret';

/* Same reasoning as test-clock.ts's ISSUES: server/verdicts.jsonl is live data
 * on the deploy box and `npm test` has to be safe to run there. Set on
 * process.env BEFORE the server is spawned — spawnServer passes process.env
 * through, so the child and the assertions below read the same path. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-scenario-'));
const VERDICTS_FILE = join(SCRATCH, 'verdicts.jsonl');
process.env['ALGO_VERDICTS_FILE'] = VERDICTS_FILE;
process.env['ALGO_TESTER_TOKEN'] = TOKEN;

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
function eq(a: unknown, b: unknown, label: string): void {
  if (JSON.stringify(a) === JSON.stringify(b)) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}\n      got:      ${JSON.stringify(a)}\n      expected: ${JSON.stringify(b)}`); failures++; }
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

interface Msg {
  t: string; seat?: Seat; view?: any; legal?: Action[]; msg?: string;
  scenario?: any; log?: string[];
}

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
   * wire to go quiet rather than sleep a magic number" fix R204/CT-85 made in
   * test-clock.ts, and for the same reason (the bot's moves and the human's
   * update are two pushes, not one). */
  async quiet(quietMs = 150, maxMs = 4000): Promise<void> {
    const deadline = Date.now() + maxMs;
    for (;;) {
      const since = Date.now() - this.lastAt;
      if (since >= quietMs || Date.now() >= deadline) return;
      await sleep(Math.min(quietMs - since, 40));
    }
  }
  /** Send an action and wait for the wire to settle again. */
  async act(a: Action): Promise<void> {
    this.lastAt = Date.now();
    this.send({ t: 'action', action: a });
    await this.quiet();
  }
}

/** The seat's own units, as the SERVER served them — this is the "is the board
 * really on screen" channel, not a peek at the room's internals. */
const unitsInView = (view: any, seat: Seat): { card: string; region: number }[] =>
  Object.values(view.entities ?? {})
    .filter((e: any) => e.kind === 'unit' && e.controller === seat && !e.absent)
    .map((e: any) => ({ card: e.card, region: e.region }))
    .sort((x: any, y: any) => x.card.localeCompare(y.card));

async function main(): Promise<void> {
  let server: ServerHandle = await spawnServer();
  const base = (): string => `http://localhost:${server.port}`;

  // ── §1 the admin gate ────────────────────────────────────────────────
  console.log('\n§1 the admin route is gated (docs/14 §8.2 — this is a PUBLIC deploy)');
  {
    const noToken = await fetch(`${base()}/api/scenario/list`);
    ok(noToken.status === 404, `no token → 404 (got ${noToken.status})`);
    const wrong = await fetch(`${base()}/api/scenario/list?token=nope`);
    ok(wrong.status === 404, `wrong token → 404 (got ${wrong.status})`);
    const wrongOpen = await fetch(`${base()}/api/scenario/open?id=${SCENARIO}`, { redirect: 'manual' });
    ok(wrongOpen.status === 404, `opening a scenario with no token → 404 (got ${wrongOpen.status})`);
    // …and a 404 body, so the response cannot even be used to confirm the
    // route exists
    ok(!(await noToken.text()).includes('scenario'), 'the refusal names nothing about the tester');

    // …and the half that matters most on a public box: a server that was
    // never given a token must not have the feature AT ALL. Not "refuses" —
    // absent, indistinguishable from any other unserved path.
    const unconfigured = await spawnServer({ ALGO_TESTER_TOKEN: '' });
    try {
      const withToken = await fetch(`http://localhost:${unconfigured.port}/api/scenario/list?token=${TOKEN}`);
      ok(withToken.status === 404,
        `a server with no ALGO_TESTER_TOKEN 404s even the RIGHT token (got ${withToken.status})`);
      const openIt = await fetch(
        `http://localhost:${unconfigured.port}/api/scenario/open?token=${TOKEN}&id=${SCENARIO}&json=1`);
      ok(openIt.status === 404, `…and will not deal a board either (got ${openIt.status})`);
    } finally {
      await unconfigured.stop();
    }

    const good = await fetch(`${base()}/api/scenario/list`, { headers: { 'x-algo-tester': TOKEN } });
    ok(good.status === 200, `right token (header) → 200 (got ${good.status})`);
    const list = await good.json() as { scenarios: { id: string }[] };
    ok(list.scenarios.some(s => s.id === SCENARIO), `the queue lists ${SCENARIO}`);
  }

  // ── open the scenario ────────────────────────────────────────────────
  console.log('\n§2 the scenario room, and the board the owner is actually served');
  const opened = await fetch(`${base()}/api/scenario/open?token=${TOKEN}&id=${SCENARIO}&json=1`);
  const openBody = await opened.json() as { ok: boolean; code: string; join: string; scenario: any };
  ok(openBody.ok === true, 'a scenario room was dealt');
  const ROOM = openBody.code;
  ok(/^[A-Z0-9]{4,6}$/.test(ROOM), `room code looks like a room code (${ROOM})`);
  eq(openBody.join, `/?room=${ROOM}&seat=0`, 'the reply hands over the URL to open');

  const you = new Client(server.port);
  await you.open();
  you.send({ t: 'join', room: ROOM, seat: 0, name: 'Owner' });
  const joined = await you.next(m => m.t === 'joined');
  ok(joined.t === 'joined', 'seat 0 joined');

  // THE POSITIVE CONTROL FOR THIS CHANNEL. Everything below reads the view
  // the SERVER pushed, which is the same bytes the browser renders.
  const sc = SCENARIOS[SCENARIO]!;
  eq(you.view.players[0].hand, sc.you.hand, 'your hand is exactly the scenario\'s hand');
  eq(unitsInView(you.view, 0), [{ card: 'The Foretold', region: 1 }],
    'your body is on the board (in the battle region — it is attacking)');
  eq(unitsInView(you.view, 1), [{ card: 'Towering Colossus', region: 1 }],
    'their host is on the board');
  eq(you.view.players[0].resources.length, 6, 'you have the six open resources the scenario deals');
  ok(you.view.players[0].resources.every((r: any) => r.state === 'open'), 'and all six are open');
  eq(you.view.phase, 'battle', 'the prologue landed in the battle window');
  eq(you.view.priority, 0, 'and priority is yours');
  eq([you.view.players[0].life, you.view.players[1].life], [30, 30], 'both players start on 30');

  // the runner screen's payload
  eq(you.scenario?.id, SCENARIO, 'the runner brief rode along with the join');
  eq(you.scenario?.card, 'Lithoghul', 'it names the card under test');
  ok((you.scenario?.expect ?? '').includes('OPPONENT'), 'and carries the plain-English `expect` line');
  eq(you.scenario?.clauses, ['[Augment] Whenever I am dealt damage, I deal that much damage to you.'],
    'the clause dropdown is DERIVED from printed.json, not typed (docs/13 §7.2)');
  eq(you.scenario?.verdicts, [...VERDICTS], 'all four buttons, `bad-scenario` included');
  eq(you.scenario?.needsLiveOpponent, false, 'this one does not need a second tab');
  ok(/^[0-9a-f]{40}$|^unknown$/.test(you.scenario?.engine ?? ''), 'and the engine SHA it would stamp (R200)');

  // ── §3 play it, with nobody in the other seat ────────────────────────
  console.log('\n§3 the scripted opponent (docs/14 §4) — one human, one seat');
  const host = Object.values(you.view.entities as Record<string, any>)
    .find((e: any) => e.card === 'Towering Colossus')!;
  const lith = you.legal.find(a => a.type === 'augment' && (a as any).hostId === host.id);
  ok(!!lith, 'augmenting Lithoghul onto the ENEMY unit is offered (it is a {Virus})');
  await you.act(lith!);
  await you.act({ type: 'passPriority', seat: 0 });
  // the bot answers, the virus resolves and attaches — with nobody in seat 1
  const wearing = Object.values(you.view.entities as Record<string, any>)
    .find((e: any) => e.card === 'Towering Colossus')?.mods ?? [];
  ok(wearing.length === 1, `the augment attached without a second player (mods: ${JSON.stringify(wearing)})`);
  eq(you.view.priority, 0, 'and priority came back to you');

  const arcIdx = (you.view.players[0].hand as string[]).indexOf('Luminous Arc');
  await you.act({ type: 'playCard', seat: 0, handIndex: arcIdx } as Action);
  ok(!!you.view.decision, 'Luminous Arc asks for its target');
  const optIdx = (you.view.decision.options as any[]).findIndex(o => o.value?.unit === host.id);
  ok(optIdx >= 0, 'the enemy host is on the target menu');
  await you.act({ type: 'decide', seat: 0, choice: optIdx } as Action);
  await you.act({ type: 'passPriority', seat: 0 });
  // the Arc resolves, Lithoghul's donated trigger goes on the stack, and the
  // bot passes it through as well
  for (let i = 0; i < 4 && (you.view.stack?.length ?? 0) > 0; i++) {
    if (you.legal.some(a => a.type === 'passPriority')) await you.act({ type: 'passPriority', seat: 0 });
    else break;
  }

  console.log('\n   the clause under test — R131 "you" on a DONATED augment');
  eq([you.view.players[0].life, you.view.players[1].life], [30, 24],
    'the 6 came off the HOST\'S CONTROLLER, not off you');

  // ── §4 ⭐ the byte-identical rebuild ──────────────────────────────────
  console.log('\n§4 ⭐ a scenario room still rebuilds and replays byte-identically (docs/14 §8.1)');
  const played = JSON.stringify(you.view);
  const playedLog = you.msgs.filter(m => m.t === 'update').length;
  ok(playedLog > 0, `the game recorded ${playedLog} updates`);

  const file = gameFile(ROOM);
  ok(existsSync(file), 'the room was persisted');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { seed: number; scenario?: string; actions: Action[] };
  eq(saved.scenario, SCENARIO, 'the scenario id is in the file, BESIDE the seed (docs/14 §2)');
  ok(saved.actions.length >= 6, `and so is the whole log, bot moves included (${saved.actions.length} actions)`);
  ok(!JSON.stringify(saved).includes('"entities"'),
    'and NO hand-built GameState was written — the file is still a seed and a log');

  you.ws.close();
  await server.stop();
  server = await spawnServer();
  const again = new Client(server.port);
  await again.open();
  again.send({ t: 'join', room: ROOM, seat: 0, name: 'Owner' });
  await again.next(m => m.t === 'joined');
  await again.quiet();

  const restored = JSON.stringify(again.view);
  if (restored === played) console.log('  ✓ the restored view is BYTE-IDENTICAL to the played one');
  else {
    failures++;
    console.error('  ✗ the restored view differs from the played one');
    // print the first divergence rather than two walls of JSON
    for (let i = 0; i < Math.max(played.length, restored.length); i++) {
      if (played[i] !== restored[i]) {
        console.error(`      first difference at char ${i}:`);
        console.error(`      played:   …${played.slice(Math.max(0, i - 60), i + 60)}`);
        console.error(`      restored: …${restored.slice(Math.max(0, i - 60), i + 60)}`);
        break;
      }
    }
  }
  eq([again.view.players[0].life, again.view.players[1].life], [30, 24],
    'and the replayed game still ends with the OPPONENT down 6');
  const rebuilt = JSON.parse(readFileSync(file, 'utf8')) as { forks?: unknown[] };
  ok(!rebuilt.forks || rebuilt.forks.length === 0,
    'the restore recorded no fork — nothing in the log was refused or changed meaning');

  // ── §5 the verdict record ────────────────────────────────────────────
  console.log('\n§5 the verdict store (docs/14 §5)');
  {
    const bad = await fetch(`${base()}/api/verdict`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: ROOM, seat: 0, verdict: 'lgtm' }),
    });
    const badBody = await bad.json() as { ok: boolean; error?: string };
    ok(badBody.ok === false, 'an invented verdict is refused');

    const notScenario = await fetch(`${base()}/api/verdict`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: 'ZZZZ', seat: 0, verdict: 'works' }),
    });
    ok(((await notScenario.json()) as { ok: boolean }).ok === false,
      'a verdict against a room that is not a scenario is refused');

    const res = await fetch(`${base()}/api/verdict`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room: ROOM, seat: 0, verdict: 'works',
        clause: '[Augment] Whenever I am dealt damage, I deal that much damage to you.',
        note: 'written by test-scenario.ts',
      }),
    });
    ok(((await res.json()) as { ok: boolean }).ok === true, 'a valid verdict is accepted');

    const lines = readFileSync(VERDICTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    eq(lines.length, 1, 'exactly one line was written');
    const v = JSON.parse(lines[0]!) as Record<string, unknown>;
    eq(v['scenario'], SCENARIO, 'stamped with the scenario id');
    eq(v['card'], 'Lithoghul', 'stamped with the card');
    eq(v['room'], ROOM, 'stamped with the room code');
    eq(v['verdict'], 'works', 'stamped with the verdict');
    ok(typeof v['actionIndex'] === 'number' && (v['actionIndex'] as number) === saved.actions.length,
      `stamped with the action index the server knows (${v['actionIndex']}), not one the client claimed`);
    ok(/^[0-9a-f]{40}$|^unknown$/.test(String(v['engine'])),
      `stamped with the engine SHA (R200): ${v['engine']}`);
    ok(typeof v['ts'] === 'string' && !Number.isNaN(Date.parse(String(v['ts']))), 'and a timestamp');
    ok(!existsSync(join(import.meta.dirname, 'verdicts.jsonl')),
      'and NOTHING was written to server/verdicts.jsonl (ALGO_VERDICTS_FILE honoured)');
  }

  again.ws.close();
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log(failures ? `\n${failures} FAILED` : '\nall good');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  rmSync(SCRATCH, { recursive: true, force: true });
  process.exit(1);
});
