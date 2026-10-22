/**
 * CR 206.2 / CT-244 — STATS MARK A UNIT; A SPELL PRINTS NONE.
 *
 * The oracle transcription carries power and toughness on 91 of 138 spell
 * rows (Arc Lightning 1/3, Interdiction Rift 4/3, Spectrogenesis 4/5) that no
 * card shows. They are zeroed at extraction (scripts/extract-printed.mjs),
 * not in the oracle, and the card search keeps every spell out of a stat
 * comparison, so neither the transcribed numbers (`pow>=3` found 4/3
 * Interdiction Rift) nor the zeroes (`pow<=2` would find every spell) can
 * reach a search. A spell unit is a unit and keeps its stats.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import { allRows } from '../cardindex.ts';
import { search } from '../cardsearch.ts';

const names = (src: string): string[] => search(`${src} class:all`).rows.map(r => r.name);

test('CR 206.2 / CT-244: no spell in the engine pool or the catalogue carries power or toughness', () => {
  const spells = allCardNames().map(getCard).filter(c => c.kind === 'spell');
  assert.ok(spells.length > 100, 'the pool has its spells');
  for (const c of spells) assert.deepEqual([c.power, c.toughness], [0, 0], `${c.name} prints no stats`);
  for (const r of allRows().filter(r => r.kind === 'spell')) {
    assert.deepEqual([r.power, r.toughness], [0, 0], `catalogue: ${r.name} prints no stats`);
  }
  // a spell UNIT is a unit, and keeps them
  assert.ok(allCardNames().map(getCard).some(c => c.kind === 'spellUnit' && c.power + c.toughness > 0),
    'spell units keep their printed stats');
});

test('CR 206.2 / CT-244: a stat search never finds a spell', () => {
  for (const q of ['pow>=3', 'pow<=2', 'pow=0', 'tou<2', 'pt>=0', 'pow!=7']) {
    const hits = names(q);
    assert.ok(hits.length > 0, `${q} finds units`);
    const spells = hits.filter(n => allRows().find(r => r.name === n)?.kind === 'spell');
    assert.deepEqual(spells, [], `${q} finds no spell`);
  }
  assert.ok(!names('pow>=3').includes('Interdiction Rift'), 'the transcribed 4/3 is gone');
});
