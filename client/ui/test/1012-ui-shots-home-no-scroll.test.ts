/* 1012 — UI-SHOTS FAILS A HOME THAT SCROLLS (client/docs/24-redesign/, 2026-11-03).
 *
 * The browser half of "the home is one window" (1010 is the CSS half): every
 * home__* state ui-shots photographs is marked `noScroll`, and a run in which
 * such a state's document is taller (or wider) than the window at desktop or
 * tablet lists it as a problem and exits 1. A phone may scroll (docs/24:
 * phones are stacked, not designed for).
 *
 * §1 pageScrolls: the document against the window, both ways
 * §2 every home state is held to it, at desktop and tablet only — including
 *    the tabs and sheets the old home had as folds
 * §3 ui-shots.mjs really calls it on noScroll states and sets a failing exit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_SCROLL_VIEWPORTS, pageScrolls } from '../../server/e2e/ui-shots-overflow.mjs';
import { SCENARIOS } from '../../server/e2e/ui-shots-states.mjs';

const FX = { seasons: { running: 's1' }, challenge: { current: 'c1', past: 'c0' }, sharedDeck: 'd1', decks: { pub: 'dp', unlisted: 'du', maybe: 'dm' }, cc: { deck: 'd2', room: 'R', seat: 0 } };

test('1012 §1 pageScrolls: taller or wider than the window is a scroll; exactly the window is not', () => {
  assert.equal(pageScrolls({ scrollW: 1440, scrollH: 900, W: 1440, H: 900 }), false);
  assert.equal(pageScrolls({ scrollW: 1440, scrollH: 901, W: 1440, H: 900 }), true, 'one pixel taller');
  assert.equal(pageScrolls({ scrollW: 1025, scrollH: 768, W: 1024, H: 768 }), true, 'one pixel wider');
  assert.deepEqual([...NO_SCROLL_VIEWPORTS].sort(), ['desktop', 'portrait', 'tablet'], 'the upright iPad too (BL-65)');
});

test('1012 §2 every home state is held to the window', () => {
  const homes = SCENARIOS(FX).filter(s => s.page === 'home');
  const names = homes.map(s => s.state);
  for (const want of ['signed-out', 'signed-in', 'constructed', 'competitive', 'pick-now', 'join-open', 'info-open',
    'updates-open', 'customrules-open', 'bell-open', 'cc-your-matches',
    // 2026-11-03 round 2: the custom rules on the Draft tab, and the match clock
    'beginner', 'cards-rules', 'ban-typing', 'competitive-clock-off']) {
    assert.ok(names.includes(want), `home__${want} is not photographed`);
  }
  assert.ok(!names.includes('folds-open'), 'the home has no folds any more');
  assert.deepEqual(homes.filter(s => !s.noScroll).map(s => s.state), [], 'a home state is not held to the window');
});

test('1012 §3 ui-shots checks noScroll states and fails the run', () => {
  const src = readFileSync(new URL('../../server/e2e/ui-shots.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*\bpageScrolls\b[^}]*\} from '\.\/ui-shots-overflow\.mjs'/);
  const at = src.indexOf('if (s.noScroll && NO_SCROLL_VIEWPORTS.includes(vpName) && (!ov || pageScrolls(ov))) {');
  assert.ok(at > 0, 'ui-shots does not hold noScroll states to the window');
  const branch = src.slice(at, src.indexOf('\n          }\n', at));
  assert.match(branch, /problems\.push\(/, 'a scrolling home is not listed as a problem');
  assert.match(branch, /noScrollFailed = true;/);
  assert.match(src, /if \(noScrollFailed\) \{[^\n]*process\.exitCode = 1;/, 'the run does not fail');
});
