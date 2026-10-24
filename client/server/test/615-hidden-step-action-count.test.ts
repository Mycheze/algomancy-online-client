/* 615 — CT-334: INSIDE A HIDDEN STEP, THE OTHER SEAT DOES NOT SEE YOUR ACTIONS COUNTED.
 *
 * CR D6.1a: inside a hidden step the other player's side is shown as it stood
 * when the step opened. CT-325 stopped the fix dialog counting the other seat's
 * hidden actions, but every view still carried the state's live `actionCount`,
 * which ticks once per action whoever takes it — so a client reading the wire
 * could count the opponent's hidden plays.
 *
 * The count each seat is served is now the live count less the OTHER seat's
 * actions in the open step (rooms.ts `hiddenActionsFrom`, view.ts `viewFor`):
 * it still moves for your own plays (the client's send latch and pick chains
 * wait on exactly that), it does not move for theirs, and the reveal brings it
 * level. The standing pass's backstop stamps its pass in the same count, since
 * a late answer from the client carries the count of the view it answered.
 *
 *   §1  in-process: the composition, both seats, both directions, and the reveal
 *   §2  over the wire: a rejoin in the middle of the step is served the frozen count
 *
 * Seeds: 61500-61599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import { viewFor } from '../view.ts';
import { mintRoom, spawnServer } from '../e2e/test-util.ts';

type Rooms = typeof import('../rooms.ts');

/** the count `seat` is served — main.ts baseView's composition */
const served = (R: Rooms, room: Room, seat: Seat): number =>
  viewFor(room.state, seat, room.segSnapshot, R.hiddenActionsFrom(room, seat)).actionCount;

const recycle = (room: Room, seat: Seat): Action => {
  const hand = room.state.players[seat]!.hand;
  assert.ok(hand.length, `seat ${seat} has a card to recycle`);
  return { type: 'recycleForResource', seat, handIndex: 0, element: room.state.elements[0]! } as Action;
};

test('CR D6.1a / CT-334: in a hidden step each seat is served a count that moves for its own actions and not for the other seat', async () => {
  process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-615-'));
  const R = await import(`../rooms.ts?r615=${Math.random()}`) as Rooms;
  const room = R.createRoom('R615A', 61501, ['Ann', 'Bo'], 'shared');
  assert.equal(room.state.phase, 'planning');
  assert.ok(room.segSnapshot, 'turn 1 planning is a hidden step from the start');
  const start = room.state.actionCount;
  assert.equal(served(R, room, 0), start);
  assert.equal(served(R, room, 1), start);

  R.applyToRoom(room, recycle(room, 0));
  assert.equal(room.state.actionCount, start + 1, 'the live count moved');
  assert.equal(served(R, room, 0), start + 1, 'seat 0 sees its own play counted');
  assert.equal(served(R, room, 1), start, 'seat 1 is not told that seat 0 did anything');

  R.applyToRoom(room, recycle(room, 1));
  assert.equal(served(R, room, 1), start + 1, 'seat 1 sees its own');
  assert.equal(served(R, room, 0), start + 1, 'and seat 0 still sees only its own');

  // the step closes when both are done: the reveal brings both counts level
  R.applyToRoom(room, { type: 'donePlanning', seat: 0 } as Action);
  R.applyToRoom(room, { type: 'donePlanning', seat: 1 } as Action);
  if (R.segmentKey(room.state) !== room.segKey) R.openSegment(room);
  const live = room.state.actionCount;
  const hidden0 = R.hiddenActionsFrom(room, 0), hidden1 = R.hiddenActionsFrom(room, 1);
  assert.equal(hidden0, 0, 'nothing is held from seat 0 once the step is over');
  assert.equal(hidden1, 0, 'nor from seat 1');
  assert.equal(served(R, room, 0), live);
  assert.equal(served(R, room, 1), live);
});

interface Msg { t: string; view?: { actionCount: number; phase: string }; legal?: Action[] }

test('CR D6.1a / CT-334: over the wire, a seat rejoining mid-step is not served the opponent hidden plays in its count', async () => {
  const server = await spawnServer({
    ALGO_GAMES_DIR: mkdtempSync(join(tmpdir(), 'algo-615g-')),
    ALGO_ACCOUNTS_FILE: join(mkdtempSync(join(tmpdir(), 'algo-615a-')), 'accounts.json'),
    ALGO_ISSUES_FILE: join(mkdtempSync(join(tmpdir(), 'algo-615i-')), 'issues.jsonl'),
  });
  const socks: WebSocket[] = [];
  try {
    const code = await mintRoom(server.port);
    const client = (): { ws: WebSocket; msgs: Msg[]; next: (p: (m: Msg) => boolean) => Promise<Msg> } => {
      const ws = new WebSocket(`ws://localhost:${server.port}`);
      socks.push(ws);
      const msgs: Msg[] = [];
      const waiters: { p: (m: Msg) => boolean; r: (m: Msg) => void }[] = [];
      ws.addEventListener('message', ev => {
        const m = JSON.parse(String((ev as MessageEvent).data)) as Msg;
        msgs.push(m);
        const i = waiters.findIndex(w => w.p(m));
        if (i >= 0) waiters.splice(i, 1)[0]!.r(m);
      });
      return {
        ws, msgs,
        next: p => new Promise((res, rej) => { waiters.push({ p, r: res }); setTimeout(() => rej(new Error('timeout')), 8000); }),
      };
    };
    const opened = (ws: WebSocket): Promise<void> => new Promise(r => ws.addEventListener('open', () => r(), { once: true }));
    const a = client(), b = client();
    await opened(a.ws); await opened(b.ws);
    const aj = a.next(m => m.t === 'joined');
    a.ws.send(JSON.stringify({ t: 'join', room: code, seat: 0, name: 'Ann' }));
    await aj;
    const bj = b.next(m => m.t === 'joined');
    b.ws.send(JSON.stringify({ t: 'join', room: code, seat: 1, name: 'Bo' }));
    const joined = await bj;
    assert.equal(joined.view!.phase, 'planning', 'the hidden planning step');
    const start = joined.view!.actionCount;

    // seat 0 plays twice inside the step
    for (let k = 0; k < 2; k++) {
      const legal = [...a.msgs].reverse().find(m => m.legal)!.legal!;
      const rec = legal.find(x => x.type === 'recycleForResource' && x.seat === 0) ?? legal.find(x => x.type === 'activateResource' && x.seat === 0);
      assert.ok(rec, 'seat 0 has a hidden play to make');
      // seat 0 is served its own plays counted (a timeout here says it was not)
      const up = a.next(m => m.t === 'update' && m.view?.actionCount === start + k + 1);
      a.ws.send(JSON.stringify({ t: 'action', action: rec }));
      await up;
    }

    // seat 1 comes back (a reload): the whole view is served afresh
    const again = b.next(m => m.t === 'joined');
    b.ws.send(JSON.stringify({ t: 'join', room: code, seat: 1, name: 'Bo' }));
    const fresh = await again;
    assert.equal(fresh.view!.phase, 'planning', 'still inside the step');
    assert.equal(fresh.view!.actionCount, start, 'and its count does not show the two plays seat 0 made behind the freeze');
    for (const m of b.msgs) if (m.view) assert.equal(m.view.actionCount, start, `no message to seat 1 carried a moved count (${m.t})`);
  } finally {
    for (const ws of socks) try { ws.close(); } catch { /* closing */ }
    await server.stop();
  }
});
