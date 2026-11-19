/* The profile's ✕ beside a friend asks twice: the first press turns it into a
 * red "Press again to remove <name>", the second removes them, and any other
 * account button disarms it. A friendship takes the other player's consent to
 * restore, so one stray click must not end it. Decline (a request to you) and
 * Cancel (your own request) still go at once: either side can simply ask again.
 *
 *   §1 the markup: the ✕, the armed button, and Decline / Cancel untouched
 *   §2 account.ts driven through the real client: one press sends nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FriendView, Me, Profile } from '../account.ts';

const PROFILE = {
  games: 1, wins: 1, losses: 0, unresolved: 0, byMode: { draft: 1 }, cardElements: { fire: 1 }, recycled: {},
  cards: { Ember: 1 }, unitsPlayed: 1, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0,
  resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, turnsPlayed: 5, longestGameTurns: 5, flawlessWins: 0, closeWins: 0, streak: 1,
  bestStreak: 1, rating: {}, ratedGames: {}, firstPlayed: '2026-09-01T00:00:00Z', lastPlayed: '2026-11-01T00:00:00Z',
} satisfies Profile;
const friend = (id: string, username: string): FriendView =>
  ({ id, username, online: false, games: 0, wins: 0, favoriteElement: null, lastPlayed: null }) as FriendView;
const ME: Me = {
  id: 'u1500', username: 'Quill', createdAt: '2026-09-01T00:00:00Z', favoriteElement: 'fire', profile: PROFILE,
  topCards: [], earned: 0, opponents: [], achievements: [], history: [], decks: [],
  friends: [friend('u2', 'Nyar'), friend('u3', 'Karanda')], incoming: [friend('u4', 'Tomzy')], outgoing: [friend('u5', 'Fennick')],
};

const POSTS: { url: string; id: string }[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok-1500' };
const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
g['__UI_DRIVER_FETCH'] = (url: string, init?: { body?: string }) => {
  if (url === '/api/me') return reply({ ok: true, me: ME });
  if (url.startsWith('/api/friends/')) {
    POSTS.push({ url, id: (JSON.parse(init?.body ?? '{}') as { id?: string }).id ?? '' });
    return reply({ ok: true, me: ME });
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const { profileHtml, profileView } = await import('../pages/profile.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });

const ARMED = /<button[^>]*ui-button--danger[^>]*data-btn="acct-friend-remove"[^>]*data-id="(\w+)"[^>]*>Press again to remove (\w+)<\/button>/;

test('1500 §1 BL-10: a friend\'s ✕ arms into a red Press again; Decline and Cancel are plain', () => {
  const view = (removing: string | null) => profileHtml(profileView({
    me: ME, tab: 'players', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', removing, pwMsg: null, favMsg: '',
    claimMsg: '', leaders: null, leadersFailed: false, board: 'constructed', ladder: null,
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false }, artFor: c => c,
  }));
  const calm = view(null);
  assert.doesNotMatch(calm, /Press again/);
  assert.equal([...calm.matchAll(/data-btn="acct-friend-remove"[^>]*aria-label="remove (\w+)"|aria-label="remove (\w+)"[^>]*data-btn="acct-friend-remove"/g)].length, 2,
    'each friend has its ✕, named');
  const armed = view('u2');
  assert.deepEqual(ARMED.exec(armed)?.slice(1), ['u2', 'Nyar'], 'Nyar\'s row asks again, in red');
  assert.match(armed, /title="remove Karanda"/, 'Karanda keeps the ✕');
  assert.match(armed, />Decline<\/button>/);
  assert.match(armed, />Cancel<\/button>/);
});

test('1500 §2 BL-10: the first ✕ sends nothing; the second removes; another button disarms; Decline goes at once', async () => {
  await settle(); await settle();
  const ui = home();
  ui.click({ btn: 'acct-open-profile' });
  await settle(); await settle();
  ui.click({ btn: 'acct-tab', tab: 'players' });
  await settle();
  assert.ok(ui.has({ btn: 'acct-friend-remove', id: 'u2' }), 'positive control: the Players tab is up with Nyar');

  ui.click({ btn: 'acct-friend-remove', id: 'u2' });
  await settle(); await settle();
  assert.deepEqual(POSTS, [], 'one press removes nobody');
  assert.equal(ARMED.exec(ui.html())?.[2], 'Nyar');

  ui.click({ btn: 'acct-friend-remove', id: 'u3' });
  await settle();
  assert.deepEqual(POSTS, [], 'a press on another friend moves the question, it does not answer it');
  assert.equal(ARMED.exec(ui.html())?.[2], 'Karanda');

  ui.click({ btn: 'acct-ladder-mode', mode: 'draft' });
  await settle();
  assert.doesNotMatch(ui.html(), /Press again/, 'any other account button disarms');
  ui.click({ btn: 'acct-friend-remove', id: 'u2' });
  await settle();
  assert.deepEqual(POSTS, [], 'so the next ✕ asks again');

  ui.click({ btn: 'acct-friend-remove', id: 'u2' });
  await settle(); await settle();
  assert.deepEqual(POSTS, [{ url: '/api/friends/remove', id: 'u2' }], 'the second press removes Nyar');
  assert.doesNotMatch(ui.html(), /Press again/);

  ui.click({ btn: 'acct-friend-remove', id: 'u4' });
  await settle(); await settle();
  assert.deepEqual(POSTS.at(-1), { url: '/api/friends/remove', id: 'u4' }, 'Decline goes on the first press');
  ui.click({ btn: 'acct-friend-remove', id: 'u5' });
  await settle(); await settle();
  assert.deepEqual(POSTS.at(-1), { url: '/api/friends/remove', id: 'u5' }, 'and so does Cancel');
});
