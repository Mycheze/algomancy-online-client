/* BL-12 — LEARN TO PLAY ENDS AT THE SHOP.
 *
 * BL-12's last doneWhen: "It ends by pointing at the shop: both links from
 * BL-15, with an honest line about supporting the creator." The owner,
 * 2026-08-25: "Give them the links and recommend buying the game or AT LEAST
 * the print and play version to support the creator of this excellent game."
 * BL-15 fixes the two URLs and their order (box first).
 *
 * Until 2026-10-25 the end lesson's "Where next" page had no link at all;
 * the shop lived only in ui/legal.ts's footer and pages. This reads the page
 * through the same builder the lesson window paints with (windowHtml), so a
 * figure that never renders, or a link that leaves for the same tab and
 * drops the learner's game, fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/index.ts';
import { windowHtml } from '../lessonlayer.ts';
import { END } from '../lessons.ts';
import { BUY_PHYSICAL, BUY_PNP } from '../legal.ts';

const lastPage = END.pages.length - 1;
const html = windowHtml({ lesson: END, page: lastPage, ctx: null, judge: [], judgeBusy: false, judgeDraft: '' });

test('CR D8.1 / BL-12: the last page of the end lesson links both shop URLs, the physical game first', () => {
  assert.equal(END.pages[lastPage]!.title, 'Where next', 'the shop is on the page the tutorial ends on');
  const box = html.indexOf(`href="${BUY_PHYSICAL}"`);
  const pnp = html.indexOf(`href="${BUY_PNP}"`);
  assert.ok(box >= 0, 'the physical game is linked');
  assert.ok(pnp >= 0, 'the print-and-play is linked');
  assert.ok(box < pnp, 'box first, then print-and-play (the owner order, BL-15)');
});

test('CR D8.1 / BL-12: both shop links open a new tab, so the learner keeps the game', () => {
  for (const url of [BUY_PHYSICAL, BUY_PNP]) {
    const a = new RegExp(`<a [^>]*href="${url.replace(/[.?/]/g, '\\$&')}"[^>]*>`).exec(html)?.[0] ?? '';
    assert.match(a, /target="_blank"/, `${url}: a new tab`);
    assert.match(a, /rel="noopener noreferrer"/, `${url}: no opener`);
  }
});

test('CR D8.1 / BL-12: the end lesson recommends buying the game to support its creator', () => {
  assert.match(html, /Buy the game<\/b>, or at least the print-and-play, to support the creator/);
  for (const p of END.pages.slice(0, lastPage)) {
    const earlier = windowHtml({ lesson: END, page: END.pages.indexOf(p), ctx: null, judge: [], judgeBusy: false, judgeDraft: '' });
    assert.ok(!earlier.includes(BUY_PNP), `${p.title}: the shop waits for the last page`);
  }
});
