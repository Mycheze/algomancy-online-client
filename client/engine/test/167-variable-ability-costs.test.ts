/* R196 — VARIABLE AND CHOICE-BEARING ACTIVATION COSTS ARE PAID AT ACTIVATION.
 *
 * The last of `docs/16-divergence-inventory.md` §2a's cost rows. Six cards
 * print a cost that `AbilityCost` could not express — an X-mana "[x]",
 * "Sacrifice X units", "Discard X cards", "Recall another ally", "Erase one of
 * my mods" — so every one of them was chosen and PAID AT RESOLUTION. Measured
 * before the fix, in battle, with the ability on the stack and the opponent
 * holding priority: the mana was still open, the units were still standing,
 * the hand was still full and `parts[0].costPaid` was null. THE OPPONENT
 * RESPONDED BLIND — they had to decide whether to answer a "base X/X" without
 * knowing X, and a negation removed the ability without a single point of it
 * ever being paid.
 *
 * That is R64's founding complaint, one card family over. The playtest report
 * it was raised on, verbatim: *"Shouldn't Discharge have you remove counters
 * as an additional cost? Not on resolution"*. And R157 §21 settles the general
 * shape: ANY `[bracketed]` clause is a COST or a MODE, fixed when the item
 * goes on the stack — never a sum, never a resolution-time pick.
 *
 * HOW THE FIX RELATES TO THE X-SPELL CAST PATH. There are TWO X's in this
 * engine and they meet in `E.collectTargets`:
 *
 *   · an X SPELL's X is the printed `mana: 'X'` on the CARD. `E.collectX`
 *     prices each candidate through `manaToPlay` and pays the whole bill on
 *     the answer, writing `StackItem.x`. It runs inside `castChain`, i.e.
 *     AFTER `playAtTiming`'s `take(); payAll();` — which is why a cost mod
 *     that wants to raise an X spell TO 3 (Stasis Sentry, R157 §20) needed an
 *     engine seam rather than a card change, and why the paid X rides the play
 *     EVENT as well as the item (Floral Singularity is `timing: deploy` and is
 *     never pushed, so a stack lookup could not find it).
 *   · an ABILITY's X is a BRACKETED COST — there is no card being played and
 *     no mana bill to modify. It goes where every other bracketed cost already
 *     goes: `EffectDef.castCost` with `n: 'X'`, collected by
 *     `E.collectCastCosts(…, 'variable')`, landing in `costPaid.x` and read
 *     back as `ctx.x`.
 *
 * So this row did NOT need a second variable machinery bolted onto
 * `AbilityCost`. Two of the six cards close with NO new engine code at all
 * (Glook and Infernal Cultivator are `discardCard`/`sacrificeUnits` with
 * `n: 'X'`, which already existed); the other four needed three new
 * `CastCost` kinds — `payMana`, `recallUnit`, `eraseMod` — plus
 * `AbilityCost.sacrificeNontoken`.
 *
 * ⚠ THE COMPOUND HALF-PAY. `collectItemCosts` carried a documented latent bug:
 * the choice-free half of an activation cost is charged one collector EARLIER
 * than the choice-bearing half, so a compound cost could pay its mana and then
 * declare "nothing is paid". Instrument of Reassignment, Auric Ascendant and
 * Slag Spewer are all compound now. It is fixed at the root, with R110's own
 * rule one scope up: `E.gateCompoundCost` asks ALL OR NOTHING at the top of
 * the cast window, before any collector has charged anything. The last test
 * here is that gate, and it also measures WHY the audit's own scenario ("a
 * response took the last unit") was never reachable.
 *
 * Every test drives the real reducer path, in BATTLE, with the opponent
 * holding priority over a live stack — the only place where "paid at
 * activation" and "paid at resolution" are distinguishable at all. (In
 * deployment an activated ability is committed with `then: 'resolve'` and
 * never reaches a stack, which is why the pre-existing per-card tests could
 * not see this bug.) Seeds: 16700-16799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { EntityId, Seat, StackItem } from '../src/types.ts';
import {
  effStats, ent, give, giveResources, offered, ownAttrs, pass, pick, spawn,
  toDeployment, tokensOf, toNextBattle, unitsOf, absorb,
} from './util.ts';

const fireballs = (h: Harness, seat: Seat) => tokensOf(h, seat).filter(t => t.card === 'Fireball');

const open = (h: Harness, seat: Seat): number => new E(h.state).openMana(seat);

/** a real UNIT TOKEN in `seat`'s home region — `util.spawn` puts a real CARD
 * into play, so a card called "Unit Token" spawned that way is not a token at
 * all and would be a perfectly legal "sacrifice a nontoken unit" victim. */
function spawnToken(h: Harness, seat: Seat): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [1, 1] });
  e.settle();
  return u.id;
}

/**
 * A battle in the DEFENDER's region with the defender holding priority: the
 * activator is D, everything D controls is in the battle region (R12), and A
 * is the opponent who will be asked to respond.
 */
function battle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  return { h, A, D, atk } as unknown as { h: Harness; A: Seat; D: Seat };
}

/** …and open the priority window, once every unit is on the board. */
function joinBattle(h: Harness, A: Seat, D: Seat): void {
  toNextBattle(h, A);
  const atk = unitsOf(h, A).find(u => u.card === 'Unit Token')!;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk.id]] });
  for (let guard = 4; h.state.priority !== D && guard-- > 0;) pass(h);
  assert.equal(h.state.priority, D, 'the activator holds priority');
}

/** the one item on the stack — what BOTH seats can read, because the stack is
 * public in battle (server/view.ts: "stack is public because it exists to be
 * responded to"). Its `parts[0].costPaid` is the receipt of what was paid. */
function onStack(h: Harness): StackItem {
  assert.equal(h.state.stack.length, 1, 'exactly one item is on the stack');
  return h.state.stack[0]!;
}
const receipt = (h: Harness): NonNullable<StackItem['parts'][number]['costPaid']> => {
  const paid = onStack(h).parts[0]!.costPaid;
  assert.ok(paid, 'the item carries a COST RECEIPT — the cost was paid on the way to the stack');
  return paid!;
};

/** THE MOMENT THIS WHOLE FILE IS ABOUT: pushing an item onto the stack hands
 * priority straight to the opponent, so this is where they decide whether to
 * answer. Before R196 they decided it against an ability whose size was not
 * yet chosen; the per-card tests read the receipt here. */
function opponentResponds(h: Harness, A: Seat): void {
  assert.equal(h.state.priority, A, 'the opponent holds priority over the live ability');
  assert.equal(h.state.stack.length, 1, 'and it is still on the stack, unresolved');
  assert.equal(h.state.decision, null, 'with nothing left for the payer to answer');
}

/** both seats pass — the ability resolves. */
function resolve(h: Harness): void { pass(h); pass(h); }

// ── 1. Celestial Shifter ────────────────────────────────────────────────
//
// "[Augment] [x]: I become base X/X until regroup."

test('R196 Celestial Shifter "[Augment] [x]: I become base X/X until regroup" — the [x] is paid at ACTIVATION and the opponent sees X', () => {
  const { h, A, D } = battle(16701);
  const sh = spawn(h, D, 'Celestial Shifter');                // 2/2
  giveResources(h, D, 'metal', 5);
  joinBattle(h, A, D);

  assert.equal(open(h, D), 5, 'five open before the activation');
  h.do({ type: 'activateAbility', seat: D, entityId: sh, abilityIndex: 0, via: 'augment' });
  // the [x] is a bracketed cost, paid a point at a time like every other
  // variable cost in the pool, with "that's enough" always on the table (xMin 0)
  assert.deepEqual(offered(h), ['{"payMana1":true}', '{"doneCost":true}'],
    'the cast window asks for the cost, not the resolution');
  for (let k = 0; k < 3; k++) pick(h, { payMana1: true });
  pick(h, { doneCost: true });                                // X = 3

  // THE PAYMENT HAS ALREADY HAPPENED, and the item has not resolved
  assert.equal(open(h, D), 2, 'three mana are GONE before anybody may respond');
  assert.equal(receipt(h).mana, 3, 'the receipt says [3] was paid');
  assert.equal(receipt(h).x, 3, 'and that R157 §1 X — what was actually paid — is 3');
  assert.deepEqual(effStats(h, sh), [2, 2], 'still a printed 2/2: nothing has resolved yet');

  opponentResponds(h, A);
  assert.equal(onStack(h).parts[0]!.costPaid!.x, 3,
    'the responding seat can read X = 3 off the public stack BEFORE deciding');

  resolve(h);
  assert.deepEqual(effStats(h, sh), [3, 3], 'base X/X, with X the number that was paid');
});

// ── 2. Instrument of Reassignment ───────────────────────────────────────
//
// "[Augment] [x], Sacrifice another nontoken unit: Create a Robot X.
//  X can't be 0."

test('R196 Instrument of Reassignment "[x], Sacrifice another nontoken unit: Create a Robot X. X can\'t be 0." — both halves paid at ACTIVATION', () => {
  const { h, A, D } = battle(16702);
  const inst = spawn(h, D, 'Instrument of Reassignment');
  const slime = spawn(h, D, 'Lurking Slimebeast');            // the nontoken victim
  const tok = spawnToken(h, D);                               // a TOKEN — never a legal victim
  giveResources(h, D, 'metal', 3);
  joinBattle(h, A, D);

  h.do({ type: 'activateAbility', seat: D, entityId: inst, abilityIndex: 0, via: 'augment' });
  // "X can't be 0" is `xMin: 1` — a floor that FORBIDS, so at X = 0 there is
  // no way to stop (contrast R157 §22/R161's warning-only `xZeroWarning`)
  assert.deepEqual(offered(h), ['{"payMana1":true}'],
    "X can't be 0: stopping at zero is not on the menu");
  pick(h, { payMana1: true });
  pick(h, { payMana1: true });
  assert.ok(offered(h).includes('{"doneCost":true}'), 'above the floor, stopping is legal again');
  pick(h, { doneCost: true });                                // X = 2
  assert.equal(open(h, D), 1, 'the [x] is spent already');

  // …then the choice-bearing half, in the same window
  assert.deepEqual(offered(h), [`{"unit":${slime}}`],
    'only ANOTHER NONTOKEN unit is offered — not the carrier, not the token');
  pick(h, { unit: slime });

  assert.ok(!ent(h, slime), 'the victim is dead before anybody may respond');
  assert.ok(ent(h, tok), 'the token was never eligible');
  assert.equal(receipt(h).x, 2, 'the item carries X = 2');
  assert.deepEqual(onStack(h).paidCosts?.sacrificed, ['Lurking Slimebeast'],
    'and names what was sacrificed for it');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Robot').length, 0, 'no Robot yet');

  opponentResponds(h, A);
  assert.equal(onStack(h).parts[0]!.costPaid!.x, 2,
    'the responder can see a Robot 2 coming, not an unknown Robot X');

  resolve(h);
  const robot = unitsOf(h, D).find(u => u.card === 'Robot')!;
  assert.ok(robot, 'a Robot arrives');
  assert.equal(robot.counters, 2, 'a Robot X, with X the number that was paid');
});

// ── 3. Auric Ascendant ──────────────────────────────────────────────────
//
// "[once] [one], Recall another ally: I gain {g}flying and +2/+0 until
//  regroup."

test('R196 Auric Ascendant "[once] [one], Recall another ally: I gain {Flying} and +2/+0" — the RECALL is a cost, named before the opponent answers', () => {
  const { h, A, D } = battle(16703);
  const auric = spawn(h, D, 'Auric Ascendant');               // 2/1
  const ally = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 1);
  joinBattle(h, A, D);

  h.do({ type: 'activateAbility', seat: D, entityId: auric, abilityIndex: 0 });
  assert.equal(open(h, D), 0, 'the [one] was charged in the cast window (it always was)');
  assert.deepEqual(offered(h), [`{"recall":${ally}}`],
    'and the RECALL is now asked in the same window — "another", so never the carrier');
  pick(h, { recall: ally });

  assert.ok(!ent(h, ally), 'the ally is back in hand before anybody may respond');
  assert.deepEqual(receipt(h).recalled?.map(r => r.card), ['Unit Token'],
    'the item names which ally paid for it');
  assert.ok(!ownAttrs(h, auric).has('Flying'), 'the effect has not happened yet');

  opponentResponds(h, A);
  assert.deepEqual(onStack(h).parts[0]!.costPaid!.recalled?.map(r => r.card), ['Unit Token'],
    'the responder sees a cost already paid — answering the ability cannot un-recall it');

  resolve(h);
  assert.ok(ownAttrs(h, auric).has('Flying'), 'gained {Flying}');
  assert.deepEqual(effStats(h, auric), [4, 1], '+2/+0 until regroup');
});

test('R196 Auric Ascendant with no other ally is NOT OFFERED — an unpayable cost gates, it does not whiff (R49)', () => {
  // ⚠ THIS IS A DELIBERATE CHANGE OF WHEN THE [once] IS SPENT. The run used to
  // carry a "no other ally to recall — no effect" branch, and R113 put it in
  // the SPENDS family: you activated it and whiffed. A COST cannot whiff. With
  // nothing to recall the ability is not offered, the [one] is never paid and
  // the use is never spent — the same answer `canPayCastCost` already gives
  // Deformant's "sacrifice me AND another ally".
  const { h, A, D } = battle(16704);
  const auric = spawn(h, D, 'Auric Ascendant');
  giveResources(h, D, 'water', 1);
  joinBattle(h, A, D);

  const offers = () => h.legal(D).filter(a => a.type === 'activateAbility' && a.entityId === auric);
  assert.equal(offers().length, 0, 'no other ally — the activation is not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: auric, abilityIndex: 0 }),
    /nothing it can be used on/, 'and it is refused, not merely unoffered');
  assert.equal(open(h, D), 1, 'NOTHING was paid');
  assert.equal(ent(h, auric)!.budgets['ability:Auric Ascendant#0'] ?? 0, 0,
    'and the [once] is still there to be used when an ally shows up');

  // give it an ally and the same ability is live again
  const ally = spawn(h, D, 'Unit Token');
  assert.equal(offers().length, 1, 'with another ally the cost is payable and it is offered');
  h.do({ type: 'activateAbility', seat: D, entityId: auric, abilityIndex: 0 });
  pick(h, { recall: ally });
  assert.ok(!ent(h, ally));
});

// ── 4. Slag Spewer ──────────────────────────────────────────────────────
//
// "[Augment][once] [one], Erase one of my mods: I deal 2 damage to any
//  target."

test('R196 Slag Spewer "[Augment][once] [one], Erase one of my mods: I deal 2 damage to any target" — the mod is erased at ACTIVATION, after the target is declared (R57)', () => {
  const { h, A, D } = battle(16705);
  const spewer = spawn(h, D, 'Slag Spewer');
  const victim = spawn(h, D, 'Unit Token');                   // the 2 damage kills it
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'earth', 1);
  giveResources(h, D, 'fire', 2);                             // A Pile of Runes be/3, then [one]
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'A Pile of Runes'), hostId: spewer });
  const modId = ent(h, spewer)!.mods[0]!;
  joinBattle(h, A, D);

  h.do({ type: 'activateAbility', seat: D, entityId: spewer, abilityIndex: 0, via: 'augment' });
  // R57 is preserved and visible in the collector order: the TARGET is chosen
  // before the mod is spent, because a FIXED castCost is collected after
  // `collectPartTargets`. You never lose the mod to a misclick you can't aim.
  assert.ok(offered(h).includes(`{"unit":${victim}}`), 'the damage target comes first (R57)');
  pick(h, { unit: victim });
  assert.equal(ent(h, spewer)!.mods.length, 1, 'the mod is still on — the cost is not paid yet');
  assert.deepEqual(offered(h), [`{"eraseMod":${modId}}`],
    '"one of MY mods" — the SOURCE\'s mods, nobody else\'s');
  pick(h, { eraseMod: modId });

  assert.equal(ent(h, spewer)!.mods.length, 0, 'the mod is gone before anybody may respond');
  assert.ok(!ent(h, modId), 'erased outright — no bin, no death, no despawn');
  assert.ok(!h.state.players[D]!.bin.includes('A Pile of Runes'), 'erased, not binned');
  assert.deepEqual(receipt(h).erasedMods?.map(m => m.card), ['A Pile of Runes'],
    'the receipt names the mod that paid');
  assert.ok(ent(h, victim), 'no damage yet — that is the EFFECT, not the cost');

  opponentResponds(h, A);
  assert.deepEqual(onStack(h).parts[0]!.costPaid!.erasedMods?.map(m => m.card), ['A Pile of Runes'],
    'the responder can see the price has already been paid');

  resolve(h);
  assert.ok(!ent(h, victim), 'the 2 damage killed the 1/1');
});

// ── 5. Glook ────────────────────────────────────────────────────────────
//
// "[once] Discard X cards: Glimpse 1, X times."

test('R196 Glook "[once] Discard X cards: Glimpse 1, X times" — X cards leave the hand at ACTIVATION', () => {
  const { h, A, D } = battle(16706);
  const glook = spawn(h, D, 'Glook');
  joinBattle(h, A, D);
  const hand0 = h.state.players[D]!.hand.slice();   // AFTER the turn's draw step
  assert.ok(hand0.length >= 2, 'the hand is big enough to pay with');

  h.do({ type: 'activateAbility', seat: D, entityId: glook, abilityIndex: 0 });
  assert.ok(offered(h).includes('{"discard":0}'), 'the discards are the COST collector\'s question');
  pick(h, { discard: 0 });
  pick(h, { discard: 0 });
  pick(h, { doneCost: true });                                // X = 2

  assert.equal(h.state.players[D]!.hand.length, hand0.length - 2,
    'two cards are gone from hand before anybody may respond');
  assert.ok(h.state.players[D]!.bin.includes(hand0[0]!), 'each discard is still a TRASH (R40)');
  assert.ok(h.state.players[D]!.bin.includes(hand0[1]!));
  assert.equal(receipt(h).x, 2, 'X = the cards actually paid');
  assert.equal(h.q.cache(D).length, 0, 'and nothing has been glimpsed yet');

  opponentResponds(h, A);
  assert.equal(onStack(h).parts[0]!.costPaid!.x, 2,
    'the responder knows two glimpses are coming, not "some"');

  resolve(h);
  assert.equal(h.q.cache(D).length, 2, '"Glimpse 1, X times" — X separate glimpses (R45)');
  assert.equal(h.q.cachePermission(D, 0), 'glimpse', 'playable until end of turn (R45)');
});

// ── 6. Infernal Cultivator ──────────────────────────────────────────────
//
// "[Augment] [once] Sacrifice X units: Create X Fireball 1."

test('R196 Infernal Cultivator "[Augment] [once] Sacrifice X units: Create X Fireball 1" — the units die at ACTIVATION, so a negation cannot refund them', () => {
  const { h, A, D } = battle(16707);
  const cult = spawn(h, D, 'Infernal Cultivator');
  const f1 = spawn(h, D, 'Conduit of Pain');
  const f2 = spawn(h, D, 'Conduit of Pain');
  joinBattle(h, A, D);

  h.do({ type: 'activateAbility', seat: D, entityId: cult, abilityIndex: 0, via: 'augment' });
  // the printed line is "Sacrifice X units", not "X OTHER units", so the
  // carrier is on its own menu — as it was in the resolution-time loop
  assert.ok(offered(h).includes(`{"unit":${cult}}`), 'the carrier may pay for its own ability');
  pick(h, { unit: f1 });
  pick(h, { unit: f2 });
  pick(h, { doneCost: true });                                // X = 2

  assert.ok(!ent(h, f1) && !ent(h, f2), 'both are dead before anybody may respond');
  assert.equal(h.state.players[D]!.bin.filter(n => n === 'Conduit of Pain').length, 2);
  assert.equal(receipt(h).x, 2, 'X = the units actually paid');
  assert.equal(fireballs(h, D).length, 0, 'no Fireballs yet');

  opponentResponds(h, A);
  assert.equal(onStack(h).parts[0]!.costPaid!.x, 2,
    'the responder is answering a KNOWN two Fireballs — R64\'s whole point');

  resolve(h);
  const fires = fireballs(h, D);
  assert.equal(fires.length, 2, 'X Fireballs created');
  assert.ok(fires.every(t => t.x === 1), 'each is a Fireball 1');
});

// ── 7. THE COMPOUND COST, and the half-pay hazard it would have hit ─────

test('R196 the COMPOUND half-pay hazard: an unpayable half of Instrument of Reassignment\'s cost pays NOTHING, neither the mana nor the unit', () => {
  // `collectItemCosts` carried this note for a year: "nothing is paid holds
  // ONLY because no pool ability combines a choice-free half (charged by
  // payActivationCost one call EARLIER) with a choice half like this one. The
  // first card that does will reach here with its mana already spent."
  //
  // Instrument of Reassignment is now exactly that card — a variable `payMana`
  // castCost charged by one collector and a `sacrificeOther` atom by another.
  // The invariant that replaces the note is ALL OR NOTHING, and it is checked
  // BEFORE the first collector charges: with either half unpayable the
  // activation is refused and neither half is taken.
  const inst = getCard('Instrument of Reassignment').augmentText![0]!;
  assert.equal(inst.type, 'activated');
  assert.equal(inst.effect.castCost?.kind, 'payMana', 'the [x] half is a variable castCost');
  assert.equal(inst.cost.sacrificeOther, 1, 'and the sacrifice half is a pendingCosts atom');
  assert.ok(inst.cost.sacrificeNontoken, 'narrowed to nontoken units, as printed');

  // (a) mana but NO legal victim — the [x] must not be charged
  {
    const { h, A, D } = battle(16708);
    const i = spawn(h, D, 'Instrument of Reassignment');
    spawnToken(h, D);                                         // a token: not a legal victim
    giveResources(h, D, 'metal', 3);
    joinBattle(h, A, D);
    assert.equal(h.legal(D).filter(a => a.type === 'activateAbility' && a.entityId === i).length, 0,
      'no nontoken unit to sacrifice — not offered');
    assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: i, abilityIndex: 0, via: 'augment' }),
      /cannot pay the activation cost/);
    assert.equal(open(h, D), 3, 'the mana is untouched — this is the half-pay that used to be possible');
    assert.equal(h.state.stack.length, 0, 'and no item reached the stack');
  }
  // (b) a victim but NO mana — "X can't be 0", so the unit must not die either
  {
    const { h, A, D } = battle(16709);
    const i = spawn(h, D, 'Instrument of Reassignment');
    const slime = spawn(h, D, 'Lurking Slimebeast');
    joinBattle(h, A, D);
    assert.equal(h.legal(D).filter(a => a.type === 'activateAbility' && a.entityId === i).length, 0,
      "no open mana and X can't be 0 — not offered");
    assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: i, abilityIndex: 0, via: 'augment' }),
      /nothing it can be used on/);
    assert.ok(ent(h, slime), 'the victim is alive — nothing was paid');
  }
});

test('R196 the compound-cost GATE: a compound activation cost whose choice-bearing half is unpayable charges NEITHER half', () => {
  // The seam itself, white-box, because no card in the pool can reach it
  // through the reducer — see the next test for why. It is worth an engine
  // test all the same: this is the exact state the 2026-08-23 audit note
  // described, and it is the one the fix has to answer.
  //
  // A compound activation cost: [one] (choice-free, charged by
  // `payActivationCost`) plus "sacrifice another unit" (choice-bearing,
  // collected one call LATER by `collectItemCosts`) — on a board where the
  // controller has no other unit to sacrifice.
  const { h, A, D } = battle(16711);
  const src = spawn(h, D, 'Glook');                           // any body: it is the SOURCE, not the payer
  giveResources(h, D, 'dark', 1);
  joinBattle(h, A, D);
  assert.equal(unitsOf(h, D).length, 1, 'the source is the only unit — nothing else to sacrifice');
  assert.equal(open(h, D), 1, 'and exactly [1] is open');

  const e = new E(h.state);
  const item: StackItem = {
    id: 990001, kind: 'activated', card: 'Glook',
    label: 'a compound activation cost', controller: D, region: e.homeRegion(D),
    negated: false, parts: [], sourceId: src, event: null,
    activationCost: { mana: 1 },                              // the choice-free half
    pendingCosts: [{ kind: 'sacrificeOther', n: 1 }],         // the choice-bearing half
  };
  e.collectTargets(item, 'push', []);
  h.state = e.s;
  absorb(h, e.events);

  assert.equal(open(h, D), 1,
    'THE MANA IS UNTOUCHED. Without the gate `payActivationCost` charges it one call '
    + 'before `collectItemCosts` discovers there is nothing to sacrifice, and the log '
    + 'then says "nothing is paid" about a seat that is [1] poorer.');
  assert.equal(item.activationCost, undefined, 'and neither half is left pending');
  assert.equal(item.pendingCosts, undefined);
  assert.ok(h.log.some(l => /can no longer be paid/.test(l)), 'the abandonment is announced');
});

test('R196 nothing may act INSIDE the cast window — which is why the audit\'s "a response took the last unit" was never reachable', () => {
  // The 2026-08-23 note imagined the opponent removing the payment between the
  // activation gate and the collection. They cannot: every suspension the cast
  // window raises is a question for the PAYER, triggers only queue (settle()
  // runs after castChain), and the opponent never holds priority in between.
  // What CAN make a later half unpayable is the payer's OWN earlier atom
  // eating its pool — which is why `E.gateCompoundCost` asks all-or-nothing up
  // front rather than trusting the activation gate to hold.
  const { h, A, D } = battle(16710);
  const inst = spawn(h, D, 'Instrument of Reassignment');
  spawn(h, D, 'Lurking Slimebeast');
  giveResources(h, D, 'metal', 2);
  joinBattle(h, A, D);

  h.do({ type: 'activateAbility', seat: D, entityId: inst, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision!.seat, D, 'the pending question belongs to the payer');
  assert.deepEqual(h.legal(A), [],
    'the opponent has NO legal action while the cast window is open — no response can '
    + 'take the payment away between one collector and the next');
  assert.equal(h.state.stack.length, 0,
    'and the item is not on the stack yet, so it cannot be negated mid-payment either');
});

test('R196 a variable "[x]" cannot eat the ability\'s own R121 tax — Celestial Shifter under a Crevice Lurker', () => {
  // `collectCastCosts('variable')` runs BEFORE `payActivationCost`, so without
  // a reserve the payer could put every open point into X and leave the tax
  // unpayable. `E.activationManaReserve` holds back exactly what the fixed
  // half still owes — here [0] printed + [1] Crevice Lurker.
  const { h, A, D } = battle(16712);
  const lurker = spawn(h, A, 'Crevice Lurker');               // taxes D's activations +1 in battle
  const sh = spawn(h, D, 'Celestial Shifter');
  giveResources(h, D, 'metal', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lurker]] });   // the Lurker joins the battle
  for (let guard = 4; h.state.priority !== D && guard-- > 0;) pass(h);
  assert.equal(h.q.abilityTax(D, 'Celestial Shifter', h.state.battle!.region, 'activate').total, 1,
    'the activation is taxed [1]');

  h.do({ type: 'activateAbility', seat: D, entityId: sh, abilityIndex: 0, via: 'augment' });
  assert.deepEqual(offered(h), ['{"payMana1":true}', '{"doneCost":true}']);
  for (let k = 0; k < 3; k++) pick(h, { payMana1: true });     // X = 3 of the 4 open
  assert.equal(h.state.decision, null,
    'the fourth point is RESERVED for the tax, so there is nothing left to offer — X '
    + 'cannot be raised into it and the cost closes itself at 3');

  assert.equal(open(h, D), 0, 'X = 3 plus the [1] tax spends all four');
  assert.equal(receipt(h).x, 3, 'and X is 3, not 4');
  resolve(h);
  assert.deepEqual(effStats(h, sh), [3, 3], 'base 3/3');
});

// ── 8. the row itself: no card in the six still pays at resolution ──────

test('R196 all six inventory cards declare a real cost — none of them chooses one at resolution', () => {
  // The inventory row named these six and said `AbilityCost` atoms are fixed-N,
  // so all of them paid at RESOLUTION. Read off the CARDS, so a seventh added
  // next month is measured too rather than a list being edited.
  const six: [string, 'abilities' | 'augmentText', string][] = [
    ['Celestial Shifter', 'augmentText', 'payMana'],
    ['Instrument of Reassignment', 'augmentText', 'payMana'],
    ['Auric Ascendant', 'abilities', 'recallUnit'],
    ['Slag Spewer', 'augmentText', 'eraseMod'],
    ['Glook', 'abilities', 'discardCard'],
    ['Infernal Cultivator', 'augmentText', 'sacrificeUnits'],
  ];
  const bad: string[] = [];
  for (const [name, where, kind] of six) {
    const ab = getCard(name)[where]![0]!;
    if (ab.type !== 'activated') { bad.push(`${name}: not an activated ability`); continue; }
    if (ab.effect.castCost?.kind !== kind) {
      bad.push(`${name}: castCost is ${ab.effect.castCost?.kind ?? 'MISSING'}, wanted ${kind}`);
    }
    // the tell of the old shape: the run body asking for the cost itself
    if (/ctx\.choose|payMana\(|payOrDecline/.test(ab.effect.run.toString())) {
      bad.push(`${name}: its run still asks for / charges its own cost at resolution`);
    }
  }
  assert.deepEqual(bad, [],
    'these are the six cards of the VARIABLE-COST ACTIVATED ABILITIES row of\n'
    + 'docs/16-divergence-inventory.md §2a. A cost belongs in the cast window (R157 §21);\n'
    + 'a `ctx.choose` in one of these runs is the divergence coming back.');
});
