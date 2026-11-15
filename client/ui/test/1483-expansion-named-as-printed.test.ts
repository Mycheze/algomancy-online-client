/* 1483 — THE EXPANSION IS NAMED AS ITS DECKS PRINT IT (BL-10;
 * docs/23-ui-inventory/03 §3.10: "\"Light vs Dark\" vs \"Light & Dark\"").
 *
 * Every Light & Dark printed deck is "Light & Dark (…)", and so is every other
 * place the client names the expansion; the card browser's Printed deck chip
 * (and the deck builder's pool, which draws the same rail) said "Light vs Dark".
 *
 * §1 the chip's label is the prefix every one of the expansion's decks carries
 * §2 the rail draws that label on its Printed deck chip
 * §3 no client source writes "Light vs Dark" as text a player reads
 * §4 the chip's own words, and the old ones, still find the expansion when typed
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../../engine/src/cards/registry.ts';
import { allRows, RELEASE_LABEL } from '../cardindex.ts';
import { search } from '../cardsearch.ts';
import { facets } from '../pages/cardfilters.ts';

const UI = join(import.meta.dirname, '..');
const CLIENT = join(UI, '..');

test('BL-10 §1: the expansion\'s chip label is the name its printed decks carry', () => {
  const decks = new Set(allRows().filter(r => r.release === 'lightdark').map(r => r.set));
  assert.ok(decks.size >= 2, 'the expansion\'s printed decks are reached');
  for (const d of decks) assert.ok(d.startsWith(`${RELEASE_LABEL.lightdark} (`), `${d} is not "${RELEASE_LABEL.lightdark} (…)"`);
  assert.equal(RELEASE_LABEL.lightdark, 'Light & Dark');
});

test('BL-10 §2: the Printed deck section draws "Light & Dark"', () => {
  for (const building of [false, true]) {
    const labels = facets(building).filter(f => f.section === 'set').map(f => f.label);
    assert.deepEqual([...labels].sort(), ['Base Game', 'Kickstarter Exclusive', 'Light & Dark']);
  }
});

test('BL-10 §3: no client source draws "Light vs Dark"', () => {
  const dirs = [UI, join(UI, 'pages'), join(UI, 'components'), join(CLIENT, 'server'), join(CLIENT, 'storybook', 'stories')];
  let read = 0;
  for (const dir of dirs) {
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names.filter(x => x.endsWith('.ts'))) {
      read++;
      const src = readFileSync(join(dir, n), 'utf8');
      // a string literal, not a comment quoting how someone once said it
      assert.doesNotMatch(src, /['"`>]\s*Light vs\.? Dark/i, `${dir}/${n} names the expansion "Light vs Dark"`);
    }
  }
  assert.ok(read > 50, `the census read ${read} files`);
});

test('BL-10 §4: typing the chip\'s name, or the old one, finds the whole expansion', () => {
  const ld = search('set:lightdark class:all').total;
  assert.ok(ld > 100);
  assert.equal(search('set:"light & dark" class:all').total, ld);
  assert.equal(search('set:"light vs dark" class:all').total, ld);
});
