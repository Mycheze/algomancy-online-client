/* Report #364 (CT-551, mycheze, TUDN, 2026-11-09, ux):
 *
 *   "When you hover over a prophecied card you should still be able to see the
 *    "countdown" stuff as "chips" on the card. You can still see when you're
 *    NOT hovering over it, but now you can't really tell when zoomed in"
 *
 * The cache thumbs in a player's info block (main.ts regionCacheHtml) wear
 * their cacheChip — ⏳ 1/4, waiting, ✓ free, ⚡ turn — as a `.cchip` BESIDE
 * the card, inside `.cthumb`. The hover zoom copies the `.card` alone, and
 * decorateZoom only re-hung chips it found IN the card or rebuilt for a unit,
 * a hand card or a stack item, so the zoomed copy had no count. The cache
 * dialog and the hand-side strip put the chip inside the card and kept it.
 *
 * Now the thumb's card names its entry (`data-cslot="<seat>:<index>"`) and the
 * zoom decorator hangs that entry's cacheChip on the copy as a die.
 *
 * Driven through the real client (test/ui-driver.ts): the board is the one
 * main.ts paints, the element is the one a hover would land on, and the
 * decorator is the one main.ts registered with ui/zoom.ts. The driver lays
 * nothing out, so the copy is a stub that records what is hung on it.
 *
 * Seeds 11990-11999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import { client, elementFor } from './ui-driver.ts';
import { zoomDecorator } from '../zoom.ts';

const ui = await client();

/** the copy zoom.ts would hand the decorator: a thumb's card has no chip
 * strip, damage marker or mod strips of its own, so every query misses */
function stubCopy(): { el: HTMLElement; hung: () => string } {
  const parts: string[] = [];
  const el = {
    insertAdjacentHTML: (_where: string, html: string) => { parts.push(html); },
    querySelector: () => null,
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: { setProperty: () => {} },
  } as unknown as HTMLElement;
  return { el, hung: () => parts.join('') };
}

/** zoom the table thumb carrying `slot`, as a hover would */
function zoomThumb(board: string, slot: string): string {
  const src = elementFor(board, { cslot: slot }) as unknown as HTMLElement;
  const deco = zoomDecorator();
  assert.ok(deco, 'main.ts registered a zoom decorator');
  const copy = stubCopy();
  deco(src, copy.el);
  return copy.hung();
}

test("report 364 - zooming the opponent's prophesied card in their cache keeps its countdown", () => {
  const h = new Harness(11990);
  toDeployment(h);
  // Debeli's shape: seat 1's counting prophecy, watched from seat 0
  withE(h, e => { e.cacheCard(1, 'Hooba-God', 'effect', { prophecy: '4 Turns Pass' }); });
  toNextBattle(h);                                           // 1 of 4
  ui.join(h.state, 0, []);
  const board = ui.update(h.state, []);
  assert.match(board, /class="cchip proph">⏳ 1\/4</, 'the premise: the table thumb shows the count beside the card');
  const hung = zoomThumb(board, '1:0');
  assert.match(hung, /<div class="zoomdice">[^]*⏳ 1\/4[^]*<\/div>/, 'the zoomed copy wears the count as a die');
  assert.match(hung, /title="Prophecy: 4 Turns Pass\. 1 of 4 turns so far"/, 'with the same full sentence on hover');
});

test('report 364 - a state-condition prophecy zooms with "waiting", your own cache too', () => {
  const h = new Harness(11991);
  toDeployment(h);
  withE(h, e => {
    e.cacheCard(0, 'Hooba-God', 'effect', { prophecy: '4 Turns Pass' });
    e.cacheCard(0, 'Wisp', 'effect', { prophecy: 'Your life is 10 or less' });
  });
  ui.join(h.state, 0, []);
  const board = ui.update(h.state, []);
  assert.match(zoomThumb(board, '0:0'), /class="zoomdice">[^]*⏳ 0\/4/, 'the counting one: 0 of 4');
  assert.match(zoomThumb(board, '0:1'), /class="zoomdice">[^]*>waiting</, 'the state one: waiting');
});

test('report 364 - every cache thumb on the table names its entry, so none zooms bare', () => {
  const h = new Harness(11992);
  toDeployment(h);
  withE(h, e => {
    e.cacheCard(0, 'Hooba-God', 'effect', { prophecy: '4 Turns Pass' });
    e.cacheCard(1, 'Wisp', 'effect', { prophecy: 'Your life is 10 or less' });
  });
  ui.join(h.state, 0, []);
  const board = ui.update(h.state, []);
  const thumbs = board.split('class="cthumb"').slice(1);
  assert.ok(thumbs.length >= 2, `both caches have a thumb on the table (${thumbs.length})`);
  for (const t of thumbs) assert.match(t.slice(0, t.indexOf('class="cchip')), /data-cslot="\d:\d+"/, 'the thumb\'s card carries its slot');
});
