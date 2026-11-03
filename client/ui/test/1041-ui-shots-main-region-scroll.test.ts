/* 1041 — UI-SHOTS FAILS A HOME WHOSE MAIN REGION SCROLLS (2026-11-03).
 *
 * The shell is exactly the window and its main region scrolls inside itself,
 * so a Play card taller than the window never makes the DOCUMENT scroll —
 * 1012's pageScrolls cannot see it. That is how the Draft tab's new rows first
 * ran ~100px past the foot of a 1024×768 window with every check green.
 *
 * §1 the walk measures the shell's main region, and regionScrolls reads it
 *    (one pixel of rounding allowed; a page with no shell never fails it)
 * §2 ui-shots really holds noScroll states to it and fails the run
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionScrolls } from '../../server/e2e/ui-shots-overflow.mjs';

test('1041 §1 regionScrolls: taller than the region is a scroll; a page with no shell is not', () => {
  assert.equal(regionScrolls({ region: { scrollH: 650, H: 650 } }), false);
  assert.equal(regionScrolls({ region: { scrollH: 651, H: 650 } }), false, 'a pixel of rounding');
  assert.equal(regionScrolls({ region: { scrollH: 745, H: 650 } }), true);
  assert.equal(regionScrolls({ region: null }), false, 'no shell on the page');
  const walk = readFileSync(new URL('../../server/e2e/ui-shots-overflow.mjs', import.meta.url), 'utf8');
  assert.match(walk, /querySelector\('\.ui-app-shell__main'\)/, 'the walk does not measure the shell\'s main region');
  assert.match(walk, /region = main \? \{ scrollH: main\.scrollHeight, H: main\.clientHeight \}/);
});

test('1041 §2 ui-shots fails a noScroll state whose main region scrolls', () => {
  const src = readFileSync(new URL('../../server/e2e/ui-shots.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*\bregionScrolls\b[^}]*\} from '\.\/ui-shots-overflow\.mjs'/);
  const at = src.indexOf('if (s.noScroll && NO_SCROLL_VIEWPORTS.includes(vpName) && ov && regionScrolls(ov)) {');
  assert.ok(at > 0, 'ui-shots does not hold noScroll states to their main region');
  const branch = src.slice(at, src.indexOf('\n          }\n', at));
  assert.match(branch, /problems\.push\(/);
  assert.match(branch, /noScrollFailed = true;/);
});
