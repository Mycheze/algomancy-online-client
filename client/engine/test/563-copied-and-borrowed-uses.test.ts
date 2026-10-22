/**
 * CR 109.9k, 710.2d, 710.7 / CT-342 — A COPIED BOX AND A BORROWED SOURCE EACH
 * HAVE THEIR OWN USE.
 *
 * Report 269 gave a real augment mod its own [once] (543). Two places still
 * had no mod entity to hold one, and gave two copies of one bounded box a
 * single use between them:
 *
 *  · a COPY (Borrower of Forms, Apex Prime) of a unit wearing two same-name
 *    augments: CR 710.2d — "A [once] ability from a copied augment can be used
 *    once per turn on the copy, exactly as if a real mod of that card were on
 *    it". Two real mods are two uses (CR 109.9k), so two copied boxes are too.
 *    The same held for two copied same-name bounded GRAFTS ("Two copies of the
 *    same bounded graft on one host each have one use").
 *  · Ancient One borrowing a neighbour's triggered text (CR 710.7: "including
 *    the text their mods give them"): a neighbour wearing two Jollyglops gave
 *    the Ancient One one borrowed use.
 *
 * A copied box past the first of its name is addressed
 * `{ face, text: 'augment', copy: k }`; the old `{ face, text: 'augment' }`
 * keeps meaning the first, so an old action log replays unchanged.
 *
 * Seeds 56300-56399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { apply, legalActions } from '../src/apply.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

function mod(h: Harness, host: EntityId, card: string, seat: Seat, as: 'augment' | 'graft' = 'augment'): EntityId {
  let id = -1;
  withE(h, e => { id = e.attachMod(e.s.entities[host]!, card, seat, as).id; });
  return id;
}

/** `target` becomes an exact copy of `src`, mods' text and all (CR 710.2) */
function copyOnto(h: Harness, target: EntityId, src: EntityId): void {
  withE(h, e => { e.becomeCopy(e.s.entities[target]!, e.s.entities[src]!, { from: 'Borrower of Forms', until: 'permanent' }); });
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

const vias = (h: Harness, seat: Seat, id: EntityId) => h.legal(seat)
  .filter(a => a.type === 'activateAbility' && a.entityId === id)
  .map(a => (a as { via?: unknown }).via);

test('CR 710.2d / CT-342: a copy of a unit with two Debt Blep augments offers two activations, and spending one leaves the other', () => {
  const h = new Harness(56300);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Good Whale');
  mod(h, host, 'Debt Blep', A);
  mod(h, host, 'Debt Blep', A);
  const copy = spawn(h, A, 'Good Whale');
  copyOnto(h, copy, host);
  assert.deepEqual(vias(h, A, copy), [
    { face: 'Debt Blep', text: 'augment' },
    { face: 'Debt Blep', text: 'augment', copy: 1 },
  ], 'each copied box is its own activation');
  // the fuzzer's "legalActions lied" invariant, aimed at this path by hand
  for (const a of legalActions(h.state, A)) {
    assert.doesNotThrow(() => apply(h.state, a), `legalActions offered ${JSON.stringify(a)} and apply refused it`);
  }
  h.do({ type: 'activateAbility', seat: A, entityId: copy, abilityIndex: 0, via: { face: 'Debt Blep', text: 'augment', copy: 1 } });
  assert.deepEqual(vias(h, A, copy), [{ face: 'Debt Blep', text: 'augment' }],
    'the second box is spent; the first is not');
  assert.equal(ent(h, copy)!.budgets['augment:Debt Blep#0@1'], 1, 'the second box keeps its use under its own key');
  assert.equal(ent(h, copy)!.budgets['augment:Debt Blep#0'], undefined, 'and the first box is untouched');
  // the OLD address keeps meaning the first box, so an old log replays as it did
  h.do({ type: 'activateAbility', seat: A, entityId: copy, abilityIndex: 0, via: { face: 'Debt Blep', text: 'augment' } });
  assert.equal(ent(h, copy)!.budgets['augment:Debt Blep#0'], 1, 'the first box spends the key it always did');
  assert.deepEqual(vias(h, A, copy), [], 'both are spent now');
});

test('CR 710.2d / CT-342: a copy with ONE copied Debt Blep refuses a second-box address', () => {
  const h = new Harness(56301);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Good Whale');
  mod(h, host, 'Debt Blep', A);
  const copy = spawn(h, A, 'Good Whale');
  copyOnto(h, copy, host);
  assert.deepEqual(vias(h, A, copy), [{ face: 'Debt Blep', text: 'augment' }], 'one box, one activation');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: copy, abilityIndex: 0,
    via: { face: 'Debt Blep', text: 'augment', copy: 1 } }), /does not have that ability/);
});

test('CR 710.2d / CT-342: a copy of a unit with two Jollyglop augments triggers twice when it is dealt damage', () => {
  const h = new Harness(56302);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, D, 'Good Whale');
  mod(h, host, 'Jollyglop', D);
  mod(h, host, 'Jollyglop', D);
  const copy = spawn(h, D, 'Good Whale');
  copyOnto(h, copy, host);
  takeTwo(h, A, D, copy);
  assert.ok(ent(h, copy), 'the copy survived the 2 damage');
  assert.equal(unitsOf(h, D).filter(u => u.token).length, 4, 'both copied [once] boxes fired: two 1/1s each');
});

test('CR 710.2d / CT-342: a copy of a Jollyglop wearing a Jollyglop has two uses, as the real one does', () => {
  const h = new Harness(56303);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, D, 'Jollyglop');
  mod(h, host, 'Jollyglop', D);
  const copy = spawn(h, D, 'Good Whale');
  copyOnto(h, copy, host);                            // a 0/4 Jollyglop face + one copied box
  takeTwo(h, A, D, copy);
  assert.ok(ent(h, copy), 'the copy survived the 2 damage');
  assert.equal(unitsOf(h, D).filter(u => u.token).length, 4, 'its own text and the copied box each fired');
});

test('CR 109.9k / CT-342: two copied Recall grafts on a copy each have one use', () => {
  const h = new Harness(56304);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Spewing Mushroom');       // unbounded graft cause
  mod(h, host, 'Recall', A, 'graft');
  mod(h, host, 'Recall', A, 'graft');
  const copy = spawn(h, A, 'Good Whale');
  copyOnto(h, copy, host);
  let first: string[] = [], second: string[] = [];
  withE(h, e => {
    const u = e.s.entities[copy]!;
    first = (e.composeParts(u, 0, 'ability') ?? []).map(p => p.effectKey);
    second = (e.composeParts(u, 0, 'ability') ?? []).map(p => p.effectKey);
  });
  assert.deepEqual(first, ['ability:Spewing Mushroom#0', 'graft:Recall', 'graft:Recall'],
    'both copied grafts compose the first time');
  assert.deepEqual(second, ['ability:Spewing Mushroom#0'], 'and both are spent the second time');
});

test('CR 710.7 / CT-342: Ancient One next to an ally wearing two Jollyglops borrows two uses', () => {
  const h = new Harness(56305);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');
  mod(h, whale, 'Jollyglop', A);
  mod(h, whale, 'Jollyglop', A);
  const ancient = spawn(h, A, 'Ancient One');
  withE(h, e => { e.s.entities[ancient]!.counters = 3; });   // a 4/4, so it lives through the Fireball
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale, ancient]] });
  let fire = -1;
  withE(h, e => { fire = e.createSpellToken(D, 'Fireball', 2, e.s.battle!.region).id; });
  let guard = 8;
  while (h.state.priority !== D && guard-- > 0) pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: fire });
  pick(h, { unit: ancient });
  guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
  assert.equal(ent(h, ancient)!.damage, 2, 'the Fireball hit the Ancient One');
  assert.equal(unitsOf(h, A).filter(u => u.token).length, 4,
    'each borrowed Jollyglop box fired once: two 1/1s each');
  finishBattle(h);
});
