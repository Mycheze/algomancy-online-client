/* docs/22 §7 W3 "done when" — TWO CLIENTS PLAY A FULL BEST OF THREE OVER THE
 * WIRE, THROUGH A SERVER RESTART MID-PAUSE.
 *
 *   §1 the creating join makes the match (signed in, a saved CC deck); the
 *      second registration deals game 1, sequential
 *   §2 a concede of game 1 pushes {t:'match'} with the next room to both seats,
 *      and the post-game payload carries the match score
 *   §3 in the next room each seat sees its own deck; a preset applies; the
 *      window opens once both are in; a pause is offered and agreed
 *   §4 THE SERVER RESTARTS. Both rejoin: the match is still paused, the
 *      configuration, the score and the banks exactly as they were
 *   §5 resume (both); the loser readies with the initiative; game 2 deals on
 *      the chosen seat, from the preset deck, on the carried banks
 *   §6 game 2 to the other seat; game 3; the match ends 2-1 and says so
 *   §7 /api/matches/mine lists an open match and drops a finished one
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccWire, joinNext, startWireMatch, type Msg } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

test('§1-§7 a Bo3 over the wire, paused, restarted, resumed and finished', async () => {
  const w = await ccWire('t818');
  const [ann, bo] = w.people as [typeof w.people[0], typeof w.people[0]];
  try {
    const mine = async (token: string): Promise<any[]> => {
      const r = await fetch(`http://localhost:${w.port}/api/matches/mine`, { headers: { Authorization: `Bearer ${token}` } });
      return (await r.json() as { matches: any[] }).matches;
    };
    // §1
    const { a, b, lobby, ja } = await startWireMatch(w);
    assert.equal(lobby['waiting']?.match?.bestOf, 3, 'the creator lands in the match lobby');
    assert.deepEqual(lobby['waiting']?.match?.mine?.registered?.side, ann.side, 'with its own sideboard');
    assert.equal(ja['view'].sequential, true, 'game 1 is a CC game');
    assert.equal(ja['match']?.bestOf, 3, 'the in-game push names the match');
    assert.equal((await mine(ann.token)).length, 1, '§7 the open match is listed');
    // §2 Ann concedes game 1
    const markA = a.msgs.length, markB = b.msgs.length;
    a.send({ t: 'action', action: { type: 'concede', seat: 0 } });
    const toA = await a.next(m => m.t === 'match', markA);
    const toB = await b.next(m => m.t === 'match', markB);
    assert.ok(toA['room'] && toA['room'] === toB['room'], 'both are sent to the same next room');
    assert.deepEqual(toA['match'].score, [0, 1]);
    const over = await b.next(m => m.t === 'gameover', markB);
    assert.deepEqual(over['match']?.score, [0, 1], 'the post-game screen has the match score');
    const room2 = String(toA['room']);
    // §3
    const [la, lb] = await joinNext(a, b, room2, ann, bo);
    assert.equal(la['waiting']?.match?.chooser, 0, 'Ann lost game 1 and chooses');
    assert.deepEqual(lb['waiting']?.match?.mine?.registered?.side, bo.side, 'Bo sees his own deck');
    const opened = await a.next(m => m.t === 'update' && typeof m['waiting']?.match?.until === 'number');
    assert.ok(opened['waiting'].match.until > Date.now(), 'the window opened once both were in');
    const banks: number[] = opened['waiting'].match.banks;
    let mk = a.msgs.length;
    a.send({ t: 'cc', op: 'preset', preset: ann.presetId });
    const pre = await a.next(m => m.t === 'update' && m['waiting']?.match?.mine?.current?.side?.includes(ann.main[0]), mk);
    const presetCfg = pre['waiting'].match.mine.current;
    mk = a.msgs.length;
    b.send({ t: 'cc', op: 'pause' });
    await a.next(m => m.t === 'update' && m['waiting']?.match?.pause?.offeredBy === 1, mk);
    mk = b.msgs.length;
    a.send({ t: 'cc', op: 'pause' });
    await b.next(m => m.t === 'update' && m['waiting']?.match?.phase === 'paused', mk);
    // §4 the restart
    await w.restart();
    const a2 = await w.client(), b2 = await w.client();
    const [ra, rb] = await joinNext(a2, b2, room2, ann, bo);
    assert.equal(ra['waiting']?.match?.phase, 'paused', 'still paused after the restart');
    assert.deepEqual(ra['waiting'].match.mine.current, presetCfg, 'the configuration as it was');
    assert.deepEqual(rb['waiting'].match.score, [0, 1], 'the score as it was');
    assert.deepEqual(ra['waiting'].match.banks, banks, 'the banks as they were');
    assert.equal((await mine(bo.token))[0]?.phase, 'paused', '§7 listed as paused');
    // §5 resume, ready, deal
    mk = a2.msgs.length;
    a2.send({ t: 'cc', op: 'resume' });
    b2.send({ t: 'cc', op: 'resume' });
    const resumed = await a2.next(m => m.t === 'update' && m['waiting']?.match?.phase === 'between', mk);
    assert.ok(resumed['waiting'].match.until - Date.now() > 100_000, 'a full window again');
    b2.send({ t: 'cc', op: 'ready', ready: true });
    await sleep(50);
    mk = a2.msgs.length;
    const mkB = b2.msgs.length;
    a2.send({ t: 'cc', op: 'ready', ready: true, initiative: 1 });
    const g2a = await a2.next(m => m.t === 'joined' && !!m['view'], mk);
    await b2.next(m => m.t === 'joined' && !!m['view'], mkB);
    assert.equal(g2a['view'].initiative, 1, 'Bo takes the initiative, as Ann chose');
    assert.equal(g2a['match']?.game, 2);
    assert.equal(g2a['view'].players[0].hand.length + g2a['view'].decks[0].length, presetCfg.main.length,
      'Ann plays the preset deck (its size)');
    assert.deepEqual(g2a['clock']?.ms?.map((x: number) => Math.round(x / 1000)), banks.map(x => Math.round(x / 1000)),
      'game 2 starts on the carried banks');
    // §6 Bo concedes game 2; game 3; Bo concedes again
    let m3: Msg;
    mk = a2.msgs.length;
    b2.send({ t: 'action', action: { type: 'concede', seat: 1 } });
    m3 = await a2.next(m => m.t === 'match', mk);
    assert.deepEqual(m3['match'].score, [1, 1]);
    const room3 = String(m3['room']);
    await joinNext(a2, b2, room3, ann, bo);
    await a2.next(m => m.t === 'update' && typeof m['waiting']?.match?.until === 'number');
    mk = a2.msgs.length;
    a2.send({ t: 'cc', op: 'ready', ready: true });
    b2.send({ t: 'cc', op: 'ready', ready: true, initiative: 0 });
    const g3 = await a2.next(m => m.t === 'joined' && !!m['view'], mk);
    assert.equal(g3['view'].initiative, 0);
    assert.equal(g3['match']?.game, 3);
    mk = a2.msgs.length;
    b2.send({ t: 'action', action: { type: 'concede', seat: 1 } });
    const end = await a2.next(m => m.t === 'match', mk);
    assert.equal(end['room'], null, 'no next room');
    assert.deepEqual(end['match'].score, [2, 1]);
    assert.deepEqual([end['match'].phase, end['match'].result?.winner, end['match'].result?.how], ['over', 0, 'games']);
    assert.equal((await mine(ann.token)).length, 0, '§7 a finished match is no longer listed');
  } finally {
    await w.stop();
  }
});
