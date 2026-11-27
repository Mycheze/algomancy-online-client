/* 1505 · AN EDIT'S DIFF AND ITS ROAD (ui/cardnotation.ts; client/docs/card-editor.md §5)
 *
 *  §1 notation alone is never a change, on any card
 *  §2 the road table: numbers, affinity and art go fast; text, type, name, complexity go to the steward
 *  §3 an affinity change carries the new factions and deck, or goes to the steward when the deck
 *     cannot be worked out
 *  §4 the colour rules reproduce the oracle: factions on every card, the deck wherever it is derived
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORACLE_JSON } from '../../engine/scripts/paths.mjs';
import {
  changedFields, deckFor, diffRow, editorFields, factionsFor, oracleValues, road, type DiffEntry, type EditorFields,
  type OracleRow,
} from '../cardnotation.ts';

const ORACLE = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, OracleRow[]>;
const ROWS = Object.values(ORACLE).map(v => v[0]!);
const row = (name: string): OracleRow => ORACLE[name]![0]!;

/** The diff an on-screen edit makes, the way the server computes it. */
const diffOf = (name: string, screen: EditorFields): DiffEntry[] =>
  diffRow(row(name), oracleValues(changedFields(row(name), screen)));

test('§1 notation alone never counts as a change', () => {
  for (const r of ROWS) {
    assert.deepEqual(diffRow(r, oracleValues(editorFields(r))), [], r.name);
    assert.deepEqual(changedFields(r, editorFields(r)), {}, r.name);
  }
});

/** [what changed, the edit on Murkstalker (ld, 2, 2/2), the road, the reasons]. */
const TABLE: readonly [string, EditorFields, 'fast' | 'steward', string[]][] = [
  ['power alone', { power: '3' }, 'fast', []],
  ['toughness alone', { toughness: '3' }, 'fast', []],
  ['total cost alone', { 'total cost': '3' }, 'fast', []],
  ['affinity alone', { cost: 'w' }, 'fast', []],
  ['every number at once', { power: '3', toughness: '1', 'total cost': '4', cost: 'ww' }, 'fast', []],
  ['art alone', { image: 'images_out/Stable/murk3.png' }, 'fast', []],
  ['art with numbers', { image: 'images_out/Stable/murk3.png', power: '4' }, 'fast', []],
  ['text', { text: 'When you trash another card, [Switch1] Each opponent loses 3 life.' }, 'steward', ['the text changed']],
  ['type', { type: 'Unit — Cosmic Alien' }, 'steward', ['the type line changed']],
  ['complexity', { complexity: 'Simple' }, 'steward', ['the complexity changed']],
  ['text with numbers', { text: 'Draw a card.', power: '5' }, 'steward', ['the text changed']],
];

test('§2 the road table, one case per row', () => {
  for (const [what, screen, want, why] of TABLE) {
    const diff = diffOf('Murkstalker', screen);
    assert.ok(diff.length, `${what}: no diff`);
    assert.deepEqual(road(diff), { road: want, why }, what);
  }
  const renamed = diffRow(row('Murkstalker'), { name: 'Murkwalker' });
  assert.deepEqual(road(renamed), { road: 'steward', why: ['the name changed'] });
  assert.deepEqual(diffOf('Murkstalker', { 'total cost': '3' }), [{ field: 'total_cost', from: '2', to: '3' }]);
});

test('§3 an affinity change carries its factions and deck', () => {
  // Light & Dark: the deck follows the pips, Light then Dark then the other element
  assert.deepEqual(diffOf('Murkstalker', { cost: 'w' }), [
    { field: 'cost', from: 'ld', to: 'l' },
    { field: 'factions', from: ['light', 'dark'], to: ['light'] },
    { field: 'Deck', from: 'Light & Dark (Light/Dark)', to: 'Light & Dark (Light)' },
  ]);
  assert.deepEqual(diffOf('Exhume', { cost: 'bk' }).slice(1), [
    { field: 'factions', from: ['dark'], to: ['water', 'dark'] },
    { field: 'Deck', from: 'Light & Dark (Dark)', to: 'Light & Dark (Dark/Water)' },
  ]);
  // more of the same colour: no colour moves
  assert.deepEqual(diffOf('Murkstalker', { cost: 'wwk' }), [{ field: 'cost', from: 'ld', to: 'lld' }]);
  // a base-set card moves to another element's deck
  const fire = ROWS.find(r => r['Deck'] === 'Fire' && r.cost === 'r')!;
  assert.deepEqual(diffOf(fire.name, { cost: 'b' }).slice(1), [
    { field: 'factions', from: ['fire'], to: ['water'] },
    { field: 'Deck', from: 'Fire', to: 'Water' },
  ]);
  assert.equal(road(diffOf(fire.name, { cost: 'b' })).road, 'fast');
  // decks no rule gives: two base elements, a hybrid, light on a base card, a colourless card
  const hybrid = ROWS.find(r => r['Deck'] === 'Hybrid')!;
  const stolen = ROWS.find(r => r['Deck'] === 'Stolen Cards')!;
  for (const [name, cost] of [[fire.name, 'rb'], [hybrid.name, 'b'], [fire.name, 'w'], ['Murkstalker', 'r'], [stolen.name, 'r']] as const) {
    const diff = diffOf(name, { cost });
    assert.deepEqual(diff.at(-1)?.field, 'Deck', `${name} → ${cost}`);
    assert.equal(diff.at(-1)?.to, null, `${name} → ${cost}`);
    assert.deepEqual(road(diff), { road: 'steward', why: ["its deck can't be worked out from the new affinity"] }, `${name} → ${cost}`);
  }
});

test('§4 the colour rules reproduce the oracle', () => {
  let derived = 0;
  for (const r of ROWS) {
    assert.deepEqual(factionsFor(r.cost), r['factions'], `${r.name}: factions of ${r.cost}`);
    const deck = deckFor(r['Deck'], r.cost);
    if (deck === null) continue;
    assert.equal(deck, r['Deck'], `${r.name}: deck of ${r.cost}`);
    derived++;
  }
  assert.ok(derived > 400, `only ${derived} decks derived`);
});
