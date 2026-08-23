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

test('R7: piercing is automatic, not elective; without it excess is lost', () => {
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
  assert.equal(h.state.players[D]!.life, 30, 'no piercing: 3 excess damage lost, never elective');
  // piercing-automatic is asserted in 02-combat ("piercing overflow hit player")
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
 * R10 IS NO LONGER A THEORETICAL RULING. This slot used to hold one
 * `{todo:true}` whose title read "no Unaware card in the M1 pool", and that
 * stopped being true the day the Light & Dark expansion shipped: Bubb,
 * Trashling and Haboob all print {Unaware} on the type line TODAY, and are in
 * the pool, and get drafted. The todo's title was quietly telling every reader
 * there was nothing to test here.
 *
 * There is. The attribute arrives — printed data carries it, the augment
 * donates it, the UI shows it — and then `effStats()` ignores it: the method
 * ends on the literal placeholder `// layer 5 (Inverted), 6 (Unaware) go
 * here`. Carrying an attribute nothing reads is indistinguishable from a
 * blank, which is exactly the shape that hid Harbinger, and it is why
 * card-ledger.ts lists all three as dead-or-partial `deadAttr: 'Unaware'`
 * entries.
 *
 * So this is now TWO tests: a real one that exercises the attribute end to end
 * and pins where the truth stops, and a todo that keeps the still-unbuilt half
 * — layer 6 itself — named. The real test is the guard; the todo is the entry
 * card-ledger.ts's staleness check reads, and it is kept honest by having the
 * real test standing next to it.
 */
test('R10: Unaware is printed and carried on Bubb / Trashling / Haboob — and stat layer 6 still ignores it', () => {
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
  //    it to a host. Both paths work; both lead nowhere.
  const bubb = spawn(h, A, 'Bubb');                       // 5/6
  assert.ok(ownAttrs(h, bubb).has('Unaware'), 'a played Bubb has {Unaware}');
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 4);                        // Bubb: e/4
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Bubb'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'),
    'and the [Augment] half donates {Unaware} to the host (printed.augmentAttrs)');

  // 3. THE DIVERGENCE, exercised end to end rather than asserted about.
  //    Haboob is an {Unaware} spell: "I deal 1 damage to each unit." Caleb, in
  //    rules-questions, is explicit about what {Unaware} means for it —
  //      "Unaware is last 'stat modifier applied' and any Unaware units (or
  //       Spells like Haboob) will only look at BASE STAT PRINTED on cards"
  //    — so a 1/1 token pumped to 3/3 is, to Haboob, still a 1/1, and 1 damage
  //    kills it. R10 says the same thing from the other side: "everything
  //    counts as interacting", and the two mutually ignore stat changes.
  const pumped = spawn(h, A, 'Unit Token');               // 1/1
  ent(h, pumped)!.counters = 2;                           // → 3/3
  assert.deepEqual(effStats(h, pumped), [3, 3], 'pumped to 3/3 the ordinary way');
  giveResources(h, D, 'earth', 4);                        // Haboob: ee/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pumped]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haboob') });
  pass(h); pass(h);                                       // resolve Haboob

  // ⚠ THIS IS THE WRONG ANSWER, PINNED ON PURPOSE. Under R10 the token is
  // dead: Haboob reads its BASE 1 toughness and deals it 1. The engine reads
  // the effective 3 instead, because layer 6 does not exist, so the token
  // walks away with a scratch. Nothing else in the repo would go red if
  // somebody deleted the {Unaware} plumbing tomorrow, and nothing at all
  // would go red when layer 6 finally lands — this assertion does both. When
  // you implement layer 6, this line fails, and the fix is to change it to
  // `assert.ok(!ent(h, pumped), 'Haboob read the printed 1 toughness')` and
  // delete the todo below.
  assert.ok(ent(h, pumped), 'layer 6 is unimplemented: the pumped token survives Haboob');
  assert.equal(ent(h, pumped)!.damage, 1, 'it took the 1 damage, just not lethally');
  finishBattle(h);
});

test('R10: Unaware — stat layer 6 itself (mutually ignoring stat changes at every interaction)', { todo: true }, () => {
  // The half above pins the CURRENT behaviour; this is the one that is still
  // to build. effStats() ends on "// layer 5 (Inverted), 6 (Unaware) go here"
  // and R10's scope is wide — fight, blocking, being blocked, dealing or
  // receiving combat damage, targeting, all of it — so it is a pairwise
  // "as seen by" question at every interaction site, not a term to add to a
  // sum. card-ledger.ts's Bubb / Trashling / Haboob entries point here.
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
