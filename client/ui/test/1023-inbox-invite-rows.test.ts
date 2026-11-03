/* 1023 — THE PENDING INVITES AS ROWS INSIDE A PAGE (new home's Join sheet,
 * docs/24, 2026-11-03).
 *
 * pages/inbox.ts inviteRowsHtml draws the invites the bell holds as rows for
 * a sheet: the popup's own sentence and its own `data-inbox="join"` /
 * `"decline"` buttons, so inbox.ts's capture listener answers them wherever
 * they are drawn. No DOM here.
 *
 * §1 the rows: one per invite, Join then No thanks, each keyed by the invite id
 * §2 the sender and the room are the server's text, escaped
 * §3 no invites: nothing at all (the sheet leaves the section out)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteRowsHtml } from '../pages/inbox.ts';

const attrs = (html: string, name: string): string[] => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map(m => m[1]!);

test('1023 §1 a row per invite, with the popup\'s buttons', () => {
  const html = inviteRowsHtml([{ id: 'i1', from: 'Ann', label: 'a live draft' }, { id: 'i2', from: 'Bo', label: 'a constructed game' }]);
  assert.match(html, /^<div class="inviterows">/);
  assert.equal(html.match(/class="inviterow"/g)?.length, 2);
  assert.deepEqual(attrs(html, 'data-inbox'), ['join', 'decline', 'join', 'decline']);
  assert.deepEqual(attrs(html, 'data-id'), ['i1', 'i1', 'i2', 'i2']);
  assert.match(html, /<b>Ann<\/b> invites you to a live draft\./);
  assert.match(html, /<button class="primary" data-inbox="join" data-id="i1">Join<\/button>/);
  assert.doesNotMatch(html, /data-btn=/, 'the inbox never uses main.ts\'s data-btn');
});

test('1023 §2 the server\'s text is escaped', () => {
  const html = inviteRowsHtml([{ id: 'a"b', from: 'Ann <script>', label: 'a <i>room</i>' }]);
  assert.match(html, /<b>Ann &lt;script&gt;<\/b> invites you to a &lt;i&gt;room&lt;\/i&gt;\./);
  assert.match(html, /data-id="a&quot;b"/);
  assert.doesNotMatch(html, /<script>|<i>/);
});

test('1023 §3 no invites, no rows', () => {
  assert.equal(inviteRowsHtml([]), '');
});
