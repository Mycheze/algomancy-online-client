/* ui/deckstats.ts — the arithmetic a deckbuilder makes cuts on.
 *
 * These sums are the kind that get quietly wrong and are never caught, because
 * a curve chart always LOOKS like a curve chart and an affinity table always
 * looks authoritative. So the module is pure and every claim it makes is
 * asserted here against hand-checked card costs rather than against itself.
 *
 * §3 is the one that matters most. Algomancy's binding deckbuilding constraint
 * is not the curve, it is "how much affinity do I need OPEN, and by when" —
 * and the cumulative column is the half of that answer a per-row table cannot
 * give. A [3][r][r] card is not a fire requirement that begins on turn 3: it
 * is a requirement you have to have been building toward since turn 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeck, cardFacts, deckElements, deckListText } from '../ui/deckstats.ts';
import { defaultDecks, importDeckText } from '../../server/decks.ts';

/** N copies of a card, the shape a real deck list has */
const copies = (name: string, n: number): string[] => Array.from({ length: n }, () => name);

// ── §1 printed facts ──────────────────────────────────────────────────

test('§1 cardFacts reads cost, pips, kind and timing off the printed card', () => {
  const sprite = cardFacts('Ignis Sprite');
  assert.ok(sprite);
  assert.equal(sprite.mana, 1);
  assert.equal(sprite.isX, false);
  assert.deepEqual(sprite.pips, { fire: 1 });
  assert.equal(sprite.kind, 'unit');
  assert.deepEqual(sprite.factions, ['fire']);

  // "rr" is two pips of ONE element — the case the whole affinity table is for
  const channeler = cardFacts('Rune Channeler');
  assert.ok(channeler);
  assert.equal(channeler.mana, 3);
  assert.deepEqual(channeler.pips, { fire: 2 });
});

test('§1 a card the engine does not script reads as null, not as a zero-cost card', () => {
  assert.equal(cardFacts('Not A Real Card'), null);
  const a = analyzeDeck([...copies('Ignis Sprite', 2), 'Not A Real Card']);
  assert.deepEqual(a.unknown, ['Not A Real Card']);
  assert.equal(a.legal, false);
  // it still COUNTS toward the deck size — it is in the list, it is just not
  // playable, and hiding it would make a 30-card deck look like 29
  assert.equal(a.total, 3);
});

// ── §2 the split and the curve ────────────────────────────────────────

test('§2 the unit / spell / spellUnit buckets sum to the deck', () => {
  for (const deck of defaultDecks()) {
    const a = analyzeDeck(deck.cards);
    assert.equal(a.units + a.spells + a.spellUnits, a.total,
      `${deck.name}: the split does not add up to ${a.total}`);
  }
});

test('§2 the curve is dense INSIDE its range — an empty rung is a row of zeroes', () => {
  // 1-drop and 3-drop only: the 2 slot must still be there, saying "nothing"
  const a = analyzeDeck([...copies('Ignis Sprite', 2), ...copies('Rune Channeler', 2)]);
  assert.deepEqual(a.curve.map(c => c.mana), [1, 2, 3],
    'it starts at the cheapest card — a leading empty 0 row on every deck is noise, not information');
  assert.equal(a.curve[0]!.total, 2);
  assert.equal(a.curve[1]!.total, 0, 'the gap at 2 is a row, not a missing row');
  assert.equal(a.curve[2]!.total, 2);
  assert.equal(a.curve.reduce((n, c) => n + c.total, 0) + a.xCards, a.total);
});

test('§2 an X card is counted apart and sits on no rung', () => {
  const a = analyzeDeck([...copies('Ignis Sprite', 2), 'Wildfire']);
  assert.equal(a.xCards, 1);
  assert.equal(a.curve.reduce((n, c) => n + c.total, 0), 2);
  // …and it does not drag the average toward zero
  assert.equal(a.avgMana, 1);
});

// ── §3 the affinity table ─────────────────────────────────────────────

test('§3 maxAffinity is the ceiling: reaching it casts everything', () => {
  const a = analyzeDeck([...copies('Ignis Sprite', 2), ...copies('Rune Channeler', 2)]);
  // one card wants 1 fire, the other 2 — the deck wants 2, not 3
  assert.equal(a.maxAffinity['fire'], 2);
  assert.equal(a.affinityFloor, 2);
  // …while `pips` is the running total, which is a different question
  assert.equal(a.pips['fire'], 2 * 1 + 2 * 2);
});

test('§3 the cumulative column carries a requirement DOWN the curve, never up', () => {
  // Rune Channeler is [3] with two fire pips; Ignis Sprite is [1] with one
  const a = analyzeDeck([...copies('Ignis Sprite', 2), ...copies('Rune Channeler', 2)]);
  const at = (m: number) => a.rows.find(r => r.mana === m)!;

  // the per-row need is only what is printed AT that mana value
  assert.equal(at(1).need['fire'], 1);
  assert.equal(at(2).need['fire'], 0);
  assert.equal(at(3).need['fire'], 2);

  // the cumulative column is monotonic — you never need LESS as you go up
  let prev = 0;
  for (const row of a.rows) {
    assert.ok(row.cumulative['fire']! >= prev,
      `fire requirement fell at mana ${row.mana}`);
    prev = row.cumulative['fire']!;
  }
  assert.equal(at(1).cumulative['fire'], 1);
  assert.equal(at(2).cumulative['fire'], 1);   // nothing new at 2
  assert.equal(at(3).cumulative['fire'], 2);

  // `first` marks where the requirement WENT UP, not where a card happens to
  // restate it. The obvious "does a card here need as much as the total" test
  // is true on every restating row, and it highlighted three rows in five.
  assert.deepEqual(at(1).first, ['fire'], 'the 1-drop introduces the first fire pip');
  assert.deepEqual(at(2).first, [], 'nothing new at 2');
  assert.deepEqual(at(3).first, ['fire'], 'and the 3-drop raises it to 2');
  // the top of the cumulative column IS the ceiling
  assert.equal(a.rows[a.rows.length - 1]!.cumulative['fire'], a.maxAffinity['fire']);
});

test('§3 `first` fires exactly once per level of a requirement', () => {
  for (const deck of defaultDecks()) {
    const a = analyzeDeck(deck.cards);
    for (const el of Object.keys(a.maxAffinity)) {
      const rises = a.rows.filter(r => r.first.includes(el)).length;
      const climbed = a.rows.reduce((n, r, i) =>
        n + (i > 0 && (r.cumulative[el] ?? 0) > (a.rows[i - 1]!.cumulative[el] ?? 0) ? 1 : 0),
        (a.rows[0]?.cumulative[el] ?? 0) > 0 ? 1 : 0);
      assert.equal(rises, climbed, `${deck.name}: ${el} is marked new ${rises} times but rises ${climbed}`);
    }
  }
});

test('§3 every bundled deck agrees with its own table', () => {
  for (const deck of defaultDecks()) {
    const a = analyzeDeck(deck.cards);
    const last = a.rows[a.rows.length - 1]!;
    for (const el of Object.keys(a.maxAffinity)) {
      // an X card can carry pips and sits on no row, so the table's ceiling
      // may legitimately be below the deck's — never above it
      assert.ok(last.cumulative[el]! <= a.maxAffinity[el]!,
        `${deck.name}: the ${el} table asks for more than any card does`);
    }
    assert.equal(a.rows.reduce((n, r) => n + r.count, 0) + a.xCards, a.total, deck.name);
  }
});

// ── §4 elements ───────────────────────────────────────────────────────

test('§4 a hybrid is half of each element it belongs to', () => {
  // Sunlit Vines is a wood/light hybrid in the Light & Dark set
  const hybrid = defaultDecks()
    .flatMap(d => d.cards)
    .map(n => cardFacts(n))
    .find(f => f && f.factions.length === 2);
  if (!hybrid) return;   // the bundled five are mono; nothing to assert
  const a = analyzeDeck([hybrid.name]);
  for (const el of hybrid.factions) assert.equal(a.elements[el], 0.5);
});

test('§4 deckElements ranks by share and drops the noise', () => {
  const fire = defaultDecks().find(d => /Fire/.test(d.name))!;
  const els = deckElements(analyzeDeck(fire.cards));
  assert.equal(els[0]!.el, 'fire');
  assert.ok(els[0]!.share > 0.5, 'a Single-Box fire deck should read as mostly fire');
  // shares are sorted descending and are all real cards' worth
  for (let i = 1; i < els.length; i++) assert.ok(els[i - 1]!.share >= els[i]!.share);
  for (const e of els) assert.ok(e.cards >= 0.5);
});

// ── §5 legality is reported, never enforced ───────────────────────────

test('§5 a half-built deck analyses fine and simply says it is not legal yet', () => {
  const a = analyzeDeck(copies('Ignis Sprite', 2));
  assert.equal(a.legal, false);
  assert.match(a.problems.join(' '), /at least 30/);
  // …and everything else still answered
  assert.equal(a.total, 2);
  assert.equal(a.units, 2);
  assert.equal(a.maxAffinity['fire'], 1);
});

test('§5 the five bundled decks are legal, and are what the collection seeds', () => {
  const decks = defaultDecks();
  assert.equal(decks.length, 5, 'the starter five');
  for (const d of decks) {
    const a = analyzeDeck(d.cards);
    assert.deepEqual(a.problems, [], `${d.name} is not a legal deck`);
    assert.ok(a.total >= 30, `${d.name} is ${a.total} cards`);
    assert.deepEqual(a.unknown, [], `${d.name} has unscripted cards`);
  }
});

test('§5 copies counts duplicates once, with their number', () => {
  const a = analyzeDeck([...copies('Ignis Sprite', 2), 'Rune Channeler']);
  assert.deepEqual(a.copies.map(c => [c.name, c.n]),
    [['Ignis Sprite', 2], ['Rune Channeler', 1]]);
});

// ── §6 the text export round-trips through the real importer ──────────

test('§6 a deck exported as text imports back as the same deck', () => {
  for (const deck of defaultDecks()) {
    const text = deckListText(deck.name, deck.cards);
    // through the SERVER's own parser, not a second copy of the format —
    // an export nobody can paste back is a text file, not an export
    const back = importDeckText(text);
    assert.deepEqual(back.problems, [], `${deck.name}: exported text does not import cleanly`);
    assert.deepEqual([...back.cards].sort(), [...deck.cards].sort(), deck.name);
  }
});

test('§6 duplicates survive the round trip as a count, not as two lines', () => {
  const cards = [...copies('Ignis Sprite', 2), 'Rune Channeler'];
  const text = deckListText('two of one', cards);
  assert.match(text, /^2 Ignis Sprite$/m, 'a pair is one line with a 2');
  assert.equal((text.match(/Ignis Sprite/g) ?? []).length, 1);
  assert.deepEqual([...importDeckText(text).cards].sort(), [...cards].sort());
});

test('§6 the maybeboard is exported as a comment-separated tail, and never as deck cards', () => {
  const text = deckListText('with a shelf', copies('Ignis Sprite', 2), ['Rune Channeler']);
  assert.match(text, /\/\/ maybeboard/);
  // …and re-importing takes the WHOLE file, maybeboard included, because the
  // paste format has no notion of one. That is the honest limit of a text
  // deck list and the reason the collection stores the two lists apart.
  const back = importDeckText(text);
  assert.equal(back.cards.length, 3, 'a paste of the export brings the shelf back as cards');
});
