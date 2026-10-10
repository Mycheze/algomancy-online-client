/**
 * Comprehensive rules, unit U12 (combat damage) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U12
 * (data/comprehensive-rules/build/probes/U12/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U12.json lists this file in its
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
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, throughDamageWindows,
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
function amountsOffered(h: Harness): number[] {
  return (h.state.decision?.options ?? []).map(o => o.value).filter((v): v is number => typeof v === 'number');
}

/* ── amount ─────────────────────────────────────────────────────────────── */

test('cr:combat.damage.amount.counting — a negative-power unit counts as 0 and does not reduce its column', () => {
  const h = new Harness(91202);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');               // 4/4
  const neg = tok(h, A, -2, 3);
  toNextBattle(h, A);
  assert.equal(new E(h.state).effStats(new E(h.state).entity(neg)!)[0], -2, 'the token really has -2 power');
  h.do({ type: 'declareAttack', seat: A, columns: [[lith, neg]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 4, 'the column deals 4, not 2');
});

/* ── pairing (the Manual p.23 example) ──────────────────────────────────── */

/** Living Forge (2/4) + A Pile of Rubbish (1/1) in one column, blocked by
 *  Tiderunner Initiate (2/2): the damage events of the combat damage step */
function manualP23(): { h: Harness; D: Seat; forge: EntityId; rub: EntityId; tide: EntityId; hits: [unknown, unknown][] } {
  const h = new Harness(91207);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const forge = spawn(h, A, 'Living Forge');
  const rub = spawn(h, A, 'A Pile of Rubbish');
  const tide = spawn(h, D, 'Tiderunner Initiate');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[forge, rub]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [tide] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const hits = h.events.slice(mark).filter(e => e.type === 'damage')
    .map(e => [e.data?.['unit'], e.data?.['n']] as [unknown, unknown]);
  return { h, D, forge, rub, tide, hits };
}

test('cr:combat.damage.pairing.blocked — the Manual p.23 example: Living Forge and A Pile of Rubbish deal 3 to the blocking Tiderunner Initiate, which deals 2 back, and the player takes nothing', () => {
  const { h, D, forge, rub, tide, hits } = manualP23();
  assert.deepEqual(hits.filter(([u]) => u === tide).map(([, n]) => n), [3], 'combined 3 to the Tiderunner');
  assert.deepEqual(hits.filter(([u]) => u === forge).map(([, n]) => n), [2], 'its 2 back, all to Living Forge in front');
  assert.deepEqual(hits.filter(([u]) => u === rub), [], 'none to the back unit');
  assert.equal(h.state.players[D]!.life, 30, 'blocked: nothing to the player');
  finishBattle(h);
});

/* ── assignment ─────────────────────────────────────────────────────────── */

test('cr:combat.damage.assignment — the Manual p.23 example: the blocking half-column damage goes to the front unit first, none to the unit behind it', () => {
  const { h, forge, rub, hits } = manualP23();
  assert.deepEqual(hits.filter(([u]) => u === forge).map(([, n]) => n), [2], 'all 2 to Living Forge in front');
  assert.deepEqual(hits.filter(([u]) => u === rub), [], 'nothing reaches A Pile of Rubbish behind it');
  finishBattle(h);
});

test('cr:combat.damage.assignment.lethal-defined — a Vulnerable 3/7 needs 4 assigned (half its defense rounded UP), not 3', () => {
  const h = new Harness(91203);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const v = tok(h, D, 3, 7);
  toNextBattle(h, A);
  grant(h, atk, 'Piercing');
  grant(h, v, 'Vulnerable');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [v] } });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...amountsOffered(h)), 4, 'the floor is ceil(7/2) = 4');
  assert.ok(!amountsOffered(h).includes(3), '3 (rounded down) is not offered');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 6, 'default: 4 to the unit, 6 to the player');
});

test('cr:combat.damage.assignment.lethal-defined — in a Pure exchange a Deadly column is priced at full defense, not 1', () => {
  const h = new Harness(91222);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 8, 20);
  const b1 = tok(h, D, 1, 3), b2 = tok(h, D, 1, 3);
  toNextBattle(h, A);
  grant(h, atk, 'Deadly');
  grant(h, atk, 'Pure');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...amountsOffered(h)), 3, 'Pure switches Deadly off: the floor is the 3 defense');
  finishBattle(h);
});

test('cr:combat.damage.assignment.lethal-defined — in a Pure exchange a Vulnerable blocker is priced at full defense, not half', () => {
  const h = new Harness(91223);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const b1 = tok(h, D, 1, 6), b2 = tok(h, D, 1, 3);
  toNextBattle(h, A);
  grant(h, b1, 'Vulnerable');
  grant(h, atk, 'Pure');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...amountsOffered(h)), 6, 'Pure switches Vulnerable off: 6, not 3');
  finishBattle(h);
});

test('cr:combat.damage.assignment.lethal-defined — with damage already marked, lethal is the remaining defense', () => {
  const h = new Harness(91224);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 20);
  const b1 = tok(h, D, 1, 6), b2 = tok(h, D, 1, 3);
  toNextBattle(h, A);
  new E(h.state).entity(b1)!.damage = 4;               // already marked: 2 defense left
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...amountsOffered(h)), 2, '6 - 4 marked = 2');
  finishBattle(h);
});

test('cr:combat.damage.assignment.lethal-defined — in an Unaware exchange the front blocker is priced at its PRINTED defense, less marked damage', () => {
  const h = new Harness(91225);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb');                    // 5/6 {Unaware}
  const b1 = tok(h, D, 1, 3), b2 = tok(h, D, 1, 3);
  toNextBattle(h, A);
  new E(h.state).entity(b1)!.counters = 3;             // effectively 4/6
  new E(h.state).entity(b1)!.damage = 1;               // printed 3 - 1 marked = 2
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'assignDamage');
  assert.equal(Math.min(...amountsOffered(h)), 2, 'printed 3 less 1 marked, not the 6 its counters give it');
  finishBattle(h);
});

/* ── dealing ────────────────────────────────────────────────────────────── */

test('cr:combat.damage.dealing.prevention — a shielded blocker dealt COMBAT damage gets no damage event, nothing marked, and no Deadly kill', () => {
  const h = new Harness(91201);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 20);
  const tomb = spawn(h, D, 'Awoken Tomb');             // 0/5, "when I am dealt damage"
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  grant(h, atk, 'Deadly');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: tomb });
  pass(h); pass(h);
  assert.equal(ent(h, tomb)!.damageShield, 'Phytochemical Protection');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [tomb] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const dmgEvents = h.events.slice(mark).filter(e => e.type === 'damage' && e.data?.['unit'] === tomb);
  assert.equal(dmgEvents.length, 0, 'no damage event for the shielded unit');
  assert.ok(ent(h, tomb), 'Deadly did not kill through the shield');
  assert.equal(ent(h, tomb)!.damage, 0, 'nothing marked');
  finishBattle(h);
});

test('cr:combat.damage.dealing.regroup — damage from the first battle of the turn is still marked when the second battle starts, and is removed in regroup', () => {
  const h = new Harness(91221);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 2, 5);
  const blk = tok(h, D, 2, 5);
  const counter = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] }, send: [counter] });
  pass(h); pass(h);                                    // combat damage of battle 1
  assert.equal(ent(h, atk)!.damage, 2, 'attacker marked 2');
  assert.equal(ent(h, blk)!.damage, 2, 'blocker marked 2');
  pass(h); pass(h);                                    // after-combat window, then battle 2
  assert.equal(h.state.phase, 'battle');
  assert.equal(h.state.battle!.round, 2, 'the first battle is over and the second has started');
  assert.equal(ent(h, atk)!.damage, 2, 'the attacker still carries its damage after its battle ended');
  assert.equal(ent(h, blk)!.damage, 2, 'and so does the blocker');
  finishBattle(h);
  assert.notEqual(h.state.phase, 'battle');
  assert.equal(ent(h, atk)!.damage, 0, 'regroup removed it');
  assert.equal(ent(h, blk)!.damage, 0, 'regroup removed it');
});

/* ── split / sub-steps ──────────────────────────────────────────────────── */

test('cr:combat.damage.split.empty-substep — a column that gains Sluggish after the last scheduled sub-step strikes with no window before it, then after combat begins', () => {
  const h = new Harness(91204);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');            // 2/1 {Swift}
  const one = tok(h, A, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [one]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal']);
  assert.equal(h.state.battle!.step, 'damageWindow');
  assert.equal(h.state.players[D]!.life, 28);
  grant(h, dune, 'Sluggish');
  let windows = 0;
  let guard = 20;
  let lastPending: unknown = h.state.battle!.pendingSub;
  while (h.state.battle?.step === 'damageWindow' && guard-- > 0) {
    if (h.state.battle.pendingSub !== lastPending) { windows++; lastPending = h.state.battle.pendingSub; }
    pass(h);
  }
  assert.equal(windows, 0, 'no second window opened (before the Sluggish strike)');
  assert.equal(h.state.battle?.step, 'afterWindow', 'straight on to after combat');
  assert.equal(h.state.players[D]!.life, 30 - 2 - 1 - 2, 'the Drifter column struck again in Sluggish');
  finishBattle(h);
});

test('cr:combat.damage.split.empty-substep — a scheduled sub-step keeps its window though every striker scheduled for it died', () => {
  const h = new Harness(91205);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');            // Swift column
  const one = tok(h, A, 1, 1);                          // the only normal striker
  const slug = spawn(h, A, 'Ambling Mountaintop');      // {Sluggish}
  const killer = spawn(h, D, 'Dune Drifter');           // Swift blocker kills the 1/1 in the Swift sub-step
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [one], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [killer] } });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal', 'Sluggish']);
  assert.equal(h.state.battle!.pendingSub, 'normal');
  assert.ok(!ent(h, one), 'the only normal striker died in the Swift sub-step');
  let guard = 20;
  while (h.state.battle?.step === 'damageWindow' && h.state.battle.pendingSub === 'normal' && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: h.state.decision.pickOrder ? h.state.decision.options.map((_, i) => i) : 0 });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'damageWindow', 'the empty-but-scheduled normal sub-step still opened a window');
  assert.equal(h.state.battle!.pendingSub, 'Sluggish');
  finishBattle(h);
});

test('cr:combat.damage.substeps.swift-and-sluggish — a Swift and Sluggish column strikes in the Swift and Sluggish sub-steps, NOT in normal', () => {
  const h = new Harness(91206);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const rw = spawn(h, A, 'Rime Wraith');               // 2/1 {Swift}{Sluggish}
  const one = tok(h, A, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rw], [one]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal', 'Sluggish']);
  assert.equal(h.state.players[D]!.life, 28, 'Swift: the Wraith column');
  let guard = 20;
  while (h.state.battle?.pendingSub === 'normal' && h.state.battle.step === 'damageWindow' && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.pendingSub, 'Sluggish');
  assert.equal(h.state.players[D]!.life, 27, 'normal: only the 1/1 struck; the Wraith column did not');
  throughDamageWindows(h);
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 25, 'Sluggish: the Wraith column struck again');
});

test('cr:combat.damage.substeps.column-attributes — a unit leaving a column takes the Swift it shared with it', () => {
  const h = new Harness(91208);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const dune = spawn(h, A, 'Dune Drifter');
  const lith = spawn(h, A, 'Lithoghul');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune, lith]] });
  assert.deepEqual(h.q.combatSubStepsOf(ent(h, lith)!), ['Swift'], 'shared Swift');
  const g = new E(h.state);
  g.recall(g.entity(dune)!);
  g.settle();
  assert.deepEqual(h.q.combatSubStepsOf(ent(h, lith)!), ['normal'], 'lost at once when the Drifter left');
  finishBattle(h);
});

/* ── triggers ───────────────────────────────────────────────────────────── */

/** the board of 239's RAQ batch: Lithoghul attacks into a Geode (a dies
 *  trigger) beside a Wisp (an after-combat trigger), both the defender's;
 *  the defender orders the batch as `order` (null: just read the decision) */
function geodeWispBatch(order: number[] | null): { labels: string[]; kind: string | undefined; stack: string[] } {
  const h = new Harness(23904);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');
  const geo = spawn(h, D, 'Geode');
  spawn(h, D, 'Wisp');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  while (h.state.decision?.kind === 'assignDamage') h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  const dec = h.state.decision;
  const labels = (dec?.options ?? []).map(o => o.label);
  if (order === null) return { labels, kind: dec?.kind, stack: [] };
  h.do({ type: 'decide', seat: D, choice: order });
  let guard = 10;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    if (d.kind === 'orderTriggers') break;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  return { labels, kind: dec?.kind, stack: h.state.stack.map(s => s.label) };
}

test('cr:combat.damage.triggers.unsplit — one seat may put its after-combat trigger above OR below its combat-death trigger (free order)', () => {
  const first = geodeWispBatch(null);
  assert.equal(first.kind, 'orderTriggers');
  const wisp = first.labels.findIndex(l => /Wisp/.test(l));
  const geode = first.labels.findIndex(l => /Geode/.test(l));
  assert.ok(wisp >= 0 && geode >= 0, 'one decision orders the death trigger and the after-combat trigger together');
  const results = [[wisp, geode], [geode, wisp]].map(order => geodeWispBatch(order).stack);
  for (const r of results) {
    assert.ok(r.some(l => /Wisp/.test(l)) && r.some(l => /Geode/.test(l)), 'both triggers are on the stack');
  }
  assert.notDeepEqual(results[0], results[1], 'the two orders give two different stacks: the seat chose freely');
  assert.ok(results.some(r => r.findIndex(l => /Wisp/.test(l)) < r.findIndex(l => /Geode/.test(l))),
    'one legal stack has the after-combat trigger BELOW the damage-caused one');
  assert.ok(results.some(r => r.findIndex(l => /Wisp/.test(l)) > r.findIndex(l => /Geode/.test(l))),
    'and one has it ABOVE');
});

/* ── overview, sub-steps, split, pairing, amount, assignment timing (tester) ── */

/** the event types since `mark` */
const types = (h: Harness, mark: number): string[] => h.events.slice(mark).map(e => e.type);

test('cr:combat.damage.overview — the step begins only once blocks are declared and both players pass, and the after combat step follows it', () => {
  const h = new Harness(91240);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 2, 5);
  const blk = tok(h, D, 2, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  const mark = h.events.length;
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  assert.equal(h.state.battle!.step, 'blockWindow', 'blocks declared: a priority window, not damage');
  pass(h);
  assert.ok(!types(h, mark).includes('combatDamage'), 'one pass is not enough');
  assert.equal(ent(h, atk)!.damage, 0);
  pass(h);
  const t = types(h, mark);
  const cd = t.indexOf('combatDamage');
  assert.ok(cd >= 0, 'both passed: the combat damage step');
  assert.equal(ent(h, atk)!.damage, 2);
  assert.equal(ent(h, blk)!.damage, 2);
  assert.ok(t.indexOf('afterCombat') > cd, 'the after combat step follows it');
  assert.equal(h.state.battle!.step, 'afterWindow');
  finishBattle(h);
});

test('cr:combat.damage.overview.per-region — each battle round has its own combat damage step, in the region that round attacks', () => {
  const h = new Harness(91241);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 5);
  const ctr = tok(h, D, 1, 5);
  toNextBattle(h, A);
  const g = new E(h.state);
  const homeA = g.homeRegion(A), homeD = g.homeRegion(D);
  assert.notEqual(homeA, homeD);
  const mark = h.events.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr] });
  pass(h); pass(h);
  pass(h); pass(h);
  h.do({ type: 'declareAttack', seat: D, columns: [[ctr]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  finishBattle(h);
  const regions = h.events.slice(mark).filter(e => e.type === 'combatDamage').map(e => e.data?.['region']);
  assert.deepEqual(regions, [homeD, homeA]);
});

test('cr:combat.damage.overview.per-region — a battle round with no attack has no combat damage step', () => {
  const h = new Harness(91242);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ctr = tok(h, D, 1, 5);
  tok(h, A, 1, 5);
  toNextBattle(h, A);
  const g = new E(h.state);
  const homeA = g.homeRegion(A);
  const mark = h.events.length;
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  assert.ok(!types(h, mark).includes('combatDamage'), 'the region attacked by nobody has no damage step');
  h.do({ type: 'declareAttack', seat: D, columns: [[ctr]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  finishBattle(h);
  const regions = h.events.slice(mark).filter(e => e.type === 'combatDamage').map(e => e.data?.['region']);
  assert.deepEqual(regions, [homeA]);
});

test('cr:combat.damage.overview.simultaneous — two 3/3s in one exchange both deal their damage before either dies', () => {
  const h = new Harness(91243);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 3);
  const blk = tok(h, D, 3, 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const ev = h.events.slice(mark);
  const dmg = ev.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'damage');
  const died = ev.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'died');
  assert.equal(dmg.length, 2);
  assert.equal(died.length, 2);
  assert.ok(Math.max(...dmg.map(([, i]) => i)) < Math.min(...died.map(([, i]) => i)), 'all damage before any death');
  assert.ok(!ent(h, atk) && !ent(h, blk));
  finishBattle(h);
});

test('cr:combat.damage.overview.simultaneous — a Swift attacker deals its damage first: it kills a 2/2 blocker that never strikes back', () => {
  const h = new Harness(91244);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');            // 2/1 {Swift}
  const blk = tok(h, D, 2, 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  finishBattle(h);
  assert.ok(!ent(h, blk), 'the blocker died');
  assert.ok(ent(h, dune), 'the 2/1 Drifter survived: no simultaneous strike back');
});

test('cr:combat.damage.substeps — Swift, then normal, then Sluggish, and the two halves of one column strike in their own sub-steps', () => {
  const h = new Harness(91245);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');            // 2/1 {Swift}
  const slug = spawn(h, A, 'Ambling Mountaintop');     // {Sluggish}
  const blk = tok(h, D, 1, 5);
  toNextBattle(h, A);
  const slugP = new E(h.state).effStats(new E(h.state).entity(slug)!)[0];
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal', 'Sluggish']);
  assert.equal(h.state.battle!.pendingSub, 'normal');
  assert.equal(ent(h, blk)!.damage, 2, 'Swift: the attacking half struck');
  assert.equal(ent(h, dune)!.damage, 0, 'the blocking half has not struck yet');
  assert.equal(h.state.players[D]!.life, 30, 'the Sluggish column has not struck');
  let guard = 20;
  while (h.state.battle?.pendingSub === 'normal' && h.state.battle.step === 'damageWindow' && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.pendingSub, 'Sluggish');
  assert.ok(!ent(h, dune), 'normal: the blocking half struck the Drifter');
  assert.equal(h.state.players[D]!.life, 30, 'still no Sluggish damage');
  throughDamageWindows(h);
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - slugP, 'Sluggish: last');
});

test('cr:combat.damage.split — no Swift or Sluggish: one normal sub-step and no window inside the step, whatever other attributes are present', () => {
  const h = new Harness(91246);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = tok(h, A, 3, 5), a2 = tok(h, A, 3, 5), a3 = tok(h, A, 3, 5);
  const b1 = tok(h, D, 1, 2);
  toNextBattle(h, A);
  grant(h, a1, 'Piercing'); grant(h, a2, 'Deadly'); grant(h, a3, 'Powerful');
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2], [a3]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1] } });
  pass(h); pass(h);
  let guard = 20;
  while (h.state.decision?.kind === 'assignDamage' && guard-- > 0) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.deepEqual(h.state.battle!.damageSubs, ['normal'], 'unsplit');
  assert.equal(h.state.battle!.step, 'afterWindow', 'straight to after combat: no window inside the step');
  finishBattle(h);
});

test('cr:combat.damage.split — a Swift attacking half over a normal blocking half splits the step into two sub-steps with a window between them', () => {
  const h = new Harness(91247);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');
  const blk = tok(h, D, 1, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal'], 'split');
  assert.equal(h.state.battle!.step, 'damageWindow');
  finishBattle(h);
});

test('cr:combat.damage.pairing — an unblocked attacking column hits the player, a blocked one hits its blocker, and the blocker hits the column it blocks', () => {
  const h = new Harness(91248);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 3, 5), a1 = tok(h, A, 4, 5);
  const b0 = tok(h, D, 2, 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  pass(h); pass(h);
  assert.equal(ent(h, b0)!.damage, 3, 'blocked column: its 3 to the blocker');
  assert.equal(ent(h, a0)!.damage, 2, 'blocker: its 2 to the column it blocks');
  assert.equal(ent(h, a1)!.damage, 0, 'nothing to the unblocked column');
  assert.equal(h.state.players[D]!.life, 30 - 4, 'unblocked column: its 4 to the player');
  finishBattle(h);
});

test('cr:combat.damage.amount — a column deals the combined power of its units as it is when it strikes, read after a pump between sub-steps', () => {
  const h = new Harness(91249);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');            // 2/1 {Swift}
  const x = tok(h, A, 1, 1), y = tok(h, A, 2, 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [x, y]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'damageWindow');
  assert.equal(h.state.players[D]!.life, 28);
  new E(h.state).entity(x)!.counters = 2;              // 1/1 -> 3/3 before it strikes
  assert.equal(new E(h.state).effStats(new E(h.state).entity(x)!)[0], 3);
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 28 - (3 + 2), 'the column dealt 3 + 2, counted when it struck');
});

test('cr:combat.damage.assignment.timing — both columns are asked for their split before any damage of the sub-step is dealt', () => {
  const h = new Harness(91250);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 10, 20), a1 = tok(h, A, 10, 20);
  const b0 = tok(h, D, 1, 3), b1 = tok(h, D, 1, 3), b2 = tok(h, D, 1, 3), b3 = tok(h, D, 1, 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0, b1], 1: [b2, b3] } });
  const mark = h.events.length;
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'assignDamage', 'the first split is asked');
  assert.ok(!types(h, mark).includes('damage'), 'nothing dealt yet');
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });
  assert.equal(h.state.decision?.kind, 'assignDamage', 'the second split is asked');
  assert.ok(!types(h, mark).includes('damage'), 'still nothing dealt after the first answer');
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });
  assert.ok(types(h, mark).filter(t => t === 'damage').length >= 4, 'now all of it is dealt');
  finishBattle(h);
});
