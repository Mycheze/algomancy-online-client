/* 1507 · THE UPDATE LINE A FAST-PATH CARD EDIT WRITES (ui/cardnotation.ts updateLine)
 *
 *  §1 what it says, for each kind of change
 *  §2 for every card in the pool, the line keeps the rules of the home page list (test 323)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORACLE_JSON } from '../../engine/scripts/paths.mjs';
import { MAX_UPDATE_CHARS } from '../updates.ts';
import { changedFields, diffRow, oracleValues, updateLine, type EditorFields, type OracleRow } from '../cardnotation.ts';

const ORACLE = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, OracleRow[]>;
const row = (name: string): OracleRow => ORACLE[name]![0]!;
const lineFor = (name: string, screen: EditorFields): string =>
  updateLine(name, diffRow(row(name), oracleValues(changedFields(row(name), screen))));

/** 323's own check for an internal id, read from that test so the rule stays in one place. */
const RULES_323 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '323-recent-updates.test.ts'), 'utf8');
const INTERNAL_ID = new RegExp(/^const INTERNAL_ID = \/(.+)\/;$/m.exec(RULES_323)![1]!);

test('§1 what the line says', () => {
  assert.equal(lineFor('Murkstalker', { 'total cost': '3' }), 'Murkstalker now costs 3 (was 2).');
  assert.equal(lineFor('Murkstalker', { power: '3', toughness: '1' }), 'Murkstalker is now 3/1 (was 2/2).');
  assert.equal(lineFor('Murkstalker', { power: '3' }), 'Murkstalker now has 3 power (was 2).');
  assert.equal(lineFor('Murkstalker', { image: 'images_out/Stable/murk3.png' }), 'Murkstalker has new card art.');
  assert.equal(lineFor('Murkstalker', { cost: 'w' }), 'Murkstalker now has light affinity (was light and dark).');
  assert.equal(lineFor('Murkstalker', { cost: 'wwk' }), 'Murkstalker now has 2 light and 1 dark affinity (was light and dark).');
  assert.equal(lineFor('Murkstalker', { 'total cost': 'X', toughness: '4', image: 'b.png' }),
    'Murkstalker now costs X (was 2), now has 4 toughness (was 2) and has new card art.');
});

test('§2 every card line keeps the home page rules', () => {
  const worst: EditorFields = { 'total cost': '13', cost: 'wwbk', power: '4046', toughness: '4046', image: 'images_out/Stable/a.png' };
  for (const name of Object.keys(ORACLE)) {
    for (const screen of [worst, { image: 'images_out/Stable/a.png' }] as const) {
      const line = lineFor(name, screen);
      assert.ok(line.length <= MAX_UPDATE_CHARS, `${line.length} chars: ${line}`);
      assert.ok(line.trim().length >= 20, `too short: ${line}`);
      assert.doesNotMatch(line, INTERNAL_ID, line);
      assert.doesNotMatch(line, /<[a-z/]/i, line);
      assert.doesNotMatch(line, /images_out|https?:|\.png|\[|\{/, `a path or markup in: ${line}`);
    }
  }
  assert.match('see CT-12', INTERNAL_ID, 'the id check read from 323 went blind');
});
