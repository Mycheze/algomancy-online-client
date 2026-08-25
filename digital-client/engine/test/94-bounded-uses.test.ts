/**
 * R113 — HOW MANY TIMES A BOUNDED ABILITY HAPPENS PER TURN.
 *
 * Four questions were put to the designer on 2026-08-23 and answered in one
 * sitting. This file is one test per answer, plus the card-level split the
 * first two force. The answers, verbatim:
 *
 *  1. Hexbane Shiitake's `[once]` — "Its ability can only be triggered once per
 *     turn, but you can choose for each spell if you want to let it trigger and
 *     to put the ability on the stack."
 *  2. `[bounded_graft]` — "can only be activated or triggered once per turn.
 *     Regardless of if that ability resolves or doesn't."
 *  3. `[graft]` under `[bounded_graft]` — "the whole block of different parts is
 *     only put on the stack once per turn."
 *  4. `[bounded_graft]` under `[graft]` — "the big block of different parts can
 *     be put on the stack multiple times each turn, but after the first time
 *     the `[bounded_graft]` parts are 'missing'."
 *
 * WHY THIS FILE EXISTS SEPARATELY from 93-engine-defects, which already guards
 * the decline routes: answers 1 and 2 pull in OPPOSITE directions, and the
 * repo has already shipped each of them alone. R108 read "spent only when it
 * does something" and refunded a fizzle; R113 reads "regardless of if that
 * ability resolves" and does not. The pair is only safe if both halves are
 * pinned in the same place, so that moving one fails a test about the other.
 *
 * THE LINE, in one sentence: a bounded use is spent by being USED — activated,
 * or put on the stack — and only a decline (or an offer that could not be made
 * at all) keeps it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { spawn, toDeployment, giveResources } from './util.ts';
import type { Seat, StackItem } from '../src/types.ts';

function board(seed: number): { g: E; h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const g = new E(h.state);
  return { g, h, A, D: (1 - A) as Seat };
}

/** the effect keys a composition produced, or null if it refused to compose */
function keys(parts: unknown): string[] | null {
  return parts === null ? null : (parts as { effectKey: string }[]).map(p => p.effectKey);
}

/**
 * Run one card's `run` and report whether it asked for its bounded use back.
 *
 * This is the measurement R113's card-level half needs, and it is deliberately
 * a BEHAVIOURAL one: `ctx.refundBudget` is a spy, so the assertion is "the card
 * called it" and not "the file contains the string". Two of this round's own
 * CARD-TODO proofs were source-text proxies that stayed true after the fix, and
 * the lesson was written down — a regex over card source proves nothing about
 * what the card does.
 */
function refunds(
  def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat },
  answers: Record<string, unknown> = {},
): boolean {
  let asked = false;
  def.run(g, {
    sourceName: 'test',
    region: g.homeRegion(ctx.controller),
    targets: [],
    event: null,
    eraseSelf: () => {},
    refundBudget: () => { asked = true; },
    choose: (key, dec) => (key in answers ? answers[key] : dec.options[0]!.value),
    ...ctx,
  } as EffectCtx);
  return asked;
}

// ════════════════════════════════════════════════════════════════════════
// ANSWER 1 — the limit is on TRIGGERING, and you choose per opportunity
// ════════════════════════════════════════════════════════════════════════
//
// "you can choose for each spell if you want to let it trigger" is the half
// that is easy to lose: it is not "one yes per turn", it is "one USE per turn,
// offered every time until you take it". 93-engine-defects pins the single
// decline; what is pinned here is the FOR EACH SPELL — decline on the first
// opposing spell and the offer must come back on the second, the same turn.

const HEX = 'augment:Hexbane Shiitake#0';

test('Hexbane Shiitake declined on one spell is still offered on the NEXT spell that turn (R113)', () => {
  const { g, h, A, D } = board(9400);
  const carrier = g.entity(spawn(h, A, 'Hexbane Shiitake'))!;
  const turn = g.s.turn;

  const offer = (n: number, answer: boolean): void => {
    const parts = g.composeParts(carrier, 0, 'augment');
    assert.ok(parts, `spell ${n}: the trigger would not even compose — its use was already gone`);
    assert.equal(g.entity(carrier.id)!.budgets[HEX], 1,
      `spell ${n}: composition must RESERVE the use — it is also the re-entrancy guard`);
    const bait: StackItem = {
      id: g.s.nextId++, kind: 'spell', card: 'Overbloom', label: 'Overbloom',
      controller: D, region: g.homeRegion(A), negated: false,
      parts: [{ effectKey: 'spell:Overbloom', targets: [] }],
    };
    g.s.stack.push(bait);
    g.resolveParts({
      id: g.s.nextId++, kind: 'triggered', card: 'Hexbane Shiitake',
      label: 'Hexbane Shiitake', controller: A, region: g.homeRegion(A),
      negated: false, parts, sourceId: carrier.id,
      event: { type: 'spellPlayed', msg: '', data: { card: 'Overbloom', seat: D, region: g.homeRegion(A) } },
    } as StackItem, 0, { '0:swap': answer });
  };

  offer(1, false);
  assert.equal(g.entity(carrier.id)!.budgets[HEX], undefined,
    'declining the first spell did not spend the use');
  assert.equal(g.s.turn, turn, 'still the same turn — nothing reset the budgets');

  offer(2, false);
  assert.equal(g.entity(carrier.id)!.budgets[HEX], undefined,
    'and declining the second did not either — "you can choose FOR EACH SPELL"');
  assert.equal(g.s.turn, turn, 'still the same turn');

  // …and the moment it is taken up, the turn's use is gone.
  const parts = g.composeParts(carrier, 0, 'augment');
  assert.ok(parts, 'a third offer was still available before it was used');
  assert.equal(g.entity(carrier.id)!.budgets[HEX], 1, 'and taking it up spends it');
  assert.equal(g.composeParts(carrier, 0, 'augment'), null,
    'so there is no fourth offer this turn — the limit is on the USE, not on the yeses');
});

// ════════════════════════════════════════════════════════════════════════
// ANSWER 2 — spent "regardless of if that ability resolves or doesn't"
// ════════════════════════════════════════════════════════════════════════
//
// The fizzle is guarded in 93-engine-defects (that test was INVERTED when R113
// landed, and its header says so). The other way an item on the stack fails to
// resolve is NEGATION, and nothing guarded that at all.

test('a bounded trigger that is NEGATED on the stack has still spent its use (R113)', () => {
  const KEY = 'ability:Minor Kraken#0';
  const { g, h, A, D } = board(9401);
  const kraken = g.entity(spawn(h, A, 'Minor Kraken'))!;
  const victim = g.entity(spawn(h, D, 'Curio Drifter'))!;

  const parts = g.composeParts(kraken, 0, 'ability')!;
  assert.equal(kraken.budgets[KEY], 1, 'composition reserved the use');
  const item: StackItem = {
    id: g.s.nextId++, kind: 'triggered', label: 'Minor Kraken', controller: A,
    region: g.homeRegion(A), negated: false, sourceId: kraken.id,
    parts: parts.map(p => ({ ...p, targets: [{ unit: victim.id }] })),
  } as never;
  g.s.stack.push(item);
  const before = g.events.length;
  g.negate(item.id);
  // `E.negate` lifts the item off the stack and discharges it — it never
  // reaches `resolveItem` at all, which makes it the purest form of "didn't
  // resolve" the engine has.
  assert.ok(g.events.slice(before).some(e => e.type === 'negated'),
    'the trigger really was negated — otherwise this tests nothing');
  assert.ok(!g.s.stack.some(i => i.id === item.id), 'and it is off the stack');

  assert.equal(g.entity(kraken.id)!.budgets[KEY], 1,
    'it was triggered and put on the stack, so the use is gone even though it never '
    + 'resolved (R113: "regardless of if that ability resolves or doesn\'t")');
  assert.equal(g.composeParts(g.entity(kraken.id)!, 0, 'ability'), null,
    'and it cannot be triggered again this turn — negating it is a real answer, '
    + 'not a free one');
});

// ════════════════════════════════════════════════════════════════════════
// ANSWERS 3 and 4 — the two nestings
// ════════════════════════════════════════════════════════════════════════
//
// Both were already true in `E.composeParts` when the ruling arrived, and
// neither had a test. That is precisely the state a rule rots from: the two
// branches are three lines apart and read almost identically (`return null`
// versus `continue`), and swapping them passes the whole suite.

test('ANSWER 3: a BOUNDED cause bounds the WHOLE block — graft riders included (R113)', () => {
  const { g, h, A } = board(9402);
  const host = g.entity(spawn(h, A, 'Minor Kraken'))!;   // bounded graftCause
  assert.ok(getCard('Minor Kraken').abilities![0]!.bounded, 'the cause is bounded');
  assert.ok(getCard('Minor Kraken').abilities![0]!.graftCause, 'and it is a graft cause');
  assert.ok(!getCard('Geode').graftEffect!.bounded, 'the rider is UNBOUNDED — that is the point');
  g.attachMod(host, 'Geode', A, 'graft');

  assert.deepEqual(keys(g.composeParts(host, 0, 'ability')),
    ['ability:Minor Kraken#0', 'graft:Geode'],
    'first time: the whole block goes on the stack');
  assert.equal(keys(g.composeParts(host, 0, 'ability')), null,
    'second time: NOTHING is put on the stack — not the base, and not the unbounded '
    + 'rider either. "With [graft] under [bounded_graft] the whole block of different '
    + 'parts is only put on the stack once per turn."');
});

test('ANSWER 4: an UNBOUNDED cause fires every time; the bounded riders go missing (R113)', () => {
  const { g, h, A } = board(9403);
  const host = g.entity(spawn(h, A, 'Spewing Mushroom'))!;   // unbounded graftCause
  assert.ok(!getCard('Spewing Mushroom').abilities![0]!.bounded, 'the cause is UNBOUNDED');
  assert.ok(getCard('Recall').graftEffect!.bounded, 'and the rider is bounded — that is the point');
  g.attachMod(host, 'Recall', A, 'graft');

  assert.deepEqual(keys(g.composeParts(host, 0, 'ability')),
    ['ability:Spewing Mushroom#0', 'graft:Recall'],
    'first time: the whole block');
  for (const n of [2, 3]) {
    assert.deepEqual(keys(g.composeParts(host, 0, 'ability')),
      ['ability:Spewing Mushroom#0'],
      `time ${n}: the block still goes on the stack, with the bounded part MISSING — `
      + 'it is not the whole composite that is bounded, only the rider');
  }
});

test('the bounded budget of a graft rider is per MOD, so two copies get a use each (R9/R113)', () => {
  // R9 says "per card", and for a rider the card in play is the mod entity.
  // Without this the second copy of a bounded graft would be dead on arrival,
  // and the two `composeParts` budget keys ('graft' on the mod, the effectKey
  // on the source) would be indistinguishable in the only case that tells them
  // apart.
  const { g, h, A } = board(9404);
  const host = g.entity(spawn(h, A, 'Spewing Mushroom'))!;
  g.attachMod(host, 'Recall', A, 'graft');
  g.attachMod(host, 'Recall', A, 'graft');

  assert.deepEqual(keys(g.composeParts(host, 0, 'ability')),
    ['ability:Spewing Mushroom#0', 'graft:Recall', 'graft:Recall'],
    'both copies compose the first time — each mod holds its own use');
  assert.deepEqual(keys(g.composeParts(host, 0, 'ability')),
    ['ability:Spewing Mushroom#0'],
    'and both are gone the second time');
});

// ════════════════════════════════════════════════════════════════════════
// THE CARD-LEVEL SPLIT — declined versus merely whiffed
// ════════════════════════════════════════════════════════════════════════
//
// R113 forces every bounded run's bail-out branch into one of two families,
// and the six calls that were in the wrong one were deleted when it landed.
// These tests are what stops them coming back: each names the branch, and each
// asserts on the spy rather than on the source.

test('R113 KEEPS the use where the player declined, or could not be offered it', () => {
  const { g, h, A } = board(9410);
  const anima = getCard('Afflicting Anima').abilities![0]!.effect;

  // (a) the offer was made and refused
  giveResources(h, A, 'dark', 2);   // payable, or this measures the wrong branch
  assert.ok(refunds(anima, g, { controller: A }, { pay: false }),
    'Afflicting Anima: a declined "you may pay [1]" keeps the use');

  // (b) the offer could not be made at all — no mana, so no question
  const bare = board(9411);
  assert.ok(refunds(anima, bare.g, { controller: bare.A }),
    'Afflicting Anima with no mana is never asked, so the use is not spent either — '
    + 'this is the shape CARD-TODO #18 was raised about');
});

test('R113 SPENDS the use where an activated ability was used and simply whiffed', () => {
  // Both of these are `type: 'activated'`. The player chose to activate and
  // paid the [one]; there is no "you may" inside either of them to decline,
  // so finding nothing to work on cannot hand the use back.
  const { g, h, A } = board(9412);
  const auric = getCard('Auric Ascendant').abilities![0]!;
  assert.equal(auric.type, 'activated');
  assert.ok(auric.bounded, 'and bounded');
  const self = g.entity(spawn(h, A, 'Auric Ascendant'))!;
  assert.equal(g.unitsOf(A, self.region).filter(u => u.id !== self.id).length, 0,
    'there is no other ally — the whiff branch');
  assert.ok(!refunds(auric.effect, g, { controller: A, sourceId: self.id }),
    'Auric Ascendant with nobody to recall has SPENT its [once] (R113)');

  const slag = getCard('Slag Spewer').augmentText![0]!;
  assert.equal(slag.type, 'activated');
  assert.ok(slag.bounded, 'and bounded');
  const spewer = g.entity(spawn(h, A, 'Slag Spewer'))!;
  assert.equal(spewer.mods.length, 0, 'it carries no mod — the whiff branch');
  assert.ok(!refunds(slag.effect, g, { controller: A, sourceId: spewer.id }),
    'Slag Spewer with no mod to erase has SPENT its [once] (R113)');
});

test('R113 SPENDS the use where a TARGETED bounded ability missed (Graxxlid)', () => {
  // The same shape as a fizzle by another route: the target was legal when it
  // was declared and had left the stack by resolution. Refunding here would
  // make "respond by moving the target" a free answer to Graxxlid every turn.
  const { g, h, A } = board(9413);
  const grax = getCard('Graxxlid').augmentText![0]!;
  assert.ok(grax.bounded, 'Graxxlid\'s [once] is bounded');
  const self = g.entity(spawn(h, A, 'Graxxlid'))!;
  assert.ok(!refunds(grax.effect, g, {
    controller: A, sourceId: self.id, targets: [{ stack: 999999 } as never],
  }), 'the targeted effect has already left the stack, and the use is gone (R113)');
});

test('R113 splits Structural Collapse\'s one branch in two by whether the cost was PAID', () => {
  // The branch used to read `bar <= 0`, which covered a declined cost and a
  // sacrificed 0-defense unit together. R113 puts them in different families,
  // and `costPaid.sacrificed` is the only thing that tells them apart.
  const { g, A } = board(9414);
  const eff = getCard('Structural Collapse').graftEffect!;
  assert.ok(eff.bounded, 'the rider is a bounded graft');

  assert.ok(refunds(eff.effect, g, { controller: A, costPaid: {} as never }),
    'no unit was sacrificed — the [cost] was declined or unpayable, so the use is kept');
  assert.ok(!refunds(eff.effect, g, {
    controller: A,
    costPaid: { sacrificed: { card: 'Prismatic Prismite', power: 0, defense: 0 } } as never,
  }), 'a 0-defense unit WAS sacrificed — the ability was used, so the use is spent even '
    + 'though nobody ends up sacrificing anything');
});

// ── the census ──────────────────────────────────────────────────────────

test('every bounded run that asks for its use back is an offer the player can refuse (R113)', () => {
  // The rule as a SHAPE, not as a list. R113's keeper family is "there was a
  // yes/no about the ability itself" — which in this pool means the run raises
  // a `payOrDecline`, or the ability carries a cast `[cost]` that can be
  // declined. Anything else that calls `ctx.refundBudget()` is in the wrong
  // family, and this is the test that says so before it ships.
  //
  // Read off the CARDS, not off a file list, so a seventh carrier added next
  // month is measured too.
  const suspects: string[] = [];
  for (const name of ['Afflicting Anima', 'Murkdrop Distiller', 'The Bonesculptor',
                      'Hexbane Shiitake', 'Immolate', 'Linked Extinction',
                      'Structural Collapse', 'Auric Ascendant', 'Slag Spewer', 'Graxxlid']) {
    const def = getCard(name);
    const src = [...(def.abilities ?? []), ...(def.augmentText ?? [])]
      .filter(a => a.bounded)
      .map(a => a.effect.run.toString())
      .concat(def.graftEffect?.bounded ? [def.graftEffect.effect.run.toString()] : []);
    for (const body of src) {
      if (!/refundBudget/.test(body)) continue;
      const offers = /payOrDecline/.test(body) || /costPaid/.test(body);
      if (!offers) suspects.push(name);
    }
  }
  assert.deepEqual(suspects, [],
    'these bounded abilities hand their use back without ever offering the player a '
    + 'choice about the ability. Under R113 that is the "used it and whiffed" family, '
    + 'which SPENDS the use — delete the refundBudget call and say why in a comment.');
});
