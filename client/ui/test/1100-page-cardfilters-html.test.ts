/* 1100 — THE CARD FILTERS, SHARED (BL-65 W0, 2026-11-04): pages/cardfilters.ts
 * holds the facet rail and the search syntax that the Cards page and the
 * builder's pool both draw. Moved out of pages/cards.ts byte for byte (980
 * still pins the Cards page; the move was proven by rendering cardsHtml over
 * fourteen views before and after and comparing the strings).
 *
 * §1 under CARDS_BTNS the rail and the help carry exactly the Cards page's
 *    names; under POOL_BTNS the builder's — and nothing else differs
 * §2 a chip's state is read off the query string: on, off, none
 * §3 the rail: closed sections show their active count, open ones their chips
 *    and note; "This deck" only while building
 * §4 pages/cards.ts re-exports facets (980 and older imports keep working)
 * §5 text is escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { CARDS_BTNS, POOL_BTNS, SECTIONS, chipHtml, facets, filterRailHtml, syntaxHelpHtml, type FilterRailView } from '../pages/cardfilters.ts';
import { facets as cardsFacets } from '../pages/cards.ts';

const btns = (html: string): Set<string> => new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));
const ALL_OPEN = Object.fromEntries(SECTIONS.map(s => [s.id, true]));
const v = (q: string, over: Partial<FilterRailView> = {}): FilterRailView => ({ facets: facets(false), q, railOpen: { element: true, cost: true }, ...over });

test('1100 §1 the names are a parameter: cards-* for the Cards page, tt-* for the pool, nothing else differs', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined', 'no DOM here');
  assert.deepEqual(CARDS_BTNS, { chip: 'cards-chip', section: 'cards-section', try: 'cards-try', scroll: 'cards-rail' });
  assert.deepEqual(POOL_BTNS, { chip: 'tt-chip', section: 'tt-section', try: 'tt-try', scroll: 'tt-filters' });
  const cards = filterRailHtml(v('el:fire', { railOpen: ALL_OPEN }));
  assert.deepEqual(btns(cards), new Set(['cards-section', 'cards-chip']));
  assert.match(cards, /^<aside class="cbrail" data-scroll="cards-rail">/);
  const pool = filterRailHtml(v('el:fire', { railOpen: ALL_OPEN }), POOL_BTNS);
  assert.deepEqual(btns(pool), new Set(['tt-section', 'tt-chip']));
  assert.match(pool, /^<aside class="cbrail" data-scroll="tt-filters">/);
  const swap = (s: string): string => s.replace(/data-btn="cards-(chip|section)"/g, 'data-btn="tt-$1"').replace('data-scroll="cards-rail"', 'data-scroll="tt-filters"');
  assert.equal(swap(cards), pool, 'the pool\'s rail is the Cards page\'s, renamed');
  const help = syntaxHelpHtml();
  assert.deepEqual(btns(help), new Set(['cards-try']));
  assert.equal(help.replace(/data-btn="cards-try"/g, 'data-btn="tt-try"'), syntaxHelpHtml(POOL_BTNS));
  assert.match(help, /<table class="cbkeys">/);
  assert.match(help, /data-q="is:[a-z]+"><code>is:/, 'every flag is a query to try');
});

test('1100 §2 a chip\'s state is the query\'s: included, excluded, absent', () => {
  const fire = facets(false).find(f => f.key === 'el' && f.value === 'fire')!;
  assert.match(chipHtml(fire, 'el:fire'), /^<button class="cbchip elchip fire on" aria-pressed="true" title="showing only fire — click to exclude"/);
  assert.match(chipHtml(fire, '-el:fire'), /^<button class="cbchip elchip fire off" aria-pressed="false" aria-label="Hiding fire" title="hiding fire — click to clear"/);
  assert.match(chipHtml(fire, ''), /^<button class="cbchip elchip fire" aria-pressed="false" title="include fire"/);
  assert.match(chipHtml(fire, '', POOL_BTNS), /data-btn="tt-chip" data-key="el" data-value="fire"/);
});

test('1100 §3 the rail: active counts on closed sections, chips and notes on open ones, "This deck" only while building', () => {
  const closed = filterRailHtml(v('mana:2 mana:3 kind:unit', { railOpen: {} }));
  assert.match(closed, /data-section="cost">\s*<span>Cost<\/span>\s*<span class="cbactive">2<\/span>/);
  assert.doesNotMatch(closed, /cbchips/, 'nothing open, no chips');
  const open = filterRailHtml(v('', { railOpen: { element: true } }));
  assert.match(open, /<section class="cbsection open">[\s\S]*?<div class="cbnote"><span class="mouseonly">click<\/span><span class="touchonly">tap<\/span> once to include, twice to exclude<\/div>/);
  assert.doesNotMatch(filterRailHtml(v('', { railOpen: ALL_OPEN })), /data-section="building"/);
  assert.match(filterRailHtml(v('', { facets: facets(true), railOpen: ALL_OPEN })), /data-section="building"[\s\S]*?In the deck/);
});

test('1100 §4 pages/cards.ts still exports facets', () => {
  assert.equal(cardsFacets, facets);
});

test('1100 §5 text is escaped', () => {
  const html = chipHtml({ section: 'subtype', label: 'A <b> "c"', key: 'sub', value: 'a"b' }, '');
  assert.ok(html.includes('A &lt;b&gt; &quot;c&quot;') && html.includes('data-value="a&quot;b"'));
  assert.ok(!html.includes('<b>'));
});
