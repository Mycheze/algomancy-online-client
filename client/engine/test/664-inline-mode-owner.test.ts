/**
 * CR 102.4, 102.5a / CT-367 — A CARD PLAYED MID-RESOLUTION IN A MODE KEEPS ITS OWNER.
 *
 * `playInline` carries `opts.owner` onto the item of a plain play (CT-245,
 * CT-344), but its mode branch, `playInlineMode` (a Virus, an Ambush or a
 * Prophecy played by Tides of the Cosmos), built its stack items and its cache
 * entry with no owner at all. Unreachable from a card today — Tides plays off
 * the deck, a shared zone whose taker owns the card — so this drives the
 * branch directly, the way 556 drives the in-place branch. 623 holds every
 * stack item a card file builds to the same rule by sweep.
 *
 * Seeds: 66400-66449.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { inlineModes, playInline } from '../src/cards/sets/batch-water-a.ts';
import { spawn, toDeployment, toNextBattle, withE } from './util.ts';

const rig = (seat: Seat, region: number) => ({
  controller: seat, sourceName: 'CT-367 rig', region, targets: [], event: null,
  choose: (_k: string, d: { options: { value: unknown }[] }) => d.options[0]!.value,
}) as never;

/** a battle window in A region, A attacking with a vanilla unit and holding priority */
function battle(seed: number): { h: Harness; A: Seat; D: Seat; region: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  return { h, A, D, region: h.state.battle!.region };
}

const first = (pred: (n: string) => boolean): string => {
  const n = allCardNames().find(pred);
  assert.ok(n, 'the pool has a card for this fixture');
  return n!;
};

test('CR 102.4 / CT-367: a Virus played in a mode by an effect carries the owner of the card', () => {
  const { h, A, D, region } = battle(66401);
  const virus = first(n => getCard(n).virus === true && getCard(n).kind === 'unit');
  withE(h, e => {
    assert.ok(inlineModes(e, virus, region, A).includes('virus'), 'fixture: the Virus mode is offered');
    playInline(e, rig(A, region), virus, 'ct367v', A, { from: 'bin', owner: D, mode: 'virus' });
  });
  const it = h.state.stack.at(-1)!;
  assert.equal(it.kind, 'virus');
  assert.equal(it.owner, D, 'the Virus item is still D card (it carried no owner)');
});

test('CR 102.4 / CT-367: an Ambush played in a mode by an effect carries the owner of the card', () => {
  const { h, A, D, region } = battle(66402);
  const amb = first(n => !!getCard(n).ambush);
  withE(h, e => {
    assert.ok(inlineModes(e, amb, region, A).includes('ambush'), 'fixture: the Ambush mode is offered');
    playInline(e, rig(A, region), amb, 'ct367a', A, { from: 'bin', owner: D, mode: 'ambush' });
  });
  const it = h.state.stack.at(-1)!;
  assert.equal(it.kind, 'ambush');
  assert.equal(it.owner, D);
});

test('CR 102.4 / CT-367: a card prophesied in a mode by an effect is cached with the owner of the card', () => {
  const { h, A, D, region } = battle(66403);
  const pro = first(n => !!getCard(n).prophecy);
  withE(h, e => { playInline(e, rig(A, region), pro, 'ct367p', A, { from: 'bin', owner: D, mode: 'prophecy' }); });
  const cc = new E(h.state).cache(A).find(c => c.card === pro);
  assert.ok(cc, 'it is cached');
  assert.equal(cc!.owner, D);
});

test('CR 102.4 / CT-367: a mode play of the player own card carries no owner field', () => {
  const { h, A, region } = battle(66404);
  const virus = first(n => getCard(n).virus === true && getCard(n).kind === 'unit');
  withE(h, e => { playInline(e, rig(A, region), virus, 'ct367s', A, { from: 'deck', owner: A, mode: 'virus' }); });
  assert.equal('owner' in h.state.stack.at(-1)!, false, 'the field is absent when the player owns it, as on every other item');
});
