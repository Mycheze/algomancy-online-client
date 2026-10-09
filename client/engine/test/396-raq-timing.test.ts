/**
 * RAQ batch D — play timing, play permissions, and the rules-questions Q&A
 * threads, each claim read against the engine (ledgers/raq.ts).
 *
 * Every test here names the thread it comes from and quotes the claim. A
 * `{ todo }` test is a claim the engine does NOT honour today: it reproduces
 * the gap and stays out of the gate until the owner has seen the list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import {
  ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/** answer the pending decision by option label */
function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}
const labels = (h: Harness): string[] => (h.state.decision?.options ?? []).map(o => o.label);
/** decline whatever is still being asked ("Done", else the first option) */
function finishAsking(h: Harness): void {
  for (let k = 0; k < 6 && h.state.decision; k++) {
    const d = h.state.decision;
    const i = d.options.findIndex(o => o.label === 'Done');
    h.do({ type: 'decide', seat: d.seat, choice: i < 0 ? 0 : i });
  }
}

/* ═══ Tides of the Cosmos ═══════════════════════════════════════════════
 * RAQ "[Solved] Tides of Cosmos - all you need to know." (_passer) and
 * "[Solved] Does Tides of the cosmos ignore timing of cards?" (calebgannon).
 */

/** D casts Tides in A's attack window, with `deck` on top; resolves to the first pick */
function tides(seed: number, deck: string[], setup?: (h: Harness, A: Seat, D: Seat) => void): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);                          // bbb / 8, and nothing else
  setup?.(h, A, D);
  toNextBattle(h, A);
  const fill = Array(Math.max(0, 8 - deck.length)).fill('Good Whale');
  h.state.sharedDeck = [...deck, ...fill, 'Dune Drifter'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);                                          // Tides resolves → the first pick
  return { h, A, D };
}

test('RAQ Tides 1: a free play ignores affinity — a fire unit with only water resources', () => {
  const { h, D } = tides(39601, ['Ignis Sprite']);
  decide(h, l => l.startsWith('Ignis Sprite'));              // r/1, D owns no fire at all
  finishAsking(h);
  pass(h); pass(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Ignis Sprite'), 'played with zero fire affinity');
  finishBattle(h);
});

test('RAQ Tides 2: a free play ignores timing — a deploy unit and a deploy spell unit, in battle', () => {
  const { h, D } = tides(39602, ['Curio Drifter', 'Lonely Forager']);
  decide(h, l => l.startsWith('Curio Drifter'));             // deploy timing
  decide(h, l => l.startsWith('Lonely Forager'));            // deploy timing spell unit
  finishAsking(h);
  for (let k = 0; k < 4 && h.state.stack.length; k++) { pass(h); pass(h); }
  assert.ok(unitsOf(h, D).some(u => u.card === 'Curio Drifter'), 'the deploy unit was played in battle');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Lonely Forager'), 'and so was the deploy spell unit');
  finishBattle(h);
});

test('RAQ Tides 8: the total cost of 8 or less reads printed costs — Tranquility does not shrink it', () => {
  // "Things which affect cost of spells (like Tranquility or The Silent) won't
  // have affect on 'total cost of 8 or less', meaning you only look at printed cost"
  const { h } = tides(39603, ['Burn the Blight', 'Equilibriate'], (g, A) => {
    spawn(g, A, 'Tranquility');                              // spells cost one more in battle
  });
  assert.ok(labels(h).some(l => l.startsWith('Burn the Blight [3]')), 'the menu reads the printed [3]');
  decide(h, l => l.startsWith('Burn the Blight'));           // printed [3] — 5 left (4 if taxed)
  assert.ok(labels(h).some(l => l.startsWith('Equilibriate')),
    'a printed [5] spell still fits the 5 that is left: Tranquility taxes neither spell here');
  finishAsking(h);
  finishBattle(h);
});

test('RAQ Tides 7: a free play is a play — Bloomcaster hears a unit Tides plays', () => {
  // "Played units/spells will trigger things with wording 'when you play ...'
  // like Bloomcaster or Death Greeter."
  const { h, D } = tides(39604, ['Curio Drifter'], (g, _A, d) => { spawn(g, d, 'Bloomcaster'); });
  const before = unitsOf(h, D).filter(u => u.card === 'Unit Token').length;
  decide(h, l => l.startsWith('Curio Drifter'));
  finishAsking(h);
  for (let k = 0; k < 4 && h.state.stack.length; k++) { pass(h); pass(h); }
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Unit Token').length, before + 1,
    'Bloomcaster made its 1/1 off the free play');
  finishBattle(h);
});

test('RAQ Tides 5: an additional cost is still paid, and a unit from the same Tides is not in play to pay it', () => {
  // "Any additional [cost] of the card must be paid. That means you CANNOT use
  // Volatile Toxicity on Towering Colossus from same Tides of the Cosmos (he
  // cannot be sacrificed, since he is not yet in play)."
  // R338 (CT-221): pushInlinePlay collects the cast window's own [cost] now;
  // until then no sacrifice was asked and the free Volatile Toxicity resolved
  // into nothing.
  const { h, D } = tides(39605, ['Towering Colossus', 'Volatile Toxicity'], (g, _A, d) => {
    spawn(g, d, 'Curio Drifter');                            // something D CAN sacrifice
  });
  const curio = unitsOf(h, D).find(u => u.card === 'Curio Drifter')!.id;
  decide(h, l => l.startsWith('Towering Colossus'));         // [5]
  decide(h, l => l.startsWith('Volatile Toxicity'));         // [2]
  // R337: the Colossus is itself a Virus card, so Tides asks how it is played
  decide(h, l => l === 'Play Towering Colossus');
  const asked = (h.state.decision?.options ?? []).map(o => JSON.stringify(o.value));
  assert.ok(asked.includes(JSON.stringify({ unit: curio })),
    `the sacrifice is asked, and the unit in play is offered; menu was [${labels(h).join(' | ')}]`);
  assert.ok(!labels(h).some(l => l.includes('Towering Colossus')),
    'the Colossus is on the stack, not in play, so it is not a sacrifice option');
});

test('RAQ Tides 6a: an X spell counts as cost 0 against the budget and is played at X = 0', () => {
  // "Any spells with X cost can only be played with X=0 making most of them useless"
  // (and R157 §1: the X card is choosable at [0]).
  const { h, A } = tides(39608, ['Wildfire']);
  assert.ok(labels(h).some(l => l === 'Wildfire [0]'), `Wildfire is offered at [0]; menu [${labels(h).join(' | ')}]`);
  decide(h, l => l.startsWith('Wildfire'));
  finishAsking(h);
  const item = h.state.stack.find(i => i.card === 'Wildfire');
  assert.ok(item, 'Wildfire is on the stack');
  assert.ok(!item.x, `with X = 0 (got ${item.x})`);
  const before = unitsOf(h, A).map(u => [u.id, u.damage ?? 0]);
  for (let k = 0; k < 4 && h.state.stack.length; k++) { pass(h); pass(h); }
  assert.deepEqual(unitsOf(h, A).map(u => [u.id, u.damage ?? 0]), before, 'and it deals 0 damage');
  finishBattle(h);
});

test('RAQ Tides 4: Tides plays a card, never a graft or a plain augment', () => {
  // _passer: "You cannot use cards to apply Mods (other than Viruses). So no
  // Grafting or non-virus augments." calebgannon: augments are not virus-like
  // under Tides "because augment in general is a special action".
  const { h, D } = tides(39609, ['Accelerated Germination', 'Bloomcaster']);
  const seen: string[] = [];
  decide(h, l => l.startsWith('Accelerated Germination'));   // graftable ([Switch1])
  seen.push(...labels(h));
  decide(h, l => l.startsWith('Bloomcaster'));               // an [Augment] unit
  for (let k = 0; k < 6 && h.state.decision; k++) { seen.push(...labels(h)); finishAsking(h); }
  assert.ok(!seen.some(l => /graft|augment/i.test(l)), `no mod is ever offered; asked [${seen.join(' | ')}]`);
  for (let k = 0; k < 6 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) finishAsking(h); else pass(h);
  }
  assert.ok(unitsOf(h, D).some(u => u.card === 'Bloomcaster'), 'the augment card arrives as a unit');
  assert.ok(unitsOf(h, D).filter(u => u.card === 'Unit Token').length >= 2, 'the graftable spell resolved as a spell');
  finishBattle(h);
});

test('RAQ Tides 6: Frosted Denial (X cannot be zero) is not a card Tides can play', () => {
  // "Any spells with X cost can only be played with X=0 … it also means that
  // you CANNOT play Frosted Denial from Tides of Cosmos." Frosted Denial
  // prints "X can't be zero".
  const { h } = tides(39606, ['Frosted Denial']);
  assert.ok(!labels(h).some(l => l.startsWith('Frosted Denial')), 'Frosted Denial is not offered');
});

test('RAQ Tides 3: a Virus card can be played from Tides as a Virus', () => {
  // "Tides allows you to play Viruses/Ambushes/Prophecy (you still look at
  // 'main' cost of the card, even if you used it as Ambush/Prophecy)."
  const { h } = tides(39607, ['Molten Riftbreaker'], (g, A) => { spawn(g, A, 'Dune Drifter'); });
  decide(h, l => l.startsWith('Molten Riftbreaker'));
  decide(h, l => l === 'Done');                              // no second pick
  assert.ok(labels(h).some(l => /virus|augment/i.test(l)),
    `the Virus mode is offered; menu was [${labels(h).join(' | ')}]`);
});

/* ═══ Meteor Shower ══════════════════════════════════════════════════════
 * RAQ "[Solved] Meteor Shower. How it works." (_passer).
 */

test('RAQ Meteor Shower: rockfall chooses rather than targets, so Boon of Protection has nothing to negate', () => {
  // "Rockfall is 'choosing' effect rather than 'targeting', so it cannot be
  // negated by things like Boon of Protection. It also means that no targets
  // have to be declared when effects goes on stack"
  const h = new Harness(39610);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  spawn(h, D, 'Curio Drifter');
  giveResources(h, D, 'earth', 4);                           // Meteor Shower e/4
  giveResources(h, A, 'wood', 2);                            // Boon of Protection gg/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Meteor Shower') });
  const item = h.state.stack.find(i => i.card === 'Meteor Shower')!;
  assert.deepEqual(item.parts.flatMap(p => p.targets), [], 'no targets were declared on the stack');
  const boon = give(h, A, 'Boon of Protection');
  if (h.state.priority !== A) pass(h);
  assert.equal(h.state.priority, A, 'A holds priority over the Meteor Shower');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === boon),
    'Boon of Protection is not offered: a choosing effect targets none of the units in the region');
  finishBattle(h);
});

/* ═══ Bloomcaster ════════════════════════════════════════════════════════
 * RAQ "[Solved] Bloomcaster vs Mycelial Mentor and Spell Units." (_passer).
 * Both cards print [Augment] since the thread; played normally the text is live.
 */

test('RAQ Bloomcaster: its 1/1 resolves before the Mycelial Mentor it was played with arrives', () => {
  // "You play Mycelial Mentor. He goes on the stack (but is not Spawned / In
  // play yet). Bloomcaster trigger to create 1/1. After it resolves Mycelial
  // Mentor can be resolved and comes into play" — so Mentor never sees that token.
  const h = new Harness(39611);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Bloomcaster');
  giveResources(h, P, 'wood', 1);                            // Mycelial Mentor g/1
  const tokensBefore = unitsOf(h, P).filter(u => u.card === 'Unit Token').length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Mycelial Mentor') });
  for (let k = 0; k < 4 && h.state.decision; k++) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  const mentor = unitsOf(h, P).find(u => u.card === 'Mycelial Mentor');
  assert.ok(mentor, 'the Mentor arrived');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Unit Token').length, tokensBefore + 1, 'Bloomcaster made its 1/1');
  const token = unitsOf(h, P).find(u => u.card === 'Unit Token')!;
  assert.ok(token.id < mentor.id, 'the 1/1 was made before the Mentor spawned');
  assert.ok(!h.log.some(l => l.includes('Mycelial Mentor') && l.includes('+3/+3')),
    'and the Mentor never heard it: no +3/+3 off a token made before it was in play');
});

test('RAQ Bloomcaster: a negated spell unit still leaves the Bloomcaster 1/1 behind', () => {
  // "Bloomcaster will go on top of the Spell-Units effect on the stack and will
  // try to resolve before Spell effect itself, meaning you will get 1/1 from
  // Bloomcaster even if Spell-Units effect is negated."
  const h = new Harness(39612);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  spawn(h, D, 'Bloomcaster');
  giveResources(h, D, 'water', 3);                           // Jelly b/3
  giveResources(h, A, 'water', 1); giveResources(h, A, 'metal', 1);   // Dematerialize bm/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const tokensBefore = unitsOf(h, D).filter(u => u.card === 'Unit Token').length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  for (let k = 0; k < 3 && h.state.decision; k++) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  const top = h.state.stack[h.state.stack.length - 1]!;
  assert.ok(top.card !== 'Jelly' && (top.label ?? '').includes('Bloomcaster'),
    `the Bloomcaster trigger is on top of the spell unit; stack [${h.state.stack.map(i => i.label).join(', ')}]`);
  const jelly = h.state.stack.find(i => i.card === 'Jelly')!;
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Dematerialize') });
  const d = h.state.decision!;
  h.do({ type: 'decide', seat: A, choice: d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ stack: jelly.id })) });
  for (let k = 0; k < 12 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Jelly'), 'the spell unit was negated and never arrived');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Unit Token').length, tokensBefore + 1,
    'the Bloomcaster 1/1 is there anyway');
  finishBattle(h);
});

/* ═══ Spell units played by Hooba-Pon ════════════════════════════════════
 * RAQ "[Solved] Spell Units played when you can 'play a unit from hand'
 * (Hooba-Pon, Insidious Invitation)" (_passer).
 */

/** A attacks with Hooba-Pon and plays Jelly (a {Battle} spell unit, "Target
 * unit gains -2/-2") from hand through the attack trigger, aimed at D's
 * `victim`. Returns with Jelly on the stack. */
function ponPlaysJelly(seed: number, setup?: (h: Harness, A: Seat, D: Seat) => number[] | void) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const pon = spawn(h, A, 'Hooba-Pon');
  const victim = spawn(h, D, 'Good Whale');                  // 7/5 — survives -2/-2
  giveResources(h, A, 'water', 3);                           // Jelly b/3
  const alongside = setup?.(h, A, D) ?? [];                  // more attackers, each its own column
  toNextBattle(h, A);
  give(h, A, 'Jelly');
  h.do({ type: 'declareAttack', seat: A, columns: [[pon], ...alongside.map(id => [id])] });
  pass(h); pass(h);                                          // the attack trigger resolves
  decide(h, l => l === 'Jelly');
  for (let k = 0; k < 4 && h.state.decision; k++) {
    const d = h.state.decision;
    const t = d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: victim }));
    h.do({ type: 'decide', seat: d.seat, choice: t < 0 ? 0 : t });
  }
  assert.ok(h.state.stack.some(i => i.card === 'Jelly'), 'Jelly is on the stack');
  return { h, A, D, pon, victim };
}

test('RAQ Hooba-Pon spell unit: the spell part happens, then the unit spawns into the formation', () => {
  // "Yes, the spell part happens and if it resolves, the unit will spawn into formation."
  const { h, A, victim } = ponPlaysJelly(39620);
  for (let k = 0; k < 6 && h.state.stack.some(i => i.card === 'Jelly'); k++) pass(h);
  assert.deepEqual(h.state.entities[victim] ? [ent(h, victim)!.card] : [], ['Good Whale']);
  const jelly = unitsOf(h, A).find(u => u.card === 'Jelly');
  assert.ok(jelly, 'the Jelly body arrived');
  assert.ok(h.state.battle!.columns.some(c => c.includes(jelly.id)), 'into the formation');
  assert.ok(h.log.some(l => l.includes('-2/-2')), 'and the spell part happened');
  finishBattle(h);
});

test('RAQ Hooba-Pon spell unit: it counts as playing a spell', () => {
  // "Q: Does that count as 'playing a spell' for some triggers? A: Yes."
  const { h } = ponPlaysJelly(39621);
  assert.ok(h.events.some(e => e.type === 'spellPlayed' && e.data?.['card'] === 'Jelly'),
    'the play announced itself as a played spell');
  finishBattle(h);
});

test('RAQ Hooba-Pon spell unit: Origon negates it as the first spell played in this battle', () => {
  // "Q: Would Origon try to negate it? A: Yes" — Origon now prints "Whenever a
  // player plays their first spell in this battle, negate it."
  const { h, A } = ponPlaysJelly(39622, (g, _A, D) => { spawn(g, D, 'Origon'); });
  for (let k = 0; k < 8 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Jelly'), 'Origon negated it, so no body arrived');
  assert.ok(h.state.players[A]!.bin.includes('Jelly'), 'the negated card is in the bin');
  finishBattle(h);
});

test('RAQ Hooba-Pon spell unit: Molten Riftbreaker dying negates it as an allied spell', () => {
  // "Q: Molten Riftbreaker dying would negate that as 'allied SPELL'? A: Yes"
  let rift = 0;
  const { h, A, D } = ponPlaysJelly(39623, (g, a, d) => {
    rift = spawn(g, a, 'Molten Riftbreaker');                // 3/2, "When I despawn, negate all allied spells"
    giveResources(g, d, 'fire', 2);                          // Luminous Arc r/2
    return [rift];                                           // it attacks too, so it is in the fight
  });
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  const d = h.state.decision!;
  h.do({ type: 'decide', seat: D, choice: d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: rift })) });
  for (let k = 0; k < 10 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(ent(h, rift), undefined, 'the Riftbreaker died');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Jelly'), 'and took the Jelly play with it');
  finishBattle(h);
});

test('RAQ Hooba-Pon spell unit: negated, the unit does not enter play', () => {
  // "As always - if the spell is negated, then unit doesn't enter play."
  const { h, A, D } = ponPlaysJelly(39624, (g, _a, d) => {
    giveResources(g, d, 'water', 1); giveResources(g, d, 'metal', 1);   // Dematerialize bm/2
  });
  const jelly = h.state.stack.find(i => i.card === 'Jelly')!;
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  const d = h.state.decision!;
  h.do({ type: 'decide', seat: D, choice: d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ stack: jelly.id })) });
  for (let k = 0; k < 10 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Jelly'), 'no Jelly body');
  finishBattle(h);
});

/* ═══ Dispatch Courier ═══════════════════════════════════════════════════
 * RAQ "[Solved] Dispatch Courier vs Battle Timing" (_passer) and the
 * rules-questions thread it came from (calebgannon: "it's gotta be no").
 */

test('RAQ Dispatch Courier: a Battle spell unit is not playable in the haste step either', () => {
  // "Does units / spell-units with :battle: timing can be played during :haste:
  // thanks to Dispatch Courier? No" — the unit half is 26-metal-a; this is the
  // spell-unit half.
  const h = new Harness(39630);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'water', 3);
  giveResources(h, A, 'metal', 2);
  const jelly = give(h, A, 'Jelly');                         // b/3 {Battle} spell unit
  const dc = give(h, A, 'Dispatch Courier');                 // a deploy unit — the grant applies
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.handIndex === dc), 'the grant is live');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === jelly),
    'the {Battle} spell unit is NOT offered in the haste step');
  assert.throws(() => h.do({ type: 'playCard', seat: A, handIndex: jelly }));
});

/* ═══ Temporal Rift vs NIT sending counter-attack ([Considered]) ═════════
 * The thread's question is still open (calebgannon: "Yeah I'm still working on
 * the ruling"). Its one stated fact is checkable.
 */

test('RAQ Temporal Rift thread: the non-initiative player still attacks when the initiative player declines', () => {
  // _passer: "Counter-attacks ARE allowed even if IT players decides to Pass
  // his attack opportunity." — R15: NIT then attacks round 2 with any unit.
  const h = new Harness(39640);
  toDeployment(h);
  const IT = h.state.initiative, NIT = (1 - IT) as Seat;
  spawn(h, IT, 'Curio Drifter');                             // IT COULD attack, and declines
  const u = spawn(h, NIT, 'Curio Drifter');
  toNextBattle(h, IT);
  h.do({ type: 'declareAttack', seat: IT, columns: [] });
  assert.equal(h.state.battle!.attacker, NIT, 'round 2 is the non-initiative player');
  assert.ok(h.legal(NIT).some(a => a.type === 'declareAttack' && a.columns.flat().includes(u)),
    'and any of their units may go, with no block step having sent them');
});

/* ═══ rules-questions: "Mana question" (calebgannon) ═════════════════════ */

test('RAQ Mana question: affinity counts resources already spent — two wood pay for many gg cards', () => {
  // calebgannon: "You don't care if it's tapped or not. All resources tap for
  // generic mana. The affinity dots just require you have at least that many
  // resources of that type somewhere in your manabase. So you could play 100
  // accelerated germination if you had 2 wood and 198 shards for example"
  const h = new Harness(39650);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'wood', 2);
  giveResources(h, P, 'shard', 4);
  for (let n = 1; n <= 3; n++) {
    const i = give(h, P, 'Accelerated Germination');         // gg / 2
    assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === i),
      `Accelerated Germination #${n} is playable with ${h.state.players[P]!.resources.filter(r => r.state === 'open').length} open resources`);
    h.do({ type: 'playCard', seat: P, handIndex: i });
    for (let k = 0; k < 3 && h.state.decision; k++) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
  assert.equal(h.state.players[P]!.resources.filter(r => r.state === 'open').length, 0, 'six mana paid in all');
  assert.equal(h.state.players[P]!.hand.filter(c => c === 'Accelerated Germination').length, 0, 'all three were played');
});

/* ═══ rules-questions: "Another set of questions, this time on" ══════════ */

test('RAQ Another set: Rebalance is playable with no unit of your own — it targets nothing', () => {
  // calebgannon: "Yes you can still play it without a unit (it doesn't target
  // anything so there are no requirements for you having a unit)"
  const h = new Harness(39660);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'wood', 2);                            // Rebalance g/2; D has no unit at all
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(unitsOf(h, D).length, 0, 'the caster has no unit anywhere');
  const r = give(h, D, 'Rebalance');
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.handIndex === r), 'Rebalance is offered');
  h.do({ type: 'playCard', seat: D, handIndex: r });
  for (let k = 0; k < 6 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(ent(h, atk)!.controller, D, 'and it resolves: the attacker hands its unit over');
  finishBattle(h);
});

test('RAQ Another set: a Ghord sacrifice reaches only the opponent units in its own region', () => {
  // calebgannon: "Yes everything in the game is region specific. Just add 'in
  // this region' to every card if it helps." (asked of Ghord: "When you
  // sacrifice a unit, each opponent sacrifices a nontoken unit")
  const h = new Harness(39662);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  spawn(h, P, 'Ghord');
  const fodder = spawn(h, P, 'Curio Drifter');
  const theirs = spawn(h, O, 'Good Whale');                  // at THEIR home, not in Ghord's region
  assert.notEqual(ent(h, theirs)!.region, ent(h, fodder)!.region, 'two different regions');
  withE(h, e => { e.destroy(e.s.entities[fodder]!, 'is sacrificed'); e.settle(); });
  for (let k = 0; k < 4 && h.state.decision; k++) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.ok(h.events.some(ev => ev.type === 'died' && ev.data?.['verb'] === 'is sacrificed'), 'the sacrifice happened');
  assert.ok(ent(h, theirs), 'the opponent unit in another region is not sacrificed');
});

test('RAQ Another set: Organic Exchange may target two of your own units, and a spell aimed at one still resolves', () => {
  // calebgannon: "You can target your own 2 units, but another effect targeting
  // them would still resolve (they're still the same units). Things only
  // wouldn't resolve if a unit changed to a different location"
  const h = new Harness(39661);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a1 = spawn(h, A, 'Good Whale');                      // 7/5
  const a2 = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'fire', 2);                            // Luminous Arc r/2
  giveResources(h, A, 'wood', 3);                            // Organic Exchange gg/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  h.do({ type: 'decide', seat: D, choice: h.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: a1 })) });
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Organic Exchange') });
  for (const id of [a1, a2]) {
    const d = h.state.decision!;
    const i = d.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: id }));
    assert.notEqual(i, -1, `an ally is a legal Organic Exchange target; menu [${d.options.map(o => o.label).join(' | ')}]`);
    h.do({ type: 'decide', seat: d.seat, choice: i });
  }
  for (let k = 0; k < 10 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.equal(ent(h, a1), undefined, 'the Arc still resolved on the unit it aimed at — 6 damage kills the 7/5');
  assert.ok(ent(h, a2), 'and the other one is untouched');
  finishBattle(h);
});
