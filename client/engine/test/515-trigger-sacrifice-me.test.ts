/* 515 — "When …, sacrifice me. If you do, …": the sacrifice is part of the
 * EFFECT, made as the trigger resolves (CR 111.8). CT-264, report #259 (CWEU).
 *
 * The report (judge L2): "void mandible should not sacrifice until its effect
 * resolves." The three cards that print this shape — Eldritch Dreamtender,
 * Cthyrian Rector, Void Mandible — had carried a `castCost` of
 * `{ kind: 'sacrificeUnits', from: 'self' }` since the owner ruling of
 * 2026-08-22, so the sacrifice was paid on the way to the stack and nobody
 * could answer it with the unit still there. The sources say otherwise:
 *
 *  · CR 111.8: the sacrifice is part of the effect, not a cost. The ability
 *    goes on the stack with its source still in play, players may respond,
 *    and the source is sacrificed as it resolves. If the source is gone, the
 *    "If you do" part does nothing.
 *  · Caleb (2025-04-20, msg 1363535826436493614), on Eldritch Dreamtender:
 *    "if the opponent kills him with the trigger on the stack for example,
 *    you wouldn't be able to sacrifice him/discard a card from them."
 *
 * The owner accepted Caleb's reading on 2026-10-21.
 *
 * §1 is the derived scan: no TRIGGERED effect carries a castCost unless its
 * card's printed text marks a cost — a bracketed cost verb ("[Sacrifice a
 * unit]", "[Pay 2 life]", …) or a colon ("Sacrifice me: …"). A castCost is
 * paid in the cast window, before anyone can respond; printing the cost as
 * prose after a trigger condition is what says it is not one.
 *
 * §2 derives the class from the printed text and drives every member three
 * ways: the source is still in play while the trigger waits; killed in
 * response, nothing happens; the normal case sacrifices, then applies the
 * effect. A new card printing the shape fails §2 until it has a scenario.
 *
 * RED-CHECK: put `castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 }`
 * back on any of the three — §1 names it, and its §2 scenarios fail on "still
 * in play while it waits".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/cards/registry.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
  withE as whiteBox,
} from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

// ── §1 the derived scan ──────────────────────────────────────────────────

/** A printed cost mark: a bracket whose body starts with a cost verb, or a
 * "cost: effect" colon. Mana brackets ("[2]", "[x]") are not cost marks on
 * their own — a mana cost on an ability is always followed by a colon. */
const COST_BRACKET = /\[(Pay|Sacrifice|Discard|Erase|Remove|Gain|Recall)\b[^\]]*\]/i;
const marksCost = (text: string): boolean => COST_BRACKET.test(text) || /:/.test(text);

interface TriggerSlot { card: string; route: 'ability' | 'augment'; index: number; castCost: unknown }

function triggeredSlots(): TriggerSlot[] {
  const out: TriggerSlot[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    (c.abilities ?? []).forEach((a, i) => {
      if (a.type === 'triggered') out.push({ card: name, route: 'ability', index: i, castCost: a.effect.castCost });
    });
    (c.augmentText ?? []).forEach((a, i) => {
      if (a.type === 'triggered') out.push({ card: name, route: 'augment', index: i, castCost: a.effect.castCost });
    });
  }
  return out;
}

test('§1 no triggered effect carries a castCost unless its printed text marks a cost', () => {
  const slots = triggeredSlots();
  assert.ok(slots.length > 100, `only ${slots.length} triggered abilities seen — the scan would be vacuous`);
  // the mark detector must actually see the printed costs it claims to see
  const marked = allCardNames().filter(n => COST_BRACKET.test(getCard(n).text ?? ''));
  assert.ok(marked.length >= 10, `only ${marked.length} cards print a bracketed cost — the regex is broken`);
  assert.ok(marked.includes('Malevolent Machinations') && marked.includes('Immolate'),
    'the detector sees "[Sacrifice X units]" and "[Sacrifice a unit]"');
  assert.ok(!marksCost(getCard('Eldritch Dreamtender').text ?? ''),
    'and does NOT see a cost in "sacrifice me. If you do, …" prose');

  const bad = slots
    .filter(s => s.castCost !== undefined && !marksCost(getCard(s.card).text ?? ''))
    .map(s => `${s.route}:${s.card}#${s.index} ${JSON.stringify(s.castCost)}`);
  assert.deepEqual(bad, [],
    'a triggered effect pays these in the cast window, before anyone can answer it, but the '
    + 'printed text marks no cost (no [cost] bracket, no colon). CR 111.8: a sacrifice printed as '
    + 'effect prose is made as the ability resolves — run() makes it, with an "if you do" check');
});

// ── §2 the class, derived, and its behaviour ─────────────────────────────

/** "When …, sacrifice me. If you do, …" — a trigger condition, then a
 * MANDATORY self-sacrifice as effect prose, then a rider on it. */
const SHAPE = /\bWhen\b[^.]*,\s*sacrifice me\.\s*If you do\b/i;

interface Scenario {
  /** build the board up to the moment the trigger is waiting on the stack;
   * returns the unit that will be sacrificed and the seat that controls it */
  setUp(h: Harness): { src: EntityId; A: Seat; D: Seat; seen: Record<string, unknown> };
  /** pass priority until the trigger has resolved */
  resolve(h: Harness, A: Seat): void;
  /** the rider happened (the effect after "If you do") */
  riderDone(h: Harness, ctx: { A: Seat; D: Seat; seen: Record<string, unknown> }): boolean;
}

const triggerUp = (h: Harness, src: EntityId): boolean =>
  h.state.stack.some(i => i.kind === 'triggered' && i.sourceId === src);

const SCENARIOS: Record<string, Scenario> = {
  'Eldritch Dreamtender': {
    setUp(h) {
      toDeployment(h);
      const A = h.state.deployPlayer!, D = (1 - A) as Seat;
      const src = spawn(h, A, 'Eldritch Dreamtender');
      toNextBattle(h, A);
      h.do({ type: 'declareAttack', seat: A, columns: [[src]] });
      pass(h); pass(h);
      h.do({ type: 'declareBlocks', seat: D, blocks: {} });
      pass(h); pass(h);                                   // combat damage → the trigger
      return { src, A, D, seen: { hand: h.state.players[D]!.hand.length } };
    },
    resolve(h) {
      pass(h); pass(h);
      if (h.state.decision) pick(h, h.state.decision.options[0]!.value);
    },
    riderDone: (h, { D, seen }) => h.state.players[D]!.hand.length === (seen['hand'] as number) - 1,
  },
  'Void Mandible': {
    setUp(h) {
      toDeployment(h);
      const A = h.state.deployPlayer!, D = (1 - A) as Seat;
      const src = spawn(h, A, 'Void Mandible');
      const raider = spawn(h, D, 'Unit Token');
      giveResources(h, D, 'light', 2);
      toNextBattle(h, D);                                 // A's home is the battle region
      h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
      h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Godray') });
      pick(h, { player: A });                             // 3 at A
      const godray = h.state.stack.find(i => i.card === 'Godray')!.id;
      return { src, A, D, seen: { godray, life: h.state.players[A]!.life } };
    },
    resolve(h) { pass(h); pass(h); },
    // negated: Godray has left the stack without dealing its 3
    riderDone: (h, { A, seen }) => !h.state.stack.some(i => i.id === seen['godray'])
      && h.state.players[A]!.life === seen['life'],
  },
  'Cthyrian Rector': {
    setUp(h) {
      toDeployment(h);
      const A = h.state.deployPlayer!, D = (1 - A) as Seat;
      const src = spawn(h, A, 'Cthyrian Rector');
      const raider = spawn(h, D, 'Unit Token');
      toNextBattle(h, D);                                 // the Rector's region hosts the battle
      h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
      if (h.state.priority !== A) pass(h);
      giveResources(h, A, 'fire', 2);
      giveResources(h, A, 'dark', 2);
      h.state.players[A]!.hand = [];
      give(h, A, 'Darkblast');
      give(h, A, 'Luminous Arc');                         // the only card the cost can discard
      h.do({ type: 'playCard', seat: A, handIndex: 0 });
      // aim the 5 at the opponent, then discard the Arc for the cost
      while (h.state.decision) {
        const o = h.state.decision.options;
        const pl = o.find(x => (x.value as { player?: number })?.player === D);
        const arc = o.find(x => x.label.includes('Luminous Arc'));
        pick(h, (pl ?? arc ?? o[0]!).value);
      }
      return { src, A, D, seen: {} };
    },
    resolve(h) {
      // the Rector's trigger sits above the Darkblast; one round of passes resolves it
      pass(h); pass(h);
    },
    riderDone: (h, { A }) => h.state.players[A]!.hand.includes('Luminous Arc'),
  },
};

test('§2 the class is derived from the printed text, and every member has a scenario here', () => {
  const cls = allCardNames().filter(n => SHAPE.test(getCard(n).text ?? '')).sort();
  assert.ok(cls.length >= 3, `the shape matched only ${cls.length} cards — the regex is broken`);
  assert.ok(!SHAPE.test(getCard('Maelstrom Charger').text ?? ''),
    '"As you play …, you MAY sacrifice me" is a different shape, settled by its own RAQ write-up');
  assert.deepEqual(cls, Object.keys(SCENARIOS).sort(),
    'a card printing "When …, sacrifice me. If you do, …" needs a scenario below: the sacrifice is '
    + 'made as the trigger resolves (CR 111.8), and that has to be watched, not assumed');
});

for (const [card, sc] of Object.entries(SCENARIOS)) {
  test(`§2 ${card}: the trigger waits on the stack with its source still in play`, () => {
    const h = new Harness(51500);
    const { src } = sc.setUp(h);
    assert.ok(triggerUp(h, src), `the ${card} trigger is on the stack`);
    assert.ok(ent(h, src), 'and its source is still in play while it waits — nothing was paid on the way up');
  });

  test(`§2 ${card}: the normal case sacrifices the source, then applies the effect`, () => {
    const h = new Harness(51501);
    const { src, A, D, seen } = sc.setUp(h);
    assert.ok(ent(h, src));
    sc.resolve(h, A);
    assert.ok(!ent(h, src), 'sacrificed as the trigger resolved');
    assert.ok(h.state.players[A]!.bin.includes(card), 'into its owner\'s bin');
    assert.ok(sc.riderDone(h, { A, D, seen }), '"If you do": the rider happened');
    finishBattle(h);
  });

  test(`§2 ${card}: killed in response, its trigger does nothing`, () => {
    const h = new Harness(51502);
    const { src, A, D, seen } = sc.setUp(h);
    assert.ok(triggerUp(h, src));
    whiteBox(h, e => e.destroy(e.entity(src)!, 'dies'));   // the response: it dies first
    assert.ok(!ent(h, src));
    assert.ok(triggerUp(h, src), 'the trigger is independent of its source and stays on the stack');
    const before = h.events.length;
    sc.resolve(h, A);
    assert.ok(!sc.riderDone(h, { A, D, seen }),
      'nothing to sacrifice, so "If you do" fails (Caleb: "you wouldn\'t be able to sacrifice him/'
      + 'discard a card from them")');
    assert.ok(h.events.slice(before).some(ev => ev.msg.includes(`${card}: there is nothing left to sacrifice`)),
      'and the log says so plainly');
    finishBattle(h);
  });
}

test('§2 Eldritch Dreamtender: a real response — the opponent kills it with the trigger on the stack', () => {
  // Caleb's own example, played through actions rather than a white-box kill.
  const h = new Harness(51503);
  const sc = SCENARIOS['Eldritch Dreamtender']!;
  const { src, D } = sc.setUp(h);
  assert.ok(triggerUp(h, src));
  giveResources(h, D, 'fire', 2);
  if (h.state.priority !== D) pass(h);
  assert.equal(h.state.priority, D, 'the opponent has priority with the trigger on the stack');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: src });
  // Arc resolves first (it is on top), killing the Dreamtender
  for (let i = 0; i < 4 && ent(h, src); i++) pass(h);
  assert.ok(!ent(h, src), 'the Arc killed it');
  assert.ok(triggerUp(h, src), 'its trigger is still waiting');
  const hand = h.state.players[D]!.hand.length;
  pass(h); pass(h);
  assert.equal(h.state.decision, null, 'no discard is offered');
  assert.equal(h.state.players[D]!.hand.length, hand, 'no card left the opponent\'s hand');
  finishBattle(h);
});
