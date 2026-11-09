/* CT-542, report #357 — A FRIEND JOINING YOUR CONSTRUCTED ROOM PICKS THEIR DECK IN IT.
 *
 * mycheze, 2026-11-08 (gamebreaking): *"Gember thought she selected the right
 * deck, but for some reason, it didn't actually follow her into the game."*
 * Room RUCV: Gember arrived in mycheze's room and the game was dealt that
 * instant, with whatever deck her browser last held — the waiting room's deck
 * picker and its "Play this deck" were never shown to her.
 *
 * Every join carries the browser's selected deck (ui/main.ts sendJoin). In a
 * friend's constructed room only two joins may register it
 * (server/rooms.ts takesJoinDeck): the one that CREATES the room (Create on
 * the home screen, with the deck shown beside it) and the waiting room's own
 * "Play this deck" (`pick`). League rooms already worked this way.
 *
 *   §1 ⭐ the creator's join registers their deck; the friend's arrival, deck
 *      and all, registers nothing: no game, no error, ready [true, false]
 *   §2 the friend's "Play this deck" deals the game — from the deck they
 *      picked in the room, not the one their browser arrived with
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ccWire } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

test('§1-§2 a friend arriving in a constructed room is not dealt in until they pick a deck there', async () => {
  const w = await ccWire('t1197');
  const [ann, bo, cy] = w.people as [typeof w.people[0], typeof w.people[0], typeof w.people[0]];
  try {
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    await a.ask({ t: 'join', room: code, seat: 0, mode: 'constructed', deck: ann.main, deckId: ann.deckId, token: ann.token, name: 'x' },
      m => m.t === 'joined');
    // §1 — exactly what sendJoin sends on arrival by link, invite or code:
    // the deck this browser last selected (here, Cy's list — "the wrong deck")
    const j = await b.ask({ t: 'join', room: code, mode: 'constructed', deck: cy.main, token: bo.token },
      m => m.t === 'joined');
    await sleep(150);
    assert.ok(!j['view'], '⭐ no game was dealt on arrival');
    assert.deepEqual(j['waiting']?.have, [true, false], 'the creator’s deck is in; the friend’s is not');
    assert.ok(!b.msgs.some(m => m.t === 'error'), 'and nothing was refused');
    assert.ok(!a.msgs.some(m => m.t === 'joined' && m['view']), 'the creator was dealt no game either');
    // §2 — the waiting room's Play this deck, with the deck chosen there
    const dealt = await b.ask({ t: 'join', room: code, deck: bo.main, deckId: bo.deckId, token: bo.token, pick: true },
      m => m.t === 'joined' && !!m['view']);
    assert.ok(dealt['view'], 'the pick deals the game');
    const file = join(w.env.ALGO_GAMES_DIR, `${code}.json`);
    for (let i = 0; i < 50 && !existsSync(file); i++) await sleep(100);
    const g = JSON.parse(readFileSync(file, 'utf8')) as { decks: [string[], string[]] };
    assert.deepEqual(sorted(g.decks[0]), sorted(ann.main), 'the creator plays the deck they created with');
    assert.deepEqual(sorted(g.decks[1]), sorted(bo.main), '⭐ the friend plays the deck they picked in the room');
  } finally {
    await w.stop();
  }
});
