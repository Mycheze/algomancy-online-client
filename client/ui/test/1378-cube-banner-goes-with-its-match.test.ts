/* 1378 · "YOUR MATCH IS READY" GOES WITH ITS MATCH (pages/cube.ts liveBanner, ui/cube.ts) — the
 * Chrome walk of 2026-11-14: the host recorded the result of my round-2 match, which ended the
 * event, and the page still said "Your match is ready: vs Sim Cleo" with Play and Dismiss.
 *
 *   §1 liveBanner, pure: kept while the view has the match undecided and mine (or does not list it
 *      yet — the `matched` push can come before the view that posts it); gone when the match is
 *      decided (a result, the host's, a drop's), when it is no longer mine, when the event is over
 *      or called off; the view's newer copy of the match is the one kept
 *   §2 the page never draws a banner liveBanner drops (a stale one handed in is not shown)
 *   §3 driven (the real ui/main.ts): the banner is up; the view with the match decided and the
 *      event over takes it away — and it stays away when the event page is painted again
 *   §4 driven: a match voided by a drop, and an event called off, take it away too
 *
 * Seeds: none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml, liveBanner } from '../pages/cube.ts';
import { eventView, match, pageView } from './cube-fixture.ts';

const MINE = match('r2p1', 2, 0, 3, 'waiting');   // Ann (me, the fixture's host) vs Di
const withMatch = (m: ReturnType<typeof match>, over: Parameters<typeof eventView>[1] = {}) => {
  const base = eventView('playing', over);
  return { ...base, matches: base.matches.map(x => (x.pairing === m.pairing ? m : x)) };
};

test('§1 liveBanner, pure', () => {
  assert.deepEqual(liveBanner(MINE, eventView('playing')), MINE, 'undecided and mine: kept');
  const live = match('r2p1', 2, 0, 3, 'live');
  assert.deepEqual(liveBanner(MINE, withMatch(live)), live, 'the view’s newer copy (now live) is the one kept');
  assert.deepEqual(liveBanner(match('x9', 9, 0, 3, 'waiting'), eventView('playing')), match('x9', 9, 0, 3, 'waiting'),
    'a match the view does not list yet: kept (the push came first)');
  assert.deepEqual(liveBanner(MINE, eventView('building', { matches: [] })), MINE, 'the first round, posted before the view says playing');
  assert.equal(liveBanner(MINE, withMatch(match('r2p1', 2, 0, 3, 'done', { score: '2–1', winner: 'u1' }))), null, 'decided: gone');
  assert.equal(liveBanner(MINE, withMatch(match('r2p1', 2, 0, 3, 'done', { score: 'Draw' }))), null, 'a draw: gone');
  assert.equal(liveBanner(MINE, withMatch(match('r2p1', 2, 1, 3, 'waiting'))), null, 'no longer mine (swapped): gone');
  assert.equal(liveBanner(MINE, { ...eventView('playing'), me: null }), null, 'signed out: gone');
  assert.equal(liveBanner(MINE, eventView('done')), null, 'the event is over: gone, even with the match listed undecided');
  assert.equal(liveBanner(MINE, eventView('cancelled')), null, 'called off: gone');
  assert.equal(liveBanner(null, eventView('playing')), null);
  assert.equal(liveBanner(MINE, null), null);
});

test('§2 the page draws only a live banner', () => {
  const up = cubeHtml(pageView({ event: eventView('playing'), banner: MINE }));
  assert.match(up, /Your match is ready: <b>vs Di<\/b>/, 'positive control: the banner is drawn');
  for (const [why, event] of [
    ['decided', withMatch(match('r2p1', 2, 0, 3, 'done', { score: '1–0', winner: 'u4' }))],
    ['the event over', eventView('done')],
    ['called off', eventView('cancelled')],
  ] as const) {
    const html = cubeHtml(pageView({ event, banner: MINE }));
    assert.doesNotMatch(html, /Your match is ready/, `${why}: no banner`);
    assert.doesNotMatch(html, /data-btn="cube-banner-close"/, `${why}: no Dismiss`);
  }
});

/* driven: the real client, a socket this test holds the other end of (test/ui-driver.ts) */
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?cube=qzxv';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok1' };
g['__UI_DRIVER_FETCH'] = () => new Promise(() => {});
const { client } = await import('./ui-driver.ts');
const ui = await client();
const READY = /Your match is ready/;

test('§3 driven: the result that ends the event takes the banner away', () => {
  ui.push({ t: 'cube', view: eventView('playing') });
  assert.match(ui.push({ t: 'cube', matched: MINE }), READY, 'positive control: the banner is up');
  // the host records my match, which ends the event
  const over = eventView('done', {
    matches: eventView('playing').matches.map(x => (x.pairing === 'r2p1' ? { ...x, status: 'done' as const, score: '1–0', winner: 'u4' } : x)),
    myMatch: null,
  });
  assert.doesNotMatch(ui.push({ t: 'cube', view: over }), READY, 'the event is over: no banner');
  assert.doesNotMatch(ui.click({ btn: 'cube-tab', v: 'matches' }), READY, 'and it does not come back on a repaint');
  assert.doesNotMatch(ui.push({ t: 'cube', view: eventView('playing') }), READY,
    'the state was cleared, not hidden: a later view with the match undecided does not raise it again');
});

test('§4 driven: a drop’s void, an event called off', () => {
  ui.push({ t: 'cube', view: eventView('playing') });
  assert.match(ui.push({ t: 'cube', matched: MINE }), READY);
  assert.doesNotMatch(ui.push({ t: 'cube', view: withMatch(match('r2p1', 2, 0, 3, 'done', { score: null, winner: 'u1' })) }), READY,
    'the opponent dropped: the match is decided');
  ui.push({ t: 'cube', view: eventView('playing') });
  assert.match(ui.push({ t: 'cube', matched: MINE }), READY);
  assert.match(ui.push({ t: 'cube', view: eventView('playing', { round: 2 }) }), READY, 'an unrelated view keeps it');
  assert.doesNotMatch(ui.push({ t: 'cube', view: eventView('cancelled') }), READY, 'called off: gone');
});
