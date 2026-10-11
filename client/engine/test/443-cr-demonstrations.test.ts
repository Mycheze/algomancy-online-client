/**
 * A text-less example is a DEMONSTRATION: the test that shows the rule, with
 * no scenario printed under it (the 2026-10-11 examples audit demoted 678
 * examples that restated their rule or paraphrased a test title). The schema
 * takes `{ text: null, test }` and nothing looser: a null text with no test
 * binding demonstrates nothing, and an empty string is still a missing text.
 * The verdict pins the binding either way, so a demonstration whose test is
 * swapped reads as changed after verification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHash, validateRecord } from '../scripts/cr/schema.mjs';

type Example = { text: string | null; test?: string | null };
const rule = (examples: Example[]) => ({
  key: 'concepts.ending.concede', parent: '104', order: 4,
  text: 'A player may concede.', examples, see: [],
  sources: { printed: [], designer: [], ours: [], rulings: [], history: [], engine: [], tests: [] },
  basis: 'owner', confidence: 'high',
});
const T = '58-playtest-round9.test.ts::R65: conceding ends the game the way a lethal blow does';
const exampleProblems = (examples: Example[]) => validateRecord(rule(examples)).filter((p: string) => p.includes('examples['));

test('443: a demonstration is { text: null, test }; null text needs a test, empty text is still missing', () => {
  assert.deepEqual(exampleProblems([{ text: null, test: T }]), []);
  assert.deepEqual(exampleProblems([{ text: 'A player concedes: the other player has won.', test: T }]), []);
  assert.equal(exampleProblems([{ text: null, test: null }]).length, 1);
  assert.equal(exampleProblems([{ text: null }]).length, 1);
  assert.equal(exampleProblems([{ text: '', test: T }]).length, 1);
  assert.equal(exampleProblems([{ text: null, test: 'no-separator.test.ts' }]).length, 1);
});

test('443: the verdict pin covers a demonstration binding, and differs from the same example with text', () => {
  const demo = recordHash(rule([{ text: null, test: T }]));
  assert.notEqual(demo, recordHash(rule([{ text: null, test: T.replace('R65', 'R66') }])));
  assert.notEqual(demo, recordHash(rule([{ text: 'A player concedes.', test: T }])));
  assert.notEqual(demo, recordHash(rule([])));
});
