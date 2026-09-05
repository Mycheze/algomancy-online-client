/* Test mode's "Concede" is "Leave" — the owner, 2026-09-05: "when in test
 * mode, 'Concede Match' should just be 'Leave Match' since it's not a real
 * match or anything. So you're just closing it, essentially." The action is
 * the same concede underneath; only the words change, and only when the
 * server-pushed state says the room was dealt as a sandbox. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { boardMenuEntries } from '../inspect.ts';
import { concessionNote, type GameOver } from '../postgame.ts';

const state = (sandbox: boolean) => { const s = new Harness(29200).state; if (sandbox) (s as { sandbox?: boolean }).sandbox = true; return s; };
const concedeLabel = (sandbox: boolean): string =>
  boardMenuEntries(state(sandbox), 0).find(e => e.kind === 'concede')!.label;

test('the menu says Leave in a sandbox and Concede in a real game', () => {
  assert.match(concedeLabel(true), /Leave the match/);
  assert.doesNotMatch(concedeLabel(true), /Concede/);
  assert.match(concedeLabel(false), /Concede the match/, 'positive control: a real game still concedes');
});

test('the confirmation says Leave / Stay in a sandbox, and the action underneath is the same concede', () => {
  const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
  const fn = MAIN.slice(MAIN.indexOf('function concedeHtml(): string {'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /h\.state\.sandbox/);
  assert.match(body, /<h3>Leave the match\?<\/h3>/);
  assert.match(body, /nothing is recorded/);
  assert.equal((body.match(/data-btn="concedeyes"/g) ?? []).length, 2, 'both branches confirm through the one concede button');
});

test('the post-game weight note is silent for a game that went into nobody\'s record', () => {
  const base = { seat: 0, names: ['A', 'B'], concession: { seat: 1, turn: 1, weight: 'walkover' } } as unknown as GameOver;
  assert.equal(concessionNote({ ...base, recorded: false }), '', 'a test-mode or signed-out leave is not a walkover to announce');
  assert.match(concessionNote({ ...base, recorded: true }), /Walkover/, 'positive control: a recorded one still is');
});
