/* R106 — STAT LAYER 6, {Unaware}: everything in the interaction reads at the
 * numbers PRINTED on the card.
 *
 * {Unaware} was the last attribute in the pool with zero engine references
 * (CARD-TODO #5). Three cards printed it — Bubb (5/6), Trashling (2/2, which
 * donates it as a {Virus}) and Haboob (a spell) — and all three were plain
 * vanilla bodies, which is exactly the shape that hid Harbinger: an attribute
 * that arrives, is displayed, and is read by nothing.
 *
 * Owner ruling, 2026-08-23, stated operationally:
 *
 *   "Unaware means that it looks ONLY at what is the literal printed text on
 *    all cards 'involved' (self or others when dealing damage or in combat
 *    when dealing/receiving). So Bubb blocking a Robot token would kill it (do
 *    Bubb, it has 0 power and 0 defense), no matter how many +1/+1 counters it
 *    has. Bubb would also survive 100 -1/-1 counters just fine. Haboob kills
 *    anything that has 1 defense printed at the card level."
 *
 * Two halves:
 *
 *  1. SELF — an Unaware card's own numbers never move off its printed face,
 *     for any purpose, the state-based death check included. Counters, temp
 *     deltas, auras, {Tough}, {Inverted} — and, unlike {Inverted} one layer
 *     up, base REWRITES too: "your units are base 3/3" is not literal printed
 *     text on Bubb's card.
 *  2. PAIRWISE — in an interaction involving an Unaware card, EVERY
 *     participant reads at printed, not just the Unaware one. Scoped, exactly
 *     as the owner scoped it, to dealing/receiving damage and to combat.
 *     Targeting is out of scope and is R106's one open edge.
 *
 * The three worked examples above are named tests below, quoting him.
 *
 * The NEGATIVE CONTROLS at the bottom are load-bearing, and more so than
 * usual, because TWO different collapses are in play: an implementation that
 * read every unit at printed all the time would satisfy every assertion above
 * them.
 *
 * Seeds 9200-9299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs,
  pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';

/** spawn a vanilla stat token (no printed triggers, no attributes). Its
 * `tokenStats` ARE its printed face — what it was created as. */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

/** a Robot N — the owner's own example. The card is printed 0/0 and carries
 * its whole size in +1/+1 counters ("I spawn with X +1/+1 counters on me"),
 * which is what makes it the sharpest possible test of "printed". */
function spawnRobot(h: Harness, seat: Seat, n: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Robot', e.homeRegion(seat), { token: true, counters: n });
  e.settle();
  return u.id;
}

const effAttrs = (h: Harness, id: EntityId): Set<string> =>
  new E(h.state).effAttrs(ent(h, id)!);

/* ══ the owner's three worked examples ═══════════════════════════════════ */

test('"Bubb blocking a Robot token would kill it… no matter how many +1/+1 counters it has"', () => {
  // "(do Bubb, it has 0 power and 0 defense)" — the Robot is printed 0/0, so
  // in the exchange it deals nothing and is already dead. Run at three sizes,
  // because "no matter how many" is the load-bearing half of the sentence.
  for (const [seed, n] of [[9200, 1], [9201, 7], [9202, 20]] as const) {
    const h = new Harness(seed);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const robot = spawnRobot(h, A, n);
    const bubb = spawn(h, D, 'Bubb');                        // 5/6
    assert.deepEqual(effStats(h, robot), [n, n],
      `outside any interaction a Robot ${n} really is an ${n}/${n}`);
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[robot]] });
    pass(h); pass(h);
    h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
    pass(h); pass(h);                                        // damage
    assert.ok(!ent(h, robot), `the Robot ${n} read its printed 0 defense and died`);
    assert.ok(ent(h, bubb), 'Bubb survived');
    assert.equal(ent(h, bubb)!.damage, 0,
      `and took NOTHING: the Robot ${n} deals its printed 0 power, not ${n}`);
    finishBattle(h);
  }
});

test('"Bubb would also survive 100 -1/-1 counters just fine"', () => {
  const h = new Harness(9203);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  const g = new E(h.state);
  g.addCounters(g.entity(bubb)!, -100);                      // addCounters runs checkDeaths
  h.state = g.s;
  assert.ok(ent(h, bubb), 'the state-based death check never fired');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'because Bubb reads its printed 5/6');
  assert.equal(ent(h, bubb)!.counters, -100, 'the counters are ON it — they are just not read');
});

test('"Haboob kills anything that has 1 defense printed at the card level"', () => {
  const h = new Harness(9204);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  // three victims, identical in play and different on their faces
  const pumped = spawnToken(h, A, 1, 1);                     // printed 1 defense
  ent(h, pumped)!.counters = 4;                              // → a 5/5 in play
  const tough = spawnToken(h, A, 1, 2);                      // printed 2 defense
  ent(h, tough)!.counters = 4;                               // → a 5/6 in play
  const bubb = spawn(h, A, 'Bubb');                          // printed 6 defense
  assert.deepEqual(effStats(h, pumped), [5, 5], 'the pumped 1/1 is a 5/5 to everything else');
  giveResources(h, D, 'earth', 4);                           // Haboob: ee/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pumped], [tough], [bubb]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haboob') });
  pass(h); pass(h);                                          // resolve
  assert.ok(!ent(h, pumped), '1 printed defense: dead, whatever the counters say');
  assert.ok(ent(h, tough), '2 printed defense: alive');
  assert.equal(ent(h, tough)!.damage, 1, 'and marked with the 1 it was dealt');
  assert.ok(ent(h, bubb), 'Bubb itself takes its 1 on a printed 6');
  assert.equal(ent(h, bubb)!.damage, 1);
  finishBattle(h);
});

/* ══ the SELF half ═══════════════════════════════════════════════════════ */

test('a +1/+1 counter on Bubb leaves it a 5/6', () => {
  const h = new Harness(9210);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'printed 5/6 to begin with');
  ent(h, bubb)!.counters = 1;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'the counter is not printed text, so it is not read');
});

test('a temporary -2/-2 on Bubb leaves it a 5/6', () => {
  const h = new Harness(9211);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  ent(h, bubb)!.tempPower = -2;
  ent(h, bubb)!.tempToughness = -2;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'until-regroup deltas are not printed text either');
});

test('a lord\'s aura leaves Bubb a 5/6', () => {
  const h = new Harness(9212);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  spawn(h, A, 'Glowhaven Elder');            // "Your other units gain +1/+1"
  assert.deepEqual(effStats(h, bubb), [5, 6], 'a continuous +1/+1 static is not printed on Bubb');
  // the aura really is radiating — it is Bubb that refuses it, not the Elder
  // that is switched off
  const lines = new E(h.state).projections(ent(h, bubb)!);
  assert.ok(lines.some(l => l.from === 'Glowhaven Elder' && l.dp === 1 && l.dt === 1),
    'the Elder still projects onto Bubb; layer 6 is what discards it');
});

test('a base REWRITE is ignored too — a Statweaver does NOT make Bubb a 3/3', () => {
  // The one place R106 parts company with R93's {Inverted}. R93 keeps base
  // rewrites because they are what {Inverted} inverts FROM; R106 drops them
  // because "your units are base 3/3" is not literal printed text on Bubb's
  // card. Layer 6 returns layer 1 alone.
  const h = new Harness(9213);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  const plain = spawnToken(h, A, 7, 7);
  spawn(h, A, 'Aberrant Statweaver');         // "Your units are base 3/3"
  assert.deepEqual(effStats(h, plain), [3, 3], 'the rewrite really is landing on the board');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'and Bubb reads straight past it');
  // the until-regroup stamp, the other half of layer 2, is ignored the same way
  new E(h.state).setBase(ent(h, bubb)!, 4, 4);
  assert.deepEqual(effStats(h, bubb), [5, 6], '"becomes a base 4/4" is not printed text either');
});

test('{Tough} donated onto Bubb does nothing', () => {
  const h = new Harness(9214);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  const control = spawn(h, A, 'Rampart Guardian');            // 0/4 {Tough}
  assert.deepEqual(effStats(h, control), [0, 8], 'Tough doubles a NON-Unaware toughness');
  giveResources(h, A, 'earth', 2);                            // Rampart Guardian: e/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Rampart Guardian'), hostId: bubb });
  assert.ok(ownAttrs(h, bubb).has('Tough'), 'Bubb really has {Tough} now');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'and it is a 5/6, not a 5/12');
});

test('{Inverted} and {Unaware} on one unit: layer 6 goes last, so Bubb is a 5/6', () => {
  const h = new Harness(9215);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  ent(h, bubb)!.counters = 2;
  giveResources(h, A, 'earth', 2);                            // Reality Bender: e/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: bubb });
  assert.ok(ownAttrs(h, bubb).has('Inverted'), 'the [Augment] donated {Inverted}');
  // without layer 6 this is 2*5-7 / 2*6-8 = 3/4
  assert.deepEqual(effStats(h, bubb), [5, 6], 'layer 5 inverts a delta layer 6 has already discarded');
});

/* ══ the PAIRWISE half ═══════════════════════════════════════════════════ */

test('Bubb blocks a pumped 3/3 and takes the attacker\'s PRINTED 3, not its 5', () => {
  const h = new Harness(9220);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  ent(h, atk)!.counters = 2;                                   // +2/+2 → 5/5
  const bubb = spawn(h, D, 'Bubb');                            // 5/6
  assert.deepEqual(effStats(h, atk), [5, 5], 'the attacker is a 5/5 to everyone else');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  assert.ok(!effAttrs(h, atk).has('Unaware'),
    'the attacker does not GAIN the attribute — it is the exchange that is collapsed');
  pass(h); pass(h);                                            // damage
  assert.ok(ent(h, bubb), 'Bubb survived');
  assert.equal(ent(h, bubb)!.damage, 3,
    'THREE, the attacker\'s printed power — the +2/+2 is not in the exchange');
  assert.ok(!ent(h, atk), 'and Bubb\'s printed 5 killed a printed 3 defense');
  finishBattle(h);
});

test('a pumped attacker cannot kill Bubb through the collapse', () => {
  // The mirror of the test above, and the one that would go red if only the
  // SELF half had been built: a 3/3 grown to 9/9 still swings a printed 3.
  const h = new Harness(9221);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  ent(h, atk)!.counters = 6;                                   // → 9/9, lethal on a 5/6
  const bubb = spawn(h, D, 'Bubb');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);
  assert.ok(ent(h, bubb), 'a 9/9 that reads as a 3/3 does not kill a 5/6');
  assert.equal(ent(h, bubb)!.damage, 3);
  finishBattle(h);
});

test('an Unaware ATTACKER collapses the exchange the same way a blocker does', () => {
  const h = new Harness(9222);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb');                            // attacking this time
  const blocker = spawnRobot(h, D, 9);                         // a Robot 9 = 9/9
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);
  assert.ok(!ent(h, blocker), 'the Robot 9 blocked at its printed 0/0 and died');
  assert.equal(ent(h, bubb)!.damage, 0, 'dealing Bubb its printed 0 power back');
  finishBattle(h);
});

test('two units FIGHT: Bubb reads a Robot 7 as a 0/0 and kills it outright', () => {
  const h = new Harness(9223);
  toDeployment(h);
  const A = h.state.initiative;
  const bubb = spawn(h, A, 'Bubb');
  const robot = spawnRobot(h, A, 7);
  giveResources(h, A, 'earth', 4);                             // Battle: ee/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb], [robot]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: h.state.battle!.defender, blocks: {} });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Battle') });
  pick(h, { unit: bubb });
  pick(h, { unit: robot });
  pass(h); pass(h);                                            // resolve the fight
  assert.ok(!ent(h, robot), 'a fight is an interaction: the Robot fought at printed 0/0');
  assert.ok(ent(h, bubb), 'Bubb took the Robot\'s printed 0 power');
  assert.equal(ent(h, bubb)!.damage, 0);
  finishBattle(h);
});

/* ══ column sharing (R19): the decision, unchanged ═══════════════════════ */

test('{Unaware} is column-shared: a pumped column-mate of Bubb fights at ITS printed stats', () => {
  const h = new Harness(9230);
  toDeployment(h);
  const A = h.state.initiative;
  const mate = spawnToken(h, A, 2, 2);
  ent(h, mate)!.counters = 2;                                  // → 4/4
  const bubb = spawn(h, A, 'Bubb');
  assert.deepEqual(effStats(h, mate), [4, 4], 'out of formation the counters count normally');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mate, bubb]] });
  assert.ok(effAttrs(h, mate).has('Unaware'), 'the column shares {Unaware} up and down');
  assert.deepEqual(effStats(h, mate), [2, 2],
    'so the mate reads at printed too — Caleb: attributes are shared "in all situations"');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'Bubb itself, unchanged');
  finishBattle(h);
  assert.deepEqual(effStats(h, mate), [4, 4], 'and the mate gets its counters back when the formation breaks');
});

test('column sharing runs both ways: a {Tough} column-mate of Bubb loses its own doubling', () => {
  const h = new Harness(9231);
  toDeployment(h);
  const A = h.state.initiative;
  const rg = spawn(h, A, 'Rampart Guardian');                  // 0/4 {Tough}
  const bubb = spawn(h, A, 'Bubb');
  assert.deepEqual(effStats(h, rg), [0, 8], 'alone, Tough doubles it');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rg, bubb]] });
  assert.ok(effAttrs(h, rg).has('Unaware') && effAttrs(h, bubb).has('Tough'),
    'the column shares both attributes in both directions');
  assert.deepEqual(effStats(h, rg), [0, 4], 'the Guardian is Unaware now, so it reads its printed 0/4');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'and the borrowed Tough does nothing to Bubb');
  finishBattle(h);
});

/* ══ Trashling: {Unaware} donated by a {Virus} ═══════════════════════════ */

test('Trashling donating {Unaware} drops its HOST to the host\'s printed stats', () => {
  const h = new Harness(9240);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawnToken(h, A, 3, 3);
  ent(h, host)!.counters = 2;                                  // → 5/5
  assert.deepEqual(effStats(h, host), [5, 5], 'a plain pumped 5/5 before the virus lands');
  giveResources(h, A, 'metal', 2);                             // Trashling: m/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Trashling'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'), 'the type-line [Augment] donated {Unaware}');
  assert.deepEqual(effStats(h, host), [3, 3],
    'and the host reads its printed 3/3 — the virus takes its buffs away by making it stop counting them');
  // continuous, not a stamp: counters gained AFTER the virus are ignored too
  ent(h, host)!.counters = 6;
  assert.deepEqual(effStats(h, host), [3, 3], 'later counters do nothing either');
});

test('Trashling played as a unit is a 2/2 that stays a 2/2', () => {
  const h = new Harness(9241);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tr = spawn(h, A, 'Trashling');
  ent(h, tr)!.counters = 3;
  spawn(h, A, 'Glowhaven Elder');
  assert.deepEqual(effStats(h, tr), [2, 2], 'its own counters and the lord both bounce off');
});

/* ══ the negative controls ═══════════════════════════════════════════════ */

test('NEGATIVE CONTROL: a unit WITHOUT {Unaware} still gets its counters, its aura and its {Tough}', () => {
  const h = new Harness(9290);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const plain = spawnToken(h, A, 2, 2);
  assert.deepEqual(effStats(h, plain), [2, 2]);
  ent(h, plain)!.counters = 1;
  assert.deepEqual(effStats(h, plain), [3, 3], 'the +1/+1 counter counts');
  spawn(h, A, 'Glowhaven Elder');                              // +1/+1 to your other units
  assert.deepEqual(effStats(h, plain), [4, 4], 'the lord\'s aura counts');
  ent(h, plain)!.tempPower = -1;
  assert.deepEqual(effStats(h, plain), [3, 4], 'a temp delta counts');
  const rg = spawn(h, A, 'Rampart Guardian');                  // 0/4 {Tough}
  assert.deepEqual(effStats(h, rg), [1, 10], '+1/+1 from the Elder, then Tough doubles the 5');
  assert.ok(!ownAttrs(h, plain).has('Unaware'), '(none of these units is Unaware — that is the point)');
});

test('NEGATIVE CONTROL: an exchange with nobody Unaware in it is not collapsed', () => {
  // The same shape as the pairwise tests above, one card different. Without
  // this, an implementation that read every unit at printed all the time would
  // pass every assertion in this file.
  const h = new Harness(9291);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  ent(h, atk)!.counters = 2;                                   // → 5/5
  const blk = spawnToken(h, D, 5, 6);                          // Bubb's body, without the attribute
  ent(h, blk)!.counters = 2;                                   // → 7/8
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  assert.ok(!ent(h, atk), 'the 7-power blocker killed the 5-toughness attacker');
  assert.ok(ent(h, blk), 'and survived on 8');
  assert.equal(ent(h, blk)!.damage, 5, 'marked with the attacker\'s full, uncollapsed 5');
  finishBattle(h);
});

test('NEGATIVE CONTROL: a Robot token that nobody Unaware is fighting is its full size', () => {
  const h = new Harness(9292);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const robot = spawnRobot(h, A, 7);                           // 7/7
  const blk = spawnToken(h, D, 5, 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[robot]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);
  assert.ok(!ent(h, blk), 'the Robot 7 swung a real 7 and killed the 5/6');
  assert.ok(ent(h, robot), 'and survived the 5 it took on its real 7 toughness');
  assert.equal(ent(h, robot)!.damage, 5, 'a Robot is only a 0/0 to an Unaware card');
  finishBattle(h);
});
