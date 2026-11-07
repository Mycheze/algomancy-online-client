/* 976 — THE PROFILE, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The profile's markup left ui/account.ts for ui/pages/profile.ts: account.ts
 * keeps the state and hands it to profileView(); profileHtml(view) draws it.
 * This file drives profileHtml with made-up views and no DOM at all.
 *
 * Redrawn by the account redesign (2026-11-07): five tabs in the toolbar's
 * centre — Overview · Achievements · Games · Players · Settings.
 *
 * §1 every tab draws, and the current one is the one that is on
 * §2 the Overview's header band; Settings' Staff row: the server's flags draw
 *    Admin, Storybook and Rules review, and nothing else does
 * §3 every data-btn the account handler routes on is drawn
 * §4 the Players tab's Everyone board: loading, the board (Add on a stranger,
 *    not on a friend or yourself), and a failed load that SAYS it failed (it
 *    used to draw an empty table) with a way to ask again
 * §5 text off the server is escaped (a username, a friend message, a deck name)
 * §6 profileView: the link code only while it is live, the art through artFor,
 *    a guest names the account instead of changing a password
 * §7 account.ts marks a failed load of that board, rather than emptying it
 * §8 an old tab name (a link, a test) still lands on the tab that has its content
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
    me: ME, tab: 'overview', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '', claimMsg: '',
    leaders: null, leadersFailed: false, board: 'constructed', ladder: null,
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false },
    artFor: c => `art/${c}.webp`, ...over,
  };
}
const view = (over: Partial<ProfileState> = {}): ProfileView => profileView(state(over), 0);
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('976 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // the app frame (pages/frame.ts, 2026-11-04): the shell, its page class last — what report.ts reads (pageOf → "acct")
  assert.match(profileHtml(view()), /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage acctpage">/);
});

test('976 §1 every tab draws, and the current one is the one that is on', () => {
  const bodies: Record<string, RegExp> = {
    overview: /<section class="pfhero">[\s\S]*<h3>Most played<\/h3>[\s\S]*<h3>Career<\/h3>/,
    achievements: /<b>1 of 1<\/b> earned[\s\S]*<h3>Winning<\/h3>/,
    games: /<table class="pftable pfgames">/,
    players: /<h3>Add a friend<\/h3>[\s\S]*data-btn="acct-ladder-mode"/,
    settings: /<h3>Account<\/h3>[\s\S]*<h3>At the table<\/h3>[\s\S]*<h3>Look<\/h3>/,
  };
  assert.deepEqual([...PROFILE_TABS], ['overview', 'achievements', 'games', 'players', 'settings']);
  for (const t of PROFILE_TABS) {
    const html = profileHtml(view({ tab: t }));
    assert.match(html, bodies[t]!, `${t}: its body`);
    assert.match(html, new RegExp(`<div class="pfbody pf-${t}">`), `${t}: the body says which tab`);
    const on = [...html.matchAll(/class="ui-segmented__option on" data-btn="acct-tab"[^>]*data-tab="(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(on, [t], `${t}: the only tab that is on`);
  }
  // the tabs are the toolbar's centre; Players says somebody is waiting
  const html = profileHtml(view());
  assert.match(html, /ui-app-shell__zone--center"><div class="ui-segmented acctnav"/);
  assert.match(html, /data-tab="players" data-count="1">Players</, 'one request waiting');
  assert.doesNotMatch(profileHtml(view({ me: { ...ME, incoming: [] } })), /data-count/, 'none waiting, no count');
});

test('976 §2 the Overview\'s band, and the Staff row the server\'s flags draw', () => {
  const html = profileHtml(view());
  assert.match(html, /<h1 class="frametitle">Profile<\/h1>/);
  assert.match(html, /<h2 class="pfname">Quill &lt;on&gt;<\/h2>/);
  assert.match(html, /Judge L2<\/span>/);
  assert.match(html, /<b>7–5<\/b><span>Record<\/span><small>58% won · 12 games<\/small>/);
  assert.match(html, /<b>1,012<\/b><span>Constructed<\/span><small>3 rated games<\/small>/);
  assert.match(html, /<b>1,000<\/b><span>Live draft<\/span><small>not rated yet<\/small>/);
  // Return to Lobby is the frame's Home button, the same data-btn
  assert.match(html, /<button class="ui-icon-button ui-icon-button--stack frameback" data-btn="acct-close" type="button">[\s\S]*?>Home<\/span>/);
  const settings = profileHtml(view({ tab: 'settings' }));
  for (const b of ['nav-admin', 'nav-storybook', 'nav-crreview', 'acct-logout']) assert.ok(btns(settings).includes(b), b);
  assert.match(settings, /<h3>Staff<\/h3>/);
  const plain = profileHtml(view({ tab: 'settings', me: { ...ME, admin: undefined, badge: null } }));
  for (const b of ['nav-admin', 'nav-storybook', 'nav-crreview']) assert.ok(!btns(plain).includes(b), `a plain account: no ${b}`);
  assert.doesNotMatch(plain, /<h3>Staff<\/h3>/, 'and no Staff section');
  // League and Challenge left the profile: the home has both
  assert.ok(!btns(html).includes('nav-league') && !btns(html).includes('nav-challenge'));
});

test('976 §3 every data-btn the account handler routes on is drawn', () => {
  const all = PROFILE_TABS.flatMap(t => btns(profileHtml(view({ tab: t, discordLinking: true, leaders: [LEADER] }))));
  for (const b of ['acct-tab', 'acct-favorite', 'acct-password', 'acct-discord-link', 'acct-ladder-mode', 'acct-pref', 'acct-logout',
    'acct-friend-add', 'acct-friend-accept', 'acct-friend-remove', 'meta-open']) assert.ok(all.includes(b), b);
  assert.ok(btns(profileHtml(view({ tab: 'settings', me: { ...ME, provisional: true } }))).includes('acct-claim'), 'a guest: acct-claim');
  // every setting has its buttons, one per value
  const settings = profileHtml(view({ tab: 'settings' }));
  for (const [pref, vals] of [['colours', ['standard', 'accessible']], ['sound', ['on', 'off']], ['motion', ['on', 'off']],
    ['autoPass', ['on', 'off']], ['bluffHaste', ['on', 'off']]] as const) {
    for (const v of vals) assert.match(settings, new RegExp(`data-btn="acct-pref"[^>]*data-pref="${pref}" data-v="${v}"`), `${pref}=${v}`);
  }
});

test('976 §4 Everyone: loading, the board, and a failed load that says so', () => {
  assert.match(profileHtml(view({ tab: 'players', board: 'all' })), /<p class="pfnone">Loading…<\/p>/);
  const stranger: LeaderRow = { ...LEADER, id: 'u9', username: 'Zed', online: false };
  const board = profileHtml(view({ tab: 'players', board: 'all', leaders: [LEADER, stranger] }));
  assert.match(board, /<table class="pftable pfboard"><thead><tr><th>Player<\/th><th class="pfnum">Games<\/th>/);
  assert.match(board, /<span class="pfopp">Nyar<\/span>[\s\S]*?<td class="pfnum">3<\/td><td class="pfnum">2–1<\/td><td class="pfnum">4<\/td><td class="pfact"><\/td>/, 'a friend: no Add');
  assert.match(board, /data-btn="acct-friend-add"[^>]*data-name="Zed"/, 'a stranger: Add, carrying the name');
  const failed = profileHtml(view({ tab: 'players', board: 'all', leadersFailed: true }));
  assert.doesNotMatch(failed, /<table class="pftable pfboard"/, 'a failed load draws no (empty) table');
  assert.match(failed, /class="ui-status ui-status--error" role="alert">Could not load the players\.</);
  assert.match(failed, /data-btn="acct-ladder-mode"[^>]*data-mode="all"[^>]*>Try again</, 'and Everyone asks again');
});

test('976 §5 text off the server is escaped', () => {
  assert.doesNotMatch(profileHtml(view()), /Quill <on>/);
  assert.match(profileHtml(view({ tab: 'players', friendMsg: 'no such <user>' })), /no such &lt;user&gt;/);
  assert.match(profileHtml(view()), /<span class="pfdeckname">Ember &lt;Rush&gt;<\/span>/);
});

test('976 §6 profileView: a live link code only, the art through artFor, a guest names the account', () => {
  const live = profileView(state({ discordLinking: true, linkCode: { code: 'ABC', expiresAt: 100 } }), 50);
  assert.equal(live.connections?.code, 'ABC');
  assert.equal(profileView(state({ discordLinking: true, linkCode: { code: 'ABC', expiresAt: 100 } }), 150).connections?.code, null);
  assert.equal(profileView(state()).connections, null, 'no Discord bot, no Discord row');
  assert.equal(view().decks[0]!.cover, 'art/Ember.webp');
  assert.equal(view().topCards[0]!.art, 'art/Ember.webp');
  const guest = profileHtml(view({ tab: 'settings', me: { ...ME, provisional: true } }));
  assert.doesNotMatch(guest, /pwform/);
  assert.match(guest, /id="acct-claim-name"[\s\S]*id="acct-claim-pass"/);
  assert.match(profileHtml(view({ tab: 'settings' })), /<div class="pfform pwform">/);
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

test('976 §8 an old tab name lands on the tab that has its content', async () => {
  const { profileTabFor } = await import('../pages/profile.ts');
  assert.equal(profileTabFor('stats'), 'overview');
  assert.equal(profileTabFor('decks'), 'overview');
  assert.equal(profileTabFor('history'), 'games');
  assert.equal(profileTabFor('friends'), 'players');
  assert.equal(profileTabFor('ladder'), 'players');
  assert.equal(profileTabFor('settings'), 'settings');
  assert.equal(profileTabFor('nonsense'), 'overview');
});
