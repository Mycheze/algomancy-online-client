/* The LITERAL-READING audit of the light + wood/metal-hybrid batches
 * (2026-08-24), in R125's shape: a qualifier in the code that the printed text
 * does not carry, or a clause the code reads at a moment the card does not.
 *
 * "I think you're underestimating most cards. All the cards in Algomancy are
 * pretty literal." — the owner, R125.
 *
 * Four cards moved:
 *
 *  · VROOT — "When my column deals combat damage" was read off the aggregated
 *    per-seat combat `lifeLost` with no sub-step gate, so a Vroot in a NORMAL
 *    column paid the opponent for a {Swift} column's damage. R117 ruled that
 *    clause ("it fires in the sub-step its own column strikes in") and shipped
 *    `E.strikesInCurrentSubStep`; batch-dark-b's copy of this very helper
 *    already carried the gate and batch-light-a's did not.
 *
 *  · THE EVERYWHERE — "name a card" offered only the names of UNITS standing
 *    on the board. The silence is CONTINUOUS and matches on a NAME, so naming
 *    a card that is not in play YET is the card's whole point; the old menu
 *    could not express it.
 *
 *  · DIVINE FORESIGHT — "LOOK AT target opponent's hand" printed the whole
 *    opposing hand into the shared log. E.revealHandTo is deliberately careful
 *    not to; the line needed `privateTo`.
 *
 *  · HOOBA-GOD — "create a token that's a copy of ME" hardcoded the string
 *    'Hooba-God' instead of reading the R118 face. Latent today (no shipped
 *    card puts Hooba-God's trigger on something else), so the test builds the
 *    reachable case with R63's `grantText`, the shipped primitive Reforge the
 *    Dead uses.
 *
 * Seeds 11500-11599. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick,
  resolveAfterCombat, skipHasteStep, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** raw engine calls against the harness state, absorbing a suspension
 * (38-light-a's helper; E may replace its state object on a rollback) */
function withE(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

/** answer whatever the combat pump raises (trigger ordering, an elective
 * split) so the remaining sub-steps can run — 53-playtest-round7's helper */
function answerAll(h: Harness): void {
  let guard = 30;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    h.do({
      type: 'decide', seat: d.seat,
      choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0,
    });
  }
  if (guard <= 0) throw new Error('answerAll did not terminate');
}

/** how many times Vroot's "when my column deals combat damage" was ANNOUNCED.
 *
 * The trigger still fires inside the damage step under R261 (R1: the condition
 * is evaluated at event time); what moved is when it RESOLVES. The count is
 * therefore the one reading of the sub-step rule that R261 could not disturb,
 * and it is asserted alongside the life totals rather than instead of them.
 *
 * ⚠ WHAT IT ACTUALLY GUARDS IS THE RULE, NOT R117's GATE. Measured in a
 * scratch copy: `strikesInCurrentSubStep` can be replaced by `return true` and
 * neither test below notices, because R195 gave the aggregated `lifeLost` a
 * per-column breakdown and `columnDealtCombatDamage`'s face arm asks
 * `faceDamageDealtBy` — which already answers "is this my sub-step?" on the
 * way to answering "is this my damage?". Both gates have to go before a
 * number here moves; either one alone holds R117. */
function vrootTriggers(h: Harness): number {
  return h.events.filter(ev => ev.type === 'triggered' && /Vroot/.test(ev.msg)).length;
}

/** deployment → the next turn's [Haste] naming decision (38-light-a's) */
function toNaming(h: Harness, attacker: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = attacker;
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

// ── Vroot: R117's sub-step gate ──────────────────────────────────────────

test('Vroot: a NORMAL column does not pay out for the Swift sub-step (R117)', () => {
  const h = new Harness(11501);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const swift = spawn(h, A, 'Dune Drifter');                 // {Swift}, 2 power
  const v = spawn(h, A, 'Vroot');                            // 4/4, no speed attr
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[swift], [v]] });
  assert.equal(h.q.combatSubStepOf(ent(h, swift)!), 'Swift');
  assert.equal(h.q.combatSubStepOf(ent(h, v)!), 'normal',
    "Vroot's column has no Swift and no Sluggish in it");
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  // R261 (owner, 2026-08-30): THE PAYOUT NO LONGER HAPPENS INSIDE THE DAMAGE
  // STEP. `answerAll` alone used to be enough here because `pumpCombatDamage`
  // drained the trigger queue between sub-steps and Vroot's life gain had
  // already landed by the time the pass returned. It goes on the stack in the
  // after-combat window now, respondable by both seats, so the board does not
  // carry the refund until somebody lets the stack resolve.
  //
  // ⚠ R261 TOOK THE ORDERING CLAIM AND LEFT THE GATE, WHICH IS WHAT THIS TEST
  // IS ABOUT. `strikesInCurrentSubStep` is still asked from `when()`, at event
  // time, inside `combatSubStep`, so Vroot still hears ONLY its own column's
  // sub-step and the number below is unchanged. What R261 superseded — "a
  // Swift column's riders land before normal damage" — this test never claimed.
  answerAll(h);
  resolveAfterCombat(h);
  // THE REGRESSION THIS PINS. commitPlayerDamage aggregates every connecting
  // column's face damage into ONE lifeLost per seat per sub-step, so without
  // the gate Vroot heard the Swift column's 2 as its own and handed D 2 life
  // back — 2 + 4 dealt, 2 + 4 gained, a net of zero. With it, only Vroot's own
  // 4 is refunded and the Drifter's 2 sticks.
  assert.equal(h.state.players[D]!.life, life0 - 2,
    'the Drifter\'s 2 sticks; only Vroot\'s own 4 comes back');
  // THE POSITIVE CONTROL, and it is not decoration: with the gate gone the
  // count is TWO, and under R261 both would resolve after combat and the life
  // total would come out at life0 — the same number a board where Vroot never
  // triggered at all would produce. The count is what tells those apart.
  assert.equal(vrootTriggers(h), 1,
    'exactly ONE Vroot trigger was announced — its own column\'s sub-step, and not the '
    + 'Swift column\'s aggregated lifeLost as well');
  finishBattle(h);
});

test('Vroot: its OWN sub-step still pays out in full (R114 unchanged)', () => {
  const h = new Harness(11502);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const v = spawn(h, A, 'Vroot');                            // 4/4, alone
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[v]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  answerAll(h);
  resolveAfterCombat(h);   // R261: the payout is on the after-combat stack, not in the sub-step
  assert.equal(h.state.players[D]!.life, life0,
    'lost 4, gained 4 — the gate narrows WHEN it fires, never whether');
  assert.equal(vrootTriggers(h), 1, 'one column, one sub-step, one trigger');
  finishBattle(h);
});

// ── The Everywhere: "name a card" is the whole pool ───────────────────────

test('The Everywhere: a card NOT in play can be named, and the silence bites when it arrives', () => {
  const h = new Harness(11503);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ev = spawn(h, A, 'The Everywhere');
  toNaming(h, A);
  // RED-CHECK: the old menu was `unitsIn(r).map(u => u.card)` — the units
  // standing on the board — and nothing but The Everywhere is in play here, so
  // this pick throws "no option matching" without the fix.
  assert.ok(h.state.decision!.options.length > 100,
    'the menu is the card pool, not the board');
  pick(h, 'Good Whale');
  assert.equal(ent(h, ev)!.named, 'Good Whale', 'a card nobody has played is a legal name');
  // it arrives afterwards, in ITS OWN region: nothing is silenced yet (R12)
  const whale = spawn(h, D, 'Good Whale');                   // 7/5, trigger-free
  assert.ok(!h.q.abilitiesSuppressed(ent(h, whale)!),
    'still in their own region — the naming reaches nothing across regions');
  h.do({ type: 'declareAttack', seat: A, columns: [[ev]] });
  assert.ok(h.q.abilitiesSuppressed(ent(h, whale)!),
    'I attacked into their region, so my last named card loses all abilities');
  finishBattle(h);
});

test('The Everywhere: every name the OLD menu offered is still offered', () => {
  const h = new Harness(11504);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ev = spawn(h, A, 'The Everywhere');
  spawn(h, A, 'Unit Token');                                 // a TOKEN name: not a deck card
  toNaming(h, A);
  const menu = (h.state.decision!.options).map(o => o.value);
  assert.ok(menu.includes('Unit Token'),
    'the pool filter drops token faces, so the in-play union has to put them back');
  assert.ok(menu.includes(''), 'and "name no card" survives — it releases a previous naming');
  pick(h, 'Unit Token');
  assert.equal(ent(h, ev)!.named, 'Unit Token');
  finishBattle(h);
});

// ── Divine Foresight: LOOKING is not REVEALING ───────────────────────────

test("Divine Foresight: the opponent's hand does not go into the shared log", () => {
  const h = new Harness(11505);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);                           // ll/1
  toNextBattle(h, A);
  h.state.players[D]!.hand = ['Shard Sprite', 'Greed Angel'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Divine Foresight') });
  pick(h, { player: D });
  pass(h); pass(h);                                          // resolve → the hand pick
  const leak = h.events.filter(e => e.msg.includes('Shard Sprite'));
  assert.ok(leak.length, 'the looker still gets the line — it is a LOOK, not a secret');
  for (const e of leak) {
    assert.equal(e.data?.['privateTo'], A,
      'and every line naming a card in their hand belongs to the looker alone');
  }
  assert.ok(h.events.some(e => e.msg.includes("looks at") && e.data?.['privateTo'] === undefined),
    'what the table sees is E.revealHandTo\'s "X looks at Y\'s hand", which names nothing');
  pick(h, 1);
  finishBattle(h);
});

// ── Hooba-God: "a copy of ME" reads the R118 face ────────────────────────

test('Hooba-God: granted to another unit, "a copy of me" copies THAT unit (R118)', () => {
  const h = new Harness(11506);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');                    // 7/5, trigger-free
  // R63: an authored ability granted by reference, exactly as Reforge the Dead
  // grants "When I die, create a Robot 3." — fireEvent dispatches it off
  // `Entity.granted`, and "me" is the HOLDER, not the card the text came from.
  withE(h, e => {
    e.grantText(ent(h, host)!, {
      card: 'Hooba-God', via: 'ability', index: 0,
      text: "When I attack or block, create a token that's a copy of me in my formation.",
      from: 'the literal-reading audit',
    });
  });
  toNextBattle(h, A);
  const before = unitsOf(h, A).length;
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pass(h); pass(h);                                          // the granted trigger resolves
  answerAll(h);                                              // R75: which slot
  const made = unitsOf(h, A).filter(u => u.token);
  assert.equal(unitsOf(h, A).length, before + 1, 'exactly one token was created');
  assert.equal(made[0]!.card, 'Good Whale',
    'a copy of ME is a copy of the holder — the old code hardcoded "Hooba-God"');
  assert.equal(D, 1 - A);
  finishBattle(h);
});
