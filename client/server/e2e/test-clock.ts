/* Integration tests for the playtest-feedback trio (run: node test-clock.ts):
 *   - chess clock: CLOCK_START_MS per seat, runs only for seats the game is
 *     waiting on
 *     (and only while both players are connected), stops on donePlanning,
 *     persists across a server restart
 *   - POST /api/report appends {ts, room, seat, note, actionIndex} to the
 *     issues file (unknown room: actionIndex null). Pointed at a throwaway
 *     path via ALGO_ISSUES_FILE — see SCRATCH below.
 *   - draft mode: the per-seat view carries packInfo {packNumber, originalSize,
 *     remaining, picksMade, picksTotal, after} while the draft step is open; `after`
 *     flips true on turn 2 (the pack in hand never returns to you)
 *
 * Same harness style as test-new-features.ts: spawn the real server on an
 * ephemeral port, drive it with raw WebSockets, no test framework.
 */
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Action, Seat } from '../../engine/src/types.ts';
import { CLOCK_START_MS, MAX_CLOCK_MS, MIN_CLOCK_MS, sanitizeClock } from '../rooms.ts';
import { gameFile, mintRoom, spawnServer, type ServerHandle } from './test-util.ts';

// minted from /api/new once the server is up: only a server-minted code may
// create a room (rooms.ts)
let ROOM = '';
let DROOM = '';
/** BL-26/BL-27 mint their own rooms; every code lands here so the `finally`
 *  can clean up whatever the run got to before it stopped. */
const EXTRA: string[] = [];
async function mintExtra(port: number): Promise<string> {
  const code = await mintRoom(port);
  EXTRA.push(code);
  return code;
}
/* The report half of this test POSTS two bug reports, so it needs somewhere
 * for them to land that is NOT var/issues.jsonl — that file is the only
 * copy of every playtest report the owner has ever filed, and this suite runs
 * on the deploy box. It used to read the real file into memory, let the server
 * append to it and write the original back in the `finally`, which loses the
 * lot if a run is killed in between (or if two runs overlap). main.ts honours
 * ALGO_ISSUES_FILE now, exactly like ALGO_GAMES_DIR and ALGO_ACCOUNTS_FILE, so
 * the server under test writes to a throwaway file and never opens the real
 * one. Set on process.env before the server is spawned: startServer() passes
 * `...process.env` through, so both the child and the assertions below read
 * the same path. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-clock-'));
const ISSUES = join(SCRATCH, 'issues.jsonl');
process.env['ALGO_ISSUES_FILE'] = ISSUES;
/** imported rather than restated: this test hardcoded 40:00 and silently
 * went red when rooms.ts moved to 60:00 */
const START = CLOCK_START_MS;

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

interface Clock { ms: [number, number]; running: [boolean, boolean]; at: number; start: number; }
interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
  names?: string[]; clock?: Clock;
  waiting?: { have: [boolean, boolean]; clockStart: number | null };
  winner?: number | null;
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
  /** wall time of the last message on this socket — see quiesce() below */
  lastAt = 0;
  private onMsg(m: Msg): void {
    this.msgs.push(m);
    this.lastAt = Date.now();
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

/* R204/CT-85: the server picks its own port and tells us which — see
 * test-util.ts. It used to be `freePort()` in the parent then PORT=<number>
 * in the child, which left the port held by nobody for as long as node took
 * to boot. This test restarts the server mid-run, so PORT is a `let`: the
 * restarted process gets a fresh port, and re-binding the old number would
 * reintroduce that window at the worst possible moment — while the process
 * that held it is still shutting down. */
async function startServer(): Promise<ServerHandle> {
  return await spawnServer();
}

/** the no-op draft commit for a redacted view */
function noopCommit(view: any, seat: Seat): Action {
  const H = view.players[seat].hand.length;
  const packIndices = view.packs[seat].map((_: unknown, i: number) => H + i);
  return { type: 'draftCommit', seat, packIndices } as Action;
}

/* R204 / CT-85 — THE FLAKE THIS FILE ACTUALLY HAD.
 *
 * `advanceUntil` below decides whether to drive a client by testing pred()
 * against `a.view` and `b.view`. Those are whatever the last message on each
 * socket said. One action can push an update to BOTH seats, and the two
 * pushes do not land at the same instant; the loop only ever awaited the
 * update for the client it had just driven.
 *
 * So: seat 0 commits, reaches turn 2, and its update lands. Seat 1's update
 * for the same turn is still on the wire. done() reads seat 1's turn-1 view,
 * says "not there yet", and drives seat 1 — using seat 1's turn-1 `legal`,
 * which still offers a draftCommit. Seat 1 commits a SECOND time. The loop
 * then returns happily, and the caller reads picksMade === 2 where the draft
 * has only been picked over once. Observed as `✗ each pack has been picked
 * over once`, twice in twelve runs at four concurrent suites, never once in
 * ten runs on an idle box — because widening the inter-socket skew is exactly
 * what load does.
 *
 * The fix is not a longer sleep. It is to stop reading a view that has a
 * known-pending successor: wait for both sockets to go quiet before believing
 * either of them. Quiet, not a fixed delay — a fixed delay is the same bug
 * with a bigger number.
 */

/** Resolve once neither client has received a message for `quietMs`, or after
 * `maxMs` regardless (a genuinely idle board never goes quiet "again"). */
async function quiesce(a: Client, b: Client, quietMs = 120, maxMs = 3000): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const since = Date.now() - Math.max(a.lastAt, b.lastAt);
    if (since >= quietMs || Date.now() >= deadline) return;
    await sleep(Math.min(quietMs - since, 40));
  }
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
    await quiesce(a, b);
    if (done()) return;
    let sent = false;
    for (const c of [a, b]) {
      await quiesce(a, b);
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

let server = await startServer();
let PORT = server.port;
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

  /* R204/CT-85: seat 0's clock starts the instant seat 1 connects and stops
   * when the donePlanning below lands, so the "sliver" it loses is one real
   * round trip on a real box. The assertion further down used to compare that
   * sliver to a hardcoded 1000ms — a statement about an idle machine, not
   * about the clock, and the first thing to go wrong when the box is busy. So
   * measure how long the window actually was and bound the sliver by that. */
  const sliverStart = Date.now();
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
  // the window seat 0's clock was actually allowed to run for (see sliverStart)
  const sliverMax = Date.now() - sliverStart + 250;   // + slack for clock granularity
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
  /* R204/CT-85: this gap is (the 1300ms seat 1 spent thinking) minus (the
   * sliver seat 0 lost before it said done). The constant used to be a flat
   * 1000, which silently assumed the sliver could never exceed 300ms — true
   * on an idle box, and a coin flip on a busy one, where a join round trip
   * alone can cost that. Derive the bound from the sliver we measured. */
  ok(ms[0] - ms[1] >= 1300 - sliverMax,
    `seat 0 billed much less than seat 1 (${ms[0]} vs ${ms[1]}, gap ${ms[0] - ms[1]}ms, need ${1300 - sliverMax}ms)`);
  ok(START - ms[0] <= sliverMax,
    `seat 0 lost only its pre-done sliver (${START - ms[0]}ms of at most ${sliverMax}ms)`);

  console.log('\n[clock: persists across a server restart]');
  const persisted = JSON.parse(readFileSync(gameFile(ROOM), 'utf8'));
  ok(Array.isArray(persisted.clockMs) && persisted.clockMs[1] <= START - 1200,
    `room file records clockMs (${JSON.stringify(persisted.clockMs)})`);
  await server.stop();   // stop() waits for the exit; a restart must not overlap
  server = await startServer();
  PORT = server.port;
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

  /* ══ BL-26: THE BANK IS A PER-ROOM SETTING ═══════════════════════════
   *
   * `CLOCK_START_MS` used to be the rule — a module constant every room got,
   * nobody could change and nothing could switch off. The owner named making
   * it optional and configurable as the PREREQUISITE for making time run out
   * matter: "we need to make timers optional and configurable first."
   *
   * ⚠ Nothing below restates a number. The default is imported (this file
   * hardcoded 40:00 once and went silently red when rooms.ts moved to 60:00),
   * and every custom bank is a local the assertions compare against.
   */
  console.log('\n[BL-26: sanitizeClock — the wire value, and what "off" is]');
  ok(sanitizeClock(undefined) === CLOCK_START_MS,
    'a client that says nothing about the clock gets the default — today\'s behaviour, unchanged');
  ok(sanitizeClock(null) === null && sanitizeClock(0) === null && sanitizeClock('off') === null,
    'OFF IS A REAL SETTING: null / 0 / "off" all mean no clock, not a very large number');
  ok(sanitizeClock(90_000) === 90_000, 'a bank in range comes through untouched');
  ok(sanitizeClock('90000') === 90_000, 'and a numeric string does too (it arrives off a URL)');
  ok(sanitizeClock(1) === MIN_CLOCK_MS && sanitizeClock(1e12) === MAX_CLOCK_MS,
    'out-of-range banks are CLAMPED into [MIN, MAX] rather than refused');
  ok(sanitizeClock('nonsense') === CLOCK_START_MS && sanitizeClock(-5) === CLOCK_START_MS
    && sanitizeClock(Number.NaN) === CLOCK_START_MS && sanitizeClock({}) === CLOCK_START_MS,
    'junk falls back to the default and never throws — this reads a value off a socket');

  console.log('\n[BL-26: a room created with a custom bank]');
  const CUSTOM = 90_000;                       // 90s — deliberately not the default
  const cRoom = await mintExtra(PORT);
  const c0 = new Client(PORT);
  await c0.open();
  c0.send({ t: 'join', room: cRoom, seat: 0, name: 'Short', clock: CUSTOM });
  const c0j = await c0.next(m => m.t === 'joined');
  ok(c0j.clock?.ms[0] === CUSTOM && c0j.clock?.ms[1] === CUSTOM,
    `both banks start at the room's own setting, not CLOCK_START_MS (${c0j.clock?.ms[0]})`);
  ok(c0j.clock?.start === CUSTOM,
    'and the snapshot NAMES the setting, so a seat joining twenty minutes in can still see it');
  ok(CUSTOM !== CLOCK_START_MS && c0j.clock?.ms[0] !== CLOCK_START_MS,
    'the default is genuinely not what this room got — the constant is a default, not the rule');

  // ⚠ THE ONE THAT MATTERS FOR ABUSE: the bank belongs to whoever CREATED the
  // room. A joiner who could re-specify it could hand their opponent a
  // three-second game by editing the link they were sent.
  const c1 = new Client(PORT);
  await c1.open();
  c1.send({ t: 'join', room: cRoom, seat: 1, name: 'Long', clock: 1000 });
  const c1j = await c1.next(m => m.t === 'joined');
  ok(c1j.clock?.start === CUSTOM,
    'the SECOND player cannot re-specify the bank — the room keeps the creator\'s setting');

  {
    const saved = JSON.parse(readFileSync(gameFile(cRoom), 'utf8')) as { clockStart?: number | null };
    ok(saved.clockStart === CUSTOM, `and the setting is in the FILE (${saved.clockStart})`);
  }

  console.log('\n[BL-26: a room with no clock at all]');
  const offRoom = await mintExtra(PORT);
  const o0 = new Client(PORT);
  await o0.open();
  o0.send({ t: 'join', room: offRoom, seat: 0, name: 'Untimed', clock: 0 });
  const o0j = await o0.next(m => m.t === 'joined');
  // NOT "ms is 0" and NOT "running is false" — the entry asks for NO CLOCKS AT
  // ALL rather than a frozen 60:00, and the honest wire shape for that is an
  // absent field. A client cannot draw what it was never sent.
  ok(!('clock' in o0j), 'the joined payload carries NO clock field at all — not a stopped one');
  const o1 = new Client(PORT);
  await o1.open();
  o1.send({ t: 'join', room: offRoom, seat: 1, name: 'Also' });
  const o1j = await o1.next(m => m.t === 'joined');
  ok(!('clock' in o1j), 'and neither does the other seat\'s');
  {
    const om = o0.msgs.length;
    const pick = o0.legal.find(x => x.type === 'donePlanning')!;
    o0.send({ t: 'action', action: pick });
    const ou = await o0.next(m => m.t === 'update', 5000, om);
    ok(!('clock' in ou), 'nor any update once the game is moving — a clockless room never sends one');
    const saved = JSON.parse(readFileSync(gameFile(offRoom), 'utf8')) as { clockStart?: number | null };
    ok(saved.clockStart === null,
      'the file records the setting as null — distinguishable from a file that predates it');
  }

  console.log('\n[BL-26: the setting survives a restart, and an OLD file still loads]');
  {
    // an old file: exactly what every game on the deploy box looks like today
    const oldRoom = await mintExtra(PORT);
    const x0 = new Client(PORT);
    await x0.open();
    x0.send({ t: 'join', room: oldRoom, seat: 0, name: 'Legacy' });
    await x0.next(m => m.t === 'joined');
    const raw = JSON.parse(readFileSync(gameFile(oldRoom), 'utf8')) as Record<string, unknown>;
    delete raw['clockStart'];
    writeFileSync(gameFile(oldRoom), JSON.stringify(raw));

    await server.stop();
    server = await startServer();
    PORT = server.port;

    const y0 = new Client(PORT);
    await y0.open();
    y0.send({ t: 'join', room: cRoom, seat: 0, name: 'Short' });
    const y0j = await y0.next(m => m.t === 'joined');
    ok(y0j.clock?.start === CUSTOM,
      `the custom bank survived the restart (${y0j.clock?.start})`);

    const z0 = new Client(PORT);
    await z0.open();
    z0.send({ t: 'join', room: offRoom, seat: 0, name: 'Untimed' });
    const z0j = await z0.next(m => m.t === 'joined');
    ok(!('clock' in z0j), 'and so did "off" — it did not come back as a 60:00 room');

    const w0 = new Client(PORT);
    await w0.open();
    w0.send({ t: 'join', room: oldRoom, seat: 0, name: 'Legacy' });
    const w0j = await w0.next(m => m.t === 'joined');
    ok(w0j.clock?.start === CLOCK_START_MS,
      'A FILE WITH NO clockStart STILL LOADS, at CLOCK_START_MS — which is not a guess: it is '
      + 'the bank that game really was played with, because it was the only one there was');
  }

  /* ══ BL-27: RUNNING OUT OF TIME LOSES THE GAME ═══════════════════════
   *
   * The owner's reason is BM, not pacing: "we'll make the timer actally cause
   * a game loss before launching to prevent BMing." Today a player who is
   * losing can stop acting and the game never ends — it lands in history as
   * `finished: false` with no winner, indistinguishable from an honest "we
   * both had to go".
   *
   * THE FIXTURE IS RACE-FREE ON PURPOSE. Seat 0 finishes planning while it is
   * still ALONE in the room, where no clock runs at all (asserted at the top
   * of this file). Seat 1 then joins into a game that is waiting only on
   * them — so seat 0 has its whole bank, seat 1 is the only one being billed,
   * and which seat runs out is a fact rather than a coin flip decided by how
   * loaded the box is.
   */
  console.log('\n[BL-27: a seat that stops acting runs out of time and LOSES]');
  const BANK = 2500;
  const eRoom = await mintExtra(PORT);
  const e0 = new Client(PORT);
  await e0.open();
  e0.send({ t: 'join', room: eRoom, seat: 0, name: 'Patient', clock: BANK });
  const e0j = await e0.next(m => m.t === 'joined');
  ok(e0j.clock?.start === BANK, `a ${BANK}ms room`);
  const e0m = e0.msgs.length;
  e0.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } as Action });
  await e0.next(m => m.t === 'update' && m.view?.planningDone?.[0] === true, 5000, e0m);
  const e1 = new Client(PORT);
  await e1.open();
  e1.send({ t: 'join', room: eRoom, seat: 1, name: 'Staller' });
  const e1j = await e1.next(m => m.t === 'joined');
  ok(e1j.clock?.running[0] === false && e1j.clock?.running[1] === true,
    'only the stalling seat is on the clock');

  // …and now NOBODY DOES ANYTHING. This is the whole trap: settleClock() runs
  // when something happens, so the one situation this feature exists for is
  // the one where nothing ever calls it. The sweep is what notices.
  // …and the awaits are `.catch(() => null)` rather than bare, on purpose. The
  // failure this section guards against is a game that NEVER ENDS, and a bare
  // await for a message that never comes fails as a bare timeout with no
  // sentence attached. Caught, it fails as the requirement it is.
  const over1 = await e1.next(m => m.t === 'gameover', 15_000).catch(() => null);
  ok(over1?.winner === 0,
    'THE TRAP, SPRUNG: neither player acted, so nothing called settleClock — and the game still '
    + `ENDED, with the staller losing (seat ${over1?.winner} wins)`);
  const over0 = await e0.next(m => m.t === 'gameover', 15_000).catch(() => null);
  ok(over0?.winner === 0, 'and the other seat is told the same thing');
  ok(e0.msgs.some(m => (m.events ?? []).some(ev => /ran out of time/.test(ev.msg))),
    'the log says what happened, in words — not a game that silently stopped');
  ok(e0.clock?.running[0] === false && e0.clock?.running[1] === false,
    'and BOTH clocks stopped — the board is still full of legal moves, so nothing but the '
    + 'stamped result can tell the clock the game is over');
  {
    const saved = JSON.parse(readFileSync(gameFile(eRoom), 'utf8')) as
      { winner?: number | null; actions: unknown[] };
    ok(saved.winner === 0,
      'THE RESULT IS STAMPED IN THE FILE, exactly as a concession is — so the history sync and '
      + 'the rating fold see an ordinary decided game rather than `finished: false`');
    ok(saved.actions.every(a => (a as { type: string }).type !== 'concede'),
      'and it is NOT faked as an action: running out of time is not something anybody DID, and '
      + 'a pseudo-action would stop the log reproducing its own game');
  }
  {
    // the loser must not be able to keep playing a game they have already lost:
    // the BOARD still looks perfectly legal, which is the whole hazard
    const em = e1.msgs.length;
    e1.send({ t: 'action', action: { type: 'donePlanning', seat: 1 } as Action });
    const err = await e1.next(m => m.t === 'error', 5000, em).catch(() => null);
    ok(/already over/.test(err?.msg ?? ''),
      `an action after the loss is REFUSED (${err?.msg})`);
  }

  console.log('\n[BL-27: nothing expires in a room with no clock]');
  {
    const nRoom = await mintExtra(PORT);
    const n0 = new Client(PORT);
    await n0.open();
    n0.send({ t: 'join', room: nRoom, seat: 0, name: 'Forever', clock: 'off' });
    await n0.next(m => m.t === 'joined');
    n0.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } as Action });
    const n1 = new Client(PORT);
    await n1.open();
    n1.send({ t: 'join', room: nRoom, seat: 1, name: 'AlsoForever' });
    await n1.next(m => m.t === 'joined');
    const mark = n1.msgs.length;
    await sleep(BANK + 1500);          // longer than the timed room's whole bank
    ok(!n1.msgs.slice(mark).some(m => m.t === 'gameover'),
      'both players sat still for longer than a whole bank and nobody lost');
    const nm = n1.msgs.length;
    n1.send({ t: 'action', action: n1.legal.find(x => x.type === 'donePlanning')! });
    const nu = await n1.next(m => m.t === 'update' || m.t === 'error', 5000, nm);
    ok(nu.t === 'update', 'and the game is still perfectly playable');
  }

  console.log('\n[BL-27: a disconnected seat does not bleed time]');
  {
    const dRoom = await mintExtra(PORT);
    const g0 = new Client(PORT);
    await g0.open();
    g0.send({ t: 'join', room: dRoom, seat: 0, name: 'Waiting', clock: 4000 });
    await g0.next(m => m.t === 'joined');
    const gm = g0.msgs.length;
    g0.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } as Action });
    await g0.next(m => m.t === 'update' && m.view?.planningDone?.[0] === true, 5000, gm);

    const g1 = new Client(PORT);
    await g1.open();
    g1.send({ t: 'join', room: dRoom, seat: 1, name: 'Dropped' });
    await g1.next(m => m.t === 'joined');
    g1.ws.close();                      // the tab dies; the clock must stop
    await sleep(5000);                  // longer than the whole 4s bank

    const g1b = new Client(PORT);
    await g1b.open();
    g1b.send({ t: 'join', room: dRoom, seat: 1, name: 'Dropped' });
    const back = await g1b.next(m => m.t === 'joined', 8000);
    ok(back.t === 'joined' && !g0.msgs.some(m => m.t === 'gameover'),
      'five seconds offline on a four-second bank cost the absent player NOTHING');
    ok((back.clock?.ms[1] ?? -1) > 3000,
      `their bank is still intact (${(back.clock?.ms[1] ?? -1)}ms of 4000)`);
  }

  console.log('\n[BL-27: nobody loses on time the server spent switched off]');
  {
    const rRoom = await mintExtra(PORT);
    const h0 = new Client(PORT);
    await h0.open();
    h0.send({ t: 'join', room: rRoom, seat: 0, name: 'Rebooter', clock: 4000 });
    await h0.next(m => m.t === 'joined');
    const hm = h0.msgs.length;
    h0.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } as Action });
    await h0.next(m => m.t === 'update' && m.view?.planningDone?.[0] === true, 5000, hm);

    await server.stop();
    await sleep(5000);                  // downtime longer than the whole bank
    server = await startServer();
    PORT = server.port;

    const i1 = new Client(PORT);
    await i1.open();
    i1.send({ t: 'join', room: rRoom, seat: 1, name: 'Opponent' });
    const i1j = await i1.next(m => m.t === 'joined', 8000);
    ok((i1j.clock?.ms[1] ?? -1) > 3000,
      `the hours the server was DOWN are billed to nobody (${(i1j.clock?.ms[1] ?? -1)}ms of 4000)`);
    ok(!i1.msgs.some(m => m.t === 'gameover'),
      'and the game is still live — a restart is not a loss');
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
} finally {
  await server.stop();
  rmSync(gameFile(ROOM), { force: true });
  rmSync(gameFile(DROOM), { force: true });
  for (const c of EXTRA) rmSync(gameFile(c), { force: true });
  rmSync(SCRATCH, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
