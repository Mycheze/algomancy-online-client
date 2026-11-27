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
import { allFaces, loadPrinted, looseFaces, parseFile, parseFaces, rewriteFaces, setFiles, type FaceCard } from '../scripts/face-comment.mjs';

const PRINTED = loadPrinted();
const ROWS = allFaces(PRINTED);

test('face comments: the parser reaches the face comments of the card files', () => {
  // a parser gone blind would pass the lock below with nothing to check
  assert.ok(ROWS.length >= 434, `only ${ROWS.length} face comments parsed`);
  assert.ok(new Set(ROWS.map((r) => r.file)).size >= 25, 'face comments parsed in too few set files');
});

test('face comments: every face in the card files is tied to its card', () => {
  const loose = looseFaces().map((r) => `${relative(REPO_ROOT, r.file)}:${r.line}`);
  assert.deepEqual(loose, [], 'a face no card() claims unambiguously goes unchecked: move it directly above its card()');
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

test('face comments: a face above a helper is the next cards only when nothing else could claim it', () => {
  const helper = '// "Drain." — ld/2 2/2 Horror Unit.\n//\n// More notes.\nconst DRAIN = 1;\nconst drain = { run: () => DRAIN };\ncard(\'Murk\', { effect: drain });\n';
  const [d] = parseFaces(helper);
  assert.deepEqual([d!.name, d!.faces.length, d!.faces[0]!.line], ['Murk', 1, 1]);
  assert.equal(rewriteFaces(helper, 'Murk', unit({ cost: 'ld', mana: 3, power: 1, toughness: 1 })), helper.replace('ld/2 2/2', 'ld/3 1/1'));
  // a card with its own face: the one above its helpers is ambiguous
  const both = '// "A." — l/1 1/1 Unit.\nconst a = 1;\n// "B." — d/1 2/2 Unit.\ncard(\'B\', {});\n';
  assert.deepEqual(parseFile(both).defs[0]!.faces.map((f) => f.pips), ['d']);
  assert.deepEqual(parseFile(both).loose.map((f) => f.pips), ['l']);
  // two faces before one card: neither is claimed
  const two = '// "A." — l/1 1/1 Unit.\nconst a = 1;\n// "B." — d/1 2/2 Unit.\nconst b = 2;\ncard(\'B\', {});\n';
  assert.deepEqual([parseFile(two).defs[0]!.faces.length, parseFile(two).loose.length], [0, 2]);
  // a name in double quotes is a card() too
  assert.deepEqual(parseFaces('// "X." — d/1 5/3 Unit.\ncard("Möbius\'s Corruption", {});\n').map((x) => [x.name, x.faces.length]), [["Möbius's Corruption", 1]]);
});
