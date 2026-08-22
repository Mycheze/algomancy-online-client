/* Per-card tests for the fire/water/earth hybrid batch (batch-hybrids-fwe):
 * despawn-amount snapshots (A Pile of Runes), the engine Ambush mode + a
 * bounded damage-mirror (Mirrorback Ambusher), first-spell negation (Origon,
 * R14 counters), after-combat recalls/sacrifices (Unfinished Creation,
 * Unstable Form), battle life-loss draws (Astral Painseeker), spell-cost
 * sacrifices (Death Greeter), X-spell machinery with white-box x (Channel
 * Through, Torrential Reclamation — X is chosen and paid at cast, R35),
 * survive-damage punishment (Molten Tormentor), an [Augment]-text activated
 * ability (Slag Spewer), defense-bar sacrifices (Structural Collapse),
 * despawn pings (Demon of the Depths) and a pay-to-draw death trigger
 * (Tempest Oracle) and Stasis Sentry's continuous cost tax (R59 — un-parked;
 * it used to carry a todo saying the cost layer did not exist).
 * States are built explicitly (give/spawn/giveResources) so parallel card
 * registration can't shift assertions. Seeds: 1900-1999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
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

// ── A Pile of Runes ──────────────────────────────────────────────────────

test('A Pile of Runes: despawning creates a Crystal X, X = defense (self and donated)', () => {
  const h = new Harness(1901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  // played normally: its own [Augment] text is live — dies as a 1/3 → Crystal 3
  const pile = spawn(h, p, 'A Pile of Runes');
  whiteBox(h, e => e.destroy(ent(h, pile)!, 'dies'));
  let crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'one Crystal created');
  assert.equal(crystals[0]!.x, 3, 'X = the 1/3 body’s defense');
  // donated by augment: the HOST’s despawn makes the Crystal, X = host defense
  const host = spawn(h, p, 'Unit Token');                     // 1/1
  giveResources(h, p, 'water', 1);
  giveResources(h, p, 'earth', 1);
  giveResources(h, p, 'fire', 1);                             // be / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'A Pile of Runes'), hostId: host });
  whiteBox(h, e => e.destroy(ent(h, host)!, 'dies'));
  crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 2, 'the host’s death made a second Crystal');
  assert.ok(crystals.some(t => t.x === 1), 'X = the 1/1 host’s defense');
});

// ── Mirrorback Ambusher ──────────────────────────────────────────────────

test('Mirrorback Ambusher: [once] dealt combat damage → deals that much to target unit', () => {
  const h = new Harness(1902);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sentry = spawn(h, A, 'Stasis Sentry');                // 2/4 inert attacker
  const amb = spawn(h, D, 'Mirrorback Ambusher');             // 1/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sentry]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [amb] } });
  pass(h); pass(h);   // combat: amb dealt 1 (lethal assignment), dies; trigger at once
  assert.ok(!ent(h, amb), 'the 1/1 died to combat damage');
  pick(h, { unit: sentry });                                  // the trigger targets the attacker
  assert.equal(ent(h, sentry)!.damage, 2, '1 from the block + 1 mirrored = 2');
  finishBattle(h);
});

test('Mirrorback Ambusher: Ambush [2be] recalls an ally and takes its position (R22)', () => {
  const h = new Harness(1903);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Stasis Sentry');                  // the ambush target
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'earth', 1);                            // ambush cost [2be]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Mirrorback Ambusher'), mode: 'ambush' });
  pick(h, { unit: ally });
  pass(h); pass(h);                                           // resolve the ambush
  assert.ok(h.state.players[D]!.hand.includes('Stasis Sentry'), 'the ally is recalled to hand');
  assert.ok(!ent(h, ally), 'the ally left play');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Mirrorback Ambusher').length, 1,
    'the ambusher is in play in its place');
  finishBattle(h);
});

// ── Origon ───────────────────────────────────────────────────────────────

test('Origon: negates each player’s FIRST spell in this battle only (R14)', () => {
  const h = new Harness(1904);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Origon');                                      // own [Augment] text live
  giveResources(h, A, 'earth', 2);
  giveResources(h, A, 'fire', 1);                             // Structural Collapse eer/3
  giveResources(h, A, 'water', 1);                            // Torrential Reclamation br
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // A's FIRST spell this battle → Origon negates it
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Structural Collapse') });
  pick(h, { unit: atk });                                     // cast cost (R35): paid before the push
  pass(h); pass(h);                                           // resolve the negation trigger
  assert.equal(h.state.stack.length, 0, 'R68: the negated spell left the stack with the trigger');
  assert.ok(h.log.some(m => m.includes('Structural Collapse is negated')), 'first spell negated');
  assert.ok(h.state.players[A]!.bin.includes('Structural Collapse'), 'negated spell → bin');
  assert.ok(!ent(h, atk), 'the cast COST was still paid (R35) — negation does not refund it');
  // A's SECOND spell resolves normally (X = 0 chosen at cast → harmless no-op)
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });
  pick(h, 0);                                                 // X = 0 at cast (R35)
  pass(h); pass(h);
  assert.ok(h.state.players[A]!.bin.includes('Torrential Reclamation'), 'second spell resolved → bin');
  assert.equal(h.log.filter(m => m.includes('is negated')).length, 1, 'only the first was negated');
  finishBattle(h);
});

// ── Stasis Sentry ────────────────────────────────────────────────────────

test('Stasis Sentry: spells with base cost \u2264 [three] cost [three] in battle', () => {
  // UN-PARKED (R59). This was a todo reading "a continuous cost-modification
  // layer does not exist"; CostMod is that layer.
  const h = new Harness(1904);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Stasis Sentry');                               // D's region: the battle lands here
  const cheap = 'Fight';                                      // printed 1
  assert.equal(getCard(cheap).mana, 1, 'printed cost');
  const before = new E(h.state);
  assert.equal(before.manaToPlay(D, cheap), 1, 'no tax outside battle');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  assert.equal(e.manaToPlay(D, cheap), 3, 'a [1] spell is raised to [3] during battle');
  assert.equal(e.manaToPlay(A, cheap), 3, 'unqualified subject — the attacker pays it too');
  const pricey = 'Flame Shield';                              // printed 4
  assert.equal(getCard(pricey).mana, 4);
  assert.equal(e.manaToPlay(D, pricey), 4, 'a spell already above [three] is untouched');
  assert.equal(e.manaToPlay(D, 'Torrential Reclamation'), 0,
    '\u26a0 an X spell has no fixed base cost — excluded (see the card note)');
  assert.equal(e.manaToPlay(D, 'Bubb'), getCard('Bubb').mana as number, 'a unit is not a spell');
  finishBattle(h);
});

test('Stasis Sentry: plays as a 2/4; the tax is DONATED by the augment', () => {
  const h = new Harness(1905);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sentry = spawn(h, A, 'Stasis Sentry');
  assert.deepEqual(effStats(h, sentry), [2, 4], 'vanilla 2/4 in play');
  const host = spawn(h, D, 'Unit Token');                     // D's region — where the battle lands
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'earth', 1);
  giveResources(h, D, 'fire', 1);                             // be / 3
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Stasis Sentry'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'it attached as a mod');
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(new E(h.state).manaToPlay(D, 'Fight'), 3,
    'the donated modifier taxes from the host (mod-carried CostMod, host-anchored)');
  finishBattle(h);
});

// ── Unfinished Creation ──────────────────────────────────────────────────

test('Unfinished Creation: recalled after combat', () => {
  const h = new Harness(1906);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const uc = spawn(h, A, 'Unfinished Creation');              // 0/5, own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[uc]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                           // combat (0 power) + afterCombat trigger
  pass(h); pass(h);                                           // resolve the recall
  assert.ok(!ent(h, uc), 'left play after combat');
  assert.ok(h.state.players[A]!.hand.includes('Unfinished Creation'), 'recalled to hand');
  finishBattle(h);
});

// ── Astral Painseeker ────────────────────────────────────────────────────

test('Astral Painseeker: a player losing life during battle → [Switch1] draw a card', () => {
  const h = new Harness(1907);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                      // 1/1 unblocked attacker
  spawn(h, D, 'Astral Painseeker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const handBefore = h.state.players[D]!.hand.length;
  const lifeBefore = h.state.players[D]!.life;
  pass(h); pass(h);                                           // combat: D loses 1 → trigger
  pass(h); pass(h);                                           // resolve the draw
  assert.equal(h.state.players[D]!.life, lifeBefore - 1, 'took 1 combat damage');
  assert.equal(h.state.players[D]!.hand.length, handBefore + 1, 'drew a card');
  finishBattle(h);
});

// ── Death Greeter ────────────────────────────────────────────────────────

test('Death Greeter: your spell in battle → each player sacrifices a unit with cost ≤ its cost', () => {
  const h = new Harness(1908);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tokA = spawn(h, A, 'Unit Token');                     // cost 0 — eligible
  const torm = spawn(h, A, 'Molten Tormentor');               // cost 7 — NOT eligible
  spawn(h, D, 'Death Greeter');                               // cost 3 — NOT eligible for a 0-cost spell
  const tokD = spawn(h, D, 'Unit Token');                     // cost 0 — eligible
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tokA], [torm]] });
  pass(h);                                                    // priority → D
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, e.homeRegion(D)).id; });
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });    // D plays a spell (token, cost 0)
  pick(h, { player: A });                                     // Fireball's target
  pass(h); pass(h);                                           // resolve the Death Greeter trigger
  assert.ok(!ent(h, tokD), 'D sacrificed their only cost-0 unit');
  assert.ok(!ent(h, tokA), 'A sacrificed their only cost-0 unit');
  assert.ok(ent(h, torm), 'cost 7 > 0: Molten Tormentor is not eligible');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Death Greeter'), 'cost 3 > 0: the Greeter stays');
  pass(h); pass(h);                                           // resolve the Fireball
  assert.equal(h.state.players[A]!.life, lifeA - 1, 'Fireball 1 landed');
  finishBattle(h);
});

// ── Channel Through ──────────────────────────────────────────────────────

test('Channel Through: X is chosen at cast (R35) — X=0 is a no-op, X=1 works', () => {
  const h = new Harness(1909);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tokA = spawn(h, A, 'Unit Token');
  const tokD = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'fire', 1);                             // eer / X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tokA]] });
  pass(h);                                                    // priority → D
  // X = 0 chosen at cast → nothing happens. R83: the opponent is a cast-time
  // target in its own right (slot 0), so it is asked for even at X = 0.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  pick(h, 0);                                                 // X = 0 at cast (R35)
  pick(h, { player: A });                                     // R83: target opponent
  pass(h); pass(h);
  assert.ok(ent(h, tokA) && ent(h, tokD), 'X = 0: nobody was damaged');
  // X = 1: 2 damage to the targeted ally, 2 distributed onto the (auto-picked)
  // unit of the targeted opponent — both 1/1s die
  pass(h);                                                    // priority → D again
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  pick(h, 1);                                                 // X = 1 at cast (R35), paid now
  pick(h, { player: A });                                     // R83: slot 0 is the opponent
  pick(h, { unit: tokD });                                    // R64: the ally is a CAST-TIME target
  pass(h); pass(h);
  assert.ok(!ent(h, tokD), 'the targeted ally took 2 and died');
  assert.ok(!ent(h, tokA), 'the distributed 2 killed the opponent’s 1/1');
  finishBattle(h);
});

// ── Molten Tormentor ─────────────────────────────────────────────────────

test('Molten Tormentor: surviving N damage → each opponent sacrifices N units', () => {
  const h = new Harness(1910);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tokA1 = spawn(h, A, 'Unit Token');
  const tokA2 = spawn(h, A, 'Unit Token');
  const torm = spawn(h, D, 'Molten Tormentor');               // 7/6, own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tokA1], [tokA2]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [torm] } });
  pass(h); pass(h);   // combat: torm dealt 1, survives; the trigger resolves at once
  assert.ok(!ent(h, tokA1), 'the blocked attacker died in combat');
  assert.ok(!ent(h, tokA2), 'the surviving attacker was sacrificed (N = 1)');
  assert.equal(ent(h, torm)!.damage, 1, 'the Tormentor survived 1 damage');
  finishBattle(h);
});

// ── Slag Spewer ──────────────────────────────────────────────────────────

test('Slag Spewer: [once] [one] + erase a mod → 2 damage to any target', () => {
  const h = new Harness(1911);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const spewer = spawn(h, p, 'Slag Spewer');
  const victim = spawn(h, p, 'Unit Token');                   // the 2 damage kills it
  giveResources(h, p, 'water', 1);
  giveResources(h, p, 'earth', 1);
  giveResources(h, p, 'fire', 2);                             // Pile augment be/3 + [one]
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'A Pile of Runes'), hostId: spewer });
  const modId = ent(h, spewer)!.mods[0]!;
  h.do({ type: 'activateAbility', seat: p, entityId: spewer, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: victim });
  assert.ok(!ent(h, victim), 'the 2 damage killed the 1/1');
  assert.equal(ent(h, spewer)!.mods.length, 0, 'the mod was consumed');
  assert.ok(!ent(h, modId), 'the mod entity is erased outright');
  assert.ok(!h.state.players[p]!.bin.includes('A Pile of Runes'), 'erased, not binned');
  // [once]: a second activation this turn is illegal (R9)
  giveResources(h, p, 'fire', 1);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: p, entityId: spewer, abilityIndex: 0, via: 'augment' }),
    /already used/);
});

// ── Structural Collapse ──────────────────────────────────────────────────

test('Structural Collapse: sacrifice a unit → opponents sacrifice up to its defense', () => {
  const h = new Harness(1912);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const t1 = spawn(h, A, 'Unit Token');
  const t2 = spawn(h, A, 'Unit Token');
  const t3 = spawn(h, A, 'Unit Token');
  const sentry = spawn(h, D, 'Stasis Sentry');                // 2/4 — the defense bar is 4
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'fire', 1);                             // eer / 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[t1], [t2], [t3]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Structural Collapse') });
  pick(h, { unit: sentry });                                  // cast cost (R35): the 2/4 dies NOW (bar = 4)
  assert.ok(!ent(h, sentry), 'the caster’s unit is sacrificed at cast');
  pass(h); pass(h);                                           // resolve
  pick(h, t1);                                                // A picks sacrifices toward the bar…
  pick(h, t2);                                                // …third pick is forced (auto)
  assert.ok(!ent(h, t1) && !ent(h, t2) && !ent(h, t3),
    'A sacrificed all three 1/1s (total defense 3 < 4 — ran out)');
  finishBattle(h);
});

// ── Unstable Form ────────────────────────────────────────────────────────

test('Unstable Form: after combat, sacrifice another unit', () => {
  const h = new Harness(1913);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const uf = spawn(h, D, 'Unstable Form');                    // own [Augment] text live
  const tokD = spawn(h, D, 'Unit Token');                     // the sacrifice (auto-picked)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                           // combat + afterCombat trigger
  pass(h); pass(h);                                           // resolve the sacrifice
  assert.ok(!ent(h, tokD), 'the other unit was sacrificed');
  assert.ok(ent(h, uf), 'Unstable Form itself stays ("another")');
  assert.ok(ent(h, atk), 'the opponent’s unit is untouched');
  finishBattle(h);
});

// ── Demon of the Depths ──────────────────────────────────────────────────

test('Demon of the Depths: an allied despawn → 1 damage to any target (chains on deaths)', () => {
  const h = new Harness(1914);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const demon = spawn(h, p, 'Demon of the Depths');           // own [Augment] text live
  const tok1 = spawn(h, p, 'Unit Token');
  const tok2 = spawn(h, p, 'Unit Token');
  const lifeBefore = h.state.players[p]!.life;
  whiteBox(h, e => e.recall(ent(h, tok1)!));                  // an allied despawn (recall)
  pick(h, { unit: tok2 });                                    // the ping kills the 1/1 …
  pick(h, { player: p });                                     // … which despawns → a second ping
  assert.ok(!ent(h, tok2), 'the 1 damage killed the 1/1');
  assert.equal(h.state.players[p]!.life, lifeBefore - 1, 'the chained ping hit the player');
  assert.ok(ent(h, demon), 'the Demon is untouched');
  assert.ok(h.state.players[p]!.hand.includes('Unit Token'), 'the recalled ally reached the hand');
});

// ── Tempest Oracle ───────────────────────────────────────────────────────

test('Tempest Oracle: on despawn, may pay [one] to draw a card and lose 1 life (R6)', () => {
  const h = new Harness(1915);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const oracle = spawn(h, p, 'Tempest Oracle');
  giveResources(h, p, 'fire', 1);                             // the [one]
  const handBefore = h.state.players[p]!.hand.length;
  const lifeBefore = h.state.players[p]!.life;
  whiteBox(h, e => e.destroy(ent(h, oracle)!, 'dies'));
  pick(h, true);                                              // pay [one]
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'drew a card');
  assert.equal(h.state.players[p]!.life, lifeBefore - 1, 'lost 1 life');
  assert.equal(new E(h.state).openMana(p), 0, 'the [one] was paid');
  assert.ok(h.state.players[p]!.bin.includes('Tempest Oracle'), 'the Oracle is in the bin');
});

// ── Torrential Reclamation ───────────────────────────────────────────────

test('Torrential Reclamation: recall X nontoken allies → per recall, sacrifices + 1 life', () => {
  const h = new Harness(1916);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  const sentry = spawn(h, D, 'Stasis Sentry');                // the recalled ally
  const tokD = spawn(h, D, 'Unit Token');                     // D's forced sacrifice
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'fire', 1);                             // br / X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);                                                    // priority → D
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Torrential Reclamation') });
  pick(h, 1);                                                 // X = 1 at cast (R35), paid now
  // R64: "X target nontoken allies" are declared at cast — D's own token is
  // not offered, and neither is anything of A's.
  notOffered(h, { unit: a1 }, "A's unit is not D's ally");
  pick(h, { unit: sentry });                                  // D recalls the Sentry
  pass(h); pass(h);                                           // resolve
  pick(h, a1);                                                // A's sacrifice pick (D's is forced)
  assert.ok(h.state.players[D]!.hand.includes('Stasis Sentry'), 'the ally is recalled to hand');
  assert.ok(!ent(h, tokD), 'D sacrificed a unit for the recall');
  assert.ok(!ent(h, a1), 'A sacrificed a unit for the recall');
  assert.ok(ent(h, a2), 'only one round of sacrifices (X = 1)');
  assert.equal(h.state.players[D]!.life, lifeD - 1, 'the caster lost 1 life per recall');
  finishBattle(h);
});
