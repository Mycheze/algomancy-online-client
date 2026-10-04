/* R311 — the KEMX shape: a cached {Virus} in a battle priority window.
 *
 * Report #195 (game KEMX, action 105, 2026-10-04): the owner held priority in
 * the after-combat window with Gember's Mirage Walker in the battle and a
 * glimpsed Möbius's Corruption in the cache — and `legalActions` offered no
 * augment for it. From hand it would have been offered. He spent Umbral Decay
 * instead. *"I'm not able to virus a card from my cached cards."*
 *
 * 369-cache-is-the-hand is the whole-pool sweep that keeps the offer honest
 * for every card and mode. This file plays the KEMX move to the end: the
 * cached Virus goes onto an ENEMY unit and onto a SPELL on the stack, pays
 * its mana while ignoring its affinity (R303 — the seat has no dark at all),
 * says so in the log, and lands as a mod. Plus the two siblings R311 opened in
 * the same window: a fulfilled prophecy's Virus is free, and a cached Ambush
 * ambushes.
 *
 * Seeds: 3700-3709.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Action, Seat, StackItem } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const VIRUS = "Möbius's Corruption";   // d/1 5/3 {Virus}
const FILLER = 'The Foretold';

/** A attacks D with one vanilla unit, then casts Arc Lightning at D, so D
 * holds priority with an enemy unit in the battle and a spell on the stack.
 * D's mana is all FIRE: not one dark pip, so any Virus D lands from the cache
 * is landing on the R303 affinity waiver and nothing else. */
function kemxWindow(seed: number): { h: Harness; A: Seat; D: Seat; atk: number; ally: number; spell: StackItem } {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const ally = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { player: D });
  giveResources(h, D, 'fire', 6);
  assert.equal(h.state.priority, D);
  return { h, A, D, atk, ally, spell: h.state.stack[0]! };
}

/** glimpse `name` off the top of `seat`'s deck into the cache, stamped live —
 * the real route, as Premonition / Maw of Despair take it */
function glimpse(h: Harness, seat: Seat, name: string): void {
  h.q.deckOf(seat).unshift(name);
  withE(h, e => { e.glimpse(seat, 1); });
  assert.equal(h.q.cachePermission(seat, h.state.players[seat]!.cache!.length - 1), 'glimpse');
}

const cacheVirus = (h: Harness, D: Seat): Action[] =>
  h.legal(D).filter(a => a.type === 'augment' && a.from === 'cache');

test('R311: a glimpsed Virus in the cache goes onto an ENEMY unit in battle, ignoring affinity', () => {
  const { h, A, D, atk } = kemxWindow(3700);
  glimpse(h, D, VIRUS);
  assert.ok(!h.q.canPayCard(D, VIRUS, { purpose: 'mod' }), 'from hand it would be unaffordable: no dark at all');
  const opt = cacheVirus(h, D).find(a => a.type === 'augment' && a.hostId === atk);
  assert.ok(opt, `the cache offers ${VIRUS} onto the attacker (offers: ${JSON.stringify(cacheVirus(h, D))})`);
  const mana = h.q.openMana(D);
  h.do(opt!);
  assert.equal(h.q.openMana(D), mana - 1, 'the [1] mana is paid');
  assert.equal(h.state.players[D]!.cache!.length, 0, 'it left the cache');
  assert.ok(h.log.some(l => l === `${VIRUS} augments out of ${h.state.players[D]!.name}'s cache, ignoring affinity.`),
    'the waiver is said out loud, as the deployment branch says it');
  const top = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(top.kind, 'virus', 'a Virus augment is a response on the stack');
  assert.equal(top.hostId, atk);

  pass(h); pass(h);                                  // the virus resolves first
  const host = h.state.entities[atk]!;
  assert.ok(host.mods.some(m => h.state.entities[m]?.card === VIRUS), `${VIRUS} is a mod on the enemy attacker`);
  assert.equal(host.controller, A, 'still the enemy unit — a Virus goes onto anyone');
});

test('R311: a glimpsed Virus in the cache goes onto a spell on the stack', () => {
  const { h, D, spell } = kemxWindow(3701);
  glimpse(h, D, VIRUS);
  const opt = cacheVirus(h, D).find(a => a.type === 'augment' && a.hostStack === spell.id);
  assert.ok(opt, 'the cache offers the Virus onto Arc Lightning on the stack (R79)');
  const mana = h.q.openMana(D);
  h.do(opt!);
  assert.equal(h.q.openMana(D), mana - 1);
  assert.ok(h.log.some(l => l.includes(`${VIRUS} augments out of`) && l.endsWith('ignoring affinity.')));
  assert.equal(h.state.stack.length, 2, 'above its host');
  pass(h); pass(h);
  assert.deepEqual(h.state.stack.find(i => i.id === spell.id)!.augments, [{ card: VIRUS, by: D }],
    'the spell now carries it');
});

test('R311: a Virus whose prophecy is fulfilled augments in battle for FREE', () => {
  const { h, D, atk } = kemxWindow(3702);
  withE(h, e => { e.cacheCard(D, VIRUS, 'effect', { prophecy: 'One Turn Passes' }).prophecy!.fulfilled = true; });
  assert.equal(h.q.cachePermission(D, 0), 'prophecy');
  const opt = cacheVirus(h, D).find(a => a.type === 'augment' && a.hostId === atk);
  assert.ok(opt);
  const mana = h.q.openMana(D);
  h.do(opt!);
  assert.equal(h.q.openMana(D), mana, 'nothing is paid');
  assert.ok(h.log.includes(`${VIRUS} augments for FREE — its prophecy is fulfilled.`));
});

test('R311: an EXPIRED glimpse is still nothing in battle', () => {
  const { h, D, atk } = kemxWindow(3703);
  (h.state.players[D]!.cache ??= []).push({ card: VIRUS, uid: 37_030, playableUntilTurn: h.state.turn - 1 });
  assert.equal(h.q.cachePermission(D, 0), null);
  assert.deepEqual(cacheVirus(h, D), [], 'not offered');
  assert.throws(() => h.do({ type: 'augment', seat: D, from: 'cache', index: 0, hostId: atk }), /no permission/);
});

test('R311: a glimpsed Ambush card ambushes out of the cache, paying the ambush mana ignoring affinity', () => {
  const { h, D, ally } = kemxWindow(3704);
  glimpse(h, D, 'Lurking Slimebeast');              // Ambush [3 b] — D has no water
  const opt = h.legal(D).find(a => a.type === 'playCached' && a.mode === 'ambush');
  assert.ok(opt, 'the cached card offers its Ambush mode');
  const mana = h.q.openMana(D);
  h.do(opt!);
  assert.equal(h.q.openMana(D), mana - 3, 'the ambush line\'s [3] is paid');
  assert.ok(h.log.some(l => l.includes('Lurking Slimebeast ambushes out of') && l.endsWith('ignoring affinity.')));
  pick(h, { unit: ally });                           // R67: the ally to recall is chosen at cast
  const item = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(item.kind, 'ambush');
  assert.equal(item.from, 'cache', 'the item knows where the card came from');
  pass(h); pass(h);
  const units = Object.values(h.state.entities).filter(u => u.kind === 'unit' && u.controller === D && !u.absent);
  assert.ok(units.some(u => u.card === 'Lurking Slimebeast'), 'the ambusher is in play');
});
