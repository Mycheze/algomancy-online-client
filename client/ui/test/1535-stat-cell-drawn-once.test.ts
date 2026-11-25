/**
 * A stat grid's cell is drawn by one helper, pages/statcell.ts: no other module
 * under ui/ writes its markup, and the pages that show one draw it through it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { analyzeDeck } from '../deckstats.ts';
import { deckStatsHtml } from '../pages/deckstats.ts';
import { scoreHtml } from '../pages/challengerun.ts';
import { statCell } from '../pages/statcell.ts';

const UI = dirname(dirname(fileURLToPath(import.meta.url)));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'test' || f === 'node_modules' ? [] : sources(p);
    return f.endsWith('.ts') ? [p] : [];
  });
}

test('BL-10: only pages/statcell.ts writes a stat cell\'s markup', () => {
  const files = sources(UI);
  assert.ok(files.length > 100, `reads the client, not an empty directory (${files.length})`);
  const writers = files.filter(f => /class="stat(?:cell|val|lab)\b/.test(readFileSync(f, 'utf8')))
    .map(f => relative(UI, f));
  assert.deepEqual(writers, ['pages/statcell.ts']);
  for (const page of ['league.ts', 'deckstats.ts', 'challengerun.ts']) {
    assert.match(readFileSync(join(UI, 'pages', page), 'utf8'), /statCell\(/, `pages/${page} draws its cells with statCell`);
  }
});

test('BL-10: statCell draws value over label, escaped, with its hover', () => {
  assert.equal(statCell('players', 12),
    '<div class="statcell"><div class="statval">12</div><div class="statlab">players</div></div>');
  assert.equal(statCell('now', '<b>', { title: 'a "hover"', valueClass: 'lgphase' }),
    '<div class="statcell" title="a &quot;hover&quot;"><div class="statval lgphase">&lt;b&gt;</div><div class="statlab">now</div></div>');
});

test('BL-10: the deck stats and a challenge score still draw their cells', () => {
  const html = deckStatsHtml(analyzeDeck(DECK_LIST.slice(0, 30)));
  assert.match(html, /<div class="statcell" title="cards printed \{Battle\}[^"]*"><div class="statval">\d+<\/div><div class="statlab">battle cards<\/div>/);
  assert.match(html, /<div class="statlab">different cards<\/div>/);
  const score = scoreHtml({ turns: 5, cards: 30, extra: 0, elements: 2, debt: 0, debtTurns: 0 } as Parameters<typeof scoreHtml>[0]);
  assert.equal((score.match(/class="statcell"/g) ?? []).length, 3, 'turns, cards, elements; no extra copies');
});
