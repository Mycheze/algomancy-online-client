/* 1074 — EVERY SCREEN IS LEAVABLE WITHOUT THE ADDRESS BAR (owner, 2026-11-04:
 * "Every SINGLE page must be accessible (and leavable) without touching the
 * URL bar (since we're treating this like a stand alone app that just
 * happens to run in browser)").
 *
 * An audit of every screen (2026-11-04) found the board stranded a player in
 * five places: spectating (no concede to make, and the server sends watchers
 * no post-game screen), a room that closed while the device slept (the
 * rejoin's refusal landed as a red line on a dead board), a replay that did
 * not load (an empty board), a frozen game, and ?demo (its "New game" button
 * had no handler). Test mode's "Leave the match" drew no end screen until a
 * reload — that one was the server's (test-sandbox.ts holds it).
 *
 * §1 the table's ☰ menu goes home wherever this client has no live seat:
 *    the entry exists, is last, and a spectator is offered no concede
 * §2 main.ts asks for it in exactly those cases, and routes it home
 * §3 the ended-game bar always has a way home, and the dead button is gone
 * §4 a refused REjoin drops to the refused screen (its way home) instead of
 *    a red line on a board that is gone
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { boardMenuEntries } from '../inspect.ts';

const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const s = new Harness(1234).state;

test('1074 §1 the table menu goes home where there is no live seat to play', () => {
  const kinds = (o: Parameters<typeof boardMenuEntries>[2]) => boardMenuEntries(s, 0, o).map(e => e.kind);
  assert.ok(!kinds({}).includes('home'), 'a player mid-game leaves by conceding, as before');
  assert.ok(kinds({}).includes('concede'), 'positive control: the player is offered the concede');
  const home = kinds({ home: true });
  assert.equal(home[home.length - 1], 'home', 'Home is the last entry');
  const watching = kinds({ home: true, spectating: true, fixes: true });
  assert.ok(watching.includes('home'));
  assert.ok(!watching.includes('concede') && !watching.includes('fix'), 'a spectator has no seat to concede or fix for');
  assert.equal(boardMenuEntries(s, 0, { home: true }).find(e => e.kind === 'home')!.confirm, false, 'going home is not data-losing: no confirm');
});

test('1074 §2 main.ts offers Home in exactly those cases, and it goes home', () => {
  assert.match(MAIN, /const home = !NET \|\| spectating \|\| h\.state\.phase === 'gameover' \|\| !!NET\.frozen;/);
  assert.match(MAIN, /entry\.kind === 'home'\s*\?\s*\(\): void => \{ goHome\(\); \}/);
  assert.match(MAIN, /function goHome\(\): void \{\s*location\.href = location\.pathname;/);
  assert.match(MAIN, /if \(b === 'gohome'\) \{ goHome\(\); return true; \}/, 'the old gohome buttons go the same way');
});

test('1074 §3 the ended-game bar always has a way home; the dead button is gone', () => {
  const bar = MAIN.slice(MAIN.indexOf("if (s.phase === 'gameover') {\n    const won"), MAIN.indexOf('// Playtest 2026-08-20: "when a decision is pending'));
  assert.ok(bar.length > 200, 'positive control: the ended-game bar is read');
  assert.match(bar, /const home = '<button data-btn="gohome">Home<\/button>';/);
  assert.equal((bar.match(/\$\{home\}/g) ?? []).length, 2, 'both the net bar and the local one carry it');
  assert.doesNotMatch(MAIN, /data-btn="restart"/, '"New game" had no handler and must not come back as one');
});

test('1074 §4 a refused rejoin is the refused screen, not a red line on a dead board', () => {
  assert.match(MAIN, /this\.ws\.onopen = \(\) => \{\s*this\.reconnectDelay = 1000;\s*this\.rejoining = this\.joined;/);
  const onMsg = MAIN.slice(MAIN.indexOf('  private onMsg(m: NetMsg): void {'));
  assert.match(onMsg.slice(0, 300), /if \(m\.t === 'joined' \|\| m\.t === 'watching'\) this\.rejoining = false;/,
    'the flag clears the moment the rejoin is answered — before any branch can return');
  assert.match(onMsg, /if \(m\.t === 'error' && this\.rejoining\) \{\s*this\.rejoining = false;\s*this\.joined = false;/);
  assert.match(MAIN, /if \(NET && !NET\.joined\) \{ hideHoverTip\(\); renderConnecting\(\); return false; \}/,
    'not joined is the connecting / refused screen, which has its way home');
});
