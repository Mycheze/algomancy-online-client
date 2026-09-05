/* Seat binding — a CLAIMED seat belongs to its account
 * (run: node test-seat-binding.ts).
 *
 * Until 2026-09-05 a specifically-requested seat was granted to anyone,
 * occupied or not: the incumbent's tab was kicked and — because the account
 * was resolved after the seat was picked — a signed-out joiner also wrote
 * null over the victim's binding, so the game stopped counting for them.
 * On a LAN with two known players that was the feature. On an open URL it
 * was anyone with a four-letter code sitting down in a live game and reading
 * that hand.
 *
 * rooms.ts's `seatVerdict` is the decision, as a value. This file reads it
 * in-process for the four rows, then proves the property that matters over
 * the real server:
 *
 *   ⚠ THE REFUSED JOINER NEVER RECEIVES ANY MESSAGE CARRYING A `view`.
 *
 * Asserted as an ABSENCE, not as the presence of the error — a fix that
 * refused and also leaked would pass the other way round. And asserted with
 * the victim FULLY DISCONNECTED, because that is the case a socket-only fix
 * gets wrong: the claim is what binds, not the live connection.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintRoom, spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-seat-test-'));
const STORE = join(SCRATCH, 'accounts.json');
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = STORE;
process.env['ALGO_GAMES_DIR'] = GAMES;

const { seatVerdict } = await import('./rooms.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── 1. the verdict as a value ─────────────────────────────────────────

console.log('\n[seatVerdict: the four rows]');
{
  const live = {} as never;   // any non-null stands in for a socket
  const room = (users: [string | null, string | null], sockets: [unknown, unknown]): Parameters<typeof seatVerdict>[0] =>
    ({ users, names: ['Ann', 'Bob'], sockets }) as never;

  const taken = seatVerdict(room(['ann', null], [live, null]), 0, 'bob');
  ok('refuse' in taken && /belongs to Ann/.test(taken.refuse), 'requested, claimed by another → refused, naming the occupant');
  const takenGone = seatVerdict(room(['ann', null], [null, null]), 0, 'bob');
  ok('refuse' in takenGone, '…and still refused when the occupant\'s socket is gone: the CLAIM binds');
  const signedOut = seatVerdict(room(['ann', null], [null, null]), 0, null);
  ok('refuse' in signedOut && /log in/.test(signedOut.refuse), 'a signed-out joiner is refused a claimed seat, and told to log in');

  const mine = seatVerdict(room(['ann', null], [live, null]), 0, 'ann');
  ok('seat' in mine && mine.seat === 0 && mine.kicked === live, 'requested, claimed by me → allowed, the stale tab kicked');

  const unclaimed = seatVerdict(room([null, null], [live, null]), 0, 'bob');
  ok('seat' in unclaimed && unclaimed.kicked === live, 'requested, unclaimed → allowed, whoever is there kicked (the signed-out carve-out)');

  const auto = seatVerdict(room(['ann', null], [null, null]), undefined, 'bob');
  ok('seat' in auto && auto.seat === 1, 'no seat requested → the first seat not claimed by another');
  const autoMine = seatVerdict(room(['ann', 'bob'], [live, live]), undefined, 'ann');
  ok('seat' in autoMine && autoMine.seat === 0 && autoMine.kicked === live,
    'no seat requested, but I hold a claim → MY seat, even when both are occupied');
  const full = seatVerdict(room(['ann', 'bob'], [null, null]), undefined, 'cat');
  ok('refuse' in full && /full/.test(full.refuse), 'both claimed by others → full, even with nobody connected');
  const autoSignedOut = seatVerdict(room(['ann', null], [null, null]), undefined, null);
  ok('seat' in autoSignedOut && autoSignedOut.seat === 1, 'signed out, no seat requested → the unclaimed one');
}

// ── 2. the real server ────────────────────────────────────────────────

type Msg = Record<string, any>;
class Client {
  ws: WebSocket;
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
  close(): Promise<void> {
    return new Promise(res => { this.ws.addEventListener('close', () => res(), { once: true }); this.ws.close(); });
  }
  private onMsg(m: Msg): void {
    this.msgs.push(m);
    const i = this.waiters.findIndex(w => w.pred(m));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
  }
  next(pred: (m: Msg) => boolean, timeoutMs = 5000): Promise<Msg> {
    const past = this.msgs.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((res, rej) => {
      this.waiters.push({ pred, resolve: res });
      setTimeout(() => rej(new Error('timeout waiting for message')), timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  /** the load-bearing assertion: nothing with a board in it ever arrived */
  sawBoard(): boolean { return this.msgs.some(m => m.view !== undefined || m.t === 'joined'); }
}
const settle = (ms = 500): Promise<void> => new Promise(res => setTimeout(res, ms));

console.log('\n[server: a claimed seat cannot be taken]');
const server = await spawnServer({ ALGO_ACCOUNTS_FILE: STORE, ALGO_GAMES_DIR: GAMES });
const PORT = server.port;
const base = `http://localhost:${PORT}`;
const register = async (username: string): Promise<string> => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'a good password' }),
  });
  const r = await res.json() as { ok: boolean; token?: string };
  if (!r.ok || !r.token) throw new Error(`register ${username} failed`);
  return r.token;
};
const savedUsers = (code: string): (string | null)[] =>
  (JSON.parse(readFileSync(join(GAMES, `${code}.json`), 'utf8')) as { users: (string | null)[] }).users;

try {
  const ann = await register('Ann');
  const bob = await register('Bob');
  const ROOM = await mintRoom(PORT);

  const annTab = new Client(PORT);
  await annTab.open();
  annTab.send({ t: 'join', room: ROOM, seat: 0, token: ann, mode: 'shared' });
  const annJoined = await annTab.next(m => m.t === 'joined');
  eq(annJoined.seat, 0, 'Ann takes seat 0, signed in');
  const annId = savedUsers(ROOM)[0];
  ok(typeof annId === 'string', 'and the saved room claims seat 0 for her account');

  // Bob, signed in as somebody else, asks for her seat
  const bobTab = new Client(PORT);
  await bobTab.open();
  bobTab.send({ t: 'join', room: ROOM, seat: 0, token: bob, mode: 'shared' });
  const refused = await bobTab.next(m => m.t === 'error');
  ok(/belongs to Ann/.test(String(refused.msg)), `Bob is refused, and told whose seat it is: "${refused.msg}"`);
  await settle();
  ok(!bobTab.sawBoard(), 'THE POINT: Bob received no message carrying a view');
  ok(!annTab.msgs.some(m => m.t === 'kicked'), 'and Ann was not kicked');

  // Ann fully disconnects. The socket is gone; the claim is not.
  await annTab.close();
  await settle();
  const bobAgain = new Client(PORT);
  await bobAgain.open();
  bobAgain.send({ t: 'join', room: ROOM, seat: 0, token: bob, mode: 'shared' });
  await bobAgain.next(m => m.t === 'error');
  await settle();
  ok(!bobAgain.sawBoard(), 'with Ann FULLY DISCONNECTED, Bob is still refused her seat and sees no view');

  // a signed-out stranger with the code
  const stranger = new Client(PORT);
  await stranger.open();
  stranger.send({ t: 'join', room: ROOM, seat: 0, name: 'Stranger', mode: 'shared' });
  const strangerErr = await stranger.next(m => m.t === 'error');
  ok(/log in/.test(String(strangerErr.msg)), 'a signed-out joiner is refused the claimed seat and told to log in');
  await settle();
  ok(!stranger.sawBoard(), 'and sees no view either');
  eq(savedUsers(ROOM)[0], annId, 'none of that touched the claim — the saved room still names Ann');

  // Ann comes back, from a different tab
  const annPhone = new Client(PORT);
  await annPhone.open();
  annPhone.send({ t: 'join', room: ROOM, seat: 0, token: ann, mode: 'shared' });
  const back = await annPhone.next(m => m.t === 'joined');
  eq(back.seat, 0, 'Ann herself rejoins her seat from a new tab');

  // Bob takes the OTHER, unclaimed seat
  const bobSeat1 = new Client(PORT);
  await bobSeat1.open();
  bobSeat1.send({ t: 'join', room: ROOM, seat: 1, token: bob, mode: 'shared' });
  const bobJoined = await bobSeat1.next(m => m.t === 'joined');
  eq(bobJoined.seat, 1, 'Bob takes the unclaimed seat 1');
  await settle();
  ok(savedUsers(ROOM)[1] !== null, 'which is now claimed for him');

  // auto-join: Ann with no seat in the link, both seats occupied — she lands
  // in HER seat and her stale tab is the one kicked
  const annLaptop = new Client(PORT);
  await annLaptop.open();
  annLaptop.send({ t: 'join', room: ROOM, token: ann, mode: 'shared' });
  const auto = await annLaptop.next(m => m.t === 'joined');
  eq(auto.seat, 0, 'auto-join with a claim lands in your own seat even when the room is "full"');
  ok(!!(await annPhone.next(m => m.t === 'kicked').catch(() => null)), 'and the stale tab is the one kicked');
  ok(!bobSeat1.msgs.some(m => m.t === 'kicked'), 'not the opponent');

  // auto-join as a third account: both seats claimed by others → full
  const cat = await register('Cat');
  const catTab = new Client(PORT);
  await catTab.open();
  catTab.send({ t: 'join', room: ROOM, token: cat, mode: 'shared' });
  const catErr = await catTab.next(m => m.t === 'error');
  ok(/full/.test(String(catErr.msg)), 'a third account auto-joining a claimed room is told it is full');
  await settle();
  ok(!catTab.sawBoard(), 'and sees no view');

  console.log('\n[server: the signed-out carve-out, unchanged from the LAN rule]');
  const ROOM2 = await mintRoom(PORT);
  const guest1 = new Client(PORT);
  await guest1.open();
  guest1.send({ t: 'join', room: ROOM2, seat: 0, name: 'Guest One', mode: 'shared' });
  await guest1.next(m => m.t === 'joined');
  const guest2 = new Client(PORT);
  await guest2.open();
  guest2.send({ t: 'join', room: ROOM2, seat: 0, name: 'Guest Two', mode: 'shared' });
  const g2 = await guest2.next(m => m.t === 'joined');
  eq(g2.seat, 0, 'an UNCLAIMED seat can still be taken over (no identity to bind to)');
  ok(!!(await guest1.next(m => m.t === 'kicked')), 'and the previous connection is kicked, as before');
  eq(savedUsers(ROOM2)[0], null, 'nobody was signed in, so nothing is claimed');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
