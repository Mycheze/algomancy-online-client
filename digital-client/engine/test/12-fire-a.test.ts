/* Per-card tests for batch-fire-a (project rule: a test for every card).
 * Covers a stack sweeper (Flame Shield), mid-resolution sacrifice choices
 * (Immolate, Bloodwind Revenant, General Smof, Ghord, Infernal Cultivator —
 * the R6 choose model), bin recall (Delver of Mysteries), retargeting with a
 * payment out (Gravitational Correction), end-of-turn triggers (Harbinger of
 * Immolation, Infernal Wispweaver), formation token creation (Hooba-Lin), a
 * trigger-approximated aura (Animated Spark), a haste body plus a bin-resident
 * recall trigger (Cinder Scuttler, R51)
 * and the Manual p.18 AFFINITY BONUS that the [element] Resource faces reprint
 * as reminder text — including the seven-element conformance sweep that keeps
 * that rule out of card definitions (R116, R54). States are
 * built explicitly (give/spawn/giveResources) so parallel card registration
 * can't shift assertions. Seeds: 1200-1299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ALL_ELEMENTS } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';
import type { Element, EntityId, Seat } from '../src/types.ts';

/** spawn a stat token (no triggers) into a seat's home region */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

// ── Abyssal Evocation ────────────────────────────────────────────────────

test('Abyssal Evocation: in this battle, you may play spells from your bin', () => {
  // R96. The whole card. Before round 17 it resolved to an info line and went
  // to the bin, so a bin-recursion deck built on it had no recursion.
  const h = new Harness(1200);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 6);                    // Evocation rr/4 + Luminous Arc r/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Luminous Arc'];        // a {Battle} spell, already spent
  const region = h.state.battle!.region;
  const canPlay = () => new E(h.state).mayPlaySpellsFromBin(A, region);
  assert.equal(canPlay(), false, 'no permission to begin with');
  assert.equal(h.legal(A).filter(a => a.type === 'playFromBin').length, 0,
    'and nothing is offered');

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);                                  // resolve
  assert.equal(canPlay(), true, '"in this battle, you may play spells from your bin"');
  const offers = h.legal(A).filter(a => a.type === 'playFromBin');
  assert.equal(offers.length, 1, 'the Arc in the bin is offered');
  assert.ok(h.state.players[A]!.bin.includes('Abyssal Evocation'), 'the Evocation itself binned');
});

test('Abyssal Evocation: a bin-played spell is {Unstable} — it is ERASED, never re-binned', () => {
  // R69 names this card for the mechanism: "Reminder text on both cards that
  // GRANT it (Abyssal Evocation, Spell Excavation): '(If they would enter a
  // bin, erase them instead.)' — a bin replacement, in as many words. … Only
  // the destination changes." `dischargeItem` is the single choke point for
  // both resolution and negation, and this is the site an ordinary bin-played
  // spell hits.
  const h = new Harness(1240);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, D, 1, 30);
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Luminous Arc'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  assert.deepEqual(h.state.players[A]!.bin, ['Luminous Arc', 'Abyssal Evocation'],
    'the Arc is still there, and the Evocation joined it');

  h.do({ type: 'playFromBin', seat: A, binIndex: 0 });
  assert.deepEqual(h.state.players[A]!.bin, ['Abyssal Evocation'],
    'the Arc left the BIN as it was played (index 0)');
  pick(h, { unit: victim });
  pass(h); pass(h);                                  // resolve it
  // 7, not the Arc's printed 6: R104 made Conduit of Pain live, and the
  // attacker above is one — "[Augment] If an allied source would deal
  // noncombat damage, it deals that much damage plus 1 instead". The bin-play
  // path is what this test is about; the extra point is the replacement layer
  // working in a real game, on a card that used to be a vanilla 2/1 body.
  assert.equal(ent(h, victim)!.damage, 7, 'it really resolved (6 + Conduit of Pain\'s 1)');
  assert.ok(!h.state.players[A]!.bin.includes('Luminous Arc'),
    '"if they would enter a bin, erase them instead" — it did NOT come back');
  assert.ok((h.state.players[A]!.erased ?? []).includes('Luminous Arc'),
    'R65: the erase reaches the public erased pile');
  finishBattle(h);
});

test('Abyssal Evocation: the permission is this REGION\'s battle, and lapses at the next one', () => {
  // R14: "'this battle' = this region's battle". The permission is a
  // region-keyed battleCounter, which is exactly why round 1's grant cannot
  // leak into round 2 — and why it needed no cleanup code of its own.
  const h = new Harness(1241);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  assert.equal(new E(h.state).mayPlaySpellsFromBin(A, region), true, 'granted here');
  const other = h.state.regions.findIndex((_r, i) => i !== region);
  assert.equal(new E(h.state).mayPlaySpellsFromBin(A, other), false,
    'and nowhere else — the other region\'s battle is a different battle');
  finishBattle(h);
  toNextBattle(h, A);
  assert.equal(new E(h.state).mayPlaySpellsFromBin(A, region), false,
    'the next battle in the same region is a new battle');
});

test('Abyssal Evocation: without the permission the action is refused, not just unoffered', () => {
  const h = new Harness(1242);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Luminous Arc'];
  assert.throws(() => h.do({ type: 'playFromBin', seat: A, binIndex: 0 }),
    /no permission to play cards from your bin/,
    'apply refuses it, so legalActions and apply cannot drift apart in the safe direction only');
  finishBattle(h);
});

test('Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing', () => {
  // Shipped RESTRICTIVE, and this test is what says so out loud. R42/R45
  // answered the analogous CACHE question that way — "normal TIMING applies —
  // the card is played 'as if it were in your hand' … (Caleb 2025-12-28)" —
  // and `playAtTiming` enforces it for free, so a bin full of DEPLOY-timing
  // spells is inert under this card. If the owner rules the other way, this
  // needs an explicit timing override and this assertion flips.
  const h = new Harness(1243);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // Flame Juggle is a DEPLOY-timing spell; Luminous Arc is {Battle}
  h.state.players[A]!.bin = ['Flame Juggle', 'Luminous Arc'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  const offers = h.legal(A).filter(a => a.type === 'playFromBin')
    .map(a => h.state.players[A]!.bin[(a as { binIndex: number }).binIndex]);
  // the Evocation itself is in the bin now and is a {Battle} spell, so it is
  // legitimately one of the spells you may replay — which is worth knowing.
  assert.deepEqual(offers.sort(), ['Abyssal Evocation', 'Luminous Arc'],
    'only the {Battle} spells are reachable; the DEPLOY spell is not');
  assert.throws(() => h.do({ type: 'playFromBin', seat: A, binIndex: 0 }),
    /only battle cards can be played now/, 'and the deploy spell is refused outright');
  finishBattle(h);
});

test('Abyssal Evocation: a bin-played SPELL UNIT stamps its BODY, and "until regroup" ends it', () => {
  // The "edge, noted for review" in Spell Excavation's own comment: a spell
  // unit played this way spawns a body, and the body's later bin entry was not
  // tracked as unstable. StackItem.unstable → Entity.unstable closes it, and
  // the R11 step-3 sweep clears the stamp at regroup for free.
  const h = new Harness(1244);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Jelly'];               // a {Battle} spell UNIT, b/3 2/1
  assert.equal(getCard('Jelly').kind, 'spellUnit', 'the fixture is a spell unit');
  assert.equal(getCard('Jelly').timing, 'battle', 'and battle timing');
  giveResources(h, A, 'water', 3);                   // Jelly is b / 3
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  h.do({ type: 'playFromBin', seat: A, binIndex: 0 });
  pick(h, { unit: atk });                            // "target unit gains -2/-2"
  pass(h); pass(h);
  const body = unitsOf(h, A).find(u => u.card === 'Jelly');
  assert.ok(body, 'the body spawned');
  assert.equal(body!.unstable, true, 'and it carries the Unstable stamp');
  // it dies → erased, not binned
  const e = new E(h.state);
  e.destroy(e.entity(body!.id)!, 'dies'); e.settle(); h.state = e.s;
  assert.ok(!h.state.players[A]!.bin.includes('Jelly'), 'erased, not binned');
  assert.ok((h.state.players[A]!.erased ?? []).includes('Jelly'), 'and publicly so');
});

// ── Animated Spark ───────────────────────────────────────────────────────

test('Animated Spark: each nontoken spell played in battle gives your units +1/+0', () => {
  const h = new Harness(1201);
  toDeployment(h);
  const A = h.state.initiative;
  const spark = spawn(h, A, 'Animated Spark');       // 0/1; own [Augment] text live
  const ally = spawn(h, A, 'Conduit of Pain');       // 2/1
  giveResources(h, A, 'fire', 1);                    // Immolate r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[spark], [ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pick(h, { unit: ally });                           // cast cost (R35): sacrifice the ally NOW
  // STATIC: the bonus is live the moment the spell is PLAYED (ledger bump) —
  // no trigger, no stack round-trip
  assert.deepEqual(effStats(h, spark), [1, 1], 'Spark itself +1/+0');
  pass(h); pass(h);                                  // Immolate resolves → draw
  finishBattle(h);
});

// ── Bloodwind Revenant ───────────────────────────────────────────────────

test('Bloodwind Revenant: unblocked combat damage to opponent → may sacrifice to draw', () => {
  const h = new Harness(1202);
  toDeployment(h);
  const A = h.state.initiative;
  const rev = spawn(h, A, 'Bloodwind Revenant');     // 1/2 Flying
  const fodder = spawn(h, A, 'Conduit of Pain');     // 2/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rev], [fodder]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: 1 - A, blocks: {} });
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);   // combat: opponent takes 3 → trigger resolves at once (R3 sub-step drain)
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, 'the controller chooses the sacrifice');
  pick(h, fodder);                                   // sacrifice the fodder
  assert.ok(!ent(h, fodder), 'fodder sacrificed');
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'), 'sacrifice → bin');
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'drew a card');
  finishBattle(h);

  // blocked with no damage through: no trigger at all
  const h2 = new Harness(1252);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const rev2 = spawn(h2, A2, 'Bloodwind Revenant');
  const blk = spawn(h2, D2, 'Bloodwind Revenant');   // a Flying blocker
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[rev2]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [blk] } });
  const hand2 = h2.state.players[A2]!.hand.length;
  finishBattle(h2);                                  // trade, no player damage
  assert.equal(h2.state.players[A2]!.hand.length, hand2, 'no combat damage to a player → no draw');
});

// ── Cinder Scuttler ──────────────────────────────────────────────────────

test('Cinder Scuttler: playable in the haste step as a 2/1', () => {
  const h = new Harness(1203);
  const p = 0;
  const idx = give(h, p, 'Cinder Scuttler');
  giveResources(h, p, 'fire', 1);                    // r / 1
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone && !h.state.hasteDone[p], 'haste step engaged (R18)');
  h.do({ type: 'playCard', seat: p, handIndex: idx });
  const scut = unitsOf(h, p).find(u => u.card === 'Cinder Scuttler');
  assert.ok(scut, 'spawned during the haste step');
  assert.deepEqual(effStats(h, scut!.id), [2, 1], '2/1');
  h.do({ type: 'doneHaste', seat: p });
  h.do({ type: 'doneHaste', seat: 1 - p });          // R228: both seats close it
  assert.equal(h.state.phase, 'battle', 'battle follows the haste step');
});

test('Cinder Scuttler: recalled from the bin on combat damage to an opponent (R51)', () => {
  const h = new Harness(1213);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');             // 7/5, trigger-free beater
  h.state.players[A]!.bin.push('Cinder Scuttler');   // it is in A's bin
  h.state.players[D]!.bin.push('Cinder Scuttler');   // and in D's
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const scutsA = () => h.state.players[A]!.hand.filter(c => c === 'Cinder Scuttler').length;
  const scutsD = () => h.state.players[D]!.hand.filter(c => c === 'Cinder Scuttler').length;
  const beforeA = scutsA(), beforeD = scutsD();
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });   // unblocked → D takes 7
  pass(h); pass(h);
  assert.ok(h.state.players[D]!.life < 30, 'D took combat damage');
  assert.ok(!h.state.players[A]!.bin.includes('Cinder Scuttler'), "it left the DEALER's bin");
  assert.equal(scutsA(), beforeA + 1, "and is in the dealer's hand");
  assert.ok(h.state.players[D]!.bin.includes('Cinder Scuttler'),
    "the VICTIM's copy stays put — they dealt nothing");
  assert.equal(scutsD(), beforeD, 'and none reached their hand');
  assert.ok(!h.events.some(ev => ev.type === 'trashed' && ev.data?.['card'] === 'Cinder Scuttler'),
    'leaving a bin is not trashing (R40)');
  finishBattle(h);
});

test('Cinder Scuttler: one firing per bin, not per copy (R51)', () => {
  const h = new Harness(1214);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  h.state.players[A]!.bin.push('Cinder Scuttler', 'Cinder Scuttler', 'Cinder Scuttler');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const scuts = () => h.state.players[A]!.hand.filter(c => c === 'Cinder Scuttler').length;
  const before = scuts();
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(scuts(), before + 1,
    'three copies in the bin, ONE recall — the text is a standing permission (R51)');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Cinder Scuttler').length, 2,
    'the other two stay in the bin');
  finishBattle(h);
});

// ── Conduit of Pain ──────────────────────────────────────────────────────

test('Conduit of Pain: plays as a 2/1; augments (donating nothing yet)', () => {
  const h = new Harness(1204);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cp = spawn(h, p, 'Conduit of Pain');
  assert.deepEqual(effStats(h, cp), [2, 1], '2/1 body');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'fire', 2);                    // rr / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Conduit of Pain'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
  assert.deepEqual(effStats(h, host), [1, 1], 'the text is an AmountMod, so the host\'s stats do not change');
});

test('Conduit of Pain: an allied source deals its noncombat damage plus one', () => {
  // R104. The AMOUNT family: nothing is substituted and nothing is redirected,
  // the number is simply bigger by the time it lands. Luminous Arc prints 6.
  const h = new Harness(1250);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, D, 1, 30);
  // R12: the Conduit radiates in ITS OWN region, so it has to be in the battle
  // — it is the attacker here, exactly as a burn deck would play it.
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 7, 'the printed 6 was dealt as 7');
  finishBattle(h);
});

test('Conduit of Pain: two Conduits both apply, and neither applies to itself', () => {
  // Caleb, on how these compose: "a replacement only happens once … The
  // replacement just takes what would be 1 and makes it 2". So two DIFFERENT
  // modifiers both apply (6 → 8), and none applies to its own contribution —
  // which falls out of the shape rather than needing a guard, because an
  // AmountMod is CONSULTED once as a pure query rather than re-entering the
  // damage it is answering about.
  const h = new Harness(1251);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, D, 1, 30);
  const atk = spawn(h, A, 'Conduit of Pain');
  const atk2 = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [atk2]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 8, '6 + 1 + 1, not 6 + 1 and then +1 of that again');
  finishBattle(h);
});

test('Conduit of Pain: an ENEMY Conduit does not boost your spell', () => {
  // "an allied source" is the effect's CONTROLLER, which the damage batch
  // really knows (ctx.controller) — unlike the counters path, where addCounters
  // has no source at all. A Conduit standing in the same battle on the other
  // side is offered the same question and answers no.
  const h = new Harness(1252);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, D, 1, 30);            // a fat body in the battle region
  const atk = spawn(h, A, 'Conduit of Pain');        // A's Conduit, in the battle
  giveResources(h, D, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                           // A passes priority to D
  // D casts the burn at their own body. A's Conduit is standing right there and
  // is asked; "an ALLIED source" is allied to the CONDUIT, not to whoever is in
  // the room, so the enemy's spell is not boosted.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 6, 'an enemy Conduit does not boost your spell');
  finishBattle(h);
});

test('Conduit of Pain: the extra damage never reaches the stack, so nothing can negate it', () => {
  // CT-10's acceptance criterion, on the AmountMod half. A continuous modifier
  // has no stack item for Containment Protocol or Nothyr to find, and no
  // priority window opens between the spell's damage and the Conduit's point.
  const h = new Harness(1253);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, D, 1, 30);
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: victim });
  const before = h.events.length;
  pass(h); pass(h);
  const after = h.events.slice(before);
  assert.equal(after.filter(ev => ev.type === 'triggered').length, 0,
    'the Conduit queued nothing');
  assert.equal(after.filter(ev => ev.type === 'damage' && ev.data?.['unit'] === victim).length, 1,
    'ONE damage event carrying the whole 7 — not a 6 and then a 1');
  assert.equal(ent(h, victim)!.damage, 7);
  finishBattle(h);
});

// ── Delver of Mysteries ──────────────────────────────────────────────────

test('Delver of Mysteries: recalls a chosen spell from the bin, then spawns 2/2', () => {
  const h = new Harness(1205);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.bin.push('Immolate', 'Conduit of Pain');   // spell + unit
  giveResources(h, p, 'fire', 4);                    // rr / 4
  const immolatesBefore = h.state.players[p]!.hand.filter(n => n === 'Immolate').length;
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Delver of Mysteries') });
  // R67: the bin card is a CAST-TIME target, declared before the Delver is on
  // the stack — not a mid-resolution pick
  assert.equal(h.state.decision?.kind, 'targets', 'cast-time bin target');
  assert.equal(h.state.decision!.options.length, 1, 'only the SPELL is offered, not the unit');
  pick(h, { bin: { seat: p, card: 'Immolate' } });
  assert.equal(h.state.players[p]!.hand.filter(n => n === 'Immolate').length,
    immolatesBefore + 1, 'Immolate recalled to hand');
  assert.deepEqual(h.state.players[p]!.bin, ['Conduit of Pain'], 'unit stays in the bin');
  const delver = unitsOf(h, p).find(u => u.card === 'Delver of Mysteries');
  assert.ok(delver, 'spell unit spawns after resolving');
  assert.deepEqual(effStats(h, delver!.id), [2, 2]);
});

// ── Emberflame Enlightener ───────────────────────────────────────────────

test('Emberflame Enlightener: 0/5; your units in its region gain Powerful (live static)', () => {
  const h = new Harness(1206);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ee = spawn(h, A, 'Emberflame Enlightener');
  assert.deepEqual(effStats(h, ee), [0, 5], '0/5 body — Powerful changes no stats');
  const ally = spawn(h, A, 'Unit Token');
  const enemy = spawn(h, D, 'Unit Token');
  assert.ok(ownAttrs(h, ally).has('Powerful'), 'an allied unit gains Powerful');
  assert.ok(ownAttrs(h, ee).has('Powerful'), '"your units" includes itself');
  assert.ok(!ownAttrs(h, enemy).has('Powerful'), "the opponent's unit (another region) gains nothing");
  // the aura is continuous: it ends the moment the Enlightener leaves play
  const e = new E(h.state);
  e.destroy(ent(h, ee)!, 'dies'); e.settle();
  assert.ok(!ownAttrs(h, ally).has('Powerful'), 'the aura ends with the Enlightener');
});

test('Emberflame Enlightener: a Powerful column deals double combat damage', () => {
  const h = new Harness(1218);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ee = spawn(h, A, 'Emberflame Enlightener');   // 0/5 — attacks along to carry the aura (R12)
  const tok = spawn(h, A, 'Unit Token');              // 1/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok, ee]] });
  pass(h); pass(h);                                   // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 28, 'the 1-power column output is DOUBLED (Powerful units)');
  // (The spells half is live too as of round 17 — R94, tested below on its own
  // channel. This test is the UNITS half and stays a combat-damage test.)
});

test('Emberflame Enlightener: the units aura is DONATED too (mod-carried static)', () => {
  // The augment-donated form used to be parked on "statics run only while the
  // holder is a unit in play". E.anchored() radiates a mod's statics from its
  // HOST, so augmenting it hands the host's side the same aura.
  const h = new Harness(1224);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const host = spawn(h, A, 'Unit Token');
  const ally = spawn(h, A, 'Unit Token');
  const enemy = spawn(h, D, 'Unit Token');
  assert.ok(!ownAttrs(h, ally).has('Powerful'), 'nothing yet');
  giveResources(h, A, 'fire', 4);                     // rrr/4
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Emberflame Enlightener'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'it attached as a mod');
  assert.ok(ownAttrs(h, ally).has('Powerful'), 'the donated aura reaches the host controller\'s units');
  assert.ok(ownAttrs(h, host).has('Powerful'), '"your units" includes the host carrying it');
  assert.ok(!ownAttrs(h, enemy).has('Powerful'), 'and still nobody else');
});

test('Emberflame Enlightener: your SPELLS gain {Powerful} too — a spell effect deals double', () => {
  // R94, and the half the owner's spell deck was built around. The units half
  // is a StaticMod; this one cannot be, because StaticMod.affects is typed
  // over an Entity and a resolving spell is a StackItem. It is an
  // `effectAttrs` mod — CostMod's sibling — whose grant lands in
  // EffectCtx.grantedAttrs, which dealEffectDamage has unioned into the
  // source's attributes since R79.
  const h = new Harness(1233);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, A, 1, 30);             // fat enough to read the number off
  spawn(h, D, 'Emberflame Enlightener');              // defender's home region = the battle region
  giveResources(h, D, 'fire', 2);                     // Luminous Arc: r/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[victim]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 12, '"I deal 6 damage" from a Powerful source is 12');
  finishBattle(h);
});

test('Emberflame Enlightener: "YOUR spells" — the opponent\'s spell in the same region gains nothing', () => {
  // The control for the test above, and the region/ownership half in one: the
  // Enlightener is in the battle region, so the aura is in scope, and the
  // spell is still not its controller's.
  const h = new Harness(1234);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, D, 1, 30);
  spawn(h, D, 'Emberflame Enlightener');
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 6, "the ATTACKER's spell is not \"your\" spell");
  finishBattle(h);
});

test('Emberflame Enlightener: the SPELLS aura is DONATED too (mod-carried effectAttrs)', () => {
  // The gatherer walks anchored(), so it reaches augment MODS as well as units
  // in play and reads each from its HOST — the same contract statics and
  // costMods radiate on. Here the Enlightener is a mod on one of A's units and
  // A's spell still comes out Powerful.
  //
  // (Its host can only ever be an ALLY: this card is not a {Virus}, so it
  // cannot be applied during battle, and a deployment mod may only go on a
  // unit in your own region. Ownership is still decided against the ANCHOR's
  // controller rather than the applier's, which is what makes the two halves
  // of the [Augment] agree.)
  const h = new Harness(1235);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Unit Token');
  const victim = spawnToken(h, D, 1, 30);
  giveResources(h, A, 'fire', 6);                     // rrr/4 for the mod, r/2 for the Arc
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Emberflame Enlightener'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'it attached as a mod');
  toNextBattle(h, D);                                 // battle in A's region, where the mod is
  h.do({ type: 'declareAttack', seat: D, columns: [[victim]] });
  while (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 12, 'the donated aura doubles the host controller\'s spell');
  finishBattle(h);
});

test('Emberflame Enlightener: "your spells" INCLUDES your spell tokens (R157 §13)', () => {
  // RULED, and this title said "⚠ OPEN" for three days after it was answered.
  // R157 §13, the owner, 2026-08-25: **"Yes. Tokens are spells."** — recorded
  // there as *Already correct*, naming this exact card. The engine was right
  // and this test was pinning the right behaviour; only the title and the
  // paragraph below were stale, which is its own small lesson: a test that
  // announces an open question in its NAME keeps announcing it long after the
  // question closes, because nothing links a test title to a ruling. Found by
  // the round-29 reconciliation of the owner's answer sheet against the repo.
  //
  // The reasoning, kept because it is why the answer went this way: R59 carved
  // spell TOKENS out of `costMods` on the grounds that "a spell token is cast
  // from play, not played" — but that carve-out exists because Tranquility's
  // text says "to PLAY", and Emberflame has no play verb in it at all. So
  // "your spells" includes them, which is the difference between an Emberflame
  // deck doubling its Fireballs and not.
  //
  // `dsl.isSpellEffect` is the single line that decides it, and R157 §13 says
  // it stays as it is. (If it were ever reversed: drop 'spellToken' from that
  // line and change the number below to 3 — nothing else moves.)
  const h = new Harness(1236);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawnToken(h, A, 1, 30);
  spawn(h, D, 'Emberflame Enlightener');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[victim]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(D, 'Fireball', 3, region);
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D)[0]!.id });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 6, 'a Fireball 3 under the aura deals 6, not 3');
  finishBattle(h);
});

// ── Envoy of Lightning ───────────────────────────────────────────────────

test('Envoy of Lightning: plays as a 3/2, and is still applicable as an augment', () => {
  const h = new Harness(1207);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const el = spawn(h, p, 'Envoy of Lightning');
  assert.deepEqual(effStats(h, el), [3, 2], '3/2 body');
  // The whole card is an [Augment], and it prints no augmentAttrs and now has
  // no augmentText either — `isAugment` reads
  // `augmentAttrs || augmentText || augmentable`, so dropping the old inert
  // stub without `augmentable: true` would have silently deleted the card.
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'fire', 2);                     // rr/2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Envoy of Lightning'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'it still attaches as a mod');
});

test('Envoy of Lightning: your single-target spell effects are Electric', () => {
  // R94. Luminous Arc ("I deal 6 damage to target unit") is a plain spell with
  // no printed attributes; under the Envoy it becomes {Electric}, so its
  // excess past lethal walks to an adjacent unit (R4).
  const h = new Harness(1230);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Unit Token');            // 1/1
  const back = spawnToken(h, A, 1, 20);               // big enough to survive the excess
  spawn(h, D, 'Envoy of Lightning');                  // defender's home region
  giveResources(h, D, 'fire', 2);                     // Luminous Arc: r/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: front });
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, front), '1/1 dies to the first point');
  assert.equal(ent(h, back)!.damage, 5,
    'the other 5 followed the Electric path to the only adjacent unit');
  finishBattle(h);
});

test('Envoy of Lightning: two DECLARED targets is not "a single target", even after one is removed', () => {
  // RAQ "[Solved] Envoy of Lightning vs Twin Flame.", the card by name and the
  // reason this whole channel is per-part with a DECLARED count:
  //   Q: "What if Twin Flame was played targeting two units, but one of them
  //       was removed before Twin Flame resolves. Will it be Electric?"
  //   A: "No, it still has 2 targets, but one of them is invalid (but could
  //       become valid thanks to Gravitational Correction or Warder)."
  // resolveParts drops the dead ref before it builds ctx.targets, so a seam
  // built on the SURVIVOR count would score perfectly on Emberflame Enlightener
  // and wrongly — and invisibly — here.
  const h = new Harness(1231);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Unit Token');            // 1/1, col 0 front
  const back = spawnToken(h, A, 1, 20);               // col 0 back
  const other = spawn(h, A, 'Unit Token');            // 1/1, col 1 — the second target
  spawn(h, D, 'Envoy of Lightning');
  giveResources(h, D, 'fire', 3);                     // Twin Flame: rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back], [other]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Twin Flame') });
  pick(h, { unit: front });
  pick(h, { unit: other });                           // TWO declared targets
  // ...and now the second one is removed while the spell is still on the stack
  const e = new E(h.state);
  e.destroy(e.entity(other)!, 'dies'); e.settle();
  h.state = e.s;
  pass(h); pass(h);                                   // resolve with one live target
  assert.ok(!ent(h, front), 'the surviving target still takes its 2 and dies');
  assert.equal(ent(h, back)!.damage, 0,
    '"it still has 2 targets, but one of them is invalid" — NOT Electric, so the excess is lost');
  finishBattle(h);
});

test('Envoy of Lightning: one declared target on the SAME spell is Electric (the control)', () => {
  // The other half of the RAQ — "If Twin Flame is played with only 1 target,
  // is it Electric thanks to Envoy? … Yes, it will be Electric" — on the same
  // board as the test above, so the only difference between them is the number
  // of slots that were filled at cast.
  const h = new Harness(1232);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Unit Token');            // 1/1
  const back = spawnToken(h, A, 1, 20);
  const other = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Envoy of Lightning');
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back], [other]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Twin Flame') });
  pick(h, { unit: front });
  pick(h, { doneTargets: true });                     // "up to two" — stop at one
  pass(h); pass(h);
  // R4: two units are adjacent to the dead 1/1 (its column-mate and the
  // neighbouring column's front), so the Electric excess asks its controller
  // which way to go — an electricPath decision existing AT ALL is the proof
  // that the spell resolved as {Electric}.
  assert.equal(h.state.decision?.kind, 'electricPath', 'Electric: the 1 excess needs a path');
  assert.equal(h.state.decision!.seat, D, "the Electric SOURCE's controller chooses (R4)");
  pick(h, back);
  assert.ok(!ent(h, front), 'the 1/1 dies to the first point');
  assert.equal(ent(h, back)!.damage, 1, 'and the 1 excess walked the chosen way');
  finishBattle(h);
});

// ── Fire Resource ────────────────────────────────────────────────────────

test('Fire Resource: registered with its printed face', () => {
  const c = getCard('Fire Resource');
  assert.equal(c.cost, 'r');
  assert.equal(c.power, 2);
  assert.equal(c.toughness, 0);
});

/* ── THE AFFINITY BONUS (Manual p.18) ──────────────────────────────────────
 *
 * These were a `{ todo: true }` test for weeks, and the ledger carried a
 * `gap: 'dead'` entry beside them, both saying the clause needed "the
 * resource-CARD model and a dispatched activation event". Both were WRONG.
 *
 * "When I activate, if you have at least [r][r][r], create a Shard. {i}(It
 * spawns dormant.)" is not card-specific behaviour. It is the Manual p.18
 * GENERAL RULE, reprinted on the physical card as reminder text, and it has
 * been implemented the whole time in `apply.ts::maybeGrantShard` — for every
 * element, on the real `activateResource` action path.
 *
 * ⚠ NOTE FOR WHOEVER READS THIS NEXT: printed.json carries only THREE Resource
 * faces — Fire, Water and Earth. There is no Wood, Metal, Light or Dark
 * Resource card. So the sweep below is the guard rail: "implementing" the
 * three faces would route a SEVEN-element rule through three card definitions
 * and silently drop the bonus for the other four. That is why these are
 * declared in 71-card-ledger's NOT_A_GAP rather than implemented. R116, R54.
 */

test('Fire Resource: activating your 3rd fire pays the p.18 affinity Shard — dormant, and every time', () => {
  const h = new Harness(1254);
  giveResources(h, 0, 'fire', 2, 'open');
  giveResources(h, 0, 'fire', 1, 'dormant');
  const dormant = (): number =>
    h.state.players[0]!.resources.findIndex(r => r.kind === 'fire' && r.state === 'dormant');
  const shards = (): { state: string }[] => h.state.players[0]!.resources.filter(r => r.kind === 'shard');

  h.do({ type: 'activateResource', seat: 0, index: dormant() });
  assert.equal(shards().length, 1, 'the printed clause: at [r][r][r], a Shard');
  assert.equal(shards()[0]!.state, 'dormant', '"(It spawns dormant.)"');
  assert.equal(h.q.affinity(0, 'fire'), 3, 'and the Shard itself adds no fire affinity');

  // Caleb, asked whether the bonus happens once or every time: "Every time."
  giveResources(h, 0, 'fire', 1, 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: dormant() });
  assert.equal(shards().length, 2, '"Every time" — not once per game, not once per turn');
});

test('Fire Resource: below three affinity the clause does nothing', () => {
  const h = new Harness(1255);
  giveResources(h, 0, 'fire', 1, 'open');
  giveResources(h, 0, 'fire', 1, 'dormant');
  const i = h.state.players[0]!.resources.findIndex(r => r.kind === 'fire' && r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: i });
  assert.equal(h.q.affinity(0, 'fire'), 2, 'the 2nd fire — "at least [r][r][r]" is not met');
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 0);
});

test('the resource being activated COUNTS TOWARD ITS OWN THREE — the boundary', () => {
  // The pinned reading of "if you have at least [r][r][r]": it is checked
  // AFTER the resource turns face-up, so your THIRD fire pays for itself. The
  // alternative reading ("three OTHER fire") would mean the bonus first
  // arrives on the 4th, and nothing else in the suite says which it is. This
  // test is the difference between the two, made to fail if it ever moves.
  const h = new Harness(1256);
  giveResources(h, 0, 'fire', 2, 'open');            // two face-up: affinity 2
  giveResources(h, 0, 'fire', 1, 'dormant');
  assert.equal(h.q.affinity(0, 'fire'), 2, 'BEFORE the activation the player is one short');
  const i = h.state.players[0]!.resources.findIndex(r => r.kind === 'fire' && r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: i });
  assert.equal(h.q.affinity(0, 'fire'), 3, 'the activated resource is the third');
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 1,
    'and it pays out on the activation that made the third — not on the fourth');
});

test('CONFORMANCE: every element pays the p.18 affinity bonus at 3 — all seven, not just the three with printed faces', () => {
  // THE TEST THAT MATTERS. It fails the day someone "implements" Fire/Water/
  // Earth Resource as card definitions: the bonus would then live on three
  // card faces, and wood, metal, light and dark — which have NO Resource face
  // in printed.json to hang it on — would silently stop paying.
  //
  // Exhaustive by construction: the Record forces a compile error if a new
  // Element is added to the type without a line here.
  const EVERY_ELEMENT: Record<Element, true> = {
    fire: true, water: true, earth: true, wood: true, metal: true, light: true, dark: true,
  };
  const elements = Object.keys(EVERY_ELEMENT) as Element[];
  assert.deepEqual([...elements].sort(), [...ALL_ELEMENTS].sort(),
    'this sweep must cover exactly the engine\'s element list');

  const missed: string[] = [];
  for (const el of elements) {
    // a fresh game per element: ACTIVATIONS_PER_TURN is 2, and the point is
    // the rule, not the budget
    const h = new Harness(1257);
    giveResources(h, 0, el, 2, 'open');
    giveResources(h, 0, el, 1, 'dormant');
    const i = h.state.players[0]!.resources.findIndex(r => r.kind === el && r.state === 'dormant');
    h.do({ type: 'activateResource', seat: 0, index: i });
    const shards = h.state.players[0]!.resources.filter(r => r.kind === 'shard');
    if (shards.length !== 1) missed.push(`${el}: ${shards.length} shards, expected exactly 1`);
    else if (shards[0]!.state !== 'dormant') missed.push(`${el}: shard arrived ${shards[0]!.state}, not dormant`);
  }
  assert.deepEqual(missed, [],
    'the p.18 affinity bonus is a rule about ELEMENTS, implemented once in '
    + 'apply.ts::maybeGrantShard. printed.json has Resource faces for only fire, '
    + 'water and earth — so if this failed for wood/metal/light/dark, the likely '
    + 'cause is that the rule was moved onto those three card definitions. Put it '
    + 'back in maybeGrantShard; see R116 and 71-card-ledger\'s NOT_A_GAP.');
});

test('CONFORMANCE: a Prismite and a Shard never pay the bonus, however many you have', () => {
  // maybeGrantShard's two early returns, pinned. R17: prismites give no
  // affinity; R54: nor do shards. Neither is an "elemental resource" in the
  // p.18 sense, so neither can reach three affinity of anything.
  for (const kind of ['prismite', 'shard'] as const) {
    const h = new Harness(1258);
    giveResources(h, 0, kind, 3, 'open');
    giveResources(h, 0, kind, 1, 'dormant');
    const before = h.state.players[0]!.resources.filter(r => r.kind === 'shard').length;
    const i = h.state.players[0]!.resources.findIndex(r => r.kind === kind && r.state === 'dormant');
    h.do({ type: 'activateResource', seat: 0, index: i });
    const after = h.state.players[0]!.resources.filter(r => r.kind === 'shard').length;
    assert.equal(after, before, `activating a ${kind} must create nothing`);
  }
});

// ── Flame Shield ─────────────────────────────────────────────────────────

test('Flame Shield: negates the rest of the stack; a Fireball per nontoken spell', () => {
  const h = new Harness(1209);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Conduit of Pain');
  const whale = spawn(h, D, 'Good Whale');           // 7/5, Arc's target
  giveResources(h, A, 'fire', 8);
  giveResources(h, D, 'fire', 4);                    // rr / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame Shield') });
  pass(h); pass(h);                                  // Flame Shield resolves first
  const fires = tokensOf(h, D).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'one nontoken spell negated → one Fireball');
  assert.equal(fires[0]!.x, 1, 'Fireball 1');
  assert.equal(h.state.stack.length, 0, 'R68: the negated Arc is off the stack already');
  assert.ok(ent(h, whale), 'target survives');
  assert.equal(ent(h, whale)!.damage, 0, 'no damage dealt');
  assert.ok(h.state.players[A]!.bin.includes('Luminous Arc'), 'negated spell → bin');
  finishBattle(h);
});

// ── General Smof ─────────────────────────────────────────────────────────

test('General Smof: after combat, each present player sacrifices a unit of their choice', () => {
  const h = new Harness(1210);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const smof = spawn(h, A, 'General Smof');
  const fodder = spawn(h, A, 'Conduit of Pain');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[smof], [fodder]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat, afterCombat trigger pushed
  pass(h); pass(h);                                  // resolve the trigger
  assert.equal(h.state.decision?.seat, D, 'region owner picks first (presentSeats order)');
  pick(h, whale);                                    // D sacrifices the whale
  assert.equal(h.state.decision?.seat, A, 'then the attacker picks');
  pick(h, fodder);                                   // A keeps Smof
  assert.ok(!ent(h, whale) && !ent(h, fodder), 'both sacrifices committed together');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'));
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'));
  assert.ok(ent(h, smof), 'Smof survives');
  finishBattle(h);
});

// ── Ghord ────────────────────────────────────────────────────────────────

test('Ghord: sacrificing a unit makes each present opponent sacrifice a nontoken unit', () => {
  const h = new Harness(1211);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ghord = spawn(h, A, 'Ghord');
  const fodder = spawn(h, A, 'Conduit of Pain');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 1);                    // Immolate r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ghord], [fodder]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pick(h, { unit: fodder });                         // cast cost (R35): sacrificed NOW → Ghord triggers
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'), 'sacrificed → bin');
  pass(h); pass(h);                                  // Ghord's trigger (above Immolate) resolves
  assert.equal(h.state.decision?.seat, D, 'the opponent picks their sacrifice');
  pick(h, whale);
  assert.ok(!ent(h, whale), 'opponent sacrificed a nontoken unit');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'));
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                  // Immolate resolves → draw
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'Immolate drew');
  assert.ok(ent(h, ghord), 'Ghord still in play');
  finishBattle(h);
});

// ── Gravitational Correction ─────────────────────────────────────────────

test('Gravitational Correction: retargets the effect unless its controller pays [x]', () => {
  const h = new Harness(1212);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const conduit = spawn(h, A, 'Conduit of Pain');    // 2/1 attacker (the new target)
  const whale = spawn(h, D, 'Good Whale');           // 7/5 (the original target)
  giveResources(h, A, 'fire', 8);
  giveResources(h, D, 'fire', 2);                    // rr / X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[conduit]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  const arcId = h.state.stack.find(i => i.card === 'Luminous Arc')!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Gravitational Correction') });
  pick(h, 2);                                        // X = 2, chosen and paid AT CAST (R35)
  pick(h, { stack: arcId });
  pass(h); pass(h);                                  // resolve the Correction
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, "the EFFECT's controller decides (R6)");
  assert.ok(h.state.decision!.options.some(o => o.value === true), 'pay [2] is affordable & offered');
  pick(h, false);                                    // decline → retarget
  assert.equal(h.state.decision?.seat, D, "the Correction's controller picks the new target");
  pick(h, { unit: conduit });
  assert.ok(h.state.players[D]!.bin.includes('Gravitational Correction'), 'spell → bin');
  pass(h); pass(h);                                  // Arc resolves at its NEW target
  assert.ok(!ent(h, conduit), 'retargeted Arc killed the 2/1');
  assert.ok(ent(h, whale), 'original target untouched');
  assert.equal(ent(h, whale)!.damage, 0);
  finishBattle(h);
});

// ── Harbinger of Immolation ──────────────────────────────────────────────

test('Harbinger of Immolation: end of turn → Fireball X, X = 1 + your spell tokens', () => {
  const h = new Harness(1213);
  toDeployment(h);
  const p = h.state.initiative;
  spawn(h, p, 'Harbinger of Immolation');
  const e = new E(h.state);                          // two tokens made after regroup
  e.createSpellToken(p, 'Fireball', 1, e.homeRegion(p));
  e.createSpellToken(p, 'Fireball', 1, e.homeRegion(p));
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 3, 'the two originals plus the new one');
  assert.ok(fires.some(t => t.x === 3), 'X = 1 + 2 controlled tokens = 3 (R1: live at resolution)');
});

// The [Augment] half (rooms ZQPC + SAAY: "my fireball was erased during
// regroup even tho I have the Harbinger!!!"). It is a STATIC, so it is live
// in BOTH forms — the card played normally and the card donated to a host —
// and startRegroup asks per token instead of erasing unconditionally.

test('Harbinger of Immolation: in play as a UNIT, your spell tokens stay through regroup', () => {
  const h = new Harness(1225);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Harbinger of Immolation');
  const e = new E(h.state);
  const tok = e.createSpellToken(A, 'Fireball', 4, e.homeRegion(A));
  toNextBattle(h, A);                                // EOT: the trigger adds one more
  const before = tokensOf(h, A).length;
  assert.ok(before >= 2, 'the seeded Fireball plus the end-of-turn one');
  finishBattle(h);                                   // → regroup → deployment
  assert.equal(h.state.phase, 'deploy');
  assert.equal(tokensOf(h, A).length, before, 'every one of them survived regroup');
  assert.ok(ent(h, tok.id), 'the seeded Fireball in particular');
});

test('Harbinger of Immolation: a surviving token keeps its X, and still loses its temporary changes', () => {
  const h = new Harness(1226);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Harbinger of Immolation');
  const e = new E(h.state);
  const tok = e.createSpellToken(A, 'Fireball', 7, e.homeRegion(A));
  tok.tempPower = 3; tok.tempToughness = 2; tok.tempAttrs = ['Lethal'];
  toNextBattle(h, A);
  finishBattle(h);
  const t = ent(h, tok.id);
  assert.ok(t, 'not erased');
  assert.equal(t!.x, 7, 'X is untouched — regroup never rewrote it');
  assert.equal(t!.region, new E(h.state).homeRegion(A), 'it came home with everything else');
  assert.equal(t!.tempPower, 0, 'step (3) still swept it: it is spared the erase, not the cleanup');
  assert.equal(t!.tempToughness, 0);
  assert.equal(t!.tempAttrs, undefined);
});

test('Harbinger of Immolation: augmented onto a host, the HOST controller\'s tokens stay', () => {
  const h = new Harness(1227);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Conduit of Pain');
  const e = new E(h.state);
  e.attachMod(ent(h, host)!, 'Harbinger of Immolation', A, 'augment');
  const tok = e.createSpellToken(A, 'Fireball', 2, e.homeRegion(A));
  toNextBattle(h, A);
  finishBattle(h);
  assert.ok(ent(h, tok.id), 'the mod radiates the static from its host (E.anchored)');
});

test('Harbinger of Immolation: only YOUR tokens stay — the opponent\'s are still erased', () => {
  const h = new Harness(1228);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, A, 'Harbinger of Immolation');
  const e = new E(h.state);
  const mine = e.createSpellToken(A, 'Fireball', 1, e.homeRegion(A));
  const theirs = e.createSpellToken(D, 'Fireball', 1, e.homeRegion(D));
  toNextBattle(h, A);
  finishBattle(h);
  assert.ok(ent(h, mine.id), 'mine stays');
  assert.ok(!ent(h, theirs.id), "the opponent's is erased as normal");
});

test('Harbinger of Immolation: no Harbinger (or it left play first) → tokens erased as normal', () => {
  const h = new Harness(1229);
  toDeployment(h);
  const A = h.state.initiative;
  const harb = spawn(h, A, 'Harbinger of Immolation');
  const e = new E(h.state);
  const tok = e.createSpellToken(A, 'Fireball', 5, e.homeRegion(A));
  toNextBattle(h, A);
  const e2 = new E(h.state);
  e2.destroy(ent(h, harb)!, 'dies');                 // the static goes with it
  e2.settle();
  finishBattle(h);
  assert.ok(!ent(h, tok.id), 'nothing protects the token any more');
  assert.equal(tokensOf(h, A).length, 0, 'and neither does the end-of-turn Fireball it made');
});

test('regroup default is unchanged: with no Harbinger anywhere, spell tokens are erased', () => {
  const h = new Harness(1230);
  toDeployment(h);
  const A = h.state.initiative;
  const e = new E(h.state);
  const tok = e.createSpellToken(A, 'Fireball', 3, e.homeRegion(A));
  toNextBattle(h, A);
  finishBattle(h);
  assert.ok(!ent(h, tok.id), '(+) spell tokens are erased');
});

// ── Hooba-Lin ────────────────────────────────────────────────────────────

test('Hooba-Lin: augmented host attacking creates a 1/1 in its formation column', () => {
  const h = new Harness(1214);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Conduit of Pain');
  giveResources(h, p, 'fire', 2);                    // rr / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Hooba-Lin'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'Hooba-Lin augments the host');
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: p, columns: [[host]] });
  pass(h); pass(h);                                  // resolve the attack trigger
  // R75: the controller now chooses the slot — either end of the line, or the
  // back slot of the one-unit column. This used to be auto-picked.
  const dec = h.state.decision!;
  assert.equal(dec.seat, p, 'the effect\'s controller picks');
  assert.deepEqual(dec.options.map(o => o.label),
    ['a new column on the left', 'column 1, behind Conduit of Pain', 'a new column on the right']);
  pick(h, 1);                                        // behind the host
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the 1/1 joined my column');
  const tok = ent(h, col[1]!)!;
  assert.equal(tok.card, 'Unit Token');
  assert.ok(tok.token, 'a token');
  assert.deepEqual(effStats(h, tok.id), [1, 1]);
  finishBattle(h);
});

// ── Immolate ─────────────────────────────────────────────────────────────

test('Immolate: sacrifice a unit to draw a card', () => {
  const h = new Harness(1215);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 1);                    // r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  const handBefore = h.state.players[A]!.hand.length;
  pick(h, { unit: atk });                            // cast cost (R35): paid BEFORE the stack push
  assert.ok(!ent(h, atk), 'unit sacrificed at cast');
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'), 'sacrifice → bin');
  pass(h); pass(h);                                  // resolve → draw
  assert.ok(h.state.players[A]!.bin.includes('Immolate'), 'the spell → bin');
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'drew a card');
  finishBattle(h);
});

// ── Infernal Cultivator ──────────────────────────────────────────────────

test('Infernal Cultivator: [once] sacrifice X units → X Fireball 1; once per turn', () => {
  const h = new Harness(1216);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cult = spawn(h, p, 'Infernal Cultivator');
  const f1 = spawn(h, p, 'Conduit of Pain');
  const f2 = spawn(h, p, 'Conduit of Pain');
  h.do({ type: 'activateAbility', seat: p, entityId: cult, abilityIndex: 0, via: 'augment' });
  // R196: "Sacrifice X units" is a real cast COST now, so the picks are the
  // cost collector's, made in the cast window before the item is respondable
  pick(h, { unit: f1 });                             // first sacrifice
  pick(h, { unit: f2 });                             // second
  pick(h, { doneCost: true });                       // "That's enough" → X = 2
  assert.ok(!ent(h, f1) && !ent(h, f2), 'both sacrificed');
  assert.equal(h.state.players[p]!.bin.filter(n => n === 'Conduit of Pain').length, 2);
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 2, 'X Fireballs created');
  assert.ok(fires.every(t => t.x === 1), 'each is a Fireball 1');
  assert.ok(ent(h, cult), 'Cultivator itself was not picked');
  assert.throws(() => h.do({ type: 'activateAbility', seat: p, entityId: cult, abilityIndex: 0, via: 'augment' }),
    /already used/, '[once]: bounded per turn (R9)');
});

// ── Infernal Wispweaver ──────────────────────────────────────────────────

test('Infernal Wispweaver: [Augment] end of turn → create a Wisp', () => {
  const h = new Harness(1217);
  toDeployment(h);
  const p = h.state.initiative;
  spawn(h, p, 'Infernal Wispweaver');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn
  const wisp = unitsOf(h, p).find(u => u.card === 'Wisp');
  assert.ok(wisp, 'a Wisp is created at end of turn');
  assert.ok(wisp!.token, 'the Wisp is a token');
  assert.deepEqual(effStats(h, wisp!.id), [2, 2], 'the weaver in play: its 0/1 Wisp is a live 2/2');
});

test('Infernal Wispweaver: your Wisps in its region gain +2/+1 (live static)', () => {
  const h = new Harness(1219);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const weaver = spawn(h, A, 'Infernal Wispweaver');
  const wisp = spawn(h, A, 'Wisp');
  assert.deepEqual(effStats(h, wisp), [2, 2], 'a 0/1 Wisp is a live 2/2');
  const foeWisp = spawn(h, D, 'Wisp');
  assert.deepEqual(effStats(h, foeWisp), [0, 1], "an enemy Wisp (another region) is untouched");
  assert.deepEqual(effStats(h, weaver), [2, 1], 'the weaver is no Wisp itself');
  const e = new E(h.state);
  e.destroy(ent(h, weaver)!, 'dies'); e.settle();
  assert.deepEqual(effStats(h, wisp), [0, 1], 'the static ends with the weaver');
});

test('Infernal Wispweaver: wisps do not sacrifice themselves after combat', () => {
  // R62 UNPARKED: the playtest report was "I have infernal wispweaver, but my
  // wisps sacrificed themselves anyway!!!". The Wisp's whole ability list is
  // "After combat, sacrifice me", so the weaver's static suppresses it.
  const h = new Harness(1221);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, A, 'Infernal Wispweaver');
  const mine = spawn(h, A, 'Wisp');
  const theirs = spawn(h, D, 'Wisp');
  const e = new E(h.state);
  assert.ok(e.abilitiesSuppressed(ent(h, mine)!), "my Wisp's abilities are off");
  assert.ok(!e.abilitiesSuppressed(ent(h, theirs)!), "the enemy's Wisp is untouched");
  assert.deepEqual(e.suppressionOf(ent(h, mine)!).by, ['Infernal Wispweaver'],
    'the text box names who switched it off');
  assert.ok(e.ownAttrs(ent(h, mine)!).has('Feeble'),
    'only the ABILITY layer is off — {Feeble} is a printed attribute and stays');
});

test('Infernal Wispweaver: the Wisp survives the after-combat sacrifice', () => {
  const h = new Harness(1222);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const weaver = spawn(h, A, 'Infernal Wispweaver');
  const guarded = spawn(h, A, 'Wisp');
  toNextBattle(h, A);
  const e = new E(h.state);
  const doomed = e.spawnUnit(D, 'Wisp', h.state.battle!.region).id;
  e.settle();
  // the weaver rides along so the static reaches the Wisp in the battle region
  h.do({ type: 'declareAttack', seat: A, columns: [[weaver], [guarded]] });
  finishBattle(h);
  assert.ok(ent(h, guarded), 'my Wisp is still there after combat');
  assert.ok(!ent(h, doomed), 'the unguarded enemy Wisp sacrificed itself as printed');
});

test('Infernal Wispweaver: the suppression ends the instant the weaver does', () => {
  const h = new Harness(1223);
  toDeployment(h);
  const A = h.state.initiative;
  const weaver = spawn(h, A, 'Infernal Wispweaver');
  const wisp = spawn(h, A, 'Wisp');
  const e = new E(h.state);
  assert.ok(e.abilitiesSuppressed(ent(h, wisp)!));
  e.destroy(ent(h, weaver)!, 'dies'); e.settle();
  assert.ok(!new E(h.state).abilitiesSuppressed(ent(h, wisp)!),
    'continuous, not a one-off stamp — the Wisp gets its ability back');
});
