/* Per-card tests for the Light & Dark hybrid batch B (batch-hybrids-ld-b):
 * a prophecy-bannered lord (Air Plant, R42/R43), doubled life change (Arbiter
 * of Vitality), X-many Wraith augments (Blight's End, R71), board-wide
 * {Balanced} (Brough, R19), a discard-fuelled graft cause (Cadaverous
 * Cultivator), a resolution-paid recursion engine (Combustible Bogwalker),
 * a discard-costed burn spell (Darkblast, R35/R40), life averaging
 * (Equilibriate), the {Poisonous} half of Inexorable Miasma, life-parity
 * statics (Life Power Dude), trash-triggered drain and burn (Murkstalker,
 * Splort, R40), counter/rot proliferation (Proliferating Slime), bin-fed
 * attribute theft (The Omniphage) and the two vanillas (Hammer of Justice,
 * Rime Wraith). Deferral Drone is LIVE (R59 CostMod + an Entity.budgets
 * charge, un-parked 2026-08-22). Vengeance is LIVE (R122: the CostMod
 * `sacrifice` channel — an imposed additional cast cost paid in the cast
 * window, un-parked 2026-08-24). Inexorable Miasma's bin half is live (R51).
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration can't shift assertions. Seeds: 4500-4599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { E, IllegalAction } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, ownAttrs, pass,
  pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf, withE as whiteBox,
} from './util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** answer the pending decision by the option that names `card` (the
 * mid-resolution cost pickers label their options with the card) */
function pickCard(h: Harness, card: string): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => o.card === card);
  if (idx === -1) throw new Error(`no option for ${card} in ${JSON.stringify(dec.options)}`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** empty a seat's opening hand so a discard cost has exactly one candidate */
function emptyHand(h: Harness, seat: Seat): void {
  h.state.players[seat]!.hand.length = 0;
}

// ── Air Plant ────────────────────────────────────────────────────────────

test('Air Plant: [Augment] your OTHER units gain +2/+2 and Flying', () => {
  const h = new Harness(4501);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const plant = spawn(h, p, 'Air Plant');
  const ally = spawn(h, p, 'Hammer of Justice');               // printed 10/3
  assert.deepEqual(effStats(h, ally), [12, 5], 'the other unit gets +2/+2');
  assert.ok(ownAttrs(h, ally).has('Flying'), 'and Flying');
  assert.deepEqual(effStats(h, plant), [2, 2], '"other" excludes the Air Plant itself');
  assert.ok(ownAttrs(h, plant).has('Flying'), 'its own Flying is printed, not granted');
});

test('Air Plant: prophesied for [2], released free once four unique unit costs are out (R42)', () => {
  const h = new Harness(4502);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'light', 1);   // R301: the banner is [2lg], so two mana
  giveResources(h, p, 'wood', 1);    // and one pip of each of its own elements
  const idx = give(h, p, 'Air Plant');
  h.do({ type: 'prophesy', seat: p, from: 'hand', index: idx });
  const cc = h.state.players[p]!.cache![0]!;
  assert.equal(cc.card, 'Air Plant', 'the card moved to cache');
  assert.equal(cc.prophecy!.condition, 'Your units have four unique costs.', 'banner attached');
  const e = new E(h.state);
  assert.ok(!e.cachePermission(p, 0), 'no permission yet — no unique costs on board');
  spawn(h, p, 'Splort');                                       // [2]
  spawn(h, p, 'Murkstalker');                                  // [3]
  spawn(h, p, 'Brough');                                       // [4]
  assert.ok(!new E(h.state).cachePermission(p, 0), 'three unique costs is not enough');
  spawn(h, p, 'Hammer of Justice');                            // [6] — the fourth
  assert.equal(new E(h.state).cachePermission(p, 0), 'prophecy', 'four unique costs → released');
  // and the release is FREE, with no light/wood affinity anywhere in sight
  h.do({ type: 'playCached', seat: p, index: 0 });
  assert.ok(unitsOf(h, p).some(u => u.card === 'Air Plant'), 'played from cache for free');
});

// ── Arbiter of Vitality ──────────────────────────────────────────────────

// R162: no longer a trigger approximation — it is one `AmountMultiplier` now,
// applied before the total moves. The NUMBERS here are unchanged, which is the
// point of keeping the two tests: one Arbiter still doubles. What moved is in
// 137-multiplier-and-mode.test.ts (two Arbiters, lethal ordering, composition).
test('Arbiter of Vitality: doubles life GAIN', () => {
  const h = new Harness(4503);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Arbiter of Vitality');
  const before = h.state.players[p]!.life;
  whiteBox(h, e => e.gainLife(p, 3, 'a test'));
  assert.equal(h.state.players[p]!.life, before + 6, '3 gained, doubled to 6');
  assert.ok(h.log.some(m => m.includes('Arbiter of Vitality') && m.includes('×2')),
    'logged as the multiplication, by name');
});

test('Arbiter of Vitality: doubles life LOSS, and never doubles its own doubling', () => {
  const h = new Harness(4504);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Arbiter of Vitality');
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, 30, '5 lost, doubled to 10 — and no runaway recursion');
});

// ── Blight's End ─────────────────────────────────────────────────────────

test("Blight's End: augments a Wraith (R71) onto X target units, enemies included", () => {
  const h = new Harness(4505);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Hammer of Justice');
  const theirs = spawn(h, D, 'Hammer of Justice');
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 1);                             // gd, X up to 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });   // both units now in region 1
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, "Blight's End") });
  pick(h, 2);                                                  // X = 2, paid at cast (R35)
  // R67: the X hosts are DECLARED targets, chosen at CAST — X is settled
  // first, so the collector knows to ask for exactly two of them
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  assert.equal(h.state.stack.length, 1, 'only now is it on the stack, fully aimed');
  pass(h); pass(h);                                            // resolve
  for (const id of [mine, theirs]) {
    const mods = ent(h, id)!.mods.map(m => ent(h, m)!);
    assert.equal(mods.length, 1, 'exactly one mod landed');
    // Blight's End still prints the retired name "Wight"; state stores the
    // current canonical name, so the alias never leaks out of getCard().
    assert.equal(mods[0]!.card, 'Wraith', 'it is the Wraith token');
    assert.equal(mods[0]!.appliedAs, 'augment', 'applied as an augment, not spawned');
    assert.ok(mods[0]!.token, 'the mod is a token — a mod has no card of its own to bin (R69)');
  }
  finishBattle(h);
});

// ── Brough ───────────────────────────────────────────────────────────────

test('Brough: everything is {Balanced} — both players’ units, itself included (R19)', () => {
  const h = new Harness(4506);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const brough = spawn(h, p, 'Brough');                        // printed 0/4
  const hammer = spawn(h, p, 'Hammer of Justice');             // printed 10/3
  assert.deepEqual(effStats(h, brough), [4, 4], '0/4 balances up to 4/4');
  assert.deepEqual(effStats(h, hammer), [10, 10], '10/3 balances up to 10/10');
  assert.ok(ownAttrs(h, hammer).has('Balanced'), 'the attribute really is granted');
});

// ── Cadaverous Cultivator ────────────────────────────────────────────────

test('Cadaverous Cultivator: [Battle] discard a card to fire its grafts', () => {
  const h = new Harness(4507);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  // the Cultivator defends, so the battle happens in ITS region and both
  // players are present there (R25, for the grafted "each opponent" rider)
  const cult = spawn(h, D, 'Cadaverous Cultivator');
  const atk = spawn(h, A, 'Hammer of Justice');
  whiteBox(h, e => e.attachMod(ent(h, cult)!, 'Murkstalker', D, 'graft', 0));
  h.state.players[D]!.life = 30;
  const foeLife = h.state.players[A]!.life;
  toNextBattle(h, A);
  emptyHand(h, D);                                             // after the turn's draw
  give(h, D, 'Brough');                                        // the only card to discard
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                     // priority → D
  h.do({ type: 'activateAbility', seat: D, entityId: cult, abilityIndex: 0 });
  // R49: the discard is an ACTIVATION cost — chosen and paid in the cast
  // window, before the item ever reaches the stack
  assert.equal(h.state.decision!.seat, D, 'the cost choice is asked at activation');
  h.do({ type: 'decide', seat: D, choice: 0 });
  assert.ok(h.state.players[D]!.bin.includes('Brough'),
    'the cost was paid immediately — before anyone could respond');
  pass(h); pass(h);                                            // resolve the ability
  assert.equal(h.state.players[A]!.life, foeLife - 3, 'the grafted Murkstalker rider fired');
  assert.equal(h.state.players[D]!.life, 33, 'and gained the Cultivator’s controller 3');
  finishBattle(h);
});

test('Cadaverous Cultivator: R49 — [Battle] is enforced at ACTIVATION, not at resolution', () => {
  const h = new Harness(4508);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cult = spawn(h, p, 'Cadaverous Cultivator');
  emptyHand(h, p);
  give(h, p, 'Hammer of Justice');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: p, entityId: cult, abilityIndex: 0 }),
    /can only be activated during battle/,
    'the printed [Battle] marker gates the activation itself');
  assert.deepEqual(h.state.players[p]!.bin, [], 'nothing was discarded');
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === cult),
    'and it is not even offered during deployment');
});

test('Cadaverous Cultivator: R49 — an empty hand makes the activation cost unpayable', () => {
  const h = new Harness(4530);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const cult = spawn(h, D, 'Cadaverous Cultivator');
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  emptyHand(h, D);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: cult, abilityIndex: 0 }),
    /cannot pay the activation cost/);
  assert.ok(!h.legal(D).some(a => a.type === 'activateAbility' && a.entityId === cult));
  finishBattle(h);
});

// ── Combustible Bogwalker ────────────────────────────────────────────────

test('Combustible Bogwalker: discard a card to recall a unit from your bin ([once])', () => {
  const h = new Harness(4509);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bog = spawn(h, p, 'Combustible Bogwalker');
  h.state.players[p]!.bin.push('Brough');                      // the unit to recall
  emptyHand(h, p);
  give(h, p, 'Darkblast');                                     // a SPELL, so the bin
  h.do({ type: 'activateAbility', seat: p, entityId: bog, abilityIndex: 0, via: 'augment' });
  // R64/R57: the TARGET is chosen first — against the bin as it is now, which
  // is before the cost pushes a card into it
  pickCard(h, 'Brough');
  // R49: the either/or cost is asked at ACTIVATION, before the item exists
  pickCard(h, 'Darkblast');
  assert.ok(h.state.players[p]!.bin.includes('Darkblast'),
    'paid immediately — nobody could respond in between');
  assert.ok(h.state.players[p]!.hand.includes('Brough'), 'the bin unit is back in hand');
  assert.ok(!h.state.players[p]!.bin.includes('Brough'), 'and left the bin');
  assert.ok(h.state.players[p]!.bin.includes('Darkblast'), 'the discard trashed the paid card (R40)');
  assert.ok(ent(h, bog), 'the OTHER cost mode was not taken — the Bogwalker lives');
  // [once] per turn (R9)
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === bog),
    'the [once] budget is spent for the turn');
});

test('Combustible Bogwalker: R49 — with an empty bin the cost is paid for nothing', () => {
  const h = new Harness(4510);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bog = spawn(h, p, 'Combustible Bogwalker');
  emptyHand(h, p);
  give(h, p, 'Darkblast');                                     // a SPELL: not recallable
  h.do({ type: 'activateAbility', seat: p, entityId: bog, abilityIndex: 0, via: 'augment' });
  pickCard(h, 'Darkblast');
  // ⚠ the printed line is a COST, and R35 pays costs before effects — so an
  // activation with nothing to recall wastes the payment. The old
  // resolution-time version checked the bin first and paid nothing; that was
  // the more forgiving reading, not the more correct one.
  assert.deepEqual(h.state.players[p]!.bin, ['Darkblast'], 'the cost was paid');
  assert.ok(!h.state.players[p]!.hand.includes('Darkblast'), 'and left the hand');
  assert.ok(h.log.some(m => m.includes('no unit in your bin')), 'and it says why');
});

test('Combustible Bogwalker: R49 — with no payment available the activation is refused', () => {
  const h = new Harness(4534);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bog = spawn(h, p, 'Combustible Bogwalker');   // its ONLY unit — "another"
  h.state.players[p]!.bin.push('Brough');
  emptyHand(h, p);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: p, entityId: bog, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/);
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === bog),
    'and the [once] budget is not burned on it either');
  assert.ok(h.state.players[p]!.bin.includes('Brough'), 'nothing moved');
});

// ── Darkblast ────────────────────────────────────────────────────────────

test('Darkblast: discard a card, deal 5 damage to any target (R35 cost, R40 trash)', () => {
  const h = new Harness(4511);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Hammer of Justice');             // 10/3 — 5 damage kills it
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'dark', 1);                              // rd / 1
  toNextBattle(h, A);
  emptyHand(h, A);                                             // after the turn's draw
  give(h, A, 'Brough');                                        // the only card to discard
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Darkblast') });
  // R57: the TARGET is declared first, then the bracketed cost is chosen and
  // paid — both still at cast, before the spell reaches the stack (R35).
  assert.equal(h.state.decision!.seat, A, 'the caster aims it');
  pick(h, { unit: victim });
  assert.ok(!h.state.players[A]!.bin.includes('Brough'), 'nothing discarded yet');
  h.do({ type: 'decide', seat: A, choice: 0 });                // discard Brough
  assert.ok(h.state.players[A]!.bin.includes('Brough'),
    'the discard cost was paid at cast and trashed (R40)');
  pass(h); pass(h);                                            // resolve
  assert.ok(!ent(h, victim), 'the target took 5 and died');
  finishBattle(h);
});

test('Darkblast: R35 — with nothing else in hand the cost is unpayable and the CAST is illegal', () => {
  const h = new Harness(4512);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Hammer of Justice');
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'dark', 1);
  toNextBattle(h, A);
  emptyHand(h, A);                                             // after the turn's draw
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const only = give(h, A, 'Darkblast');                        // its own only hand card
  assert.throws(
    () => h.do({ type: 'playCard', seat: A, handIndex: only }),
    /unpayable \[cost\]/,
    'R35: a spell cannot discard ITSELF to pay its own [Discard a card] cost');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === only),
    'and legalActions does not offer it');
  assert.ok(ent(h, victim), 'nothing happened at all');
  finishBattle(h);
});

// ── Deferral Drone (R119: a PLAYER-side charge) ──────────────────────────
//
// "[Augment][once] Gain 4 debt: The next card you play this turn costs [3]
// less." Built 2026-08-22 as an `Entity.budgets` key plus a `CostMod`; moved
// wholesale onto `GameState.nextPlayDiscount` on 2026-08-23 when the owner
// ruled the residue (R119: the charge SURVIVES the Drone — "you paid for it").
// Set by E.grantNextPlayDiscount, read by manaToPlay before its clamp, spent
// at the spellPlayed / spawned emit sites a play already fires (both land
// AFTER payment), cleared by E.startTurn.

/** what it costs `seat` to PLAY `name` right now, straight off the R59 layer */
function costToPlay(h: Harness, seat: Seat, name: string): number {
  return new E(h.state).manaToPlay(seat, name);
}
const debtOf = (h: Harness, seat: Seat): number => new E(h.state).debt(seat);

test('Deferral Drone: gain 4 debt → the next card you play this turn costs [3] less', () => {
  const h = new Harness(4535);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  assert.deepEqual(effStats(h, drone), [2, 2], 'a 2/2 body');
  assert.equal(costToPlay(h, p, 'Brough'), 4, 'printed [4] before anything is armed');
  const act = h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone);
  assert.ok(act, 'the ability is offered (it was deliberately not, while parked)');
  h.do(act!);
  assert.equal(debtOf(h, p), 4, 'the activation cost is real: 4 debt');
  assert.equal(costToPlay(h, p, 'Brough'), 1, '[4] card now costs [1]');
  assert.equal(costToPlay(h, p, 'Murkstalker'), 0, '[3] card is free — clamped at zero, never negative');
});

test('Deferral Drone: only the NEXT card is discounted — the one after it pays in full', () => {
  const h = new Harness(4536);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  giveResources(h, p, 'light', 6);
  giveResources(h, p, 'earth', 6);                             // Brough: le / 4
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  const open = () => h.state.players[p]!.resources.filter(r => r.state === 'open').length;
  const before = open();
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Brough') });
  assert.equal(before - open(), 1, 'the first Brough really cost 1 mana, not 4');
  assert.equal(costToPlay(h, p, 'Brough'), 4, 'the charge is spent — back to printed [4]');
  const mid = open();
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Brough') });
  assert.equal(mid - open(), 4, 'and the second one pays the full 4');
});

test('Deferral Drone: [once] — one activation per turn (R9)', () => {
  const h = new Harness(4537);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === drone),
    'not offered a second time this turn');
  assert.equal(debtOf(h, p), 4, 'and no second helping of debt');
});

test('Deferral Drone: applying a mod is not playing, so it keeps the charge (R37/R59)', () => {
  const h = new Harness(4538);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  const host = spawn(h, p, 'Brough');
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  const e = new E(h.state);
  assert.equal(e.manaToPlay(p, 'Deferral Drone', { purpose: 'mod' }), 2,
    'augmenting is priced at the printed [2] — the discount does not apply');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'metal', 1);                             // lm / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Deferral Drone'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the augment landed');
  assert.equal(costToPlay(h, p, 'Brough'), 1, 'and the charge is still standing for a real PLAY');
});

test('Deferral Drone: donated by an augment, "you" is the HOST\'s controller', () => {
  const h = new Harness(4539);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Brough');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'metal', 1);                             // lm / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Deferral Drone'), hostId: host });
  const act = h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === host);
  assert.ok(act, 'the donated ability is offered on the HOST');
  h.do(act!);
  assert.equal(costToPlay(h, p, 'Hammer of Justice'), 3, 'the host radiates the discount: [6] → [3]');
});

// ── R119: the charge outlives its source ─────────────────────────────────
//
// PROMOTED from `{ todo: true }` on 2026-08-23. The todo asked "does a
// paid-for one-shot discount outlive its source?"; the owner answered YES —
// "you paid for it". These five are the ruling.

test('Deferral Drone: R119 — the charge SURVIVES the Drone leaving play ("you paid for it")', () => {
  const h = new Harness(4540);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  assert.equal(debtOf(h, p), 4, 'the 4 debt is really gone — that is what "you paid for it" means');
  assert.equal(costToPlay(h, p, 'Brough'), 1, 'armed: [4] → [1]');
  whiteBox(h, e => e.destroy(ent(h, drone)!, 'is sacrificed'));
  assert.equal(ent(h, drone), undefined, 'the Drone is off the board');
  assert.equal(costToPlay(h, p, 'Brough'), 1,
    'R119: the ability RESOLVED and the debt is paid, so the source leaving play cannot claw the charge back');
  assert.equal(costToPlay(h, p, 'Murkstalker'), 0, 'and it still clamps at zero rather than going negative');
});

test('Deferral Drone: R119 — the charge is spent by the next play even with the Drone gone', () => {
  const h = new Harness(4541);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  giveResources(h, p, 'light', 6);
  giveResources(h, p, 'earth', 6);                             // Brough: le / 4
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  whiteBox(h, e => e.destroy(ent(h, drone)!, 'is sacrificed'));
  const open = () => h.state.players[p]!.resources.filter(r => r.state === 'open').length;
  const before = open();
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Brough') });
  assert.equal(before - open(), 1, 'the discounted Brough really cost 1 mana');
  // THE reason the spend could not stay card-side: the bookkeeping trigger
  // died with the Drone, so a surviving charge would have been unspendable.
  assert.equal(costToPlay(h, p, 'Brough'), 4, 'and the charge is spent — back to printed [4]');
  const mid = open();
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Brough') });
  assert.equal(mid - open(), 4, 'the one after it pays in full');
});

test('Deferral Drone: R119 — an unspent charge does not carry into the next turn', () => {
  const h = new Harness(4542);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  assert.equal(costToPlay(h, p, 'Brough'), 1, 'armed this turn');
  const turn = h.state.turn;
  toNextBattle(h);                                             // startTurn runs here
  assert.ok(h.state.turn > turn, 'the turn really flipped');
  assert.ok(ent(h, drone), 'the Drone is still standing — this is the clock, not the death');
  assert.equal(costToPlay(h, p, 'Brough'), 4,
    '"the next card you play THIS TURN": E.startTurn zeroes the charge beside the budgets wipe');
});

test('Deferral Drone: R119 — with the Drone gone, applying a mod still does not spend the charge (R37)', () => {
  const h = new Harness(4543);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  const host = spawn(h, p, 'Brough');
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  whiteBox(h, e => e.destroy(ent(h, drone)!, 'is sacrificed'));
  assert.equal(new E(h.state).manaToPlay(p, 'Deferral Drone', { purpose: 'mod' }), 2,
    'the `purpose` guard is R37/R59 doing its usual work: a mod payment pays printed [2]');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'metal', 1);                             // lm / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Deferral Drone'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the augment landed');
  assert.equal(costToPlay(h, p, 'Brough'), 1, 'and the charge is still standing for a real PLAY');
});

test('Deferral Drone: R119 — the charge survives a JSON round-trip, and pre-R119 states read as 0', () => {
  const h = new Harness(4544);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  h.do(h.legal(p).find(a => a.type === 'activateAbility' && a.entityId === drone)!);
  const round = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  assert.deepEqual(round.nextPlayDiscount, h.state.nextPlayDiscount, 'the new field round-trips');
  assert.equal(new E(round).manaToPlay(p, 'Brough'), 1, 'and the charge still prices a play off the reloaded state');
  // additive/optional: a game serialized before R119 has no such key at all
  const old = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  delete old.nextPlayDiscount;
  assert.equal(new E(old).manaToPlay(p, 'Brough'), 4, 'a pre-R119 save loads and reads as no charge');
  h.state = old;
  assert.doesNotThrow(() => h.legal(p), 'and still drives');
});

// ── Equilibriate ─────────────────────────────────────────────────────────

test('Equilibriate: sets every life total to the floored average', () => {
  const h = new Harness(4514);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  h.state.players[A]!.life = 20;
  h.state.players[D]!.life = 7;                                // average 13.5 → 13
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'earth', 3);                             // lg / 5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Equilibriate') });
  pass(h); pass(h);                                            // resolve
  assert.equal(h.state.players[A]!.life, 13, 'the high player comes down');
  assert.equal(h.state.players[D]!.life, 13, 'the low player comes up');
  finishBattle(h);
});

// ── Hammer of Justice / Rime Wraith (vanilla) ────────────────────────────

test('Hammer of Justice and Rime Wraith: printed bodies and printed attributes only', () => {
  const h = new Harness(4515);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const hammer = spawn(h, p, 'Hammer of Justice');
  assert.deepEqual(effStats(h, hammer), [10, 3], 'a 10/3 structure');
  assert.ok(ownAttrs(h, hammer).has('Blessed'), '{Blessed} comes off the type line (R48)');
  assert.ok(ownAttrs(h, hammer).has('Piercing'), 'as does {Piercing}');
  // Rime Wraith is a {Virus} [Augment] {Swift}{Sluggish} body with no behaviour:
  // augmenting it donates both type-line attributes and nothing else
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'water', 1);                             // lb / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rime Wraith'), hostId: hammer });
  const attrs = ownAttrs(h, hammer);
  assert.ok(attrs.has('Swift') && attrs.has('Sluggish'),
    '⚠ the card grants BOTH Swift and Sluggish — see the batch report');
  assert.deepEqual(effStats(h, hammer), [10, 3], 'the augment changes no stats');
});

// ── Inexorable Miasma ────────────────────────────────────────────────────

test('Inexorable Miasma: target unit gains {Poisonous} until regroup', () => {
  const h = new Harness(4516);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Hammer of Justice');
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'dark', 1);                              // gd / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Inexorable Miasma') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.ok(ownAttrs(h, victim).has('Poisonous'), 'the target is poisonous');
  assert.deepEqual(ent(h, victim)!.tempAttrs, ['Poisonous'], 'granted as a temp attr (clears at regroup)');
  finishBattle(h);
});

test('Inexorable Miasma: R51 — after combat, from your BIN, remove a -1/-1 counter to recall it', () => {
  const h = new Harness(4531);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  // the counter-carrying unit has to be IN the battle region (R12/R25), i.e.
  // the defender's home — so it is D's, which is fine: the text says "a unit"
  const shrunk = spawn(h, D, 'Hammer of Justice');
  whiteBox(h, e => e.addCounters(ent(h, shrunk)!, -2));         // net -2: it has -1/-1 counters
  h.state.players[A]!.bin.push('Inexorable Miasma');            // sitting in A's bin
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                             // attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                             // block window → damage → after-combat
  // in battle a trigger uses the stack, so it asks when it RESOLVES
  pass(h); pass(h);
  assert.ok(h.state.decision, 'the bin-resident trigger asked its question');
  assert.equal(h.state.decision!.seat, A, '"if I am in YOUR bin" — the bin owner decides');
  const opt = h.state.decision!.options.findIndex(o => o.card === 'Hammer of Justice');
  assert.ok(opt >= 0, 'only a unit carrying a -1/-1 counter is offered');
  h.do({ type: 'decide', seat: A, choice: opt });
  assert.equal(ent(h, shrunk)!.counters, -1, 'one -1/-1 counter was removed');
  assert.ok(!h.state.players[A]!.bin.includes('Inexorable Miasma'), 'it left the bin');
  assert.ok(h.state.players[A]!.hand.includes('Inexorable Miasma'), 'recalled to hand');
  finishBattle(h);
});

test('Inexorable Miasma: with no -1/-1 counters anywhere it just stays in the bin', () => {
  const h = new Harness(4532);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Inexorable Miasma');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  pass(h); pass(h);                                             // the trigger resolves
  assert.equal(h.state.decision, null, 'nothing to ask');
  assert.ok(h.state.players[A]!.bin.includes('Inexorable Miasma'), 'still in the bin');
  assert.ok(h.log.some(m => m.includes('no unit carries a -1/-1 counter')));
  finishBattle(h);
});

test('Inexorable Miasma: a card that is NOT in the bin never hears the after-combat event', () => {
  const h = new Harness(4533);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const shrunk = spawn(h, A, 'Hammer of Justice');
  whiteBox(h, e => e.addCounters(ent(h, shrunk)!, -2));
  toNextBattle(h, A);                                            // bin is empty
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.decision, null, 'no zone trigger without the card in the zone');
  assert.equal(ent(h, shrunk)!.counters, -2, 'and nothing was removed');
  finishBattle(h);
});

// ── Life Power Dude ──────────────────────────────────────────────────────

test('Life Power Dude: odd life → all units -2/-0, even life → +2/+0 (live, R27)', () => {
  const h = new Harness(4517);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const dude = spawn(h, p, 'Life Power Dude');                 // printed 2/3
  const ally = spawn(h, p, 'Hammer of Justice');               // printed 10/3
  h.state.players[p]!.life = 21;                               // odd
  assert.deepEqual(effStats(h, ally), [8, 3], 'odd life: -2/-0');
  assert.deepEqual(effStats(h, dude), [0, 3], '"all units" includes the Dude itself');
  h.state.players[p]!.life = 20;                               // even
  assert.deepEqual(effStats(h, ally), [12, 3], 'even life: +2/+0');
  assert.deepEqual(effStats(h, dude), [4, 3], 'and again, itself included');
});

// ── Murkstalker ──────────────────────────────────────────────────────────

test('Murkstalker: when YOU trash a card, drain 3 — bounded once per turn (R9/R40)', () => {
  const h = new Harness(4518);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  // "each opponent" is region-scoped (R25), so the drain needs both players in
  // one region: the Murkstalker DEFENDS and the battle comes to it
  const murk = spawn(h, D, 'Murkstalker');
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[D]!.life = 30;
  const foeLife = h.state.players[A]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(ent(h, murk)!.region, h.state.battle!.region, 'setup: the battle is in its region');
  whiteBox(h, e => { e.discardFromHand(D, 0); });
  pass(h); pass(h);                                            // resolve the trigger
  assert.equal(h.state.players[A]!.life, foeLife - 3, 'each opponent loses 3');
  assert.equal(h.state.players[D]!.life, 33, 'and I gain 3');
  whiteBox(h, e => { e.discardFromHand(D, 0); });
  assert.equal(h.state.players[A]!.life, foeLife - 3, '[Switch1]: only once this turn');
  finishBattle(h);
});

test('Murkstalker: an OPPONENT trashing a card does not fire it', () => {
  const h = new Harness(4519);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const foe = 1 - p;
  // put the Murkstalker in the trasher's region so only "who trashed" can differ
  whiteBox(h, e => { e.spawnUnit(p, 'Murkstalker', e.homeRegion(foe)); });
  const myLife = h.state.players[p]!.life;
  give(h, foe, 'Brough');
  whiteBox(h, e => { e.discardFromHand(foe, 0); });
  assert.equal(h.state.players[p]!.life, myLife, '"when YOU trash" — not their trash');
});

// ── Proliferating Slime ──────────────────────────────────────────────────

test('Proliferating Slime: counters on an ENEMY unit arrive plus one (⚠ approximation)', () => {
  const h = new Harness(4520);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const foe = 1 - p;
  spawn(h, p, 'Proliferating Slime');
  let enemy = 0, mine = 0;
  whiteBox(h, e => {
    enemy = e.spawnUnit(foe, 'Hammer of Justice', e.homeRegion(p)).id;
    mine = e.spawnUnit(p, 'Hammer of Justice', e.homeRegion(p)).id;
  });
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, -1));
  assert.equal(ent(h, enemy)!.counters, -2, 'one -1/-1 counter became two — and did not run away');
  whiteBox(h, e => e.addCounters(ent(h, mine)!, 2));
  assert.equal(ent(h, mine)!.counters, 2, 'my own units are untouched');
});

test('Proliferating Slime: rot given to an enemy PLAYER arrives plus one (⚠ interpretation)', () => {
  const h = new Harness(4521);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const foe = 1 - p;
  spawn(h, p, 'Proliferating Slime');
  whiteBox(h, e => e.gainRot(foe, 2));
  assert.equal(new E(h.state).rot(foe), 3, '"or player" is read as rot/debt — 2 became 3');
  whiteBox(h, e => e.gainDebt(p, 2));
  assert.equal(new E(h.state).debt(p), 2, 'my own debt is not proliferated');
});

// ── Splort ───────────────────────────────────────────────────────────────

test('Splort: when ANOTHER card is trashed, deal 2 to any target (R40)', () => {
  const h = new Harness(4522);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Splort');
  const target = spawn(h, p, 'Life Power Dude');               // 2/3 — survives 2 damage
  give(h, p, 'Brough');
  give(h, p, 'Murkstalker');
  whiteBox(h, e => { e.discardFromHand(p, 0); });
  assert.ok(h.state.decision, 'the trigger asks for its target');
  pick(h, { unit: target });
  assert.equal(ent(h, target)!.damage, 2, 'two damage landed');
  whiteBox(h, e => { e.discardFromHand(p, 0); });
  assert.ok(!h.state.decision, '[Switch1]: bounded to once per turn');
});

// ── The Omniphage ────────────────────────────────────────────────────────

test('The Omniphage: gains every attribute printed on units in your bin (live)', () => {
  const h = new Harness(4523);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const omni = spawn(h, p, 'The Omniphage');
  assert.equal(ownAttrs(h, omni).size, 0, 'an empty bin grants nothing');
  h.state.players[p]!.bin.push('Air Plant');                   // a {Flying} unit
  assert.ok(ownAttrs(h, omni).has('Flying'), 'Flying is copied out of the bin');
  h.state.players[p]!.bin.push('Hammer of Justice');           // {Blessed} {Piercing}
  const attrs = ownAttrs(h, omni);
  assert.ok(attrs.has('Blessed') && attrs.has('Piercing') && attrs.has('Flying'),
    'all of them, from every unit in the bin');
  h.state.players[1 - p]!.bin.push('Rime Wraith');
  assert.ok(!ownAttrs(h, omni).has('Sluggish'), '"YOUR bin" — not the opponent’s');
});

// ── Vengeance (R122) ─────────────────────────────────────────────────────
// The un-park of the old { todo: true } test: CostMod carries a `sacrifice`
// channel now, counted by E.unitsToPlay, gated in canPayCard, and paid as a
// StackItem.pendingCosts 'playSacrifice' atom in the cast window.

test("Vengeance: opponents' battle cards gain '[Sacrifice a unit]' — the payer picks, off a menu of THEIR units only", () => {
  const h = new Harness(4545);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Vengeance');                 // radiates from A's home — the battle region below
  toNextBattle(h, D);                       // D attacks INTO A's region
  const atk = spawn(h, D, 'Good Whale');    // vanilla — no spawn trigger to muddy the stack
  const spare = spawn(h, D, 'Unit Token');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk], [spare]] });
  giveResources(h, D, 'fire', 4);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { player: A });                   // the spell's own target first (R57)
  // then the imposed cost: a real decision, and the PAYER owns it
  const dec = h.state.decision!;
  assert.equal(dec.seat, D, 'the paying player chooses — never the engine, never the Vengeance side');
  assert.ok(dec.prompt.includes('sacrifice a unit') && dec.prompt.includes('additional cost'), dec.prompt);
  // mandatory once the play is declared: the menu is their units — the token
  // included ("a unit", unqualified) — and NOTHING else, no decline option
  assert.deepEqual(offered(h).sort(),
    [JSON.stringify({ unit: atk }), JSON.stringify({ unit: spare })].sort(),
    "exactly D's two units: no enemy units, no skip");
  assert.equal(h.state.stack.length, 0, 'the cost is paid BEFORE the item reaches the stack');
  pick(h, { unit: spare });
  assert.ok(!ent(h, spare), 'the picked unit died');
  assert.ok(ent(h, atk), 'and the other survived');
  assert.ok(h.log.some(l => l.includes('sacrifices Unit Token')), 'it died as a SACRIFICE');
  assert.equal(h.state.stack.length, 1, 'only once the cost is paid does the spell reach the stack');
  pass(h); pass(h);
  finishBattle(h);
});

test('Vengeance: no unit to sacrifice — the play is not offered, refused atomically, nothing half-paid', () => {
  const h = new Harness(4546);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const v = spawn(h, A, 'Vengeance');
  toNextBattle(h, A);                       // A attacks INTO D's region; D defends with NOTHING
  h.do({ type: 'declareAttack', seat: A, columns: [[v]] });
  pass(h);                                  // A passes → D holds priority
  giveResources(h, D, 'fire', 4);
  const bolt = give(h, D, 'Flame of History');
  const hand0 = h.state.players[D]!.hand.length;
  const open0 = h.state.players[D]!.resources.filter(r => r.state === 'open').length;
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === bolt),
    'an unpayable additional cost gates legality, exactly as unaffordable mana does');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: bolt }), IllegalAction,
    'and apply() refuses it too');
  assert.equal(h.state.players[D]!.hand.length, hand0, 'the card never left the hand');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, open0,
    'and no mana was spent — a refused play pays nothing');
  const chump = spawn(h, D, 'Unit Token');  // D's home IS the battle region here
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.handIndex === bolt),
    'one unit and the same play is castable again');
  h.do({ type: 'playCard', seat: D, handIndex: bolt });
  pick(h, { player: A });
  pick(h, { unit: chump });
  assert.ok(!ent(h, chump), 'paid with the only unit');
  pass(h); pass(h);
  finishBattle(h);
});

test("Vengeance: its controller's OWN battle plays are untouched", () => {
  const h = new Harness(4547);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const v = spawn(h, A, 'Vengeance');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[v]] });   // it carries its own text into battle
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flame of History') });
  pick(h, { player: D });
  assert.equal(h.state.decision, null, '"your opponents" — no sacrifice asked of its own controller');
  assert.equal(h.state.stack.length, 1, 'the spell went straight to the stack');
  assert.ok(ent(h, v), 'and the Vengeance stands');
  pass(h); pass(h);
  finishBattle(h);
});

test('Vengeance: deployment plays are untaxed — "during battle" is a real gate (region held equal)', () => {
  const h = new Harness(4548);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const v = spawn(h, A, 'Vengeance');
  const chump = spawn(h, D, 'Unit Token');
  // park A's Vengeance IN D's home region, so only the PHASE separates this
  // from the battle case — R12 region scope is not what exempts it here
  whiteBox(h, e => { e.entity(v)!.region = e.homeRegion(D); });
  h.do({ type: 'doneDeploying', seat: A });
  giveResources(h, D, 'fire', 1);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Ignis Sprite') });
  assert.equal(h.state.decision, null, 'no sacrifice decision during deployment');
  assert.ok(ent(h, chump), 'nothing died');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Ignis Sprite'), 'the unit simply enters');
});

test('Vengeance: applying a mod during battle is not playing (R37) — no tax on an augment', () => {
  const h = new Harness(4549);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Vengeance');
  toNextBattle(h, D);
  const atk = spawn(h, D, 'Ignis Sprite');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  giveResources(h, D, 'fire', 6);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Smouldering Inferno'), hostId: atk });
  assert.equal(h.state.decision, null, 'no sacrifice asked for a mod — purpose "mod" is exempt');
  let guard = 20;   // a battle augment rides the stack (R79) — let it attach
  while (h.state.stack.length && guard-- > 0) pass(h);
  assert.ok(ent(h, atk), 'the host lives');
  assert.equal(ent(h, atk)!.mods.length, 1, 'the augment is applied, and no sacrifice was ever asked');
  finishBattle(h);
});

test('Vengeance: donated as an augment, the HOST\'s controller is "you" — their opponents are taxed', () => {
  const h = new Harness(4550);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const host = spawn(h, A, 'Ignis Sprite');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'earth', 11);                            // lr / 13
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Vengeance'), hostId: host });
  const chump = spawn(h, D, 'Unit Token');
  const spare = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] }); // the HOST carries the donated text into battle
  pass(h);                                                     // A passes → D holds priority
  giveResources(h, D, 'fire', 4);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { player: A });
  assert.ok(h.state.decision, "the host's opponent is taxed — the mod anchors on the host (R59 anchoring)");
  pick(h, { unit: chump });
  assert.ok(!ent(h, chump) && ent(h, spare), 'one sacrifice, the payer chose which');
  pass(h); pass(h);
  finishBattle(h);
});

test('Vengeance: the imposed sacrifice is a REAL death — death triggers fire (Static Courier)', () => {
  const h = new Harness(4551);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Vengeance');
  toNextBattle(h, D);
  const courier = spawn(h, D, 'Static Courier');   // 3/2 — "When I die, create a Fireball X (X = my power)"
  h.do({ type: 'declareAttack', seat: D, columns: [[courier]] });
  giveResources(h, D, 'fire', 4);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { player: A });
  pick(h, { unit: courier });                      // pay the imposed cost with the Courier
  assert.ok(!ent(h, courier), 'sacrificed — through the normal destroy path');
  let guard = 20;
  while (h.state.stack.length && guard-- > 0) pass(h);   // death trigger + the spell both resolve
  const fires = tokensOf(h, D).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'its death trigger fired');
  assert.equal(fires[0]!.x, 3, 'X = its power when it died');
  finishBattle(h);
});

test('Vengeance: a pending sacrifice decision survives a JSON round-trip and drives on', () => {
  const h = new Harness(4552);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Vengeance');
  toNextBattle(h, D);
  const atk = spawn(h, D, 'Good Whale');    // vanilla — no spawn trigger to muddy the stack
  const spare = spawn(h, D, 'Unit Token');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk], [spare]] });
  giveResources(h, D, 'fire', 4);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { player: A });
  assert.ok(h.state.decision, 'the sacrifice decision is pending');
  h.state = JSON.parse(JSON.stringify(h.state));               // save + load
  assert.ok(h.state.decision, 'the decision round-trips');
  pick(h, { unit: atk });
  assert.ok(!ent(h, atk) && ent(h, spare), 'the loaded game pays and plays on');
  assert.equal(h.state.stack.length, 1, 'and the spell reaches the stack as normal');
  pass(h); pass(h);
  finishBattle(h);
});

test('Vengeance: two of them impose TWO sacrifices — additive, and the gate counts both', () => {
  const h = new Harness(4553);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  spawn(h, A, 'Vengeance');
  spawn(h, A, 'Vengeance');
  toNextBattle(h, D);
  const atk = spawn(h, D, 'Ignis Sprite');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  giveResources(h, D, 'fire', 4);
  const bolt = give(h, D, 'Flame of History');
  // one unit cannot pay two imposed sacrifices — gated, never half-paid
  assert.ok(!h.legal(D).some(a => a.type === 'playCard' && a.handIndex === bolt),
    'one unit is not enough under two Vengeances');
  const t1 = spawn(h, D, 'Unit Token');
  const t2 = spawn(h, D, 'Unit Token');
  // spawned at home; walk them to the battle region so they can pay (R12)
  whiteBox(h, e => { for (const id of [t1, t2]) e.entity(id)!.region = e.s.battle!.region; });
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.handIndex === bolt),
    'three units clear the two-sacrifice gate');
  h.do({ type: 'playCard', seat: D, handIndex: bolt });
  pick(h, { player: A });
  assert.ok(h.state.decision!.prompt.includes('2 left'),
    'each bracketed cost is its own payment — the printed reading is additive');
  pick(h, { unit: t1 });
  pick(h, { unit: t2 });
  assert.ok(!ent(h, t1) && !ent(h, t2) && ent(h, atk), 'exactly two die, and the payer chose which');
  pass(h); pass(h);
  finishBattle(h);
});

test('Vengeance: plays as a 7/9 and is recognised as an augment', () => {
  const h = new Harness(4524);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const v = spawn(h, p, 'Vengeance');
  assert.deepEqual(effStats(h, v), [7, 9], 'vanilla 7/9 in play');
  const host = spawn(h, p, 'Brough');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'fire', 1);
  giveResources(h, p, 'earth', 11);                            // lr / 13
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Vengeance'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'inert donation, but a legal augment');
});

// ── CT-177: THE SCENARIO ITSELF, as a test ───────────────────────────────
//
// `docs/14` §6: a scenario the owner judges becomes the failing test that
// proves the fix. `vengeance-taxes-their-play` (server/scenarios-b.ts) was
// judged **broken** on 2026-08-27 and then judged **works** by the same owner
// twenty minutes later, on the same room, with the retraction written into
// var/verdicts.jsonl in his own words: *"That verdict was a misread: Sudden
// Bloom was taken for a targeted card, so the sacrifice prompt was read as a
// targeting prompt."* Room YNBP replays faithfully at HEAD and the clause
// fires exactly as the scenario predicts. The card was, and is, correct.
//
// This is here anyway, because the scenario's own `why` is right that no
// driver in the repo builds its board — and the ten tests above do not either.
// Every one of them taxes a spell that TARGETS (Flame of History), so the
// imposed cost is always the SECOND question and never stands alone. The
// scenario is deliberately the other case: Sudden Bloom is wood/1 and
// targetless, *"so the sacrifice is the only thing that happens"*. That is the
// board the misread happened on, and until now nothing held it.
//
// Seeds 4525-4526.

test('CT-177 Vengeance, the scenario board: an ATTACKING Vengeance taxes the defender\'s targetless play, and the defender pays', () => {
  const h = new Harness(4525);
  toDeployment(h);
  // scenario: initiative YOU; YOU hold the Vengeance, OPPONENT holds the card
  const you = h.state.deployPlayer!, opp = (1 - you) as Seat;
  const veng = spawn(h, you, 'Vengeance');
  const foretold = spawn(h, opp, 'The Foretold');
  const bubb = spawn(h, opp, 'Bubb');
  giveResources(h, opp, 'wood', 4);
  toNextBattle(h, you);
  // "Your Vengeance is attacking, so its text is standing in the battle it is
  // taxing" — R12, and the whole reason the tax reaches at all
  h.do({ type: 'declareAttack', seat: you, columns: [[veng]] });
  assert.equal(ent(h, veng)!.region, h.state.battle!.region,
    'the carrier stands in the region it is taxing');
  pass(h);                                     // "hand the window straight to seat 1"
  assert.equal(h.state.priority, opp, 'the opponent holds priority and plays the next card');

  // 1. "In the OPPONENT's tab, play Sudden Bloom."
  h.do({ type: 'playCard', seat: opp, handIndex: give(h, opp, 'Sudden Bloom') });

  // EXPECTED: "before that spell is allowed onto the stack they are asked to
  // SACRIFICE A UNIT, and offered their two — The Foretold and Bubb."
  const dec = h.state.decision;
  assert.ok(dec, 'the imposed cost is DEMANDED — a card that just plays for free is the '
    + 'first failure the scenario names ("the imposed cost is not being granted")');
  assert.equal(dec!.seat, opp, 'and demanded of the player who PLAYED it — the second failure '
    + 'the scenario names is being asked yourself, which would read "your opponents" from the '
    + 'wrong side. R284: a printed bracket is paid by the owner of the effect, and this '
    + 'bracket is granted to their card');
  assert.ok(dec!.prompt.includes('Sudden Bloom') && dec!.prompt.includes('sacrifice a unit')
    && dec!.prompt.includes('additional cost'),
    `the prompt says which card and which cost, standing alone: "${dec!.prompt}"`);
  assert.deepEqual(offered(h).sort(),
    [JSON.stringify({ unit: foretold }), JSON.stringify({ unit: bubb })].sort(),
    'exactly their two units — The Foretold and Bubb — and nothing of the taxing side\'s');
  // ⚠ THE MISREAD'S OWN GROUND: Sudden Bloom is targetless, so this is the
  // ONLY question the play raises. There is no target pick before it to be
  // confused with, and the ten tests above all have one.
  assert.equal(h.state.stack.length, 0,
    '"only then does Sudden Bloom go on the stack" — the cost is paid first, and a spell '
    + 'sitting on the stack while its cost is still owed is what "plays for free" looks like');

  // "Pick either; it dies to their bin"
  pick(h, { unit: bubb });
  assert.ok(!ent(h, bubb), 'the picked unit died');
  assert.ok(ent(h, foretold), 'and the other survived — it was a choice, not a tax on an only child');
  assert.ok(h.state.players[opp]!.bin.includes('Bubb'), 'to THEIR bin, not the taxing side\'s');
  assert.equal(h.state.players[you]!.bin.length, 0, 'the Vengeance side paid nothing');
  assert.equal(h.state.stack.length, 1, 'and only now is the spell on the stack');
  pass(h); pass(h);
  assert.deepEqual(effStats(h, foretold), [4, 4],
    'and it resolved: "[Switch] Your units gain +1/+1" on a 3/3 they still control');
  finishBattle(h);
});

test('CT-177 census: the two cards that impose a bracketed cost on somebody ELSE\'s play, and the clause that separates them', () => {
  const printed = JSON.parse(readFileSync(join(HERE, '../src/cards/printed.json'), 'utf8')) as
    Record<string, { name: string; text?: string }>;
  // Derived, not typed out: a printed bracket whose body is a COST verb, in a
  // sentence about cards being PLAYED. Trench Stalker prints "[Discard two
  // cards]" as its own cast cost and says "I can be played", so the play it
  // names is its own — the filter keeps it and the second clause drops it.
  const imposers = Object.values(printed)
    .filter(c => /\[(Pay|Sacrifice|Discard|Erase|Gain)[^\]]*\]/i.test(c.text ?? '')
      && /\bcards?\b[^.]*\bplay(ed|s)?\b/i.test(c.text ?? '')
      && !/\bI can be played\b/i.test(c.text ?? ''))
    .map(c => c.name)
    .sort();
  assert.deepEqual(imposers, ['Arbiter of Armistice', 'Vengeance'],
    'a new card that hangs a bracketed additional cost on a play somebody else makes belongs '
    + 'in this drill — that channel (CostMod.life / CostMod.sacrifice) is reachable only from '
    + 'a board no play-through builds, which is how the whole family stayed unobserved');

  // The two differ on exactly the clause the retracted verdict was about, and
  // the difference is visible in one query rather than in a play-through.
  const h = new Harness(4526);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Vengeance');
  spawn(h, A, 'Arbiter of Armistice');
  // D attacks INTO A's home, so the battle is fought where both carriers
  // stand — R12, the same reason the scenario has to make its Vengeance ATTACK
  toNextBattle(h, D);
  const region = h.state.battle!.region;
  assert.equal(region, h.q.homeRegion(A), 'the battle is in the region the two carriers are in');
  const q = h.q;
  // "Cards YOUR OPPONENTS play" — one side only
  assert.equal(q.unitsToPlay(D, 'Sudden Bloom', { region }), 1, 'the opponent is taxed');
  assert.equal(q.unitsToPlay(A, 'Sudden Bloom', { region }), 0,
    'and its own controller is not — "your opponents", read from the right side');
  // "Cards played during battle" — unqualified, so BOTH sides, its own included
  assert.equal(q.lifeToPlay(D, 'Sudden Bloom', { region }), 2, 'the Arbiter taxes them');
  assert.equal(q.lifeToPlay(A, 'Sudden Bloom', { region }), 2,
    'and taxes its own controller too — the printed text has no "your opponents" in it, and '
    + 'copying Vengeance\'s seat test onto it would be the same bug in the other direction');
});
