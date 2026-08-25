/* Per-card tests for the wood/metal-involved hybrid batch (batch-hybrids-wm-a):
 * live-X Robot construction (Colossal Construction, R27/R115), moving a unit
 * and its mods onto a new host (Reconfigure), counter-triggered draws +
 * grafts (Scrapyard Custodian, Corroded Alchemy), spawn-triggered Crystals
 * (Aether Channeler), damage-mirroring -1/-1 counters (Decay Distributor),
 * the SPELL COPY approximation (Earthbound Replicator, Maelstrom Charger),
 * an either-or token conjure (Spirit of Nature), sacrifice-funded negation
 * (Malevolent Machinations), death-punishing sacrifices (Malicious Hardware,
 * Soulforger), the repeating sacrifice loop (Maw of Damnation), spell-damage
 * token minting (Ember of Life, R33 — absorbed into R115) and a sacrifice ACTIVATION cost
 * (Hearthwood Ancient, R49 sacrificeOther — it used to be paid at
 * resolution). The Silent's cost tax is live (R59 CostMod); the PARKED Rook
 * (play permission) has a registration test + todo.
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration can't shift assertions. Seeds: 2900-2999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, notOffered, pass, pick,
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

test('Colossal Construction: creates a Robot X, X = greatest defense among your units (R27/R115)', () => {
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
  assert.equal(robot.region, new E(h.state).homeRegion(p), 'created UNIT arrives at ctx.region — home for a deploy cast (R115)');
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

/* ── Rook (R95) ────────────────────────────────────────────────────────────
 *
 * "[Augment] You may augment cards from hand and bin during battle as if they
 * were [Virus]." This text is the whole card; until round 17 it was a vanilla
 * 4/4. The designer names it as exactly this permission AND as something that
 * has to be opt-in (rules-questions):
 *
 *   chatt_nooga: "Does Steward of the Plain let me apply a virus from my
 *                 discard during combat?"
 *   calebgannon: "That's a very interesting question" / "It shouldn't"
 *   chatt_nooga: "Okay but hear me out: What if it did? Would that be broken?"
 *   calebgannon: "Not really I don't think. If it said 'as if it was in your
 *                 hand' then it could work" → $card rook → "Does do that"
 */

test('Rook: a NON-virus augment from HAND during battle — refused without it, legal with it', () => {
  const h = new Harness(2910);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  // Emberflame Enlightener is an augment and is NOT a {Virus}
  const idx = give(h, A, 'Emberflame Enlightener');
  giveResources(h, A, 'fire', 4);                             // rrr / 4
  assert.throws(
    () => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: host }),
    /only Virus cards can augment from hand during battle/,
    'the base rule: a battle augment must be a Virus from hand');
  // now a Rook in the region grants the permission
  const e = new E(h.state);
  e.spawnUnit(A, 'Rook', h.state.battle!.region);
  e.settle(); h.state = e.s;
  h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: host });
  pass(h); pass(h);                                           // the virus-shaped item resolves
  assert.ok(ent(h, host)!.mods.some(id => ent(h, id)!.card === 'Emberflame Enlightener'),
    'with Rook in the region it lands, on the stack, exactly as a Virus would');
  finishBattle(h);
});

test('Rook: augmenting from the BIN during battle takes the card out of the BIN, not the hand', () => {
  // THE dangerous line. Both battle branches of doAugment used to hardcode
  // `e.player(seat).hand.splice(index, 1)`, so widening only the legality
  // check would have let a bin augment through and then deleted an unrelated
  // card out of the hand while leaving the bin card in place. Both are
  // `zoneTake` now.
  const h = new Harness(2911);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  const e0 = new E(h.state);
  e0.spawnUnit(A, 'Rook', h.state.battle!.region);
  e0.settle(); h.state = e0.s;
  // a hand that must survive untouched, and a bin with the augment in it
  h.state.players[A]!.hand = ['Unit Token', 'Unit Token', 'Unit Token'];
  h.state.players[A]!.bin = ['Emberflame Enlightener'];
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'augment', seat: A, from: 'bin', index: 0, hostId: host });
  pass(h); pass(h);
  assert.deepEqual(h.state.players[A]!.bin, [], 'the card left the BIN');
  assert.deepEqual(h.state.players[A]!.hand, ['Unit Token', 'Unit Token', 'Unit Token'],
    'and the hand is untouched — zoneTake, not hand.splice');
  assert.ok(ent(h, host)!.mods.some(id => ent(h, id)!.card === 'Emberflame Enlightener'),
    'the mod really attached');
  finishBattle(h);
});

test('Rook: legalActions OFFERS the bin augment, and offers nothing without a Rook', () => {
  // legalActions and apply route through the same predicate
  // (`battleAugmentAllowed`); the fuzzer's "legalActions lied" check has
  // caught that class of split before. This is the other direction: an action
  // that is legal must also be OFFERED, or the card is unreachable in the UI —
  // which is exactly how Rook's whole text stayed invisible.
  const h = new Harness(2912);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  h.state.players[A]!.bin = ['Emberflame Enlightener'];
  giveResources(h, A, 'fire', 4);
  const binAugments = () => h.legal(A).filter(
    a => a.type === 'augment' && (a as { from?: string }).from === 'bin');
  assert.equal(binAugments().length, 0, 'no Rook: the bin is not a battle-augment zone at all');
  const e = new E(h.state);
  e.spawnUnit(A, 'Rook', h.state.battle!.region);
  e.settle(); h.state = e.s;
  assert.ok(binAugments().length > 0, 'with a Rook in the region, the bin augment is offered');
  finishBattle(h);
});

test('Rook: the permission is REGION-scoped, and does not reach the opponent', () => {
  // "I am 99% sure that Rook has to be in the region, since there are no
  // global effects in Algomancy" (rodanaw, rules-questions, on this card) —
  // and "your" hand and bin, so it is the Rook controller's permission.
  const h = new Harness(2913);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Unit Token');
  const rookAtHome = spawn(h, A, 'Rook');                     // A's HOME region
  toNextBattle(h, A);                                         // battle is in D's region
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  const idx = give(h, A, 'Emberflame Enlightener');
  giveResources(h, A, 'fire', 4);
  assert.equal(ent(h, rookAtHome)!.region, new E(h.state).homeRegion(A), 'the Rook stayed home');
  assert.throws(
    () => h.do({ type: 'augment', seat: A, from: 'hand', index: idx, hostId: host }),
    /only Virus cards can augment from hand during battle/,
    'a Rook in another region grants nothing here (R12)');
  // and even in the region, it is not the OPPONENT's permission
  const e = new E(h.state);
  e.spawnUnit(A, 'Rook', h.state.battle!.region);
  e.settle(); h.state = e.s;
  const dIdx = give(h, D, 'Emberflame Enlightener');
  giveResources(h, D, 'fire', 4);
  while (h.state.priority !== D) pass(h);
  assert.throws(
    () => h.do({ type: 'augment', seat: D, from: 'hand', index: dIdx, hostId: host }),
    /only Virus cards can augment from hand during battle/,
    "\"YOUR hand and bin\": the opponent gets nothing from my Rook");
  finishBattle(h);
});

test('Rook: the [Augment] half works, and the permission belongs to the HOST', () => {
  // `self` in a ModPermission is the ANCHOR, so a Rook augmented onto a unit
  // grants that unit's controller the permission — the same "text reads from
  // the host" contract statics and cost mods radiate on. `augmentable: true`
  // is what keeps the card applicable at all now that the inert augmentText
  // stand-in is gone (isAugment reads augmentAttrs || augmentText ||
  // augmentable, and Rook prints neither of the first two).
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
  assert.equal(ent(h, host)!.mods.length, 1, 'still recognised as an augment');
  // the unit-in-play Rook is gone; only the mod on `host` carries the text now
  const e = new E(h.state);
  e.destroy(e.entity(rook)!, 'dies'); e.settle(); h.state = e.s;
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: p, columns: [[host]] });
  h.state.players[p]!.bin = ['Emberflame Enlightener'];
  giveResources(h, p, 'fire', 4);
  h.do({ type: 'augment', seat: p, from: 'bin', index: 0, hostId: host });
  pass(h); pass(h);
  assert.deepEqual(h.state.players[p]!.bin, [], 'the donated permission opened the bin');
  finishBattle(h);
});

test('Rook: it prints "hand and bin", so the CACHE stays shut', () => {
  // ModCtx.from is in the signature rather than hardcoded in apply.ts
  // precisely so this is the CARD's answer: Rook refuses the cache because
  // Rook does not print it, not because the rules cannot express it.
  const h = new Harness(2914);
  toDeployment(h);
  const A = h.state.initiative;
  const e = new E(h.state);
  const rook = e.spawnUnit(A, 'Rook', e.homeRegion(A));
  e.settle(); h.state = e.s;
  const card = getCard('Rook');
  const perms = card.modPermissions ?? [];
  assert.equal(perms.length, 1, 'one permission');
  const g = new E(h.state);
  const self = g.entity(rook.id)!;
  const ctx = (from: 'hand' | 'bin' | 'cache') =>
    ({ seat: A, card: getCard('Emberflame Enlightener'), from, region: self.region });
  assert.equal(perms[0]!.augmentInBattle!(g, self, ctx('hand')), true, 'hand: yes');
  assert.equal(perms[0]!.augmentInBattle!(g, self, ctx('bin')), true, 'bin: yes');
  assert.equal(perms[0]!.augmentInBattle!(g, self, ctx('cache')), false, 'cache: not printed');
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
  // R130: the placement names its actor — "when YOU put" reads `by`, and a
  // white-box call has no resolving effect to default it from.
  whiteBox(h, e => e.addCounters(ent(h, ally)!, 2, p));       // "you put counters on an ally"
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'drew a card');
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Crystal').length, 1,
    'the grafted Corroded Alchemy made its Crystal 1');
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Poison').length, 1, '…and its Poison 1');
  // [Switch1]: bounded — a second batch of counters this turn does nothing
  whiteBox(h, e => e.addCounters(ent(h, cust)!, 1, p));       // counters on the Custodian itself
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'no second draw (R9)');
  assert.equal(tokensOf(h, p).length, 2, 'no second token pair');
});

// ── The Silent ───────────────────────────────────────────────────────────

test('The Silent: spells cost [two] more per spell the team played this battle', () => {
  // Unparked by R59's cost-modifier layer. The behaviour proper (asymmetry,
  // the counter, stacking with Tranquility) is pinned in 49-playtest-round6;
  // this checks the card is wired into the layer at all.
  const c = getCard('The Silent');
  assert.equal(c.costMods?.length, 1, 'it carries a cost modifier');
  assert.equal(c.augmentable, true, 'and is still applicable as an augment');
});

test('The Silent: plays as a 3/4 and augments', () => {
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
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
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

test('Earthbound Replicator: a nonunit spell targeting me is copied; declining the retarget keeps the original target', () => {
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
  // "may choose new targets": the printed choice is offered to THE SPELL'S
  // PLAYER ("they copy it") mid-resolution. Declining pins the pre-choice
  // behavior exactly: the copy runs against the carrier.
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'the retarget question is a real decision');
  assert.equal(h.state.decision?.seat, A, "Replicator's 'they' — the copying player answers, not the carrier's owner");
  pick(h, false);                                             // keep the original target
  // R164: the copy is a real stack item now — it has its own priority window
  assert.ok(h.state.stack.some(i => i.copy), 'the copy is ON the stack');
  pass(h); pass(h);                                           // resolve the COPY
  pass(h); pass(h);                                           // then the original Fireball
  assert.ok(h.log.some(m => m.includes('copies Fireball')), 'the spell was copied');
  assert.equal(ent(h, repl)!.damage, 2, '1 original + 1 copy = 2 damage — exactly the pre-retarget behavior');
  assert.ok(ent(h, repl), 'the 1/3 survives');
  finishBattle(h);
});

test('Earthbound Replicator: choosing NEW targets aims the copy elsewhere; the original is untouched by it', () => {
  const h = new Harness(2920);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });
  pick(h, { unit: repl });                                    // Fireball 1 targets the Replicator
  pass(h); pass(h);                                           // resolve the copy trigger
  pick(h, true);                                              // choose new targets for the copy
  // the re-collection is fresh against Fireball's own spec ('any') — units
  // and players alike are on the menu, R64-judged now
  pick(h, { unit: atk });                                     // aim the copy at A's own 1/1
  pass(h); pass(h);                                           // resolve the COPY (R164: its own window)
  pass(h); pass(h);                                           // then the original Fireball
  assert.ok(!ent(h, atk), 'the copy hit the NEW target — the 1/1 died to it');
  assert.equal(ent(h, repl)!.damage, 1, 'only the ORIGINAL hit the Replicator — the copy did not touch it');
  finishBattle(h);
});

test('Earthbound Replicator: the retarget choice survives a JSON round-trip mid-decision (R85)', () => {
  const h = new Harness(2923);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });
  pick(h, { unit: repl });
  pass(h); pass(h);                                           // → the keep-or-new decision
  h.state = JSON.parse(JSON.stringify(h.state));              // save + load mid-choice
  pick(h, true);                                              // choose new targets
  h.state = JSON.parse(JSON.stringify(h.state));              // save + load mid-PICK too
  pick(h, { unit: atk });
  pass(h); pass(h);                                           // resolve the COPY (R164)
  pass(h); pass(h);
  assert.ok(!ent(h, atk), 'the loaded state still drives the retargeted copy');
  assert.equal(ent(h, repl)!.damage, 1, 'and the copy still misses the original target');
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
  // R57: the either-or is declared as the trigger is put on the stack, not as
  // it resolves — the item says which token it will make before anyone may
  // answer it.
  assert.equal(h.state.decision?.kind, 'mode', 'the half is a cast-time question');
  assert.equal(h.state.stack.length, 0, 'asked before the trigger reaches the stack');
  pick(h, 'Crystal');
  assert.equal(h.state.stack[0]?.parts[0]?.mode, 'Crystal', 'and it rides on the stack');
  pass(h); pass(h);                                           // resolve the trigger
  const crystals = tokensOf(h, D).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'one token created');
  assert.equal(crystals[0]!.x, 2, 'a Crystal 2');
  assert.equal(tokensOf(h, D).filter(t => t.card === 'Poison').length, 0, 'no Poison — the choice');
  finishBattle(h);
});

// ── Maelstrom Charger ────────────────────────────────────────────────────

test('Maelstrom Charger: sacrifice me as you play a nonunit spell → copy it; declining the retarget keeps the targets', () => {
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
  // "YOU may choose new targets" — the Charger's controller is asked, before
  // the sacrifice commits. Declining pins the pre-choice behavior exactly.
  assert.equal(h.state.decision?.seat, D, "Charger's 'you' — its controller answers");
  assert.ok(ent(h, chg), 'plan-then-commit: the Charger still stands while the retarget is asked');
  pick(h, false);                                             // keep the original targets
  pass(h); pass(h);                                           // resolve the COPY (R164: its own window)
  pass(h); pass(h);                                           // resolve the original Fireball
  assert.ok(!ent(h, chg), 'the Charger was sacrificed');
  assert.ok(h.state.players[D]!.bin.includes('Maelstrom Charger'), 'sacrificed → bin');
  assert.equal(h.state.players[A]!.life, lifeA - 2, 'copy + original: 2 total damage — exactly the pre-retarget behavior');
  finishBattle(h);
});

test('Maelstrom Charger: choosing NEW targets re-aims the copy; the original still hits its own target', () => {
  const h = new Harness(2921);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, D, 'Maelstrom Charger');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });
  pick(h, { player: A });                                     // the original: 1 at A's face
  pass(h); pass(h);                                           // resolve the Charger trigger
  pick(h, true);                                              // sacrifice → copy
  pick(h, true);                                              // choose new targets
  pick(h, { unit: atk });                                     // the copy re-aims at the attacker
  pass(h); pass(h);                                           // resolve the COPY (R164: its own window)
  pass(h); pass(h);                                           // resolve the original Fireball
  assert.ok(!ent(h, chg), 'the Charger was sacrificed');
  assert.ok(!ent(h, atk), 'the copy killed its NEW target');
  assert.equal(h.state.players[A]!.life, lifeA - 1, 'only the original hit the face');
  finishBattle(h);
});

test('Maelstrom Charger: with NO legal new target there is no retarget question — the originals ride', () => {
  const h = new Harness(2922);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, D, 'Maelstrom Charger');
  giveResources(h, D, 'metal', 2);                            // Arcane Echo m/2, {Battle}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // a token for the Echo to target — the ONLY token in the region
  let tok = 0;
  whiteBox(h, e => { tok = e.createSpellToken(A, 'Fireball', 1, h.state.battle!.region).id; });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arcane Echo') });
  pick(h, { unit: tok });                                     // Echo targets the token
  // A answers by removing the only token: now 'target token' has NO candidate
  whiteBox(h, e => { delete e.s.entities[tok]; });
  pass(h); pass(h);                                           // resolve the Charger trigger
  pick(h, true);                                              // sacrifice → copy
  // a genuinely empty choice is NOT a question: no retarget decision appears
  assert.ok(!h.state.decision, 'no retarget question when nothing is legal to aim at');
  assert.ok(h.log.some(m => m.includes('no legal new target')), 'and the log says why the originals ride');
  assert.ok(!ent(h, chg), 'the Charger was still sacrificed');
  // R164: the copy is a stack item, so a dead target fizzles it through the
  // ordinary R86 path — announced, in its own resolution, rather than being
  // swallowed by an inline "no target — no effect" line.
  pass(h); pass(h);                                           // the copy fizzles (target gone)
  assert.ok(h.log.some(m => m.includes('(copy) fizzles')), 'the copy fizzles and says so');
  pass(h); pass(h);                                           // the original Echo fizzles too (target gone)
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
  // R64: the bracket is an additional cost — sacrificed AT CAST, X fixed
  // there, and the effect it negates is a declared target on the stack.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Malevolent Machinations') });
  pick(h, { unit: d1 });                                      // sacrifice one unit…
  pick(h, { doneCost: true });                                // …then done: X = 1
  assert.ok(!ent(h, d1), 'the sacrifice is paid as it is cast, not at resolution');
  pick(h, { stack: collapseId });                             // aim at the Collapse (X = 1 → the only one)
  assert.ok(ent(h, d2), 'only X = 1 unit sacrificed');
  pass(h); pass(h);                                           // resolve Malevolent (top of stack)
  assert.ok(h.log.some(m => m.includes('is negated')), 'the effect was negated');
  assert.equal(h.state.stack.length, 0, 'R68: the negated Collapse left the stack at once');
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

test('Ember of Life: [once] a spell effect deals N damage → create N 1/1 units (R33, absorbed into R115)', () => {
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
  // R49 UN-PARKED: a real activation cost, paid in the cast window, and it can
  // only offer ANOTHER unit
  notOffered(h, { unit: ha }, '"another unit" — never the carrier');
  pick(h, { unit: t1 });                                      // the activation cost
  assert.ok(!ent(h, t1), 'the other unit was sacrificed');
  assert.deepEqual(effStats(h, ha), [1, 5], 'the Ancient gains +1/+1 (0/4 → 1/5)');
  assert.deepEqual(effStats(h, t2), [2, 2], 'the surviving ally gains +1/+1');
  assert.ok(!ent(h, t1), 'the sacrificed unit never benefits');
});

test('Hearthwood Ancient: with no other unit the ability is not offered at all', () => {
  const h = new Harness(2919);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const ha = spawn(h, p, 'Hearthwood Ancient');
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === ha),
    'unpayable [Sacrifice another unit] → not offered (it used to activate and fizzle)');
  assert.throws(() => h.do({ type: 'activateAbility', seat: p, entityId: ha, abilityIndex: 0, via: 'augment' }),
    /cannot pay/);
});
