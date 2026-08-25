/* Per-card tests for batch-earth-a (project rule: a test for every card).
 * Covers the Rockfall death graft (A Fast Pile of Rocks, R25 per-seat picks),
 * the R168 static +2/+2 (Aetherflux Golem — was a counters approximation), the two
 * fight effects (Battle / Fight — cast-time first target + mid-resolution
 * second pick), type-line and text-box augments (Bubb, Deathglow Strider,
 * Lithoghul), activated abilities living in [Augment] text (Enigmatic
 * Warder, Graxxlid — via: 'augment'), the column-combat-damage trigger
 * (Flowstone Arcanite, both the lifeLost and unit-damage channels), a
 * region-wide sweep (Haboob), the pay-to-fight damage trigger (Eminence of
 * the Barrens, R6 payment), Hooba-Lan's real dormant Shard (unparked — see
 * E.createShard), the Manual p.18 affinity bonus the Earth Resource face
 * reprints as reminder text (R116/R54 — the rule lives in maybeGrantShard, not
 * on the card), and Crevice Lurker's R121 ability-cost tax + pay-to-trigger
 * gate (taxed and refused activations, the pay/decline/no-mana trigger gate,
 * the kept [once], the untaxed mod application, the donated form, two-Lurker
 * summing, and a JSON round-trip of the pending question).
 * States are built explicitly (give/spawn/giveResources).
 * Seeds 1600-1699. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard } from '../src/cards/dsl.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle,
} from './util.ts';

test('A Fast Pile of Rocks: dies in combat → Rockfall 4 (each present player picks a unit; 4 damage each)', () => {
  const h = new Harness(1600);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const pile = spawn(h, A, 'A Fast Pile of Rocks');   // 2/1 haste body
  const bubbA = spawn(h, A, 'Bubb');                  // 5/6 — A's only other unit in region
  const blocker = spawn(h, D, 'Unit Token');          // 1/1 — trades with the pile
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6
  const tokD = spawn(h, D, 'Unit Token');             // second D unit → D gets a real choice
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pile], [bubbA]] });
  pass(h); pass(h);                                   // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);   // combat: pile & blocker trade → Rockfall resolves at once: A auto-picks…
  assert.ok(!ent(h, pile) && !ent(h, blocker), 'pile and its blocker died in combat');
  pick(h, ent(h, bubbD)!.id);                         // …D chooses Bubb over the token
  assert.equal(ent(h, bubbA)!.damage, 4, "A's auto-picked unit took 4");
  assert.equal(ent(h, bubbD)!.damage, 4, "D's chosen unit took 4");
  assert.equal(ent(h, tokD)!.damage, 0, 'the unchosen unit is untouched');
  assert.ok(h.state.players[A]!.bin.includes('A Fast Pile of Rocks'), 'the pile went to the bin');
  finishBattle(h);
});

test('Aetherflux Golem: +2/+2 for itself when played normally; +2/+2 to the host when augmenting', () => {
  const h = new Harness(1601);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const golem = spawn(h, p, 'Aetherflux Golem');
  assert.deepEqual(effStats(h, golem), [3, 3], "1/1 + its own [Augment] text's +2/+2 = 3/3");
  const host = spawn(h, p, 'Unit Token');             // vanilla 1/1
  giveResources(h, p, 'earth', 2);                    // ee / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Aetherflux Golem'), hostId: host });
  assert.deepEqual(effStats(h, host), [3, 3], 'host 1/1 + donated +2/+2 = 3/3');
  // R168: a LAYER, not two +1/+1 counters. This line used to read
  // `assert.equal(ent(h, host)!.counters, 2, 'modelled as two +1/+1 counters
  // (approximation)')`. The approximation is gone — counter-matters cards no
  // longer see counters the Golem never printed, the +2/+2 cannot be negated
  // off the stack, and it LEAVES with the virus. Same correction Tenebrous
  // Bulborb got after playtest ledger #46; see test/142-static-conformance.
  assert.equal(ent(h, host)!.counters, 0,
    'no counters — the +2/+2 is a continuous layer on the anchor, not two +1/+1 counters');
  assert.deepEqual(effStats(h, golem), [3, 3], 'the in-play Golem did not double-fire on the attach');
  // and the layer leaves with the mod: erase the virus, the host is a 1/1 again
  const mod = ent(h, host)!.mods[0]!;
  h.state.entities[host]!.mods = [];
  delete h.state.entities[mod];
  assert.deepEqual(effStats(h, host), [1, 1], 'the +2/+2 goes when the mod goes — a layer, not a write');
});

test('Battle: two target units fight (mutual power damage; both targets at cast)', () => {
  const h = new Harness(1602);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 attacker
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6 defender-side unit
  giveResources(h, D, 'earth', 4);                    // ee / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Battle') });
  pick(h, { unit: atk });                             // first target (at cast)
  pick(h, { unit: bubbD });                           // second target (at cast — count: 2)
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), "the 1/1 died to Bubb's 5 power");
  assert.equal(ent(h, bubbD)!.damage, 1, "Bubb took the 1/1's 1 power back");
  finishBattle(h);
});

test('Bubb: 5/6 Unaware; type-line [Augment] donates Unaware (attrs only, no stats)', () => {
  const h = new Harness(1603);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bubb = spawn(h, p, 'Bubb');
  assert.deepEqual(effStats(h, bubb), [5, 6], '5/6');
  assert.ok(ownAttrs(h, bubb).has('Unaware'), 'played normally: has Unaware');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'earth', 4);                    // e / 4
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Bubb'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'), 'type-line [Augment] donates Unaware');
  assert.deepEqual(effStats(h, host), [1, 1], 'attr-only donation: stats unchanged');
});

// ── Crevice Lurker — R121: the ability-cost tax + pay-to-trigger gate ──
// "[Augment] Abilities cost [one] more to activate or trigger during battle.
// (Choosing to not pay this prevents the abilities from triggering.)"
// Designer: it "taxes the cost to activate or trigger abilities" and can stop
// e.g. Ruinbringer's after-combat trigger like a negate can. R12 region
// scope; R37: applying a mod is not taxed; R108/R113: a declined trigger
// keeps its [once].

/** a seat's open resources — the taxed activations spend real mana */
function openMana(h: Harness, seat: number): number {
  return h.state.players[seat]!.resources.filter(r => r.state === 'open').length;
}

test('Crevice Lurker: 2/3 body, attaches cleanly as an augment', () => {
  const h = new Harness(1604);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cl = spawn(h, p, 'Crevice Lurker');
  assert.deepEqual(effStats(h, cl), [2, 3], '2/3 body');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'earth', 2);                    // ee / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Crevice Lurker'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment, attaches cleanly');
});

test('Crevice Lurker: R121 — in battle an activated [1] costs [2], and with only [1] open it is not activatable', () => {
  const h = new Harness(1620);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lurker = spawn(h, A, 'Crevice Lurker');
  const auric = spawn(h, D, 'Auric Ascendant');       // "[once] [one], Recall another ally: …"
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lurker]] });   // the Lurker walks into the battle
  pass(h);                                            // priority → D
  const offers = () => h.legal(D).filter(a => a.type === 'activateAbility' && a.entityId === auric);
  assert.equal(offers().length, 0, 'printed [1] is taxed to [2] — with [1] open it is not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: auric, abilityIndex: 0 }),
    /cannot pay the activation cost/, 'and it is refused, not just unoffered');
  giveResources(h, D, 'water', 1);
  assert.equal(offers().length, 1, 'with [2] open the taxed activation is offered');
  h.do({ type: 'activateAbility', seat: D, entityId: auric, abilityIndex: 0 });
  assert.equal(openMana(h, D), 0, 'the activation spent [1] printed + [1] tax');
  pass(h); pass(h);                                   // resolve (no other ally — no recall)
  finishBattle(h);
});

test('Crevice Lurker: R121 — outside battle the same activation costs its printed [1]', () => {
  const h = new Harness(1621);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Crevice Lurker');
  const auric = spawn(h, p, 'Auric Ascendant');
  giveResources(h, p, 'water', 1);
  h.do({ type: 'activateAbility', seat: p, entityId: auric, abilityIndex: 0 });
  assert.equal(openMana(h, p), 0, 'exactly the printed [1] — deployment is untaxed');
  // the recall resolves immediately in deployment; the Lurker is the one
  // other ally, so answer the recall pick if it is asked rather than auto-taken
  if (h.state.decision) h.do({ type: 'decide', seat: p, choice: 0 });
});

test('Crevice Lurker: R121 — a taxed trigger ASKS its controller, and paying [1] puts it on the stack', () => {
  const h = new Harness(1622);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const titan = spawn(h, A, 'Pestilent Titan');       // "When I attack/block, [once] plague"
  const lurker = spawn(h, D, 'Crevice Lurker');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  const dec = h.state.decision;
  assert.ok(dec && dec.kind === 'payOrDecline' && dec.seat === A,
    'the trigger controller is asked to pay — the engine never decides for the player');
  pick(h, true);                                      // pay [1]
  assert.equal(openMana(h, A), 0, 'the tax was paid');
  pass(h); pass(h);                                   // the trigger resolves off the stack
  assert.equal(h.state.players[A]!.rot, 1, "the Titan's plague went through");
  assert.equal(h.state.players[D]!.rot, 1, 'both present players got a rot');
  assert.equal(ent(h, lurker)!.counters, -1, 'each unit in the region got a -1/-1 counter');
  finishBattle(h);
});

test('Crevice Lurker: R121 — declining prevents the trigger and does NOT spend its [once] (R108/R113)', () => {
  // The [once] proof needs a bounded trigger that can fire TWICE in one
  // battle — an attack/block trigger gets one event per battle, so the pair
  // here is Astral Painseeker ("When a player loses life during battle,
  // [Switch1] Draw a card") fed by Blob of the Dark Order's unbounded
  // "Pay 1 life:" activation. Note the Blob activations are themselves taxed
  // [1] each (mana), on top of their printed life cost.
  const h = new Harness(1623);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lurker = spawn(h, A, 'Crevice Lurker');
  const seeker = spawn(h, D, 'Astral Painseeker');
  const blob = spawn(h, D, 'Blob of the Dark Order');
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lurker]] });   // the tax walks in with the Lurker
  pass(h);                                            // priority → D
  const hand0 = h.state.players[D]!.hand.length;
  h.do({ type: 'activateAbility', seat: D, entityId: blob, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision?.kind, 'payOrDecline',
    "the life loss queued the Painseeker draw — its controller is asked");
  pick(h, false);                                     // decline — the draw does not happen
  assert.equal(h.state.players[D]!.hand.length, hand0, 'prevented: no draw');
  assert.ok(!('ability:Astral Painseeker#0' in ent(h, seeker)!.budgets),
    'the declined trigger kept its [Switch1] (R108/R113)');
  pass(h);                                            // A passes; D responds with a second activation
  h.do({ type: 'activateAbility', seat: D, entityId: blob, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision?.kind, 'payOrDecline',
    'the SAME [Switch1] asks again the same turn — the budget really was kept');
  pick(h, true);                                      // pay this time
  assert.equal(openMana(h, D), 0, 'two taxed activations + the trigger tax = all [3] spent');
  while (h.state.stack.length) { pass(h); }           // resolve the draw and both Blob activations
  assert.equal(h.state.players[D]!.hand.length, hand0 + 1, 'paid: the draw resolves');
  assert.equal(ent(h, seeker)!.budgets['ability:Astral Painseeker#0'], 1,
    'paying SPENDS the [Switch1] (R113: put on the stack = spent, resolve or not)');
  finishBattle(h);
});

test('Crevice Lurker: R121 — zero open mana: the trigger is prevented with a log line and no prompt', () => {
  const h = new Harness(1624);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const titan = spawn(h, A, 'Pestilent Titan');
  spawn(h, D, 'Crevice Lurker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  assert.equal(h.state.decision, null, 'no legal way to pay — no question is asked');
  assert.ok(h.log.some(l => l.includes('prevented') && l.includes('Crevice Lurker')),
    `the prevention is announced in the log; got:\n${h.log.slice(-6).join('\n')}`);
  assert.ok(!('ability:Pestilent Titan#0' in ent(h, titan)!.budgets),
    'no offer could be made at all — the [once] is kept (R113)');
  finishBattle(h);
  assert.equal(h.state.players[A]!.rot, 0, 'the plague never happened');
});

test('Crevice Lurker: R121 — applying an augment during battle is NOT taxed (R37: a mod is not an activation)', () => {
  const h = new Harness(1625);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lurker = spawn(h, A, 'Crevice Lurker');
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'metal', 3);                    // Soul Reaver: mm / 3, a {Virus}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lurker]] });
  pass(h);                                            // priority → D
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Soul Reaver'), hostId: host });
  assert.equal(openMana(h, D), 0, 'exactly the printed [3] — the tax does not touch a mod application');
  pass(h); pass(h);                                   // the Virus item resolves off the stack (R79)
  assert.equal(ent(h, host)!.mods.length, 1);
  finishBattle(h);
});

test("Crevice Lurker: R121 — donated as an augment, the HOST's region carries the tax", () => {
  const h = new Harness(1626);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const titan = spawn(h, A, 'Pestilent Titan');
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'earth', 2);                    // ee / 2 to donate the Lurker
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Crevice Lurker'), hostId: host });
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'the mod radiates the tax from its host');
  pick(h, true);
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.rot, 1);
  finishBattle(h);
});

test('Crevice Lurker: R121 — two Lurkers compound: CostMod deltas SUM, so the tax is +2', () => {
  const h = new Harness(1627);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const l1 = spawn(h, A, 'Crevice Lurker');
  const l2 = spawn(h, A, 'Crevice Lurker');
  const auric = spawn(h, D, 'Auric Ascendant');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[l1], [l2]] });
  pass(h);
  const offers = () => h.legal(D).filter(a => a.type === 'activateAbility' && a.entityId === auric);
  assert.equal(offers().length, 0, '[1] + 2 tax = [3]; with [2] open it is not offered');
  giveResources(h, D, 'water', 1);
  assert.equal(offers().length, 1);
  h.do({ type: 'activateAbility', seat: D, entityId: auric, abilityIndex: 0 });
  assert.equal(openMana(h, D), 0, 'paid [3]');
  pass(h); pass(h);
  finishBattle(h);
});

test('Crevice Lurker: R121 — the pending pay-decision survives a JSON round-trip and keeps driving', () => {
  const h = new Harness(1628);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const titan = spawn(h, A, 'Pestilent Titan');
  spawn(h, D, 'Crevice Lurker');
  giveResources(h, A, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  const round = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  assert.equal(round.suspension && (round.suspension as { type: string }).type, 'payTrigger',
    'the gate is a serializable suspension');
  assert.deepEqual(round.decision, h.state.decision, 'the question round-trips');
  h.state = round;
  pick(h, true);                                      // …and the revived state still drives
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.rot, 1);
  void titan;
  finishBattle(h);
});

test('Deathglow Strider: after combat, deals its defense to each opponent', () => {
  const h = new Harness(1605);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const strider = spawn(h, A, 'Deathglow Strider');   // 2/3
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[strider]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, lifeD - 5, '2 combat (unblocked) + 3 (my defense) after combat');
  assert.equal(h.state.players[A]!.life, lifeA, 'controller untouched ("each opponent")');
});

test('Earth Resource: registered printed-data-only (resource face, not a deck card)', () => {
  const c = getCard('Earth Resource');
  assert.equal(c.mana, 0);
  assert.deepEqual([c.power, c.toughness], [2, 0]);
  assert.match(c.type, /Earth Resource/);
});

test('Earth Resource: activating your 3rd earth pays the p.18 affinity Shard, every time', () => {
  // Until 2026-08-23 this card had NO test at all — its ledger entry was
  // `unverified: true` and a batch-header comment was the only thing that ever
  // mentioned it, which is precisely the Harbinger shape. The entry claimed
  // the printed clause was dead, waiting on "the resource-CARD model and a
  // dispatched activation event". It was not dead. "When I activate, if you
  // have at least [e][e][e], create a Shard. {i}(It spawns dormant.)" is the
  // Manual p.18 GENERAL RULE reprinted on the card as reminder text, and it is
  // implemented in apply.ts::maybeGrantShard for all seven elements — see the
  // conformance sweep in 12-fire-a, which exists so nobody "implements" it
  // onto the three printed Resource faces and drops the other four. R116, R54.
  const h = new Harness(1621);
  giveResources(h, 0, 'earth', 2, 'open');
  giveResources(h, 0, 'earth', 1, 'dormant');
  const dormant = (): number =>
    h.state.players[0]!.resources.findIndex(r => r.kind === 'earth' && r.state === 'dormant');
  const shards = (): { state: string }[] => h.state.players[0]!.resources.filter(r => r.kind === 'shard');

  h.do({ type: 'activateResource', seat: 0, index: dormant() });
  assert.equal(shards().length, 1, 'at [e][e][e], a Shard');
  assert.equal(shards()[0]!.state, 'dormant', '"(It spawns dormant.)"');
  assert.equal(h.q.affinity(0, 'earth'), 3, 'R54: the Shard adds no earth affinity of its own');

  giveResources(h, 0, 'earth', 1, 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: dormant() });
  assert.equal(shards().length, 2, 'Caleb, once or every time: "Every time"');
});

test('Earth Resource: two open earth is not [e][e][e] — no Shard', () => {
  const h = new Harness(1622);
  giveResources(h, 0, 'earth', 1, 'open');
  giveResources(h, 0, 'earth', 1, 'dormant');
  const i = h.state.players[0]!.resources.findIndex(r => r.kind === 'earth' && r.state === 'dormant');
  h.do({ type: 'activateResource', seat: 0, index: i });
  assert.equal(h.q.affinity(0, 'earth'), 2);
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 0);
});

test('Eminence of the Barrens: dealt damage → may pay [one] to fight another target unit (R6)', () => {
  const h = new Harness(1607);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');              // 1/1 — pokes the Eminence
  const bubbA = spawn(h, A, 'Bubb');                  // 5/6 — the fight victim
  const emin = spawn(h, D, 'Eminence of the Barrens');// 6/8
  giveResources(h, D, 'earth', 1);                    // the [one]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok], [bubbA]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [emin] } });
  pass(h); pass(h);   // combat: tok deals 1 to Eminence → trigger resolves at once
  pick(h, { unit: bubbA });                           // trigger target: "another target unit"
  pick(h, true);                                      // pay [one] → the fight happens
  assert.ok(!ent(h, bubbA), 'Bubb died to the 6-power fight');
  assert.equal(ent(h, emin)!.damage, 6, '1 combat + 5 from the fight');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'expended').length, 1, 'the [one] was paid');
  // "whenever": the fight's 5 damage re-triggered the ability — but R64 makes
  // "ANOTHER target unit" a real restriction, so with only the Eminence left
  // there is nothing legal to aim at and the trigger says so instead of
  // offering a target it would then refuse.
  assert.equal(h.state.decision, null, 'no self-target is offered');
  assert.ok(h.log.some(m => m.includes('no legal target')), 'and it says why nothing happened');
  finishBattle(h);
});

test("Enigmatic Warder: [two] activated ([Augment] text, via: 'augment') redirects a spell target to itself", () => {
  const h = new Harness(1608);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 — the Boon's intended target
  const warder = spawn(h, D, 'Enigmatic Warder');     // 1/2
  giveResources(h, A, 'fire', 2);                     // Channeled Boon rr/2
  giveResources(h, D, 'earth', 2);                    // the [two]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const boonId = h.state.stack[0]!.id;
  h.do({ type: 'activateAbility', seat: D, entityId: warder, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: boonId });
  pass(h); pass(h);                                   // Warder resolves: the Boon now targets it
  pass(h); pass(h);                                   // Boon resolves on the new target
  assert.deepEqual(effStats(h, warder), [5, 6], 'the Warder stole the +4/+4');
  assert.deepEqual(effStats(h, atk), [1, 1], 'the original target got nothing');
  finishBattle(h);
});

test('Fight: BOTH units are cast-time targets, ally first (R58)', () => {
  const h = new Harness(1609);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 attacker
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6 — the ally
  giveResources(h, D, 'earth', 1);                    // e / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  // slot 0 is 'allyUnit' — only D's own units are offered
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [{ unit: bubbD }],
    'the ally slot offers allies of the CASTER only');
  pick(h, { unit: bubbD });
  // slot 1 is 'unit' — any OTHER unit in the region, so the attacker appears
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [{ unit: atk }],
    'the second slot offers the other units, and never the ally again');
  pick(h, { unit: atk });
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), 'the 1/1 died to Bubb');
  assert.equal(ent(h, bubbD)!.damage, 1, 'Bubb took 1 back');
  finishBattle(h);
});

test('Flowstone Arcanite: column deals combat damage → +1/+1 counter on each of your units (once/turn)', () => {
  // unblocked: connects to the player (the lifeLost channel); the ally's
  // later hit does NOT double-fire ([Switch1] budget, R9)
  const h = new Harness(1610);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const flow = spawn(h, A, 'Flowstone Arcanite');     // 1/3 {Swift}
  const tok = spawn(h, A, 'Unit Token');              // 1/1 ally attacker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[flow], [tok]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(ent(h, flow)!.counters, 1, 'Flowstone got exactly one counter (bounded)');
  assert.equal(ent(h, tok)!.counters, 1, 'each of your units, ally included');

  // blocked: combat damage to a unit (the damage channel)
  const h2 = new Harness(1620);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const flow2 = spawn(h2, A2, 'Flowstone Arcanite');
  const blk = spawn(h2, D2, 'Unit Token');            // 1/1 blocker
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[flow2]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [blk] } });
  finishBattle(h2);
  assert.ok(!ent(h2, blk), 'the blocker died to the Swift hit');
  assert.equal(ent(h2, flow2)!.counters, 1, 'damage to the blocker triggered the counter');
});

test('Graxxlid: [once][one] negates an effect targeting it; that controller draws; once per turn', () => {
  const h = new Harness(1611);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const grax = spawn(h, D, 'Graxxlid');               // 2/3
  giveResources(h, A, 'fire', 2);                     // Channeled Boon rr/2
  giveResources(h, D, 'earth', 2);                    // [one] with one to spare
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: grax });                            // the Boon targets Graxxlid
  const boonId = h.state.stack[0]!.id;
  const handA = h.state.players[A]!.hand.length;
  h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: boonId });
  pass(h); pass(h);                                   // Graxxlid resolves
  assert.ok(!h.state.stack.some(i => i.id === boonId), 'R68: the negated Boon left the stack');
  assert.ok(h.state.players[A]!.bin.includes('Channeled Boon'), 'and went to its bin');
  assert.equal(h.state.players[A]!.hand.length, handA + 1, "the Boon's controller drew a card");
  assert.deepEqual(effStats(h, grax), [2, 3], 'no buff landed');
  pass(h);                                            // priority → D
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' }),
    /already used/, '[once]: spent for the turn (R9)');
  finishBattle(h);
});

/* Report #70 (GETD, 2026-08-22): "Graxxlid is lighting up like I can activate
 * its ability despite there being no legal targets on the stack". The empty
 * stack was already covered (58-playtest-round9); the reported case is the
 * harder one — a stack with plenty on it, none of it aimed at Graxxlid. R64's
 * `restrict` is what makes those two the same question. */
test('Graxxlid (report #70): a stack item that does NOT target me is not a legal target, so the ability is not offered', () => {
  const h = new Harness(1613);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const grax = spawn(h, D, 'Graxxlid');               // 2/3
  giveResources(h, A, 'fire', 4);                     // two Channeled Boons, rr/2 each
  giveResources(h, D, 'earth', 2);                    // [one], with one to spare
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });                             // aimed at A's OWN attacker
  assert.equal(h.state.stack.length, 1, 'the stack is not empty…');
  assert.ok(!legalActions(h.state, D).some(a =>
    a.type === 'activateAbility' && a.entityId === grax),
    '…but nothing on it targets Graxxlid, so the activation is not offered');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' }),
    /nothing it can be used on/, 'and it is refused if asked for anyway');
  // …and the moment something DOES aim at it, the same ability is on the menu
  pass(h);                                            // priority → A
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: grax });
  assert.ok(legalActions(h.state, D).some(a =>
    a.type === 'activateAbility' && a.entityId === grax),
    'an effect targeting Graxxlid puts the activation back on the menu');
  const boonAtGrax = h.state.stack[h.state.stack.length - 1]!.id;
  h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' });
  assert.deepEqual(offered(h), [JSON.stringify({ stack: boonAtGrax })],
    'and the menu offers exactly the one item aimed at me — not the other Boon');
  pick(h, { stack: boonAtGrax });
  finishBattle(h);
});

/* Caleb, rules-questions: "You can redirect a virus, it is a targeted effect",
 * and to "so you could Graxxlid or Boon of Protection it as well?" — "Yep!
 * They're fully interactible." A virus carries no target refs (apply.ts builds
 * it with `parts: []` and a `hostId`), so the target-ref read alone missed it. */
test('Graxxlid: a Virus being applied to me IS an effect targeting me', () => {
  const h = new Harness(1614);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const grax = spawn(h, D, 'Graxxlid');               // 2/3
  giveResources(h, A, 'earth', 2);                    // Crumbling Ancient, e/2 {Virus}
  giveResources(h, D, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const handA = h.state.players[A]!.hand.length;
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Crumbling Ancient'), hostId: grax });
  const virus = h.state.stack[h.state.stack.length - 1]!.id;
  assert.ok(legalActions(h.state, D).some(a =>
    a.type === 'activateAbility' && a.entityId === grax),
    'the virus aimed at Graxxlid is a legal target for it');
  h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: virus });
  pass(h); pass(h);                                   // Graxxlid resolves
  assert.ok(!h.state.stack.some(i => i.id === virus), 'R68: the negated virus left the stack');
  assert.equal(h.state.players[A]!.hand.length, handA + 1, "the virus's controller drew a card");
  assert.ok(!ent(h, grax)!.mods.some(m => ent(h, m)?.card === 'Crumbling Ancient'),
    'and {Vulnerable} never landed on Graxxlid');
  finishBattle(h);
});

test('Haboob: deals 1 damage to each unit in the battle region (both sides)', () => {
  const h = new Harness(1612);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 — dies to the sweep
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6 — takes 1
  giveResources(h, D, 'earth', 4);                    // ee / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haboob') });
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), "the caster's own sweep killed the 1/1 attacker");
  assert.equal(ent(h, bubbD)!.damage, 1, "the caster's Bubb was hit too (each unit)");
  finishBattle(h);
});

test('Hooba-Lan: attacking creates a real dormant Shard for its controller', () => {
  // Was TODO while there was no Shard primitive; E.createShard exists now, so
  // the payload is live. The Shard is dormant and gives mana only — see
  // 48-playtest-hotfix for what separates it from a prismite.
  const h = new Harness(1613);
  toDeployment(h);
  const A = h.state.initiative;
  const hooba = spawn(h, A, 'Hooba-Lan');             // 3/4
  const before = h.state.players[A]!.resources.length;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pass(h); pass(h);                                   // resolve the trigger
  const made = h.state.players[A]!.resources.slice(before);
  assert.equal(made.length, 1, 'exactly one Shard per attack');
  assert.equal(made[0]!.kind, 'shard');
  assert.equal(made[0]!.state, 'dormant', 'printed "(It will spawn dormant.)"');
  finishBattle(h);
});

test('Lithoghul: dealt damage → deals that much damage to its controller', () => {
  const h = new Harness(1614);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1
  const lith = spawn(h, D, 'Lithoghul');              // 4/4
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [lith] } });
  pass(h); pass(h);   // combat → trigger resolves at once (R3 sub-step drain)
  assert.ok(!ent(h, atk), 'the attacker died to the 4-power block');
  assert.equal(ent(h, lith)!.damage, 1, 'Lithoghul took 1 combat damage (pre-regroup)');
  assert.equal(h.state.players[D]!.life, lifeD - 1, 'its controller took the mirrored 1');
  assert.equal(h.state.players[A]!.life, lifeA, 'the attacker took nothing (blocked)');
  finishBattle(h);
});
