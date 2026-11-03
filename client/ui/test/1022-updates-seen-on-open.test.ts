/* 1022 — "N NEW" COUNTS FROM WHEN THE LIST WAS LAST OPENED (new home, docs/24,
 * 2026-11-03).
 *
 * The Recent updates list moved behind the home's bottom-bar "Updates" button,
 * so "seen" moved with it: it advances when the list is OPENED
 * (markUpdatesSeen), not when the home page loads. updatesUnseen() is the
 * button's badge. A first visit badges nothing and records today's count, so
 * the next entry is the first one badged. The open list keeps the marks it
 * was opened with, so opening it does not wipe them off the list being read.
 * updatesListHtml is the list without the band's heading, for the sheet.
 * (323 keeps pinning updatesHtml(list, seen) itself.)
 *
 * §1 a first visit: no badge, and the count is recorded
 * §2 a new entry badges; opening clears the badge but keeps the rows marked
 * §3 updatesListHtml: the list alone, the same rows as the band's, '' for none
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markUpdatesSeen, updatesHtml, updatesListHtml, updatesUnseen, type Update } from '../updates.ts';

const store = new Map<string, string>();
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
const line = (i: number): Update => ({ date: '2026-11-03', kind: 'fix', text: `line ${i}` });
const marked = (html: string): number => html.match(/class="upd [a-z]+ unseen"/g)?.length ?? 0;

test('1022 §1 a first visit badges nothing, and records the count', () => {
  const list = [line(2), line(1), line(0)];
  assert.equal(store.get('algoUpdatesSeen'), undefined, 'positive control: nothing stored yet');
  assert.equal(updatesUnseen(list), 0);
  assert.equal(store.get('algoUpdatesSeen'), '3', 'the first visit records today\'s count');
  assert.equal(marked(updatesListHtml(list)), 0, 'and marks no row');
});

test('1022 §2 a new entry badges; opening the list clears the badge and keeps the marks', () => {
  const list = [line(4), line(3), line(2), line(1), line(0)];
  assert.equal(updatesUnseen(list), 2, 'two entries since the list was last seen');
  assert.equal(marked(updatesListHtml(list)), 2, 'the list marks them before it is opened');
  assert.equal(updatesUnseen(list), 2, 'reading the badge or drawing the list does not advance it');
  markUpdatesSeen(list);
  assert.equal(store.get('algoUpdatesSeen'), '5');
  assert.equal(updatesUnseen(list), 0, 'opened: the badge is gone');
  assert.equal(marked(updatesListHtml(list)), 2, 'but the open list still marks what was new when it opened');
  markUpdatesSeen(list);
  assert.equal(marked(updatesListHtml(list)), 2, 'opening it again in the same page load keeps them');
  assert.equal(updatesUnseen([line(5), ...list]), 1, 'the next entry badges again');
});

test('1022 §3 the list alone, for a sheet with its own heading', () => {
  const list = Array.from({ length: 9 }, (_, i) => line(9 - i));
  const alone = updatesListHtml(list, 7);
  assert.match(alone, /^<ol class="updlist">/, 'no section and no heading');
  assert.doesNotMatch(alone, /<section|<h2|updnew/);
  assert.match(alone, /<details class="updolder"><summary>|<details class="updolder">\s*<summary>Older updates \(3\)/);
  assert.equal(marked(alone), 2);
  const band = updatesHtml(list, 7);
  assert.ok(band.includes(alone), 'the band draws exactly this list under its heading');
  assert.match(band, /^<section class="updates" aria-labelledby="upd-h">\s*<h2 id="upd-h">Recent updates<span class="updnew">2 new since your last visit<\/span><\/h2>/);
  assert.equal(updatesListHtml([], null), '', 'nothing to say: nothing drawn');
  assert.match(updatesListHtml([{ date: '2026-11-03', kind: 'new', text: '<b>x</b> & y' }], null), /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
});
