/* R198 — A RESPONSE WINDOW FOR A CARD PLAYED MID-RESOLUTION.
 *
 * Divergence inventory §2a, row RESPONSE WINDOW MID-RESOLUTION, called out
 * there as *"structurally the hardest item here"*: the four cards that play
 * another card as part of their own resolution went through `playInline`,
 * which built **no StackItem at all**. So nobody ever held priority between
 * "you play it" and "it resolves". Measured before anything was changed, on
 * all four: zero `stackPushed` events for the played card, an empty stack the
 * instant the effect finished, and the played card's effect already done.
 *
 * THE FIX is the one MTG and the Manual both describe and the one R164 already
 * used for a spell COPY: a play that happens during a resolution goes on the
 * stack, the resolution that played it finishes, and THEN priority is handed
 * out with the played card sitting there. `playInline` builds the item,
 * declares everything the play has to declare (R67 target, R57 mode, R29
 * formation spot) through the outer `ctx.choose`, and hands it to
 * `E.commitItem(…, 'push')`.
 *
 * ⚠ §5 IS THE SAFETY CASE AND IT IS NOT DECORATION. A `'resolve'` suspension
 * carries an R85 whole-`GameState` snapshot and `E.resumeResolve` does
 * `this.s = snap`, so anything a SECOND seat landed while a question was open
 * would be erased by the answer (130-seat-aware-gate §3). A priority window is
 * exactly "the other player acts", so the two must never overlap — and they
 * cannot, because the window opens only after the resolution has finished and
 * the suspension is gone. §5 asserts the structural fact and then DRIVES it.
 *
 * Seeds 16900-16999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { GameState, Seat } from '../src/types.ts';
import { decisionBlocks } from '../src/apply.ts';
import { inlinePlayGoesToStack } from '../src/cards/sets/batch-water-a.ts';
import {
  ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/* ── helpers ──────────────────────────────────────────────────────────── */

/** answer the pending decision by option LABEL predicate */
function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

/** answer by option VALUE (deep-equal) */
function pickValue(h: Harness, value: unknown): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(value));
  assert.notEqual(i, -1, `no option ${JSON.stringify(value)}; menu was [${d.options.map(o => JSON.stringify(o.value))}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

/** the item on the stack for a named card, or undefined */
const onStack = (h: Harness, card: string): { id: number } | undefined =>
  h.state.stack.find(i => i.card === card);

/**
 * THE ASSERTION THIS FILE IS FOR. `card` was played by `player` out of
 * `source`'s resolution, it is still on the stack, and a real priority window
 * is open on it — nothing pending, nobody gated, and the OPPONENT gets a turn
 * in it before it can resolve.
 *
 * ⚠ It does NOT assert that the opponent holds priority at this instant.
 * `E.finishResolutionTail` restarts a post-resolution window from the
 * INITIATIVE player, which is the engine's standing convention for every
 * window (`openPriority` does the same). Who speaks first is not what the
 * divergence was about; that anybody speaks at all is. So this asserts the
 * window, and returns with the opponent holding priority so the caller can
 * drive their response.
 */
function windowIsOpen(h: Harness, card: string, player: Seat, source: string): void {
  const opp = (1 - player) as Seat;
  assert.ok(onStack(h, card),
    `${source}: the played card (${card}) is ON THE STACK, not already resolved`);
  assert.equal(h.state.decision, null, `${source}: no question is pending — the resolution finished`);
  assert.equal(h.state.suspension, null,
    `${source}: and no suspension survives it, so no R85 snapshot can rewind this window`);
  assert.notEqual(h.state.priority, null,
    `${source}: somebody holds priority — "you play it" and "it resolves" are two moments now`);
  assert.equal(h.state.passes, 0, `${source}: a FRESH window, not the tail of an old one`);
  for (const seat of [player, opp] as Seat[]) {
    assert.equal(decisionBlocks(h.state, seat), false,
      `${source}: seat ${seat} is not gated out of it — a window nobody may act in is not a window`);
  }
  if (h.state.priority !== opp) pass(h);
  assert.equal(h.state.priority, opp,
    `${source}: the opponent's turn in the window comes round while the card is still on the stack`);
  assert.ok(onStack(h, card), `${source}: …and it is still there when it does`);
}

/**
 * Every place the two players can account for a card: hands, bins, play,
 * erased piles, caches, the stack. R65's whole point — nothing may be NOWHERE,
 * which is the exact shape the R85 hazard took ("in neither hand nor bin").
 *
 * The DECK is deliberately not searched: it holds bare names in bulk, so a
 * second printing of the same card there is a different object and would make
 * every count a guess. Every card these tests follow has demonstrably left it.
 */
function whereIs(s: GameState, card: string): string[] {
  const e = new E(s);
  const out: string[] = [];
  for (const p of s.players) {
    for (const n of p.hand) if (n === card) out.push(`hand:${p.seat}`);
    for (const n of p.bin) if (n === card) out.push(`bin:${p.seat}`);
    for (const n of e.erased(p.seat)) if (n === card) out.push(`erased:${p.seat}`);
    for (const c of e.cache(p.seat)) if (c.card === card) out.push(`cache:${p.seat}`);
  }
  for (const u of Object.values(s.entities)) if (u && u.card === card) out.push(`play:${u.id}`);
  for (const i of s.stack) if (i.card === card) out.push(`stack:${i.id}`);
  return out;
}

/* ═══ §1 Hooba-Pon ═══════════════════════════════════════════════════════
 *
 * "[Augment] When I attack or block, you may play a unit from your hand into
 *  an open position in my formation. (You still pay the cost.)"
 *
 * R128 (owner, 2026-08-24): *"ANYTHING on the stack is an effect, including
 * units and spell units."* So the unit this trigger plays is a legal "target
 * effect" the moment it is a real stack item — which is the whole difference.
 */

test('R198 Hooba-Pon "you may play a unit from your hand into an open position in my formation": the opponent answers the play before the body arrives', () => {
  const h = new Harness(16901, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const pon = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 2);                       // the second Hooba-Pon: bb/2
  give(h, A, 'Hooba-Pon');
  giveResources(h, D, 'water', 1); giveResources(h, D, 'metal', 1);   // Dematerialize: bm/2
  toNextBattle(h, A);
  give(h, D, 'Dematerialize');
  h.do({ type: 'declareAttack', seat: A, columns: [[pon]] });
  pass(h); pass(h);                                      // the attack trigger resolves
  decide(h, l => l === 'Hooba-Pon');                     // pay for the unit in hand
  pickValue(h, { kind: 'behind', unit: pon });           // R29: where it is PLAYED into

  // THE WINDOW.
  windowIsOpen(h, 'Hooba-Pon', A, 'Hooba-Pon');
  assert.equal(h.state.battle!.columns[0]!.length, 1,
    'the body has NOT arrived yet — that is what the window is for');

  // and the opponent uses it.
  const played = onStack(h, 'Hooba-Pon')!;
  h.do({ type: 'playCard', seat: D, handIndex: h.state.players[D]!.hand.indexOf('Dematerialize') });
  pickValue(h, { stack: played.id });
  pass(h); pass(h);                                      // Dematerialize resolves
  decide(h, () => true);                                 // its Glimpse 3
  assert.equal(onStack(h, 'Hooba-Pon'), undefined, 'R68: the negated play left the stack at once');
  assert.equal(h.state.battle!.columns[0]!.length, 1,
    'and no body ever joined the formation — the play was ANSWERED');
  assert.deepEqual(whereIs(h.state, 'Hooba-Pon').filter(p => !p.startsWith('play:')), [`bin:${A}`],
    'the answered card is in its owner’s bin — exactly once, and not also nowhere (R65). '
    + 'The engine owns that disposal now; a caller that ALSO binned it would show up here twice');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0,
    'and it was still paid for — a negation refunds nothing');
  finishBattle(h);
});

/* ═══ §2 Insidious Invitation ════════════════════════════════════════════
 *
 * "Draw a card. [Switch1] Starting with you, players may play a unit from hand
 *  as if it were [Battle]. (The unit's costs still need to be paid.)"
 */

test('R198 Insidious Invitation "Starting with you, players may play a unit from hand as if it were [Battle]": both plays reach the stack and each gets its own window', () => {
  const h = new Harness(16902, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);                       // Invitation b/1 + Echo of Despair b/4
  giveResources(h, D, 'water', 2);                       // Hooba-Pon bb/2
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair'];
  h.state.players[D]!.hand = ['Hooba-Pon'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h); pass(h);                                      // the Invitation resolves

  decide(h, l => l === 'Echo of Despair');               // "starting with you"
  assert.ok(onStack(h, 'Echo of Despair'),
    'the caster’s play is on the stack while the opponent is being asked');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Echo of Despair'),
    '…and has NOT resolved: nobody has had priority yet');
  decide(h, l => l === 'Hooba-Pon');                     // …then each other player

  windowIsOpen(h, 'Hooba-Pon', D, 'Insidious Invitation');
  assert.deepEqual(h.state.stack.map(i => i.card), ['Echo of Despair', 'Hooba-Pon'],
    'both plays are on the stack in printed order, so they resolve last-played-first');

  pass(h); pass(h);                                      // window 1 → Hooba-Pon resolves
  assert.ok(unitsOf(h, D).some(u => u.card === 'Hooba-Pon'), 'D’s unit lands');
  windowIsOpen(h, 'Echo of Despair', A, 'Insidious Invitation');
  pass(h); pass(h);                                      // window 2 → Echo resolves
  assert.ok(unitsOf(h, A).some(u => u.card === 'Echo of Despair'), 'A’s unit lands');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0, 'A paid 1 + 4');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, 0, 'D paid 2');
  finishBattle(h);
});

/* ═══ §3 Tides of the Cosmos ═════════════════════════════════════════════
 *
 * "Reveal the top eight cards of the deck. Choose up to two of them with total
 *  cost 8 or less. You may play them now, for free. Recycle the rest."
 *
 * "For free" waives the COST. It does not make it something other than a play,
 * which is the same distinction R111 draws for a fulfilled prophecy.
 */

test('R198 Tides of the Cosmos "You may play them now, for free": a free play is still a play, so it can be answered on the stack', () => {
  const h = new Harness(16903, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);                      // Tides: bbb/8
  giveResources(h, A, 'water', 1); giveResources(h, A, 'metal', 1);   // Dematerialize: bm/2
  toNextBattle(h, A);
  give(h, A, 'Dematerialize');
  h.state.sharedDeck = [
    'Burn the Blight',                                   // [3], no targets, no picks
    'Good Whale', 'Good Whale', 'Good Whale', 'Good Whale',
    'Good Whale', 'Good Whale', 'Good Whale',
    'Rune Channeler',
  ];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);                                      // Tides resolves → the picks
  decide(h, l => l.startsWith('Burn the Blight'));   // the only pick inside the [8] budget

  windowIsOpen(h, 'Burn the Blight', D, 'Tides of the Cosmos');
  assert.ok(h.state.players[D]!.bin.includes('Tides of the Cosmos'),
    'Tides itself has already finished and binned — the free play OUTLIVES its resolution');

  const free = onStack(h, 'Burn the Blight')!;
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Dematerialize') });
  pickValue(h, { stack: free.id });
  pass(h); pass(h);
  decide(h, () => true);                                 // Dematerialize's Glimpse 3
  assert.equal(onStack(h, 'Burn the Blight'), undefined, 'the free play was negated');
  assert.deepEqual(whereIs(h.state, 'Burn the Blight'), [`bin:${D}`],
    'a negated free play reaches exactly one place, and it is a bin (R40: off the stack, not a trash)');
  assert.equal(h.events.filter(e => e.type === 'trashed' && e.data?.['card'] === 'Burn the Blight').length, 0,
    'still not a trash — R146(a), unmoved by the card coming off a real stack now');
  finishBattle(h);
});

/* ═══ §4 Spell Excavation ════════════════════════════════════════════════
 *
 * "You may play target spell from your bin. If you do, it gains {Unstable}."
 *  (R96 — the engine's phrasing of the printed line: it is erased, not
 *  re-binned.)
 *
 * The window is the first half. The second half is what the window makes
 * REACHABLE: the excavated spell can now be negated, and R96 has to survive
 * that exit too — the card must not fall into the bin it never returns to.
 */

test('R198 Spell Excavation "play target spell from your bin": the bin play gets a window, and R96’s erase survives being negated in it', () => {
  const h = new Harness(16904, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');              // Luminous Arc's 2/2 victim
  h.state.players[D]!.bin.push('Luminous Arc');
  giveResources(h, D, 'water', 2);                       // Excavation: bb/1
  giveResources(h, D, 'fire', 2);                        // Arc: r/2
  giveResources(h, A, 'water', 1); giveResources(h, A, 'metal', 1);   // Dematerialize: bm/2
  toNextBattle(h, A);
  give(h, A, 'Dematerialize');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spell Excavation') });
  decide(h, l => l.startsWith('Luminous Arc'));          // R67: declared at cast
  pass(h); pass(h);                                      // the Excavation resolves

  windowIsOpen(h, 'Luminous Arc', D, 'Spell Excavation');
  assert.ok(ent(h, atk), 'the excavated spell has NOT dealt its damage yet');
  assert.deepEqual(whereIs(h.state, 'Luminous Arc'), [`stack:${onStack(h, 'Luminous Arc')!.id}`],
    'and it is on the stack and nowhere else — out of the bin, on a real pile');

  const arc = onStack(h, 'Luminous Arc')!;
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Dematerialize') });
  pickValue(h, { stack: arc.id });
  pass(h); pass(h);
  decide(h, () => true);                                 // Glimpse 3, to the Arc's controller
  assert.ok(ent(h, atk), 'the answered spell never dealt its 6');
  // ⚠ THE R96 HALF. Negation is a stack exit `E.dischargeItem` owns, and the
  // Unstable STAMP the play put on the item is read there — so the card is
  // erased on this exit exactly as it is on resolution. The card never says
  // "unless somebody answers it".
  assert.deepEqual(whereIs(h.state, 'Luminous Arc'), [`erased:${D}`],
    'a NEGATED bin play is still erased, never binned — and never nowhere');
  finishBattle(h);
});

/* ═══ §5 THE R85 SNAPSHOT HAZARD ═════════════════════════════════════════ */

test('R198 the window and an R85 rollback snapshot can never be open at the same time', () => {
  const h = new Harness(16905, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair'];
  h.state.players[D]!.hand = ['Hooba-Pon'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h); pass(h);

  // WHILE a snapshot is live, NOBODY may act — that is the pre-existing R154
  // gate (`decisionBlocks`), and it is what makes the deferral safe rather
  // than something apply.ts had to be taught.
  const sus = h.state.suspension!;
  assert.equal(sus.type, 'resolve', 'the invitation suspends mid-resolution');
  assert.ok(sus.type === 'resolve' && sus.snapshot, 'carrying a whole-state rollback snapshot');
  for (const seat of [A, D] as Seat[]) {
    for (const a of h.legal(seat)) {
      assert.ok(a.type === 'decide' || a.type === 'concede',
        `${a.type} must not be offered to seat ${seat} while a rollback snapshot is live`);
    }
  }
  for (const seat of [A, D] as Seat[]) {
    assert.equal(decisionBlocks(h.state, seat), true,
      `seat ${seat} is gated out: a half-resolved board is a PREVIEW, never a window`);
  }

  decide(h, l => l === 'Echo of Despair');
  decide(h, l => l === 'Hooba-Pon');

  // …and the instant there IS a window, the snapshot is GONE. Not "cleared
  // afterwards" — the window is opened by `finishResolutionTail`, which runs
  // only once `resolveItem` has returned.
  assert.equal(h.state.suspension, null, 'the window opens with no suspension at all');
  assert.equal(h.state.decision, null, '…and no pending question');
  assert.ok(h.state.priority !== null && h.state.stack.length === 2, '…and a live stack');
  finishBattle(h);
});

test('R198 the R85 hazard, DRIVEN: the other seat acts inside the window and loses neither life nor a card', () => {
  const h = new Harness(16906, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);                       // Invitation b/1 + Echo of Despair b/4
  giveResources(h, A, 'fire', 2);                        // Luminous Arc r/2 — the response
  giveResources(h, D, 'water', 2);                       // Hooba-Pon bb/2
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair', 'Luminous Arc'];
  h.state.players[D]!.hand = ['Hooba-Pon'];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h); pass(h);
  decide(h, l => l === 'Echo of Despair');               // A plays a unit → stack
  decide(h, l => l === 'Hooba-Pon');                     // D plays a unit → stack

  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  windowIsOpen(h, 'Echo of Despair', D, 'Insidious Invitation');

  // A ACTS IN THE WINDOW — the seat that did NOT answer last. That is the exact
  // shape of the hazard: if the window and a live R85 snapshot could coexist,
  // D's answer (the one just given) would `this.s = snap` over everything A is
  // about to do, taking A's life, A's mana and A's card back with it.
  assert.ok(h.legal(A).some(a => a.type === 'playCard'),
    'their hand is live in the window — a screen full of refusals is not a window');
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Luminous Arc') });
  pickValue(h, { unit: tok });                           // 6 damage to A's own attacking token
  pass(h); pass(h);                                      // the Arc resolves
  assert.equal(ent(h, tok), undefined, 'the response really happened — the token is dead');

  // drain the rest: D's unit, then A's.
  pass(h); pass(h);
  pass(h); pass(h);

  // NOTHING WAS REWOUND.
  assert.equal(h.state.players[A]!.life, lifeA, 'A’s life is untouched, not rolled back');
  assert.equal(h.state.players[D]!.life, lifeD, 'D’s life is untouched, not rolled back');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Echo of Despair'),
    'A’s played card resolved — it did not vanish when D acted over it');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Hooba-Pon'), 'and D’s did too');
  // the reported shape of the hazard, said in its own words: a card in neither
  // hand nor bin, gone from the game.
  for (const card of ['Echo of Despair', 'Hooba-Pon', 'Luminous Arc', 'Insidious Invitation']) {
    assert.equal(whereIs(h.state, card).length, 1,
      `${card} is in exactly one place — never nowhere, never duplicated`);
  }
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Luminous Arc').length, 1,
    'the card played IN the window reached its owner’s bin exactly once — not zero, not twice');
  finishBattle(h);
});

/* ═══ §6 THE GATE ════════════════════════════════════════════════════════
 *
 * A play is deferred to the stack ONLY where a priority regime exists to hand
 * the window to. Widen this by accident and the game strands: nothing drains a
 * planning-phase stack at all, and `pumpCombatDamage` refuses to run while the
 * stack is non-empty, so an item pushed between combat sub-steps would sit
 * there forever.
 */

test('R198 the deferral gate: only a live battle priority window defers a mid-resolution play', () => {
  const h = new Harness(16907, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  assert.equal(h.state.phase, 'deploy');
  assert.equal(inlinePlayGoesToStack(h.q), false,
    'DEPLOYMENT is a hidden simultaneous segment — no response windows at all, and settle() '
    + 'drains its stack itself (R144a)');

  const tok = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  assert.equal(h.state.phase, 'battle');
  assert.equal(inlinePlayGoesToStack(h.q), true, 'the attack window IS a priority window');

  // the three ways a state can look battle-ish and have no window in it. Widen
  // the gate onto any of them and the game strands rather than misbehaving:
  // nothing drains a planning-phase stack at all, and `pumpCombatDamage`
  // refuses to run while the stack is non-empty.
  const mid = structuredClone(h.state);
  mid.priority = null;
  assert.equal(inlinePlayGoesToStack(new E(mid)), false,
    'battle with priority null (advanceBattleStep’s interval) is not a window');
  mid.priority = 0;
  mid.battle!.damageStep = 'Swift';
  assert.equal(inlinePlayGoesToStack(new E(mid)), false,
    'nor is a combat sub-step — R3 triggers there are special actions');
  delete mid.battle!.damageStep;
  mid.phase = 'planning';
  assert.equal(inlinePlayGoesToStack(new E(mid)), false,
    'nor the PLANNING phase / haste step, whatever priority happens to say');
  finishBattle(h);
});
