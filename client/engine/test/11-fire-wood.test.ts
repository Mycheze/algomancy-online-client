/* Per-card tests for the fire/wood/earth batch (project rule: a test for every
 * card). Covers type-line augments (Bumblecrab/Carapace Devourer), a {Battle}
 * buff spell (Channeled Boon), a resolution-time amount from battle deaths
 * (Burning Vengeance, R1/R14), region-scoped buffs and spawn/death triggers
 * (Guardian of the Grotto R12, Engorged Caudex, Forager of the Fallen), and
 * text-box [Augment] triggers (Bloomcaster, Flourishing Flora, Flamebreath
 * Initiate, Embermaw Fledgling). States are built explicitly (give/spawn/
 * giveResources) so concurrent card registration can't shift assertions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

// ─────────────────────────── EARTH augments ─────────────────────────────

test('Bumblecrab: {Piercing} 2/3 — as a unit and donated by type-line [Augment]', () => {
  const h = new Harness(601);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bc = spawn(h, p, 'Bumblecrab');
  assert.ok(ownAttrs(h, bc).has('Piercing'), 'played normally: has Piercing');
  assert.deepEqual(effStats(h, bc), [2, 3], '2/3');
  const host = spawn(h, p, 'Unit Token');            // vanilla 1/1
  giveResources(h, p, 'earth', 2);                   // ee / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Bumblecrab'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Piercing'), 'type-line [Augment] donates Piercing');
});

test('Carapace Devourer: {Deadly} 3/3 — as a unit and donated by type-line [Augment]', () => {
  const h = new Harness(602);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cd = spawn(h, p, 'Carapace Devourer');
  assert.ok(ownAttrs(h, cd).has('Deadly'), 'played normally: has Deadly');
  assert.deepEqual(effStats(h, cd), [3, 3], '3/3');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'earth', 2);                   // e / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Carapace Devourer'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Deadly'), 'type-line [Augment] donates Deadly');
});

// ─────────────────────────────── FIRE ───────────────────────────────────

test('Channeled Boon: {Battle} spell gives target unit +4/+4 until regroup', () => {
  const h = new Harness(603);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atkr = spawn(h, A, 'Lonely Forager');        // 3/1, opens a battle
  const sprite = spawn(h, D, 'Ignis Sprite');        // 1/1 target in the region
  giveResources(h, D, 'fire', 2);                    // r / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atkr]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: sprite });
  pass(h); pass(h);                                  // resolve
  assert.deepEqual(effStats(h, sprite), [5, 5], '1/1 + 4/4 = 5/5');
  finishBattle(h);
});

test('Burning Vengeance: damage = units that died this battle (R1 amount, both seats)', () => {
  const h = new Harness(604);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sa = spawn(h, A, 'Unit Token');              // trigger-free 1/1
  const sd = spawn(h, D, 'Unit Token');              // trigger-free 1/1
  giveResources(h, D, 'fire', 1);                    // r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sa]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [sd] } });
  pass(h); pass(h);                                  // combat: both 1/1s trade (2 deaths)
  assert.ok(!ent(h, sa) && !ent(h, sd), 'both units died in combat');
  const lifeA = h.state.players[A]!.life;
  pass(h);                                           // afterWindow: A → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burning Vengeance') });
  pick(h, { player: A });
  pass(h); pass(h);                                  // resolve
  assert.equal(h.state.players[A]!.life, lifeA - 2, '2 units died → 2 damage');
  finishBattle(h);
});

test('Flamebreath Initiate: attack → Fireball X+1, X = adjacent allies (R1, at resolution)', () => {
  // X = 1: an adjacent ally column
  const h = new Harness(605);
  toDeployment(h);
  const A = h.state.initiative;
  const fb = spawn(h, A, 'Flamebreath Initiate');    // augment text live when played normally
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[fb], [ally]] });
  pass(h); pass(h);                                  // resolve the attack trigger
  let fires = tokensOf(h, A).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'one Fireball created');
  assert.equal(fires[0]!.x, 2, 'X=1 adjacent ally → Fireball X+1 = 2');
  finishBattle(h);

  // X = 0: attacking alone
  const h2 = new Harness(615);
  toDeployment(h2);
  const A2 = h2.state.initiative;
  const fb2 = spawn(h2, A2, 'Flamebreath Initiate');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[fb2]] });
  pass(h2); pass(h2);
  fires = tokensOf(h2, A2).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1);
  assert.equal(fires[0]!.x, 1, 'alone → X=0 → Fireball 1');
  finishBattle(h2);
});

test('Embermaw Fledgling: after combat → X/X, X = attacking units in my formation', () => {
  // attacker: three attackers survive → a 3/3
  const h = new Harness(606);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const emb = spawn(h, A, 'Embermaw Fledgling');     // augment text live when played normally
  const u1 = spawn(h, A, 'Unit Token');
  const u2 = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[emb], [u1], [u2]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat (unblocked), afterWindow
  pass(h); pass(h);                                  // resolve the afterCombat trigger
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 3);
  assert.equal(made.length, 1, '3 attacking units → one 3/3 token');
  assert.deepEqual(effStats(h, made[0]!.id), [3, 3]);
  finishBattle(h);

  // defender: no attacking units in my formation → X=0 → nothing
  const h2 = new Harness(616);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const atkr = spawn(h2, A2, 'Unit Token');
  const emb2 = spawn(h2, D2, 'Embermaw Fledgling');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[atkr]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [emb2] } });
  finishBattle(h2);
  assert.ok(!unitsOf(h2, D2).some(u => u.card === 'Unit Token'),
    'blocking Embermaw has X=0 attacking units in its formation → makes nothing');
});

// ─────────────────────────────── WOOD ────────────────────────────────────

test('Guardian of the Grotto: attack → your units in this region gain +0/+1 (R12)', () => {
  const h = new Harness(607);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const guardian = spawn(h, A, 'Guardian of the Grotto');  // 1/1
  const forager = spawn(h, A, 'Lonely Forager');           // 3/1 ally attacker
  const whale = spawn(h, D, 'Good Whale');                 // 7/5 enemy in the region
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[guardian], [forager]] });
  pass(h); pass(h);                                        // resolve the attack trigger
  assert.deepEqual(effStats(h, guardian), [1, 2], 'the Guardian buffs itself');
  assert.deepEqual(effStats(h, forager), [3, 2], 'ally attacker in-region buffed');
  assert.deepEqual(effStats(h, whale), [7, 5], 'enemy NOT buffed ("your units")');
  finishBattle(h);
});

test('Engorged Caudex: nontoken ally spawn draws (once/turn); tokens do not', () => {
  const h = new Harness(608);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const caudex = spawn(h, p, 'Engorged Caudex');          // its own spawn does not draw
  const handBefore = h.state.players[p]!.hand.length;
  // a TOKEN ally spawns: "nontoken" gate fails → no draw, budget untouched
  const e = new E(h.state);
  e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true, tokenStats: [1, 1] });
  e.settle();
  assert.equal(h.state.players[p]!.hand.length, handBefore, 'token ally: no draw');
  // a NONTOKEN ally spawns → draw
  spawn(h, p, 'Good Whale');
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'nontoken ally → draw');
  // second nontoken ally same turn → [Switch1] budget spent (R9)
  spawn(h, p, 'Good Whale');
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'bounded: only once per turn');
  assert.ok(ent(h, caudex), 'sanity: Caudex still in play');
});

test('Forager of the Fallen: an enemy dying in-region creates a 2/2', () => {
  const h = new Harness(609);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const forager = spawn(h, A, 'Forager of the Fallen');   // 2/2
  const sprite = spawn(h, D, 'Ignis Sprite');             // 1/1 enemy
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[forager]] });
  pass(h); pass(h);                                       // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [sprite] } });
  finishBattle(h);                                        // combat: sprite dies → Forager trigger
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 2);
  assert.equal(made.length, 1, 'enemy death → a 2/2');
  assert.deepEqual(effStats(h, made[0]!.id), [2, 2]);
  assert.ok(ent(h, forager), 'Forager survived the 1/1 blocker');
});

test('Bloomcaster: PLAYING a unit makes a 1/1 — and putting one into play does not', () => {
  // ⚠ THIS TEST USED TO ASSERT THE BUG. It called the `spawn` helper, which
  // puts a unit straight into play, and expected a 1/1 — because the card
  // listened on 'spawned'. But the card prints "whenever you PLAY a unit", and
  // Exhume, Resurrect, Wake the Dead, Rousing Spirit and Lurking Dread all
  // print "put into play", not "play". Every one of them wrongly paid out.
  // R129's 'cardPlayed' is the real event; the negative half below is the
  // whole point and the old test had no way to express it.
  const h = new Harness(610);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const count = (): number => unitsOf(h, p).filter(u => u.card === 'Unit Token').length;

  spawn(h, p, 'Bloomcaster');                       // put into play: not a play
  assert.equal(count(), 0,
    'putting Bloomcaster into play is not PLAYING a unit — the old test asserted 1 here');

  giveResources(h, p, 'water', 6);   // Good Whale is b/6
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Good Whale') });
  assert.equal(count(), 1, 'a real play of a nontoken unit makes one 1/1');

  // the loop guard is structural now: a created TOKEN never fires 'cardPlayed'
  // at all, so there is nothing to guard against by hand
  assert.ok(unitsOf(h, p).filter(u => u.card === 'Unit Token')
    .every(u => effStats(h, u.id)[0] === 1 && effStats(h, u.id)[1] === 1), 'each is 1/1');

  // and a SECOND put-into-play still pays nothing
  spawn(h, p, 'Good Whale');
  assert.equal(count(), 1, 'a second put-into-play adds no 1/1');
});

test('Flourishing Flora: [Augment] — another ally spawning (token or not) grows me +1/+1', () => {
  const h = new Harness(611);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const flora = spawn(h, p, 'Flourishing Flora');         // 0/1; own spawn does not count
  assert.deepEqual(effStats(h, flora), [0, 1], 'starts 0/1');
  spawn(h, p, 'Good Whale');                              // another nontoken ally
  assert.deepEqual(effStats(h, flora), [1, 2], '+1/+1 counter');
  const e = new E(h.state);                               // a token ally counts too ("another ally")
  e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true, tokenStats: [1, 1] });
  e.settle();
  assert.deepEqual(effStats(h, flora), [2, 3], 'tokens count as allies');
  assert.equal(ent(h, flora)!.counters, 2);
});
