/**
 * CR 305.6, 721.4a, 723.2 / CT-407 — IN BATTLE A VIRUS MAY GO ONTO A SPELL TOKEN
 * STANDING IN PLAY.
 *
 * The engine let a battle Virus mod a unit in the battle (CR 723.2) or a spell
 * on the stack (CR 723.4), and let any augment mod your own spell token in play
 * during DEPLOYMENT (CR 721.4a) — but not a spell token standing in play during
 * a battle. Sources:
 *   Caleb, rules-questions 2025-04-24 (RQ 1364998183226179735), asked "Can you
 *   Augment Fireball in play or only Fireball on stack?": "Honestly I don't see
 *   why you couldn't".
 *   Caleb, 2025-03-06 (RQ 1347270455198879858): "It's very similar to how
 *   regular viruses work. So you can hit enemy spells" … "Also you can only do
 *   this with attributes".
 *   Owner, 2026-10-24, asked "During a battle, can a Virus be augmented onto a
 *   spell token that is sitting in play?": "Yes, allow it".
 * Like any battle Virus it may go onto either player's token in the battle
 * region, and the token gains only the attributes (CR 721.4b).
 *
 * Seeds: 66500-66549.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { Action, EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from './util.ts';

/** A attacks into D region taking a Fireball (X 3) with it; D holds a Fireball at home there too */
function battle(seed: number): { h: Harness; A: Seat; D: Seat; mine: EntityId; theirs: EntityId; victim: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const e = new E(h.state);
  e.createSpellToken(A, 'Fireball', 3, e.homeRegion(A));
  e.createSpellToken(D, 'Fireball', 2, e.homeRegion(D));
  const mine = tokensOf(h, A).find(t => t.card === 'Fireball')!.id;
  const theirs = tokensOf(h, D).find(t => t.card === 'Fireball')!.id;
  const victim = spawn(h, D, 'The Foretold');                    // 3/3, D home
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]], spellTokens: [mine] });
  if (h.state.priority !== A) pass(h);
  giveResources(h, A, 'earth', 4);
  return { h, A, D, mine, theirs, victim };
}

const augmentOffers = (h: Harness, seat: Seat, index: number) =>
  legalActions(h.state, seat).filter(
    (a): a is Extract<Action, { type: 'augment' }> => a.type === 'augment' && a.index === index);

test('CR 721.4a / CT-407: in battle a Virus is offered onto a spell token in play, either player token in the battle region', () => {
  const { h, A, mine, theirs } = battle(66501);
  assert.equal(h.state.battle!.region, ent(h, theirs)!.region, 'fixture: the battle is in the region D token stands in');
  assert.equal(ent(h, mine)!.region, h.state.battle!.region, 'fixture: A token rode out with the attack');
  const idx = give(h, A, 'Chitin Shredder');                     // {Virus}, [Augment] {Powerful}
  const hosts = augmentOffers(h, A, idx).map(a => a.hostId);
  assert.ok(hosts.includes(mine), 'A own Fireball in play is a host');
  assert.ok(hosts.includes(theirs), 'and so is the enemy Fireball ("you can hit enemy spells")');
  finishBattle(h);
});

test('CR 721.4a / CT-407: a Virus gives a Fireball token in play Powerful mid-battle, and its cast deals double', () => {
  const { h, A, mine, victim } = battle(66502);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: mine });
  assert.equal(h.state.stack.at(-1)?.kind, 'virus', 'a battle Virus uses the stack (CR 723.3)');
  pass(h); pass(h);                                              // the Virus resolves
  assert.equal(ent(h, mine)!.mods.length, 1, 'the Virus is attached to the token');
  assert.ok(h.log.some(l => /Chitin Shredder augments Fireball — the spell gains \{Powerful\}/.test(l)), 'and the log says the spell gains only the attribute');
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'castSpellToken', seat: A, entityId: mine });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.ok(!ent(h, victim), 'a Fireball 3 wearing {Powerful} deals 6 and kills a 3/3');
  assert.ok(h.log.some(l => /Fireball deals 6 /.test(l)), 'and the log shows the doubled number');
  finishBattle(h);
});

test('CR 721.4b / CT-407: a non-Virus augment still cannot go onto a token in battle', () => {
  const { h, A, mine } = battle(66503);
  const idx = give(h, A, 'Tempest Wrangler');               // [Augment] {Alluring}, not a Virus
  assert.equal(augmentOffers(h, A, idx).length, 0, 'only a Virus augments in battle (CR 723.2)');
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: mine }));
  finishBattle(h);
});
