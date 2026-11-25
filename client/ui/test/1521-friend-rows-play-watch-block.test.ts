/* 1521 — A FRIEND ROW YOU CAN ACT FROM.
 *
 * The Players tab's friends were a roster: a dot, a name, a ✕. Now each row
 * says your record against them and what they are playing, Watch opens a
 * playing friend's game, and the name (or Play) opens a card under the row:
 * your games together, Play a live draft / Play constructed, and Block. The
 * post-game screen offers Add friend, and a room made from Play invites the
 * friend once you are in it. The server half is server/test/1520.
 *
 *  §1 a row: the record, the activity line and Watch for a playing friend, Play otherwise
 *  §2 the open card: the record in words, the games together, the two Play buttons, Block asking twice
 *  §3 a request has Block; the Blocked list unblocks; the board offers no Add to a blocked player
 *  §4 the post-game's Add friend follows where the two players stand
 *  §5 a room opened from Play sends the invite once, and stops when the poll shows it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FriendView, LiveFriend, Me, MatchRow, Profile } from '../account.ts';
import type { ProfileState } from '../pages/profile.ts';
import type { GameOver } from '../postgame.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = {};
g['__UI_DRIVER_FETCH'] = () => new Promise(() => {});
await import('./ui-driver.ts');
const { profileHtml, profileView } = await import('../pages/profile.ts');
const { postGameHtml } = await import('../pages/postgame.ts');

const PROFILE = {
  games: 1, wins: 1, losses: 0, unresolved: 0, byMode: { draft: 1 }, cardElements: { fire: 1 }, recycled: {},
  cards: { Ember: 1 }, unitsPlayed: 1, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0,
  resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, turnsPlayed: 5, longestGameTurns: 5, flawlessWins: 0, closeWins: 0, streak: 1,
  bestStreak: 1, rating: {}, ratedGames: {}, firstPlayed: '2026-09-01T00:00:00Z', lastPlayed: '2026-11-01T00:00:00Z',
} satisfies Profile;
const friend = (id: string, username: string, vs = { games: 0, wins: 0, losses: 0 }): FriendView =>
  ({ id, username, online: false, games: 12, wins: 6, favoriteElement: null, lastPlayed: null, vs });
const row = (code: string, opponentId: string, result: 'win' | 'loss'): MatchRow => ({
  code, playedAt: '2026-11-20T00:00:00Z', mode: 'draft', els: ['fire', 'water', 'earth'], turns: 9, deckId: null,
  finished: true, diverged: false, result, opponent: opponentId === 'u2' ? 'Nyar' : 'Someone', opponentId,
  life: [10, 0], unitsPlayed: 3, spellsPlayed: 1, damageDealt: 20, favoriteElement: 'fire',
});
const ME: Me = {
  id: 'u1521', username: 'Quill', createdAt: '2026-09-01T00:00:00Z', favoriteElement: 'fire', profile: PROFILE,
  topCards: [], earned: 0, opponents: [], achievements: [], decks: [],
  history: [row('AAAA', 'u2', 'win'), row('BBBB', 'u9', 'loss'), row('CCCC', 'u2', 'loss')],
  friends: [friend('u2', 'Nyar', { games: 4, wins: 3, losses: 1 }), friend('u3', 'Karanda')],
  incoming: [friend('u4', 'Tomzy')], outgoing: [],
  blocked: [{ id: 'u6', username: 'Pest' }],
};
const LIVE: LiveFriend[] = [{ id: 'u3', status: 'playing', game: { room: 'WXYZ', label: 'Live draft' } }];

function html(over: Partial<ProfileState> = {}): string {
  return profileHtml(profileView({
    me: ME, tab: 'players', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', removing: null,
    pwMsg: null, favMsg: '', claimMsg: '', leaders: null, leadersFailed: false, board: 'constructed', ladder: null,
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false }, artFor: c => c,
    live: LIVE, ...over,
  }));
}
/** one friend's row, from its <li> to the next */
const rowOf = (h: string, name: string): string =>
  h.split('<li class="pffriend').find(r => r.includes(`>${name}</span>`)) ?? '';

test('1521 §1 BL-67: a row says the record, and a playing friend has Watch and what they play', () => {
  const h = html();
  const nyar = rowOf(h, 'Nyar'), karanda = rowOf(h, 'Karanda');
  assert.match(nyar, /class="pfvs"[^>]*>3–1</, 'Nyar: 3–1');
  assert.doesNotMatch(karanda, /pfvs/, 'no record before the first game');
  assert.match(karanda, /pfactivity">in a Live draft</);
  assert.match(karanda, /href="\/\?ws=1&amp;room=WXYZ&amp;watch=1"[^>]*>Watch|href="\/\?ws=1&room=WXYZ&watch=1"[^>]*>Watch/, 'Watch opens the room as a spectator');
  assert.match(karanda, /data-id="u3"[^>]*class="fdot on"|class="fdot on"/, 'a playing friend reads as on the site');
  assert.match(nyar, /data-btn="acct-friend-open"[^>]*data-id="u2"[^>]*>Play</, 'a friend not playing has Play, which opens their card');
  assert.match(nyar, /aria-expanded="false"/);
});

test('1521 §2 the open card: record in words, games together, both Plays, Block asks twice', () => {
  const h = html({ openFriend: 'u2' });
  const card = h.slice(h.indexOf('pffriendcard'));
  assert.match(h, /aria-expanded="true"/);
  assert.match(card, /You are <b>3–1<\/b> against Nyar over 4 games\./);
  assert.match(card, /Nyar has played 12 games here\./);
  assert.equal([...card.slice(0, card.indexOf('</li>')).matchAll(/\?replay=(\w+)/g)].map(m => m[1]).join(','), 'AAAA,CCCC',
    'only the games against Nyar, each with its replay');
  assert.match(card, /data-btn="acct-friend-play"[^>]*data-id="u2"[^>]*data-mode="draft"[^>]*>Play a live draft</);
  assert.match(card, /data-btn="acct-friend-play"[^>]*data-id="u2"[^>]*data-mode="constructed"[^>]*>Play constructed</);
  assert.match(card, /data-btn="acct-friend-block"[^>]*data-id="u2"[^>]*>Block</);
  assert.match(html({ openFriend: 'u2', blocking: 'u2' }), /ui-button--danger[^>]*data-btn="acct-friend-block"[^>]*>Press again to block Nyar</);
  const playing = html({ openFriend: 'u3' });
  assert.match(playing.slice(playing.indexOf('pffriendcard')), />Watch their Live draft</, 'a playing friend\'s card offers Watch, not Play');
});

test('1521 §3 Block on a request, the Blocked list, and no Add for a blocked player', () => {
  const h = html();
  assert.match(rowOf(h, 'Tomzy'), /data-btn="acct-friend-block"[^>]*data-id="u4"/);
  assert.match(h, /<h3>Blocked<\/h3>[\s\S]*Pest[\s\S]*data-btn="acct-friend-unblock"[^>]*data-id="u6"[^>]*>Unblock</);
  const board = html({ board: 'all', leaders: [
    { id: 'u6', username: 'Pest', games: 3, wins: 1, losses: 2, earned: 0, online: false, favoriteElement: null },
    { id: 'u7', username: 'Stranger', games: 3, wins: 1, losses: 2, earned: 0, online: false, favoriteElement: null },
  ] as unknown as ProfileState['leaders'] });
  assert.doesNotMatch(board, /data-name="Pest"/, 'a blocked player gets no Add friend');
  assert.match(board, /data-name="Stranger"/);
});

test('1521 §4 the post-game\'s Add friend follows where the two players stand', () => {
  const seat = (name: string): GameOver['seats'][0] => ({
    name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
    cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
    attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
    unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
  });
  const over = (friend?: GameOver['friend'], extra: Partial<GameOver> = {}): string => postGameHtml({
    over: {
      seat: 0, winner: 0, names: ['Quill', 'Nyar'], mode: 'draft', els: [], turns: 7, seats: [seat('Quill'), seat('Nyar')],
      rematch: [false, false], rematchRoom: null, recorded: true, ...(friend ? { friend } : {}), ...extra,
    },
    modeLabel: 'live draft', elements: null, guest: false, signup: null, matchResult: '',
  });
  assert.doesNotMatch(over(), /pg-befriend|friend request/, 'no friend field (a guest, signed out): nothing offered');
  assert.match(over({ username: 'Nyar', state: 'none' }), /data-btn="pg-befriend"[^>]*>Add Nyar as a friend</);
  assert.match(over({ username: 'Nyar', state: 'theyAsked' }), /data-btn="pg-befriend"[^>]*>Accept Nyar&#39;s friend request<|data-btn="pg-befriend"[^>]*>Accept Nyar's friend request</);
  assert.match(over({ username: 'Nyar', state: 'asked' }), /disabled[^>]*>Friend request sent<|>Friend request sent</);
  assert.doesNotMatch(over({ username: 'Nyar', state: 'friends' }), /pg-befriend|are friends/, 'already friends: nothing');
  assert.match(over({ username: 'Nyar', state: 'friends' }, { friendNow: true }), />You and Nyar are friends</);
  assert.match(over({ username: 'Nyar', state: 'none' }, { friendMsg: 'too many requests' }), /ui-status--error[^>]*>too many requests</);
});

test('1521 §5 a room opened from Play sends its invite once, and stops when the poll shows it', async () => {
  const { installInbox, inviteOnArrival, pollInboxNow } = await import('../inbox.ts');
  const posts: string[] = [];
  let invited: 'sent' | null = null;
  const reply = (body: unknown): Promise<unknown> => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  g['fetch'] = (url: string, init?: { body?: string }) => {
    if (url.startsWith('/api/inbox')) {
      return reply({ ok: true, invites: [], requests: [], friends: [
        { id: 'u2', username: 'Nyar', favoriteElement: null, status: 'online', game: null, invite: invited },
      ] });
    }
    if (url === '/api/invite') { posts.push(init?.body ?? ''); return reply({ ok: true }); }
    return reply({ ok: true, matches: [] });
  };
  installInbox({
    token: () => 'tok', authHeaders: () => ({}), room: () => 'ABCD', quiet: () => false, friendsChanged: () => {},
    tz: () => 'UTC', openLeague: () => {}, playLeague: () => {}, leagueChanged: () => {},
  });
  inviteOnArrival('abcd', 'u2');
  const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  pollInboxNow(); await settle();
  assert.deepEqual(posts.map(b => JSON.parse(b)), [{ to: 'u2', room: 'ABCD' }], 'invited once the panel knows the friend');
  invited = 'sent';
  pollInboxNow(); await settle();
  pollInboxNow(); await settle();
  assert.equal(posts.length, 1, 'the poll shows it sent: no second invite');
});

test('1521 §6 the Players tab sorts on the live presence: on the site first, then most games together, then name', () => {
  const me: Me = { ...ME, friends: [
    friend('u10', 'Zed', { games: 9, wins: 5, losses: 4 }),
    friend('u11', 'Amy', { games: 1, wins: 1, losses: 0 }),
    friend('u12', 'Cy', { games: 5, wins: 2, losses: 3 }),
    friend('u13', 'Bo', { games: 5, wins: 3, losses: 2 }),
    { ...friend('u14', 'Dee'), online: true },
  ] };
  const live: LiveFriend[] = [
    { id: 'u11', status: 'online' }, { id: 'u12', status: 'playing', game: { room: 'QRST', label: 'Constructed' } },
    { id: 'u13', status: 'online' }, { id: 'u10', status: 'offline' },
  ];
  const h = html({ me, live });
  const friendsPart = h.slice(h.indexOf('<h3>Friends</h3>'), h.indexOf('<h3>Blocked</h3>'));
  const order = [...friendsPart.matchAll(/<span class="pfopp">(\w+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(order, ['Bo', 'Cy', 'Amy', 'Dee', 'Zed'],
    'Dee is on the site by the profile\'s own flag (no live row); Zed, the best friend, is offline');
});
