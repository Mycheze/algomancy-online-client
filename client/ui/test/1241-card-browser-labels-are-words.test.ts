/* 1241 — THE CARD BROWSER'S LABELS ARE WORDS, NOT QUERY SYNTAX (BL-10,
 * 2026-11-13; docs/23-ui-inventory/03 §3.10: "Labels are raw identifiers:
 * sort options (`pow`, `tou`, `rarity`, `relevance`), … mechanic chips
 * (`discardme`, `tokenmaker`)").
 *
 * The sort menu showed its keys as they are typed after `sort:`, and the
 * filter rail (the Cards page and the deck builder's pool both draw it) showed
 * the Mechanics chips, Burst and Unstable, the "This deck" pair and the "What
 * kind of thing" chips as their `is:` / `class:` values, lower-case beside the
 * capitalised Kind and Attributes chips.
 *
 * §1 every sort key has a label, and the menu draws the label, not the key
 * §2 every chip outside the Element section starts with a capital or a digit
 *    (element names stay lower-case, as on every element chip in the app —
 *    test 1177's exemption), and no chip shows a flag that is not a word
 * §3 the values are untouched: a chip still filters by `is:discardme`, the
 *    menu still sends `pow`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { FLAGS, SORT_LABEL, SORTS, search } from '../cardsearch.ts';
import { facets } from '../pages/cardfilters.ts';
import { CHUNK, cardsHtml, type CardsView } from '../pages/cards.ts';

function view(q = ''): CardsView {
  return {
    q, res: search(q), cardCount: 450, facets: facets(false),
    railOpen: {}, hints: [], saved: [], helpOpen: false,
    focus: null, focusRow: null, played: 0, rulings: null, cursor: -1, shown: CHUNK, chrome: { signedIn: true, alerts: 0 },
  };
}

test('1241 §1 the sort menu says Power, Toughness, Best match, not pow, tou, relevance', () => {
  for (const s of SORTS) {
    const label = SORT_LABEL[s];
    assert.ok(label, `${s} has a label`);
    assert.match(label, /^[A-Z]/, `${s}: "${label}" starts with a capital`);
  }
  const html = cardsHtml(view());
  const select = html.match(/<label class="cbsort">([^<]*)<select id="cb-sort">([\s\S]*?)<\/select>/);
  assert.ok(select, 'the sort menu is drawn');
  assert.equal(select[1]!.trim(), 'Sort');
  const shown = [...select[2]!.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(shown.map(([v]) => v), [...SORTS], 'one option per sort key, in order');
  for (const [v, text] of shown) assert.equal(text, SORT_LABEL[v as keyof typeof SORT_LABEL], `${v} is drawn as its label`);
  assert.deepEqual(Object.fromEntries(shown.filter(([v]) => ['pow', 'tou', 'relevance'].includes(v!))),
    { pow: 'Power', tou: 'Toughness', relevance: 'Best match' });
});

test('1241 §2 every rail chip but an element name starts with a capital, and none shows raw syntax', () => {
  const bad: string[] = [];
  for (const f of facets(true)) {
    if (f.section === 'element') continue;
    if (!/^[A-Z0-9]/.test(f.label)) bad.push(`${f.section}: "${f.label}"`);
  }
  assert.deepEqual(bad, [], 'a rail chip starts lower-case: give it a label (FlagDef.label, or the section\'s own list)');
  // a flag drawn on the rail has a label of its own
  const drawn = new Set(facets(true).filter(f => f.key === 'is' && f.section !== 'kind' && f.section !== 'building').map(f => f.value));
  for (const f of FLAGS) {
    if (f.mechanic || drawn.has(f.flag)) assert.ok(f.label, `is:${f.flag} is on the rail and has no label`);
  }
  const labels = new Map(facets(true).map(f => [`${f.key}:${f.value}`, f.label]));
  assert.equal(labels.get('is:discardme'), 'Discard me');
  assert.equal(labels.get('is:tokenmaker'), 'Makes tokens');
  assert.equal(labels.get('is:burst'), 'Burst');
  assert.equal(labels.get('class:help'), 'Reference card');
  assert.equal(labels.get('is:deck'), 'In the deck');
});

test('1241 §3 the values are the query syntax still', () => {
  const chips = facets(false);
  const dm = chips.find(f => f.label === 'Discard me')!;
  assert.deepEqual([dm.key, dm.value], ['is', 'discardme']);
  const html = cardsHtml(view('is:discardme'));
  assert.match(html, /<option value="pow">Power<\/option>/);
  assert.ok(search('is:discardme').total > 0, 'the flag still filters');
});
