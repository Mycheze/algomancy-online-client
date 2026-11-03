/* 975 — THE ADMIN DASHBOARD, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * ui/admin.ts moved to ui/pages/admin.ts and split by the page contract
 * (pages/README.md): adminView() gathers, adminHtml(view) draws. This file
 * drives adminHtml with made-up views and no DOM at all.
 *
 * §1 refused: one sentence and the close button, no tab, no table
 * §2 every tab draws its table, and the current tab is the `on` one
 * §3 every data-btn the click handler routes on is drawn, with its data-*
 * §4 text off the server is escaped (a username, a report note, a fault)
 * §5 loading, an action's error and a server fault each say so
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_TABS, adminHtml, type AdminView } from '../pages/admin.ts';

const OVER: NonNullable<AdminView['overview']> = {
  me: 'ops', admins: 1, accounts: 2, games: 1, rooms: 1,
  reports: { total: 1, unmarked: 0, real: 1, not: 0, live: 0, unfetched: 0 },
};

function view(over: Partial<AdminView> = {}): AdminView {
  return {
    access: true, current: 'reports', isLoading: false, actionMsg: '', faultMsg: '', overview: OVER,
    accountRows: [{ id: 'a', username: 'Ann <b>', createdAt: '2026-10-01T00:00:00Z', admin: false, badge: { judge: 2, since: 'x' },
      games: 3, wins: 1, lastPlayed: null, friends: 0, decks: 0, discord: null }],
    reportRows: [{ id: 7, ledgerId: 7, ts: '2026-11-01T10:00:00Z', room: 'QXZK', seat: 0, note: 'it <script>broke</script>',
      actionIndex: 3, kind: 'bug', severity: 'minor', by: { name: 'Bo' }, status: 'fixed', guards: [], ledgerNote: null,
      mark: 'real', markedBy: 'ops' }],
    gameRows: [{ code: 'G1', playedAt: '2026-11-01T10:00:00Z', mode: 'draft', els: ['fire'], finished: true, diverged: false,
      winner: 1, turns: 8, minutes: 20, players: ['Ann', 'Bo'], known: [true, true], rated: false, custom: false }],
    roomRows: [{ code: 'QXRM', mode: 'draft', names: ['Ann', 'Bo'], connected: [true, false], users: ['a', null], turn: 2,
      phase: 'main', winner: null, actions: 9, minutes: 4, watchers: 0, rated: false }],
    calendar: { now: 0, rows: [], runsOutAt: null, weeksLeft: 0, upcoming: 0 },
    onlyUnmarked: false,
    ...over,
  };
}

const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('975 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(adminHtml(view()), /^<div class="adminpage">/);
});

test('975 §1 refused: the one sentence and the way out, nothing else', () => {
  const html = adminHtml(view({ access: false }));
  assert.match(html, /This account is not an admin on this server/);
  assert.deepEqual(btns(html), ['admin-close']);
  assert.doesNotMatch(html, /<table|admin-tab/);
});

test('975 §2 every tab draws its table, and the current tab is the one that is on', () => {
  const heads: Record<string, RegExp> = {
    reports: /<th>status<\/th>\s*<th>real\?<\/th>/, accounts: /<th>discord<\/th><th>actions<\/th>/,
    games: /<th>result<\/th><th>turns<\/th><th>length<\/th>/, rooms: /<th>live<\/th><th>watching<\/th>/,
    challenges: /The calendar is empty\./,
  };
  for (const [id] of ADMIN_TABS) {
    const html = adminHtml(view({ current: id }));
    assert.match(html, heads[id]!, `${id}: its body`);
    const on = [...html.matchAll(/class="[^"]*\bon\b[^"]*" data-btn="admin-tab" data-tab="(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(on, [id], `${id}: the only tab that is on`);
    assert.equal((html.match(/data-btn="admin-tab"/g) ?? []).length, ADMIN_TABS.length, 'every tab is drawn');
  }
});

test('975 §3 every data-btn the handler routes on is drawn, with what it reads', () => {
  const reports = adminHtml(view());
  for (const b of ['admin-refresh', 'admin-close', 'admin-tab', 'admin-unmarked', 'admin-mark']) assert.ok(btns(reports).includes(b), b);
  assert.match(reports, /data-btn="admin-mark"[^>]*data-ts="2026-11-01T10:00:00Z" data-mark="real"/);
  assert.match(reports, /class="ui-button ui-button--secondary on" data-btn="admin-mark"/, 'the mark a report carries is on');
  assert.match(reports, /data-mark=""/, 'and a marked report can be cleared');
  const accounts = adminHtml(view({ current: 'accounts' }));
  for (const level of [0, 1, 2, 3]) assert.match(accounts, new RegExp(`data-btn="admin-judge"[^>]*data-level="${level}"`));
  assert.match(accounts, /data-btn="admin-flag"[^>]*data-name="Ann &lt;b&gt;" data-want="1">make admin</);
});

test('975 §4 text off the server is escaped', () => {
  assert.match(adminHtml(view({ current: 'accounts' })), /<b>Ann &lt;b&gt;<\/b>/);
  const r = adminHtml(view());
  assert.match(r, /it &lt;script&gt;broke&lt;\/script&gt;/);
  assert.doesNotMatch(r, /<script>/);
  assert.match(adminHtml(view({ faultMsg: 'answered <502>' })), /answered &lt;502&gt;/);
});

test('975 §5 loading, an action error and a server fault each say so', () => {
  assert.match(adminHtml(view({ isLoading: true })), /<p class="adminnote">loading…<\/p>/);
  const both = adminHtml(view({ actionMsg: 'refused', faultMsg: 'the server answered 500 — try refresh' }));
  assert.match(both, /class="ui-status ui-status--error adminmsg" role="alert">refused</);
  assert.match(both, /role="alert">the server answered 500/);
  assert.doesNotMatch(adminHtml(view()), /role="alert"/, 'no error line when there is none');
});
