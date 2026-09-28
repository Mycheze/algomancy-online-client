/* THE STANDING PASS STOPS THE CLOCK (run: node e2e/test-passall-clock.ts).
 *
 * The owner, 2026-09-28: *"When a player is 'Pass all'ed, their timer should
 * never go down."* He chose PAUSE + BACKSTOP: the client tells the server when
 * Pass all (or Pass through stack) is armed, the server stops that seat's clock
 * in every window the arm is answering, and if the client's own pass has not
 * arrived within PASS_ALL_BACKSTOP_MS the server passes for it, so a stuck tab
 * cannot freeze a game whose clock has stopped.
 *
 *   §1 an armed seat's clock does not move across its priority windows — and
 *      the OTHER seat, which has nothing to do in them, is not billed either
 *   §2 disarming bills again
 *   §3 the backstop passes after ~2s, the pass is in the ACTION LOG, the room
 *      replays it faithfully, and the client's own late pass for the same
 *      window is dropped rather than landed on the next one
 *   §4 a phase change clears the arm (passAllRelease's 'phase' rule): the next
 *      battle's window is billed
 *   §5 a real choice is billed even when armed — here the attack declaration,
 *      which is the same gate a decision or a target falls through (no
 *      `passPriority` on offer ⇒ not a pass window)
 *
 * A sandbox room (BL-06) because it is the one way to put a unit on the board
 * over the wire: turn 1 of an ordinary room has nothing to attack with, and an
 * empty board has no priority windows at all. The clock runs there exactly as
 * in any room. Same harness style as test-sandbox.ts.
 */
import { WebSocket } from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, Seat } from '../../engine/src/types.ts';
import { gameFile, spawnServer } from './test-util.ts';
import { analyze, type RoomFile } from '../replay-room.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-passall-'));
process.env['ALGO_GAMES_DIR'] = process.env['ALGO_GAMES_DIR'] ?? join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = process.env['ALGO_ACCOUNTS_FILE'] ?? join(SCRATCH, 'accounts.json');
// imported AFTER the scratch paths are set: rooms.ts resolves its games dir at load
const { PASS_ALL_BACKSTOP_MS } = await import('../rooms.ts');

let failures = 0;
const ok = (cond: unknown, what: string): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${what}`);
  if (!cond) failures++;
};
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
/** the clock is billed off wall time with a few ms of processing in every
 * interval; every interval asserted on here is hundreds of ms */
const SLOP = 150;

interface Clock { ms: [number, number]; running: [boolean, boolean]; at: number }
interface Msg { t: string; view?: any; legal?: Action[]; clock?: Clock; msg?: string; events?: { msg?: string }[] }

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  view: any = null;
  legal: Action[] = [];
  clock: Clock | null = null;
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', d => {
      const m = JSON.parse(String(d)) as Msg;
      this.msgs.push(m);
      if (m.view) this.view = m.view;
      if (m.legal) this.legal = m.legal;
      if (m.clock) this.clock = m.clock;
      const i = this.waiters.findIndex(w => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
    });
  }
  open(): Promise<void> { return new Promise(r => this.ws.on('open', () => r())); }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  /** the next message matching `pred` that arrives from NOW on */
  next(pred: (m: Msg) => boolean, timeoutMs = 6000): Promise<Msg> {
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for a message')), timeoutMs);
    });
  }
  async act(a: Action, extra: Record<string, unknown> = {}): Promise<void> {
    const got = this.next(m => m.t === 'update' || m.t === 'error');
    this.send({ t: 'action', action: a, ...extra });
    const m = await got;
    if (m.t === 'error') throw new Error(`${a.type} refused: ${m.msg}`);
    // both seats are pushed the same tick; let the other one's copy land too
    await sleep(150);
  }
  /** arm or drop the standing pass, exactly as ui/main.ts NET.passAll sends
   * it, and return the clock the server answers with */
  async passAll(on: boolean, mode: 'all' | 'stack' = 'all'): Promise<Clock> {
    const got = this.next(m => m.t === 'clock');
    this.send(on
      ? { t: 'passall', on: true, mode, phase: this.view.phase, items: this.view.stack.map((i: any) => i.id), opts: [] }
      : { t: 'passall', on: false });
    return (await got).clock!;
  }
  close(): void { this.ws.close(); }
}

const srv = await spawnServer();

/** a sandbox room with both seats in, seat 0 holding one unit, at the battle's
 * declare step (seat 0 attacking) */
async function battleTable(): Promise<{ room: string; a: Client; b: Client; unit: number }> {
  const body = await (await fetch(`http://localhost:${srv.port}/api/sandbox/open?json=1`)).json() as { code: string };
  const room = body.code;
  const a = new Client(srv.port), b = new Client(srv.port);
  await a.open(); await b.open();
  const ja = a.next(m => m.t === 'joined');
  a.send({ t: 'join', room, seat: 0, name: 'Ann' });
  await ja;
  const jb = b.next(m => m.t === 'joined');
  b.send({ t: 'join', room, seat: 1, name: 'Bo' });
  await jb;
  await sleep(150);
  await a.act({ type: 'sandboxSpawn', seat: 0, card: 'Towering Colossus', to: 'play' } as Action);
  await a.act({ type: 'sandboxAdvance', seat: 0 } as Action);
  const unit = (Object.values(a.view.entities) as any[]).find(e => e.kind === 'unit' && e.controller === 0).id;
  return { room, a, b, unit };
}

const savedActions = (room: string): Action[] =>
  (JSON.parse(readFileSync(gameFile(room), 'utf8')) as RoomFile).actions as Action[];

const { room, a, b, unit } = await battleTable();
ok(a.view.phase === 'battle' && a.view.battle?.step === 'declare', `fixture: at the declare step (${a.view.battle?.step})`);

console.log('\n§5 — a real choice is billed even when armed');
{
  const c = await a.passAll(true);
  ok(c.running[0] === true,
    'seat 0 armed Pass all at its attack declaration and its clock still runs — a declaration '
    + '(like a decision or a target) is a choice the arm does not make, so it is billed');
  await a.passAll(false);
}

console.log('\n§1 — an armed seat\'s clock does not move across its priority windows');
let ms0: number;
{
  await a.act({ type: 'declareAttack', seat: 0, columns: [[unit]] });
  ok(a.view.battle?.step === 'attackWindow' && a.view.priority === 0, 'fixture: seat 0 holds priority in the attack window');
  ok(a.clock!.running[0] === true, 'positive control: unarmed, the seat holding priority is billed');
  const c = await a.passAll(true);
  ok(c.running[0] === false, 'armed: seat 0\'s clock stops in the window its arm is answering');
  ok(c.running[1] === false, 'and the other seat, with nothing to do in it, is not billed for the wait');
  ms0 = c.ms[0];
  await sleep(1200);   // below the backstop
  const off = await a.passAll(false);
  ok(Math.abs(off.ms[0] - ms0) <= SLOP,
    `1.2s sat in the window armed cost ${ms0 - off.ms[0]}ms of seat 0's bank (must be ~0)`);

  console.log('\n§2 — disarming bills again');
  ok(off.running[0] === true, 'disarmed: seat 0\'s clock runs again in the same window');
  await sleep(800);
  const re = await a.passAll(true);
  ok(re.ms[0] <= off.ms[0] - 800 + SLOP && re.ms[0] >= off.ms[0] - 800 - SLOP,
    `the 0.8s spent disarmed was billed (${off.ms[0] - re.ms[0]}ms)`);
  ms0 = re.ms[0];

  // the client's own pass, as ui/main.ts sends it (stamped with its view)
  await a.act({ type: 'passPriority', seat: 0 }, { at: a.view.actionCount });
  ok(a.view.priority === 1, 'seat 0 passed; seat 1 holds priority');
  ok(a.clock!.running[1] === true, 'seat 1 is not armed, so its window is billed as always');
  await sleep(300);
  await b.act({ type: 'passPriority', seat: 1 });
  ok(a.view.battle?.step === 'blockWindow' && a.view.priority === 0, 'fixture: the block window, seat 0 to act');
  ok(a.clock!.running[0] === false, 'the arm carries into the NEXT window: seat 0 is still not billed');
  ok(Math.abs(a.clock!.ms[0] - ms0) <= SLOP,
    `across a whole priority window and the opponent's turn in it, seat 0's bank moved ${ms0 - a.clock!.ms[0]}ms`);
}

console.log('\n§3 — the backstop passes for a seat whose client does not');
{
  const at = a.view.actionCount as number;
  const before = savedActions(room).length;
  const t0 = Date.now();
  const passed = await a.next(m => m.t === 'update' && m.view?.priority === 1, PASS_ALL_BACKSTOP_MS + 3000);
  const took = Date.now() - t0;
  ok(took >= PASS_ALL_BACKSTOP_MS - 100 && took <= PASS_ALL_BACKSTOP_MS + 1600,
    `the server passed for seat 0 after ${took}ms (backstop ${PASS_ALL_BACKSTOP_MS}ms, 1s sweep)`);
  ok(Math.abs(passed.clock!.ms[0] - ms0) <= SLOP,
    `and the ${took}ms it waited cost seat 0 ${ms0 - passed.clock!.ms[0]}ms (must be ~0)`);
  const log = savedActions(room);
  ok(log.length === before + 1, 'exactly one action was added');
  const last = log[log.length - 1] as { type: string; seat: Seat };
  ok(last.type === 'passPriority' && last.seat === 0,
    `and it is seat 0's passPriority, in the room's action log (${JSON.stringify(last)})`);
  const an = analyze(JSON.parse(readFileSync(gameFile(room), 'utf8')) as RoomFile);
  ok(an.refusals.length === 0 && an.divergedAt === null,
    'the saved room replays with the backstop\'s pass in it: nothing refused, no divergence');

  // …and the client's OWN pass for that window, arriving late, is dropped: it
  // must not land on seat 1's window (illegal) or on a later one of seat 0's
  const errs = a.msgs.filter(m => m.t === 'error').length;
  a.send({ t: 'action', action: { type: 'passPriority', seat: 0 }, at });
  await sleep(400);
  ok(savedActions(room).length === before + 1, 'the late pass for the backstopped window added nothing');
  ok(a.msgs.filter(m => m.t === 'error').length === errs, 'and was dropped without an error on the player\'s screen');
}

console.log('\n§4 — a phase change clears the arm');
{
  await b.act({ type: 'passPriority', seat: 1 });
  ok(a.view.battle?.step === 'afterWindow' && a.view.priority === 0, 'fixture: the after window, seat 0 to act');
  await a.act({ type: 'passPriority', seat: 0 }, { at: a.view.actionCount });
  await b.act({ type: 'passPriority', seat: 1 });
  ok(a.view.phase !== 'battle',
    `the battle is over (now ${a.view.phase} ${a.view.battle?.step ?? ''}, priority ${a.view.priority})`);
  // round the turn to the next battle WITHOUT re-arming
  await a.act({ type: 'sandboxAdvance', seat: 0 } as Action);
  await a.act({ type: 'sandboxAdvance', seat: 0 } as Action);
  ok(a.view.phase === 'battle' && a.view.battle?.step === 'declare', `fixture: the next battle (${a.view.battle?.step})`);
  const u2 = (Object.values(a.view.entities) as any[]).find(e => e.kind === 'unit' && e.controller === 0).id;
  await a.act({ type: 'declareAttack', seat: 0, columns: [[u2]] });
  // initiative moves with the turn, so seat 1 may open this window
  if (a.view.priority === 1) await b.act({ type: 'passPriority', seat: 1 });
  ok(a.view.priority === 0, `fixture: seat 0 holds priority in the new attack window (${a.view.priority})`);
  ok(a.clock!.running[0] === true,
    'the arm from the LAST battle was dropped when its phase ended: seat 0 is billed here');
  const t0 = Date.now();
  await sleep(PASS_ALL_BACKSTOP_MS + 1200);
  ok(a.view.priority === 0 && Date.now() - t0 > PASS_ALL_BACKSTOP_MS,
    'and nothing passed for it: the backstop answers only a standing arm');
}

a.close(); b.close();
await srv.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
