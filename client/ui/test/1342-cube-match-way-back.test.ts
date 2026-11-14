/* 1342 — A CUBE MATCH GOES BACK TO ITS EVENT, NOT HOME (docs/25 §8), driven through ui/main.ts.
 *
 * The server tags a cube match's summary (`match.cube = {event, pairing}`, server/match.ts
 * matchSummary); a Play or Watch from the event page also puts `cube=<CODE>` on the room link.
 *
 * §1 after the last game the post-game screen stays up; its one way out goes to the event
 * §2 a match that ends while this page waits between games goes to the event at once
 * §3 the room's Leave (gohome) goes to the event
 * §4 a watch link that carries its event: the way back is the event; a room link without one is not a cube match
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import * as cube from '../cube.ts';
import type { Seat } from '../../engine/src/types.ts';

const ui = await client();
const loc = globalThis.location as unknown as { search: string; href: string };
const SEAT: Seat = 0;
const seatStats = (name: string): Record<string, unknown> => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});
const CUBE = { event: 'QZXV', pairing: 'r2p1' };
const OVER_MATCH = { id: 'M1342', bestOf: 1, score: [1, 0], game: 1, phase: 'over', room: 'RM1', result: { winner: 0, how: 'games', at: 1 }, cube: CUBE };
const h = new Harness(134200);
ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
if (ui.has({ report: 'close' })) ui.click({ report: 'close' });

test('1342 §1 the post-game screen stays; its ways out go to the event', () => {
  ui.push({
    t: 'gameover', seat: SEAT, winner: 0, names: ['Ann', 'Bo'], mode: 'constructed', els: [], turns: 7,
    seats: [seatStats('Ann'), seatStats('Bo')], rematch: [false, false], rematchRoom: null, recorded: true, match: OVER_MATCH,
  });
  const before = loc.search;
  const html = ui.push({ t: 'match', room: null, match: OVER_MATCH });
  assert.equal(loc.search, before, 'the result stays on screen: no jump away from it');
  // one way out, named for where it goes (1348 pins the screen's buttons)
  assert.doesNotMatch(html, /data-btn="pg-newmatch"|data-btn="pg-home"/);
  ui.click({ btn: 'cube-return' });
  assert.match(String(loc.href), /\?cube=QZXV$/, 'Back to the event: the event, not the home card');
});

test('1342 §2 between games, the end goes to the event at once', () => {
  ui.click({ btn: 'pg-close' });
  ui.push({
    t: 'joined', room: 'RM2', seat: SEAT, peers: [true, true], names: ['Ann', 'Bo'], waiting: { have: [true, true], match: {
      id: 'M1342', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'], banks: [1, 1], clockStart: 2700_000,
      phase: 'between', chooser: 1, initiative: null, until: null, locked: false, ready: [false, false],
      mine: { registered: { main: [], side: [] }, current: { main: [], side: [] } },
    } },
  });
  loc.search = '?ws=1&room=RM2&seat=0&mode=constructed&cc=1';
  ui.push({ t: 'match', room: null, match: { ...OVER_MATCH, bestOf: 3, room: 'RM2', result: { winner: 0, how: 'conceded', at: 1, concededBy: 1 } } });
  assert.equal(loc.search, '?cube=QZXV');
});

test('1342 §3 Leave goes to the event', () => {
  loc.href = 'http://x/';
  ui.click({ btn: 'gohome' });
  assert.match(String(loc.href), /\?cube=QZXV$/);
});

test('1342 §4 the event from the link, and no event without one', () => {
  loc.search = '?ws=1&room=RM9&watch=1&cube=ABCD';
  assert.equal(cube.backTo(null), 'ABCD', 'a Watch link from the event page');
  assert.equal(cube.backSearch(null), '?cube=ABCD');
  assert.equal(cube.backTo('QZXV'), 'QZXV', 'the match\'s own tag first');
  loc.search = '?ws=1&room=RM9&watch=1';
  assert.equal(cube.backTo(null), null, 'an ordinary room');
  assert.equal(cube.backSearch(undefined), '');
  loc.search = '?cube=ABCD';
  assert.equal(cube.backTo(null), null, 'the event page itself is not a room to come back from');
});
