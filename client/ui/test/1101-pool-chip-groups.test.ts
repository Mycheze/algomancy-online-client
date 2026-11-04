/* 1101 — THE BUILDER'S POOL CHIPS: OR INSIDE A GROUP, AND BETWEEN GROUPS
 * (BL-65 W0, architecture §0 ruling 4). cardsearch.ts poolChosen /
 * withPoolGroup / togglePoolChip edit the query STRING, in the language the
 * Cards page already speaks; the search itself is the one parser.
 *
 * §1 the string: one value is a plain term, two or more a parenthesised OR; a
 *    tap adds or removes one; the last one out removes the group
 * §2 the meaning, through the real search: fire OR metal = cards with either;
 *    cost 2 OR 3; groups AND with each other and with typed text
 * §3 what was typed survives: spacing, other terms, a top-level OR (wrapped),
 *    a negated or nested term of the same key (left alone, not read as a chip)
 * §4 the Cards page's chips are unchanged: a single pool value is the term
 *    withChip writes and chipState lights
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { POOL_GROUPS, POOL_GROUP_KEY, chipState, poolChosen, search, togglePoolChip, withChip, withPoolGroup } from '../cardsearch.ts';

const names = (q: string): Set<string> => new Set(search(q).rows.map(r => r.name));

test('1101 §1 the string: a term, then an OR group; taps add and remove; the last one out clears', () => {
  assert.deepEqual(POOL_GROUPS, ['cost', 'element', 'kind']);
  assert.deepEqual(POOL_GROUP_KEY, { cost: 'mana', element: 'el', kind: 'kind' });
  let q = togglePoolChip('', 'element', 'fire');
  assert.equal(q, 'el:fire');
  q = togglePoolChip(q, 'element', 'metal');
  assert.equal(q, '(el:fire OR el:metal)');
  assert.deepEqual(poolChosen(q, 'element'), ['fire', 'metal']);
  q = togglePoolChip(q, 'cost', '2');
  q = togglePoolChip(q, 'cost', '3');
  assert.equal(q, '(el:fire OR el:metal) (mana:2 OR mana:3)');
  q = togglePoolChip(q, 'element', 'fire');
  assert.equal(q, 'el:metal (mana:2 OR mana:3)');
  q = togglePoolChip(q, 'element', 'METAL');
  assert.equal(q, '(mana:2 OR mana:3)', 'case does not matter; the last one out removes the group');
  assert.deepEqual(poolChosen(q, 'element'), []);
  assert.equal(withPoolGroup(q, 'cost', []), '');
  assert.equal(withPoolGroup('', 'kind', ['unit', 'unit']), 'kind:unit', 'a value once');
  assert.equal(withPoolGroup('x', 'cost', ['X']), 'x mana:X');
});

test('1101 §2 the meaning: OR within a group, AND across groups and with the text', () => {
  const fire = names('el:fire'), metal = names('el:metal');
  const either = names(togglePoolChip('el:fire', 'element', 'metal'));
  assert.ok(fire.size > 0 && metal.size > 0);
  assert.deepEqual(either, new Set([...fire, ...metal]), 'fire OR metal = cards having any of them');
  const two = names('mana:2'), three = names('mana:3');
  const cost = names(withPoolGroup('', 'cost', ['2', '3']));
  assert.deepEqual(cost, new Set([...two, ...three]));
  const both = withPoolGroup(withPoolGroup('', 'cost', ['2', '3']), 'element', ['fire', 'metal']);
  const want = [...cost].filter(n => either.has(n));
  assert.ok(want.length > 0);
  assert.deepEqual(names(both), new Set(want), 'the groups AND');
  const units = names(withPoolGroup(both, 'kind', ['unit']));
  assert.ok(units.size > 0 && units.size < want.length && [...units].every(n => want.includes(n)));
  const spellsAndUnits = names(withPoolGroup(both, 'kind', ['unit', 'spell']));
  assert.deepEqual(spellsAndUnits, names(both), 'unit OR spell is every card that is either (a spell unit is both)');
});

test('1101 §3 what was typed survives a tap', () => {
  assert.equal(togglePoolChip('dragon  sort:mana', 'element', 'fire'), 'dragon  sort:mana el:fire', 'appended, the rest as typed');
  assert.equal(togglePoolChip('dragon el:fire sort:mana', 'element', 'water'), 'dragon (el:fire OR el:water) sort:mana', 'replaced in place');
  assert.equal(togglePoolChip('dragon (el:fire OR el:water) sort:mana', 'element', 'water'), 'dragon el:fire sort:mana');
  assert.equal(togglePoolChip('sub:sprite OR sub:demon', 'cost', '1'), '(sub:sprite OR sub:demon) mana:1', 'a top-level OR is wrapped');
  // the user's own terms of the same key are theirs
  assert.deepEqual(poolChosen('-el:fire', 'element'), [], 'a negated term is not a chip');
  assert.deepEqual(poolChosen('(el:fire mana:2)', 'element'), [], 'nor one inside a group the user built');
  assert.deepEqual(poolChosen('el:fire OR mana:2', 'element'), [], 'nor one branch of a top-level OR');
  assert.deepEqual(poolChosen('mana<=3', 'cost'), [], 'a range is not a chip');
  assert.deepEqual(poolChosen('el:fire,wood', 'element'), ['fire,wood'], 'a comma list is one value as written (it means AND)');
  assert.equal(togglePoolChip('-el:fire', 'element', 'wood'), '-el:fire el:wood');
});

test('1101 §4 the Cards page\'s chips are unchanged; a single pool value is their term', () => {
  const q = togglePoolChip('', 'element', 'fire');
  assert.equal(q, withChip('', 'el', 'fire', 'on'));
  assert.equal(chipState(q, 'el', 'fire'), 'on');
  assert.equal(withChip('el:fire', 'el', 'metal', 'on'), 'el:fire el:metal', 'withChip still ANDs');
});
