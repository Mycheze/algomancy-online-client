/* The league availability grid: a finger scrolls, a tap toggles, the keyboard
 * works, a screen reader can read it, and a fast drag paints every cell.
 *
 * Found 2026-11-02 in a browser (390px, touch emulation): `.lggrid` was
 * `touch-action: none` and pointerdown called preventDefault for every
 * pointer, so a swipe on the grid — 880px tall, more than a phone's screen —
 * scrolled 0px and painted 11 cells instead; the cells were bare divs, so Tab
 * never reached them; and a quick mouse stroke left gaps, because only the
 * cell under each pointermove sample was painted.
 *
 * Owner, 2026-11-02 ("tap cells + arrow keys"): a swipe scrolls, a tap
 * toggles one cell, a mouse drag paints as before; Tab reaches the grid, the
 * arrows move a visible focus cell, Space toggles it; role=grid/gridcell with
 * aria-selected, labelled by day and hour.
 *
 * league.ts paints into the DOM, so this reads its source and the stylesheet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';

const src = readFileSync(new URL('../league.ts', import.meta.url), 'utf8');
const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
const grid = src.slice(src.indexOf('function wireGrid'), src.indexOf('\n}\n', src.indexOf('function wireGrid')));
const rule = (sel: string): string => css.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

test('positive control: the grid and its wiring are where this expects', () => {
  assert.match(src, /<div class="lggrid" id="lg-grid"/);
  assert.ok(grid.length > 500);
  assert.ok(rule('.lggrid'), 'the .lggrid rule');
});

test('a finger scrolls the page: no touch-action none, no preventDefault for touch', () => {
  assert.doesNotMatch(rule('.lggrid'), /touch-action:\s*none/);
  const down = grid.slice(grid.indexOf('el.onpointerdown'), grid.indexOf('el.onpointermove'));
  const bail = down.indexOf("if (e.pointerType === 'touch') return;");
  assert.ok(bail > 0 && bail < down.indexOf('e.preventDefault()'), 'touch leaves before the default is prevented');
});

test('a tap toggles one cell (the click a tap sends; a scroll sends none)', () => {
  const click = grid.slice(grid.indexOf('el.onclick'), grid.indexOf('el.onkeydown'));
  assert.match(click, /if \(lastPointer !== 'touch'\) return;/, 'a mouse drag is not toggled twice');
  assert.match(click, /toggle\(cell\)/);
});

test('the keyboard: one tabbable cell, arrows move it, Space and Enter toggle', () => {
  assert.match(src, /tabindex="\$\{i === \(gridFocus \?\? [^)]*\) \? 0 : -1\}"/, 'roving tabindex');
  const keys = grid.slice(grid.indexOf('el.onkeydown'));
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.ok(keys.includes(k), k);
  assert.match(keys, /if \(e\.key === ' ' \|\| e\.key === 'Enter'\) \{ e\.preventDefault\(\); toggle\(cell\);/);
  assert.match(keys, /rove\(next\); next\.focus\(\);/);
  assert.ok(rule('.lgcell:focus-visible').includes('outline'), 'the focus cell is visible');
});

test('a screen reader: grid, rows, headers, gridcells with aria-selected, labelled by day and hour', () => {
  assert.match(src, /id="lg-grid" role="grid" aria-label="[^"]+"/);
  assert.match(src, /role="columnheader"/);
  assert.match(src, /class="lghr" role="rowheader"/);
  assert.match(src, /role="gridcell" aria-selected="\$\{on\}" aria-label="\$\{label\}"/);
  assert.match(src, /const label = `\$\{DAY_NAMES\[day\]\} \$\{hourLabel\(h\)\}`;/);
  assert.match(grid, /cell\.setAttribute\('aria-selected', String\(v === '1'\)\)/, 'kept true as cells change');
  assert.match(rule('.lggrid .lgrow'), /display:\s*contents/, 'the rows do not break the layout');
});

test('a fast drag paints the whole way, not just where the samples landed', () => {
  const move = grid.slice(grid.indexOf('el.onpointermove'), grid.indexOf('el.onpointerup'));
  assert.match(move, /for \(const c of from \? line\(from, cell\) : \[cell\]\) put\(c, painting\);/);
});
