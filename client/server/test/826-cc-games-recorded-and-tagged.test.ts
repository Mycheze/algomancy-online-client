/* docs/22 §2.6 — EVERY GAME OF A MATCH IS RECORDED, COUNTED AND TAGGED.
 *
 * The rating sees the match once (824); everything else sees every game, as
 * it would any game: the history, the profile, achievements, the deck record
 * and the card stats. Each row says which match and which game it was, so
 * the history can say "Game 2 of 3".
 *
 *   §1 ⭐ a Bo3 played 2-1: three history rows, each tagged {id, game, bestOf},
 *      and the match history's rows carry the tag
 *   §2 ⭐ the card stats count all three games — rated filter included — and
 *      each seat's deck in each of them
 *   §3 a re-import of the game files (the boot sync) keeps every tag, reading
 *      the link off each file and the best-of off the match record
 *   §4 the tag of a link with no match record: a game 2 or 3 exists only in a
 *      best of three; a game 1 cannot say
 *
 * The concedes' stamps are moved to turn 5 (and saved) so each game is an
 * ordinary decided game: a turn-1 concede is a walkover, which CR D8.5a counts
 * toward nothing — 825 is about that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t826');
const A = await import('../accounts.ts');
const H = await import('../history.ts');
const CS = await import('../api-cardstats.ts');
const LM = await import('../league-match.ts');
const restore = A.useAccountsFile(join(F.DIR, 'accounts.json'));
test.after(() => { restore(); rmSync(F.DIR, { recursive: true, force: true }); });
LM.installLeagueMatchHooks();

type Room = ReturnType<typeof F.current>;
function decide(room: Room, loser: Seat): void {
  F.concede(room, loser);
  room.concession = { seat: loser, turn: 5 };
  F.R.touchRoom(room, Date.now());     // the file says so too, for §3's re-import
  H.recordLiveGame(room);
}
function dealNext(m: Parameters<typeof F.current>[0]): Room {
  const room = F.current(m);
  F.seatUp(room, 0, 1);
  F.M.matchSeatJoined(room);
  const chooser = m.between!.chooser;
  F.M.matchOp(room, chooser === 0 ? 1 : 0, 'ready', { ready: true });
  F.M.matchOp(room, chooser, 'ready', { ready: true, initiative: chooser });
  assert.equal(m.phase, 'game');
  return room;
}

assert.ok(A.register('TagAnn', 'correct horse battery').ok);
assert.ok(A.register('TagBo', 'correct horse battery').ok);
const ANN = A.accountByName('TagAnn')!.id, BO = A.accountByName('TagBo')!.id;
const { room: G1, m: MATCH } = F.start(3, [ANN, BO]);
MATCH.rated = true;
G1.rated = true;
F.S.saveMatch(MATCH);
decide(G1, 1);
const G2 = dealNext(MATCH);
decide(G2, 0);
const G3 = dealNext(MATCH);
decide(G3, 1);
const CODES = [G1.code, G2.code, G3.code];

test('§1 ⭐ every game of a 2-1 Bo3 is a history row tagged with its match and game', () => {
  assert.equal(MATCH.phase, 'over');
  assert.deepEqual(F.S.matchScore(MATCH), [2, 1]);
  const rows = CODES.map(c => A.gameHistory().find(g => g.code === c));
  assert.ok(rows.every(Boolean), '⭐ all three games are in the history');
  assert.deepEqual(rows.map(r => r!.match), [1, 2, 3].map(game => ({ id: MATCH.id, game, bestOf: 3 })),
    '⭐ each says which game of which best of three it was');
  assert.deepEqual(rows.map(r => r!.winner), [0, 1, 0]);
  const mine = A.recentGames(ANN).filter(r => CODES.includes(r.code));
  assert.equal(mine.length, 3);
  assert.deepEqual(mine.map(r => r.match?.game).sort(), [1, 2, 3], 'the match history rows carry the tag ("Game 2 of 3")');
  assert.deepEqual(mine.map(r => r.result).sort(), ['loss', 'win', 'win']);
  const p = A.accountById(ANN)!.profile;
  assert.deepEqual([p.games, p.wins, p.losses], [3, 2, 1], 'the profile counts every game');
  assert.equal(p.ratedGames.constructed, 1, 'and the rating, the match once (824)');
});

test('§2 ⭐ the card stats count every game of the match', () => {
  const games = CS.statsGames().filter(g => CODES.includes(g.code));
  assert.equal(games.length, 3, 'each game joins its ledger');
  const all = CS.cardStats({ mode: 'constructed' });
  assert.equal(all.games, 3, '⭐ three games, not one match');
  assert.equal(all.seatGames, 6);
  assert.equal(CS.cardStats({ mode: 'constructed', rated: true }).games, 3, 'the rated filter keeps them all');
  // each seat's deck counts in each game: seat 0's first main card, seat 1's
  const card0 = F.REG[0].main[0]!, card1 = F.REG[1].main[0]!;
  const row = (c: string) => all.cards.find(r => r.card === c);
  assert.equal(row(card0)?.deck.n, 3, `${card0} was in seat 0's deck in all three games`);
  assert.equal(row(card1)?.deck.n, 3, `${card1} likewise for seat 1`);
});

test('§3 a re-import of the files keeps every tag', () => {
  const r = H.syncGamesDir(join(F.DIR, 'games'), { force: true });
  assert.ok(r.rows.some(x => CODES.includes(x.code)), 'the games were re-read from their files');
  const rows = CODES.map(c => A.gameHistory().find(g => g.code === c)!);
  assert.deepEqual(rows.map(x => x.match), [1, 2, 3].map(game => ({ id: MATCH.id, game, bestOf: 3 })));
  assert.ok(rows.every(x => !x.diverged), 'each game replays from its own deal (its rules threaded)');
  assert.equal(A.accountById(ANN)!.profile.ratedGames.constructed, 1, 'and the rebuild still rates the match once');
});

test('§4 a link with no match record still tags the game', () => {
  assert.deepEqual(H.matchTagOf({ id: 'MZZZZZZZZZZ', game: 2 }), { id: 'MZZZZZZZZZZ', game: 2, bestOf: 3 },
    'a game 2 is a best of three');
  assert.deepEqual(H.matchTagOf({ id: 'MZZZZZZZZZZ', game: 1 }), { id: 'MZZZZZZZZZZ', game: 1 }, 'a game 1 cannot say');
  assert.equal(H.matchTagOf({ id: 'ABCD', game: 1 }), undefined, 'a room code is not a match id');
  assert.equal(H.matchTagOf(undefined), undefined);
});
