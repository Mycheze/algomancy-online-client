/* Off the board, hovering a card's tile or name shows its text box.
 *
 * The deck page, the card browser, the metagame and card stats draw cards as
 * `data-prev` tiles and rows (`.dkart`, `.cbrow`, …). None is a `.card`, so
 * the board's zoom (zoom.ts zoomTarget) never matches them, and what they had
 * was the long-hover text box, armed by main.ts's document `mouseover` for any
 * `[data-prev]`. Board round 8 (b8f8a662, 2026-10-29) deleted that branch
 * together with the classic board, and from then on these pages showed nothing
 * on hover — while decks.ts and cards.ts still said, in their headers, that
 * the hover box worked there (found 2026-11-02 in a browser: no #hovertip, no
 * #cardzoom, on any of them).
 *
 * main.ts is DOM code that boots on import, so this reads the handler's source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const start = main.indexOf("document.addEventListener('mouseover'");
const handler = main.slice(start, main.indexOf('\n});\n', start));

test('positive control: the handler, the art-tip branch and the zoom are where this expects', () => {
  assert.ok(start > 0);
  assert.match(handler, /closest\?\.\('\[data-prevart\]'\)/);
  assert.match(handler, /zoomAt\(e\.target as Element\)/);
});

test('off the board, a [data-prev] target arms the hover box before the zoom is tried', () => {
  const branch = handler.indexOf("closest?.('[data-prev], [data-previd]')");
  assert.ok(branch > 0, 'the handler looks for [data-prev] itself');
  const guard = handler.lastIndexOf("if (!$app.classList.contains('board') && pointerCanHover())", branch);
  assert.ok(guard > 0 && branch - guard < 200, 'only off the board, and only for a mouse');
  assert.match(handler.slice(branch, branch + 300), /armHoverTip\(prev,/);
  assert.ok(branch < handler.lastIndexOf('zoomAt('), 'it runs before the zoom');
});

test('the pages it is for really draw data-prev on things that are not .card', () => {
  const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  // the browser's markup is pages/cards.ts since the design-system round
  assert.match(read('pages/cards.ts'), /<div class="cbrow[^"]*"\s+data-prev=/);
  assert.match(read('pages/cards.ts'), /<div class="dktile cbtile[^"]*"\s+data-prev=/);
  assert.match(read('pages/meta.ts'), /data-prev="\$\{esc\(name\)\}" data-btn="meta-focus"/);
  assert.match(read('pages/cardstats.ts'), /<button class="csname" data-btn="meta-cs-focus" data-card="\$\{esc\(name\)\}" data-prev=/);
  assert.match(read('decks.ts'), /data-prev=/);
});
