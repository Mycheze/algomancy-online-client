/* A SAVED DECK'S ID BELONGS TO A CONSTRUCTED ROOM, AND NOWHERE ELSE.
 *
 * Reported 2026-09-20, on the owner's Manablub Tempo deck: *"The list of
 * 'games' is just wrong … It's getting a live draft game counted in its
 * record. I think it's counting all games where it was my 'selected' deck,
 * even if that game wasn't with that deck."*
 *
 * That is precisely what happened, and the mechanism is worth stating because
 * every part of it looked right on its own:
 *
 *   1. ui/main.ts sends the browser's chosen deck (`deck` + `deckId`) on EVERY
 *      join. It always has. The server was trusted to ignore a deck in a room
 *      that does not want one.
 *   2. `roomWaiting` is true for a constructed room short of a deck — and for
 *      ANY room with an unresolved lobby, which is every live draft room while
 *      the elements are being picked.
 *   3. so main.ts's join called `setRoomDeck` on a DRAFT room, which stamped
 *      `room.deckIds[seat]`…
 *   4. …and `recordLiveGame` writes `room.deckIds` into the history with no
 *      mode guard, so the draft game landed in that deck's record.
 *
 * §1 ⭐ is the stamp: a non-constructed room refuses a deck outright.
 * §2 ⭐ is the LARGER bug the same hole allowed, which nobody had hit yet.
 * §3 ⭐ is the repair: a history that already carries a bad stamp still folds
 *    to the right number, because the live deploy's rows cannot be un-written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ⚠ THROWAWAY STATE, AND IT IS THESE TWO VARIABLES, NOT `ALGO_VAR_DIR`.
 *
 * `createRoom` persists every room it touches, and `register` writes the
 * account store — both under var/, which is LIVE DATA (server/statepaths.ts).
 * statepaths reads `ALGO_GAMES_DIR` and `ALGO_ACCOUNTS_FILE`; `ALGO_VAR_DIR`
 * is the BOT's variable (bot/test/_scratch_var.py) and means nothing here, so
 * setting it looks like isolation and gives none. Set before the imports,
 * because rooms.ts captures its games directory at module scope. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-deckid-test-'));
process.env['ALGO_GAMES_DIR'] = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');

const { createRoom, roomWaiting, setRoomDeck } = await import('../rooms.ts');
const { defaultDecks } = await import('../decks.ts');

const CARDS = defaultDecks()[0]!.cards;

/* ══ §1 — the stamp ════════════════════════════════════════════════════ */

test('§1 ⭐ a draft room refuses a deck, and is not stamped with its id', () => {
  const room = createRoom('AAAA', 42, ['a', 'b'], 'draft');

  // the precondition that made this reachable: a draft lobby IS "waiting"
  assert.equal(roomWaiting(room), true,
    'a draft room with an unresolved lobby is waiting — that is the trap');

  assert.equal(setRoomDeck(room, 0, CARDS, 'a-saved-deck-id'), false);
  assert.deepEqual(room.deckIds, [null, null],
    'a draft game must not be stamped with a constructed deck id');
  assert.equal(room.decks[0], null, 'nor hold a constructed deck at all');
});

test('§1b a shared-deal room refuses one too', () => {
  const room = createRoom('BBBB', 42, ['a', 'b'], 'shared');
  setRoomDeck(room, 0, CARDS, 'a-saved-deck-id');
  assert.deepEqual(room.deckIds, [null, null]);
});

test('§1c …and a constructed room still takes one, which is the point', () => {
  const room = createRoom('CCCC', 42, ['a', 'b'], 'constructed', undefined, CARDS);
  setRoomDeck(room, 1, CARDS, 'the-other-deck');
  assert.equal(room.deckIds[1], 'the-other-deck',
    'the fix must not cost constructed rooms the id their record is folded on');
});

/* ══ §2 — the bigger one, which nobody had hit ═════════════════════════ */

test('§2 ⭐ two seats arriving at a draft with decks chosen cannot deal a game', () => {
  // Before the fix this returned TRUE: `complete` went true, and setRoomDeck
  // dealt a game from the two constructed decks INSIDE an unresolved draft
  // lobby — discarding the state and the action log on the way. It needed
  // nothing unusual, just both players having a deck selected in their
  // browser, which is the ordinary state of anybody who plays constructed.
  const room = createRoom('DDDD', 42, ['a', 'b'], 'draft');
  setRoomDeck(room, 0, CARDS, 'deck-a');
  assert.equal(setRoomDeck(room, 1, CARDS, 'deck-b'), false,
    'nothing about a draft room is completed by two constructed decks');
  assert.ok(room.lobby && !room.lobby.result, 'the lobby is still the lobby');
  assert.deepEqual(room.deckIds, [null, null]);
  assert.deepEqual(room.actions, [], 'and no action log was thrown away');
});

/* ══ §3 — the repair, for rows already written ═════════════════════════ */

test('§3 ⭐ a history row stamped with a deck id on a non-constructed game folds to nothing', async () => {
  const { loadAccounts, register, stashHistory } = await import('../accounts.ts');
  const { createDeck, deckRecords } = await import('../collection.ts');
  const { lineageRecords } = await import('../publicdecks.ts');

  loadAccounts();
  const made = register('Recorder', 'a good password');
  assert.ok(made.ok);
  if (!made.ok) return;
  const account = made.account;
  const r = createDeck(account, { name: 'Manablub Tempo', cards: CARDS });
  assert.ok(r.ok);
  if (!r.ok) return;
  const id = r.deck.id;

  const seat = (won: boolean): unknown => ({
    name: 'x', won, lifeLeft: won ? 20 : 0, lifeLost: won ? 10 : 30,
    cardElements: {}, recycled: {}, cards: {},
    unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0,
    resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0,
    damageDealt: 0, unitsLost: 0, unitsKilled: 0,
  });
  const row = (code: string, mode: string): unknown => ({
    code, playedAt: '2026-09-19T00:00:00.000Z', recordedAt: new Date().toISOString(),
    mode, els: ['fire'], finished: true, winner: 0, turns: 9, diverged: false,
    users: [account.id, null], deckIds: [id, null], names: ['Recorder', 'Guest'],
    seats: [seat(true), seat(false)],
  });

  stashHistory(row('REAL', 'constructed') as never);
  stashHistory(row('DRAFT', 'draft') as never);
  stashHistory(row('SHARE', 'shared') as never);

  assert.equal(deckRecords(account)[id]?.games, 1,
    'only the constructed game is in the deck\'s record');
  const lineage = lineageRecords(new Map([[id, r.deck]]));
  assert.equal(lineage.get(id)?.games, 1,
    '…and the metagame list folds the lineage the same way');
});
