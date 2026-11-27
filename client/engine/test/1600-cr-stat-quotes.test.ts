/**
 * A card's printed stats or cost, quoted beside its name in a comprehensive
 * rule, must match the pool (scripts/cr/stat-quotes.mjs, read by check.mjs as
 * `card-stat-mismatch`; test 409 (3) runs it over the committed records).
 * Here: which shapes count as a claim about PRINT, which never do, and that a
 * changed card turns the committed records red by name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../scripts/cr/extract.mjs';
import type { CardStats, Extract } from '../scripts/cr/extract.d.mts';
import { loadInputs } from '../scripts/cr/render.mjs';
import { check } from '../scripts/cr/check.mjs';
import { statQuoteScanner } from '../scripts/cr/stat-quotes.mjs';
import printed from '../src/cards/printed.json' with { type: 'json' };

const CARDS: CardStats[] = [
  { name: 'Good Whale', power: 7, toughness: 5, mana: 6, cost: 'b', ambush: { cost: 'bb', mana: 4 } },
  { name: 'Rampart Guardian', power: 0, toughness: 4, mana: 2, cost: 'ee' },
  { name: 'Arc Lightning', power: 0, toughness: 0, mana: 4, cost: 'rr' },
  { name: 'Tidal Menace', power: 7, toughness: 2, mana: 3, cost: 'b' },
  { name: 'Wisp', power: 0, toughness: 1, mana: 0, cost: 'rr' },
  { name: 'Wildfire', power: 0, toughness: 0, mana: 'X', cost: 'r' },
];
const scan = statQuoteScanner(CARDS);
const claims = (t: string) => scan(t).map((q) => `${q.name} ${q.what} ${q.said}${q.ok ? '' : ' WRONG'}`);

test('CR stat quotes: the shapes that state a printed value are claims, right or wrong', () => {
  const cases: [string, string[]][] = [
    ['Good Whale (7/5) survives.', ['Good Whale stats 7/5']],
    ['Good Whale (7/6, Piercing) blocks.', ['Good Whale stats 7/6 WRONG']],
    ['Rampart Guardian (printed 0/4) is hit.', ['Rampart Guardian stats 0/4']],
    ['Rampart Guardian (a 0/4 with Tough) is dealt 5.', ['Rampart Guardian stats 0/4']],
    ['It deals 2 to Rampart Guardian (Vulnerable, 0/5).', ['Rampart Guardian stats 0/5 WRONG']],
    ['A player attacks with a 7/5 Good Whale.', ['Good Whale stats 7/5']],
    ['Damage is redirected into a 0/1 Wisp.', ['Wisp stats 0/1']],
    ['Tidal Menace, a {Haste} 7/3, is played.', ['Tidal Menace stats 7/3 WRONG']],
    ['The Wisp prints 0/1.', ['Wisp stats 0/1']],
    ['Rampart Guardian costs 3: three become expended.', ['Rampart Guardian cost 3 WRONG']],
    ['Good Whale (cost orb 6) cannot be played.', ['Good Whale cost 6']],
    ['Arc Lightning (rr, cost 4) cannot be played.', ['Arc Lightning cost 4', 'Arc Lightning pips rr']],
    ['playing Arc Lightning, cost 5, expends five.', ['Arc Lightning cost 5 WRONG']],
    ['Good Whale (main cost 6, Ambush 3) can be chosen.', ['Good Whale cost 6', 'Good Whale ambush 3 WRONG']],
  ];
  for (const [text, want] of cases) assert.deepEqual(claims(text), want, text);
});

test('CR stat quotes: modified stats, modifiers, copies and quoted card text are never claims', () => {
  for (const text of [
    'Good Whale gets +1/+1 and is now 8/6.',
    'A Good Whale with a +1/+1 counter is an 8/6.',
    'It makes a 3/3 copy of Good Whale.',
    'Under the Statweaver it is a 3/3 Good Whale until regroup.',
    'The Wisp enters as a 2/2 Wisp.',
    'Good Whale (-1/-1 for each card in hand) shrinks.',
    'A 3/3 Wisp token is created.',
    'Rampart Guardian costs 2 more under the tax.',
    'Arc Lightning ("cost 2 or less") cannot return it.',
    'Wildfire\'s cost is 0 when cast for X = 0.',
    'Two Good Whales (8/6 each) attack.',
  ]) assert.deepEqual(claims(text), [], text);
});

test('CR stat quotes: a printed X compares as X', () => {
  assert.deepEqual(claims('Wildfire costs X.'), ['Wildfire cost X']);
  assert.deepEqual(claims('Wildfire costs 3.'), ['Wildfire cost 3 WRONG']);
});

const EX: Extract = extract();

test('CR stat quotes: the extract reads every pool card from printed.json', () => {
  const pool = Object.values(printed as Record<string, CardStats>);
  const by = new Map((EX.cardStats ?? []).map((c) => [c.name, c]));
  for (const c of pool) {
    const s = by.get(c.name);
    assert.ok(s, `${c.name} has no cardStats row`);
    assert.deepEqual([s.power, s.toughness, s.mana, s.cost], [c.power, c.toughness, c.mana, c.cost], c.name);
  }
});

test('CR stat quotes: a changed card turns the committed records red by name', () => {
  const inputs = loadInputs();
  const edited = (EX.cardStats ?? []).map((c) => (c.name === 'Good Whale' ? { ...c, toughness: 6 } : c.name === 'Rampart Guardian' ? { ...c, mana: 3 } : c));
  const bad = check(inputs, { ...EX, cardStats: edited }).problems.filter((p) => p.code === 'card-stat-mismatch');
  assert.ok(bad.some((p) => /Good Whale's stats as 7\/5; the card prints 7\/6/.test(p.msg)), JSON.stringify(bad));
  assert.ok(bad.some((p) => /Rampart Guardian's cost as 2; the card prints 3/.test(p.msg)), JSON.stringify(bad));
});
