/**
 * CR 712.6b — report #386 (room BXYQ): The Everywhere's named card loses
 * abilities it gains LATER, too.
 *
 * "[Augment] As I am played or modded, name a card. My last named card loses
 * all abilities. (As long as I am in its region)." Karanda named Nimbus Eel; the
 * opponent then stacked Voltwrath Behemoth ("[Augment] Whenever you play a
 * spell, I deal 1 damage to any target") on their Eel, and the augment kept
 * firing with The Everywhere beside it. It was closed by-design on the RAQ
 * timestamp ruling for Monke / Transmogrifant ("this new Attribute/Ability is
 * NOT affected by Monke or Transmogrifant", CR 712.2). The owner marked it a
 * real bug: The Everywhere names a CARD and says that card loses all abilities
 * for as long as it is in its region — a condition on the card, not a strip
 * scoped to the moment it applied — so text the card gains afterwards is lost
 * too.
 *
 * The RAQ ruling still stands for every other stripper: the control below
 * shows Transmogrifant leaving a later augment alone (and 402 §1/§8 pin the
 * rest of it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard } from '../src/cards/dsl.ts';
import { effStats, ent, give, giveResources, playEverywhere, spawn, toDeployment, withE } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

const drain = (h: Harness): void => { while (h.state.stack.length || h.state.decision) {
  if (h.state.decision) throw new Error(`unexpected decision: ${h.state.decision.prompt}`);
  h.do({ type: 'passPriority', seat: h.state.priority! });
} };

function augment(h: Harness, seat: Seat, card: string, hostId: EntityId): EntityId {
  h.do({ type: 'augment', seat, from: 'hand', index: give(h, seat, card), hostId });
  drain(h);
  const modId = ent(h, hostId)!.mods.find(m => ent(h, m)!.card === card);
  assert.ok(modId !== undefined, `setup: ${card} is on the host`);
  return modId!;
}

/** Flourishing Flora ("[Augment] Whenever another ally spawns, put a +1/+1
 * counter on me") on a Nimbus Eel AFTER the stripper arrived: does it still
 * hear an ally spawn? */
function floraFiresAfter(stripper: 'The Everywhere' | 'Transmogrifant'): number {
  const h = new Harness(124201);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Nimbus Eel');
  if (stripper === 'The Everywhere') playEverywhere(h, A, 'Nimbus Eel');
  else spawn(h, A, 'Transmogrifant');                          // "Your other units … lose all abilities"
  assert.ok(h.q.abilitiesSuppressed(ent(h, eel)!), `setup: ${stripper} strips the Eel`);
  giveResources(h, A, 'wood', 1);                              // Flourishing Flora g/1
  augment(h, A, 'Flourishing Flora', eel);
  const before = ent(h, eel)!.counters;
  spawn(h, A, 'Unit Token');                                   // another ally spawns
  drain(h);
  return ent(h, eel)!.counters - before;
}

test('CR 712.6b / report #386: an augment put on the card The Everywhere named, AFTER it named it, is silenced too', () => {
  assert.equal(floraFiresAfter('The Everywhere'), 0, 'the later augment\'s trigger does not fire on the named Eel');
});

test('CR 712.2 control: under Transmogrifant the same later augment still fires (the RAQ timestamp ruling stands)', () => {
  assert.equal(floraFiresAfter('Transmogrifant'), 1, 'Transmogrifant takes only what arrived before it');
});

test('CR 712.6b / report #386: Voltwrath Behemoth stacked on the named Nimbus Eel after the naming has its line struck', () => {
  const h = new Harness(124202);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Nimbus Eel');
  playEverywhere(h, A, 'Nimbus Eel');
  giveResources(h, A, 'fire', 6);                              // Voltwrath Behemoth rr/6
  const modId = augment(h, A, 'Voltwrath Behemoth', eel);
  const ab = getCard('Voltwrath Behemoth').augmentText![0]!;
  withE(h, e => {
    const x = e.s.entities[eel]!;
    const at = e.stampOf(modId);
    assert.ok(e.abilityIsSuppressed(x, ab, at), '"Whenever you play a spell, I deal 1 damage" is off on the named Eel');
    assert.ok(e.abilityTextStripped(x, at), 'and the card panel strikes it');
  });
});

test('CR 712.6b: a static an augment gives the named card later is lost too ("I gain +2/+2")', () => {
  const h = new Harness(124203);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Nimbus Eel');
  playEverywhere(h, A, 'Nimbus Eel');
  giveResources(h, A, 'earth', 2);                             // Aetherflux Golem ee
  augment(h, A, 'Aetherflux Golem', eel);
  assert.deepEqual(effStats(h, eel), [2, 1], 'the Golem\'s "[Augment] I gain +2/+2" does not apply to the named Eel');
});

test('CR 712.6b: the later text comes back when The Everywhere leaves the region', () => {
  const h = new Harness(124204);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Nimbus Eel');
  const te = playEverywhere(h, A, 'Nimbus Eel');
  giveResources(h, A, 'earth', 2);
  augment(h, A, 'Aetherflux Golem', eel);
  assert.deepEqual(effStats(h, eel), [2, 1], 'setup: silenced while The Everywhere is here');
  withE(h, e => e.destroy(e.s.entities[te]!, 'is deleted'));
  drain(h);
  assert.ok(!h.q.abilitiesSuppressed(ent(h, eel)!), 'The Everywhere is gone: nothing strips the Eel');
  assert.deepEqual(effStats(h, eel), [4, 3], 'and the Golem\'s +2/+2 applies again');
});
