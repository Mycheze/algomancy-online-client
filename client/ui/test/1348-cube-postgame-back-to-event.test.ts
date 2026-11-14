/* 1348 — A CUBE MATCH'S POST-GAME SCREEN HAS ONE WAY OUT: BACK TO THE EVENT (docs/25 §8).
 *
 * Both "New match" and "Return to home" went to the event already (1342), so their words were
 * wrong. A finished cube match (the summary carries `cube`) shows one primary "Back to the
 * event" (`cube-return`, carrying the event) in their place; an ordinary match keeps them.
 *
 *   §1 ⭐ a finished cube match: Back to the event, primary and alone; no New match, no Return to home
 *   §2 mid-match (Bo3, game 1 over): Continue stays first; the way home is Back to the event
 *   §3 an ordinary Competitive match and a casual game are as they were
 *   §4 clicked through ui/cube.ts: `cube-return` goes to the event its button names
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import type { GameOver } from '../postgame.ts';
import type { MatchSummary } from '../match.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
});
const OVER: GameOver = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'constructed', els: [], turns: 7,
  seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
};
const MATCH = { id: 'M1', bestOf: 3, score: [2, 0], game: 2, phase: 'over', room: 'RM1', result: { winner: 0, how: 'games', at: 1 } } as unknown as MatchSummary;
const CUBE = { event: 'QZXV', pairing: 'r2p1' };
const view = (match?: MatchSummary): PostGameView => ({
  over: { ...OVER, ...(match ? { match } : {}) }, modeLabel: 'constructed', elements: null,
  guest: false, signup: null, matchResult: '',
});
/** the button row as [data-btn, label, primary] */
function buttons(html: string): [string, string, boolean][] {
  const row = /<div class="pgbtns">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(row, 'the button row is drawn');
  return [...row[1]!.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(m => [/data-btn="([^"]+)"/.exec(m[1]!)?.[1] ?? '', m[2]!.trim(), /ui-button--primary/.test(m[1]!)]);
}

test('1348 §1 ⭐ a finished cube match: one way out, to the event', () => {
  for (const phase of ['over', 'void']) {
    const html = postGameHtml(view({ ...MATCH, phase, cube: CUBE } as MatchSummary));
    const b = buttons(html);
    assert.deepEqual(b[0], ['cube-return', 'Back to the event', true], `${phase}: first and primary`);
    assert.match(html, /data-btn="cube-return"[^>]*data-code="QZXV"/, 'it names its event');
    assert.equal(b.filter(x => x[2]).length, 1, 'the only primary');
    const names = b.map(x => x[0]);
    assert.ok(!names.includes('pg-newmatch'), 'no New match');
    assert.ok(!names.includes('pg-home'), 'no Return to home');
    assert.equal(names.filter(n => n === 'cube-return').length, 1, 'once');
  }
});

test('1348 §2 mid-match: Continue, and the way home is the event', () => {
  const b = buttons(postGameHtml(view({ ...MATCH, phase: 'between', score: [1, 0], room: 'NEXT', cube: CUBE } as unknown as MatchSummary)));
  assert.deepEqual(b[0], ['pg-continue', 'Continue to game 2', true]);
  assert.ok(b.some(x => x[0] === 'cube-return' && x[1] === 'Back to the event' && !x[2]), 'a plain Back to the event');
  assert.ok(!b.some(x => x[0] === 'pg-home'), 'no Return to home');
});

test('1348 §3 an ordinary match and a casual game are unchanged', () => {
  const cc = buttons(postGameHtml(view(MATCH)));
  assert.deepEqual(cc[0], ['pg-newmatch', 'New match', true]);
  assert.ok(cc.some(x => x[0] === 'pg-home' && x[1] === 'Return to home'));
  assert.ok(!cc.some(x => x[0] === 'cube-return'));
  const casual = buttons(postGameHtml(view()));
  assert.deepEqual(casual.slice(-2).map(x => x[0]), ['pg-home', 'pg-queue']);
  assert.ok(!casual.some(x => x[0] === 'cube-return'));
});

test('1348 §4 cube-return goes to the event its button names', async () => {
  const g = globalThis as Record<string, unknown>;
  const loc = { pathname: '/', search: '', href: 'http://x/' };
  g['location'] = loc;
  const cube = await import('../cube.ts');
  const btn = { dataset: { btn: 'cube-return', code: 'QZXV' } } as unknown as HTMLElement;
  assert.equal(cube.handleButton(btn), true, 'cube.ts claims it');
  assert.equal(loc.href, '/?cube=QZXV');
});
