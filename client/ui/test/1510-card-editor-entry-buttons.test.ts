/* 1510 — the designer flag in the client, drawn without a page.
 *
 * §1 the profile's Staff row has a Card editor button for a designer and for an
 *    admin, and none for a plain player or a judge badge alone
 * §2 the admin dashboard's Accounts tab: a designer chip and a Designer toggle on
 *    every row, beside the admin one, saying which way it will go
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileHtml, profileView, type ProfileState } from '../pages/profile.ts';
import { adminHtml, type AccountRow, type AdminView } from '../pages/admin.ts';
import type { Me } from '../account.ts';

const ME = {
  id: 'u1', username: 'Caleb', createdAt: '2026-09-01T00:00:00Z', favoriteElement: null, profile: null, topCards: [],
  earned: 0, opponents: [], achievements: [], friends: [], incoming: [], outgoing: [], history: [], decks: [],
  badge: null,
} as unknown as Me;

function settings(me: Partial<Me>): string {
  const state: ProfileState = {
    me: { ...ME, ...me }, tab: 'settings', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null,
    favMsg: '', claimMsg: '', leaders: null, leadersFailed: false, board: 'constructed', ladder: null,
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false },
    artFor: c => `art/${c}.webp`,
  };
  return profileHtml(profileView(state, 0));
}
const BTN = /<button [^>]*data-btn="nav-cardeditor"[^>]*>Card editor<\/button>/g;

test('1510 §1 Card editor on the profile for a designer and for an admin, not for anybody else', () => {
  for (const [who, me] of [['a designer', { designer: true }], ['an admin', { admin: true }],
    ['both', { designer: true, admin: true }]] as const) {
    const html = settings(me);
    assert.equal((html.match(BTN) ?? []).length, 1, `${who}: one Card editor button`);
    assert.match(html, /<h3>Staff<\/h3>/, `${who}: in the Staff row`);
  }
  assert.doesNotMatch(settings({ designer: true }), /nav-admin|nav-storybook/, 'a designer gets no admin buttons');
  for (const [who, me] of [['a player', {}], ['a judge', { badge: { judge: 3, since: 'x' } }],
    ['the owner badge', { badge: { owner: true, since: 'x' } }]] as const) {
    assert.doesNotMatch(settings(me as Partial<Me>), /nav-cardeditor/, `${who}: no Card editor button`);
  }
});

const ROW: AccountRow = {
  id: 'a', username: 'Caleb', createdAt: '2026-10-01T00:00:00Z', admin: false, designer: false, badge: null,
  games: 0, wins: 0, lastPlayed: null, friends: 0, decks: 0, discord: null,
};
function accountsTab(rows: AccountRow[]): string {
  const view: AdminView = {
    access: true, current: 'accounts', isLoading: false, actionMsg: '', faultMsg: '',
    overview: { me: 'ops', admins: 1, accounts: rows.length, games: 0, rooms: 0,
      reports: { total: 0, unmarked: 0, real: 0, not: 0, live: 0, unfetched: 0 } },
    accountRows: rows, reportRows: [], gameRows: [], roomRows: [],
    calendar: { now: 0, rows: [], runsOutAt: null, weeksLeft: 0, upcoming: 0 },
    onlyUnmarked: false, chrome: { signedIn: true, alerts: 0 },
  };
  return adminHtml(view);
}

test('1510 §2 the Accounts tab has a Designer toggle beside admin, and a chip for a designer', () => {
  const html = accountsTab([ROW, { ...ROW, id: 'b', username: 'Dee', designer: true }]);
  assert.match(html, /data-btn="admin-flag"[^>]*data-name="Caleb"[^>]*>Make admin<\/button>\s*<button [^>]*data-btn="admin-designer"[^>]*data-name="Caleb" data-want="1">Make designer</,
    'a grant, beside the admin toggle');
  assert.match(html, /data-btn="admin-designer"[^>]*data-name="Dee" data-want="0">Revoke designer</, 'a revoke for a designer');
  assert.equal((html.match(/data-btn="admin-designer"/g) ?? []).length, 2, 'one toggle per row');
  assert.match(html, /<b>Dee<\/b>\s*<span class="badgechip designer" title="can edit cards">Designer<\/span>/, 'a designer is marked');
  assert.doesNotMatch(html, /<b>Caleb<\/b>[^<]*<span class="badgechip designer">/, 'and nobody else is');
});
