/* 948 · ui/components/table.ts — cells escaped unless {html}, numeric columns, the empty row, the scroll box */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table } from '../components/table.ts';

const columns = [{ key: 'name', label: 'Player' }, { key: 'w', label: 'Wins', align: 'right' as const }, { key: 'tag', label: 'Tag' }];

test('header, rows, escaping, trusted cells', () => {
  const html = table({ columns, rows: [{ cells: { name: '<Bob>', w: 3, tag: { html: '<span class="ui-chip">x</span>' } }, className: 'myrow', attrs: { 'data-id': 7 } }], dataBtn: 't' });
  assert.match(html, /^<table class="ui-table" data-btn="t"><thead><tr><th scope="col">Player<\/th><th class="ui-table__num" scope="col">Wins<\/th>/);
  assert.match(html, /<tr class="myrow" data-id="7"><td>&lt;Bob&gt;<\/td><td class="ui-table__num">3<\/td><td><span class="ui-chip">x<\/span><\/td><\/tr>/);
});

test('a missing cell is empty; no rows shows emptyText across every column', () => {
  assert.match(table({ columns, rows: [{ cells: { name: 'a' } }] }), /<td>a<\/td><td class="ui-table__num"><\/td><td><\/td>/);
  assert.match(table({ columns, rows: [], emptyText: 'no games <yet>' }), /<td class="ui-table__empty" colspan="3">no games &lt;yet&gt;<\/td>/);
});

test('caption and scroll', () => {
  const html = table({ columns, rows: [], caption: 'History', scroll: true });
  assert.match(html, /^<div class="ui-table-scroll"><table class="ui-table"><caption class="ui-table__caption">History<\/caption>/);
});

test('headless: no thead; a column title is the header cell\'s tooltip; headClassName on the header alone', () => {
  const cols = [{ key: 'a', label: 'A', title: 'the <tip>', headClassName: 'sorted', className: 'c' }, { key: 'b', label: 'B' }];
  const html = table({ columns: cols, rows: [{ cells: { a: 1, b: 2 } }] });
  assert.match(html, /<th class="c sorted" scope="col" title="the &lt;tip&gt;">A<\/th><th scope="col">B<\/th>/);
  assert.match(html, /<td class="c">1<\/td><td>2<\/td>/, 'headClassName is not on the body cells');
  const bare = table({ columns: cols, rows: [{ cells: { a: 1, b: 2 } }], headless: true, className: 'lgout' });
  assert.equal(bare, '<table class="ui-table lgout"><tbody><tr><td class="c">1</td><td>2</td></tr></tbody></table>');
});
