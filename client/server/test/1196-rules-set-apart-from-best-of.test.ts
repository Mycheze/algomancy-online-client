/* 1196 — REPORT #356 (owner, 2026-11-08): Casual and Competitive are the
 * RULES SET, and Best of is its own choice.
 *
 *   "Casual = simultaneous actions during simultaneous phases / Competitive =
 *   entirely turn based, INT while NIT watches, then swap. Best of 1 or Best
 *   of 3 doesn't really matter for that … So both draft AND constructed should
 *   have the competitive vs casual slider … Constructed should have Best of 1
 *   vs Best of 3 for both competitive and casual"
 *
 * Over the wire, through main.ts's creating join and a real restart:
 *   §1 a CASUAL Best of 3: the match says Casual; game 1 is dealt with the
 *      house rule (no `sequential`); the opponent's deck elements are still
 *      not sent (a sideboard can change them); game 2 is dealt on the
 *      loser's chosen initiative, still Casual, and survives a restart
 *   §2 a Competitive Best of 3 (the control): game 1 is `sequential`
 *   §3 a COMPETITIVE DRAFT: the creating join's `rules: 'competitive'` deals
 *      a sequential draft game, which survives a restart; without it, and on
 *      a joiner's join, a draft is Casual as it always was
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire, joinNext, type Msg } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

test('1196 §1-§3 the rules set apart from Best of: a Casual match, and a Competitive draft', async () => {
  const w = await ccWire('t1196');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  /** a Best of 3 created with `cc`, both registered; game 1 as each seat sees it */
  const match = async (cc: Record<string, unknown>) => {
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    a.send({ t: 'join', room: code, seat: 0, mode: 'constructed', cc, deckId: ann.deckId, token: ann.token, name: 'x' });
    const lobby = await a.next(m => m.t === 'joined');
    const markA = a.msgs.length;
    b.send({ t: 'join', room: code, deckId: bo.deckId, token: bo.token, pick: true });
    const jb = await b.next(m => m.t === 'joined' && !!m['view']);
    const ja = await a.next(m => m.t === 'joined' && !!m['view'], markA);
    return { a, b, lobby, ja, jb };
  };
  const draft = async (rules: unknown, joinerRules?: unknown): Promise<{ code: string; view: Msg }> => {
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    a.send({ t: 'join', room: code, seat: 0, mode: 'draft', els: ['fire', 'water', 'earth'], name: 'x',
      ...(rules !== undefined ? { rules } : {}) });
    await a.next(m => m.t === 'joined');
    const mark = b.msgs.length;
    b.send({ t: 'join', room: code, name: 'y', ...(joinerRules !== undefined ? { rules: joinerRules } : {}) });
    const jb = await b.next(m => m.t === 'joined' && !!m['view'], mark);
    return { code, view: jb['view'] };
  };
  try {
    // §1 a Casual Best of 3
    const cas = await match({ bestOf: 3, casual: true });
    assert.equal(cas.lobby['waiting']?.match?.bestOf, 3, 'positive control: the creator is in a match lobby');
    assert.equal(cas.lobby['waiting']?.match?.casual, true, 'the match says it is Casual');
    assert.equal('sequential' in cas.ja['view'], false, 'game 1 is dealt with the house rule');
    assert.ok(cas.ja['view'].deckElements?.[0]?.length > 0, 'my own deck elements are sent');
    assert.deepEqual(cas.ja['view'].deckElements?.[1], [], 'the opponent\'s are not: a sideboard can change them');
    let mk = cas.a.msgs.length;
    const mkB = cas.b.msgs.length;
    cas.a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    const to = await cas.a.next(m => m.t === 'match', mk);
    await cas.b.next(m => m.t === 'match', mkB);
    const room2 = String(to['room']);
    await joinNext(cas.a, cas.b, room2, ann, bo);
    await cas.a.next(m => m.t === 'update' && typeof m['waiting']?.match?.until === 'number');
    cas.b.send({ t: 'cc', op: 'ready', ready: true });
    await sleep(50);
    mk = cas.a.msgs.length;
    cas.a.send({ t: 'cc', op: 'ready', ready: true, initiative: 1 });
    const g2 = await cas.a.next(m => m.t === 'joined' && !!m['view'], mk);
    assert.equal(g2['match']?.game, 2);
    assert.equal(g2['view'].initiative, 1, 'game 2 on the loser\'s chosen initiative');
    assert.equal('sequential' in g2['view'], false, 'and still Casual');

    // §2 the control: a Competitive Best of 3 is played in turn
    const comp = await match({ bestOf: 3 });
    assert.equal(comp.lobby['waiting']?.match?.casual, undefined);
    assert.equal(comp.ja['view'].sequential, true, 'a Competitive match\'s game is sequential');

    // §3 a Competitive draft, and the Casual one beside it
    const ccDraft = await draft('competitive');
    assert.equal(ccDraft.view.sequential, true, 'the creating join\'s rules deal a Competitive draft');
    const plain = await draft(undefined);
    assert.equal('sequential' in plain.view, false, 'no rules on the link: a Casual draft, as always');
    const joinerSays = await draft(undefined, 'competitive');
    assert.equal('sequential' in joinerSays.view, false, 'a joiner cannot make an existing room Competitive');

    // both survive a restart as they were dealt
    await w.restart();
    const a2 = await w.client(), b2 = await w.client();
    const [r2] = await joinNext(a2, b2, room2, ann, bo);
    assert.equal(r2['view']?.initiative, 1, 'the Casual match\'s game 2, restored');
    assert.equal('sequential' in r2['view'], false, 'still Casual after the restart');
    const c = await w.client();
    c.send({ t: 'join', room: ccDraft.code, seat: 0, name: 'x' });
    const back = await c.next(m => m.t === 'joined' && !!m['view']);
    assert.equal(back['view'].sequential, true, 'the Competitive draft, restored, is still Competitive');
  } finally {
    await w.stop();
  }
});
