/* Per-card tests for the second wood/metal-involved hybrid batch
 * (batch-hybrids-wm-b): after-combat counter sweeps (Infernal Grovekeeper,
 * Ominous Growth), a mod-carried "everything is deadly" static (Rotspore
 * Herald), sacrifice-for-tokens (Volatile Toxicity), a recall-cost activated
 * ability (Auric Ascendant), stack negation + Glimpse (Dematerialize),
 * battle-ending stack wipes (Temporal Rift), spawn-doubling (Transmutide
 * Enigma), gain-control machinery (Abduct, Mindwarp Sporefrog — white-box x
 * for Abduct, the cast-time X primitive is PARKED), modal X spells (Floral
 * Singularity — direct-run with a scripted ctx), token-birth taxes (The
 * World Shepherd), modal counter sweeps (Wither and Bloom), counter movement
 * (Aethercap Siphoner), formation-counting creation/recall (Galactic
 * Germination, Lumengrove Lurker). The PARKED Invasive Species
 * start-of-deployment trigger has a todo test.
 * States are built explicitly (give/spawn/giveResources) so parallel card
 * registration can't shift assertions. Seeds: 3000-3099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard, type EffectCtx } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
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
  h.state = e.s;
}

const homeOf = (h: Harness, seat: Seat): number =>
  h.state.regions.findIndex(r => r.owner === seat);

// ── Infernal Grovekeeper ─────────────────────────────────────────────────

test('Infernal Grovekeeper: after combat, -1/-1 on each unit, then 2 damage to each player', () => {
  const h = new Harness(3001);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                      // 1/1 attacker
  const grove = spawn(h, D, 'Infernal Grovekeeper');          // 3/5, own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const lifeA = h.state.players[A]!.life;
  const lifeD = h.state.players[D]!.life;
  pass(h); pass(h);                                           // combat (D takes 1) + afterCombat trigger
  pass(h); pass(h);                                           // resolve the trigger
  assert.ok(!ent(h, atk), 'the 1/1 died to its -1/-1 counter');
  assert.equal(ent(h, grove)!.counters, -1, 'the carrier taxed itself too');
  assert.deepEqual(effStats(h, grove), [2, 4], '3/5 with a -1/-1 counter');
  assert.equal(h.state.players[A]!.life, lifeA - 2, 'A took 2 from the Grovekeeper');
  assert.equal(h.state.players[D]!.life, lifeD - 1 - 2, 'D took 1 combat + 2 from the Grovekeeper');
  finishBattle(h);
});

// ── Rotspore Herald ──────────────────────────────────────────────────────

test('Rotspore Herald: everything in the region is deadly (both sides, combat)', () => {
  const h = new Harness(3002);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sentry = spawn(h, A, 'Stasis Sentry');                // 2/4 attacker
  spawn(h, D, 'Rotspore Herald');                             // the static radiates in D's region
  const blocker = spawn(h, D, 'Unit Token');                  // 1/1 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sentry]] });
  // the ENEMY attacker entered the Herald's region — it is deadly too
  assert.ok(ownAttrs(h, sentry).has('Deadly'), 'everything includes enemy units');
  assert.ok(ownAttrs(h, blocker).has('Deadly'), 'everything includes your units');
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  const lifeD = h.state.players[D]!.life;
  pass(h); pass(h);                                           // combat: 1 deadly point each way
  assert.ok(!ent(h, sentry), 'the 2/4 died to ONE deadly point from the 1/1');
  assert.ok(!ent(h, blocker), 'the 1/1 died to the (deadly) attacker');
  assert.equal(h.state.players[D]!.life, lifeD, 'blocked column: no damage through');
  finishBattle(h);
});

// ── Volatile Toxicity ────────────────────────────────────────────────────

test('Volatile Toxicity: sacrifice a unit → Poison X and Fireball X, X = its defense', () => {
  const h = new Harness(3003);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const sentry = spawn(h, D, 'Stasis Sentry');                // 2/4 — X will be 4
  giveResources(h, D, 'fire', 1);
  giveResources(h, D, 'wood', 1);                             // rg / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Volatile Toxicity') });
  pick(h, { unit: sentry });                                  // cast cost (R35): the 2/4 dies NOW, X = 4
  assert.ok(!ent(h, sentry), 'the unit is sacrificed at cast');
  assert.ok(h.state.players[D]!.bin.includes('Stasis Sentry'), 'sacrificed nontoken → bin');
  pass(h); pass(h);                                           // resolve
  const toks = tokensOf(h, D);
  assert.ok(toks.some(t => t.card === 'Poison' && t.x === 4), 'a Poison 4 is created');
  assert.ok(toks.some(t => t.card === 'Fireball' && t.x === 4), 'a Fireball 4 is created');
  finishBattle(h);
});

// ── Auric Ascendant ──────────────────────────────────────────────────────

test('Auric Ascendant: [once] [one] + recall another ally → Flying and +2/+0 until regroup', () => {
  const h = new Harness(3004);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const auric = spawn(h, p, 'Auric Ascendant');               // 2/1
  const ally = spawn(h, p, 'Unit Token');                     // the recall cost (auto-picked)
  giveResources(h, p, 'metal', 2);                            // [one] ×2 (second activation attempt)
  h.do({ type: 'activateAbility', seat: p, entityId: auric, abilityIndex: 0 });
  assert.ok(!ent(h, ally), 'the ally left play (recalled)');
  assert.ok(ownAttrs(h, auric).has('Flying'), 'gained {Flying}');
  assert.deepEqual(effStats(h, auric), [4, 1], '+2/+0 until regroup');
  // [once]: a second activation this turn is illegal (R9)
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: p, entityId: auric, abilityIndex: 0 }),
    /already used/);
});

// ── Dematerialize ────────────────────────────────────────────────────────

test('Dematerialize: negates a target stack effect; its controller Glimpses 3', () => {
  const h = new Harness(3005);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'metal', 1);                            // bm / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });    // A casts Fireball 1 …
  pick(h, { player: D });                                     // … at D
  const fbStackId = h.state.stack[h.state.stack.length - 1]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: fbStackId });                              // negate target effect
  const lifeD = h.state.players[D]!.life;
  const handA = h.state.players[A]!.hand.length;
  const deckLen = h.state.sharedDeck.length;
  pass(h); pass(h);                                           // resolve Dematerialize
  pick(h, 0);                                                 // A caches the first revealed card
  assert.ok(h.log.some(m => m.includes('is negated')), 'the Fireball is negated');
  assert.equal(h.state.players[A]!.hand.length, handA + 1, 'the glimpsing player cached a card');
  assert.equal(h.state.sharedDeck.length, deckLen - 1, 'two of the three glimpsed cards recycled');
  pass(h); pass(h);                                           // the negated Fireball resolves
  assert.equal(h.state.players[D]!.life, lifeD, 'the negated Fireball dealt nothing');
  finishBattle(h);
});

// ── Temporal Rift ────────────────────────────────────────────────────────

test('Temporal Rift: negates all stack effects and ends the battle', () => {
  const h = new Harness(3006);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'metal', 2);                            // bmm / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });    // A casts Fireball 1 …
  pick(h, { player: D });                                     // … at D
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Temporal Rift') });
  pass(h); pass(h);                                           // resolve the Rift (top of stack)
  assert.equal(h.state.players[D]!.life, lifeD, 'the Fireball never resolved — no damage');
  assert.equal(h.state.stack.length, 0, 'the stack is wiped');
  assert.equal(h.state.battle, null, 'the battle is over');
  // round 1 ended with no sent counterattackers → the cascade reaches deployment
  assert.equal(h.state.phase, 'deploy', 'round 2 was skipped straight into regroup/deploy');
  assert.ok(ent(h, atk), 'the attacker survived (combat never happened)');
  // ⚠ approximation: "Erase this spell" — the Rift is binned like a resolved spell
  assert.ok(h.state.players[D]!.bin.includes('Temporal Rift'), 'the Rift is binned (erase approximated)');
});

// ── Transmutide Enigma ───────────────────────────────────────────────────

test('Transmutide Enigma: another ally spawning in battle gets power or defense doubled', () => {
  const h = new Harness(3007);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Transmutide Enigma');                          // own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let tok = 0;
  whiteBox(h, e => { tok = e.spawnUnit(D, 'Unit Token', e.s.battle!.region, { token: true, tokenStats: [2, 3] }).id; });
  pass(h); pass(h);                                           // resolve the trigger
  pick(h, 'defense');                                         // double its defense
  assert.deepEqual(effStats(h, tok), [2, 6], 'defense doubled (+0/+3) until regroup');
  finishBattle(h);                                            // → regroup → deploy
  assert.deepEqual(effStats(h, tok), [2, 3], 'the doubling is temporary — regroup clears it');
});

// ── Abduct ───────────────────────────────────────────────────────────────

test('Abduct: controller may pay [x] to keep the unit; otherwise control flips (X at cast)', () => {
  const h = new Harness(3008);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sentry = spawn(h, A, 'Stasis Sentry');                // cost 3 — the real target
  const atk = spawn(h, A, 'Unit Token');                      // cost 0 — the x=0 target
  giveResources(h, D, 'wood', 1);
  giveResources(h, D, 'metal', 3);                            // gm affinity + mana for X = 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sentry], [atk]] });
  pass(h);                                                    // priority → D
  // X = 0 chosen at cast (R35) — A ransoms the token for [0]
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Abduct') });
  pick(h, 0);                                                 // X = 0
  pick(h, { unit: atk });
  pass(h); pass(h);                                           // resolve
  pick(h, true);                                              // A pays [0] to keep it
  assert.equal(ent(h, atk)!.controller, A, 'ransom paid — the token stays');
  // X = 3: A has no open mana → cannot pay → the Sentry is abducted
  pass(h);                                                    // priority → D again
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Abduct') });
  pick(h, 3);                                                 // X = 3 at cast — the Sentry (cost 3) qualifies
  pick(h, { unit: sentry });
  pass(h); pass(h);                                           // resolve — no ransom possible
  assert.equal(ent(h, sentry)!.controller, D, 'D gains control of the Sentry');
  assert.ok(!h.state.battle!.columns.flat().includes(sentry), 'the flipped unit left the formation');
  finishBattle(h);                                            // → regroup → deploy
  assert.equal(ent(h, sentry)!.region, homeOf(h, D), 'regroup walks it to its new home');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Stasis Sentry'), 'it is a D unit now');
});

// ── Floral Singularity ───────────────────────────────────────────────────

test('Floral Singularity: create X 1/1s at home, or your units become base X/X (white-box x)', () => {
  const h = new Harness(3009);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const auric = spawn(h, p, 'Auric Ascendant');               // 2/1
  // the cast-time X primitive is PARKED — drive the effect with a scripted ctx
  const runFloral = (x: number, mode: string): void => {
    whiteBox(h, e => {
      const ctx: EffectCtx = {
        controller: p, sourceName: 'Floral Singularity', region: e.homeRegion(p),
        targets: [], x, event: null, choose: () => mode,
      };
      getCard('Floral Singularity').spellEffect!.run(e, ctx);
    });
  };
  runFloral(2, 'create');
  const toks = unitsOf(h, p).filter(u => u.token);
  assert.equal(toks.length, 2, 'two 1/1 unit tokens created');
  assert.ok(toks.every(u => u.region === homeOf(h, p)), 'created units arrive HOME (R28)');
  assert.deepEqual(effStats(h, toks[0]!.id), [1, 1], 'they are 1/1s');
  runFloral(3, 'base');
  assert.deepEqual(effStats(h, auric), [3, 3], 'the 2/1 became base 3/3 until regroup');
  assert.deepEqual(effStats(h, toks[0]!.id), [3, 3], 'the 1/1 tokens became base 3/3 too');
});

// ── Ominous Growth ───────────────────────────────────────────────────────

test('Ominous Growth: after combat, all tokens in the region are deleted', () => {
  const h = new Harness(3010);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const growth = spawn(h, D, 'Ominous Growth');               // own [Augment] text live
  let atk = 0, tokD = 0, fb = 0;                              // real TOKENS (flagged)
  whiteBox(h, e => {
    atk = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [1, 1] }).id;
    tokD = e.spawnUnit(D, 'Unit Token', e.homeRegion(D), { token: true, tokenStats: [1, 1] }).id;
    fb = e.createSpellToken(D, 'Fireball', 1, e.homeRegion(D)).id;
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                           // combat + afterCombat trigger
  pass(h); pass(h);                                           // resolve the deletion
  assert.ok(!ent(h, atk), "A's attacking unit token is deleted");
  assert.ok(!ent(h, tokD), "D's own unit token is deleted too");
  assert.ok(!ent(h, fb), 'the spell token is deleted');
  assert.ok(ent(h, growth), 'nontoken units stay');
  finishBattle(h);
});

// ── The World Shepherd ───────────────────────────────────────────────────

test('The World Shepherd: a unit token is created → -1/-1 on me, +1/+1 on the token', () => {
  const h = new Harness(3011);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const shep = spawn(h, p, 'The World Shepherd');             // 2/3, own [Augment] text live
  let tok = 0;
  whiteBox(h, e => { tok = e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true, tokenStats: [1, 1] }).id; });
  assert.equal(ent(h, shep)!.counters, -1, 'the Shepherd taxed itself');
  assert.equal(ent(h, tok)!.counters, 1, 'the newborn token got the +1/+1');
  assert.deepEqual(effStats(h, tok), [2, 2], 'a 2/2 token');
  // a NONTOKEN spawn does not trigger it
  spawn(h, p, 'Stasis Sentry');
  assert.equal(ent(h, shep)!.counters, -1, 'nontoken spawns are ignored');
});

// ── Wither and Bloom ─────────────────────────────────────────────────────

test('Wither and Bloom: modal — -1/-1 on each enemy, or +1/+1 on each of your units', () => {
  const h = new Harness(3012);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  const sentry = spawn(h, D, 'Stasis Sentry');
  giveResources(h, D, 'wood', 4);
  giveResources(h, D, 'metal', 2);                            // gm / 3, twice
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wither and Bloom') });
  pass(h); pass(h);                                           // resolve
  pick(h, 'wither');                                          // -1/-1 on each enemy
  assert.ok(!ent(h, a1) && !ent(h, a2), 'both enemy 1/1s withered away');
  assert.equal(ent(h, sentry)!.counters, 0, 'your own units are untouched by wither');
  pass(h);                                                    // priority → D again
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wither and Bloom') });
  pass(h); pass(h);                                           // resolve
  pick(h, 'bloom');                                           // +1/+1 on each of your units
  assert.equal(ent(h, sentry)!.counters, 1, 'the Sentry bloomed');
  assert.deepEqual(effStats(h, sentry), [3, 5], '2/4 with a +1/+1 counter');
  finishBattle(h);
});

// ── Aethercap Siphoner ───────────────────────────────────────────────────

test('Aethercap Siphoner: spawns with three -1/-1; a nontoken spell moves one onto another unit', () => {
  const h = new Harness(3013);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const siph = spawn(h, p, 'Aethercap Siphoner');             // 4/4 body
  assert.equal(ent(h, siph)!.counters, -3, 'spawned with three -1/-1 counters');
  assert.deepEqual(effStats(h, siph), [1, 1], 'a 1/1 for now');
  const tok = spawn(h, p, 'Unit Token');                      // the counter's destination
  giveResources(h, p, 'wood', 2);
  giveResources(h, p, 'metal', 1);                            // Floral Singularity ggm / X
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Floral Singularity') });
  pick(h, 0);                                                 // X = 0 at cast (R35) — a harmless no-op
  pick(h, tok);                                               // may move a counter → onto the token
  assert.equal(ent(h, siph)!.counters, -2, 'one -1/-1 moved off the Siphoner');
  assert.ok(!ent(h, tok), 'the 1/1 token died to the moved -1/-1');
});

// ── Galactic Germination ─────────────────────────────────────────────────

test('Galactic Germination: a 1/1 per unit in target formation — arriving HOME (R28)', () => {
  const h = new Harness(3014);
  toDeployment(h);
  const D = h.state.initiative, A = 1 - D;                    // D will attack (initiative)
  const u1 = spawn(h, D, 'Unit Token');
  const u2 = spawn(h, D, 'Unit Token');
  spawn(h, A, 'Stasis Sentry');                               // a defender (not in a formation)
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'wood', 2);                             // bg / 3
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[u1], [u2]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Galactic Germination') });
  pick(h, { unit: u1 });                                      // a unit in the target formation
  pass(h); pass(h);                                           // resolve
  const home = unitsOf(h, D).filter(u => u.token && u.region === homeOf(h, D));
  assert.equal(home.length, 2, 'two 1/1s — one per unit in the attacking formation');
  assert.notEqual(homeOf(h, D), h.state.battle!.region, 'home is NOT the battle region here');
  assert.deepEqual(effStats(h, home[0]!.id), [1, 1], 'they are 1/1s');
  finishBattle(h);
});

// ── Invasive Species ─────────────────────────────────────────────────────

test('Invasive Species: at the start of deployment, recall all your other units', { todo: true }, () => {
  // PARKED: no start-of-deployment event exists — startDeployment fires no
  // fireEvent, and 'endOfTurn' is after deployment (the recalled units would
  // wrongly miss the next battle). See the batch header.
});

test('Invasive Species: plays as a 4/4; augments (donating nothing yet)', () => {
  const h = new Harness(3015);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const inv = spawn(h, p, 'Invasive Species');
  assert.deepEqual(effStats(h, inv), [4, 4], 'vanilla 4/4 in play');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'water', 1);
  giveResources(h, p, 'wood', 1);                             // bg / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Invasive Species'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment (inert donation)');
});

// ── Lumengrove Lurker ────────────────────────────────────────────────────

test('Lumengrove Lurker: after combat, recall a unit with cost ≤ my formation size', () => {
  const h = new Harness(3016);
  toDeployment(h);
  const D = h.state.initiative, A = 1 - D;                    // D attacks with the Lurker
  const lurk = spawn(h, D, 'Lumengrove Lurker');              // 3/2
  const tokD = spawn(h, D, 'Unit Token');                     // formation size 2
  const amb = spawn(h, A, 'Mirrorback Ambusher');             // cost 2 ≤ 2 — recallable
  spawn(h, A, 'Stasis Sentry');                               // cost 3 — over the bar
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[lurk], [tokD]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  pass(h); pass(h);                                           // combat + afterCombat trigger
  pick(h, { unit: amb });                                     // up to one target ("done" offered)
  pass(h); pass(h);                                           // resolve the recall
  assert.ok(!ent(h, amb), 'the 2-cost unit left play');
  assert.ok(h.state.players[A]!.hand.includes('Mirrorback Ambusher'), 'recalled to its owner’s hand');
  finishBattle(h);
});

// ── Mindwarp Sporefrog ───────────────────────────────────────────────────

test('Mindwarp Sporefrog: its controller dealt combat damage → the opponent gains control', () => {
  const h = new Harness(3017);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                      // 1/1 unblocked attacker
  const frog = spawn(h, D, 'Mindwarp Sporefrog');             // 5/6, own [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);   // combat: D takes 1 → the flip resolves at once (R31)
  assert.equal(ent(h, frog)!.controller, A, 'the opponent gains control of the Sporefrog');
  finishBattle(h);                                            // → regroup → deploy
  assert.equal(ent(h, frog)!.region, homeOf(h, A), 'regroup walks it to its new home');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Mindwarp Sporefrog'), 'an A unit now');
});
