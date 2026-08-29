/* HOW A DECK IS LAID OUT, ON EVERY SURFACE THAT SHOWS ONE.
 *
 * The owner, 2026-08-29:
 *
 *   "When viewing other people's decks, it's hard to really visualize things
 *    since it's just a flat list: the decks should be auto sorted by cost, and
 *    split by spells/units, with a few other view options. And instead of
 *    showing a x2 for cards with 2 copies, actually show two of those cards,
 *    just stacked. But this should actually be default on deck building pages
 *    too. Add some basic stats about the deck like element requirements and
 *    mana values."
 *
 * ── ⚠ WHAT WAS ACTUALLY WRONG, AND IT IS NOT "META.TS HAD NO GROUPING" ──
 *
 * The BUILDER already grouped, sorted and had a full stats tab. The SHARED
 * page had a single `.dkgrid` over `a.copies`, in storage order, with no
 * split, no sort and no stats. So the same deck looked like two different
 * decks depending on whose page you were on — and the one strangers see was
 * the flat one.
 *
 * The fix is therefore ONE module both pages call (`ui/decklayout.ts`), not a
 * second grouping written into `ui/meta.ts`. `ui/deckstats.ts` says why in its
 * own header: *"two projections of one record is how the deck page and the
 * browser end up disagreeing about what a card costs."* §3 is the guard on
 * that — it reads both call sites and asserts neither has grown its own.
 *
 * Seeds 22000-22099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDeck } from '../ui/deckstats.ts';
import {
  GROUPINGS, byCost, deckSections, needsCountBadge, stackLayers,
} from '../ui/decklayout.ts';
import type { DeckEntry } from '../ui/decklayout.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '..', 'ui');

/** a deck built from real cards, so the facts are the printed ones */
const DECK = [
  'Ignis Sprite', 'Ignis Sprite',      // cheap unit, two copies
  'Good Whale',                        // pricier unit
  'Jelly',                             // spell
  'Biotoxicity',                       // spell
  'The Foretold',                      // unit
];
const A = analyzeDeck(DECK);

const entry = (name: string, mana: number, kind: string, isX = false): DeckEntry =>
  ({ name, n: 1, facts: { name, mana, isX, kind, pips: {}, timing: 'deploy', factions: [],
    power: 0, toughness: 0, text: '', type: '' } as DeckEntry['facts'] });

/* ══ §1 sorted by cost, always ═══════════════════════════════════════════ */

test('§1a cost order, with X after every number and unknowns last', () => {
  const list: DeckEntry[] = [
    entry('zed', 9, 'unit'),
    { name: 'mystery', n: 1, facts: null },
    entry('xx', 0, 'unit', true),
    entry('alpha', 1, 'unit'),
  ];
  assert.deepEqual([...list].sort(byCost).map(e => e.name), ['alpha', 'zed', 'xx', 'mystery'],
    'an X card has no mana value to sort by — filing it at 0 would read as a free card, and a '
    + 'card this build does not script must never silently claim to be a 0-drop');
});

test('§1b ties break on name, so a repaint never reshuffles the grid', () => {
  const list = [entry('beta', 2, 'unit'), entry('alpha', 2, 'unit')];
  assert.deepEqual([...list].sort(byCost).map(e => e.name), ['alpha', 'beta']);
  assert.deepEqual([...list].sort(byCost).sort(byCost).map(e => e.name), ['alpha', 'beta']);
});

test('§1c EVERY grouping is cost-ordered inside its sections', () => {
  // "auto sorted by cost" is unconditional — it is not one of the view
  // options, it is true under all of them. The bucketing this replaced sorted
  // alphabetically inside every bucket.
  for (const g of GROUPINGS) {
    for (const sec of deckSections(A, g.id)) {
      const costs = sec.entries.map(e => (!e.facts ? 1e6 : e.facts.isX ? 1e5 : e.facts.mana));
      assert.deepEqual(costs, [...costs].sort((x, y) => x - y),
        `${g.id} / ${sec.label}: cards inside a section must climb in cost`);
    }
  }
});

/* ══ §2 split by units and spells ════════════════════════════════════════ */

test('§2a the default split is units, then spells', () => {
  const secs = deckSections(A, 'type');
  assert.deepEqual(secs.map(s => s.label), ['Units', 'Spells', 'Spell units'],
    'the owner asked for this split by name, and units lead');
  assert.equal(secs[0]!.cards, 4, 'two Sprites, a Whale and the Foretold — COPIES, not names');
  assert.equal(secs[1]!.cards, 1, 'Biotoxicity');
  // ⚠ Jelly is printed as a spell AND a unit, so it is neither of the first
  // two. Filing it under "spells" would be a half-truth on the one card whose
  // whole point is that it is both — hence a section of its own.
  assert.deepEqual(secs[2]!.entries.map(e => e.name), ['Jelly']);
});

test('§2b a section counts copies, not distinct cards', () => {
  const units = deckSections(A, 'type')[0]!;
  const sprite = units.entries.find(e => e.name === 'Ignis Sprite')!;
  assert.equal(sprite.n, 2, 'and the entry still knows there are two');
  assert.equal(units.entries.length, 3, 'three distinct units');
  assert.equal(units.cards, 4, 'four cards');
});

test('§2c an empty section is not drawn', () => {
  // contrast DeckAnalysis.curve, which is deliberately DENSE because a gap in
  // a curve is information. A missing section is not information.
  const noSpells = analyzeDeck(['Ignis Sprite', 'Good Whale', 'The Foretold']);
  assert.deepEqual(deckSections(noSpells, 'type').map(s => s.label), ['Units'],
    'a deck of nothing but units gets one heading, not three with two empty');
  for (const g of GROUPINGS) {
    for (const sec of deckSections(A, g.id)) assert.ok(sec.entries.length > 0, `${g.id}/${sec.label}`);
  }
});

test('§2d every grouping keeps every card — nothing is lost in the split', () => {
  for (const g of GROUPINGS) {
    const secs = deckSections(A, g.id);
    assert.equal(secs.reduce((n, s) => n + s.cards, 0), A.total,
      `${g.id}: the sections must add up to the deck`);
    const names = secs.flatMap(s => s.entries.map(e => e.name)).sort();
    assert.deepEqual(names, A.copies.map(c => c.name).sort(), `${g.id}: same cards`);
  }
});

test('§2e there really are a few view options, and "flat" still sorts', () => {
  assert.ok(GROUPINGS.length >= 3, 'a few other view options');
  const flat = deckSections(A, 'flat');
  assert.equal(flat.length, 1, 'one list');
  assert.deepEqual(flat[0]!.entries.map(e => e.name), [...flat[0]!.entries].sort(byCost).map(e => e.name),
    '"no grouping" is not "no sorting" — an unsorted list is the thing being fixed');
});

/* ══ §3 copies are drawn, not counted ════════════════════════════════════ */

test('§3a one copy is one card; two copies is two cards', () => {
  assert.deepEqual(stackLayers(1), [], 'a single card has nothing behind it');
  assert.equal(stackLayers(2).length, 1, 'one ghost behind the front card');
  assert.equal(stackLayers(3).length, 2);
});

test('§3b the ghosts are ordered back-to-front, so the offsets nest', () => {
  assert.deepEqual(stackLayers(3), [2, 1],
    'drawn furthest-back first, so the front card is painted last and stays legible');
});

test('§3c a stack is bounded, and the bound is GEOMETRIC', () => {
  // Each copy steps half a card to the right inside a tile two grid columns
  // wide, so two ghosts exactly fill it and a third would hang off the end.
  // This is not an aesthetic cap: past it the layout breaks, and anything
  // past it is an illegal count that is reported as a number anyway.
  assert.equal(stackLayers(40).length, 2, 'capped at two ghosts — three cards total');
  assert.ok(stackLayers(40).every(i => i >= 1));
  const widest = 1 + 0.5 * stackLayers(40).length;
  assert.ok(widest <= 2,
    `a stacked tile spans two columns, so the pile may not exceed two card widths (got ${widest})`);
});

test('§3d the NUMBER comes back over the legal cap, and only there', () => {
  // ⚠ two copies is the cap, so a legal deck never shows a number again. Three
  // is illegal, and "there are too many of these" is exactly the thing that
  // must not be left to counting overlapping corners by eye.
  assert.equal(needsCountBadge(1), false);
  assert.equal(needsCountBadge(2), false, 'the legal maximum draws two cards and says nothing');
  assert.equal(needsCountBadge(3), true, 'an over-cap import still tells you in words');
});

/* ══ §4 one layout, both surfaces ════════════════════════════════════════ */

const decksSrc = readFileSync(join(UI, 'decks.ts'), 'utf8');
const metaSrc = readFileSync(join(UI, 'meta.ts'), 'utf8');

test('§4a both pages group through the shared module', () => {
  // ⚠ THE IMPORT, not a mention. A break-test that shadowed `deckSections`
  // with a local `const` walked straight through a `/deckSections\(/` check —
  // the symbol was there, it just was not the shared one. So the assertion is
  // that the name is bound BY the import from decklayout.ts.
  for (const [name, src] of [['decks.ts', decksSrc], ['meta.ts', metaSrc]] as const) {
    const imports = [...src.matchAll(/import \{([^}]*)\} from '\.\/decklayout\.ts';/g)]
      .flatMap(m => m[1]!.split(',').map(x => x.trim()));
    assert.ok(imports.includes('deckSections'),
      `${name} must import deckSections from ui/decklayout.ts — got [${imports.join(', ')}]`);
    assert.equal(/const deckSections\b|function deckSections\b/.test(src), false,
      `${name} defines its own deckSections, which is the second projection this file exists to stop`);
    assert.match(src, /deckSections\(/, `${name} must actually call it`);
  }
});

test('§4b neither page kept a bucketing of its own', () => {
  // the specific regression: `ui/decks.ts` used to build a `buckets` Map
  // inline, and copying that into meta.ts — rather than lifting it — is the
  // obvious way to answer this report and the way that produces two answers.
  for (const [name, src] of [['decks.ts', decksSrc], ['meta.ts', metaSrc]] as const) {
    assert.equal(/const buckets = new Map/.test(src), false,
      `${name} still has its own bucketing`);
  }
});

test('§4c both pages draw copies rather than counting them', () => {
  for (const [name, src] of [['decks.ts', decksSrc], ['meta.ts', metaSrc]] as const) {
    assert.match(src, /stackLayers\(/, `${name} must draw the copies`);
    assert.match(src, /needsCountBadge\(/, `${name} must use the one cap rule`);
    // the old unconditional badge, in either page's spelling
    assert.equal(/\$\{c\.n > 1 \? `<span class="dkn">×\$\{c\.n\}<\/span>` : ''\}/.test(src), false,
      `${name} still prints an unconditional ×N`);
    assert.equal(/n < 2 \? '' : `<span class="dkn/.test(src), false,
      `${name} still prints an unconditional ×N`);
  }
});

test('§4c2 the stack offset is HALF A CARD, and that number is guarded', () => {
  // ⚠ THIS TEST EXISTS BECAUSE THE FIRST VERSION SHIPPED WRONG. The offset was
  // 4.5px — chosen so a stack stayed inside its own grid cell, which kept the
  // rows tidy and made the whole feature invisible. The owner: "the stacked
  // cards are so closely stacked together that it's impossible to tell which
  // ones are two ofs and which are just single cards."
  //
  // A pixel nudge is not a smaller version of this feature, it is the absence
  // of it, and nothing in the suite could tell the two apart — the geometry
  // lives entirely in CSS. So the CSS is read.
  const css = readFileSync(join(UI, 'style.css'), 'utf8');
  const rule = /\.dkstack \.dkghostwrap \{[^}]*transform: translateX\(calc\(var\(--i\) \* (\d+)%\)\)/
    .exec(css);
  assert.ok(rule, 'the ghost offset must be a PERCENTAGE of the card, not a pixel nudge');
  assert.ok(Number(rule![1]) >= 50,
    `the offset must be at least half a card — got ${rule![1]}%`);
  // and the tile has to be given the room, or a 50% offset just overlaps the
  // neighbouring card and the grid reads as noise
  assert.match(css, /\.dktile\.dkstack \{[\s\S]*?grid-column: span 2;/,
    'a stacked tile spans two columns so the offset has somewhere to go');
});

test('§4d the shared page shows the SAME stats panel, not a thinner copy', () => {
  assert.match(metaSrc, /import \{ deckStatsHtml \} from '\.\/decks\.ts';/,
    'element requirements and mana values were already computed and rendered for the builder — '
    + 'growing a second, thinner panel on the shared page is how the two come to disagree');
  assert.match(metaSrc, /deckStatsHtml\(a\)/);
  assert.match(decksSrc, /export function deckStatsHtml/);
});

test('§4e the stats really do carry element requirements and mana values', () => {
  // the owner asked for these two by name; they are computed by analyzeDeck
  // and this pins that the panel is fed the whole analysis rather than a slice
  assert.equal(typeof A.avgMana, 'number');
  assert.ok(A.curve.length > 0, 'mana values');
  assert.ok('affinityFloor' in A && typeof A.affinityFloor === 'number', 'element requirements');
  assert.ok(A.rows.length > 0, 'and by when you need them');
});
