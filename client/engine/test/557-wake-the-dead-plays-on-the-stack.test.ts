/* CT-245 — WAKE THE DEAD PLAYS ITS UNITS; IT DOES NOT CONJURE THEM.
 *
 * "Play up to two units in any bin with total cost [8] or less now, for free."
 *
 * CR 301.9: a unit an effect lets a player "play" was played. CR 701.4: a card
 * played during another effect's resolution goes on the stack during battle
 * and can be responded to. CR 303.9, and the designer on a spell unit played by
 * an effect (RAQ, Hooba-Pon): "Yes, the spell part happens and if it resolves,
 * the unit will spawn into formation."
 *
 * The engine used to raise them with `spawnUnit(asPlay)` inside Wake the
 * Dead's own resolution: no stack item, nothing to answer or negate, and a
 * spell unit (Jelly) arrived as a bare body with no target asked, no spell
 * part and no 'spellPlayed'. They go through `playInline` now, the road every
 * other mid-resolution play takes.
 *
 * Seeds 55700-55749.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { effStats, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

/** A attacks with a token; `bin` goes into the given bins; A casts Wake the Dead
 * in the attack window and it resolves, leaving its first question pending */
function wake(seed: number, bins: { mine?: string[]; theirs?: string[] }, dDemat = false) {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Good Whale');
  h.state.players[A]!.bin.push(...(bins.mine ?? []));
  h.state.players[D]!.bin.push(...(bins.theirs ?? []));
  giveResources(h, A, 'dark', 8);
  if (dDemat) { giveResources(h, D, 'water', 1); giveResources(h, D, 'metal', 1); }
  toNextBattle(h, A);
  if (dDemat) give(h, D, 'Dematerialize');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);                                          // Wake the Dead resolves
  return { h, A, D, victim, mark };
}

test('CR 303.9 / CT-245: a Jelly that Wake the Dead plays from a bin casts its spell, then its body arrives', () => {
  const { h, A, victim, mark } = wake(55700, { mine: ['Jelly'] });
  pick(h, `${A}:0`);
  if (h.state.decision?.options.some(o => o.value === 'done')) pick(h, 'done');
  // the -2/-2 is TARGETED, so it is declared as the Jelly is played
  assert.ok(h.state.decision, 'a target is asked for the spell part — the play is declared like any other');
  pick(h, { unit: victim });
  const jelly = h.state.stack.find(i => i.card === 'Jelly');
  assert.ok(jelly, 'CR 701.4: the Jelly waits on the stack — it has not resolved inside Wake the Dead');
  assert.equal(jelly.kind, 'spellUnit', 'as the spell unit it is');
  assert.equal(jelly.from, 'bin', 'played from the bin (CR 701.4a)');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Jelly'), 'and no body exists yet');
  const evs = h.events.slice(mark);
  assert.ok(evs.some(e => e.type === 'spellPlayed' && e.data?.['card'] === 'Jelly'),
    'it is played as a spell (RAQ: "Does that count as playing a spell for some triggers? Yes.")');
  assert.ok(evs.some(e => e.type === 'cardPlayed' && e.data?.['card'] === 'Jelly' && typeof e.data?.['item'] === 'number'),
    'and heard as a played card, with its item (CR 108.1a, 706.13)');
  pass(h); pass(h);                                          // the Jelly resolves
  assert.deepEqual(effStats(h, victim), [5, 3], 'the spell part happened: -2/-2 on the Good Whale');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Jelly'), 'and then the body arrived');
  finishBattle(h);
});

test('CR 701.4 / CT-245: a unit Wake the Dead plays can be answered, and a negated one never arrives', () => {
  const { h, A, D } = wake(55701, { mine: ['Shard Sprite'] }, true);
  pick(h, `${A}:0`);
  if (h.state.decision?.options.some(o => o.value === 'done')) pick(h, 'done');
  const item = h.state.stack.find(i => i.card === 'Shard Sprite');
  assert.ok(item, 'the raised unit is ON THE STACK');
  assert.equal(h.state.decision, null, 'with nothing pending — a priority window is open on it');
  if (h.state.priority !== D) pass(h);
  assert.equal(h.state.priority, D, 'and the opponent gets a turn in it');
  h.do({ type: 'playCard', seat: D, handIndex: h.state.players[D]!.hand.indexOf('Dematerialize') });
  pick(h, { stack: item.id });
  pass(h); pass(h);                                          // Dematerialize resolves
  const glimpse = h.state.decision as { seat: Seat } | null;   // (narrowed to null by the assert above)
  if (glimpse) h.do({ type: 'decide', seat: glimpse.seat, choice: 0 });   // its Glimpse
  assert.ok(!h.state.stack.some(i => i.card === 'Shard Sprite'), 'negated off the stack');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Shard Sprite'), 'and no body ever arrived');
  assert.ok(h.state.players[A]!.bin.includes('Shard Sprite'), 'the answered card is back in a bin');
  finishBattle(h);
});

test('CR 102.5a / CT-245: a unit Wake the Dead plays out of the opponent bin is still the opponent card', () => {
  const { h, A, D } = wake(55702, { theirs: ['Shard Sprite'] });
  pick(h, `${D}:0`);
  if (h.state.decision?.options.some(o => o.value === 'done')) pick(h, 'done');
  const item = h.state.stack.find(i => i.card === 'Shard Sprite');
  assert.ok(item, 'played onto the stack');
  assert.equal(item.controller, A, 'the caster plays it');
  pass(h); pass(h);
  const body = unitsOf(h, A).find(u => u.card === 'Shard Sprite');
  assert.ok(body, 'the caster controls the body');
  assert.equal(body.owner, D, 'and the opponent still owns it (CARD-TODO #17)');
  finishBattle(h);
});
