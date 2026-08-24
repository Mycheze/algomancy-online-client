/* R104 — THE REPLACEMENT-EFFECT LAYER, tested as a layer.
 *
 * The per-card behaviour lives with each card (12-fire-a for Conduit of Pain,
 * 26-metal-a for Automaton of Abundance and Cosmic Conspirator, 27-metal-b for
 * Flux Resonator, 40-light-c for Nullbringer and Suspend, 45-hybrids-ld-b for
 * Proliferating Slime, 46-hybrids-ld-c for Counter Theif). What is here is
 * everything that is true of the LAYER rather than of any one card, because
 * that is the part playtest reports #60 and #75 are about:
 *
 *   · the two families COMPOSE differently, and the difference is a ruling;
 *   · a replacement never reaches the stack, so nothing can negate it and no
 *     priority window opens inside it;
 *   · the events that USED to fire no longer do, which is the only observable
 *     difference between a replacement and the trigger it replaces.
 *
 * HOUSE RULES this file obeys, both learned the hard way:
 *  · assertions are on the engine's EVENT VOCABULARY and on state, never on
 *    log prose — a prose-matching test gets deleted the first time somebody
 *    improves a sentence;
 *  · no `{ todo: true }`. A todo can never fail, which is how Harbinger of
 *    Immolation stayed completely dead through two playtest reports and a
 *    conceded game while the suite was green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
  tokensOf, unitsOf,
} from './util.ts';
import type { EngineEvent, Seat } from '../src/types.ts';

/** run raw engine calls against the harness state, absorbing a suspension (E
 * may REPLACE its state object on a mid-part rollback, so h.state is
 * re-pointed afterwards) — the same helper the per-card files use. */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** the events one action produced, so a test can assert on what was NOT said */
function during(h: Harness, fn: () => void): EngineEvent[] {
  const before = h.events.length;
  fn();
  return h.events.slice(before);
}

const typesIn = (evs: EngineEvent[], t: string): EngineEvent[] => evs.filter(e => e.type === t);

// ══ 1. THE AMOUNT FAMILY COMPOSES BY SUMMING ═══════════════════════════
//
// Caleb settled it: "a replacement only happens once … The replacement just
// takes what would be 1 and makes it 2". So two DIFFERENT modifiers both
// apply, and none applies to its own contribution.

test('two different AmountMods both apply to one counter placement', () => {
  // Flux Resonator ("counters put on an allied unit, plus one") and
  // Proliferating Slime ("counters put on an ENEMY unit or player, plus one")
  // are two different cards reading the same quantity from opposite sides. Put
  // one of each on opposite sides of a battle and give the Slime's controller's
  // enemy — who is the Resonator's controller — some counters: both apply.
  const h = new Harness(8701);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Flux Resonator');       // allied to A
  const slime = spawn(h, D, 'Proliferating Slime'); // A is its enemy
  toNextBattle(h, A);
  // R12: a mod only sees its own region, so the Resonator has to come to where
  // the Slime is — it attacks into the defender's region, which is exactly how
  // the two cards would ever meet in a real game.
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  assert.equal(ent(h, slime)!.region, ent(h, mine)!.region, 'both are in the battle region');
  // R130: a white-box placement NAMES ITS ACTOR. In a real game `by` comes
  // free from the resolving effect's controller; called straight off an E
  // there is no effect to read it from, and the Resonator's printed "by an
  // ALLIED source" now asks the question for real — an unattributed placement
  // is not an allied one.
  whiteBox(h, e => e.addCounters(e.entity(mine)!, 1, A));
  assert.equal(ent(h, mine)!.counters, 3,
    '1 printed + 1 from the Resonator (an ally of A) + 1 from the Slime (an enemy of A) = 3');
  finishBattle(h);
});

test('an AmountMod does not apply to its own contribution', () => {
  // The whole reason the two families are separate. The trigger
  // implementations these replace RE-ENTERED addCounters, so each needed a
  // module-level `let` to stop itself looping — report #60 counted five of
  // them. A query cannot re-enter the thing it is answering about, so one Flux
  // Resonator adds exactly one counter however many times you ask it.
  const h = new Harness(8702);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const fr = spawn(h, A, 'Flux Resonator');
  const ally = spawn(h, A, 'Unit Token');
  whiteBox(h, e => e.addCounters(e.entity(ally)!, 1, A));
  assert.equal(ent(h, ally)!.counters, 2, '1 + 1, and not 1 + 1 + 1 + …');
  assert.equal(ent(h, fr)!.counters, 0, 'and the Resonator did not put any on itself');
});

test('two copies of the SAME AmountMod both apply — they are two modifiers', () => {
  const h = new Harness(8703);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Flux Resonator');
  spawn(h, A, 'Flux Resonator');
  const ally = spawn(h, A, 'Unit Token');
  whiteBox(h, e => e.addCounters(e.entity(ally)!, 2, A));
  assert.equal(ent(h, ally)!.counters, 4, '2 + 1 + 1');
});

test('one counter placement produces ONE countersChanged carrying the modified number', () => {
  // The observable difference from the post-hoc trigger this replaces. Flux
  // Resonator used to let the printed counters land (firing a countersChanged
  // for the WRONG number) and then reach into `u.counters` directly to add its
  // own, silently, to dodge its own re-entrancy.
  const h = new Harness(8704);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Flux Resonator');
  const ally = spawn(h, A, 'Unit Token');
  const evs = during(h, () => whiteBox(h, e => e.addCounters(e.entity(ally)!, 2, A)));
  const changed = typesIn(evs, 'countersChanged');
  assert.equal(changed.length, 1, 'exactly one event for one placement');
  assert.equal(changed[0]!.data!['n'], 3, 'and it carries 3, not 2 with a silent extra after it');
  assert.equal(changed[0]!.data!['total'], 3);
});

test('Proliferating Slime reads rot and debt as the player counters they are', () => {
  // "an enemy unit OR PLAYER". docs/08 calls both rot and debt "a counter
  // accumulated by a PLAYER", and no other counter can be put on a player, so
  // the clause would otherwise be dead text. Now it is the same three lines as
  // the unit half rather than a second trigger with its own re-entrancy guard.
  const h = new Harness(8705);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Proliferating Slime');
  whiteBox(h, e => e.gainRot(D, 2));
  assert.equal(h.state.players[D]!.rot, 3, '2 rot arrives as 3');
  whiteBox(h, e => e.gainDebt(D, 1));
  assert.equal(h.state.players[D]!.debt, 2, '1 debt arrives as 2');
  whiteBox(h, e => e.gainRot(A, 2));
  assert.equal(h.state.players[A]!.rot, 2, 'and its own controller is not an enemy');
});

// ══ 2. THE REPLACEMENT FAMILY CONSUMES ═════════════════════════════════

test('a replacement fires once, not once per source that could have fired it', () => {
  // First-true-consumes, and the structural version of what the old
  // Nullbringer needed a WeakSet keyed on the event object to fake. Three
  // Nullbringers still turn +N into −N.
  const h = new Harness(8706);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Nullbringer');
  spawn(h, A, 'Nullbringer');
  spawn(h, A, 'Nullbringer');
  const lifeD = h.state.players[D]!.life;
  const evs = during(h, () => whiteBox(h, e => e.gainLife(D, 4, 'test')));
  assert.equal(h.state.players[D]!.life, lifeD - 4, 'exactly −4, not −12');
  assert.equal(typesIn(evs, 'lifeLost').length, 1, 'and exactly one lifeLost');
});

test('a counter REDIRECT moves the counters, it does not copy them', () => {
  // Counter Theif is the redirect half of the family: the number is untouched
  // and the recipient changes. Two thieves do not each get a set — the first
  // claimant consumes, ties by entity id, exactly as replaceRotDamage resolves
  // them.
  const h = new Harness(8707);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const first = spawn(h, A, 'Counter Theif');
  const second = spawn(h, A, 'Counter Theif');
  const victim = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  whiteBox(h, e => e.addCounters(e.entity(victim)!, 4));
  assert.deepEqual(
    [ent(h, victim)!.counters, ent(h, first)!.counters, ent(h, second)!.counters],
    [0, 4, 0],
    'four counters exist in total, and they are all on the lowest-id thief');
});

test('an AmountMod runs BEFORE the redirect — the thief steals the plus-one too', () => {
  // The printed order: "put that many counters plus one instead" describes what
  // WOULD be placed, and "those counters are placed on me instead" steals what
  // would be placed. So the amount is settled first.
  const h = new Harness(8708);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const thief = spawn(h, A, 'Counter Theif');
  spawn(h, A, 'Flux Resonator');
  const victim = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  whiteBox(h, e => e.addCounters(e.entity(victim)!, 1, A));
  assert.equal(ent(h, thief)!.counters, 2, '1 printed + the Resonator\'s 1, all stolen');
  assert.equal(ent(h, victim)!.counters, 0);
});

test('a donated [Augment] replacement reads from its HOST, not from the card that donated it', () => {
  // Six of the seven print their clause under [Augment], so the clause has to
  // travel with the card and rebind "me"/"allied"/"enemy" to the host. That
  // comes free from `E.anchored()` — a mod's text is anchored on its host and
  // reads from the host's perspective — which is the same rule Skittering
  // Blight's "counters on me" has always used. `augmentable: true` is what
  // keeps these cards recognised as augments now that their inert augmentText
  // entries are gone (the Rook / Emberflame Enlightener precedent).
  const h = new Harness(8709);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);
  giveResources(h, A, 'dark', 2);                   // Counter Theif md / 4
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Counter Theif'), hostId: host });
  toNextBattle(h, A);
  // the Counter Theif's own body is nowhere on the board — only the mod is —
  // so anything that lands has to have come from the HOST's anchor
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Counter Theif').length, 0);
  whiteBox(h, e => e.addCounters(e.entity(victim)!, 3));
  assert.equal(ent(h, host)!.counters, 3,
    'the counters landed on the HOST — "me" is the anchor, not the card that donated the text');
  assert.equal(ent(h, victim)!.counters, 0);
  finishBattle(h);
});

// ══ 3. NOTHING REACHES THE STACK ═══════════════════════════════════════
//
// CT-10's stated acceptance criterion, and the reason the whole layer exists.
// Containment Protocol negates "all activated and triggered effects"; Nothyr
// negates "up to one target nonspell effect". Neither can find a replacement,
// because a replacement is not an effect and never uses the stack.

/** put `card` in play for `seat`, attack with a body, and give the OPPONENT a
 *  Containment Protocol they can cast in response to whatever happens */
function battleWith(seed: number, mine: string): {
  h: Harness; A: Seat; D: Seat; me: number;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const me = spawn(h, A, mine);
  giveResources(h, D, 'metal', 3);                  // Containment Protocol mm/3
  toNextBattle(h, A);
  return { h, A, D, me };
}

test('Containment Protocol on the stack cannot negate a life-gain replacement', () => {
  const { h, A, D } = battleWith(8710, 'Nullbringer');
  const atk = unitsOf(h, A).find(u => u.card === 'Nullbringer')!;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk.id]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  // the Protocol is on the stack, waiting. The replacement happens under it and
  // is not something it can see.
  const lifeD = h.state.players[D]!.life;
  const evs = during(h, () => whiteBox(h, e => e.gainLife(D, 5, 'test')));
  assert.equal(h.state.players[D]!.life, lifeD - 5, 'the replacement happened');
  assert.equal(typesIn(evs, 'stackPushed').length, 0, 'nothing was pushed for it to negate');
  assert.equal(typesIn(evs, 'negated').length, 0, 'and nothing was negated');
  finishBattle(h);
});

test('Containment Protocol RESOLVING negates nothing a replacement did', () => {
  // The other half: resolve the Protocol with every one of the seven cards on
  // the board and confirm it finds nothing to negate. It is the sweep's
  // behavioural twin — the sweep proves no such card DECLARES a trigger, this
  // proves the negation path agrees.
  const h = new Harness(8711);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Nullbringer');
  spawn(h, A, 'Conduit of Pain');
  spawn(h, A, 'Flux Resonator');
  spawn(h, A, 'Counter Theif');
  spawn(h, A, 'Proliferating Slime');
  spawn(h, A, 'Automaton of Abundance');
  spawn(h, A, 'Cosmic Conspirator');
  giveResources(h, D, 'metal', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  const evs = during(h, () => { pass(h); pass(h); });
  assert.equal(typesIn(evs, 'negated').length, 0,
    'seven replacement cards in play and the Protocol negated nothing — a replacement is '
    + 'neither an activated nor a triggered effect');
  finishBattle(h);
});

test('Nothyr finds no nonspell effect to target while only replacements are in play', () => {
  // "When I am trashed, negate up to one target nonspell effect." Its target
  // list is built from the stack, so with nothing but replacements in play
  // there is nothing on it. The assertion is that the seven cards contribute
  // no candidates, which is the same statement as "they never reach the stack".
  const h = new Harness(8712);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Nullbringer');
  spawn(h, A, 'Counter Theif');
  spawn(h, A, 'Flux Resonator');
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  const evs = during(h, () => {
    whiteBox(h, e => e.addCounters(e.entity(ally)!, 2));
    whiteBox(h, e => e.gainLife(A, 3, 'test'));
  });
  assert.equal(h.state.stack.length, 0,
    'three replacements ran and the stack is still empty — nothing for Nothyr to target');
  assert.equal(typesIn(evs, 'triggered').length, 0, 'and nothing was queued');
  finishBattle(h);
});

// ══ 4. THE EVENTS THAT NO LONGER FIRE ══════════════════════════════════
//
// The only way to tell a replacement from a trigger that lands on the same
// final state is what the engine SAID on the way. Asserting the absence is
// therefore the assertion, and it is what the owner is actually complaining
// about in #60: "Nullbringer fires a lifeGained for a gain that never
// happened; Cosmic Conspirator really creates then erases, firing a spurious
// spawned event."

test('a replaced life gain fires no lifeGained, and leaves no per-battle gain ledger entry', () => {
  const h = new Harness(8720);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Nullbringer');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const evs = during(h, () => whiteBox(h, e => e.gainLife(D, 6, 'test')));
  assert.equal(typesIn(evs, 'lifeGained').length, 0, 'no lifeGained event');
  // and the state ledger behind it: "X is the life you've gained in this
  // battle" (Life Channel) must not count a gain that never happened
  const region = h.state.battle!.region;
  assert.equal(new E(h.state).battleCounter(region, `lifeGained:${D}`), 0,
    'and the per-battle life-GAIN ledger never saw it either');
  finishBattle(h);
});

test('a replaced token creation fires no spawned for the token that was never created', () => {
  // Cosmic Conspirator's old shape created the Robot, fired a `spawned`, asked,
  // and erased it. Every spawn listener in the region heard about a token the
  // card says was never created.
  const h = new Harness(8721);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Cosmic Conspirator');
  giveResources(h, A, 'metal', 2);
  const evs = during(h, () => {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Self-Assembly') });
    pick(h, 'Poison');
  });
  assert.equal(evs.filter(e => e.type === 'spawned' && e.data?.['card'] === 'Robot').length, 0,
    'no Robot ever spawned');
  assert.equal(typesIn(evs, 'erased').length, 0, 'and nothing was erased, because nothing existed');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Poison').length, 1, 'a Poison exists instead');
});

// ══ 5. THE BATCH ═══════════════════════════════════════════════════════

test('one resolving part is one creation batch, so unique is counted across the whole creation', () => {
  // Report #60: "Automaton of Abundance fires per spawn so N identical tokens
  // yield N copies instead of one per unique." Manufacture creates three Robots
  // in one resolution.
  const h = new Harness(8730);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  giveResources(h, A, 'metal', 6);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Manufacture') });
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Robot').length, 4,
    'three printed Robots and ONE copy');
});

test('a batch replacement adds its extras inside the same resolution, with no window between', () => {
  // "Not as a trigger, just as part of resolution of the damage" is the owner's
  // wording for R103's piercing, and it is the same standard here: the extra
  // tokens are created in the same resolving part, so nothing is queued and no
  // priority window opens between the printed tokens and the copy.
  const h = new Harness(8731);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  giveResources(h, A, 'metal', 6);
  const evs = during(h, () => {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Manufacture') });
  });
  assert.equal(typesIn(evs, 'triggered').length, 0, 'nothing was queued as a trigger');
  assert.equal(h.state.stack.length, 0, 'and the stack is empty when it is over');
  assert.equal(typesIn(evs, 'spawned').length, 4, 'four spawns, all inside one resolution');
});

test('a lone creation outside a resolving part is still a batch of one', () => {
  // The batch window is opened by `resolveParts`. An engine-internal creation
  // (or a direct call from a test) has no part to hang one on, and must not
  // therefore silently skip the batch replacement — it is its own batch.
  const h = new Harness(8732);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  whiteBox(h, e => { e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 2 }); });
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Robot').length, 2,
    'one Robot and its copy');
});

// ══ 6. THE LOCK ════════════════════════════════════════════════════════

test('a locked life total stops the replacement layer too — there is nothing left to replace', () => {
  // Suspend's lock is asked ABOVE the replacement hooks on purpose: once the
  // change cannot happen at all, there is nothing for Nullbringer to turn into
  // a loss. The two together must not produce a loss out of a gain that was
  // already forbidden.
  const h = new Harness(8740);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Nullbringer');
  giveResources(h, A, 'light', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suspend') });
  pick(h, { player: D });
  pass(h); pass(h);
  const lifeD = h.state.players[D]!.life;
  const evs = during(h, () => whiteBox(h, e => e.gainLife(D, 5, 'test')));
  assert.equal(h.state.players[D]!.life, lifeD, 'no gain and no loss');
  assert.equal(typesIn(evs, 'lifeGained').length, 0);
  assert.equal(typesIn(evs, 'lifeLost').length, 0,
    'Nullbringer did not turn a forbidden gain into a real loss');
  finishBattle(h);
});
