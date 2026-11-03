/* 1045 — A COMPETITIVE MATCH'S CLOCK IS THE CREATOR'S CHOICE (docs/22 §6.1;
 * owner, 2026-11-03: "Competitive constructed still needs the Clock setting.
 * Yes, the default will usually be used, but it's up to the players if they
 * want to override that").
 *
 * Over the wire, through main.ts's creating join (the branch that used to
 * force MATCH_CLOCK_MS.constructed whatever the link said):
 *   §1 no `clock` on the creating join: the owner's default, 45 minutes each
 *   §2 `clock: 3600000`: a 60-minute bank, and game 1 is dealt with it
 *   §3 `clock: 0` (Off): no clock at all — the match says so (clockStart null)
 *      and game 1 is dealt with no clock snapshot
 *   §4 the JOINER's clock is never read: the room exists by then
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire } from './cc-wire.ts';

test('1045 §1-§4 the creating join sets the match clock; the default is 45 minutes; the joiner sets nothing', async () => {
  const w = await ccWire('t1045');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  /** a match created with `clock` (or none), both registered; the lobby and game 1 as the creator sees them */
  const make = async (clock: unknown, joinerClock?: unknown) => {
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    a.send({ t: 'join', room: code, seat: 0, mode: 'constructed', cc: { bestOf: 3 }, deckId: ann.deckId, token: ann.token, name: 'x',
      ...(clock !== undefined ? { clock } : {}) });
    const lobby = await a.next(m => m.t === 'joined');
    const mark = a.msgs.length;
    b.send({ t: 'join', room: code, deckId: bo.deckId, token: bo.token, pick: true, ...(joinerClock !== undefined ? { clock: joinerClock } : {}) });
    const game = await a.next(m => m.t === 'joined' && !!m['view'], mark);
    return { lobby: lobby['waiting']?.match, game };
  };
  try {
    const def = await make(undefined);
    assert.ok(def.lobby, 'positive control: the creator is in a match registration room');
    assert.equal(def.lobby.clockStart, 45 * 60_000, '§1 no clock on the link is the owner\'s 45 minutes');
    assert.equal(def.game['clock']?.start, 45 * 60_000);

    const sixty = await make(60 * 60_000);
    assert.equal(sixty.lobby.clockStart, 60 * 60_000, '§2 the link\'s 60 minutes is the match\'s bank');
    assert.equal(sixty.game['clock']?.start, 60 * 60_000, 'and game 1 is dealt with it');
    // both banks start full (a few ms may already be billed: the clocks run once both are seated)
    for (const ms of sixty.game['clock']?.ms ?? []) assert.ok(ms > 59 * 60_000 && ms <= 60 * 60_000, `a bank of ${ms}`);

    const off = await make(0);
    assert.equal(off.lobby.clockStart, null, '§3 Off: the match has no clock');
    assert.equal(off.game['clock'], undefined, 'game 1 is dealt with no clock — the client draws none');

    const joiner = await make(undefined, 0);
    assert.equal(joiner.lobby.clockStart, 45 * 60_000, '§4 the joiner\'s Off is not read');
    assert.equal(joiner.game['clock']?.start, 45 * 60_000);
  } finally {
    await w.stop();
  }
});
