/**
 * Comprehensive rules, unit U04 (costs, life, damage, rot, debt, timestamps) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U04
 * (data/comprehensive-rules/build/probes/U04/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U04.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The two tests titled "engine differs" are the exception: their rules state
 * printed law (an Ambush is a card played, so a "cards played" imposed cost
 * applies to it) and carry an engineDiffers mark, and these tests pin the
 * divergence the mark describes. They are deliberately NOT listed in those
 * rules' sources. When one goes red the engine has been brought in line with
 * print: drop the engineDiffers mark and the test, and bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, GameEnded, Suspended } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import {
  absorb, ent, finishBattle, give, giveResources, offered, ownAttrs, pass, pick, spawn, toDeployment, toNextBattle, withE,
} from './util.ts';

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
/** run an engine step directly, outside an action (a death, a life loss) */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try { f(e); e.settle(); } catch (sig) {
    if (!(sig instanceof Suspended) && !(sig instanceof GameEnded)) throw sig;
  }
  h.state = e.s;
  absorb(h, e.events);
}
function drainDecisions(h: Harness): void {
  while (h.state.decision) pick(h, h.state.decision.options[0]!.value);
}

/* ── costs ──────────────────────────────────────────────────────────────── */

test('cr:concepts.costs.region — a sacrifice cost menu holds only units in the region where it is paid', () => {
  const h = new Harness(40407);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const away = tok(h, A, 1, 3);                               // walks into the battle
  const home = tok(h, A, 1, 7);                               // stays at home
  giveResources(h, A, 'fire', 1); giveResources(h, A, 'wood', 1);   // Volatile Toxicity rg/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[away]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Volatile Toxicity') });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: away })), 'the unit in the battle region is offered');
  assert.ok(!menu.includes(JSON.stringify({ unit: home })), 'the unit at home, in another region, is not');
  pick(h, { unit: away });
  finishBattle(h);
});

test('cr:concepts.costs.region.other-units — a [Remove X counters from allies] menu holds only allies in the region where it is paid', () => {
  const h = new Harness(40421);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const away = tok(h, A, 1, 5);
  const home = tok(h, A, 1, 5);
  h.state.entities[away]!.counters = 2;
  h.state.entities[home]!.counters = 2;
  giveResources(h, A, 'metal', 1);                           // Discharge m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[away]] });
  assert.notEqual(ent(h, away)!.region, ent(h, home)!.region, 'setup: the two allies are in different regions');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });
  const menu = offered(h).join(' ');
  assert.ok(menu.includes(`"counterFrom":${away}`), `the battle-region ally is offered: ${menu}`);
  assert.ok(!menu.includes(`"counterFrom":${home}`), `the ally at home, in another region, is not: ${menu}`);
});

test('cr:concepts.costs.region.other-units — a [Recall another ally] menu holds only allies in the region where it is paid', () => {
  const h = new Harness(40422);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const auric = spawn(h, A, 'Auric Ascendant');
  const mate = tok(h, A, 1, 5);
  const home = tok(h, A, 1, 5);
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[auric], [mate]] });
  h.do({ type: 'activateAbility', seat: A, entityId: auric, abilityIndex: 0 });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ recall: mate })), `the ally beside it is offered: ${menu}`);
  assert.ok(!menu.includes(JSON.stringify({ recall: home })), `the ally at home is not: ${menu}`);
  assert.ok(!menu.includes(JSON.stringify({ recall: auric })), 'and never the source itself');
});

test('cr:concepts.costs.activation — a negated Infernal Cultivator activation does not give back the sacrificed units', () => {
  const h = new Harness(40423);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const cult = spawn(h, D, 'Infernal Cultivator');
  const f1 = tok(h, D, 1, 1);
  const f2 = tok(h, D, 1, 1);
  giveResources(h, A, 'water', 1); giveResources(h, A, 'metal', 1);   // Dematerialize bm/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'activateAbility', seat: D, entityId: cult, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: f1 });
  pick(h, { unit: f2 });
  pick(h, { doneCost: true });
  assert.ok(!ent(h, f1) && !ent(h, f2), 'the sacrifice is paid at activation');
  const item = h.state.stack[h.state.stack.length - 1]!;
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Dematerialize') });
  pick(h, { stack: item.id });
  drainDecisions(h);
  pass(h); pass(h);
  drainDecisions(h);
  while (h.state.stack.length) { pass(h); drainDecisions(h); }
  assert.ok(!h.state.stack.some(i => i.id === item.id), 'the ability is gone');
  assert.equal(Object.values(h.state.entities).filter(e => e.kind === 'spellToken' && e.controller === D).length, 0,
    'negated: no Fireballs');
  assert.ok(!ent(h, f1) && !ent(h, f2), 'and the sacrificed units did not come back');
  finishBattle(h);
});

test('cr:concepts.costs.activation.gate-first — the Throwing Boulder adjacency condition is not checked again at resolution', () => {
  const h = new Harness(40403);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const boulder = spawn(h, A, 'Throwing Boulder');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder], [ally]] });
  h.do({ type: 'activateAbility', seat: A, entityId: boulder, abilityIndex: 0, via: 'augment' });
  pick(h, { player: D });
  assert.ok(!ent(h, boulder), 'the sacrifice cost is paid as the ability goes on the stack');
  whiteBox(h, e => e.destroy(e.entity(ally)!, 'dies'));      // the adjacent ally is gone before resolution
  assert.ok(!ent(h, ally));
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 27, 'it still resolves for 3: the condition was a gate, checked once');
  finishBattle(h);
});

test('cr:concepts.costs.modifiers.noun — Tranquility ("Spells cost [one] more") taxes a spell unit played in battle, not a plain unit', () => {
  const h = new Harness(40424);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const before = new E(h.state).manaToPlay(D, 'Jelly');
  spawn(h, D, 'Tranquility');
  const after = new E(h.state).manaToPlay(D, 'Jelly');
  assert.equal(after - before, 1, `Jelly (a {Battle} spell unit) costs one more: ${before} -> ${after}`);
  assert.equal(new E(h.state).manaToPlay(D, 'Shard Sprite'), 1, 'and a plain {Battle} unit (not a spell) is untaxed');
  finishBattle(h);
});

test('cr:concepts.costs.modifiers.noun — Arbiter of Armistice ("Cards played") taxes a unit played in battle', () => {
  const h = new Harness(40425);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  spawn(h, D, 'Arbiter of Armistice');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(new E(h.state).lifeToPlay(D, 'Shard Sprite'), 2, 'a {Battle} unit card owes 2 life');
  giveResources(h, D, 'light', 1);
  if (h.state.priority !== D) pass(h);
  const life = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Shard Sprite') });
  assert.equal(h.state.players[D]!.life, life - 2, 'and really pays it as it is played');
  finishBattle(h);
});

/* The probe for the next two: measured on the engine, which plays an Ambush
 * outside the imposed-cost layer, so a "cards played" tax never reaches it. */
function ambushPaysNoArbiterLife(): void {
  const h = new Harness(40401);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Arbiter of Armistice');                        // "Cards played during battle gain [Pay 2 life]."
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3);                            // Lurking Slimebeast ambush [3b]
  toNextBattle(h, D);                                         // D attacks into the region of the Arbiter
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  assert.equal(new E(h.state).lifeToPlay(D, 'Godray'), 2, 'control: a spell card played here owes 2 life');
  const life = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: raider });
  assert.equal(h.state.players[D]!.life, life, 'the Ambush paid no life');
  finishBattle(h);
}

test('cr:concepts.costs.modifiers.imposed.ambush — engine differs: an Ambush played under Arbiter of Armistice pays no life, while a spell card there owes 2', ambushPaysNoArbiterLife);

test('cr:concepts.costs.modifiers.noun — engine differs: a card played as an Ambush escapes the Arbiter of Armistice "cards played" tax', ambushPaysNoArbiterLife);

/* ── life ───────────────────────────────────────────────────────────────── */

test('cr:concepts.life.basics — players start at 30, and a player reduced to exactly 0 life loses the game', () => {
  const h = new Harness(40406);
  assert.deepEqual(h.state.players.map(p => p.life), [30, 30], 'both begin at 30');
  toDeployment(h);
  const P = h.state.deployPlayer!;
  whiteBox(h, e => e.loseLife(P, 30, 'probe'));
  assert.equal(h.state.players[P]!.life, 0);
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, 1 - P, 'exactly 0 is elimination');
});

test('cr:concepts.life.basics.region — "each opponent loses 3 life" during deployment reaches nobody', () => {
  const h = new Harness(40410);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const blub = spawn(h, A, 'Bloated Manablub');               // "When I despawn, each opponent loses 3 life."
  const life = h.state.players[D]!.life;
  whiteBox(h, e => e.destroy(e.entity(blub)!, 'dies'));
  drainDecisions(h);
  assert.equal(h.state.players[D]!.life, life, 'the opponent is in another region in deployment: no life lost');
});

/* ── damage ─────────────────────────────────────────────────────────────── */

test('cr:concepts.damage.basics — damage equal to defense kills, and unblocked damage to a player is that much life lost', () => {
  const h = new Harness(40405);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = tok(h, A, 2, 9);
  const a2 = tok(h, A, 1, 9);
  const blk = tok(h, D, 0, 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.ok(!ent(h, blk), '2 damage on a 0/2 (damage >= defense) kills it');
  assert.equal(h.state.players[D]!.life, life - 1, 'the unblocked column dealt 1 to the player as 1 life lost');
  finishBattle(h);
});

test('cr:concepts.damage.basics.regroup — damage marked on a unit is removed at regroup', () => {
  const h = new Harness(40404);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 2, 9);
  const wall = tok(h, D, 0, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  pass(h); pass(h);                                           // combat damage
  assert.equal(ent(h, wall)!.damage, 2, 'the blocker has 2 marked damage during the battle');
  finishBattle(h);                                            // battle → regroup → deploy
  assert.equal(ent(h, wall)!.damage, 0, 'regroup removed it');
});

test('cr:concepts.damage.amount-order — Conduit adds, Powerful doubles, then a Vulnerable recipient is dealt double', () => {
  const h = new Harness(40408);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const boulder = spawn(h, A, 'Bellowing Boulder');
  const conduit = spawn(h, A, 'Conduit of Pain');
  const wall = tok(h, D, 0, 40);
  const ctrl = tok(h, D, 0, 40);
  toNextBattle(h, A);
  grant(h, boulder, 'Powerful');
  grant(h, wall, 'Vulnerable');
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder], [conduit]] });
  pass(h); pass(h);
  assert.equal(ent(h, ctrl)!.damage, 4, '(1+1)x2 = 4 on a plain unit');
  assert.equal(ent(h, wall)!.damage, 8, 'and the Vulnerable unit is dealt double that: 8');
  finishBattle(h);
});

test('cr:concepts.damage.one-effect.copies — the three Meteor Shower rockfalls are three separate dealings of damage', () => {
  const h = new Harness(40409);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = tok(h, A, 1, 40);
  const d = tok(h, D, 0, 40);
  giveResources(h, D, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Meteor Shower') });
  pass(h); pass(h);
  const hits = h.events.slice(mark).filter(ev => ev.type === 'damage' && ev.data?.['unit'] === d);
  assert.equal(hits.length, 3, 'three damage events on the same unit, not coalesced into one');
  assert.deepEqual(hits.map(x => x.data?.['n']), [3, 3, 3], 'each rockfall deals its own 3 to the unit');
  assert.deepEqual(hits.map(x => x.data?.['total']), [6, 6, 6],
    'and each batch total is ONE rockfall (3 to each of the two chosen units), never the 18 of a coalesced shower');
  finishBattle(h);
});

/* ── debt ───────────────────────────────────────────────────────────────── */

test('cr:concepts.debt — debt is still owed while the resource step is open, and is paid only as it ends', () => {
  const h = new Harness(40402);
  const P = 0 as Seat;
  giveResources(h, P, 'fire', 5);
  h.state.players[P]!.debt = 3;
  assert.equal(h.state.phase, 'planning');
  assert.equal(h.state.players[P]!.debt, 3, 'nothing is paid at the start of the resource step');
  assert.equal(new E(h.state).openMana(P), 5, 'and every resource is still open to expend first');
  h.do({ type: 'donePlanning', seat: P });
  assert.equal(h.state.players[P]!.debt, 0, 'the debt is paid as the step ends: 1 mana per debt');
  assert.equal(new E(h.state).openMana(P), 2);
});

test('cr:concepts.debt.as-cost — Hyper Beam negated by Dematerialize deals no damage, and the debt gained to play it stays', () => {
  const h = new Harness(40411);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const target = tok(h, D, 1, 20);
  const card = 'Hyper Beam';
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'light', 2); giveResources(h, A, 'fire', 2);   // Hyper Beam lr/4
  giveResources(h, D, 'water', 1); giveResources(h, D, 'metal', 1);  // Dematerialize bm/2
  const debt0 = h.state.players[A]!.debt ?? 0;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, card) });
  pick(h, { unit: target });
  const gained = (h.state.players[A]!.debt ?? 0) - debt0;
  assert.ok(gained > 0, `the debt cost was charged as the spell was played (+${gained})`);
  const item = h.state.stack.find(i => i.card === card)!;
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: item.id });
  drainDecisions(h);
  pass(h); pass(h);                                           // Dematerialize resolves: Hyper Beam negated
  drainDecisions(h);
  while (h.state.stack.length) pass(h);
  assert.equal(ent(h, target)!.damage, 0, 'negated: no damage');
  assert.equal((h.state.players[A]!.debt ?? 0) - debt0, gained, 'and the debt stays gained');
  finishBattle(h);
});

/* ── tester additions: the rules the verifier left without a demonstration ── */

test('cr:concepts.costs.what-a-cost-is.mana — each resource is expended once for 1 mana, for a card or an ability, and is open again next turn', () => {
  const h = new Harness(40430);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const auric = spawn(h, A, 'Auric Ascendant');               // "[once] [one], Recall another ally: ..."
  const mate = tok(h, A, 1, 5);
  giveResources(h, A, 'light', 1); giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  assert.equal(new E(h.state).openMana(A), 2, 'two open resources are two mana');
  h.do({ type: 'declareAttack', seat: A, columns: [[auric], [mate]] });
  h.do({ type: 'activateAbility', seat: A, entityId: auric, abilityIndex: 0 });
  pick(h, { recall: mate });
  assert.equal(new E(h.state).openMana(A), 1, 'the ability mana cost expended one resource');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'expended').length, 1);
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Shard Sprite') });   // l/1
  drainDecisions(h);
  assert.equal(new E(h.state).openMana(A), 0, 'the card mana cost expended the other one');
  assert.ok(h.state.players[A]!.resources.filter(r => r.state !== 'dormant').every(r => r.state === 'expended'),
    'both resources are expended (the dormant ones never were open)');
  if (h.state.priority !== A) pass(h);
  const idx = give(h, A, 'Shard Sprite');
  assert.ok(h.state.priority === A, 'setup: A holds priority');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === idx),
    'an expended resource gives no more mana this turn: a second 1-cost card is not playable');
  h.state.players[A]!.hand.splice(idx, 1);
  finishBattle(h);
  toNextBattle(h, A);
  const mine = h.state.players[A]!.resources.filter(r => r.kind === 'light' || r.kind === 'water');
  assert.deepEqual(mine.map(r => r.state), ['open', 'open'], 'the next turn both resources are open again');
});

test('cr:concepts.life.basics.gain-and-loss — damage to a player and a paid life cost both reach the life total as life lost', () => {
  const h = new Harness(40431);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const boulder = spawn(h, A, 'Throwing Boulder');            // "Sacrifice me: I deal 3 damage to any target."
  const ally = tok(h, A, 2, 5);
  spawn(h, D, 'Arbiter of Armistice');                        // "Cards played during battle gain [Pay 2 life]."
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder], [ally]] });
  const lostBy = (seat: Seat, from: number): number[] => h.events.slice(from)
    .filter(ev => ev.type === 'lifeLost' && ev.data?.['seat'] === seat).map(ev => ev.data?.['n'] as number);
  const gainedBy = (seat: Seat, from: number): number => h.events.slice(from)
    .filter(ev => ev.type === 'lifeGained' && ev.data?.['seat'] === seat).length;

  // effect damage to a player
  let mark = h.events.length, life = h.state.players[D]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: boulder, abilityIndex: 0, via: 'augment' });
  pick(h, { player: D });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, life - 3, 'the 3 damage took 3 life');
  assert.deepEqual(lostBy(D, mark), [3], 'as one loss of 3 life');
  assert.equal(gainedBy(D, mark), 0);

  // a paid life cost
  mark = h.events.length; life = h.state.players[A]!.life;
  giveResources(h, A, 'light', 1);
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Shard Sprite') });
  assert.equal(h.state.players[A]!.life, life - 2, 'the [Pay 2 life] cost took 2 life');
  assert.deepEqual(lostBy(A, mark), [2], 'as one loss of 2 life');
  drainDecisions(h);
  while (h.state.stack.length) { pass(h); drainDecisions(h); }

  // combat damage to a player
  mark = h.events.length; life = h.state.players[D]!.life;
  finishBattle(h);                                            // no blocks: the ally's column is unblocked
  const lost = lostBy(D, mark).reduce((x, y) => x + y, 0);
  assert.ok(lost >= 2, `the unblocked attacker dealt its 2 combat damage as life lost (${lost})`);
  assert.equal(gainedBy(D, mark), 0);
  assert.equal(life - h.state.players[D]!.life, lost, 'and the life total moved by exactly the life lost, nothing else');
});

test('cr:concepts.timestamps.when — a static dates from its card, a mod from when it was applied, a resolved spell from its resolution, and printed text is older than all', () => {
  // a static: Transmogrifant ("Your other units ... lose all attributes") takes what is older than its own arrival
  {
    const h = new Harness(40432);
    toDeployment(h);
    const A = h.state.deployPlayer!;
    const early = spawn(h, A, 'Bubb');                        // prints {Unaware}
    const late = spawn(h, A, 'Bubb');
    giveResources(h, A, 'earth', 4);
    h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: early });
    drainDecisions(h); while (h.state.stack.length) pass(h);
    withE(h, e => e.addTempAttr(e.s.entities[early]!, 'Flying'));
    spawn(h, A, 'Transmogrifant');
    h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostId: late });
    drainDecisions(h); while (h.state.stack.length) pass(h);
    withE(h, e => e.addTempAttr(e.s.entities[late]!, 'Flying'));
    assert.ok(!ownAttrs(h, early).has('Powerful'), 'a mod applied before the static arrived is taken');
    assert.ok(!ownAttrs(h, early).has('Flying'), 'an effect granted before it is taken');
    assert.ok(ownAttrs(h, late).has('Powerful'), 'a mod applied after the static arrived is kept');
    assert.ok(ownAttrs(h, late).has('Flying'), 'an effect granted after it is kept');
    assert.ok(!ownAttrs(h, late).has('Unaware'), 'printed text is older than the static, even on the later unit');
  }
  // a resolved spell: Suppression Field strips from when it RESOLVES, not when it was cast
  {
    const h = new Harness(40433);
    toDeployment(h);
    const A = h.state.initiative as Seat, D = (1 - A) as Seat;
    const u = tok(h, A, 1, 5);
    giveResources(h, D, 'metal', 1);
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[u]] });
    while (h.state.priority !== D) pass(h);
    h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Suppression Field') });
    pick(h, { unit: u });
    assert.ok(h.state.stack.some(i => i.card === 'Suppression Field'), 'setup: the spell is on the stack');
    withE(h, e => e.addTempAttr(e.s.entities[u]!, 'Piercing'));   // after the cast, before resolution
    while (h.state.stack.length) { pass(h); drainDecisions(h); }
    withE(h, e => e.addTempAttr(e.s.entities[u]!, 'Flying'));     // after resolution
    assert.ok(!ownAttrs(h, u).has('Piercing'), 'granted while the spell was on the stack: older than its resolution, taken');
    assert.ok(ownAttrs(h, u).has('Flying'), 'granted after it resolved: kept');
    finishBattle(h);
  }
});
