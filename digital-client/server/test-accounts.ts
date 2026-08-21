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
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
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
} = await import('./accounts.ts');
const { evaluateAchievements } = await import('./achievements.ts');
const { summarizeGame } = await import('./stats.ts');
const { syncGamesDir } = await import('./history.ts');

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
  const { rebuildProfiles } = await import('./accounts.ts');
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
  const { recordLiveGame } = await import('./history.ts');
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
const PORT = 8900 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [join(HERE, 'main.ts')], {
  env: { ...process.env, PORT: String(PORT), ALGO_ACCOUNTS_FILE: STORE, ALGO_GAMES_DIR: GAMES },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((res, rej) => {
  server.stdout.on('data', (d: Buffer) => { if (String(d).includes('Algomancy server')) res(); });
  server.on('exit', () => rej(new Error('server died on startup')));
  setTimeout(() => rej(new Error('server startup timeout')), 15000);
});

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
  server.kill();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
