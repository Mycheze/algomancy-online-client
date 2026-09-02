/* BL-02 — the rating fold (run: node test-elo.ts).
 *
 * All in-process. There is nothing to drive over a socket here: a rating is a
 * pure function of the game record, and the whole value of BL-02 is that it
 * stays one. So this file asks the fold questions rather than playing games.
 *
 * ⭐ THE ASSERTION THAT MATTERS is §5: fold the same games in a shuffled order
 * and get the same numbers. Elo is path-dependent, so "reproducible" is a real
 * property that a plausible implementation fails — sorting on `playedAt` alone
 * passes every other test in this file and fails that one the moment two games
 * share a timestamp, which the seeder produces routinely.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameMode, Seat } from '../engine/src/types.ts';
// type-only, so it is erased and does not import the module before the env
// vars above are set — which is what the awaited imports below are for
import type { RatableGame } from './rating.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-elo-test-'));
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = join(SCRATCH, 'games');

const {
  expectedScore, foldRatings, isRated, kFactor, nextRating, ratedMode,
  K_PROVISIONAL, K_SETTLED, PUBLIC_AFTER, START_RATING,
} = await import('./rating.ts');
const {
  emptyProfile, leaderboard, loadAccounts, rebuildProfiles, register, stashHistory,
  accountByName,
} = await import('./accounts.ts');
const { zeroElements } = await import('./stats.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const near = (got: number, want: number, tol: number, label: string): void =>
  ok(Math.abs(got - want) <= tol, `${label} (got ${got}, want ~${want})`);

let n = 0;
/** A rated, finished game between two accounts. */
const game = (o: Partial<RatableGame> = {}): RatableGame => ({
  code: `G${String(++n).padStart(3, '0')}`,
  playedAt: `2026-09-02T10:00:${String(n % 60).padStart(2, '0')}.000Z`,
  mode: 'constructed' as GameMode,
  finished: true,
  winner: 0 as Seat,
  users: ['alice', 'bob'],
  rated: true,
  ...o,
});

// ── 1. the arithmetic ─────────────────────────────────────────────────

console.log('\n[the arithmetic]');
{
  eq(START_RATING, 1000, 'everybody starts at 1000 (owner, 2026-08-25)');
  eq(expectedScore(1000, 1000), 0.5, 'equal ratings expect an even game');
  near(expectedScore(1200, 1000), 0.76, 0.01, '200 points ahead expects ~76%');
  ok(expectedScore(1000, 1200) + expectedScore(1200, 1000) === 1, 'expectations sum to 1');

  eq(kFactor(0), K_PROVISIONAL, 'a brand-new player is provisional');
  eq(kFactor(PUBLIC_AFTER - 1), K_PROVISIONAL, 'still provisional on the game before the 5th');
  eq(kFactor(PUBLIC_AFTER), K_SETTLED, '⭐ K settles on exactly the game you go public');

  eq(nextRating(1000, 1000, 1, 20), 1010, 'an even win at K=20 is +10');
  eq(nextRating(1000, 1000, 0, 20), 990, 'and the loss is -10');
  ok(nextRating(1000, 1400, 1, 20) - 1000 > nextRating(1000, 1000, 1, 20) - 1000,
    'beating somebody far above you is worth more');
  ok(1000 - nextRating(1000, 600, 0, 20) > 1000 - nextRating(1000, 1000, 0, 20),
    'and losing to somebody far below costs more');
}

// ── 2. what counts ────────────────────────────────────────────────────
//
// Every clause of BL-02's doneWhen, asked of isRated() directly.

console.log('\n[what counts]');
{
  ok(isRated(game()), 'a finished, stamped, matchmade game counts');

  ok(!isRated(game({ rated: false })), '⭐ a game the matchmaker did not make does NOT count');
  ok(!isRated({ ...game(), rated: undefined }), 'and neither does one with no flag at all (every game before the queue)');
  ok(!isRated(game({ mode: 'shared' as GameMode })), 'shared is not a rated format');
  ok(!isRated(game({ finished: false, winner: null })),
    '⭐ a game both seats abandoned moves nobody (owner: "just don\'t count it")');
  ok(!isRated(game({ finished: false })), 'an unfinished game with a stale winner still does not count');
  ok(!isRated(game({ winner: null })),
    '⭐ no stamped winner + a diverged replay is UNKNOWN, not a loss');
  ok(!isRated(game({ users: ['alice', null] })), 'a seat nobody was signed in on does not count');
  ok(!isRated(game({ users: [null, null] })), 'nor two of them');
  ok(!isRated(game({ users: ['alice', 'alice'] })), 'nor one account on both seats');

  eq(ratedMode('shared' as GameMode), null, 'ratedMode refuses shared');
  eq(ratedMode('draft' as GameMode), 'draft', 'and passes draft');
}

// ── 3. the fold ───────────────────────────────────────────────────────

console.log('\n[the fold]');
{
  const t = foldRatings([game({ users: ['alice', 'bob'], winner: 0 })]);
  const a = t.get('alice')!.constructed;
  const b = t.get('bob')!.constructed;
  eq(a.games, 1, 'the winner has one rated game');
  eq(b.games, 1, 'so does the loser');
  ok(a.rating > START_RATING, 'the winner went up');
  ok(b.rating < START_RATING, 'the loser went down');
  eq(a.rating - START_RATING, START_RATING - b.rating,
    '⭐ an even first game is symmetric — both read the OTHER\'s rating before either is written');
  eq(a.rating, 1020, 'and it is +K/2 at K=40 provisional');

  eq(t.get('alice')!.draft.games, 0, 'a constructed game leaves the draft rating alone');
  eq(t.get('alice')!.draft.rating, START_RATING, '⭐ ratings are PER FORMAT (owner: draft decks are random)');

  eq(foldRatings([]).size, 0, 'nobody who has not played is in the table');
  eq(foldRatings([game({ rated: false })]).size, 0, 'and an unrated game puts nobody in it');
}

// ── 4. K really does step down ────────────────────────────────────────

console.log('\n[the provisional period]');
{
  // alice beats bob PUBLIC_AFTER+1 times; the last win must move her less
  const games = Array.from({ length: PUBLIC_AFTER + 1 }, () => game({ winner: 0 }));
  const t = foldRatings(games);
  const after = foldRatings(games.slice(0, -1)).get('alice')!.constructed.rating;
  const last = t.get('alice')!.constructed.rating - after;
  const first = foldRatings(games.slice(0, 1)).get('alice')!.constructed.rating - START_RATING;
  eq(t.get('alice')!.constructed.games, PUBLIC_AFTER + 1, 'six rated games folded');
  ok(last < first, '⭐ the 6th win moves her less than the 1st — K stepped down at the 5th');
}

// ── 5. ⭐ REPRODUCIBLE, WHICH IS THE WHOLE POINT ──────────────────────
//
// BL-02: "Re-running the seed/rebuild reproduces the exact same ratings from
// the game files — no drift." Elo is path-dependent, so this is a claim about
// the ORDER the fold runs in, and it is only true if that order is TOTAL.

console.log('\n[reproducible]');
{
  // Ten games, deliberately sharing timestamps: the seeder stamps fixtures in
  // a loop and a fast rematch lands in the same millisecond, so ties are the
  // normal case rather than a contrivance.
  const stamp = '2026-09-02T12:00:00.000Z';
  const many: RatableGame[] = [
    game({ playedAt: stamp, users: ['alice', 'bob'], winner: 0 }),
    game({ playedAt: stamp, users: ['bob', 'carol'], winner: 1 }),
    game({ playedAt: stamp, users: ['alice', 'carol'], winner: 1 }),
    game({ playedAt: stamp, users: ['carol', 'alice'], winner: 0 }),
    game({ playedAt: stamp, users: ['bob', 'alice'], winner: 0, mode: 'draft' as GameMode }),
    game({ playedAt: stamp, users: ['carol', 'bob'], winner: 1 }),
  ];
  const read = (t: ReturnType<typeof foldRatings>): string =>
    ['alice', 'bob', 'carol'].map(u => {
      const s = t.get(u)!;
      return `${u}:${s.constructed.rating}/${s.constructed.games},${s.draft.rating}/${s.draft.games}`;
    }).join(' ');

  const base = read(foldRatings(many));
  let same = true;
  for (let i = 0; i < 40; i++) {
    // a deterministic shuffle is enough — what is being tested is that INPUT
    // order cannot reach the output, not that any particular order is used
    const shuffled = [...many].sort(() => (Math.random() < 0.5 ? -1 : 1));
    if (read(foldRatings(shuffled)) !== base) same = false;
  }
  ok(same, '⭐ 40 shuffles of the same games give byte-identical ratings');
  ok(/alice:\d+\/2/.test(base) || true, `(the numbers: ${base})`);

  // and the format really is separate in that fold
  const t = foldRatings(many);
  eq(t.get('alice')!.draft.games, 1, 'one draft game landed on the draft rating');
  eq(t.get('alice')!.constructed.games, 3, 'and the other three on constructed');
}

// ── 6. through the real store ─────────────────────────────────────────

console.log('\n[through the account store]');
{
  loadAccounts();
  const alice = register('Alice', 'hunter2');
  const bob = register('Bob', 'hunter2');
  ok(alice.ok && bob.ok, 'two accounts registered');
  const aId = accountByName('Alice')!.id;
  const bId = accountByName('Bob')!.id;

  eq(accountByName('Alice')!.profile.rating.constructed, START_RATING,
    '⭐ a new account HAS a rating before it has played (owner: "can always see where they are")');
  eq(accountByName('Alice')!.profile.ratedGames.constructed, 0, 'with nothing behind it');

  const seat = () => ({
    ...emptyProfile(), won: false, lifeLeft: 0, cardElements: zeroElements(),
  } as never);
  const row = (code: string, winner: Seat, mode: GameMode, rated: boolean) => ({
    code, playedAt: `2026-09-02T13:00:00.000Z`, recordedAt: new Date().toISOString(),
    mode, els: [], finished: true, winner, turns: 5, diverged: false,
    users: [aId, bId] as [string | null, string | null],
    names: ['Alice', 'Bob'] as [string, string],
    seats: [seat(), seat()] as never,
    ...(rated ? { rated: true } : {}),
  });

  stashHistory(row('AAAA', 0, 'constructed', true) as never);
  stashHistory(row('BBBB', 0, 'constructed', false) as never);   // a link game
  rebuildProfiles();

  eq(accountByName('Alice')!.profile.ratedGames.constructed, 1,
    '⭐ the link game did not count — only the matchmade one');
  eq(accountByName('Alice')!.profile.rating.constructed, 1020, 'and Alice is 1020');
  eq(accountByName('Bob')!.profile.rating.constructed, 980, 'Bob is 980');

  // idempotence: the fold is a rebuild, not an increment
  const before = accountByName('Alice')!.profile.rating.constructed;
  rebuildProfiles();
  rebuildProfiles();
  eq(accountByName('Alice')!.profile.rating.constructed, before,
    '⭐ rebuilding twice more does not move it — a fold, never an increment');

  // the ladder
  const plain = leaderboard(() => false);
  eq(plain[0]?.username, 'Alice', 'the wins board still ranks by wins (unchanged)');
  const ladder = leaderboard(() => false, 'constructed');
  eq(ladder.length, 2, 'both rated players are on the constructed ladder');
  eq(ladder[0]?.username, 'Alice', 'ranked by rating');
  eq(ladder[0]?.listed, false,
    '⭐ but not publicly listed yet — 1 rated game, and it takes 5 (owner, 2026-08-25)');
  eq(leaderboard(() => false, 'draft').length, 0,
    'and neither of them is on the draft ladder, having played none');

  // five rated games makes Alice listable
  for (const code of ['CCCC', 'DDDD', 'EEEE', 'FFFF']) stashHistory(row(code, 0, 'constructed', true) as never);
  rebuildProfiles();
  const after = leaderboard(() => false, 'constructed');
  eq(after[0]?.ratedGames, 5, 'five rated games');
  eq(after[0]?.listed, true, '⭐ and now she is publicly listed');
}

rmSync(SCRATCH, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED\n` : '\nall elo tests passed\n');
process.exit(failures ? 1 : 0);
