/* 751 — THE ROOM A CONSTRUCTED LEAGUE MATCH IS PLAYED IN.
 *
 * The owner, 2026-11-01: the November league is constructed, "but you're
 * perfectly allowed to change your deck every single game (or not)". So the
 * room is the ordinary constructed waiting room — each seat picks a deck, it
 * deals when both are in — made by the league on the first Play, before
 * anybody has picked. Rated like the draft season (weekly and final, not
 * sign-up week), on the constructed rating, because the rating is per mode.
 *
 *   §1  ⭐ both seats bound, constructed, waiting, NO deck yet, the constructed
 *       clock, rated as the caller says; the draft room is unchanged
 *   §2  ⭐ a deck riding on an ordinary join does not register in a league
 *       room — only the waiting room's own pick does (takesJoinDeck)
 *   §3  ⭐ the two picks deal the real game, from the two decks picked
 *   §4  ⭐ a deckless league room survives a restart (an ordinary constructed
 *       room with no deck is refused, as before), and a rematch is a friendly
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Rooms = typeof import('../rooms.ts');
async function roomsAt(d: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = d;
  return import(`../rooms.ts?lgc=${Math.random()}`) as Promise<Rooms>;
}
const { defaultDecks } = await import('../decks.ts');
const DECKS = defaultDecks().filter(d => !d.problems.length);
const [D1, D2] = [DECKS[0]!, DECKS[1]!];

const games = mkdtempSync(join(tmpdir(), 'league-con-'));
test.after(() => rmSync(games, { recursive: true, force: true }));
const ann = { userId: 'u-a', username: 'Ann' }, bob = { userId: 'u-b', username: 'Bob' };
/** one server's rooms for §1–§4; §4 boots a second one off the same files */
const R = await roomsAt(games);

test('league constructed room §1 ⭐ bound, constructed, waiting for two decks, rated as asked', async () => {
  assert.ok(D1 && D2 && D1.name !== D2.name, 'two legal bundled decks to pick');
  const room = R.createLeagueRoom(ann, bob, 'LGC1', { season: 'nov', match: 'nov-w1-1' }, true, 'constructed');
  assert.equal(room.mode, 'constructed');
  assert.deepEqual(room.users, ['u-a', 'u-b'], 'both seats bound before anybody joins');
  assert.ok('refuse' in R.seatVerdict(room, undefined, 'u-x'), 'a third account is refused');
  assert.deepEqual(room.decks, [null, null], '⭐ nobody has a deck yet: each picks one for THIS game');
  assert.ok(R.roomWaiting(room), 'nothing is dealt');
  assert.equal(room.lobby, null, 'no element lobby: it is constructed');
  assert.equal(room.rated, true, 'a weekly match is rated — on the constructed rating, since room.mode is constructed');
  assert.deepEqual(room.league, { season: 'nov', match: 'nov-w1-1' });
  assert.equal(room.clockStart, R.MATCH_CLOCK_MS.constructed, 'the matchmaker’s constructed clock');

  const w0 = R.createLeagueRoom(ann, bob, 'LGC2', { season: 'nov', match: 'nov-w0-1' }, false, 'constructed');
  assert.equal(w0.rated, undefined, 'a sign-up week game is not rated');

  const draft = R.createLeagueRoom(ann, bob, 'LGD1', { season: 'oct', match: 'oct-final' }, true);
  assert.equal(draft.mode, 'draft', 'the default is still the October draft room');
  assert.equal(R.roomLobby(draft)!.method, 'random');
});

test('league constructed room §2 ⭐ only the waiting room’s own pick registers a deck', async () => {
  const room = R.getRoom('LGC1')!;
  assert.equal(R.takesJoinDeck(room, false), false,
    '⭐ the deck last selected on the home page does not lock in when Play lands you in the room');
  assert.equal(R.takesJoinDeck(room, true), true, '“Play this deck” does');
  const friendly = R.createRoom('FRN1', 1, ['A', 'B'], 'constructed', undefined, D1.cards);
  assert.equal(R.takesJoinDeck(friendly, false), true, 'a friend’s constructed room takes the deck you came with, as before');
});

test('league constructed room §3 ⭐ two picks deal the game, from the decks picked', async () => {
  const room = R.getRoom('LGC1')!;
  assert.equal(R.setRoomDeck(room, 0, D1.cards, null), false, 'one deck in: still waiting');
  assert.ok(R.roomWaiting(room));
  assert.equal(R.setRoomDeck(room, 1, D2.cards, null), true, 'the second deck deals');
  assert.equal(R.roomWaiting(room), false);
  assert.deepEqual(room.decks, [D1.cards, D2.cards]);
  const hand = (seat: 0 | 1): string[] => [...room.state.players[seat]!.hand];
  const dealt = [...hand(0), ...hand(1)];
  assert.ok(dealt.length > 0, 'opening hands are dealt');
  assert.ok(hand(0).every(n => D1.cards.includes(n as never)) && hand(1).every(n => D2.cards.includes(n as never)),
    '⭐ each hand comes from the deck that seat picked, not the placeholder');
});

test('league constructed room §4 ⭐ a deckless league room survives a restart; a rematch is a friendly', async () => {
  const fresh = R.createLeagueRoom(ann, bob, 'LGC3', { season: 'nov', match: 'nov-w1-2' }, true, 'constructed');
  assert.deepEqual(fresh.decks, [null, null]);
  const half = R.createLeagueRoom(ann, bob, 'LGC4', { season: 'nov', match: 'nov-w1-3' }, true, 'constructed');
  R.setRoomDeck(half, 1, D2.cards, null);

  const R2 = await roomsAt(games);
  R2.restoreRooms(Date.now());
  const back = R2.getRoom('LGC3');
  assert.ok(back, '⭐ a league room nobody has picked a deck in comes back after a restart');
  assert.equal(back.mode, 'constructed');
  assert.deepEqual(back.decks, [null, null]);
  assert.ok(R2.roomWaiting(back), 'still waiting for both');
  assert.deepEqual(back.league, { season: 'nov', match: 'nov-w1-2' });
  assert.equal(back.rated, true);
  assert.equal(R2.setRoomDeck(back, 0, D1.cards, null), false);
  assert.equal(R2.setRoomDeck(back, 1, D2.cards, null), true, 'and deals once both pick');
  const halfBack = R2.getRoom('LGC4')!;
  assert.deepEqual(halfBack.decks, [null, D2.cards], 'a pick made before the restart is kept');

  // the dealt one: a rematch never settles the league match again
  const played = R2.getRoom('LGC1')!;
  assert.equal(R2.roomWaiting(played), false, 'the dealt room comes back dealt');
  const again = R2.createRematch(played, 'LGC5');
  assert.equal(again.league, undefined, '⭐ a rematch is a friendly');
  assert.equal(again.rated, undefined);
});
