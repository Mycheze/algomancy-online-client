/**
 * R328 / R329 — stripping is a layer applied in timestamp order, and
 * Suppression Field takes the attributes of the target's whole column.
 *
 * The RAQ is the authority (owner, 2026-10-09). calebgannon: "Suppression field
 * just removes attributes from the time it was played, so anything after that
 * will still apply." _passer: "if any unit in play later gains Attribute or
 * Ability, then timestamps takes precedence and this new Attribute/Ability is
 * NOT affected by Monke or Transmogrifant". This reverses R62's veto.
 *
 * The RAQ examples themselves are guarded in 393/390; this file pins the
 * ORDER both ways (a grant before a stripper is taken, after it is kept) for
 * every grant channel, the column half, and what an old state reads as.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import { ent, finishBattle, give, giveResources, ownAttrs, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { Seat } from '../src/types.ts';

const drain = (h: Harness): void => { while (h.state.stack.length || h.state.decision) {
  if (h.state.decision) throw new Error(`unexpected decision: ${h.state.decision.prompt}`);
  h.do({ type: 'passPriority', seat: h.state.priority! });
} };

test('§1 a static stripper takes a mod attached BEFORE it arrived, and leaves one attached after', () => {
  const h = new Harness(40201);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const early = spawn(h, A, 'Bubb');
  const late = spawn(h, A, 'Bubb');
  giveResources(h, A, 'earth', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: early });
  drain(h);
  assert.ok(ownAttrs(h, early).has('Powerful'), 'setup: the first virus works before Transmogrifant');
  spawn(h, A, 'Transmogrifant');                              // "Your other units … lose all attributes"
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: late });
  drain(h);
  assert.ok(!ownAttrs(h, early).has('Powerful'), 'the virus attached BEFORE Transmogrifant is taken');
  assert.ok(ownAttrs(h, late).has('Powerful'), 'the virus attached AFTER it is not');
  assert.ok(!ownAttrs(h, late).has('Unaware'), 'and Bubb\'s own printed Unaware is taken either way');
});

test('§2 Suppression Field: the column loses its attributes, but only the target loses its abilities', () => {
  const h = new Harness(40202);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb'), crab = spawn(h, A, 'Bumblecrab');
  giveResources(h, D, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb, crab]] });
  while (h.state.priority !== D) h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Suppression Field') });
  h.do({ type: 'decide', seat: D, choice: h.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: bubb })) });
  drain(h);
  assert.equal(ent(h, crab)!.suppressed?.attrs, 'Suppression Field', 'the column-mate is stripped of attributes');
  assert.equal(ent(h, crab)!.suppressed?.abilities, undefined, 'and keeps its abilities');
  assert.equal(ent(h, bubb)!.suppressed?.abilities, 'Suppression Field', 'the target loses both');
  assert.ok(!ownAttrs(h, crab).has('Piercing'), 'the Crab has no Piercing');
  finishBattle(h);
});

test('§3 a temporary attribute granted before a strip is taken, and one granted after is kept', () => {
  const h = new Harness(40203);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Unit Token');
  withE(h, e => {
    const x = e.s.entities[u]!;
    e.addTempAttr(x, 'Flying');
    e.suppress(x, 'Suppression Field', { attrs: true });
    e.addTempAttr(x, 'Piercing');
  });
  assert.ok(!ownAttrs(h, u).has('Flying'), 'the grant before the strip is taken');
  assert.ok(ownAttrs(h, u).has('Piercing'), 'the grant after it is kept');
});

test('§4 an ability on a mod attached after the strip is not switched off; the unit printed text is', () => {
  const h = new Harness(40204);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Unit Token');
  withE(h, e => e.suppress(e.s.entities[u]!, 'Suppression Field', { abilities: true }));
  giveResources(h, A, 'earth', 2);                            // Graxxlid ee/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Graxxlid'), hostId: u });
  drain(h);
  const modId = ent(h, u)!.mods.find(m => ent(h, m)!.card === 'Graxxlid');
  assert.ok(modId !== undefined, 'setup: Graxxlid is on the token');
  const ab = getCard('Graxxlid').augmentText![0]!;
  withE(h, e => {
    const x = e.s.entities[u]!;
    assert.ok(!e.abilityIsSuppressed(x, ab, E.entityStamp(modId!)), 'the later mod text is live');
    assert.ok(e.abilityIsSuppressed(x, ab, E.PRINTED), 'printed text is the oldest, and stripped');
  });
});

test('§5 a stripped unit that joins a Balanced column later is Balanced, and gives the column nothing it lost', () => {
  const h = new Harness(40205);
  toDeployment(h);
  const A = h.state.initiative;
  const bubb = spawn(h, A, 'Bubb'), child = spawn(h, A, 'Child of Aether');
  withE(h, e => e.suppress(e.s.entities[bubb]!, 'Suppression Field', { attrs: true }));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[child, bubb]] });
  withE(h, e => {
    const eff = e.effAttrs(e.s.entities[bubb]!);
    assert.ok(eff.has('Balanced'), 'Bubb has the column\'s Balanced');
    assert.ok(!eff.has('Unaware'), 'the column is not Unaware: Bubb lost it');
  });
  finishBattle(h);
});

test('§6 a strip with no time on it (a state saved before R328) still takes everything, as the old veto did', () => {
  const h = new Harness(40206);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Unit Token');
  withE(h, e => {
    const x = e.s.entities[u]!;
    x.suppressed = { attrs: 'Suppression Field' };          // no attrsAt
    e.addTempAttr(x, 'Piercing');
  });
  assert.ok(!ownAttrs(h, u).has('Piercing'), 'an untimed strip reads as the latest thing on the unit');
});

test('§7 stamping takes no entity id, so a saved game keeps its numbering', () => {
  const h = new Harness(40207);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Unit Token');
  const before = h.state.nextId;
  withE(h, e => {
    const x = e.s.entities[u]!;
    e.addTempAttr(x, 'Flying');
    e.suppress(x, 'Suppression Field', { attrs: true, abilities: true });
  });
  assert.equal(h.state.nextId, before, 'nextId did not move');
  assert.ok((h.state.layerTick ?? 0) >= 2, 'the minor clock did');
});

test('§8 a trigger on a mod attached after the strip still fires; one attached before it does not', () => {
  // Flourishing Flora: "[Augment] Whenever another ally spawns, put a +1/+1 counter on me."
  const run = (stripFirst: boolean): number => {
    const h = new Harness(40208);
    toDeployment(h);
    const A = h.state.deployPlayer!;
    const u = spawn(h, A, 'Unit Token');
    const strip = (): void => withE(h, e => e.suppress(e.s.entities[u]!, 'Suppression Field', { abilities: true }));
    if (stripFirst) strip();
    giveResources(h, A, 'wood', 1);                           // Flourishing Flora g/1
    h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Flourishing Flora'), hostId: u });
    drain(h);
    if (!stripFirst) strip();
    const before = ent(h, u)!.counters;
    spawn(h, A, 'Unit Token');                                // another ally spawns
    drain(h);
    return ent(h, u)!.counters - before;
  };
  assert.equal(run(true), 1, 'stripped first, then Flora attached: the later text listens');
  assert.equal(run(false), 0, 'Flora attached first, then stripped: its text is taken');
});
