/* CT-291 (left over from CT-284 / report D3): three key leaks.
 *
 *  · Ctrl+Z under a draft pick or the constructed bottom-2 pick still sent a
 *    game undo: `inputOwned` left the pick dialogs out of its layer list, on
 *    the reading that undo "may take back" the pick. The dialog is a modal
 *    over the board; a key pressed over it is not aimed at the board, any more
 *    than one pressed over the report is. Enter still answers it (the hotkeys'
 *    own branch, which does not ask inputOwned) and Escape still hides it.
 *  · '/' and the rules review page's search. Behind the REPORT it did not in
 *    fact leak in a browser (headless Chrome, round r1024: the report's
 *    capture listener already stops it). The page's own comment SHEET and
 *    COMPOSER capture only Escape, so with one up and the focus off its text
 *    box '/' jumped to the search behind it; the handler now waits for all
 *    of them.
 *  · Enter from the report to a pick behind it: proved in headless Chrome
 *    (round r1024 report), not here — this driver dispatches every listener
 *    regardless of capture and stopPropagation, so it cannot show what a
 *    browser does.
 *
 * Seeds 62100-62199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const undos = (): number => ui.sent().filter(m => m['t'] === 'undo').length;

function open(h: Harness, seat: 0 | 1): void {
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  ui.sent();
}

test('CT-291 (D3): Ctrl+Z over the draft pick sends no game undo', () => {
  const h = new Harness(62100, ['Ann', 'Bo'], 'draft');
  open(h, 0);
  assert.ok(ui.has({ btn: 'draftcommit' }), 'fixture: the draft pick dialog is up');
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 0, 'the pick dialog has the keyboard');
});

// the negative control: the same board, the same seat, the dialog put away
test('CT-291 (D3): hidden to look at the board, the pick is not up, and Ctrl+Z is the game undo again', () => {
  const h = new Harness(62101, ['Ann', 'Bo'], 'draft');
  open(h, 0);
  ui.key('Escape');
  assert.ok(!ui.has({ btn: 'draftcommit' }), 'fixture: Escape hid the dialog');
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 1);
});

test('CT-291 (D3): the rules search slash waits while a dialog is over the page', () => {
  const src = readFileSync(new URL('../crsearch.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(isReportOpen\(\) \|\| reportJustSent\(\) \|\| isComposerOpen\(\) \|\| isSheetOpen\(\)\) return;/);
});
