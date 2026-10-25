/* CT-368 — ON THE REGIONS BOARD, A SPECTATOR'S VIEW OF THE TOP SEAT'S HAND.
 *
 * With both hands shown, the top seat's full hand (`.lspect`) was a fourth
 * row of the info block, under the name, the resources and the hand line, in
 * a block that clips (`container-type: size`). Measured in headless Chrome on
 * ?question=transmogrifant-control-change: at 1440x900 the strip started at
 * y=191 in a block ending at y=221, so ~25px of 108px-tall cards showed; at
 * 1280x720 ~9px.
 *
 * Now it is a column of its own, between the name column and the cache and
 * bin, spanning the block's height (the last row takes the slack). Measured
 * after: 1440x900 cards 92x128 whole; 1920x1080 92x128 (capped at the hand
 * dock's width); 1280x720 39x55 whole (the block itself is 85px tall there);
 * nine cards in the 1440x900 strip all fit at 31px.
 *
 * The geometry is the browser's; what can be held here is the grid that gives
 * the strip its column, in both of the block's shapes, and only when drawn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');

/** every rule body for an exact selector, in source order */
function rules(selector: string): string[] {
  const out: string[] = [];
  for (let i = CSS.indexOf(`${selector} {`); i >= 0; i = CSS.indexOf(`${selector} {`, i + 1)) {
    out.push(CSS.slice(i, CSS.indexOf('}', i)));
  }
  return out;
}

test('CT-368: the spectated hand has a column of its own the height of the info block, in both block shapes', () => {
  const sel = '.linfo.theirs > .lin:has(> .lspect)';
  const bodies = rules(sel);
  assert.equal(bodies.length, 2, 'one grid for the full block, one for the squeezed (battle) block');
  for (const body of bodies) {
    const areas = /grid-template-areas:\s*((?:"[^"]*"\s*)+)/.exec(body)?.[1] ?? '';
    const rows = areas.match(/"[^"]*"/g) ?? [];
    assert.ok(rows.length >= 2, `${sel} names its rows`);
    assert.ok(rows.every(r => /\bspect\b/.test(r)),
      `the strip is in EVERY row, so it spans the block rather than taking what is left of it: ${areas}`);
    assert.match(body, /grid-template-rows:[^;]*minmax\(0, 1fr\);/, 'the last row takes the slack');
  }
  assert.match(CSS, /\.linfo \.lspect \{ grid-area: spect;/, 'the strip sits in that area');
});

test('CT-368: its cards are sized from the strip height and shrink together when the hand is long', () => {
  assert.match(CSS, /\.linfo \.lspect > \.zone > \.card \{ flex: 0 1 min\(92px, calc\(\(100cqh - 18px\) \/ 1\.4\)\); width: auto; min-width: 0; \}/);
  assert.match(CSS, /\.linfo \.lspect \{[^}]*container-type: size;/, 'the strip is the size its cards are measured against');
});
