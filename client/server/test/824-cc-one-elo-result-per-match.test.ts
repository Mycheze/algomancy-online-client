/* docs/22 §2.6 — A RATED COMPETITIVE MATCH IS ONE ELO RESULT, NEVER ITS GAMES.
 *
 * The owner, 2026-11-02, choosing the ladder: "Share constructed" — the option
 * that read "One constructed rating; a CC match moves it once."
 *
 *   §1 a game that belongs to a match is never rated, whatever else it says;
 *      the match row is the match's stamped result, and only a decided match
 *      has one (an open or a void match moves nobody)
 *   §2 ⭐ a rated best of three won 2-0 between two accounts moves each rating
 *      ONCE, on the constructed ladder, and counts ONE rated game each — while
 *      the profiles count both games
 *   §3 the match's row sorts by when the match ended, and its `M` id never
 *      ties with a room code
 *
 * The games are decided by concedes. A concede's STAMP (`Room.concession`,
 * who and on which turn) is the only thing any fold reads about it (server/
 * concession.ts, "THE STAMP"); these games end on turn 1, so each stamp is
 * moved to turn 5 before the game is recorded — an ordinary decided game, which
 * is what this file is about (825 is about the weights).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

// the fixture points the games and the matches at a scratch directory BEFORE
// anything loads the rooms module (it reads its directory at import)
const F = await ccFixture('t824');
const A = await import('../accounts.ts');
const H = await import('../history.ts');
const Rt = await import('../rating.ts');
const LM = await import('../league-match.ts');
const restore = A.useAccountsFile(join(F.DIR, 'accounts.json'));
test.after(() => { restore(); rmSync(F.DIR, { recursive: true, force: true }); });
LM.installLeagueMatchHooks();

function account(name: string): string {
  assert.ok(A.register(name, 'correct horse battery').ok, `register ${name}`);
  return A.accountByName(name)!.id;
}

/** `seat` concedes `room`'s game; the stamp says turn 5; main.ts's order:
 * the match moves first, then the game is recorded */
function decide(room: ReturnType<typeof F.current>, loser: Seat): void {
  F.concede(room, loser);
  room.concession = { seat: loser, turn: 5 };
  H.recordLiveGame(room);
}

/** both seats into the between-games room, both ready, the chooser choosing */
function dealNext(m: Parameters<typeof F.current>[0]): ReturnType<typeof F.current> {
  const room = F.current(m);
  F.seatUp(room, 0, 1);
  F.M.matchSeatJoined(room);
  const chooser = m.between!.chooser;
  F.M.matchOp(room, chooser === 0 ? 1 : 0, 'ready', { ready: true });
  F.M.matchOp(room, chooser, 'ready', { ready: true, initiative: chooser });
  assert.equal(m.phase, 'game', 'the next game is dealt');
  return room;
}

test('§1 a game of a match is never rated, and only a decided match has a row', () => {
  const game = {
    code: 'ABCD', playedAt: '2026-11-02T10:00:00.000Z', mode: 'constructed' as const, finished: true,
    winner: 0 as Seat, users: ['u1', 'u2'] as [string, string], rated: true,
  };
  assert.equal(Rt.isRated(game), true, 'the same game, alone, is rated (non-vacuous)');
  assert.equal(Rt.isRated({ ...game, match: { id: 'MAAAAAAAAAA', game: 1, bestOf: 3 } }), false,
    'a game of a match never moves a rating by itself');

  const over = {
    id: 'MAAAAAAAAAA', phase: 'over', endedAt: Date.parse('2026-11-02T12:00:00Z'), rated: true as const,
    users: ['u1', 'u2'] as [string, string], games: [{ code: 'G1' }, { code: 'G2' }],
    result: { winner: 1 as Seat, at: Date.parse('2026-11-02T12:00:00Z') },
  };
  const row = Rt.matchRatingRow(over, () => undefined)!;
  assert.deepEqual(row, {
    code: 'MAAAAAAAAAA', playedAt: '2026-11-02T12:00:00.000Z', mode: 'constructed', finished: true,
    winner: 1, users: ['u1', 'u2'], rated: true,
  }, 'one constructed result: the match winner, when it ended');
  assert.equal(Rt.isRated(row), true);
  assert.equal(Rt.matchRatingRow({ ...over, rated: undefined }, () => undefined)!.rated, undefined, 'an unrated match stays unrated');
  for (const phase of ['game', 'between', 'paused', 'void']) {
    assert.equal(Rt.matchRatingRow({ ...over, phase, result: phase === 'void' ? undefined : over.result }, () => undefined), null,
      `a ${phase} match has no result to rate`);
  }
});

test('§2 ⭐ a rated Bo3 won 2-0 moves each rating once and counts one rated game, while both games count', () => {
  const ann = account('EloAnn'), bo = account('EloBo');
  const { room: g1, m } = F.start(3, [ann, bo]);
  // rated as a league match is from week 1: the match and every room it makes
  m.rated = true;
  g1.rated = true;
  F.S.saveMatch(m);

  decide(g1, 1);                       // Ann takes game 1
  assert.equal(m.phase, 'between');
  const a1 = A.accountById(ann)!.profile, b1 = A.accountById(bo)!.profile;
  assert.equal(a1.games, 1, 'game 1 is in the record');
  assert.deepEqual([a1.rating.constructed, b1.rating.constructed], [Rt.START_RATING, Rt.START_RATING],
    '⭐ game 1 alone moves nobody: the match is not decided');
  assert.deepEqual([a1.ratedGames.constructed, b1.ratedGames.constructed], [0, 0]);

  const g2 = dealNext(m);
  decide(g2, 1);                       // and game 2: 2-0
  assert.equal(m.phase, 'over');
  assert.equal(m.result!.winner, 0);
  const a = A.accountById(ann)!.profile, b = A.accountById(bo)!.profile;
  assert.equal(a.games, 2, 'both games count in the profile');
  assert.equal(a.wins, 2);
  assert.equal(b.losses, 2);
  assert.deepEqual([a.ratedGames.constructed, b.ratedGames.constructed], [1, 1], '⭐ ONE rated game each: the match');
  // one result at the provisional K, from 1000 each: 1000 ± 40 × 0.5
  assert.deepEqual([a.rating.constructed, b.rating.constructed], [1020, 980], '⭐ the rating moved once');
  assert.deepEqual([a.ratedGames.draft, a.rating.draft], [0, Rt.START_RATING], 'on the constructed ladder only');

  const rows = A.gameHistory().filter(g => g.match?.id === m.id);
  assert.equal(rows.length, 2, 'each game is its own history row');
  assert.ok(rows.every(r => r.rated === true), 'the games carry the room’s rated flag — and still are not rated');
});

test('§3 the match row sorts by when it ended, and its id never ties with a room code', () => {
  const ended = Date.parse('2026-11-02T12:00:00Z');
  const row = Rt.matchRatingRow({
    id: 'MBBBBBBBBBB', phase: 'over', endedAt: ended, users: ['u1', 'u2'], games: [{ code: 'X' }, { code: 'Y' }],
    result: { winner: 0, at: ended - 5 },
  }, () => undefined)!;
  assert.equal(row.playedAt, new Date(ended).toISOString(), 'played at the match’s end');
  const room = { code: 'MBBB', playedAt: row.playedAt };
  assert.notEqual(Rt.ratingOrder(row, room), 0, 'the same millisecond still has an order');
});
