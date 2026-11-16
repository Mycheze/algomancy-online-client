/**
 * CT-409 — two players brought to 0 by the same effect.
 *
 * Caleb, rules-questions 2025-03-10, asked who wins if both players die in the
 * same combat step: "both players would need to die at the exact same time for
 * this to happen, which is quite rare. But yes currently the rule is player with
 * the highest life total wins". The owner, 2026-10-25, choosing between the
 * readings: "Highest total, tie: INT loses". On an exact tie the owner later
 * chose a draw: "B - make it a draw. Nyar is right. But this is the only case
 * (now) where a draw can happen" (CT-565, report #403).
 *
 * So every life change of one effect is applied before anyone loses (CR 104.1a):
 * one resolving effect part (the same unit CR 112.8 deals damage in and CR 708.9
 * creates tokens in), one combat-damage sub-step, one rot step. Then, if both
 * players are at 0 or less, the higher total wins (negative numbers count) and
 * an exact tie is a draw (CR 104.1b): phase 'gameover', no winner.
 *
 * Before the fix the first `loseLife` to reach 0 ended the game on the spot, so
 * the winner was whoever the effect happened to list second.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, GameEnded, other } from '../src/engine.ts';
import {
  assignDefault, give, giveResources, pass, pick, skipHasteStep, spawn, throughDamageWindows, toDeployment, toNextBattle,
} from './util.ts';
import type { EngineEvent, Seat } from '../src/types.ts';

const over = (h: Harness): EngineEvent | undefined => h.events.find(e => e.type === 'gameOver');

/** A attacks into D's region with a token; returns the seats once the attack is declared */
function battle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  return { h, A, D };
}

for (const first of ['defender', 'attacker'] as const) {
  test(`CR 104.1a / CT-409 / CT-565: Penance takes both players from 1 to 0 and the game is a draw (${first} targeted first)`, () => {
    const { h, A, D } = battle(65401);
    h.state.players[A]!.life = 1;
    h.state.players[D]!.life = 1;
    const idx = give(h, A, 'Penance');
    h.do({ type: 'playCard', seat: A, handIndex: idx });
    const order = first === 'defender' ? [D, A] : [A, D];
    pick(h, { player: order[0] });
    pick(h, { player: order[1] });
    pass(h);
    assert.equal(h.state.phase, 'gameover');
    assert.equal(h.state.players[A]!.life, 0, 'both losses were applied');
    assert.equal(h.state.players[D]!.life, 0, 'both losses were applied');
    assert.equal(h.state.winner, null, 'equal totals at 0: nobody wins, whichever target came first');
    const ev = over(h)!;
    assert.equal((ev.data as Record<string, unknown>)['draw'], true, 'the game-over says it is a draw');
    assert.throws(() => h.do({ type: 'concede', seat: A }), /over/, 'a drawn game cannot be conceded afterwards');
  });
}

for (const [aLife, dLife] of [[1, 2], [2, 1]] as const) {
  test(`CR 104.1a / CT-409: Recall takes 2 from each player and the higher total wins, negative numbers included (${aLife} and ${dLife})`, () => {
    const { h, A, D } = battle(65403);
    h.state.players[A]!.life = aLife;
    h.state.players[D]!.life = dLife;
    const idx = give(h, A, 'Recall');
    h.do({ type: 'playCard', seat: A, handIndex: idx });
    pass(h);
    while (h.state.decision && h.state.phase !== 'gameover') h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    assert.equal(h.state.phase, 'gameover');
    assert.equal(h.state.players[A]!.life, aLife - 2);
    assert.equal(h.state.players[D]!.life, dLife - 2);
    const want = aLife > dLife ? A : D;
    assert.equal(h.state.winner, want, `${aLife - 2} beats ${dLife - 2}`);
  });
}

test('CR 104.1a / CT-409: an unblocked attacker and a Piercing blocker bring both players to 0 in one combat step, and the higher total wins', () => {
  // CR 608.4: every unit in formation deals its combat damage at the same time.
  // The unblocked Foretold deals 3 to the defender; the Good Whale (7/5
  // {Piercing}) blocking the other Foretold (3/3) pierces 4 to the attacker.
  const h = new Harness(65405);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const a0 = spawn(h, A, 'The Foretold');
  const a1 = spawn(h, A, 'The Foretold');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [whale] } });
  h.state.players[A]!.life = 3;   // takes 4: ends on -1
  h.state.players[D]!.life = 3;   // takes 3: ends on 0
  pass(h); pass(h);
  throughDamageWindows(h);
  assignDefault(h);
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.players[A]!.life, -1, 'the pierce landed although the attacker struck first in the list');
  assert.equal(h.state.players[D]!.life, 0);
  assert.equal(h.state.winner, D, '0 beats -1: the initiative player used to lose here by list order alone');
});

test('CR 104.1b / CT-565 / #403: an unblocked attacker and a Piercing blocker bring both players to exactly 0 in one combat step, and the game is a draw', () => {
  // The reported game: the initiative player attacked, and one combat damage
  // sub-step took both players to 0.
  const h = new Harness(65405);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const a0 = spawn(h, A, 'The Foretold');
  const a1 = spawn(h, A, 'The Foretold');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [whale] } });
  h.state.players[A]!.life = 4;   // takes 4 pierced: ends on 0
  h.state.players[D]!.life = 3;   // takes 3: ends on 0
  pass(h); pass(h);
  throughDamageWindows(h);
  assignDefault(h);
  assert.equal(h.state.phase, 'gameover');
  assert.deepEqual([h.state.players[A]!.life, h.state.players[D]!.life], [0, 0]);
  assert.equal(h.state.winner, null, 'the initiative player used to lose this tie');
  const ev = over(h)!;
  assert.equal((ev.data as Record<string, unknown>)['draw'], true);
  assert.match(ev.msg, /draw/);
  assert.equal(h.events.filter(e => e.type === 'gameOver').length, 1, 'the game ends once');
});

test('CR 104.1a / CT-409: with one player at 0 the other still wins, and an effect finishes before the game ends CT-417', () => {
  // Inside one effect a player at 0 is not yet out: the rest of the effect
  // runs (here Penance still draws), and then the game ends.
  const { h, A, D } = battle(65407);
  h.state.players[D]!.life = 1;
  const idx = give(h, A, 'Penance');
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'playCard', seat: A, handIndex: idx });
  pick(h, { player: D });
  pick(h, { doneTargets: true });
  pass(h);
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, A);
  assert.equal(h.state.players[A]!.hand.length, hand, 'played one, drew one: the draw ran after the loss');
  assert.equal((over(h)!.data as Record<string, unknown>)['alsoAtZero'], undefined, 'nobody else fell');
});

test('CR 104.1a / CT-409 / CT-565: the engine decides a double loss by total, and equal totals are a draw', () => {
  const h = new Harness(65409);
  toDeployment(h);
  for (const [l0, l1, want] of [[-3, -1, 1], [-1, -3, 0], [0, 0, null], [-2, -2, null]] as const) {
    const e = new E(structuredClone(h.state));
    e.s.players[0]!.life = 1;
    e.s.players[1]!.life = 1;
    let ended = false;
    try {
      e.lifeBatch(() => {
        e.loseLife(0, 1 - l0, 'probe');
        e.loseLife(1, 1 - l1, 'probe');
      });
    } catch (sig) {
      if (!(sig instanceof GameEnded)) throw sig;
      ended = true;
    }
    assert.ok(ended, 'the batch ended the game once, at its end');
    assert.equal(e.s.winner, want, `${l0} vs ${l1}`);
    assert.equal(e.s.phase, 'gameover', `${l0} vs ${l1}`);
  }
});

test('CR 104.1a / CT-409: rot is not simultaneous, so the initiative player whose rot takes them to 0 loses before the other player takes theirs', () => {
  // Caleb, 2026-08-28, both players holding more rot than life: "initiative
  // takes their deployment first and dies" … "But rot isn't simultaneous".
  // Batched, the initiative player would win here on 0 against -4.
  const h = new Harness(65411);
  const I = h.state.initiative, N = other(I);
  h.state.players[I]!.life = 1; h.state.players[I]!.rot = 1;
  h.state.players[N]!.life = 1; h.state.players[N]!.rot = 5;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, N);
  assert.equal(h.state.players[N]!.life, 1, 'the second rot never landed');
});
