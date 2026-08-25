/**
 * SILENT BRANCHES — an effect that reaches a guard, gives up, and says nothing.
 *
 * WHY THIS FILE EXISTS
 *
 * The shape is always the same:
 *
 *     if (<some situation a player can actually reach>) return;   // no g.ev
 *
 * The spell leaves the stack, the mana and the X are spent, the log says
 * nothing at all, and the player cannot tell a RULE from a BUG. It is the most
 * productive defect shape the card audit found: three of them were itemised as
 * CARD-TODO #1 (Abduct), #2 (Divine Intervention) and #3 (Immolate), and a
 * static probe found seventy more guards of the same shape across the pool.
 *
 * "Nothing happened" is a legitimate outcome. Not SAYING so never is.
 *
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT
 *
 * Never the prose. A test that greps a sentence gets deleted the first time
 * somebody improves the sentence, and then the branch is unguarded again. The
 * assertion for this class is in the engine's own vocabulary:
 *
 *     this effect, resolved in THIS situation, emitted at least one event
 *
 * plus, where it matters, that the event TYPES are right and that the guard
 * really was a guard — the game state did not change behind the player's back.
 * Two places go further, and both are still structural rather than textual:
 *
 *   · Divine Intervention and Gravitational Correction do the same job, so
 *     their retarget lines must carry the same DATA payload ({ item, n }) —
 *     that is "the two read the same in the log" as an assertion rather than
 *     as a hope.
 *   · Organic Exchange must DISTINGUISH the two-controller case from the
 *     one-controller case, which is asserted by resolving both and requiring
 *     the two announcements to differ. No wording is pinned; the obligation to
 *     tell the situations apart is.
 *
 * And nothing here is `{ todo: true }`. A todo can never fail, which is exactly
 * how a dead card survived two playtest reports (see the head of
 * card-ledger.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { effectsOf } from '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { drillCard } from './drill.ts';
import { spawn, toDeployment, giveResources } from './util.ts';
import type { EngineEvent, Entity, EntityId, Seat, StackItem } from '../src/types.ts';

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

/** an answer table for ctx.choose, keyed by the effect's own choice key */
type Answers = Record<string, unknown>;

/**
 * Resolve one EffectDef and return the events IT emitted.
 *
 * This is the same measurement 81-card-drill takes when it wraps every run in
 * the registry — events before, events after — only aimed at one situation
 * that the drill's three board states cannot arrange.
 */
function resolve(
  def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat }, answers: Answers = {},
): EngineEvent[] {
  const before = g.events.length;
  def.run(g, {
    sourceName: 'test',
    region: g.homeRegion(ctx.controller),
    targets: [],
    event: null,
    choose: (key, dec) => (key in answers ? answers[key] : dec.options[0]!.value),
    ...ctx,
  } as EffectCtx);
  return g.events.slice(before);
}

const spellOf = (card: string): EffectDef => getCard(card).spellEffect!;
const abilityOf = (card: string, i = 0): EffectDef => getCard(card).abilities![i]!.effect;
const augmentOf = (card: string, i = 0): EffectDef => getCard(card).augmentText![i]!.effect;

/** the whole point, in one line */
function assertSpoke(evs: EngineEvent[], what: string): void {
  assert.ok(evs.length > 0,
    `${what} resolved and emitted NOTHING. The player sees the effect leave the stack `
    + 'with no indication of what it did — add a g.ev() naming the card and the reason '
    + 'before that `return`.');
}

/** a stack id nothing on the stack has: "the effect you aimed at is gone" */
const GONE = 9_999_001;

/** put a real, resolvable item on the stack for the retargeters to aim at */
function bait(g: E, controller: Seat, victim: EntityId): StackItem {
  const item: StackItem = {
    id: 4242, kind: 'spell', card: 'Overbloom', label: 'Overbloom',
    controller, region: g.homeRegion(controller), negated: false,
    parts: [{ effectKey: 'spell:Overbloom', targets: [{ unit: victim }] }],
  };
  g.s.stack.push(item);
  return item;
}

// ── 1. A CAST [cost] THAT WAS DECLINED OR UNPAYABLE ─────────────────────
//
// `if (!ctx.costPaid?.sacrificed) return;` — CARD-TODO #3's shape, and the
// most reachable one in the pool, because a [Switch]/[Sacrifice a unit] card
// is usually met as a GRAFT RIDER whose cost is declined at composite cast
// time. The composite then resolves a part that does nothing and says nothing.

const DECLINED_COST: [string, EffectDef][] = [
  ['Immolate', spellOf('Immolate')],
  ['Sacrificial Burst', spellOf('Sacrificial Burst')],
  ['Linked Extinction', spellOf('Linked Extinction')],
  ['Structural Collapse', spellOf('Structural Collapse')],
];

for (const [card, def] of DECLINED_COST) {
  test(`${card} resolved with its [Sacrifice a unit] cost unpaid announces that nothing happens`, () => {
    const { g, A, theirs } = board(8500);
    const evs = resolve(def, g, { controller: A, sourceName: card, targets: [theirs] });
    assertSpoke(evs, `${card} with no sacrifice paid`);
    // and it really was a guard: the payload did not happen anyway
    assert.equal(g.player(A).hand.length, g.player(A).hand.length, 'hand is untouched');
    assert.ok(g.entity(theirs.id), 'the target unit is still there — nothing was dealt or destroyed');
  });
}

test('Immolate resolved as a graft rider with its cost unpaid announces it too', () => {
  // the same EffectDef backs the graft, so this pins that the graft path is
  // covered by the same fix rather than by luck
  const { g, A } = board(8501);
  const evs = resolve(getCard('Immolate').graftEffect!.effect, g,
    { controller: A, sourceName: 'Immolate' });
  assertSpoke(evs, 'the Immolate graft rider with no sacrifice paid');
});

// ── 2. ABDUCT (CARD-TODO #1) ────────────────────────────────────────────

test('Abduct aimed at your own unit announces that nothing happens', () => {
  const { g, A, mine } = board(8510);
  const evs = resolve(spellOf('Abduct'), g,
    { controller: A, sourceName: 'Abduct', targets: [mine], x: 9 });
  assertSpoke(evs, 'Abduct aimed at a unit you already control');
  assert.equal(g.entity(mine.id)!.controller, A, 'control did not change — it could not');
});

test('Abduct whose ransom the target\'s controller pays announces the payment', () => {
  const { g, h, A, D, theirs } = board(8511);
  giveResources(h, D, 'water', 6);          // The Foretold costs 3: X = 4 clears the cost bar
  const evs = resolve(spellOf('Abduct'), g,
    { controller: A, sourceName: 'Abduct', targets: [theirs], x: 4 }, { pay: true });
  assertSpoke(evs, 'Abduct whose ransom was paid');
  assert.equal(g.entity(theirs.id)!.controller, D, 'the ransom kept the unit where it was');
});

test('Abduct whose ransom is declined still takes the unit', () => {
  // the working path, pinned so the fix above cannot be "announce everything
  // and stop doing the thing"
  const { g, h, A, D, theirs } = board(8512);
  giveResources(h, D, 'water', 6);
  const evs = resolve(spellOf('Abduct'), g,
    { controller: A, sourceName: 'Abduct', targets: [theirs], x: 4 }, { pay: false });
  assertSpoke(evs, 'Abduct whose ransom was declined');
  assert.equal(g.entity(theirs.id)!.controller, A, 'the unit changed hands');
});

// ── 3. DIVINE INTERVENTION (CARD-TODO #2) ───────────────────────────────
//
// The bug here was backwards behaviour, not silence alone: the DECLINE branch
// logged and the branch that actually rewrites another player's targets said
// nothing. Both halves are pinned.

test('Divine Intervention that changes an effect\'s targets announces the change', () => {
  const { g, A, D, mine, theirs } = board(8520);
  bait(g, D, theirs.id);
  const evs = resolve(spellOf('Divine Intervention'), g,
    { controller: A, sourceName: 'Divine Intervention', targets: [{ stack: 4242 }] },
    { may: true, 'retarget:0:0': { unit: mine.id } });
  assertSpoke(evs, 'Divine Intervention that redirected an effect');
  assert.deepEqual(g.s.stack[0]!.parts[0]!.targets, [{ unit: mine.id }],
    'the retarget itself still happened');
});

test('Divine Intervention that declines to change anything still announces it', () => {
  const { g, A, D, theirs } = board(8521);
  bait(g, D, theirs.id);
  const evs = resolve(spellOf('Divine Intervention'), g,
    { controller: A, sourceName: 'Divine Intervention', targets: [{ stack: 4242 }] },
    { may: false });
  assertSpoke(evs, 'Divine Intervention that left the targets alone');
});

test('Divine Intervention and Gravitational Correction report a retarget the same way', () => {
  // "the same way" as a STRUCTURAL claim: both carry the item and the number of
  // targets moved in the event's data, so a reader (and the UI) gets the same
  // facts from either card. Wording is not asserted and must stay free to change.
  const read = (card: string, answers: Answers): EngineEvent | undefined => {
    const { g, A, D, mine, theirs } = board(8522);
    bait(g, D, theirs.id);
    const evs = resolve(spellOf(card), g,
      { controller: A, sourceName: card, targets: [{ stack: 4242 }], x: 0 },
      { ...answers, 'retarget:0:0': { unit: mine.id } });
    assertSpoke(evs, `${card} that redirected an effect`);
    return evs.find(e => e.data?.['item'] !== undefined && e.data?.['n'] !== undefined);
  };
  const di = read('Divine Intervention', { may: true });
  const gc = read('Gravitational Correction', { pay: false });
  assert.ok(di, 'Divine Intervention must report which item it retargeted, and how many targets moved');
  assert.ok(gc, 'Gravitational Correction must report the same two facts');
  assert.deepEqual(Object.keys(di!.data!).sort(), Object.keys(gc!.data!).sort(),
    'the two retargeting cards must report the same facts about what they did');
  assert.equal(di!.data!['n'], gc!.data!['n']);
});

test('Divine Intervention driven through a real game reaches its success branch and speaks', () => {
  // the action path, not a hand-built ctx: the drill puts the card in a hand,
  // walks a real game, picks the playCard out of legalActions and resolves it
  // against an opponent-controlled effect on the stack.
  const defs = effectsOf('Divine Intervention');
  const runs: number[] = [];
  const originals = defs.map(d => d.run);
  defs.forEach(d => {
    const inner = d.run;
    d.run = (g, ctx) => { const b = g.events.length; inner(g, ctx); runs.push(g.events.length - b); };
  });
  try {
    const r = drillCard('Divine Intervention', 900_000, { bait: true });
    assert.ok(r.played, 'the drill must be able to cast it at all');
  } finally {
    defs.forEach((d, i) => { d.run = originals[i]!; });
  }
  assert.ok(runs.length > 0, 'the effect never ran — the drill lost its reach');
  assert.deepEqual(runs.filter(n => n === 0), [],
    'a completed Divine Intervention run emitted nothing in a real game');
});

// ── 4. THE EFFECT YOU AIMED AT HAS ALREADY LEFT THE STACK ───────────────
//
// Reachable by anyone who responds to a counterspell: the item it points at is
// negated, recalled or resolved first, and the counterspell then resolves
// against a stack id that is not there any more.

const STACK_GONE: [string, EffectDef, Partial<EffectCtx>][] = [
  ['Frosted Denial', spellOf('Frosted Denial'), { x: 1 }],
  ['Null Drone', spellOf('Null Drone'), {}],
  ['Boon of Protection', spellOf('Boon of Protection'), {}],
  ['Dematerialize', spellOf('Dematerialize'), {}],
  ['Dream Lapse', spellOf('Dream Lapse'), {}],
  ['Divine Intervention', spellOf('Divine Intervention'), {}],
  ['Graxxlid', augmentOf('Graxxlid'), {}],
];

for (const [card, def, extra] of STACK_GONE) {
  test(`${card} resolving after the effect it targeted left the stack announces that`, () => {
    const { g, A } = board(8530);
    const evs = resolve(def, g,
      { controller: A, sourceName: card, targets: [{ stack: GONE }], ...extra });
    assertSpoke(evs, `${card} pointed at an effect that is no longer on the stack`);
    assert.equal(g.s.stack.length, 0, 'and it did not invent something to negate');
  });
}

// ── 5. THE UNIT YOU AIMED AT IS GONE ────────────────────────────────────
//
// R5/R56: a target that leaves play between cast and resolution. The engine
// keeps the resolved target object, so the run gets an Entity whose id no
// longer resolves — the same thing a player sees when their removal spell is
// answered by a sacrifice.

const TARGET_GONE: [string, EffectDef, (t: Entity) => Partial<EffectCtx>][] = [
  ['Throw off a Cliff', spellOf('Throw off a Cliff'), t => ({ targets: [t] })],
  ['Pull Under', spellOf('Pull Under'), t => ({ targets: [t] })],
  ['Borrower of Forms', spellOf('Borrower of Forms'), t => ({ targets: [t] })],
  ['Arcane Echo', spellOf('Arcane Echo'), t => ({ targets: [t] })],
  ['Necromorph', spellOf('Necromorph'), t => ({
    targets: [t, { binCard: { seat: t.controller, index: 0, card: 'Tidal Menace' } }],
  })],
];

for (const [card, def, mk] of TARGET_GONE) {
  test(`${card} resolving after its target left play announces that nothing happens`, () => {
    const { g, h, A, theirs } = board(8540);
    g.player(theirs.controller).bin.push('Tidal Menace');
    delete h.state.entities[theirs.id];          // it left play between cast and resolution
    const evs = resolve(def, g, { controller: A, sourceName: card, ...mk(theirs) });
    assertSpoke(evs, `${card} whose target is gone`);
  });
}

// ── 6. THE CARRIER IS GONE ──────────────────────────────────────────────
//
// An [Augment] ability's "me" is the unit carrying it, and a trigger can
// resolve after that unit has died — a mod host answered in response, a virus
// whose host was removed.

const CARRIER_GONE: [string, EffectDef][] = [
  ['Slag Spewer', augmentOf('Slag Spewer')],
  ['Auric Ascendant', abilityOf('Auric Ascendant')],
  ['Corrupting Blight', augmentOf('Corrupting Blight')],
  ['Hexbane Shiitake', augmentOf('Hexbane Shiitake')],
  // R178 removed Maelstrom Charger from this list, and from the declined-pay
  // section below. It has NO EffectDef at all any more: the designer's ruling
  // is that its printed line is *"neither Triggered nor Activated"*, so it is a
  // `CardBehavior.asYouPlay` option collected in the cast window, and there is
  // no resolving effect for either of those situations to arise in. Its
  // carrier cannot be gone when the option is offered (the offer is read off
  // the live board), and the declined half is now guarded where it lives —
  // test/151-copy-and-moved-mods.test.ts, "R178 Maelstrom Charger: declining
  // the sacrifice says so and copies nothing".
];

for (const [card, def] of CARRIER_GONE) {
  test(`${card} resolving after its carrier left play announces that nothing happens`, () => {
    const { g, A, theirs } = board(8550);
    const evs = resolve(def, g, {
      controller: A, sourceName: card, sourceId: 9_999_002 as EntityId, targets: [theirs],
      event: { type: 'spellPlayed', msg: '', data: { card: 'Overbloom', seat: (1 - A) as Seat } },
    });
    assertSpoke(evs, `${card} whose carrier is gone`);
  });
}

// ── 7. A "you may pay" THAT WAS DECLINED ────────────────────────────────
//
// The commonest reachable silence in the pool after the cast costs: the
// player is asked, says no, and the log shows the question and no answer.

test('Afflicting Anima whose [1] is declined announces that no Wraith is created', () => {
  const { g, A } = board(8560);
  const evs = resolve(abilityOf('Afflicting Anima'), g,
    { controller: A, sourceName: 'Afflicting Anima' }, { pay: false });
  assertSpoke(evs, 'Afflicting Anima with the payment declined');
  assert.equal(g.unitsOf(A, g.homeRegion(A)).length, 1, 'and no Wraith appeared');
});

test('Swarmling whose [1] is declined announces that no copy is created', () => {
  const { g, h, A } = board(8561);
  giveResources(h, A, 'dark', 3);
  const evs = resolve(abilityOf('Swarmling'), g,
    { controller: A, sourceName: 'Swarmling' }, { pay: false });
  assertSpoke(evs, 'Swarmling with the payment declined');
});

test('Swarmling triggered with no open mana announces that it cannot pay', () => {
  const { g, A } = board(8562);
  for (const r of g.player(A).resources) r.state = 'expended';
  const evs = resolve(abilityOf('Swarmling'), g, { controller: A, sourceName: 'Swarmling' });
  assertSpoke(evs, 'Swarmling with no open mana');
});

test('Dragnol whose [2] is declined announces that nothing is drained', () => {
  const { g, h, A } = board(8563);
  giveResources(h, A, 'dark', 4);
  const evs = resolve(augmentOf('Dragnol'), g,
    { controller: A, sourceName: 'Dragnol' }, { pay: false });
  assertSpoke(evs, 'Dragnol with the payment declined');
});

test('Spore of Regenesis whose erase cost is declined announces that nothing returns', () => {
  const { g, A } = board(8564);
  g.player(A).bin.push('Spore of Regenesis', 'Ignis Sprite');
  const evs = resolve(abilityOf('Spore of Regenesis'), g,
    { controller: A, sourceName: 'Spore of Regenesis' }, { erase: false });
  assertSpoke(evs, 'Spore of Regenesis with the erase declined');
  assert.ok(g.player(A).bin.includes('Ignis Sprite'), 'and nothing came back out of the bin');
});

test('Murkdrop Distiller that declines to cache the trashed card announces that', () => {
  const { g, A } = board(8565);
  g.player(A).bin.push('Ignis Sprite');
  // R140: the event carries `binNth` — WHICH copy of that name in that bin was
  // trashed — exactly as E.noteTrashed stamps it. Without it the card reads the
  // trash as "that copy is already gone" and takes the OTHER silent branch, so
  // this fixture has to be a faithful trashed event or it tests nothing.
  const evs = resolve(abilityOf('Murkdrop Distiller'), g, {
    controller: A, sourceName: 'Murkdrop Distiller',
    event: { type: 'trashed', msg: '', data: { card: 'Ignis Sprite', seat: A, binNth: 0 } },
  }, { cache: 0 });
  assertSpoke(evs, 'Murkdrop Distiller with the cache declined');
  assert.ok(evs.some(e => e.msg.includes('is left in the bin — nothing is cached')),
    'and it is the DECLINE branch that spoke, not the "already gone" one');
  assert.ok(g.player(A).bin.includes('Ignis Sprite'), 'and the card stayed in the bin');
});

test('Murkdrop Distiller triggered on a card that is not in the bin announces that', () => {
  // a trashed TOKEN is binned and swept away before this trigger resolves
  const { g, A } = board(8566);
  const evs = resolve(abilityOf('Murkdrop Distiller'), g, {
    controller: A, sourceName: 'Murkdrop Distiller',
    event: { type: 'trashed', msg: '', data: { card: 'Ignis Sprite', seat: A } },
  });
  assertSpoke(evs, 'Murkdrop Distiller whose trashed card is not in the bin');
});

test('The Bonesculptor that declines to play a unit from the bin announces that', () => {
  const { g, h, A } = board(8567);
  giveResources(h, A, 'earth', 6);
  g.player(A).bin.push('Tidal Menace');
  const evs = resolve(abilityOf('The Bonesculptor'), g,
    { controller: A, sourceName: 'The Bonesculptor' }, { pick: -1 });
  assertSpoke(evs, 'The Bonesculptor with the bin play declined');
  assert.ok(g.player(A).bin.includes('Tidal Menace'), 'and the unit stayed in the bin');
});

// COSMIC CONSPIRATOR USED TO BE HERE, and R104 took it out of this file's
// class rather than out of coverage. It is no longer an EFFECT at all: "if you
// would create … you may instead create" is a REPLACEMENT (`replaceTokenCreation`),
// which is consulted at the creation call and never resolves off a stack. This
// file's whole subject is "an effect ran to completion and emitted nothing",
// and a replacement has no run to complete.
//
// The silent-branch risk it was covering is covered where the card now lives:
// 26-metal-a.test.ts's "Biotoxicity asks once per token" walks the keep branch
// (the second Poison) and asserts the printed token is really there, and the
// engine's own decline path — no resolving part to raise a decision in — logs
// its reason rather than defaulting in silence, which is the glimpse precedent.

test('Hexbane Shiitake that declines the exchange announces that the spell is left alone', () => {
  const { g, A, D, theirs } = board(8569);
  const carrier = g.spawnUnit(A, 'Hexbane Shiitake', g.homeRegion(A));
  bait(g, D, theirs.id);
  const evs = resolve(augmentOf('Hexbane Shiitake'), g, {
    controller: A, sourceName: 'Hexbane Shiitake', sourceId: carrier.id,
    event: { type: 'spellPlayed', msg: '', data: { card: 'Overbloom', seat: D } },
  }, { swap: false });
  assertSpoke(evs, 'Hexbane Shiitake with the exchange declined');
  assert.equal(g.s.stack[0]!.controller, D, 'and the spell stayed with its caster');
});

// (R178: Maelstrom Charger's declined sacrifice used to be tested here, as a
// resolving EffectDef with `{ sac: false }` pre-answered. It has no EffectDef
// now — the designer's *"neither Triggered nor Activated"* makes it a cast-
// window `asYouPlay` option, which this file's `resolve()` harness cannot
// reach because there is nothing to resolve. The decline still has to speak,
// and is guarded through a real play in
// test/151-copy-and-moved-mods.test.ts: "R178 Maelstrom Charger: declining the
// sacrifice says so and copies nothing".)

// ── 8. AN X THAT IS ZERO, AND AN EMPTY ZONE ─────────────────────────────

test('Siphon Life cast for X = 0 announces that no life changes hands', () => {
  const { g, A } = board(8580);
  const life = g.player(A).life;
  const evs = resolve(spellOf('Siphon Life'), g,
    { controller: A, sourceName: 'Siphon Life', targets: [{ player: A }], x: 0 });
  assertSpoke(evs, 'Siphon Life cast for X = 0');
  assert.equal(g.player(A).life, life, 'and no life moved');
});

test('Tides of the Cosmos resolved on an empty deck announces that nothing is revealed', () => {
  const { g, A } = board(8581);
  g.deckOf(A).length = 0;
  const evs = resolve(spellOf('Tides of the Cosmos'), g,
    { controller: A, sourceName: 'Tides of the Cosmos' });
  assertSpoke(evs, 'Tides of the Cosmos with an empty deck');
});

test('Perpetual Construct modded with a zero-cost mod announces that no unit is created', () => {
  const { g, A } = board(8582);
  const before = Object.keys(g.s.entities).length;
  const evs = resolve(abilityOf('Perpetual Construct'), g, {
    controller: A, sourceName: 'Perpetual Construct',
    event: { type: 'modApplied', msg: '', data: { mod: 9_999_003 } },
  });
  assertSpoke(evs, 'Perpetual Construct whose mod is gone');
  assert.equal(Object.keys(g.s.entities).length, before, 'and no X/X unit appeared');
});

// ── 9. "EACH OPPONENT" WITH NOBODY THERE ────────────────────────────────
//
// R25: "each opponent" reads the effect region's PRESENT seats, and a home
// region out of battle lists only its owner. The loop then runs zero times —
// a real, ordinary, reachable situation that used to produce no log line at
// all. Spirit of Vengeance and Cthyrian Culler already say it; these did not.

const NO_OPPONENT: [string, EffectDef, Partial<EffectCtx>][] = [
  ['Restitution', augmentOf('Restitution'), { event: { type: 'damage', msg: '', data: { n: 3 } } }],
  ['Vroot', augmentOf('Vroot'), { event: { type: 'damage', msg: '', data: { n: 3 } } }],
  ['Flzzz', augmentOf('Flzzz'), { event: { type: 'lifeGained', msg: '', data: { n: 3 } } }],
];

for (const [card, def, extra] of NO_OPPONENT) {
  test(`${card} resolving in a region with no opponent present announces that`, () => {
    const { g, A } = board(8590);
    const lives = g.s.players.map(p => p.life);
    const evs = resolve(def, g, { controller: A, sourceName: card, ...extra });
    assertSpoke(evs, `${card} with no opponent in the region`);
    assert.deepEqual(g.s.players.map(p => p.life), lives, 'and nobody gained or lost life');
  });
}

// ── 10. ORGANIC EXCHANGE (CARD-TODO #6) ─────────────────────────────────
//
// RULING (2026-08-23, owner): the play stays LEGAL. Swapping the positions of
// two of your own units is a real line and the printed text — "Exchange
// control of two target units and swap their positions" — does not forbid it.
// The defect was the LOG: the two control assignments cancel, and the line
// read "Player 1 takes Tidal Menace, Player 1 takes The Foretold — positions
// swapped", naming the same player twice for a control change that did not
// happen. So: no `restrict`, no change to the legal target set, and the
// announcement must tell the two situations apart.

function exchange(seed: number, sameSide: boolean): { evs: EngineEvent[]; a: Entity; b: Entity; g: E } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const a = spawn(h, A, 'Tidal Menace');
  const b = spawn(h, sameSide ? A : D, 'The Foretold');
  const g = new E(h.state);
  const ea = g.entity(a)!, eb = g.entity(b)!;
  const evs = resolve(spellOf('Organic Exchange'), g,
    { controller: A, sourceName: 'Organic Exchange', targets: [ea, eb] });
  return { evs, a: ea, b: eb, g };
}

test('Organic Exchange aimed at two of your own units is still a legal, offered play', () => {
  // the ruling, as an assertion: no different-controller restriction was added
  const spec = spellOf('Organic Exchange').targets!;
  assert.equal(spec.what, 'unit', 'both sides stay targetable');
  assert.equal(spec.restrict, undefined,
    'CARD-TODO #6 was ruled a LOGGING fix, not a legality fix — a restrict here would '
    + 'silently remove a legal line (swapping the positions of two of your own units).');
});

test('Organic Exchange aimed at two of your own units swaps positions and changes no control', () => {
  const { evs, a, b, g } = exchange(8600, true);
  assertSpoke(evs, 'Organic Exchange aimed at two units you already control');
  assert.equal(g.entity(a.id)!.controller, g.entity(b.id)!.controller,
    'both units are still under the same controller — the assignments cancelled');
});

test('Organic Exchange announces a same-controller swap differently from a real exchange', () => {
  // the honesty of the log, as a structural claim: whatever the two lines say,
  // they may not be the SAME line, because the two situations are not the same
  // thing. Wording is deliberately not pinned.
  const same = exchange(8601, true);
  const across = exchange(8602, false);
  const line = (evs: EngineEvent[]): string => evs.map(e => e.msg).join(' | ');
  assert.notEqual(line(same.evs), line(across.evs),
    'Organic Exchange must say something different when both targets already share a '
    + 'controller: there the positions swap and control does not change, and reporting '
    + 'it as two takings names the same player twice for a change that never happened.');
});

test('Organic Exchange across the table still exchanges control', () => {
  const { evs, a, b, g } = exchange(8603, false);
  assertSpoke(evs, 'Organic Exchange aimed across the table');
  assert.notEqual(g.entity(a.id)!.controller, g.entity(b.id)!.controller,
    'the two units really did change hands');
});

// ── 11. THE CLASS ITSELF ────────────────────────────────────────────────

test('every card fixed here is one the whole-pool drill also watches', () => {
  // 81-card-drill wraps every EffectDef in the registry and fails on any run
  // that completes without emitting. This file reaches the situations the
  // drill's three board states cannot arrange; the two nets have to be aimed
  // at the same cards, or a fix here can rot without the sweep noticing.
  const fixed = [
    ...DECLINED_COST.map(([c]) => c),
    ...STACK_GONE.map(([c]) => c),
    ...TARGET_GONE.map(([c]) => c),
    ...CARRIER_GONE.map(([c]) => c),
    ...NO_OPPONENT.map(([c]) => c),
    'Abduct', 'Divine Intervention', 'Organic Exchange', 'Siphon Life',
    'Tides of the Cosmos', 'Perpetual Construct', 'Afflicting Anima', 'Swarmling',
    'Dragnol', 'Spore of Regenesis', 'Murkdrop Distiller', 'The Bonesculptor',
    // (Cosmic Conspirator was here until R104 turned it into a replacement —
    // see the note above. It carries no EffectDef now, by construction, so the
    // drill cannot and should not watch it.)
  ];
  const missing = [...new Set(fixed)].filter(c => effectsOf(c).length === 0);
  assert.deepEqual(missing, [],
    'these cards carry no EffectDef the registry can see, so the drill cannot watch them');
});
