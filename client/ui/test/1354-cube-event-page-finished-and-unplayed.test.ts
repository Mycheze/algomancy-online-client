/* 1354 · THE EVENT PAGE, FROM THE WALK OF 2026-11-14 (pages/cube.ts, 56-cube.css) — DOM-free.
 *
 *   §1 standings before anyone has played: GW read 33% while OMW/OGW read 0% — a player with no
 *      match shows "—" for all three; one who has played (a bye counts) shows the numbers
 *   §2 a finished event keeps Standings · Matches (and a round robin's Schedule) to browse the
 *      finished matches; no Round or Players tab, no host's Result button once it is over
 *   §3 the facts' card count is its own line, never "· 320 cards" wrapped under the elements
 *   §4 at 1024 the event's name keeps its room beside the tabs (56-cube.css)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml, tabsFor, tiebreaks } from '../pages/cube.ts';
import { CONFIG, eventView, pageView, STANDINGS } from './cube-fixture.ts';
import { readStyles } from './read-styles.ts';

const cells = (html: string, user: string): string[] => {
  const name = STANDINGS.find(r => r.user === user)!.name;
  const row = new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?${name}(?:(?!</tr>)[\\s\\S])*?</tr>`).exec(html)?.[0] ?? '';
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]!.replace(/<[^>]+>/g, '').trim());
};

test('§1 no match played: "—", not 33%', () => {
  const fresh = STANDINGS.map(r => ({ ...r, points: 0, w: 0, l: 0, d: 0, omw: 0, gw: 1 / 3, ogw: 0 }));
  const html = cubeHtml(pageView({ event: eventView('playing', { standings: fresh }) }));
  assert.deepEqual(cells(html, 'u1').slice(-3), ['—', '—', '—']);
  assert.doesNotMatch(html, /33%/);
  assert.deepEqual(tiebreaks({ w: 0, l: 0, d: 0, omw: 0, gw: 1 / 3, ogw: 0 }), { omw: '—', gw: '—', ogw: '—' });
  assert.deepEqual(tiebreaks({ w: 1, l: 0, d: 0, omw: 0.5, gw: 1, ogw: 1 / 3 }), { omw: '50%', gw: '100%', ogw: '33%' }, 'played (a bye too): the numbers');
  const played = cubeHtml(pageView({ event: eventView('playing') }));
  assert.deepEqual(cells(played, 'u1').slice(-3), ['50%', '60%', '45%']);
});

test('§2 finished: Standings and Matches stay', () => {
  const done = eventView('done');
  assert.deepEqual(tabsFor(done), ['standings', 'matches']);
  assert.deepEqual(tabsFor({ ...done, config: { ...CONFIG, tournament: 'roundrobin' } }), ['standings', 'round', 'matches'], 'a round robin keeps its schedule');
  assert.deepEqual(tabsFor(eventView('playing')), ['standings', 'round', 'matches', 'players'], 'playing: as it was');
  const html = cubeHtml(pageView({ event: done, tab: 'matches' }));
  assert.match(html, /data-btn="cube-tab"[^>]*data-v="standings"/);
  assert.match(html, /data-btn="cube-tab"[^>]*data-v="matches"/);
  assert.match(html, /data-scroll="cube-done-matches"/);
  assert.match(html, /Ann <span class="dim">vs<\/span> Bo/, 'the finished matches, listed');
  assert.match(html, /🏆 Ann/, 'the winner stays beside them');
  assert.doesNotMatch(html, /data-btn="cube-result-open"/, 'over: no Result to set');
  assert.match(cubeHtml(pageView({ event: eventView('playing'), tab: 'matches' })), /data-btn="cube-result-open"/, 'playing: the host still has it');
  assert.match(cubeHtml(pageView({ event: done })), /data-scroll="cube-done-standings"/);
});

test('§3 the card count, its own line', () => {
  const html = cubeHtml(pageView({ event: eventView('lobby') }));
  assert.match(html, /<span class="dim cubepoolsize">320 cards<\/span>/);
  assert.doesNotMatch(html, /· 320 cards<\/span>/);
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(css, /\.cubepoolsize\s*\{[^}]*display:\s*block/);
});

test('§4 at 1024 the name keeps its room', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
  const narrow = /@media \(max-width: 1100px\) \{([\s\S]*?)\n\}/g;
  const blocks = [...css.matchAll(narrow)].map(m => m[1]!).join('\n');
  assert.match(blocks, /\.cubepage \.frametop:has\(\.cubetabs\)\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) auto auto;/);
});
