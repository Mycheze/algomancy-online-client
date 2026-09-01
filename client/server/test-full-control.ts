/* BL-18's FOURTH ROW, over the wire (run: node test-full-control.ts).
 *
 * Four things act for you. Three are the client's and are guarded in
 * engine/test/272 and /273; this is the fourth, `drainForced` in main.ts —
 * the server stepping an empty board along on a player's behalf.
 *
 * WHAT AN EMPTY BOARD DOES BY ITSELF. With nothing in play there is no attack
 * to declare and no block to make, so `forcedAction()` offers the one action
 * that is possible and the drain takes it, several steps in a row. The player
 * never sees the window. Under full control they do, which is the entry's
 * second doneWhen line: "stopped at every window where you have any legal
 * action, including ones with a single option."
 *
 * ── THE FOUR THINGS THIS FILE IS HERE TO HOLD
 *
 * §1 THE NEGATIVE CONTROL, and it is the one that matters: with the switch
 *    OFF the server drains exactly as it always did. Asserted over the wire
 *    from the view the client really receives, not read off the diff.
 * §2 With it ON, the board stops at the window and the seat is offered it.
 * §3 ⚠ NOT A HANG. A drain removed without an affordance behind it is worse
 *    than a drain: the board simply stops and nothing says why. So the seat
 *    that owes the step must be OFFERED it — `legal` non-empty in that seat's
 *    own push — and taking it must move the game on.
 * §4 ⚠ NOT A DESYNC. The opponent did not opt in and must not be made to wait
 *    on a window that exists only because you did. The flag is per SEAT and
 *    the drain stops only at a step belonging to somebody who asked for it,
 *    so the opponent's own forced steps still drain.
 *    THE ONE REAL CONSEQUENCE, stated rather than discovered: while the board
 *    owes YOU a step, your opponent waits for you to click it — the same way
 *    they wait for any other action of yours. That is what opting in means.
 * §5 The switch is per-seat soft state, so it survives a reconnect (the client
 *    re-asserts it on the join) and it can be flipped mid-game.
 *
 * Same harness style as test-building.ts: spawn the real server on an
 * OS-assigned port and drive two real sockets.
 */
import { WebSocket } from 'ws';
import { mintRoom, spawnServer } from './test-util.ts';
import { forcedAction } from '../engine/src/apply.ts';
import type { GameState } from '../engine/src/types.ts';

let failures = 0;
const ok = (cond: unknown, what: string): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${what}`);
  if (!cond) failures++;
};
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

interface Msg { [k: string]: unknown }

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  seat = -1;
  constructor(port: number) { this.ws = new WebSocket(`ws://127.0.0.1:${port}`); }
  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
      this.ws.on('message', d => {
        const m = JSON.parse(String(d)) as Msg;
        this.msgs.push(m);
        if (m['t'] === 'joined') this.seat = m['seat'] as number;
      });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(t: string): Msg | undefined { return [...this.msgs].reverse().find(m => m['t'] === t); }
  /** the newest authoritative view this seat has been pushed */
  view(): Msg | undefined {
    return [...this.msgs].reverse().find(m => (m['t'] === 'update' || m['t'] === 'joined') && m['view']);
  }
  /** this seat's legal actions, as the server last offered them */
  legal(): { type: string; seat: number }[] {
    const m = [...this.msgs].reverse().find(x => Array.isArray(x['legal']));
    return (m?.['legal'] ?? []) as { type: string; seat: number }[];
  }
  close(): void { this.ws.close(); }
}

const srv = await spawnServer();
const PORT = srv.port;

/** the battle step both seats are looking at, off the newest view */
function step(c: Client): string {
  const v = c.view()?.['view'] as { battle?: { step?: string }; phase?: string } | undefined;
  return v?.battle?.step ?? `no battle (${v?.phase ?? '?'})`;
}

/**
 * Two joined clients on a fresh room, with `full` naming which seats asked
 * that nothing act for them. The switch rides the JOIN, exactly as a real
 * browser sends it.
 */
async function table(full: [boolean, boolean]): Promise<[Client, Client]> {
  const room = await mintRoom(PORT);
  const a = new Client(PORT), b = new Client(PORT);
  await a.open(); await b.open();
  a.send({ t: 'join', room, seat: 0, name: 'Ann', on: full[0] });
  await sleep(120);
  b.send({ t: 'join', room, seat: 1, name: 'Bo', on: full[1] });
  await sleep(300);
  return [a, b];
}

/** walk both seats out of planning and the haste step, into the battle where
 * an empty board owes its forced steps */
async function toBattle(a: Client, b: Client): Promise<void> {
  a.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });
  b.send({ t: 'action', action: { type: 'donePlanning', seat: 1 } });
  await sleep(250);
  a.send({ t: 'action', action: { type: 'doneHaste', seat: 0 } });
  b.send({ t: 'action', action: { type: 'doneHaste', seat: 1 } });
  await sleep(300);
}

console.log('\nBL-18 §1 — THE NEGATIVE CONTROL: with the switch OFF, nothing changes');
{
  const [a, b] = await table([false, false]);
  ok(a.seat === 0 && b.seat === 1, 'two seats joined');
  await toBattle(a, b);
  // the empty board owes a declareAttack and a declareBlocks; with nobody
  // opted in the server takes both and the game runs on past them
  const s = step(a);
  ok(!/declare|blocks/.test(s),
    `the empty board stepped itself along on its own (now at "${s}") — this is today's `
    + 'behaviour and doneWhen line 4 says the switch off must not change it');
  ok(a.legal().every(x => x.type !== 'declareAttack'),
    'and seat 0 is not being asked for the attack the server already answered');
  a.close(); b.close();
}

console.log('\nBL-18 §2/§3 — with it ON the board stops, and the seat is OFFERED the window');
{
  const [a, b] = await table([true, false]);
  await toBattle(a, b);
  const s = step(a);
  ok(/declare/.test(s),
    `the board drained itself anyway (now at "${s}") — full control means "stopped at every `
    + 'window where you have any legal action, including ones with a single option", and a '
    + 'forced step is exactly a window with one option');

  // §3 — NOT A HANG. Whoever owes the step has to be able to take it.
  const mine = a.legal().filter(x => x.type === 'declareAttack');
  ok(mine.length > 0,
    'the seat that opted in is offered NOTHING — a drain removed without an affordance behind '
    + 'it is a stopped board, not a feature');

  // …and taking it moves the game on, which is the other half of "not a hang"
  a.send({ t: 'action', action: { type: 'declareAttack', seat: 0, columns: [] } });
  await sleep(300);
  ok(step(a) !== s, `the offered action did not move the game (still "${step(a)}")`);
  a.close(); b.close();
}

console.log('\nBL-18 §4 — NOT A DESYNC: the opponent did not opt in and does not wait for one');
{
  // ⚠ WHOSE WINDOW IT IS, ASKED OF THE FUNCTION THAT DECIDES. Two earlier cuts
  // guessed and both were wrong: `battle.attacker` is per-round and the LEGAL
  // list offers a declareAttack to BOTH seats in this step. `forcedAction` is
  // the only thing whose answer is the answer, and on an empty board the
  // redacted view carries everything it reads — so the test asks it, and
  // models no rule of its own.
  //
  // ⚠ AND THE MOVEMENT IS NOT A CHANGE OF `step`. Round 1's declare step holds
  // BOTH declarations, so the attacker's landing leaves the step name exactly
  // where it was. What moves is WHOSE step is owed — measured, not named.
  const owedIn = (c: Client): { type: string; seat: number } | null =>
    forcedAction(c.view()!['view'] as GameState) as { type: string; seat: number } | null;

  const [a, b] = await table([true, true]);
  await toBattle(a, b);
  const seats: [Client, Client] = [a, b];
  const first = owedIn(a);
  ok(first !== null,
    'the held board owes no forced step at all — it is not where this section thinks it is');
  const mine = first?.seat ?? 0, theirs = 1 - mine;
  ok(seats[mine]!.legal().some(x => x.type === first!.type),
    `both opted in, so the board is held and seat ${mine} is being asked for its own step`);

  // the seat that owes it switches OFF: the drain resumes and takes the step
  // belonging to somebody who no longer wants it…
  seats[mine]!.send({ t: 'fullcontrol', on: false });
  await sleep(300);
  const next = owedIn(a);
  ok(next !== null && next.seat === theirs,
    `seat ${mine} switched OFF and the board did not resume onto seat ${theirs}'s step `
    + `(now ${JSON.stringify(next)}) — a player who turns the preference off must not be left `
    + 'sitting at a window they have just said they do not want to answer');

  // …and STOPPED AGAIN, at the other seat's own forced step. That is the
  // per-seat property: one player's preference holds their own windows and
  // nobody else's. Read off the room, the drain would have run the whole way
  // through to deployment here — which is exactly what §1 shows it doing when
  // nobody has opted in.
  ok(seats[theirs]!.legal().some(x => x.type === next?.type),
    `seat ${theirs} is not being offered the step the board is holding for them — the drain `
    + 'stopped and nobody was asked, which is a stopped game');

  // THE ONE REAL CONSEQUENCE, asserted rather than left to be discovered in a
  // game: the seat that switched OFF is now waiting on the other one's click,
  // for a step that used to be instant. That is what opting in means, and it
  // is not a bug.
  ok(step(a) === step(b),
    'both seats are looking at the same held board, so the wait is shared and visible rather '
    + 'than one client being out of step with the other');
  a.close(); b.close();
}

console.log('\nBL-18 §5 — per-seat soft state: mid-game, and across a reconnect');
{
  // OFF at the join, flipped ON mid-game: the switch is a preference, not a
  // room setting chosen at creation, so this has to work.
  const room = await mintRoom(PORT);
  const a = new Client(PORT), b = new Client(PORT);
  await a.open(); await b.open();
  a.send({ t: 'join', room, seat: 0, name: 'Ann', on: false });
  await sleep(120);
  b.send({ t: 'join', room, seat: 1, name: 'Bo', on: false });
  await sleep(300);
  a.send({ t: 'fullcontrol', on: true });
  await sleep(200);
  ok(a.last('update') !== undefined,
    'flipping the switch was not acknowledged with a view — the seat has just taken '
    + 'responsibility for a window and has to be shown it');
  await toBattle(a, b);
  ok(/declare/.test(step(a)), 'the mid-game flip is honoured by the drain');

  // …and a reconnect re-asserts it, because the browser owns it and the
  // server's copy is not persisted
  a.close();
  await sleep(150);
  const a2 = new Client(PORT);
  await a2.open();
  a2.send({ t: 'join', room, seat: 0, name: 'Ann', on: true });
  await sleep(300);
  ok(/declare/.test(step(a2)),
    'the reconnected seat lost its switch — the client re-asserts it on every join precisely so '
    + 'nothing has to be persisted');
  a2.close(); b.close();
}

await srv.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
