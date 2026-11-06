/* A fanned row never spreads its cards apart, and never runs past its box
 * (owner, #steward, 2026-11-06, a game with Nyar while building an attack):
 * "their units get spread out over a very large area and there's a huge gap
 * between them … Nyar actually has *additional* units that are hidden and off
 * screen … There's no case where Nyar's cards should have this much space
 * between them."
 *
 * In a battle the opponent's In Play band is short, and with modded units in
 * it not even a floor-sized card stood in its height. ui/fit.ts fitCards then
 * found no grid at all and FANNED one row, with the step that spreads that row
 * over the band's whole width: six or seven units ~300px apart. And the step
 * did not count the zone's own gap (style.css `.zone` gap, which a fanned card
 * keeps), so the row ran `gap × (n - 1)` px past the band, and the zone, which
 * wraps, put its last card on a second line that the band clips — the unit
 * that was "hidden and off screen".
 *
 *   §1 ⭐ a short band holding a few units: they stand side by side, no wider
 *   §2 a fanned row — the CSS's own spacing, step plus gap — fits in its box
 *   §3 a crowded row still overlaps, and still spans the band
 *   §4 the counterattack send box (no gap between its cards) is unchanged
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATIO, fitCards, fitSendBox } from '../fit.ts';
import { leadPx } from '../layout.ts';

const GAP = 6;
/** how wide a fanned row stands in the stylesheet: the first card, then each
 * further card `step` past the one before plus the zone's gap
 * (41-regions-blocks.css `margin-left: calc(var(--fanstep) - var(--cw))`) */
const rowW = (n: number, cw: number, step: number): number => cw + (n - 1) * (step + GAP);

// the owner's screen: a ~1900px band, 60px tall, a unit with mod strips in it
const BAND = { w: 1900, h: 60 };
const MODDED = { cw: 86, gap: GAP, ratio: RATIO * 1.3 };

test('§1 ⭐ a few units in a short band stand side by side, not spread across it', () => {
  for (const n of [2, 3, 6, 7]) {
    const p = fitCards(n, BAND, MODDED);
    if (p.mode !== 'fan') continue;
    assert.ok(p.step <= p.cw,
      `${n} units: a fan step of ${p.step}px puts ${p.step - p.cw + GAP}px between cards of ${p.cw}px`);
  }
  // and so their row is short, and starts at the seam (ui/layout.ts theirLead)
  const p = fitCards(7, BAND, MODDED);
  const lead = leadPx(950, BAND.w, 7, p.cw, p.mode === 'fan' ? p.step : null);
  assert.equal(lead, 950, 'seven units start at the seam, not at the far edge');
});

test('§2 a fanned row, at the stylesheet\'s spacing, fits in its box', () => {
  for (const box of [BAND, { w: 300, h: 60 }, { w: 1206, h: 70 }, { w: 640, h: 140 }]) {
    for (const n of [2, 5, 7, 12, 40, 75]) {
      const p = fitCards(n, box, { cw: 78, gap: GAP, ratio: RATIO * 1.2 });
      if (p.mode !== 'fan') continue;
      const perRow = Math.ceil(n / p.rows);
      // the 14px minimum step may still overflow a box that is simply too
      // small for the cards — that is the floor, not this bug
      if (p.step === 14) continue;
      assert.ok(rowW(perRow, p.cw, p.step) <= box.w,
        `${n} cards in ${box.w}×${box.h}: the row stands ${rowW(perRow, p.cw, p.step)}px — it wraps, and the last card is clipped`);
    }
  }
});

test('§3 a crowded row still overlaps, and still reaches across the band', () => {
  const p = fitCards(40, { w: 1206, h: 70 }, { cw: 78, gap: GAP });
  assert.equal(p.mode, 'fan');
  assert.ok(p.step < p.cw, 'forty cards overlap');
  const w = rowW(40, p.cw, p.step);
  assert.ok(w <= 1206 && w > 1206 - 60, `the row spans the band (${w}px of 1206)`);
});

test('§4 the counterattack send box keeps its own spacing', () => {
  // its cards stand with no gap (41-regions-blocks.css column-gap: 0), each
  // `step` wide, and its step is the row's width over the cards a row holds
  const p = fitSendBox(30, { w: 600, h: 130 }, { cw: 78, gap: GAP });
  assert.equal(p.mode, 'fan');
  assert.equal(p.step, Math.min(Math.floor((600 - p.cw) / (p.cols - 1)), Math.floor(600 / p.cols)));
});
