/* docs/22 §5.5 — THE POST-GAME SCREEN OF A MATCH GAME.
 *
 *   §1 a game of a match that goes on: the score, and Continue (to the room
 *      the match moved to, same seat, as a match room) IN PLACE of Rematch
 *   §2 the match ends while the screen is up ({t:'match'}): the match result,
 *      and New match — never Rematch, which would build a casual room
 *   §3 a conceded match and a voided one say so
 *   §4 a match that ended while this page sat between games: the result, and
 *      the way home
 *   §5 an ordinary game's screen is unchanged: Rematch, no match line
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import type { GameOver } from '../postgame.ts';
import { postGameHtml as drawPostGame, postGameView } from '../pages/postgame.ts';
import type { Seat } from '../../engine/src/types.ts';

// the screen's markup is pages/postgame.ts since the design-system round (2026-11-03)
const postGameHtml = (o: GameOver): string => drawPostGame(postGameView(o));

const ui = await client();
const SEAT: Seat = 1;
const seatStats = (name: string): Record<string, unknown> => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});
const OVER = {
  seat: SEAT, winner: 1, names: ['Ann', 'Bo'], mode: 'constructed', els: [],
  turns: 7, seats: [seatStats('Ann'), seatStats('Bo')],
  rematch: [false, false], rematchRoom: null, recorded: true,
};
const MOVED = { id: 'M838', bestOf: 3, score: [0, 1], game: 2, phase: 'between', room: 'NEXT' };
const buttons = (html: string): string[] => {
  const row = /<div class="pgbtns">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(row, 'the post-game screen is up');
  return [...row[1]!.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(m => /data-btn="([^"]+)"/.exec(m[1]!)?.[1] ?? '');
};
const h = new Harness(83800);
ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
if (ui.has({ report: 'close' })) ui.click({ report: 'close' });

test('§1 the match goes on: the score and Continue in place of Rematch', () => {
  const html = ui.push({ t: 'gameover', ...OVER, match: MOVED });
  assert.match(html, /You win!/, 'the GAME result heads the screen');
  assert.match(html, /Best of 3 · you lead 1–0 after 1 game\./);
  const b = buttons(html);
  assert.equal(b[0], 'pg-continue');
  assert.ok(!b.includes('pg-rematch'), 'no Rematch in a match');
  assert.match(html, /data-btn="pg-continue"[^>]* data-room="NEXT">Continue to game 2</);   // a button() since 2026-11-03
  ui.click({ btn: 'pg-continue' });
  assert.equal(location.search, '?ws=1&room=NEXT&seat=1&mode=constructed&cc=1', 'the next room, the same seat, a match room');
});

test('§2 the match ends while the screen is up: the result, and New match', () => {
  const html = ui.push({ t: 'match', room: null, match: { ...MOVED, score: [0, 2], game: 2, phase: 'over', room: 'NEXT', result: { winner: 1, how: 'games', at: 1 } } });
  assert.match(html, /You win the match 2–0\./);
  const b = buttons(html);
  assert.equal(b[0], 'pg-newmatch');
  assert.ok(!b.includes('pg-rematch') && !b.includes('pg-continue'));
  ui.click({ btn: 'pg-newmatch' });
  assert.match(String(location.href), /\?bo=3$/, 'home, with the Competitive card on Best of 3');
});

test('§3 conceded and voided matches say so', () => {
  const conceded = postGameHtml({ ...OVER, match: { ...MOVED, phase: 'over', result: { winner: 0, how: 'conceded', at: 1, concededBy: 1 } } } as unknown as GameOver);
  assert.match(conceded, /Ann wins the match 0–1\.<\/b> You conceded\./);
  const time = postGameHtml({ ...OVER, match: { ...MOVED, phase: 'over', result: { winner: 1, how: 'time', at: 1 } } } as unknown as GameOver);
  assert.match(time, /You win the match 1–0\.<\/b> Ann ran out of time\./);
  const voided = postGameHtml({ ...OVER, match: { ...MOVED, phase: 'void', voided: { at: 1, why: 'paused for 7 days' } } } as unknown as GameOver);
  assert.match(voided, /The match closed with no result\./);
});

test('§4 the match ends between games: the result and the way home', () => {
  ui.click({ btn: 'pg-close' });
  ui.push({
    t: 'joined', room: 'NEXT', seat: SEAT, peers: [true, true], names: ['Ann', 'Bo'], waiting: { have: [true, true], match: {
      id: 'M838', bestOf: 3, game: 2, score: [0, 1], names: ['Ann', 'Bo'], banks: [1, 1], clockStart: 2700_000,
      phase: 'between', chooser: 0, initiative: null, until: null, locked: false, ready: [false, false],
      mine: { registered: { main: [], side: [] }, current: { main: [], side: [] }, presets: [] },
    } },
  });
  const html = ui.push({ t: 'match', room: null, match: { ...MOVED, phase: 'over', result: { winner: 1, how: 'conceded', at: 1, concededBy: 0 } } });
  assert.match(html, /You win the match 1–0\.<\/b> Ann conceded\./);
  assert.match(html, /data-btn="gohome"/);
  assert.doesNotMatch(html, /data-btn="cc-ready"/, 'nothing left to ready for');
});

test('§5 an ordinary game keeps Rematch and says nothing of a match', () => {
  const html = postGameHtml(OVER as unknown as GameOver);
  assert.equal(buttons(html)[0], 'pg-rematch');
  assert.doesNotMatch(html, /pgmatch|Continue to game/);
});
