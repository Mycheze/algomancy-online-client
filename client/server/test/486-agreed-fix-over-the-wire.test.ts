/* BL-46 — AGREED FIXES OVER THE WIRE, against the real server.
 *
 * The owner, 2026-10-16: "Assuming both players agree, it doesn't change
 * anything in the game. it'll only be used to solve broken engine/game
 * issues." This file spawns main.ts (an OS-assigned port, its own throwaway
 * games, accounts and report files) and plays two seats over raw sockets:
 *
 *   §1 ⚠ THE GATE: an `amend` sent as an action is refused, whoever it names
 *      as agreeing — a fix lands only through the other seat's accept
 *   §2 propose → accept: the edit lands for both, in the log, the clocks stop
 *      while it waits, and a bug report is filed into the report journal
 *   §3 the proposer cannot accept their own; a decline cools them down
 *   §4 a rewind: both seats get a whole fresh view, the file archives what
 *      was taken back
 *   §4b fixes inside the hidden planning and deploy steps reach the other
 *      seat at once
 *   §5 the fixed game survives a restart of the server and replays FAITHFUL
 *   §6 two fixes with no move between them file ONE report, and a restart
 *      before the next move still files it
 *
 * Seeds: the server picks its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, Seat } from '../../engine/src/types.ts';
import { mintRoom, spawnServer, type ServerHandle } from '../e2e/test-util.ts';
import { analyze, reportLines, type RoomFile } from '../replay-room.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-486-'));
const ENV = {
  ALGO_GAMES_DIR: join(DIR, 'games'),
  ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl'),
  ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'),
};

interface Msg {
  t: string; seat?: Seat; view?: any; log?: string[]; legal?: Action[];
  events?: { msg: string }[]; msg?: string; fix?: any; how?: string; clock?: any;
  rewinds?: { to: number; label: string }[]; rewound?: boolean;
}

class Client {
  ws: WebSocket;
  view: any = null;
  legal: Action[] = [];
  log: string[] = [];
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
    if (m.log) this.log = [...m.log];
    if (m.events) for (const e of m.events) if (e.msg) this.log.push(e.msg);
    const i = this.waiters.findIndex(w => w.pred(m));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
  }
  next(pred: (m: Msg) => boolean, after = 0, timeoutMs = 8000): Promise<Msg> {
    const past = this.msgs.findIndex((m, i) => i >= after && pred(m));
    if (past >= 0) return Promise.resolve(this.msgs[past]!);
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for message')), timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  /** send, and wait for the reply that matches */
  async ask(obj: unknown, pred: (m: Msg) => boolean): Promise<Msg> {
    const mark = this.msgs.length;
    this.send(obj);
    return this.next(pred, mark);
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
/** the report rows the agreed fixes of this room filed */
const fixRows = (): any[] => (existsSync(ENV.ALGO_ISSUES_FILE) ? readFileSync(ENV.ALGO_ISSUES_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
  .filter(r => r.room === ROOM && r.fix);
async function quiesce(a: Client, b: Client, quietMs = 150, maxMs = 4000): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const since = Date.now() - Math.max(a.lastAt, b.lastAt);
    if (since >= quietMs || Date.now() >= deadline) return;
    await sleep(Math.min(quietMs - since, 40));
  }
}

/** the same plain player the in-process tests use (485): enough to reach battle */
function greedy(c: Client, seat: Seat, recycled: Set<string>): Action | null {
  const legal = c.legal.filter(a => a.seat === seat);
  const v = c.view;
  const key = `${v.turn}:${seat}`;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && !recycled.has(key)) { recycled.add(key); return rec; }
  return legal.find(a => a.type === 'activateResource')
    ?? (v.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
    ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
    ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? null;
}

const battleWindow = (v: any): boolean => v && v.phase === 'battle' && !v.decision && !v.pendingAsk && v.priority !== null
  && !(v.phase === 'planning' || v.phase === 'deploy');

async function driveToBattle(a: Client, b: Client): Promise<void> {
  return driveUntil(a, b, v => battleWindow(v));
}
async function driveUntil(a: Client, b: Client, want: (v: any) => boolean): Promise<void> {
  const recycled = new Set<string>();
  for (let i = 0; i < 300; i++) {
    await quiesce(a, b);
    if (want(a.view) && want(b.view) && a.view.actionCount === b.view.actionCount) return;
    let sent = false;
    for (const [c, seat] of [[a, 0], [b, 1]] as [Client, Seat][]) {
      const pick = greedy(c, seat, recycled);
      if (!pick) continue;
      const mark = c.msgs.length;
      c.send({ t: 'action', action: pick });
      try { await c.next(m => m.t === 'update' || m.t === 'error', mark, 5000); } catch { /* keep driving */ }
      sent = true;
      break;
    }
    if (!sent) await sleep(80);
  }
  throw new Error('never reached the state asked for');
}

let server: ServerHandle;
let ROOM = '';
let a: Client, b: Client;
const seatClient = (s: Seat): Client => (s === 0 ? a : b);
let afterRewind = 0;
/** the seat a decline cooled down in §3 — §4 proposes from the other one */
let cooled: Seat = 0;

test.before(async () => {
  server = await spawnServer(ENV);
  ROOM = await mintRoom(server.port);
  a = new Client(server.port); b = new Client(server.port);
  await a.open(); await b.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Ann' });
  await a.next(m => m.t === 'joined');
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Bo' });
  await b.next(m => m.t === 'joined');
});
test.after(async () => {
  try { a?.ws.close(); b?.ws.close(); } catch { /* closing */ }
  await server?.stop();
});

test('§1 an amend sent as an action is refused, whoever it names as agreeing', async () => {
  await quiesce(a, b);
  const count = a.view.actionCount;
  for (const action of [
    { type: 'amend', seat: 0, by: 1, edit: { kind: 'drawCards', target: 0, n: 1 } },
    { type: 'amend', seat: 0, by: 0, edit: { kind: 'life', target: 1, life: 1 } },
  ]) {
    const err = await a.ask({ t: 'action', action }, m => m.t === 'error');
    assert.match(err.msg ?? '', /lands only when your opponent agrees/, 'the server refused it by name');
  }
  await quiesce(a, b);
  assert.equal(a.view.actionCount, count, 'nothing reached the log');
  assert.ok(!a.log.some(l => /Agreed fix/.test(l)));
});

test('§2 propose then accept: the edit lands for both, the clocks stop meanwhile, a report is filed', async () => {
  await driveToBattle(a, b);
  const P = a.view.priority as Seat;
  const O = (P === 0 ? 1 : 0) as Seat;
  const prop = seatClient(P), opp = seatClient(O);
  assert.ok(prop.msgs.some(m => m.t === 'joined' && m.fix), 'a room between two players says it takes fixes');
  const hand = prop.view.players[P].hand.length;
  const markO = opp.msgs.length;
  prop.send({ t: 'amend', op: 'propose', edit: { kind: 'drawCards', target: P, n: 1 }, reason: 'my draw did not trigger' });
  const seen = await opp.next(m => m.t === 'amend' && m.how === 'proposed', markO);
  assert.equal(seen.fix.proposal.seat, P);
  assert.match(seen.fix.proposal.what, /draws 1 card/);
  assert.equal(seen.fix.proposal.reason, 'my draw did not trigger', 'the other seat reads why');
  assert.deepEqual(seen.clock?.running, [false, false], 'both clocks stop while it waits');
  const markP = prop.msgs.length;
  opp.send({ t: 'amend', op: 'accept', id: seen.fix.proposal.id });
  await prop.next(m => m.t === 'amend' && m.how === 'applied', markP);
  await quiesce(a, b);
  assert.equal(prop.view.players[P].hand.length, hand + 1, 'the proposer drew');
  for (const c of [a, b]) {
    assert.ok(c.log.some(l => /Agreed fix: .*draws 1 card.*agreed by/.test(l)), 'a public line in both logs');
  }
  const applied = [...prop.msgs].reverse().find(m => m.t === 'amend')!;
  assert.equal(applied.fix.proposal, undefined, 'nothing is waiting any more');
  assert.ok(applied.clock.running.some(Boolean), 'and the clocks run again');
  // one report per RUN of fixes (rooms.ts FixRun): filed when the next game
  // action lands, not before — a second fix now would join this one
  await sleep(300);
  assert.equal(fixRows().length, 0, 'not filed while the run may still continue');
  const mover = seatClient(prop.view.priority as Seat);
  const pass = mover.legal.find(x => x.type === 'passPriority');
  assert.ok(pass, 'fixture: the seat with priority may pass');
  mover.send({ t: 'action', action: pass });
  await quiesce(a, b);
  await sleep(300);
  const rows = fixRows();
  assert.equal(rows.length, 1, 'the move after it filed the run, once');
  const row = rows.at(-1);
  assert.equal(row.room, ROOM);
  assert.equal(row.kind, 'bug');
  assert.equal(row.fix.kind, 'edit');
  assert.equal(row.fix.agreedBy, O);
  assert.equal(row.seat, P, 'filed as the proposer');
  assert.match(row.note, /^\[Agreed fix\] .*What went wrong: my draw did not trigger$/);
  assert.equal(typeof row.actionIndex, 'number', 'with the moment to replay to');
});

test('§3 the proposer cannot accept their own fix; a decline cools them down', async () => {
  await quiesce(a, b);
  const P = a.view.priority as Seat;
  const O = (P === 0 ? 1 : 0) as Seat;
  const prop = seatClient(P), opp = seatClient(O);
  const life = { kind: 'life', target: O, life: 9 };
  const up = await prop.ask({ t: 'amend', op: 'propose', edit: life, reason: 'the damage was dealt twice' }, m => m.t === 'amend' && m.how === 'proposed');
  const id = up.fix.proposal.id;
  const own = await prop.ask({ t: 'amend', op: 'accept', id }, m => m.t === 'amenderr');
  assert.match(own.msg ?? '', /other player answers/);
  const markP = prop.msgs.length;
  opp.send({ t: 'amend', op: 'decline', id });
  await prop.next(m => m.t === 'amend' && m.how === 'declined', markP);
  const again = await prop.ask({ t: 'amend', op: 'propose', edit: life, reason: 'please' }, m => m.t === 'amenderr');
  assert.match(again.msg ?? '', /declined — wait/);
  cooled = P;
  assert.notEqual(opp.view.players[O].life, 9, 'nothing changed');
});

test('§4 a rewind: both seats get a fresh view, and the file archives what was taken back', async () => {
  await quiesce(a, b);
  const before = a.view.actionCount;
  const prop = seatClient(cooled === 0 ? 1 : 0), opp = seatClient(cooled);
  const opts = await prop.ask({ t: 'amend', op: 'options' }, m => m.t === 'amendopts');
  assert.ok(opts.rewinds && opts.rewinds.length, 'rewinds are on offer');
  const pick = opts.rewinds![0]!;
  const up = await prop.ask({ t: 'amend', op: 'propose', rewind: pick.to, reason: 'I misclicked the pass' }, m => m.t === 'amend' && m.how === 'proposed');
  const markA = a.msgs.length, markB = b.msgs.length;
  opp.send({ t: 'amend', op: 'accept', id: up.fix.proposal.id });
  const ja = await a.next(m => m.t === 'joined' && m.rewound === true, markA);
  const jb = await b.next(m => m.t === 'joined' && m.rewound === true, markB);
  assert.ok(ja.view.actionCount <= before && jb.view.actionCount === ja.view.actionCount, 'both are on the rewound board');
  assert.ok(ja.log!.some(l => /Agreed fix: back to /.test(l)), 'the log says so');
  await sleep(300);
  const file = JSON.parse(readFileSync(join(ENV.ALGO_GAMES_DIR, `${ROOM}.json`), 'utf8'));
  assert.equal(file.actions.length, pick.to, 'the log was cut there');
  const rw = file.amendments.find((x: any) => x.kind === 'rewind');
  assert.equal(rw.at, pick.to);
  assert.ok(rw.removed.length >= 1, 'the actions taken back are archived');
  assert.equal(rw.reason, 'I misclicked the pass');
  afterRewind = file.actions.length;
});

test('§4b fixes inside the hidden planning and deploy steps reach the other seat at once', async () => {
  const P = (cooled === 0 ? 1 : 0) as Seat, O = cooled;
  const prop = seatClient(P), opp = seatClient(O);
  for (const [step, edit, check] of [
    ['planning', { kind: 'drawCards', target: P, n: 1 }, (before: any, after: any) => after.players[P].hand.length === before.players[P].hand.length + 1],
    ['deploy', { kind: 'life', target: P, life: 23 }, (_b: any, after: any) => after.players[P].life === 23],
  ] as const) {
    await driveUntil(a, b, v => v.phase === step && !v.decision && !v.pendingAsk);
    await quiesce(a, b);
    const before = opp.view;
    const up = await prop.ask({ t: 'amend', op: 'propose', edit, reason: `${step}: the game skipped it` }, m => m.t === 'amend' && m.how === 'proposed');
    const markO = opp.msgs.length;
    opp.send({ t: 'amend', op: 'accept', id: up.fix.proposal.id });
    const upd = await opp.next(m => m.t === 'update' && !!m.events?.some(e => /Agreed fix/.test(e.msg)), markO);
    assert.equal(upd.view.phase, step, `${step}: still inside the hidden step`);
    assert.ok(check(before, upd.view), `${step}: the other seat is shown the fix at once, on the half it otherwise sees frozen`);
  }
  await quiesce(a, b);
  await sleep(300);
  afterRewind = JSON.parse(readFileSync(join(ENV.ALGO_GAMES_DIR, `${ROOM}.json`), 'utf8')).actions.length;
});

test('§5 the fixed game survives a restart of the server and replays FAITHFUL', async () => {
  a.ws.close(); b.ws.close();
  await server.stop();
  server = await spawnServer(ENV);
  a = new Client(server.port); b = new Client(server.port);
  await a.open(); await b.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Ann' });
  const j = await a.next(m => m.t === 'joined');
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Bo' });
  await b.next(m => m.t === 'joined');
  assert.ok(j.view, 'the room came back');
  assert.ok(!a.log.some(l => /could not be fully restored|restored onto changed rules/.test(l)), 'no fork on restore');
  const raw = JSON.parse(readFileSync(join(ENV.ALGO_GAMES_DIR, `${ROOM}.json`), 'utf8')) as RoomFile;
  assert.equal(raw.actions.length, afterRewind);
  const an = analyze(raw);
  assert.deepEqual(an.refusals, []);
  assert.deepEqual(an.sigs, raw.sigs, 'every recorded fingerprint matches');
  assert.match(reportLines(`${ROOM}.json`, raw, an).lines.join('\n'), /FAITHFUL/);
});

test('§6 two fixes in a row file one report, and a restart in between does not lose it', async () => {
  await driveToBattle(a, b);
  await quiesce(a, b);
  const filed = fixRows().length;
  const P = a.view.priority as Seat;
  const prop = seatClient(P), opp = seatClient(P === 0 ? 1 : 0);
  for (const why of ['I passed by mistake', 'and one more back']) {
    const opts = await prop.ask({ t: 'amend', op: 'options' }, m => m.t === 'amendopts');
    assert.ok(opts.rewinds && opts.rewinds.length, `rewinds are on offer (${why})`);
    const up = await prop.ask({ t: 'amend', op: 'propose', rewind: opts.rewinds!.at(-1)!.to, reason: why }, m => m.t === 'amend' && m.how === 'proposed');
    const mark = prop.msgs.length;
    opp.send({ t: 'amend', op: 'accept', id: up.fix.proposal.id });
    await prop.next(m => m.t === 'amend' && m.how === 'applied', mark);
    await quiesce(a, b);
  }
  await sleep(300);
  assert.equal(fixRows().length, filed, 'nothing filed while the run may continue');
  // the restart: the run was persisted with the room, and boot files it
  a.ws.close(); b.ws.close();
  await server.stop();
  server = await spawnServer(ENV);
  a = new Client(server.port); b = new Client(server.port);
  await a.open(); await b.open();
  await sleep(300);
  const rows = fixRows();
  assert.equal(rows.length, filed + 1, 'ONE row for the two fixes');
  const row = rows.at(-1);
  assert.equal(row.fix.run, 2, 'it says it holds two');
  assert.equal(row.fix.kind, 'rewind');
  assert.match(row.note, /^\[Agreed fix\] back to .*What went wrong: I passed by mistake\n\[and then\] back to .*What went wrong: and one more back$/,
    'each fix in its own words, in order');
  assert.doesNotMatch(row.note, /logged/, 'and no count of the log');
  const file = JSON.parse(readFileSync(join(ENV.ALGO_GAMES_DIR, `${ROOM}.json`), 'utf8'));
  assert.equal(file.fixRun, undefined, 'the filed run is gone from the game file');
  assert.equal(file.amendments[row.fix.amendment].reason, 'I passed by mistake', 'the row points at its first fix in the file');
});
