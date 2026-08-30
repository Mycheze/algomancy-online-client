/* Round 17, the contended core.
 *
 * R86 — a composite that has lost ALL of its declared targets fizzles WHOLE,
 *   untargeted parts included (playtest report #71, game GETD, 2026-08-22).
 * R87 — a counterattacker may bring spell tokens, and `declareBlocks` says so
 *   in the same words `declareAttack` does (playtest report #67, GETD).
 * R89 — R79's missing half: a SPELL TOKEN may be augmented during DEPLOYMENT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { Action, EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, handIdx, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf,
} from './util.ts';

// ── R86 — losing every target kills the untargeted riders too ──────────

/** The GETD composite, rebuilt from its own cards: a Spewing Mushroom whose
 * attack trigger is a graft cause, carrying one UNTARGETED graft (Biotoxicity,
 * "create three Poison 1") and one TARGETED graft (Technological Superiority,
 * "duplicate each counter on target unit"). Returns the board mid-battle with
 * the trigger on the stack, its one target declared. */
function graftComposite(seed: number): { h: Harness; A: Seat; D: Seat; mush: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const mush = spawn(h, A, 'Spewing Mushroom');
  giveResources(h, A, 'wood', 8);
  giveResources(h, A, 'metal', 8);
  giveResources(h, D, 'water', 12);
  give(h, A, 'Biotoxicity');
  h.do({ type: 'graft', seat: A, from: 'hand', index: handIdx(h, A, 'Biotoxicity'), hostId: mush, position: 0 });
  give(h, A, 'Technological Superiority');
  h.do({
    type: 'graft', seat: A, from: 'hand',
    index: handIdx(h, A, 'Technological Superiority'), hostId: mush, position: 0,
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mush]] });
  // the attack trigger is a THREE-part composite: the printed "create a Poison
  // X" (untargeted), Biotoxicity's three Poisons (untargeted), and
  // Technological Superiority's "target unit" — which is the only target the
  // whole item declares, and it declares it now, at cast (R64).
  assert.equal(h.state.decision?.kind, 'targets', 'the targeted graft asks for its target at cast');
  pick(h, { unit: mush });
  assert.equal(h.state.stack.length, 1, 'the composite trigger is on the stack');
  return { h, A, D, mush };
}

test('R86: a graft composite that loses its ONLY target fizzles whole — no Poison from the untargeted grafts', () => {
  const { h, A, D, mush } = graftComposite(7101);
  // D deletes the Mushroom out from under its own trigger. The trigger now
  // holds exactly one declared target and that target is gone. (Pushing the
  // trigger handed priority straight to D — R57 — so D may answer it now.)
  const li = give(h, D, 'Leaping Lillik');
  h.do({ type: 'playCard', seat: D, handIndex: li });
  pick(h, { unit: mush });
  pass(h); pass(h);
  assert.ok(!ent(h, mush), 'the Mushroom is gone — the composite has lost every target it declared');
  assert.equal(h.state.stack.length, 1, 'the composite is still on the stack, about to resolve');

  pass(h); pass(h);
  // Caleb, RAQ "[Solved] When does effect fizzles?": "If effect loses ALL of
  // its targets and wants to resolve" — and the worked example spells out that
  // the untargeted grafts go with it, "yielding no card draw from 2nd and 3rd
  // graft". Biotoxicity's three Poisons are that card draw.
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Poison').length, 0,
    'the untargeted Biotoxicity graft made NO Poison: the whole composite fizzled');
  assert.ok(h.log.some(l => /fizzles — all targets are gone/.test(l)),
    'and it said so, once, as a fizzle rather than as a resolution');
});

test('R86: one surviving target carries the untargeted grafts through', () => {
  const { h, A, D, mush } = graftComposite(7102);
  // The mirror image: nothing dies, so nothing is lost, so everything happens.
  // "currently at least 1 target must remain for whole effect to be carried
  // out" — the same thread, the other direction.
  void D;
  pass(h); pass(h);
  assert.ok(ent(h, mush), 'the Mushroom is alive');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Poison').length, 4,
    'three Poisons from Biotoxicity plus the printed Poison X: the composite resolved in full');
});

test('R86: an item that declares NO target anywhere never fizzles', () => {
  // The other half of the rule, and the reason it is asked of the ITEM rather
  // than part by part: Ignis Sprite's spawn trigger is untargeted, so it has
  // nothing to lose and must not be dragged into a fizzle by the new gate.
  const h = new Harness(7103);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Ignis Sprite');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Fireball').length, 1,
    'the untargeted spawn trigger resolved');
  assert.ok(!h.log.some(l => /fizzles — all targets are gone/.test(l)),
    'and nothing fizzled');
});

test('R86: a required target with no legal candidate at cast still fizzles', () => {
  // The regression this rule could have caused and did not. A Poison token
  // cast into a region with nothing to aim at declares NO target — but its
  // spec REQUIRES one (min 1), so the item is targeted, has no live part, and
  // fizzles exactly as it did before R86. Found by replaying GETD: an earlier
  // draft made these three tokens print "Resolving Poison 1:" and do nothing.
  const h = new Harness(7104);
  toDeployment(h);
  const A = h.state.initiative;
  const e = new E(h.state);
  e.resolveItem({
    id: 9001, kind: 'spellToken', card: 'Poison', label: 'Poison 1', controller: A,
    region: e.homeRegion(A), negated: false,
    parts: [{ effectKey: 'spell:Poison', targets: [] }],
  });
  const said = e.events.map(ev => ev.msg);
  assert.ok(said.some(m => /fizzles — all targets are gone/.test(m)),
    'a required target it never had is still a fizzle, not a silent "Resolving …"');
  assert.ok(!said.some(m => /^Resolving Poison 1/.test(m)),
    'and it never printed a resolution heading it could not honour');
});

// ── R87 — a counterattacker may bring spell tokens ─────────────────────

/** Round 1 of a battle, stopped at the block step: A is attacking with one
 * vanilla unit, D has a unit that is free to counterattack and a Poison 1
 * standing beside it in the contested region. */
function counterattackWithToken(seed: number): {
  h: Harness; A: Seat; D: Seat; atk: EntityId; ctr: EntityId; tok: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const ctr = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const b = h.state.battle!;
  // the token is created where the defender stands, which is where the
  // counterattack leaves from — Caleb 2025-04-21: "you can only play spell
  // tokens in the region they are in (or you can bring them into enemy regions
  // during an attack, if they were created in your own region)".
  new E(h.state).createSpellToken(D, 'Poison', 1, b.region);
  const tok = tokensOf(h, D).find(t => t.card === 'Poison')!.id;
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'stopped at the block step');
  return { h, A, D, atk, ctr, tok };
}

test('R87: declareBlocks takes spellTokens, and they ride out with the counterattackers', () => {
  const { h, A, D, ctr, tok } = counterattackWithToken(6701);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr], spellTokens: [tok] });
  assert.ok(ent(h, tok)!.absent, 'the token left with the counterattack and "does not exist" until round 2');
  assert.deepEqual(h.state.battle!.sentAttackers, [ctr, tok],
    'unit and token are one movement — tecera 2025-12-23: "those units + some/all spell tokens"');
  // round 1 finishes; the sent pair arrives in the initiative player's region
  pass(h); pass(h);
  while (h.state.phase === 'battle' && h.state.battle!.round === 1) pass(h);
  const b2 = h.state.battle!;
  assert.equal(b2.round, 2, 'the counterattack battle');
  const t = ent(h, tok)!;
  assert.ok(!t.absent, 'the token is back on the board');
  assert.equal(t.region, new E(h.state).homeRegion(A), 'and it travelled into the region under attack');
  assert.ok(b2.attackerPool!.includes(tok), 'it is in the pool the round-2 declaration draws from');
  // and it can be declared along with the counterattack, exactly as an
  // attacker's riding tokens are
  h.do({ type: 'declareAttack', seat: D, columns: [[ctr]], spellTokens: [tok] });
  assert.equal(ent(h, tok)!.region, b2.region, 'the token is in the contested region, castable there');
});

test('R87: legalActions offers the counterattack-with-token shape', () => {
  const { h, D, ctr, tok } = counterattackWithToken(6702);
  // The whole of report #67: the engine accepted this shape and nothing ever
  // said so, so the client could not build it and the tokens stayed home.
  const offers = legalActions(h.state, D).filter(
    (a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
  const withToken = offers.filter(a => a.spellTokens?.length);
  assert.ok(withToken.length, 'the block step offers at least one declaration that brings a token');
  assert.ok(withToken.every(a => a.send?.length),
    'and never a token on its own — "they always need a unit to take them with them"');
  assert.ok(withToken.some(a => a.send!.includes(ctr) && a.spellTokens!.includes(tok)),
    'the free unit and the Poison beside it are offered together');
});

test('R87: spell tokens still travel only with units, and only from the region they stand in', () => {
  const { h, D, tok } = counterattackWithToken(6703);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {}, spellTokens: [tok] }),
    /spell tokens travel only with units/,
    '_passer 2025-05-10: "In order to attack opponent Region, you must send atleast 1 of your unit"');
});

test('R87: a token named in the old `send` field still counterattacks — saved games replay', () => {
  // Backwards compatibility is not decoration here: `send` has always accepted
  // a spell token mixed in with the units, and apply() must keep taking that
  // shape or every game in server/games/ that used it stops replaying.
  const { h, D, ctr, tok } = counterattackWithToken(6704);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr, tok] });
  assert.deepEqual(h.state.battle!.sentAttackers, [ctr, tok], 'the old shape means the new thing');
});

// ── R89 — augmenting a SPELL TOKEN during deployment (R79's missing half) ──

/** Deployment, seat A holding a Fireball 3 in their home region and a Chitin
 * Shredder ("[Augment] {Powerful} Insect {Virus} Unit", no rules text at all)
 * they can afford to put on it. */
function tokenInDeployment(seed: number, augment = 'Chitin Shredder'): {
  h: Harness; A: Seat; D: Seat; tok: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  giveResources(h, A, 'earth', 8);
  giveResources(h, A, 'dark', 8);
  new E(h.state).createSpellToken(A, 'Fireball', 3, new E(h.state).homeRegion(A));
  const tok = tokensOf(h, A).find(t => t.card === 'Fireball')!.id;
  give(h, A, augment);
  return { h, A, D, tok };
}

test('R89: a spell token is a legal augment host during deployment, and legalActions says so', () => {
  const { h, A, tok } = tokenInDeployment(7901);
  // Caleb 2025-03-06: "You can augment spells during deployment but currently
  // that would only be possible with spell tokens." R79 listed this as
  // "⚠ Not in scope" because doAugment demanded `kind === 'unit'`.
  const idx = handIdx(h, A, 'Chitin Shredder');
  const offers = legalActions(h.state, A).filter(
    (a): a is Extract<Action, { type: 'augment' }> => a.type === 'augment' && a.index === idx);
  assert.ok(offers.some(a => a.hostId === tok),
    'the Fireball is offered as a host — otherwise the rule is invisible, exactly as hostStack was');
  h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: tok });
  assert.equal(ent(h, tok)!.mods.length, 1, 'the augment is attached to the token');
});

test('R89: only ATTRIBUTES transfer — the augmented token deals {Powerful} damage when cast', () => {
  const { h, A, D, tok } = tokenInDeployment(7902);
  h.do({ type: 'augment', seat: A, from: 'hand', index: handIdx(h, A, 'Chitin Shredder'), hostId: tok });
  const victim = spawn(h, D, 'The Foretold');       // 3/3
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  // the token rides out with the attack (R87's other side) so it is castable
  // in the contested region
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]], spellTokens: [tok] });
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: victim });
  pass(h); pass(h);
  // {Powerful} doubles the damage its source deals — Caleb 2025-03-06 lists it
  // among the attributes this actually does something with ("mostly, deadly,
  // piercing and powerful are impacted by this")
  assert.ok(!ent(h, victim), 'a Fireball 3 wearing {Powerful} deals 6 and kills a 3/3');
  assert.ok(h.log.some(l => /Fireball deals 6 /.test(l)),
    'and the log shows the doubled number, not the printed one');
});

test('R89: a text-only augment on a token grants nothing, and says so', () => {
  // "Also you can only do this with attributes" — and the corollary R79
  // already pinned for the stack: a virus whose payload is rules text may
  // legally be applied and donates nothing.
  const { h, A, tok } = tokenInDeployment(7903, 'Graxxlid');
  h.do({ type: 'augment', seat: A, from: 'hand', index: handIdx(h, A, 'Graxxlid'), hostId: tok });
  assert.ok(h.log.some(l => /a spell can only gain ATTRIBUTES, and this grants none/.test(l)),
    'the player is told at the moment they commit the card, not when it resolves for the same damage');
});

test('R89: an augmented token erased at regroup takes its mod with it — no orphan', () => {
  const { h, A, tok } = tokenInDeployment(7904);
  h.do({ type: 'augment', seat: A, from: 'hand', index: handIdx(h, A, 'Chitin Shredder'), hostId: tok });
  const mod = ent(h, tok)!.mods[0]!;
  toNextBattle(h, A);
  finishBattle(h);
  assert.ok(!ent(h, tok), 'the token is erased at regroup as every spell token is');
  // Manual p.35: "when it dies or is erased, it and all of its mods are erased
  // with it". A mod left behind would be an entity pointing at a dead host.
  assert.ok(!ent(h, mod), 'and its augment went with it');
  assert.ok(h.state.players[A]!.erased!.includes('Chitin Shredder'),
    'into the public erased pile (R65), where every other erase is recorded');
});

test('R89: the augment rides the token through a Harbinger regroup, and is erased with it on resolution', () => {
  const { h, A, tok } = tokenInDeployment(7905);
  giveResources(h, A, 'fire', 8);
  spawn(h, A, 'Harbinger of Immolation');           // its static spares YOUR tokens the regroup erase
  h.do({ type: 'augment', seat: A, from: 'hand', index: handIdx(h, A, 'Chitin Shredder'), hostId: tok });
  const mod = ent(h, tok)!.mods[0]!;
  toNextBattle(h, A);
  finishBattle(h);
  // "A protected token is spared the ERASE and nothing else" (R11 note in
  // startRegroup) — and a mod is not a temporary change, so it is still there.
  assert.ok(ent(h, tok), 'the Harbinger kept the Fireball');
  assert.ok(ent(h, mod), 'and the augment stayed on it: nothing in regroup strips a mod');
  assert.equal(ent(h, tok)!.mods.length, 1, 'exactly the one it went in with');
  // and when it is finally cast, R79's Unstable discharge takes the pair —
  // Manual p.35, and the same `dischargeItem` a virused spell goes through
  const atk = spawn(h, A, 'The Foretold');
  const D = (1 - A) as Seat;
  const victim = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]], spellTokens: [tok] });
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.ok(!ent(h, mod), 'the augment left the board with the token that carried it');
  assert.ok(h.state.players[A]!.erased!.includes('Chitin Shredder'),
    'erased, not binned: a modded card is Unstable however it leaves (R69)');
});
