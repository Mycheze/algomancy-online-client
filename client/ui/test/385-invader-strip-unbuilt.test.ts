/**
 * Report #200 (UTVU, 2026-10-06): "While my oppo is declaring counter
 * attackers, the sizes of their units are really weird."
 *
 * Watching the other seat declare with nothing placed yet, the fight draws
 * "nothing placed yet…" and no `.cols` at all — and `battlePlan` returned null
 * for a fight with no columns, so the fit pass never sized the invader strip.
 * The counterattackers standing in it kept their full 78px width inside a
 * strip 36px wide and stood clipped down the edge of the fight. Measured in a
 * real browser on a slice of UTVU at action 249: 78×108 cards in a 36px strip
 * before, 52×72 after.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBattle } from '../fit.ts';
import { fitBoard } from '../layout.ts';

const rect = (w: number, h: number) => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h });

/** a fight block with no columns and `n` cards in its invader strip — the
 * parts of the DOM the fit pass reads and writes, nothing else */
function unbuiltFight(n: number) {
  const props = (): { set: Map<string, string>; setProperty(k: string, v: string): void; removeProperty(k: string): void } => {
    const set = new Map<string, string>();
    return { set, setProperty: (k, v) => { set.set(k, v); }, removeProperty: k => { set.delete(k); } };
  };
  const strip = { style: props(), getBoundingClientRect: () => rect(36, 220), querySelectorAll: () => ({ length: n }) };
  const fight = {
    dataset: { fit: 'battle' } as Record<string, string>,
    style: props(),
    getBoundingClientRect: () => rect(580, 230),
    querySelector: (sel: string) => (sel === '.linvside' ? strip : null),
    querySelectorAll: (sel: string) => ({ length: sel === '.linvside .card' ? n : 0 }),
  };
  const root = { querySelectorAll: () => [fight] } as unknown as ParentNode;
  return { root, fight, strip };
}

test('report #200: with no columns placed yet, the invader strip is still sized', () => {
  const { root, strip } = unbuiltFight(4);
  fitBoard(root, 78);
  const cw = parseInt(strip.style.set.get('--cw') ?? '', 10);
  assert.ok(Number.isFinite(cw), 'the strip gets a card width of its own (it kept the full 78px before)');
  assert.ok(cw < 78, `and it is a strip card, smaller than a full one (got ${cw}px)`);
  assert.ok(strip.style.set.has('--invw'), 'the strip\'s own width is written too');
  assert.ok(strip.style.set.has('--invstep'), 'and how far its cards overlap to fit its height');
});

test('report #200: a fight with no columns and no invaders is still left alone', () => {
  const { root, fight } = unbuiltFight(0);
  fitBoard(root, 78);
  assert.equal(fight.style.set.size, 0, 'nothing to size, nothing written');
});

test('report #200: fitBattle plans the strip with zero columns', () => {
  const side = { n: 4, frac: 0.6, pad: 12 };
  const p = fitBattle(0, 0, 0, { w: 0, h: 0 }, { cw: 86, gap: 6, chrome: 8, floor: 40, side });
  assert.equal(p.cols, 0);
  assert.deepEqual(p.side, { cw: 52, w: 64 }, 'the same strip a fight with columns would carry');
});
