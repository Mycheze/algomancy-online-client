/**
 * The Card Stats tab (ui/cardstats.ts) on the metagame page (ui/meta.ts).
 *
 * Asserted over the SOURCE, as 214 does for the deck page: both files build
 * strings for `$app.innerHTML`, and each claim below is one edit away from
 * false without any other test noticing.
 *
 *   1. EVERY BUTTON THE PAGE DRAWS IS ANSWERED. The `meta-cs-*` names are
 *      collected from the markup, not listed here — a list would go on passing
 *      while a new button did nothing.
 *   2. THE URL IS THE PAGE. `?cardstats=` opens it on a cold load (a card's
 *      name opens that card), written with replaceState, never pushState.
 *   3. THE WAY IN FROM THE CARD BROWSER goes to this page, on that card.
 *   4. RAW NUMBERS. Every win rate cell prints its game count; the owner chose
 *      raw numbers over any smoothing, and the n is what makes a raw number
 *      honest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const cs = readFileSync(join(UI, 'cardstats.ts'), 'utf8');
const meta = readFileSync(join(UI, 'meta.ts'), 'utf8');
// the markup of all three is under pages/ since the design-system round
const csPage = readFileSync(join(UI, 'pages', 'cardstats.ts'), 'utf8');
const metaPage = readFileSync(join(UI, 'pages', 'meta.ts'), 'utf8');
const cardsPage = readFileSync(join(UI, 'pages', 'cards.ts'), 'utf8');

test('every meta-cs button the page draws has a case in handle()', () => {
  const drawn = new Set([...csPage.matchAll(/data-btn="(meta-cs-[a-z-]+)"/g)].map(m => m[1]!));
  // seg() and flag() (the segmented controls and toggles, 2026-11-04) build the
  // rest from a string argument
  for (const m of csPage.matchAll(/(?:seg|flag)\([^)]*?'(meta-cs-[a-z-]+)'/g)) drawn.add(m[1]!);
  assert.ok(drawn.size >= 10, `found only ${drawn.size} buttons — the scan has gone blind`);
  const handler = cs.slice(cs.indexOf('export function handle('));
  for (const b of drawn) assert.ok(handler.includes(`case '${b}'`), `${b} is drawn and nothing answers it`);
  assert.ok(meta.includes('cardstats.handle(btn)'), 'meta.ts must offer every click to the card stats module');
  // and the tab is drawn through the page module, inside meta's page
  assert.match(metaPage, /cardStatsHtml\(v\.stats\)/);
});

test('the URL is the page: ?cardstats= on a cold load, replaceState only', () => {
  assert.match(meta, /url\.has\('cardstats'\)/);
  assert.match(meta, /searchParams\.set\('cardstats', cardstats\.focused\(\) \?\? '1'\)/);
  for (const src of [cs, meta, csPage, metaPage]) {
    assert.ok(!/pushState/.test(src), 'one back-button step per filter click buries the app');
  }
});

test('the card browser opens this page on the card', () => {
  assert.match(cardsPage, /data-btn="meta-stats-open" data-card="\$\{esc\(r\.name\)\}"/);
  assert.match(meta, /case 'meta-stats-open':\s*\n\s*openStats\(btn\.dataset\['card'\]/);
});

test('every win rate is printed with its game count', () => {
  const cell = csPage.slice(csPage.indexOf('function wrCell('), csPage.indexOf('const iwdCell'));
  assert.match(cell, /<small>\$\{w\.n\}<\/small>/, 'a percentage without its n is a number nobody can judge');
  assert.ok(!/shrink|wilson|bayes/i.test(cs + csPage), 'raw numbers, by the owner\'s choice (2026-09-27)');
});
