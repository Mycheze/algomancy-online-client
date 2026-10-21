/* WHERE A CARD LANDS IN A PILE (ui/piletable.ts) — the pure geometry.
 *
 * The drop preview and the drop itself are computed by the same functions,
 * so the gap a carried card opens is where it lands. These pin them, and the
 * CSS that makes "painted in front" true: v1 cascaded a pile with negative
 * margins, so every later card painted over an earlier one and a card dropped
 * mid-pile showed only its top sliver ("it went to the back of the column").
 *
 *   §1 the strip S: a fifth of the card, tightened when the pile would
 *      overflow the pane, never under 14px
 *   §2 insertIndexAt: strips' halves, the last card's face, clamps, and the
 *      same-pile n' (the carried card counted as gone)
 *   §3 stripIndexAt: the same, sideways, with the box's scroll
 *   §4 previewShift: the cards from the gap slide one strip, the carried
 *      card's own place closes up — and the preview and the commit agree
 *   §5 the card width per screen
 *   §6 the CSS: absolutely placed cards, z-index by index, the dropped card
 *      above every sibling, no negative-margin cascade
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import {
  CARD_ASPECT, MIN_STRIP, cardHeight, cardWidth, fanHeight, insertIndexAt, previewShift, stripIndexAt, stripOf,
} from '../piletable.ts';
import { movePileCard } from '../deckarrange.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(UI, 'style.css'), 'utf8');

test('§1 the strip: a fifth of the card, tightened to fit, never under 14px', () => {
  const ch = cardHeight(132);
  assert.equal(ch, Math.round(132 * CARD_ASPECT));
  assert.equal(stripOf(1, 800, ch), Math.round(ch * 0.2), 'one card: the full strip (unused)');
  assert.equal(stripOf(5, 2000, ch), Math.round(ch * 0.2), 'room to spare: a fifth');
  const S = stripOf(20, 600, ch);
  assert.ok(fanHeight(20, S, ch) <= 600, `20 cards fit a 600px pane at S=${S}`);
  assert.ok(S < Math.round(ch * 0.2));
  assert.equal(stripOf(200, 600, ch), MIN_STRIP, 'and never below the minimum');
  assert.equal(fanHeight(0, 30, ch), 0);
  assert.equal(fanHeight(3, 30, ch), ch + 60);
});

test('§2 insertIndexAt: halves of a strip, the last card’s face, clamps', () => {
  const S = 30, ch = 180, top = 100;
  assert.equal(insertIndexAt(top - 50, top, S, 4, ch), 0, 'above the pile: the top');
  assert.equal(insertIndexAt(top + 5, top, S, 4, ch), 0, 'card 0’s upper half: before it');
  assert.equal(insertIndexAt(top + 20, top, S, 4, ch), 1, 'its lower half: after it');
  assert.equal(insertIndexAt(top + 2 * S + 10, top, S, 4, ch), 2);
  // card 3 is the last, drawn whole from 3S to 3S + ch
  assert.equal(insertIndexAt(top + 3 * S + 10, top, S, 4, ch), 3, 'the last card’s upper face: before it');
  assert.equal(insertIndexAt(top + 3 * S + ch / 2 - 1, top, S, 4, ch), 3);
  assert.equal(insertIndexAt(top + 3 * S + ch / 2, top, S, 4, ch), 4, 'past its middle: the end');
  assert.equal(insertIndexAt(top + 5000, top, S, 4, ch), 4, 'clamped to n');
  assert.equal(insertIndexAt(top + 300, top, S, 0, ch), 0, 'an empty pile takes it at 0');
  // the same pile: 5 drawn, the carried one counted as gone → n' = 4
  assert.equal(insertIndexAt(top + 4 * S + ch, top, S, 5 - 1, ch), 4, 'n′, not n');
  for (let y = top - 40; y < top + 400; y += 7) {
    const i = insertIndexAt(y, top, S, 6, ch);
    assert.ok(Number.isInteger(i) && i >= 0 && i <= 6);
    assert.ok(insertIndexAt(y + 7, top, S, 6, ch) >= i, 'monotone down the pile');
  }
});

test('§3 stripIndexAt: the same rule sideways, the box’s scroll added', () => {
  const Sx = 40, cw = 108;
  assert.equal(stripIndexAt(10 + 5, 10, 0, Sx, 6, cw), 0);
  assert.equal(stripIndexAt(10 + 25, 10, 0, Sx, 6, cw), 1);
  assert.equal(stripIndexAt(10 + 25, 10, 2 * Sx, Sx, 6, cw), 3, 'scrolled two cards along');
  assert.equal(stripIndexAt(10 + 5 * Sx + cw, 10, 0, Sx, 6, cw), 6, 'past the last card’s middle: the end');
});

test('§4 previewShift opens the gap where the commit puts the card', () => {
  // from elsewhere: cards from the gap down slide one strip
  assert.deepEqual([0, 1, 2, 3].map(k => previewShift(k, -1, 2)), [0, 0, 1, 1]);
  // from this pile (index 0) to index 2: card 0 is hidden, 1 and 2 close up, 3+ make room
  assert.deepEqual([0, 1, 2, 3, 4].map(k => previewShift(k, 0, 2)), [0, -1, -1, 0, 0]);
  // and the drawn slots, with the carried card put in the gap, are the order movePileCard commits
  const names = ['a', 'b', 'c', 'd', 'e'];
  for (let src = 0; src < names.length; src++) {
    for (let to = 0; to < names.length; to++) {
      const slots = new Map<number, string>();
      names.forEach((n, k) => { if (k !== src) slots.set(k + previewShift(k, src, to), n); });
      slots.set(to, names[src]!);
      const drawn = [...slots.entries()].sort((x, y) => x[0] - y[0]).map(e => e[1]);
      const pile = movePileCard([{ id: 'p1', name: 'P', cards: names }], 'p1', src, 'p1', to)[0]!.cards;
      assert.deepEqual(drawn, pile, `src ${src} → ${to}: the preview is the result`);
    }
  }
});

test('§5 the card width per screen', () => {
  assert.equal(cardWidth({ touch: false, width: 1440 }), 132);
  assert.equal(cardWidth({ touch: false, width: 1366 }), 108);
  assert.equal(cardWidth({ touch: true, width: 1440 }), 108);
  assert.equal(cardWidth({ touch: true, width: 899 }), 88);
});

test('§6 the CSS: placed cards, z-index by index, the dropped card in front, no cascade', () => {
  const at = CSS.indexOf('/* ── THE TABLETOP');
  const end = CSS.indexOf('/* ── THE BINDER');
  assert.ok(at > 0 && end > at, 'the tabletop block is where it was');
  const block = CSS.slice(at, end);
  assert.ok(at < CSS.indexOf('THE REGIONS BOARD'), 'above the regions banner (318 §6)');
  const card = /\n\.ttcard \{([^}]*)\}/.exec(block)?.[1] ?? '';
  assert.match(card, /position: absolute/);
  assert.match(card, /z-index: var\(--k\)/, 'a later card paints over an earlier one');
  const front = Number(/\.ttcard\.ttfront \{ z-index: (\d+)/.exec(block)?.[1]);
  assert.ok(front > 200, `the dropped card is above any pile’s cards (z ${front})`);
  assert.doesNotMatch(block, /margin(-top|-bottom)?:\s*-/, 'no negative-margin cascade');
  assert.doesNotMatch(block, /\.droptarget|\.dttarget/, 'no target outlines');
});
