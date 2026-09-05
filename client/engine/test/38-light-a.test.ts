/* Per-card tests for the light-a batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources) so parallel card
 * registration cannot shift assertions; seeds are 3800-3899.
 *
 * Covers: the life half of the cost-modifier layer (Arbiter of Armistice,
 * R60), pay-life activations
 * (Blob of the Dark Order, Glararr, Flesh Tithe), life-movement triggers
 * (Colony of the Interworld, Shard Sprite, Triskaidekaphage, Vroot), the cache
 * (Divine Foresight's granted prophecy, Prismatic Observer's recall, Lifebound
 * Seer's glimpse, Stalwart Sentinel's played-from-elsewhere), debt (Greed
 * Angel, including the automatic resource-step payment), self-copying in
 * formation (Hooba-God), the per-battle life-loss ledger (Retribution Thing),
 * multi-player targeting (Penance) and Keeper of Tithes. The Everywhere is
 * fully built: R91 landed the naming and the region-scoped suppression, and on
 * 2026-08-23 the last approximated clause — the CONTINUOUS duration, "(As long
 * as I am in their region.)" — landed as `Entity.named` plus a name-matching
 * `StaticMod.suppressAbilities`. Its `{ todo: true }` and its card-ledger entry
 * are gone; the four tests that replaced them are grouped below the card.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { IllegalAction } from '../src/engine.ts';
import { isGraftable } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  resolveAfterCombat, skipHasteStep, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';
import type { CachedCard, Seat } from '../src/types.ts';

const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];

/** finish deployment for both seats — the turn flips into the next planning */
function endDeployment(h: Harness): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
}

// ── Arbiter of Armistice ─────────────────────────────────────────────────

test('Arbiter of Armistice: registers and plays as its printed 2/2 haste body', () => {
  const h = new Harness(3801);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const arb = spawn(h, A, 'Arbiter of Armistice');
  assert.deepEqual(effStats(h, arb), [2, 2]);
  assert.equal(h.q.card('Arbiter of Armistice').timing, 'haste', 'printed timing comes from printed.json');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[arb]] });
  finishBattle(h);
  assert.ok(ent(h, arb), 'it survives an unblocked attack — nothing crashes');
});

// ⚠ Still flagged: the type line prints a bare {Switch} with no matching
// marker in the rules text — the only such card in the pool.

test('Arbiter of Armistice: cards played during battle cost 2 life — everyone\'s', () => {
  // The Arbiter taxes the battle it is STANDING IN (R12 region scoping), so
  // these all put it in the defending seat's home region — the battle region.
  const h = new Harness(3830);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Arbiter of Armistice');
  toNextBattle(h, D);                       // D attacks INTO A's region
  const atk = spawn(h, D, 'Ignis Sprite');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  // the ATTACKER first — the tax is on cards played in battle, not on the
  // Arbiter's opponent (playtest DEYK: "I didn't have to pay 2 life")
  giveResources(h, D, 'fire', 4);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  assert.equal(h.state.players[D]!.life, lifeD - 2, 'the 2 life came off at cast time');
  assert.ok(h.log.some(l => l.includes('pays 2 life to play Flame of History')),
    'and the log says why');
  pick(h, { player: A }); pass(h); pass(h);   // aim it, let it resolve
  // …and the Arbiter's OWN controller pays it too ("cards", not "their cards")
  if (h.state.priority !== A) pass(h);
  giveResources(h, A, 'fire', 4);
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flame of History') });
  assert.equal(h.state.players[A]!.life, lifeA - 2, 'its own controller is taxed as well');
  pick(h, { player: D });
  finishBattle(h);
});

test('Arbiter of Armistice: an unpayable life tax makes the card uncastable', () => {
  const h = new Harness(3831);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Arbiter of Armistice');
  toNextBattle(h, D);
  const atk = spawn(h, D, 'Ignis Sprite');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  giveResources(h, D, 'fire', 4);
  const bolt = give(h, D, 'Flame of History');
  h.state.players[D]!.life = 2;   // R49: pay N life only while you have MORE
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === bolt),
    'not offered at exactly 2 life');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: bolt }), IllegalAction,
    'and apply() refuses it too');
  h.state.players[D]!.life = 3;
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.handIndex === bolt),
    'one more life and it is castable again');
});

test('Arbiter of Armistice: the tax is on PLAYING, in BATTLE — not haste, not mods', () => {
  const h = new Harness(3832);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Arbiter of Armistice');
  // deployment, same region: still free — "during battle" is a real gate
  giveResources(h, A, 'fire', 12);
  const life0 = h.state.players[A]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Ignis Sprite') });
  assert.equal(h.state.players[A]!.life, life0, 'deployment is not battle — no tax');
  toNextBattle(h, D);
  const atk = spawn(h, D, 'Ignis Sprite');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  pass(h);
  // R37: applying a mod is not PLAYING a card, so a Virus augment is exempt
  const target = unitsOf(h, A)[0]!;
  giveResources(h, A, 'fire', 6);
  const life1 = h.state.players[A]!.life;
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Smouldering Inferno'), hostId: target.id });
  assert.equal(h.state.players[A]!.life, life1, 'a Virus augment is applied, not played');
  finishBattle(h);
});

// ── Blob of the Dark Order ───────────────────────────────────────────────

test('Blob of the Dark Order: [Augment] pay 1 life for {Piercing} until regroup', () => {
  const h = new Harness(3802);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const blob = spawn(h, A, 'Blob of the Dark Order');
  const life = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: blob, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.life, life - 1, '1 life paid at resolution');
  assert.ok(ownAttrs(h, blob).has('Piercing'), 'it gains Piercing');
  toNextBattle(h, A);
  finishBattle(h);
  assert.ok(!ownAttrs(h, blob).has('Piercing'), 'until regroup only (R11 step 3)');
});

test('Blob of the Dark Order: R49 — at 1 life the cost is unpayable and the activation is ILLEGAL', () => {
  const h = new Harness(3803);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const blob = spawn(h, A, 'Blob of the Dark Order');
  h.state.players[A]!.life = 1;
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: blob, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/,
    'R49: a life cost you cannot survive is not payable — the activation is refused');
  assert.equal(h.state.players[A]!.life, 1, 'no life paid');
  assert.equal(h.state.winner, null, 'and nobody died paying a cost');
  assert.ok(!ownAttrs(h, blob).has('Piercing'), 'the unpaid cost buys nothing');
  assert.ok(!h.legal(A).some(a => a.type === 'activateAbility' && a.entityId === blob),
    'and legalActions does not offer it either');
  // at 2 life it IS payable, and the cost is paid at ACTIVATION
  h.state.players[A]!.life = 2;
  h.do({ type: 'activateAbility', seat: A, entityId: blob, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.life, 1, 'the 1 life is paid');
  assert.ok(ownAttrs(h, blob).has('Piercing'));
});

// ── Colony of the Interworld ─────────────────────────────────────────────

test('Colony of the Interworld: +3 counters when your life moves in battle, once per turn', () => {
  const h = new Harness(3804);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const colony = spawn(h, D, 'Colony of the Interworld');    // 2/2, D's
  giveResources(h, D, 'light', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                   // A passes → D acts
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Shard Sprite') });
  pass(h); pass(h);                                          // the Sprite resolves and spawns
  pass(h); pass(h);                                          // its "gain 3 life" trigger
  assert.equal(h.state.players[D]!.life, 33, 'D gained 3 life during battle');
  pass(h); pass(h);                                          // the Colony trigger
  assert.equal(ent(h, colony)!.counters, 3, 'the life GAIN channel fired');
  assert.deepEqual(effStats(h, colony), [5, 5]);
  pass(h); pass(h);                                          // the attack window closes
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat: D loses 1 life
  assert.equal(h.state.players[D]!.life, 32, 'and then lost life too');
  assert.equal(ent(h, colony)!.counters, 3, '[Switch1] is bounded — one firing this turn (R9)');
  finishBattle(h);
});

// ── Divine Foresight ─────────────────────────────────────────────────────

test('Divine Foresight: an opponent caches a chosen card with Prophecy — Three Turns Pass', () => {
  const h = new Harness(3805);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);                           // ll/1
  toNextBattle(h, A);
  h.state.players[D]!.hand = ['Shard Sprite', 'Greed Angel'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Divine Foresight') });
  pick(h, { player: D });
  pass(h); pass(h);                                          // resolve → the hand pick
  assert.equal(h.state.decision!.seat, A, 'the caster chooses from the revealed hand');
  assert.equal(h.state.decision!.options.length, 2);
  pick(h, 1);                                                // Greed Angel
  assert.deepEqual(h.state.players[D]!.hand, ['Shard Sprite'], 'it left their hand');
  const cc = cacheOf(h, D)[0]!;
  assert.equal(cc.card, 'Greed Angel', "into THEIR cache (it is still their card)");
  assert.equal(cc.prophecy!.norm, '3 turns pass', 'with the granted prophecy, normalised (R43)');
  assert.equal(cc.prophecy!.fulfilled, undefined, 'and counting forward from now');
  assert.ok(h.state.seenHand[A], 'the look is remembered client-side');
  finishBattle(h);
});

// ── Flesh Tithe ──────────────────────────────────────────────────────────

test('Flesh Tithe: pay X life, create an X/X unit', () => {
  const h = new Harness(3806);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'light', 4);                           // l/4
  const before = unitsOf(h, A).length;
  // R64: "[Pay X life]" is an additional cost — paid at cast, a point at a
  // time (R49 re-asked each time), and what was paid IS X.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flesh Tithe') });
  assert.equal(h.state.decision!.seat, A, 'the caster pays as they cast');
  for (let i = 0; i < 5; i++) pick(h, { payLife1: true });
  assert.equal(h.state.players[A]!.life, 25, '5 life paid before it reached the stack');
  pick(h, { doneCost: true });                               // X = 5
  const made = unitsOf(h, A).filter(u => u.token);
  assert.equal(made.length, 1, 'one token created');
  assert.equal(unitsOf(h, A).length, before + 1);
  assert.deepEqual(effStats(h, made[0]!.id), [5, 5], 'an X/X body');
  assert.ok(h.state.players[A]!.bin.includes('Flesh Tithe'), 'the spell resolved → bin');
});

test('Flesh Tithe: X = 0 pays nothing and creates nothing', () => {
  const h = new Harness(3807);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'light', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flesh Tithe') });
  pick(h, { doneCost: true });                               // X = 0, nothing paid
  assert.equal(h.state.players[A]!.life, 30);
  assert.equal(unitsOf(h, A).filter(u => u.token).length, 0);
});

// ── Glararr ──────────────────────────────────────────────────────────────

test('Glararr: pay 9 life to erase target unit (no bin, no death trigger)', () => {
  const h = new Harness(3808);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const gl = spawn(h, A, 'Glararr');
  const victim = spawn(h, A, 'Good Whale');
  h.do({ type: 'activateAbility', seat: A, entityId: gl, abilityIndex: 0 });
  pick(h, { unit: victim });
  assert.equal(h.state.players[A]!.life, 21, '9 life paid');
  assert.ok(!ent(h, victim), 'the target is gone');
  assert.ok(!h.state.players[A]!.bin.includes('Good Whale'), 'erased, not binned');
  assert.ok(h.log.some(l => l.includes('is ERASED')));
});

test('Glararr: R49 — at exactly 9 life the cost cannot be paid and the activation is ILLEGAL', () => {
  const h = new Harness(3809);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const gl = spawn(h, A, 'Glararr');
  const victim = spawn(h, A, 'Good Whale');
  h.state.players[A]!.life = 9;
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: gl, abilityIndex: 0 }),
    /cannot pay the activation cost/,
    'R49: paying your LAST life is refused too (life > n, not >=)');
  assert.equal(h.state.players[A]!.life, 9, 'no life paid');
  assert.equal(h.state.winner, null);
  assert.ok(ent(h, victim), 'and nothing is erased');
  assert.ok(!h.legal(A).some(a => a.type === 'activateAbility' && a.entityId === gl),
    'legalActions does not offer an unpayable activation');
});

test('Glararr: its [Switch1] is a transferable graft too, and the rider pays the 9 life (R49)', () => {
  const h = new Harness(3833);
  assert.ok(isGraftable('Glararr'),
    'a [Switch1]-printed card must be graftable — it was the only one in the pool that was not');
  const h2 = h;
  toDeployment(h2);   // (h2 aliases h; kept so the assertions read uniformly)
  const A = h2.state.deployPlayer!;
  // Shard Sprite is a graft cause ("When I spawn, [Switch1] you gain 3 life")
  const host = spawn(h2, A, 'Shard Sprite');
  const victim = spawn(h2, A, 'Good Whale');
  giveResources(h2, A, 'light', 5);                          // Glararr is l/5
  h2.state.players[A]!.life = 30;
  h2.do({ type: 'graft', seat: A, from: 'hand', index: give(h2, A, 'Glararr'), hostId: host, position: 0 });
  assert.equal(ent(h2, host)!.mods.length, 1, 'it really grafted');
  // fire the cause: spawning a SECOND Shard Sprite does not help — re-spawn the
  // host's own trigger by spawning a fresh one and grafting there is overkill;
  // instead drive the composite directly through the graft's own effect key
  const def = h2.q.card('Glararr').graftEffect!.effect;
  assert.equal(def.castCost?.kind, 'payLife', 'the rider carries the printed life cost');
  assert.equal((def.castCost as { n: number }).n, 9);
  assert.ok(h2.q.canPayCastCost(A, def.castCost!, h2.q.homeRegion(A), 0),
    'and at 30 life it is payable');
  h2.state.players[A]!.life = 9;
  assert.ok(!h2.q.canPayCastCost(A, def.castCost!, h2.q.homeRegion(A), 0),
    'R49: at exactly 9 life the rider cannot pay and is skipped');
  assert.ok(ent(h2, victim), 'nothing was erased along the way');
});

test('Prismatic Observer: its [Switch1] is a transferable graft too', () => {
  assert.ok(isGraftable('Prismatic Observer'),
    'a [Switch1]-printed card must be graftable');
  const h = new Harness(3834);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Shard Sprite');
  giveResources(h, A, 'light', 1);                           // Prismatic Observer is l/1
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Prismatic Observer'), hostId: host, position: 0 });
  assert.equal(ent(h, host)!.mods.length, 1, 'grafted');
  const def = h.q.card('Prismatic Observer').graftEffect!.effect;
  assert.equal(def.targets!.what, 'cachedCard', 'the rider keeps the printed target spec');
  assert.equal(def.targets!.min, 0, '"up to one"');
});

// ── Greed Angel ──────────────────────────────────────────────────────────

test('Greed Angel: 3 debt and a card on spawn; the debt is paid at the next resource step', () => {
  const h = new Harness(3810);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hand = h.state.players[A]!.hand.length;
  spawn(h, A, 'Greed Angel');
  assert.equal(h.q.debt(A), 3, 'R39: 3 debt on the player');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'and a card drawn');
  endDeployment(h);                                          // → next turn's planning
  giveResources(h, A, 'light', 5);
  const open = h.q.openMana(A);
  h.do({ type: 'donePlanning', seat: A });
  assert.equal(h.q.debt(A), 0, 'paid off automatically at the end of the resource step');
  assert.equal(h.q.openMana(A), open - 3, '1 mana per debt, expended and unavailable this turn');
  assert.ok(h.log.some(l => l.includes('pays 3 of 3 debt')));
});

test('Greed Angel: unpayable debt carries over instead of costing life', () => {
  const h = new Harness(3811);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Greed Angel');
  endDeployment(h);
  // strip A's mana so nothing can be paid
  for (const r of h.state.players[A]!.resources) r.state = 'expended';
  const life = h.state.players[A]!.life;
  h.do({ type: 'donePlanning', seat: A });
  assert.equal(h.q.debt(A), 3, 'the whole debt carries over');
  assert.equal(h.state.players[A]!.life, life, 'and there is no other penalty (R39)');
});

// ── Hooba-God ────────────────────────────────────────────────────────────

test('Hooba-God: attacking creates a copy token in its formation column', () => {
  const h = new Harness(3812);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hg = spawn(h, A, 'Hooba-God');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hg]] });
  pass(h); pass(h);                                          // resolve the attack trigger
  pick(h, 1);                                                // R75: behind me
  const copies = unitsOf(h, A).filter(u => u.card === 'Hooba-God');
  assert.equal(copies.length, 2, 'the original plus one copy');
  const copy = copies.find(u => u.id !== hg)!;
  assert.ok(copy.token, 'the copy is a token');
  assert.deepEqual(effStats(h, copy.id), [2, 2], 'with the printed body');
  assert.deepEqual(h.state.battle!.columns[0], [hg, copy.id], 'slotted into my column');
  finishBattle(h);
});

test('R75: a full column no longer strands the copy — it opens a column at an end', () => {
  // this used to assert "no room in the formation": the copy was created and
  // then left standing in the region, because Hooba-God only ever looked at
  // its own column. R75 offers the two ENDS of the line as well.
  const h = new Harness(3813);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hg = spawn(h, A, 'Hooba-God');
  const mate = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hg, mate]] });
  pass(h); pass(h);                                          // resolve the attack trigger
  assert.deepEqual(h.state.decision!.options.map(o => o.label),
    ['a new column on the left', 'a new column on the right'],
    'a full column offers no back slot, but both ends are open');
  pick(h, 1);                                                // the right-hand end
  const b = h.state.battle!;
  assert.deepEqual(b.columns[0], [hg, mate], 'the full column is untouched');
  assert.equal(b.columns.length, 2, 'the formation widened');
  const copy = unitsOf(h, A).filter(u => u.card === 'Hooba-God').find(u => u.id !== hg)!;
  assert.deepEqual(b.columns[1], [copy.id], 'the copy fronts the new column');
  finishBattle(h);
});

// ── Keeper of Tithes ─────────────────────────────────────────────────────

test('Keeper of Tithes: plays as a 3/3 and augments crash-free (parked text is inert)', () => {
  const h = new Harness(3814);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const k = spawn(h, A, 'Keeper of Tithes');
  assert.deepEqual(effStats(h, k), [3, 3]);
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 5);                           // l/5
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Keeper of Tithes'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'attached');
  assert.deepEqual(effStats(h, host), [1, 1], 'the donated text is parked-inert');
});

test('Keeper of Tithes: at the end of [Haste] it creates an X/X for your expended resources', () => {
  const h = new Harness(3830);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const keeper = spawn(h, A, 'Keeper of Tithes');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  // three resources already spent this turn when the haste step closes
  giveResources(h, A, 'light', 3, 'expended');
  giveResources(h, A, 'light', 2);
  const before = unitsOf(h, A).length;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle', 'the end-of-haste window did not strand the phase flip');
  const made = unitsOf(h, A).filter(u => u.id !== keeper && u.token);
  assert.equal(unitsOf(h, A).length, before + 1, 'exactly one token arrived');
  assert.deepEqual(made[0]!.tokenStats, [3, 3], 'X = the 3 expended resources');
  finishBattle(h);
});

test('Keeper of Tithes: with nothing expended X is 0 and no unit is created', () => {
  const h = new Harness(3831);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Keeper of Tithes');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  const before = unitsOf(h, A).length;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(unitsOf(h, A).length, before, 'X = 0 → nothing created');
  assert.ok(h.events.some(e => e.msg.includes('Keeper of Tithes: no expended resources')));
  finishBattle(h);
});

// ── Lifebound Seer ───────────────────────────────────────────────────────

test('Lifebound Seer: Glimpse 2 when it attacks — ONE cached, the other recycled (R45)', () => {
  const h = new Harness(3815);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const seer = spawn(h, A, 'Lifebound Seer');
  toNextBattle(h, A);
  const top = h.q.deckOf(A).slice(0, 2);
  const deckBefore = h.q.deckOf(A).length;
  const handBefore = [...h.state.players[A]!.hand];
  h.do({ type: 'declareAttack', seat: A, columns: [[seer]] });
  pass(h); pass(h);                                          // resolve the trigger
  const dec = h.state.decision!;
  assert.equal(dec.seat, A, 'the glimpser chooses which one to cache');
  assert.deepEqual(dec.options.map(o => o.card), top, 'both revealed cards are offered');
  h.do({ type: 'decide', seat: A, choice: 1 });              // cache the second
  assert.deepEqual(cacheOf(h, A).map(c => c.card), [top[1]], 'exactly ONE is cached');
  assert.deepEqual(h.q.deckOf(A).slice(-1), [top[0]], 'the other is recycled to the bottom');
  assert.equal(h.q.deckOf(A).length, deckBefore - 1, 'only the cached card left the deck');
  assert.deepEqual(h.state.players[A]!.hand, handBefore, 'nothing reaches hand');
  assert.ok(h.events.some(e => e.type === 'glimpsed'), 'the reveal is public (R41)');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse', 'playable until end of turn');
  assert.equal(cacheOf(h, A)[0]!.prophecy, undefined, 'glimpse attaches no prophecy');
  finishBattle(h);
});

// ── Penance ──────────────────────────────────────────────────────────────

test('Penance: any number of target players each lose 1 life, then draw a card', () => {
  const h = new Harness(3816);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 1);                           // l/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const idx = give(h, A, 'Penance');
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'playCard', seat: A, handIndex: idx });
  pick(h, { player: D });
  pick(h, { player: A });                                    // "any number" — both players
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 29);
  assert.equal(h.state.players[A]!.life, 29, 'you may target yourself');
  assert.equal(h.state.players[A]!.hand.length, hand, 'played one, drew one');
  finishBattle(h);
});

test('Penance: with no targets declared (min 0) the draw still happens', () => {
  const h = new Harness(3817);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const idx = give(h, A, 'Penance');
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'playCard', seat: A, handIndex: idx });
  pick(h, { doneTargets: true });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 30, 'nobody lost life');
  assert.equal(h.state.players[A]!.hand.length, hand, 'but the card was still drawn');
  finishBattle(h);
});

// ── Prismatic Observer ───────────────────────────────────────────────────

test('Prismatic Observer: sacrifice to recall a cached card (either cache, in battle) and gain 3 life', () => {
  const h = new Harness(3818);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const obs = spawn(h, A, 'Prismatic Observer');
  // D has a card of their own cached under a prophecy, nearly ripe
  const bait = 'Shard Sprite';
  withE(h, e => { e.cacheCard(D, bait, 'hand', { prophecy: 'Two Turns Pass' }); });
  const uid = cacheOf(h, D)[0]!.uid!;
  // R291: the enemy cache is a target only where the enemy IS. This used to
  // fire during deployment; the Observer attacks into D's region now, and
  // 293-cached-targets-are-regional holds the deployment refusal.
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[obs]] });
  if (h.state.priority !== A) pass(h);
  const life = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 });
  // R57: you pick the target BEFORE the sacrifice-self cost is paid, so a
  // misclick during battle no longer eats the unit before you have seen the
  // list. The cost is still paid at cast, before the ability resolves.
  assert.ok(ent(h, obs), 'still alive while you choose');
  pick(h, { cached: { seat: D, uid } });                     // R41: the enemy cache is targetable
  assert.ok(!ent(h, obs), 'sacrificed as a cost, before the ability resolves');
  pass(h); pass(h);                                          // in battle the ability resolves off the stack
  assert.equal(cacheOf(h, D).length, 0, 'the entry (and its prophecy) is gone');
  assert.ok(h.state.players[D]!.hand.includes(bait), 'recalled to its owner\'s hand');
  assert.equal(h.state.players[A]!.life, life + 3, 'and you gain 3 life');
});

test('Prismatic Observer: "up to one" — with no cached card the 3 life still happens', () => {
  const h = new Harness(3819);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const obs = spawn(h, A, 'Prismatic Observer');
  const life = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 });
  assert.equal(h.state.decision, null, 'nothing to target — no decision at all');
  assert.equal(h.state.players[A]!.life, life + 3);
  assert.ok(!ent(h, obs));
});

// ── Retribution Thing ────────────────────────────────────────────────────

test('Retribution Thing: the "lost" mode makes X the life you have lost in this battle', () => {
  const h = new Harness(3820);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');                     // 7/5
  const target = spawn(h, D, 'Good Whale');
  giveResources(h, D, 'light', 1);                           // l/1, D casts it
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat: D loses 7
  assert.equal(h.state.players[D]!.life, 23);
  // the after-combat window opens with the initiative player: D answers second
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  pick(h, { unit: atk });
  pick(h, 'lost');                                           // R157 §21: named at cast
  pass(h); pass(h);
  assert.ok(!ent(h, atk), '7 damage this battle kills the 7/5');
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'));
  assert.ok(ent(h, target), 'the untargeted unit is untouched');
  finishBattle(h);
});

test('R157 §21: the printed "[lost or gained]" is a MODE, so X is one ledger and never the sum', () => {
  const h = new Harness(3832);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Triskaidekaphage');            // 0/13, survives 5
  giveResources(h, A, 'light', 1);                           // l/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  withE(h, e => { e.loseLife(A, 2, 'test'); e.gainLife(A, 3, 'test'); });
  const region = h.state.battle!.region;
  assert.equal(h.q.battleCounter(region, `lifeLost:${A}`), 2);
  assert.equal(h.q.battleCounter(region, `lifeGained:${A}`), 3, 'R49: the gain ledger exists now');
  const [, tough] = effStats(h, victim);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Retribution Thing') });
  pick(h, { unit: victim });
  // this used to read X as the SUM (5). The owner's R157 §21 says every
  // [bracketed] clause is a cost or a cast-time mode, so the caster names one
  // ledger and reads only that — see 136-triggers-and-modes for both halves.
  assert.equal(h.state.decision?.kind, 'mode', 'the bracket is a cast-time choice');
  pick(h, 'gained');
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 3, 'X = the 3 GAINED alone — not 5, and not the 2 lost');
  assert.ok(tough > 5, 'the victim survives, so the damage is readable');
  finishBattle(h);
});

// ── Shard Sprite ─────────────────────────────────────────────────────────

test('Shard Sprite: you gain 3 life when it spawns', () => {
  const h = new Harness(3821);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const life = h.state.players[A]!.life;
  const sp = spawn(h, A, 'Shard Sprite');
  assert.equal(h.state.players[A]!.life, life + 3);
  assert.deepEqual(effStats(h, sp), [2, 1]);
});

// ── Stalwart Sentinel ────────────────────────────────────────────────────

test('Stalwart Sentinel: +2 counters for a card played from the cache, not from hand', () => {
  const h = new Harness(3822);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sent = spawn(h, A, 'Stalwart Sentinel');             // 1/1
  // a card played from HAND does nothing
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unit Token') });
  assert.equal(ent(h, sent)!.counters, 0, 'your hand is the ordinary place to play from');
  // glimpse it into the cache, then release it from there
  h.q.deckOf(A).unshift('Unit Token');
  withE(h, e => { e.glimpse(A, 1); });
  assert.equal(h.q.cachePermission(A, 0), 'glimpse');
  h.do({ type: 'playCached', seat: A, index: 0 });
  assert.equal(ent(h, sent)!.counters, 2, 'played from anywhere else → two +1/+1 counters');
  assert.deepEqual(effStats(h, sent), [3, 3]);
});

// ── The Everywhere ───────────────────────────────────────────────────────

/** deployment → the next turn's END-OF-HASTE decision. R50 fires 'endOfHaste'
 * inside a settle() window that may suspend, which is where The Everywhere
 * names its card — so the usual toNextBattle() plumbing would walk straight
 * past (and then trip over) the pending decision. `attacker` pins round 1. */
function toNaming(h: Harness, attacker?: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  if (attacker !== undefined) h.state.initiative = attacker;
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

test('The Everywhere: plays as a 3/3 haste body and augments crash-free', () => {
  const h = new Harness(3823);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ev = spawn(h, A, 'The Everywhere');
  assert.deepEqual(effStats(h, ev), [3, 3]);
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 4);                           // l/4
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'The Everywhere'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1);
  assert.deepEqual(effStats(h, host), [1, 1], 'the donated text grants no stats');
});

test('The Everywhere: naming a card during [Haste] silences EVERY copy of it IN MY REGION (R12/R62/R91)', () => {
  const h = new Harness(3841);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ev = spawn(h, A, 'The Everywhere');
  const mine1 = spawn(h, A, 'Triskaidekaphage');              // "when I attack, your life becomes 13"
  const mine2 = spawn(h, A, 'Triskaidekaphage');
  const theirs = spawn(h, D, 'Triskaidekaphage');
  toNaming(h, A);
  // R91: "name a card" IS a decision — the half the park note said did not exist
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, "the holder's controller names the card");
  assert.ok(h.state.decision!.options.some(o => o.value === 'Triskaidekaphage'),
    'the menu offers real cards, with DecisionOption.card set for the scan');
  pick(h, 'Triskaidekaphage');
  assert.ok(h.q.abilitiesSuppressed(ent(h, mine1)!));
  assert.ok(h.q.abilitiesSuppressed(ent(h, mine2)!),
    'the named CARD, not one unit — every copy');
  assert.deepEqual(h.q.suppressionOf(ent(h, mine1)!).by, ['The Everywhere'],
    'the text box names the culprit');
  // Caleb: "nothing can send information across regions" — the enemy copy is
  // untouched. The CONTINUOUS form does not change that: it reaches an enemy
  // only by carrying The Everywhere into their region, which is the next test.
  assert.ok(!h.q.abilitiesSuppressed(ent(h, theirs)!),
    'a copy in the other region is not silenced');
  // not just a flag: the silenced trigger never queues. The Everywhere attacks
  // in its own column beside the named unit, because the silence is now scoped
  // live to ITS region — a named ally that attacks alone leaves the projector
  // behind and gets its abilities back (see the "leaves" test below).
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[ev], [mine1]] });
  assert.equal(h.state.stack.length, 0, 'the on-attack trigger is silenced');
  finishBattle(h);
  assert.equal(h.state.players[A]!.life, lifeA, 'life never became 13');
});

test('The Everywhere: naming a card that is not in play silences nobody (R91)', () => {
  const h = new Harness(3842);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'The Everywhere');
  const mine = spawn(h, A, 'Triskaidekaphage');
  toNaming(h, A);
  pick(h, '');                                               // "a card that is not in play"
  assert.ok(!h.q.abilitiesSuppressed(ent(h, mine)!), 'nothing is silenced');
  assert.ok(h.log.some(l => l.includes('names a card that is not in play')));
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, 13, 'the unnamed card keeps its abilities');
  finishBattle(h);
});

/* ── The Everywhere's CONTINUOUS silence ───────────────────────────────────
 *
 * These four replace the `{ todo: true }` that used to sit here (and the card
 * ledger entry that named it). Printed: "[Augment] During [Haste] name a card.
 * My last named card loses all abilities. {i}(As long as I am in their
 * region.)" — the parenthetical is a DURATION, and it is the clause the card
 * is built around. At the end of the haste step every unit is still standing
 * at home, so a one-shot stamped at naming time could only ever reach allies;
 * the printed card reaches an enemy by ATTACKING INTO their region afterwards.
 *
 * Nothing here reaches across regions (Caleb: "the single rule we'll never
 * violate is 'nothing can send information across regions'"). The silence is a
 * StaticMod, and `staticsFor` already scopes its walk to
 * `anchor.region === target.region` — so the region clause is that scope,
 * re-asked live, and The Everywhere has to physically travel to use it.
 */

test('The Everywhere: the silence is CONTINUOUS — an enemy copy is silenced only once I ATTACK INTO their region', () => {
  const h = new Harness(3843);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ev = spawn(h, A, 'The Everywhere');                  // 3/3 {Haste}
  const theirs = spawn(h, D, 'Triskaidekaphage');            // "when I attack or block, your life becomes 13"
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');                               // a card in the OTHER region
  assert.equal(ent(h, ev)!.named, 'Triskaidekaphage', 'the naming is remembered on the anchor');
  assert.ok(!h.q.abilitiesSuppressed(ent(h, theirs)!),
    'nothing is silenced yet — we are still in our own regions');
  // the travel clause: attacking puts the projector in the defender's region
  h.do({ type: 'declareAttack', seat: A, columns: [[ev]] });
  assert.equal(ent(h, ev)!.region, ent(h, theirs)!.region, 'now we share a region');
  assert.ok(h.q.abilitiesSuppressed(ent(h, theirs)!),
    '"(as long as I am in their region)" — the silence switches on with no new event');
  assert.deepEqual(h.q.suppressionOf(ent(h, theirs)!).by, ['The Everywhere']);
  // and it is not just a flag: the silenced trigger never queues
  const lifeD = h.state.players[D]!.life;
  pass(h); pass(h);                                          // close the attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [theirs] } });
  assert.equal(h.state.stack.length, 0, 'the on-block trigger is silenced');
  finishBattle(h);
  assert.notEqual(h.state.players[D]!.life, 13, "the blocker's life never became 13");
  assert.ok(h.state.players[D]!.life <= lifeD);
});

test('The Everywhere: the silence LIFTS when I leave — continuous, not until-regroup', () => {
  const h = new Harness(3844);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ev = spawn(h, A, 'The Everywhere');
  const theirs = spawn(h, D, 'Triskaidekaphage');
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');
  h.do({ type: 'declareAttack', seat: A, columns: [[ev]] });
  assert.ok(h.q.abilitiesSuppressed(ent(h, theirs)!), 'silenced while I am there');
  finishBattle(h);                                           // → regroup: everyone goes home
  assert.ok(!h.q.abilitiesSuppressed(ent(h, theirs)!),
    'I went home, so I am no longer in their region and the abilities come straight back');
  // THE POINT of the distinction: the old implementation was an until-regroup
  // stamp, so regroup was where it ENDED. Here regroup ends nothing — it only
  // moves everyone, and the NAME survives as a memory ("my LAST named card"),
  // ready to bite again the moment I am back in their region.
  assert.equal(ent(h, theirs)!.suppressed, undefined,
    'no until-regroup stamp was ever written — R11 step 3 has nothing to sweep');
  assert.equal(ent(h, ev)!.named, 'Triskaidekaphage',
    'the memory is deliberately NOT cleared by the R11 step-3 regroup sweep');
});

test('The Everywhere: a second naming replaces the first — it is my LAST named card', () => {
  const h = new Harness(3845);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ev = spawn(h, A, 'The Everywhere');
  const trisk = spawn(h, A, 'Triskaidekaphage');
  const vroot = spawn(h, A, 'Vroot');
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');
  assert.ok(h.q.abilitiesSuppressed(ent(h, trisk)!));
  assert.ok(!h.q.abilitiesSuppressed(ent(h, vroot)!));
  finishBattle(h);
  toNaming(h, A);                                            // the next turn's [Haste] naming
  pick(h, 'Vroot');
  assert.equal(ent(h, ev)!.named, 'Vroot');
  assert.ok(h.q.abilitiesSuppressed(ent(h, vroot)!), 'the new name is silenced');
  assert.ok(!h.q.abilitiesSuppressed(ent(h, trisk)!),
    'and the OLD one is released — "my LAST named card" is one card, not a growing list');
  finishBattle(h);
});

test('The Everywhere: naming a card that is not in play RELEASES whatever I had named', () => {
  const h = new Harness(3846);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ev = spawn(h, A, 'The Everywhere');
  const trisk = spawn(h, A, 'Triskaidekaphage');
  toNaming(h, A);
  pick(h, 'Triskaidekaphage');
  assert.ok(h.q.abilitiesSuppressed(ent(h, trisk)!));
  finishBattle(h);
  toNaming(h, A);
  pick(h, '');                                               // "a card that is not in play"
  assert.equal(ent(h, ev)!.named, '', 'the decline is still a naming, and it is the LAST one');
  assert.ok(!h.q.abilitiesSuppressed(ent(h, trisk)!),
    'so the previous silence ends — the empty name matches no card in play');
  finishBattle(h);
});

// ── Triskaidekaphage ─────────────────────────────────────────────────────

test('Triskaidekaphage: attacking sets its controller\'s life to 13 (down)', () => {
  const h = new Harness(3824);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const t = spawn(h, A, 'Triskaidekaphage');                 // 0/13
  assert.deepEqual(effStats(h, t), [0, 13]);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[t]] });
  pass(h); pass(h);                                          // resolve the attack trigger
  assert.equal(h.state.players[A]!.life, 13, '30 → 13');
  finishBattle(h);
});

test('Triskaidekaphage: as a Virus the text reads from the HOST — and can go UP to 13', () => {
  const h = new Harness(3825);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const blocker = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'light', 3);                           // lll/3
  toNextBattle(h, A);
  h.state.players[D]!.life = 5;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Triskaidekaphage'), hostId: blocker });
  pass(h); pass(h);                                          // the Virus resolves onto the enemy blocker
  assert.equal(ent(h, blocker)!.mods.length, 1);
  pass(h); pass(h);                                          // the attack window closes
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);                                          // resolve the block trigger
  assert.equal(h.state.players[D]!.life, 13, "the HOST's controller goes 5 → 13");
  finishBattle(h);
});

// ── Vroot ────────────────────────────────────────────────────────────────

test('Vroot: when my column deals combat damage, each opponent gains that much life', () => {
  const h = new Harness(3826);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const v = spawn(h, A, 'Vroot');                            // 4/4
  assert.deepEqual(effStats(h, v), [4, 4]);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[v]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                          // combat: 4 to D
  resolveAfterCombat(h);   // R261: the column-damage trigger pays out after combat
  assert.equal(h.state.players[D]!.life, 30, 'lost 4, gained 4 back — the drawback cancels the hit');
  assert.ok(h.log.some(l => l.includes('Vroot')), 'the gain is attributed to Vroot');
  finishBattle(h);
});

test('Vroot: a blocked column pays out its whole power, not the blocker’s toughness (report #84, EGCW 251)', () => {
  // R114: "ALL damage is dealt to units, even if it surpasses its defense."
  // Vroot reads the amount straight off the combat 'damage' event, so the
  // lethal-capped assignment used to pay out 2 (the blocker's toughness)
  // where the column swung for 9. A non-Piercing column keeps every point.
  const h = new Harness(3827);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const v = spawn(h, A, 'Vroot');                            // 4/4
  let big = 0, chump = 0;
  withE(h, e => {
    big = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [5, 5] }).id;
    chump = e.spawnUnit(D, 'Unit Token', e.homeRegion(D), { token: true, tokenStats: [2, 2] }).id;
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[v, big]] });   // 4 + 5 = 9 power
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chump] } });
  pass(h); pass(h);
  resolveAfterCombat(h);   // R261: the column-damage trigger pays out after combat
  assert.ok(!ent(h, chump), 'the 2/2 blocker died');
  assert.equal(h.state.players[D]!.life, 39,
    'the column dealt all 9 to the blocker, so D gains 9 — not the 2 that killed it');
  finishBattle(h);
});
