/* Per-card tests for the wood/metal-involved hybrid batch (batch-hybrids-wm-a):
 * live-X Robot construction (Colossal Construction, R27/R28), moving a unit
 * and its mods onto a new host (Reconfigure), counter-triggered draws +
 * grafts (Scrapyard Custodian, Corroded Alchemy), spawn-triggered Crystals
 * (Aether Channeler), damage-mirroring -1/-1 counters (Decay Distributor),
 * the SPELL COPY approximation (Earthbound Replicator, Maelstrom Charger),
 * an either-or token conjure (Spirit of Nature), sacrifice-funded negation
 * (Malevolent Machinations), death-punishing sacrifices (Malicious Hardware,
 * Soulforger), the repeating sacrifice loop (Maw of Damnation), spell-damage
 * token minting (Ember of Life, R28) and a resolution-paid sacrifice buff
 * (Hearthwood Ancient). The PARKED Rook and The Silent (play-permission /
 * cost modifiers) have registration tests + todos.
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration can't shift assertions. Seeds: 2900-2999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

/** run engine mutations white-box; a trigger's decision may suspend —
 * the suspension is recorded in state and answered via h.do('decide'). */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  // a mid-resolution suspension rolls the draft back via structuredClone,
  // re-pointing e.s at a fresh object — re-sync the harness to it
  h.state = e.s;
}

// ── Colossal Construction ────────────────────────────────────────────────

test('Colossal Construction: creates a Robot X, X = greatest defense among your units (R27/R28)', () => {
  const h = new Harness(2901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Unit Token');                                  // defense 1
  spawn(h, p, 'Rook');                                        // defense 4 — the greatest
  giveResources(h, p, 'earth', 2);
  giveResources(h, p, 'metal', 1);                            // em / 3
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Colossal Construction') });
  const robot = unitsOf(h, p).find(u => u.card === 'Robot');
  assert.ok(robot, 'a Robot was created');
  assert.equal(robot.counters, 4, 'X = 4 (the Rook’s defense) as +1/+1 counters');
  assert.deepEqual(effStats(h, robot.id), [4, 4], 'the 0/0 Robot is a 4/4');
  assert.ok(robot.token, 'the Robot is a token');
  assert.equal(robot.region, new E(h.state).homeRegion(p), 'created UNIT arrives home (R28)');
});

// ── Reconfigure ──────────────────────────────────────────────────────────

test('Reconfigure: moves target augment unit AND its mods onto another target unit', () => {
  const h = new Harness(2902);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const dd = spawn(h, D, 'Decay Distributor');                // has [Augment] — movable
  const host = spawn(h, D, 'Unit Token');
  whiteBox(h, e => e.attachMod(ent(h, dd)!, 'Rook', D, 'augment'));   // dd carries a mod
  assert.equal(ent(h, dd)!.mods.length, 1, 'setup: the mod is on the moved unit');
  giveResources(h, D, 'earth', 1);
  giveResources(h, D, 'metal', 1);
  giveResources(h, D, 'wood', 2);                             // em / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Reconfigure') });
  pick(h, { unit: dd });                                      // first pick: the unit to move
  pick(h, { unit: host });                                    // second pick: the new host
  pass(h); pass(h);                                           // resolve
  assert.ok(!ent(h, dd), 'the moved unit left play (silently — moved, not despawned)');
  assert.ok(!h.state.players[D]!.bin.includes('Decay Distributor'), 'not binned — moved');
  const mods = ent(h, host)!.mods.map(id => ent(h, id)!);
  assert.deepEqual(mods.map(m => m.card), ['Decay Distributor', 'Rook'],
    'the unit AND its mod now sit on the host');
  assert.ok(mods.every(m => m.modOf === host && m.appliedAs === 'augment'),
    'all re-pointed at the new host as augments');
  finishBattle(h);
});

// ── Rook ─────────────────────────────────────────────────────────────────

test('Rook: augment from hand and bin during battle as if [Virus]', { todo: true }, () => {
  // PARKED: a continuous play-permission layer over doAugment's legality
  // rules does not exist (sibling of the missing cost-modification layer).
  // See the batch header.
});

test('Rook: plays as a 4/4; augments (donating nothing yet)', () => {
  const h = new Harness(2903);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const rook = spawn(h, p, 'Rook');
  assert.deepEqual(effStats(h, rook), [4, 4], 'vanilla 4/4 in play');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'metal', 1);
  giveResources(h, p, 'earth', 1);
  giveResources(h, p, 'wood', 2);                             // me / 4
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rook'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment (inert donation)');
});

// ── Scrapyard Custodian ──────────────────────────────────────────────────

test('Scrapyard Custodian: counters on an ally → [Switch1] draw; grafts join the cause', () => {
  const h = new Harness(2904);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cust = spawn(h, p, 'Scrapyard Custodian');
  const ally = spawn(h, p, 'Unit Token');
  whiteBox(h, e => e.attachMod(ent(h, cust)!, 'Corroded Alchemy', p, 'graft', 0));
  const handBefore = h.state.players[p]!.hand.length;
  whiteBox(h, e => e.addCounters(ent(h, ally)!, 2));          // "you put counters on an ally"
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'drew a card');
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Crystal').length, 1,
    'the grafted Corroded Alchemy made its Crystal 1');
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Poison').length, 1, '…and its Poison 1');
  // [Switch1]: bounded — a second batch of counters this turn does nothing
  whiteBox(h, e => e.addCounters(ent(h, cust)!, 1));          // counters on the Custodian itself
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'no second draw (R9)');
  assert.equal(tokensOf(h, p).length, 2, 'no second token pair');
});

// ── The Silent ───────────────────────────────────────────────────────────

test('The Silent: spells cost [two] more per spell the team played this battle', { todo: true }, () => {
  // PARKED: a continuous cost-modification layer does not exist —
  // canPayCard/payCard read printed mana only (the Stasis Sentry precedent).
  // See the batch header.
});

test('The Silent: plays as a 3/4; augments (donating nothing yet)', () => {
  const h = new Harness(2905);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const silent = spawn(h, p, 'The Silent');
  assert.deepEqual(effStats(h, silent), [3, 4], 'vanilla 3/4 in play');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'earth', 1);
  giveResources(h, p, 'metal', 1);
  giveResources(h, p, 'wood', 1);                             // em / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'The Silent'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment (inert donation)');
});

// ── Aether Channeler ─────────────────────────────────────────────────────

test('Aether Channeler: another NONTOKEN ally spawning → Crystal 1 (tokens don’t count)', () => {
  const h = new Harness(2906);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Aether Channeler');                            // own [Augment] text live
  spawn(h, p, 'Rook');                                        // nontoken ally spawns
  let crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'one Crystal created');
  assert.equal(crystals[0]!.x, 1, 'a Crystal 1');
  whiteBox(h, e => {                                          // token ally spawns
    e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true, tokenStats: [1, 1] });
  });
  crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'a token spawn makes no Crystal');
});

// ── Corroded Alchemy ─────────────────────────────────────────────────────

test('Corroded Alchemy: creates a Crystal 1 and a Poison 1', () => {
  const h = new Harness(2907);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 1);
  giveResources(h, p, 'wood', 1);                             // eg / 1
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Corroded Alchemy') });
  const mine = tokensOf(h, p);
  assert.equal(mine.filter(t => t.card === 'Crystal' && t.x === 1).length, 1, 'a Crystal 1');
  assert.equal(mine.filter(t => t.card === 'Poison' && t.x === 1).length, 1, 'and a Poison 1');
  assert.ok(h.state.players[p]!.bin.includes('Corroded Alchemy'), 'the spell → bin');
});

// ── Decay Distributor ────────────────────────────────────────────────────

test('Decay Distributor: dealt N damage → N -1/-1 counters on target unit (combat, R31)', () => {
  const h = new Harness(2908);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                      // 1/1 attacker
  const dd = spawn(h, D, 'Decay Distributor');                // 0/7, own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [dd] } });
  pass(h); pass(h);   // combat: dd is dealt 1; the trigger resolves at once (R31)
  pick(h, { unit: atk });                                     // put the counter on the attacker
  assert.ok(!ent(h, atk), 'the 1/1 died to the -1/-1 counter');
  assert.equal(ent(h, dd)!.damage, 1, 'the Distributor took the 1 damage');
  finishBattle(h);
});

// ── Earthbound Replicator ────────────────────────────────────────────────

test('Earthbound Replicator: a nonunit spell targeting me is copied (⚠ same target)', () => {
  const h = new Harness(2909);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');          // 1/3, own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });    // A's priority right after declare
  pick(h, { unit: repl });                                    // Fireball 1 targets the Replicator
  pass(h); pass(h);                                           // resolve the copy trigger first
  pass(h); pass(h);                                           // then the original Fireball
  assert.ok(h.log.some(m => m.includes('copies Fireball')), 'the spell was copied');
  assert.equal(ent(h, repl)!.damage, 2, '1 original + 1 copy = 2 damage');
  assert.ok(ent(h, repl), 'the 1/3 survives');
  finishBattle(h);
});

// ── Spirit of Nature ─────────────────────────────────────────────────────

test('Spirit of Nature: after combat, [Switch1] create a Poison 2 OR a Crystal 2', () => {
  const h = new Harness(2910);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Spirit of Nature');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                           // combat + afterCombat trigger
  pass(h); pass(h);                                           // resolve the trigger
  pick(h, 'Crystal');                                         // the either-or (R6)
  const crystals = tokensOf(h, D).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'one token created');
  assert.equal(crystals[0]!.x, 2, 'a Crystal 2');
  assert.equal(tokensOf(h, D).filter(t => t.card === 'Poison').length, 0, 'no Poison — the choice');
  finishBattle(h);
});

// ── Maelstrom Charger ────────────────────────────────────────────────────

test('Maelstrom Charger: sacrifice me as you play a nonunit spell → copy it (⚠ same targets)', () => {
  const h = new Harness(2911);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, D, 'Maelstrom Charger');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });    // D plays a nonunit spell
  pick(h, { player: A });                                     // Fireball 1 at the opponent
  pass(h); pass(h);                                           // resolve the Charger trigger
  pick(h, true);                                              // sacrifice → copy
  pass(h); pass(h);                                           // resolve the original Fireball
  assert.ok(!ent(h, chg), 'the Charger was sacrificed');
  assert.ok(h.state.players[D]!.bin.includes('Maelstrom Charger'), 'sacrificed → bin');
  assert.equal(h.state.players[A]!.life, lifeA - 2, 'copy + original: 2 total damage');
  finishBattle(h);
});

// ── Malevolent Machinations ──────────────────────────────────────────────

test('Malevolent Machinations: sacrifice X units → negate up to X target effects', () => {
  const h = new Harness(2912);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const d1 = spawn(h, D, 'Unit Token');
  const d2 = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 2);
  giveResources(h, A, 'fire', 1);                             // Structural Collapse eer/3
  giveResources(h, D, 'fire', 2);
  giveResources(h, D, 'metal', 1);                            // Malevolent Machinations rrm/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Structural Collapse') });
  pick(h, { unit: atk });                                     // Collapse's cast cost (R35): paid up front
  const collapseId = h.state.stack.find(i => i.card === 'Structural Collapse')!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Malevolent Machinations') });
  pass(h); pass(h);                                           // resolve Malevolent (top of stack)
  pick(h, d1);                                                // sacrifice one unit…
  pick(h, false);                                             // …then Done: X = 1
  pick(h, collapseId);                                        // negate the Collapse
  assert.ok(!ent(h, d1), 'the sacrifice was paid');
  assert.ok(ent(h, d2), 'only X = 1 unit sacrificed');
  assert.ok(h.log.some(m => m.includes('is negated')), 'the effect was negated');
  pass(h); pass(h);                                           // the negated Collapse resolves
  assert.ok(h.state.players[A]!.bin.includes('Structural Collapse'), 'negated spell → bin');
  assert.ok(!ent(h, atk), 'the Collapse cast cost stays paid (R35) — negation does not refund it');
  finishBattle(h);
});

// ── Malicious Hardware ───────────────────────────────────────────────────

test('Malicious Hardware: one of your units dies → each opponent sacrifices a unit', () => {
  const h = new Harness(2913);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk1 = spawn(h, A, 'Unit Token');
  const atk2 = spawn(h, A, 'Unit Token');
  const mh = spawn(h, D, 'Malicious Hardware');               // own [Augment] text live
  const b1 = spawn(h, D, 'Unit Token');                       // the doomed blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk1], [atk2]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1] } });
  pass(h); pass(h);   // combat: atk1 and b1 trade; b1's death fires the trigger (R31)
  assert.ok(!ent(h, b1), 'the blocker died (your unit died)');
  assert.ok(!ent(h, atk1), 'the blocked attacker died in the trade');
  assert.ok(!ent(h, atk2), 'the opponent sacrificed their surviving unit (forced pick)');
  assert.ok(ent(h, mh), 'the Hardware itself is untouched');
  finishBattle(h);
});

// ── Maw of Damnation ─────────────────────────────────────────────────────

test('Maw of Damnation: each player sacrifices two; 4+ sacrificed → it repeats', () => {
  const h = new Harness(2914);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  const d1 = spawn(h, D, 'Unit Token');
  const d2 = spawn(h, D, 'Unit Token');
  const d3 = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'fire', 1);
  giveResources(h, D, 'metal', 1);
  giveResources(h, D, 'wood', 2);                             // rm / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Maw of Damnation') });
  pass(h); pass(h);                                           // resolve
  pick(h, d1);                                                // D's first pick (round 1)
  pick(h, d2);                                                // D's second pick
  pick(h, a1);                                                // A's first pick (second is forced)
  // round 1 sacrificed 4 → it repeats: D's d3 is forced, A has nothing → 1 < 4, stop
  assert.ok(h.log.some(m => m.includes('it repeats')), 'the 4-sacrifice round repeated');
  assert.ok(!ent(h, d1) && !ent(h, d2) && !ent(h, d3), 'D lost all three units');
  assert.ok(!ent(h, a1) && !ent(h, a2), 'A lost both units');
  finishBattle(h);
});

// ── Soulforger ───────────────────────────────────────────────────────────

test('Soulforger: your NONTOKEN unit dying → Fireball 1 (token deaths don’t count)', () => {
  const h = new Harness(2915);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Soulforger');                                  // own [Augment] text live
  const rook = spawn(h, p, 'Rook');
  let tok = 0;
  whiteBox(h, e => {                                          // a REAL token unit
    tok = e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true, tokenStats: [1, 1] }).id;
  });
  whiteBox(h, e => e.destroy(ent(h, rook)!, 'dies'));         // nontoken death
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Fireball' && t.x === 1).length, 1,
    'a Fireball 1 was created');
  whiteBox(h, e => e.destroy(ent(h, tok)!, 'dies'));          // token death
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Fireball').length, 1,
    'a token death makes no Fireball');
});

// ── Ember of Life ────────────────────────────────────────────────────────

test('Ember of Life: [once] a spell effect deals N damage → create N 1/1 units (R28)', () => {
  const h = new Harness(2916);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Ember of Life');                               // own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);                                                    // priority → D
  // NOTE: Fireball is {Burst} — every burst token in the region casts at
  // once, so the two Fireballs are created one at a time
  let fb1 = 0, fb2 = 0;
  whiteBox(h, e => { fb1 = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: D, entityId: fb1 });
  pick(h, { unit: a1 });
  pass(h); pass(h);                                           // Fireball resolves, trigger queued
  pass(h); pass(h);                                           // resolve the Ember trigger
  assert.ok(!ent(h, a1), 'the Fireball killed the 1/1');
  const minted = unitsOf(h, D).filter(u => u.card === 'Unit Token');
  assert.equal(minted.length, 1, 'one 1/1 created (N = 1)');
  assert.equal(minted[0]!.region, unitsOf(h, D).find(u => u.card === 'Ember of Life')!.region,
    "created UNIT arrives in the carrier's region (R33; here = D's home, where Ember stands)");
  // [once]: a second spell-damage event this turn mints nothing
  pass(h);                                                    // priority → D again
  whiteBox(h, e => { fb2 = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: D, entityId: fb2 });
  pick(h, { unit: a2 });
  pass(h); pass(h);                                           // resolve the second Fireball
  assert.ok(!ent(h, a2), 'the second Fireball landed');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Unit Token').length, 1,
    'no second minting (R9 [once])');
  finishBattle(h);
});

// ── Hearthwood Ancient ───────────────────────────────────────────────────

test('Hearthwood Ancient: sacrifice another unit → your units gain +1/+1 until regroup', () => {
  const h = new Harness(2917);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const ha = spawn(h, p, 'Hearthwood Ancient');               // 0/4, own [Augment] text live
  const t1 = spawn(h, p, 'Unit Token');
  const t2 = spawn(h, p, 'Unit Token');
  h.do({ type: 'activateAbility', seat: p, entityId: ha, abilityIndex: 0, via: 'augment' });
  pick(h, t1);                                                // the resolution-paid sacrifice
  assert.ok(!ent(h, t1), 'the other unit was sacrificed');
  assert.deepEqual(effStats(h, ha), [1, 5], 'the Ancient gains +1/+1 (0/4 → 1/5)');
  assert.deepEqual(effStats(h, t2), [2, 2], 'the surviving ally gains +1/+1');
  assert.ok(!ent(h, t1), 'the sacrificed unit never benefits');
});
