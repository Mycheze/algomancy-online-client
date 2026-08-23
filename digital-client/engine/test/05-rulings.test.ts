/* digital-rules.md encoded as tests: one per ruling R1-R12.
 * Where a ruling's core is already exercised by the ported prototype tests,
 * the test here isolates the ruling-specific behavior. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard, registerSynthetic } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn,
  toDeployment, toNextBattle,
} from './util.ts';
import type { Seat } from '../src/types.ts';

test('R1: trigger conditions check at event time; amounts compute at resolution', () => {
  const h = new Harness(101);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tide = spawn(h, A, 'Astral Tidewraith');
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.state.players[A]!.hand = [];               // A's hand: 0 cards
  h.state.players[D]!.hand = ['Luminous Arc', 'Luminous Arc'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tide]] });
  // trigger fired at attack time; D's hand is 2 now. D responds with an Arc:
  // the hand count must be read at RESOLUTION, after the response.
  assert.equal(h.state.stack.length, 1, 'Tidewraith trigger on the stack');
  assert.equal(h.state.priority, D, 'D responds to the stacked trigger first');
  h.do({ type: 'playCard', seat: D, handIndex: 0 });
  pick(h, { unit: tide });                     // Arc the 0/6 for 6 — kills it!
  pass(h); pass(h);                            // resolve Arc: Tidewraith dies
  assert.ok(!ent(h, tide), 'Tidewraith died before its trigger resolved');
  const lifeBefore = h.state.players[D]!.life;
  pass(h); pass(h);                            // resolve the trigger anyway (R1:
  // once on the stack it resolves regardless of later changes to the source)
  assert.equal(h.state.players[D]!.life, lifeBefore - 1,
    'D took damage equal to their hand AT RESOLUTION (1 card left, not 2)');
  assert.equal(h.state.players[A]!.life, 30, 'A: empty hand, no damage');
});

test('R2: simultaneous triggers — owners order their own, NIT resolves first', () => {
  const h = new Harness(102);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  giveResources(h, A, 'fire', 3);
  // both sides get an "after combat, sacrifice me" via Smouldering augment text
  const aUnit = spawn(h, A, 'Rune Channeler');
  const sa = give(h, A, 'Smouldering Inferno');
  h.do({ type: 'augment', seat: A, from: 'hand', index: sa, hostId: aUnit });
  toNextBattle(h, A);
  const IT = h.state.initiative, NIT = 1 - IT;
  const dUnit = spawn(h, NIT, 'Mischievous Reclaimer');
  new E(h.state).attachMod(ent(h, dUnit)!, 'Smouldering Inferno', NIT, 'augment');
  h.do({ type: 'declareAttack', seat: IT, columns: [[aUnit]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: NIT, blocks: {} });   // no blocks: both survive
  pass(h); pass(h);   // damage to face; afterCombat fires BOTH sacrifices
  assert.equal(h.state.stack.length, 2, 'both triggers stacked simultaneously');
  assert.equal(h.state.stack[1]!.controller, NIT, "NIT's trigger entered last (R2)");
  pass(h); pass(h);   // resolve top: NIT's sacrifice first
  assert.ok(!ent(h, dUnit), "NIT's unit sacrificed first");
  assert.ok(ent(h, aUnit), "IT's not yet");
  pass(h); pass(h);
  assert.ok(!ent(h, aUnit), "IT's sacrifice resolved second");
});

test('R3: formation recalc between damage sub-steps, no priority window', () => {
  // the Swift sub-step test in 02-combat.test.ts is the R3 encoding: the
  // blocker died in the Swift sub-step and the recalculated state applied to
  // the normal sub-step with no priority in between. Here: back-row promotion
  // between sub-steps.
  const h = new Harness(103);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const swift = spawn(h, A, 'Dune Drifter');       // 2/1 Swift
  const front = spawn(h, D, 'Curio Drifter');      // 2/2 front blocker
  const back = spawn(h, D, 'Rune Channeler');      // 4/3 back blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[swift]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [front, back] } });
  pass(h); pass(h);
  // swift sub-step: 2 damage kills the 2/2 front; back promotes immediately;
  // normal sub-step: the promoted 4/3 kills the 2/1 — no priority in between
  assert.ok(!ent(h, front), 'front blocker died to swift damage');
  assert.ok(!ent(h, swift), 'promoted back blocker struck back in the normal sub-step');
  assert.ok(ent(h, back), 'back blocker took no damage (swift power was spent on the front)');
});

test('R4: electric excess follows a controller-chosen non-overlapping path, atomically', () => {
  const h = new Harness(104);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const front1 = spawn(h, A, 'Curio Drifter');     // 2/2 col 0 front
  const back1 = spawn(h, A, 'Rune Channeler');     // 4/3 col 0 back
  const front2 = spawn(h, A, 'Ignis Sprite');      // 1/1 col 1 front
  giveResources(h, D, 'fire', 4);                  // Arc Lightning is rr / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front1, back1], [front2]] });
  pass(h);
  const arc = give(h, D, 'Arc Lightning');         // {Electric} 6 damage
  h.do({ type: 'playCard', seat: D, handIndex: arc });
  pick(h, { unit: front1 });
  pass(h); pass(h);                                // resolve: 2 lethal, 4 excess
  // two adjacent candidates (back1 vertically, front2 horizontally) → decision
  assert.equal(h.state.decision?.kind, 'electricPath', 'controller chooses the path (R4)');
  assert.equal(h.state.decision!.seat, D, "the Electric SOURCE's controller chooses");
  const toSprite = h.state.decision!.options.findIndex(o => o.label === 'Ignis Sprite');
  h.do({ type: 'decide', seat: D, choice: toSprite });
  // 4 excess → Ignis (1 lethal), 3 excess → next hop: only front1 adjacent
  // (visited) and nothing else → lost. All damage landed atomically.
  assert.ok(!ent(h, front1), 'first victim died');
  assert.ok(!ent(h, front2), 'excess jumped the chosen way and killed the sprite');
  assert.ok(ent(h, back1) && ent(h, back1)!.damage === 0, 'unchosen neighbor untouched, overflow lost');
});

test('R5: all targets gone → fizzle; a fizzled spell unit never spawns', () => {
  const h = new Harness(105);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const target = spawn(h, A, 'Good Whale');        // 7/5, no spell trigger of its own
  giveResources(h, D, 'water', 3);
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[target]] });
  pass(h);
  const j = give(h, D, 'Jelly');                   // spell unit, targets the attacker
  h.do({ type: 'playCard', seat: D, handIndex: j });
  pick(h, { unit: target });
  // A responds by killing their own whale with Luminous Arc (6 ≥ 5)
  const arc = give(h, A, 'Luminous Arc');
  h.do({ type: 'playCard', seat: A, handIndex: arc });
  pick(h, { unit: target });
  pass(h); pass(h);                                // Arc resolves, target dies
  assert.ok(!ent(h, target));
  pass(h); pass(h);                                // Jelly: all targets gone
  assert.ok(h.log.some(l => l.includes('Jelly fizzles')), 'fizzled');
  assert.ok(!Object.values(h.state.entities).some(e => e.card === 'Jelly'),
    'a fizzled spell unit never spawns');
  assert.ok(h.state.players[D]!.bin.includes('Jelly'), 'fizzled card → bin');
});

// R6 needs an "unless its controller pays [x]" card; none is in the M1 pool,
// so a synthetic card exercises the engine mechanism (mid-resolution payment,
// no priority window around it).
registerSynthetic({
  name: 'Test Extortion', cost: 'r', mana: 1, power: 0, toughness: 0,
  type: '{Battle} Test Spell', kind: 'spell', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], text: 'Delete target unit unless its controller pays [2].', image: '',
}, {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Test Extortion: delete target unit unless its controller pays [2]' },
    run: (g, ctx) => {
      const t = ctx.targets[0]!;
      if (!('id' in (t as object))) return;
      const u = t as import('../src/types.ts').Entity;
      const options = [{ label: 'Decline', value: false }];
      if (g.openMana(u.controller) >= 2) options.unshift({ label: 'Pay [2]', value: true });
      const pays = ctx.choose('pay', {
        kind: 'payOrDecline', seat: u.controller,
        prompt: `Pay [2] to save ${u.card}?`, options,
      });
      if (pays) g.payMana(u.controller, 2);
      else g.destroy(u, 'is deleted');
    },
  },
});

test('R6: "unless its controller pays" is part of resolution — pay branch', () => {
  const h = new Harness(106);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const target = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'fire', 3);
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[target]] });
  pass(h);
  const ex = give(h, D, 'Test Extortion');
  h.do({ type: 'playCard', seat: D, handIndex: ex });
  pick(h, { unit: target });
  pass(h); pass(h);                                // resolve → payment decision
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, "the TARGET's controller decides");
  const payIdx = h.state.decision!.options.findIndex(o => o.value === true);
  const manaBefore = new E(h.state).openMana(A);
  h.do({ type: 'decide', seat: A, choice: payIdx });
  assert.ok(ent(h, target), 'unit saved');
  assert.equal(new E(h.state).openMana(A), manaBefore - 2, 'payment expended mid-resolution');
  assert.equal(h.state.stack.length, 0, 'no priority window around the payment (R6)');
});

test('R6: decline branch deletes', () => {
  const h = new Harness(107);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const target = spawn(h, A, 'Rune Channeler');
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[target]] });
  pass(h);
  const ex = give(h, D, 'Test Extortion');
  h.do({ type: 'playCard', seat: D, handIndex: ex });
  pick(h, { unit: target });
  pass(h); pass(h);
  const declineIdx = h.state.decision!.options.findIndex(o => o.value === false);
  h.do({ type: 'decide', seat: A, choice: declineIdx });
  assert.ok(!ent(h, target), 'declined → deleted');
});

/** the `n` of every 'damage' event this test has seen land on one unit */
function damageTo(h: Harness, id: number): number[] {
  return h.events.filter(e => e.type === 'damage' && e.data?.['unit'] === id)
    .map(e => e.data!['n'] as number);
}

test('R114: without Piercing the excess is not lost, it lands on the unit', () => {
  // Report #84 (Bena, 2026-08-23): "ALL damage is dealt to units, even if it
  // surpasses its defense. The only exception is Piercing, which deals excess
  // to the controller." The engine used to CAP the hit at lethal and drop the
  // rest, so a 4-power attacker into a 1/1 dealt 1.
  const h = new Harness(108);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const big = spawn(h, A, 'Rune Channeler');       // 4/3, NO piercing
  const chump = spawn(h, D, 'Ignis Sprite');       // 1/1 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[big]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chump] } });
  pass(h); pass(h);
  assert.ok(!ent(h, chump), 'blocker died');
  assert.deepEqual(damageTo(h, chump), [4],
    'the 1/1 was DEALT the whole 4 — the excess is not trimmed away');
  assert.equal(h.state.players[D]!.life, 30,
    'and none of it reached the player: without Piercing nothing leaves the unit');
  // piercing-automatic is asserted in 02-combat ("piercing overflow hit player")
});

test("R114: {Deadly}'s 1 is a pass-along floor, not a cap on what is dealt", () => {
  // Report #79 (EGCW 212): a 2-power {Deadly} column into a 7/3. {Deadly}
  // means one point of the pool SUFFICES to kill, so only 1 has to be paid
  // before the rest may walk on — it never means only 1 is dealt.
  const h = new Harness(1084);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const d1 = spawn(h, A, 'Tidepool Terror');       // 1/2 {Deadly}
  const d2 = spawn(h, A, 'Tidepool Terror');       // 1/2 {Deadly} — 2 power in column
  const fat = spawn(h, D, 'Life Plant');           // 7/3 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[d1, d2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [fat] } });
  pass(h); pass(h);
  assert.deepEqual(damageTo(h, fat), [2],
    'the whole 2-power column was dealt, not the 1 {Deadly} needed');
  assert.ok(!ent(h, fat), 'and the 7/3 still died to {Deadly}');
  finishBattle(h);
});

test('R114: {Piercing} is still the exception — excess goes to the controller, not the unit', () => {
  // The ruling's own carve-out, fenced so the R114 fix cannot swallow it.
  const h = new Harness(1085);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const spear = spawn(h, A, 'Bumblecrab');           // 2/3 {Piercing}
  const chump = spawn(h, D, 'Ignis Sprite');         // 1/1 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[spear]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chump] } });
  pass(h); pass(h);
  assert.deepEqual(damageTo(h, chump), [1],
    'Piercing pays the blocker its lethal share and carries the rest away');
  assert.equal(h.state.players[D]!.life, 29, 'the 1 excess hit the controller');
  finishBattle(h);
});

test('R9: once-per-turn budgets are per card and survive control change', () => {
  const h = new Harness(109);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  giveResources(h, p, 'water', 6);   // Lonely Forager is b / 3
  const rc = spawn(h, p, 'Rune Channeler');
  // spend RC's bounded trigger with a spell
  const s1 = give(h, p, 'Lonely Forager');
  h.do({ type: 'playCard', seat: p, handIndex: s1 });
  pick(h, { unit: rc });                           // RC deals 2 to itself
  assert.ok((ent(h, rc)!.budgets['ability:Rune Channeler#0'] ?? 0) > 0, 'budget spent');
  // steal RC; the budget must NOT reset (R9)
  ent(h, rc)!.controller = o;
  ent(h, rc)!.region = new E(h.state).homeRegion(o);
  h.do({ type: 'doneDeploying', seat: p });
  giveResources(h, o, 'water', 3);
  const s2 = give(h, o, 'Lonely Forager');
  h.do({ type: 'playCard', seat: o, handIndex: s2 });
  assert.equal(h.state.decision, null, 'stolen RC did not re-trigger: spent budget travelled with the card');
});

/*
 * R10 IS NO LONGER A THEORETICAL RULING, AND NO LONGER AN UNBUILT ONE.
 *
 * This slot used to hold one `{todo:true}` whose title read "no Unaware card
 * in the M1 pool", and that stopped being true the day the Light & Dark
 * expansion shipped: Bubb, Trashling and Haboob all print {Unaware} on the
 * type line, and are in the pool, and get drafted. The todo's title was
 * quietly telling every reader there was nothing to test here. Then it was
 * replaced by a SECOND todo — "stat layer 6 itself" — which was true but
 * still could not fail, and the attribute stayed dead through two playtest
 * reports and a conceded game (CARD-TODO #5).
 *
 * Stat layer 6 shipped on 2026-08-23 (R106): an {Unaware} card, and everything
 * it is interacting with, reads at the numbers PRINTED on the card. Both
 * halves are exercised below, and the whole layer has its own file,
 * test/92-unaware.test.ts.
 *
 * There is no todo left in this slot. There is no todo left to put here.
 */
test('R10: Unaware is printed and carried on Bubb / Trashling / Haboob, and stat layer 6 reads it', () => {
  // 1. the printed data. Three cards, one attribute — if a data refresh ever
  //    drops it, this is the first thing that notices.
  for (const name of ['Bubb', 'Trashling', 'Haboob']) {
    assert.ok(getCard(name).attrs.includes('Unaware'),
      `${name} prints {Unaware} on its type line`);
  }

  const h = new Harness(110);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;

  // 2. it reaches a unit in play, and the "[Augment] {Unaware}" half donates
  //    it to a host. Both paths work, and both now END SOMEWHERE.
  const bubb = spawn(h, A, 'Bubb');                       // 5/6
  assert.ok(ownAttrs(h, bubb).has('Unaware'), 'a played Bubb has {Unaware}');
  ent(h, bubb)!.counters = 3;
  assert.deepEqual(effStats(h, bubb), [5, 6],
    'R106: Bubb reads the 5/6 printed on its own card, whatever is stacked on it');
  const host = spawn(h, A, 'Unit Token');                 // 1/1
  ent(h, host)!.counters = 2;                             // → 3/3
  assert.deepEqual(effStats(h, host), [3, 3], 'the host is an ordinary pumped 3/3 first');
  giveResources(h, A, 'earth', 4);                        // Bubb: e/4
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Bubb'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'),
    'and the [Augment] half donates {Unaware} to the host (printed.augmentAttrs)');
  assert.deepEqual(effStats(h, host), [1, 1],
    'which drops the host to ITS printed 1/1 — the donation is a real effect now');

  // 3. THE DIVERGENCE THAT USED TO BE PINNED HERE AS "THE WRONG ANSWER".
  //
  //    Haboob is an {Unaware} spell: "I deal 1 damage to each unit." Caleb, in
  //    rules-questions:
  //      "Unaware is last 'stat modifier applied' and any Unaware units (or
  //       Spells like Haboob) will only look at BASE STAT PRINTED on cards"
  //    and the owner, 2026-08-23, in as many words: "Haboob kills anything
  //    that has 1 defense printed at the card level." They agree. So a 1/1
  //    token pumped to 3/3 is, to Haboob, a 1/1, and 1 damage kills it.
  //
  //    This assertion spent months reading `assert.ok(ent(h, pumped))` under a
  //    comment explaining that it was the wrong answer, pinned on purpose
  //    until layer 6 landed. Layer 6 landed; this is the right answer now.
  const pumped = spawn(h, A, 'Unit Token');               // 1/1
  ent(h, pumped)!.counters = 2;                           // → 3/3
  assert.deepEqual(effStats(h, pumped), [3, 3], 'pumped to 3/3 the ordinary way');
  giveResources(h, D, 'earth', 4);                        // Haboob: ee/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pumped]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haboob') });
  pass(h); pass(h);                                       // resolve Haboob

  assert.ok(!ent(h, pumped), 'Haboob read the printed 1 toughness and killed it');
  finishBattle(h);
});

test('R10/R106: an Unaware blocker and what it blocks BOTH read at printed', () => {
  // The owner's own example, driven through real combat: "Bubb blocking a
  // Robot token would kill it (do Bubb, it has 0 power and 0 defense), no
  // matter how many +1/+1 counters it has." A Robot is printed 0/0 and carries
  // its whole size in counters, so the two readings could not be further apart.
  const h = new Harness(1101);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const robot = (() => {
    const e = new E(h.state);
    const u = e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 9 });
    e.settle();
    return u.id;
  })();
  const bubb = spawn(h, D, 'Bubb');
  assert.deepEqual(effStats(h, robot), [9, 9], 'a Robot 9 is a 9/9 to everything else');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[robot]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);                                       // damage
  assert.ok(!ent(h, robot), 'in the exchange it is a 0/0, and 0 defense is dead');
  assert.equal(ent(h, bubb)!.damage, 0, 'and it dealt its printed 0 power, not 9');
  finishBattle(h);
});

test('R11: regroup runs its exact sequence (return → damage → temp → formation, tokens erased)', () => {
  const h = new Harness(111);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');   // 7/5: survives Jelly + 1 marked damage
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const j = give(h, D, 'Jelly');                   // -2/-2 temp on the attacker
  h.do({ type: 'playCard', seat: D, handIndex: j });
  pick(h, { unit: atk });
  pass(h); pass(h);
  ent(h, atk)!.damage = 1;                         // mark some damage too
  const e0 = new E(h.state);
  const tok = e0.createSpellToken(A, 'Fireball', 1, h.state.battle!.region);
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  const e = new E(h.state);
  const u = ent(h, atk)!;
  assert.equal(u.region, e.homeRegion(A), '(1) unit returned home');
  assert.deepEqual(h.state.regions.map(r => r.presentSeats), [[0], [1]], '(1) players returned');
  assert.equal(u.damage, 0, '(2) damage reset');
  assert.equal(u.tempPower, 0, '(3) temporary changes removed');
  assert.equal(h.state.battle, null, '(4) formations gone');
  assert.ok(!h.state.entities[tok.id], '(+) spell tokens erased');
});

test('R12: regions are exclusive — home units are not targetable in another region\'s battle', () => {
  const h = new Harness(112);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Rune Channeler');       // will attack
  const home = spawn(h, A, 'Good Whale');          // stays home
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const arc = give(h, D, 'Luminous Arc');
  h.do({ type: 'playCard', seat: D, handIndex: arc });
  const offered = h.state.decision!.options.map(o => JSON.stringify(o.value));
  assert.ok(offered.includes(JSON.stringify({ unit: atk })), 'attacker (in region) targetable');
  assert.ok(!offered.includes(JSON.stringify({ unit: home })), 'home unit does not exist here (R12)');
  pick(h, { unit: atk });
  pass(h); pass(h);
});
