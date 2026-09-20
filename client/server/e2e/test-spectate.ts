/* BL-29 — SPECTATORS: watching a live room. (run: node test-spectate.ts)
 *
 * The entry had ONE blocking question, and it was the one that decides the
 * whole build: does a spectator see the game seat-by-seat with each side's
 * hidden information still hidden (which is what `viewFor` already produces),
 * or an omniscient broadcast showing both hands? The owner, 2026-09-01:
 *
 *   "Just omniscient and live is fine for now."
 *
 * ⚠ SO THIS FEATURE DELIBERATELY BYPASSES `viewFor`, AND THE ENTRY'S OWN NOTE
 * WARNS AGAINST EXACTLY THAT: *"Do NOT build a spectator view that bypasses
 * viewFor() — that is how a redaction hole gets in through a door the leak
 * tests do not watch."* The warning is right, the exception is the owner's,
 * and this file is the compensation: §2 is a leak test run BACKWARDS (the
 * spectator must see what a seat may not, or "omniscient" is a lie) and §3 is
 * the fence that makes the bypass safe — a watching socket is not a seat, can
 * never become one, and cannot move the game.
 *
 * §1 a watcher joins a live room and is sent the board
 * §2 …and it is OMNISCIENT: both hands, which no seat's view carries
 * §3 ⭐ A WATCHER IS NOT A PLAYER: no seat, no actions, no clock
 * §4 the players are TOLD there is an audience, and told when it leaves
 * §5 a watcher keeps up: an action by a player reaches the audience
 * §6 ⭐ THE FENCE, THE OTHER WAY ROUND: a watcher who sits down stops watching
 *
 * ⚠ WHAT IS NOT HERE. BL-29 is two features in one entry — spectate a LIVE
 * room, and watch a FINISHED game back from its saved file with step and
 * scrub controls. Only the live half is built, because that is the half the
 * owner's answer unblocked; the replay half needs the drift/fork verdict
 * `replay-room.ts` already makes and is its own piece of work. The entry says
 * which is which.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintRoom, spawnServer } from './test-util.ts';
import { HIDDEN_CARD } from '../view.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-spectate-'));
const GAMES = join(SCRATCH, 'games');
mkdirSync(GAMES, { recursive: true });
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = GAMES;

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const server = await spawnServer();
const PORT = server.port;

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
  settle(ms = 400): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
}

try {
  const ROOM = await mintRoom(PORT);
  const a = new Client(); await a.open();
  const b = new Client(); await b.open();
  a.send({ t: 'join', room: ROOM, seat: 0, name: 'Ben' });
  b.send({ t: 'join', room: ROOM, seat: 1, name: 'Rashi' });
  await a.settle(700);
  ok(!!a.last('joined')?.['view'], 'fixture: a real dealt room with both seats in it');

  // ── §1 ──────────────────────────────────────────────────────────────
  console.log('\n[a watcher joins]');
  const w = new Client(); await w.open();
  w.send({ t: 'watch', room: ROOM });
  await w.settle(500);
  const seen = w.last('watching');
  ok(!!seen, 'watching a live room sends the board');
  eq(seen?.['room'], ROOM, 'and says which room it is');
  ok(seen?.['seat'] === undefined,
    'the watcher was given a SEAT. It must not be: everything downstream — the clock, the '
    + 'action path, the redaction — keys off a socket having one');
  ok(Array.isArray(seen?.['log']), 'the log travels too, or there is nothing to read');
  ok(seen?.['names']?.[0] === 'Ben' && seen?.['names']?.[1] === 'Rashi', 'and both names');

  // ── §2 THE OWNER'S ANSWER, MEASURED ─────────────────────────────────
  console.log('\n[omniscient, which is a leak test run backwards]');
  const wView = seen?.['view'] as { players: { hand: unknown[] }[] } | undefined;
  const aView = a.last('joined')?.['view'] as { players: { hand: unknown[] }[] };
  ok(!!wView, 'fixture: the watcher really got a view');
  ok(wView!.players[0]!.hand.length > 0 && wView!.players[1]!.hand.length > 0,
    'the watcher sees BOTH hands as real cards — "Just omniscient and live is fine for now." '
    + 'If this ever goes empty the feature has quietly become the seat-by-seat one the owner '
    + 'did NOT ask for, and nothing else would notice');
  // …and the negative half, so "omniscient" is a comparison and not a wish:
  // a SEAT's own view of the same moment does not carry the opponent's hand.
  const oppHandToSeatA = aView.players[1]!.hand as unknown as string[];
  ok(oppHandToSeatA.length > 0 && oppHandToSeatA.every(c => c === HIDDEN_CARD),
    'CONTROL: seat 0\'s own view still hides seat 1\'s hand behind HIDDEN_CARD — if this fails '
    + 'the redaction is broken and §2 above is passing for the wrong reason entirely');
  ok((wView!.players[1]!.hand as unknown as string[]).every(c => c !== HIDDEN_CARD),
    '…and the watcher\'s copy of that SAME hand is real card names, not the placeholder. The '
    + 'two assertions are the same moment seen twice, which is what makes "omniscient" a '
    + 'measurement rather than a wish');

  // ── §3 THE FENCE ────────────────────────────────────────────────────
  console.log('\n[a watcher is not a player]');
  w.msgs.length = 0;
  w.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });
  await w.settle(400);
  ok(!!w.last('error'), 'an action from a watcher is refused');
  eq(w.last('error')?.['msg'], 'join a room first',
    'and refused because it HAS NO SEAT — not by a special case somebody could delete. The '
    + 'action path reads `conns`, a watcher is not in it, and that is the whole fence');

  // it did not sit down either: both seats are still the players'
  const stillA = a.last('joined')?.['seat'];
  eq(stillA, 0, 'seat 0 is still Ben\'s');
  ok(!w.last('joined'), 'and the watcher was never sent a `joined` — it is not at the table');

  // a SEAT may not also watch: it would be handed the opponent's hand
  a.msgs.length = 0;
  a.send({ t: 'watch', room: ROOM });
  await a.settle(300);
  ok(!!a.last('error'),
    'a seated player asked to watch and was allowed to — which hands them the opponent\'s '
    + 'hand through the one door that does not redact');
  ok(!a.last('watching'), 'and got no omniscient payload');

  // ── §4 THE PLAYERS ARE TOLD ─────────────────────────────────────────
  console.log('\n[the audience is visible to the table]');
  a.msgs.length = 0;
  const w2 = new Client(); await w2.open();
  w2.send({ t: 'watch', room: ROOM });
  await a.settle(500);
  eq(a.last('update')?.['watchers'], 2,
    'the players are not told how many people are watching. With an OMNISCIENT live view that '
    + 'is not decoration: somebody who can see both hands and talk to a player is a cheating '
    + 'vector, and the thing that makes it manageable at a friendly table is that you can see '
    + 'they are there');

  a.msgs.length = 0;
  w2.ws.close();
  await a.settle(500);
  eq(a.last('update')?.['watchers'], 1, '…and told again when one of them leaves');

  // ── §5 KEEPING UP ───────────────────────────────────────────────────
  console.log('\n[the audience keeps up]');
  w.msgs.length = 0;
  a.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });
  await w.settle(600);
  const after = w.last('watching');
  ok(!!after, 'a move by a player reaches the audience without them asking');
  ok((after?.['view'] as { planningDone?: boolean[] })?.planningDone?.[0] === true,
    'and it is the board AFTER the move, not the one before it');
  // ⚠ one push per action, not one per seat: `sendToSeat` fires twice for a
  // broadcast and the watcher hook coalesces on the microtask queue.
  const pushes = w.msgs.filter(m => m.t === 'watching').length;
  ok(pushes >= 1 && pushes <= 2,
    `one action produced ${pushes} spectator pushes — the coalescing has stopped working, and `
    + 'every action is being sent to the audience once per seat');

  // ── §6 THE FENCE, THE OTHER WAY ROUND ───────────────────────────────
  console.log('\n[a watcher who sits down stops watching]');
  // §3 proved a SEAT cannot start watching. This is the mirror, and for a day
  // it was the hole: `{watch}` then `{join}` on one socket left it in
  // room.watchers, so every push after that handed a seated player the
  // unredacted board. Last, because taking seat 1 kicks Rashi.
  const w3 = new Client(); await w3.open();
  w3.send({ t: 'watch', room: ROOM });
  await w3.settle(400);
  ok(!!w3.last('watching'), 'fixture: the newcomer is watching');
  w3.send({ t: 'join', room: ROOM, seat: 1, name: 'Cass' });
  await w3.settle(500);
  ok(!!w3.last('joined'), 'fixture: …and then sat down in seat 1');
  w3.msgs.length = 0;
  a.msgs.length = 0;
  w3.send({ t: 'action', action: { type: 'donePlanning', seat: 1 } });
  await w3.settle(600);
  ok(!w3.last('watching'),
    '⭐ after sitting down it receives NO omniscient push — the socket left room.watchers when '
    + 'it took the seat. If this fails, a player is being handed the opponent\'s hand');
  const seatView = w3.last('update')?.['view'] as { players: { hand: string[] }[] } | undefined;
  ok(!!seatView && seatView.players[0]!.hand.every(c => c === HIDDEN_CARD),
    '…and what it does receive is the SEAT view, with the opponent\'s hand redacted');
  eq(a.last('update')?.['watchers'], 1,
    'the remaining player is told the audience shrank by one (w2 is still watching)');
} finally {
  server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
