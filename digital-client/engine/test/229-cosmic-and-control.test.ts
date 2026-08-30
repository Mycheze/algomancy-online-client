/* R250 — COSMIC REVERSAL REACHES THE BOARD, AND A STOLEN UNIT DIES INTO THE
 * BIN OF WHOEVER CONTROLS IT.
 *
 * Two owner answers from the round-31 sheet, plus one measurement that turned a
 * suspected bug into a ruling that was already correct.
 *
 * ── Q4 / reports #119 + #121 — Cosmic Reversal ────────────────────────
 * Printed: *"Recall all other spell effects and spell units. (Negate them and
 * put them into their controller's hands.)"*
 *
 *   > "Yes. It returns all spell effects on the stack (anything currently on
 *   > the stack with type spell goes to the owners hand) and recalls all spell
 *   > units *from the board*."
 *
 * The card only ever swept `g.s.stack`. §1 is the board half.
 *
 * ── Q1 / report #119 — "she could not cast it" ────────────────────────
 *   > "Yes, all triggers are respondable. And at this moment, she had priority
 *   > and enough mana to cast the spell. But we think the reason the game
 *   > prevented it was not cause she didn't have prio, but because it assumed
 *   > the spell needed to be cast while there was a *spell effect* on the
 *   > stack (despite that not being a requirement). She wanted to bounce the in
 *   > play spell unit."
 *
 * **BOTH HALVES OF THAT DIAGNOSIS ARE WRONG, AND THE FINDING IS BIGGER THAN
 * THE ONE IT REPLACES.** There is no castability restriction on this card and
 * there never was (§2). What actually happened in room YFUE is that the
 * trigger she wanted to respond to — Eminence of the Barrens, *"Whenever I am
 * dealt damage…"* — fired inside the **COMBAT DAMAGE STEP**, and the engine
 * gave nobody a window there.
 *
 * ⚠ AND THAT SECOND HALF WAS THE ENGINE'S FAULT, NOT THE REPORT'S. R250 §3
 * concluded from this board that *"all triggers are respondable" is true
 * everywhere the game hands out priority, and false in the two places it does
 * not: the combat damage step (R3) and deployment (R144)*. The deployment half
 * stands. **[R261] (owner, 2026-08-30, round-32 Q1) supersedes the combat
 * half:** the owner's sentence was right as written, and it is the engine that
 * has changed —
 *
 *   > "all triggers that are caused by damage get moved to 'After combat',
 *   > along with anything that triggers then. […] Both the initiative player
 *   > and non-initiative player have their triggers put onto the stack during
 *   > after combat and can respond to them there."
 *
 * R3 is not overruled; it is narrowed to what it was always about. There is
 * still no priority window BETWEEN DAMAGE SUB-STEPS, deaths and promotion are
 * still immediate, and a unit killed in the Swift sub-step still deals no
 * normal damage. R3 governs the board, not the trigger queue.
 *
 * §3 therefore pins the SAME trigger of the SAME card off TWO damage sources —
 * and, since R261, gets the SAME answer from both. That the answer converged
 * is the finding, not a reason to delete either half: the two sources are what
 * show the difference was never about the card. The full R261 guard set lives
 * in `test/239-damage-triggers-after-combat.test.ts`; what §3 keeps is the
 * report's own board.
 *
 * ── Q5 — a stolen unit that dies ──────────────────────────────────────
 *   > "The controller trashes it and it goes to their graveyard. In Algomancy,
 *   > there's no issue with taking opponent's cards and putting them into your
 *   > zones in the way that's not possible in other card games. The primary
 *   > format (live draft) is a fully shared card pool."
 *
 * …and, on the follow-up question, the general form:
 *
 *   > "Zones ALWAYS follow control. One rule, no split. Whoever CONTROLLED the
 *   > card at the moment it left play gets it in their bin."
 *
 * §4. **This REVERSES [R244] §1's "⚠ THE DESTINATION DOES NOT MOVE" outright,
 * for the mod as well as the body.** R244's ATTRIBUTION half stands entirely —
 * a mod is trashed by the host's controller, because a mod is part of the unit
 * it sits on — and only its destination half is superseded. R244 wrote that
 * paragraph knowing the question was open: it recorded that the engine "could
 * get away with" conflating attribution and destination "only because no
 * caller had ever made them differ". This is that seam being decided.
 *
 * The measured consequence, and the reason §4 tests the stamp as hard as it
 * tests the bin: R244 ruled that **no R131 bin ref is stamped when trasher and
 * bin-owner differ**, because a bin ref naming a copy that is not in that bin
 * is R140's bug (Cthyrian Rector recalling an innocent older copy). Under R250
 * they never differ, so 0-of-200 stamped becomes 200-of-200 stamped, and every
 * one of those stamps has to be right.
 *
 * ⚠ WHAT R250 DOES NOT DECIDE. The ruling as given is about BINS. Three other
 * per-seat destinations still read `owner`: `recall`'s hand, `cacheUnit`'s
 * cache, and `eraseMod`'s R65 erased pile. They are left alone deliberately —
 * "zones follow control" plainly reaches them, but a stolen unit BOUNCED into
 * the thief's hand is a power change nobody has asked for yet, and the Manual
 * says a recall goes to its owner's hand. Cosmic Reversal above passes an
 * explicit `to: controller` because its PRINTED TEXT says so, which is a
 * different argument and does not generalise.
 *
 * Seeds 9400-9499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { Entity, Seat } from '../src/types.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import { getCard } from '../src/cards/dsl.ts';
import {
  ent, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

const P = printed as unknown as Record<string, {
  name: string; kind: string; type: string; text?: string;
}>;

/**
 * DERIVE, NEVER ENUMERATE (docs/13-assessment.md §7.2). Every printed Spell
 * Unit, off the card data. Naming the fourteen that exist today would go stale
 * the day the pool grows, and the card itself derives the same set through a
 * DIFFERENT channel (`E.card(name).kind`, i.e. the live registry), which is
 * what §1c cross-checks.
 */
const spellUnitCards = (): string[] => Object.values(P)
  .filter(c => c.kind === 'spellUnit').map(c => c.name);

/** Every card that stands in play as a unit — the population Q5 can move. */
const unitShapedCards = (): string[] => Object.values(P)
  .filter(c => c.kind === 'unit' || c.kind === 'spellUnit').map(c => c.name);

const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const handOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.hand;
const trashEvents = (h: Harness, from: number): { seat: number; card: string; binNth?: number }[] =>
  h.events.slice(from)
    .filter(ev => ev.type === 'trashed')
    .map(ev => ev.data as unknown as { seat: number; card: string; binNth?: number });

/** answer every decision that is standing, taking the first option each time */
const settleDecisions = (h: Harness): void => {
  let guard = 20;
  while (h.state.decision && guard-- > 0) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
};

/**
 * The one fixture §1 keeps re-using: `A` attacks with `attackers`, so the
 * battle is fought in `D`'s home region, and `D` casts Cosmic Reversal into
 * the block window with the stack empty.
 *
 * ⚠ THE REGION IS LOAD-BEARING AND IT IS NOT A DETAIL OF THE FIXTURE. R243:
 * *"every card that says 'all' is actually 'all in this region'"*, so the
 * board half is `unitsIn(ctx.region)`. The battle region is the DEFENDER's
 * home (`startBattleRound`), so the defender's whole board is in reach and the
 * attacker's is in reach exactly to the extent that it attacked. A spell unit
 * left at home by the attacker is NOT recalled, and that is R243 rather than
 * an oversight — see §1e.
 */
function castReversal(h: Harness, A: Seat, D: Seat, attackers: number[]): void {
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: attackers.map(id => [id]) });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Cosmic Reversal') });
  settleDecisions(h);
  pass(h); pass(h);
  settleDecisions(h);
}

// ══ §1 — THE BOARD HALF ══════════════════════════════════════════════

test('R250: Cosmic Reversal recalls a spell unit in play to its controller hand', () => {
  // The plainest shape: the CASTER has a Jelly (a printed Spell Unit) standing
  // in the battle region, and gets it back. Before R250 the card iterated
  // `g.s.stack` and nothing else, so this Jelly was never even looked at.
  const h = new Harness(9400);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const su = spawn(h, D, 'Jelly');
  assert.equal(ent(h, su)!.kind, 'unit',
    'in play a spell unit is an ordinary unit — the spell-ness is a fact about the CARD');

  castReversal(h, A, D, [atk]);

  assert.equal(ent(h, su), undefined, 'the spell unit has left play');
  assert.ok(handOf(h, D).includes('Jelly'), 'and it is in its controller hand');
  assert.ok(!binOf(h, D).includes('Jelly'), 'a recall is not a trash — it never touched a bin');
});

test('R250: it recalls the CASTER own attacking spell unit — the room YFUE case', () => {
  // What Rashi was actually trying to do: bounce her own Leaping Lillik (a
  // printed Spell Unit) out of a fight it was about to lose. An attacking unit
  // stands in the DEFENDER's home region, which is the battle region, so it is
  // in reach of a {Battle} spell either seat casts.
  assert.ok(spellUnitCards().includes('Leaping Lillik'), 'Leaping Lillik is a printed Spell Unit');
  const h = new Harness(9401);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lillik = spawn(h, A, 'Leaping Lillik');

  castReversal(h, A, D, [lillik]);

  assert.equal(ent(h, lillik), undefined, 'the attacking spell unit has left play');
  assert.ok(handOf(h, A).includes('Leaping Lillik'),
    'and it went to ITS controller hand, not to the caster hand');
  assert.ok(!handOf(h, D).includes('Leaping Lillik'), 'the caster did not steal it');
});

test('R250 whole pool: every printed Spell Unit is recalled off the board', () => {
  // DERIVE, NEVER ENUMERATE. The card asks the live registry
  // (`E.card(name).kind === 'spellUnit'`); this asks printed.json. Two
  // channels, one population — that is the different-mechanism check, and it
  // is what keeps this correct when the fifteenth Spell Unit is printed.
  const names = spellUnitCards();
  assert.ok(names.length >= 14, `expected the pool Spell Units, found ${names.length}`);
  assert.deepEqual(
    names.filter(n => getCard(n).kind !== 'spellUnit'), [],
    'the registry and the printed data agree about which cards are Spell Units');

  const missed: string[] = [];
  let checked = 0;
  for (const name of names) {
    const h = new Harness(9402);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    let su: number;
    let atk: number;
    try {
      atk = spawn(h, A, 'Unit Token');
      su = spawn(h, D, name);
    } catch { continue; }
    if (!ent(h, su) || h.state.decision) continue;   // died on spawn, or asked a question
    try { castReversal(h, A, D, [atk]); } catch { continue; }
    checked++;
    if (ent(h, su) || !handOf(h, D).includes(name)) missed.push(name);
  }
  assert.ok(checked >= 12, `only ${checked} Spell Units reached the sweep`);
  assert.deepEqual(missed, [], 'every one of them was recalled to its controller hand');
});

test('R250: an ordinary unit in the same region is left alone', () => {
  // The complement, and the reason the sweep must ask the CARD rather than the
  // entity: in play a Spell Unit and a plain unit are the same `kind: 'unit'`,
  // so a board sweep that read the entity would take the whole table.
  const h = new Harness(9403);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const plain = spawn(h, D, 'Ignis Sprite');
  const su = spawn(h, D, 'Jelly');
  assert.equal(getCard('Ignis Sprite').kind, 'unit', 'Ignis Sprite is a plain printed Unit');

  castReversal(h, A, D, [atk]);

  assert.ok(ent(h, plain), 'the ordinary unit is still standing');
  assert.equal(ent(h, su), undefined, 'while the spell unit beside it went home');
});

test('R250 + R243: the board half is scoped to the region, like every other all', () => {
  // ⚠ THIS IS THE RULING, NOT A LIMITATION. R243 (owner, 2026-08-29): *"every
  // card that says 'all' is actually 'all in this region'"*. The attacker's
  // spell unit that stayed HOME is not in the battle region, so a {Battle}
  // spell cast in that battle cannot reach it — exactly as every other "all"
  // card in the pool already behaves. Written down here because a reader who
  // knows only R250 would call this a missed case.
  const h = new Harness(9404);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const homebody = spawn(h, A, 'Jelly');

  castReversal(h, A, D, [atk]);

  assert.notEqual(ent(h, homebody)!.region, h.state.battle?.region ?? -1,
    'the attacker Jelly never left its home region');
  assert.ok(ent(h, homebody), 'so it is untouched');
  assert.ok(!handOf(h, A).includes('Jelly'), 'and it did not go to a hand');
});

test('R250: a STOLEN spell unit is recalled to the seat that CONTROLS it', () => {
  // The two rulings meeting. Printed: "put them into their controller's
  // hands", and Q5 says the same thing about a bin. `recall` defaults to the
  // OWNER, so this only comes out right because the card says so explicitly.
  const h = new Harness(9405);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const su = spawn(h, A, 'Jelly');
  withE(h, e => { e.giveControl(e.entity(su)!, D); });
  assert.equal(ent(h, su)!.owner, A, 'A still owns it');
  assert.equal(ent(h, su)!.controller, D, 'D controls it');

  castReversal(h, A, D, [atk]);

  assert.ok(handOf(h, D).includes('Jelly'), 'it goes to the CONTROLLER hand');
  assert.ok(!handOf(h, A).includes('Jelly'), 'not to the owner one');
});

test('R250: the log names both halves of the sweep, whether or not it found anything', () => {
  // card-todo #114's second, separable finding: even a player who knew the
  // rule could not audit the sweep. With an empty stack the card used to say
  // only "there is no other spell effect on the stack", which named neither
  // the board nor the spell units it had been cast for.
  const h = new Harness(9406);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Jelly');

  castReversal(h, A, D, [atk]);

  const lines = h.log.filter(l => l.includes('Cosmic Reversal'));
  assert.ok(lines.some(l => /spell unit/i.test(l)),
    'the log says how many spell units in play the sweep looked at');
  assert.ok(lines.some(l => /stack item/i.test(l)),
    'and how many stack items it looked at');
});

// ══ §2 — THERE IS NO CASTABILITY RESTRICTION ═════════════════════════

test('R250: Cosmic Reversal is offered with an EMPTY stack — there is no spell-effect requirement', () => {
  // Report #119's diagnosis: *"it assumed the spell needed to be cast while
  // there was a spell effect on the stack"*. Measured on the legality channel
  // the client reads, that is simply not so, and it never was — the card
  // carries no `targets`, no `restrict` and no `canPlay`, so nothing about the
  // stack can gate it.
  const h = new Harness(9410);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const idx = give(h, D, 'Cosmic Reversal');

  assert.equal(h.state.stack.length, 0, 'the stack is empty');
  assert.equal(h.state.priority, D, 'and D has priority');
  const acts = legalActions(h.state, D);
  assert.ok(acts.some(a => a.type === 'playCard' && (a as { handIndex: number }).handIndex === idx),
    'Cosmic Reversal is on the legal-action list anyway');

  // and it really is castable, not merely listed
  h.do({ type: 'playCard', seat: D, handIndex: idx });
  assert.ok(h.state.stack.some(it => it.card === 'Cosmic Reversal'), 'it went on the stack');
});

// ══ §3 — ARE TRIGGERS RESPONDABLE? ═══════════════════════════════════

/** Eminence of the Barrens: "[Augment] Whenever I am dealt damage, you may pay
 * [one]. If you do, I fight another target unit." ONE trigger, two damage
 * sources, two different answers — which is the whole point of §3.
 *
 * ⚠ Two spellings, because the engine writes the same ability two ways: the
 * `triggered` announcement joins with an em dash, the STACK LABEL joins with a
 * colon. A test that knew only one of them would silently assert nothing. */
const EMINENCE = /Eminence of the Barrens\s*[:\u2014]\s*you may pay/;

test('R250: a trigger fired OUTSIDE the damage step reaches the stack and IS respondable', () => {
  // Half one of the owner's "all triggers are respondable", and it is true.
  // A takes non-combat damage on its attacking Eminence from D's Flame of
  // History; the resulting trigger is pushed with `pushItem`, which resets
  // `passes` to 0 and hands priority to whoever did NOT act — so D is looking
  // at the trigger on the stack with a live window to answer it.
  const h = new Harness(9420);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const emi = spawn(h, A, 'Eminence of the Barrens');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 3);
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[emi]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  settleDecisions(h);            // Flame picks its target
  pass(h); pass(h);              // Flame resolves; the Eminence trigger fires
  settleDecisions(h);            // its controller aims it

  const item = h.state.stack.find(it => EMINENCE.test(it.label));
  assert.ok(item, 'the trigger is ON THE STACK');
  assert.equal(item!.kind, 'triggered', 'as a triggered item');
  assert.equal(h.state.passes, 0, 'the push reset the pass count');
  assert.equal(h.state.priority, D, 'and handed priority to the seat that did not control it');
  // and the window is REAL: hand D another castable card and it is offered
  giveResources(h, D, 'fire', 3);
  const idx = give(h, D, 'Flame of History');
  assert.ok(legalActions(h.state, D).some(
    a => a.type === 'playCard' && (a as { handIndex: number }).handIndex === idx),
  'so D may cast something in response — this is what respondable means');
});

/* ⚠ THIS TEST PREDICTED ITS OWN DEATH, AND IT WAS RIGHT. It used to read:
 *
 *     test('R3 GUARD: the SAME trigger fired by COMBAT DAMAGE resolves with no
 *           priority window', …)
 *
 *     // ⚠ If this test ever goes red because a window appeared, R3 has been
 *     // overruled and R250 §3 must be re-read before it is "fixed" — the
 *     // owner believes this window already exists, and the honest answer is
 *     // that R3 says it does not.
 *
 *     assert.ok(h.state.decision, 'the trigger is asking its controller something');
 *     assert.equal(h.state.priority, null, 'and nobody holds priority while it does');
 *     assert.deepEqual(legalActions(h.state, D), [],
 *       'the other seat cannot act at all — no window, rather than a refused spell');
 *     …
 *     assert.ok(!named('stackPushed'),
 *       'but it NEVER reached the stack — R3, a special action between damage sub-steps');
 *     assert.ok(named('resolved'), 'it resolved anyway, in the same breath');
 *
 * The window appeared. R261 put it there, deliberately, because the owner
 * believed it existed and was RIGHT: R250 §3 read R3 one step too far. So the
 * instruction that comment left has been carried out — R250 §3 was re-read,
 * and the ruling rather than the test was what moved. What follows is the same
 * board, the same trigger and the same card, inverted.
 *
 * The one thing that did NOT move is the announcement: `fireEvent` writes
 * 'triggered' at QUEUE time, inside the sub-step, because the condition is
 * evaluated at event time (R1). So the shape is 'triggered' BEFORE
 * 'afterCombat' and 'stackPushed' AFTER it, and that pair is asserted below. */
test('R261: the SAME trigger fired by COMBAT DAMAGE also reaches the stack, in the after-combat window', () => {
  const h = new Harness(9421);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const emi = spawn(h, A, 'Eminence of the Barrens');
  // the blocker must actually HIT: a 0-power body deals no combat damage and
  // the trigger this whole test is about would never fire. The second unit is
  // there so the fight has a legal target and the trigger RESOLVES instead of
  // fizzling — a fizzle would prove the wrong thing.
  const blocker = spawn(h, D, 'Good Whale');
  spawn(h, D, 'Ignis Sprite');
  giveResources(h, A, 'earth', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[emi]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] }, send: [], spellTokens: [] });
  const mark = h.events.length;
  pass(h); pass(h);              // both pass out of the block window → combat damage

  // ⚠ THE SHARPEST ASSERTION IN THE FILE, INVERTED. The trigger has fired and
  // is asking its controller the same question it always asked — but the
  // question is now asked on the way to the STACK, in the after-combat window,
  // and when it is answered the other seat is looking at a live item with a
  // real window to answer it. That is the state room YFUE should have been in.
  assert.ok(h.state.decision, 'the trigger is asking its controller something');
  settleDecisions(h);

  const item = h.state.stack.find(it => EMINENCE.test(it.label));
  assert.ok(item, 'the trigger is ON THE STACK — the same place §2 above found it when the '
    + 'damage came from a spell instead');
  assert.equal(item!.kind, 'triggered');
  assert.equal(h.state.battle!.step, 'afterWindow',
    'and the window it is sitting in is the AFTER-COMBAT one, not a sub-step');
  assert.equal(h.state.passes, 0, 'the push reset the pass count');
  assert.equal(h.state.priority, D,
    'priority is with the seat that does NOT control it — a window, rather than a refused '
    + 'spell');
  // and the window is REAL, measured the way §2 measures it: a castable card
  // in the other seat's hand is offered.
  giveResources(h, D, 'fire', 3);
  const idx = give(h, D, 'Flame of History');
  assert.ok(legalActions(h.state, D).some(
    a => a.type === 'playCard' && (a as { handIndex: number }).handIndex === idx),
  'so D may answer a COMBAT-DAMAGE trigger — this is the half R250 §3 got wrong');

  const after = h.events.slice(mark);
  const named = (t: string) => after.some(ev => ev.type === t && EMINENCE.test(ev.msg));
  const at = (t: string) => after.findIndex(ev => ev.type === t && EMINENCE.test(ev.msg));
  assert.ok(after.some(ev => ev.type === 'combatDamage'), 'combat damage happened');
  assert.ok(named('triggered'), 'and the Eminence trigger fired');
  assert.ok(named('stackPushed'), 'and this time it DID reach the stack (R261)');
  assert.ok(!named('resolved'),
    'and it has NOT resolved — the stack is still holding it, which is what respondable means');
  // R261's log shape, and the reason R1 is untouched: the announcement is
  // inside the damage step, the push is after it. Both halves, in order.
  const ac = after.findIndex(ev => ev.type === 'afterCombat');
  assert.ok(ac > 0, 'the damage step ran to its after-combat step');
  assert.ok(at('triggered') < ac,
    'ANNOUNCED inside the damage step — the condition is evaluated at event time (R1) and the '
    + 'trigger really did trigger there');
  assert.ok(at('stackPushed') > ac,
    'PUSHED after it — what R261 moved is the build and the resolution, never the firing');
});

// ══ §4 — A STOLEN UNIT THAT DIES ═════════════════════════════════════

test('R250: a stolen unit that dies is trashed by its CONTROLLER, into the controller bin', () => {
  const h = new Harness(9430);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const id = spawn(h, A, 'Ignis Sprite');
  withE(h, e => { e.giveControl(e.entity(id)!, D); });
  assert.equal(ent(h, id)!.owner, A, 'A still owns it — control is not ownership');
  const mark = h.events.length;
  withE(h, e => { e.destroy(e.entity(id)!, 'dies'); });

  const tr = trashEvents(h, mark).filter(t => t.card === 'Ignis Sprite');
  assert.equal(tr.length, 1, 'exactly one trash');
  assert.equal(tr[0]!.seat, D, 'the CONTROLLER trashed it');
  assert.ok(binOf(h, D).includes('Ignis Sprite'), 'and it is in the controller bin');
  assert.ok(!binOf(h, A).includes('Ignis Sprite'), 'not in the owner one');
});

test('R250 whole pool: every unit-shaped card dies into the bin of whoever controls it', () => {
  // The blast radius, measured rather than argued: the OLD code sent every one
  // of these to `u.owner`, so this whole population moved. It is asserted over
  // the derived pool for the same reason R244's sweep was — a fix proved on
  // one card is a fix for one card.
  const wrongSeat: string[] = [], wrongBin: string[] = [];
  let checked = 0;
  for (const name of unitShapedCards()) {
    const h = new Harness(9431);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    let id: number;
    try { id = spawn(h, A, name); } catch { continue; }
    const u0 = ent(h, id);
    if (!u0) continue;                              // died on spawn
    withE(h, e => { e.giveControl(e.entity(id)!, D); });
    const u = ent(h, id);
    if (!u || u.controller !== D || u.owner !== A) continue;
    const mark = h.events.length;
    withE(h, e => { e.destroy(e.entity(id)!, 'dies'); });
    checked++;
    const tr = trashEvents(h, mark).filter(t => t.card === name);
    if (tr.length !== 1 || tr[0]!.seat !== D) wrongSeat.push(name);
    if (!binOf(h, D).includes(name) && !(h.state.players[D]!.erased ?? []).includes(name)) {
      wrongBin.push(name);
    }
  }
  assert.ok(checked > 300, `only ${checked} cards reached the death route`);
  assert.deepEqual(wrongSeat, [], 'every one is trashed by its controller');
  assert.deepEqual(wrongBin, [], 'and lands in the controller bin (or the controller erased pile)');
});

test('R250: a MOD goes to the HOST CONTROLLER bin, superseding R244 destination half', () => {
  // ⚠ THIS REVERSES [R244] §1's *"⚠ THE DESTINATION DOES NOT MOVE. A card
  // still goes to its own OWNER's bin — Rashi's Virus lands in Rashi's bin —
  // because ownership is not control."* The owner has ruled the other way:
  // **zones always follow control, one rule, no split.** R244's ATTRIBUTION
  // half is untouched and is asserted here beside the new destination, because
  // the two are now the same seat and a test that checked only one of them
  // could not tell a correct engine from one that had collapsed the pair back
  // into a single number for the wrong reason.
  //
  // R244 itself flagged this seam: it recorded that the engine "could get away
  // with" conflating attribution and destination "only because no caller had
  // ever made them differ".
  const h = new Harness(9432);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Bumblecrab', D, 'augment'); });
  assert.ok(ent(h, host), 'the host survived the mod');
  const mod = Object.values(h.state.entities).find(e => e.kind === 'mod' && e.card === 'Bumblecrab');
  assert.equal(mod!.owner, D, 'D owns the Virus it cast');
  assert.equal(mod!.controller, A, 'but A controls it — a mod is part of the unit it sits on');
  const mark = h.events.length;
  // the RECALL route: a mod left behind in a bin really stays there, so it is
  // trashed (R137/R70) and its destination is observable. On a DEATH the mod
  // is swept out with its Unstable host and is not trashed at all (R244 §2).
  withE(h, e => { e.recall(e.entity(host)!); });

  const tr = trashEvents(h, mark).filter(t => t.card === 'Bumblecrab');
  assert.equal(tr.length, 1, 'the mod was trashed');
  assert.equal(tr[0]!.seat, A, 'R244 stands: attributed to the HOST controller');
  assert.ok(binOf(h, A).includes('Bumblecrab'), 'R250: and it lands in that same seat bin');
  assert.ok(!binOf(h, D).includes('Bumblecrab'), 'the mod owner bin does not get it back');
  assert.equal(tr[0]!.binNth, 0,
    'so the R131 bin ref is STAMPED now — under R244 this case was deliberately absent');
});

test('R250 whole pool: every card that can become a mod bins to the host controller, stamped', () => {
  // The blast radius of the destination half, derived from printed data the
  // same way R244 derived its own: a {Virus} is augmented onto a unit by
  // casting it, and [Switch]/[Switch1] is the graft marker. R244 measured 203
  // such cards and moved ATTRIBUTION for 200 of them on this route; R250 moves
  // DESTINATION for the same 200, and turns 0-of-200 stamped bin refs into
  // 200-of-200.
  const moddable = Object.values(P)
    .filter(c => (c as { virus?: boolean }).virus || /\[Switch1?\]|\{Switch1?\}/.test(c.text ?? ''))
    .map(c => c.name);
  assert.ok(moddable.length > 150, `expected the moddable population, found ${moddable.length}`);

  const wrongBin: string[] = [], unstamped: string[] = [];
  let checked = 0;
  for (const name of moddable) {
    const h = new Harness(9436);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    let host: number;
    try { host = spawn(h, A, 'Good Whale'); } catch { continue; }
    withE(h, e => { e.attachMod(e.entity(host)!, name, D, 'augment'); });
    if (!ent(h, host)) continue;                    // the mod killed the host
    const mark = h.events.length;
    withE(h, e => { e.recall(e.entity(host)!); });
    checked++;
    const tr = trashEvents(h, mark).filter(t => t.card === name);
    if (!binOf(h, A).includes(name) || binOf(h, D).includes(name)) wrongBin.push(name);
    if (tr.length !== 1 || tr[0]!.binNth === undefined) unstamped.push(name);
  }
  assert.ok(checked > 150, `only ${checked} cards reached the recall route`);
  assert.deepEqual(wrongBin, [], 'every one lands in the host controller bin');
  assert.deepEqual(unstamped, [],
    'and every one carries an R131 bin ref, because trasher and bin now agree');
});

test('R250: no live caller can make the trasher and the bin owner differ any more', () => {
  // The consequence the ruling has for `noteTrashed`'s `binSeat`, established
  // rather than assumed. Both routes that pass the parameter are swept above
  // and below; this asserts the INVARIANT the parameter now rests on — a mod
  // controller is its host controller — over the whole moddable pool, on the
  // route where a mod is minted and on the route where a control change moves
  // it. If this ever goes red, `binSeat` has a live case again and R244's -1
  // rule is back in play; do not "simplify" it away on the strength of the
  // sweeps alone.
  const moddable = Object.values(P)
    .filter(c => (c as { virus?: boolean }).virus || /\[Switch1?\]|\{Switch1?\}/.test(c.text ?? ''))
    .map(c => c.name);
  const split: string[] = [];
  let checked = 0;
  for (const name of moddable) {
    const h = new Harness(9437);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    let host: number;
    try { host = spawn(h, A, 'Good Whale'); } catch { continue; }
    withE(h, e => { e.attachMod(e.entity(host)!, name, D, 'augment'); });
    const u = ent(h, host);
    if (!u) continue;
    withE(h, e => { e.giveControl(e.entity(host)!, D); });   // R8 walks u.mods
    const after = ent(h, host);
    if (!after) continue;
    checked++;
    for (const id of after.mods) {
      const m = h.state.entities[id];
      if (m && m.controller !== after.controller) split.push(`${name}:${m.card}`);
    }
  }
  assert.ok(checked > 150, `only ${checked} cards were checked`);
  assert.deepEqual(split, [], 'a mod controller is always its host controller');
});

test('R140 GUARD: the body bin ref is stamped, and it counts in the bin the card really reached', () => {
  // R244 drops the R131 bin ref when the trasher and the bin owner differ,
  // because a "recall that card from YOUR bin" reaching into the wrong bin is
  // how an innocent older copy of the same name gets taken (R140). Moving the
  // BODY's destination onto the controller does not reopen that: it moves
  // BOTH numbers together, so they never differ and the stamp is always
  // computed. The older copy planted below is what makes the nth mean
  // something.
  const h = new Harness(9433);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  h.state.players[D]!.bin.push('Ignis Sprite');       // an innocent older copy
  const id = spawn(h, A, 'Ignis Sprite');
  withE(h, e => { e.giveControl(e.entity(id)!, D); });
  const mark = h.events.length;
  withE(h, e => { e.destroy(e.entity(id)!, 'dies'); });

  const tr = trashEvents(h, mark).filter(t => t.card === 'Ignis Sprite');
  assert.equal(tr[0]!.seat, D, 'trashed by the controller');
  assert.equal(tr[0]!.binNth, 1, 'and stamped as the SECOND copy in the controller bin');
  assert.equal(binOf(h, D).filter(c => c === 'Ignis Sprite').length, 2,
    'which is where the two copies really are');
});

test('R137 GUARD: a stolen Unstable body is still trashed before it is swept', () => {
  // R244's opening worry, one ruling later. An implementation that moves the
  // body's bin must not quietly stop the body TRASHING on the way through it —
  // that is playtest report #93 (Dropslime trashed from a hand fired, the same
  // Dropslime dying under a grafted Wraith fired nothing), and it is the one
  // thing R137 exists to prevent.
  const h = new Harness(9434);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Bumblecrab', A, 'augment'); });
  withE(h, e => { e.giveControl(e.entity(host)!, D); });
  assert.ok(withE_isUnstable(h, host), 'a modded unit is Unstable (R69)');
  const mark = h.events.length;
  withE(h, e => { e.destroy(e.entity(host)!, 'dies'); });

  const tr = trashEvents(h, mark).filter(t => t.card === 'Good Whale');
  assert.equal(tr.length, 1, 'the body was trashed on its way through the bin');
  assert.equal(tr[0]!.seat, D, 'by the controller — R250');
  assert.ok(!binOf(h, D).includes('Good Whale'), 'and then swept back out — R137');
  assert.ok((h.state.players[D]!.erased ?? []).includes('Good Whale'),
    'onto the CONTROLLER erased pile, the same seat the bin belonged to');
});

/** `E.isUnstable` through the harness — a read, not a mutation. */
function withE_isUnstable(h: Harness, id: number): boolean {
  let out = false;
  withE(h, e => { out = e.isUnstable(e.entity(id)!); });
  return out;
}

// ══ §5 — the units the board sweep sees ══════════════════════════════

test('R250: unitsOf still reports a recalled spell unit as gone from both boards', () => {
  // A small consistency read: after the sweep neither seat has the card in
  // play, which is the fact every other query in the client is built on.
  const h = new Harness(9440);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Jelly');

  castReversal(h, A, D, [atk]);

  assert.ok(!unitsOf(h, D).some((u: Entity) => u.card === 'Jelly'), 'not on the controller board');
  assert.ok(!unitsOf(h, A).some((u: Entity) => u.card === 'Jelly'), 'nor on the other one');
});
