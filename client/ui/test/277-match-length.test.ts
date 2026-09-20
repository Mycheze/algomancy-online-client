/* BL-37 — THE MATCH LENGTH ON SCREEN.
 *
 * The owner, 2026-09-01: *"a global wall-clock match timer — literal elapsed
 * time, not double-counting per-player time — saved with the game to track
 * average game length and tune the clocks."*
 *
 * The measuring lives on the server (`Room.matchMs`, guarded by
 * server/e2e/test-match-clock.ts) and the average lives in the history
 * (`matchLengths`, same file). This is the third surface: the post-game
 * screen, which is where the number is actually read by a person.
 *
 * ⚠ THE WHOLE OF IT IS "ABSENT IS NOT ZERO". Every game played before today
 * carries no length, and printing "0m" for one would be a measurement nobody
 * took — reported as fact, on the screen the owner reads after every game, for
 * the entire back catalogue. So §1 is the true positive and §2 is the false
 * one, and §2 is the half that matters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLength, postGameHtml, type GameOver } from '../postgame.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
});

const over = (extra: Partial<GameOver> = {}): GameOver => ({
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'shared', els: [], turns: 7,
  seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null,
  recorded: true, ...extra,
});

/* ══ §1 the number, said the way a person says it ═════════════════════ */

test('BL-37 §1 the match length reads as a person would say it', () => {
  assert.equal(matchLength(47 * 60_000), '47m');
  assert.equal(matchLength(72 * 60_000), '1h 12m');
  assert.equal(matchLength(60 * 60_000), '1h 0m');
  // never seconds above a minute: nobody tunes a chess clock to the second,
  // and "47m 13s" is precision that is not information
  assert.equal(matchLength(47 * 60_000 + 13_000), '47m');
  // ⚠ AND NEVER A BARE "0m". A game that took forty seconds really happened;
  // "0m" reads as a bug, "<1m" reads as a fact.
  assert.equal(matchLength(40_000), '<1m');
  assert.equal(matchLength(1), '<1m');
});

test('BL-37 §1 a timed game says how long it took, beside the turn count', () => {
  const html = postGameHtml(over({ matchMs: 47 * 60_000 }));
  assert.match(html, /7 turns · 47m/,
    'the length is not on the post-game screen — which is the one place a person reads it, '
    + 'and the reason the server measures it at all');
});

/* ══ §2 …AND AN UNTIMED GAME SAYS NOTHING ════════════════════════════ */

test('BL-37 §2 a game that measured nothing prints no length at all', () => {
  // Every game in the archive is this case: the timer did not exist when they
  // were played, so `matchMs` is absent. A screen that printed "0m" would be
  // stating a measurement nobody took, about every game ever played here.
  const html = postGameHtml(over());
  assert.match(html, /7 turns/, 'fixture: the sub-line is there to be checked');
  assert.doesNotMatch(html, /0m|<1m/,
    'an unmeasured game was given a length. Absent is not zero — see RecordedGame.matchMs');
});

test('BL-37 §2 …and neither does an explicit zero', () => {
  // the server omits the field rather than sending 0, but a `0` reaching here
  // must fall the same way: one rule, asked once, at the render.
  assert.doesNotMatch(postGameHtml(over({ matchMs: 0 })), /· 0m|· <1m/,
    'a zero was rendered as a length. The wire omits it and the screen must too, or the two '
    + 'disagree the moment anything else starts filling this field in');
});
