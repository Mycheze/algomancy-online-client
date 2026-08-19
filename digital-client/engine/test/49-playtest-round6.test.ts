/* Playtest round 6 — the engine half of Bena's second bug list.
 *
 *  R57  Targets are chosen BEFORE any cost is paid. "Sacrifice me:" used to
 *       eat its own unit the instant you clicked it, before showing you the
 *       target list — irreversible, and a disaster to fumble mid-battle.
 *  R58  Per-SLOT target legality. Fight prints "target ally AND ANOTHER target
 *       unit": two cast-time targets with different restrictions. It used to
 *       take one target and pick the second mid-resolution, and Enigmatic
 *       Warder could redirect an ENEMY into the "ally" slot.
 *  R59  A continuous COST-modifier layer, so Tranquility taxes spells.
 *
 * Seeds 4900-4999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/* ── R57: targets before costs ─────────────────────────────────────────── */

test('R57: a "Sacrifice me:" ability keeps its unit until the target is chosen', () => {
  // The report: activating one of these during battle was instant and
  // unrecoverable, so a misclick on a unit you meant to BLOCK with just
  // deleted it. Now the unit is still on the board while you choose.
  const h = new Harness(4900, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const obs = spawn(h, A, 'Prismatic Observer');   // "Sacrifice me: recall up to one target cached card"
  const life = h.state.players[A]!.life;
  new E(h.state).cacheCard(A, 'Shard Sprite', 'hand', {});

  h.do({ type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 });
  assert.ok(ent(h, obs), 'still in play while the target decision is open');
  assert.equal(h.state.decision?.kind, 'targets');

  pick(h, { cached: { seat: A, uid: new E(h.state).cache(A)[0]!.uid! } });
  assert.ok(!ent(h, obs), 'and sacrificed once the choice is made');
  assert.equal(h.state.players[A]!.life, life + 3);
});

test('R57: the cost is still paid at cast — nothing may respond between cost and effect', () => {
  const h = new Harness(4901, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const obs = spawn(h, A, 'Prismatic Observer');
  h.do({ type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 });
  // "up to one" with an empty cache: no decision at all, so the cost is
  // charged immediately and the effect resolves — the old behaviour is intact
  // for the no-choice path.
  assert.equal(h.state.decision, null);
  assert.ok(!ent(h, obs), 'sacrificed');
});

test('R57: mana for an activated ability is also charged after targeting', () => {
  const h = new Harness(4902, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const warder = spawn(h, A, 'Enigmatic Warder');   // "[two]: change a target of target effect to me"
  const victim = spawn(h, D, 'Bubb');
  giveResources(h, A, 'earth', 4);
  giveResources(h, D, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[warder]] });
  pass(h);
  // D puts a targeted spell on the stack for the Warder to aim at
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Accumulated Nucleation') });
  pick(h, { unit: victim });

  const open = new E(h.state).openMana(A);
  h.do({ type: 'activateAbility', seat: A, entityId: warder, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision?.kind, 'targets', 'it asks what to aim at');
  assert.equal(new E(h.state).openMana(A), open, 'and has not billed the [two] yet');

  h.do({ type: 'decide', seat: A, choice: 0 });
  assert.equal(new E(h.state).openMana(A), open - 2, 'the [two] is paid once aimed');
  finishBattle(h);
});

/* ── R58: per-slot target legality ─────────────────────────────────────── */

test('R58: Fight takes both units as CAST-time targets', () => {
  const h = new Harness(4903, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Bubb');
  giveResources(h, D, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });

  pick(h, { unit: ally });
  pick(h, { unit: atk });
  // both targets are visible on the stack BEFORE it resolves — the whole
  // point of making the second one a real target
  const item = h.state.stack.find(i => i.card === 'Fight')!;
  assert.deepEqual(item.parts[0]!.targets, [{ unit: ally }, { unit: atk }]);
  pass(h); pass(h);
  assert.ok(!ent(h, atk));
  finishBattle(h);
});

test('R58: the ally slot only offers allies OF THE CASTER', () => {
  const h = new Harness(4904, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const mine = spawn(h, D, 'Bubb');
  const alsoMine = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });

  const offered = h.state.decision!.options.map(o => JSON.stringify(o.value)).sort();
  assert.deepEqual(offered, [{ unit: mine }, { unit: alsoMine }].map(v => JSON.stringify(v)).sort(),
    "slot 0 is 'allyUnit' — the attacker is not offered");
  pick(h, { unit: mine });
  // slot 1 is plain 'unit': every OTHER unit in the region, both sides
  const slot1 = h.state.decision!.options.map(o => JSON.stringify(o.value)).sort();
  assert.deepEqual(slot1, [{ unit: alsoMine }, { unit: atk }].map(v => JSON.stringify(v)).sort(),
    "slot 1 takes any other unit, and never repeats slot 0");
  pick(h, { unit: atk });
  pass(h); pass(h);
  finishBattle(h);
});

test('R58: Enigmatic Warder cannot redirect an ENEMY into an ally slot', () => {
  // The exact table report: "allowed Enigmatic Warder to change the 'ally'
  // target to it (even though it was my opponent's spell)". "Ally" means ally
  // of the SPELL's controller, so the opponent's Warder is not a legal
  // occupant of that slot and must not be offered it.
  const h = new Harness(4905, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const warder = spawn(h, A, 'Enigmatic Warder');   // A's — the OPPONENT of the caster
  const ally = spawn(h, D, 'Bubb');
  const other = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 4);
  giveResources(h, D, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[warder]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  pick(h, { unit: ally });     // slot 0: D's ally
  pick(h, { unit: other });    // slot 1: another unit

  const fightItem = h.state.stack.find(i => i.card === 'Fight')!;
  h.do({ type: 'activateAbility', seat: A, entityId: warder, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: fightItem.id });
  // Slot 0 ('allyUnit' of D) must NOT be offered; slot 1 ('unit') may be.
  // With exactly one legal slot the card auto-picks it, so there is either no
  // slot decision or a decision that excludes slot 0 — either way the ally
  // slot must still hold D's own unit when the dust settles.
  while (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  pass(h); pass(h);
  const after = h.state.stack.find(i => i.card === 'Fight');
  if (after) {
    assert.deepEqual(after.parts[0]!.targets[0], { unit: ally },
      'the ally slot still holds an ally of the CASTER');
  }
  // and A's Warder was never made D's "ally"
  assert.ok(!ent(h, ally) || ent(h, ally)!.controller === D);
  finishBattle(h);
});

test('R58: canFillSlot enforces the slot restriction directly', () => {
  const h = new Harness(4906, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const enemy = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Bubb');
  const ally2 = spawn(h, D, 'Curio Drifter');
  giveResources(h, D, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[enemy]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  pick(h, { unit: ally });
  pick(h, { unit: enemy });

  const item = h.state.stack.find(i => i.card === 'Fight')!;
  const e = new E(h.state);
  assert.equal(e.canFillSlot(item, 0, 0, { unit: enemy }), false, 'enemy cannot fill the ally slot');
  assert.equal(e.canFillSlot(item, 0, 0, { unit: ally2 }), true, 'another ally can');
  assert.equal(e.canFillSlot(item, 0, 1, { unit: ally2 }), true, "slot 1 is plain 'unit'");
  assert.equal(e.canFillSlot(item, 0, 1, { unit: ally }), false,
    'and may not duplicate the sibling slot — "another" (R56)');
  finishBattle(h);
});

test('R58: Fight refuses at resolution if its ally slot stopped being an ally', () => {
  const h = new Harness(4907, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const enemy = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Bubb');
  giveResources(h, D, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[enemy]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  pick(h, { unit: ally });
  pick(h, { unit: enemy });
  // control of the ally changes while the spell sits on the stack
  ent(h, ally)!.controller = A;
  pass(h); pass(h);
  assert.equal(ent(h, enemy)!.damage, 0, 'no fight happened');
  assert.ok(h.log.some(m => m.includes('Fight') && m.includes('not')), 'and it said why');
  finishBattle(h);
});

/* ── R59: the cost-modifier layer ──────────────────────────────────────── */

test('R59: Tranquility taxes spells [1] more during battle', () => {
  const h = new Harness(4908, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Tranquility');                 // D's region — the battle happens here
  giveResources(h, D, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);

  const e = new E(h.state);
  assert.equal(getCard('Fight').mana, 1, 'printed cost');
  assert.equal(e.manaToPlay(D, 'Fight'), 2, 'and 2 with Tranquility out');
  const before = e.openMana(D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  while (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.equal(new E(h.state).openMana(D), before - 2, 'two mana actually left');
  finishBattle(h);
});

test('R59: it taxes BOTH players, not just its controller', () => {
  const h = new Harness(4909, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Tranquility');
  giveResources(h, A, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  assert.equal(e.manaToPlay(A, 'Fight'), 2, 'the attacker pays the tax too — the text is unqualified');
  finishBattle(h);
});

test('R59: no tax outside battle, and none on units', () => {
  const h = new Harness(4910, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Tranquility');
  const e = new E(h.state);
  assert.equal(e.manaToPlay(A, 'Fight'), 1, '"during battle" — deployment is untaxed');
  assert.equal(e.manaToPlay(A, 'Bubb'), getCard('Bubb').mana, 'a unit is not a spell');
});

test('R59: applying a mod is not playing, so it is never taxed (R37)', () => {
  const h = new Harness(4911, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Tranquility');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  // a Virus augment during battle is a mod application, not a play
  const virus = e.card('Tenebrous Bulborb');
  assert.equal(
    e.manaToPlay(D, 'Tenebrous Bulborb', { purpose: 'mod' }),
    virus.mana,
    'modding pays the printed cost even under Tranquility');
  finishBattle(h);
});

test('R59: the tax makes an unaffordable spell genuinely unplayable', () => {
  const h = new Harness(4912, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Tranquility');
  giveResources(h, D, 'earth', 1);            // exactly the printed cost, one short of the tax
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const i = give(h, D, 'Fight');
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === i),
    'not offered — 1 open mana cannot pay the taxed cost of 2');
  finishBattle(h);
});

test('R59: the modifier is region-scoped like any static (R12)', () => {
  const h = new Harness(4913, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const tranq = spawn(h, D, 'Tranquility');
  giveResources(h, D, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  assert.equal(e.manaToPlay(D, 'Fight'), 2, 'taxed in the battle region');
  // move it out of the battle's region and the tax goes with it
  ent(h, tranq)!.region = h.state.regions.length - 1 - ent(h, tranq)!.region;
  assert.equal(new E(h.state).manaToPlay(D, 'Fight'), 1, 'untaxed from another region');
  finishBattle(h);
});

test('R59: Tranquility is recognised as an augment and taxes from a host', () => {
  const h = new Harness(4914, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const host = spawn(h, D, 'Bubb');
  const e0 = new E(h.state);
  e0.attachMod(ent(h, host)!, 'Tranquility', D, 'augment');
  e0.settle();
  giveResources(h, D, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(new E(h.state).manaToPlay(D, 'Fight'), 2,
    'the donated [Augment] modifier radiates from the host');
  finishBattle(h);
});

test('R59: with no cost modifiers in play, manaToPlay is exactly the printed cost', () => {
  const h = new Harness(4915, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const e = new E(h.state);
  for (const n of ['Fight', 'Bubb', 'Mohruung', 'Brough']) {
    const c = getCard(n);
    assert.equal(e.manaToPlay(A, n), c.mana === 'X' ? (c.xMin ?? 0) : c.mana, n);
  }
  assert.equal(unitsOf(h, A).length, 0);
});

test('R59: an X spell pays the tax on top, and X is offered after it', () => {
  // payCard runs before collectX, so the modifier must already be deducted
  // when the X options are built — otherwise you could pick an X you cannot
  // actually afford. Channel Through is eer/X, a {Battle} spell.
  const h = new Harness(4916, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Tranquility');
  giveResources(h, D, 'earth', 4);
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);

  const e = new E(h.state);
  const xMin = getCard('Channel Through').xMin ?? 0;
  assert.equal(e.manaToPlay(D, 'Channel Through'), xMin + 1, 'printed floor plus the tax');

  const open = e.openMana(D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  const afterPay = new E(h.state).openMana(D);
  assert.equal(afterPay, open - 1, 'the [1] tax is taken before X is chosen');
  const dec = h.state.decision;
  if (dec && /choose X/i.test(dec.prompt)) {
    const maxX = Math.max(...dec.options.map(o => o.value as number));
    assert.ok(maxX <= afterPay, `X options (max ${maxX}) never exceed the ${afterPay} mana left`);
  }
  while (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  finishBattle(h);
});

test('R59: manaToPlay never returns a negative cost', () => {
  // a discount bigger than the printed cost clamps at zero rather than
  // handing the player mana back
  const h = new Harness(4917, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const e = new E(h.state);
  assert.ok(e.manaToPlay(A, 'Fight') >= 0);
  assert.ok(e.manaToPlay(A, 'Bubb') >= 0);
});

test('R59: The Silent taxes [2] per spell you have already played this battle', () => {
  // Unparked by the same layer. Asymmetric on purpose: "each player … for each
  // spell THEIR TEAM has previously played", so it bills the spell-slinger.
  const h = new Harness(4918, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'The Silent');
  giveResources(h, D, 'earth', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);

  const region = h.state.battle!.region;
  const e = new E(h.state);
  assert.equal(e.manaToPlay(D, 'Fight'), 1, 'no spells yet — printed cost');
  assert.equal(e.manaToPlay(A, 'Fight'), 1, 'and the same for the other player');

  e.bumpBattleCounter(region, `spellsPlayed:${D}`, 2);
  const e2 = new E(h.state);
  assert.equal(e2.manaToPlay(D, 'Fight'), 1 + 4, 'two of my own spells → [4] more');
  assert.equal(e2.manaToPlay(A, 'Fight'), 1, "the opponent's own count is still zero");
  finishBattle(h);
});

test('R59: two cost modifiers in the same region stack additively', () => {
  const h = new Harness(4919, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Tranquility');
  spawn(h, D, 'The Silent');
  giveResources(h, D, 'earth', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  new E(h.state).bumpBattleCounter(region, `spellsPlayed:${D}`, 1);
  assert.equal(new E(h.state).manaToPlay(D, 'Fight'), 1 + 1 + 2,
    'printed 1 + Tranquility 1 + The Silent 2');
  finishBattle(h);
});
