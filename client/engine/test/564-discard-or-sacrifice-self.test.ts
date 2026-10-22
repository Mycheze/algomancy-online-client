/**
 * CR 111.2 / CT-281 — "Sacrifice a nontoken unit" names ANY nontoken unit you
 * control, the ability's own source included; only "another" leaves it out.
 *
 * Combustible Bogwalker prints "[Augment][once] Sacrifice a nontoken unit or
 * discard a card: Recall target unit in your bin." — no "another". The shared
 * either/or cost (`discardOrSacrifice`) excluded the source anyway, in the
 * payability gate and in the option list, so a Bogwalker alone with an empty
 * hand was never offered its own ability. Lilbot prints "sacrifice ANOTHER
 * nontoken unit" and keeps the exclusion, now by its own `another` flag.
 * Pallid Gorger prints no "another" either, and follows its print the same
 * way (the owner's steer: printed text beats an engine default).
 *
 * Seeds 56400-56499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ent, spawn, toDeployment, withE } from './util.ts';

function setup(seed: number, card: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  withE(h, e => {
    for (const u of e.unitsOf(A, e.homeRegion(A))) e.destroy(u, 'is deleted');
  });
  h.state.players[A]!.hand = [];
  const id = spawn(h, A, card);
  return { h, A, id };
}

const offers = (h: Harness, A: Seat, id: number) =>
  h.legal(A).filter(a => a.type === 'activateAbility' && a.entityId === id);

test('CR 111.2 / CT-281: a Combustible Bogwalker alone with an empty hand is offered itself as the sacrifice', () => {
  const { h, A, id } = setup(56400, 'Combustible Bogwalker');
  h.state.players[A]!.bin.push('Good Whale');            // a unit to recall, so the target is there
  assert.equal(offers(h, A, id).length, 1, 'the ability is offered: the Bogwalker can pay with itself');
  h.do({ type: 'activateAbility', seat: A, entityId: id, abilityIndex: 0, via: 'augment' });
  let guard = 6;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    const opt = d.options.find(o => String(o.label) === 'Sacrifice Combustible Bogwalker') ?? d.options[0]!;
    h.do({ type: 'decide', seat: d.seat, choice: d.options.indexOf(opt) });
  }
  assert.equal(ent(h, id), undefined, 'the Bogwalker sacrificed itself to pay');
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), 'and the ability resolved: the Whale is recalled');
});

test('CR 111.2 / CT-281: Lilbot prints another, so alone with an empty hand it is not offered', () => {
  const { h, A, id } = setup(56401, 'Lilbot');
  assert.equal(offers(h, A, id).length, 0, 'no other nontoken unit and no card: nothing can pay');
  spawn(h, A, 'Good Whale');
  assert.equal(offers(h, A, id).length, 1, 'another nontoken unit pays');
});

test('CR 111.2 / CT-281: Pallid Gorger prints no another, so alone with an empty hand it may sacrifice itself', () => {
  const { h, A, id } = setup(56402, 'Pallid Gorger');
  assert.equal(offers(h, A, id).length, 1, 'the ability is offered: the Gorger can pay with itself');
  h.do({ type: 'activateAbility', seat: A, entityId: id, abilityIndex: 0, via: 'augment' });
  const d = h.state.decision!;
  const i = d.options.findIndex(o => String(o.label) === 'Sacrifice Pallid Gorger');
  assert.ok(i >= 0, 'and it is the option');
  h.do({ type: 'decide', seat: d.seat, choice: i });
  assert.equal(ent(h, id), undefined, 'it sacrificed itself to pay');
});
