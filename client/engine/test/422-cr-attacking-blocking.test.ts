/**
 * Comprehensive rules, unit U11 (attacking, attack window, blocking, block
 * window) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U11
 * (data/comprehensive-rules/build/probes/U11/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U11.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, IllegalAction } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && h.state.priority !== null && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}
function spellTok(h: Harness, seat: Seat, name: string, x: number): EntityId {
  const g = new E(h.state);
  const t = g.createSpellToken(seat, name, x, g.homeRegion(seat));
  g.settle();
  return t.id;
}

/* ── attacking ──────────────────────────────────────────────────────────── */

function attackerMovesIn(): void {
  const h = new Harness(111018);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.deepEqual(h.state.battle!.columns, [[atk]], 'it stands in the attacking formation');
  assert.equal(ent(h, atk)!.region, new E(h.state).homeRegion(D), 'the attacker stands in the defending region');
  finishBattle(h);
  assert.equal(ent(h, atk)!.region, new E(h.state).homeRegion(A), 'and is home again after the battle');
}

test('cr:combat.attack.general — the declared attacker moves into the defending region, and returns home after the battle', attackerMovesIn);

test('cr:combat.attack.declaring — a declared attacker is placed in the attacking formation in the defending region', attackerMovesIn);

test('cr:combat.attack.declaring — a player with three units attacks with two side by side; the third stays home, and the formation cannot be declared again', () => {
  const h = new Harness(211001);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const [u1, u2, u3] = [tok(h, A, 1, 9), tok(h, A, 1, 9), tok(h, A, 1, 9)];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u1], [u2]] });
  assert.deepEqual(h.state.battle!.columns, [[u1], [u2]], 'two columns, one unit each');
  assert.equal(ent(h, u3)!.region, new E(h.state).homeRegion(A), 'the third stayed home');
  assert.throws(() => h.do({ type: 'declareAttack', seat: A, columns: [[u2], [u1]] }), IllegalAction,
    'the attacking formation, once set, cannot be re-declared or rearranged');
  finishBattle(h);
});

function noCounterCounterattack(): void {
  const h = new Harness(111015);
  toDeployment(h);
  const IT = h.state.initiative as Seat, NIT = (1 - IT) as Seat;
  const ctr = tok(h, NIT, 1, 9);
  const it1 = tok(h, IT, 1, 9);
  toNextBattle(h, IT);
  h.do({ type: 'declareAttack', seat: IT, columns: [] });
  assert.equal(h.state.battle!.round, 2);
  h.do({ type: 'declareAttack', seat: NIT, columns: [[ctr]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: IT, blocks: {}, send: [it1] }), /no counter-counterattacks/);
  h.do({ type: 'declareBlocks', seat: IT, blocks: {} });
  finishBattle(h);
}

test('cr:combat.attack.general.rounds — each side gets one chance: in round 2 the defender may not send units to attack back', noCounterCounterattack);

test('cr:combat.attack.declaring.no-summoning-sickness — a unit that entered play during the battle phase, before the declaration, may attack', () => {
  const h = new Harness(111020);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  toNextBattle(h, A);
  assert.equal(h.state.battle!.step, 'declare');
  const fresh = tok(h, A, 2, 2);
  h.do({ type: 'declareAttack', seat: A, columns: [[fresh]] });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 28, 'the fresh unit connected for 2');
});

test('cr:combat.attack.declaring.spell-tokens — an attack naming a spell token and no unit is not refused: it is taken as declining to attack, and the token stays home', () => {
  const h = new Harness(111002);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  tok(h, A, 1, 1);
  const p = spellTok(h, A, 'Poison', 1);
  toNextBattle(h, A);
  const home = new E(h.state).homeRegion(A);
  let threw = false;
  try { h.do({ type: 'declareAttack', seat: A, columns: [], spellTokens: [p] }); } catch (e) { threw = e instanceof IllegalAction; }
  assert.equal(threw, false, 'no refusal');
  assert.equal(h.state.battle?.round, 2, 'the round ended as a decline');
  assert.equal(h.state.battle?.attacker, D);
  assert.equal(ent(h, p)!.region, home, 'the Poison did not travel');
});

test('cr:combat.attack.declaring.spell-tokens — with a unit beside it, the spell token goes along into the attacked region', () => {
  const h = new Harness(111003);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const u = tok(h, A, 1, 1);
  const p = spellTok(h, A, 'Poison', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u]], spellTokens: [p] });
  assert.equal(ent(h, p)!.region, h.state.battle!.region);
});

test('cr:combat.attack.decline.next-round — when the initiative player declines, the battle phase does not end: the non-initiative player gets round 2 with any unit', () => {
  const h = new Harness(111019);
  toDeployment(h);
  const IT = h.state.initiative as Seat, NIT = (1 - IT) as Seat;
  const home = tok(h, NIT, 2, 2);
  toNextBattle(h, IT);
  h.do({ type: 'declareAttack', seat: IT, columns: [] });
  assert.equal(h.state.phase, 'battle');
  assert.equal(h.state.battle!.round, 2);
  h.do({ type: 'declareAttack', seat: NIT, columns: [[home]] });
  assert.equal(h.state.battle!.step, 'attackWindow');
  finishBattle(h);
  assert.equal(h.state.players[IT]!.life, 28, 'the home unit connected for 2');
});

test('cr:combat.attack.declaring.tokens-irreversible — a spell token brought along with an attack stays in that region for the rest of the battle and cannot be cast back home in the counterattack', () => {
  const h = new Harness(111021);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const u = tok(h, A, 1, 9);
  const p = spellTok(h, A, 'Poison', 1);
  const c = tok(h, D, 1, 9);
  toNextBattle(h, A);
  const homeD = new E(h.state).homeRegion(D);
  h.do({ type: 'declareAttack', seat: A, columns: [[u]], spellTokens: [p] });
  assert.equal(ent(h, p)!.region, homeD, 'the token went along into the attacked region');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] });
  let guard = 20;
  while (h.state.battle && h.state.battle.round === 1 && guard-- > 0) {
    assert.equal(ent(h, p)!.region, homeD, 'still in the attacked region during round 1');
    pass(h);
  }
  assert.equal(h.state.battle!.round, 2);
  h.do({ type: 'declareAttack', seat: D, columns: [[c]] });
  assert.notEqual(h.state.battle!.region, homeD, 'the counterattack is fought in the other region');
  passTo(h, A);
  assert.equal(ent(h, p)!.region, homeD, 'the token did not come back home');
  assert.ok(!h.legal(A).some(a => a.type === 'castSpellToken'), 'no cast of it is offered in the counterattack');
  assert.throws(() => h.do({ type: 'castSpellToken', seat: A, entityId: p }), /castable only in their region/);
  finishBattle(h);
});

/* ── attack window ──────────────────────────────────────────────────────── */

test('cr:combat.attack-window.general.initiative-first — in the round 2 attack window the initiative player, who is defending, gets priority first', () => {
  const h = new Harness(111001);
  toDeployment(h);
  const IT = h.state.initiative as Seat, NIT = (1 - IT) as Seat;
  const ctr = tok(h, NIT, 2, 2);
  toNextBattle(h, IT);
  h.do({ type: 'declareAttack', seat: IT, columns: [] });          // round 1 declined
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attacker, NIT);
  h.do({ type: 'declareAttack', seat: NIT, columns: [[ctr]] });
  assert.equal(h.state.battle!.step, 'attackWindow');
  assert.equal(h.state.priority, IT, 'the initiative player, who is defending, is asked first');
});

test('cr:combat.attack-window.general.gravity — a middle column killed in the attack window closes up', () => {
  const h = new Harness(111010);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const a = [tok(h, A, 1, 1), tok(h, A, 1, 1), tok(h, A, 1, 1)];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: a.map(x => [x]) });
  assert.equal(h.state.battle!.step, 'attackWindow');
  const g = new E(h.state); g.destroy(g.entity(a[1]!)!, 'dies'); g.settle();
  assert.deepEqual(h.state.battle!.columns, [[a[0]], [a[2]]]);
  finishBattle(h);
});

test('cr:combat.attack-window.general.still-present — the attacking player stays present after its only attacker is destroyed in the attack window', () => {
  const h = new Harness(111012);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = tok(h, A, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  const g = new E(h.state); g.destroy(g.entity(atk)!, 'dies'); g.settle();
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: h.state.battle!.defender, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'afterWindow');
  assert.ok(h.state.regions[region]!.presentSeats.includes(A), 'still present in the after combat step');
  finishBattle(h);
});

/* ── blocking ───────────────────────────────────────────────────────────── */

test('cr:combat.blocks.general.empty-columns — blocking the first and third of three columns leaves the middle unblocked, and nothing closes up', () => {
  const h = new Harness(111011);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = [tok(h, A, 1, 9), tok(h, A, 2, 9), tok(h, A, 1, 9)];
  const d0 = tok(h, D, 1, 9), d2 = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: a.map(x => [x]) });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d0], 2: [d2] } });
  new E(h.state).settle();
  assert.deepEqual(Object.keys(h.state.battle!.blocks), ['0', '2']);
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 28, 'only the middle column connected');
  finishBattle(h);
});

// Only the first clause of this rule is asserted here: the empty blocking
// column keeps its place. The engine reads the two blockers as adjacent,
// which the rule says they are not (an engine divergence filed against the
// rule); that half is deliberately not asserted.
test('cr:combat.blocks.general.gap-adjacency — an empty middle blocking column keeps its place between blockers on the first and third columns', () => {
  const h = new Harness(211004);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = [tok(h, A, 1, 9), tok(h, A, 1, 9), tok(h, A, 1, 9)];
  const d0 = tok(h, D, 1, 9), d2 = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: a.map(x => [x]) });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d0], 2: [d2] } });
  assert.deepEqual(Object.keys(h.state.battle!.blocks), ['0', '2'], 'the empty middle blocking column keeps its place');
  assert.deepEqual(h.state.battle!.blocks[0], [d0]);
  assert.deepEqual(h.state.battle!.blocks[2], [d2]);
  finishBattle(h);
});

test('cr:combat.blocks.general.locked — blocks cannot be declared a second time in the block window', () => {
  const h = new Harness(111016);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = [tok(h, A, 1, 9), tok(h, A, 1, 9)];
  const d = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(x => [x]) });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] } });
  passTo(h, D);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [d] } }), /not your block step/);
  finishBattle(h);
});

test('cr:combat.blocks.general.one-column — one unit may not block two attacking columns', () => {
  const h = new Harness(111017);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = [tok(h, A, 1, 9), tok(h, A, 1, 9)];
  const d = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(x => [x]) });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d], 1: [d] } }), /only block in one column/);
});

test('cr:combat.blocks.who.recent — a unit that entered the defending region during the attack window may block', () => {
  const h = new Harness(111013);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const fresh = tok(h, D, 1, 9);                     // enters during the attack window
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [fresh] } });
  assert.deepEqual(h.state.battle!.blocks[0], [fresh]);
  finishBattle(h);
});

test('cr:combat.blocks.who.not-sent — a unit may not both block and be sent to counterattack', () => {
  const h = new Harness(111014);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const d = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d] }, send: [d] }), /blockers cannot also be sent/);
});

test('cr:combat.blocks.counterattack.second-round — in round 2 the defender may not send counterattackers', noCounterCounterattack);

test('cr:combat.blocks.side.blocks-nothing — a side-block beside a lone Sneaky attacker is allowed and the Sneaky unit is still unblocked', () => {
  const h = new Harness(111004);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const mantid = spawn(h, A, 'Whispering Mantid');   // 3/2 Sneaky
  const s = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mantid]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [s] } }), /Sneaky/);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [s] } });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 27, 'the Sneaky attacker connected for 3');
});

test('cr:combat.blocks.side.blocks-nothing — a non-Flying unit may side-block beside a Flying attack', () => {
  const h = new Harness(111005);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const flier = spawn(h, A, 'Ephemeral Skywalker');
  const s = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[flier]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [s] } }), /flying/);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [s] } });
  assert.deepEqual(Object.keys(h.state.battle!.blocks), ['1']);
  finishBattle(h);
});

test('cr:combat.blocks.side.adjacency — a side-blocker is adjacent to the blocker beside it', () => {
  const h = new Harness(111006);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const b0 = tok(h, D, 1, 9), s = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0], 1: [s] } });
  const g = new E(h.state);
  assert.deepEqual(g.adjacentInFormation(s).map(u => u.id), [b0]);
  assert.deepEqual(g.adjacentInFormation(b0).map(u => u.id), [s]);
  finishBattle(h);
});

/* ── block window ───────────────────────────────────────────────────────── */

test('cr:combat.block-window.late-blocker.when — between the Swift and normal sub-steps a Tiderunner put in front of the unblocked normal column blocks it for the normal sub-step', () => {
  const h = new Harness(111007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');           // 2/1 {Swift}
  const plain = tok(h, A, 1, 5);
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [plain]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'damageWindow', 'a window between the sub-steps');
  assert.equal(h.state.players[D]!.life, 28, 'the Swift column struck');
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tiderunner Initiate') });
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => /^column 2, blocking it/.test(o.label));
  assert.ok(i >= 0, dec.options.map(o => o.label).join(' | '));
  h.do({ type: 'decide', seat: dec.seat, choice: i });
  pass(h); pass(h);
  const runner = unitsOf(h, D).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(h.state.battle!.blocks[1]?.includes(runner.id));
  let guard = 10;
  while ((h.state.battle?.step as string | undefined) !== 'afterWindow' && guard-- > 0) pass(h);
  assert.equal(h.state.players[D]!.life, 28, 'the normal column hit the Tiderunner, not the player');
  assert.equal(ent(h, runner.id)!.damage, 1);
  finishBattle(h);
});

test('cr:combat.block-window.late-blocker.when — no blocking spot is offered in the after combat window', () => {
  const h = new Harness(111008);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  tok(h, A, 1, 9);
  const atk = unitsOf(h, A)[0]!.id;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.ok(new E(h.state).formationSlots(D).some(s => s.spot.kind === 'block'), 'offered in the block window');
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'afterWindow');
  assert.ok(!new E(h.state).formationSlots(D).some(s => s.spot.kind === 'block'), 'not after combat damage');
  finishBattle(h);
});

test('cr:combat.block-window.late-blocker.not-declared — no blocked event fires for a unit placed in front of an attacker after blocks', () => {
  const h = new Harness(111009);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 3);
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  passTo(h, D);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tiderunner Initiate') });
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => /blocking it/.test(o.label)) });
  pass(h); pass(h);
  const runner = unitsOf(h, D).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(h.state.battle!.blocks[0]?.includes(runner.id), 'it is blocking');
  assert.ok(!h.events.slice(mark).some(e => e.type === 'blocked' || e.type === 'blocksDeclared'), 'no block event');
  finishBattle(h);
});

test('cr:combat.blocks.general.formation — two blockers in one column stand front and back: they are adjacent to each other and the front one takes the damage', () => {
  const h = new Harness(111022);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const d1 = tok(h, D, 1, 9), d2 = tok(h, D, 1, 9), d3 = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1, d2, d3] } }), /1-2 units/,
    'a formation has only two rows');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1, d2] } });
  const g = new E(h.state);
  assert.deepEqual(g.adjacentInFormation(d1).map(x => x.id), [d2], 'the back blocker is behind the front one');
  assert.deepEqual(g.adjacentInFormation(d2).map(x => x.id), [d1]);
  pass(h); pass(h);
  assert.equal(ent(h, d1)!.damage, 1, 'the front-row blocker took the hit');
  assert.equal(ent(h, d2)!.damage, 0, 'the back-row blocker did not');
  assert.equal(h.state.players[D]!.life, 30);
  finishBattle(h);
});
