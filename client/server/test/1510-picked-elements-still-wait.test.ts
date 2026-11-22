/* 1510 — A DRAFT ROOM MADE WITH ITS ELEMENTS PICKED STILL OPENS IN ITS LOBBY.
 *
 * The owner, in #steward: "When starting a room with the draft already choosen, there's no
 * 'joining room:' screen where you can invite your friends or anything. It just immediatly dumps
 * you into the room, without an opponent". A room whose creator picked the elements on the home
 * page now waits in the lobby like any other draft room — the code to share, the invites — with
 * those elements as its one method, 'chosen', and deals once both players are ready.
 *
 *   §1 the reservation's elements open a 'chosen' lobby; nothing is dealt
 *   §2 the method cannot be changed; both ready deals the picked elements
 *   §3 an unresolved 'chosen' lobby survives a restart as one
 *   §4 a custom reservation's elements wait the same; a plain reservation without any opens the vote
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BEGINNER_RULES, checkCustomRules } from '../../ui/customrules.ts';

type Rooms = typeof import('../rooms.ts');
async function roomsAt(d: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = d;
  return import(`../rooms.ts?picked=${Math.random()}`) as Promise<Rooms>;
}

const games = mkdtempSync(join(tmpdir(), 'picked-els-'));
test.after(() => rmSync(games, { recursive: true, force: true }));

test('1510 §1-§3 inbox: a draft room made with its elements picked waits in its lobby, and deals them', async () => {
  const R = await roomsAt(games);
  R.reserveRoomCode('PKA1', undefined, ['wood', 'fire', 'water']);
  const room = R.joinableRoom('PKA1', 'draft', undefined, undefined, null)!;
  assert.ok(R.roomWaiting(room), '⭐ nothing is dealt while the opponent is away');
  assert.equal(R.roomLobby(room)!.method, 'chosen');
  assert.deepEqual([...room.els].sort(), ['fire', 'water', 'wood'], 'the picked elements');

  assert.equal(R.setLobbyMethod(room, 'pick-one'), false, 'the picked elements stay picked');
  R.setLobbySubmission(room, 0, {}, true);
  assert.equal(R.resolveLobby(room, []), null, 'one ready player is not enough');
  R.setLobbySubmission(room, 1, {}, true);
  const r = R.resolveLobby(room, [])!;
  assert.deepEqual([...r.els].sort(), ['fire', 'water', 'wood'], '⭐ both ready deals the picked elements');
  assert.ok(!R.roomWaiting(room), 'and the room is a game');
  assert.equal(room.state.mode, 'draft');
  assert.equal(room.state.packs[0]!.length, 10);

  // a restart keeps an unresolved one
  R.reserveRoomCode('PKA2', undefined, ['dark', 'light', 'metal']);
  R.joinableRoom('PKA2', 'draft', ['fire', 'wood', 'earth'], undefined, null)!;
  const R2 = await roomsAt(games);
  R2.restoreRooms(Date.now());
  const back = R2.getRoom('PKA2')!;
  assert.ok(R2.roomWaiting(back));
  assert.equal(R2.roomLobby(back)!.method, 'chosen', 'an unresolved lobby restores as chosen');
  assert.deepEqual([...back.els].sort(), ['dark', 'light', 'metal'], 'with the reserved elements, not the join message ones');
  R2.setLobbySubmission(back, 0, {}, true);
  R2.setLobbySubmission(back, 1, {}, true);
  assert.deepEqual([...R2.resolveLobby(back, [])!.els].sort(), ['dark', 'light', 'metal']);
});

test('1510 §4 inbox: picked elements wait with custom rules too; none opens the vote', async () => {
  const R = await roomsAt(games);
  const v = checkCustomRules(BEGINNER_RULES, ['fire', 'wood']);
  R.reserveRoomCode('PKB1', { rules: v.rules!, deal: v.deal! }, ['fire', 'wood']);
  const custom = R.joinableRoom('PKB1', 'draft')!;
  assert.equal(R.roomLobby(custom)?.method, 'chosen', 'a custom room with picked elements waits too');
  R.setLobbySubmission(custom, 0, {}, true);
  R.setLobbySubmission(custom, 1, {}, true);
  assert.deepEqual([...R.resolveLobby(custom, [])!.els].sort(), ['fire', 'wood']);
  assert.equal(custom.state.packs[0]!.length, 5, 'dealt under its rules');

  R.reserveRoomCode('PKB2');
  const plain = R.joinableRoom('PKB2', 'draft')!;
  assert.equal(R.roomLobby(plain)?.method, 'pick-one', 'positive control: no elements is the ordinary vote');
});
