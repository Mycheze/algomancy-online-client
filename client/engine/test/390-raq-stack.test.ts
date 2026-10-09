/**
 * RAQ batch B — the stack, targeting, triggers and costs, read against the
 * engine thread by thread (ledgers/raq.ts; the audit is engine/test/386).
 *
 * Every test here names the RAQ thread it comes from and quotes the claim. A
 * claim the engine already disagrees with is a `{ todo }` reproduction: it
 * runs, it does not fail the gate, and its ticket is the place it gets fixed
 * once the owner has seen the list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, ownAttrs, pass, pick, spawn, toDeployment, toNextBattle,
  unitsOf, withE,
} from './util.ts';
import type { Seat } from '../src/types.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;
/** the pending question kind, read fresh (an earlier assert may have narrowed the field) */
const kindNow = (h: Harness): string | undefined => h.state.decision?.kind;
/** answer the pending question the way finishBattle does: by shape */
const answer = (h: Harness): void => {
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
};
const playable = (h: Harness, seat: Seat, name: string): boolean =>
  legalActions(h.state, seat).some(a => a.type === 'playCard' && h.state.players[seat]!.hand[a.handIndex] === name);

// ── "[Solved] When does effect fizzles?" ─────────────────────────────────

test('RAQ fizzles: Fight that loses one of its two targets does nothing to the survivor', () => {
  // _passer: "Does Fight/Battle/Squish / Organic Exchange fizzle if it lost only
  // one target? It won't fizzle, but will do nothing."
  const h = new Harness(3900);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const mine = spawn(h, A, 'Good Whale');                       // 7/5
  const theirs = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  withE(h, e => e.destroy(e.s.entities[theirs]!, 'dies'));      // the other fighter leaves first
  assert.ok(h.state.stack.some(i => i.card === 'Fight'), 'Fight is still on the stack');
  pass(h); pass(h);
  assert.ok(!h.state.stack.some(i => i.card === 'Fight'), 'it left the stack');
  assert.equal(ent(h, mine)!.damage, 0, 'and the survivor took nothing: no fight with nobody');
  finishBattle(h);
});

// ── "[Solved] Valid targets becomes invalid." ────────────────────────────

test('RAQ valid targets: Minor Kraken cannot aim at a unit with more than 5 defense', () => {
  // _passer: "You can't target Bubb (5/6) with Minor Kraken (5 or less defense)"
  const h = new Harness(3901);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const kraken = spawn(h, A, 'Minor Kraken');
  const bubb = spawn(h, D, 'Bubb');                             // 5/6
  const crab = spawn(h, D, 'Mirage Scuttler');                  // 0/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken]] });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: crab })), 'the 0/2 is a legal target');
  assert.ok(!menu.includes(JSON.stringify({ unit: bubb })), 'the 5/6 is not');
  finishBattle(h);
});

test('RAQ valid targets: a target that grows past 5 defense before Minor Kraken resolves is not recalled', () => {
  // _passer: "If you did target something which was valid, but became invalid
  // target then effect will fizzle on resolution." (Mirage Scuttler grown by counters.)
  const h = new Harness(3902);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const kraken = spawn(h, A, 'Minor Kraken');
  const crab = spawn(h, D, 'Mirage Scuttler');                  // 0/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken]] });
  pick(h, { unit: crab });
  withE(h, e => e.addCounters(e.s.entities[crab]!, 11));        // 0/2 → 11/13
  assert.ok(h.state.stack.some(i => i.card === 'Minor Kraken'), 'the recall is still waiting');
  pass(h); pass(h);
  assert.ok(ent(h, crab), 'a 13-defense unit is no longer a legal target, so it stays in play');
  finishBattle(h);
});

test('RAQ valid targets: Enigmatic Warder cannot take Throw off a Cliff, which needs 4 or more defense', () => {
  // _passer: "Enigmatic Warder (1/2) can't redirect Throw off a Cliff ('4 or
  // more defense') to himself as he is not valid target for it."
  const h = new Harness(3903);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');                        // 7/5, the Cliff's target
  const warder = spawn(h, D, 'Enigmatic Warder');               // 1/2
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Throw off a Cliff') });
  pick(h, { unit: atk });
  const item = h.state.stack.find(i => i.card === 'Throw off a Cliff')!;
  let fits = true;
  withE(h, e => { fits = e.canFillSlot(item, 0, 0, { unit: warder }); });
  assert.equal(fits, false, 'a 1/2 cannot occupy a "4 or more defense" slot');
  finishBattle(h);
});

test('RAQ valid targets: Enigmatic Warder cannot become the target of a negate that wants a spell effect', () => {
  // _passer: "You can't activate Enigmatic Warder to change the target of
  // Dreadwave Devourer to Enigmatic Warder, as Enigmatic Warder is not 'spell effect'."
  const h = new Harness(3904);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  const warder = spawn(h, A, 'Enigmatic Warder');
  giveResources(h, A, 'fire', 10);
  giveResources(h, D, 'water', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wildfire') });
  pick(h, 3);                                                   // X = 3, paid as it is chosen
  pick(h, { player: D });
  if (h.state.priority === A) pass(h);                          // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dreadwave Devourer') });
  const wildfire = h.state.stack.find(i => i.card === 'Wildfire')!;
  pick(h, { stack: wildfire.id });
  const devourer = h.state.stack.find(i => i.card === 'Dreadwave Devourer')!;
  let fits = true;
  withE(h, e => { fits = e.canFillSlot(devourer, 0, 0, { unit: warder }); });
  assert.equal(fits, false, 'a unit is not a spell effect');
  finishBattle(h);
});

test('RAQ valid targets: an Ambush whose ally changed sides before it resolves recalls nothing', {
  todo: 'RAQ: a target restriction is re-checked at resolution only where a card does it by hand (R56); Ambush does not',
}, () => {
  // _passer: "Opponent Ambush one of his units. You have responded with Rebalance or
  // Organic Exchange and successfully stole that unit. Ambush won't resolve as it's
  // effect 'Recall target ALLY' and that unit is no longer ally of your opponent"
  const h = new Harness(3937);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const sprite = spawn(h, A, 'Ignis Sprite');
  const rc = spawn(h, D, 'Rune Channeler');
  giveResources(h, D, 'water', 5);
  give(h, D, 'Orblish Horroth');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rc] } });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: h.state.players[D]!.hand.indexOf('Orblish Horroth'), mode: 'ambush' });
  pick(h, { unit: rc });
  withE(h, e => { e.giveControl(e.s.entities[rc]!, A); });     // stands in for Rebalance / Organic Exchange
  while (h.state.stack.length || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.ok(ent(h, rc), 'the stolen unit was not recalled');
  assert.equal(ent(h, rc)!.controller, A, 'it stays with its new controller');
  assert.ok(!h.state.players[D]!.hand.includes('Rune Channeler'), 'and did not go to the ambusher hand');
  finishBattle(h);
});

// ── "[Solved] Target requirements to put effect on stack." ───────────────

test('RAQ target requirements: Resurrect cannot be played with no unit costing 2 or less in your bin', () => {
  // _passer: "You cannot play Resurrect if there aren't any 2 mana units in your bin."
  const h = new Harness(3905);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'fire', 2);
  give(h, p, 'Resurrect');
  h.state.players[p]!.bin.push('Good Whale');                   // too expensive
  assert.equal(playable(h, p, 'Resurrect'), false, 'nothing to target: not playable');
  h.state.players[p]!.bin.push('Ignis Sprite');                 // cost 1
  assert.equal(playable(h, p, 'Resurrect'), true, 'the control: with a target it is');
});

test('RAQ target requirements: Fight cannot be played without an ally and another unit in the region', {
  todo: 'RAQ: castable() checks only the first target slot, so Fight is offered with no second fighter',
}, () => {
  // _passer: "You cannot play Fight if there isn't 2 units in the region (one of
  // which must be an allied unit)."
  const h = new Harness(3906);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const mine = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  give(h, A, 'Fight');
  assert.equal(playable(h, A, 'Fight'), false, 'one unit in the region: no second fighter');
  spawn(h, D, 'Unit Token');
  assert.equal(playable(h, A, 'Fight'), true, 'the control: ally plus another unit');
  finishBattle(h);
});

test('RAQ target requirements: a graft trigger with a required target and none available makes nothing at all', () => {
  // _passer: "When you attack with Megadeath + Resurrect, then 'Create Poison 5' +
  // 'Put target unit with cost 2 or less from your bin into play' can't be put on
  // the stack unless you target such unit in your bin."
  const h = new Harness(3907);
  toDeployment(h);
  const A = h.state.initiative;
  const mega = spawn(h, A, 'Megadeath');
  giveResources(h, A, 'fire', 2);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Resurrect'), hostId: mega, position: 0 });
  h.state.players[A]!.bin = h.state.players[A]!.bin.filter(n => n !== 'Resurrect');
  toNextBattle(h, A);
  const before = h.state.stack.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  while (h.state.stack.length > before || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  const poison = Object.values(h.state.entities).filter(u => u.card === 'Poison');
  assert.equal(poison.length, 0, 'no Poison 5 either: the whole graft effect goes, not just its targeted half');
  finishBattle(h);
});

test('RAQ target requirements: Tidal Reversion is not playable while one player has no unit to recall', {
  todo: 'RAQ: castable() checks only the first target slot, so the other player\'s empty slot is never asked',
}, () => {
  // calebgannon (screenshot): "You can't play it if one player doesn't have a
  // valid target, but it will still resolve if one of the selected targets is removed"
  const h = new Harness(3908);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const mine = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  give(h, A, 'Tidal Reversion');
  assert.equal(playable(h, A, 'Tidal Reversion'), false, 'the defender has no unit: not playable');
  spawn(h, D, 'Unit Token');
  assert.equal(playable(h, A, 'Tidal Reversion'), true, 'the control: one each');
  finishBattle(h);
});

test('RAQ target requirements: Tidal Reversion still recalls the other unit when one target is removed', () => {
  // calebgannon: "…but it will still resolve if one of the selected targets is removed"
  const h = new Harness(3909);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const mine = spawn(h, A, 'Good Whale');
  const theirs = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tidal Reversion') });
  for (const want of [{ unit: mine }, { unit: theirs }]) {
    if (offered(h).includes(JSON.stringify(want))) pick(h, want);
  }
  while (h.state.decision) pick(h, h.state.decision.options[0]!.value);
  withE(h, e => e.destroy(e.s.entities[theirs]!, 'dies'));
  pass(h); pass(h);
  assert.equal(ent(h, mine), undefined, 'my unit was still recalled');
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), 'to my hand');
  finishBattle(h);
});


// ── "[Solved] Dead Unit Effect on Stack" ─────────────────────────────────

/** Bellowing Boulder attacking with `behind` in its column, its "I deal 1
 * damage to each unit" on the stack, and a 7/5 defender in the region */
function boulderOnTheStack(seed: number, behind: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const boulder = spawn(h, A, 'Bellowing Boulder');           // 3/4
  const partner = spawn(h, A, behind);
  const whale = spawn(h, D, 'Good Whale');                    // 7/5: 1 damage kills it only if Deadly
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder, partner]] });
  assert.ok(h.state.stack.some(i => i.card === 'Bellowing Boulder'), 'the ping is on the stack');
  return { h, A, D, boulder, partner, whale };
}

test('RAQ dead unit: an effect stays on the stack when its unit dies and still resolves', () => {
  // _passer: "Does units effect leaves the stack when this unit dies? No, it will
  // remain on stack and will try to resolve."
  const h = new Harness(3910);
  toDeployment(h);
  const A = h.state.initiative;
  const mega = spawn(h, A, 'Megadeath');                      // "When I attack, create a Poison 5"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  withE(h, e => e.destroy(e.s.entities[mega]!, 'dies'));
  assert.ok(h.state.stack.some(i => i.card === 'Megadeath'), 'the trigger outlived its unit');
  pass(h); pass(h);
  assert.ok(Object.values(h.state.entities).some(u => u.card === 'Poison' && u.controller === A),
    'and the Poison 5 was still made');
  finishBattle(h);
});

test('RAQ dead unit: Hooba-Nan gone with its trigger on the stack makes nothing', () => {
  // _passer: "There are only couple of effects which will do nothing since unit is
  // gone (Rousing Spirit, Hooba-Nan)."
  const h = new Harness(3911);
  toDeployment(h);
  const A = h.state.initiative;
  const nan = spawn(h, A, 'Hooba-Nan');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[nan]] });
  const before = unitsOf(h, A).length;
  withE(h, e => e.destroy(e.s.entities[nan]!, 'dies'));
  while (h.state.stack.length || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.equal(unitsOf(h, A).length, before - 1, 'Hooba-Nan died and no 1/1 appeared');
  finishBattle(h);
});

test('RAQ dead unit: Rousing Spirit gone with its trigger on the stack brings nothing back', () => {
  const h = new Harness(3912);
  toDeployment(h);
  const A = h.state.initiative;
  const spirit = spawn(h, A, 'Rousing Spirit');
  h.state.players[A]!.bin.push('Ignis Sprite');               // a legal cost-1 pick
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[spirit]] });
  if (h.state.decision && offered(h).some(k => k.includes('Ignis Sprite'))) {
    pick(h, h.state.decision.options.find(o => JSON.stringify(o.value).includes('Ignis Sprite'))!.value);
  }
  withE(h, e => e.destroy(e.s.entities[spirit]!, 'dies'));
  while (h.state.stack.length || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Ignis Sprite'), 'the Sprite stayed in the bin');
  assert.ok(h.state.players[A]!.bin.includes('Ignis Sprite'));
  finishBattle(h);
});

test('RAQ dead unit: Flamebreath Initiate removed before its trigger resolves still makes a Fireball 1', {
  todo: 'RAQ: the effect returns "the carrier is gone - no Fireball" instead of reading X = 0',
}, () => {
  // _passer: "If Flamebreath Initiate is removed with his trigger on the stack, the
  // X=0 so he will still make Fireball 1."
  const h = new Harness(3913);
  toDeployment(h);
  const A = h.state.initiative;
  const fb = spawn(h, A, 'Flamebreath Initiate');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[fb], [ally]] }); // an adjacent ally while it stood
  withE(h, e => e.destroy(e.s.entities[fb]!, 'dies'));
  pass(h); pass(h);
  const balls = Object.values(h.state.entities).filter(u => u.card === 'Fireball' && u.controller === A);
  assert.equal(balls.length, 1, 'a Fireball was still made');
  assert.equal(balls[0]!.x, 1, 'X = 0 adjacent allies once it is gone, so a Fireball 1');
  finishBattle(h);
});

test('RAQ dead unit: Bellowing Boulder in a column with a Deadly unit pings with Deadly', () => {
  // the control for the two below: nothing removed
  const { h, whale } = boulderOnTheStack(3914, 'Carapace Devourer');
  pass(h); pass(h);
  assert.equal(ent(h, whale), undefined, '1 Deadly damage kills the 7/5');
  finishBattle(h);
});

test('RAQ dead unit: Bellowing Boulder dead with its ping on the stack still pings with Deadly, its last state', {
  todo: 'RAQ: effect damage reads the source attributes off the live entity, so a dead source has none',
}, () => {
  // _passer: "Bellowing Boulder will remember his last state when it comes to
  // resolving his effect, so the '1 damage to each unit' WILL be Deadly."
  const { h, boulder, whale } = boulderOnTheStack(3915, 'Carapace Devourer');
  withE(h, e => e.destroy(e.s.entities[boulder]!, 'dies'));
  pass(h); pass(h);
  assert.equal(ent(h, whale), undefined, 'the Boulder is gone and its 1 damage is still Deadly');
  finishBattle(h);
});

test('RAQ dead unit: once the Deadly partner leaves the column, the Boulder ping is not Deadly', () => {
  // _passer: "However if Deadly unit is removed before Bellowing Boulder dies, BB
  // loses Deadly and its 'I deal 1 damage to each unit' won't be Deadly anymore."
  // (The Boulder stays alive here: what is under test is the partner leaving.)
  const { h, partner, whale } = boulderOnTheStack(3916, 'Carapace Devourer');
  withE(h, e => e.destroy(e.s.entities[partner]!, 'dies'));
  pass(h); pass(h);
  assert.ok(ent(h, whale), 'the 7/5 survives a plain 1 damage');
  assert.equal(ent(h, whale)!.damage, 1);
  finishBattle(h);
});

test('RAQ dead unit: Deadly given back to the Boulder before its ping resolves makes the ping Deadly again', () => {
  // _passer: "If that Deadly unit is removed, then BB loses Deadly. If you later
  // attach Deadly virus to him, his effect is Deadly again"
  const { h, A, boulder, partner, whale } = boulderOnTheStack(3917, 'Carapace Devourer');
  withE(h, e => e.destroy(e.s.entities[partner]!, 'dies'));
  giveResources(h, A, 'water', 1);
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Tidepool Terror'), hostId: boulder });
  while (h.state.stack.length) pass(h);                       // the virus, then the ping
  assert.equal(ent(h, whale), undefined, 'Deadly again: the 1 damage kills the 7/5');
  finishBattle(h);
});

// ── "[Solved] [Cost] vs Trigger. What is first?" ─────────────────────────

/** play Sacrificial Burst as A in battle, sacrificing `victim`, aimed at D */
function burstSacrificing(h: Harness, A: Seat, D: Seat, victim: number): void {
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Sacrificial Burst') });
  let guard = 10;
  while (h.state.decision && guard-- > 0) {
    // the target is asked first, then the sacrifice (both before the spell is played)
    pick(h, /sacrifice/i.test(h.state.decision.prompt) ? { unit: victim } : { player: D });
  }
}

test('RAQ cost vs trigger: a unit sacrificed to pay a spell cost never sees that spell played', () => {
  // _passer: "I play Sacrificial Burst and as part of cost [Sacrifice a unit] I decide
  // to Sac Ravenous Fireslinger. Does he register SPELL BEING PLAYED and trigger? No
  // trigger. Cost has to be paid before spell is actually played."
  const h = new Harness(3920);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  const sling = spawn(h, A, 'Ravenous Fireslinger');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [sling]] }); // in the battle region
  burstSacrificing(h, A, D, sling);
  assert.equal(ent(h, sling), undefined, 'the Fireslinger paid the cost');
  assert.ok(!h.state.stack.some(i => i.card === 'Ravenous Fireslinger'), 'and put no trigger on the stack');
  assert.ok(!h.log.some(l => /Ravenous Fireslinger.*(gains|\+1\/-1)/.test(l)), 'nor resolved one');
  finishBattle(h);
});

test('RAQ cost vs trigger: the control, a Fireslinger that was NOT the sacrifice does trigger', () => {
  const h = new Harness(3921);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  const sling = spawn(h, A, 'Ravenous Fireslinger');
  const fodder = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [sling], [fodder]] });
  burstSacrificing(h, A, D, fodder);
  while (h.state.stack.length) pass(h);
  assert.deepEqual(effStats(h, sling), [5, 2], 'the surviving Fireslinger saw the play: +1/-1');
  finishBattle(h);
});

// ── "[Solved] Increasing Spells Cost vs Triggers checking 'where X is spells cost'"

test('RAQ printed cost: Arcane Concentrator and Channeled Amalgam read a taxed Squish as a 2', () => {
  // _passer: "Despite paying 4mana (3 because of Stasis Sentry and +1 because of
  // Tranquility) to cast Squish, both Arcane Concentrator and Channeled Amalgam will
  // register 2mana spell being played"
  const h = new Harness(3922);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Stasis Sentry');
  spawn(h, D, 'Tranquility');
  spawn(h, D, 'Arcane Concentrator');
  const amalgam = spawn(h, D, 'Channeled Amalgam');
  const wall = spawn(h, D, 'Bubb');                           // the Squish ally: 6 defense
  giveResources(h, D, 'earth', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  const open0 = new E(h.state).openMana(D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Squish') });
  pick(h, { unit: wall });
  pick(h, { unit: atk });
  assert.equal(open0 - new E(h.state).openMana(D), 4, 'Squish cost 4: base 3 under the Sentry, +1 Tranquility');
  while (h.state.stack.length || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  const xx = unitsOf(h, D).filter(u => u.card === 'Unit Token');
  assert.equal(xx.length, 1, 'the Concentrator made one X/X');
  assert.deepEqual(effStats(h, xx[0]!.id), [2, 2], 'X = the printed 2, not the 4 paid');
  assert.equal(ent(h, amalgam)!.counters, 2, 'the Amalgam took 2 counters, not 4');
  finishBattle(h);
});

// ── "[Solved] Timestamps vs Static Abilities" ────────────────────────────

test('RAQ timestamps: a virus applied AFTER Monke still gives its attribute', {
  todo: 'RAQ: R62 made suppression a veto, so a later mod is switched off too; the RAQ says the later timestamp wins',
}, () => {
  // _passer: "Since both Chitin Shredder and Graxxlid apply to the same layer as
  // Monke, but were played after Monke, their bonuses aren't affected by it, so Bubb
  // has Powerful and can Activate Graxxlid Ability."
  const h = new Harness(3923);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'metal', 1);
  giveResources(h, D, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  pass(h); pass(h);                                           // Monke resolves: the battle goes vanilla
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostId: host });
  while (h.state.stack.length) pass(h);
  assert.ok(ownAttrs(h, host).has('Powerful'), 'the later virus wins: Powerful');
  finishBattle(h);
});

test('RAQ timestamps: Body Swap with a Statweavered unit trades the 3/3 base for the 1/1', () => {
  // _passer: "Opponent has Statweaver in play ... you played Body Swap and targeted your
  // 1/1 unit and enemy Wisp which due to Statweaver is considered a base 3/3. Your unit
  // becomes base 3/3 until regroup and enemy Wisp is now base 1/1 until regroup."
  const h = new Harness(3924);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  const mine = spawn(h, D, 'Unit Token');                      // 1/1
  const weaver = spawn(h, A, 'Aberrant Statweaver');            // "Your units are base 3/3"
  const wisp = spawn(h, A, 'Wisp');
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  // all three walk into D's region: the Statweaver's static is region-scoped (R12)
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, wisp], [weaver]] });
  assert.deepEqual(effStats(h, wisp), [3, 3], 'the Statweaver makes the Wisp a 3/3');
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Body Swap') });
  pick(h, { unit: mine });
  pick(h, { unit: wisp });
  pass(h); pass(h);
  assert.deepEqual(effStats(h, mine), [3, 3], 'my 1/1 took the 3/3 base');
  assert.deepEqual(effStats(h, wisp), [1, 1], 'the Wisp is base 1/1 although the Statweaver still stands');
  finishBattle(h);
});

// ── "[Solved] Xenopod Progenitor - When enemy negates vs when you pay?" ──

test('RAQ Xenopod: the trigger goes on the stack with no payment asked, and the [1] is asked as it resolves', () => {
  // _passer: "When Xenopod is triggered, his effect goes on stack. At this point, you
  // don't need to declare if you gonna pay it or not. When enemy gets his priority
  // window, he has a chance to negate it. If he doesn't, then when effect is being
  // resolved you can choose to pay 1 and get 2/2 or choose not to pay."
  const h = new Harness(3925);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  spawn(h, D, 'Xenopod Progenitor');                          // in the region the battle comes to
  const atk = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  withE(h, e => e.draw(D, 1));
  assert.ok(h.state.stack.some(i => i.card === 'Xenopod Progenitor'), 'the trigger is on the stack');
  assert.equal(h.state.decision, null, 'and nobody was asked to pay yet');
  assert.equal(new E(h.state).openMana(D), 1, 'nothing has been paid');
  pass(h); pass(h);
  assert.equal(kindNow(h), 'payOrDecline', 'the [1] is asked at resolution');
  finishBattle(h);
});

test('RAQ Xenopod: negated on the stack, it never asks for the [1]', () => {
  const h = new Harness(3926);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  spawn(h, D, 'Xenopod Progenitor');
  const atk = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 1);
  giveResources(h, A, 'metal', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  withE(h, e => e.draw(D, 1));
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Containment Protocol') });
  let guard = 20;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    assert.notEqual(h.state.decision?.kind, 'payOrDecline', 'a negated Xenopod asks nothing');
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.equal(new E(h.state).openMana(D), 1, 'and the [1] stays unspent');
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Unit Token'), 'no 2/2');
  finishBattle(h);
});

// ── "[Solved] Crevice Lurker explained" ──────────────────────────────────

test('RAQ Crevice Lurker: declining the tax on your own Origon lets your own first spell resolve', () => {
  // _passer: "you decide to play Acummulated Nucleation spell targeting your Origon. In
  // response to that, Origon would like to trigger and negate this spell ... You decide
  // to NOT to pay 1 mana, so Origon trigger is prevented by Crevice Lurker"
  const h = new Harness(3927);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Crevice Lurker');
  const origon = spawn(h, D, 'Origon');
  giveResources(h, D, 'earth', 3);                            // the Nucleation [2], and [1] left for the tax
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  const before = ent(h, origon)!.counters;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Accumulated Nucleation') });
  pick(h, { unit: origon });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'the Origon trigger asks its controller for the tax');
  assert.equal(h.state.decision!.seat, D, 'the player who would control the trigger pays');
  pick(h, false);                                             // decline
  while (h.state.stack.length) pass(h);
  assert.ok(ent(h, origon)!.counters > before, 'the Nucleation resolved: counters on the Origon');
  finishBattle(h);
});

test('RAQ Crevice Lurker: paying the tax lets Origon negate the opponent first spell', () => {
  // _passer: "Then opponent plays Spell-Unit Leaping Lillik targeting your Origon ...
  // you decide to pay 1 mana ... Origon effect goes on the stack and will negate Leaping Lillik"
  const h = new Harness(3928);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Crevice Lurker');
  const origon = spawn(h, D, 'Origon');
  giveResources(h, D, 'earth', 1);
  giveResources(h, A, 'water', 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leaping Lillik') });
  pick(h, { unit: origon });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'Origon wants to trigger: D is asked');
  assert.equal(h.state.decision!.seat, D);
  pick(h, true);                                              // pay [1]
  while (h.state.stack.length || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.ok(ent(h, origon), 'the Lillik was negated: the Origon is still in play');
  finishBattle(h);
});

test('RAQ Crevice Lurker: it taxes the opponent too, not only its controller', () => {
  // _passer: "It affects all players in his region (both ally & opponent) during battle"
  const h = new Harness(3929);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const titan = spawn(h, A, 'Pestilent Titan');
  spawn(h, D, 'Crevice Lurker');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'the attacker trigger is taxed by the DEFENDER Lurker');
  assert.equal(h.state.decision!.seat, A);
  finishBattle(h);
});

test('RAQ Crevice Lurker: a graft trigger is taxed like any other', () => {
  // _passer: "Triggered abilities ('When', 'Whenever', this INCLUDES Graft triggers like
  // for Bellowing Boulder)"
  const h = new Harness(3930);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const boulder = spawn(h, A, 'Bellowing Boulder');
  giveResources(h, A, 'earth', 2);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Geode'), hostId: boulder, position: 0 });
  spawn(h, D, 'Crevice Lurker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'the Boulder graft trigger asks for the tax');
  finishBattle(h);
});

test('RAQ Crevice Lurker: a static ability is not taxed, Tranquility still adds exactly one', () => {
  // _passer: "It doesn't affect Static Abilities (Like ... 'Spells cost 1 more to play
  // during battle' ...)"
  const h = new Harness(3931);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Crevice Lurker');
  spawn(h, D, 'Tranquility');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(new E(h.state).manaToPlay(D, 'Fight'), 2, 'Fight [1] + Tranquility [1]; the Lurker adds nothing');
  finishBattle(h);
});

// ── "[Solved] Trigger-like Attributes vs Crevice Lurker & Containment Protocol"

test('RAQ trigger-like attributes: Crevice Lurker taxes the Alluring trigger', () => {
  // calebgannon: "my intent is for it to stop those from triggering"
  const h = new Harness(3932);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const eel = spawn(h, A, 'Tempest Wrangler');               // {Alluring}
  spawn(h, D, 'Crevice Lurker');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[eel]] });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'the Alluring trigger asks for the tax');
  pick(h, false);                                             // decline: the lure never happens
  assert.ok(!h.state.stack.some(i => i.card === 'Tempest Wrangler'), 'no Alluring trigger on the stack');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });       // nobody is lured, so no block is owed
  finishBattle(h);
});

test('RAQ trigger-like attributes: Crevice Lurker taxes Resonant, the designer intent', {
  todo: 'RAQ: Resonant is an inline damage rider, not a trigger, so the R121 gate never sees it',
}, () => {
  // calebgannon: "I think crevice lurker should say 'Effects cost 1 more to activate or
  // trigger'. So as written it wouldn't work but my intent is for it to stop those from triggering"
  const h = new Harness(3933);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const res = spawn(h, A, 'Resonant Form');                   // {Resonant} 2/4
  spawn(h, D, 'Crevice Lurker');
  const blocker = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[res]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } as never });
  const life = h.state.players[D]!.life;
  let asked = false;
  let guard = 40;
  while (h.state.phase === 'battle' && guard-- > 0) {
    if (h.state.decision?.kind === 'payOrDecline') { asked = true; pick(h, false); continue; }
    if (h.state.decision) { answer(h); continue; }
    if (h.state.priority === null) break;
    pass(h);
  }
  assert.ok(asked, 'the Resonant drain is offered the tax');
  assert.equal(h.state.players[D]!.life, life, 'and declined, it does not happen');
});

test('RAQ trigger-like attributes: Containment Protocol negates a waiting Alluring trigger', () => {
  // Containment Protocol: "Negate all activated and triggered effects."
  const h = new Harness(3934);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const eel = spawn(h, A, 'Tempest Wrangler');
  spawn(h, D, 'Unit Token');
  giveResources(h, D, 'metal', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[eel]] });
  while (h.state.decision) answer(h);
  assert.ok(h.state.stack.some(i => i.card === 'Tempest Wrangler'), 'the Alluring trigger waits on the stack');
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  pass(h); pass(h);
  const lure = h.state.stack.find(i => i.card === 'Tempest Wrangler');
  assert.ok(!lure || lure.negated, 'the Alluring trigger was negated');
  finishBattle(h);
});

// ── '"After Combat" (Regarding Lost Guardian)' ───────────────────────────

test('RAQ after combat: an after-combat trigger fires for a unit in the battle region that is not in formation', () => {
  // calebgannon: "It just needs to be present in a region where battle is happening.
  // Doesn't need to be in formation"
  const h = new Harness(3935);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const atk = spawn(h, A, 'Good Whale');
  const overseer = spawn(h, D, 'Construct Overseer');        // stands in the battle region, does not block
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.ok(ent(h, overseer), 'the Overseer was never in combat');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Robot'), 'and still made its Robot after combat');
});

test('RAQ after combat: the control, an after-combat unit in ANOTHER region makes nothing', () => {
  const h = new Harness(3936);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, A, 'Construct Overseer');                          // A's home: not where A attacks
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: other(A), blocks: {} });
  finishBattle(h);
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Robot'), 'no battle in its region, no Robot');
});
