/* docs/22 §5.1, CT-518 — A CODE TYPED ON THE HOME PAGE REGISTERS NO DECK.
 *
 * The client sends the selected Constructed deck on every join, and a joiner
 * who types a Competitive room's code does not know it is one until the
 * first push says so. Game 1 of a match must be dealt only from decks the two
 * players picked FOR THE MATCH.
 *
 *   §1 a join carrying a CC-legal saved deck (deck + deckId, no `pick`) seats
 *      the player in the registration room and registers nothing: no game,
 *      no error, ready [true, false], `mine` null
 *   §2 the waiting room's own "Play this deck" (`pick: true`) registers, and
 *      that is what deals game 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

test('§1-§2 a typed-code join with a legal Constructed deck registers nothing, only the pick does', async () => {
  const w = await ccWire('t840');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  try {
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    a.send({ t: 'join', room: code, seat: 0, mode: 'constructed', cc: { bestOf: 3 }, deckId: ann.deckId, token: ann.token, name: 'x' });
    await a.next(m => m.t === 'joined');
    // §1 — what ui/main.ts sendJoin sends before it knows the room is a match
    const j = await b.ask({ t: 'join', room: code, mode: 'constructed', deck: bo.main, deckId: bo.deckId, token: bo.token },
      m => m.t === 'joined');
    await sleep(150);
    assert.ok(!j['view'], 'no game was dealt');
    const mi = j['waiting']?.match;
    assert.ok(mi, 'the joiner is in the match registration room');
    assert.deepEqual(mi.ready, [true, false], 'only the creator has registered');
    assert.equal(mi.mine, null, 'the joiner has no registration');
    assert.ok(!b.msgs.some(m => m.t === 'error'), 'and nothing was refused');
    assert.ok(!a.msgs.some(m => m.t === 'joined' && m['view']), 'the creator was dealt no game either');
    // §2 — the waiting room's Play this deck
    const dealt = await b.ask({ t: 'join', room: code, deckId: bo.deckId, token: bo.token, pick: true },
      m => m.t === 'joined' && !!m['view']);
    assert.ok(dealt['view'], 'the pick deals game 1');
  } finally {
    await w.stop();
  }
});
