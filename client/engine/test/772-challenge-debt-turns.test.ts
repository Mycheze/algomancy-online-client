/* WEEKLY CHALLENGES — debt still owed costs turns (owner, 2026-11-01).
 *
 * "There's no downside to gaining debt", so "gain debt: the next card costs
 * less" bought a turn-2 run of nearly every challenge. Now a run that meets
 * its goal still owes its debt: the score adds the turns it would take to pay
 * it off, the final turn's open resources first, then +2 resources a turn.
 *
 *   §1 ⭐ the owner's two examples: 2 debt with nothing open is 1 turn; 24 debt
 *      on 2 resources is 4 + 6 + 8 + 6, 4 turns — and open resources pay first
 *   §2 the score: `turns` = met turn + debt turns, and raw follows it; a run
 *      with no debt, or folded before the rule (no `end`), is unchanged
 *   §3 the fold stamps the debt and resources of the board the goal was met on
 *   §4 Full House's real turn-2 runs (38 debt) rank behind its 3-turn runs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareScores, debtPayoffTurns, endOf, foldRun, newChallengeGame, newRun, scoreRun,
  type ChallengeDef, type RunScore,
} from '../src/challenge.ts';
import type { GameState } from '../src/types.ts';

test('§1 the owner\'s examples, and open resources pay first', () => {
  assert.equal(debtPayoffTurns(2, 0, 0), 1, '2 debt, nothing open: 1 turn');
  assert.equal(debtPayoffTurns(2, 0, 6), 1, '2 debt, nothing open: 1 turn, whatever the resources');
  assert.equal(debtPayoffTurns(24, 0, 2), 4, '24 debt on 2 resources: 4 + 6 + 8 + 6');
  assert.equal(debtPayoffTurns(18, 0, 2), 3, '4 + 6 + 8 pays exactly 18');
  assert.equal(debtPayoffTurns(19, 0, 2), 4, 'one over is one more turn');
  assert.equal(debtPayoffTurns(2, 2, 2), 0, 'the final turn\'s open resources pay it all');
  assert.equal(debtPayoffTurns(5, 2, 4), 1, '2 paid now, the other 3 next turn');
  assert.equal(debtPayoffTurns(0, 0, 0), 0, 'no debt, no turns');
  assert.equal(debtPayoffTurns(0, 5, 5), 0);
});

const goal = { kind: 'life', n: 1 } as const;

function metAcc(metTurn: number, end?: { debt: number; open: number; active: number }) {
  const acc = { ...newRun(goal), met: true, metTurn, turn: metTurn, used: { 'Ancient One': 1 } };
  return end ? { ...acc, end } : acc;
}

test('§2 the score adds the debt turns to turns, and raw follows', () => {
  const s = scoreRun(metAcc(2, { debt: 24, open: 0, active: 2 }), 10);
  assert.equal(s.debt, 24);
  assert.equal(s.debtTurns, 4);
  assert.equal(s.turns, 6, 'met on turn 2, plus 4 paying');
  assert.equal(s.raw, s.cards * Math.max(1, s.elements) * 6);
  const clean = scoreRun(metAcc(2, { debt: 0, open: 3, active: 3 }), 10);
  assert.equal(clean.turns, 2);
  assert.equal(clean.debtTurns, 0);
  const old = scoreRun(metAcc(3), 10);
  assert.equal(old.turns, 3, 'a run folded before the rule (no end) keeps its met turn');
  assert.equal(old.debtTurns, 0);
});

test('§3 the fold stamps the debt and resources of the board the goal is met on', () => {
  const def: ChallengeDef = { id: 't', week: '2026-11-01', title: 't', blurb: '', goal, seed: 7, par: 1 };
  const h = newChallengeGame(def, Array.from({ length: 30 }, () => 'Ancient One'));
  const st: GameState = structuredClone(h.state);
  st.players[0]!.debt = 9;
  const before = endOf(st);
  assert.equal(before.debt, 9);
  assert.equal(before.active, st.players[0]!.resources.filter(r => r.state !== 'dormant').length);
  assert.equal(before.open, st.players[0]!.resources.filter(r => r.state === 'open').length);
  // the life goal is met on any board (30 life ≥ 1), so one fold meets it
  const acc = foldRun(newRun(goal), st, { type: 'passPriority', seat: 0 }, st, []);
  assert.ok(acc.met);
  assert.deepEqual(acc.end, before);
  const s = scoreRun(acc, 1);
  assert.equal(s.debt, 9);
  assert.equal(s.debtTurns, debtPayoffTurns(9, before.open, before.active));
  assert.equal(s.turns, st.turn + s.debtTurns!);
});

test('§4 Full House: the 38-debt turn-2 run ranks behind the 3-turn runs', () => {
  const sc = (cards: number, elements: number, metTurn: number, end?: { debt: number; open: number; active: number }): RunScore => {
    const used: Record<string, number> = {};
    // one name per card, the elements faked through the card count only
    for (let i = 0; i < cards; i++) used[`c${i}`] = 1;
    const raw = { unique: cards, extra: 0, cards, elements, turns: metTurn + debtPayoffTurns(end?.debt ?? 0, end?.open ?? 0, end?.active ?? 0) };
    return { ...raw, raw: cards * elements * raw.turns, skill: 0 };
  };
  // the stamped numbers of Karanda's runs that week, the turn-2 one with the
  // 38 debt and resources it ended on (re-scored to 7 turns, 2026-11-01)
  const borrowed = sc(8, 3, 2, { debt: 38, open: 0, active: 4 });
  assert.equal(borrowed.turns, 7);
  const honest = sc(4, 2, 3);
  assert.ok(compareScores('fastest', honest, borrowed) < 0, 'the 3-turn run is faster now');
  assert.ok(compareScores('overall', honest, borrowed) < 0);
});
