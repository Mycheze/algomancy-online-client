/* 1005 · ui/components/sheet.ts — drawn from state (closed → ''), the
 * dismiss data-btn on BOTH the scrim and the ✕, every placement and width,
 * labelled by its title; and installSheetEsc on a fake document: idempotent,
 * Escape only, the callback decides whether the key is taken. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_PLACEMENTS, SHEET_WIDTHS, type SheetKeyEvent, installSheetEsc, sheet } from '../components/sheet.ts';
import { icon } from '../components/icon.ts';

test('closed renders nothing at all', () => {
  assert.equal(sheet({ open: false, title: 'Join', bodyHtml: '<p>x</p>', dismissBtn: 'home-sheet-close' }), '');
});

test('open: root, scrim and ✕ carrying the dismiss button, title, body, foot', () => {
  const html = sheet({ open: true, id: 'join', title: 'Join <a> room', bodyHtml: '<p>b</p>', footerHtml: '<button>Go</button>', dismissBtn: 'home-sheet-close' });
  assert.match(html, /^<div class="ui-sheet ui-sheet--center ui-sheet--md" id="join" data-sheet>/);
  assert.match(html, /<div class="ui-sheet__scrim" data-btn="home-sheet-close" data-sheet-dismiss aria-hidden="true"><\/div>/);
  assert.match(html, /<section class="ui-sheet__panel" role="dialog" aria-labelledby="join-title">/);
  assert.match(html, /<h2 class="ui-sheet__title" id="join-title">Join &lt;a&gt; room<\/h2>/);
  assert.ok(html.includes(`<button class="ui-sheet__close" type="button" data-btn="home-sheet-close" data-sheet-dismiss title="Close" aria-label="Close">${icon('close')}</button>`));
  assert.match(html, /<div class="ui-sheet__body"><p>b<\/p><\/div><div class="ui-sheet__foot"><button>Go<\/button><\/div><\/section><\/div>$/);
  assert.equal(html.match(/data-btn="home-sheet-close"/g)?.length, 2, 'the scrim and the ✕, nothing else');
  // the scrim is the panel's sibling, so a click in the panel never reaches it through closest()
  assert.ok(html.indexOf('ui-sheet__scrim') < html.indexOf('ui-sheet__panel') && html.indexOf('</div><section') > 0);
});

test('no id: the panel is named by aria-label; no foot without footerHtml; no dismissBtn writes none', () => {
  const html = sheet({ open: true, title: 'About "us"' });
  assert.match(html, /role="dialog" aria-label="About &quot;us&quot;"/);
  assert.ok(!html.includes('ui-sheet__foot') && !html.includes('data-btn') && !html.includes(' id='));
});

test('every placement and width is its modifier; className, dataBtn and attrs pass through', () => {
  for (const placement of SHEET_PLACEMENTS) for (const width of SHEET_WIDTHS) {
    assert.match(sheet({ open: true, title: 't', placement, width }), new RegExp(`^<div class="ui-sheet ui-sheet--${placement} ui-sheet--${width}"`));
  }
  const html = sheet({ open: true, title: 't', className: 'updates', dataBtn: 'r', attrs: { 'data-k': 2 }, closeLabel: 'Done & close' });
  assert.match(html, /^<div class="ui-sheet ui-sheet--center ui-sheet--md updates" data-btn="r" data-sheet data-k="2">/);
  assert.match(html, /title="Done &amp; close" aria-label="Done &amp; close"/);
});

function fakeDoc(): { doc: { addEventListener(t: 'keydown', fn: (e: SheetKeyEvent) => void): void }; listeners: Array<(e: SheetKeyEvent) => void> } {
  const listeners: Array<(e: SheetKeyEvent) => void> = [];
  return { doc: { addEventListener: (_t, fn) => { listeners.push(fn); } }, listeners };
}
const key = (k: string, isComposing = false): SheetKeyEvent & { prevented: boolean } => {
  const e = { key: k, isComposing, prevented: false, preventDefault() { e.prevented = true; } };
  return e;
};

test('installSheetEsc: one listener per document; a later call swaps the callback', () => {
  const { doc, listeners } = fakeDoc();
  const calls: string[] = [];
  assert.equal(installSheetEsc(doc, () => { calls.push('a'); return true; }), true);
  assert.equal(installSheetEsc(doc, () => { calls.push('b'); return true; }), false);
  assert.equal(listeners.length, 1);
  listeners[0]!(key('Escape'));
  assert.deepEqual(calls, ['b']);
});

test('installSheetEsc: Escape only, not mid-composition; the key is taken only when the callback says so', () => {
  const { doc, listeners } = fakeDoc();
  let open = true;
  let calls = 0;
  installSheetEsc(doc, () => { calls++; if (!open) return false; open = false; return true; });
  const other = key('Enter');
  listeners[0]!(other);
  const composing = key('Escape', true);
  listeners[0]!(composing);
  assert.equal(calls, 0);
  const first = key('Escape');
  listeners[0]!(first);
  assert.equal(open, false);
  assert.equal(first.prevented, true, 'a sheet was open: Escape was ours');
  const second = key('Esc');
  listeners[0]!(second);
  assert.equal(calls, 2);
  assert.equal(second.prevented, false, 'no sheet open: Escape goes on to whatever else wants it');
});
