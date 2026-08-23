/* R105 — {Modular} takes ANY mod you can pay for, and a modded card is Unstable.
 *
 * Owner ruling, 2026-08-23, on CARD-TODO #19:
 *
 *   "I think it's legal to apply ANYTHING to a Modular card. But many cards
 *    wont do anything at all since it requires being in play (which a spell
 *    never is). Same with viruses, they should also be allowed to be applied
 *    to the modular card, even if they might not do anything"
 *
 * and, on what the card is FOR:
 *
 *   "A modded Spellbind should also have unstable. It basically works as a
 *    'flashback' for graft cards. You pay 1 to put it on the stack, then add
 *    in some effects from your yard that you also want to happen. Since
 *    otherwise, gaining 1 rot is pretty bad"
 *
 * Three things had to become true, and only the first is visible in a menu:
 *
 *  1. the OFFER is every card in hand and bin whose cost you can pay — no
 *     graft gate, no augment-capability gate, viruses included;
 *  2. a mod's type-line [Augment] attribute is DONATED to the resolving effect
 *     (R79's channel, a different timing) — without this the widened offer
 *     donates nothing and the fix looks done while changing nothing. Graftable
 *     cards and attribute-granting cards are DISJOINT in the pool (137 and 22,
 *     overlap zero), so before this, donation through {Modular} was impossible;
 *  3. the carrier is {Unstable} (Manual p.35), so the whole pile is ERASED and
 *     a mod applied from the bin can never be flashed back twice.
 *
 * [Augment] TEXT still does nothing on a spell — "many cards wont do anything
 * at all" — and that is asserted here as a DELIBERATE no-op, because an
 * unasserted no-op is how a dead card survives a green suite.
 *
 * Seeds 9100-9199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard, isGraftable } from '../src/cards/dsl.ts';
import { ent, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { DecisionOption, Entity, Seat, StackItem } from '../src/types.ts';

// ── helpers ───────────────────────────────────────────────────────────

/** A live battle window with A holding priority, an empty hand and an empty
 * bin — so the {Modular} menu contains EXACTLY what a test puts there. */
function window(seed: number): { h: Harness; A: Seat; D: Seat; atk: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');            // 3/3, no attrs, no triggers
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.decision, null, 'a vanilla attacker asks nothing');
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin.length = 0;
  return { h, A, D, atk };
}

function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision;
  assert.ok(dec, 'a decision was expected');
  const i = dec!.options.findIndex(match);
  if (i === -1) throw new Error(`no matching option in [${dec!.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec!.seat, choice: i });
}

/** answer the {Modular} window: apply each named mod in order, then stop */
function applyMods(h: Harness, ...names: string[]): void {
  for (const n of names) pickBy(h, o => o.card === n);
  if (h.state.decision?.options.some(o => o.label === 'No more mods')) {
    pickBy(h, o => o.label === 'No more mods');
  }
}

function drain(h: Harness, guard = 40): void {
  while (h.state.stack.length && h.state.phase === 'battle' && guard-- > 0) {
    if (h.state.decision) throw new Error(`unexpected decision while draining: ${h.state.decision.prompt}`);
    pass(h);
  }
}

const bin = (h: Harness, s: Seat): string[] => h.state.players[s]!.bin;
const erased = (h: Harness, s: Seat): string[] => h.state.players[s]!.erased ?? [];
const count = (xs: string[], n: string): number => xs.filter(c => c === n).length;
const item = (h: Harness, card: string): StackItem => h.state.stack.find(i => i.card === card)!;
const unitsNamed = (h: Harness, n: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.card === n);
const trashed = (h: Harness): unknown[] =>
  h.events.filter(e => e.type === 'trashed').map(e => e.data!['card']);
const damageTo = (h: Harness, id: number): number[] =>
  h.events.filter(e => e.type === 'damage' && e.data?.['unit'] === id).map(e => e.data!['n'] as number);

// ── 1. the offer ──────────────────────────────────────────────────────

/**
 * The anti-narrowing test. One card of every capability class sits in hand,
 * and every one of them must be offered:
 *
 *   Primordial Coalescence  graftable                 (the ONLY class offered before)
 *   Chitin Shredder         {Virus}, type-line [Augment] {Powerful}
 *   Tempest Wrangler        NOT a virus, type-line [Augment] {Alluring} — one of the
 *                           eight cards that could reach a spell by no route at all
 *   Sparkwraith             text-box [Augment] only, no attributes to grant
 *   Soul Tithe              neither graftable nor augmentable — inert as a mod, and
 *                           legal anyway ("even if they might not do anything")
 *
 * Any filter reintroduced above `canPayCard` drops at least one of these, so
 * this test fails the moment the menu is narrowed again.
 */
test('R105: the {Modular} menu offers every card you can pay for — graft, virus, non-virus augment, [Augment] text, and a card that can do nothing at all', () => {
  const { h, A } = window(9101);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 2);
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'fire', 1);                     // 5 mana; 4 left after Spellbind
  const MENU = ['Chitin Shredder', 'Primordial Coalescence', 'Soul Tithe', 'Sparkwraith', 'Tempest Wrangler'];
  for (const n of MENU) give(h, A, n);
  give(h, A, 'Oorblak');                             // eee/4 — earth affinity 3, and you have 2

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  const dec = h.state.decision;
  assert.ok(dec, '{Modular} asks as the card is played (R35 cast-time cost)');
  const offered = dec!.options.filter(o => o.card).map(o => o.card!).sort();

  assert.deepEqual(offered, [...MENU].sort(),
    'the offer is exactly the cards you can pay for — one per capability class, no filter above the cost');
  // named individually so a regression says WHICH class was dropped
  assert.ok(offered.includes('Primordial Coalescence'), 'a GRAFT is still offered (no regression)');
  assert.ok(offered.includes('Chitin Shredder'), 'a VIRUS is offered — the owner named viruses explicitly');
  assert.ok(offered.includes('Tempest Wrangler'), 'a NON-VIRUS type-line augment is offered — {Modular} is its only route to a spell');
  assert.ok(offered.includes('Sparkwraith'), 'an [Augment]-TEXT card is offered even though its text cannot do anything here');
  assert.ok(offered.includes('Soul Tithe'), 'a card that is neither graft nor augment is offered — a wasteful play is still a legal one');
  assert.ok(!offered.includes('Oorblak'), 'the COST is the whole filter, and it is still enforced (eee needs 3 earth affinity)');
  assert.ok(dec!.options.some(o => o.label === 'No more mods'), 'and declining is always on the menu');
});

test('R105: a card in the BIN is offered beside the hand, and an unaffordable one is not', () => {
  const { h, A } = window(9102);
  giveResources(h, A, 'dark', 4);                    // Spellbind 1, then 3 left
  bin(h, A).push('Primordial Coalescence');          // d/3 — affordable from the bin
  bin(h, A).push('Pestilent Titan');                 // d/4 — one mana too many
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  const offered = h.state.decision!.options.filter(o => o.card).map(o => o.label);
  assert.deepEqual(offered, ['Primordial Coalescence (bin)'],
    'the bin is a source, and "you still pay their costs" is enforced against it');
});

// ── 2. what a mod contributes ─────────────────────────────────────────

test('R105: a GRAFT mod still contributes its [Switch] effect as an extra part', () => {
  const { h, A } = window(9103);
  giveResources(h, A, 'dark', 4);
  give(h, A, 'Primordial Coalescence');              // "[Switch1] Create three Wraiths and gain 2 Rot."
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyMods(h, 'Primordial Coalescence');

  const it = item(h, 'Spellbind');
  assert.deepEqual(it.parts.map(p => p.effectKey),
    ['spell:Spellbind', 'graft:Primordial Coalescence'],
    'the graft joins the composite as an extra part (Manual p.33) — unchanged by R105');
  assert.deepEqual(it.mods, [{ card: 'Primordial Coalescence', from: 'hand' }]);
  drain(h);
  assert.equal(h.state.players[A]!.rot ?? 0, 3, "Spellbind's own rot plus the rider's two");
  assert.equal(unitsNamed(h, 'Wraith').length, 3, "and the rider's three Wraiths");
});

test('R105: a mod with NO graft effect adds no part, and the spell resolves rather than throwing', () => {
  const { h, A } = window(9104);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 2);
  give(h, A, 'Rampart Guardian');                    // ee/2 {Virus}, [Augment] {Tough}, no graft effect
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyMods(h, 'Rampart Guardian');

  const it = item(h, 'Spellbind');
  assert.ok(!isGraftable('Rampart Guardian'), 'the premise: this card has no [Switch] half');
  assert.deepEqual(it.parts.map(p => p.effectKey), ['spell:Spellbind'],
    'no `graft:Rampart Guardian` part — there is no such effect to look up, and pushing one threw');
  assert.deepEqual(it.mods, [{ card: 'Rampart Guardian', from: 'hand' }], 'it is attached all the same');
  drain(h);   // the assertion IS that this completes: an invented graft key throws in effectByKey
  assert.equal(h.state.players[A]!.rot ?? 0, 1, 'Spellbind resolved normally');
});

// ── 3. attribute donation, with an observable consequence ─────────────

/**
 * The half that makes the ruling mean something, proved on the damage number
 * rather than on a flag. Spellbind carries Twin Flame's [Switch] half ("I deal
 * 2 damage to each of up to two target units") and Chitin Shredder's type-line
 * [Augment] {Powerful}; {Powerful} doubles what the source deals (R79/R103),
 * and the source of a grafted rider is the carrier.
 *
 * Two runs, identical but for the one mod, so the doubling is a DIFF: 2 → 4,
 * which is also the difference between a 3/3 attacker living and dying.
 */
test('R105: a type-line [Augment] mod really donates — {Powerful} turns a Spellbind-carried Twin Flame from 2 damage into 4', () => {
  // control: the graft alone
  {
    const { h, A, atk } = window(9105);
    giveResources(h, A, 'dark', 1);
    giveResources(h, A, 'fire', 3);
    give(h, A, 'Twin Flame');                        // rr/3
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
    applyMods(h, 'Twin Flame');
    pickBy(h, o => String(o.label).includes('The Foretold'));
    drain(h);
    assert.deepEqual(damageTo(h, atk), [2], 'the printed 2, undoubled');
    assert.equal(ent(h, atk)!.damage, 2, 'and the 3/3 survives it');
  }
  // the same cast, plus the {Powerful} mod
  {
    const { h, A, atk } = window(9106);
    giveResources(h, A, 'dark', 2);
    giveResources(h, A, 'fire', 2);
    giveResources(h, A, 'earth', 2);                 // 6 mana: 1 + 3 + 2
    give(h, A, 'Twin Flame');
    give(h, A, 'Chitin Shredder');                   // ee/2 [Augment] {Powerful}, no text at all
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
    applyMods(h, 'Twin Flame', 'Chitin Shredder');
    pickBy(h, o => String(o.label).includes('The Foretold'));
    const it = item(h, 'Spellbind');
    assert.deepEqual(new E(h.state).stackModAttrs(it), ['Powerful'],
      'the mod donates its type-line attribute to the item, exactly as R79 does for a virus');
    drain(h);
    assert.deepEqual(damageTo(h, atk), [4], '{Powerful} doubled what the source dealt');
    assert.equal(ent(h, atk), undefined, 'and 4 is lethal to a 3/3 — the consequence, not the flag');
  }
});

test('R105: a donated attribute reaches EffectCtx.grantedAttrs, the one field everything downstream reads', () => {
  const { h, A } = window(9107);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'water', 1);
  give(h, A, 'Tempest Wrangler');                    // b/1, NOT a virus, [Augment] {Alluring}
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyMods(h, 'Tempest Wrangler');
  const e = new E(h.state);
  const it = item(h, 'Spellbind');
  assert.deepEqual(e.stackModAttrs(it), ['Alluring']);
  assert.ok(e.itemAttrs(it).has('Alluring'),
    'and the resolution-time attribute check sees it too ({Afflicting} reads this set)');
  assert.deepEqual(e.stackAugmentAttrs(it), [],
    'R79\'s virus channel is untouched — {Modular} donates through its own, so neither can be mistaken for the other');
});

// ── 4. [Augment] TEXT on a spell: a deliberate no-op ──────────────────

/**
 * "Many cards wont do anything at all since it requires being in play (which a
 * spell never is)" — the owner. Caleb 2025-04-24 said the same for viruses:
 * "spells cannot gain static abilities like that, so the only useful thing you
 * can do is give them attributes."
 *
 * This is asserted rather than assumed, because a silent no-op and an
 * unimplemented card look identical from outside. Sparkwraith's whole card is
 * "[Augment] Whenever you play a spell, put a +1/+1 counter on me" — so the
 * test plays a spell while it rides the stack and proves the trigger stays
 * dead, on a card that demonstrably HAS the text.
 */
test('R105: an [Augment]-TEXT mod is accepted and does nothing — a spell has no body for a triggered ability, and that is correct', () => {
  const { h, A } = window(9108);
  giveResources(h, A, 'dark', 2);
  giveResources(h, A, 'fire', 1);
  assert.equal(getCard('Sparkwraith').augmentText?.length, 1,
    'the premise: this card really does carry text-box [Augment] text');
  assert.deepEqual(getCard('Sparkwraith').augmentAttrs, [], 'and grants no type-line attribute');
  give(h, A, 'Sparkwraith');                         // r/1
  give(h, A, 'Spellbind');                           // a second spell, to be played later

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyMods(h, 'Sparkwraith');
  const it = item(h, 'Spellbind');
  assert.deepEqual(it.mods, [{ card: 'Sparkwraith', from: 'hand' }], 'it really is attached');
  assert.deepEqual(it.parts.map(p => p.effectKey), ['spell:Spellbind'],
    'its [Augment] text donates NO part — there is nothing for the ability to live on');
  assert.deepEqual(new E(h.state).stackModAttrs(it), [], 'and no attributes, because it prints none');

  // "Whenever you play a spell" — play one, right now, while it rides the stack
  pass(h);                                           // the opponent declines to answer
  h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.indexOf('Spellbind') });
  applyMods(h);
  drain(h);
  assert.deepEqual(h.events.filter(e => e.type === 'countersChanged'), [],
    'no counter was placed anywhere: the trigger has no host, so it never fires');
  assert.deepEqual(unitsNamed(h, 'Sparkwraith'), [], 'and no body was ever created for it');
  assert.equal(h.state.players[A]!.rot ?? 0, 2, 'both Spellbinds resolved — the no-op cost a card, not the cast');
});

// ── 5. the cost ───────────────────────────────────────────────────────

test('R105: "you still pay their costs" — the mod is charged at cast, and applying it is not PLAYING it', () => {
  const { h, A } = window(9109);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'water', 2);
  const before = h.q.openMana(A);
  give(h, A, 'Tempest Wrangler');                    // b/1
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  assert.equal(h.q.openMana(A), before - 1, "Spellbind's own [1] is paid first");
  applyMods(h, 'Tempest Wrangler');
  assert.equal(h.q.openMana(A), before - 2, "and the mod's [1] on top of it, before the item reaches the stack");
  assert.ok(!h.state.players[A]!.hand.includes('Tempest Wrangler'), 'the mod left the hand');
  assert.deepEqual(h.events.filter(e => e.type === 'spawned' && e.data?.['card'] === 'Tempest Wrangler'), [],
    'R37: applying a mod is not playing a card — no body spawns');
  drain(h);
});

// ── 6. {Unstable}: the flashback, and its price ───────────────────────

/**
 * The card working exactly as designed, end to end.
 *
 * Owner: "It basically works as a 'flashback' for graft cards. You pay 1 to
 * put it on the stack, then add in some effects from your yard that you also
 * want to happen. Since otherwise, gaining 1 rot is pretty bad."
 *
 * Manual p.35: "As long as a card is modded, it has the unstable attribute,
 * meaning when it dies or is erased, it and all of its mods are erased with
 * it. This means that even though mods can be applied from the bin, they are
 * generally only able to be applied once." That sentence is about THIS window
 * — it is the only one in the game that applies a mod from a bin — and the
 * one-shot is the price of the flashback, not a harsh edge case.
 *
 * If someone later "tidies" the erase back into a bin, this test is what says
 * no: the graft becomes infinitely reusable and the drawback disappears.
 */
test('R105: the flashback line — a graft card in the BIN is replayed by Spellbind, happens, and is ERASED so it can never be flashed back twice', () => {
  const { h, A } = window(9110);
  giveResources(h, A, 'dark', 4);
  bin(h, A).push('Primordial Coalescence');          // "[Switch1] Create three Wraiths and gain 2 Rot."
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyMods(h, 'Primordial Coalescence');
  assert.deepEqual(item(h, 'Spellbind').mods, [{ card: 'Primordial Coalescence', from: 'bin' }],
    'applied from the bin, which is the whole point of the card');
  assert.equal(item(h, 'Spellbind').unstable, true,
    'a modded card is Unstable — stamped at cast, before the item reaches the stack');
  assert.equal(count(bin(h, A), 'Primordial Coalescence'), 0, 'and it has already left the bin');

  drain(h);
  // (a) the graft effect really happened
  assert.equal(unitsNamed(h, 'Wraith').length, 3, 'the bin card\'s [Switch] half resolved: three Wraiths');
  // (b) the rot is gained — the drawback the flashback is paying for
  assert.equal(h.state.players[A]!.rot ?? 0, 3, "Spellbind's rot plus the rider's two");
  // (c) the mod does NOT come back
  assert.equal(count(bin(h, A), 'Primordial Coalescence'), 0,
    'it never returns to the bin — otherwise the flashback is infinite');
  // (d) it is in the public erased pile, and so is the carrier
  assert.equal(count(erased(h, A), 'Primordial Coalescence'), 1, 'R65: the mod is erased, publicly');
  assert.equal(count(erased(h, A), 'Spellbind'), 1, 'and the carrier with it (R69: Unstable is a BIN replacement)');
  assert.equal(count(bin(h, A), 'Spellbind'), 0, 'the carrier reaches no bin either');
  assert.ok(!trashed(h).includes('Spellbind'),
    'nothing was TRASHED: R40 — it came from the stack, and it never entered a bin to be trashed out of');
});

test('R105: an UNMODDED {Modular} spell is not Unstable — it is binned like any other spell (R40)', () => {
  const { h, A } = window(9111);
  giveResources(h, A, 'dark', 2);
  giveResources(h, A, 'water', 1);
  give(h, A, 'Tempest Wrangler');                    // a real, payable offer…
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  pickBy(h, o => o.label === 'No more mods');        // …declined: nothing is applied
  assert.equal(item(h, 'Spellbind').unstable, undefined, 'no mod, no stamp');
  drain(h);
  assert.equal(count(bin(h, A), 'Spellbind'), 1, 'the bin, not the erased pile');
  assert.equal(count(erased(h, A), 'Spellbind'), 0);
});

/**
 * The asymmetry that raised the question in the first place, closed.
 *
 * A mod applied through the {Modular} window and a virus applied through
 * R79's window are the same act — something is applied to a spell — and they
 * used to have opposite outcomes: the virus erased the pile, the {Modular}
 * mod binned it and left it reusable. One card (Chitin Shredder), one carrier
 * (Spellbind), two routes, one assertion: if the two paths ever diverge again,
 * this fails.
 */
test('R105 = R79: the {Modular} window and the virus window agree — either way the carrier and the mod are erased, never binned', () => {
  /** cast a Spellbind with Chitin Shredder attached by `route`, and report where everything ended up */
  const run = (seed: number, route: 'modular' | 'virus'): Record<string, number> => {
    const { h, A } = window(seed);
    giveResources(h, A, 'dark', 1);
    giveResources(h, A, 'earth', 2);
    if (route === 'modular') {
      give(h, A, 'Chitin Shredder');
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
      applyMods(h, 'Chitin Shredder');
    } else {
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
      applyMods(h);                                  // no {Modular} mods — the virus comes later
      pass(h);                                       // the opponent declines to answer
      h.do({
        type: 'augment', seat: A, from: 'hand',
        index: give(h, A, 'Chitin Shredder'), hostStack: item(h, 'Spellbind').id,
      });
      pass(h); pass(h);                              // the virus is a response: it resolves first
    }
    drain(h);
    return {
      spellBinned: count(bin(h, A), 'Spellbind'),
      spellErased: count(erased(h, A), 'Spellbind'),
      modBinned: count(bin(h, A), 'Chitin Shredder'),
      modErased: count(erased(h, A), 'Chitin Shredder'),
    };
  };
  const modular = run(9112, 'modular');
  const virus = run(9113, 'virus');
  assert.deepEqual(modular, { spellBinned: 0, spellErased: 1, modBinned: 0, modErased: 1 },
    'a {Modular} mod makes its carrier Unstable: both cards are erased, neither is binned');
  assert.deepEqual(modular, virus,
    'and R79\'s virus window agrees exactly — the same act cannot have two disposals');
});

test('R105: a NEGATED modded Spellbind is erased too — Unstable is a bin replacement, so no exit reaches a bin', () => {
  const { h, A, D } = window(9114);
  giveResources(h, A, 'dark', 4);
  giveResources(h, D, 'fire', 2);
  bin(h, A).push('Primordial Coalescence');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyMods(h, 'Primordial Coalescence');
  const target = item(h, 'Spellbind').id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Tithe') });   // "negate that effect"
  pickBy(h, o => JSON.stringify(o.value).includes(String(target)));
  pass(h); pass(h);
  pickBy(h, o => /^Don't pay/.test(o.label));        // A has no mana left: the ransom goes unpaid
  drain(h);
  assert.equal(unitsNamed(h, 'Wraith').length, 0, 'the negation landed — no Wraiths');
  assert.equal(count(bin(h, A), 'Spellbind'), 0, 'a negated Unstable carrier still cannot reach a bin (R68 + R69)');
  assert.equal(count(erased(h, A), 'Spellbind'), 1);
  assert.equal(count(erased(h, A), 'Primordial Coalescence'), 1, 'and the mod goes with it');
  assert.equal(count(bin(h, A), 'Primordial Coalescence'), 0);
});
