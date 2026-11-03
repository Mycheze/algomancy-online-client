/* docs/22 §2.6, §3.3, §5.3, Risk 3 — NOTHING ON THE WIRE TELLS A SEAT ITS
 * OPPONENT'S DECK. 203's discipline: every claim is read off what the real
 * server actually sent, recorded for every message, not off a function that
 * builds part of it.
 *
 * Ann and Bo play games 1 and 2 of a Bo3 and stand in game 3's lobby. Bo
 * registers from a saved deck with a sideboard, swaps two cards in, then
 * sideboards by hand. Over EVERY message Ann received:
 *
 *   §1 no card of Bo's sideboard is named, ever (the cards are Bo's alone —
 *      the decks are disjoint slices of the pool)
 *   §2 Bo's deck id does not appear
 *   §3 every waiting payload's match carries Ann's own deck under `mine` and
 *      nothing of Bo's but his ready dot
 *   §4 every in-game view blanks Bo's deck elements and keeps Ann's (CR D6.6e,
 *      CC only)
 *   §5 and the same of Bo's messages about Ann (the rule is symmetric)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire, joinNext, startWireMatch, type Client, type Msg } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const KNOWN_MATCH_KEYS = new Set(['id', 'bestOf', 'game', 'score', 'names', 'banks', 'clockStart', 'phase', 'chooser',
  'initiative', 'until', 'locked', 'ready', 'mine', 'pause', 'result']);

test('§1-§5 no message names the opponent sideboard, deck id or deck elements', async () => {
  const w = await ccWire('t820');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  try {
    const { a, b } = await startWireMatch(w);
    // game 1: Ann concedes
    let mk = a.msgs.length;
    a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    const r2 = String((await a.next(m => m.t === 'match', mk))['room']);
    await joinNext(a, b, r2, ann, bo);
    await b.next(m => m.t === 'update' && typeof m['waiting']?.match?.until === 'number');
    // Bo swaps two in, then a hand-made configuration of his own
    mk = b.msgs.length;
    b.send({ t: 'cc', op: 'config', ...bo.swap });
    await b.next(m => m.t === 'update' && m['waiting']?.match?.mine?.current?.main?.includes(bo.side[0]), mk);
    const handMade = { main: [...bo.main.slice(1), bo.side[2]], side: [bo.main[0], ...bo.side.slice(0, 2)] };
    mk = b.msgs.length;
    b.send({ t: 'cc', op: 'config', ...handMade });
    await b.next(m => m.t === 'update' && m['waiting']?.match?.mine?.current?.main?.includes(bo.side[2]), mk);
    b.send({ t: 'cc', op: 'ready', ready: true });
    await sleep(50);
    mk = a.msgs.length;
    a.send({ t: 'cc', op: 'ready', ready: true, initiative: 0 });
    await a.next(m => m.t === 'joined' && !!m['view'], mk);
    // game 2: Bo concedes; both into game 3's lobby; Bo swaps again
    mk = a.msgs.length;
    b.send({ t: 'action', action: { type: 'concede', seat: 1 } });
    const r3 = String((await a.next(m => m.t === 'match', mk))['room']);
    await joinNext(a, b, r3, ann, bo);
    await b.next(m => m.t === 'update' && typeof m['waiting']?.match?.until === 'number');
    b.send({ t: 'cc', op: 'config', ...bo.swap });
    await sleep(200);

    const check = (who: Client, me: typeof ann, them: typeof ann, seat: 0 | 1): void => {
      let views = 0, lobbies = 0;
      for (const m of who.msgs) {
        const text = JSON.stringify(m);
        // §1 — Bo's sideboard: cards nobody else owns. (His main deck is
        // public as it is played, and this game plays none of it.)
        for (const c of them.side) assert.ok(!text.includes(JSON.stringify(c)), `${me.name} was sent ${c}, a card of the opponent's sideboard, in a '${m.t}'`);
        // §2
        assert.ok(!text.includes(them.deckId), `the opponent's deck id in a '${m.t}'`);
        // §3
        const mi = (m as Msg)['waiting']?.match;
        if (mi) {
          lobbies++;
          for (const k of Object.keys(mi)) assert.ok(KNOWN_MATCH_KEYS.has(k), `an unexpected field in the lobby: ${k}`);
          if (mi.mine) {
            assert.deepEqual(mi.mine.registered.side, me.side, 'mine is my own deck');
            assert.deepEqual(Object.keys(mi.mine).sort(), ['current', 'registered'], 'my own deck, and nothing else');
          }
        }
        // §4
        const v = (m as Msg)['view'];
        if (v) {
          views++;
          assert.deepEqual(v.deckElements?.[1 - seat], [], `the opponent's deck elements are blank in a '${m.t}'`);
          assert.ok((v.deckElements?.[seat] ?? []).length > 0, 'my own deck elements are sent');
        }
      }
      assert.ok(views >= 2 && lobbies >= 4, `non-vacuous: ${views} views and ${lobbies} lobbies read`);
    };
    check(a, ann, bo, 0);
    check(b, bo, ann, 1);   // §5
  } finally {
    await w.stop();
  }
});
