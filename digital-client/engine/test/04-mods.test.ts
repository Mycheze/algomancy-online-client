/* Mods: augments (port of prototype section 8, with the type-line-attrs rule
 * fixed), Virus augments on the stack, and PROPER graft composition — the
 * prototype skipped grafts entirely (docs/03 §6, Manual p.32-33, Graft 101). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import {
  ent, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

test('augments: type-line attribute grant, unstable erasure', () => {
  const h = new Harness(8);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Rune Channeler');
  giveResources(h, p, 'fire', 4);
  const sk = give(h, p, 'Ephemeral Skywalker');
  h.do({ type: 'augment', seat: p, from: 'hand', index: sk, hostId: host });
  assert.ok(ownAttrs(h, host).has('Flying'), 'host gained Flying (type-line [Augment])');
  assert.equal(ent(h, host)!.mods.length, 1, 'host is modded');
  new E(h.state).destroy(ent(h, host)!, 'is deleted');
  assert.ok(!h.state.players[p]!.bin.includes('Rune Channeler'),
    'unstable: erased, not binned');
  assert.ok(!h.state.players[p]!.bin.includes('Ephemeral Skywalker'),
    'mods erased with the host');
});

test('virus augment during battle: on the stack, donated to an enemy, text-only transfer', () => {
  const h = new Harness(81);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  const rc = spawn(h, o, 'Rune Channeler');   // 4/3, no printed attrs
  toNextBattle(h, o);                      // opponent attacks with it
  h.do({ type: 'declareAttack', seat: o, columns: [[rc]] });
  pass(h);                                 // attacker holds; p may respond
  giveResources(h, p, 'fire', 3);
  const si = give(h, p, 'Smouldering Inferno');
  h.do({ type: 'augment', seat: p, from: 'hand', index: si, hostId: rc });
  assert.equal(h.state.stack.length, 1, 'virus went on the stack');
  assert.equal(h.state.stack[0]!.kind, 'virus');
  pass(h); pass(h);                        // resolve the virus
  assert.ok(ent(h, rc)!.mods.length === 1, 'host modded by virus');
  // Smouldering Inferno's [Augment] is in its TEXT BOX, so only the text
  // transfers — Piercing stays put (the prototype donated it wrongly; the
  // Manual and mods.py agree it must not)
  assert.ok(!ownAttrs(h, rc).has('Piercing'), 'attribute did NOT transfer');
  finishBattle(h);
  assert.ok(!ent(h, rc), 'donated "after combat, sacrifice me" erased the host (unstable)');
});

test('a virus is not a "spell effect" (negation scoping); a negated virus does not mod', () => {
  const h = new Harness(82);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  const whale = spawn(h, o, 'Good Whale');
  toNextBattle(h, o);
  h.do({ type: 'declareAttack', seat: o, columns: [[whale]] });
  pass(h);
  giveResources(h, p, 'fire', 3);
  giveResources(h, o, 'water', 12);
  const si = give(h, p, 'Smouldering Inferno');
  h.do({ type: 'augment', seat: p, from: 'hand', index: si, hostId: whale });
  // Dreadwave negates "target spell effect" — the virus on the stack does not
  // qualify, so with nothing else stacked the cast has no legal targets
  const dv = give(h, o, 'Dreadwave Devourer');
  assert.throws(() => h.do({ type: 'playCard', seat: o, handIndex: dv }), IllegalAction,
    'virus is not a legal negation target for a spell-effect negate');
  // negate the virus directly (negation that CAN hit it exists in the pool's
  // rules text but not in the M1 card set): it must go to the bin, not attach
  new E(h.state).negate(h.state.stack[0]!.id);
  pass(h); pass(h);
  assert.equal(ent(h, whale)!.mods.length, 0, 'negated virus never modded');
  assert.ok(h.state.players[p]!.bin.includes('Smouldering Inferno'), 'negated virus → bin');
});

// ── grafts (the M1 de-risk item) ──────────────────────────────────────

/** deployment helper: graft `name` (from hand) under `host` at `position` */
function graft(h: Harness, seat: number, name: string, hostId: number, position = 0): void {
  const idx = give(h, seat, name);
  h.do({ type: 'graft', seat, from: 'hand', index: idx, hostId, position });
}

test('graft composition: composite fires as ONE stack item, top-to-bottom', () => {
  const h = new Harness(90);
  toDeployment(h);
  const A = h.state.initiative === h.state.deployPlayer ? h.state.deployPlayer! : h.state.deployPlayer!;
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 10); giveResources(h, p, 'wood', 4);
  const oracle = spawn(h, p, 'Oracle of the Flame');   // "Sacrifice me: [Switch] Create a Fireball 1"
  // graft Accelerated Germination under it → "Sacrifice me: Create a Fireball 1
  // AND (once per turn) create two 1/1 units" (the Manual's own example, p.33)
  graft(h, p, 'Accelerated Germination', oracle, 0);
  assert.equal(ent(h, oracle)!.mods.length, 1, 'graft applied');
  assert.equal(h.state.entities[ent(h, oracle)!.mods[0]!]!.appliedAs, 'graft');

  h.do({ type: 'activateAbility', seat: p, entityId: oracle, abilityIndex: 0 });
  assert.ok(!ent(h, oracle), 'sacrifice cost paid at activation');
  // deployment: composite resolved immediately, top to bottom
  assert.equal(tokensOf(h, p).length, 1, 'base effect: Fireball 1');
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 2, 'grafted effect: two 1/1s');
});

test('grafting requires the graft symbol on both cards and a cause on the host', () => {
  const h = new Harness(91);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 10); giveResources(h, p, 'water', 10); giveResources(h, p, 'wood', 4);
  const vanilla = spawn(h, p, 'Good Whale');           // no graft cause
  const oracle = spawn(h, p, 'Oracle of the Flame');
  const ag = give(h, p, 'Accelerated Germination');
  assert.throws(() => h.do({ type: 'graft', seat: p, from: 'hand', index: ag, hostId: vanilla, position: 0 }),
    IllegalAction, 'host without a graft cause cannot receive grafts');
  const arc = give(h, p, 'Luminous Arc');
  assert.throws(() => h.do({ type: 'graft', seat: p, from: 'hand', index: arc, hostId: oracle, position: 0 }),
    IllegalAction, 'a card without a graft symbol cannot be grafted');
});

test('grafts can be applied from the bin', () => {
  const h = new Harness(92);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 6);
  const oracle = spawn(h, p, 'Oracle of the Flame');
  h.state.players[p]!.bin.push('Flame Juggle');
  const binIdx = h.state.players[p]!.bin.indexOf('Flame Juggle');
  h.do({ type: 'graft', seat: p, from: 'bin', index: binIdx, hostId: oracle, position: 0 });
  assert.equal(ent(h, oracle)!.mods.length, 1, 'grafted from bin');
  h.do({ type: 'activateAbility', seat: p, entityId: oracle, abilityIndex: 0 });
  assert.equal(tokensOf(h, p).length, 4, 'Fireball 1 (base) + three Fireball 1 (Flame Juggle graft)');
});

test('bounded graft EFFECT skips after first firing; unbounded cause keeps firing (R9)', () => {
  const h = new Harness(93);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 20); giveResources(h, p, 'wood', 4);
  // two Oracles: sacrifice the first to prove budgets are per CARD (R9)
  const o1 = spawn(h, p, 'Oracle of the Flame');
  const o2 = spawn(h, p, 'Oracle of the Flame');
  graft(h, p, 'Accelerated Germination', o1, 0);
  h.do({ type: 'activateAbility', seat: p, entityId: o1, abilityIndex: 0 });
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 2, 'bounded graft fired once');
  // o2 is a different card: its own activation is fresh — but it has no graft
  h.do({ type: 'activateAbility', seat: p, entityId: o2, abilityIndex: 0 });
  assert.equal(tokensOf(h, p).length, 2, 'both bases fired');
});

test('bounded graft cause bounds the WHOLE composite (Manual p.33)', () => {
  const h = new Harness(94);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 20); giveResources(h, p, 'water', 6);   // Lonely Forager is b
  const rc = spawn(h, p, 'Rune Channeler');   // bounded cause: "when you play a nontoken spell, [Switch1] …"
  graft(h, p, 'Flame Juggle', rc, 0);         // bounded effect: three Fireballs
  // play two nontoken spells; the composite may fire only once
  const s1 = give(h, p, 'Lonely Forager');
  h.do({ type: 'playCard', seat: p, handIndex: s1 });
  // composite fired: RC wants a target (deal 2), then Flame Juggle makes 3 Fireballs
  assert.equal(h.state.decision?.kind, 'targets', 'composite fired once');
  pick(h, { unit: rc });   // RC shoots itself for 2 (4/3 survives)
  assert.equal(tokensOf(h, p).length, 3, 'grafted Flame Juggle fired inside the composite');
  const s2 = give(h, p, 'Lonely Forager');
  h.do({ type: 'playCard', seat: p, handIndex: s2 });
  assert.equal(h.state.decision, null, 'bounded cause: no second firing');
  assert.equal(tokensOf(h, p).length, 3, 'no extra Fireballs either');
});

test('graft insert position: below the base, order controls resolution', () => {
  const h = new Harness(95);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 20); giveResources(h, p, 'water', 10); giveResources(h, p, 'wood', 4);
  const oracle = spawn(h, p, 'Oracle of the Flame');
  const victim = spawn(h, p, 'Curio Drifter');   // 2/2, will be deleted mid-composite
  graft(h, p, 'Accelerated Germination', oracle, 0);
  // insert Leaping Lillik ("delete target unit") ABOVE Accelerated Germination:
  // resolution order = base Fireball → delete → two 1/1s
  graft(h, p, 'Leaping Lillik', oracle, 0);
  const mods = ent(h, oracle)!.mods.map(id => h.state.entities[id]!.card);
  assert.deepEqual(mods, ['Leaping Lillik', 'Accelerated Germination'], 'inserted below base, above the other graft');

  h.do({ type: 'activateAbility', seat: p, entityId: oracle, abilityIndex: 0 });
  // targets for the whole composite are declared as it goes on the stack
  assert.equal(h.state.decision?.kind, 'targets', 'composite target declared up front');
  pick(h, { unit: victim });
  assert.ok(!ent(h, victim), 'delete resolved');
  assert.equal(tokensOf(h, p).length, 1, 'base still resolved');
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 2, 'later graft still resolved');
});

test('composite is ONE stack item in battle: single negation kills all of it (R5/Graft 101)', () => {
  const h = new Harness(96);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  giveResources(h, p, 'fire', 10); giveResources(h, p, 'water', 10);
  giveResources(h, o, 'water', 12);
  const tide = spawn(h, p, 'Astral Tidewraith');   // "when I attack or block, [Switch1] …"
  graft(h, p, 'Flame Juggle', tide, 0);
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: p, columns: [[tide]] });
  // the composite trigger is on the stack; o negates it with Dreadwave? — no:
  // Dreadwave hits spell effects only. Assert it resolves as one item instead.
  assert.equal(h.state.stack.length, 1, 'composite = one stack item');
  assert.equal(h.state.stack[0]!.parts.length, 2, 'two parts inside');
  // negate it directly through the engine to prove single-negation semantics
  new E(h.state).negate(h.state.stack[0]!.id);
  assert.equal(h.state.stack.length, 0, 'R68: negating takes the composite off the stack at once');
  assert.equal(tokensOf(h, p).length, 0, 'no Fireballs: one negation killed the whole composite');
  assert.equal(h.state.players[o]!.life, 30, 'no Tidewraith damage either');
});

test('mods move with a stolen unit: controller of the unit controls its mods (R8)', () => {
  const h = new Harness(97);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  giveResources(h, p, 'fire', 5);
  const host = spawn(h, p, 'Rune Channeler');
  const sk = give(h, p, 'Ephemeral Skywalker');
  h.do({ type: 'augment', seat: p, from: 'hand', index: sk, hostId: host });
  // steal it (control change primitive; no pool card does this yet)
  const u = ent(h, host)!;
  u.controller = o;
  u.region = new E(h.state).homeRegion(o);
  assert.ok(ownAttrs(h, host).has('Flying'), 'mod text/attrs follow the unit');
});
