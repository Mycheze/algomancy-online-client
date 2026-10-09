/**
 * RAQ fix round F1 (2026-10-09) — combat damage, following the RAQ threads
 * (the owner: "Trust the RAQ over our rulings. Those are the actual judges").
 *
 *   R315 {Resonant} is its source's trigger: damage from an effect, on the stack
 *   R316 additive damage modifiers (Conduit of Pain) apply before {Powerful}
 *   R317 {Electric}'s jump is optional, and excess with nowhere to go is dealt
 *   R318 Squish / Fight / Battle: the unit is the source, with its own attributes
 *   R319 {Piercing} is elective in combat (reverses R7)
 *
 * The thread-by-thread claims are guarded in 387 / 388 / 390; this file holds
 * what the fixes needed beyond them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

/** a p/t token for `seat` in its home region */
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
/** answer the pending assignDamage question with the option whose value is `v` */
function elect(h: Harness, v: number | 'default'): void {
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'assignDamage', 'an elective-split decision is pending');
  const idx = dec.options.findIndex(o => o.value === v);
  assert.ok(idx >= 0, `option ${v} is offered (menu: ${dec.options.map(o => JSON.stringify(o.value)).join(', ')})`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** a Piercing attacker of `power` into `blockers` (D's), at the combat-damage election */
function piercingBoard(seed: number, power: number, blockers: (h: Harness, D: Seat) => EntityId[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, power, 20);
  const blk = blockers(h, D);
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: blk } });
  pass(h); pass(h);                                    // into combat damage
  return { h, A, D, atk, blk, life: h.state.players[D]!.life };
}

// ── R319 {Piercing} is elective ──────────────────────────────────────────

test('R319: a Piercing attacker may put all 10 into a lone Vulnerable 3/8 and none reaches the player', () => {
  // RAQ "[Solved] Vulnerable + Piercing / Electric": the attacker "can also put
  // all 10 dmg into Crumbling (which will receive 20 damage)".
  const { h, D, blk, life } = piercingBoard(39901, 10, (h, D) => [spawn(h, D, 'Crumbling Ancient')]);
  elect(h, 10);
  finishBattle(h);
  assert.ok(!ent(h, blk[0]!), 'the Ancient took everything');
  assert.equal(h.state.players[D]!.life, life, 'and nothing pierced through');
});

test('R319: with Piercing the attacker may overkill the front unit and keep the excess off the player', () => {
  // RAQ "[Solved] Excessive Combat Damage & interaction with Piercing, Deadly
  // and Phytochemical Protection": the attacker may "overkill the front or back
  // unit, keeping that excess off the player".
  const { h, D, blk, life } = piercingBoard(39902, 10, (h, D) => [tok(h, D, 1, 2), tok(h, D, 1, 3)]);
  elect(h, 10);                                        // everything on the front unit
  finishBattle(h);
  assert.ok(!ent(h, blk[0]!), 'the front unit took all 10');
  assert.ok(ent(h, blk[1]!), 'nothing reached the unit behind it');
  assert.equal(h.state.players[D]!.life, life, 'and nothing reached the player');
});

test('R319: a Piercing split may keep part of the excess on the back unit and send the rest', () => {
  const { h, D, life } = piercingBoard(39903, 10, (h, D) => [tok(h, D, 1, 2), tok(h, D, 1, 3)]);
  elect(h, 2);                                         // lethal to the front
  const dec = h.state.decision!;
  assert.match(dec.prompt, /Piercing/, 'the question on the last unit says where the rest goes');
  assert.ok(dec.options.some(o => o.value === 5 && o.label.includes('3 to')), 'each amount says how much reaches the player');
  elect(h, 5);                                         // 5 on the back unit, 3 to the player
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, life - 3);
});

test('R319: the default answer is unchanged — lethal to each, the rest to the player', () => {
  const { h, D, blk, life } = piercingBoard(39904, 10, (h, D) => [tok(h, D, 1, 2), tok(h, D, 1, 3)]);
  const def = h.state.decision!.options.find(o => o.value === 'default')!;
  assert.match(def.label, /2 to .*3 to .*5 to /, 'the default names the player share too');
  elect(h, 'default');
  finishBattle(h);
  assert.ok(!ent(h, blk[0]!) && !ent(h, blk[1]!));
  assert.equal(h.state.players[D]!.life, life - 5);
});

test('R319: a Piercing strike with nothing past its lone blocker\'s lethal share is not a question', () => {
  const { h } = piercingBoard(39905, 2, (h, D) => [tok(h, D, 1, 2)]);
  assert.equal(h.state.decision, null, '2 into a 1/2: every point is owed to it, so nothing is asked');
  finishBattle(h);
});

// ── R315 {Resonant} is a trigger ─────────────────────────────────────────

test('R315: the Resonant rider waits on the stack after combat, as its source, and can be negated', () => {
  const h = new Harness(39906);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const res = spawn(h, A, 'Resonant Form');            // 2/4 {Resonant}
  const wall = tok(h, D, 0, 20);
  giveResources(h, D, 'metal', 3);                     // Containment Protocol
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[res]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);                                    // combat damage
  assert.equal(ent(h, wall)!.damage, 2, 'the blocker took its 2');
  assert.equal(h.state.players[D]!.life, life, 'and no life has moved yet');
  const rider = h.state.stack.find(i => i.card === 'Resonant Form' && i.kind === 'triggered');
  assert.ok(rider, 'the rider is a trigger on the stack, named after its source');
  let guard = 6;
  while (h.state.priority !== D && guard-- > 0) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  pass(h); pass(h);                                    // Containment Protocol resolves
  let g2 = 10;
  while (h.state.stack.length && g2-- > 0) pass(h);
  assert.equal(h.state.players[D]!.life, life, 'negated, the rider dealt nothing');
  finishBattle(h);
});

test('R315: effect damage riders too — the 1 lands on the controller as damage from the source', () => {
  const h = new Harness(39907);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const curio = spawn(h, D, 'Curio Drifter');
  const g = new E(h.state);
  g.dealEffectDamage({
    controller: A, sourceName: 'Resonant Form', region: g.homeRegion(A), targets: [], event: null,
    eraseSelf: () => {}, choose: () => { throw new Error('no choice expected'); },
  }, g.entity(curio)!, 1);
  g.settle();
  assert.equal(h.state.players[D]!.life, 29);
  // a bare E keeps its own event list (the Harness only absorbs h.do's)
  const face = g.events.find(e => e.type === 'damage' && e.data?.['player'] === D);
  assert.ok(face, 'a damage event to the player — not bare life loss');
  assert.equal(face!.data!['source'], 'Resonant Form');
});

// ── R318 the unit is the source ──────────────────────────────────────────

test('R318: Fight — a fighter that GAINED Powerful deals double; its live attributes, not its printed card', () => {
  const h = new Harness(39908);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 3, 10);
  const foe = tok(h, D, 1, 20);
  giveResources(h, A, 'earth', 3);
  toNextBattle(h, A);
  grant(h, ally, 'Powerful');
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: ally });
  pick(h, { unit: foe });
  pass(h); pass(h);
  assert.equal(ent(h, foe)!.damage, 6, '"you would need to target ally unit which is Powerful to deal double damage"');
  finishBattle(h);
});

test('R318: Fight — a Powerful virus on the Fight spell does not double either fighter', () => {
  const h = new Harness(39909);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 3, 10);
  const foe = tok(h, D, 2, 20);
  giveResources(h, A, 'earth', 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: ally });
  pick(h, { unit: foe });
  const fight = h.state.stack[h.state.stack.length - 1]!;
  let guard = 6;
  while (h.state.priority !== A && guard-- > 0) pass(h);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostStack: fight.id });
  pass(h); pass(h);                                    // the virus resolves onto Fight
  pass(h); pass(h);                                    // Fight resolves
  assert.equal(ent(h, foe)!.damage, 3, '"It doesn\'t matter if Squish is Powerful" — nor Fight');
  assert.equal(ent(h, ally)!.damage, 2);
  finishBattle(h);
});
