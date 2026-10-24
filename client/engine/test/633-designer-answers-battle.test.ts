/* THREE OWNER QUESTIONS THE DESIGNER HAD ALREADY ANSWERED (2026-10-24).
 *
 * owner-questions.md carried them as open; the 2026-10-24 CR audit found
 * Caleb's answers in the flat rules-questions channel. In each case the engine
 * already does what he says, and nothing pinned the case that tells the two
 * readings apart. These are the guards the redrafted rules bind.
 *
 * §1–2 CR 505.3f, Temporal Rift ("End this battle."). _passer: "Cast in NIT
 *      Region before blockers = No Counter-Attack for NIT / Cast … after
 *      blockers = Counter-Attack is already sent and 2nd Battle happens?";
 *      Caleb: "that's what it currently is" (RQ 1353982561101025362). 30's
 *      Rift test gives the non-initiative player no units at all, so it cannot
 *      tell "no round 2" from "round 2 with nobody to send".
 * §3   CR 802.2a, Flying. "Columns share attributes, so if any unit in the
 *      column has flying, the entire column has flying" (RQ 1348502069614612563).
 * §4   CR 802.14a, Sneaky. "Attributes like that are only checked during the
 *      assign blockers step" (RQ 1353935255425388665).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ent, give, giveResources, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

test('CR 505.3f / designer: Temporal Rift cast before blocks ends the battle phase — the non-initiative player gets no round 2, though it has units', () => {
  const h = new Harness(63301);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const home = spawn(h, D, 'Curio Drifter');               // could counterattack, if there were a round 2
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'metal', 2);                          // Temporal Rift: bmm / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                  // the initiative player passes the attack window
  assert.equal(h.state.priority, D, 'the non-initiative player holds priority in the attack window');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Temporal Rift') });
  pass(h); pass(h);                                         // both pass: the Rift resolves
  assert.equal(h.state.battle, null, 'the battle phase is over');
  assert.equal(h.state.phase, 'deploy', 'no round 2: straight on to deployment');
  assert.ok(ent(h, home) && !ent(h, home)!.absent, 'the unit that could have counterattacked is still at home');
});

test('CR 505.3f / designer: Temporal Rift cast after blocks ends round 1 only — the units sent at the block step attack in round 2', () => {
  const h = new Harness(63302);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  const counter = spawn(h, D, 'Rune Channeler');
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [counter] });
  assert.ok(ent(h, counter)!.absent, 'the sent counterattacker is away during round 1');
  pass(h);                                                  // the initiative player passes the block window
  assert.equal(h.state.priority, D);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Temporal Rift') });
  pass(h); pass(h);                                         // the Rift resolves before combat damage
  assert.equal(h.state.players[D]!.life, lifeD, 'round 1 ended before any combat damage');
  assert.equal(h.state.battle?.round, 2, 'round 2 happens');
  assert.equal(h.state.battle!.attacker, D, 'the non-initiative player attacks in it');
  assert.ok(h.legal(D).some(a => a.type === 'declareAttack' && a.columns.flat().includes(counter)),
    'with the unit it sent at the block step');
});

test('CR 802.2a / designer: a unit without Flying may block a Flying column together with a Flying unit in its column', () => {
  const h = new Harness(63303);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sky = spawn(h, A, 'Ephemeral Skywalker');           // 3/1 Flying
  const flyer = spawn(h, D, 'Ephemeral Skywalker');         // Flying
  const ground = spawn(h, D, 'Good Whale');                 // no Flying
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sky]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [ground] } }),
    /flying/i, 'alone, the unit without Flying cannot block the Flying column');
  assert.ok(h.legal(D).some(a => a.type === 'declareBlocks' && (a.blocks[0] ?? []).includes(ground)),
    'beside a Flying unit it is offered as a blocker');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [flyer, ground] } });
  assert.deepEqual(h.state.battle!.blocks[0], [flyer, ground],
    'and the shared column blocks');
});

test('CR 802.14a / designer: Sneaky "attacking alone" is judged when blocks are declared — a co-attacker gone by then leaves it unblockable', () => {
  const h = new Harness(63304);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const mantid = spawn(h, A, 'Whispering Mantid');          // 3/2 Sneaky
  const extra = spawn(h, A, 'Lonely Forager');
  const blocker = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mantid], [extra]] });
  withE(h, e => e.destroy(e.entity(extra)!, 'is sacrificed')); // gone in the attack window
  assert.equal(ent(h, extra), undefined, 'the co-attacker has left play');
  pass(h); pass(h);                                         // → blocks
  assert.ok(!h.legal(D).some(a => a.type === 'declareBlocks' && Object.keys(a.blocks).length > 0),
    'no block is offered against the Sneaky unit, now attacking alone');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } }),
    /Sneaky/, 'and an explicit block is refused');
});
