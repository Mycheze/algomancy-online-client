/**
 * THREE ENGINE DEFECTS, FOUND BY THE 2026-08-23 AUDIT — CARD-TODO #16/#17/#18.
 *
 * All three are one level BELOW the cards, which is why each of them had
 * already been patched on two or three individual carriers without ever being
 * fixed. The rule this file exists to enforce is the repo's own: a fix that is
 * applied card-by-card is a bug that comes back.
 *
 *   #16  an empty non-combat damage batch resolved in total silence.
 *   #17  playing another player's card out of their bin made you its OWNER.
 *   #18  a [once] budget was spent when the trigger was QUEUED, so an ability
 *        that was never even asked still burnt it.
 *
 * WHAT IS ASSERTED. State, and the engine's own event vocabulary — never log
 * prose. Two of these three are ABOUT the log, and the temptation to grep a
 * sentence is exactly how the earlier fixes rotted: the assertion is "an event
 * was emitted, with these fields", not "it said this".
 *
 * And nothing here is `{ todo: true }`. A todo can never fail, which is how a
 * dead card survived two playtest reports and a conceded game.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { spawn, toDeployment, giveResources } from './util.ts';
import type { EngineEvent, Entity, Seat, StackItem } from '../src/types.ts';

// ── the rig ─────────────────────────────────────────────────────────────

/** a real game walked to deployment, with a body on each side */
function board(seed: number): { g: E; h: Harness; A: Seat; D: Seat; mine: Entity; theirs: Entity } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const a = spawn(h, A, 'Tidal Menace');
  const d = spawn(h, D, 'The Foretold');
  const g = new E(h.state);
  return { g, h, A, D, mine: g.entity(a)!, theirs: g.entity(d)! };
}

/** a real game at deployment with NOTHING on the board */
function emptyBoard(seed: number): { g: E; h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const g = new E(h.state);
  return { g, h, A, D: (1 - A) as Seat };
}

/** run one EffectDef against a live game and return the events IT emitted */
function resolve(
  def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat },
  answers: Record<string, unknown> = {},
): EngineEvent[] {
  const before = g.events.length;
  def.run(g, {
    sourceName: 'test',
    region: g.homeRegion(ctx.controller),
    targets: [],
    event: null,
    eraseSelf: () => {},
    choose: (key, dec) => (key in answers ? answers[key] : dec.options[0]!.value),
    ...ctx,
  } as EffectCtx);
  return g.events.slice(before);
}

/** the ctx a bare `dealEffectDamageAll` probe needs */
function damageCtx(g: E, seat: Seat, sourceName: string): EffectCtx {
  return {
    controller: seat, sourceName, region: g.homeRegion(seat), targets: [], event: null,
    eraseSelf: () => {},
    choose: () => { throw new Error('a damage probe must not raise a decision'); },
  } as unknown as EffectCtx;
}

// ════════════════════════════════════════════════════════════════════════
// CARD-TODO #16 — AN EMPTY DAMAGE BATCH
// ════════════════════════════════════════════════════════════════════════
//
// The measurement that found it: `dealEffectDamageAll(ctx, [])` against a live
// state emitted ZERO events. Every "I deal N damage to each opponent / each
// enemy unit" card builds a hit list and hands it over, so with no opponent in
// the region (R25) or no enemy unit on the board the card resolved, the mana
// was spent and the log was blank.
//
// The fix is ONE line in the engine, at the top of the method, keyed on
// `hits.length` rather than on `order.length` — see the comment there for why
// that is the place the three shapes are distinguishable.

test('a damage batch handed an empty hit list announces that there was nothing to damage', () => {
  const { g, A } = board(9300);
  const before = g.events.length;
  g.dealEffectDamageAll(damageCtx(g, A, 'Immolate'), []);
  const evs = g.events.slice(before);
  assert.ok(evs.length > 0,
    'an empty batch emitted NOTHING. The card resolves, the mana is spent and the log is '
    + 'blank — the player cannot tell a rule from a bug.');
  assert.ok(evs.some(e => e.data?.['empty'] === true && e.data?.['source'] === 'Immolate'),
    'the announcement must name its source in the event payload, so the UI and the log '
    + 'reader both learn WHICH card did nothing');
});

test('a damage batch with a real hit list still deals its damage and fires a damage event', () => {
  // the fix may not be "announce everything and stop doing the thing"
  const { g, A, theirs } = board(9301);
  const before = g.events.length;
  g.dealEffectDamageAll(damageCtx(g, A, 'Immolate'), [{ target: theirs, n: 2 }]);
  const evs = g.events.slice(before);
  assert.equal(g.entity(theirs.id)!.damage, 2, 'the damage really landed');
  assert.ok(evs.some(e => e.type === 'damage' && e.data?.['unit'] === theirs.id),
    'a real hit still fires a damage event');
  assert.deepEqual(evs.filter(e => e.data?.['empty'] === true), [],
    'a batch that dealt damage must NOT also claim there was nothing to damage');
});

test('a damage batch whose every hit computed zero damage stays silent', () => {
  // NOT the bug: the card decided the amount, and it is the card's business to
  // explain a deliberate zero (Siphon Life for X = 0 does exactly that).
  const { g, A, theirs } = board(9302);
  const before = g.events.length;
  g.dealEffectDamageAll(damageCtx(g, A, 'Immolate'), [{ target: theirs, n: 0 }]);
  assert.equal(g.events.length, before,
    'a batch whose hits were all n <= 0 is not an empty batch — the engine must not '
    + 'announce "nothing to damage" over a card that computed a zero on purpose');
  assert.equal(g.entity(theirs.id)!.damage, 0, 'and nothing was dealt');
});

test('a fully prevented damage batch reports only the prevention, never emptiness', () => {
  // R98: prevented damage was never DEALT, and `preventUnitDamage` already logs
  // itself. Prevention runs after the empty check, so a prevented batch can
  // never be mistaken for an empty one.
  const { g, A, theirs } = board(9303);
  g.entity(theirs.id)!.damageShield = 'Phytochemical Protection';
  const before = g.events.length;
  g.dealEffectDamageAll(damageCtx(g, A, 'Immolate'), [{ target: theirs, n: 3 }]);
  const evs = g.events.slice(before);
  assert.deepEqual(evs.filter(e => e.data?.['empty'] === true), [],
    'a prevented batch is not an empty batch — R98 says it was never dealt, not that '
    + 'there was nobody to deal it to');
  assert.ok(evs.some(e => e.data?.['prevented'] === 3),
    'the prevention itself is still reported');
  assert.deepEqual(evs.filter(e => e.type === 'damage'), [],
    'and no damage event fired: "if there is not damage being dealt, then no counters '
    + 'are placed"');
  assert.equal(g.entity(theirs.id)!.damage, 0, 'no damage was marked');
});

test('Meteor Shower with no unit anywhere to hit announces each empty rockfall', () => {
  // A REAL CARRIER that was never patched card-side, driven through its own
  // spellEffect: three rockfalls, no unit in the region, three empty batches.
  // This is the whole point of fixing it in the engine — no card had to know.
  const { g, A } = emptyBoard(9304);
  assert.equal(g.unitsIn(g.homeRegion(A)).length, 0, 'the board really is empty');
  const evs = resolve(getCard('Meteor Shower').spellEffect!, g,
    { controller: A, sourceName: 'Meteor Shower' });
  const empties = evs.filter(e => e.data?.['empty'] === true);
  assert.equal(empties.length, 3,
    'Meteor Shower is three separate rockfalls (R80: one resolution of one effect, one '
    + 'batch), so an empty board must produce three announcements, not one and not none');
  assert.ok(empties.every(e => e.data?.['source'] === 'Meteor Shower'),
    'each one names the carrier');
});

// ════════════════════════════════════════════════════════════════════════
// CARD-TODO #17 — OWNER vs CONTROLLER WHEN A CARD IS PUT INTO PLAY
// ════════════════════════════════════════════════════════════════════════
//
// R65: "each card reaches ITS OWN owner's erased pile — a virus on an enemy
// spell is the enemy's card." `spawnUnit` used to write `owner: seat,
// controller: seat` together and took no owner at all, so Wake the Dead ("Play
// up to two units in ANY bin…") did not BORROW an enemy's unit, it naturalised
// it: the card went to the caster's bin when it died, counted toward the
// caster's "cards in your bin" effects for the rest of the game, and its real
// owner could never recur it.
//
// A control change (R8) is NOT this. R8 moves the unit; it does not
// renationalise the card. Uglk needs both at once and is the proof they are
// separable.

/** put `name` in `seat`'s bin and resolve Wake the Dead for `caster` */
function wake(seed: number, binSeat: (A: Seat, D: Seat) => Seat): {
  g: E; A: Seat; D: Seat; owner: Seat; u: Entity; evs: EngineEvent[];
} {
  const { g, A, D } = emptyBoard(seed);
  const owner = binSeat(A, D);
  // R243: "any bin" is any bin IN THIS REGION. Wake the Dead is a {Battle}
  // spell, so the only state it can legally be cast in is a battle region
  // holding BOTH seats — and this fixture resolves it directly onto an
  // otherwise empty board, where a home region lists only its owner. Without
  // this the fixture tests the card in a position it can never be in, and the
  // enemy bin it is about is not there to raise from.
  g.s.regions[g.homeRegion(A)]!.presentSeats = [A, D];
  g.player(owner).bin.push('Tidal Menace');
  const before = g.events.length;
  resolve(getCard('Wake the Dead').spellEffect!, g,
    { controller: A, sourceName: 'Wake the Dead' },
    { 'wake:0': `${owner}:0`, 'wake:1': 'done' });
  const u = g.unitsIn(g.homeRegion(A)).find(x => x.card === 'Tidal Menace');
  assert.ok(u, 'Wake the Dead did not put the unit into play at all');
  return { g, A, D, owner, u, evs: g.events.slice(before) };
}

test('Wake the Dead raising a unit from the ENEMY bin gives the caster control, not ownership', () => {
  const { A, D, u } = wake(9310, (_A, d) => d);
  assert.equal(u.controller, A, 'the caster controls what they played');
  assert.equal(u.owner, D,
    "and the opponent still OWNS it — playing another player's card is borrowing it, "
    + 'not naturalising it (R65)');
});

test('a unit raised out of the enemy bin dies into the bin of whoever CONTROLS it', () => {
  // ⚠ THIS TEST WAS REVERSED BY R250 §4, DELIBERATELY. It used to be titled
  // "…dies back to the ENEMY's bin" and asserted the opposite, on R244 §1's
  // reasoning that "a control change is not a transfer of the card". The owner
  // has since ruled the general form, and this is the exact case he was
  // describing:
  //
  //   > "The controller trashes it and it goes to their graveyard. In
  //   > Algomancy, there's no issue with taking opponent's cards and putting
  //   > them into your zones in the way that's not possible in other card
  //   > games. The primary format (live draft) is a fully shared card pool."
  //
  // The consequence that makes it matter is unchanged and is now the other
  // way round: whose bin it lands in decides who can recur it and whose "cards
  // in your bin" it counts toward, for the rest of the game.
  //
  // OWNERSHIP still does not move — the test above asserts that, and it must
  // keep passing. R250 separates "whose card is this" from "which zone does it
  // go to" and answers the second with control.
  const { g, A, D, u } = wake(9311, (_A, d) => d);
  assert.equal(u.owner, D, 'still the enemy card');
  g.destroy(u, 'dies');
  assert.ok(g.player(A).bin.includes('Tidal Menace'),
    'R250: it reached the CONTROLLER bin — the seat that played it');
  assert.ok(!g.player(D).bin.includes('Tidal Menace'),
    'and not the owner one, however much it is still their card');
});

test('Wake the Dead raising a unit from your OWN bin is unchanged', () => {
  const { g, A, u } = wake(9312, a => a);
  assert.equal(u.controller, A, 'you control it');
  assert.equal(u.owner, A, 'and you own it — the default is still "the seat it enters under"');
  g.destroy(u, 'dies');
  assert.ok(g.player(A).bin.includes('Tidal Menace'), 'it dies back to your own bin');
});

test('the borrowed spawn says so in its event, and an ordinary spawn does not', () => {
  // the log has to be able to show "it dies to THEIR bin" coming. Asserted as a
  // FIELD, not a sentence.
  const borrowed = wake(9313, (_A, d) => d);
  const ordinary = wake(9314, a => a);
  const spawnOf = (evs: EngineEvent[]): EngineEvent | undefined =>
    evs.find(e => e.type === 'spawned' && e.data?.['card'] === 'Tidal Menace');
  assert.equal(spawnOf(borrowed.evs)?.data?.['owner'], borrowed.D,
    'a spawn whose owner is not its controller must carry the owner');
  assert.equal(spawnOf(ordinary.evs)?.data?.['owner'], undefined,
    'and an ordinary spawn must carry exactly the payload it always did');
});

test('Uglk hands an opponent CONTROL of a unit without handing over the card', () => {
  // "[Augment] After combat, each player puts a unit from their bin into play
  // under an opponent's control." The two halves of R8 and R65 in one sentence,
  // which is what makes this the neighbour worth checking.
  const { g, A, D } = emptyBoard(9315);
  const region = g.homeRegion(A);
  g.s.regions[region]!.presentSeats = [A, D];
  g.player(A).bin.push('Tidal Menace');
  g.player(D).bin.push('The Foretold');
  resolve(getCard('Uglk').augmentText![0]!.effect, g, { controller: A, sourceName: 'Uglk', region });
  const mine = g.unitsIn(region).find(u => u.card === 'Tidal Menace')!;
  const theirs = g.unitsIn(region).find(u => u.card === 'The Foretold')!;
  assert.equal(mine.owner, A, "the card out of A's bin is still A's");
  assert.equal(mine.controller, D, '…and D controls it');
  assert.equal(theirs.owner, D, "the card out of D's bin is still D's");
  assert.equal(theirs.controller, A, '…and A controls it');
  // ⚠ R250 §4 REVERSED THE LAST ASSERTION HERE. The TITLE still holds and is
  // what card-todo cites this by: Uglk hands over CONTROL and not the card —
  // `mine.owner` is still A above, and always will be. What changed is where
  // the card goes when it dies, and the answer is now "wherever its
  // controller's cards go". This line used to read "a control change is not a
  // transfer of the card: it dies back to its owner's bin".
  g.destroy(mine, 'dies');
  assert.equal(mine.owner, A, 'ownership never moved');
  assert.ok(g.player(D).bin.includes('Tidal Menace'),
    'R250: but the bin follows CONTROL, so D gets the card A lent them');
  assert.ok(!g.player(A).bin.includes('Tidal Menace'), 'and A does not get it back');
});

// ════════════════════════════════════════════════════════════════════════
// CARD-TODO #18 — A [once] BUDGET SPENT ON A QUESTION NOBODY WAS ASKED
// ════════════════════════════════════════════════════════════════════════
//
// THE RULING (owner, 2026-08-23): "A [once] is spent only when the ability
// actually does something. Say no to a 'you may' and the budget is intact, so
// the same trigger can ask again later the same turn."
//
// THE TRAP, and the reason the seam is explicit rather than inferred:
// "emitted no event" is NOT the test for "did nothing" any more. The
// CARD-TODO #3 sweep gave every one of these bail-out branches an
// announcement — that was the entire point of it — so they all look busy. A
// refund keyed on event count would refund nothing and the fix would look done.

const HEX_BUDGET = 'augment:Hexbane Shiitake#0';

/**
 * Compose Hexbane Shiitake's [once] trigger the way the engine does (which is
 * what RESERVES the budget) and resolve it. Returns the carrier so the test can
 * read `budgets` afterwards.
 */
function hexbane(seed: number, opts: { endOfTurn?: boolean; answers?: Record<string, unknown> } = {}): {
  g: E; A: Seat; D: Seat; carrier: Entity; bait: StackItem; run: () => void;
} {
  const { g, A, D, theirs } = board(seed);
  const carrier = g.spawnUnit(A, 'Hexbane Shiitake', g.homeRegion(A));
  // a real enemy spell on the stack for it to want
  const bait: StackItem = {
    id: 4242, kind: 'spell', card: 'Overbloom', label: 'Overbloom',
    controller: D, region: g.homeRegion(A), negated: false,
    parts: [{ effectKey: 'spell:Overbloom', targets: [{ unit: theirs.id }] }],
  };
  g.s.stack.push(bait);
  // the END-OF-TURN window is `phase === 'deploy' && deployPlayer === null` —
  // the state in which nobody has a deployment. The card used to refuse to
  // raise a decision there; it no longer does (see below).
  if (opts.endOfTurn) g.s.deployPlayer = null;
  // R191: `item` is the played item's id, and it is how this card finds the
  // spell now — R178 puts it on every real 'spellPlayed', so a fixture without
  // it is not the event `commitItem` emits.
  const ev: EngineEvent = {
    type: 'spellPlayed', msg: '',
    data: { card: 'Overbloom', seat: D, region: g.homeRegion(A), item: bait.id },
  };
  const run = (): void => {
    const parts = g.composeParts(carrier, 0, 'augment');
    assert.ok(parts, 'the trigger could not even be composed — its budget was already spent');
    assert.equal(g.entity(carrier.id)!.budgets[HEX_BUDGET], 1,
      'composition must still RESERVE the budget: it is the re-entrancy guard, and the '
      + 'fix for #18 is a refund, not the removal of the reservation');
    const item: StackItem = {
      id: g.s.nextId++, kind: 'triggered', card: 'Hexbane Shiitake',
      label: 'Hexbane Shiitake: exchange control of me for that spell (you may)',
      controller: A, region: g.homeRegion(A), negated: false, parts,
      sourceId: carrier.id, event: ev,
    };
    g.resolveParts(item, 0, opts.answers ?? {});
  };
  return { g, A, D, carrier, bait, run };
}

test('Hexbane Shiitake in the end-of-turn window is ASKED, and declining does not spend its [once]', () => {
  // the headline case, INVERTED 2026-08-23. This card used to read
  // `inEndOfTurn(g) ? false : ctx.choose(...)`: the player was never asked and
  // the [once] burnt on a question nobody heard. The designer took the silent
  // half away — "Ask — the click is the price" — because a ctx.choose raised in
  // the end-of-turn window IS answered and E.finishTurnEnd closes the owed turn
  // flip on the way back out of settle() (R85). 99-endofturn.test.ts drives that
  // claim over the real action path; here it is enough that the question is real.
  // An unanswered ctx.choose throws, so THROWING is "it asked".
  assert.throws(() => hexbane(9320, { endOfTurn: true }).run(),
    (e: unknown) => e instanceof Suspended,
    'the end-of-turn window has to ASK: no answer was supplied, so a real question suspends');
  // and the refund half of CARD-TODO #18 survives on the ordinary decline
  const { g, carrier, run } = hexbane(9320, { endOfTurn: true, answers: { '0:swap': false } });
  run();
  assert.equal(g.entity(carrier.id)!.budgets[HEX_BUDGET], undefined,
    'declining never spends the budget — not even here');
});

test('a Hexbane Shiitake that DECLINED can still fire later the same turn', () => {
  // "the same trigger can ask again later the same turn" — the half of the
  // ruling that makes the refund mean something. Same turn, no budget reset.
  const { g, carrier, run } = hexbane(9321, { endOfTurn: true, answers: { '0:swap': false } });
  const turn = g.s.turn;
  run();
  g.s.deployPlayer = g.s.players[carrier.controller]!.seat;   // the window closes
  assert.equal(g.s.turn, turn, 'still the same turn — nothing reset the budgets');
  assert.ok(g.composeParts(g.entity(carrier.id)!, 0, 'augment'),
    'the trigger must be composable again: an ability that did nothing is an ability '
    + 'that has not been used');
});

test('Hexbane Shiitake whose exchange is DECLINED keeps its [once]', () => {
  // the ordinary decline, which the ruling settles the same way as the
  // never-asked one. NOTE the branch announces itself (CARD-TODO #3 saw to
  // that), so an event-count refund would miss this entirely.
  const { g, carrier, run } = hexbane(9322, { answers: { '0:swap': false } });
  const before = g.events.length;
  run();
  assert.equal(g.entity(carrier.id)!.budgets[HEX_BUDGET], undefined,
    'declining a "you may" never spends the budget');
  assert.ok(g.events.slice(before).length > 0,
    'and the declining branch still SPEAKS — the refund is not a licence to go silent');
});

test('a SUCCESSFUL Hexbane Shiitake exchange really does spend its [once]', () => {
  // the test that stops the refund from making [once] meaningless.
  const { g, A, carrier, bait, run } = hexbane(9323, {
    answers: { '0:swap': true, '0:rt:0:0': { keep: true } },
  });
  run();
  assert.equal(bait.controller, A, 'the exchange happened — the caster took the spell');
  assert.equal(g.entity(carrier.id)!.budgets[HEX_BUDGET], 1,
    'an ability that DID something spends its use; a refund here would make [once] '
    + 'mean nothing at all');
  assert.equal(g.composeParts(g.entity(carrier.id)!, 0, 'augment'), null,
    'and it cannot be composed a second time this turn');
});

test('a declined "you may pay" on a bounded trigger keeps its budget (Afflicting Anima)', () => {
  // a second carrier, a different branch shape (a declined payment rather than
  // a declined exchange), so the seam is pinned as a RULE and not as one card's
  // special case.
  const KEY = 'ability:Afflicting Anima#0';
  const { g, A } = board(9324);
  const carrier = g.spawnUnit(A, 'Afflicting Anima', g.homeRegion(A));
  const parts = g.composeParts(carrier, 0, 'ability')!;
  assert.equal(g.entity(carrier.id)!.budgets[KEY], 1, 'composition reserved it');
  const item: StackItem = {
    id: g.s.nextId++, kind: 'triggered', card: 'Afflicting Anima',
    label: 'Afflicting Anima: you may pay [1] to create a Wraith',
    controller: A, region: g.homeRegion(A), negated: false, parts,
    sourceId: carrier.id, event: { type: 'trashed', msg: '', data: { card: 'Afflicting Anima', seat: A } },
  };
  const wraiths = () => g.unitsIn(g.homeRegion(A)).filter(u => u.card === 'Wraith').length;
  const before = wraiths();
  g.resolveParts(item, 0, { '0:pay': false });
  assert.equal(wraiths(), before, 'nothing was created');
  assert.equal(g.entity(carrier.id)!.budgets[KEY], undefined,
    'and the [once] was not spent — declining never spends it');
});

test('a bounded ability that DID something keeps the budget spent (Afflicting Anima)', () => {
  const KEY = 'ability:Afflicting Anima#0';
  const { g, h, A } = board(9325);
  giveResources(h, A, 'dark', 2);   // the [1] has to be payable, or this tests the wrong branch
  const carrier = g.spawnUnit(A, 'Afflicting Anima', g.homeRegion(A));
  const parts = g.composeParts(carrier, 0, 'ability')!;
  const item: StackItem = {
    id: g.s.nextId++, kind: 'triggered', card: 'Afflicting Anima',
    label: 'Afflicting Anima: you may pay [1] to create a Wraith',
    controller: A, region: g.homeRegion(A), negated: false, parts,
    sourceId: carrier.id, event: { type: 'trashed', msg: '', data: { card: 'Afflicting Anima', seat: A } },
  };
  const before = g.unitsIn(g.homeRegion(A)).filter(u => u.card === 'Wraith').length;
  g.resolveParts(item, 0, { '0:pay': true });
  assert.equal(g.unitsIn(g.homeRegion(A)).filter(u => u.card === 'Wraith').length, before + 1,
    'the Wraith was created (the mana was there)');
  assert.equal(g.entity(carrier.id)!.budgets[KEY], 1, 'so the use is spent');
});

// ══ CARD-TODO #20 — a FIZZLE SPENDS the bounded budget (R113) ════════════
//
// REVERSED 2026-08-23. This file first asserted the opposite, on R108's
// reading that a fizzle is "the ability did nothing" and therefore refunds.
// The designer then ruled the family directly — a bounded ability "can only be
// activated or triggered once per turn, REGARDLESS OF IF THAT ABILITY RESOLVES
// OR DOESN'T" — which names the fizzle by its exact description.
//
// The test is kept rather than deleted, inverted, because the inverted form is
// the one that is easy to get wrong again: refunding on fizzle is the
// intuitive-feeling behaviour, and it makes removing a target in response a
// free answer to every one of the pool's 61 targeted bounded abilities.

test('a bounded ability that FIZZLES for want of a target has SPENT its [once] (R113)', () => {
  const KEY = 'ability:Minor Kraken#0';
  const { g, h, A, D } = board(9330);
  const kraken = g.entity(spawn(h, A, 'Minor Kraken'))!;
  const victim = g.entity(spawn(h, D, 'Curio Drifter'))!;

  // compose the bounded trigger — this is where the reservation is written
  const parts = g.composeParts(kraken, 0, 'ability');
  assert.ok(parts, 'the trigger composed');
  assert.equal(kraken.budgets[KEY], 1, 'composition reserved the [once]');

  // it declared a target, and then the target leaves in response
  const item: StackItem = {
    id: g.s.nextId++, kind: 'triggered', label: 'Minor Kraken', controller: A,
    region: g.homeRegion(A), negated: false, sourceId: kraken.id,
    parts: parts!.map(p => ({ ...p, targets: [{ unit: victim.id }] })),
  } as never;
  g.destroy(victim, 'dies');
  assert.ok(!g.entity(victim.id), 'the declared target is gone');

  const before = g.events.length;
  g.s.stack.push(item);
  g.resolveTop();
  assert.ok(g.events.slice(before).some(e => e.type === 'fizzled'),
    'the item really fizzled — this test is worthless if it resolved normally');
  assert.equal(kraken.budgets[KEY], 1,
    'the trigger was PUT ON THE STACK, so the use is gone — a fizzle does not hand it '
    + 'back (R113, reversing CARD-TODO #20\'s first answer)');
  assert.equal(g.composeParts(kraken, 0, 'ability'), null,
    'and it cannot be triggered again this turn');
});
