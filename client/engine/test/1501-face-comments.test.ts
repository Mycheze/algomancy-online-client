/**
 * The printed face a card() definition quotes above itself (`— ee/2 2/3 …`)
 * agrees with printed.json, and scripts/face-comment.mjs, which the card-edit
 * job calls to restate it, rewrites only the numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { REPO_ROOT } from '../scripts/paths.mjs';
import { allFaces, loadPrinted, parseFaces, rewriteFaces, setFiles, type FaceCard } from '../scripts/face-comment.mjs';

const PRINTED = loadPrinted();
const ROWS = allFaces(PRINTED);

test('face comments: the parser reaches the face comments of the card files', () => {
  // a parser gone blind would pass the lock below with nothing to check
  assert.ok(ROWS.length >= 250, `only ${ROWS.length} face comments parsed`);
  assert.ok(new Set(ROWS.map((r) => r.file)).size >= 25, 'face comments parsed in too few set files');
});

test('face comments: every parseable face comment agrees with printed.json', () => {
  const bad = ROWS.filter((r) => r.bad.length).map((r) => `${relative(REPO_ROOT, r.file)}:${r.line} ${r.name}: ${r.bad.join('; ')}`);
  assert.deepEqual(bad, [], `restate them with node client/engine/scripts/face-comment.mjs --rewrite "<Name>":\n${bad.join('\n')}`);
});

test('face comments: rewriting every card from todays printed.json changes nothing', () => {
  const moved: string[] = [];
  for (const file of setFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const d of parseFaces(src)) {
      const c = PRINTED.get(d.name);
      if (c && rewriteFaces(src, d.name, c) !== src) moved.push(`${relative(REPO_ROOT, file)}:${d.line} ${d.name}`);
    }
  }
  assert.deepEqual(moved, []);
});

const unit = (o: Partial<FaceCard>): FaceCard => ({ name: 'X', cost: 'ee', mana: 2, power: 2, toughness: 3, kind: 'unit', ...o });

test('face comments: a rewrite restates pips, cost and stats in place and touches nothing else', () => {
  const src = [
    '// "[Augment] Abilities cost [one] more." — ee/2 2/3 Golem Beast Unit. CR 111.10f',
    "card('Bubb', {});",
    '',
    '// "Other." — ee/2 2/3 Golem Unit.',
    "card('Other', {});",
    '',
  ].join('\n');
  const out = rewriteFaces(src, 'Bubb', unit({ name: 'Bubb', cost: 'eee', mana: 3, power: 4, toughness: 3 }));
  assert.equal(out, src.replace('— ee/2 2/3 Golem Beast', '— eee/3 4/3 Golem Beast'));
  assert.equal(rewriteFaces(out, 'Bubb', unit({ name: 'Bubb', cost: 'eee', mana: 3, power: 4, toughness: 3 })), out, 'a second rewrite is a no-op');
  assert.equal(rewriteFaces(src, 'Missing', unit({})), src);
});

test('face comments: a face split across comment lines keeps its line break', () => {
  const src = '// "Text that runs long." —\n// rr/2\n// 3/2 Infernal Horror Unit.\ncard(\'Imp\', {});\n';
  assert.equal(rewriteFaces(src, 'Imp', unit({ cost: 'rrr', mana: 4, power: 5, toughness: 1 })),
    '// "Text that runs long." —\n// rrr/4\n// 5/1 Infernal Horror Unit.\ncard(\'Imp\', {});\n');
  const before = '// "Delete target unit."\n// bb/4 — {Battle} Maelstrom Spell.\ncard(\'Pull\', {});\n';
  assert.equal(rewriteFaces(before, 'Pull', unit({ cost: 'b', mana: 5, kind: 'spell' })), before.replace('bb/4 —', 'b/5 —'));
});

test('face comments: a plain spell that states stats loses them, a spell unit keeps them', () => {
  const spell = unit({ cost: 'bm', mana: 2, kind: 'spell', power: 0, toughness: 0 });
  const same = '// "Negate." — bm/2 2/1 {Battle} Cosmic Spell.\ncard(\'S\', {});\n';
  assert.deepEqual(parseFaces(same)[0]!.faces.map((f) => f.stats?.p), ['2']);
  assert.equal(rewriteFaces(same, 'S', spell), '// "Negate." — bm/2 {Battle} Cosmic Spell.\ncard(\'S\', {});\n');
  const eol = '// "Negate." — bm/2 2/1\n// {Battle} Cosmic Spell.\ncard(\'S\', {});\n';
  assert.equal(rewriteFaces(eol, 'S', spell), '// "Negate." — bm/2\n// {Battle} Cosmic Spell.\ncard(\'S\', {});\n');
  const next = '// "Negate." —\n// bm/2 2/1 {Battle} Cosmic Spell.\ncard(\'S\', {});\n';
  assert.equal(rewriteFaces(next, 'S', spell), '// "Negate." —\n// bm/2 {Battle} Cosmic Spell.\ncard(\'S\', {});\n');
  const su = '// "Forage." — g/3 3/1 Spell Unit.\ncard(\'F\', {});\n';
  assert.equal(rewriteFaces(su, 'F', unit({ cost: 'g', mana: 3, power: 3, toughness: 1, kind: 'spellUnit' })), su);
});

test('face comments: modifiers and stats outside the face are not read as the face', () => {
  const src = '// "I gain +2/+1. Create a 1/1." — r/2 2/1 Sprite Unit. A 3/3 copy stays 3/3.\ncard(\'Sprite\', {});\n';
  const [d] = parseFaces(src);
  assert.equal(d!.faces.length, 1);
  assert.deepEqual([d!.faces[0]!.pips, d!.faces[0]!.mana, d!.faces[0]!.stats?.p, d!.faces[0]!.stats?.t], ['r', '2', '2', '1']);
});
