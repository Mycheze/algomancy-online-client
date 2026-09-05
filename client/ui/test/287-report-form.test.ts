/* T6 — THE REPORT BUTTON IS A FORM.
 *
 * The owner, polish round 2026-09-05: "The 'Bug' report button should be an
 * actual form now and is more just 'Report'. They select whether it's a bug,
 * UX/UI issue or feature request (or other, I guess) and then rank the
 * severity of the bug/issue (Minor, Medium, Game Breaking) and then the
 * normal text box. This will help us to process tickets much more easily."
 *
 * Driven through the real client (test/ui-driver.ts) with `fetch` stubbed, so
 * every assertion below is about what the form really PUTS ON THE WIRE — the
 * body /api/report receives — and not about the markup's shape.
 *
 *   §1 the button says Report, not bug
 *   §2 the form offers exactly the server's kinds and severities, by value —
 *      the two lists are named once, in server/report-fields.ts, and this is
 *      what stops the client offering a choice the server would coerce away
 *   §3 severity is asked for a bug and a UX issue, not for a feature request
 *      or "other"; Send waits for kind, severity (where asked) and a note
 *   §4 the body: room, seat, note, kind, severity — and the dialog closes
 *      with a toast on ok
 *   §5 switching to a kind without severity DROPS a severity already chosen
 *   §6 the choices survive a server push mid-typing (the reason they are
 *      module state, like the draft)
 *   §7 Escape closes; Ctrl+Enter from the box sends
 *
 * Seeds 28400-28499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { REPORT_KINDS, REPORT_SEVERITIES, SEVERITY_KINDS } from '../../server/report-fields.ts';
import { client } from './ui-driver.ts';
import { pageOf, REPORT_KIND_LABELS, REPORT_SEVERITY_LABELS } from '../report.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const SEAT: Seat = 0;
const board = (seed: number): GameState => new Harness(seed).state;
const join = (s: GameState): string => ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));

/** the fetch stub: every /api/report body, and an `ok` answer */
const posted: { url: string; body: Record<string, unknown> }[] = [];
let answer: Record<string, unknown> = { ok: true };
(globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: { body?: string }) => {
  posted.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
  return Promise.resolve({ json: () => Promise.resolve(answer) });
};
/** let the fetch's then/finally chain run */
const settle = (): Promise<void> => new Promise(r => setImmediate(r));

/** the `data-kind` / `data-severity` values the form offers right now */
const offered = (html: string, attr: 'kind' | 'severity'): string[] =>
  [...html.matchAll(new RegExp(`data-report="${attr}" data-${attr}="([^"]+)"`, 'g'))].map(m => m[1]!);
const sendDisabled = (html: string): boolean => /data-report="send" disabled/.test(html);
const NOTE_ID = 'report-note';

/** open the dialog fresh on a new board */
function open(seed: number): string {
  join(board(seed));
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  return ui.click({ btn: 'reportopen' });
}

test('T6 §1 the side-rail button says Report, and the dialog is titled so', () => {
  const html = join(board(28400));
  const btn = /<button data-btn="reportopen"[^>]*>([^<]*)<\/button>/.exec(html);
  assert.ok(btn, 'the report button is on the rail for an online client');
  assert.match(btn[1]!, /report/i, 'the button is "Report" now');
  assert.doesNotMatch(btn[1]!, /bug/i, 'the owner: "is more just Report" — a bug is one of the kinds, not the button');
  const dialog = ui.click({ btn: 'reportopen' });
  assert.match(dialog, /<h3>[^<]*Report[^<]*<\/h3>/, 'the dialog heading');
  assert.doesNotMatch(dialog, /<h3>[^<]*bug/i);
  // the ONE fresh form this file sees: Cancel keeps the choices the way it
  // keeps the draft (an accidental Escape must not eat a paragraph), so every
  // later test inherits whatever the one before picked
  assert.ok(sendDisabled(dialog), 'nothing chosen, nothing typed: Send is disabled');
  assert.equal(offered(dialog, 'severity').length, 0, 'no severity row before a kind is picked');
});

test('T6 §2 the form offers exactly the server\'s kinds and severities, by value', () => {
  const html = open(28401);
  assert.deepEqual(offered(html, 'kind'), [...REPORT_KINDS],
    'the kind buttons are the server\'s REPORT_KINDS, in order — one list, named in server/report-fields.ts');
  assert.deepEqual(REPORT_KIND_LABELS.map(([v]) => v), [...REPORT_KINDS], 'and the label table names nothing the server would coerce');
  assert.deepEqual(REPORT_SEVERITY_LABELS.map(([v]) => v), [...REPORT_SEVERITIES]);
  // severities are only on screen once a kind that takes one is picked
  const bug = ui.click({ report: 'kind', kind: 'bug' });
  assert.deepEqual(offered(bug, 'severity'), [...REPORT_SEVERITIES],
    'the severity buttons are the server\'s REPORT_SEVERITIES, in order');
  assert.match(bug, /data-kind="bug"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-kind="bug"/,
    'the picked kind is checked (role=radio + aria-checked)');
});

test('T6 §3 severity is asked for a bug / UX issue only, and Send waits for every part', () => {
  let html = open(28402);
  for (const k of REPORT_KINDS) {
    html = ui.click({ report: 'kind', kind: k });
    const asks = SEVERITY_KINDS.includes(k);
    assert.equal(offered(html, 'severity').length > 0, asks,
      `kind '${k}' ${asks ? 'asks for' : 'does not ask for'} a severity (server/report-fields.ts SEVERITY_KINDS)`);
  }
  // Typing flips the Send button's live `disabled` PROPERTY through
  // document.querySelector, which this driver has no DOM to answer — so the
  // markup `type()` hands back is the pre-keystroke paint. Sendability is
  // therefore read after a repaint (re-picking the current kind), which is
  // the same `reportComplete()` the live toggle and the sender both consult.
  const typed = (text: string, kind: string): string => { ui.type(NOTE_ID, text); return ui.click({ report: 'kind', kind }); };
  // feature request: kind + note is enough
  html = ui.click({ report: 'kind', kind: 'feature' });
  assert.ok(sendDisabled(html), 'a kind alone is not a report');
  html = typed('let me sort my hand', 'feature');
  assert.ok(!sendDisabled(html), 'kind + note: a feature request can be sent');
  // bug: needs the severity too
  html = ui.click({ report: 'kind', kind: 'bug' });
  assert.ok(sendDisabled(html), 'a bug with no severity cannot be sent — the owner wants it ranked');
  html = ui.click({ report: 'severity', severity: 'medium' });
  assert.ok(!sendDisabled(html), 'bug + severity + note: sendable');
  html = typed('   ', 'bug');
  assert.ok(sendDisabled(html), 'a blank note is no note');
  posted.length = 0;
  ui.click({ report: 'send' });
  assert.equal(posted.length, 0, 'and a disabled Send that is clicked anyway sends nothing — the sender re-checks the form');
});

test('T6 §4 the body carries room, seat, note, kind and severity; ok closes with a toast', async () => {
  open(28403);
  posted.length = 0;
  ui.click({ report: 'kind', kind: 'bug' });
  ui.click({ report: 'severity', severity: 'gamebreaking' });
  ui.type(NOTE_ID, 'the stack vanished after undo');
  const busy = ui.click({ report: 'send' });
  assert.equal(posted.length, 1, 'one POST');
  assert.equal(posted[0]!.url, '/api/report');
  assert.deepEqual(posted[0]!.body, {
    room: 'UIDRIVER', seat: 0, page: 'game', note: 'the stack vanished after undo', kind: 'bug', severity: 'gamebreaking',
  }, 'the body is the fields the server stores — and from the rail it says which game');
  assert.match(busy, /sending…/, 'the dialog shows the send in flight');
  await settle();
  const after = ui.html();
  assert.ok(!ui.has({ report: 'send' }), 'ok: the dialog closed');
  assert.match(after, /class="toast"/, 'and a toast says it landed');
  // the form starts blank next time — a second report is a new ticket
  const again = ui.click({ btn: 'reportopen' });
  assert.equal(offered(again, 'severity').length, 0, 'no kind is pre-picked on the next report');
  assert.ok(sendDisabled(again));
  ui.click({ report: 'close' });
});

test('T6 §4b a refusal keeps the dialog and the draft', async () => {
  open(28404);
  posted.length = 0;
  answer = { ok: false };
  ui.click({ report: 'kind', kind: 'other' });
  ui.type(NOTE_ID, 'hello');
  ui.click({ report: 'send' });
  await settle();
  answer = { ok: true };
  assert.ok(ui.has({ report: 'send' }), 'not accepted: the dialog stays, with the note, so it can be retried');
  assert.match(ui.html(), /was not accepted/, 'and says so');
  ui.click({ report: 'close' });
});

test('T6 §5 switching to a kind without severity drops the one chosen', () => {
  open(28405);
  posted.length = 0;
  ui.click({ report: 'kind', kind: 'ux' });
  ui.click({ report: 'severity', severity: 'minor' });
  ui.type(NOTE_ID, 'the pass button moves');
  ui.click({ report: 'kind', kind: 'feature' });
  ui.click({ report: 'send' });
  assert.equal(posted[0]!.body['kind'], 'feature');
  assert.equal(posted[0]!.body['severity'], null,
    'a feature request never carries the severity picked for the bug it used to be');
});

test('T6 §6 a server push mid-form keeps the kind, the severity and the draft', () => {
  const s = board(28406);
  join(s);
  ui.click({ btn: 'reportopen' });
  ui.click({ report: 'kind', kind: 'bug' });
  ui.click({ report: 'severity', severity: 'medium' });
  ui.type(NOTE_ID, 'half a sent');
  const pushed = ui.update(viewFor({ ...structuredClone(s), turn: s.turn + 1 }, SEAT), legalActions(s, SEAT));
  assert.ok(ui.has({ report: 'send' }), 'the dialog is still up after the push');
  assert.match(pushed, /data-kind="bug"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-kind="bug"/, 'kind kept');
  assert.match(pushed, /data-severity="medium"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-severity="medium"/, 'severity kept');
  // the form is NOT repainted by a push any more (§10) — so the markup still
  // shows Send as it was before the typing, and sendability is read the way
  // §3 reads it, after a repaint the form itself makes
  assert.ok(!sendDisabled(ui.click({ report: 'kind', kind: 'bug' })), 'the draft is kept too — Send is still live');
  posted.length = 0;
  ui.click({ report: 'send' });
  assert.equal(posted[0]!.body['note'], 'half a sent', 'and it is what gets sent');
});

test('T6 §7 Escape closes; Ctrl+Enter from the box sends', () => {
  open(28407);
  ui.key('Escape');
  assert.ok(!ui.has({ report: 'send' }), 'Escape closes the form');
  ui.click({ btn: 'reportopen' });
  posted.length = 0;
  ui.click({ report: 'kind', kind: 'ux' });
  ui.keyIn(NOTE_ID, 'Enter', { ctrl: true });
  assert.equal(posted.length, 0, 'Ctrl+Enter on an incomplete form sends nothing');
  ui.click({ report: 'severity', severity: 'minor' });
  ui.type(NOTE_ID, 'tiny text');
  ui.keyIn(NOTE_ID, 'Enter', { ctrl: true });
  assert.equal(posted.length, 1, 'Ctrl+Enter sends a complete form');
  assert.deepEqual(posted[0]!.body, { room: 'UIDRIVER', seat: 0, page: 'game', note: 'tiny text', kind: 'ux', severity: 'minor' });
});

/* ══ 2026-09-05 — ON EVERY PAGE ═══════════════════════════════════════
 *
 * Owner: "we need the Report button to appear somewhere on every page. Even in
 * the lobby and deck building areas. It doesn't make sense to need to report
 * something by entering a game if it has to do with the card search or
 * something..." The form is a layer beside #app now (ui/report.ts): a fixed
 * pill off the board, the rail button on it, and off the board the report
 * carries the PAGE it came from, read off #app's own root class.
 */

test('§8 the page a report is filed from is read off the screen\'s own root class', () => {
  // the roots the screen modules really paint (grep `class="` at each
  // module's $app.innerHTML), not a list this test invents
  assert.equal(pageOf('<div class="deckpage">…'), 'deck');
  assert.equal(pageOf('<div class="cbpage">…'), 'cb');
  assert.equal(pageOf('<div class="acctpage">…'), 'acct');
  assert.equal(pageOf('<div class="homepage">…'), 'home');
  assert.equal(pageOf('<div class="lobbypage">…'), 'lobby');
  assert.equal(pageOf('<div class="metapage">…'), 'meta');
  assert.equal(pageOf('<div class="joinscreen home queuescreen">…'), 'queue');
  assert.equal(pageOf('<div class="joinscreen home acctscreen">…'), 'acct');
  assert.equal(pageOf('<div class="joinscreen"><h2>Algomancy</h2>'), 'join');
  assert.equal(pageOf(''), null, 'no root, no page');
});

test('§9 off the board the pill opens the same form, and the body says which page, no room', async () => {
  // the driver never leaves the board, so the pill is raised the way the pill
  // is wired — by its own data-report — after closing any open form
  join(board(28408));
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  assert.ok(ui.has({ report: 'open' }), 'the pill is painted by the report layer (the harness never sets #app.board, so it is up)');
  const html = ui.click({ report: 'open' });
  assert.match(html, /<h3>[^<]*Report[^<]*<\/h3>/, 'the same dialog');
  assert.match(html, /the page you are on/, 'and it says the report carries the page, not a game moment');
  posted.length = 0;
  ui.click({ report: 'kind', kind: 'feature' });
  ui.type(NOTE_ID, 'sort the card browser by cost');
  ui.click({ report: 'send' });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!.body['room'], '', 'no room: this is not about a game');
  assert.equal(posted[0]!.body['seat'], null);
  assert.equal(typeof posted[0]!.body['page'], 'string', 'the page is on the body');
  await settle();
  assert.ok(!ui.has({ report: 'send' }), 'sent and closed');
});

test('§10 a board repaint does not rebuild the form — the layer is outside #app', () => {
  const s = board(28409);
  join(s);
  ui.click({ btn: 'reportopen' });
  ui.click({ report: 'kind', kind: 'ux' });
  const before = ui.html();
  const formBefore = before.slice(before.indexOf('id="reportscrim"'));
  ui.update(viewFor({ ...structuredClone(s), turn: s.turn + 1 }, SEAT), legalActions(s, SEAT));
  const after = ui.html();
  assert.equal(after.slice(after.indexOf('id="reportscrim"')), formBefore,
    'the form\'s markup is byte-identical across a server push — nothing repainted it');
  ui.click({ report: 'close' });
});
