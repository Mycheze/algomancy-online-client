/* 1353 · A CUBE MATCH'S WORDS (docs/25 §8) — the walk of 2026-11-14: after a cube match the screen said
 * "the conceder loses a few rating points" (cube games are unrated), and the bar behind it — and a
 * watched cube match's — offered "Home" for a button that goes back to the event.
 *
 *   §1 a cube match's concession note says nothing about rating; an ordinary game's is as it was
 *   §2 the ended board's way out: "Back to the event" for a cube match (its tag, or a Watch link's
 *      `cube=`), "Home" otherwise — the same `gohome` button either way
 *   §3 driven through main.ts: the bar behind a cube match's post-game screen says Back to the event
 *
 * Note: the post-game header's "— vs —" is the elements each side PLAYED (pages/profile.ts
 * gameElementsHtml); a game conceded on turn 1 played none, in any mode. The names are the table's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import * as cube from '../cube.ts';
import { concessionNote, type GameOver } from '../postgame.ts';
import type { MatchSummary } from '../match.ts';
import type { Seat } from '../../engine/src/types.ts';

const seatStats = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});
const CUBE = { event: 'QZXV', pairing: 'r1p1' };
const OVER_MATCH = { id: 'M1353', bestOf: 1, score: [1, 0], game: 1, phase: 'over', room: 'RM1', result: { winner: 0, how: 'games', at: 1 }, cube: CUBE };
const over = (weight: 'walkover' | 'early', match?: unknown): GameOver => ({
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'constructed', els: [], turns: 1,
  seats: [seatStats('Ann'), seatStats('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
  concession: { seat: 1, turn: weight === 'walkover' ? 1 : 2, weight }, ...(match ? { match: match as MatchSummary } : {}),
});

test('§1 no rating in a cube match’s note', () => {
  for (const w of ['walkover', 'early'] as const) {
    const plain = concessionNote(over(w));
    assert.match(plain, /rating/, `${w}: an ordinary game's note keeps its rating words (positive control)`);
    const c = concessionNote(over(w, OVER_MATCH));
    assert.ok(c.length > 0, `${w}: a cube match still says what the concession was`);
    assert.match(c, /Bo conceded on turn/);
    assert.doesNotMatch(c, /rat(ing|ed)/i, `${w}: not a word about rating`);
  }
});

const loc = globalThis.location as unknown as { search: string; href: string };

test('§2 the way out says where it goes', () => {
  loc.search = '';
  assert.equal(cube.homeButtonHtml(null), '<button data-btn="gohome">Home</button>');
  assert.equal(cube.homeButtonHtml('QZXV'), '<button data-btn="gohome">Back to the event</button>', 'a cube match (its tag)');
  loc.search = '?ws=1&room=RM9&watch=1&cube=ABCD';
  assert.equal(cube.homeButtonHtml(undefined), '<button data-btn="gohome">Back to the event</button>', 'watching one (the link)');
  loc.search = '?ws=1&room=RM9&watch=1';
  assert.equal(cube.homeButtonHtml(undefined), '<button data-btn="gohome">Home</button>', 'an ordinary room');
});

test('§3 driven: the bar behind the post-game screen', async () => {
  const ui = await client();
  const SEAT: Seat = 0;
  loc.search = '?ws=1&room=RM1&seat=0&mode=constructed&cc=1';
  const h = new Harness(135300);
  ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  ui.push({
    t: 'gameover', seat: SEAT, winner: 0, names: ['Ann', 'Bo'], mode: 'constructed', els: [], turns: 7,
    seats: [seatStats('Ann'), seatStats('Bo')], rematch: [false, false], rematchRoom: null, recorded: true, match: OVER_MATCH,
  });
  // the match's end, as the server says it (1342 §1): the summary carries its event
  ui.push({ t: 'match', room: null, match: OVER_MATCH });
  const html = ui.click({ btn: 'pg-close' });
  assert.match(html, /<div class="promptbar">[\s\S]*?<button data-btn="gohome">Back to the event<\/button>/, 'Back to the event, not Home');
  assert.doesNotMatch(html, /<button data-btn="gohome">Home<\/button>/);
});
