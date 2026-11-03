/* docs/22 §5.7 — PAUSE A MATCH BETWEEN GAMES BY AGREEMENT, AND RESUME IT.
 *
 *   §1 either seat offers; the offerer can withdraw; the other seat is asked
 *      and can accept or decline — each the wire's own op (§5.8)
 *   §2 paused: "Paused — resume any time before <date>" (seven days on, or
 *      the server's earlier deadline: a league week's end — CT-514),
 *      the deck panel gone, Resume — disabled while the opponent is away,
 *      because resuming needs both of them
 *   §3 one seat asked to resume: it says it is waiting, and the other seat
 *      is told they want to
 *   §4 the window has locked: no pause is offered any more
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 22);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);
const SIDE = N.slice(15, 22);
const PAUSED_AT = Date.UTC(2026, 10, 2, 12);
const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'M836', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
  banks: [40 * 60_000, 39 * 60_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 1, initiative: null, until: Date.now() + 90_000, locked: false, ready: [false, false],
  mine: { registered: { main: MAIN, side: SIDE }, current: { main: MAIN, side: SIDE } },
  ...over,
});
const lobby = (over: Record<string, unknown> = {}, peers: [boolean, boolean] = [true, true]): string => ui.push({
  t: 'joined', room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info(over) }, peers, names: ['Ann', 'Bo'],
});
const cc = (): unknown[] => ui.sent().filter(m => m['t'] === 'cc');

test('§1 offer, withdraw; asked, accept or decline', () => {
  let html = lobby();
  assert.match(html, /<button data-btn="cc-pause">Offer pause<\/button>/);
  ui.sent();
  ui.click({ btn: 'cc-pause' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'pause' }]);
  html = lobby({ pause: { offeredBy: 0, pausedAt: null, resume: [false, false] } });
  assert.match(html, /You offered a pause\./);
  ui.click({ btn: 'cc-unpause' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'unpause' }], 'withdraw');
  html = lobby({ pause: { offeredBy: 1, pausedAt: null, resume: [false, false] } });
  assert.match(html, /Bo offers to pause the match\./);
  ui.click({ btn: 'cc-pause' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'pause' }], 'accept is the second pause');
  ui.click({ btn: 'cc-unpause' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'unpause' }], 'decline');
});

test('§2 paused: the deadline, no deck panel, Resume needs both here', () => {
  const paused = { phase: 'paused', until: null, pause: { offeredBy: null, pausedAt: PAUSED_AT, resume: [false, false] } };
  const by = new Date(PAUSED_AT + 7 * 24 * 3600_000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  let html = lobby(paused);
  assert.ok(html.includes(`Paused — resume any time before ${by}.`), html.slice(html.indexOf('ccpaused'), html.indexOf('ccpaused') + 300));
  assert.doesNotMatch(html, /class="ccboard"/, 'no sideboarding while paused');
  assert.doesNotMatch(html, /data-cc-until/, 'and no countdown');
  assert.match(html, /Game 2 of 3 — you lead 1–0/, 'the score is as it was');
  assert.match(html, /<button class="cta primary" data-btn="cc-resume" >Resume<\/button>/);
  ui.sent();
  ui.click({ btn: 'cc-resume' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'resume' }]);
  html = lobby(paused, [true, false]);
  assert.match(html, /data-btn="cc-resume" disabled>Resume/, 'the opponent is away');
  assert.match(html, /Bo is not here — you both need to be\./);
  // CT-514: a league week that ends first is the server's deadline, and the one shown
  const WEEK_END = PAUSED_AT + 3 * 24 * 3600_000;
  const byWeek = new Date(WEEK_END).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  html = lobby({ ...paused, pause: { ...paused.pause, voidAt: WEEK_END } });
  assert.ok(html.includes(`Paused — resume any time before ${byWeek}.`), 'the league week end, not the seven days');
});

test('§3 one seat asked: it waits, and the other is told', () => {
  let html = lobby({ phase: 'paused', until: null, pause: { offeredBy: null, pausedAt: PAUSED_AT, resume: [true, false] } });
  assert.match(html, /Waiting for Bo to resume…/);
  assert.doesNotMatch(html, /data-btn="cc-resume"/);
  html = lobby({ phase: 'paused', until: null, pause: { offeredBy: null, pausedAt: PAUSED_AT, resume: [false, true] } });
  assert.match(html, /Bo wants to resume\./);
  assert.match(html, /data-btn="cc-resume"/);
});

test('§4 once the window locks, no pause is offered', () => {
  const html = lobby({ locked: true, until: null, chooser: 0 });
  assert.doesNotMatch(html, /data-btn="cc-pause"/);
});
