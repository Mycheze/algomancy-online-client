/* WEEKLY CHALLENGES — the doubleKO goal (Double Knockout, the week of Sun 10
 * Jan 2027; src/challenge.ts). Owner, 2026-10-24: "Kill the dummy and yourself
 * simultaneously (via the same effect)".
 *
 * It rests on CR 104.1a / CT-409: every life change of one effect lands before
 * anyone loses, and the game-over then carries `alsoAtZero` (the winner fell
 * too). The fold reads that stamp into `RunAcc.bothFell`.
 *
 * §1 a game-over with `alsoAtZero` meets it; a dummy that falls alone, the
 *    player falling alone, and a concession do not
 * §2 a real game: Penance takes both from 1 to 0 and the run is met on the
 *    action it resolves on
 * §3 text and label
 *
 * Seeds 65500-65599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import {
  DUMMY, PLAYER, foldRun, goalText, newChallengeGame, newRun, progress, progressLabel, type ChallengeDef,
} from '../src/challenge.ts';
import { Harness } from '../src/harness.ts';
import type { Action, CardName, EngineEvent, GameState, Seat } from '../src/types.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from './util.ts';

const DECK: CardName[] = Array.from({ length: 20 }, () => 'Penance');
const def: ChallengeDef = { id: 'e65500', week: '2027-01-10', title: 'T', blurb: '', goal: { kind: 'doubleKO' }, seed: 65500, par: 1 };
const pass: Action = { type: 'passPriority', seat: PLAYER };
const ev = (type: string, data: Record<string, unknown>): EngineEvent => ({ type, msg: '', data } as unknown as EngineEvent);

test('§1 CR 104.1a / CT-409: doubleKO is met by a game-over that says the winner fell too, and by nothing else', () => {
  const before = structuredClone(newChallengeGame(def, DECK).state);
  const fold = (lives: [number, number], data: Record<string, unknown>) => {
    const after: GameState = structuredClone(before);
    after.players[PLAYER]!.life = lives[0];
    after.players[DUMMY]!.life = lives[1];
    after.phase = 'gameover';
    after.winner = data['winner'] as number;
    return foldRun(newRun(def.goal, DECK), before, pass, after, [ev('gameOver', data)]);
  };
  const both = fold([0, 0], { winner: DUMMY, alsoAtZero: DUMMY });
  assert.equal(both.met, true);
  assert.equal(both.bothFell, true);
  assert.equal(fold([-1, 0], { winner: DUMMY, alsoAtZero: DUMMY }).met, true, 'whoever wins');
  assert.equal(fold([5, 0], { winner: PLAYER }).met, false, 'the dummy alone');
  assert.equal(fold([0, 9], { winner: DUMMY }).met, false, 'you alone');
  assert.equal(fold([5, 9], { winner: DUMMY, conceded: PLAYER }).met, false, 'a concession');
});

test('§2 CR 104.1a / CT-409: Penance takes both players from 1 to 0 and the run is met on that action', () => {
  // the fold reads the engine's game-over, whatever the deal: a plain game
  const h = new Harness(65501);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.life = 1;
  h.state.players[D]!.life = 1;
  let acc = newRun(def.goal, DECK);
  const step = (a: Action): void => {
    const before = h.state;
    const events = h.do(a);
    acc = foldRun(acc, before, a, h.state, events);
  };
  step({ type: 'playCard', seat: A, handIndex: give(h, A, 'Penance') });
  for (const seat of [D, A]) {
    const d = h.state.decision!;
    step({ type: 'decide', seat: d.seat, choice: d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ player: seat })) });
  }
  step({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(acc.met, false, 'not before it resolves');
  step({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.phase, 'gameover');
  assert.equal(acc.met, true);
  assert.deepEqual(progress(acc), { value: 1, target: 1, met: true });
});

test('§3 doubleKO reads as one plain sentence and a short meter label', () => {
  assert.equal(goalText({ kind: 'doubleKO' }), 'Defeat the dummy and yourself with the same effect');
  assert.equal(progressLabel({ kind: 'doubleKO' }), 'Both defeated');
});
