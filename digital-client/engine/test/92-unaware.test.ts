/* R106 — STAT LAYER 6, {Unaware}: an Unaware unit's numbers are its BASE
 * numbers, for everybody, everywhere.
 *
 * {Unaware} was the last attribute in the pool with zero engine references
 * (CARD-TODO #5). Three cards printed it — Bubb (5/6), Trashling (2/2, which
 * donates it as a {Virus}) and Haboob (a spell) — and all three were plain
 * vanilla bodies, which is exactly the shape that hid Harbinger: an attribute
 * that arrives, is displayed, and is read by nothing.
 *
 * Owner ruling, 2026-08-23, the BLANKET reading:
 *
 *   "Bubb 5/6 with a +1/+1 counter = STILL 5/6. A -1/-1 counter on Bubb:
 *    still 5/6. A lord's +1/+0 aura: still 5/6."
 *   "Bubb blocks a pumped 3/3 (+2/+2 -> 5/5): Bubb 5/6 vs the attacker's
 *    FULL 5/5."
 *
 * Two halves, and the second is the one R10's own wording ("Unaware and
 * whatever it interacts with mutually ignore stat changes") invites you to get
 * wrong:
 *
 *  1. an Unaware unit ignores stat changes INCLUDING ITS OWN — counters, temp
 *     deltas, auras, {Tough}, {Inverted}, all of it;
 *  2. the OTHER side of the interaction is NOT collapsed. There is no pairwise
 *     "as seen by" evaluation anywhere in the engine, and these tests pin that
 *     absence as hard as they pin the presence — a pumped 5/5 attacker really
 *     hits an Unaware blocker for 5.
 *
 * A base REWRITE still lands, on R93's argument for {Inverted}: "becomes a
 * base 4/4" / "your units are base 3/3" redefines what base IS rather than
 * changing it, so it is not a stat change. Layers 1-2 survive; 3, 4 and 5 are
 * dropped.
 *
 * The NEGATIVE CONTROL at the bottom of this file is load-bearing: without it
 * an implementation that collapsed EVERY unit to its base stats would pass
 * every assertion above it.
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
  pass, spawn, toDeployment, toNextBattle,
} from './util.ts';

/** spawn a vanilla stat token (no printed triggers, no attributes) */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

const effAttrs = (h: Harness, id: EntityId): Set<string> =>
  new E(h.state).effAttrs(ent(h, id)!);

/* ── the owner's worked example, verbatim ──────────────────────────────── */

test('a +1/+1 counter on Bubb leaves it a 5/6', () => {
  const h = new Harness(9200);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'printed 5/6 to begin with');
  ent(h, bubb)!.counters = 1;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'the +1/+1 counter is a stat change: ignored');
  assert.equal(ent(h, bubb)!.counters, 1, 'the counter is still ON the unit — layer 6 ignores it, it does not erase it');
});

test('a -1/-1 counter on Bubb leaves it a 5/6', () => {
  const h = new Harness(9201);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  ent(h, bubb)!.counters = -1;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'a shrink is a stat change too — Unaware cuts both ways');
  ent(h, bubb)!.counters = -9;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'nine of them do not kill it either');
  assert.ok(ent(h, bubb), 'and it is still in play');
});

test('a temporary -2/-2 on Bubb leaves it a 5/6', () => {
  const h = new Harness(9202);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  ent(h, bubb)!.tempPower = -2;
  ent(h, bubb)!.tempToughness = -2;
  assert.deepEqual(effStats(h, bubb), [5, 6], 'until-regroup deltas are layer 3: dropped');
});

test('a lord\'s aura leaves Bubb a 5/6', () => {
  const h = new Harness(9203);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  spawn(h, A, 'Glowhaven Elder');            // "Your other units gain +1/+1"
  assert.deepEqual(effStats(h, bubb), [5, 6], 'a continuous +1/+1 static is a stat change: ignored');
  // the aura is really radiating — it is Bubb that is refusing it, not the
  // Elder that is switched off
  const lines = new E(h.state).projections(ent(h, bubb)!);
  assert.ok(lines.some(l => l.from === 'Glowhaven Elder' && l.dp === 1 && l.dt === 1),
    'the Elder still projects onto Bubb; layer 6 is what discards it');
});

test('an enemy debuff aura leaves Bubb a 5/6 (the shrink direction, from off-side)', () => {
  const h = new Harness(9204);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  // Towering Colossus projects +2/+2 onto ENEMY units in its region; put it on
  // the same seat's side so the static's region filter reaches Bubb
  spawn(h, A, 'Towering Colossus');
  const other = spawnToken(h, A, 2, 2);
  assert.deepEqual(effStats(h, bubb), [5, 6], 'Bubb ignores a static it did not ask for');
  assert.deepEqual(effStats(h, other), [2, 2], '(and the Colossus only touches enemies anyway)');
});

/* ── the asymmetry: the OTHER side is not collapsed ────────────────────── */

test('Bubb blocks a pumped 3/3 and takes the attacker\'s FULL 5 — the other side is not collapsed', () => {
  const h = new Harness(9210);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  ent(h, atk)!.counters = 2;                                   // +2/+2 → 5/5
  const bubb = spawn(h, D, 'Bubb');                            // 5/6
  assert.deepEqual(effStats(h, atk), [5, 5], 'the attacker is a 5/5 the ordinary way');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  // read both sides mid-exchange: this is the ruling in one line
  assert.deepEqual(effStats(h, bubb), [5, 6], 'Bubb fights at its base 5/6');
  assert.deepEqual(effStats(h, atk), [5, 5],
    'and the attacker is STILL a 5/5 in that exchange — no pairwise collapse');
  assert.ok(!effAttrs(h, atk).has('Unaware'),
    'Unaware does not cross the block: attack column and block column are separate columns');
  pass(h); pass(h);                                            // damage
  assert.ok(!ent(h, atk), 'Bubb\'s 5 power killed the 5-toughness attacker');
  assert.ok(ent(h, bubb), 'Bubb survived on 6 toughness');
  assert.equal(ent(h, bubb)!.damage, 5,
    'it took FIVE — a pairwise reading would have marked 3');
  finishBattle(h);
});

test('a pumped attacker really kills Bubb, and Bubb swings for its base 5 while carrying +2/+2', () => {
  const h = new Harness(9211);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  ent(h, atk)!.counters = 4;                                   // → 7/7
  const bubb = spawn(h, D, 'Bubb');
  ent(h, bubb)!.counters = 2;                                  // would be 7/8
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  assert.deepEqual(effStats(h, bubb), [5, 6], 'the two counters do nothing');
  pass(h); pass(h);
  assert.ok(!ent(h, bubb), 'a 7/7 kills a 5/6 — Bubb does not get to be an 8-toughness unit');
  assert.ok(ent(h, atk), 'and Bubb hit back for its BASE 5, not for 7');
  assert.equal(ent(h, atk)!.damage, 5, 'exactly 5 marked on the 7-toughness attacker');
  finishBattle(h);
});

/* ── layers 1-2 survive: a base REWRITE is not a stat change (R93) ─────── */

test('a base rewrite DOES change an Unaware unit — Aberrant Statweaver makes Bubb a 3/3', () => {
  const h = new Harness(9220);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  spawn(h, A, 'Aberrant Statweaver');         // "Your units are base 3/3"
  assert.deepEqual(effStats(h, bubb), [3, 3],
    'layer 2 redefines what base IS, so Unaware has nothing to ignore');
  // and layer 3 is still dropped ON TOP of the rewritten base
  ent(h, bubb)!.counters = 2;
  assert.deepEqual(effStats(h, bubb), [3, 3], 'the counter is still ignored — from the NEW base');
});

test('an until-regroup base stamp reaches Bubb too, and the counter on top still does not', () => {
  const h = new Harness(9221);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const bubb = spawn(h, A, 'Bubb');
  ent(h, bubb)!.counters = 3;
  new E(h.state).setBase(ent(h, bubb)!, 4, 4);               // "becomes a base 4/4"
  assert.deepEqual(effStats(h, bubb), [4, 4], 'the stamp lands; the +3/+3 does not');
});

/* ── layer 4 and layer 5 are dropped ───────────────────────────────────── */

test('{Tough} donated onto Bubb does nothing — layer 4 is a stat change', () => {
  const h = new Harness(9230);
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
  const h = new Harness(9231);
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

/* ── column sharing (R19): the decision, pinned ────────────────────────── */

test('{Unaware} is column-shared: a pumped column-mate of Bubb fights at ITS base stats', () => {
  const h = new Harness(9240);
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
    'so the whole column freezes at base — Caleb: attributes are shared "in all situations"');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'Bubb itself, unchanged');
  finishBattle(h);
  assert.deepEqual(effStats(h, mate), [4, 4], 'and the mate gets its counters back when the formation breaks');
});

test('column sharing runs both ways: a {Tough} column-mate of Bubb loses its own doubling', () => {
  const h = new Harness(9241);
  toDeployment(h);
  const A = h.state.initiative;
  const rg = spawn(h, A, 'Rampart Guardian');                  // 0/4 {Tough}
  const bubb = spawn(h, A, 'Bubb');
  assert.deepEqual(effStats(h, rg), [0, 8], 'alone, Tough doubles it');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rg, bubb]] });
  assert.ok(effAttrs(h, rg).has('Unaware') && effAttrs(h, bubb).has('Tough'),
    'the column shares both attributes in both directions');
  assert.deepEqual(effStats(h, rg), [0, 4], 'the Guardian is Unaware now, so its own Tough is a stat change it ignores');
  assert.deepEqual(effStats(h, bubb), [5, 6], 'and the borrowed Tough does nothing to Bubb');
  finishBattle(h);
});

/* ── Trashling: {Unaware} donated by a {Virus} ─────────────────────────── */

test('Trashling donating {Unaware} freezes its HOST at the host\'s base stats', () => {
  const h = new Harness(9250);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawnToken(h, A, 3, 3);
  ent(h, host)!.counters = 2;                                  // → 5/5
  assert.deepEqual(effStats(h, host), [5, 5], 'a plain pumped 5/5 before the virus lands');
  giveResources(h, A, 'metal', 2);                             // Trashling: m/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Trashling'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'), 'the type-line [Augment] donated {Unaware}');
  assert.deepEqual(effStats(h, host), [3, 3],
    'and the host drops to its base 3/3 — the virus takes its buffs away by making it stop counting them');
  // counters gained AFTER the virus are ignored too: this is continuous, not a stamp
  ent(h, host)!.counters = 6;
  assert.deepEqual(effStats(h, host), [3, 3], 'later counters do nothing either');
});

test('Trashling played as a unit is a 2/2 that stays a 2/2', () => {
  const h = new Harness(9251);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tr = spawn(h, A, 'Trashling');
  ent(h, tr)!.counters = 3;
  spawn(h, A, 'Glowhaven Elder');
  assert.deepEqual(effStats(h, tr), [2, 2], 'its own counters and the lord both bounce off');
});

/* ── Haboob: the printed effect still works next to the live attribute ─── */

test('Haboob still deals its 1 damage to each unit, and does NOT collapse what it hits', () => {
  const h = new Harness(9260);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const pumped = spawnToken(h, A, 1, 1);
  ent(h, pumped)!.counters = 2;                                // → 3/3
  const bubb = spawn(h, A, 'Bubb');                            // Unaware, 5/6
  const chump = spawnToken(h, D, 1, 1);                        // dies to 1
  giveResources(h, D, 'earth', 4);                             // Haboob: ee/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pumped], [bubb]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haboob') });
  pass(h); pass(h);                                            // resolve
  assert.ok(!ent(h, chump), 'the printed effect works: 1 damage kills a 1/1');
  assert.ok(ent(h, pumped), 'the pumped 3/3 survives — R106 does not collapse the OTHER side');
  assert.equal(ent(h, pumped)!.damage, 1, 'it just takes its 1');
  assert.ok(ent(h, bubb), 'and Bubb, which is genuinely Unaware, takes its 1 on a base 6');
  assert.equal(ent(h, bubb)!.damage, 1);
  finishBattle(h);
});

/* ── the negative control ──────────────────────────────────────────────── */

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

test('NEGATIVE CONTROL: real combat damage still uses the pumped numbers when nobody is Unaware', () => {
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
  assert.equal(ent(h, blk)!.damage, 5, 'marked with the attacker\'s full 5');
  finishBattle(h);
});
