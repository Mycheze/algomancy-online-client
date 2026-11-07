/* 997 — THE PROFILE SAYS WHEN SOMETHING DID NOT TAKE (design-system round, 2026-11-03, stream ds-w3b).
 *
 * Three places on the profile lost a failure:
 *
 *  - the favourite element (acct-favorite): `post(...).then(refreshMe)` had no
 *    catch. Offline, an unhandled rejection; refused, nothing at all. The
 *    picker just did not move. It has its own message under the picker now.
 *  - Unlink Discord: no try/catch, and a refusal was dropped. It says so on
 *    the Connections card now, where Link Discord's own failure already went
 *    (test/905) — and that card draws the message on its linked face too,
 *    which it did not.
 *  - the Ladder tab's "Could not load the ladder." was .deckmsg's gold, the
 *    colour of a note; it is the error status now, as "Everyone here" is.
 *
 * §1 a favourite pick that fails says why (no server, then a refusal), and a good one clears it
 * §2 an Unlink that fails says why on the linked card (a refusal, then no server)
 * §3 the ladder's failure is drawn as an error, DOM-free
 *
 * Driven through the real client (test/ui-driver.ts) with a fetch we answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Me, Profile } from '../account.ts';

const PROFILE = {
  games: 1, wins: 1, losses: 0, unresolved: 0, byMode: { draft: 1 }, cardElements: { fire: 1 }, recycled: {},
  cards: { Ember: 1 }, unitsPlayed: 1, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0,
  resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, turnsPlayed: 5, longestGameTurns: 5, flawlessWins: 0, closeWins: 0, streak: 1,
  bestStreak: 1, rating: {}, ratedGames: {}, firstPlayed: '2026-09-01T00:00:00Z', lastPlayed: '2026-11-01T00:00:00Z',
} satisfies Profile;
const ME: Me = {
  id: 'u997', username: 'Quill', createdAt: '2026-09-01T00:00:00Z', favoriteElement: 'fire', profile: PROFILE,
  topCards: [], earned: 0, opponents: [], achievements: [], friends: [], incoming: [], outgoing: [], history: [],
  decks: [], discord: 'quill_d',
};

/** how the next POST to each route answers: a body, or 'offline' (fetch rejects) */
const answer: Record<string, unknown> = {};
const POSTS: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok-997' };
const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
g['__UI_DRIVER_FETCH'] = (url: string) => {
  if (url === '/api/me') return reply({ ok: true, me: ME, discordLinking: true });
  if (url in answer) {
    POSTS.push(url);
    const a = answer[url];
    return a === 'offline' ? Promise.reject(new TypeError('Failed to fetch')) : reply(a);
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const { profileHtml, profileView } = await import('../pages/profile.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle(); await settle();
const ui = home();
ui.click({ btn: 'acct-open-profile' });
await settle(); await settle();
// the picker and the Discord row are on Settings since the account redesign (2026-11-07)
ui.click({ btn: 'acct-tab', tab: 'settings' });
await settle();

/** the error line(s) on screen, as text */
const errors = (): string[] =>
  [...ui.html().matchAll(/<div class="ui-status ui-status--error" role="alert">([^<]*)<\/div>/g)].map(m => m[1]!);

test('997 §0 positive control: the profile is up, signed in, with the picker and the linked card', () => {
  assert.ok(ui.has({ btn: 'acct-favorite', el: 'fire' }), 'the favourite picker is drawn');
  assert.ok(ui.has({ btn: 'acct-discord-unlink' }), 'the Connections card is on its linked face');
  assert.deepEqual(errors(), [], 'and no error to start with');
});

test('997 §1 a favourite pick that fails says why; one that works clears it', async () => {
  answer['/api/me/favorite'] = 'offline';
  ui.click({ btn: 'acct-favorite', el: 'fire' });
  await settle(); await settle();
  assert.deepEqual(errors(), ['could not reach the server'], 'no server: said, under the picker');
  const html = ui.html();
  assert.ok(html.indexOf('could not reach the server') > html.indexOf('data-btn="acct-favorite"'), 'under the picker');

  answer['/api/me/favorite'] = { ok: false, error: 'not signed in' };
  ui.click({ btn: 'acct-favorite', el: 'water' });
  await settle(); await settle();
  assert.deepEqual(errors(), ['not signed in'], 'a refusal: the server\'s reason');

  answer['/api/me/favorite'] = { ok: true, favoriteElement: 'water', favoritePicked: 'water' };
  ui.click({ btn: 'acct-favorite', el: 'water' });
  await settle(); await settle();
  assert.deepEqual(errors(), [], 'a pick that took clears the message');
  assert.equal(POSTS.filter(u => u === '/api/me/favorite').length, 3, 'positive control: three picks went out');
});

test('997 §2 an Unlink that fails says why, on the linked card', async () => {
  answer['/api/link/discord/unlink'] = { ok: false, error: 'try again later' };
  ui.click({ btn: 'acct-discord-unlink' });
  await settle(); await settle();
  assert.deepEqual(errors(), ['try again later']);
  assert.ok(ui.has({ btn: 'acct-discord-unlink' }), 'still linked, still offering to unlink');

  answer['/api/link/discord/unlink'] = 'offline';
  ui.click({ btn: 'acct-discord-unlink' });
  await settle(); await settle();
  assert.deepEqual(errors(), ['could not reach the server']);
  const card = /<h3>Account<\/h3>[\s\S]*?<\/section>/.exec(ui.html())?.[0] ?? '';
  assert.match(card, /could not reach the server/, 'in the Account section, by the Discord row');
});

test('997 §3 the ladder\'s failure is drawn as an error, not as a gold note', () => {
  const html = profileHtml(profileView({
    me: ME, tab: 'players', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '', claimMsg: '',
    leaders: null, leadersFailed: false, board: 'constructed',
    ladder: { mode: 'constructed', players: [], you: null, rated: 0, publicAfter: 5, failed: true },
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false }, artFor: c => c,
  }));
  assert.match(html, /<div class="ui-status ui-status--error" role="alert">Could not load the ladder\.<\/div>/);
  assert.doesNotMatch(html, /class="deckmsg"/);
  assert.match(html, /data-btn="acct-ladder-mode"[^>]*data-mode="constructed"[^>]*>Try again</, 'and it still asks again');
});
