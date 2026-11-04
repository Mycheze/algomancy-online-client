/* 1109 · UNDO/REDO (ui/history.ts) AND THE DIVIDER (ui/splitter.ts) — the pure parts.
 *
 *   §1 record → undo → redo walks the snapshots; a new change drops Redo
 *   §2 snapshots are copies (a later edit of the host's arrays cannot reach in)
 *   §3 capped at HISTORY_CAP; another table's history is not this one's
 *   §4 the divider: clamped, stepped by ▲ ▼, read from a pointer's y
 *   §5 the controller: place() records before its one commit, and an Undo is
 *      a commit of the snapshot through the same door (source-level)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canRedo, canUndo, emptyHistory, HISTORY_CAP, record, redo, undo, type Snap } from '../history.ts';
import { clampSplit, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, splitAt, stepSplit } from '../splitter.ts';

const S = (cards: string[]): Snap => ({ cards, maybe: [], side: null, piles: null });

test('§1 record, undo, redo', () => {
  let h = emptyHistory('d1');
  assert.ok(!canUndo(h, 'd1') && !canRedo(h, 'd1'));
  h = record(h, S(['a']));          // a → ab
  h = record(h, S(['a', 'b']));     // ab → abc
  const u = undo(h, S(['a', 'b', 'c']))!;
  assert.deepEqual(u.to.cards, ['a', 'b']);
  assert.ok(canRedo(u.h, 'd1'));
  const u2 = undo(u.h, u.to)!;
  assert.deepEqual(u2.to.cards, ['a']);
  assert.equal(undo(u2.h, u2.to), null, 'nothing further back');
  const r = redo(u2.h, u2.to)!;
  assert.deepEqual(r.to.cards, ['a', 'b']);
  const fork = record(r.h, r.to);
  assert.ok(!canRedo(fork, 'd1'), 'a new change drops Redo');
});

test('§2 copies', () => {
  const cards = ['a'];
  const h = record(emptyHistory('d1'), S(cards));
  cards.push('x');
  assert.deepEqual(h.past[0]!.cards, ['a']);
});

test('§3 the cap, and the key', () => {
  let h = emptyHistory('d1');
  for (let i = 0; i < HISTORY_CAP + 20; i++) h = record(h, S([String(i)]));
  assert.equal(h.past.length, HISTORY_CAP);
  assert.deepEqual(h.past[0]!.cards, ['20'], 'the oldest go first');
  assert.ok(!canUndo(h, 'd2'), 'another table');
});

test('§4 the divider', () => {
  assert.equal(clampSplit(NaN), SPLIT_DEFAULT);
  assert.equal(clampSplit(5), SPLIT_MAX);
  assert.equal(clampSplit(-1), SPLIT_MIN);
  assert.ok(stepSplit(0.4, 1) > 0.4 && stepSplit(0.4, -1) < 0.4);
  assert.equal(splitAt(500, 100, 800), 0.5);
  assert.equal(splitAt(0, 100, 0), SPLIT_DEFAULT, 'no height: the default');
});

test('§5 the history goes through the one door', () => {
  const tt = readFileSync(new URL('../tabletop.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const place = tt.slice(tt.indexOf('export function place('), tt.indexOf('export function tabletopChanged('));
  assert.match(place, /hist = stepped \?\? record\(histFor\(h\), snapNow\(h\)\);\s*front = landed;\s*h\.commit\(next\);/,
    'recorded just before the one commit');
  assert.match(place, /\(e\.op === 'undo' \? undoStep : redoStep\)\(histFor\(h\), snapNow\(h\)\)/, 'Undo and Redo are snapshots committed here');
  assert.match(tt, /case 'tt-undo':\s*case 'tt-redo':[\s\S]*?place\(h, null, \{ at: 'arrange', edit: \{ op:/);
  assert.match(tt, /if \(mod && !e\.altKey && \(k === 'z' \|\| k === 'y'\) && !typing\(e\.target\)/, 'Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y, never in a text box');
});
