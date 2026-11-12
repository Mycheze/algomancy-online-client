/* 1102 — A DECK'S STATS, DRAWN (BL-65 W0, 2026-11-04): pages/deckstats.ts.
 *
 * §1 curveByElement (ui/deckstats.ts): the same rungs as the curve, each split
 *    by element, a hybrid half to each, parts adding up to the rung; X last
 * §2 statsStripHtml: one tt-stats button — the curve coloured by element
 *    (tokens only), the element split, units · spells, the average
 * §3 an empty deck, an X-only deck: no average, no stray parts
 * §4 sampleHandHtml: the button alone, then the cards (data-prev, no native
 *    image drag) and "Deal again"; names escaped
 * §5 deckStatsHtml moved here; decks.ts re-exports the same function
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { analyzeDeck, cardFacts, curveByElement, ELEMENTS } from '../deckstats.ts';
import { deckStatsHtml, sampleHandHtml, statsStripHtml } from '../pages/deckstats.ts';
import { deckStatsHtml as fromDecks } from '../decks.ts';

const facts = (n: string) => cardFacts(n)!;
const MONO = DECK_LIST.filter(n => facts(n).factions.length === 1 && !facts(n).isX);
const HYBRID = DECK_LIST.find(n => facts(n).factions.length === 2 && !facts(n).isX)!;
const X = DECK_LIST.find(n => facts(n).isX)!;
const DECK = [...MONO.slice(0, 26), HYBRID, HYBRID, X, MONO[30]!];

test('1102 §1 curveByElement: the curve\'s rungs, split by element, X last', () => {
  const a = analyzeDeck(DECK);
  const rungs = curveByElement(a);
  const numeric = rungs.filter(r => r.mana !== 'X');
  assert.deepEqual(numeric.map(r => [r.mana, r.total]), a.curve.map(c => [c.mana, c.total]), 'the same rungs as the curve');
  assert.equal(rungs.at(-1)!.mana, 'X');
  assert.equal(rungs.at(-1)!.total, a.xCards);
  for (const r of rungs) {
    const parts = Object.values(r.byElement).reduce((n, v) => n + v, 0);
    assert.ok(Math.abs(parts - r.total) < 1e-9, `rung ${r.mana}: its parts add up`);
  }
  const hf = facts(HYBRID);
  const at = rungs.find(r => r.mana === hf.mana)!;
  for (const el of hf.factions) assert.ok((at.byElement[el] ?? 0) >= 1, 'two hybrid copies: half of each, to each element');
  assert.deepEqual(curveByElement(analyzeDeck(MONO.slice(0, 3))).filter(r => r.mana === 'X'), [], 'no X rung without X cards');
  assert.deepEqual(curveByElement(analyzeDeck([])), []);
});

test('1102 §2 the strip: one tt-stats button, the curve by element, the split, units · spells, the average', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined', 'no DOM here');
  const a = analyzeDeck(DECK);
  const html = statsStripHtml(a);
  assert.match(html, /^<button class="ttstrip" type="button" data-btn="tt-stats" aria-label="Stats">/);
  assert.equal(html.match(/data-btn=/g)?.length, 1, 'the whole strip is the one button');
  assert.doesNotMatch(html, /<div/, 'only phrasing content inside a button');
  assert.equal(html.match(/class="ttrung[ "]/g)?.length, curveByElement(a).length, 'a rung per rung, X included');
  assert.match(html, /<span class="ttrung x" style="height:\d+%">/);
  assert.match(html, /<span class="ttrung" style="height:100%">/, 'the tallest rung is the full height');
  for (const m of html.matchAll(/background:([^;"]+)/g)) assert.match(m[1]!, /^var\(--[a-z-]+\)$/, 'colours are tokens');
  for (const el of new Set(DECK.flatMap(n => facts(n).factions))) assert.match(html, new RegExp(`<span class="ttel ${el}">`));
  const fireCards = DECK.filter(n => facts(n).factions.includes(ELEMENTS[0]!)).length;
  if (fireCards) assert.match(html, new RegExp(`<span class="ttel ${ELEMENTS[0]}"><span class="ttdot" style="background:var\\(--${ELEMENTS[0]}\\)"><img class="elicon" src="[^"]*/${ELEMENTS[0]}\\.webp"[^>]*></span>${fireCards}</span>`));
  assert.match(html, new RegExp(`<span class="ttkinds">${a.units} units · ${a.spells} spells`));
  assert.match(html, new RegExp(`<span class="ttavg">avg ${a.avgMana.toFixed(1)}</span>`));
  assert.match(html, /ui-icon--chevron-right/);
});

test('1102 §3 an empty deck and an X-only deck draw no average and no split', () => {
  const empty = statsStripHtml(analyzeDeck([]));
  assert.match(empty, /<span class="ttcurve" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(empty, /ttsplit|ttavg/);
  assert.match(empty, /0 units · 0 spells/);
  const xOnly = statsStripHtml(analyzeDeck([X]));
  assert.doesNotMatch(xOnly, /ttavg/, 'an X card has no cost to average');
  assert.match(xOnly, /class="ttrung x"/);
  assert.match(statsStripHtml(analyzeDeck([MONO[0]!])), /1 (unit|spell) ·/, 'one is singular');
});

test('1102 §4 the sample hand: the button, then the cards and the button again', () => {
  const none = sampleHandHtml(null);
  assert.match(none, /^<div class="ttsample"><button class="ui-button ui-button--secondary ui-button--sm" data-btn="tt-hand" type="button">Sample hand<\/button><\/div>$/);
  const hand = sampleHandHtml(MONO.slice(0, 4));
  assert.equal(hand.match(/<span class="ttsamplecard" data-prev="/g)?.length, 4);
  assert.match(hand, />Deal again<\/button><\/div>$/);
  assert.doesNotMatch(hand, /<img (?![^>]*draggable="false")/, 'no native image drag (Firefox)');
  const odd = sampleHandHtml(['No <such> "card"']);
  assert.ok(odd.includes('data-prev="No &lt;such&gt; &quot;card&quot;"') && !odd.includes('<such>'));
});

test('1102 §5 deckStatsHtml moved here; decks.ts re-exports the same one', () => {
  assert.equal(fromDecks, deckStatsHtml);
  assert.match(deckStatsHtml(analyzeDeck(DECK)), /^<section class="acctcard">\s*<h3>Curve<\/h3>/);
});
