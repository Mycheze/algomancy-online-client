/* Report #211 (room XFFB, Single Card Duel: 30 Cinder Scuttler vs 30 Abduct) —
 * "Can't play abduct here for some reason".
 *
 * Abduct is "Gain control of target unit with cost [x] or less unless its
 * controller pays [x]", and its restriction reads the item's X. X is chosen
 * BEFORE targets (CR 702.3a, 702.3c), but the castability gate asked CR 110.7's
 * "can every required target be chosen?" with NO X at all, so the restriction
 * read X as 0 and a battle with only cost-1 attackers never offered the card:
 * eleven battle windows in XFFB, zero offers. The per-card test hid it with a
 * cost-0 Unit Token in the attack.
 *
 * The rule the gate now asks (CR 110.7, 107.2a): is there an X the caster could
 * pay at which every required target exists? And the X menu offers only those
 * X — an X that leaves the target slot empty is not a legal declaration, so
 * Abduct can no longer reach the stack aimed at nothing.
 *
 * Seeds 45200-45299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { CachedCard, ResourceState, Seat } from '../src/types.ts';
import { ent, give, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const open = (kind: ResourceState['kind']): ResourceState => ({ kind, state: 'open' });

/** A attacks with exactly `attackers`; D holds priority with `mana` open */
function battleWith(seed: number, attackers: string[], mana: ResourceState[]): { h: Harness; A: Seat; D: Seat; ids: number[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids = attackers.map(n => spawn(h, A, n));
  toNextBattle(h, A);
  h.state.players[A]!.resources = [];            // no ransom money: the flip is unconditional
  h.state.players[D]!.resources = mana;
  h.state.players[D]!.hand = [];
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  pass(h);                                        // priority → D
  assert.equal(h.state.priority, D, 'D holds priority in the battle');
  return { h, A, D, ids };
}

const abductPlays = (h: Harness, D: Seat) =>
  legalActions(h.state, D).filter(a => a.type === 'playCard'
    && h.state.players[D]!.hand[(a as { handIndex: number }).handIndex] === 'Abduct');

test('Abduct is castable against a cost-1 attacker, its X menu starts at 1, and control flips', () => {
  // wood + metal for the gm affinity, and 2 more: 4 open mana in all
  const { h, A, D, ids } = battleWith(45200, ['Cinder Scuttler'], [open('wood'), open('metal'), open('fire'), open('fire')]);
  const [scuttler] = ids as [number];
  const hi = give(h, D, 'Abduct');
  assert.equal(abductPlays(h, D).length, 1, 'report #211: Abduct is offered in the battle window');
  h.do({ type: 'playCard', seat: D, handIndex: hi });
  const xs = h.state.decision!.options.map(o => o.value);
  assert.deepEqual(xs, [1, 2, 3, 4], 'X = 0 is not offered — at 0 there is no unit to take');
  pick(h, 1);                                     // X = 1
  pick(h, { unit: scuttler });
  pass(h); pass(h);                               // resolve — A has nothing to ransom with
  assert.equal(ent(h, scuttler)!.controller, D, 'D gains control of the Cinder Scuttler');
  assert.ok(!h.state.battle!.columns.flat().includes(scuttler), 'the flipped unit left the formation');
  void A;
});

test('Abduct is not castable when no payable X reaches any attacker', () => {
  // cost-3 attacker, only 2 open: X = 2 is the most D can pay
  const { h, D } = battleWith(45201, ['Rune Channeler'], [open('wood'), open('metal')]);
  give(h, D, 'Abduct');
  assert.equal(abductPlays(h, D).length, 0, 'CR 110.7: no X D can pay leaves a legal target');
});

test('A free prophecy release of Abduct is judged at X = 0, not at the open mana', () => {
  // CR 702.6c: a fulfilled prophecy releases an X spell for free at X = 0. With
  // 4 open the hand copy could reach the cost-1 attacker, but the free release
  // cannot choose X at all, so it would be aimed at nothing.
  const { h, D } = battleWith(45202, ['Cinder Scuttler'], [open('wood'), open('metal'), open('fire'), open('fire')]);
  const cached: CachedCard = {
    card: 'Abduct',
    prophecy: { condition: 'test', norm: 'test', turn: 0, battles: 0, fulfilled: true },
  };
  h.state.players[D]!.cache = [cached];
  const cachedPlays = () => legalActions(h.state, D).filter(a => a.type === 'playCached');
  assert.equal(cachedPlays().length, 0, 'at X = 0 there is no cost-0 unit to take');
  assert.throws(() => h.do({ type: 'playCached', seat: D, index: 0 }), /no legal targets/,
    'and apply refuses it for the same reason');
});

test('A free prophecy release of Abduct is offered when a cost-0 unit is there to take', () => {
  const { h, D, ids } = battleWith(45203, ['Cinder Scuttler', 'Unit Token'], [open('wood'), open('metal')]);
  const token = ids[1]!;
  h.state.players[D]!.cache = [{
    card: 'Abduct',
    prophecy: { condition: 'test', norm: 'test', turn: 0, battles: 0, fulfilled: true },
  }];
  assert.equal(legalActions(h.state, D).filter(a => a.type === 'playCached').length, 1);
  h.do({ type: 'playCached', seat: D, index: 0 });
  // no X question: it is fixed at 0, so the first ask is the target
  const offered = h.state.decision!.options.map(o => JSON.stringify(o.value));
  assert.deepEqual(offered, [JSON.stringify({ unit: token })], 'only the cost-0 unit qualifies at X = 0');
});
