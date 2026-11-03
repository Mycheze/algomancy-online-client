/* docs/22 §2.6 — NO MID-MATCH PEEKING. Two doors would show a player the
 * opponent's deck before the match is over, and both close while it is open:
 *
 *   §1 /api/replay/<code> of a game of an open match is "no such game" to its
 *      own players (a saved game holds both decks)
 *   §2 an omniscient live watch of a match room is refused to either player
 *      (from a second tab) and to a signed-out socket (it could be either);
 *      a signed-in third account may watch
 *   §3 once the match is over, both doors open as for any game
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire, startWireMatch } from './cc-wire.ts';

test('§1-§3 the replay and the omniscient watch are refused to the players until the match is over', async () => {
  const w = await ccWire('t821');
  const [ann, bo, cy] = w.people as [typeof w.people[0], typeof w.people[0], typeof w.people[0]];
  try {
    const replay = (code: string, token: string): Promise<number> =>
      fetch(`http://localhost:${w.port}/api/replay/${code}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.status);
    const { code, a } = await startWireMatch(w);
    let mk = a.msgs.length;
    a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    const next = String((await a.next(m => m.t === 'match', mk))['room']);
    // §1 game 1 is decided, but its match is not
    assert.equal(await replay(code, ann.token), 404, 'Ann cannot open game 1 mid-match');
    assert.equal(await replay(code, bo.token), 404, 'nor can Bo');
    // §2 watching
    const watch = async (room: string, token?: string) => {
      const c = await w.client();
      return c.ask({ t: 'watch', room, ...(token ? { token } : {}) }, () => true);
    };
    for (const [who, token] of [['Ann', ann.token], ['Bo', bo.token], ['a signed-out tab', undefined]] as const) {
      for (const room of [code, next]) {
        const got = await watch(room, token);
        assert.equal(got.t, 'error', `${who} may not watch ${room}`);
        assert.match(String(got.msg), /Competitive match in progress/);
      }
    }
    const third = await watch(next, cy.token);
    assert.notEqual(third.t, 'error', 'a signed-in stranger may watch');
    // §3 Ann concedes the match
    mk = a.msgs.length;
    a.send({ t: 'concedeMatch' });
    const over = await a.next(m => m.t === 'match', mk);
    assert.equal(over['match'].phase, 'over');
    assert.equal(await replay(code, ann.token), 200, 'after the match, Ann may watch game 1 back');
    assert.equal(await replay(code, bo.token), 200, 'and so may Bo');
    const after = await watch(code, ann.token);
    assert.notEqual(after.t, 'error', 'and a finished match room may be watched');
  } finally {
    await w.stop();
  }
});
