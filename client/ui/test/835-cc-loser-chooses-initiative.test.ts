/* docs/22 §8 answer 1 (owner, 2026-11-02) — THE PREVIOUS GAME'S LOSER CHOOSES
 * THE INITIATIVE AS THEY READY UP, and the client never chooses for them.
 *
 *   §1 the loser has TWO Ready buttons, neither highlighted (no default,
 *      CR D1.2), and each carries the absolute seat it names
 *   §2 the winner has ONE plain Ready and sees the choice once it is made
 *   §3 after the 120 s lock the loser sees only the two initiative buttons,
 *      untimed: no Ready, no countdown, no deck changes, no pause offer
 *   §4 …and the winner waits on them, saying so
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 22);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);
const SIDE = N.slice(15, 22);
const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'M835', bestOf: 3, game: 2, score: [0, 1], names: ['Ann', 'Bo'],
  banks: [40 * 60_000, 39 * 60_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 0, initiative: null, until: Date.now() + 90_000, locked: false, ready: [false, false],
  mine: { registered: { main: MAIN, side: SIDE }, current: { main: MAIN, side: SIDE }, presets: [] },
  ...over,
});
const lobby = (seat: 0 | 1, over: Record<string, unknown> = {}): string => ui.push({
  t: 'joined', room: 'UIDRIVER', seat, waiting: { have: [true, true], match: info(over) }, peers: [true, true], names: ['Ann', 'Bo'],
});
const readyTags = (html: string): string[] => [...html.matchAll(/<button[^>]*data-btn="cc-ready"[^>]*>[^<]*<\/button>/g)].map(m => m[0]);

test('§1 the loser: two Ready buttons, no default, each naming a seat', () => {
  const html = lobby(0);
  const tags = readyTags(html);
  assert.equal(tags.length, 2, tags.join('\n'));
  assert.match(tags[0]!, /data-init="0"[^>]*>Ready — I take the initiative</);
  assert.match(tags[1]!, /data-init="1"[^>]*>Ready — they take it</);
  for (const t of tags) assert.doesNotMatch(t, /class="[^"]*(primary|on)/, `no default highlight: ${t}`);
  assert.match(html, /You lost the last game: you choose who takes the initiative\./);
  ui.sent();
  ui.click({ btn: 'cc-ready', init: '1' });
  assert.deepEqual(ui.sent(), [{ t: 'cc', op: 'ready', ready: true, initiative: 1 }], 'they take it = seat 1, absolute');
  // seat 1 losing: "I take it" is seat 1
  lobby(1, { chooser: 1, score: [1, 0] });
  ui.click({ btn: 'cc-ready', init: '1' });
  assert.deepEqual(ui.sent(), [{ t: 'cc', op: 'ready', ready: true, initiative: 1 }], 'I take it = my own seat');
  // ready: the choice is said back, with the way to take it back
  const done = lobby(0, { ready: [true, false], initiative: 0 });
  assert.match(done, /Ready ✓<\/b> You take the initiative\./);
  assert.equal(readyTags(done).length, 1, 'only Not ready');
});

test('§2 the winner: one plain Ready, and the choice once made', () => {
  let html = lobby(1);
  assert.equal(readyTags(html).length, 1);
  assert.doesNotMatch(readyTags(html)[0]!, /data-init/, 'the winner chooses nothing');
  assert.match(html, /Ann is choosing who takes the initiative…/);
  html = lobby(1, { initiative: 0, ready: [true, false] });
  assert.match(html, /Ann takes the initiative\./);
  html = lobby(1, { initiative: 1, ready: [true, false] });
  assert.match(html, /You take the initiative\./);
});

test('§3 after the lock the loser sees only the two initiative buttons, untimed', () => {
  const html = lobby(0, { locked: true, until: null });
  const tags = readyTags(html);
  assert.equal(tags.length, 2);
  assert.match(tags[0]!, /data-init="0"[^>]*>I take the initiative</);
  assert.match(tags[1]!, /data-init="1"[^>]*>They take it</);
  assert.match(html, /Sideboarding is over\. Who takes the initiative\?/);
  assert.doesNotMatch(html, /data-cc-until/, 'untimed');
  assert.doesNotMatch(html, />Ready</, 'no Ready');
  assert.doesNotMatch(html, /data-btn="cc-preset"/, 'no swaps');
  assert.doesNotMatch(html, /data-btn="cc-pause"/, 'no pause offer');
  for (const m of html.matchAll(/<button class="ccchip"[^>]*>/g)) assert.match(m[0], /disabled/, 'the deck is shown, not editable');
  ui.sent();
  ui.click({ btn: 'cc-ready', init: '0' });
  assert.deepEqual(ui.sent(), [{ t: 'cc', op: 'ready', ready: true, initiative: 0 }]);
});

test('§4 …and the winner waits on that choice', () => {
  const html = lobby(1, { locked: true, until: null });
  assert.equal(readyTags(html).length, 0);
  assert.match(html, /Waiting for Ann to choose who takes the initiative…/);
});
