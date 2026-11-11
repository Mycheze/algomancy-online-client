/* THE STACK VIEWER'S "X = N" FOR A SPELL'S OWN X IS JUST THE NUMBER.
 *
 * Owner, 2026-11-11 (#steward), with a screenshot of a Crystal token on the
 * stack whose hover read "X = 1 — played for X":
 *   "Saying 'X = 1 - played for X' is redundant. Just 'X = 1' is fine."
 *
 * The stack viewer (previewStackHtml in main.ts) prints one "X = N" row per X
 * an item carries. Two kinds say something the number does not: the event
 * that fired a trigger ("X is the damage I was dealt"), and what a variable
 * cost consumed. The third, a spell's own X, said only that it was the X —
 * the same "a sentence about the card" the owner had already struck from the
 * hand's count on 2026-11-03 (xRowsHtml). The wording now lives in one pure
 * function, `stackXHint`, and main.ts draws no note when it returns ''.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/sets/index.ts';
import { stackItemX, stackXHint } from '../inspect.ts';
import type { StackItem } from '../../engine/src/types.ts';

const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

test('a spell played for X = 1 shows X = 1 and no note', () => {
  const item = { id: 1, kind: 'spell', card: 'Crystal', label: 'Crystal', x: 1, parts: [] } as unknown as StackItem;
  const rows = stackItemX(item);
  assert.deepEqual(rows.map(r => [r.kind, r.x]), [['cast', 1]]);
  assert.equal(stackXHint(rows[0]!), '', 'the X it was played for needs no explaining');
});

test('the X rows that do carry news keep their note', () => {
  assert.equal(stackXHint({ kind: 'event', x: 3, from: 'Ana dealt 3 damage' }), 'Ana dealt 3 damage');
  assert.equal(stackXHint({ kind: 'event', x: 3 }), 'from the event that fired this');
  assert.equal(stackXHint({ kind: 'cost', x: 2, part: 0, source: 'Grave Pact', receipt: 'erased 2 cards' }),
    'Grave Pact, erased 2 cards');
  assert.equal(stackXHint({ kind: 'cost', x: 2, part: 0 }), 'additional cost');
});

test('the stack viewer draws its X note from stackXHint, and none when it is empty', () => {
  const at = MAIN.indexOf('function previewStackHtml(');
  assert.ok(at > 0, 'the stack viewer is where this test expects it');
  const body = MAIN.slice(at, MAIN.indexOf('\n}\n', at));
  assert.match(body, /const hint = stackXHint\(r\);/);
  assert.match(body, /\$\{hint \? ` <span class="hint">— \$\{esc\(hint\)\}<\/span>` : ''\}/);
  assert.doesNotMatch(MAIN, /'played for X'/, 'the old note is gone from the client');
});
