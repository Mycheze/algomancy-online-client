/* Playtest round 7 — the rules glossary and the scan behind the inspector's
 * "Referenced rules" section (ui/glossary.ts).
 *
 * Bena: "when viewing the rulings and/or information about a card, all
 * referenced keywords should have their reminder text right there to see."
 *
 * The scan is a regex sweep over the card's text, its mods and its rulings, so
 * the thing worth testing is precision: a keyword mentioned in any of its real
 * spellings must be found, and a keyword that is ALSO an ordinary English word
 * must not fire on the ordinary use. Riftwalker's "Switch my position with
 * another target ally" is the verb, not the graft marker, and a reminder about
 * grafting there would be actively misleading.
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCard } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import {
  EXPANSION_GUIDE, GLOSSARY, KEYWORDS, MECHANICS, glossaryHits, matcherFor,
} from '../ui/glossary.ts';

const terms = (texts: string[], skip?: string[]): string[] =>
  glossaryHits(texts, skip ? { skip } : {}).map(e => e.term);

/* ── the table itself ──────────────────────────────────────────────────── */

test('the glossary is the three sections, with no duplicate headings', () => {
  assert.deepEqual(GLOSSARY, [...KEYWORDS, ...EXPANSION_GUIDE, ...MECHANICS]);
  const seen = new Set<string>();
  for (const e of GLOSSARY) {
    assert.ok(!seen.has(e.term), `duplicate glossary term ${e.term}`);
    seen.add(e.term);
    assert.ok(e.text.trim().length > 10, `${e.term} needs real reminder text`);
  }
});

test('every attribute printed on a real card has reminder text', () => {
  // the inspector falls back to "see the rules reference" for an attribute it
  // cannot explain — this is the guard that says a new attribute must arrive
  // with its reminder text
  const known = new Set(GLOSSARY.map(e => e.term));
  const missing = new Set<string>();
  for (const name of DECK_LIST) {
    let attrs: readonly string[];
    try { attrs = getCard(name).attrs; } catch { continue; }
    for (const a of attrs) if (!known.has(a)) missing.add(a);
  }
  assert.deepEqual([...missing], [], 'attributes with no glossary entry');
});

/* ── matching ──────────────────────────────────────────────────────────── */

test('a term is found in the spellings the cards and rulings use', () => {
  assert.deepEqual(terms(['This unit gains {Deadly} until regroup.']), ['Deadly']);
  assert.deepEqual(terms(['A card that is trashed does not resolve.']), ['Trash']);
  assert.deepEqual(terms(['It may be prophesied from your bin.']), ['Prophecy']);
  assert.deepEqual(terms(['Cached cards are public.']), ['Cache']);
});

test('word boundaries: a term never fires inside a longer word', () => {
  assert.deepEqual(terms(['Rotate the formation to protect your flyers.']), [],
    '"Rotate"/"protect" must not read as Rot');
  assert.deepEqual(terms(['Rot 2.']), ['Rot']);
});

test('[once] is the bounded marker; "once per turn" as prose is not', () => {
  assert.deepEqual(terms(['[Augment][once] [one]: do a thing.']), ['Augment', 'Once']);
  assert.deepEqual(terms(['You may do this once each turn.']), [],
    'plain English "once" must not claim to be the keyword');
});

test('graft matches its marker, not the English verb "switch"', () => {
  assert.deepEqual(terms(['[Switch1] Glimpse 1.']), ['Glimpse', 'Graft'],
    'the bracketed marker IS the keyword');
  assert.deepEqual(terms(['Switch my position with another target ally.']), [],
    'Riftwalker’s switch is the verb — a graft reminder here would mislead');
  assert.deepEqual(terms(['A grafted mod joins the cause.']), ['Graft']);
});

test('the battle MARKER counts, written either way; the word does not', () => {
  // the corpus writes it both ways — {Battle} on a type line, [Battle] in a
  // text box (Good Whale). Missing one half is how this shipped broken once.
  assert.deepEqual(terms(['{Battle} Cosmic Spell']), ['Battle']);
  assert.deepEqual(terms(['[Battle] Ambush  [4bb]']), ['Ambush', 'Battle']);
  assert.deepEqual(terms(['During the battle, units in that battle may block.']), [],
    'half the rulings corpus says "battle" — it cannot mean the marker every time');
});

test('real printed text: Good Whale explains both its markers', () => {
  const c = getCard('Good Whale');
  assert.deepEqual(glossaryHits([c.type, c.text], { skip: c.attrs }).map(e => e.term),
    ['Ambush', 'Battle'], 'the ⚔ on the card is a rule, and it gets a reminder');
});

/* ── what the inspector actually asks for ──────────────────────────────── */

test('the card’s own attributes are skipped — they have their own section', () => {
  const texts = ['{Flying} Unit', 'Target unit gains {Deadly} until regroup.'];
  assert.deepEqual(terms(texts), ['Flying', 'Deadly']);
  assert.deepEqual(terms(texts, ['Flying']), ['Deadly'],
    'Flying is already listed above as this unit’s attribute');
});

test('hits come back in glossary order, deduped across all the texts given', () => {
  // Augment (a MECHANIC) sorts after Deadly (a KEYWORD) whatever order the
  // texts arrive in, and naming a term twice yields one row
  const hits = terms(['[Augment] gains {Deadly}', 'and {Deadly} again', 'Rot 1']);
  assert.deepEqual(hits, ['Deadly', 'Rot', 'Augment']);
});

test('no text, no rows', () => {
  assert.deepEqual(terms([]), []);
  assert.deepEqual(glossaryHits([undefined, null, '']), []);
});

test('real cards: the scan explains what they mention and nothing else', () => {
  const scan = (name: string): string[] => {
    const c = getCard(name);
    return glossaryHits([c.type, c.text], { skip: c.attrs }).map(e => e.term);
  };
  assert.deepEqual(scan('Riftwalker'), ['Virus', 'Augment', 'Once'],
    'its "Switch my position" is the verb, so no Graft row');
  assert.deepEqual(scan('Foretell'), ['Cache', 'Glimpse', 'Graft', 'Battle']);
});

test('the scan stays quiet enough to read', () => {
  // a wall of reminder rows is as unreadable as none: check the whole pool
  let worst = 0, total = 0, n = 0;
  for (const name of DECK_LIST) {
    let c;
    try { c = getCard(name); } catch { continue; }
    const k = glossaryHits([c.type, c.text], { skip: c.attrs }).length;
    worst = Math.max(worst, k); total += k; n++;
  }
  assert.ok(n > 100, 'the pool actually loaded');
  assert.ok(worst <= 8, `no card should reference more than 8 rules (worst: ${worst})`);
  assert.ok(total / n < 3, `mean rows per card should stay small (got ${(total / n).toFixed(2)})`);
});

test('every entry compiles to a usable matcher', () => {
  for (const e of GLOSSARY) {
    const re = matcherFor(e);
    assert.ok(re instanceof RegExp, `${e.term} has no matcher`);
    assert.ok(re.flags.includes('i'), `${e.term}'s matcher must be case-insensitive`);
  }
});
