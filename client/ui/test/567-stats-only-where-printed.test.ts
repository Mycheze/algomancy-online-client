/**
 * CR 206.2 / CT-244 — EVERY SURFACE SHOWS STATS EXACTLY WHERE A CARD PRINTS THEM.
 *
 * Stats mark a unit. A unit and a spell unit print power and toughness; a
 * spell and a spell token print none. Two halves were wrong:
 *
 *  · the spell TOKEN rows (Fireball, Poison, Crystal) carried 3/3 from the
 *    transcription, and the card panel, the browser row and the sandbox line
 *    guarded only on kind === 'spell', so a Fireball read "Spell Token · 3/3";
 *  · the off-table text box (printedTextBox) dropped the stats of every card
 *    that was not kind 'unit', so a SPELL UNIT in hand (Jelly 2/1) showed none.
 *
 * One predicate now decides both (dsl.ts printsStats), and the extractor
 * zeroes spell-token stats as it does a spell's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { allCardNames, getCard, printsStats } from '../../engine/src/cards/dsl.ts';
import { allRows } from '../cardindex.ts';
import { cardPanelHtml } from '../cardpanel.ts';
import { printedTextBox } from '../cardtext.ts';

const SRC = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('CR 206.2 / CT-244: spell tokens carry no stats in the pool or the catalogue', () => {
  const tokens = allCardNames().map(getCard).filter(c => c.kind === 'spellToken');
  assert.ok(tokens.some(c => c.name === 'Fireball'), 'the pool has its spell tokens');
  for (const c of tokens) assert.deepEqual([c.power, c.toughness], [0, 0], `${c.name} prints no stats`);
  for (const r of allRows().filter(r => r.kind === 'spellToken')) {
    assert.deepEqual([r.power, r.toughness], [0, 0], `catalogue: ${r.name}`);
  }
});

test('CR 206.2 / CT-244: a spell unit in hand shows its printed stats in the text box', () => {
  const jelly = printedTextBox('Jelly');
  assert.equal(getCard('Jelly').kind, 'spellUnit', 'fixture: Jelly is a spell unit');
  assert.ok(jelly.stats, 'the box has a stat line');
  assert.deepEqual([jelly.stats!.power, jelly.stats!.toughness], [getCard('Jelly').power, getCard('Jelly').toughness]);
  assert.equal(printedTextBox('Arc Lightning').stats, null, 'a spell has none');
  assert.equal(printedTextBox('Fireball').stats, null, 'nor does a spell token');
  assert.ok(printedTextBox('Good Whale').stats, 'and a unit keeps its own');
});

test('CR 206.2 / CT-244: the card panel prints stats only for a unit or a spell unit', () => {
  const statLine = (name: string): boolean => / · \d+\/\d+<\/div>/.test(cardPanelHtml(name, { close: 'x' }));
  assert.equal(statLine('Fireball'), false, 'no "· 3/3" on a spell token');
  assert.equal(statLine('Arc Lightning'), false, 'none on a spell');
  assert.equal(statLine('Jelly'), true, 'a spell unit shows its stats');
  assert.equal(statLine('Good Whale'), true, 'and so does a unit');
});

test('CR 206.2 / CT-244: the browser row and the sandbox line ask the same predicate', () => {
  assert.equal(printsStats('spellToken'), false);
  assert.equal(printsStats('spell'), false);
  assert.equal(printsStats('spellUnit'), true);
  assert.equal(printsStats('unit'), true);
  for (const f of ['cards.ts', 'sandbox.ts', 'cardpanel.ts', 'cardsearch.ts', 'cardtext.ts']) {
    assert.match(SRC(f), /printsStats\(/, `${f} decides stats with printsStats`);
    assert.doesNotMatch(SRC(f), /kind === 'spell' \? '/, `${f} has no spell-only stat guard left`);
  }
});
