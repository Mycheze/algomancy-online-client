/* CT-227 — Oorblak's redirect is an interaction between the column and Oorblak.
 *
 * CR 802.11e: "A Pure Vulnerable unit, and a Vulnerable unit in an interaction
 * with a Pure card, is not dealt double damage." CR 802.25i: "A Pure recipient
 * is dealt plain damage by any source: the source's attributes do not apply to
 * it". The redirect hook read the attacking COLUMN's purity only, so a Pure
 * Vulnerable Oorblak under a plain column was dealt the hit doubled, and a
 * Pure Oorblak still saw the column's {Deadly}.
 *
 * Oorblak is a printed 2/4; its Pure and Vulnerable come by temp grant here,
 * the way a mod would give them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
function grant(h: Harness, id: EntityId, attr: Attr): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
}

/** one unblocked p-power column, granted `atkAttrs`, into D who has an Oorblak granted `oAttrs` */
function redirect(seed: number, p: number, atkAttrs: Attr[], oAttrs: Attr[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, p, 9);
  const oor = spawn(h, D, 'Oorblak');
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  for (const a of atkAttrs) grant(h, atk, a);
  for (const a of oAttrs) grant(h, oor, a);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let i = 0; i < 20 && h.state.battle && !h.log.some(l => l.includes('Oorblak takes')); i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  return { h, oor, lost: life - h.state.players[D]!.life };
}

test('CR 802.11e / CT-227: a Pure Vulnerable Oorblak under a plain column is dealt the redirected hit once, not doubled', () => {
  const { h, oor, lost } = redirect(55301, 3, [], ['Pure', 'Vulnerable']);
  assert.ok(h.log.some(l => l.includes('Oorblak takes 3')), 'the 3 redirected is dealt as 3');
  assert.ok(ent(h, oor), 'a 2/4 dealt 3 survives');
  assert.equal(ent(h, oor)!.damage, 3);
  assert.equal(lost, 0, 'the whole hit was redirected');
});

test('CR 802.11e / CT-227 PREMISE: without Pure the same Vulnerable Oorblak is dealt it doubled and dies', () => {
  const { h, oor } = redirect(55302, 3, [], ['Vulnerable']);
  assert.ok(h.log.some(l => l.includes('Oorblak takes 6')), 'Vulnerable doubles the 3 to 6');
  assert.ok(!ent(h, oor), 'a 2/4 dealt 6 dies');
});

test('CR 802.25i / CT-227: a Pure Oorblak ignores the redirected columns Deadly, so 2 damage does not kill it', () => {
  const { h, oor } = redirect(55303, 2, ['Deadly'], ['Pure']);
  assert.ok(ent(h, oor), 'the column attributes do not apply to a Pure recipient');
  assert.equal(ent(h, oor)!.damage, 2);
});
