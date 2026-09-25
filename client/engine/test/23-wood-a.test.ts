/* Per-card tests for batch-wood-a (project rule: a test for every card).
 * Covers the per-unit Poison mint (All-Consuming Blight), the hand-reveal
 * steal (Bioremediation), the allied-target negate, the R256 refusal of an
 * unallied one and the Virus arm (Boon of Protection), the stat-doubling
 * choice and regroup cleanup (Burgeon), both
 * directions of the after-combat defection (Corrupting Blight — normal play
 * and Virus steal), the reconstructed enemy-spell-target trigger (Earnest
 * Defender), the nontoken-enemy death trigger (Fungal Gardener), the two
 * statics-only augments (Glowhaven Elder, Inspiration), spawn/despawn draws
 * (Growing Plague), the spell-control exchange with retargeting (Hexbane
 * Shiitake), formation-slot filling (Hooba-Nan), the negate-and-defect spell
 * unit (Hush Mush), the buff-and-draw (Invigorate), the damage-to-tokens
 * trigger (Jollyglop), and the wide-formation draw (Luminary Leader).
 * States are built explicitly (give/spawn/giveResources). Seeds 2300-2399. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, IllegalAction } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

/** spawn a REAL token entity (the util spawn() makes nontoken entities).
 *
 * Defaults to 1/1. The 5/6 overload exists because three tests in this file
 * used to measure a stat change on a spawned `Bubb` — the pool's only vanilla
 * 5/6 body — and R106 (2026-08-23) shipped stat layer 6: {Unaware} makes Bubb
 * ignore every stat change, so a doubling, a +4/+4 and a +0/+1 all became
 * invisible ON THE YARDSTICK while the cards under test kept working. A stat
 * token is the yardstick with no attributes on it. */
function spawnToken(h: Harness, seat: Seat, p = 1, t = 1): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

test('All-Consuming Blight: creates a Poison 1 per unit you have where it resolves', () => {
  const h = new Harness(2300);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Unit Token');
  spawn(h, p, 'Unit Token');
  spawn(h, p, 'Bubb');
  giveResources(h, p, 'wood', 4);                     // gg / 4
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'All-Consuming Blight') });
  const toks = tokensOf(h, p);
  assert.equal(toks.length, 3, 'one Poison per unit');
  assert.ok(toks.every(t => t.card === 'Poison' && t.x === 1), 'each is a Poison 1');
});

test('Bioremediation: target player reveals their hand; you take a chosen card', () => {
  const h = new Harness(2301);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  give(h, A, 'Bubb');                                 // the card D will steal
  giveResources(h, D, 'wood', 4);                     // ggg / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Bioremediation') });
  pick(h, { player: A });                             // target player
  const handD = h.state.players[D]!.hand.length;
  const count = (seat: number) => h.state.players[seat]!.hand.filter(c => c === 'Bubb').length;
  const bubbsA = count(A), bubbsD = count(D);
  pass(h); pass(h);                                   // resolve → the pick suspends
  pick(h, h.state.players[A]!.hand.indexOf('Bubb'));  // choose a Bubb from the revealed hand
  assert.equal(count(A), bubbsA - 1, "a Bubb left A's hand");
  assert.equal(h.state.players[D]!.hand.length, handD + 1, "…and joined D's hand");
  assert.equal(count(D), bubbsD + 1);
  assert.ok(h.state.seenHand[D], 'D keeps the hand snapshot (revealHandTo)');
  finishBattle(h);
});

test('Boon of Protection: negates an effect aimed at something allied; an unallied one is not offered', () => {
  const h = new Harness(2302);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const bubbD = spawn(h, D, 'Bubb');
  giveResources(h, A, 'fire', 4);                     // two Channeled Boons (r/2 each)
  giveResources(h, D, 'wood', 4);                     // two Boons of Protection (gg/1 each)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // 1: A's Boon targets D's Bubb → allied to D → the negate lands
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: bubbD });
  const cb1 = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Boon of Protection') });
  pick(h, { stack: cb1 });
  pass(h); pass(h);                                   // Boon of Protection resolves
  assert.ok(!h.state.stack.some(i => i.id === cb1), 'R68: the negated buff left the stack');
  assert.ok(h.state.players[A]!.bin.includes('Channeled Boon'), 'and went to its bin');
  assert.deepEqual(effStats(h, bubbD), [5, 6], 'no buff landed');
  // 2: A's Boon targets A's OWN unit → nothing allied to D. R256: that is a
  // TARGETING restriction, so the item is not a candidate, the card is not
  // offered as a play, and the cast is refused. This used to assert the
  // opposite — that D could spend the mana, bin the card and read "does not
  // target anything allied" out of the log — which is report #134.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const cb2 = h.state.stack[0]!.id;
  const idx = give(h, D, 'Boon of Protection');
  const eD = new E(h.state);
  assert.deepEqual(
    eD.targetCandidates(getCard('Boon of Protection').spellEffect!.targets!,
      h.state.battle!.region, undefined, D),
    [], 'R256: an effect aimed only at its own caster is not a legal target');
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === idx),
    'R256: with no legal target the card is not offered as a play');
  const manaD = eD.openMana(D);
  const binned = () => h.state.players[D]!.bin.filter(c => c === 'Boon of Protection').length;
  const binnedBefore = binned();                      // 1 — the copy cast in step 1
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: idx }), IllegalAction,
    'R256: and the cast is refused rather than spent on a no-op');
  assert.equal(new E(h.state).openMana(D), manaD, 'no mana was spent');
  assert.equal(binned(), binnedBefore, 'and this copy did not go to the bin');
  assert.ok(h.state.players[D]!.hand.includes('Boon of Protection'), 'it is still in hand');
  assert.ok(h.state.stack.some(i => i.id === cb2), 'the enemy buff is still on the stack');
  pass(h); pass(h);                                   // Channeled Boon resolves
  assert.deepEqual(effStats(h, atk), [5, 5], 'the buff landed');
  finishBattle(h);
});

test('Burgeon: doubles the chosen stat of target unit until regroup', () => {
  const h = new Harness(2303);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const bubbD = spawnToken(h, D, 5, 6);               // a vanilla 5/6 (see spawnToken)
  giveResources(h, D, 'wood', 2);                     // g / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: bubbD });
  // R57 (ledger #7's other half): the stat is declared in the CAST window, so
  // the opponent responds to a Burgeon that has already said which half it is.
  // This used to be a mid-resolution ctx.choose asked AFTER both passes — the
  // guards below asserted that a choice was offered and that nothing resolved
  // silently, and both stayed green while the timing was wrong.
  assert.equal(h.state.decision?.kind, 'mode', 'the stat is a cast-time question');
  assert.equal(h.state.stack.length, 0, 'and it is asked before the stack, like a target');
  pick(h, 'defense');
  assert.equal(h.state.stack.length, 1, 'now it is on the stack');
  assert.equal(h.state.stack[0]!.parts[0]!.mode, 'defense',
    'and the half it chose is readable there, all through the response window');
  pass(h); pass(h);                                   // resolve
  assert.deepEqual(effStats(h, bubbD), [5, 12], 'defense doubled (6 → 12) until regroup');
  // playtest MNWK ("Burgeon resolving … just did nothing"): whatever it does,
  // it now SAYS what it did
  assert.ok(h.log.some(l => l.includes("Burgeon doubles Unit Token's defense: 6 → 12")),
    'the doubling is logged, not silent');
  finishBattle(h);
  assert.deepEqual(effStats(h, bubbD), [5, 6], 'regroup cleared the temporary doubling');
  assert.equal(getCard('Burgeon').graftEffect?.bounded, true, '[Switch1]: bounded graftable effect');
});

test('Burgeon: doubling a 0 says so instead of resolving into silence', () => {
  // The second half of the MNWK fix: doubling a 0-power unit is an invisible
  // no-op — addTemp(+0/+0) logs a line that reads like nothing happened,
  // because nothing did. Say so, and say it about the right stat.
  const h = new Harness(2320);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const wall = spawn(h, D, 'Rampart Guardian');       // 0 power
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: wall });
  pick(h, 'power');                                   // R57: declared at cast
  pass(h); pass(h);
  assert.equal(effStats(h, wall)[0], 0, 'twice nothing is still nothing');
  assert.ok(h.log.some(l => l.includes('has 0 power — doubling it changes nothing')),
    'and the log says why');
  finishBattle(h);
});

test('Corrupting Blight: defects after combat when played normally; steals the host as a Virus', () => {
  // (a) played normally: after combat the opponent gains control of it
  const h = new Harness(2304);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const blight = spawn(h, A, 'Corrupting Blight');    // 4/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[blight]] });
  finishBattle(h);
  assert.equal(ent(h, blight)!.controller, D, 'after combat, the Blight defected to D');
  assert.ok(unitsOf(h, D).some(u => u.id === blight), "regroup sent it to D's side");

  // (b) as a Virus on an enemy unit: after combat the virus player steals the host
  const h2 = new Harness(2320);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const tok = spawn(h2, A2, 'Unit Token');            // forces real combat
  const bubb = spawn(h2, D2, 'Bubb');                 // the host to steal
  giveResources(h2, A2, 'wood', 1);                   // g / 1
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[tok]] });
  h2.do({ type: 'augment', seat: A2, from: 'hand', index: give(h2, A2, 'Corrupting Blight'), hostId: bubb });
  pass(h2); pass(h2);                                 // the Virus resolves → attaches
  assert.equal(ent(h2, bubb)!.mods.length, 1, 'the Virus attached to Bubb');
  finishBattle(h2);
  assert.equal(ent(h2, bubb)!.controller, A2, 'after combat, the host defected to the Virus player');
});

test('Earnest Defender: an ally targeted by an enemy spell → create a 1/1 unit', () => {
  const h = new Harness(2305);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Earnest Defender');                    // 1/3, in the defended region
  const bubbD = spawn(h, D, 'Bubb');
  giveResources(h, A, 'fire', 4);                     // two Channeled Boons
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const before = unitsOf(h, D).length;
  // enemy spell targeting D's Bubb → trigger
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: bubbD });
  pass(h); pass(h);                                   // the trigger resolves first
  assert.equal(unitsOf(h, D).length, before + 1, 'a 1/1 was created for D');
  const made = unitsOf(h, D).find(u => u.token)!;
  assert.deepEqual(effStats(h, made.id), [1, 1], 'it is a 1/1');
  pass(h); pass(h);                                   // the Boon resolves
  // enemy spell targeting A's OWN unit → no trigger
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.equal(unitsOf(h, D).length, before + 1, 'no ally targeted — no second 1/1');
  assert.equal(h.log.filter(m => m.includes('Trigger: Earnest Defender')).length, 1);
  finishBattle(h);
});

test('Fungal Gardener: a nontoken enemy dies → create a 1/1 unit (token deaths don\'t count)', () => {
  const h = new Harness(2306);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const shroom = spawn(h, A, 'Hexbane Shiitake');     // 3/3 nontoken attacker — will die
  const tokA = spawnToken(h, A);                      // REAL token attacker — will die too
  spawn(h, D, 'Fungal Gardener');                     // 1/2, at home in the defended region
  const bubb1 = spawn(h, D, 'Bubb');                  // 5/6 blockers
  const bubb2 = spawn(h, D, 'Bubb');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[shroom], [tokA]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb1], 1: [bubb2] } });
  finishBattle(h);
  assert.ok(!ent(h, shroom) && !ent(h, tokA), 'both attackers died to the blocks');
  const made = unitsOf(h, D).filter(u => u.token);
  assert.equal(made.length, 1, 'exactly one 1/1 — the token death did not trigger');
  assert.deepEqual(effStats(h, made[0]!.id), [1, 1]);
});

test('Glowhaven Elder: +1/+1 to your OTHER units, in play and as a donated augment', () => {
  const h = new Harness(2307);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const elder = spawn(h, p, 'Glowhaven Elder');       // 3/3
  const tok = spawn(h, p, 'Unit Token');              // 1/1
  assert.deepEqual(effStats(h, tok), [2, 2], 'the other unit gets +1/+1');
  assert.deepEqual(effStats(h, elder), [3, 3], '"other": the Elder does not buff itself');
  giveResources(h, p, 'wood', 3);                     // gg / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Glowhaven Elder'), hostId: tok });
  assert.deepEqual(effStats(h, elder), [4, 4], "the donated aura buffs the host's other units");
  assert.deepEqual(effStats(h, tok), [2, 2], 'the host is excluded by its own copy (still +1 from the in-play Elder)');
});

test('Growing Plague: draws on spawn; despawn (as augment) makes each other player draw two', () => {
  const h = new Harness(2308);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const handA = h.state.players[A]!.hand.length;
  spawn(h, A, 'Growing Plague');
  assert.equal(h.state.players[A]!.hand.length, handA + 1, 'spawn: its controller drew a card');
  // augment a second copy onto a unit; when the host dies, the OTHER player draws two
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'wood', 2);                     // g / 2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Growing Plague'), hostId: host });
  const bubb = spawn(h, D, 'Bubb');
  toNextBattle(h, A);
  const handD = h.state.players[D]!.hand.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  finishBattle(h);
  assert.ok(!ent(h, host), 'the modded host died (erased with its mod)');
  assert.equal(h.state.players[D]!.hand.length, handD + 2, 'each other player drew two');
});

test('Hexbane Shiitake: exchanges the carrier for an enemy spell and retargets it ([once])', () => {
  const h = new Harness(2309);
  toDeployment(h);
  const D = h.state.initiative, A = 1 - D;            // D attacks, A defends (carrier at home)
  const host = spawn(h, A, 'Unit Token');             // carries the Hexbane augment
  const bubbA = spawnToken(h, A, 5, 6);               // the retarget beneficiary, a vanilla 5/6
  const atkD = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'wood', 4);                     // g / 4 (the augment)
  giveResources(h, D, 'fire', 4);                     // two Channeled Boons
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hexbane Shiitake'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'Hexbane attached during deployment');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atkD]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: atkD });                            // D buffs their attacker…
  pass(h); pass(h);                                   // …but the Hexbane trigger resolves first
  pick(h, true);                                      // exchange!
  pick(h, { unit: bubbA });                           // choose a new target for the Boon
  assert.equal(ent(h, host)!.controller, D, 'the carrier went to the spell\'s owner');
  pass(h); pass(h);                                   // the stolen Boon resolves under A
  assert.deepEqual(effStats(h, bubbA), [9, 10], 'the +4/+4 landed on A\'s chosen target');
  assert.deepEqual(effStats(h, atkD), [1, 1], 'the original target got nothing');
  assert.ok(h.state.players[A]!.bin.includes('Channeled Boon'), 'the stolen spell went to A\'s bin');
  // [once]: a second enemy spell does not re-trigger
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: atkD });
  pass(h); pass(h);
  assert.equal(h.log.filter(m => m.includes('Trigger: Hexbane Shiitake')).length, 1, '[once] spent (R9)');
  finishBattle(h);
});

test('Hooba-Nan alone: behind it AND a new column past each end (R304)', () => {
  // R304 (Bena 2026-09-25, report YUZY): "The columns to the left and right,
  // even when empty, DO technically exist." A lone column's empty adjacent
  // slots are the one behind it and the front of a new column on each side.
  // R75 closed the edges from 2026-08-21 and this made one 1/1.
  const h = new Harness(2310);
  toDeployment(h);
  const A = h.state.initiative;
  const hooba = spawn(h, A, 'Hooba-Nan');             // 5/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pass(h); pass(h);                                   // the trigger resolves in the attack window
  const b = h.state.battle!;
  const made = unitsOf(h, A).filter(u => u.token);
  assert.equal(made.length, 3, 'behind me, and one past each end of the line');
  assert.equal(b.columns.length, 3, 'the line widened by a column on each side');
  assert.deepEqual(b.columns[1], [hooba, made.find(u => b.columns[1]!.includes(u.id))!.id],
    'I am still in the middle column, with a 1/1 behind me');
  assert.equal(b.columns[0]!.length, 1, 'the new left column holds one 1/1, in its front row');
  assert.equal(b.columns[2]!.length, 1, 'and so does the new right column');
  assert.ok(made.every(u => u.region === b.region), 'slot units are battle-local, not home (R115 — was an R28 override, now the general rule)');
  finishBattle(h);
});

test('Hooba-Nan on the edge of the line: the open side and behind — two 1/1s (R304)', () => {
  // the owner's "most frequent use of the card": put it on the edge
  const h = new Harness(2313);
  toDeployment(h);
  const A = h.state.initiative;
  const left = spawn(h, A, 'Unit Token');
  const hooba = spawn(h, A, 'Hooba-Nan');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [hooba]] });
  pass(h); pass(h);
  const b = h.state.battle!;
  const made = unitsOf(h, A).filter(u => u.token && u.id !== left);
  assert.equal(made.length, 2, 'the new column on my right, and behind me');
  assert.deepEqual(b.columns[0], [left], 'the left neighbour is untouched (its back slot is diagonal)');
  assert.equal(b.columns[1]![0], hooba, 'I did not move');
  assert.equal(b.columns[1]!.length, 2, 'a 1/1 behind me');
  assert.equal(b.columns.length, 3, 'one new column, on the open side only');
  assert.equal(b.columns[2]!.length, 1, 'the new column is one 1/1 in its front row');
  finishBattle(h);
});

test('Hooba-Nan in the BACK row at the edge: no new column — that slot is not reachable (R304)', () => {
  // the slot beside a back-row unit past the end would be the back row of a
  // column with no front, and the front row fills first — so it is not a slot
  const h = new Harness(2314);
  toDeployment(h);
  const A = h.state.initiative;
  const front = spawn(h, A, 'Unit Token');
  const hooba = spawn(h, A, 'Hooba-Nan');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, hooba]] });
  pass(h); pass(h);
  const b = h.state.battle!;
  assert.equal(b.columns.length, 1, 'no column was opened');
  assert.deepEqual(b.columns[0], [front, hooba]);
  assert.equal(unitsOf(h, A).filter(u => u.token && u.id !== front).length, 0, 'no 1/1 at all');
  assert.ok(h.log.some(m => m.includes('every adjacent slot is already taken')), 'and it says so');
  finishBattle(h);
});

test('Hooba-Nan in the middle: both sides and below, and nothing diagonal (R75)', () => {
  const h = new Harness(2312);
  toDeployment(h);
  const A = h.state.initiative;
  const left = spawn(h, A, 'Unit Token');
  const hooba = spawn(h, A, 'Hooba-Nan');
  const right = spawn(h, A, 'Unit Token');
  const rightBack = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  // left column: one unit (its back slot is my LEFT-adjacent? no — same ROW)
  // right column: full, so its front row is taken
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [hooba], [right, rightBack]] });
  pass(h); pass(h);
  const b = h.state.battle!;
  // I sit at (column 2, front row). Adjacent: (1, front) — taken by `left`;
  // (2, back) — empty; (3, front) — taken by `right`. The empty BACK slot of
  // the left column is diagonal to me and is NOT filled.
  assert.deepEqual(b.columns[0], [left], 'the left column keeps its empty back slot — diagonal, not adjacent');
  assert.equal(b.columns[1]!.length, 2, 'only the slot behind me was filled');
  assert.deepEqual(b.columns[2], [right, rightBack], 'the full column is untouched');
  assert.equal(b.columns.length, 3, 'no new columns — both ends have a neighbour');
  finishBattle(h);
});

test('Hush Mush: negates target effect; that controller gains control of the spawned unit', () => {
  const h = new Harness(2311);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 2);                     // Channeled Boon r/2
  giveResources(h, D, 'wood', 2);                     // gg / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const cbId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: cbId });
  pass(h); pass(h);                                   // Hush Mush resolves: negate + spawn
  assert.ok(!h.state.stack.some(i => i.id === cbId), 'R68: the negated Boon left the stack');
  const mush = unitsOf(h, A).concat(unitsOf(h, D)).find(u => u.card === 'Hush Mush')!;
  assert.ok(mush, 'the spell unit spawned');
  // R143: no handoff step — the body ENTERED as A's. There is nothing on the
  // stack to pass on here, and the two passes this test used to need are gone
  // with the trigger they were waiting for.
  assert.deepEqual(h.state.stack, [], 'R143: the handover is not a trigger — nothing is waiting');
  assert.equal(ent(h, mush.id)!.controller, A, "the negated effect's controller gained control");
  assert.equal(ent(h, mush.id)!.owner, D, 'ownership stays with the caster');
  assert.deepEqual(effStats(h, atk), [1, 1], 'no buff landed');
  finishBattle(h);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Hush Mush'), "regroup sent it to A's side");
});

/* ── R143 — Hush Mush's handover is not a trigger ─────────────────────────
 *
 * Reports #95 and #96, SMVJ, the same action index a minute apart. #95 is the
 * cause: "Hush Mush's ability to go to the opponent isn't a trigger. It just
 * happens as part of the spell." #96 is the symptom the owner actually saw:
 * "I shouldn't be getting a Flourishing Flora trigger here. Hush Mush should
 * enter as Rashi's unit."
 *
 * The old implementation spawned the body under its CASTER and moved it with
 * giveControl from the body's own `spawned` trigger. That intermediate state
 * is observable by every "whenever another ally spawns" watcher the caster
 * controls — Flourishing Flora is just the one that happened to be on the
 * board. R143 spawns the body under the negated effect's controller directly
 * (StackItem.spawnUnder / ctx.spawnUnder), so the window does not exist.
 */

/** the log lines of everything that has happened since `from` */
const since = (h: Harness, from: number): string[] =>
  h.events.slice(from).map(e => e.msg).filter(Boolean);

/** pass priority (answering any trigger-ordering question the first way) until
 * the stack has drained.
 *
 * The tolerance for a decision is not laziness — it is what lets these tests
 * measure the ANSWER rather than the number of steps. The OLD implementation
 * pushed a handover trigger onto the stack, and where the caster had an
 * ally-spawn watcher it pushed TWO, which made the engine stop and ask for a
 * trigger ORDER. A drain that refused to answer would leave every assertion
 * below testing an unfinished turn instead of a wrong one. */
function drain(h: Harness, guard = 60): void {
  while ((h.state.stack.length || h.state.decision) && h.state.phase === 'battle' && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
}

test('R143 #95: Hush Mush ENTERS under the negated effect\'s controller — no trigger, no handover', () => {
  const h = new Harness(2331);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 2);                     // Channeled Boon r/2
  giveResources(h, D, 'wood', 2);                     // Hush Mush gg/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const cbId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: cbId });
  const mark = h.events.length;
  pass(h); pass(h);                                   // Hush Mush resolves

  // the SPAWN EVENT itself is the proof: there is no earlier state to catch,
  // so the only place the answer can be wrong is here.
  const sp = h.events.slice(mark).find(e => e.type === 'spawned' && e.data?.card === 'Hush Mush');
  assert.ok(sp, 'the body spawned');
  assert.equal(sp!.data!.seat, A, 'it entered as A\'s unit — never the caster\'s');
  assert.equal(sp!.data!.owner, D, 'R107: ownership did NOT follow — the card is still D\'s');
  // and nothing moved afterwards
  assert.ok(!since(h, mark).some(m => /gains control of Hush Mush/.test(m)),
    'no giveControl line — the handover is not a step');
  assert.deepEqual(h.state.stack, [], 'no trigger was queued behind the spell');
  const body = unitsOf(h, A).find(u => u.card === 'Hush Mush')!;
  assert.equal(ent(h, body.id)!.controller, A);
  assert.equal(ent(h, body.id)!.owner, D);
  finishBattle(h);
});

test('R143 #96: the CASTER\'s Flourishing Flora takes NO counter off Hush Mush', () => {
  const h = new Harness(2332);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  // D casts Hush Mush; this is D's OWN ally-spawn watcher, exactly the board
  // the owner had. "[Augment] Whenever another ally spawns, put a +1/+1
  // counter on me" — 0/1, and it counts tokens too, so the only thing that
  // can move it here is the Hush Mush body.
  const flora = spawn(h, D, 'Flourishing Flora');
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // R12: round 1 is fought in the DEFENDER's region, so Flora is standing in
  // the very region the body spawns into. If this ever stops holding, the
  // test would pass for the wrong reason.
  assert.equal(ent(h, flora)!.region, h.state.battle!.region,
    'Flora is in the battle region — it CAN see the spawn');
  assert.deepEqual(effStats(h, flora), [0, 1], 'starts 0/1');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: h.state.stack[0]!.id });
  const mark = h.events.length;
  pass(h); pass(h);                                   // Hush Mush resolves

  // THE assertion of report #96, in the owner's own words — "I shouldn't be
  // getting a Flourishing Flora trigger here". It is checked on the QUEUEING,
  // not on the counter, because the queueing is the moment the caster's
  // watcher saw a body that was never theirs. (Under the old implementation
  // the counter has not landed yet at this point: two triggers went on the
  // stack at once and the engine is busy asking D what order to resolve them
  // in — a question that should never have been asked either.)
  assert.ok(!since(h, mark).some(m => /Flourishing Flora/.test(m)),
    'report #96: no Flourishing Flora trigger — the body was never D\'s ally');
  drain(h);                                           // and nothing lands later
  assert.deepEqual(effStats(h, flora), [0, 1], 'still 0/1 once everything has resolved');
  assert.equal(ent(h, flora)!.counters ?? 0, 0, 'no counter was placed');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Hush Mush'), 'the body is A\'s');
  finishBattle(h);
});

test('R143: TWO Hush Mushes in one battle keep separate answers (the old ledger\'s worry)', () => {
  // The ⚠ header used to warn that the per-REGION `hushMushGiveTo` slot was
  // last-write-wins, so two copies resolving in one region could read each
  // other's seat. The answer now rides on each spell's OWN stack item, so the
  // two cannot see each other — this pins that behaviourally: one Hush Mush
  // negates A's spell (its body becomes A's) and the other negates D's OWN
  // spell (its body stays D's). A shared slot makes both land the same way.
  const h = new Harness(2333);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 2);                     // Channeled Boon r/2
  giveResources(h, D, 'wood', 6);                     // two Hush Mushes gg/2 + Invigorate g/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const cbId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Invigorate') });   // D's OWN spell
  pick(h, { unit: atk });
  const invId = h.state.stack[1]!.id;
  pass(h);                                            // A declines
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: invId });                          // → this body stays D's
  pass(h);                                            // A declines
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: cbId });                           // → this body becomes A's
  const mark = h.events.length;
  drain(h);                                           // both resolve
  assert.ok(!h.state.stack.some(i => i.id === cbId), 'A\'s Boon is negated');
  assert.ok(!h.state.stack.some(i => i.id === invId), 'D\'s own Invigorate is negated too');
  // both bodies entered already-correct: two spawn events, two different seats
  const spawns = h.events.slice(mark)
    .filter(e => e.type === 'spawned' && e.data?.card === 'Hush Mush')
    .map(e => e.data!.seat);
  assert.deepEqual([...spawns].sort(), [0, 1],
    'the two bodies ENTERED under different seats — neither read the other\'s answer');

  assert.equal(unitsOf(h, A).filter(u => u.card === 'Hush Mush').length, 1,
    'exactly one body went to A — the one that negated A\'s spell');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Hush Mush').length, 1,
    'and the one that negated D\'s own spell stayed with D');
  for (const u of unitsOf(h, A).concat(unitsOf(h, D)).filter(u => u.card === 'Hush Mush')) {
    assert.equal(ent(h, u.id)!.owner, D, 'both are still D\'s cards (R107)');
  }
  finishBattle(h);
});

test('R143: a Hush Mush whose target has already left the stack fizzles and hands nobody a body', () => {
  // Two Hush Mushes aimed at the SAME effect: the first negates it, the second
  // finds nothing there. R5 gets there first — the item fizzles before its run
  // is entered, so the card's own "the targeted effect has already left the
  // stack" branch stays the defensive line it always was, and the printed
  // consequence is the one the card's comment claims: no body, card binned.
  //
  // (The OTHER old branch — "the body is gone — no handover" — is deleted
  // rather than preserved. It guarded the gap between the spawn and the
  // handover trigger, and R143 closes the gap, so there is nothing left for it
  // to guard.)
  const h = new Harness(2334);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'wood', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const cbId = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: cbId });
  pass(h);                                            // A declines
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: cbId });                           // the same, doomed target
  const mark = h.events.length;
  drain(h);                                           // both copies resolve
  assert.ok(!h.state.stack.some(i => i.id === cbId), 'the Boon is gone');
  assert.deepEqual(effStats(h, atk), [1, 1], 'the Boon never buffed anything');
  assert.deepEqual(h.state.stack, [], 'and the game did not hang on it');
  assert.ok(since(h, mark).some(m => /Hush Mush fizzles/.test(m)),
    'R5: the second copy fizzled — all its targets are gone');
  assert.ok(!since(h, mark).some(m => /gains control of Hush Mush/.test(m)),
    'R143: nothing changed hands after the fact — a body enters correct or it never enters');
  // a spell that negated nothing has no "its controller", so it must not hand a
  // body to anybody — and R5 means it does not put one on the table at all.
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Hush Mush').length, 1,
    'only the copy that really negated something went to A');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Hush Mush').length, 0,
    'and the fizzled copy spawned no body at all');
  assert.equal(h.state.players[D]!.bin.filter(c => c === 'Hush Mush').length, 1,
    'it went to its owner\'s bin from the stack (R40)');
  finishBattle(h);
});

test('Hush Mush: "target effect" reaches a TRIGGERED ability, "target SPELL effect" does not', () => {
  // R60, playtest DEYK: "I'm not able to cast Hush Mush for some reason right
  // now. Tho I have priority and there's an effect I want to negate." The
  // effect was an attack trigger, and the engine had mapped every "target
  // effect" onto spells only.
  const h = new Harness(2330);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const herald = spawn(h, A, 'Warbloom Herald');     // "When I attack or block, …"
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[herald]] });
  const trig = h.state.stack[0]!;
  assert.equal(trig.kind, 'triggered', 'an attack trigger, not a spell, is on the stack');
  assert.equal(h.state.priority, D, 'the defender responds first');
  // the spell-only negate cannot see it…
  giveResources(h, D, 'water', 6);
  const dd = give(h, D, 'Dreadwave Devourer');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: dd }), IllegalAction,
    '"target spell effect" still means spells only');
  // …but plain "target effect" can
  const hm = give(h, D, 'Hush Mush');
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.handIndex === hm),
    'Hush Mush is offered against a triggered ability');
  h.do({ type: 'playCard', seat: D, handIndex: hm });
  pick(h, { stack: trig.id });
  pass(h); pass(h);                                   // Hush Mush resolves
  assert.ok(!h.state.stack.some(i => i.id === trig.id), 'R68: the negated trigger left the stack');
  assert.ok(!h.state.players[A]!.bin.includes('Warbloom Herald'),
    'R68: a negated ABILITY has no card of its own — its source stays in play, nothing is binned');
  assert.deepEqual(effStats(h, herald), [1, 1], 'the +1/+0 never landed');
  finishBattle(h);
});

test('Inspiration: +2/+2 to your units adjacent to it in formation (and only there)', () => {
  const h = new Harness(2312);
  toDeployment(h);
  const A = h.state.initiative;
  const insp = spawn(h, A, 'Inspiration');            // 3/2
  const t1 = spawn(h, A, 'Unit Token');
  const t2 = spawn(h, A, 'Unit Token');
  assert.deepEqual(effStats(h, t1), [1, 1], 'no formation → no adjacency → no buff');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[insp, t1], [t2]] });
  assert.deepEqual(effStats(h, t1), [3, 3], 'vertical neighbor gets +2/+2');
  assert.deepEqual(effStats(h, t2), [3, 3], 'same-row horizontal neighbor gets +2/+2');
  assert.deepEqual(effStats(h, insp), [3, 2], 'Inspiration does not buff itself');
  finishBattle(h);
  assert.deepEqual(effStats(h, t1), [1, 1], 'formation gone → buff gone');
});

test('Invigorate: target unit gains +0/+1 until regroup; draw a card', () => {
  const h = new Harness(2313);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const bubbD = spawnToken(h, D, 5, 6);               // a vanilla 5/6 (see spawnToken)
  giveResources(h, D, 'wood', 1);                     // g / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const handD = h.state.players[D]!.hand.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Invigorate') });
  pick(h, { unit: bubbD });
  pass(h); pass(h);                                   // resolve
  assert.deepEqual(effStats(h, bubbD), [5, 7], '+0/+1 until regroup');
  assert.equal(h.state.players[D]!.hand.length, handD + 1, 'played one (give), drew one — net +1 over the baseline');
  finishBattle(h);
  assert.deepEqual(effStats(h, bubbD), [5, 6], 'regroup cleared the buff');
});

test('Jollyglop: dealt N damage → creates N 1/1 units ([once])', () => {
  const h = new Harness(2314);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const t1 = spawn(h, A, 'Unit Token');
  const t2 = spawn(h, A, 'Unit Token');
  const jolly = spawn(h, D, 'Jollyglop');             // 0/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[t1, t2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [jolly] } });
  finishBattle(h);
  assert.equal(ent(h, jolly)!.counters, 0, 'took real damage, not counters');
  const made = unitsOf(h, D).filter(u => u.token);
  assert.equal(made.length, 2, 'the 2-damage hit made exactly two 1/1s ("that many")');
});

test('Luminary Leader: draws when attacking in a formation of 4+ units; silent below', () => {
  const h = new Harness(2315);
  toDeployment(h);
  const A = h.state.initiative;
  const ldr = spawn(h, A, 'Luminary Leader');
  const ts = [spawn(h, A, 'Unit Token'), spawn(h, A, 'Unit Token'), spawn(h, A, 'Unit Token')];
  toNextBattle(h, A);
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[ldr], [ts[0]!], [ts[1]!], [ts[2]!]] });
  pass(h); pass(h);                                   // the trigger resolves in the attack window
  assert.equal(h.state.players[A]!.hand.length, hand + 1, '4-unit formation → drew a card');
  finishBattle(h);

  const h2 = new Harness(2321);
  toDeployment(h2);
  const A2 = h2.state.initiative;
  const ldr2 = spawn(h2, A2, 'Luminary Leader');
  const u1 = spawn(h2, A2, 'Unit Token');
  const u2 = spawn(h2, A2, 'Unit Token');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[ldr2], [u1], [u2]] });
  assert.ok(!h2.log.some(m => m.includes('Trigger: Luminary Leader')), '3-unit formation → no trigger');
  finishBattle(h2);
  assert.equal(getCard('Luminary Leader').graftEffect?.bounded, true, '[Switch1]: bounded graftable draw');
});

/* R256 / R88: a Virus is an effect that targets its host, and the designer
 * named THIS CARD when saying so — "so you could Graxxlid or Boon of
 * Protection it as well?" / "Yep! They're fully interactible." (calebgannon).
 * `doAugment` builds a Virus stack item with `parts: []` and a `hostId`, so
 * the old read over `parts[].targets` said a Virus targets nothing and Boon
 * could never answer one. Hoisting the predicate into `restrict` would have
 * made that gap permanent — the card would not even be OFFERED — so the arm
 * R88 gave Graxxlid is in `aimsAtAlly` too. Same shape as
 * 16-earth-a::Graxxlid: a Virus being applied to me. */
test('Boon of Protection: a Virus being applied to an allied unit IS an allied target', () => {
  const h = new Harness(2324);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const mine = spawn(h, D, 'Bubb');                   // the virus host, D's own
  giveResources(h, A, 'earth', 2);                    // Crumbling Ancient, e/2 {Virus}
  giveResources(h, D, 'wood', 2);                     // Boon of Protection, gg/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Crumbling Ancient'), hostId: mine });
  const virus = h.state.stack[h.state.stack.length - 1]!.id;
  const idx = give(h, D, 'Boon of Protection');
  assert.deepEqual(
    new E(h.state).targetCandidates(getCard('Boon of Protection').spellEffect!.targets!,
      h.state.battle!.region, undefined, D),
    [{ stack: virus }], 'the Virus aimed at an ally is the legal target');
  h.do({ type: 'playCard', seat: D, handIndex: idx });
  pick(h, { stack: virus });
  pass(h); pass(h);                                   // Boon of Protection resolves
  assert.ok(!h.state.stack.some(i => i.id === virus), 'R68: the negated Virus left the stack');
  assert.ok(!ent(h, mine)!.mods.some(m => ent(h, m)?.card === 'Crumbling Ancient'),
    'and the mod never landed on the ally');
  finishBattle(h);
});
