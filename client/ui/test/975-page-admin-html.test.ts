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
    onlyUnmarked: false, chrome: { signedIn: true, alerts: 0 },
    ...over,
  };
}

const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('975 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // the app frame (pages/frame.ts, 2026-11-04): the page's class last (287)
  assert.match(adminHtml(view()), /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage framewide adminpage">/);
  assert.match(adminHtml(view({ access: false })), /^<div class="ui-app-shell ui-app-shell--contained apppage adminpage">/);
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
    // the tabs are a segmented control in the toolbar's centre since 2026-11-04
    const on = [...html.matchAll(/class="ui-segmented__option on" data-btn="admin-tab"[^>]*data-tab="(\w+)"/g)].map(m => m[1]);
    assert.match(html, new RegExp(`<div class="admintablewrap" data-scroll="admin-${id}">|The calendar is empty`), `${id}: its table scrolls by itself`);
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

/* §6 BL-17 — a report from a badged account is surfaced ahead of the others
 * while nobody has judged it; judged, it is back in date order. */
test('975 §6 unjudged reports from the owner and judges come first, highest level first', () => {
  const base = view().reportRows[0]!;
  // newest first, as the server sends them
  const r = (id: number, by: AdminView['reportRows'][number]['by'], mark: 'real' | 'not' | null = null) =>
    ({ ...base, id, ts: `2026-11-0${id}T10:00:00Z`, note: `report ${id}`, by, mark, markedBy: mark ? 'ops' : null });
  const rows = [
    r(9, { name: 'Pat' }),
    r(8, { name: 'Lou', judge: 1 }),
    r(7, null),
    r(6, { name: 'Max', judge: 3 }, 'real'),
    r(5, { name: 'Kim', judge: 3 }),
    r(4, { name: 'Ops', owner: true, judge: 1 }),
    r(3, { name: 'Ida', judge: 2 }),
    r(2, { name: 'Lou', judge: 1 }),
  ];
  const order = (html: string) => [...html.matchAll(/report (\d)<\/td>/g)].map(m => Number(m[1]));
  const html = adminHtml(view({ reportRows: rows }));
  assert.deepEqual(order(html), [4, 5, 3, 8, 2, 9, 7, 6],
    'owner, L3, L2, then the L1s newest first; then everybody else and the judged L3 in date order');
  assert.deepEqual(order(adminHtml(view({ reportRows: rows, onlyUnmarked: true }))), [4, 5, 3, 8, 2, 9, 7]);
  assert.deepEqual(rows.map(x => x.id), [9, 8, 7, 6, 5, 4, 3, 2], 'the view\'s own list is not reordered in place');
  // and the who column says what the filer was
  assert.match(html, /Ops <span class="badgechip owner">owner<\/span> <span class="badgechip judge">Judge L1<\/span><\/td>/);
  assert.match(html, /<td>Pat<\/td>/, 'an unbadged filer is just a name');
  assert.match(html, /<td><i>signed out<\/i><\/td>/);
});
