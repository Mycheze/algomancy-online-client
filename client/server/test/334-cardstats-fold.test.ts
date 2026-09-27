/* CARD STATS §5 — THE FOLD: which games count, and what each rate divides by.
 *
 * Pure: hand-built ledgers in, rows out. The rules pinned here are the ones a
 * tidy-up would most plausibly break:
 *   - the same exclusions as every other fold (unfinished, custom, single card
 *     duels, walkovers) and 'shared', which is a test table;
 *   - a denominator counts only the games that can VOUCH for its fact — a
 *     refs-only game is in Played and never in GIH or "not seen";
 *   - "my games" folds only the caller's own seat;
 *   - a public answer below the floor is refused (api-cardstats.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldCardStats, identity, type StatsGame } from '../cardstats.ts';
import { ledgerOf, type CardFact, type CardOpen, type Coverage, type LedgerSource } from '../cardledger.ts';

const FULL: Coverage = { open: true, draws: true, plays: true, picks: true, turns: true, init: true };
const REFS: Coverage = { open: false, draws: false, plays: true, picks: true, turns: false, init: false };

/** One constructed game: seat 0 opens on Jelly and plays it on turn 2, seat
 * 1 never sees it. Both decks run Jelly and Recall. Seat `winner` wins. */
function game(code: string, winner: 0 | 1, over: Partial<StatsGame> = {}, source: LedgerSource = 'live', cov: Coverage = FULL): StatsGame {
  const open: CardOpen = { init: 0, hands: [['Jelly', 'Recall'], ['Recall']] };
  const log: CardFact[] = [{ t: 2, m: [[0, 'Jelly', 'H', 'X']] }, { t: 3, m: [[1, 'Recall', 'H', 'R']] }];
  const deck = ['Jelly', 'Jelly', 'Recall', 'Recall'];
  return {
    code, playedAt: '2026-09-20T12:00:00.000Z', mode: 'constructed', els: [], finished: true, winner, turns: 6,
    users: ['u0', 'u1'], ledger: ledgerOf(cov.open ? open : null, log, [deck, deck], source, cov), ...over,
  };
}

test('the same exclusions as every other fold, and shared is not a game here', () => {
  const r = foldCardStats([
    game('A', 0),
    game('B', 0, { finished: false, winner: null }),
    game('C', 0, { custom: { any: 1 } }),
    game('D', 0, { single: ['Jelly', 'Jelly'] }),
    game('E', 0, { concession: { seat: 1, turn: 1 } }),
    game('F', 0, { mode: 'shared' }),
  ], { mode: 'all' });
  assert.equal(r.games, 1);
  assert.equal(r.seatGames, 2);
});

test('GIH, OH, played, GNS and the deck rate, from both seats', () => {
  const r = foldCardStats([game('A', 0), game('B', 1)], { mode: 'all' });
  const jelly = r.cards.find(c => c.card === 'Jelly')!;
  assert.deepEqual(jelly.gih, { n: 2, w: 1 }, 'seat 0 held it in both games and won one');
  assert.deepEqual(jelly.oh, { n: 2, w: 1 });
  assert.deepEqual(jelly.played, { n: 2, w: 1 });
  assert.deepEqual(jelly.gns, { n: 2, w: 1 }, 'seat 1 ran it and never saw it, in both');
  assert.deepEqual(jelly.deck, { n: 4, w: 2 }, 'every seat-game decked it');
  assert.equal(jelly.firstTurnSum / jelly.firstTurnN, 2);
  assert.equal(r.cards.find(c => c.card === 'Recall')!.recycled, 2);
  assert.deepEqual(r.onPlay, { n: 2, w: 1 }, 'seat 0 had initiative in both');
});

test('a refs-only game counts toward Played and never toward GIH or "not seen"', () => {
  const r = foldCardStats([game('A', 0), game('R', 0, {}, 'refs', REFS)], { mode: 'all' });
  const jelly = r.cards.find(c => c.card === 'Jelly')!;
  assert.equal(jelly.played.n, 2, 'both games know Jelly was played');
  assert.equal(jelly.gih.n, 1, 'only the full game knows the hand');
  assert.equal(jelly.gns.n, 1, 'and only the full game knows seat 1 never saw it');
  assert.equal(jelly.oh.n, 1);
  assert.deepEqual(r.coverage, { open: 2, draws: 2, plays: 4, picks: 0, init: 2 });
  assert.deepEqual(r.sources, { live: 1, refs: 1 });
});

test('"my games" folds only my own seat', () => {
  const r = foldCardStats([game('A', 0), game('B', 1, { users: ['u9', 'u1'] })], { mode: 'all', me: 'u0' });
  assert.equal(r.games, 1, 'a game I was not in is not mine');
  assert.equal(r.seatGames, 1, 'and in mine, only my side');
  assert.equal(r.cards.find(c => c.card === 'Jelly')!.gns.n, 0, 'seat 1\'s unseen Jelly is not my fact');
});

test('filters: mode, dates, rated, both signed in', () => {
  const gs = [game('A', 0), game('B', 0, { playedAt: '2026-09-25T00:00:00.000Z', rated: true }), game('C', 0, { users: ['u0', null] })];
  assert.equal(foldCardStats(gs, { mode: 'draft' }).games, 0);
  assert.equal(foldCardStats(gs, { mode: 'all', from: '2026-09-21' }).games, 1);
  assert.equal(foldCardStats(gs, { mode: 'all', to: '2026-09-20' }).games, 2);
  assert.equal(foldCardStats(gs, { mode: 'all', rated: true }).games, 1);
  assert.equal(foldCardStats(gs, { mode: 'all', bothSignedIn: true }).games, 2);
});

test('a seat\'s colours are the elements carrying a quarter of its weight', () => {
  assert.deepEqual(identity({ fire: 6, water: 3, dark: 1 }), ['fire', 'water']);
  assert.deepEqual(identity({ earth: 1 }), ['earth']);
  assert.deepEqual(identity({}), []);
});

test('the public floor refuses a filter narrow enough to show one game\'s hands', async () => {
  const { PUBLIC_FLOOR } = await import('../api-cardstats.ts');
  assert.ok(PUBLIC_FLOOR >= 5, 'a floor below five games prints individual hands');
});
