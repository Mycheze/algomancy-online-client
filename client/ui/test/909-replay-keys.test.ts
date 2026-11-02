/* The replay viewer's keys leave typing and dialogs alone.
 *
 * replaybar.ts takes Space (play/pause), ← → (step) and Escape (leave) on a
 * CAPTURE listener on document, so it ran before anything else. Found
 * 2026-11-02 in a browser, on /?replay=: typing in the report box lost every
 * space and the arrows stepped the game instead of the caret; a space in the
 * judge box toggled play and the repaint took the question with it; Escape
 * inside either dialog quit the whole replay. replayKeysBelongElsewhere()
 * now hands the key back for a field being typed in and while a dialog is
 * open — so the dialog's own Escape (main.ts closeTopOverlay) closes it.
 *
 * And the "tinted past the point the games parted" rule aimed at
 * `#app .table`, a class nothing has painted since the classic board went; it
 * aims at the regions board, `.lboard[data-focus]` (the attribute keeps the
 * selector from reading as `.lboard {`, which test 449 takes to be the board's
 * own grid rule).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';
import { replayKeysBelongElsewhere, REPLAY_DIALOGS } from '../replaybar.ts';

const noDialog = { querySelector: () => null } as unknown as Document;
const aDialog = { querySelector: (s: string) => (s === REPLAY_DIALOGS ? {} : null) } as unknown as Document;
const el = (matches: string | null, editable = false) =>
  ({ closest: (sel: string) => (matches && sel.split(',').map(x => x.trim()).includes(matches) ? {} : null), isContentEditable: editable }) as unknown as Element;

test('a key on the page itself is the replay\'s (positive control)', () => {
  assert.equal(replayKeysBelongElsewhere(el(null), noDialog), false);
  assert.equal(replayKeysBelongElsewhere(null, noDialog), false);
});

test('a key typed into a field is the field\'s', () => {
  for (const tag of ['input', 'textarea', 'select']) assert.equal(replayKeysBelongElsewhere(el(tag), noDialog), true, tag);
  assert.equal(replayKeysBelongElsewhere(el(null, true), noDialog), true, 'contenteditable');
});

test('while a dialog is open, every key is the dialog\'s — Escape closes it, not the replay', () => {
  assert.equal(replayKeysBelongElsewhere(el(null), aDialog), true);
  assert.match(REPLAY_DIALOGS, /\.overlay/);
  assert.match(REPLAY_DIALOGS, /\.reportscrim/);
  const report = readFileSync(new URL('../report.ts', import.meta.url), 'utf8');
  assert.match(report, /<div class="reportscrim"/, 'the report form is a .reportscrim');
});

test('the keydown listener asks before it acts', () => {
  const src = readFileSync(new URL('../replaybar.ts', import.meta.url), 'utf8');
  const i = src.indexOf("document.addEventListener('keydown'");
  const body = src.slice(i, src.indexOf('{ capture: true }', i));
  assert.ok(body.indexOf('replayKeysBelongElsewhere(e.target)') > 0);
  assert.ok(body.indexOf('replayKeysBelongElsewhere(e.target)') < body.indexOf("e.key === ' '"), 'before the first key is taken');
});

test('the parted tint aims at the board that exists', () => {
  const css = readStyles();
  const rule = css.match(/body:has\(\.replaybar\.parted\) #app \.([\w-]+)\[data-focus\] \{/);
  assert.ok(rule, 'the tint rule');
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(main, new RegExp(`class="${rule![1]}[ "$][^>]*data-focus=`), `main.ts paints .${rule![1]} with data-focus`);
});
