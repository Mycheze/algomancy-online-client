/* The hand's order on screen (ui/handorder.ts) is the player's, and it is
 * drawing only: the hand is drawn in that order, but every card still carries
 * its engine index, so no action can be told the hand was rearranged. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectOrder, moveCard, reconcile } from '../handorder.ts';

const drawn = (o: { order: readonly number[] }, names: string[]): string[] => o.order.map(i => names[i]!);

test('a new hand is drawn as the game holds it', () => {
  const o = reconcile(null, ['A', 'B', 'C']);
  assert.deepEqual(o.order, [0, 1, 2]);
});

test('a card dragged to a new place stays there, and an unchanged hand keeps the order', () => {
  const names = ['A', 'B', 'C', 'D'];
  let o = reconcile(null, names);
  o = moveCard(o, 3, 0);                       // D to the front
  assert.deepEqual(drawn(o, names), ['D', 'A', 'B', 'C']);
  o = moveCard(o, 0, 2);                       // A between B and C
  assert.deepEqual(drawn(o, names), ['D', 'B', 'A', 'C']);
  assert.equal(reconcile(o, [...names]), o);
});

test('a card played leaves the rest where they were; a card drawn joins at the right', () => {
  let names = ['A', 'B', 'C', 'D'];
  let o = moveCard(reconcile(null, names), 3, 0);   // D A B C
  names = ['A', 'C', 'D'];                          // B played: the engine closes ranks
  o = reconcile(o, names);
  assert.deepEqual(drawn(o, names), ['D', 'A', 'C']);
  names = ['A', 'C', 'D', 'E'];                     // E drawn
  o = reconcile(o, names);
  assert.deepEqual(drawn(o, names), ['D', 'A', 'C', 'E']);
});

test('duplicates keep their places', () => {
  let names = ['X', 'Y', 'X'];
  let o = moveCard(reconcile(null, names), 2, 0);   // X(2) X(0) Y
  names = ['X', 'Y', 'X', 'Z'];
  o = reconcile(o, names);
  assert.deepEqual(o.order, [2, 0, 1, 3]);
});

test('the draft step\'s hand row is the order the next hand takes', () => {
  const before = ['A', 'B'];
  let o = expectOrder(reconcile(null, before), before, ['P', 'B', 'A', 'Q']);
  assert.equal(reconcile(o, before).want?.length, 4, 'held until the hand changes');
  const after = ['A', 'B', 'P', 'Q'];               // the engine's pile order
  o = reconcile(o, after);
  assert.deepEqual(drawn(o, after), ['P', 'B', 'A', 'Q']);
  assert.equal(o.want, null);
});

test('a hand that does not match what the draft row expected falls back to lining up', () => {
  const before = ['A', 'B'];
  let o = expectOrder(reconcile(null, before), before, ['A', 'Q']);
  o = reconcile(o, ['A', 'B', 'C']);
  assert.deepEqual(o.order, [0, 1, 2]);
  assert.equal(o.want, null);
});

test('main.ts draws the hand in that order and still tags every card with its engine index', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const zone = /function handZoneHtml[\s\S]*?\n}\n/.exec(main)?.[0] ?? '';
  assert.match(zone, /shownOrder\(p\)/, 'the hand zone draws in the shown order');
  assert.match(zone, /data-act="hand" data-p="\$\{p\}" data-i="\$\{i\}"/, 'data-i is still the engine index');
  assert.ok(!/handorder|shownOrder|hand\.order/.test(/function (act|sendAction)\b[\s\S]*?\n}\n/.exec(main)?.[0] ?? ''),
    'nothing that sends an action reads the order');
});
