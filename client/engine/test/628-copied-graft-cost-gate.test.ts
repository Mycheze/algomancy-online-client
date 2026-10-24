/**
 * CR 722.6a, 722.8, 710.2a / CT-352 — the unpayable-graft-cost gate covers a
 * graft a COPY copied, not only a real graft mod.
 *
 * CR 722.6a: a graft cause whose grafted cost cannot be paid is not offered.
 * The activation gate (apply.ts graftCostUnpayable) skipped every graft with
 * no mod entity behind it, and a copy's copied grafts have none (CR 710.2a:
 * no mod entity is cloned). So a copy of Omniwield Evoker carrying Darkblast
 * ("[Discard a card] ...") offered its activation with an empty hand; the
 * push-time gate then withheld the whole composite, after the activation's
 * own [three] was spent on nothing.
 *
 * Seeds 62800-62899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { giveResources, toDeployment, withE } from './util.ts';
import type { EntityId } from '../src/types.ts';

/** a copy of an Omniwield Evoker ("[three]: a +1/+1 counter") that carries a
 * grafted Darkblast ("[Discard a card] ...") */
function copiedBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let copy: EntityId = -1;
  withE(h, e => {
    const evoker = e.spawnUnit(A, 'Omniwield Evoker', e.homeRegion(A));
    e.attachMod(evoker, 'Darkblast', A, 'graft', 0);
    const body = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [1, 1] });
    e.becomeCopy(body, evoker, { from: 'test', until: 'permanent' });
    copy = body.id;
  });
  giveResources(h, A, 'metal', 3);
  return { h, A, copy };
}

test('CR 722.6a, 710.2a / CT-352: a copy whose copied grafted cost cannot be paid is not offered the activation', () => {
  const { h, A, copy } = copiedBoard(62800);
  withE(h, e => {
    assert.ok(e.graftsJoining(e.entity(copy)!).some(j => j.card === 'Darkblast' && j.part.fromMod === undefined),
      'the board: the copy carries the copied Darkblast graft, with no mod entity behind it');
  });
  h.state.players[A]!.hand = [];                              // nothing to discard
  const activations = legalActions(h.state, A).filter(a => a.type === 'activateAbility' && a.entityId === copy);
  assert.equal(activations.length, 0, 'not offered: its [three] would be spent on nothing');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: copy, abilityIndex: 0 }),
    /grafted cost cannot be paid/, 'and refused by name');
});

test('CR 722.6a, 710.2a / CT-352: with a card to discard the copy is offered its activation', () => {
  const { h, A, copy } = copiedBoard(62801);
  h.state.players[A]!.hand = ['Geode'];
  assert.ok(legalActions(h.state, A).some(a => a.type === 'activateAbility' && a.entityId === copy),
    'payable, so offered');
});
