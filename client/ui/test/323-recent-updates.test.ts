/* 323 — RECENT UPDATES: the changelog on the home page (ui/updates.ts).
 *
 * The owner, 2026-09-23: every push adds a short line — "just a line or two,
 * like a short tweet" — to a list on the home page, above the footer. The list
 * is hand-written data, so the only thing that keeps it readable is its shape:
 *
 *   §1  newest first, every date a real day and none in the future
 *   §2  a known kind, and short: a tweet, not a commit message
 *   §3  plain player-facing text: no ruling numbers, ticket ids or markup
 *   §4  the band: the newest SHOWN_UPDATES open, the rest under "Older updates",
 *       a same-day row leaves its date blank, and the text is escaped
 *   §5  the home screen shows it in its Updates sheet, opened from the bottom bar
 *       (docs/24, 2026-11-03; it was a band painted after .homepage until then)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_UPDATE_CHARS, SHOWN_UPDATES, UPDATES, updatesHtml, type Update } from '../updates.ts';

// the home screen is pages/home.ts since the design-system round (2026-11-03):
// homeView() gathers updatesHtml(), homeHtml() draws it, paintHome() wires it
const HOME = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'home.ts'), 'utf8');

test('§1 newest first, real dates, none in the future', () => {
  assert.ok(UPDATES.length > 0, 'the list is empty');
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const [i, u] of UPDATES.entries()) {
    assert.match(u.date, /^\d{4}-\d{2}-\d{2}$/, `entry ${i}: "${u.date}" is not YYYY-MM-DD`);
    assert.equal(new Date(`${u.date}T00:00:00Z`).toISOString().slice(0, 10), u.date, `entry ${i}: ${u.date} is not a real day`);
    assert.ok(u.date <= tomorrow, `entry ${i}: ${u.date} is in the future`);
    if (i) assert.ok(u.date <= UPDATES[i - 1]!.date,
      `entry ${i} (${u.date}) is newer than the one above it (${UPDATES[i - 1]!.date}) — add new lines at the TOP`);
  }
});

test('§2 a known kind, and a tweet long at most', () => {
  for (const u of UPDATES) {
    assert.ok(['new', 'fix', 'change'].includes(u.kind), `unknown kind ${u.kind}`);
    assert.ok(u.text.trim().length >= 20, `too short to say anything: "${u.text}"`);
    assert.ok(u.text.length <= MAX_UPDATE_CHARS,
      `${u.text.length} chars (max ${MAX_UPDATE_CHARS}) — one or two sentences: "${u.text.slice(0, 60)}…"`);
  }
});

/** an internal id a player cannot follow: a retired ruling, a rule number, a ticket, a report.
 * (`#163` sits outside the `\b…\b`: `\b#` never matches after a space, so until 2026-10 the
 * report-number half of this check could not fire — its positive control below found that.) */
const INTERNAL_ID = /\b(?:R\d{2,}|CR \d{3}|CR D\d|BL-\d+|CT-\d+)\b|#\d{2,}\b/;

test('§3 written for a player: no ruling numbers, ticket ids or markup', () => {
  // players never see rule numbers: the comprehensive rules are this repo's spec, not the game's text
  for (const bad of ['per R303, cached cards play', 'per CR 608.2b, damage', 'see CR D6.16a', 'BL-45 landed', 'CT-12 fixed', 'report #163'])
    assert.match(bad, INTERNAL_ID, `the id check went blind on "${bad}"`);
  assert.doesNotMatch('the 2026 league starts in March', INTERNAL_ID, 'the id check fires on ordinary words');
  for (const u of UPDATES) {
    assert.doesNotMatch(u.text, INTERNAL_ID, `an internal id in "${u.text}"`);
    assert.doesNotMatch(u.text, /<[a-z/]/i, `markup in "${u.text}" — the text is escaped, so it would show literally`);
  }
});

test('§4 the band: the newest open, the rest folded, same-day dates blank, text escaped', () => {
  const list: Update[] = [
    { date: '2026-09-23', kind: 'new', text: 'a <b>bold</b> & brave line' },
    ...Array.from({ length: SHOWN_UPDATES + 2 }, (_, i): Update =>
      ({ date: i < 2 ? '2026-09-23' : '2026-09-01', kind: 'fix', text: `line ${i}` })),
  ];
  const html = updatesHtml(list, null);
  const [open, older] = html.split('<details');
  assert.ok(older, 'no "Older updates" disclosure for a list longer than SHOWN_UPDATES');
  assert.equal(open!.match(/<li /g)?.length, SHOWN_UPDATES);
  assert.equal(older.match(/<li /g)?.length, list.length - SHOWN_UPDATES);
  assert.match(older, new RegExp(`Older updates \\(${list.length - SHOWN_UPDATES}\\)`));
  // three 23-Sep rows then 01-Sep rows: each day's date shows once
  assert.equal(html.match(/>23 Sep</g)?.length, 1);
  assert.equal(html.match(/>1 Sep</g)?.length, 1);
  assert.match(html, /a &lt;b&gt;bold&lt;\/b&gt; &amp; brave line/);
  assert.equal(updatesHtml([], null), '', 'an empty list paints nothing');
  assert.doesNotMatch(updatesHtml(list.slice(0, 2), null), /<details/, 'a short list has nothing to fold');
});

test('§5 the home screen shows the list in its Updates sheet, from the bottom bar', () => {
  // new home layout, docs/24, 2026-11-03: the band under the menu became the
  // Updates sheet, opened from the bottom bar's right; the home is one window,
  // so nothing is painted after the shell (1010 §1)
  const sheets = HOME.slice(HOME.indexOf('function sheetHtml('));
  const body = sheets.slice(0, sheets.indexOf('\n}\n'));
  assert.match(body, /case 'updates':[^]*?placement: 'anchor-bottom-right'[^]*?bodyHtml: s\.updates/,
    'the Updates sheet does not draw the list');
  const bottom = HOME.slice(HOME.indexOf('function bottomHtml('));
  assert.match(bottom.slice(0, bottom.indexOf('\n}\n')), /endHtml: iconButton\(\{ label: [^]*?opens\('updates'\)/,
    'the bottom bar has no Updates button');
  assert.match(HOME, /updates: updates(List)?Html\(\),/, 'homeView does not fill the updates slot');
  const paintHome = HOME.slice(HOME.indexOf('export function paintHome('));
  assert.match(paintHome.slice(0, paintHome.indexOf('\n}\n')), /wireUpdates\(\)/, 'paintHome does not wire the disclosure');
});

test('§6 new since the last visit: marked by count, across the fold, never on a first visit', () => {
  const list: Update[] = Array.from({ length: SHOWN_UPDATES + 3 }, (_, i): Update =>
    ({ date: '2026-09-23', kind: 'change', text: `line ${i}` }));
  const marked = (html: string) => html.match(/class="upd [a-z]+ unseen"/g)?.length ?? 0;
  assert.equal(marked(updatesHtml(list, null)), 0, 'a first visit marks nothing');
  assert.doesNotMatch(updatesHtml(list, null), /new since your last visit/);
  assert.equal(marked(updatesHtml(list, list.length)), 0, 'nothing added since: nothing marked');
  // two lines on the SAME day as the last visit's newest are still new
  const two = updatesHtml(list, list.length - 2);
  assert.equal(marked(two), 2);
  assert.match(two, /2 new since your last visit/);
  assert.ok(two.indexOf('unseen') < two.indexOf('line 2'), 'the marked rows are the newest, at the top');
  // more new than SHOWN_UPDATES: the mark carries into the fold
  const many = updatesHtml(list, 1);
  assert.equal(marked(many), list.length - 1);
  assert.equal(marked(many.split('<details')[1]!), list.length - 1 - SHOWN_UPDATES);
  // a list that shrank (an entry deleted) never marks a negative count
  assert.equal(marked(updatesHtml(list, list.length + 5)), 0);
});
