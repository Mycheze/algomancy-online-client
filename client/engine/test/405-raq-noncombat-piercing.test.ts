/**
 * R340 — {Piercing} is elective OUTSIDE combat too (2026-10-10).
 *
 * RAQ "[Solved] Squish/Fight/Battle vs Source of damage & Interactions": seniek
 * asks about "Bubb and Good Whale in a column and played Squish/Fight/Battle on
 * Bubb?", and _passer answers "Since Bubb will be the source of damage and he has
 * Piercing, then any excess damage can be dealt to enemy player." Asked whether
 * "can be" is automatic or a choice, the owner: "Elective, like combat."
 *
 * So a Piercing source dealing noncombat damage asks the DEALING player (the
 * source unit's controller) how much of the excess over lethal stays on the unit;
 * the rest goes to that unit's controller. The default is unchanged — lethal to
 * the unit, the rest to the player — and the question is asked only when there is
 * excess to place, so a hit without it replays exactly as before.
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

/** answer the pending noncombat Piercing split with an amount kept on the unit */
function keep(h: Harness, n: number | 'default'): void {
  const dec = h.state.decision;
  assert.ok(dec && dec.kind === 'assignDamage', 'the Piercing split is asked');
  const i = dec.options.findIndex(o => o.value === n);
  assert.ok(i >= 0, `${n} is on the menu [${dec.options.map(o => JSON.stringify(o.value))}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

/** the thread's board: Bubb beside Good Whale in one attacking column, Squish on Bubb */
function bubbSquish(seed: number): { h: Harness; A: Seat; D: Seat; victim: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb');                  // 5/6 {Unaware}
  const whale = spawn(h, A, 'Good Whale');           // 7/5 {Piercing}
  const victim = tok(h, D, 1, 1);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb, whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: bubb });
  pick(h, { unit: victim });
  pass(h); pass(h);
  return { h, A, D, victim };
}

test('R340 Squish: Bubb with Good Whale\'s Piercing — the excess is a question, and keeping it all sends nothing to the player', () => {
  const { h, A, D, victim } = bubbSquish(40501);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage', 'the elective split — R319\'s decision, so the client draws its dial');
  assert.equal(dec.seat, A, 'the dealing player decides');
  assert.match(dec.prompt, /\{Piercing\}/, 'the prompt names Piercing (the client\'s "goes to the player" hint keys on it)');
  assert.deepEqual(dec.options.map(o => o.value), ['default', 1, 2, 3, 4, 5, 6],
    'lethal (1) up to all 6 — never less than lethal');
  const life = h.state.players[D]!.life;
  keep(h, 6);
  assert.ok(!ent(h, victim), 'the 1/1 dies');
  assert.equal(h.state.players[D]!.life, life, '"can be dealt to enemy player" — and here it is not: all 6 stay on the unit');
  finishBattle(h);
});

test('R340 Squish: the default still lets the excess through — 1 to the 1/1, 5 to the player', () => {
  const { h, D, victim } = bubbSquish(40502);
  const life = h.state.players[D]!.life;
  keep(h, 'default');
  assert.ok(!ent(h, victim));
  assert.equal(life - h.state.players[D]!.life, 5);
  finishBattle(h);
});

test('R340 Squish: a split in between — 4 kept on the unit, 2 to the player', () => {
  const { h, D, victim } = bubbSquish(40503);
  const life = h.state.players[D]!.life;
  keep(h, 4);
  assert.ok(!ent(h, victim));
  assert.equal(life - h.state.players[D]!.life, 2);
  finishBattle(h);
});

test('R340 Fight: a Piercing ally\'s excess is elective — 5 of its 7 kept on a 1/3, 2 to the player', () => {
  const h = new Harness(40504);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');           // 7/5 {Piercing}
  const foe = tok(h, D, 1, 3);
  giveResources(h, A, 'earth', 1);                   // Fight: e
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: whale });
  pick(h, { unit: foe });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage');
  assert.equal(dec.seat, A);
  assert.deepEqual(dec.options.map(o => o.value), ['default', 3, 4, 5, 6, 7]);
  keep(h, 5);
  assert.equal(h.state.decision, null, 'one question: the 1/3\'s 1 point back has no Piercing');
  assert.ok(!ent(h, foe));
  assert.equal(life - h.state.players[D]!.life, 2);
  assert.equal(ent(h, whale)!.damage, 1, 'the fight still happened both ways');
  finishBattle(h);
});

test('R340 Battle: the question belongs to the Piercing unit\'s controller, not the caster', () => {
  const h = new Harness(40505);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 1);
  const whale = spawn(h, D, 'Good Whale');           // D's 7/5 {Piercing}
  giveResources(h, A, 'earth', 4);                   // Battle: ee, mana 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Battle') });
  pick(h, { unit: atk });
  pick(h, { unit: whale });
  const life = h.state.players[A]!.life;
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'assignDamage');
  assert.equal(dec.seat, D, 'the whale deals the damage, so its controller places the excess (as a blocker\'s does in combat)');
  keep(h, 'default');
  assert.ok(!ent(h, atk));
  assert.equal(life - h.state.players[A]!.life, 6, '1 kills the 1/1, 6 reach its controller');
  finishBattle(h);
});

test('R340 control: no Piercing, no question — a plain ally\'s overkill stays on the unit', () => {
  const h = new Harness(40506);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 1, 6);
  const victim = tok(h, D, 1, 1);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: ally });
  pick(h, { unit: victim });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.notEqual(h.state.decision?.kind, 'assignDamage', 'nothing to elect without Piercing');
  assert.ok(!ent(h, victim));
  assert.equal(h.state.players[D]!.life, life);
  finishBattle(h);
});

test('R340 control: exactly lethal, no question — Good Whale squishes a 1/5 and nothing is left to place', () => {
  const h = new Harness(40507);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');           // 7/5 {Piercing}: deals 5
  const victim = tok(h, D, 1, 5);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: whale });
  pick(h, { unit: victim });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.notEqual(h.state.decision?.kind, 'assignDamage', 'no excess, no election');
  assert.ok(!ent(h, victim));
  assert.equal(h.state.players[D]!.life, life);
  finishBattle(h);
});

test('R340 Electric + Piercing: where the chain dead-ends, the Piercing half is elective too', () => {
  // a lone 1/2 has no neighbour, so a 6-point Electric + Piercing hit has
  // nowhere to jump: 2 is lethal, and the other 4 are the dealing player's to place
  const h = new Harness(40508);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = tok(h, A, 1, 1);
  const victim = tok(h, D, 1, 2);
  const asked: { kind: string; values: unknown[] }[] = [];
  const g = new E(h.state);
  g.dealEffectDamageAll({
    controller: A, sourceName: 'Unit Token', sourceId: src, region: g.homeRegion(A),
    targets: [], event: null, grantedAttrs: ['Electric', 'Piercing'] as Attr[],
    eraseSelf: () => {},
    choose: (_k, dec) => {
      asked.push({ kind: dec.kind, values: dec.options.map(o => o.value) });
      if (dec.kind === 'assignDamage') return 3;     // keep 3: lethal 2 + 1 more
      throw new Error(`unexpected ${dec.kind}`);
    },
  }, [{ target: g.entity(victim)!, n: 6 }]);
  g.settle();
  assert.deepEqual(asked, [{ kind: 'assignDamage', values: ['default', 2, 3, 4, 5, 6] }]);
  assert.equal(g.s.players[D]!.life, 30 - 3, 'the 3 not kept reach the player');
  assert.ok(!g.entity(victim), 'the 1/2 dies');
});
