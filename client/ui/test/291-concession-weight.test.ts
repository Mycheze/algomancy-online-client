/* R290 — what the player sees of a concession's weight.
 *
 * Two surfaces read the server's word for it: the post-game screen (the
 * `gameover` payload's `concession.weight`) and the profile's history tab
 * (`MatchRow.concession.weight`). Neither computes the weight — the
 * thresholds live in server/concession.ts and the client must not carry a
 * copy that can drift — so what is tested here is that each surface says the
 * right thing for each word, and NOTHING for `normal`: the owner's ruling is
 * that a turn-3+ concession "should be treated fully normally", and a screen
 * that mentions it would be treating it specially.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concessionNote, postGameHtml, type GameOver } from '../postgame.ts';
import { concessionTag, historyRowsHtml, type MatchRow } from '../account.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
});

const over = (extra: Partial<GameOver> = {}): GameOver => ({
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'constructed', els: [], turns: 1,
  seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null,
  recorded: true, ...extra,
});

/* ══ §1 the post-game screen ══════════════════════════════════════════ */

test('R290 §1 a walkover says so, names the conceder and the turn, and says it was not counted', () => {
  const o = over({ concession: { seat: 1, turn: 1, weight: 'walkover' } });
  const note = concessionNote(o);
  assert.match(note, /^Walkover — not counted \(Bo conceded on turn 1\)/);
  assert.match(note, /winner gains nothing/);
  const html = postGameHtml(o);
  assert.match(html, /pgweight walkover/);
  assert.match(html, /marked as not counted/, 'the "recorded" line changes meaning under a walkover');
  assert.doesNotMatch(html, /Recorded to your profile\./);
});

test('R290 §1 an early concession says half weight, and that it still counts', () => {
  const o = over({ concession: { seat: 1, turn: 2, weight: 'early' }, turns: 2 });
  const note = concessionNote(o);
  assert.match(note, /^Early concession — half weight \(Bo conceded on turn 2\)/);
  assert.match(note, /counts as a win and a loss/);
  assert.match(note, /fast-game achievements/);
  const html = postGameHtml(o);
  assert.match(html, /pgweight early/);
  assert.match(html, /Recorded to your profile\./, 'an early game IS recorded, and the screen says so as usual');
});

test('R290 §1 the note reads from the viewer\'s seat: "You" when it was you', () => {
  const o = over({ seat: 1, winner: 0, concession: { seat: 1, turn: 1, weight: 'walkover' } });
  assert.match(concessionNote(o), /\(You conceded on turn 1\)/);
});

test('R290 §1 ⭐ a normal concession (turn 3+) and a game with no concession say NOTHING', () => {
  assert.equal(concessionNote(over({ concession: { seat: 1, turn: 5, weight: 'normal' }, turns: 5 })), '');
  assert.equal(concessionNote(over({ turns: 9 })), '');
  const html = postGameHtml(over({ concession: { seat: 1, turn: 5, weight: 'normal' }, turns: 5 }));
  assert.doesNotMatch(html, /pgweight/);
  assert.doesNotMatch(html, /[Ww]alkover|[Ee]arly concession/);
  assert.match(html, /Recorded to your profile\./);
});

test('R290 §1 the note trusts the server\'s WORD, not the turn', () => {
  // the thresholds are the server's; if it says walkover at turn 2, the
  // screen says walkover at turn 2 rather than second-guessing it
  assert.match(concessionNote(over({ concession: { seat: 1, turn: 2, weight: 'walkover' } })), /^Walkover/);
});

/* ══ §2 the history tab ═══════════════════════════════════════════════ */

const row = (extra: Partial<MatchRow> = {}): MatchRow => ({
  code: 'ABCD', playedAt: '2026-09-05T12:00:00.000Z', mode: 'constructed', els: ['fire'],
  turns: 1, deckId: null, finished: true, diverged: false, result: 'win',
  opponent: 'Bo', opponentId: 'bo', life: [20, 20], unitsPlayed: 0, spellsPlayed: 0,
  damageDealt: 0, favoriteElement: null, ...extra,
});

test('R290 §2 a walkover row is tagged "not counted" and dimmed whole', () => {
  const tag = concessionTag(row({ concession: { turn: 1, weight: 'walkover', mine: false } }));
  assert.match(tag, /constag walkover/);
  assert.match(tag, /walkover · not counted/);
  assert.match(tag, /Bo conceded on turn 1/, 'the title names the conceder');
  const html = historyRowsHtml([row({ concession: { turn: 1, weight: 'walkover', mine: false } })]);
  assert.match(html, /class="res-win weight-walkover"/);
  assert.match(html, /WIN<span class="constag walkover"/, 'the result still says who won; the tag sits beside it');
});

test('R290 §2 an early row is tagged "half weight"', () => {
  const tag = concessionTag(row({ result: 'loss', concession: { turn: 2, weight: 'early', mine: true } }));
  assert.match(tag, /constag early/);
  assert.match(tag, /early concession · half weight/);
  assert.match(tag, /you conceded on turn 2/, '"you" when it was this account');
  assert.match(historyRowsHtml([row({ result: 'loss', concession: { turn: 2, weight: 'early', mine: true } })]),
    /class="res-loss weight-early"/);
});

test('R290 §2 ⭐ a normal concession and an un-stamped row carry no tag and no weight class', () => {
  assert.equal(concessionTag(row({ turns: 7, concession: { turn: 7, weight: 'normal', mine: false } })), '');
  assert.equal(concessionTag(row({ turns: 7 })), '');
  const html = historyRowsHtml([row({ turns: 7 }), row({ turns: 7, concession: { turn: 7, weight: 'normal', mine: true } })]);
  assert.doesNotMatch(html, /constag|weight-/);
  assert.match(html, /class="res-win">/);
});
