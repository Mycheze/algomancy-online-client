/* 978 — THE REPORT LAYER AND THE BELL, DRAWN WITHOUT A PAGE (design-system
 * round, 2026-11-03).
 *
 * Their markup left ui/report.ts and ui/inbox.ts for ui/pages/report.ts and
 * ui/pages/inbox.ts; the two modules keep their state and their clicks and
 * hand a view over. These are layers beside #app on every page, so their
 * clicks are `data-report` / `data-inbox`, never `data-btn`. No DOM here.
 *
 * §1 the report layer: the pill off the board, nothing on it, the dialog when open, the toast
 * §2 the report form: kinds, a severity only for a bug or UX, Send disabled until complete
 * §3 the dispute form, and the error line (ui-status) keeping .reporterror
 * §4 the bell: the count, the list with every kind of card, the popups only while the list is shut
 * §5 the waiting room's friends panel: loading, nobody, the rows and their invite buttons
 * §6 text off the server is escaped, and a card's trusted sentence is not
 * §7 while the pill is up the page keeps its corner clear (the league's
 *    "Suggest a time" sat under it on a phone): the page ends, and scrolls
 *    into view, at least the pill's offset + height above the window's foot
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportLayerHtml, type ReportDialogView } from '../pages/report.ts';
import { readStyles } from './read-styles.ts';
import { inboxLayerHtml, roomFriendsBodyHtml, roomFriendsHtml, type InboxListView, type NoteCardView } from '../pages/inbox.ts';

const dialog = (over: Partial<ReportDialogView> = {}): ReportDialogView =>
  ({ dispute: false, busy: false, kind: null, severity: null, complete: false, inGame: false, user: null, error: '', ...over });
const attr = (html: string, name: string): string[] => [...html.matchAll(new RegExp(`${name}="([^"]+)"`, 'g'))].map(m => m[1]!);

test('978 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
});

test('978 §1 the report layer: pill, nothing on a board, the dialog, the toast', () => {
  assert.equal(reportLayerHtml({ dialog: null, onBoard: false, toast: null }), '<button class="reportfab" data-report="open">📝 Report</button>');
  assert.equal(reportLayerHtml({ dialog: null, onBoard: true, toast: null }), '');
  const open = reportLayerHtml({ dialog: dialog(), onBoard: true, toast: null });
  assert.match(open, /^<div class="reportscrim" id="reportscrim"><div class="overlaybox reportbox" role="dialog" aria-label="Report">/);
  assert.doesNotMatch(open, /reportfab/, 'no pill under the dialog');
  assert.match(reportLayerHtml({ dialog: null, onBoard: false, toast: 'logged <ok>' }), /<div class="toast">logged &lt;ok&gt;<\/div>$/);
  assert.doesNotMatch(open, /data-btn=/, 'the layer never uses main.ts\'s data-btn');
});

test('978 §2 the report form: kinds, severity for a bug or UX only, Send disabled until complete', () => {
  const blank = reportLayerHtml({ dialog: dialog(), onBoard: false, toast: null });
  assert.deepEqual([...blank.matchAll(/data-report="kind" data-kind="(\w+)"/g)].map(m => m[1]), ['bug', 'ux', 'feature', 'other']);
  assert.doesNotMatch(blank, /data-report="severity"/);
  assert.match(blank, /data-report="send" disabled>Send report/);
  assert.match(blank, /Filed with the page you are on\. Filed anonymously/);
  const bug = reportLayerHtml({ dialog: dialog({ kind: 'bug', severity: 'medium', complete: true, inGame: true, user: 'Ann' }), onBoard: false, toast: null });
  assert.deepEqual([...bug.matchAll(/data-report="severity" data-severity="(\w+)"/g)].map(m => m[1]), ['minor', 'medium', 'gamebreaking']);
  assert.match(bug, /aria-checked="true" class="on"\s+data-report="kind" data-kind="bug"/);
  assert.match(bug, /data-report="send" >Send report/);
  assert.match(bug, /this exact moment of the game[^<]*Filed as <b>Ann<\/b>/);
  assert.doesNotMatch(reportLayerHtml({ dialog: dialog({ kind: 'feature' }), onBoard: false, toast: null }), /data-report="severity"/);
  assert.match(reportLayerHtml({ dialog: dialog({ busy: true, kind: 'other', complete: true }), onBoard: false, toast: null }), /data-report="send" disabled>sending…/);
});

test('978 §3 the dispute form, and the error line', () => {
  const d = reportLayerHtml({ dialog: dialog({ dispute: true, error: 'already <disputed>' }), onBoard: false, toast: null });
  assert.match(d, /aria-label="Dispute game"/);
  assert.doesNotMatch(d, /data-report="kind"/, 'a dispute asks for no kind');
  assert.match(d, /class="ui-status ui-status--error reporterror" role="alert">already &lt;disputed&gt;<\/div>/);
  assert.doesNotMatch(reportLayerHtml({ dialog: dialog(), onBoard: false, toast: null }), /role="alert"/, 'no error, no line');
});

const NOTE: NoteCardView = { key: 'L7', season: 's1', match: 'm1', read: false, html: 'Your match with <b>Bo</b> is in an hour', action: 'play' };
const LIST: InboxListView = {
  bellMsg: '',
  matches: [{ room: 'QXRM', seat: 1, asks: true, opponent: 'Bo', text: 'vs <b>Bo</b>', button: 'Resume' }],
  invites: [{ id: 'i1', from: 'Ann <x>', label: 'a draft' }],
  times: [{ season: 's1', seasonName: 'October', match: 'm1', from: 'Bo', when: 'Sat 7 Nov, 18:00' }],
  requests: [{ id: 'u9', username: 'Cy' }],
  notes: [NOTE],
};

test('978 §4 the bell: its count, the list, and the popups only while the list is shut', () => {
  assert.match(inboxLayerHtml({ unread: 0, list: null, pops: { invites: [], reminders: [] } }), /^<button class="inboxbell" data-inbox="bell" title="notifications">🔔<\/button>$/);
  const lit = inboxLayerHtml({ unread: 3, list: null, pops: { invites: LIST.invites, reminders: [NOTE] } });
  assert.match(lit, /class="inboxbell lit"[^>]*>🔔<span class="inboxcount">3<\/span>/);
  assert.match(lit, /<div class="invitepops">/);
  assert.deepEqual(attr(lit, 'data-inbox').filter(x => x === 'hide'), ['hide', 'hide'], 'each popup can be put away');
  const open = inboxLayerHtml({ unread: 3, list: LIST, pops: { invites: LIST.invites, reminders: [NOTE] } });
  assert.doesNotMatch(open, /invitepops/, 'the list is open: no popup over it');
  assert.deepEqual(attr(open, 'data-inbox'),
    ['bell', 'match-open', 'join', 'decline', 'time-accept', 'league', 'friend-accept', 'friend-decline', 'league-play']);
  assert.match(open, /<b>Bo<\/b> wants to resume your match/);
  assert.match(open, /<div class="zonelabel">League<\/div>/);
  assert.match(inboxLayerHtml({ unread: 0, list: { ...LIST, matches: [], invites: [], times: [], requests: [], notes: [] }, pops: { invites: [], reminders: [] } }),
    /<p class="hint">Nothing new\.<\/p>/);
});

test('978 §5 the friends panel: loading, nobody, the rows', () => {
  assert.equal(roomFriendsBodyHtml({ loaded: false, friends: [], msg: '' }), '<p class="hint">…</p>');
  assert.match(roomFriendsBodyHtml({ loaded: true, friends: [], msg: '' }), /Add friends on your profile/);
  const rows = roomFriendsHtml({ loaded: true, msg: 'not <allowed>', friends: [
    { id: 'a', username: 'Ann', favoriteElement: null, status: 'online', invite: null },
    { id: 'b', username: 'Bo', favoriteElement: null, status: 'offline', invite: 'declined' },
    { id: 'c', username: 'Cy', favoriteElement: null, status: 'playing', invite: 'sent' },
  ] });
  assert.match(rows, /^<div class="lobbypanel roomfriends"><div class="zonelabel">Invite a friend<\/div>\s*<div id="roomfriends">/);
  assert.match(rows, /<button class="primary" data-inbox="invite" data-id="a">Invite<\/button>/);
  assert.match(rows, /<button data-inbox="invite" data-id="b">Ask again<\/button>/, 'offline: not the primary');
  assert.match(rows, /data-id="c" disabled>Invited ✓/);
  assert.match(rows, /<span class="fdot on busy"><\/span>/);
  assert.match(rows, /<p class="deckmsg">not &lt;allowed&gt;<\/p>/);
});

test('978 §6 server text is escaped; a card\'s trusted sentence is not', () => {
  const open = inboxLayerHtml({ unread: 0, list: LIST, pops: { invites: [], reminders: [] } });
  assert.match(open, /<b>Ann &lt;x&gt;<\/b> invites you to a draft\./);
  assert.match(open, /Your match with <b>Bo<\/b> is in an hour/, 'noteLine\'s sentence is markup already');
});

test('978 §7 while the pill is up, the page keeps the corner it sits in clear', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  const pill = /\.reportfab \{[^}]*\bbottom: (\d+)px;[^}]*padding: 8px/.exec(css);
  assert.ok(pill, 'positive control: the pill is fixed at a bottom offset');
  // `:not(:has(#app > .apppage))`: the home's toolbar and bottom bar carry these since
  // 2026-11-03, docs/24, and every page in the app frame's since 2026-11-04 — the pill is
  // hidden there, so nothing keeps its corner clear (1020)
  const HOME_OUT = String.raw`:not\(:has\(#app > \.apppage\)\)`;
  const root = new RegExp(String.raw`:root:has\(#reportlayer > \.reportfab\)${HOME_OUT} \{([^}]*)\}`).exec(css)?.[1] ?? '';
  const clear = Number(/--report-pill-clear: (\d+)px/.exec(root)?.[1] ?? 0);
  // the pill: its offset, 8px padding twice and a line of 13px text — the clearance covers it and leaves a gap
  assert.ok(clear >= Number(pill[1]) + 16 + 18 + 8, `--report-pill-clear ${clear}px does not clear a pill ${pill[1]}px up`);
  assert.match(root, /scroll-padding-bottom: var\(--report-pill-clear\)/, 'a scroll into view stops above the pill');
  assert.match(css, new RegExp(String.raw`:root:has\(#reportlayer > \.reportfab\)${HOME_OUT} > body \{[^}]*padding-bottom: var\(--report-pill-clear\)`),
    'and the end of the page can scroll out from under it');
  // only while the pill is up: the board has no pill, and nothing here may reach it
  assert.doesNotMatch(css, /(^|[},])\s*body \{[^}]*padding-bottom/, 'no unconditional body padding');
});
