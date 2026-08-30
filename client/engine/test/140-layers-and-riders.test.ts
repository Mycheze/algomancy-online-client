/* R166 — LAYERS AND RIDERS.
 *
 * Four rows of `docs/16-divergence-inventory.md` §2b, and the Origon half of
 * §2c. Each is a card answered one layer, one event fact, or one permission
 * short of what it prints:
 *
 *  · ORIGON — "a player plays THEIR first spell in this battle" counted only
 *    the spells the CARRIER had been in play for, and then located the spell
 *    with `.find()`, which scans the stack from the BOTTOM and answers with
 *    the older of two items. Both halves are the same mistake in different
 *    clothes: the card is about the seat and about the spell just played, and
 *    the code was about this Origon and about whatever turned up first.
 *    R164 added a third: a spell COPY is a real stack item carrying the
 *    original's card name and controller, pushed ABOVE it, so a reverse scan
 *    reaches the copy first. Origon and Hexbane Shiitake — the pool's two
 *    cards that locate a spell by (card, controller) — both name the spell
 *    that was PLAYED, and RAQ says a copy was not: they skip copies.
 *
 *  · MOLTEN TORMENTOR — "whenever I survive damage" was `marked damage <
 *    defense`, so a {Deadly} hit BELOW its defense read as survived. The card
 *    was paid for surviving the one kind of hit that nothing survives, and
 *    then died. Marked damage is not the whole of what kills, so lethality is
 *    a fact the damage site puts ON the event now (`data.lethal`) — computed
 *    from the same expression that decides the kill, in both damage paths.
 *
 *  · BURGEON / SURLY STALKER — "double" was `addTemp(+current effective stat)`:
 *    the LAYER-4 number written back in at LAYER 3, so {Tough} and {Balanced}
 *    applied to it a second time. Burgeon on Rampart Guardian — a PRINTED
 *    {Tough} 0/4, so no exotic combo is needed — promised 8 → 16 and produced
 *    24. Both cards now solve for the layer-3 delta that lands `effStats` on
 *    the promised number.
 *
 *  · DIVINE INTERVENTION — "You MAY change the targets" re-picked every slot
 *    with no way to leave one alone, which turns a permission into a
 *    requirement the moment an effect has two targets.
 *
 * Seeds 14000-14099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EngineEvent, EntityId, Seat, StackItem } from '../src/types.ts';

// ── the rig (85-silent-branches', plus a record of what each menu offered) ──

type Answers = Record<string, unknown>;

/** Resolve one EffectDef against a live E, answering `ctx.choose` from a
 *  table, and keep every menu it put up so a test can assert on the OPTIONS
 *  rather than only on the outcome. */
function resolve(
  def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat },
  answers: Answers = {}, menus: Record<string, string[]> = {},
): EngineEvent[] {
  const before = g.events.length;
  def.run(g, {
    sourceName: 'test',
    region: g.homeRegion(ctx.controller),
    targets: [],
    event: null,
    eraseSelf: () => {},
    choose: (key, dec) => {
      menus[key] = dec.options.map(o => o.label);
      return key in answers ? answers[key] : dec.options[0]!.value;
    },
    ...ctx,
  } as EffectCtx);
  return g.events.slice(before);
}

/** a 'spellPlayed' event as `commitItem` builds it, for a trigger run by hand.
 *
 *  R191: `item` — the id of the item that was played — is part of that event
 *  and has been since R178, and Origon and Hexbane Shiitake now read it
 *  instead of scanning the stack for (card, controller). A fixture without it
 *  is not the event the engine emits, so it is passed here. */
const spellPlayedEvent = (card: string, seat: Seat, region: number, item: number): EngineEvent =>
  ({ type: 'spellPlayed', msg: '', data: { card, seat, region, item } });

/** put a unit into a REGION rather than into its controller's home region —
 *  `util.spawn`'s battle-time sibling, for a body that arrives mid-battle. */
function spawnInto(h: Harness, seat: Seat, name: string, region: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, name, region);
  e.settle();
  h.state = e.s;
  return u.id;
}

// ── ORIGON ──────────────────────────────────────────────────────────────

test('Origon negates the TOP of two identical stack items, not the bottom', () => {
  const h = new Harness(14000);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  const copy = (id: number): StackItem => ({
    id, kind: 'spell', card: 'Fight', label: `Fight (${id})`, controller: A,
    region, negated: false, parts: [{ effectKey: 'spell:Fight', targets: [] }],
  });
  // Two copies of one card, same controller, both on the stack. The trigger is
  // about the one played LAST, which is the one on TOP.
  g.s.stack.push(copy(7001));   // the older copy, underneath
  g.s.stack.push(copy(7002));   // the copy the 'spellPlayed' event names
  resolve(getCard('Origon').augmentText![0]!.effect, g, {
    controller: D, sourceName: 'Origon', region,
    event: spellPlayedEvent('Fight', A, region, 7002),
  });
  assert.deepEqual(g.s.stack.map(i => i.id), [7001],
    'the TOP copy is the one that was just played, and the one negated — `.find()` '
    + 'scans from the bottom and took the older one');
  assert.ok(g.events.some(e => e.type === 'negated' && e.data?.['id'] === 7002),
    'the negation names the top item');
});

test('Origon negates the spell that was PLAYED, not the R164 copy standing above it', () => {
  const h = new Harness(14002);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  const played: StackItem = {
    id: 7101, kind: 'spell', card: 'Fight', label: 'Fight', controller: A,
    region, negated: false, parts: [{ effectKey: 'spell:Fight', targets: [] }],
  };
  // R164: a copy carries the ORIGINAL's card name and controller and is pushed
  // ABOVE it, so `(card, controller)` matches two live items and a reverse scan
  // reaches the COPY first.
  const dup: StackItem = { ...structuredClone(played), id: 7102, label: 'Fight (copy)', copy: true };
  g.s.stack.push(played, dup);
  resolve(getCard('Origon').augmentText![0]!.effect, g, {
    controller: D, sourceName: 'Origon', region,
    event: spellPlayedEvent('Fight', A, region, 7101),
  });
  assert.deepEqual(g.s.stack.map(i => i.id), [7102],
    '"negate IT" points at the spell that was played; RAQ: "the 1st copy wasn\'t \'played\'"');
});

test('Hexbane Shiitake exchanges control for the spell that was PLAYED, not for its R164 copy', () => {
  const h = new Harness(14003);
  toDeployment(h);
  const A = h.state.deployPlayer!;      // plays the spell
  const D = (1 - A) as Seat;            // holds the Shiitake
  const hex = spawn(h, D, 'Hexbane Shiitake');
  const g = new E(h.state);
  const region = g.homeRegion(A);
  const played: StackItem = {
    id: 7201, kind: 'spell', card: 'Fight', label: 'Fight', controller: A,
    region, negated: false, parts: [{ effectKey: 'spell:Fight', targets: [] }],
  };
  const dup: StackItem = { ...structuredClone(played), id: 7202, label: 'Fight (copy)', copy: true };
  g.s.stack.push(played, dup);
  resolve(getCard('Hexbane Shiitake').augmentText![0]!.effect, g,
    {
      controller: D, sourceId: hex, sourceName: 'Hexbane Shiitake', region,
      event: spellPlayedEvent('Fight', A, region, 7201),
    },
    { swap: true });
  assert.equal(g.s.stack.find(i => i.id === 7201)!.controller, D,
    '"exchange control of me for THAT spell" — that spell is the one they played');
  assert.equal(g.s.stack.find(i => i.id === 7202)!.controller, A,
    'a copy was never played, so it is not what the exchange is for');
});

test('Origon that arrives mid-battle leaves alone a seat whose first spell of the battle is already spent', () => {
  const h = new Harness(14001);
  toDeployment(h);
  const A = h.state.initiative;
  const D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 2);
  giveResources(h, A, 'fire', 1);      // Structural Collapse eer/3
  giveResources(h, A, 'water', 1);     // Torrential Reclamation br/X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // A's GENUINE first spell of this battle, played with no Origon anywhere.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Structural Collapse') });
  pick(h, { unit: atk });               // R35 cast cost
  pass(h); pass(h);
  assert.ok(!h.log.some(m => m.includes('is negated')), 'nothing was in play to negate it');
  assert.equal(h.state.battleCounters[h.state.battle!.region]?.[`spellsPlayedAny:${A}`], 1,
    "the seat's own ledger counted it");
  // NOW an Origon turns up — spawned into the battle by an effect, taken with
  // E.giveControl, augmented on under R95: the card does not care which.
  const orig = spawnInto(h, D, 'Origon', h.state.battle!.region);
  assert.ok(h.state.entities[orig], 'Origon is in play in the battle region');
  // A's SECOND spell. It is not "their first spell in this battle" — the
  // subject of that sentence is the PLAYER, not the Origon.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });
  pick(h, 0);                           // X = 0 at cast (R35)
  pass(h); pass(h);
  assert.ok(!h.log.some(m => m.includes('is negated')),
    "an Origon that arrived after the fact must not negate the seat's SECOND spell");
  assert.ok(h.state.players[A]!.bin.includes('Torrential Reclamation'),
    'the second spell resolved and went to the bin');
});

// ── MOLTEN TORMENTOR ────────────────────────────────────────────────────

/** a Molten Tormentor in play for D, and an E to hit it with */
function tormentor(seed: number): { g: E; A: Seat; D: Seat; id: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const id = spawn(h, D, 'Molten Tormentor');
  return { g: new E(h.state), A, D, id };
}

/** an EffectCtx that deals damage, optionally with attributes granted to it */
const hitCtx = (g: E, seat: Seat, region: number, attrs: string[] = []): EffectCtx => ({
  controller: seat, sourceName: 'Fireball', region, targets: [], event: null,
  eraseSelf: () => {},
  choose: () => { throw new Error('no choice expected'); },
  ...(attrs.length ? { grantedAttrs: attrs } : {}),
} as unknown as EffectCtx);

const tormentorTriggers = (g: E): number =>
  g.s.triggerQueue.filter(t => t.sourceCard === 'Molten Tormentor').length;

test('Molten Tormentor does NOT pay out on a {Deadly} hit below its defense', () => {
  const { g, A, id } = tormentor(14010);
  const mt = g.entity(id)!;
  assert.deepEqual(g.effStats(mt), [7, 6], 'a 7/6');
  g.dealEffectDamage(hitCtx(g, A, mt.region, ['Deadly']), mt, 3);
  assert.ok(!g.entity(id), 'R21: the {Deadly} hit killed it, three damage on a defense of six');
  assert.equal(tormentorTriggers(g), 0,
    'it did not survive the damage, so "whenever I survive damage" must not have fired — '
    + 'reading marked damage alone said it did, and then it died anyway');
});

test('Molten Tormentor DOES pay out on a survivable hit', () => {
  const { g, A, id } = tormentor(14011);
  const mt = g.entity(id)!;
  g.dealEffectDamage(hitCtx(g, A, mt.region), mt, 3);
  assert.ok(g.entity(id), 'three damage on a defense of six leaves it standing');
  assert.equal(tormentorTriggers(g), 1,
    'the working half must stay working — the fix is not "never fire"');
});

// ── BURGEON ─────────────────────────────────────────────────────────────

test('Burgeon doubling a {Tough} unit\'s defense gives the printed number', () => {
  const h = new Harness(14020);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const id = spawn(h, A, 'Rampart Guardian');     // PRINTED {Tough} 0/4
  const g = new E(h.state);
  const u = g.entity(id)!;
  assert.deepEqual(g.printedStats(u), [0, 4], 'printed 0/4');
  assert.deepEqual(g.effStats(u), [0, 8], 'R19 layer 4: {Tough} doubles the defense to 8');
  resolve(getCard('Burgeon').spellEffect!, g,
    { controller: A, sourceName: 'Burgeon', targets: [u], mode: 'defense' });
  assert.deepEqual(g.effStats(u), [0, 16],
    'double its defense (8) is 16 — the old layer-3 +8 came back out of layer 4 as 24');
});

test('Burgeon doubling a plain unit\'s defense still doubles it', () => {
  // the guard against "fix it by halving everything": with no layer-4
  // attribute in sight the answer has not moved at all.
  const h = new Harness(14021);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const id = spawn(h, A, 'The Foretold');         // vanilla 3/3
  const g = new E(h.state);
  const u = g.entity(id)!;
  assert.deepEqual(g.effStats(u), [3, 3]);
  resolve(getCard('Burgeon').spellEffect!, g,
    { controller: A, sourceName: 'Burgeon', targets: [u], mode: 'defense' });
  assert.deepEqual(g.effStats(u), [3, 6], 'a plain 3/3 doubles its defense to 6');
});

// ── SURLY STALKER ───────────────────────────────────────────────────────

test('Surly Stalker doubling itself while its column shares {Tough} gives the printed number', () => {
  // TWO PRINTED CARDS, no virus donation: Surly Stalker prints no stat-layer
  // attribute, but R19 shares one up and down a column, and Rampart Guardian
  // prints {Tough}. Attacking together is all it takes.
  const h = new Harness(14030);
  toDeployment(h);
  const A = h.state.initiative;
  const id = spawn(h, A, 'Surly Stalker');        // 4/4, no printed attributes
  const rg = spawn(h, A, 'Rampart Guardian');     // printed {Tough} 0/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[id, rg]] });
  const g = new E(h.state);
  const u = g.entity(id)!;
  assert.deepEqual(g.effStats(u), [4, 8], 'R19: the column shares {Tough}, so a 4/4 reads 4/8');
  resolve(getCard('Surly Stalker').abilities![0]!.effect, g,
    { controller: A, sourceId: id, sourceName: 'Surly Stalker' });
  assert.deepEqual(g.effStats(u), [8, 16],
    'double my power and defense: 4 → 8 and 8 → 16, not 8 → 24');
});

test('Surly Stalker doubling itself with no attributes still doubles it', () => {
  const h = new Harness(14031);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const id = spawn(h, A, 'Surly Stalker');
  const g = new E(h.state);
  const u = g.entity(id)!;
  assert.deepEqual(g.effStats(u), [4, 4]);
  resolve(getCard('Surly Stalker').abilities![0]!.effect, g,
    { controller: A, sourceId: id, sourceName: 'Surly Stalker' });
  assert.deepEqual(g.effStats(u), [8, 8], 'a plain 4/4 doubles to 8/8');
});

// ── DIVINE INTERVENTION ─────────────────────────────────────────────────

test('Divine Intervention can keep one target while changing another', () => {
  const h = new Harness(14040);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const keep = spawn(h, A, 'The Foretold');
  const move = spawn(h, A, 'Tidal Menace');
  const g = new E(h.state);
  const region = g.homeRegion(A);
  // D's two-target effect, aimed at both of A's units. A answers with Divine
  // Intervention and wants to move ONE of the two.
  const item: StackItem = {
    id: 4242, kind: 'spell', card: 'Overbloom', label: 'Overbloom',
    controller: D, region, negated: false,
    parts: [{ effectKey: 'spell:Overbloom', targets: [{ unit: keep }, { unit: move }] }],
  };
  g.s.stack.push(item);
  const menus: Record<string, string[]> = {};
  const evs = resolve(getCard('Divine Intervention').spellEffect!, g,
    { controller: A, sourceName: 'Divine Intervention', region, targets: [{ stack: 4242 }] },
    { may: true, 'retarget:0:0': { unit: keep }, 'retarget:0:1': { unit: keep } },
    menus);
  assert.ok(menus['retarget:0:0']?.[0]?.startsWith('Keep'),
    '"you MAY change the targets" — every slot must offer leaving it alone, and it must '
    + 'lead the menu; without it the permission is a requirement');
  assert.equal(menus['retarget:0:0']!.filter(l => l.includes('The Foretold')).length, 1,
    'the kept target is offered once, not twice under two labels');
  assert.deepEqual(g.s.stack[0]!.parts[0]!.targets, [{ unit: keep }, { unit: keep }],
    'the first target was kept and the second was moved onto it');
  const said = evs.find(e => e.data?.['item'] === 4242 && e.data?.['n'] !== undefined);
  assert.ok(said, 'it still reports what it did');
  assert.equal(said!.data!['n'], 1, 'ONE target changed — keeping a target is not changing it');
});
