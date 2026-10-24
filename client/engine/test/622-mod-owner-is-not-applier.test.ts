/**
 * CR 102.4 / CT-343 — A MOD'S OWNER IS WHOSE CARD IT IS; WHO APPLIED IT IS A
 * DIFFERENT FACT.
 *
 * CT-233 (owner, 2026-10-22: "Reset in shared zones") made a card keep its
 * owner in a player's own hand, bin and cache, so a stolen card can sit in the
 * thief's hand still owned by the other player. Applied from there as a mod,
 * the mod entity's `owner` used to be the APPLIER: one field doing two jobs.
 * Morphic Mentor read it as "who applied", the stack's riding augments list
 * was built from it, and the binned mod lost its real owner.
 *
 * Now `Entity.owner` is whose card the mod is, `Entity.appliedBy` (optional,
 * read through `E.appliedBy`) is who applied it when that differs, and a Virus
 * stack item and a riding augment carry the card's owner the same way.
 *
 * Seeds: 62200-62299.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Element, Entity, EntityId, Seat } from '../src/types.ts';
import { effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** put `card` in `seat`'s hand as a card `owner` owns (as a stolen card recalled there would be) */
function giveForeign(h: Harness, seat: Seat, card: string, owner: Seat): number {
  const at = give(h, seat, card);
  const p = h.state.players[seat]!;
  p.foreign = [...(p.foreign ?? []), { zone: 'hand', at, card, owner }];
  return at;
}

const modOn = (h: Harness, host: EntityId, card: string): Entity | undefined =>
  ent(h, host)!.mods.map(id => ent(h, id)).find(m => m?.card === card);

const binOwner = (h: Harness, seat: Seat, card: string): Seat => {
  const at = h.state.players[seat]!.bin.lastIndexOf(card);
  assert.ok(at >= 0, `${card} is in the bin`);
  return new E(h.state).zoneOwner(seat, 'bin', at);
};

function deployBoard(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  for (const el of ELEMENTS) giveResources(h, A, el, 4);
  return { h, A, D };
}

test('CR 102.4 / CT-343: a foreign-owned augment applied out of the hand keeps its owner, and the applier is recorded apart', () => {
  const { h, A, D } = deployBoard(62201);
  const host = spawn(h, A, 'The Foretold');
  h.do({ type: 'augment', seat: A, from: 'hand', index: giveForeign(h, A, 'Reality Bender', D), hostId: host });
  const m = modOn(h, host, 'Reality Bender');
  assert.ok(m, 'the augment attached');
  assert.equal(m!.owner, D, 'the mod is still the card of the player who owns it');
  assert.equal(new E(h.state).appliedBy(m!), A, 'and the player who applied it is A');
  assert.equal(m!.controller, A, 'it is controlled with its host (CR 720.6a)');
  // a modded unit is Unstable and would be erased on death; a recall bins its mods
  withE(h, e => { e.recall(ent(h, host)!); });
  assert.equal(binOwner(h, A, 'Reality Bender'), D,
    'binned off its recalled host, into the controller bin (CR 400.4), it is still its owner card there');
});

test('CR 102.4 / CT-343: a foreign-owned graft applied out of the hand keeps its owner', () => {
  const { h, A, D } = deployBoard(62202);
  const oracle = spawn(h, A, 'Oracle of the Flame');
  h.do({ type: 'graft', seat: A, from: 'hand', index: giveForeign(h, A, 'Accelerated Germination', D), hostId: oracle, position: 0 });
  const m = modOn(h, oracle, 'Accelerated Germination');
  assert.ok(m, 'the graft attached');
  assert.equal(m!.owner, D);
  assert.equal(new E(h.state).appliedBy(m!), A);
});

test('CR 102.4 / CT-343: a mod applied by its own owner stores no applier, and an old mod without the field reads its owner as the applier', () => {
  const { h, A } = deployBoard(62203);
  const host = spawn(h, A, 'The Foretold');
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: host });
  const m = modOn(h, host, 'Reality Bender')!;
  assert.equal(m.owner, A);
  assert.equal(m.appliedBy, undefined, 'nothing new on the entity when owner and applier agree');
  assert.equal(new E(h.state).appliedBy(m), A, 'absent = the owner applied it, as before the split');
});

test('CR 102.4 / CT-343: a deployment augment that waits on a targeted trigger (Mohruung) keeps its owner when it attaches', () => {
  const { h, A, D } = deployBoard(62204);
  const mo = spawn(h, A, 'Mohruung');
  h.do({ type: 'augment', seat: A, from: 'hand', index: giveForeign(h, A, 'Reality Bender', D), hostId: mo });
  for (let guard = 20; h.state.decision && guard > 0; guard--) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  assert.equal(h.state.pendingMods, undefined, 'it attached');
  const m = modOn(h, mo, 'Reality Bender');
  assert.ok(m);
  assert.equal(m!.owner, D);
  assert.equal(new E(h.state).appliedBy(m!), A);
});

test('CR 102.4 / CT-343: a waiting mod whose host left play goes to the applier bin as its owner card', () => {
  const { h, A, D } = deployBoard(62205);
  withE(h, e => {
    e.s.pendingMods = [{ seat: A, host: 987654 as EntityId, card: 'Reality Bender', appliedAs: 'augment', owner: D }];
    e.finishPendingMods();
  });
  assert.equal(binOwner(h, A, 'Reality Bender'), D);
});

test('CR 102.4 / CT-343: a battle Virus out of the hand keeps its owner on the mod, and Morphic Mentor still hears its applier', () => {
  const h = new Harness(62206);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const mentor = spawn(h, A, 'Morphic Mentor');       // 2/3
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mentor]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: giveForeign(h, A, 'Reality Bender', D), hostId: mentor });
  assert.equal(h.state.stack.at(-1)?.owner, D, 'the Virus item carries the owner of its card');
  pass(h); pass(h);                                   // the virus resolves, the Mentor triggers
  pass(h); pass(h);                                   // the trigger resolves
  const m = modOn(h, mentor, 'Reality Bender');
  assert.ok(m, 'the virus attached');
  assert.equal(m!.owner, D, 'owned by D');
  assert.equal(new E(h.state).appliedBy(m!), A, 'applied by A');
  // the same reading as 17-earth-b: +2/+2 read through the Bender inversion
  assert.deepEqual(effStats(h, mentor), [0, 1], '"you apply an augment" is the APPLIER (A), not the card owner (D)');
  finishBattle(h);
});

test('CR 102.4 / CT-343: a foreign-owned Virus that fizzles goes to the applier bin as its owner card', () => {
  const h = new Harness(62207);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: giveForeign(h, A, 'Reality Bender', D), hostId: atk });
  new E(h.state).negate(h.state.stack.at(-1)!.id);
  pass(h); pass(h);
  assert.equal(ent(h, atk)!.mods.length, 0, 'the negated virus never attached');
  assert.equal(binOwner(h, A, 'Reality Bender'), D);
  finishBattle(h);
});

test('CR 102.4 / CT-343: a foreign-owned Virus on a spell unit on the stack rides into play still its owner card', () => {
  const h = new Harness(62208);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, D, 'wood', 2);                    // Hush Mush gg/2, a {Battle} spell unit
  giveResources(h, D, 'earth', 2);
  giveResources(h, A, 'water', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Premonition') });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: h.state.stack.find(i => i.card === 'Premonition')!.id });
  pass(h);                                           // A declines
  const mush = h.state.stack.find(i => i.card === 'Hush Mush')!;
  // D applies a Chitin Shredder that A owns, out of D's own hand
  h.do({ type: 'augment', seat: D, from: 'hand', index: giveForeign(h, D, 'Chitin Shredder', A), hostStack: mush.id });
  pass(h); pass(h);                                  // the virus attaches to the item
  assert.deepEqual(h.state.stack.find(i => i.card === 'Hush Mush')!.augments,
    [{ card: 'Chitin Shredder', by: D, owner: A }], 'the riding augment says who applied it and whose card it is');
  pass(h); pass(h);                                  // Hush Mush resolves and spawns
  const body = Object.values(h.state.entities).find(e => e.card === 'Hush Mush' && e.kind === 'unit');
  assert.ok(body, 'the spell unit arrived');
  const m = modOn(h, body!.id, 'Chitin Shredder');
  assert.ok(m, 'with the virus as an augment mod');
  assert.equal(m!.owner, A, 'still the card of the player who owns it');
  assert.equal(new E(h.state).appliedBy(m!), D, 'applied by D');
  finishBattle(h);
});
