/**
 * CR 109.9k — EACH MOD HAS ITS OWN USE, for [Augment] text as well as grafts.
 *
 * Report 269 (owner, 2026-10-22): "Shouldn't BOTH of Jollyglops triggers go
 * onto the stack here? It has two of the same ability that are each "Once",
 * but I see no reason why only one should work."
 *
 * The engine kept a bounded [Augment] ability's use on the HOST, keyed by the
 * card's name (`augment:Jollyglop#0`), so the second copy of the same text on
 * one unit found the first one's use spent and never fired. Grafts already
 * kept theirs on the mod (94-bounded-uses). A mod-donated [Augment] use now
 * lives on its mod entity too; the unit's own [Augment] text keeps its use on
 * the unit, so a Jollyglop wearing a Jollyglop has two.
 *
 * Seeds 54300-54399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, pass, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

function mod(h: Harness, host: EntityId, card: string, seat: Seat): EntityId {
  let id = -1;
  withE(h, e => { id = e.attachMod(e.s.entities[host]!, card, seat, 'augment').id; });
  return id;
}

/** two 1/1s attack, `blocker` blocks both and is dealt 2 */
function takeTwo(h: Harness, A: Seat, D: Seat, blocker: EntityId): void {
  const t1 = spawn(h, A, 'Unit Token');
  const t2 = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[t1, t2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  finishBattle(h);
}

test('CR 109.9k: a Jollyglop augmented with a Jollyglop triggers twice when it is dealt damage (report 269)', () => {
  const h = new Harness(54300);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const jolly = spawn(h, D, 'Jollyglop');             // 0/4, its own [Augment][once]
  mod(h, jolly, 'Jollyglop', D);                      // and a second copy of the text
  takeTwo(h, A, D, jolly);
  assert.ok(ent(h, jolly), 'it survived the 2 damage');
  assert.equal(unitsOf(h, D).filter(u => u.token).length, 4,
    'both [once] abilities fired: two 1/1s each');
});

test('CR 109.9k: two Jollyglop augments on one host each fire once', () => {
  const h = new Harness(54301);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const host = spawn(h, D, 'Jollyglop');
  const m1 = mod(h, host, 'Jollyglop', D);
  const m2 = mod(h, host, 'Jollyglop', D);
  takeTwo(h, A, D, host);
  assert.equal(unitsOf(h, D).filter(u => u.token).length, 6, 'three copies of the text, three triggers');
  assert.equal(ent(h, m1)!.budgets['augment:Jollyglop#0'], 1, 'the first mod spent its own use');
  assert.equal(ent(h, m2)!.budgets['augment:Jollyglop#0'], 1, 'and so did the second');
  assert.equal(ent(h, host)!.budgets['augment:Jollyglop#0'], 1, 'and the unit spent its own');
});

test('CR 109.9k: two Debt Blep augments offer two activations, and spending one leaves the other', () => {
  const h = new Harness(54302);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Good Whale');
  const m1 = mod(h, host, 'Debt Blep', A);
  const m2 = mod(h, host, 'Debt Blep', A);
  const vias = () => h.legal(A)
    .filter(a => a.type === 'activateAbility' && a.entityId === host)
    .map(a => (a as { via?: unknown }).via);
  assert.deepEqual(vias(), [{ mod: m1 }, { mod: m2 }], 'each mod offers its own [once]');
  h.do({ type: 'activateAbility', seat: A, entityId: host, abilityIndex: 0, via: { mod: m1 } });
  assert.deepEqual(vias(), [{ mod: m2 }], 'the first is spent; the second is not');
  assert.equal(ent(h, host)!.budgets['augment:Debt Blep#0'], undefined,
    'a mod\'s use is not kept on the host');
});
