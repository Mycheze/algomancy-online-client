/* 976 — THE PROFILE, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The profile's markup left ui/account.ts for ui/pages/profile.ts: account.ts
 * keeps the state and hands it to profileView(); profileHtml(view) draws it.
 * This file drives profileHtml with made-up views and no DOM at all.
 *
 * §1 every tab draws, and the current one is the one that is on
 * §2 the header: name, chips, the buttons the server's flags allow, Return to Lobby
 * §3 every data-btn the account handler routes on is drawn
 * §4 the friends tab's "Everyone here": loading, the board, and a failed load
 *    that SAYS it failed (it used to draw an empty table) with a way to ask again
 * §5 text off the server is escaped (a username, a friend message, a deck name)
 * §6 profileView: the link code only while it is live, the covers through artFor
 * §7 account.ts marks a failed load of that board, rather than emptying it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_TABS, profileHtml, profileView, type ProfileState, type ProfileView } from '../pages/profile.ts';
import type { LeaderRow, Me, Profile } from '../account.ts';

const PROFILE = {
  games: 12, wins: 7, losses: 5, unresolved: 0, byMode: { draft: 8, constructed: 4 }, cardElements: { fire: 3, water: 1 },
  recycled: {}, cards: { Ember: 4 }, unitsPlayed: 30, spellsPlayed: 9, tokensCast: 1, modsApplied: 2, cardsDrafted: 90,
  resourcesActivated: 40, abilitiesActivated: 6, attacksDeclared: 20, unitsAttackedWith: 33, damageDealt: 80, lifeLost: 60,
  unitsLost: 14, unitsKilled: 17, turnsPlayed: 110, longestGameTurns: 14, flawlessWins: 0, closeWins: 2, streak: 3,
  bestStreak: 4, rating: { constructed: 1012 }, ratedGames: { constructed: 3 }, firstPlayed: '2026-09-01T00:00:00Z',
  lastPlayed: '2026-11-01T00:00:00Z',
} satisfies Profile;

const ME: Me = {
  id: 'u1', username: 'Quill <on>', createdAt: '2026-09-01T00:00:00Z', favoriteElement: 'fire', profile: PROFILE,
  topCards: [{ card: 'Ember', n: 4 }], earned: 1,
  opponents: [{ id: 'u2', username: 'Nyar', games: 3, wins: 2, losses: 1 }],
  achievements: [{ id: 'a', name: 'First win', desc: 'Win a game.', icon: '🏆', have: 1, need: 1, earned: true, group: 'Winning' }],
  friends: [{ id: 'u2', username: 'Nyar', online: true, games: 3, wins: 1, favoriteElement: null, lastPlayed: null }],
  incoming: [{ id: 'u3', username: 'Bo', online: false, games: 0, wins: 0, favoriteElement: null, lastPlayed: null }],
  outgoing: [],
  history: [{ code: 'QXZK', playedAt: '2026-11-01T10:00:00Z', mode: 'draft', els: ['fire'], turns: 8, deckId: null,
    finished: true, diverged: false, result: 'win', opponent: 'Nyar', opponentId: 'u2', life: [5, 0], unitsPlayed: 4,
    spellsPlayed: 1, damageDealt: 20, favoriteElement: 'fire' }],
  decks: [{ id: 'd1', name: 'Ember <Rush>', cards: Array(30).fill('Ember'), cover: 'Ember', record: { games: 2, wins: 1, losses: 1 } } as never],
  badge: { judge: 2, since: '2026-10-01' }, admin: true,
};

const LEADER: LeaderRow = { id: 'u2', username: 'Nyar', online: true, games: 3, wins: 2, losses: 1, streak: 0, bestStreak: 1,
  favoriteElement: null, earned: 4, lastPlayed: null, rating: 1010, ratedGames: 3, listed: true };

function state(over: Partial<ProfileState> = {}): ProfileState {
  return {
    me: ME, tab: 'stats', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '',
    leaders: null, leadersFailed: false, ladderMode: 'constructed', ladder: null, artFor: c => `art/${c}.webp`, ...over,
  };
}
const view = (over: Partial<ProfileState> = {}): ProfileView => profileView(state(over), 0);
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('976 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(profileHtml(view()), /^<div class="acctpage">/, 'the root report.ts reads the page off (pageOf → "acct")');
});

test('976 §1 every tab draws, and the current one is the one that is on', () => {
  const bodies: Record<string, RegExp> = {
    stats: /<h3>Record<\/h3>/, achievements: /<h3>Achievements <span class="acctcount">1 of 1<\/span><\/h3>/,
    ladder: /<h3>Ladder<\/h3>[\s\S]*loading…/, friends: /<h3>Add a friend<\/h3>/, decks: /<h3>Published decks<\/h3>/,
    history: /<table class="accttable games">/,
  };
  for (const t of PROFILE_TABS) {
    const html = profileHtml(view({ tab: t }));
    assert.match(html, bodies[t]!, `${t}: its body`);
    const on = [...html.matchAll(/class="[^"]*\bon\b[^"]*" data-btn="acct-tab" data-tab="(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(on, [t], `${t}: the only tab that is on`);
  }
  const tabsRow = profileHtml(view());
  assert.match(tabsRow, /data-tab="achievements"[^>]*>achievements <span class="ui-tabs__count">1\/1<\/span>/);
  assert.match(tabsRow, /data-tab="friends"[^>]*>friends <span class="ui-tabs__count">1 \+1<\/span>/, 'friends and the requests waiting');
});

test('976 §2 the header: the server\'s flags draw Admin and Rules review, and nothing else does', () => {
  const html = profileHtml(view());
  assert.match(html, /<header class="ui-page-header accthead">/);
  assert.match(html, /<h1 class="ui-page-header__title">Quill &lt;on&gt; <span class="acctel icon fire"/);
  assert.match(html, /Judge L2<\/span>/);
  assert.match(html, /12 games · 7W–5L · playing since/);
  for (const b of ['nav-league', 'nav-challenge', 'nav-admin', 'nav-crreview', 'acct-refresh', 'acct-logout', 'acct-close']) {
    assert.ok(btns(html).includes(b), b);
  }
  assert.match(html, /class="ui-button ui-button--primary ui-back-link" data-btn="acct-close"[^>]*>Return to Lobby</);
  const plain = profileHtml(view({ me: { ...ME, admin: undefined, badge: null } }));
  assert.ok(!btns(plain).includes('nav-admin') && !btns(plain).includes('nav-crreview'), 'a plain account: neither');
});

test('976 §3 every data-btn the account handler routes on is drawn', () => {
  const all = PROFILE_TABS.flatMap(t => btns(profileHtml(view({ tab: t, discordLinking: true }))));
  for (const b of ['acct-tab', 'acct-favorite', 'acct-password', 'acct-discord-link', 'acct-ladder-mode',
    'acct-friend-add', 'acct-friend-accept', 'acct-friend-remove', 'meta-open']) assert.ok(all.includes(b), b);
});

test('976 §4 "Everyone here": loading, the board, and a failed load that says so', () => {
  assert.match(profileHtml(view({ tab: 'friends' })), /<h3>Everyone here<\/h3>\s*<div class="hint">loading…<\/div>/);
  const board = profileHtml(view({ tab: 'friends', leaders: [LEADER] }));
  assert.match(board, /<table class="ui-table"><thead><tr><th scope="col"><\/th><th scope="col">player<\/th><th scope="col">games<\/th><th scope="col">record<\/th><th scope="col">badges<\/th><\/tr><\/thead>/);
  assert.match(board, /<tr><td><span class="fdot on"><\/span><\/td><td>Nyar <\/td><td>3<\/td><td>2W–1L<\/td><td>4<\/td><\/tr>/);
  const failed = profileHtml(view({ tab: 'friends', leadersFailed: true }));
  const everyone = failed.slice(failed.indexOf('<h3>Everyone here</h3>'));
  assert.doesNotMatch(everyone, /<table/, 'a failed load draws no (empty) table');
  assert.match(everyone, /class="ui-status ui-status--error" role="alert">Could not load the players\.</);
  assert.match(everyone, /data-btn="acct-tab"[^>]*data-tab="friends"[^>]*>Try again</, 'and the friends tab asks again');
});

test('976 §5 text off the server is escaped', () => {
  assert.doesNotMatch(profileHtml(view()), /Quill <on>/);
  assert.match(profileHtml(view({ tab: 'friends', friendMsg: 'no such <user>' })), /no such &lt;user&gt;/);
  assert.match(profileHtml(view({ tab: 'decks' })), /<span class="metaname">Ember &lt;Rush&gt;<\/span>/);
});

test('976 §6 profileView: a live link code only, the covers through artFor, a guest has no password box', () => {
  const live = profileView(state({ discordLinking: true, linkCode: { code: 'ABC', expiresAt: 100 } }), 50);
  assert.equal(live.connections?.code, 'ABC');
  assert.equal(profileView(state({ discordLinking: true, linkCode: { code: 'ABC', expiresAt: 100 } }), 150).connections?.code, null);
  assert.equal(profileView(state()).connections, null, 'no Discord bot, no Connections card');
  assert.equal(view().decks[0]!.cover, 'art/Ember.webp');
  assert.doesNotMatch(profileHtml(view({ me: { ...ME, provisional: true } })), /pwform/);
  assert.match(profileHtml(view()), /<section class="acctcard pwform">/);
});

test('976 §7 the load behind "Everyone here" marks a failure instead of an empty list', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../account.ts', import.meta.url), 'utf8');
  const at = src.indexOf('async function loadLeaders');
  assert.ok(at >= 0, 'positive control: loadLeaders');
  const load = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(load, /if \(!res\.ok\) throw/, 'a non-200 is a failure, not an empty body');
  assert.match(load, /catch \{[\s\S]*leadersFailed = true;/, 'a failure is marked');
  assert.doesNotMatch(load, /leaders = \[\]/, 'and never turned into an empty board');
  assert.match(src, /profileView\(\{[^}]*\bleadersFailed\b/, 'the mark reaches the view');
});
