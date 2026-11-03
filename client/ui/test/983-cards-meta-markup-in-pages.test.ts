/* 983 — THE CARD BROWSER, METAGAME AND CARD STATS DRAW ONLY UNDER pages/.
 *
 * Their markup moved out of ui/cards.ts, ui/meta.ts and ui/cardstats.ts in the
 * design-system round (2026-11-03); those three keep the state, the fetches,
 * the URL and the clicks. A template that grows back in one of them is markup
 * no story and no DOM-free test (980–982) can see, which is the drift the move
 * ended. Read off the source: the controllers hold no markup and never write
 * #app themselves; each page module has the contract's three exports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** the code without its comments, which quote markup on purpose */
const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PAIRS = [
  { ctl: 'cards.ts', page: 'pages/cards.ts', trio: ['cardsView', 'cardsHtml', 'paintCards'] },
  { ctl: 'meta.ts', page: 'pages/meta.ts', trio: ['metaView', 'metaHtml', 'paintMeta'] },
  { ctl: 'cardstats.ts', page: 'pages/cardstats.ts', trio: ['cardStatsView', 'cardStatsHtml', 'paintCardStats'] },
];

test('983 §1 the controllers draw nothing', () => {
  for (const { ctl } of PAIRS) {
    const src = code(ctl);
    assert.doesNotMatch(src, /data-btn="/, `${ctl} draws a button again — markup belongs in pages/`);
    assert.doesNotMatch(src, /<(div|button|span|section|table|p|h1)\b/, `${ctl} holds a template again`);
    assert.doesNotMatch(src, /\.innerHTML\s*=/, `${ctl} writes the page itself — paint through pages/`);
  }
});

test('983 §2 each page module has the contract\'s three exports, and its controller paints through it', () => {
  for (const { ctl, page, trio } of PAIRS) {
    const src = read(page);
    for (const name of trio) {
      assert.match(src, new RegExp(`^export function ${name}\\(`, 'm'), `${page} exports ${name}()`);
    }
    // cardstats paints inside meta's page, so meta is the one that calls its paint
    const caller = ctl === 'cardstats.ts' ? 'pages/meta.ts' : ctl;
    assert.match(code(caller), new RegExp(`\\b${trio[2]}\\(`), `${caller} paints through ${trio[2]}()`);
  }
});

test('983 §3 positive control: the page modules do hold the markup', () => {
  for (const { page } of PAIRS) assert.match(code(page), /data-btn="/, `${page} draws its buttons`);
});
