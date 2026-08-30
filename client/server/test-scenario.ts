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

/* Same reasoning as test-clock.ts's ISSUES: var/verdicts.jsonl is live data
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
      'and NOTHING was written to var/verdicts.jsonl (ALGO_VERDICTS_FILE honoured)');
  }

  // ── BATCH A (R218) — every scenario in scenarios-a.ts, driven to its clause ──
  //
  // WHY THIS IS HERE and not in a fixture. docs/14 §9 names "scenarios that are
  // wrong" as the first way this whole instrument fails, and the cost of one is
  // ninety seconds of the rules authority's time plus a `bad scenario` verdict
  // that says nothing about a card. A scenario is only worth shipping if
  // somebody has actually PLAYED it, so each of the six below is played here —
  // over the same WebSocket, through the same `legal` list the browser is
  // served, with the same scripted opponent — and the observable its `expect`
  // line promises the owner is the thing asserted.
  //
  // That makes these regression tests for the CARDS as much as for the
  // scenarios: a rules change that turns one of these boards into a different
  // outcome reddens `npm --prefix server test` instead of reaching him.
  console.log('\n§6 batch A (R218) — six unreached cards, each driven to its printed clause');
  {
    /** open a scenario room and sit down in seat 0, the way the runner link does */
    const openScenario = async (id: string): Promise<Client> => {
      const res = await fetch(`${base()}/api/scenario/open?token=${TOKEN}&id=${id}&json=1`);
      const body = await res.json() as { ok: boolean; code: string };
      ok(body.ok === true, `${id}: the room was dealt`);
      const c = new Client(server.port);
      await c.open();
      c.send({ t: 'join', room: body.code, seat: 0, name: 'Owner' });
      await c.next(m => m.t === 'joined');
      await c.quiet();
      return c;
    };
    /** a seat's units BY NAME, as the SERVER served them (never a peek at the room) */
    const units = (c: Client, seat: Seat): string[] =>
      Object.values(c.view.entities as Record<string, any>)
        .filter((e: any) => e.kind === 'unit' && e.controller === seat && !e.absent)
        .map((e: any) => e.card).sort();
    const entOf = (c: Client, card: string): any =>
      Object.values(c.view.entities as Record<string, any>).find((e: any) => e.card === card && !e.absent);
    const modsOf = (c: Client, card: string): string[] =>
      ((entOf(c, card)?.mods ?? []) as number[]).map(m => (c.view.entities as any)[m]?.card ?? String(m));
    const hand = (c: Client): string[] => c.view.players[0].hand as string[];
    const bin = (c: Client): string[] => c.view.players[0].bin as string[];
    const lives = (c: Client): number[] => [c.view.players[0].life, c.view.players[1].life];
    const optionLabels = (c: Client): string[] =>
      ((c.view.decision?.options ?? []) as any[]).map(o => String(o.label));
    /** answer the open decision by the option's own label — never by a raw index,
     *  which is the thing that silently means something else after a rules change */
    const decide = async (c: Client, sub: string): Promise<void> => {
      const i = optionLabels(c).findIndex(l => l.includes(sub));
      ok(i >= 0, `   the menu offers "${sub}" (saw: ${optionLabels(c).join(' | ') || 'no decision'})`);
      await c.act({ type: 'decide', seat: 0, choice: i } as Action);
    };
    const pass = (c: Client): Promise<void> => c.act({ type: 'passPriority', seat: 0 } as Action);
    /** the opponent's own label on a target menu — read off the view rather than
     *  typed, so renaming the scripted seat cannot silently aim a spell elsewhere */
    const them = (c: Client): string => String(c.view.players[1].name);
    const play = (c: Client, card: string, mode?: 'discardMe'): Promise<void> =>
      c.act({ type: 'playCard', seat: 0, handIndex: hand(c).indexOf(card), ...(mode ? { mode } : {}) } as Action);
    const augment = (c: Client, card: string, hostCard: string): Promise<void> =>
      c.act({ type: 'augment', seat: 0, from: 'hand', index: hand(c).indexOf(card),
        hostId: entOf(c, hostCard).id } as Action);

    // #2 Cthyrian Rector — "sacrifice me" on a donated augment is the HOST
    console.log('\n   cthyrian-rector-sacrifice — the sacrifice half, which no test has ever watched');
    {
      const c = await openScenario('cthyrian-rector-sacrifice');
      eq(c.view.phase, 'battle', '   the prologue landed in the battle window');
      eq(c.view.priority, 0, '   and priority is yours');
      eq(hand(c), ['Cthyrian Rector', 'Darkblast', 'Luminous Arc'], '   the declared hand is on screen');
      ok(c.legal.some(a => a.type === 'augment' && (a as any).hostId === entOf(c, 'Towering Colossus').id),
        '   augmenting the Rector onto YOUR OWN unit is offered (it is a {Virus})');
      await augment(c, 'Cthyrian Rector', 'Towering Colossus');
      await pass(c);
      eq(modsOf(c, 'Towering Colossus'), ['Cthyrian Rector'],
        '   it attached with nobody in seat 1');
      ok(c.legal.some(a => a.type === 'playCard' && (a as any).handIndex === hand(c).indexOf('Darkblast')),
        '   Darkblast is playable with the resources the scenario deals');
      await play(c, 'Darkblast');
      await decide(c, them(c));                       // the 5 damage, at the player
      eq(optionLabels(c), ['Luminous Arc'],
        '   the "[Discard a card]" cost has EXACTLY ONE option — the setup cannot be misclicked');
      await decide(c, 'Luminous Arc');
      eq(units(c, 0), [],
        '   THE CLAUSE: the HOST was sacrificed — the 10/15 is off the board');
      await pass(c); await pass(c);
      eq(hand(c), ['Luminous Arc'], '   THE CLAUSE: the trashed card is back IN YOUR HAND');
      eq(lives(c), [30, 25], '   and Darkblast still resolved for 5 at the opponent');
      c.ws.close();
    }

    // #3 Slag Spewer — CT-86: the erase that nothing in the game can see
    console.log('\n   slag-spewer-erase — CT-86 / round-27 Q3, the one EVENTLESS card');
    {
      const c = await openScenario('slag-spewer-erase');
      eq(c.view.phase, 'battle', '   the prologue landed in the battle window');
      eq(c.view.priority, 0, '   and priority is yours');
      await augment(c, 'Slag Spewer', 'Ambling Mountaintop');
      await pass(c);
      eq(modsOf(c, 'Ambling Mountaintop'), ['Slag Spewer'], '   Slag Spewer is riding the host');
      const act = c.legal.find(a => a.type === 'activateAbility');
      ok(!!act, '   its [Augment] ability is offered on the host');
      await c.act(act!);
      await decide(c, them(c));                       // the 2 damage, at the player
      eq(optionLabels(c), ['Erase Slag Spewer'],
        '   "erase one of my mods" offers exactly one — itself');
      await decide(c, 'Erase Slag Spewer');
      await pass(c);
      eq(lives(c), [30, 28], '   THE CLAUSE: the 2 went to the OPPONENT, not to you');
      eq(modsOf(c, 'Ambling Mountaintop'), [], '   the mod is gone off the unit');
      eq(bin(c), [], '   and it is NOT in your bin — an erase is not a death');
      // R219 — CT-86 ANSWERED AND CLOSED. This used to assert `erased ===
      // undefined` and call it "the point of the ticket": the cost-erase filed
      // NOWHERE, and that was carried to the owner as an open question across
      // two rounds. It was never a question — the card says "erase", which
      // names the destination:
      //   "Obviously the card says where it should end up. It's erased…
      //    It should just end up in the erased zone."
      // Every erase now routes through E.eraseMod, so this and Suppression
      // Field were both fixed by one line.
      // the mod here is Slag Spewer's OWN body, augmented onto the Mountaintop —
      // this scenario is the card eating itself as its own activation cost.
      eq(c.view.players[0].erased, ['Slag Spewer'],
        '   CT-86: the cost-erased mod is on the R65 public pile, like every other erase');
      c.ws.close();
    }

    // #4 Nothyr — "target NONSPELL effect" aimed at a triggered ability
    console.log('\n   nothyr-negates-a-trigger — a TRIGGER on the nonspell menu, which no test aims at');
    {
      const c = await openScenario('nothyr-negates-a-trigger');
      eq(c.view.phase, 'battle', '   the prologue landed in the battle window');
      eq(c.view.priority, 0, '   and priority is yours');
      await play(c, 'Luminous Arc');
      eq(optionLabels(c), ["Lithoghul (Owner's)"],
        '   the Arc has exactly one legal target — your own Lithoghul');
      await decide(c, 'Lithoghul');
      await pass(c);
      eq((c.view.stack as any[]).map(i => i.kind), ['triggered'],
        "   the Arc resolved and Lithoghul's trigger is on the stack, aimed at YOU");
      ok(c.legal.some(a => a.type === 'playCard' && (a as any).mode === 'discardMe'),
        '   Nothyr\'s printed "Discard me" line is offered');
      await play(c, 'Nothyr', 'discardMe');
      ok(optionLabels(c).some(l => l.startsWith('Lithoghul: I deal that much damage')),
        '   THE CLAUSE: the TRIGGERED ability is on the "nonspell effect" target menu');
      await decide(c, 'Lithoghul: I deal');
      await pass(c);
      eq(lives(c), [30, 30],
        '   THE CLAUSE: the trigger was negated — you are still on 30 (unanswered it is 24)');
      eq(units(c, 0), ['Lithoghul'], '   and Lithoghul is still standing');
      c.ws.close();
    }

    // #5 Skybreaker — "Erase me" paid while riding a HOST
    console.log('\n   skybreaker-negates-spells — "negate ALL spell effects", from a host');
    {
      const c = await openScenario('skybreaker-negates-spells');
      eq(c.view.phase, 'battle', '   the prologue landed in the battle window');
      eq(c.view.priority, 0, '   and priority is yours');
      eq(modsOf(c, 'Carapace Devourer'), ['Skybreaker'],
        '   the prologue played Skybreaker from hand onto the host');
      await play(c, 'Luminous Arc'); await decide(c, 'Ambling Mountaintop');
      await play(c, 'Luminous Arc'); await decide(c, 'Bubb');
      eq((c.view.stack as any[]).length, 2, '   two spells on the stack, one per enemy body');
      const act = c.legal.find(a => a.type === 'activateAbility');
      ok(!!act, '   "Erase me: negate all spell effects" is offered');
      await c.act(act!);
      await pass(c); await pass(c); await pass(c);
      eq(units(c, 1), ['Ambling Mountaintop', 'Bubb'],
        '   THE CLAUSE: BOTH enemy units survive — the printed word is "all"');
      eq([entOf(c, 'Ambling Mountaintop').damage ?? 0, entOf(c, 'Bubb').damage ?? 0], [0, 0],
        '   with no damage on either of them');
      eq(units(c, 0), [],
        '   and the cost took the HOST with it — on an augment "me" is the unit wearing it');
      eq(c.view.players[0].erased, ['Carapace Devourer', 'Skybreaker'],
        '   both reached R65\'s erased pile — the positive control for the Slag Spewer assertion above');
      c.ws.close();
    }

    // #6 Void Mandible — R207: it negates the item the event NAMES
    console.log('\n   void-mandible-negates — the R207 confirmation, with two identical spells up');
    {
      const c = await openScenario('void-mandible-negates');
      eq(c.view.phase, 'battle', '   the prologue landed in the battle window');
      eq(c.view.priority, 0, '   and priority is yours');
      eq(units(c, 0), ['Rook', 'Towering Colossus'], '   Rook and the host are both attacking');
      await play(c, 'Luminous Arc'); await decide(c, 'Ambling Mountaintop');
      eq((c.view.stack as any[]).map(i => i.card), ['Luminous Arc'],
        '   Arc #1 is on the stack, aimed at Ambling Mountaintop');
      ok(c.legal.some(a => a.type === 'augment'),
        "   Rook's printed permission makes the non-Virus Void Mandible augmentable mid-battle");
      await augment(c, 'Void Mandible', 'Towering Colossus');
      await pass(c);
      eq(modsOf(c, 'Towering Colossus'), ['Void Mandible'],
        '   it attached, and applying a mod fired no play event (R37) — nothing triggered');
      eq((c.view.stack as any[]).map(i => i.card), ['Luminous Arc'],
        '   Arc #1 is still standing underneath it');
      await play(c, 'Luminous Arc'); await decide(c, 'Bubb');
      eq(units(c, 0), ['Rook'],
        '   THE CLAUSE (a): the host was sacrificed the instant the card was played — not optional');
      await pass(c); await pass(c);
      eq(units(c, 1), ['Bubb'],
        '   THE CLAUSE (b) / R207: the NEWER Arc was the one negated — Bubb lives, Ambling Mountaintop died');
      eq(entOf(c, 'Bubb').damage ?? 0, 0, '   and Bubb took no damage at all');
      c.ws.close();
    }

    // #7 Cinder Scuttler — recall to the HAND, and only off COMBAT damage
    console.log('\n   cinder-scuttler-recall — the zone the reminder text names, with its own control');
    {
      const c = await openScenario('cinder-scuttler-recall');
      eq(c.view.phase, 'battle', '   the prologue landed in the battle window');
      eq(c.view.priority, 0, '   and priority is yours');
      await play(c, 'Darkblast');
      await decide(c, them(c));
      eq(optionLabels(c), ['Cinder Scuttler'], '   the discard cost has exactly one option');
      await decide(c, 'Cinder Scuttler');
      eq(bin(c), ['Cinder Scuttler'], '   the discard trashed it into your bin (R40)');
      await pass(c);
      eq(lives(c), [30, 25], '   Darkblast resolves for 5 at the opponent');
      eq(hand(c), [],
        '   THE CONTROL: that 5 is NOT combat damage, and Cinder Scuttler did not move');
      for (let i = 0; i < 6 && !hand(c).includes('Cinder Scuttler'); i++) {
        if (!c.legal.some(a => a.type === 'passPriority')) break;
        await pass(c);
      }
      eq(lives(c), [30, 15], '   the attacker connects for 10 — that IS combat damage');
      eq(hand(c), ['Cinder Scuttler'],
        '   THE CLAUSE: it is recalled INTO YOUR HAND ("Put me into your hand"), not into play');
      eq(units(c, 0), ['Towering Colossus'], '   nothing came back onto the board');
      eq(bin(c), ['Darkblast'], '   and it left the bin');
      c.ws.close();
    }
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

/* ─────────────────────────────────────────────────────────────────────────
 * R218 — BATCH C, FROZEN (docs/14 §6: "a verdict is not a report, it is a
 * test").
 *
 * Six scenarios, each driven through the REAL action path — `dealScenario`,
 * `apply`, and `passiveMove` for seat 1, i.e. the same three pieces the live
 * room uses — and each asserting the concrete observable its `expect` line
 * promises the owner. If a rules change moves one of these numbers, the batch
 * says so here rather than in front of a human.
 *
 * ⚠ WHY THIS BLOCK IS SYNCHRONOUS. `main()` above is already running: it was
 * called at module top level and its first statement is an `await`, so control
 * is back here while it waits for a server. A synchronous block therefore runs
 * to completion BEFORE main() resumes, and — crucially — before its
 * `process.exit(failures ? 1 : 0)`. It shares that same `failures` counter, so
 * a red assertion below fails `npm --prefix server test` exactly like a red one
 * above. Nothing here spawns a server, opens a socket or touches a file: it is
 * the in-process half, and the end-to-end half is what §1–§5 already prove for
 * the mechanism as a whole.
 *
 * ⚠ AND THE POSITIVE CONTROL (docs/14 §9: "freezing a `works` verdict into a
 * test that cannot fail is §5 with extra steps"). Broken and reverted while
 * writing this: changing the Manablub expectation from 27 to 26 reddens with
 * `✗ Bloated Manablub: the OPPONENT is on 27 (got 27)`, and the run exits 1.
 * Every life total below was read off a real drive, not predicted.
 */
import { apply as capply, forcedAction as cforced, legalActions as clegal, sanitizeTrio as ctrio } from '../engine/src/apply.ts';
import { E as CE } from '../engine/src/engine.ts';
import { BATCH_C } from './scenarios-c.ts';
import { dealScenario as cdeal, passiveMove as cpassive, OPPONENT as C_OPP } from './scenarios.ts';
import type { Action as CAction, GameState as CState } from '../engine/src/types.ts';

{
  console.log('\nR218 batch C — six unreached promises, driven to their observable');

  /** one scenario room, off the real choke point, with the same arguments
   * /api/scenario/open passes (mode 'shared', default trio, fixed seed). */
  class CRig {
    s: CState;
    log: string[] = [];
    constructor(id: string) {
      const r = cdeal(216216216, ['You', 'Tester Bot'], 'shared', ctrio(undefined), undefined, id);
      this.s = r.state;
      for (const e of r.events) this.log.push(`[${e.type}] ${e.msg}`);
      this.forced(); this.bot();
    }
    private absorb(r: { state: CState; events: { type: string; msg: string }[] }): void {
      this.s = r.state;
      for (const e of r.events) this.log.push(`[${e.type}] ${e.msg}`);
    }
    /** the engine's own auto-submits, which the server applies for both seats */
    private forced(): void {
      for (let i = 0; i < 40; i++) {
        const f = cforced(this.s);
        if (!f) return;
        this.absorb(capply(this.s, f));
      }
    }
    /** THE REAL SCRIPTED OPPONENT: main.ts's loop, minus the room bookkeeping.
     * The preference order is `passiveMove` itself, never a copy of it — a
     * second copy would make this a check on the copy (docs/13 §5). */
    private bot(): void {
      for (let step = 0; step < 60; step++) {
        if (this.s.phase === 'gameover') return;
        const pick = cpassive(clegal(this.s, C_OPP));
        if (!pick) return;
        this.absorb(capply(this.s, pick));
        this.forced();
      }
      throw new Error('the scripted opponent hit its 60-step cap');
    }
    act(a: CAction): void { this.absorb(capply(this.s, a)); this.forced(); this.bot(); }
    legal(): CAction[] { return clegal(this.s, 0); }
    said(s: string): boolean { return this.log.some(l => l.includes(s)); }
    life(seat: 0 | 1): number { return this.s.players[seat]!.life; }
    /** a live entity by card name, optionally by controller */
    unit(card: string, seat?: 0 | 1): any {
      return Object.values(this.s.entities as Record<string, any>)
        .find(e => e.card === card && !e.absent && (seat === undefined || e.controller === seat));
    }
    tokens(): any[] {
      return Object.values(this.s.entities as Record<string, any>)
        .filter(e => e.kind === 'unit' && e.token && !e.absent);
    }
    /** answer the open targets decision by the option LABEL the runner shows */
    aim(match: (label: string) => boolean): void {
      const opts = (this.s.decision?.options ?? []) as { label?: string }[];
      const i = opts.findIndex(o => match(String(o.label ?? '')));
      if (i < 0) throw new Error(`batch C: no target matching; menu = ${JSON.stringify(opts.map(o => o.label))}`);
      this.act({ type: 'decide', seat: 0, choice: i } as CAction);
    }
    play(card: string): void {
      const i = this.s.players[0]!.hand.indexOf(card);
      if (i < 0) throw new Error(`batch C: ${card} is not in hand`);
      this.act({ type: 'playCard', seat: 0, handIndex: i } as CAction);
    }
    /** pass / decline until a phase is reached, the way the owner would */
    passTo(phase: string): void {
      for (let i = 0; i < 16; i++) {
        if (this.s.phase === phase) return;
        const l = this.legal();
        const p = l.find(a => a.type === 'passPriority') ?? l.find(a => a.type === 'declareAttack')
          ?? l.find(a => a.type === 'declareBlocks') ?? l[0];
        if (!p) throw new Error(`batch C: nothing legal for seat 0 in ${this.s.phase}`);
        this.act(p);
      }
      throw new Error(`batch C: never reached ${phase}`);
    }
  }

  /** THE BOARD A SCENARIO OPENS ON, as the owner sees it — everything except
   * the deck and bin, which the seed legitimately owns. */
  const cBoard = (s: CState): string => JSON.stringify({
    phase: s.phase, prio: s.priority ?? null, turn: s.turn, initiative: s.initiative,
    battle: s.battle, present: s.regions.map(r => r.presentSeats),
    players: s.players.map(p => ({ life: p.life, rot: p.rot ?? 0, hand: p.hand, res: p.resources })),
    entities: Object.values(s.entities as Record<string, any>).map(e => ({
      id: e.id, card: e.card, kind: e.kind, seat: e.controller, region: e.region,
      counters: e.counters ?? 0, token: !!e.token,
    })),
    stack: s.stack.length, decision: s.decision?.kind ?? null,
  });

  /* Every scenario must deal, must land where it DECLARES it lands, and must
   * open on the SAME BOARD whatever seed the room was given — the anti-rot
   * guard of docs/14 §9, applied to the whole batch at once.
   *
   * ⚠ THE SEED SWEEP IS THE LOAD-BEARING THIRD ONE. `/api/scenario/open`
   * accepts `&seed=<n>` so the owner can re-deal with a different library
   * shuffle, and `dealScenario` docs the board as seed-independent while the
   * DECK is not. A prologue that crosses a turn boundary breaks that promise
   * quietly — turn 2 draws fresh cards — and the result is the worst kind of
   * scenario: one that works when its author tests it and is a different board
   * when the owner opens it. Every batch-C prologue stays inside turn 1 for
   * exactly this reason; this loop is what keeps that true.
   *
   * ⚠ R228 REPLACED THE PARAGRAPH THAT USED TO BE HERE. It read: "the seat's
   * HAND cannot hold a payable {Haste} card either, which is why no prologue
   * here needs a `doneHaste`: `hasteDone` is null on all six. A future
   * batch-C scenario that deals a haste card INTO A HAND must add its own —
   * `runPrologue` does not skip the step for you." Every sentence of that is
   * now false: the haste step is unconditional, so `hasteDone` is never null
   * between planning and battle whatever the hand holds, and `runPrologue`
   * therefore DOES walk through it (scenarios.ts::closeHasteStep) for any
   * scenario that declares a phase other than 'planning'. A prologue may
   * still write its own `doneHaste` — one that wants to act in the step must
   * — and the walk only finishes the seats it leaves open. */
  const C_SEEDS = [1, 7, 4242, 216216216, 999983];
  for (const [id, sc] of Object.entries(BATCH_C)) {
    const rig = new CRig(id);
    eq(rig.s.phase, sc.phase, `${id}: deals into the phase it declares`);
    eq(rig.s.priority ?? null, sc.priority ?? null, `${id}: and the priority it declares`);
    ok(sc.needsLiveOpponent !== true, `${id}: is driveable with the scripted opponent alone`);
    const seen = new Set(C_SEEDS.map(seed => cBoard(
      cdeal(seed, ['You', 'Tester Bot'], 'shared', ctrio(undefined), undefined, id).state)));
    eq(seen.size, 1, `${id}: one board across ${C_SEEDS.length} seeds — the owner opens what was tested`);
  }

  // ── Skittering Blight: rot damage becomes +1/+1 counters (the engine's ONE
  //    replacement effect, R38) ─────────────────────────────────────────
  {
    const r = new CRig('skittering-blight-rot-into-counters');
    eq(r.s.players[0]!.rot, 1, 'Skittering Blight: the spawn trigger already gave you a rot');
    ok(r.legal().some(a => a.type === 'playCard'), 'Skittering Blight: Fester is payable with the mana dealt');
    r.play('Fester');
    r.aim(l => l === 'You');                       // "target player" = yourself
    r.passTo('deploy');                            // rot ticks at the start of deployment
    eq(r.s.players[0]!.rot, 2, 'Skittering Blight: you reached the rot step holding 2 rot');
    eq(r.life(0), 30, 'Skittering Blight: your life is UNTOUCHED — the damage was replaced');
    const blight = r.unit('Skittering Blight', 0);
    eq(blight?.counters, 2, 'Skittering Blight: "that MANY" — two counters for two rot, not one');
    eq(new CE(r.s).effStats(blight), [3, 3], 'Skittering Blight: and it is a 3/3');
    ok(r.said("Skittering Blight replaces the 2 damage You's rot would deal."),
      'Skittering Blight: the replacement announces itself by name');
    eq(r.life(1), 30, 'Skittering Blight: nothing else on the board moved (the 0/4 attacker is inert)');
  }

  // ── Earnest Defender: whose 1/1 is it? ──────────────────────────────
  {
    const r = new CRig('earnest-defender-enemy-spell');
    ok(r.tokens().length === 0, 'Earnest Defender: no tokens on the opening board');
    r.play('Flame of History');
    r.aim(l => l.startsWith('The Foretold'));      // their OTHER unit — an ally of the Defender
    ok(r.said('Trigger: Earnest Defender — create a 1/1 unit'),
      'Earnest Defender: the trigger fires on TARGETING, before the spell resolves');
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    const made = r.tokens();
    eq(made.length, 1, 'Earnest Defender: exactly one 1/1 was created');
    eq(made[0]?.controller, C_OPP,
      'Earnest Defender: the 1/1 belongs to the CARRIER\'s controller, not to the caster — '
      + 'a token on seat 0 is the "me"/"you" bug this scenario exists to make visible');
    eq(new CE(r.s).effStats(made[0]), [1, 1], 'Earnest Defender: and it is a 1/1');
    ok(!!r.unit('The Foretold', 1), 'Earnest Defender: the targeted ally survived the 1 damage');
  }

  // ── Bloated Manablub ⭐ the last surviving REGION card ────────────────
  {
    const r = new CRig('manablub-dies-in-their-region');
    const blub = r.unit('Bloated Manablub', 0);
    eq(blub?.region, r.s.battle?.region,
      '⭐ Bloated Manablub: the prologue put it IN THE BATTLE REGION — the position R199 could not give it');
    ok((r.s.regions[blub.region]!.presentSeats as number[]).includes(C_OPP),
      '⭐ Bloated Manablub: and an opponent is actually present there');
    r.play('Flame of History');
    r.aim(l => l.startsWith('Bloated Manablub'));  // kill your own attacker, on purpose
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    ok(r.said('Trigger: Bloated Manablub — each opponent loses 3 life'),
      '⭐ Bloated Manablub: the despawn trigger fires');
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    ok(r.said('Tester Bot loses 3 life (Bloated Manablub)'),
      '⭐ Bloated Manablub: THE CLAUSE DELIVERS — the first time this promise has ever been observed');
    eq(r.life(1), 27, '⭐ Bloated Manablub: the opponent is on 27');
    eq(r.life(0), 30, '⭐ Bloated Manablub: and you are untouched on 30 (a wrong seat would show here)');
    ok(!r.said('no opponent is present here'),
      '⭐ Bloated Manablub: the silent/empty branch — everything the suite has ever seen — was NOT taken');
    r.passTo('deploy');
    eq(r.life(1), 27, '⭐ Bloated Manablub: 27 is their final number; nothing else takes life this turn');
  }

  // ── Pestilent Mycelion: region AND count ────────────────────────────
  {
    const r = new CRig('mycelion-minus-counters-in-battle');
    eq(r.unit('Pestilent Mycelion', 0)?.region, r.s.battle?.region,
      'Pestilent Mycelion: it is standing in the battle region');
    r.play('Umbral Decay');
    r.aim(l => l.startsWith('Ambling Mountaintop'));
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    eq(r.unit('Ambling Mountaintop', 1)?.counters, -2,
      'Pestilent Mycelion: TWO -1/-1 counters arrived in one batch');
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    eq(r.log.filter(l => l.includes('loses 1 life (Pestilent Mycelion)')).length, 1,
      'Pestilent Mycelion: "one or MORE counters" is ONE firing for the batch, not one per counter');
    eq(r.life(1), 29, 'Pestilent Mycelion: the opponent is on 29 — 28 would be a per-counter reading');
    eq(r.life(0), 30, 'Pestilent Mycelion: and you are untouched');
    ok(!r.said('no opponent is present here'),
      'Pestilent Mycelion: the empty-region branch the suite pins was NOT taken');
    r.passTo('deploy');
    eq(r.life(1), 28,
      "Pestilent Mycelion: 29 → 28 afterwards is its own 1 combat damage, which `expect` warns about");
  }

  // ── Molten Riftbreaker: the donated despawn negates a real spell ─────
  {
    const r = new CRig('riftbreaker-negates-your-own-spell');
    const host = r.unit('The Foretold', 0);
    const aug = r.legal().find(a => a.type === 'augment' && (a as any).hostId === host.id);
    ok(!!aug, 'Molten Riftbreaker: a {Virus} augment is offered in the BATTLE window (a plain one would not be)');
    r.act(aug!);
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    ok(r.said('Molten Riftbreaker augments The Foretold'),
      'Molten Riftbreaker: it attached with nobody sitting in seat 1');
    ok(!r.said('Fireball'), 'Molten Riftbreaker: no Fireballs — augmenting is not spawning');
    r.play('Arc Lightning');
    r.aim(l => l === 'Tester Bot');                 // their face: 6 damage, if it ever resolves
    eq(r.s.stack.length, 1, 'Molten Riftbreaker: Arc Lightning is on the stack, unresolved');
    r.play('Luminous Arc');
    r.aim(l => l.includes("The Foretold (You's)"));  // kill your own host
    eq(r.s.stack.length, 2, 'Molten Riftbreaker: both spells are on the stack');
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    ok(r.said('Trigger: Molten Riftbreaker — negate all allied spells'),
      'Molten Riftbreaker: the DONATED despawn trigger fires off the host — the path 13-fire-b never takes');
    r.act({ type: 'passPriority', seat: 0 } as CAction);
    ok(r.said('Arc Lightning is negated'),
      'Molten Riftbreaker: it NEGATES A REAL SPELL — the precondition unreached.ts says nothing could build');
    ok(!r.said('you have no spell on the stack'),
      'Molten Riftbreaker: the empty-sweep branch, which is all the drill has ever seen, was NOT taken');
    eq(r.life(1), 30, 'Molten Riftbreaker: the opponent is still on 30 — 24 would mean the Arc resolved');
  }

  // ── Prediction Prophet: predict where you WILL be ────────────────────
  {
    const r = new CRig('prediction-prophet-predict-the-future');
    r.act({ type: 'donePlanning', seat: 0 } as CAction);
    // ⚠ R228 PUT A REAL STEP BACK BETWEEN THESE TWO LINES, and it belongs
    // there: the card's trigger is `endOfHaste`, and this block used to reach
    // it off `donePlanning` alone only because the step was OPTIMISED AWAY
    // when nobody could act in it. Now the step happens, so the prediction is
    // asked when the step ENDS — which is what the card prints. The bot
    // declines seat 1's half for itself (`PASSIVE_ORDER` holds `doneHaste`);
    // seat 0 is the human at this table and says so out loud.
    ok(!!r.legal().find(a => a.type === 'doneHaste'),
      'Prediction Prophet: the haste step is offered, as it now always is (R228)');
    ok(!r.s.decision, 'Prediction Prophet: and nothing is asked while it is still open');
    r.act({ type: 'doneHaste', seat: 0 } as CAction);
    eq(r.s.decision?.kind, 'number',
      'Prediction Prophet: the END OF THE HASTE STEP raises the R197 numeric entry');
    eq(r.s.decision?.seat, 0, 'Prediction Prophet: and it is asked of you, not of the bot');
    // `?? ` cannot be used to default this: `max: null` IS the open-ended
    // answer, so a nullish coalesce would rewrite a pass into a failure.
    ok(r.s.decision?.numeric?.max === null,
      'Prediction Prophet: the entry is open-ended (R197 — the old menu could not reach life+6)');
    r.act({ type: 'decide', seat: 0, choice: 24 } as CAction);
    ok(r.said('You predicts 24.'), 'Prediction Prophet: 24 is on the record while you stand on 30');
    r.act({ type: 'declareAttack', seat: 0, columns: [[r.unit('Rampart Guardian', 0).id]] } as CAction);
    r.play('Arc Lightning');
    r.aim(l => l === 'You');                        // spend the 6 you predicted
    r.passTo('deploy');
    eq(r.life(0), 24, 'Prediction Prophet: you reach the start of deployment on 24');
    ok(r.said('the prediction of 24 was matched'),
      'Prediction Prophet: the number written during [Haste] survived a real spell, a battle and a regroup');
    const five = r.tokens().filter(t => t.tokenStats?.[0] === 5);
    eq(five.length, 1, 'Prediction Prophet: a 5/5 was created');
    eq(five[0]?.controller, 0, 'Prediction Prophet: on YOUR side');
    eq(five[0]?.region, r.unit('Prediction Prophet', 0)?.region,
      'Prediction Prophet: and it arrived where its source stands (R115)');
    eq(r.life(1), 30, 'Prediction Prophet: the opponent never moved — the only number in play is yours');
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * R218 — BATCH D, FROZEN (docs/14 §6: a verdict is not a report, it is a test).
 *
 * Six cards out of `ledgers/unreached.ts` — promises the whole-pool drill
 * has never once watched being delivered — each driven here through the REAL
 * action path (`dealScenario` → `apply`, with `passiveMove` answering for seat
 * 1) to the exact observable its `expect` line puts in front of the owner. The
 * point is not that the clause works; five of the six already have a unit test
 * saying so from a hand-built state. The point is that it works when somebody
 * PLAYS it, which is the gap docs/14 §1 exists to close, and that the numbers
 * printed on the runner screen are the numbers the engine produces.
 *
 * Same synchronous-block reasoning as batch C above: `main()` is parked on its
 * first `await`, this runs to completion before it resumes, and it shares the
 * same `failures` counter, so a red line here fails `npm --prefix server test`.
 *
 * ⚠ POSITIVE CONTROL (docs/14 §9). Broken and reverted while writing this:
 * changing the Debt Plant expectation from 6/5 to 6/6 reddens with
 * `✗ Debt Plant: Debt Plant is 6/5 — seven expended is three whole pairs`, and
 * the run exits 1. Every number below was read off a real drive of the real
 * board, never predicted from the card text.
 */
import { apply as dapply, forcedAction as dforced, legalActions as dlegal, sanitizeTrio as dtrio } from '../engine/src/apply.ts';
import { E as DE } from '../engine/src/engine.ts';
import { BATCH_D } from './scenarios-d.ts';
import { BATCHES as D_BATCHES, dealScenario as ddeal, passiveMove as dpassive, OPPONENT as D_OPP } from './scenarios.ts';
import type { Action as DAction, GameState as DState } from '../engine/src/types.ts';

{
  console.log('\nR218 batch D — six unreached promises, driven to their observable');

  /** one scenario room, off the real choke point, with the arguments
   * /api/scenario/open actually passes (mode 'shared', default trio, its own
   * fixed seed 216216216 — the board does not depend on it, the deck does). */
  class DRig {
    s: DState;
    log: string[] = [];
    types: string[] = [];
    constructor(id: string) {
      const r = ddeal(216216216, ['You', 'Tester Bot'], 'shared', dtrio(undefined), undefined, id);
      this.s = r.state;
      this.absorbEvents(r.events);
      this.forced(); this.bot();
    }
    private absorbEvents(evs: readonly { type: string; msg: string }[]): void {
      for (const e of evs) { this.log.push(`[${e.type}] ${e.msg}`); this.types.push(e.type); }
    }
    private absorb(r: { state: DState; events: { type: string; msg: string }[] }): void {
      this.s = r.state; this.absorbEvents(r.events);
    }
    private forced(): void {
      for (let i = 0; i < 40; i++) {
        const f = dforced(this.s);
        if (!f) return;
        this.absorb(dapply(this.s, f));
      }
    }
    /** main.ts's scripted opponent, minus the room bookkeeping. `passiveMove`
     * itself, never a re-typed preference order — a second copy would make
     * this a check on the copy (docs/13 §5). */
    private bot(): void {
      for (let step = 0; step < 60; step++) {
        if (this.s.phase === 'gameover') return;
        const pick = dpassive(dlegal(this.s, D_OPP));
        if (!pick) return;
        this.absorb(dapply(this.s, pick));
        this.forced();
      }
      throw new Error('batch D: the scripted opponent hit its 60-step cap');
    }
    act(a: DAction): void { this.absorb(dapply(this.s, a)); this.forced(); this.bot(); }
    legal(): DAction[] { return dlegal(this.s, 0); }
    said(s: string): boolean { return this.log.some(l => l.includes(s)); }
    /** the log written since `mark()` — for "and NOTHING happened yet" claims */
    mark(): number { return this.log.length; }
    since(at: number): string[] { return this.log.slice(at); }
    life(seat: 0 | 1): number { return this.s.players[seat]!.life; }
    hand(seat: 0 | 1): string[] { return [...this.s.players[seat]!.hand]; }
    res(seat: 0 | 1): { kind: string; state: string }[] {
      return this.s.players[seat]!.resources.map(r => ({ kind: String(r.kind), state: String(r.state) }));
    }
    unit(card: string, seat?: 0 | 1): any {
      return Object.values(this.s.entities as Record<string, any>)
        .find(e => e.card === card && !e.absent && (seat === undefined || e.controller === seat));
    }
    tokens(): any[] {
      return Object.values(this.s.entities as Record<string, any>)
        .filter(e => e.kind === 'unit' && e.token && !e.absent);
    }
    /** printed stats plus every live layer — what the owner reads off the card */
    stats(card: string, seat?: 0 | 1): string {
      const u = this.unit(card, seat);
      if (!u) return 'ABSENT';
      const [p, t] = new DE(this.s).effStats(u);
      return `${p}/${t}`;
    }
    counters(card: string, seat?: 0 | 1): number { return this.unit(card, seat)?.counters ?? 0; }
    /** answer the open targets decision by the LABEL the runner puts on screen */
    aim(match: (label: string) => boolean, what: string): void {
      const opts = (this.s.decision?.options ?? []) as { label?: string }[];
      const i = opts.findIndex(o => match(String(o.label ?? '')));
      if (i < 0) throw new Error(`batch D: no target for ${what}; menu = ${JSON.stringify(opts.map(o => o.label))}`);
      this.act({ type: 'decide', seat: 0, choice: i } as DAction);
    }
    play(card: string): void {
      const i = this.s.players[0]!.hand.indexOf(card);
      if (i < 0) throw new Error(`batch D: ${card} is not in hand (${JSON.stringify(this.hand(0))})`);
      this.act({ type: 'playCard', seat: 0, handIndex: i } as DAction);
    }
    pass(): void { this.act({ type: 'passPriority', seat: 0 } as DAction); }
  }

  /** THE ANTI-ROT GUARD of docs/14 §9, over the whole batch at once: every
   * scenario deals, opens with no unanswered question, lands where it declares
   * it lands, and leaves the owner something to do with nobody in seat 1. */
  for (const [id, sc] of Object.entries(BATCH_D)) {
    const rig = new DRig(id);
    eq(rig.s.phase, sc.phase, `${id}: deals into the phase it declares`);
    eq(rig.s.priority ?? null, sc.priority ?? null, `${id}: and the priority it declares`);
    eq(rig.s.decision, null, `${id}: opens with no question already on the table`);
    ok(sc.needsLiveOpponent !== true, `${id}: is driveable with the scripted opponent alone`);
    ok(rig.legal().length > 0, `${id}: and the owner has a move the moment it opens`);
  }

  /* SEED INDEPENDENCE, because `/api/scenario/open` takes `&seed=`.
   *
   * The board is not supposed to depend on the seed — only the DECK is (see
   * main.ts's route comment). A scenario that quietly does depend on it works
   * when its author tests it and is a different board when the owner opens it,
   * which is `bad scenario` at best and a wasted round at worst. So this deals
   * every batch-D scenario at several seeds and compares everything the owner
   * can see: phase, priority, both hands, both resource rows, and every live
   * unit with its counters and its EFFECTIVE stats. The one seed-dependent
   * thing in the batch is which card Proph draws, which is why scenario 25's
   * observable is the hand COUNT and never the name. */
  {
    const seeds = [216216216, 1, 7, 99, 4294967291];
    const seen = (s: DState): string => {
      const e = new DE(s);
      return JSON.stringify({
        phase: s.phase, priority: s.priority ?? null, turn: s.turn, hasteDone: s.hasteDone,
        sides: [0, 1].map(seat => ({
          life: e.player(seat as 0 | 1).life,
          hand: e.player(seat as 0 | 1).hand,
          res: e.player(seat as 0 | 1).resources.map(r => `${String(r.kind)}:${String(r.state)}`),
          units: e.unitsOf(seat as 0 | 1)
            .map(u => `${u.card}+${u.counters}@${u.region}=${e.effStats(u).join('/')}`).sort(),
        })),
      });
    };
    for (const id of Object.keys(BATCH_D)) {
      const boards = new Set(seeds.map(seed =>
        seen(ddeal(seed, ['You', 'Tester Bot'], 'shared', dtrio(undefined), undefined, id).state)));
      eq(boards.size, 1,
        `${id}: deals the SAME board at ${seeds.length} different seeds — the deck may vary, the board may not`);
    }
  }

  /* THE GUARD `scenarios.ts` SAYS EXISTS AND DOES NOT.
   *
   * Its R218 batch-files note promises "`189-scenario-library.test.ts` asserts
   * the summed key count matches the merged one, so a collision fails loudly
   * instead of deleting somebody's scenario". There is no such file — 185, 186
   * and 187 are the only scenario tests in `engine/test/`, and nothing in the
   * repository reads the `BATCHES` export the promise is built on. With four
   * authors writing batches in parallel that is exactly the hazard the note
   * describes, so the check lives here until its own file exists. */
  {
    const summed = D_BATCHES.reduce((n, b) => n + Object.keys(b).length, 0);
    const merged = new Set(D_BATCHES.flatMap(b => Object.keys(b))).size;
    eq(merged, summed,
      `no two batches share a scenario id (${summed} keys across ${D_BATCHES.length} batches) `
      + '— a later spread would silently overwrite an earlier one');
  }

  // ── 20 Stalwart Sentinel: the ZONE is the only thing that differs ─────
  //
  // "[Augment] When you play a card from anywhere other than your hand, put
  // two +1/+1 counters on me." The same card is played twice in one window —
  // out of the hand, then out of the bin — so nothing but the zone can explain
  // a difference. `unreached.ts` files it BOARD: the drill plays from hand and
  // only from hand, so this has never fired in a game.
  {
    const r = new DRig('stalwart-sentinel-from-bin');
    eq(r.stats('Stalwart Sentinel', 0), '1/1', 'Stalwart Sentinel: opens as a printed 1/1');
    eq(r.counters('Stalwart Sentinel', 0), 0, 'Stalwart Sentinel: with no counters');
    eq(r.unit('Stalwart Sentinel', 0)?.region, r.s.battle?.region,
      'Stalwart Sentinel: and STANDING IN THE BATTLE — R12 scopes the play event to its region, '
      + 'and a Sentinel left at home hears nothing at all (measured, R218)');

    const beforeHandPlay = r.mark();
    r.play('Abyssal Evocation');
    r.pass();
    ok(r.said('Abyssal Evocation: You may play spells from their bin'),
      'Stalwart Sentinel: the hand play resolved and opened the bin');
    eq(r.counters('Stalwart Sentinel', 0), 0,
      'Stalwart Sentinel: THE NEGATIVE CONTROL — a card played from your HAND moves nothing');
    ok(!r.since(beforeHandPlay).some(l => l.includes('put two +1/+1 counters on me')),
      'Stalwart Sentinel: and the trigger did not even queue');

    const binIdx = r.s.players[0]!.bin.indexOf('Abyssal Evocation');
    ok(binIdx >= 0, 'Stalwart Sentinel: the spell is in your bin, where the second play comes from');
    r.act({ type: 'playFromBin', seat: 0, binIndex: binIdx } as DAction);
    r.pass();
    ok(r.said("Abyssal Evocation is played from You's bin"),
      'Stalwart Sentinel: the SAME card, this time out of the bin');
    eq(r.counters('Stalwart Sentinel', 0), 2,
      'Stalwart Sentinel: two +1/+1 counters — "anywhere other than your hand" is the bin');
    eq(r.stats('Stalwart Sentinel', 0), '3/3',
      'Stalwart Sentinel: and the card the owner is looking at reads 3/3');
  }

  // ── 21 Hooba-Lan: VOCAB — the card speaks, our checker has no word ────
  //
  // "[Augment] When I attack or block, create a Shard." `unreached.ts` files
  // it VOCAB: the Shard is a RESOURCE and the engine announces it with
  // `resourceActivated`, while EVIDENCE.create only names tokenCreated and
  // spawned. This block pins BOTH halves — that the Shard really arrives, and
  // that it arrives under the event type the ledger says it does — because the
  // scenario is asking the owner to confirm the card is fine, and a "works"
  // verdict is only evidence if what he confirmed is what we recorded.
  {
    const r = new DRig('hooba-lan-attack-shard');
    eq(r.res(0).length, 3, 'Hooba-Lan: three resources before the attack — the row is the observable');
    ok(!r.res(0).some(x => x.kind === 'shard'), 'Hooba-Lan: and none of them is a Shard');

    const before = r.mark();
    const atk = r.legal().find((a: any) => a.type === 'declareAttack' && a.columns.length > 0);
    ok(!!atk, 'Hooba-Lan: attacking with it is on offer');
    r.act(atk!);
    r.pass();

    eq(r.res(0).length, 4, 'Hooba-Lan: FOUR resources after — the Shard is really there');
    const shard = r.res(0).filter(x => x.kind === 'shard');
    eq(shard.length, 1, 'Hooba-Lan: exactly one Shard, not two');
    eq(shard[0]?.state, 'dormant', 'Hooba-Lan: dormant, as the reminder text promises');
    eq(r.res(1).length, 2, 'Hooba-Lan: and the OPPONENT gained nothing — "you" is its controller');
    ok(r.said('You creates a Shard (Hooba-Lan) — dormant.'),
      'Hooba-Lan: and the log tells the owner so in as many words');

    // the VOCAB claim itself, asserted rather than believed
    const since = r.since(before);
    ok(since.some(l => l.startsWith('[resourceActivated]')),
      'Hooba-Lan: the creation is announced as `resourceActivated`');
    ok(!since.some(l => l.startsWith('[tokenCreated]') || l.startsWith('[spawned]')),
      'Hooba-Lan: and NOT as tokenCreated or spawned — which is the whole of the VOCAB entry, '
      + 'and why the drill cannot see a card that is working perfectly well');
  }

  // ── 22 Null Drone: the branch the drill never takes ───────────────────
  //
  // "Negate target spell effect if its cost is less than or equal to the
  // greatest amount of life lost by a player in this battle." `unreached.ts`
  // files it CHOICE: the bait battle has lost nobody any life, so the
  // threshold is 0 and nothing ever clears it. Here 3 life are lost first and
  // the target costs exactly 3, which puts the printed "or EQUAL to" on its
  // boundary — the one place a `<`/`≤` slip is visible at all.
  {
    const r = new DRig('null-drone-negates');
    eq(r.life(1), 30, 'Null Drone: the opponent starts on 30');
    r.play('Seismomancy');
    r.aim(l => l === 'Tester Bot', 'the opponent himself');
    r.pass();
    eq(r.life(1), 27, 'Null Drone: 3 damage to the face — three life lost IN THIS BATTLE');

    r.play('Seismomancy');
    r.aim(l => l === 'Tester Bot', 'the opponent himself');
    eq(r.s.stack.length, 1, 'Null Drone: the second Seismomancy is waiting on the stack');
    eq(r.s.priority, 0, 'Null Drone: and priority came back to you with it still there');

    r.play('Null Drone');
    eq((r.s.decision?.options ?? []).length, 1,
      'Null Drone: exactly one thing on the stack to aim at — no wrong click available');
    r.aim(l => l.includes('Seismomancy'), 'the Seismomancy on the stack');
    r.pass();

    ok(r.said('Seismomancy is negated'),
      'Null Drone: cost 3 against 3 life lost — "less than or EQUAL to" is met, and it negates');
    ok(!r.said('not negated'),
      'Null Drone: the decline branch, which is the ONLY one the drill has ever reached, was not taken');
    eq(r.life(1), 27,
      'Null Drone: the opponent is still on 27 — 24 would mean the second Seismomancy resolved');
  }

  // ── 23 Keeper of Tithes: X is the EXPENDED ones ───────────────────────
  //
  // "[Augment] At the end of [Haste], if X is not 0, create an X/X unit, where
  // X is the number of expended resources you have." `unreached.ts` files it
  // BOARD because `fundSeat` refills the drill's seat with OPEN resources at
  // every window, so X is always 0. The owner expends three of eleven by
  // paying for something, and the three plausible misreadings each name a
  // different body: 8/8 (the open ones), 11/11 (the whole row), or nothing.
  {
    const r = new DRig('keeper-of-tithes-expended');
    eq(r.res(0).filter(x => x.state === 'expended').length, 0,
      'Keeper of Tithes: eleven resources, all open — X would be 0 right now');
    eq(r.tokens().length, 0, 'Keeper of Tithes: and no tokens on the table');

    r.play('Tidal Menace');
    eq(r.res(0).filter(x => x.state === 'expended').length, 3,
      'Keeper of Tithes: the Haste card cost 3, so three resources are expended');
    eq(r.res(0).filter(x => x.state === 'open').length, 8,
      'Keeper of Tithes: and eight are still open — deliberately a DIFFERENT number');

    const doneHaste = r.legal().find(a => a.type === 'doneHaste');
    ok(!!doneHaste, 'Keeper of Tithes: ending the Haste step is on offer');
    r.act(doneHaste!);

    const toks = r.tokens();
    eq(toks.length, 1, 'Keeper of Tithes: end of [Haste] created exactly one unit');
    eq(toks[0]?.controller, 0, 'Keeper of Tithes: yours');
    eq(toks[0]?.tokenStats, [3, 3],
      'Keeper of Tithes: a 3/3 — X is the EXPENDED count, not the open 8 and not the row of 11');
    ok(!r.said('no expended resources'),
      'Keeper of Tithes: the X = 0 announcement — all the drill has ever seen — was not made');
  }

  // ── 24 Debt Plant: the only division in the pair ──────────────────────
  //
  // "[Augment] At the end of [Haste], your units gain +1/+1 until regroup for
  // every 2 expended resources you have." Same BOARD blocker as Keeper of
  // Tithes and a different clause: this one DIVIDES. Seven is expended on
  // purpose — 7/2 is 3.5, so the printed "for every 2" has to floor it. +4/+4
  // is rounding the wrong way, +7/+7 is paying per resource, +2/+2 is counting
  // the five still open.
  {
    const r = new DRig('debt-plant-expended');
    eq(r.stats('Debt Plant', 0), '3/2', 'Debt Plant: opens as a printed 3/2');
    eq(r.stats('The Foretold', 0), '3/3', 'Debt Plant: beside a printed 3/3');

    r.play('Tithe Enforcer');
    eq(r.res(0).filter(x => x.state === 'expended').length, 7,
      'Debt Plant: the Haste card cost 7, so seven resources are expended');
    eq(r.res(0).filter(x => x.state === 'open').length, 5, 'Debt Plant: and five are still open');
    eq(r.stats('Tithe Enforcer', 0), '4/6', 'Debt Plant: the new body is a printed 4/6, for now');

    r.act(r.legal().find(a => a.type === 'doneHaste')!);

    eq(r.stats('Debt Plant', 0), '6/5',
      'Debt Plant: Debt Plant is 6/5 — seven expended is three whole pairs, and the leftover buys nothing');
    eq(r.stats('The Foretold', 0), '6/6', 'Debt Plant: +3/+3 reached "your units", not just itself');
    eq(r.stats('Tithe Enforcer', 0), '7/9',
      'Debt Plant: including the one bought DURING the Haste step it is counting the cost of');
    eq(r.stats('Bubb', 1), '5/6', 'Debt Plant: and nothing of the opponent\'s moved');
  }

  // ── 25 Proph: played from the CACHE, where the zone marker is stamped ──
  //
  // "When you play a card from anywhere other than your hand, [Switch1] Draw a
  // card." `unreached.ts` files it BOARD ("every press play is from hand") —
  // and Proph is one of the five entries written there as a BARE UNQUOTED KEY,
  // which is how an earlier scrape reported 32 unreached cards where the object
  // holds 37. Untested twice over, for two unrelated reasons.
  //
  // ⚠ The prophecy release is used rather than a mid-resolution play on
  // purpose: a card played mid-resolution carries NO zone marker, Proph reads
  // that blank as "from hand", and whether that is right is round-27 Q4 and
  // still unanswered. A scenario must not quietly decide an open question, so
  // this one exercises the settled route (R42/R45) and the `expect` line asks
  // Q4 separately, in the owner's own words.
  {
    const r = new DRig('proph-from-cache');
    eq(r.hand(0), ['The Foretold', 'Air Plant'], 'Proph: the hand is exactly the two cards');

    const proph = r.legal().find((a: any) => a.type === 'prophesy'
      && r.s.players[0]!.hand[(a as any).index] === 'Air Plant');
    ok(!!proph, 'Proph: prophesying Air Plant is on offer in deployment (R42)');
    r.act(proph!);
    ok(r.said('prophecy on Air Plant is fulfilled'),
      'Proph: and it is fulfilled the instant it is cached — four units, four unique printed costs');

    const beforeHandPlay = r.mark();
    r.play('The Foretold');
    eq(r.hand(0), [], 'Proph: THE NEGATIVE CONTROL — a card played from your HAND, and your hand is now empty');
    ok(!r.since(beforeHandPlay).some(l => l.startsWith('[draw]')),
      'Proph: nothing was drawn — that play came from the hand, which the clause excludes');

    const cached = r.legal().find(a => a.type === 'playCached');
    ok(!!cached, 'Proph: the fulfilled prophecy is releasable from the cache');
    r.act(cached!);
    ok(r.said('Trigger: Proph — draw a card'),
      'Proph: a card played from the CACHE is "anywhere other than your hand"');
    eq(r.hand(0).length, 1,
      'Proph: and the hand goes from empty to exactly one card — the difference is unmissable');
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * R218 — BATCH B, FROZEN (docs/14 §6: "a verdict is not a report, it is a
 * test").
 *
 * Six scenarios off `ledgers/unreached.ts` — Automaton of Abundance,
 * Scholar of the Void, Necromantic Rebuke, Stellarspore Harvester, Vengeance
 * and Worldbender — each driven through the REAL action path (`dealScenario`,
 * `apply`, `forcedAction`, and `passiveMove` for seat 1: the same four pieces
 * a live room uses) to the exact observable its `expect` line promises the
 * owner. docs/14 §9 puts "scenarios that are wrong" first among the ways this
 * instrument fails, and the price of one is ninety seconds of the rules
 * authority's time spent on a `bad scenario` verdict that says nothing about a
 * card. Nothing below was predicted; every number is read off a drive.
 *
 * ⚠ WHY THIS BLOCK IS SYNCHRONOUS — the same reason batch C's above it is, and
 * it is worth stating twice because it is the only thing keeping four appended
 * batches from racing each other. `main()` is already in flight (called at
 * module top level, first statement an `await`), so control is back here while
 * it waits on a server; a synchronous block therefore runs to completion
 * BEFORE main() resumes and long before its `process.exit`. It shares the same
 * `failures` counter, so a red assertion here fails
 * `npm --prefix server test` exactly like a red one inside main().
 *
 * ⚠ AND THE POSITIVE CONTROL (docs/14 §9: "freezing a `works` verdict into a
 * test that cannot fail is §5 with extra steps"). Broken and reverted while
 * writing this: changing the Automaton expectation from 5 tokens to 4 reddens
 * with `✗ Automaton of Abundance: FIVE tokens … (got 5, want 4)` and the run
 * exits 1; so does moving Worldbender's 27 to 28.
 *
 * ⚠ `vengeance-taxes-their-play` is the one scenario here that is NOT driven by
 * the scripted bot, because it honestly cannot be: the clause only fires on a
 * card the OPPONENT plays and the bot's whole contract is that it never plays
 * one. Its rig drives seat 1 by hand, exactly as the owner will in a second
 * tab — which is also what makes `needsLiveOpponent: true` a checked claim
 * rather than a note.
 */
import { apply as bapply, forcedAction as bforced, legalActions as blegal, sanitizeTrio as btrio } from '../engine/src/apply.ts';
import { BATCH_B } from './scenarios-b.ts';
import { dealScenario as bdeal, passiveMove as bpassive, OPPONENT as B_OPP, YOU as B_YOU } from './scenarios.ts';
import type { Action as BAction, GameState as BState } from '../engine/src/types.ts';

{
  console.log('\nR218 batch B — six unreached promises, driven to their observable');

  /** One scenario room, off the real choke point, with the arguments
   * /api/scenario/open passes (mode 'shared', default trio, its fixed seed).
   *
   * `live` mirrors main.ts's `botDrives`: a scenario that declares it needs a
   * second human gets no scripted opponent here either, so the drive below is
   * the drive the owner will actually have. */
  class BRig {
    s: BState;
    log: string[] = [];
    private live: boolean;
    constructor(id: string) {
      this.live = BATCH_B[id]?.needsLiveOpponent === true;
      const r = bdeal(216216216, ['You', 'Tester Bot'], 'shared', btrio(undefined), undefined, id);
      this.s = r.state;
      for (const e of r.events) this.log.push(`[${e.type}] ${e.msg}`);
      this.forced(); this.bot();
    }
    private absorb(r: { state: BState; events: { type: string; msg: string }[] }): void {
      this.s = r.state;
      for (const e of r.events) this.log.push(`[${e.type}] ${e.msg}`);
    }
    /** the engine's own auto-submits, which the server applies for both seats */
    private forced(): void {
      for (let i = 0; i < 40; i++) {
        const f = bforced(this.s);
        if (!f) return;
        this.absorb(bapply(this.s, f));
      }
    }
    /** THE REAL SCRIPTED OPPONENT: main.ts's loop without the room
     * bookkeeping, and `passiveMove` itself rather than a copy of its
     * preference order (a copy would make this a check on the copy — docs/13
     * §5 lists that shape twice). */
    private bot(): void {
      if (this.live) return;
      for (let step = 0; step < 60; step++) {
        if (this.s.phase === 'gameover') return;
        const pick = bpassive(blegal(this.s, B_OPP));
        if (!pick) return;
        this.absorb(bapply(this.s, pick));
        this.forced();
      }
      throw new Error('batch B: the scripted opponent hit its 60-step cap');
    }
    /** an action by the OWNER (seat 0), then the bot, then any auto-submits */
    act(a: BAction): void { this.absorb(bapply(this.s, a)); this.forced(); this.bot(); }
    /** an action by SEAT 1, for the one scenario that has a human there */
    actOpp(a: BAction): void { this.absorb(bapply(this.s, a)); this.forced(); }
    legal(seat: 0 | 1 = 0): BAction[] { return blegal(this.s, seat as typeof B_YOU); }
    said(s: string): boolean { return this.log.some(l => l.includes(s)); }
    life(seat: 0 | 1): number { return this.s.players[seat]!.life; }
    hand(seat: 0 | 1 = 0): string[] { return [...this.s.players[seat]!.hand]; }
    bin(seat: 0 | 1 = 0): string[] { return [...this.s.players[seat]!.bin]; }
    /** every live unit a seat controls, BY NAME and sorted — the observable
     *  most of this batch is measured in */
    units(seat: 0 | 1): string[] {
      return Object.values(this.s.entities as Record<string, any>)
        .filter(e => e.kind === 'unit' && e.controller === seat && !e.absent)
        .map(e => String(e.card)).sort();
    }
    unit(card: string, seat?: 0 | 1): any {
      return Object.values(this.s.entities as Record<string, any>)
        .find(e => e.card === card && !e.absent && (seat === undefined || e.controller === seat));
    }
    tokens(seat: 0 | 1): any[] {
      return Object.values(this.s.entities as Record<string, any>)
        .filter(e => e.kind === 'unit' && e.token && !e.absent && e.controller === seat);
    }
    labels(): string[] {
      return ((this.s.decision?.options ?? []) as { label?: string }[]).map(o => String(o.label ?? ''));
    }
    /** answer the open decision by the option LABEL the runner shows the owner,
     *  never by a raw index — an index silently means something else after a
     *  menu changes, and a scenario that quietly answers a different question
     *  is worse than one that fails */
    pick(sub: string, seat: 0 | 1 = 0): void {
      const i = this.labels().findIndex(l => l.includes(sub));
      if (i < 0) throw new Error(`batch B: no option matching "${sub}"; menu = ${JSON.stringify(this.labels())}`);
      const a = { type: 'decide', seat, choice: i } as BAction;
      if (seat === 1) this.actOpp(a); else this.act(a);
    }
    play(card: string, seat: 0 | 1 = 0): void {
      const i = this.s.players[seat]!.hand.indexOf(card);
      if (i < 0) throw new Error(`batch B: ${card} is not in seat ${seat}'s hand`);
      const a = { type: 'playCard', seat, handIndex: i } as BAction;
      if (seat === 1) this.actOpp(a); else this.act(a);
    }
    augment(card: string, hostCard: string): void {
      const i = this.s.players[0]!.hand.indexOf(card);
      const host = this.unit(hostCard, 0);
      const offer = this.legal().find(a => a.type === 'augment'
        && (a as any).index === i && (a as any).hostId === host?.id);
      if (!offer) throw new Error(`batch B: augmenting ${card} onto ${hostCard} is not offered`);
      this.act(offer);
    }
    pass(): void { this.act({ type: 'passPriority', seat: 0 } as BAction); }
    mods(card: string, seat?: 0 | 1): string[] {
      const u = this.unit(card, seat);
      return ((u?.mods ?? []) as number[]).map(m => String((this.s.entities as any)[m]?.card ?? m));
    }
  }

  /** THE ANTI-ROT SWEEP (docs/14 §9), over the whole batch at once: every
   * scenario deals, lands where it DECLARES it lands, opens with no unanswered
   * decision (186-scenario-library §1 asserts the same thing), and hands the
   * owner something to do. Derived over `BATCH_B`, so a seventh scenario is
   * covered the day it is added. */
  for (const [id, sc] of Object.entries(BATCH_B)) {
    const rig = new BRig(id);
    eq(rig.s.phase, sc.phase, `${id}: deals into the phase it declares`);
    eq(rig.s.priority ?? null, sc.priority ?? null, `${id}: and the priority it declares`);
    eq(rig.s.decision, null, `${id}: opens with no unanswered decision`);
    eq(rig.hand(0), sc.you.hand, `${id}: and with the hand it puts on screen`);
    const mine = rig.legal(0).length, theirs = rig.legal(1).length;
    ok(sc.needsLiveOpponent === true ? theirs > 0 : mine > 0,
      `${id}: the table is waiting on ${sc.needsLiveOpponent ? 'seat 1, which it says it needs' : 'the owner'}`);
  }

  // ── Automaton of Abundance: the "instead", DONATED onto a host ────────
  //    unreached.ts: "a token creation by the HOST's controller while the
  //    augment is on, which no beat provides". Report #60 is the regression
  //    this pins: per-spawn copying would make it eight.
  {
    const r = new BRig('automaton-augmented-batch');
    r.augment('Automaton of Abundance', 'The Foretold');
    eq(r.mods('The Foretold', 0), ['Automaton of Abundance'],
      'Automaton of Abundance: it is riding the host, not standing as its own body');
    ok(r.legal().some(a => a.type === 'playCard'),
      'Automaton of Abundance: Sylvan Sprouting is still payable after the augment');
    r.play('Sylvan Sprouting');
    eq(r.tokens(0).length, 5,
      'Automaton of Abundance: FIVE tokens — four printed by four wood, plus ONE for the one '
      + 'unique token (report #60: per-spawn copying gives eight)');
    ok(r.said('Automaton of Abundance: the creation is replaced'),
      'Automaton of Abundance: and the replacement said so out loud');
    eq(r.tokens(1).length, 0, 'Automaton of Abundance: nothing was created for the opponent');
  }

  // ── Scholar of the Void: the offer no driver takes ────────────────────
  //    unreached.ts: "CHOICE — the trigger fires and resolves; the offer is
  //    declined." Here it is accepted, in a real game, for the first time.
  {
    const r = new BRig('scholar-transforms');
    ok(r.legal().some(a => a.type === 'playCard'),
      'Scholar of the Void: the R18 haste step opened and it is playable in it');
    r.play('Scholar of the Void');
    eq(r.units(0), ['Scholar of the Void'], 'Scholar of the Void: it arrives as its own 0/2 body');
    r.act({ type: 'doneHaste', seat: 0 } as BAction);
    eq(r.s.phase, 'battle', 'Scholar of the Void: the haste step ends into the battle');
    r.act({ type: 'declareAttack', seat: 0, columns: [] } as BAction);
    eq(r.s.phase, 'deploy', 'Scholar of the Void: both rounds declined, deployment begins');
    eq(r.s.decision?.seat, 0, 'Scholar of the Void: and the start-of-deployment offer is YOURS');
    ok(r.labels().some(l => l.includes('Decline')),
      'Scholar of the Void: declining is on the menu — this is a "you may", and the owner is '
      + 'being asked to take the half no play-through ever has');
    r.pick('transform into Beyond, Codex Incarnate');
    eq(r.units(0), ['Beyond, Codex Incarnate'],
      'Scholar of the Void: THE CLAUSE — the body on the board turned over into the 8/3');
    eq(r.hand(0), [], 'Scholar of the Void: and the whole hand was the price');
    eq(r.bin(0).sort(), ['Manufacture', 'The Foretold'],
      'Scholar of the Void: both cards are in the bin (a discard is a trash, R40)');
  }

  // ── Necromantic Rebuke: the ransom REFUSED ────────────────────────────
  //    unreached.ts: "CHOICE — the controller is offered the escape and takes
  //    it." Every driver in the repo pays; this one refuses, which is the only
  //    way the printed negate has ever happened.
  {
    const r = new BRig('rebuke-refused');
    eq(r.bin(0), ['The Foretold', 'The Foretold'],
      'Necromantic Rebuke: the prologue traded two bodies into your bin — X has something to '
      + 'be paid out of, and NO hand card was spent doing it');
    eq(r.units(0).length, 1, 'Necromantic Rebuke: one attacker survived that combat');
    eq(r.life(1), 27, 'Necromantic Rebuke: and the unblocked column got through');
    r.play('Luminous Arc');
    eq(r.labels().length, 1,
      "Necromantic Rebuke: the Arc's only legal target is your own survivor — the setup cannot "
      + 'be misclicked');
    r.pick('The Foretold');
    eq(r.s.stack.map(i => i.label), ['Luminous Arc'], 'Necromantic Rebuke: your own Arc is on the stack');
    r.play('Necromantic Rebuke');
    ok(String(r.s.decision?.prompt).includes('erase X cards from your bin'),
      'Necromantic Rebuke: X is an ADDITIONAL COST asked at cast (R64), not at resolution');
    r.pick('The Foretold');                      // erase one → X = 1
    ok(String(r.s.decision?.prompt).includes('X = 1 so far'), 'Necromantic Rebuke: X is now 1');
    r.pick("That's enough");
    ok(String(r.s.decision?.prompt).includes('negate up to one target effect'),
      'Necromantic Rebuke: then it asks what to negate');
    ok(r.labels().some(l => l.includes('Luminous Arc')),
      'Necromantic Rebuke: your OWN effect is on the menu — "up to one target effect" carries no '
      + 'ownership qualifier, and this is what puts the refusal in one pair of hands');
    r.pick('Luminous Arc');
    r.pass();
    eq(r.s.decision?.kind, 'payOrDecline',
      'Necromantic Rebuke: the ransom is offered at resolution');
    eq(r.s.decision?.seat, 0,
      'Necromantic Rebuke: to YOU — the targeted effect is yours, so the choice is yours');
    eq(r.labels()[0], 'erase 1',
      'Necromantic Rebuke: and "erase 1" is option 0, which is exactly why no driver has ever '
      + 'seen the other branch');
    r.pick('let it be negated');
    ok(r.said('Luminous Arc is negated'), 'Necromantic Rebuke: THE CLAUSE — the effect is negated');
    eq(r.units(0), ['The Foretold'],
      'Necromantic Rebuke: your 3/3 is still standing — 6 damage never happened');
    eq(r.unit('The Foretold', 0)?.damage ?? 0, 0, 'Necromantic Rebuke: and undamaged');
    eq(r.bin(0).filter(c => c === 'The Foretold').length, 1,
      'Necromantic Rebuke: exactly ONE bin card was erased — the cast cost. Refusing the ransom '
      + 'must not erase a second');
  }

  // ── Stellarspore Harvester: the after-combat theft ────────────────────
  //    unreached.ts: "the minus counters the fixture places do not survive to
  //    that step on a unit that is still a legal target."
  {
    const r = new BRig('stellarspore-steals');
    eq(r.unit('Hammer of Justice', 1)?.counters, -1,
      'Stellarspore Harvester: their Hammer carries the -1/-1 counter');
    eq(r.s.battle?.step, 'blockWindow', 'Stellarspore Harvester: the block is already declined');
    r.pass();
    eq(r.life(1), 27, 'Stellarspore Harvester: one pass and combat damage happened');
    ok(String(r.s.decision?.prompt).includes('gain control of target unit'),
      'Stellarspore Harvester: the after-combat clause fired — the Harvester is standing in the '
      + 'battle region it marched into (R12/R199)');
    eq(r.labels().length, 3,
      'Stellarspore Harvester: the menu is EVERY unit in the battle, clean ones included — '
      + 'R157 §15, "you can target any enemy, it only checks on resolution"');
    r.pick('Hammer of Justice');
    r.pass();
    eq(r.units(0), ['Hammer of Justice', 'Stellarspore Harvester'],
      'Stellarspore Harvester: THE CLAUSE — the countered unit is YOURS now');
    eq(r.units(1), ['The Foretold'],
      'Stellarspore Harvester: and the CLEAN unit stayed theirs');
    ok(r.said('You gains control of Hammer of Justice'), 'Stellarspore Harvester: through E.giveControl (R112)');
  }

  // ── Vengeance: the imposed cost on somebody ELSE's play ───────────────
  //    unreached.ts: "the drill never has the opponent play a card while the
  //    augment is on." Neither can the scripted bot — hence the second tab,
  //    and hence seat 1 being driven by hand here.
  {
    const r = new BRig('vengeance-taxes-their-play');
    eq(r.legal(0).length, 0,
      'Vengeance: the owner has nothing to do — the table is on seat 1, which is what '
      + 'needsLiveOpponent is declaring');
    eq(r.units(0), ['Vengeance'], 'Vengeance: it is attacking, so its text stands in the battle it taxes');
    ok(r.legal(1).some(a => a.type === 'playCard'), 'Vengeance: seat 1 may play its card');
    r.play('Sudden Bloom', 1);
    eq(r.s.decision?.seat, 1,
      'Vengeance: THE CLAUSE — the demand lands on THEM, not on you ("your opponents")');
    ok(String(r.s.decision?.prompt).includes('sacrifice a unit'),
      'Vengeance: and it is the printed [Sacrifice a unit]');
    eq(r.labels().length, 2, 'Vengeance: both of their units are offered — the payer chooses');
    eq(r.s.stack.length, 0,
      'Vengeance: the spell is NOT on the stack yet — an imposed cost is paid in the cast window');
    r.pick('The Foretold', 1);
    eq(r.units(1), ['Bubb'], 'Vengeance: the sacrificed unit is off their board');
    eq(r.bin(1), ['The Foretold'], 'Vengeance: and in their bin — a real death, not an erase');
    eq(r.s.stack.map(i => i.label), ['Sudden Bloom'], 'Vengeance: only then does the spell reach the stack');
    eq(r.units(0), ['Vengeance'], 'Vengeance: and nothing of yours was asked for');
  }

  // ── Worldbender: the card step, replaced ──────────────────────────────
  //    unreached.ts: "'skip your draft step' only exists in a drafted game;
  //    the drill plays constructed." A scenario room is mode 'shared', which
  //    R162 folded into the CONSTRUCTED branch — 3 cards and 3 life.
  {
    const r = new BRig('worldbender-card-step');
    eq(r.s.deployDone, [false, true], 'Worldbender: seat 1 has already finished deploying');
    ok(r.legal().some(a => a.type === 'playCard'), 'Worldbender: it is payable with the mana dealt');
    r.play('Worldbender');
    eq(r.units(0), ['Worldbender'], 'Worldbender: a 2/2 {Feeble} body, deployed for real');
    eq([r.life(0), r.hand(0).length, r.life(1), r.hand(1).length], [30, 0, 30, 0],
      'Worldbender: before the turn rolls, both seats are on 30 with empty hands');
    r.act({ type: 'doneDeploying', seat: 0 } as BAction);
    eq(r.s.turn, 2, 'Worldbender: the turn rolled');
    eq([r.life(0), r.hand(0).length], [27, 3],
      'Worldbender: THE CLAUSE — three cards and three life, the constructed branch '
      + '(report #87, R162). The DRAFT branch would be one card and no life.');
    eq([r.life(1), r.hand(1).length], [30, 2],
      'Worldbender: the opponent, on the same turn, took the ordinary card step');
    ok(r.said('Worldbender: You skips the draw phase'), 'Worldbender: and it announced itself');
  }
}

/**
 * R220 — BATCH E, FROZEN (docs/14 §6: "a verdict is not a report, it is a
 * test").
 *
 * EIGHT CONJUNCTIONS. Batches A–D were ranked on `UNREACHED` — "the drill has
 * never observed this promise" — which measures the FIXTURE'S inability to
 * stage a board and not risk, and the owner said so after running three of
 * them ("generic tests of basic game functions … basic shit that has been
 * working in all our games so far"). Batch E is ranked on how rare the ACTION
 * is in the 23 real saved games instead — `prophesy` has fired twice in the
 * project's history, `playCached` ten times, `graft` thirty-six — and every
 * board puts TWO RULES IN CONTACT rather than checking one clause.
 *
 * Each block below drives its scenario through the REAL action path —
 * `dealScenario`, `apply`, and `passiveMove` for seat 1, the same three pieces
 * the live room uses — and asserts the concrete observable its `expect` line
 * promises the owner. Every number here was read off a real drive before it was
 * written down, never predicted.
 *
 * ⚠ ONE OF THESE IS NOT A CONFIRMATION, AND IS PINNED AS-IS ON PURPOSE.
 * `wispweaver-wisps-attack-alone` asserts that three Wisps DO sacrifice
 * themselves while their Infernal Wispweaver is standing at home, because that
 * is what this engine does: the printed line ("Your wisps … do not sacrifice
 * themselves after combat") carries no region qualifier, and R12 scopes every
 * static to its own region (`E.staticsFor`: `a.region === target.region`), so
 * sending the wisps into the defender's region turns their protector off. The
 * assertions below therefore pin CURRENT BEHAVIOUR next to the printed text
 * they contradict — if the owner rules the other way, this block is the failing
 * test that proves the fix, which is docs/14 §6 exactly.
 *
 * ⚠ WHY THIS BLOCK IS SYNCHRONOUS: same as batch C's. `main()` above is already
 * suspended on its first `await`, so a synchronous block runs to completion
 * before it resumes and before its `process.exit(failures ? 1 : 0)`. It shares
 * the same `failures` counter, spawns no server, opens no socket and touches no
 * file.
 *
 * ⚠ AND THE POSITIVE CONTROL (docs/14 §9: "freezing a `works` verdict into a
 * test that cannot fail is §5 with extra steps"). Broken and reverted while
 * writing this: changing the Harbinger's surviving-token expectation from
 * `['Fireball 2', 'Fireball 3']` to `['Fireball 1']` reddens with
 * `✗ Harbinger: the board ends on a Fireball 3 AND a Fireball 2`, and the run
 * exits 1.
 */
import { apply as eapply, forcedAction as eforced, legalActions as elegal, sanitizeTrio as etrio } from '../engine/src/apply.ts';
import { E as EEng } from '../engine/src/engine.ts';
import { BATCH_E } from './scenarios-e.ts';
import { dealScenario as edeal, passiveMove as epassive, OPPONENT as E_OPP } from './scenarios.ts';
import type { Action as EAction, GameState as EState } from '../engine/src/types.ts';

{
  console.log('\nR220 batch E — eight conjunctions, each driven to the join');

  /** One scenario room off the real choke point, with the arguments
   * `/api/scenario/open` passes (mode 'shared', default trio, its fixed seed). */
  class ERig {
    s: EState;
    log: string[] = [];
    constructor(id: string, seed = 216216216) {
      const r = edeal(seed, ['You', 'Tester Bot'], 'shared', etrio(undefined), undefined, id);
      this.s = r.state;
      for (const e of r.events) this.log.push(`[${e.type}] ${e.msg}`);
      this.forced(); this.bot();
    }
    private absorb(r: { state: EState; events: { type: string; msg: string }[] }): void {
      this.s = r.state;
      for (const e of r.events) this.log.push(`[${e.type}] ${e.msg}`);
    }
    private forced(): void {
      for (let i = 0; i < 40; i++) {
        const f = eforced(this.s);
        if (!f) return;
        this.absorb(eapply(this.s, f));
      }
    }
    /** THE REAL SCRIPTED OPPONENT: main.ts's loop minus the room bookkeeping,
     * and `passiveMove` itself rather than a copy of its preference order — a
     * copy would make this a check on the copy (docs/13 §5). */
    private bot(): void {
      for (let step = 0; step < 80; step++) {
        if (this.s.phase === 'gameover') return;
        const pick = epassive(elegal(this.s, E_OPP));
        if (!pick) return;
        this.absorb(eapply(this.s, pick));
        this.forced();
      }
      throw new Error('batch E: the scripted opponent hit its 80-step cap');
    }
    act(a: EAction): void { this.absorb(eapply(this.s, a)); this.forced(); this.bot(); }
    legal(seat: 0 | 1 = 0): EAction[] { return elegal(this.s, seat); }
    /** the FIRST legal action of a type, optionally narrowed — never a
     * hand-built action, so a rules change that stops offering it fails here
     * rather than being applied behind `legalActions`' back */
    pick(t: string, pred: (a: any) => boolean = () => true): EAction {
      const hit = this.legal().find(a => a.type === t && pred(a));
      if (!hit) {
        throw new Error(`batch E: no legal ${t}; seat 0 has `
          + JSON.stringify(this.legal().map(a => a.type)));
      }
      return hit;
    }
    do(t: string, pred?: (a: any) => boolean): void { this.act(this.pick(t, pred)); }
    said(s: string): boolean { return this.log.some(l => l.includes(s)); }
    life(seat: 0 | 1): number { return this.s.players[seat]!.life; }
    hand(seat: 0 | 1 = 0): string[] { return [...this.s.players[seat]!.hand]; }
    bin(seat: 0 | 1 = 0): string[] { return [...this.s.players[seat]!.bin]; }
    erased(seat: 0 | 1 = 0): string[] { return [...((this.s.players[seat] as any).erased ?? [])]; }
    cache(seat: 0 | 1 = 0): any[] { return [...((this.s.players[seat] as any).cache ?? [])]; }
    debt(seat: 0 | 1 = 0): number { return (this.s.players[seat] as any).debt ?? 0; }
    openMana(seat: 0 | 1 = 0): number {
      return this.s.players[seat]!.resources.filter(r => r.state === 'open').length;
    }
    unit(card: string, seat?: 0 | 1): any {
      return Object.values(this.s.entities as Record<string, any>)
        .find(e => e.kind === 'unit' && e.card === card && !e.absent
          && (seat === undefined || e.controller === seat));
    }
    units(seat: 0 | 1): string[] {
      return Object.values(this.s.entities as Record<string, any>)
        .filter(e => e.kind === 'unit' && e.controller === seat && !e.absent)
        .map(e => String(e.card)).sort();
    }
    /** spell tokens by name and X, sorted — the observable ① is measured in */
    spellTokens(seat: 0 | 1): string[] {
      return Object.values(this.s.entities as Record<string, any>)
        .filter(e => e.kind === 'spellToken' && e.controller === seat && !e.absent)
        .map(e => `${e.card} ${e.x ?? ''}`.trimEnd()).sort();
    }
    /** the live projected stat line, which is what the owner reads off a card */
    stats(card: string, seat?: 0 | 1): string {
      const u = this.unit(card, seat);
      return u ? new EEng(this.s).effStats(u).join('/') : 'gone';
    }
    flying(card: string, seat?: 0 | 1): boolean {
      const u = this.unit(card, seat);
      return !!u && new EEng(this.s).ownAttrs(u).has('Flying');
    }
    /** the cards a `playCard` offer would let the owner play, BY NAME */
    playable(): string[] {
      return this.legal().filter(a => a.type === 'playCard')
        .map(a => this.hand()[(a as any).handIndex] as string).sort();
    }
    labels(): string[] {
      return ((this.s.decision?.options ?? []) as { label?: string }[]).map(o => String(o.label ?? ''));
    }
    /** answer the open decision by the option LABEL the runner shows, never by
     * a raw index — an index silently means something else after a menu moves */
    aim(sub: string): void {
      const i = this.labels().findIndex(l => l.includes(sub));
      if (i < 0) throw new Error(`batch E: no option matching "${sub}"; menu = ${JSON.stringify(this.labels())}`);
      this.act({ type: 'decide', seat: 0, choice: i } as EAction);
    }
    /** click through, the way the owner would, until a phase (and optionally a
     * turn) is reached */
    passTo(phase: string, turn?: number): void {
      for (let i = 0; i < 40; i++) {
        if (this.s.phase === phase && (turn === undefined || this.s.turn === turn)) return;
        const l = this.legal();
        const p = l.find(a => a.type === 'passPriority') ?? l.find(a => a.type === 'declareBlocks')
          ?? l.find(a => a.type === 'declareAttack') ?? l.find(a => a.type === 'doneHaste')
          ?? l.find(a => a.type === 'doneDeploying') ?? l.find(a => a.type === 'donePlanning') ?? l[0];
        if (!p) throw new Error(`batch E: nothing legal for seat 0 in ${this.s.phase}`);
        this.act(p);
      }
      throw new Error(`batch E: never reached ${phase}`);
    }
  }

  /** THE BOARD A SCENARIO OPENS ON, as the owner sees it — everything except
   * the deck and bin, which the seed legitimately owns. */
  const eBoard = (s: EState): string => JSON.stringify({
    phase: s.phase, prio: s.priority ?? null, turn: s.turn, initiative: s.initiative,
    hasteDone: s.hasteDone, battle: s.battle, present: s.regions.map(r => r.presentSeats),
    players: s.players.map((p: any) => ({
      life: p.life, rot: p.rot ?? 0, debt: p.debt ?? 0,
      hand: p.hand, res: p.resources, cache: p.cache ?? [],
    })),
    entities: Object.values(s.entities as Record<string, any>).map(e => ({
      id: e.id, card: e.card, kind: e.kind, seat: e.controller, region: e.region,
      counters: e.counters ?? 0, token: !!e.token, x: e.x ?? null,
    })),
    stack: s.stack.length, decision: s.decision?.kind ?? null,
  });

  /* THE ANTI-ROT SWEEP (docs/14 §9) over the whole batch at once: every
   * scenario deals, lands where it DECLARES it lands, opens with no unanswered
   * decision, hands the owner something to do — and opens on the SAME BOARD
   * whatever seed the room was given.
   *
   * ⚠ THE SEED SWEEP IS THE LOAD-BEARING ONE, and it is wider here than in the
   * other batches (EIGHT seeds) because three of these scenarios are ABOUT a
   * turn boundary and it would be very easy to reach for a prologue that walks
   * across one. A prologue that does draws cards, and a drawn card is
   * seed-dependent: the owner would then open a different board from the one
   * that was tested. Every batch-E prologue stays inside turn 1, and the OWNER
   * crosses the boundary himself; this loop is what keeps that true. */
  const E_SEEDS = [1, 7, 99, 4242, 216216216, 999983, 31337, 2];
  for (const [id, sc] of Object.entries(BATCH_E)) {
    const rig = new ERig(id);
    eq(rig.s.phase, sc.phase, `${id}: deals into the phase it declares`);
    eq(rig.s.priority ?? null, sc.priority ?? null, `${id}: and the priority it declares`);
    eq(rig.s.decision, null, `${id}: opens with no unanswered decision`);
    eq(rig.hand(0), sc.handAfterPrologue ?? sc.you.hand, `${id}: and with the hand it puts on screen`);
    ok(rig.legal(0).length > 0, `${id}: the table is waiting on the OWNER, not on seat 1`);
    ok(sc.needsLiveOpponent !== true, `${id}: is driveable with the scripted opponent alone`);
    const seen = new Set(E_SEEDS.map(seed => eBoard(
      edeal(seed, ['You', 'Tester Bot'], 'shared', etrio(undefined), undefined, id).state)));
    eq(seen.size, 1, `${id}: one board across ${E_SEEDS.length} seeds — the owner opens what was tested`);
  }

  // ── ① Harbinger of Immolation: R11's regroup erase MEETS a static that
  //    spares it, with the token standing in the ENEMY region when the step
  //    begins — and the survivor then feeds the Harbinger's own X.
  {
    const r = new ERig('harbinger-tokens-through-regroup');
    eq(r.s.hasteDone, [false, true],
      'Harbinger: the board opens INSIDE the haste step, which is where the token is made');
    r.do('playCard');                                   // Molten Upheaval
    eq(r.spellTokens(0), ['Fireball 3'], 'Harbinger: Molten Upheaval left a Fireball 3');
    r.do('doneHaste');
    const fb = Object.values(r.s.entities as Record<string, any>).find(e => e.kind === 'spellToken')!;
    const ft = r.unit('The Foretold', 0)!;
    // the token RIDES OUT with the formation (R87) — this is what puts it in
    // the defender's region when regroup starts, which is the whole point
    r.act({ type: 'declareAttack', seat: 0, columns: [[ft.id]], spellTokens: [fb.id] } as EAction);
    eq((r.s.entities as any)[fb.id].region, 1,
      'Harbinger: the Fireball rode out — it is standing in THEIR region, not next to its protector');
    r.passTo('planning', 2);
    ok(r.said('spell token(s) stay through regroup'),
      'Harbinger: THE CLAUSE — regroup announced that a token was spared');
    ok(!r.said('unused spell token(s) to regroup'),
      'Harbinger: and nothing was erased for it to announce the other way');
    eq(r.spellTokens(0), ['Fireball 2', 'Fireball 3'],
      'Harbinger: the board ends on a Fireball 3 AND a Fireball 2 — the 3 survived the '
      + 'regroup, and the end-of-turn X counted it (1 + 1). Without the static the 3 is '
      + 'erased and the second token is a Fireball 1.');
    eq((r.s.entities as any)[fb.id].region, 0,
      'Harbinger: and the survivor came HOME — R11 step (1) moves spell tokens too, which is '
      + 'what lets the region-scoped survival query (R12) still see its protector');
    eq(r.life(1), 27, 'Harbinger: the 3/3 that carried the token connected for 3');
  }

  // ── ② Blurf × Worldbender: the card step MEETS an effect that adds a card
  //    outside it, and R43's tick lands between them in the same `startTurn`.
  {
    const r = new ERig('blurf-worldbender-card-step');
    eq([r.hand(0).length, r.life(0), r.debt(0), r.cache(0).length], [0, 30, 0, 0],
      'Blurf/Worldbender: before the turn rolls — empty hand, 30 life, no debt, empty cache');
    const openBefore = r.openMana();
    r.do('doneDeploying');
    eq(r.s.turn, 2, 'Blurf/Worldbender: the turn rolled on the owner\'s own click');
    eq(r.cache(0).length, 1, 'Blurf: one card went from the top of the deck into the cache');
    eq(r.cache(0)[0].prophecy?.condition, '1 turn passes',
      'Blurf: carrying the prophecy it prints, transcription and all (normalizeProphecy folds it)');
    eq(r.debt(0), 1,
      'Blurf: and the debt is the cached card\'s printed cost — Divine Foresight is ll/1 at this seed');
    eq([r.life(0), r.hand(0).length], [27, 3],
      'Worldbender: THE CARD STEP — three cards and three life (the constructed branch, R162), '
      + 'not the two-and-nothing an unreplaced step gives');
    eq([r.life(1), r.hand(1).length], [30, 2],
      'Blurf/Worldbender: the opponent, same turn same table, took the ordinary card step');
    eq(r.cache(0)[0].prophecy?.fulfilled, true,
      'THE RULING: a card cached at the END of turn 1 is fulfilled at the TOP of turn 2. R43 '
      + 'counts forward from the moment of caching, so "1 turn passes" is satisfied by the very '
      + 'next turn — not by a whole turn having to elapse first (which would be turn 3).');
    ok(r.said('may now be played from cache for free'),
      'Blurf: and it announced itself, in the same instant the card step paid out');
    r.do('donePlanning');
    eq(r.debt(0), 0, 'Blurf: the debt is cleared by the resource step (R39), not by the owner');
    eq(r.openMana(), openBefore - 1, 'Blurf: and it cost exactly one open resource to clear');
  }

  // ── ③ Infernal Wispweaver: a self-sacrifice clause MEETS the static that
  //    suppresses it, at R12's region boundary.
  //    ⚠ THIS PINS CURRENT BEHAVIOUR AGAINST THE PRINTED LINE. See the block
  //    header: the card says "your wisps", with no region in it.
  {
    const r = new ERig('wispweaver-wisps-attack-alone');
    eq([r.stats('Wisp'), r.units(0).length], ['2/2', 4],
      'Wispweaver: at home the Wisps read 2/2, not the 0/1 they print — the static is live');
    const wisps = Object.values(r.s.entities as Record<string, any>)
      .filter(e => e.kind === 'unit' && e.card === 'Wisp' && e.controller === 0);
    eq(wisps.length, 3, 'Wispweaver: three Wisps to send');
    r.act({ type: 'declareAttack', seat: 0, columns: wisps.map(w => [w.id]) } as EAction);
    eq(r.stats('Wisp'), '0/1',
      'Wispweaver: the instant they cross into the defender\'s region they lose the +2/+1 — '
      + 'R12 scopes a static to its own region and the 2/1 weaver stayed home');
    r.passTo('deploy');
    ok(r.said('Wisp: sacrifice me (after combat)'),
      'Wispweaver: THE CLAUSE — the self-sacrifice trigger fired, on all of them');
    eq(r.units(0), ['Infernal Wispweaver'],
      'Wispweaver: ⚠ ALL THREE WISPS SACRIFICED THEMSELVES while their weaver was standing at '
      + 'home. The printed line is "Your wisps … do not sacrifice themselves after combat", with '
      + 'no region qualifier — so this assertion pins what the engine does, next to the text it '
      + 'contradicts. It is the failing test the day the owner rules the other way.');
    eq(r.life(1), 30, 'Wispweaver: 0/1 attackers dealt nothing, which is the same fact from the other side');
  }

  // ── ④ Waxen Witness: a GRANTED prophecy fulfilled by R43's battle tick
  //    inside one turn, MEETING "the cache holds a card, not the unit".
  {
    const r = new ERig('waxen-witness-battle-prophecy');
    eq(r.stats('Hammer of Justice', 0), '13/6',
      'Waxen Witness: the Hammer is a printed 10/3 wearing three +1/+1 counters');
    const h = r.unit('Hammer of Justice', 0)!;
    r.act({ type: 'declareAttack', seat: 0, columns: [[h.id]] } as EAction);
    r.do('playCard');                                   // Waxen Witness, a {Battle} spell unit
    ok(r.labels().some(l => l.includes('Hammer')), 'Waxen Witness: your own unit is a legal target');
    r.aim('Hammer');
    r.passTo('deploy');
    eq(r.cache(0).map((c: any) => c.card), ['Hammer of Justice'],
      'Waxen Witness: THE CLAUSE — the unit left play for the cache');
    eq(r.cache(0)[0].prophecy?.condition, 'One Battle Passes',
      'Waxen Witness: carrying the prophecy it grants');
    eq(r.cache(0)[0].prophecy?.fulfilled, true,
      'Waxen Witness: and ONE battle round was enough — R43 ticks on the initiative battle and '
      + 'the counterattack alike, so it comes true in the turn it was granted');
    eq(r.units(0), ['Waxen Witness'],
      'Waxen Witness: the spell resolved first and the 3/3 body spawned behind it (spellUnit)');
    const before = r.openMana();
    r.do('playCached');
    eq(r.openMana(), before,
      'Waxen Witness: the release cost NOTHING — a fulfilled prophecy waives the mana (R42)');
    eq(r.stats('Hammer of Justice', 0), '10/3',
      'Waxen Witness: THE JOIN — a 13/6 went into the cache and a 10/3 came back. The cache '
      + 'holds the CARD; the three +1/+1 counters belonged to the entity, and the entity is gone.');
    eq(r.unit('Hammer of Justice', 0).counters, 0, 'Waxen Witness: zero counters, explicitly');
    eq(r.life(1), 30,
      'Waxen Witness: the opponent took nothing — the attacker was pulled out before combat');
  }

  // ── ⑤ Proph: two cards leave the same zone one step apart, and only one of
  //    them is a PLAY (R49's `from` against R37's "a mod is not a play").
  {
    const r = new ERig('proph-cache-release-vs-mod');
    eq(r.hand(0), ['Air Plant', 'Air Plant'], 'Proph: two Air Plants to spend down the two paths');
    const mana0 = r.openMana();
    r.do('prophesy');
    eq(r.cache(0)[0]?.prophecy?.fulfilled, true,
      'Proph: the banner condition ("four unique costs") is true the instant it is made — the '
      + 'four units on the board cost 1, 2, 3 and 4');
    r.do('prophesy');
    eq([r.hand(0).length, r.cache(0).length], [0, 2], 'Proph: hand empty, both copies cached');
    eq(r.openMana(), mana0 - 4, 'Proph: two banners at [2] each, and nothing else spent yet');
    const ft = r.unit('The Foretold', 0)!;
    // ⚠ ORDER IS LOAD-BEARING: Proph's trigger is [Switch1] (bounded, once a
    // turn). Playing first would spend the budget and make the augment's
    // silence unreadable.
    r.do('augment', (a: any) => a.from === 'cache' && a.hostId === ft.id);
    eq(r.hand(0).length, 0,
      'Proph: THE CLAUSE, negative half — the augment came OUT OF THE CACHE and Proph drew '
      + 'NOTHING. R37: applying a mod is not playing a card, so there was no play event to hear.');
    eq(r.openMana(), mana0 - 4,
      'Proph: and the mod was free — a fulfilled prophecy waives an augment too (R42), so the '
      + 'two paths differ in nothing but the rule');
    eq([r.stats('Proph', 0), r.stats('Bumblecrab', 0), r.stats('Resonant Form', 0)],
      ['4/3', '4/5', '4/6'],
      'Proph: the donated static is live — your OTHER units are +2/+2');
    eq(r.stats('The Foretold', 0), '3/3',
      'Proph: and the HOST is the one unit that does not grow — it is wearing the mod, and the '
      + 'text says your other units');
    ok(r.flying('Proph', 0) && !r.flying('The Foretold', 0),
      'Proph: the granted Flying splits the same way');
    r.do('playCached');
    eq(r.hand(0).length, 1,
      'Proph: THE CLAUSE, positive half — the cache RELEASE is a play from somewhere other than '
      + 'your hand, so Proph drew. Same zone, same price, same step; different rule.');
    ok(r.said('Trigger: Proph — draw a card'), 'Proph: and the trigger named itself');
    eq([r.stats('Proph', 0), r.stats('The Foretold', 0), r.stats('Air Plant', 0)],
      ['6/5', '5/5', '4/4'],
      'Proph: the second Air Plant is a BODY now, so everything grows again — and the new body '
      + 'is itself 4/4, because the AUGMENTED copy riding The Foretold counts it as one of "your '
      + 'other units". Each copy excludes only itself.');
  }

  // ── ⑥ Vaporweave Eidolon: R79 {Unstable} MEETS leaving play without dying,
  //    with the graft rider resolving while its host removes itself.
  {
    const r = new ERig('graft-host-recalls-itself');
    r.do('graft');
    ok(r.said('Flame Juggle grafts onto Vaporweave Eidolon'), 'Vaporweave: the graft landed');
    ok(r.said('it is now Unstable'),
      'Vaporweave: and the host is Unstable — R79\'s "it and all of its mods are erased with it" '
      + 'is now armed, which is what makes the next click a question');
    eq(r.unit('Vaporweave Eidolon', 0).mods.length, 1, 'Vaporweave: one mod riding');
    r.do('activateAbility');                            // [zero]: recall me
    eq(r.hand(0), ['Vaporweave Eidolon'], 'Vaporweave: the host recalled itself to hand');
    eq(r.bin(0), ['Flame Juggle'],
      'Vaporweave: THE JOIN — the grafted card is in the BIN, not the erased pile. Unstable '
      + 'erases the mods when the host DIES or IS ERASED, and a recall is neither.');
    eq(r.erased(0), [],
      'Vaporweave: nothing reached the R65 erased pile at all — the negative half of the same claim');
    eq(r.spellTokens(0), ['Fireball 1', 'Fireball 1', 'Fireball 1'],
      'Vaporweave: and the RIDER still delivered — three tokens — even though the card it was '
      + 'riding on left play in the same resolution (R167: this family was silently dead on '
      + 'recalls and caches while working on deaths)');
    eq(r.units(0), [], 'Vaporweave: the Eidolon really is off the board');
  }

  // ── ⑦ Dispatch Courier: R18's "only haste cards" MEETS R97's granted play,
  //    and the join is the one-per-turn allowance.
  {
    const r = new ERig('dispatch-courier-haste-unit');
    eq(r.s.hasteDone, [false, true],
      'Dispatch Courier: THE HASTE STEP IS OPEN with no [Haste] card anywhere in the owner\'s '
      + 'hand — `canHaste` consulted the grant (report #74: nothing used to ask)');
    eq(r.playable(), ['Curio Drifter', 'The Foretold'],
      'Dispatch Courier: both UNITS are offered, and Waxen Witness is not — a {Battle} card '
      + 'cannot be hasted however much permission you have (RAQ, "Dispatch Courier vs Battle Timing")');
    r.do('playCard', (a: any) => r.hand()[a.handIndex] === 'The Foretold');
    eq(r.units(0), ['Dispatch Courier', 'The Foretold'],
      'Dispatch Courier: THE CLAUSE — a deploy-timing unit spawned during the haste step');
    eq(r.playable(), [],
      'Dispatch Courier: THE JOIN — Curio Drifter is no longer offered. "Each turn" is an '
      + 'allowance of exactly one, charged to `hastePlaysUsed`; a standing permission would '
      + 'still be offering it.');
    r.do('doneHaste');
    eq(r.s.phase, 'battle', 'Dispatch Courier: the step closed into the battle phase');
    const ft = r.unit('The Foretold', 0)!;
    ok(r.legal().some(a => a.type === 'declareAttack'
      && JSON.stringify((a as any).columns).includes(String(ft.id))),
      'Dispatch Courier: and the unit MAY ATTACK THIS TURN, which is the entire point of '
      + 'playing it in the haste step');
  }

  // ── ⑧ Tithe Enforcer: prophesy × doneHaste × playCached — the three
  //    thinnest actions in the corpus, in one line.
  {
    const r = new ERig('tithe-enforcer-haste-release');
    const mana0 = r.openMana();
    r.do('prophesy');
    eq(r.cache(0).map((c: any) => c.card), ['Tithe Enforcer'], 'Tithe Enforcer: cached for [2]');
    eq(r.openMana(), mana0 - 2, 'Tithe Enforcer: and the banner cost exactly [2], plain mana (R42)');
    eq(r.cache(0)[0].prophecy?.fulfilled ?? false, false,
      'Tithe Enforcer: NOT fulfilled yet — "End [Haste] with used mana" needs a haste step to end');
    r.do('doneDeploying');
    eq(r.s.turn, 2, 'Tithe Enforcer: turn 2');
    r.do('donePlanning');
    eq(r.s.hasteDone, [false, true], 'Tithe Enforcer: turn 2\'s haste step, opened by the card in hand');
    r.do('playCard', (a: any) => r.hand()[a.handIndex] === 'Molten Upheaval');
    ok(!r.legal().some(a => a.type === 'playCached'),
      'Tithe Enforcer: the release is NOT offered yet — the tally is nonzero but the step has not '
      + 'ended, and `hasteWithUsedMana` requires BOTH');
    r.do('doneHaste');
    eq(r.cache(0)[0].prophecy?.fulfilled, true,
      'Tithe Enforcer: THE LATCH — it comes true as `finishHasteEnd` closes the step, one '
      + 'statement before the tally is zeroed. A window one line wide.');
    r.passTo('planning', 3);
    ok(!r.hand(0).some(c => ['Molten Upheaval'].includes(c)),
      'Tithe Enforcer: the haste card is spent and gone from hand');
    r.do('donePlanning');
    eq(r.s.hasteDone, [false, true],
      'Tithe Enforcer: TURN 3\'S HASTE STEP OPENS FOR A CARD THAT IS NOT IN HAND — `canHaste` '
      + 'counts a fulfilled cache release. Without this the card is stranded in the cache '
      + 'forever, because its printed timing is [Haste] and nothing else would open a window.');
    const before = r.openMana();
    r.do('playCached');
    eq(r.units(0).includes('Tithe Enforcer'), true,
      'Tithe Enforcer: THE CLAUSE — a 7-mana body released in the haste step');
    eq(r.stats('Tithe Enforcer', 0), '4/6', 'Tithe Enforcer: at its printed size');
    eq(r.openMana(), before,
      'Tithe Enforcer: and NOTHING was spent on it. Total outlay for a 7-drop: [2] on turn 1 and '
      + '[1] on turn 2.');
  }
}
