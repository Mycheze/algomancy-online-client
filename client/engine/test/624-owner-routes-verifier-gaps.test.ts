/**
 * CR 102.4 / CT-343, CT-344 — THE OWNER ROUTES 622 AND 623 LEFT UNGUARDED.
 *
 * The round's verifier reverted the 622/623 fixes one hunk at a time. These
 * hunks stayed green, so nothing proved them:
 *  · a spell token's riding augments: who APPLIED each one (`by`, whose erased
 *    pile it lands in, CR 723.4b) and whose card it is (`owner`);
 *  · the bin-to-play exchange (Necromorph, through `E.exchangeInPlace`);
 *  · Uglk's "from their bin into play under an opponent's control";
 *  · the agreed fix (`doAmend`, `amendFrozen`): a move between a player's own
 *    hand, bin and cache, and a unit taken off the board.
 * Each test puts a foreign-owned card through one route and reads its owner
 * on the other side.
 *
 * Seeds: 62400-62499.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { amendFrozen, apply } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { EffectCtx } from '../src/cards/dsl.ts';
import type { Action, AmendEdit, EntityId, GameState, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf, withE } from './util.ts';

const amend = (seat: Seat, edit: AmendEdit): Extract<Action, { type: 'amend' }> =>
  ({ type: 'amend', seat, by: (1 - seat) as Seat, edit });

const ownerIn = (s: GameState, seat: Seat, zone: 'hand' | 'bin', card: string): Seat => {
  const at = s.players[seat]![zone].lastIndexOf(card);
  assert.ok(at >= 0, `${card} is in the ${zone}`);
  return new E(s).zoneOwner(seat, zone, at);
};

/** a deployment board where A holds `card` in hand as a card D owns */
function foreignInHand(seed: number, card: string): { h: Harness; A: Seat; D: Seat; at: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const at = give(h, A, card);
  h.state.players[A]!.foreign = [{ zone: 'hand', at, card, owner: D }];
  return { h, A, D, at };
}

// ── (a) a spell token's riding augments ─────────────────────────────────

test('CR 102.4 / CT-343: a foreign-owned augment riding a spell token is filed as applied by its applier, and the erase goes to that pile', () => {
  const { h, A, D, at } = foreignInHand(62401, 'Chitin Shredder');
  giveResources(h, A, 'earth', 4);
  new E(h.state).createSpellToken(A, 'Fireball', 3, new E(h.state).homeRegion(A));
  const tok = tokensOf(h, A).find(t => t.card === 'Fireball')!.id;
  h.do({ type: 'augment', seat: A, from: 'hand', index: at, hostId: tok });
  const victim = spawn(h, D, 'The Foretold');
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]], spellTokens: [tok] });
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: victim });
  const item = h.state.stack.find(i => i.kind === 'spellToken');
  assert.deepEqual(item?.augments, [{ card: 'Chitin Shredder', by: A, owner: D }],
    'by = the player who applied it (A), owner = whose card it is (D)');
  pass(h); pass(h);
  assert.ok((h.state.players[A]!.erased ?? []).includes('Chitin Shredder'),
    'CR 723.4b: erased with the token into the pile of its APPLIER');
  assert.ok(!(h.state.players[D]!.erased ?? []).includes('Chitin Shredder'), 'not into the card owner pile');
  finishBattle(h);
});

// ── (b) the exchange from a bin ─────────────────────────────────────────

test('CR 102.4 / CT-344: Necromorph exchanges a unit for a foreign-owned card in that bin, which arrives still owned by its owner', () => {
  const h = new Harness(62402);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Grox');
  const victim = spawn(h, D, 'Good Whale');                  // cost 6
  const bin = h.state.players[D]!.bin;
  bin.push('Blightwalker');                                  // cost 3: an A card, sitting in D's bin
  h.state.players[D]!.foreign = [{ zone: 'bin', at: bin.length - 1, card: 'Blightwalker', owner: A }];
  giveResources(h, A, 'dark', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Necromorph') });
  pick(h, { unit: victim });
  pick(h, { bin: { seat: D, card: 'Blightwalker' } });
  pass(h); pass(h);
  for (let guard = 8; h.state.stack.length && guard > 0; guard--) pass(h);
  const u = unitsOf(h, D).find(x => x.card === 'Blightwalker');
  assert.ok(u, 'the replacement arrived under the bin seat (D)');
  assert.equal(u!.owner, A, 'and is still the card of its owner (A); it used to become D card');
  finishBattle(h);
});

// ── (c) Uglk ────────────────────────────────────────────────────────────

test('CR 102.4 / CT-344: Uglk puts a foreign-owned card from a bin into play still owned by its owner', () => {
  const h = new Harness(62403);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  withE(h, g => {
    const region = g.homeRegion(A);
    g.s.regions[region]!.presentSeats = [A, D];
    g.player(A).bin.length = 0; delete g.player(A).foreign;
    g.player(D).bin.length = 0; delete g.player(D).foreign;
    g.player(A).bin.push('Tidal Menace');                   // a D card in A's bin
    g.player(A).foreign = [{ zone: 'bin', at: 0, card: 'Tidal Menace', owner: D }];
    getCard('Uglk').augmentText![0]!.effect.run(g, {
      controller: A, sourceName: 'Uglk', region, targets: [], event: null,
      eraseSelf: () => {}, choose: (_k: string, d: { options: { value: unknown }[] }) => d.options[0]!.value,
    } as unknown as EffectCtx);
  });
  const u = Object.values(h.state.entities).find(e => e.card === 'Tidal Menace' && e.kind === 'unit');
  assert.ok(u, 'it came out of A bin into play');
  assert.equal(u!.controller, D, 'under the opponent control');
  assert.equal(u!.owner, D, 'and owned by D, whose card it was in A bin (it used to be A)');
});

// ── (d) the agreed fix ──────────────────────────────────────────────────

test('CR 102.4 / CT-344: an agreed-fix move keeps a foreign card owner from hand to bin to cache to hand', () => {
  const { h, A, D, at } = foreignInHand(62404, 'Just a Unit');
  let s = apply(h.state, amend(A, { kind: 'move', from: 'hand', index: at, card: 'Just a Unit', to: 'bin' })).state;
  assert.equal(ownerIn(s, A, 'bin', 'Just a Unit'), D, 'hand to bin');
  s = apply(s, amend(A, { kind: 'move', from: 'bin', index: s.players[A]!.bin.length - 1, card: 'Just a Unit', to: 'cache' })).state;
  assert.equal(s.players[A]!.cache!.at(-1)!.owner, D, 'bin to cache');
  s = apply(s, amend(A, { kind: 'move', from: 'cache', index: s.players[A]!.cache!.length - 1, card: 'Just a Unit', to: 'hand' })).state;
  assert.equal(ownerIn(s, A, 'hand', 'Just a Unit'), D, 'cache to hand');
});

test('CR 102.4 / CT-344: an agreed fix that takes a stolen unit off the board keeps its owner in the controller hand or bin', () => {
  for (const to of ['hand', 'bin'] as const) {
    const h = new Harness(62405);
    toDeployment(h);
    const A = h.state.deployPlayer!, D = (1 - A) as Seat;
    const id = spawn(h, D, 'Just a Unit');
    withE(h, g => { g.giveControl(g.entity(id as EntityId)!, A); });
    const s = apply(h.state, amend(A, { kind: 'unit', id, card: 'Just a Unit', to })).state;
    assert.equal(ent({ state: s } as Harness, id), undefined, `${to}: off the board`);
    assert.equal(ownerIn(s, A, to, 'Just a Unit'), D, `${to}: in the controller (A) ${to}, still D card`);
  }
});

test('CR 102.4 / CT-344: amendFrozen carries a foreign card owner through a move and a unit removal on the frozen board', () => {
  const { h, A, D } = foreignInHand(62406, 'Just a Unit');
  const id = spawn(h, D, 'Shard Sprite');
  withE(h, g => { g.giveControl(g.entity(id as EntityId)!, A); });
  const frozen = structuredClone(h.state);
  let out = amendFrozen(frozen, amend(A, { kind: 'move', from: 'hand', index: 0, card: 'Just a Unit', to: 'bin' }), h.state);
  assert.equal(ownerIn(out, A, 'bin', 'Just a Unit'), D, 'the move keeps the owner');
  out = amendFrozen(frozen, amend(A, { kind: 'unit', id, card: 'Shard Sprite', to: 'hand' }), h.state);
  assert.equal(ownerIn(out, A, 'hand', 'Shard Sprite'), D, 'the unit removal keeps the owner');
});
