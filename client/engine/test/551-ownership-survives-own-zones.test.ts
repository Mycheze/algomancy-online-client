/**
 * CR 102.4 — A CARD'S OWNER NEVER CHANGES IN A PLAYER'S OWN ZONES.
 *
 * CT-233, owner ruling 2026-10-22: "The original owner holds while the card is
 * in a player's own hand, bin or cache; once it enters a shared pack, deck or
 * recycle pile, whoever takes it out owns it."
 *
 * Zones follow control (CR 400.4), so a stolen unit that is recalled goes to
 * the THIEF's hand. A hand holds bare card names, so the replay used to make
 * the thief the new unit's owner. A hand or bin card another player owns is
 * now a `PlayerState.foreign` entry beside its slot; a stack item carries the
 * owner on (`StackItem.owner`), and so does a cache entry.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { Action, Seat } from '../src/types.ts';
import { viewFor } from '../../server/view.ts';
import { ent, finishBattle, give, giveResources, handIdx, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

const CARD = 'Just a Unit';   // a 2-mana {l} unit with no text

/** The deploying seat steals the other seat's unit, then recalls it to its own hand. */
function stolenIntoHand(seed: number): { h: Harness; owner: Seat; thief: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const thief = h.state.deployPlayer!;
  const owner = (1 - thief) as Seat;
  const id = spawn(h, owner, CARD);
  withE(h, e => {
    assert.equal(e.giveControl(ent(h, id)!, thief), true, 'setup: the theft must happen');
    e.recall(ent(h, id)!);
  });
  assert.ok(h.state.players[thief]!.hand.includes(CARD), 'setup: zones follow control — the thief hand has it');
  return { h, owner, thief };
}

test('CR 102.4 / CT-233: a stolen card recalled to the thief hand and played again is still its owner card', () => {
  const { h, owner, thief } = stolenIntoHand(55101);
  giveResources(h, thief, 'light', 3);
  const before = new Set(unitsOf(h, thief).map(u => u.id));
  const play = legalActions(h.state, thief).find(a => a.type === 'playCard'
    && (a as { handIndex: number }).handIndex === handIdx(h, thief, CARD));
  assert.ok(play, 'setup: the thief may play it');
  h.do(play as Action);
  for (let i = 0; i < 4 && h.state.stack.length; i++) pass(h);
  const u = unitsOf(h, thief).find(x => !before.has(x.id) && x.card === CARD);
  assert.ok(u, 'the card is back in play');
  assert.equal(u!.controller, thief, 'under the player who played it');
  assert.equal(u!.owner, owner, 'and owned, as always, by its owner (CR 102.4) — it was the thief before');
  assert.equal(h.state.players[thief]!.foreign, undefined, 'the hand entry left with the card');
});

test('CR 102.4 / CT-233: the owner survives another card leaving the hand ahead of it', () => {
  const { h, owner, thief } = stolenIntoHand(55102);
  const at = handIdx(h, thief, CARD);
  assert.equal(new E(h.state).zoneOwner(thief, 'hand', at), owner, 'in the thief hand it is still the owner card');
  assert.ok(at > 0, 'setup: some other card sits ahead of it');
  withE(h, e => { e.discardFromHand(thief, 0); });
  const now = handIdx(h, thief, CARD);
  assert.equal(now, at - 1, 'it moved down a slot');
  assert.equal(new E(h.state).zoneOwner(thief, 'hand', now), owner, 'and its owner moved with it');
});

test('CR 102.4 / CT-233: a stolen card in the thief bin is still its owner card, and the bin keeps it there', () => {
  const h = new Harness(55103);
  toDeployment(h);
  const thief = h.state.deployPlayer!;
  const owner = (1 - thief) as Seat;
  const id = spawn(h, owner, CARD);
  withE(h, e => { e.giveControl(ent(h, id)!, thief); e.destroy(ent(h, id)!, 'dies'); });
  const bin = h.state.players[thief]!.bin;
  const at = bin.lastIndexOf(CARD);
  assert.ok(at >= 0, 'zones follow control: it died into the thief bin');
  assert.equal(new E(h.state).zoneOwner(thief, 'bin', at), owner, 'and is still the owner card there');
});

test('CR 102.4 / CT-233: a stolen card cached into the thief cache keeps its owner on the entry', () => {
  const h = new Harness(55104);
  toDeployment(h);
  const thief = h.state.deployPlayer!;
  const owner = (1 - thief) as Seat;
  const id = spawn(h, owner, CARD);
  withE(h, e => { e.giveControl(ent(h, id)!, thief); e.cacheUnit(ent(h, id)!); });
  const cc = new E(h.state).cache(thief).find(c => c.card === CARD);
  assert.ok(cc, 'zones follow control: it is in the thief cache');
  assert.equal(cc!.owner, owner, 'with its owner on the entry');
});

test('CR 102.4 / CT-233: a shared zone resets ownership — a stolen card recycled from the hand leaves its owner behind', () => {
  const { h, thief } = stolenIntoHand(55105);
  withE(h, e => { const took = e.takeFromHand(thief, handIdx(h, thief, CARD))!; e.recycleToBottom(thief, took.card); });
  assert.equal(h.state.players[thief]!.foreign, undefined, 'no ownership record survives into a shared pile');
});

test('CR D6.5 / CT-233: the opponent view never shows which hand slot holds a foreign-owned card', () => {
  const { h, owner, thief } = stolenIntoHand(55106);
  assert.ok(viewFor(h.state, thief).players[thief]!.foreign?.length, 'the thief own view keeps the record');
  assert.equal(viewFor(h.state, owner).players[thief]!.foreign, undefined,
    'the other seat sees card backs, and no slot record either');
});

test('CR 102.4 / CT-233: Wake the Dead playing a foreign-owned card out of its own bin keeps the owner', () => {
  const h = new Harness(55107, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  // a card D owns, sitting in A's bin (as a stolen unit that died there would)
  const bin = h.state.players[A]!.bin;
  bin.push('Shard Sprite');
  h.state.players[A]!.foreign = [{ zone: 'bin', at: bin.length - 1, card: 'Shard Sprite', owner: D }];
  giveResources(h, A, 'dark', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);                                           // Wake the Dead resolves
  pick(h, `${A}:${h.state.players[A]!.bin.indexOf('Shard Sprite')}`);
  if (h.state.decision?.options.some(o => o.value === 'done')) pick(h, 'done');
  for (let i = 0; i < 4 && h.state.stack.length; i++) pass(h);
  const u = unitsOf(h, A).find(x => x.card === 'Shard Sprite');
  assert.ok(u, 'the raised card is in play under the caster');
  assert.equal(u!.owner, D, 'and still owned by the player whose card it is');
  finishBattle(h);
});
