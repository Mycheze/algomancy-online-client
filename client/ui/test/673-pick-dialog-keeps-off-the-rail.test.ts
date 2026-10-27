/* CT-369 — WITH A DRAFT OR BOTTOM PICK UP, THE RAIL STILL WORKS.
 *
 * Measured in headless Chrome (room DRFT, a draft pick, regions board,
 * 1440x900): the pick box ran 1180px wide centred on the WINDOW, 128px into
 * the rail, and its own "look at the board" button sat exactly over the rail's
 * report button — so a click on report hid the pick and opened nothing. On
 * other widths the click lands on the pick's dim, which hides it the same way.
 *
 * After: the rail stands above the pick's dim and the box is centred in the
 * window left of the rail. Driven in Chrome at 1100x800, 1280x720, 1440x900
 * and 1920x1080 on both boards: the element under the report button's centre
 * is the button, one click opens the report, and the pick stays up.
 *
 * Board round 8 made that rail a 50px toolbar at every width (there is no
 * narrow-screen drawer any more), so the rail rule below holds at every width.
 *
 * Geometry is the browser's. What is held here: the clearance arithmetic, that
 * the stylesheet puts the rail over the pick's dim, and that relayout applies it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { railClearance } from '../railclear.ts';

const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');
const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');

test('CT-369: the pick dialog leaves the rail clear on the right, and only when the rail is beside the table', () => {
  // board round 8: the regions board's rail is the 50px toolbar — #app's 2px
  // padding and the strip, at every width (measured in Chrome at 1344x768:
  // the toolbar's left edge at 1292)
  assert.equal(railClearance(1440, { left: 1388, top: 2, width: 50 }), 52, 'the toolbar at 1440');
  assert.equal(railClearance(1920, { left: 1658, top: 2, width: 50 }), 262, 'a wide window: the board is centred');
  assert.equal(railClearance(800, { left: 748, top: 2, width: 50 }), 52, 'and at 800: no drawer any more, the strip is beside the table');
  // the classic board's rail (until it is deleted)
  assert.equal(railClearance(1440, { left: 1182, top: 8, width: 250 }), 258, 'the measured 1440x900 classic board');
  assert.equal(railClearance(1440, null), 0, 'no rail drawn');
  assert.equal(railClearance(800, { left: 8, top: 900, width: 784 }), 0, 'a rail stacked under the board');
  assert.equal(railClearance(800, { left: 815, top: 0, width: 300 }), 0, 'a box parked off the window\'s right edge');
  assert.equal(railClearance(1440, { left: 1182, top: 8, width: 0 }), 0, 'a rail with no box');
});

/** the z-index a rule sets, by its exact selector */
function zOf(selector: string): number {
  const i = CSS.indexOf(`${selector} {`);
  assert.ok(i >= 0, `style.css has a rule for ${selector}`);
  const body = CSS.slice(i, CSS.indexOf('}', i));
  const z = /z-index:\s*(\d+)/.exec(body);
  assert.ok(z, `${selector} sets a z-index`);
  return Number(z![1]);
}

test('CT-369: while the pick is up the rail stands above its dim, and the box keeps to the window left of it', () => {
  assert.ok(zOf('#app.board.pickup > .side') > zOf('.overlay.pickover'),
    'the rail is above the pick dim, so a click on report reaches report');
  assert.ok(zOf('#app.board.pickup > .side') < zOf('.overlay'),
    'and still under every other dialog, which may open over the pick (the judge, the rules)');
  assert.match(CSS, /\.overlay\.pickover \{ padding-right: var\(--pick-railclear, 0px\); \}/);
  assert.match(CSS, /\.overlaybox\.pickbox \{ max-width: 100%; \}/, 'a box never wider than what is left');
  assert.match(MAIN, /setProperty\('--pick-railclear',\s*`\$\{railClearance\(innerWidth,/,
    'relayout (after every paint and resize) measures the rail and sets the clearance');
  assert.match(MAIN, /\$app\.classList\.toggle\('pickup', pickOpen\(\)\)/, 'and the board says when the pick is up');
});
