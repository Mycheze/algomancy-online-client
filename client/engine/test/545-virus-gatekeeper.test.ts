/**
 * CR 110.12 / CT-331 — a Virus applied in battle obeys Gatekeeper of Souls.
 *
 * Applying a Virus targets its host (CR 110.10a), and Gatekeeper of Souls
 * prints "When a player selects targets for an effect during battle, I must
 * be targeted if able." `doAugment` accepted any unit in the battle region and
 * `legalActions` offered every one, so a Virus could go onto another unit with
 * a Gatekeeper standing there. The host choice now runs through the same
 * compulsion the target collector applies, in the offer AND in the accept
 * (the fuzzer's "legalActions lied" check compares the two).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, Seat } from '../src/types.ts';

const augmentOffers = (h: Harness, seat: Seat): Extract<Action, { type: 'augment' }>[] =>
  legalActions(h.state, seat).filter((a): a is Extract<Action, { type: 'augment' }> => a.type === 'augment');

test('CR 110.12 / CT-331: with a Gatekeeper of Souls in the battle, a Virus may be applied only to it', () => {
  const h = new Harness(5450);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const gk = spawn(h, D, 'Gatekeeper of Souls');
  const other = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 2);                             // Crumbling Ancient, e/2 {Virus}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const idx = give(h, A, 'Crumbling Ancient');
  const hosts = augmentOffers(h, A).filter(a => a.index === idx && a.from === 'hand').map(a => a.hostId ?? `stack ${a.hostStack}`);
  assert.deepEqual(hosts, [gk], 'the Gatekeeper is the only host offered');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: other }),
    /must be targeted/, 'and applying it to another unit is refused');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: atk }),
    /must be targeted/, 'an ally included');
  h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: gk });
  pass(h); pass(h);                                            // the Virus resolves
  assert.ok(ent(h, gk)!.mods.some(m => ent(h, m)?.card === 'Crumbling Ancient'), 'it landed on the Gatekeeper');
  finishBattle(h);
});

test('CR 110.12 / CT-331: a Gatekeeper compels a Virus away from a spell on the stack too', () => {
  const h = new Harness(5451);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const gk = spawn(h, D, 'Gatekeeper of Souls');
  giveResources(h, A, 'fire', 3);                              // Twin Flame rr/3
  giveResources(h, D, 'earth', 2);                             // Crumbling Ancient e/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  // Twin Flame: the Gatekeeper first, then any other unit
  while (h.state.decision) {
    const dec = h.state.decision;
    h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  }
  assert.equal(h.state.priority, D, 'setup: the defender may respond');
  const spell = h.state.stack[h.state.stack.length - 1]!.id;
  const idx = give(h, D, 'Crumbling Ancient');
  const offers = augmentOffers(h, D).filter(a => a.index === idx && a.from === 'hand');
  assert.ok(!offers.some(a => a.hostStack === spell), 'the spell on the stack is not offered as a host');
  assert.ok(offers.some(a => a.hostId === gk), 'the Gatekeeper is');
  assert.throws(() => h.do({ type: 'augment', seat: D, from: 'hand', index: idx, hostStack: spell }),
    /must be targeted/);
  assert.ok(ent(h, gk), 'setup: the Gatekeeper still stands');
});

test('CR 110.12 / CT-331: with no Gatekeeper, a Virus still reaches every unit in the battle', () => {
  const h = new Harness(5452);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const a = spawn(h, D, 'Unit Token');
  const b = spawn(h, D, 'Curio Drifter');
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const idx = give(h, A, 'Crumbling Ancient');
  const hosts = new Set(augmentOffers(h, A).filter(x => x.index === idx).map(x => x.hostId));
  for (const u of [atk, a, b]) assert.ok(hosts.has(u), `unit ${u} is offered`);
  finishBattle(h);
});
