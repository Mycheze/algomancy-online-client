/* R290 — the weight of a conceded game (run: node test-concession.ts).
 *
 * All in-process, like test-elo.ts: a weight is a pure function of a stamped
 * row, and everything downstream of it — the rating fold, the profile fold,
 * the history view — is a fold over stamped rows. The LIVE stamp (a real
 * `concede` over a socket landing in the room file with the right turn on
 * it) is test-concede.ts's job; this file starts from the row.
 *
 * The owner's ruling, 2026-09-05, in three tiers:
 *   turn 1  walkover  — not a game; conceder −WALKOVER_PENALTY, winner +0,
 *                       nothing counted for anybody
 *   turn 2  early     — a game for the record, K × EARLY_K_SCALE, no
 *                       fast-game achievements
 *   turn 3+ normal    — exactly as before
 *
 * ⭐ THE ASSERTIONS THAT MATTER are the ones about ABSENCE: a row without the
 * stamp (every game before 2026-09-05, and every game that did not end in a
 * concession) must fold byte-for-byte as it did before. §4 is the positive
 * control for that — the same row with and without a normal-tier stamp, and
 * with no stamp at a turn count that WOULD be a walkover if the turn count
 * were what decided it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameMode, Seat } from '../engine/src/types.ts';
import type { RatableGame } from './rating.ts';
import type { RecordedGame } from './accounts.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-concession-test-'));
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = join(SCRATCH, 'games');

const {
  concessionWeight, sanitizeConcession,
  EARLY_K_SCALE, EARLY_MAX_TURN, WALKOVER_MAX_TURN, WALKOVER_PENALTY,
} = await import('./concession.ts');
const { foldRatings, K_PROVISIONAL, START_RATING } = await import('./rating.ts');
const {
  accountByName, loadAccounts, rebuildProfiles, recentGames, register, stashHistory,
} = await import('./accounts.ts');
const { matchLengths } = await import('./history.ts');
const { zeroElements } = await import('./stats.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── 1. the tiers, and the constants that name them ────────────────────

console.log('\n[the tiers]');
{
  eq(WALKOVER_MAX_TURN, 1, 'a walkover is a turn-1 concede (owner: "insta concede")');
  eq(EARLY_MAX_TURN, 2, 'early is "in the first 2 turns"');
  eq(WALKOVER_PENALTY, 5, 'a walkover costs the conceder 5');
  eq(EARLY_K_SCALE, 0.5, 'an early concession moves ratings at half K');
  ok(WALKOVER_MAX_TURN < EARLY_MAX_TURN, 'the walkover line sits below the early line');

  eq(concessionWeight({}), 'normal', '⭐ no stamp at all is normal — every row recorded before 2026-09-05');
  eq(concessionWeight({ concession: null }), 'normal', 'and so is an explicit null');
  eq(concessionWeight({ concession: { seat: 0, turn: 1 } }), 'walkover', 'turn 1 is a walkover');
  eq(concessionWeight({ concession: { seat: 0, turn: 0 } }), 'walkover', 'turn 0 (a game that never started) is one too');
  eq(concessionWeight({ concession: { seat: 1, turn: 2 } }), 'early', 'turn 2 is early');
  eq(concessionWeight({ concession: { seat: 1, turn: 3 } }), 'normal', '⭐ turn 3 is normal ("going to turn 3 or longer")');
  eq(concessionWeight({ concession: { seat: 0, turn: 5 } }), 'normal', 'turn 5: "they\'re dead and they just concede to save time"');

  ok(sanitizeConcession({ seat: 1, turn: 2 })?.turn === 2, 'a well-formed stamp survives sanitizing');
  eq(sanitizeConcession({ seat: 2, turn: 2 }), undefined, 'a stamp naming no seat is dropped');
  eq(sanitizeConcession({ seat: 0, turn: 'x' }), undefined, 'and one with no turn');
  eq(sanitizeConcession(undefined), undefined, 'and an absent one stays absent');
}

// ── 2. the rating fold ────────────────────────────────────────────────

console.log('\n[ratings]');
let n = 0;
const game = (o: Partial<RatableGame> = {}): RatableGame => ({
  code: `G${String(++n).padStart(3, '0')}`,
  playedAt: `2026-09-05T10:00:${String(n % 60).padStart(2, '0')}.000Z`,
  mode: 'constructed' as GameMode,
  finished: true,
  winner: 0 as Seat,
  users: ['alice', 'bob'],
  rated: true,
  ...o,
});
{
  // the control: an even first game at provisional K
  const full = foldRatings([game()]);
  const fullWin = full.get('alice')!.constructed.rating - START_RATING;
  eq(fullWin, K_PROVISIONAL / 2, 'control: an even first win is +K/2');

  // walkover — bob concedes on turn 1
  const wo = foldRatings([game({ winner: 0, concession: { seat: 1, turn: 1 } })]);
  eq(wo.get('alice')!.constructed.rating, START_RATING, '⭐ walkover: the winner gains NOTHING ("they didn\'t do anything either")');
  eq(wo.get('bob')!.constructed.rating, START_RATING - WALKOVER_PENALTY, `⭐ walkover: the conceder loses exactly ${WALKOVER_PENALTY}`);
  eq(wo.get('alice')!.constructed.games, 0, '⭐ a walkover is NOT a rated game for the provisional count (winner)');
  eq(wo.get('bob')!.constructed.games, 0, 'nor for the conceder');
  // it is the CONCEDER who pays, whichever seat they sat in
  const wo2 = foldRatings([game({ winner: 1, concession: { seat: 0, turn: 1 } })]);
  eq(wo2.get('alice')!.constructed.rating, START_RATING - WALKOVER_PENALTY, 'seat 0 conceding: seat 0 pays');
  eq(wo2.get('bob')!.constructed.rating, START_RATING, 'and seat 1 gains nothing');
  // and only in a rated game
  eq(foldRatings([game({ rated: false, concession: { seat: 1, turn: 1 } })]).size, 0,
    '⭐ an unrated walkover moves nobody — the tiers sit on top of isRated, not beside it');

  // early — bob concedes on turn 2
  const early = foldRatings([game({ winner: 0, concession: { seat: 1, turn: 2 } })]);
  eq(early.get('alice')!.constructed.rating - START_RATING, fullWin * EARLY_K_SCALE,
    '⭐ early: the winner gains half of a full win');
  eq(START_RATING - early.get('bob')!.constructed.rating, fullWin * EARLY_K_SCALE, 'and the conceder loses half of a full loss');
  eq(early.get('alice')!.constructed.games, 1, 'an early concession IS a rated game (it is a game for the record)');

  // normal — bob concedes on turn 5: indistinguishable from a lethal blow
  const norm = foldRatings([game({ winner: 0, concession: { seat: 1, turn: 5 } })]);
  eq(norm.get('alice')!.constructed.rating - START_RATING, fullWin, '⭐ turn 5: exactly a full win');
  eq(norm.get('bob')!.constructed.games, 1, 'and a rated game');

  // five walkovers do not make anybody "settled"
  const five = foldRatings(Array.from({ length: 5 }, () => game({ winner: 0, concession: { seat: 1, turn: 1 } })));
  eq(five.get('bob')!.constructed.games, 0, 'five walkovers: still zero rated games');
  eq(five.get('bob')!.constructed.rating, START_RATING - 5 * WALKOVER_PENALTY, 'but five penalties');
}

// ── 3. the profile fold ───────────────────────────────────────────────

console.log('\n[the profile fold]');
loadAccounts();
register('Alice', 'hunter2');
register('Bob', 'hunter2');
const aId = accountByName('Alice')!.id;
const bId = accountByName('Bob')!.id;

/** a seat that would EARN the fast-game feats if the game counted as full:
 * no life lost, no combat damage dealt, every BL-31 counter present */
const seat = (name: string, won: boolean): RecordedGame['seats'][0] => ({
  name, won, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: zeroElements(), recycled: zeroElements(), resourcesActivated: 0,
  abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0,
  lifeLost: 0, unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 20,
  combatDamageDealt: 0, bestGraftParts: 0, bestSingleHit: 0, bestCombatDamage: 0,
  biggestUnit: 0, mostUnitsInPlay: 0, mostResources: 0, mostCardsInHand: 0,
  lowestLife: 20, bestSameSpell: 0, resourcesLeft: 2, deckLeft: 30,
});
let r = 0;
const row = (o: Partial<RecordedGame> & { turns: number }): RecordedGame => ({
  code: `R${String(++r).padStart(3, '0')}`,
  playedAt: `2026-09-05T12:00:${String(r % 60).padStart(2, '0')}.000Z`,
  recordedAt: '2026-09-05T12:00:00.000Z',
  mode: 'constructed', els: ['fire'], finished: true, winner: 0, diverged: false,
  users: [aId, bId], names: ['Alice', 'Bob'],
  seats: [seat('Alice', true), seat('Bob', false)],
  rated: true, matchMs: 10 * 60_000,
  ...o,
});
const alice = () => accountByName('Alice')!;
const bob = () => accountByName('Bob')!;
const earned = (id: string): boolean => !!alice().achievements[id];

{
  // §3a — a walkover changes NO counter, for either player
  stashHistory(row({ turns: 1, concession: { seat: 1, turn: 1 } }));
  rebuildProfiles();
  const p = alice().profile, q = bob().profile;
  eq(p.games, 0, '⭐ walkover: the winner has played 0 games');
  eq(p.wins, 0, 'and has 0 wins');
  eq(q.losses, 0, 'and the conceder has 0 losses');
  eq(p.streak, 0, 'no streak');
  eq(p.byMode.constructed, 0, 'no game in the format');
  eq(p.turnsPlayed, 0, 'no turns');
  eq(p.firstPlayed, null, 'not even a first-played date');
  eq(Object.keys(p.opponents).length, 0, 'no head-to-head row');
  eq(p.blitzWins + p.flawlessWins + p.pacifistWins, 0, 'no feat of any kind');
  ok(!earned('first-game') && !earned('first-win'), '⭐ "Play your first game" is NOT unlocked by a walkover');
  eq(p.ratedGames.constructed, 0, 'no rated game');
  eq(p.rating.constructed, START_RATING, 'the winner\'s rating is untouched');
  eq(q.rating.constructed, START_RATING - WALKOVER_PENALTY, 'the conceder\'s went down by the penalty');
  const hist = recentGames(aId);
  eq(hist.length, 1, '⭐ but the game IS in the match history');
  eq(hist[0]?.concession?.weight, 'walkover', 'labelled as a walkover');
  eq(hist[0]?.concession?.mine, false, 'and Alice was not the one who conceded');
  eq(recentGames(bId)[0]?.concession?.mine, true, 'Bob was');
  eq(hist[0]?.result, 'win', 'the row still says who won');
}

{
  // §3b — an early concession counts, but not toward the fast-game feats
  stashHistory(row({ turns: 2, concession: { seat: 1, turn: 2 } }));
  rebuildProfiles();
  const p = alice().profile, q = bob().profile;
  eq(p.games, 1, '⭐ early: it is a game');
  eq(p.wins, 1, 'and a win');
  eq(q.losses, 1, 'and a loss');
  eq(p.streak, 1, 'and it starts a streak');
  eq(p.opponents[bId]?.wins, 1, 'and a head-to-head win');
  ok(earned('first-game') && earned('first-win'), 'First Cast and Victory unlock off it');
  eq(p.blitzWins, 0, '⭐ but Blitz ("win by turn 5") does NOT count it');
  eq(p.flawlessWins, 0, 'nor Untouched ("lost no life" — trivially true before combat)');
  eq(p.pacifistWins, 0, 'nor Pacifist ("no combat damage" — same)');
  eq(p.asceticWins, 0, 'nor Ascetic');
  ok(!earned('blitz'), 'so the Blitz badge is not on the account');
  eq(p.ratedGames.constructed, 1, 'it is a rated game');
  eq(p.rating.constructed - START_RATING, (K_PROVISIONAL / 2) * EARLY_K_SCALE, 'at half weight');
  eq(recentGames(aId)[0]?.concession?.weight, 'early', 'and the history row says early');
}

{
  // §3c — the positive control: the SAME row with no stamp fires Blitz
  stashHistory(row({ turns: 2 }));
  rebuildProfiles();
  const p = alice().profile;
  eq(p.games, 2, 'control: an un-stamped 2-turn win is a game');
  eq(p.blitzWins, 1, '⭐ control: an un-stamped 2-turn win DOES count for Blitz — the stamp is what withholds it, not the turn count');
  eq(p.flawlessWins, 1, 'and for Untouched');
  eq(p.pacifistWins, 1, 'and for Pacifist');
  ok(earned('blitz'), 'Blitz unlocked');
  eq(recentGames(aId)[0]?.concession, undefined, 'and the history row carries no concession field');
}

{
  // §3d — normal: a turn-5 concession is a lethal blow in every respect
  const before = JSON.stringify(alice().profile);
  const stamped = row({ turns: 5, concession: { seat: 1, turn: 5 } });
  stashHistory(stamped);
  rebuildProfiles();
  const withStamp = JSON.stringify(alice().profile);
  eq(recentGames(aId)[0]?.concession?.weight, 'normal', 'the row says normal');
  eq(alice().profile.games, 3, 'three games on the record (the walkover is still not one)');
  eq(recentGames(aId).length, 4, 'four rows in the history (the walkover is)');
  // now the SAME game (same code, same date) with the stamp removed — the
  // profile must be identical
  const { concession: _drop, ...plain } = stamped;
  stashHistory(plain as RecordedGame);
  rebuildProfiles();
  const without = JSON.stringify(alice().profile);
  ok(withStamp !== before, 'a turn-5 concession moved the profile');
  eq(withStamp, without, '⭐ and moved it EXACTLY as the same game without a stamp — turn 3+ is "treated fully normally"');
  stashHistory(stamped);   // put the stamp back for §3e's direct-fold check
}

{
  // §3e — a walkover a player LOST while on a streak does not break it
  stashHistory(row({ turns: 1, winner: 1, concession: { seat: 0, turn: 1 },
    seats: [seat('Alice', false), seat('Bob', true)] }));
  rebuildProfiles();
  eq(alice().profile.streak, 3, '⭐ Alice walked out of a turn-1 game and her 3-game streak is intact');
  eq(alice().profile.losses, 0, 'and it is not a loss');
  eq(alice().profile.rating.constructed,
    // the three counted wins minus the one penalty she paid
    (() => {
      const t = foldRatings(recentGames(aId).map(g => ({
        code: g.code, playedAt: g.playedAt, mode: g.mode, finished: g.finished,
        winner: g.result === 'win' ? 0 as Seat : 1 as Seat, users: [aId, bId] as [string, string], rated: true,
        ...(g.concession ? { concession: { seat: (g.concession.mine ? 0 : 1) as Seat, turn: g.concession.turn } } : {}),
      })));
      return t.get(aId)!.constructed.rating;
    })(),
    'and her rating agrees with a direct fold of the same rows');
}

// ── 4. the length stat ────────────────────────────────────────────────

console.log('\n[match lengths]');
{
  const g = (code: string, ms: number, concession?: { seat: Seat; turn: number }): RecordedGame =>
    row({ code, turns: 5, matchMs: ms, ...(concession ? { concession } : {}) });
  const all = matchLengths([g('A', 30 * 60_000), g('B', 40 * 60_000)]);
  eq(all.n, 2, 'control: two full games');
  const mixed = matchLengths([
    g('A', 30 * 60_000), g('B', 40 * 60_000),
    g('W', 20_000, { seat: 1, turn: 1 }),          // a 20-second walkover
    g('E', 90_000, { seat: 1, turn: 2 }),          // a 90-second early concession
    g('N', 50 * 60_000, { seat: 1, turn: 6 }),     // a real game that ended in a concede
  ]);
  eq(mixed.n, 3, '⭐ a walkover and an early concession are not "how long a game takes here"');
  eq(mixed.mean, Math.round((30 + 40 + 50) * 60_000 / 3), 'the mean is over the three full games');
}

rmSync(SCRATCH, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED\n` : '\nall concession tests passed\n');
process.exit(failures ? 1 : 0);
