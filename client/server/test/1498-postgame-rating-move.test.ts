/* BL-10 — the post-game screen says what the game did to your rating
 * (docs/23-ui-inventory/05 §18.20: "post-game shows no rating delta").
 *
 *   §1 ratingMove: a move in the rating or the count is a move; nothing is none
 *   §2 over the wire: a rated game conceded on turn 1 (CR D8.5, a walkover)
 *      tells the conceder 1000 → 995 and the winner nothing, and a reconnect
 *      gets the same screen
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingMove, START_RATING } from '../rating.ts';
import { WALKOVER_PENALTY } from '../concession.ts';
import { ccWire, type Msg } from './cc-wire.ts';

test('BL-10 §1: ratingMove reports a changed rating or count, and nothing otherwise', () => {
  assert.deepEqual(ratingMove('draft', { rating: 1000, games: 0 }, { rating: 1020, games: 1 }),
    { mode: 'draft', before: 1000, after: 1020 });
  assert.deepEqual(ratingMove('constructed', { rating: 1000, games: 3 }, { rating: 995, games: 3 }),
    { mode: 'constructed', before: 1000, after: 995 }, 'a walkover moves the rating, not the count');
  assert.deepEqual(ratingMove('draft', { rating: 1000, games: 3 }, { rating: 1000, games: 4 }),
    { mode: 'draft', before: 1000, after: 1000 }, 'a game that counted and moved nothing is still a result');
  assert.equal(ratingMove('draft', { rating: 1000, games: 3 }, { rating: 1000, games: 3 }), null, 'an unrated game moves nothing');
});

test('BL-10 §2: a rated walkover tells the conceder their new rating, and the winner nothing', async () => {
  const w = await ccWire('t1498');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  try {
    const qa = await w.client(), qb = await w.client();
    qa.send({ t: 'queue', q: 'join', mode: 'constructed', deckId: ann.deckId, ranked: true, token: ann.token });
    await qa.next(m => m.t === 'queue');
    qb.send({ t: 'queue', q: 'join', mode: 'constructed', deckId: bo.deckId, ranked: true, token: bo.token });
    await qa.next(m => m.t === 'queue' && !!m['offer']);
    qa.send({ t: 'queue', q: 'accept', token: ann.token });
    qb.send({ t: 'queue', q: 'accept', token: bo.token });
    const room = ((await qa.next(m => m.t === 'queue' && !!m['matched']))['matched'] as { room: string }).room;

    const a = await w.client(), b = await w.client();
    const seatA = (await a.ask({ t: 'join', room, token: ann.token }, m => m.t === 'joined'))['seat'] as 0 | 1;
    await b.ask({ t: 'join', room, token: bo.token }, m => m.t === 'joined');
    const over = (c: typeof a): Promise<Msg> => c.next(m => m.t === 'gameover');
    a.send({ t: 'action', action: { type: 'concede', seat: seatA } });
    const [overA, overB] = await Promise.all([over(a), over(b)]);
    assert.deepEqual(overA['rating'], { mode: 'constructed', before: START_RATING, after: START_RATING - WALKOVER_PENALTY },
      'the conceder is told the walkover penalty');
    assert.equal(overB['rating'], undefined, 'the winner of a walkover gains nothing, and is told nothing');

    const a2 = await w.client();
    await a2.ask({ t: 'join', room, token: ann.token }, m => m.t === 'joined');
    assert.deepEqual((await over(a2))['rating'], overA['rating'], 'a reconnect is told the same');
  } finally {
    await w.stop();
  }
});
