/* Per-card tests for batch-wood-b (project rule: a test for every card).
 * Covers the attack-trigger Poison mint (Megadeath), the counting until-
 * regroup buffs (Might of the Grove, Overbloom), the give-control choose
 * (Mindspore Fiend, R6), the token-creation trigger (Mycelial Mentor —
 * unit-token channel; the spell-token channel is an engine gap, see the
 * batch header), -1/-1 counter effects (Noxious Deathcap, Noxious Demise
 * with its hand-rolled Reaping rider, Plague Bellower), the control/position
 * exchange (Organic Exchange), activated [Augment] text via 'augment' and
 * via {mod} (Pack Leader), the spawn/despawn token lifecycle (Pathogenic
 * Enclave), a team-wide temp buff (Pernicious Photosynthesis), the counter-
 * punisher (Pestilent Mycelion, fed by its own Poisonous combat damage),
 * a statics-only augment (Prickly Protector), and the R98 until-regroup
 * damage-prevention shield (Phytochemical Protection). States are built explicitly
 * (give/spawn/giveResources). Seeds 2400-2499. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import {
  assignDefault, effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
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
  h.state = e.s;   // a mid-resolution suspension re-points e.s (structuredClone)
}

test('Megadeath: attacks → creates a Poison 5 in the battle region ([Switch1])', () => {
  const h = new Harness(2400);
  toDeployment(h);
  const A = h.state.initiative;
  const mega = spawn(h, A, 'Megadeath');              // 5/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  pass(h); pass(h);                                   // resolve the trigger
  const poisons = tokensOf(h, A).filter(t => t.card === 'Poison');
  assert.equal(poisons.length, 1, 'one Poison token created');
  assert.equal(poisons[0]!.x, 5, 'it is a Poison 5');
  assert.equal(poisons[0]!.region, h.state.battle!.region, 'spell tokens appear where the effect resolves');
  finishBattle(h);
});

test('Might of the Grove: target unit gains +1/+1 per your units, live at resolution; cleared at regroup', () => {
  const h = new Harness(2401);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 attacker
  const u1 = spawn(h, D, 'Unit Token');
  const u2 = spawn(h, D, 'Unit Token');               // D controls 2 units at home
  giveResources(h, D, 'wood', 2);                     // g / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Might of the Grove') });
  pick(h, { unit: u1 });
  pass(h); pass(h);                                   // resolve
  assert.deepEqual(effStats(h, u1), [3, 3], '1/1 + (+2/+2: D has 2 units in the region)');
  assert.deepEqual(effStats(h, u2), [1, 1], 'only the target is buffed');
  finishBattle(h);
  assert.deepEqual(effStats(h, u1), [1, 1], 'until regroup: the buff is gone');
});

test('Mindspore Fiend: after combat, may give an opponent control of target ally → draw (R6)', () => {
  const h = new Harness(2402);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 — attacks so combat happens
  const fiend = spawn(h, D, 'Mindspore Fiend');       // 1/1, defender side (in the battle region)
  const gift = spawn(h, D, 'Unit Token');             // the ally D gives away
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  // combat → afterCombat: the trigger goes on the stack and asks for its target
  pick(h, { unit: gift });
  const handD = h.state.players[D]!.hand.length;
  pass(h); pass(h);                                   // resolve → pay-or-decline
  pick(h, true);                                      // give control
  assert.equal(ent(h, gift)!.controller, A, 'the opponent gained control of the ally');
  assert.equal(h.state.players[D]!.hand.length, handD + 1, '"if you do, draw a card"');
  finishBattle(h);
  assert.ok(unitsOf(h, A).some(u => u.id === gift), 'at regroup the unit went home with its NEW controller');
});

test('Mycelial Mentor: a unit token is created → target ally gains +3/+3 (once per turn)', () => {
  const h = new Harness(2403);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mentor = spawn(h, p, 'Mycelial Mentor');      // 2/1
  // Pathogenic Enclave's spawn mints two 1/1 unit tokens → the Mentor hears
  // the FIRST one ([Switch1]: the second is inside the same turn's budget)
  whiteBox(h, e => { e.spawnUnit(p, 'Pathogenic Enclave', e.homeRegion(p)); e.settle(); });
  pick(h, { unit: mentor });                          // target ally: the Mentor itself
  assert.deepEqual(effStats(h, mentor), [5, 4], '2/1 + 3/3 — exactly one firing (bounded, R9)');
  assert.equal(unitsOf(h, p).filter(u => u.token).length, 2, 'both tokens were still created');
});

test('Noxious Deathcap: dies in combat → a -1/-1 counter on each unit in the region', () => {
  const h = new Harness(2404);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const cap = spawn(h, A, 'Noxious Deathcap');        // 4/2
  const bubb = spawn(h, D, 'Bubb');                   // 5/6 blocker
  const home = spawn(h, A, 'Unit Token');             // stays home — other region, untouched
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[cap]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);   // combat: the Deathcap dies to Bubb's 5 → trigger resolves at once
  assert.ok(!ent(h, cap), 'the Deathcap died');
  assert.ok(h.state.players[A]!.bin.includes('Noxious Deathcap'), '→ bin');
  assert.equal(ent(h, bubb)!.counters, -1, 'each unit in the region got a -1/-1 counter');
  assert.equal(ent(h, home)!.counters, 0, 'units in other regions are untouched (R12)');
  finishBattle(h);
});

test('Noxious Demise: -1/-1 counter kills the 1/1 → Reaping draws (hand-rolled rider)', () => {
  const h = new Harness(2405);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 — the counter is lethal
  giveResources(h, D, 'wood', 2);                     // gg / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  const handD = h.state.players[D]!.hand.length;
  pick(h, { unit: atk });
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), 'the 1/1 died to the -1/-1 counter');
  assert.equal(h.state.players[D]!.hand.length, handD + 1, 'Reaping: the caster drew');
  finishBattle(h);
});

test('Organic Exchange: control swaps and the attack slot passes to the exchanged unit', () => {
  const h = new Harness(2406);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const bubb = spawn(h, A, 'Bubb');                   // 5/6 — A's attacker
  const dtok = spawn(h, D, 'Unit Token');             // 1/1 — D's unit, not in any formation
  giveResources(h, D, 'wood', 3);                     // gg / 3
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Organic Exchange') });
  pick(h, { unit: bubb });                            // first target (at cast)
  pick(h, { unit: dtok });                            // second target (count: 2)
  pass(h); pass(h);                                   // resolve
  assert.equal(ent(h, bubb)!.controller, D, 'Bubb changed sides');
  assert.equal(ent(h, dtok)!.controller, A, 'the 1/1 changed sides');
  assert.deepEqual(h.state.battle!.columns[0], [dtok], 'the 1/1 took Bubb\'s attack slot');
  pass(h); pass(h);                                   // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, lifeD - 1, 'the swapped-in 1/1 connected for 1 (not Bubb\'s 5)');
  assert.ok(unitsOf(h, D).some(u => u.id === bubb), 'regroup: Bubb went home with D');
  assert.ok(unitsOf(h, A).some(u => u.id === dtok), 'regroup: the 1/1 went home with A');
});

test('Overbloom: target unit gains +7/+7 until regroup (deploy timing)', () => {
  const h = new Harness(2407);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const tok = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'wood', 2);                     // g / 2
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Overbloom') });
  pick(h, { unit: tok });
  assert.deepEqual(effStats(h, tok), [8, 8], '1/1 + 7/7');
  toNextBattle(h);
  finishBattle(h);
  assert.deepEqual(effStats(h, tok), [1, 1], 'until regroup: the buff is gone');
});

test("Pack Leader: [two] creates a 1/1 where the carrier stands — own text (via: 'augment') and donated (via: {mod})", () => {
  const h = new Harness(2408);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const leader = spawn(h, p, 'Pack Leader');          // 4/4
  giveResources(h, p, 'wood', 2);                     // the [two]
  h.do({ type: 'activateAbility', seat: p, entityId: leader, abilityIndex: 0, via: 'augment' });
  assert.equal(unitsOf(h, p).filter(u => u.token).length, 1, 'a 1/1 token was created');
  assert.deepEqual(unitsOf(h, p).find(u => u.token)!.tokenStats, [1, 1], 'it is a 1/1');
  // donated: augment a host with a second Pack Leader, activate through the mod
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'wood', 8);                     // gg/6 for the augment + the [two]
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Pack Leader'), hostId: host });
  h.do({ type: 'activateAbility', seat: p, entityId: host, abilityIndex: 0, via: { mod: ent(h, host)!.mods[0]! } });
  assert.equal(unitsOf(h, p).filter(u => u.token && u.id !== host).length, 2, 'the donated ability minted another 1/1');
});

test('Pathogenic Enclave: spawn mints two 1/1s (at ctx.region — home, since it spawns during deployment, R115); despawn deletes token allies in its region', () => {
  const h = new Harness(2409);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const enc = spawn(h, A, 'Pathogenic Enclave');      // 2/3 — spawn trigger fires
  const toks = unitsOf(h, A).filter(u => u.token);
  assert.equal(toks.length, 2, 'two 1/1 unit tokens created on spawn');
  const bubb = spawn(h, D, 'Bubb');                   // 5/6 — kills the Enclave
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[enc], [toks[0]!.id], [toks[1]!.id]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);   // combat: Enclave dies → its own [Augment] text deletes token allies here
  assert.ok(!ent(h, enc), 'the Enclave died');
  assert.ok(!ent(h, toks[0]!.id) && !ent(h, toks[1]!.id), 'both token allies in the region were deleted');
  finishBattle(h);
});

test('Pernicious Photosynthesis: your units gain +2/+2 and Piercing until regroup', () => {
  const h = new Harness(2410);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u1 = spawn(h, p, 'Unit Token');
  const u2 = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'wood', 4);                     // gg / 4
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Pernicious Photosynthesis') });
  for (const u of [u1, u2]) {
    assert.deepEqual(effStats(h, u), [3, 3], '1/1 + 2/2');
    assert.ok(ownAttrs(h, u).has('Piercing'), 'gained Piercing');
  }
  toNextBattle(h);
  finishBattle(h);
  assert.deepEqual(effStats(h, u1), [1, 1], 'until regroup: stats cleared');
  assert.ok(!ownAttrs(h, u1).has('Piercing'), 'until regroup: attr cleared');
});

test('Pestilent Mycelion: its Poisonous block lands a -1/-1 counter → each opponent loses 1', () => {
  const h = new Harness(2411);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1
  const myc = spawn(h, D, 'Pestilent Mycelion');      // 1/3 {Poisonous}
  toNextBattle(h, A);
  const lifeA = h.state.players[A]!.life;
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [myc] } });
  pass(h); pass(h);   // combat: Poisonous damage = a -1/-1 counter → the trigger fires
  assert.ok(!ent(h, atk), 'the 1/1 died to the -1/-1 counter');
  assert.equal(h.state.players[A]!.life, lifeA - 1, 'each opponent (A) lost 1 life');
  assert.equal(h.state.players[D]!.life, lifeD, 'its own controller is untouched');
  assert.equal(ent(h, myc)!.damage, 1, 'the Mycelion took the 1 back');
  finishBattle(h);
});

/** R98: put the shield up white-box (the spell itself is played end-to-end in
 * the first test) and return the log lines a burst of effect damage produces. */
function shield(h: Harness, id: number): void {
  whiteBox(h, e => { e.entity(id)!.damageShield = 'Phytochemical Protection'; });
}
function zap(h: Harness, from: Seat, id: number, n: number, attrs?: string[]): string[] {
  const e = new E(h.state);
  const before = e.events.length;
  e.dealEffectDamage({
    controller: from, sourceName: 'Fireball', region: e.entity(id)!.region,
    targets: [], event: null, choose: () => undefined,
    ...(attrs ? { grantedAttrs: attrs } : {}),
  } as never, e.entity(id)!, n);
  e.settle();
  h.state = e.s;
  return e.events.slice(before).map(ev => ev.msg);
}

test('Phytochemical Protection: combat damage is prevented and paid back as +1/+1 counters', () => {
  // R98, report #72 (GETD): "Phytochemical Protection is entirely non
  // functional. Needs to work like the text says."
  const h = new Harness(2412);
  assert.equal(getCard('Phytochemical Protection').kind, 'spell', 'registered');
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');              // 7/5
  const mine = spawn(h, D, 'Good Whale');             // 7/5 — 5 damage is lethal to it
  giveResources(h, D, 'wood', 2);                     // gg / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: mine });
  pass(h); pass(h);                                   // resolve the shield
  assert.equal(ent(h, mine)!.damageShield, 'Phytochemical Protection', 'the shield is up');
  pass(h); pass(h);                                   // close the attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [mine] } });
  pass(h); pass(h);                                   // combat damage
  const blocker = ent(h, mine);
  assert.ok(blocker, 'it survived a hit that was lethal twice over — all of it was prevented');
  assert.equal(blocker!.damage, 0, 'no damage was marked');
  assert.equal(blocker!.counters, 5, 'a +1/+1 counter for each damage prevented');
  assert.ok(!ent(h, atk), 'the attacker still took its 7 back and died');
  finishBattle(h);
});

test('Phytochemical Protection: the whole hit is prevented, not just the lethal part', () => {
  // The RAQ, and now R114 in the engine:
  //   "Q: No Deadly, No Piercing. Single enemy with Phytochemical Protection?
  //    A: All damage must be assigned to this single unit and whole damage
  //       will be prevented, potentially putting a lot of +/+ counters."
  // The engine used to cap the assignment at lethal and drop the rest, which
  // paid 1 counter here. A NON-Piercing attacker is the whole point of the
  // question, so the attacker is a plain 7-power body.
  const h = new Harness(2426);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Life Plant');              // 7/3, no attributes
  const mine = spawn(h, D, 'Unit Token');             // 1/1
  toNextBattle(h, A);
  shield(h, mine);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [mine] } });
  pass(h); pass(h);
  assert.ok(ent(h, mine), 'the shielded 1/1 survived a hit seven times lethal');
  assert.equal(ent(h, mine)!.counters, 7,
    'all 7 were dealt to it and all 7 were prevented — a counter for each');
});

test('Phytochemical Protection: a 2-power {Deadly} column into a shielded 7/3 pays 2 counters (report #79, EGCW 212)', () => {
  // The exact table situation. {Deadly}'s 1 is a PASS-ALONG floor (R114), so
  // the whole 2 lands on the sole blocker; the shield prevents all of it, and
  // R98 then stops {Deadly} from killing through damage that was never dealt.
  const h = new Harness(2427);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const d1 = spawn(h, A, 'Tidepool Terror');          // 1/2 {Deadly}
  const d2 = spawn(h, A, 'Tidepool Terror');          // 1/2 {Deadly} — 2 power
  const mine = spawn(h, D, 'Life Plant');             // 7/3 blocker
  toNextBattle(h, A);
  shield(h, mine);
  h.do({ type: 'declareAttack', seat: A, columns: [[d1, d2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [mine] } });
  pass(h); pass(h);
  // R120: the 7-power BLOCK-side strike over the two 1/2s is now elective;
  // this test is about the shield paying the Deadly floors, so take the default
  assignDefault(h);
  assert.ok(ent(h, mine), 'nothing was dealt, so {Deadly} had nothing to kill through (R98)');
  assert.equal(ent(h, mine)!.counters, 2,
    'the whole 2-power column was assigned and prevented — 2 counters, not the 1 {Deadly} needs');
  finishBattle(h);
});

test('Phytochemical Protection: prevented damage is NOT dealt — no damage event fires', () => {
  // RAQ "[Solved] Poisonous vs 'Whenever I am dealt damage' vs Phytochemical
  // Protection": "Jollyglop doesn't trigger". Prevention unmakes the damage,
  // unlike R38's replacements ("replacing the damage does NOT unmake it").
  const h = new Harness(2422);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const u = spawn(h, D, 'Good Whale');
  shield(h, u);
  const said = zap(h, A, u, 3);
  assert.ok(!said.some(m => m.includes('Fireball deals')), 'no damage was dealt');
  assert.ok(said.some(m => m.includes('prevents all 3 damage')), 'and the log says why');
  assert.equal(ent(h, u)!.damage, 0);
  assert.equal(ent(h, u)!.counters, 3, '+1/+1 per damage prevented, from effect damage too');
});

test('Phytochemical Protection: Poisonous does not bypass it, and lays no -1/-1 counters', () => {
  // RAQ, verbatim: "Does Poisonous bypass Phytochemical Protection? No it
  // doesn't. … if there is not damage being dealt, then no counters are
  // placed." The victim ends UP counters, not down.
  const h = new Harness(2423);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const u = spawn(h, D, 'Good Whale');
  shield(h, u);
  zap(h, A, u, 2, ['Poisonous']);
  assert.equal(ent(h, u)!.counters, 2, '+2, not -2 — the Poisonous damage was never dealt');
});

test('Phytochemical Protection: {Deadly} cannot kill through it', () => {
  // The RAQ line is "Atleast 1 dmg to Awoken (gets +1/+1, won't create 1/1
  // unit)". Deadly kills through DAMAGE DEALT; the shield leaves none.
  const h = new Harness(2424);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const killer = spawn(h, A, 'Unit Token');
  whiteBox(h, e => { e.entity(killer)!.tempAttrs = ['Deadly']; });
  const mine = spawn(h, D, 'Good Whale');             // 7/5
  toNextBattle(h, A);
  shield(h, mine);
  h.do({ type: 'declareAttack', seat: A, columns: [[killer]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [mine] } });
  pass(h); pass(h);                                   // combat damage
  assert.ok(ent(h, mine), 'a Deadly hit that dealt no damage kills nothing');
  assert.equal(ent(h, mine)!.counters, 1, 'and the 1 assigned point is still paid back');
  finishBattle(h);
});

test('Phytochemical Protection: the shield lasts UNTIL REGROUP and no longer', () => {
  const h = new Harness(2425);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  shield(h, mine);
  finishBattle(h);
  assert.equal(ent(h, mine)!.damageShield, undefined, 'swept by the R11 regroup cleanup');
  zap(h, A, mine, 2);
  assert.equal(ent(h, mine)!.damage, 2, 'damage lands again after regroup');
});

test('Plague Bellower: [three] — each opponent picks a unit; a -1/-1 counter on each', () => {
  const h = new Harness(2413);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Bubb');                     // two A units → a real choice
  const bell = spawn(h, D, 'Plague Bellower');        // 2/2
  giveResources(h, D, 'wood', 3);                     // the [three]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);                                            // priority → D
  h.do({ type: 'activateAbility', seat: D, entityId: bell, abilityIndex: 0, via: 'augment' });
  pass(h); pass(h);                                   // resolve → A's pick
  pick(h, a2);                                        // A chooses Bubb
  assert.equal(ent(h, a2)!.counters, -1, 'the chosen unit got a -1/-1 counter');
  assert.equal(ent(h, a1)!.counters, 0, 'the unchosen unit is untouched');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'expended').length, 3, 'the [three] was paid');
  finishBattle(h);
});

test('Prickly Protector: +1/+1 per other ally — live count, played normally and as an augment', () => {
  const h = new Harness(2414);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const prick = spawn(h, p, 'Prickly Protector');     // 0/1
  assert.deepEqual(effStats(h, prick), [0, 1], 'alone: no other allies');
  const t1 = spawn(h, p, 'Unit Token');
  const t2 = spawn(h, p, 'Unit Token');
  assert.deepEqual(effStats(h, prick), [2, 3], 'two other allies: +2/+2');
  giveResources(h, p, 'wood', 1);                     // g / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Prickly Protector'), hostId: t1 });
  assert.deepEqual(effStats(h, t1), [3, 3], 'host 1/1 + (+2/+2: prick and t2 are its other allies)');
  assert.deepEqual(effStats(h, t2), [1, 1], 'only the carrier is buffed');
  // the count is live: a new ally arrives → both carriers grow
  spawn(h, p, 'Unit Token');
  assert.deepEqual(effStats(h, prick), [3, 4], 'live count: three other allies now');
  assert.deepEqual(effStats(h, t1), [4, 4], 'the augmented host grew too');
});

// ── R148 / CT-38 + CT-39: the control-change choke point ──────────────────
//
// Three cards used to flip `controller` by raw assignment and skip what
// `E.giveControl` does for everyone else. Two of them are in this file. The
// assertions below are deliberately ONE PER SKIPPED BEHAVIOUR rather than one
// composite "it worked", so a partial regression names itself.
//
// ⚠ One claim in CT-38 is corrected here rather than tested: the ticket said
// Mindspore Fiend also "skips the region move". It does not skip anything
// reachable — the card picks its recipient with `presentSeats(g, ctx.region)`,
// so the new controller is a seat PRESENT in the unit's region by
// construction, and giveControl's exclusivity branch (move a unit whose
// controller is not present) cannot fire from here. The region assertion below
// therefore pins what is actually true: the unit STAYS put for the rest of the
// battle, its mods stand with it, and regroup is what walks it home.

/** the R148 control-change events since `from`, with their payloads */
function controlEvents(h: Harness, from: number): { unit: number; from: Seat; to: Seat; region: number }[] {
  return h.events.slice(from).filter(e => e.type === 'controlChanged').map(e => {
    const d = e.data as unknown as { unit: number; from: Seat; to: Seat; region: number };
    return { unit: d.unit, from: d.from, to: d.to, region: d.region };
  });
}

test('Mindspore Fiend gives away a MODDED blocker: its mods change controller, it leaves the formation, and it stays in the battle region (R148/CT-38)', () => {
  const h = new Harness(2420);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 attacker
  spawn(h, D, 'Mindspore Fiend');                     // 1/1, defender side
  const gift = spawn(h, D, 'The Foretold');           // 3/3 vanilla — blocks and survives
  let mod = 0;
  whiteBox(h, e => { mod = e.attachMod(e.entity(gift)!, 'The Foretold', D, 'augment').id; });
  assert.equal(ent(h, mod)!.controller, D, 'the augment starts on the giver\'s side');
  toNextBattle(h, A);
  const region = h.state.battle!.region;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [gift] } });
  assert.deepEqual(h.state.battle!.blocks[0], [gift], 'the gift is a declared blocker');
  pass(h); pass(h);                                   // combat → afterCombat trigger
  const mark = h.events.length;
  pick(h, { unit: gift });                            // the cast-time target
  pass(h); pass(h);                                   // resolve → pay-or-decline
  pick(h, true);                                      // give control

  // (1) THE MODS. This is the whole of CT-38's "major": the raw assignment
  //     handed over a unit whose augments still answered to the old seat.
  assert.equal(ent(h, gift)!.controller, A, 'the unit changed hands');
  assert.equal(ent(h, mod)!.controller, A, 'and its augment changed hands WITH it (R112)');
  // (2) THE FORMATION. A unit the opponent now controls must not still be
  //     standing in the blocker grid of the seat that gave it away — the
  //     afterWindow priority is still to come and can see that line.
  assert.ok(!Object.values(h.state.battle!.blocks).some(col => col.includes(gift)),
    'it left the blocker grid it was declared in');
  // (3) THE REGION. Both seats are present here, so R112 exclusivity does not
  //     fire and nothing moves mid-battle; the mod stands with its host.
  assert.equal(ent(h, gift)!.region, region, 'it stays in the battle region for the rest of the battle');
  assert.equal(ent(h, mod)!.region, region, 'and so does its augment');
  // (4) THE EVENT (CT-39), with the seats and the region of the handover.
  assert.deepEqual(controlEvents(h, mark), [{ unit: gift, from: D, to: A, region }],
    'exactly one controlChanged, naming who lost it, who got it and where');

  finishBattle(h);
  assert.ok(unitsOf(h, A).some(u => u.id === gift), 'regroup: it went home with its NEW controller');
  assert.equal(ent(h, mod)!.region, ent(h, gift)!.region, 'the augment went with it');
});

test('Organic Exchange hands over MODDED units: each unit\'s mods follow it, and the positions still swap (R148/CT-38)', () => {
  const h = new Harness(2421);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb');                   // 5/6 — A's attacker
  const dtok = spawn(h, D, 'Unit Token');             // 1/1 — D's, in no formation
  let modA = 0, modD = 0;
  whiteBox(h, e => {
    modA = e.attachMod(e.entity(bubb)!, 'The Foretold', A, 'augment').id;
    modD = e.attachMod(e.entity(dtok)!, 'The Foretold', D, 'augment').id;
  });
  giveResources(h, D, 'wood', 3);                     // gg / 3
  toNextBattle(h, A);
  const region = h.state.battle!.region;
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Organic Exchange') });
  pick(h, { unit: bubb });
  pick(h, { unit: dtok });
  pass(h); pass(h);                                   // resolve

  assert.equal(ent(h, bubb)!.controller, D, 'Bubb changed sides');
  assert.equal(ent(h, modA)!.controller, D, 'and its augment went with it');
  assert.equal(ent(h, dtok)!.controller, A, 'the 1/1 changed sides');
  assert.equal(ent(h, modD)!.controller, A, 'and its augment went with it');
  // the exchange is the ONE caller that keeps the formation: each unit takes
  // the other's slot, which is a slot on its new controller's side, so the
  // choke point must not unslot them.
  assert.deepEqual(h.state.battle!.columns[0], [dtok], 'the 1/1 took Bubb\'s attack slot');
  assert.deepEqual(controlEvents(h, mark), [
    { unit: bubb, from: A, to: D, region },
    { unit: dtok, from: D, to: A, region },
  ], 'one controlChanged per handover, both region-scoped to the battle');
  finishBattle(h);
});

test('an UNMODDED control change behaves exactly as it did before R148 — the negative control', () => {
  const h = new Harness(2422);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Mindspore Fiend');
  const gift = spawn(h, D, 'Unit Token');             // no mods, in no formation
  toNextBattle(h, A);
  const region = h.state.battle!.region;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const columns = h.state.battle!.columns.map(c => [...c]);
  pass(h); pass(h);
  const handD = h.state.players[D]!.hand.length;
  const mark = h.events.length;
  pick(h, { unit: gift });
  pass(h); pass(h);
  pick(h, true);
  assert.equal(ent(h, gift)!.controller, A, 'control changed');
  assert.equal(ent(h, gift)!.owner, D, 'owner never changes');
  assert.deepEqual(ent(h, gift)!.mods, [], 'there were no mods to carry');
  assert.equal(ent(h, gift)!.region, region, 'and nothing moved region');
  assert.deepEqual(h.state.battle!.columns, columns, 'the attacking line is untouched');
  assert.equal(h.state.players[D]!.hand.length, handD + 1, '"if you do, draw a card" still pays out');
  assert.equal(controlEvents(h, mark).length, 1, 'one handover, one event');
  // the log line is the choke point's, word for word, as it always was
  assert.ok(h.events.slice(mark).some(e => e.type === 'controlChanged'
    && e.msg === `${h.q.pname(A)} gains control of Unit Token (from ${h.q.pname(D)}).`),
    'the message is unchanged — controlChanged carries the line info used to');
});
