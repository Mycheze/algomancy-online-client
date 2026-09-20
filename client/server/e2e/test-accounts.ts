/* Tests for the accounts system (run: node test-accounts.ts).
 *
 * Two halves, same harness style as the other server tests — real code, real
 * server, no framework:
 *
 *   1. In-process: the stat fold, the achievement table, the friend graph,
 *      passwords, and the "register under a name and claim the games you
 *      already played" path.
 *   2. Integration: spawn the real server against a throwaway accounts file
 *      and a throwaway games directory, then register / log in / join a room
 *      over a websocket and check the seat really is bound to the account.
 *
 * Everything runs against ALGO_ACCOUNTS_FILE / ALGO_GAMES_DIR temp paths: the
 * real store holds password hashes and must never be a test fixture.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-accounts-test-'));
const STORE = join(SCRATCH, 'accounts.json');
const GAMES = join(SCRATCH, 'games');
// the in-process half must load the module with the override already set
process.env['ALGO_ACCOUNTS_FILE'] = STORE;
process.env['ALGO_GAMES_DIR'] = GAMES;

const {
  accountByName, acceptFriend, accountForToken, allAccounts, changePassword,
  gameHistory, leaderboard, loadAccounts, login, privateView, publicView,
  register, removeFriend, requestFriend, saveAccounts, stashHistory,
  emptyProfile, recordGame,
} = await import('../accounts.ts');
const { evaluateAchievements, ACHIEVEMENTS, GROUPS } = await import('../achievements.ts');
const { summarizeGame } = await import('../stats.ts');
const { syncGamesDir } = await import('../history.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const NEVER_ONLINE = (): boolean => false;

// ── 1. passwords and sessions ─────────────────────────────────────────

console.log('\n[passwords]');
loadAccounts();
{
  const bad = register('x', 'longenough');
  ok(!bad.ok && /2 characters/.test(bad.ok ? '' : bad.error), 'a one-character username is refused');
  const short = register('Tester', 'abc');
  ok(!short.ok && /6 characters/.test(short.ok ? '' : short.error), 'a short password is refused');
  const weird = register('drop table', 'longenough');
  ok(weird.ok, 'a normal username with a space is fine');

  const made = register('Ben', 'correct horse');
  ok(made.ok, 'registering works');
  if (!made.ok) throw new Error('cannot continue');
  const dup = register('BEN', 'other password');
  ok(!dup.ok, 'usernames are unique case-insensitively');

  ok(!login('Ben', 'wrong').ok, 'the wrong password does not log in');
  const good = login('ben', 'correct horse');
  ok(good.ok, 'login is case-insensitive on the username');

  const raw = readFileSync(STORE, 'utf8');
  ok(!raw.includes('correct horse'), 'the password never reaches the file');
  ok(/"hash":\s?"[0-9a-f]{128}"/.test(raw), 'a scrypt hash is what is stored');

  ok(!!accountForToken(made.token), 'a token resolves to its account');
  ok(!accountForToken('nonsense'), 'a made-up token resolves to nobody');

  const me = accountByName('Ben')!;
  ok(!changePassword(me, 'nope', 'brand new one').ok, 'changing a password needs the old one');
  ok(changePassword(me, 'correct horse', 'brand new one').ok, 'changing a password works');
  ok(login('Ben', 'brand new one').ok, 'the new password logs in');
}

// ── 2. friends ────────────────────────────────────────────────────────

console.log('\n[friends]');
{
  register('Rashi', 'password!');
  const ben = accountByName('Ben')!, rashi = accountByName('Rashi')!;
  ok(!requestFriend(ben, 'nobody').ok, 'befriending a stranger fails politely');
  ok(!requestFriend(ben, 'Ben').ok, 'you cannot befriend yourself');
  ok(requestFriend(ben, 'Rashi').ok, 'a request is sent');
  eq(rashi.incoming.length, 1, 'it lands in the other side\'s inbox');
  ok(!requestFriend(ben, 'Rashi').ok, 'asking twice is refused');

  // both hitting "add friend" must end up friends, not deadlocked
  const crossed = requestFriend(rashi, 'Ben');
  ok(crossed.ok && crossed.friends, 'a crossed request accepts instead of deadlocking');
  ok(ben.friends.includes(rashi.id) && rashi.friends.includes(ben.id), 'friendship is mutual');
  eq(ben.outgoing.length, 0, 'the pending request was cleared');

  ok(removeFriend(ben, rashi.id).ok, 'unfriending works');
  ok(!ben.friends.length && !rashi.friends.length, 'and it is mutual too');
  requestFriend(ben, 'Rashi');
  ok(acceptFriend(rashi, ben.id).ok, 'a request can be accepted the normal way');
  ok(ben.friends.length === 1 && rashi.friends.length === 1, 'friends again');
  ok(!acceptFriend(rashi, ben.id).ok, 'accepting twice is refused');
}

// ── 3. summarizing a real game ────────────────────────────────────────

console.log('\n[stats: a played game]');
{
  // a real saved room from the playtests, trimmed to its config: replaying it
  // is the whole point, so the fixture is a seed + an action log
  const rec = {
    code: 'TEST',
    seed: 12345,
    // 'shared' rather than 'draft': recycling is legal from the first action,
    // where a draft game insists you commit a pack first
    mode: 'shared' as const,
    els: ['fire', 'water', 'earth'] as const,
    names: ['Ben', 'Rashi'] as [string, string],
    actions: [
      { type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' },
      { type: 'recycleForResource', seat: 1, handIndex: 0, element: 'water' },
    ] as never,
  };
  const s = summarizeGame(rec as never);
  eq(s.seats[0].recycled.fire, 1, 'a recycle is counted under the element chosen');
  eq(s.seats[1].recycled.water, 1, 'and for the other seat too');
  eq(s.finished, false, 'a game with no winner and no stamp has no known result');
  eq(s.seats[0].won, null, 'and neither seat won it');
  eq(s.skipped, 0, 'a clean replay skips nothing');

  // the fix for "we finished every game and it says five are unfinished": a
  // result recorded at the time beats whatever the replay can reach
  const stamped = summarizeGame({ ...rec, winner: 0 } as never);
  eq(stamped.finished, true, 'a stamped winner makes the game resolved');
  eq(stamped.winner, 0, 'and names the seat that won');
  eq(stamped.seats[0].won, true, 'the stamped winner won');
  eq(stamped.seats[1].won, false, 'and the other seat lost');
  ok(s.seats[0].lifeLeft > 0, 'life is read off the end state');

  // an action the engine would reject must not kill the whole summary — and
  // must not be counted either, or a log replayed onto a newer engine credits
  // people for moves the rules no longer allow
  const broken = summarizeGame({ ...rec, actions: [
    { type: 'playCard', seat: 0, handIndex: 99 },
    { type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' },
  ] } as never);
  eq(broken.seats[0].recycled.fire, 1, 'the legal action after a rejected one still counts');
  eq(broken.seats[0].unitsPlayed, 0, 'the rejected action is not counted');
  eq(broken.seats[0].spellsPlayed, 0, 'not as a spell either');
  eq(broken.skipped, 1, 'and the divergence is reported, so the numbers can be labelled partial');
}

// ── 4. folding games into profiles ────────────────────────────────────

console.log('\n[profiles: the fold]');
{
  const ben = accountByName('Ben')!, rashi = accountByName('Rashi')!;
  const seat = (name: string, won: boolean | null, over: Record<string, unknown> = {}): unknown => ({
    name, won, cards: { 'Ignis Sprite': 2 }, unitsPlayed: 2, spellsPlayed: 1, tokensCast: 0,
    modsApplied: 0, cardElements: { fire: 2, water: 0, earth: 0, wood: 0, metal: 0, light: 0, dark: 0 },
    recycled: { fire: 1, water: 0, earth: 0, wood: 0, metal: 0, light: 0, dark: 0 },
    resourcesActivated: 3, abilitiesActivated: 0, attacksDeclared: 1, unitsAttackedWith: 2,
    damageDealt: 5, lifeLost: 0, unitsLost: 0, unitsKilled: 1, cardsDrafted: 4, lifeLeft: 30,
    ...over,
  });
  const game = (code: string, day: number, winner: 0 | 1): unknown => ({
    code, playedAt: `2026-08-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    recordedAt: new Date().toISOString(), mode: 'draft', els: ['fire', 'water', 'earth'],
    finished: true, winner, turns: 6, diverged: false,
    users: [ben.id, rashi.id], names: ['Ben', 'Rashi'],
    seats: [seat('Ben', winner === 0, winner === 0 ? {} : { lifeLost: 30, lifeLeft: 0 }),
      seat('Rashi', winner === 1, winner === 1 ? {} : { lifeLost: 30, lifeLeft: 0 })],
  });
  for (const g of [game('AAAA', 1, 0), game('BBBB', 2, 0), game('CCCC', 3, 0), game('DDDD', 4, 1)]) {
    stashHistory(g as never);
  }
  const { rebuildProfiles } = await import('../accounts.ts');
  rebuildProfiles();

  eq(ben.profile.games, 4, 'every game is counted');
  eq(ben.profile.wins, 3, 'wins');
  eq(ben.profile.losses, 1, 'losses');
  eq(ben.profile.bestStreak, 3, 'the best streak spans the three consecutive wins');
  eq(ben.profile.streak, 0, 'and the current streak was broken by the loss');
  eq(rashi.profile.wins, 1, 'the other side got the mirrored result');
  eq(ben.profile.unitsPlayed, 8, 'per-game counters add up');
  eq(ben.profile.cardsDrafted, 16, 'so do drafted cards');
  eq(ben.profile.cards['Ignis Sprite'], 8, 'and the per-card tally');
  eq(ben.profile.flawlessWins, 3, 'winning without losing life is a flawless win');
  eq(ben.profile.opponents[rashi.id]?.games, 4, 'head-to-head is recorded');
  eq(ben.profile.opponents[rashi.id]?.wins, 3, 'with the right record');
  eq(ben.profile.firstPlayed, '2026-08-01T12:00:00.000Z', 'first played is the oldest game');
  eq(ben.profile.lastPlayed, '2026-08-04T12:00:00.000Z', 'last played is the newest');

  // the property the whole design leans on
  const before = JSON.stringify(ben.profile);
  rebuildProfiles();
  eq(JSON.stringify(ben.profile), before, 'rebuilding twice changes nothing (idempotent)');
  stashHistory(game('AAAA', 1, 0) as never);
  rebuildProfiles();
  eq(ben.profile.games, 4, 're-stashing a game already in the record does not double it');

  eq(publicView(ben).favoriteElement, 'fire', 'favorite element is the argmax of cards played');
  eq(privateView(ben, NEVER_ONLINE).history.length, 4, 'the match history lists the games');
  // DDDD is the newest game and Rashi won it
  eq(privateView(ben, NEVER_ONLINE).history[0]?.code, 'DDDD', 'the history is newest first');
  eq(privateView(ben, NEVER_ONLINE).history[0]?.result, 'loss', 'read from your own point of view');
  eq(privateView(rashi, NEVER_ONLINE).history[0]?.result, 'win', 'and mirrored for the other player');
  eq(leaderboard(NEVER_ONLINE)[0]?.username, 'Ben', 'the leaderboard ranks by wins');
}

// ── 5. achievements ───────────────────────────────────────────────────

console.log('\n[achievements]');
{
  const ben = accountByName('Ben')!;
  const states = evaluateAchievements(ben.profile, ben);
  const by = (id: string): (typeof states)[number] => states.find(s => s.id === id)!;
  ok(by('first-game').earned, 'First Cast is earned after one game');
  ok(by('first-win').earned, 'Victory is earned after one win');
  ok(by('streak-3').earned, 'On a Roll needs three in a row and got them');
  ok(!by('streak-5').earned, 'Unstoppable still wants five');
  eq(by('regular').have, 4, 'progress is reported for the unearned ones');
  eq(by('regular').need, 10, 'with the goal alongside it');
  ok(by('flawless').earned, 'Untouched came from the flawless wins');
  ok(by('good-company').earned, 'Good Company came from the friend graph, not the profile');
  ok(!by('elementalist').earned, 'Elementalist needs all seven elements');
  eq(by('elementalist').have, 3, 'and counts the three it has');
  ok(Object.keys(ben.achievements).length > 0, 'unlocks were stamped with a date');

  // sticky: a goal that moves out of reach must not revoke a badge
  ben.achievements['veteran'] = new Date().toISOString();
  ok(evaluateAchievements(ben.profile, ben).find(s => s.id === 'veteran')!.earned,
    'an already-stamped achievement stays earned even below its goal');

  // every row carries the two fields the grid lays itself out with
  ok(states.every(s => typeof s.group === 'string' && s.group.length > 0),
    'every achievement names a group');
  ok(states.every(s => (GROUPS as readonly string[]).includes(s.group)),
    'and every group is one the client knows how to order');
  eq(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length,
    'achievement ids are unique — a duplicate would share an unlock stamp');
  eq(new Set(ACHIEVEMENTS.map(a => a.name)).size, ACHIEVEMENTS.length,
    'and so are the names');
  // the grid is scanned by icon before it is read by name, so two badges
  // wearing the same emoji are two badges nobody can tell apart at a glance
  eq(new Set(ACHIEVEMENTS.map(a => a.icon)).size, ACHIEVEMENTS.length,
    'every achievement has its own icon');

  // a ladder has to be a real ladder or the UI collapses unrelated rows onto
  // one card: same counter, rising goals, contiguous rungs from 1
  const ladders = new Map<string, typeof ACHIEVEMENTS>();
  for (const a of ACHIEVEMENTS.filter(a => a.tier)) {
    const got = ladders.get(a.tier!.of);
    if (got) got.push(a); else ladders.set(a.tier!.of, [a]);
  }
  ok(ladders.size > 0, 'there are ladders to check');
  for (const [name, rungs] of ladders) {
    rungs.sort((x, y) => x.tier!.rung - y.tier!.rung);
    eq(rungs.map(r => r.tier!.rung).join(','), rungs.map((_r, i) => i + 1).join(','),
      `${name}: rungs are numbered 1..n with no gaps or ties`);
    for (let i = 1; i < rungs.length; i++) {
      ok(rungs[i]!.goal > rungs[i - 1]!.goal,
        `${name}: rung ${i + 1} asks for more than rung ${i}`);
    }
    // the client groups FIRST and collapses within a group, so a ladder whose
    // rungs sit in different sections would render as two half-ladders
    eq(new Set(rungs.map(r => r.group)).size, 1,
      `${name}: every rung is in the same group`);
  }
}

// ── 5b. secrets stay secret ───────────────────────────────────────────

console.log('\n[achievements: secrets]');
{
  const ben = accountByName('Ben')!;
  const secrets = ACHIEVEMENTS.filter(a => a.secret);
  ok(secrets.length > 0, 'there are secret achievements to hide');

  // a fresh account has earned none of them, so all of them must be redacted
  const blank = { ...ben, achievements: {} as Record<string, string> };
  const states = evaluateAchievements(emptyProfile(), blank);
  for (const s of secrets) {
    const st = states.find(x => x.id === s.id)!;
    ok(!st.earned, `${s.id} is not earned on an empty profile`);
    ok(st.hidden, `${s.id} is marked hidden`);
    ok(!st.name.includes(s.name) && !st.desc.includes(s.desc),
      `${s.id} leaks neither its name nor its description`);
    eq(st.have, 0, `${s.id} does not leak progress either`);
  }

  // …and stops being redacted the moment it is earned, or the player can
  // never find out what they just did
  const stamped = { ...ben, achievements: Object.fromEntries(
    secrets.map(s => [s.id, new Date().toISOString()])) };
  const shown = evaluateAchievements(emptyProfile(), stamped);
  for (const s of secrets) {
    const st = shown.find(x => x.id === s.id)!;
    ok(st.earned && !st.hidden, `${s.id} is revealed once earned`);
    eq(st.name, s.name, `${s.id} shows its real name once earned`);
  }
}

// ── 5c. the per-game highlights (BL-31) ───────────────────────────────

console.log('\n[achievements: one-game feats]');
{
  // A REAL game, not a hand-written fixture: fuzzGame plays random legal
  // actions on the current engine, so its log replays with nothing skipped
  // and actually reaches combat. The saved games in server/games/ cannot do
  // this job — they were recorded on older rules and diverge within ~15
  // actions, which is the whole reason `diverged` exists.
  const { fuzzGame } = await import('../../engine/test/fuzz.ts');
  const f = fuzzGame(3, 3000);
  const s = summarizeGame({
    code: 'FUZZ', seed: 3, mode: 'shared',
    names: ['Ben', 'Rashi'] as [string, string], actions: f.actions,
  } as never);

  eq(s.skipped, 0, 'a log played on this engine replays clean');
  ok(s.turns > 3, 'and the game actually ran');

  const both = [s.seats[0], s.seats[1]];
  ok(both.some(x => x.mostUnitsInPlay > 0), 'somebody had a unit in play');
  ok(both.some(x => x.biggestUnit > 0), 'and effStats could size it');
  ok(both.some(x => x.combatDamageDealt > 0), 'combat damage is attributed to a dealer');
  ok(both.some(x => x.bestCombatDamage > 0), 'and bucketed per combat');
  ok(both.every(x => x.bestCombatDamage <= x.combatDamageDealt + x.damageDealt),
    'one combat is never more than everything that seat ever dealt');
  ok(both.every(x => x.mostCardsInHand > 0), 'both players held an opening hand');
  ok(both.every(x => Number.isFinite(x.lowestLife)),
    'lowest life is a real number, never the Infinity it starts as');
  ok(both.every(x => x.lowestLife <= 30), 'and never above the starting life');
  // an overkill lethal hit takes a player PAST zero, so this is signed — the
  // minimum is a real low-water mark, not a clamped one
  ok(both.some(x => x.lowestLife < 30), 'somebody was actually damaged');
  ok(both.every(x => x.lowestLife <= x.lifeLeft || x.lifeLeft < x.lowestLife === false),
    'the low-water mark is never above where the seat finished');
  ok(both.every(x => x.deckLeft > 0), 'the shared deck is read through deckOf, not state.decks');
  ok(both.every(x => x.mostResources >= x.resourcesLeft),
    'the peak resource count is at least the final one');

  /**
   * ⚠ SELF-DAMAGE MUST NOT COUNT. R38 rot emits a `damage` event whose
   * `controller` is its own VICTIM (engine.ts's rot step), and so do cards
   * that hurt their own side. Without a guard, "deal 30 damage with a single
   * non-combat effect" is earnable by standing still and letting your own
   * rot counters kill you.
   *
   * The seed below actually rolls rot — checked, not assumed — so this replays it and
   * computes the answer independently: the largest effect total this seat
   * aimed at something that was not its own. summarizeGame has to agree.
   */
  {
    const { createGame, apply: applyOne, IllegalAction: Illegal } =
      await import('../../engine/src/apply.ts');
    // The first seed whose fuzz game really contains self-inflicted damage —
    // FOUND, not fixed: it was seed 2 until R299's Shard option (2026-09-19)
    // shifted every fuzz walk and seed 2 stopped rolling rot.
    const replay = (seed: number) => {
      const rf = fuzzGame(seed, 3000);
      let st = createGame(seed, undefined, 'shared').state;
      const owners = new Map<number, number>();
      const want: [number, number] = [0, 0];
      let selfHits = 0;
      const selfBest: [number, number] = [0, 0];
      for (const a of rf.actions) {
        for (const e of Object.values(st.entities)) if (e) owners.set(e.id, e.controller);
        let out;
        try { out = applyOne(st, a); } catch (err) { if (err instanceof Illegal) continue; throw err; }
        for (const ev of out.events) {
          const d = (ev.data ?? {}) as Record<string, number>;
          if (ev.type !== 'damage' || typeof d['controller'] !== 'number') continue;
          const by = d['controller']!;
          const victim = typeof d['player'] === 'number' ? d['player']
            : typeof d['unit'] === 'number' ? owners.get(d['unit']!) : undefined;
          const total = typeof d['total'] === 'number' ? d['total']! : d['n']!;
          if (victim === by) {
            selfHits++;
            if (by <= 1 && total > selfBest[by as 0 | 1]) selfBest[by as 0 | 1] = total;
            continue;
          }
          if (by <= 1 && total > want[by as 0 | 1]) want[by as 0 | 1] = total;
        }
        for (const e of Object.values(out.state.entities)) if (e) owners.set(e.id, e.controller);
        st = out.state;
      }
      // it only tests anything if counting the self-hit would CHANGE a seat's answer
      const decisive = ([0, 1] as const).some(i => selfBest[i] > want[i]);
      return { rf, want, selfHits, decisive };
    };
    let rotSeed = 0;
    let found: ReturnType<typeof replay> | null = null;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const r = replay(seed);
      if (r.selfHits > 0 && r.decisive) { rotSeed = seed; found = r; }
    }
    ok(found !== null,
      'some seed in 1–40 contains self-inflicted damage BIGGER than that seat\'s best real hit — '
      + 'so counting it would change the answer, and ignoring it is really tested');
    const { rf, want } = found ?? replay(2);
    const rs = summarizeGame({ code: 'ROT', seed: rotSeed, mode: 'shared',
      names: ['A', 'B'] as [string, string], actions: rf.actions } as never);
    eq(rs.seats[0].bestSingleHit, want[0], 'seat 0\'s best single hit ignores what it did to itself');
    eq(rs.seats[1].bestSingleHit, want[1], 'and so does seat 1\'s');
  }

  // …and the fold turns those per-game peaks into career maxima. Goes
  // through recordGame, not a private helper, so this exercises the path the
  // server actually uses.
  register('Feats', 'password!');
  const feats = accountByName('Feats')!;
  recordGame({ ...s, code: 'FUZZ-A', winner: 0, finished: true,
    seats: [{ ...s.seats[0], name: 'Feats', won: true },
      { ...s.seats[1], won: false }] } as never, [feats.id, null]);
  eq(feats.profile.biggestUnit, s.seats[0].biggestUnit, 'the fold keeps the per-game max');
  eq(feats.profile.bestUnitsKilled, s.seats[0].unitsKilled, 'a per-game total becomes a career max');
  ok(feats.profile.bestElementsInAWin >= 1, 'a win records how many elements it was won with');
  ok(feats.profile.mostCardsInHand > 0, 'and the peak hand size survives the fold');

  // ⚠ THE FALSE POSITIVE this whole shape exists to avoid. A history row
  // written before these counters existed has none of the fields, and reading
  // `undefined` as 0 would award every "low is what qualifies" badge at once —
  // an empty deck, no combat damage, three resources, five life — to every
  // game ever recorded.
  const stripped = (x: (typeof s.seats)[number]): unknown => {
    const c = { ...x } as Record<string, unknown>;
    for (const k of ['combatDamageDealt', 'resourcesLeft', 'deckLeft', 'lowestLife',
      'bestGraftParts', 'bestSingleHit', 'bestCombatDamage', 'biggestUnit',
      'mostUnitsInPlay', 'mostResources', 'mostCardsInHand', 'bestSameSpell']) delete c[k];
    return c;
  };
  register('Oldie', 'password!');
  const oldie = accountByName('Oldie')!;
  recordGame({ ...s, code: 'FUZZ-OLD', winner: 0, finished: true,
    seats: [{ ...(stripped(s.seats[0]) as object), name: 'Oldie', won: true },
      { ...(stripped(s.seats[1]) as object), won: false }] } as never, [oldie.id, null]);
  eq(oldie.profile.deckedWins, 0, 'a pre-counter game does not win "0 cards in your deck" for free');
  eq(oldie.profile.pacifistWins, 0, 'nor "no combat damage"');
  eq(oldie.profile.asceticWins, 0, 'nor "3 or fewer resources"');
  eq(oldie.profile.comebackWins, 0, 'nor "down to 5 life"');
  ok(Number.isFinite(oldie.profile.biggestUnit), 'and a missing max does not become NaN');
}

// ── 6. seeding real saved games + claiming by name ────────────────────

console.log('\n[seeding: import saved games, claim by name]');
{
  // a saved room in exactly the shape rooms.ts writes
  writeFileSync(join(SCRATCH, 'store-before.json'), readFileSync(STORE));
  rmSync(STORE, { force: true });
  loadAccounts();
  eq(allAccounts().length, 0, 'starting from an empty store');

  const { mkdirSync } = await import('node:fs');
  mkdirSync(GAMES, { recursive: true });
  // long enough to read as a real game rather than a room somebody opened and
  // left (stats.ts MIN_GAME_ACTIONS)
  const recycles = (seat: 0 | 1, element: string, n: number): unknown[] =>
    Array.from({ length: n }, () => ({ type: 'recycleForResource', seat, handIndex: 0, element }));
  writeFileSync(join(GAMES, 'WXYZ.json'), JSON.stringify({
    seed: 4242, mode: 'shared', els: ['fire', 'water', 'earth'],
    names: ['Ben', 'Rashi'],
    actions: [...recycles(0, 'fire', 5), ...recycles(1, 'water', 5)],
  }));
  // a room somebody opened and left is not a game
  writeFileSync(join(GAMES, 'EMTY.json'), JSON.stringify({ seed: 1, names: ['Ben', 'Rashi'], actions: [] }));
  writeFileSync(join(GAMES, 'STUB.json'), JSON.stringify({
    seed: 2, mode: 'shared', names: ['Ben', 'Rashi'],
    actions: [{ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }],
  }));

  const report = syncGamesDir(GAMES);
  eq(report.added, 1, 'the played game was imported');
  eq(report.skipped, 2, 'the empty room and the barely-touched one were both skipped');
  eq(gameHistory()[0]?.users[0], null, 'nobody owns the seats yet');
  eq(gameHistory()[0]?.finished, false, 'nobody won it and nobody stamped a result');

  // stamping the result (seed-accounts --result, and what rooms.ts now writes
  // at game over) is authoritative over the replay
  writeFileSync(join(GAMES, 'WXYZ.json'), JSON.stringify({
    seed: 4242, mode: 'shared', els: ['fire', 'water', 'earth'],
    names: ['Ben', 'Rashi'], winner: 0,
    actions: [...recycles(0, 'fire', 5), ...recycles(1, 'water', 5)],
  }));
  syncGamesDir(GAMES, { force: true });
  eq(gameHistory()[0]?.finished, true, 'a stamped winner resolves the game');
  eq(gameHistory()[0]?.winner, 0, 'and names the winning seat');

  const made = register('Ben', 'a good password');
  ok(made.ok, 'Ben signs up');
  const ben = accountByName('Ben')!;
  eq(ben.profile.games, 1, 'and immediately owns the game he played under that name');
  eq(gameHistory()[0]?.users[0], ben.id, 'the history row now names the account');
  eq(gameHistory()[0]?.users[1], null, 'the seat nobody has claimed is still free');

  register('Rashi', 'a good password');
  const rashi = accountByName('Rashi')!;
  eq(rashi.profile.games, 1, 'Rashi claims the other seat on signup');
  // claiming rebuilds every profile from the whole history, so Ben's
  // head-to-head picks up an opponent who registered after him
  eq(ben.profile.opponents[rashi.id]?.games, 1,
    'a claim rebuilds, so an earlier account learns about a later one');

  // re-syncing an unchanged directory must be a no-op
  const again = syncGamesDir(GAMES);
  eq(again.added, 0, 'a second sync adds nothing');
  eq(again.updated, 0, 'and updates nothing (unchanged files are skipped)');
  eq(ben.profile.games, 1, 'so the stats did not double');

  const forced = syncGamesDir(GAMES, { force: true });
  eq(forced.updated, 1, '--force re-summarizes');
  eq(ben.profile.games, 1, 'and still does not double the stats');

  // the live path a finished game takes (main.ts calls this on game over):
  // same summarize-stash-rebuild as the directory sync, from the room object
  const { recordLiveGame } = await import('../history.ts');
  const live = recordLiveGame({
    code: 'LIVE', seed: 777, mode: 'shared', els: ['fire', 'water', 'earth'],
    names: ['Ben', 'Rashi'], users: [ben.id, accountByName('Rashi')!.id],
    actions: [{ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }] as never,
    decks: undefined,
  });
  ok(live.isNew, 'a live game is recorded straight from the room');
  eq(ben.profile.games, 2, 'and lands in the profile immediately');
  const liveAgain = recordLiveGame({
    code: 'LIVE', seed: 777, mode: 'shared', els: ['fire', 'water', 'earth'],
    names: ['Ben', 'Rashi'], users: [ben.id, accountByName('Rashi')!.id],
    actions: [{ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }] as never,
    decks: undefined,
  });
  ok(!liveAgain.isNew, 'recording the same game twice replaces the row');
  eq(ben.profile.games, 2, 'and does not double-count it — undo/re-finish is safe');

  saveAccounts();
}

// ── 7. the live server: a seat bound to an account ────────────────────

console.log('\n[server: joining while logged in]');
// R204/CT-85: the server picks its own port and tells us which — see
// test-util.ts. It used to be `freePort()` then PORT=<number>, which left the
// port unheld for as long as node took to boot.
const server = await spawnServer({ ALGO_ACCOUNTS_FILE: STORE, ALGO_GAMES_DIR: GAMES });
const PORT = server.port;

const base = `http://localhost:${PORT}`;
const post = async (path: string, body: unknown, token?: string): Promise<Record<string, any>> => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, any>;
};

try {
  const bad = await post('/api/auth/login', { username: 'Ben', password: 'nope' });
  ok(!bad['ok'], 'the HTTP login refuses a wrong password');
  const good = await post('/api/auth/login', { username: 'Ben', password: 'a good password' });
  ok(good['ok'] && typeof good['token'] === 'string', 'and accepts the right one');
  const token = good['token'] as string;
  // the imported saved game + the live-recorded one from the section above
  eq(good['me'].profile.games, 2, 'the login response carries the profile');
  eq(good['me'].achievements.find((a: any) => a.id === 'first-game')?.earned, true,
    'and the achievement states');

  const unauth = await fetch(`${base}/api/me`);
  eq(unauth.status, 401, '/api/me without a token is 401');
  const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json() as any;
  ok(me.ok, '/api/me with a token works');

  const players = await (await fetch(`${base}/api/players`)).json() as any;
  eq(players.players.length, 2, 'the leaderboard lists both accounts');

  // the actual point: a websocket join carrying the token binds the seat
  const room = (await (await fetch(`${base}/api/new`)).json() as { code: string }).code;
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise<void>(res => ws.addEventListener('open', () => res(), { once: true }));
  const seen: any[] = [];
  ws.addEventListener('message', ev => seen.push(JSON.parse(String((ev as MessageEvent).data))));
  ws.send(JSON.stringify({ t: 'join', room, seat: 0, name: 'not-my-name', token, mode: 'shared' }));
  await new Promise(res => setTimeout(res, 700));
  const joined = seen.find(m => m.t === 'joined');
  ok(!!joined, 'the join succeeded');
  eq(joined?.view?.players?.[0]?.name, 'Ben',
    'the ACCOUNT name wins over the typed name — stats are filed under it');
  ok(seen.some(m => m.t === 'me' && m.me?.username === 'Ben'),
    'the profile is pushed along with the join');

  const saved = JSON.parse(readFileSync(join(GAMES, `${room}.json`), 'utf8')) as { users: (string | null)[] };
  eq(saved.users[0], accountByName('Ben')!.id, 'the saved room records which account sat in seat 0');
  eq(saved.users[1], null, 'and leaves the empty seat unowned');

  // a friend request over HTTP, end to end
  const asked = await post('/api/friends/request', { username: 'Rashi' }, token);
  ok(asked['ok'], 'a friend request goes through the API');
  eq(asked['me'].outgoing.length, 1, 'and comes back in the refreshed profile');
  ws.close();
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
