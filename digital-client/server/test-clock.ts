/* Integration tests for the playtest-feedback trio (run: node test-clock.ts):
 *   - chess clock: CLOCK_START_MS per seat, runs only for seats the game is
 *     waiting on
 *     (and only while both players are connected), stops on donePlanning,
 *     persists across a server restart
 *   - POST /api/report appends {ts, room, seat, note, actionIndex} to
 *     server/issues.jsonl (unknown room: actionIndex null)
 *   - draft mode: the per-seat view carries packInfo {packNumber, originalSize,
 *     remaining, picksMade, picksTotal, after} while the draft step is open; `after`
 *     flips true on turn 2 (the pack in hand never returns to you)
 *
 * Same harness style as test-new-features.ts: spawn the real server on an
 * ephemeral port, drive it with raw WebSockets, no test framework.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Action, Seat } from '../engine/src/types.ts';
import { CLOCK_START_MS } from './rooms.ts';
import { freePort, gameFile, mintRoom } from './test-util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = await freePort();
// minted from /api/new once the server is up: only a server-minted code may
// create a room (rooms.ts)
let ROOM = '';
let DROOM = '';
const ISSUES = join(HERE, 'issues.jsonl');
/** imported rather than restated: this test hardcoded 40:00 and silently
 * went red when rooms.ts moved to 60:00 */
const START = CLOCK_START_MS;

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

interface Clock { ms: [number, number]; running: [boolean, boolean]; at: number; }
interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
  names?: string[]; clock?: Clock;
}

class Client {
  ws: WebSocket;
  view: any = null;
  legal: Action[] = [];
  clock: Clock | null = null;
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
    if (m.clock) this.clock = m.clock;
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

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

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

/** the no-op draft commit for a redacted view */
function noopCommit(view: any, seat: Seat): Action {
  const H = view.players[seat].hand.length;
  const packIndices = view.packs[seat].map((_: unknown, i: number) => H + i);
  return { type: 'draftCommit', seat, packIndices } as Action;
}

/** Drive both clients forward with "mundane" actions (done/pass/empty
 * formations/no-op commits) until pred(view) holds on BOTH clients.
 *
 * Both, not just `a`: the action that ends a hidden simultaneous segment
 * pushes one message per seat, and the caller reads b.view straight after —
 * returning as soon as a's arrived is a race the caller always eventually
 * loses. (It did, the moment the resource step became a hidden segment and
 * the message counts shifted.) */
async function advanceUntil(a: Client, b: Client, pred: (v: any) => boolean, label: string): Promise<void> {
  const done = (): boolean => pred(a.view) && pred(b.view);
  for (let i = 0; i < 120; i++) {
    if (done()) return;
    let sent = false;
    for (const c of [a, b]) {
      if (done()) return;
      const seat = c === a ? a.view?.players?.[0]?.seat ?? 0 : 1;
      void seat;
      const pick =
        c.legal.find(x => x.type === 'draftCommit') ??
        c.legal.find(x => x.type === 'donePlanning') ??
        c.legal.find(x => x.type === 'doneHaste') ??
        c.legal.find(x => x.type === 'passPriority') ??
        c.legal.find(x => x.type === 'declareAttack' && (x as any).columns?.length === 0) ??
        c.legal.find(x => x.type === 'declareBlocks') ??
        c.legal.find(x => x.type === 'doneDeploying');
      if (!pick) continue;
      const action = pick.type === 'draftCommit'
        ? noopCommit(c.view, (pick as any).seat)
        : pick;
      const mark = c.msgs.length;
      c.send({ t: 'action', action });
      try {
        await c.next(m => m.t === 'update' || m.t === 'error', 4000, mark);
      } catch { /* keep driving */ }
      sent = true;
    }
    if (!sent) await sleep(100);
  }
  if (done()) return;
  throw new Error(`advanceUntil(${label}): gave up after 120 rounds`);
}

// preserve any real issues.jsonl on this machine; restore it afterwards
const issuesBackup = existsSync(ISSUES) ? readFileSync(ISSUES, 'utf8') : null;

let { server, up } = startServer();
await up;
ROOM = await mintRoom(PORT);

try {
  // ── chess clock ─────────────────────────────────────────────────────
  console.log('\n[clock: initial state + who runs]');
  const a = new Client(PORT);
  await a.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Tick' });
  const aj = await a.next(m => m.t === 'joined');
  ok(!!aj.clock, 'joined message carries a clock snapshot');
  ok(aj.clock!.ms[0] === START && aj.clock!.ms[1] === START, `both clocks start at CLOCK_START_MS (${aj.clock!.ms})`);
  ok(aj.clock!.running[0] === false && aj.clock!.running[1] === false,
    'no clock runs while the opponent seat is empty');
  ok(typeof aj.clock!.at === 'number' && Math.abs(Date.now() - aj.clock!.at) < 5000,
    'snapshot carries a fresh server timestamp');

  await sleep(700);   // waiting alone must cost seat 0 nothing

  const b = new Client(PORT);
  await b.open();
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Tock' });
  const bj = await b.next(m => m.t === 'joined');
  ok(bj.clock!.ms[0] >= START - 50 && bj.clock!.ms[1] >= START - 50,
    `waiting for an opponent billed nobody (${bj.clock!.ms})`);
  ok(bj.clock!.running[0] === true && bj.clock!.running[1] === true,
    'both connected in simultaneous planning: both clocks run');

  console.log('\n[clock: stops for a seat that is done]');
  const done0: Action = { type: 'donePlanning', seat: 0 } as Action;
  const am = a.msgs.length;
  a.send({ t: 'action', action: done0 });
  // match the ACTION's update (planningDone flipped), not the join-refresh push
  const au = await a.next(m => m.t === 'update' && m.view?.planningDone?.[0] === true && !!m.clock, 5000, am);
  ok(au.clock!.running[0] === false && au.clock!.running[1] === true,
    `after donePlanning only the still-deciding seat runs (${au.clock!.running})`);

  await sleep(1300);  // this must be billed to seat 1 only

  const recycle = b.legal.find(x => x.type === 'recycleForResource');
  ok(!!recycle, 'seat 1 has a recycle action to spend time on');
  const bm = b.msgs.length;
  b.send({ t: 'action', action: recycle });
  const bu = await b.next(m => m.t === 'update' && !!m.clock, 5000, bm);
  const ms = bu.clock!.ms;
  ok(START - ms[1] >= 1200, `seat 1 was billed the thinking time (spent ${START - ms[1]}ms)`);
  ok(ms[0] - ms[1] >= 1000, `seat 0 billed much less than seat 1 (${ms[0]} vs ${ms[1]})`);
  ok(START - ms[0] <= 1000, `seat 0 lost only its pre-done sliver (${START - ms[0]}ms)`);

  console.log('\n[clock: persists across a server restart]');
  const persisted = JSON.parse(readFileSync(gameFile(ROOM), 'utf8'));
  ok(Array.isArray(persisted.clockMs) && persisted.clockMs[1] <= START - 1200,
    `room file records clockMs (${JSON.stringify(persisted.clockMs)})`);
  server.kill();
  await new Promise(res => server.on('exit', res));
  ({ server, up } = startServer());
  await up;
  const b2 = new Client(PORT);
  await b2.open();
  b2.send({ t: 'join', room: ROOM, seat: 1 });
  const b2j = await b2.next(m => m.t === 'joined');
  ok(b2j.clock!.ms[1] <= START - 1200 && b2j.clock!.ms[1] >= ms[1] - 60000,
    `restart restored seat 1's spent time (${b2j.clock!.ms[1]})`);
  ok(b2j.clock!.ms[0] >= b2j.clock!.ms[1], 'seat 0 still has more time than seat 1');
  ok(b2j.clock!.running[0] === false && b2j.clock!.running[1] === false,
    'restored room: clocks paused until both players are back');
  const a2 = new Client(PORT);
  await a2.open();
  a2.send({ t: 'join', room: ROOM, seat: 0 });
  const a2j = await a2.next(m => m.t === 'joined');
  ok(a2j.clock!.running[0] === false && a2j.clock!.running[1] === true,
    'both back: only the seat the game waits on runs (seat 0 already done planning)');

  // ── /api/report ─────────────────────────────────────────────────────
  console.log('\n[report endpoint]');
  const actionCount = persisted.actions.length;
  const rep1 = await (await fetch(`http://localhost:${PORT}/api/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: ROOM, seat: 0, note: 'clock test issue' }),
  })).json() as { ok: boolean };
  ok(rep1.ok === true, 'report responds {ok:true}');
  const rep2 = await (await fetch(`http://localhost:${PORT}/api/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: 'ZZZZ', seat: 1, note: 'ghost room' }),
  })).json() as { ok: boolean };
  ok(rep2.ok === true, 'unknown room still responds {ok:true}');
  const lines = readFileSync(ISSUES, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const mine = lines.filter(l => l.room === ROOM || l.room === 'ZZZZ');
  ok(mine.length === 2, 'two lines landed in issues.jsonl');
  const [l1, l2] = mine;
  ok(l1.room === ROOM && l1.seat === 0 && l1.note === 'clock test issue', 'line 1 records room/seat/note');
  ok(l1.actionIndex === actionCount, `line 1 actionIndex = the room's action count (${l1.actionIndex})`);
  ok(typeof l1.ts === 'string' && !Number.isNaN(Date.parse(l1.ts)), 'line 1 ts is an ISO date');
  ok(l2.room === 'ZZZZ' && l2.actionIndex === null, 'unknown room logged with actionIndex null');

  // ── draft packInfo ──────────────────────────────────────────────────
  console.log('\n[draft: packInfo in the redacted view]');
  // minted HERE, not at the top: the restart above was a new process, and a
  // reservation lives in memory, so a code minted before it is dead after it
  DROOM = await mintRoom(PORT);
  const d0 = new Client(PORT);
  await d0.open();
  // explicit trio: this is a packInfo test, not a lobby one
  d0.send({ t: 'join', room: DROOM, seat: 0, mode: 'draft', els: ['fire', 'water', 'earth'], name: 'Dee' });
  await d0.next(m => m.t === 'joined');
  const d1 = new Client(PORT);
  await d1.open();
  d1.send({ t: 'join', room: DROOM, seat: 1, name: 'Dum' });
  await d1.next(m => m.t === 'joined');

  const p0 = d0.view.packInfo, p1 = d1.view.packInfo;
  ok(!!p0 && !!p1, 'both seats see packInfo during the open draft step');
  ok(p0.originalSize === 10 && p0.remaining === 10 && p0.picksMade === 0,
    `turn 1: fresh pack of 10, no picks yet (${JSON.stringify(p0)})`);
  ok(p0.after === 'returns' && p1.after === 'returns',
    'turn 1 is NOT the last look — your dealt pack returns to you on turn 3');
  ok(p0.picksTotal === 3 && p1.picksTotal === 3,
    'a 1v1 pack is drafted from N+1 = 3 times before it is recycled');
  ok([p0.packNumber, p1.packNumber].sort().join() === '1,2',
    `the two dealt packs are #1 and #2 (${p0.packNumber} vs ${p1.packNumber})`);
  ok(d0.clock !== null, 'draft room updates carry the clock too');

  const d1m = d1.msgs.length;
  d1.send({ t: 'action', action: noopCommit(d1.view, 1) });
  await d1.next(m => m.t === 'update' && m.view?.draftDone?.[1] === true, 5000, d1m);
  ok(d1.view.packInfo?.picksMade === 1, 'after committing, your pack shows 1 pick made');

  const d0m = d0.msgs.length;
  d0.send({ t: 'action', action: noopCommit(d0.view, 0) });
  await d0.next(m => m.t === 'update' && m.view?.draftDone === null, 5000, d0m);
  await d1.next(m => m.t === 'update' && m.view?.draftDone === null, 5000, d1m);
  ok(d0.view.packInfo === undefined && d1.view.packInfo === undefined,
    'packInfo disappears once the packs pass (it described THIS turn\'s look)');

  console.log('\n[draft: turn 2 is the last look at the swapped pack]');
  await advanceUntil(d0, d1, v => v?.turn === 2 && v?.draftDone !== null, 'turn 2 draft step');
  const q0 = d0.view.packInfo, q1 = d1.view.packInfo;
  ok(!!q0 && !!q1, 'turn 2 draft step shows packInfo again');
  ok(q0.packNumber === p1.packNumber && q1.packNumber === p0.packNumber,
    `turn 2: the packs swapped (seat 0 now holds #${q0?.packNumber})`);
  ok(q0.picksMade === 1 && q1.picksMade === 1, 'each pack has been picked over once');
  ok(q0.after === 'others' && q1.after === 'others',
    'turn 2 IS the last look — and your opponent DOES draft the leftovers on turn 3');

  console.log('\n[draft: turn 3 is the final look — leftovers are recycled, not passed]');
  await advanceUntil(d0, d1, v => v?.turn === 3 && v?.draftDone !== null, 'turn 3 draft step');
  const r0 = d0.view.packInfo, r1 = d1.view.packInfo;
  ok(!!r0 && !!r1, 'turn 3 draft step shows packInfo again');
  ok(r0.packNumber === p0.packNumber && r1.packNumber === p1.packNumber,
    'turn 3: your own dealt pack is back for its third and final look');
  ok(r0.picksMade === 2 && r1.picksMade === 2, 'each pack has been picked over twice');
  ok(r0.after === 'recycled' && r1.after === 'recycled',
    'turn 3 leftovers go to the bottom of the deck — the opponent never sees them');

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
} finally {
  server.kill();
  rmSync(gameFile(ROOM), { force: true });
  rmSync(gameFile(DROOM), { force: true });
  if (issuesBackup === null) rmSync(ISSUES, { force: true });
  else writeFileSync(ISSUES, issuesBackup);
}
process.exit(failures ? 1 : 0);
