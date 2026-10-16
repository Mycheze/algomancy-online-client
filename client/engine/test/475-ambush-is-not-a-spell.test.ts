/* Report #218 (room UAPQ): Cosmic Reversal recalled a Lurking Slimebeast
 * Ambush off the stack.
 *
 * An Ambush is NOT a spell effect. The designer's side: _passer (2025-12-13,
 * rules-questions, Caleb deferring to him) — "From 'not spell' you can have
 * Triggered/Activated ability, Ambush or units that can be played during
 * combat"; Caleb (2023-07-09) — an Ambush cannot be Cosmic Denial'd "because
 * it's not a spell". The owner, 2026-10-16: "If Caleb says its not a spell,
 * it's not a spell and we need to fix that." And on Cosmic Reversal itself
 * (2026-08-29): "anything currently on the stack with type spell goes to the
 * owners hand".
 *
 * The engine used to put an Ambush on the spell side at six hand-copied kind
 * lists; they all read `isSpellEffect` now (476 sweeps the pool). This file
 * is the reported game's shape played for real, plus the other direction:
 * an Ambush is still an EFFECT, so "target nonspell effect" reaches it.
 *
 * Seeds are 47500-47599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ent, give, giveResources, offered, pass, pick, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

const passUntil = (h: Harness, seat: Seat) => { let g = 12; while (h.state.priority !== seat && g-- > 0) pass(h); };
const drain = (h: Harness) => {
  let g = 40;
  while ((h.state.stack.length || h.state.decision) && g-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
};

/** A attacks; A casts Flame of History (a real nontoken spell) at D's unit;
 * D answers with a Lurking Slimebeast Ambush that recalls that unit. */
function ambushOverASpell(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const raider = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'water', 2);
  giveResources(h, D, 'water', 3);
  giveResources(h, D, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  passUntil(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flame of History') });
  pick(h, { unit: ally });
  passUntil(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: ally });
  const flame = h.state.stack.find(i => i.card === 'Flame of History')!;
  const amb = h.state.stack.find(i => i.kind === 'ambush')!;
  assert.ok(flame && amb, 'the premise: a spell and an Ambush are both on the stack');
  return { h, A, D, ally, flame, amb };
}

test('Cosmic Reversal recalls the spell but not the Ambush, which stays and resolves (report 218)', () => {
  const { h, A, D, ally, amb } = ambushOverASpell(47501);
  passUntil(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Cosmic Reversal') });
  pass(h); pass(h);                                    // resolve the Reversal only
  assert.ok(h.state.players[A]!.hand.includes('Flame of History'),
    'the spell effect was recalled to its controller\'s hand');
  assert.ok(h.state.stack.some(i => i.id === amb.id),
    'the Ambush is still on the stack: it is not a spell effect');
  assert.ok(!h.state.players[D]!.hand.includes('Lurking Slimebeast'), 'and its card was not recalled');
  assert.ok(!h.log.some(l => /Cosmic Reversal recalls Lurking Slimebeast/.test(l)), 'nor logged as recalled');
  drain(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Lurking Slimebeast'), 'the Ambush resolved: the ambusher is in play');
  assert.ok(!ent(h, ally), 'and the ally it named was recalled');
});

test('Nothyr negates an Ambush: it is a nonspell effect (report 218)', () => {
  const { h, A, D, flame, amb } = ambushOverASpell(47502);
  passUntil(h, A);
  // A answers with Nothyr's discard line: "negate up to one target nonspell effect"
  giveResources(h, A, 'dark', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Nothyr'), mode: 'discardMe' });
  assert.equal(h.state.decision?.kind, 'targets', 'CR 110.1a: the negate names its victim as it goes on');
  assert.ok(offered(h).includes(JSON.stringify({ stack: amb.id })), 'the Ambush is offered');
  assert.ok(!offered(h).includes(JSON.stringify({ stack: flame.id })), 'the spell is not');
  pick(h, { stack: amb.id });
  pass(h); pass(h);                                    // resolve Nothyr's trigger
  assert.ok(!h.state.stack.some(i => i.id === amb.id), 'the Ambush was negated');
  assert.ok(h.state.players[D]!.bin.includes('Lurking Slimebeast'), 'and its card went to the bin');
});
