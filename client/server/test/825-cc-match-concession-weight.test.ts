/* docs/22 §2.6 — HOW A CONCEDED MATCH WEIGHS (CR D8.5 carried to a match).
 *
 * CR D8.5: a conceded game weighs by the turn it was conceded on — turn 1 or
 * earlier a walkover (the conceder loses 5, the winner gains nothing, no rated
 * game counted), turn 2 early (half K), turn 3 on normal. A match is weighed
 * by how much of it was played:
 *
 *   §1 ⭐ decided in or right after game 1 (a Bo1, or a Bo3 conceded after its
 *      first game): it weighs exactly as game 1 does — walkover, early, normal
 *   §2 ⭐ two or more games: normal, whatever the deciding concede's turn
 *   §3 a match conceded before game 1 was dealt is a walkover by the conceder
 *   §4 the stamp is the MATCH LOSER's: a match lost by conceding it after the
 *      opponent conceded game 1 charges the loser, never the winner
 *   §5 ⭐ the real path: a Bo1 whose one game is conceded on turn 1 (the stamp
 *      as rooms.ts writes it) costs the conceder 5 and gives the winner nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t825');
const A = await import('../accounts.ts');
const H = await import('../history.ts');
const Rt = await import('../rating.ts');
const C = await import('../concession.ts');
const LM = await import('../league-match.ts');
const restore = A.useAccountsFile(join(F.DIR, 'accounts.json'));
test.after(() => { restore(); rmSync(F.DIR, { recursive: true, force: true }); });
LM.installLeagueMatchHooks();

const ENDED = Date.parse('2026-11-02T12:00:00Z');
/** a decided, rated match between u1 (seat 0) and u2 (seat 1) */
const match = (winner: Seat, games: string[]) => ({
  id: 'MCCCCCCCCCC', phase: 'over', endedAt: ENDED, rated: true as const, users: ['u1', 'u2'] as [string, string],
  games: games.map(code => ({ code })), result: { winner, at: ENDED },
});
/** the two ratings after folding one match row */
function fold(row: ReturnType<typeof Rt.matchRatingRow>): { r: [number, number]; n: [number, number] } {
  const t = Rt.foldRatings([row!]);
  const s = (u: string) => Rt.standingFor(t, u).constructed;
  return { r: [s('u1').rating, s('u2').rating], n: [s('u1').games, s('u2').games] };
}
/** a stamp lookup: game code → who conceded it, on which turn */
const stamps = (m: Record<string, { seat: Seat; turn: number }>) => (code: string) => m[code];

test('§1 ⭐ a match decided in or right after game 1 weighs as game 1 does (CR D8.5)', () => {
  const walk = Rt.matchRatingRow(match(0, ['G1']), stamps({ G1: { seat: 1, turn: 1 } }))!;
  assert.equal(C.concessionWeight(walk), 'walkover');
  assert.deepEqual(fold(walk), { r: [1000, 995], n: [0, 0] }, '⭐ a turn-1 Bo1: the conceder loses 5, the winner nothing, no rated game');

  const early = Rt.matchRatingRow(match(0, ['G1']), stamps({ G1: { seat: 1, turn: 2 } }))!;
  assert.equal(C.concessionWeight(early), 'early');
  assert.deepEqual(fold(early), { r: [1010, 990], n: [1, 1] }, '⭐ a turn-2 Bo1: half weight, and it counts');

  const late = Rt.matchRatingRow(match(0, ['G1']), stamps({ G1: { seat: 1, turn: 6 } }))!;
  assert.equal(C.concessionWeight(late), 'normal');
  assert.deepEqual(fold(late), { r: [1020, 980], n: [1, 1] }, 'a turn-6 concede is a full game');

  const played = Rt.matchRatingRow(match(0, ['G1']), stamps({}))!;
  assert.equal(played.concession, undefined, 'a game 1 won at the table carries no stamp');
  assert.deepEqual(fold(played), { r: [1020, 980], n: [1, 1] });

  // a Bo3 conceded BETWEEN games after a walkover game 1: still only game 1 was played
  const afterWalk = Rt.matchRatingRow(match(0, ['G1']), stamps({ G1: { seat: 1, turn: 0 } }))!;
  assert.equal(C.concessionWeight(afterWalk), 'walkover', 'conceding the match after a walkover game 1 is a walkover');
});

test('§2 ⭐ two or more games weigh normal, whatever the deciding concede', () => {
  const r = Rt.matchRatingRow(match(1, ['G1', 'G2', 'G3']), stamps({ G3: { seat: 0, turn: 1 } }))!;
  assert.equal(r.concession, undefined, 'no stamp: games were played');
  assert.deepEqual(fold(r), { r: [980, 1020], n: [1, 1] }, '⭐ a game-3 turn-1 concede is a full match result');
  const two = Rt.matchRatingRow(match(0, ['G1', 'G2']), stamps({ G1: { seat: 1, turn: 2 }, G2: { seat: 1, turn: 2 } }))!;
  assert.equal(C.concessionWeight(two), 'normal');
});

test('§3 a match conceded before game 1 was dealt is a walkover by the conceder', () => {
  const r = Rt.matchRatingRow(match(1, []), stamps({}))!;
  assert.deepEqual(r.concession, { seat: 0, turn: 0 }, 'the loser, on turn 0: nothing was played');
  assert.deepEqual(fold(r), { r: [995, 1000], n: [0, 0] });
});

test('§4 the stamp is on the match loser, whoever conceded game 1', () => {
  // u2 concedes game 1 on turn 1; u1 then concedes the MATCH between games
  const r = Rt.matchRatingRow(match(1, ['G1']), stamps({ G1: { seat: 1, turn: 1 } }))!;
  assert.deepEqual(r.concession, { seat: 0, turn: 1 }, 'charged to u1, who lost the match');
  assert.deepEqual(fold(r), { r: [995, 1000], n: [0, 0] }, 'the winner is never the one charged');
});

test('§5 ⭐ a Bo1 conceded on turn 1, through the real stamp, is a walkover', () => {
  assert.ok(A.register('WalkAnn', 'correct horse battery').ok);
  assert.ok(A.register('WalkBo', 'correct horse battery').ok);
  const ann = A.accountByName('WalkAnn')!.id, bo = A.accountByName('WalkBo')!.id;
  const { room, m } = F.start(1, [ann, bo]);
  m.rated = true;
  room.rated = true;
  F.S.saveMatch(m);
  F.concede(room, 1);
  assert.equal(m.phase, 'over');
  assert.equal(room.concession?.turn, 1, 'rooms.ts stamped the turn-1 concede');
  H.recordLiveGame(room);
  const a = A.accountById(ann)!.profile, b = A.accountById(bo)!.profile;
  assert.deepEqual([a.rating.constructed, b.rating.constructed], [1000, 995], '⭐ the conceder pays 5, the winner gains nothing');
  assert.deepEqual([a.ratedGames.constructed, b.ratedGames.constructed], [0, 0], 'and it is no rated game');
});
