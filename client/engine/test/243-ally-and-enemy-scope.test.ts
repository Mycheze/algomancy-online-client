/* R265 — ALLY INCLUDES ITSELF, "ANOTHER" IS THE WORD THAT EXCLUDES IT, AND
 * BOTH ARE SCOPED TO ONE REGION.
 *
 * The question (round-32 Q5) was about ONE card. Shoreline Specter prints
 * "[Augment] After combat, you may recall target ally", and its menu offered
 * the Specter itself — is that right?
 *
 * OWNER RULING, 2026-08-30, verbatim:
 *
 *   "Yes, an ally includes itself. Otherwise it'd say 'Another target ally'.
 *    Ally = all units under your control in the current region. Enemy = all
 *    units not under your control in the current region."
 *
 * One answer, three separate checkable claims, and none of them had been
 * written down before:
 *
 *   1. an "ally" target offers the source;
 *   2. the printed word "another" is what takes the source off the menu;
 *   3. both words are scoped to the region the effect happens in.
 *
 * ⚠ THE BRIEF'S PREMISE WAS THAT "ALLY" IS ONE CONCEPT WITH ONE SEAM. IT IS
 * NOT. The engine answers "who is an ally" in SIX unrelated places, and this
 * file measures each of them rather than assuming the first one is the rule:
 *
 *   · `E.pushUnitTargets`   — target MENUS. `unitsIn(region)` + controller.
 *   · `EffectDef.subject` / `pickAlly` (Wraith) — an UNTARGETED "an ally",
 *     chosen at cast or at resolution. Its own `unitsOf(controller, region)`.
 *   · cast-COST pools (`recallUnit`, `sacrificeUnit`, `removeCounters`) —
 *     `unitsOf(seat, item.region)`, engine-side, and "another" is spelled
 *     `u.id !== sourceId` there.
 *   · `StaticMod.affects` — `t.controller === self.controller`; the REGION
 *     comes from `staticsFor`, not from the card.
 *   · triggered `when` predicates — `ev.data.seat === self.controller`; the
 *     REGION comes from `fireEvent`'s listener filter, not from the card.
 *   · formation adjacency (Ancient One, Flamebreath Initiate) — a strict
 *     subset of a region, so it cannot leak past one.
 *
 * They agree today. Nothing makes them agree, which is why the measurements
 * below are behavioural (run the seam, read the answer) rather than a source
 * scan of any one of them.
 *
 * Seeds 24300-24399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// R214: the PUBLIC entry point. `cards/registry.ts` alone registers 494 of the
// 495 cards — `Alluring Attribute`, the pool's ONLY `enemyUnit` target, is
// registered by `src/apply.ts`, which index.ts pulls. Importing the registry
// directly would make §1c's enemy half silently empty.
import '../src/index.ts';
import { allCardNames, ambushEffect, getCard, specForSlot } from '../src/cards/dsl.ts';
import { legalActions } from '../src/apply.ts';
import { activationNeedsConfirm } from '../../ui/inspect.ts';
import type { Element } from '../src/types.ts';

/** every element the pool can charge an Ambush in */
const ELEMENTS: readonly Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];
import type { ActivatedAbility, EffectDef, TargetSpec } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import type { Action, Entity, EntityId, Seat, TargetRef } from '../src/types.ts';
import { ent, giveResources, spawn, toDeployment, toNextBattle, withE } from './util.ts';

// ── the printed pool, read as data ────────────────────────────────────
// Everything in this file derives its subject set from here or from the
// registry. There is no list of card names anywhere below; a card added to
// the pool joins the measurement by itself, and the counts pinned at each
// step are what makes that visible instead of silent.
const PRINTED = JSON.parse(readFileSync(
  fileURLToPath(new URL('../src/cards/printed.json', import.meta.url)), 'utf8',
)) as Record<string, { text?: string }>;

const textOf = (name: string): string => PRINTED[name]?.text ?? '';

/** every effect a card owns, tagged with where it came from. The Ambush
 * mode's effect is generated (dsl.ts) rather than declared, and it carries an
 * `allyUnit` slot that no other channel of that card does — six ambushers are
 * six of the pool's ally targets, so it must be walked. */
function effectsOf(name: string): { where: string; def: EffectDef }[] {
  const c = getCard(name) as {
    spellEffect?: EffectDef; graftEffect?: { effect: EffectDef };
    abilities?: { effect: EffectDef }[]; augmentText?: { effect: EffectDef }[];
    ambush?: unknown;
  };
  const out: { where: string; def: EffectDef }[] = [];
  if (c.spellEffect) out.push({ where: 'spell', def: c.spellEffect });
  if (c.graftEffect) out.push({ where: 'graft', def: c.graftEffect.effect });
  (c.abilities ?? []).forEach((a, i) => out.push({ where: `ability${i}`, def: a.effect }));
  (c.augmentText ?? []).forEach((a, i) => out.push({ where: `augment${i}`, def: a.effect }));
  if (c.ambush) out.push({ where: 'ambush', def: ambushEffect(name) });
  return out;
}

/** R58/R83: how many cast-time slots a spec asks for. `count: 'X'` is fixed at
 * cast and is never fewer than the one printed slot it stands for, so it
 * counts as one here — the point is to reach every DISTINCT slot kind, and a
 * counted spec repeats its last kind. */
const slotCount = (s: TargetSpec): number =>
  (s.count === 'X' ? 1 : (s.count ?? 1)) + (s.extraSlots ?? 0);

interface Slot { card: string; where: string; index: number; spec: TargetSpec }

/** every cast-time target slot in the pool, one entry per (card, effect, index) */
function allSlots(): Slot[] {
  const out: Slot[] = [];
  for (const card of allCardNames()) {
    for (const { where, def } of effectsOf(card)) {
      const spec = def.targets;
      if (!spec) continue;
      for (let index = 0; index < slotCount(spec); index++) {
        out.push({ card, where, index, spec: specForSlot(spec, index) });
      }
    }
  }
  return out;
}

const SLOTS = allSlots();
const label = (s: Slot): string => `${s.card} ${s.where} slot${s.index}`;

const allySlots = SLOTS.filter(s => s.spec.what === 'allyUnit');
const enemySlots = SLOTS.filter(s => s.spec.what === 'enemyUnit');

// ── the board every measurement is taken on ───────────────────────────
// Two regions, each holding one unit of each seat, plus a second ally beside
// the source. The bodies are the pool's VANILLA units (no printed text, no
// attributes), derived rather than named: a body with a spawn trigger would
// put tokens on the board and change the candidate counts under the test.
const VANILLA = allCardNames().filter(n => {
  const c = getCard(n) as { kind?: string; attrs?: string[] };
  return c.kind === 'unit' && !textOf(n).trim() && !(c.attrs ?? []).length;
});

interface Board {
  h: Harness; seat: Seat; foe: Seat; here: number; there: number;
  self: EntityId; ally: EntityId; enemy: EntityId; farAlly: EntityId; farEnemy: EntityId;
}

function board(seed: number): Board {
  assert.ok(VANILLA.length >= 2, 'the pool must still have vanilla bodies to build a quiet board with');
  const [a, b] = VANILLA as [string, string];
  const h = new Harness(seed);
  toDeployment(h);
  const seat = h.state.initiative as Seat;
  const foe = (1 - seat) as Seat;
  const out = { h, seat, foe } as Board;
  withE(h, e => {
    out.here = e.homeRegion(seat);
    out.there = e.homeRegion(foe);
    assert.notEqual(out.here, out.there, 'the two seats must have different home regions');
    out.self = e.spawnUnit(seat, a, out.here).id;
    out.ally = e.spawnUnit(seat, b, out.here).id;
    out.enemy = e.spawnUnit(foe, a, out.here).id;
    out.farAlly = e.spawnUnit(seat, b, out.there).id;
    out.farEnemy = e.spawnUnit(foe, a, out.there).id;
    e.settle();
  });
  return out;
}

/** the menu one slot offers, as `{unit:id}` keys, asked exactly the way the
 * collector asks it: the EFFECT's controller as `ally`, the source entity as
 * `sourceId`, in the effect's region (R64). */
function menu(b: Board, s: Slot, region = b.here, source: EntityId | undefined = b.self): string[] {
  let out: string[] = [];
  withE(b.h, e => {
    out = e.targetCandidates(s.spec, region, undefined, b.seat, source).map(r => JSON.stringify(r));
  });
  return out;
}
const unitKey = (id: EntityId): string => JSON.stringify({ unit: id } as TargetRef);

// ══════════════════════════════════════════════════════════════════════
// §1 — CLAIM 1: an ally target offers the source
// ══════════════════════════════════════════════════════════════════════

test('R265 §1a the pool really has an ally-target family, and an enemy-target family of one', () => {
  // POSITIVE CONTROL. A filter that matches nothing passes forever and is
  // indistinguishable from a working check, so the sizes are pinned.
  assert.equal(allCardNames().length, 495, 'the pool size these counts were measured against');
  assert.equal(allySlots.length, 18, 'cast-time allyUnit slots in the pool');
  assert.equal(new Set(allySlots.map(s => s.card)).size, 14, 'cards that declare one');

  // ⚠ MEASURED, AND IT CORRECTS THE FRAMING: "enemy" is barely a TARGETING
  // word in this pool. Exactly one effect declares `enemyUnit`, and it is a
  // SYNTHETIC — the {Alluring} attribute's generated ability, not a printed
  // card. The one card that prints "target enemy" (Frosted Denial) says
  // "target enemy EFFECT", which is a stack item and not a unit at all. So
  // the ruling's enemy half is exercised almost entirely by statics,
  // triggers and sweeps, which is where §3 goes looking for it.
  assert.equal(enemySlots.length, 1, 'cast-time enemyUnit slots in the pool');
  assert.equal(
    allCardNames().filter(n => /target enem(y|ies)/i.test(textOf(n)))
      .every(n => /target enem(y|ies) effect/i.test(textOf(n))),
    true,
    'every printed "target enemy" in the pool is "target enemy EFFECT" — a stack item, not a unit',
  );
});

test('R265 §1b every printed target-ally card declares an allyUnit slot', () => {
  // The two directions of the same claim. A card could print "target ally"
  // and be implemented as a plain `unit` slot with a hand-rolled ownership
  // restriction — a second seam answering the same word — and this is what
  // would notice.
  const printedAlly = allCardNames().filter(n => /target (?:\w+ )?all(y|ies)/i.test(textOf(n)));
  const declared = new Set(allySlots.map(s => s.card));
  assert.equal(printedAlly.length, 13, 'cards whose printed text asks for a target ally');
  assert.deepEqual(printedAlly.filter(n => !declared.has(n)), [],
    'a card prints "target ally" but declares no allyUnit slot — a second ownership seam');

  // The other way round is allowed exactly once, and the reason is printed
  // data rather than behaviour: one ambusher carries no reminder text, so the
  // "recall target ally" its Ambush mode really has was never printed on it.
  const extra = [...declared].filter(n => !/target (?:\w+ )?all(y|ies)/i.test(textOf(n)));
  assert.equal(extra.length, 1, 'declared-but-not-printed ally targets');
  assert.match(textOf(extra[0]!), /Ambush/,
    'the one card declaring an ally target it does not print is an Ambush with no reminder text');
});

test('R265 §1c an ally target offers the source — 17 of the pool 18 slots, and the 18th prints ANOTHER', () => {
  const b = board(24300);
  const withSelf: string[] = [];
  const withoutSelf: string[] = [];
  for (const s of allySlots) {
    (menu(b, s).includes(unitKey(b.self)) ? withSelf : withoutSelf).push(label(s));
  }
  // THE MEASUREMENT the ruling asked for. 17 of 18 ally slots put the source
  // on its own menu; every one of them is a card with no "another" printed.
  assert.equal(withSelf.length, 17, `ally slots that offer the source: ${withSelf.join(', ')}`);
  assert.equal(withoutSelf.length, 1, `ally slots that do not: ${withoutSelf.join(', ')}`);
  assert.deepEqual(
    [...new Set(withoutSelf.map(l => allySlots.find(s => label(s) === l)!.card))]
      .filter(n => !/another target all(y|ies)/i.test(textOf(n))),
    [],
    'a slot dropped the source without the word "another" printed on the card',
  );
  // …and the menu is not trivially "everything": the enemy in the same region
  // is not an ally, so a passing self-check is not an empty restriction.
  for (const s of allySlots) {
    assert.equal(menu(b, s).includes(unitKey(b.enemy)), false,
      `${label(s)} offered an enemy unit as an ally`);
  }
});

test('R265 §1d the enemy target is the mirror — not the source, not an ally', () => {
  const b = board(24301);
  assert.equal(enemySlots.length, 1);
  const m = menu(b, enemySlots[0]!);
  assert.equal(m.includes(unitKey(b.enemy)), true, 'the enemy unit in the region is offered');
  assert.equal(m.includes(unitKey(b.self)), false, 'the source is not its own enemy');
  assert.equal(m.includes(unitKey(b.ally)), false, 'an ally is not an enemy');
});

// ══════════════════════════════════════════════════════════════════════
// §2 — CLAIM 2: "another" is the word that excludes the source
// ══════════════════════════════════════════════════════════════════════

test('R265 §2a the two sides of the word both exist, and neither set is empty', () => {
  const another = new Set(allCardNames()
    .filter(n => /another target all(y|ies)/i.test(textOf(n))));
  const plain = [...new Set(allySlots.map(s => s.card))].filter(n => !another.has(n));
  assert.equal(another.size, 1, 'cards printing "another target ally"');
  assert.equal(plain.length, 13, 'cards asking for a target ally WITHOUT the word');
  // Both sides non-empty is the whole point of a two-sided check: with only
  // the plain side, "the restriction is missing everywhere" also passes.
  assert.ok(another.size > 0 && plain.length > 0);
});

test('R265 §2b the ANOTHER side, measured where its restriction can actually run', () => {
  // The one card printing "another target ally" also prints "in my
  // formation", so it has nothing to aim at outside a battle — measuring it
  // on a quiet board would read "excludes the source" for the wrong reason.
  // Derived, not named: the pool's single "another target ally" card.
  const [name] = allCardNames().filter(n => /another target all(y|ies)/i.test(textOf(n)));
  assert.ok(name, 'the pool must still contain the card this half of the check is about');
  const h = new Harness(24302);
  toDeployment(h);
  const seat = h.state.initiative as Seat;
  const me = spawn(h, seat, name!);
  const buddy = spawn(h, seat, VANILLA[0]!);
  toNextBattle(h, seat);
  h.do({ type: 'declareAttack', seat, columns: [[me, buddy]] });
  assert.equal(h.state.phase, 'battle', 'the ability needs a formation to switch inside');

  const spec = allySlots.find(s => s.card === name)!.spec;
  withE(h, e => {
    const region = e.entity(me)!.region;
    const m = e.targetCandidates(spec, region, undefined, seat, me).map(r => JSON.stringify(r));
    assert.equal(m.includes(unitKey(me)), false, '"another" takes the source off its own menu');
    assert.equal(m.includes(unitKey(buddy)), true, 'the other ally in the column is still offered');
  });
});

test('R265 §2c across the whole another-target family, the word excludes the SOURCE only when it means the source', () => {
  // Widening claim 2 past the ally family. Ten cards print "another target";
  // the word does not always point at the effect's source — in six of them
  // the other anchor is a SIBLING SLOT ("move counters from target unit onto
  // another target unit"), and slot distinctness (R56) is what enforces those.
  // So this measures the partition rather than asserting one rule for all ten,
  // and pins WHY each side is the size it is.
  const family = allCardNames().filter(n => /another target/i.test(textOf(n)));
  assert.equal(family.length, 10, 'cards printing "another target"');

  const b = board(24303);
  const excludesSource: string[] = [];
  for (const s of SLOTS.filter(s => family.includes(s.card))) {
    // a slot with no live candidates at all cannot answer the question
    const m = menu(b, s);
    if (!m.length) continue;
    if (!m.includes(unitKey(b.self))) excludesSource.push(s.card);
  }
  // MEASURED: two of the ten drop the source from a menu that has other
  // entries — the two whose sentence names the source as the other half of
  // the move ("I fight another target unit", "move a counter FROM ME onto
  // another target unit"). The third source-anchored one is §2b's, which
  // needs a battle. The bin-anchored one (R131 / test 121) has no board
  // candidates here at all.
  assert.deepEqual([...new Set(excludesSource)].length, 2,
    `another-target slots that drop the source: ${[...new Set(excludesSource)].join(', ')}`);
  for (const n of new Set(excludesSource)) {
    assert.match(textOf(n), /\b(I|me|my)\b/,
      `${n} drops the source, so its printed sentence should name the source as the other half`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// §3 — CLAIM 3: ally and enemy stop at the region boundary
// ══════════════════════════════════════════════════════════════════════

test('R265 §3a no ally or enemy slot in the pool can see a unit in another region', () => {
  const b = board(24304);
  assert.ok(b.farAlly !== b.ally && b.farEnemy !== b.enemy);
  for (const s of [...allySlots, ...enemySlots]) {
    const m = menu(b, s);
    assert.equal(m.includes(unitKey(b.farAlly)), false, `${label(s)} reached an ally in another region`);
    assert.equal(m.includes(unitKey(b.farEnemy)), false, `${label(s)} reached an enemy in another region`);
  }
  // the same slots asked in the OTHER region see the other region and only it
  for (const s of allySlots) {
    const m = menu(b, s, b.there, b.farAlly);
    if (!m.length) continue;                       // a restriction, not a region failure
    assert.equal(m.includes(unitKey(b.ally)), false, `${label(s)} reached back into the first region`);
  }
});

test('R265 §3b nor can any other unit-shaped target — the region filter is in the family, not the card', () => {
  // Breadth, because the ruling names units and not "ally targets": every
  // `unit` / `any` / `token` slot in the pool comes off the same
  // `unitsIn(region)` list. If ONE card hand-rolled its own unit list this is
  // where it would show up.
  const b = board(24305);
  const family = SLOTS.filter(s => ['unit', 'any', 'token'].includes(s.spec.what));
  assert.ok(family.length > 100, `unit-shaped slots measured: ${family.length}`);
  for (const s of family) {
    const m = menu(b, s);
    assert.equal(m.includes(unitKey(b.farAlly)), false, `${label(s)} reached into another region`);
    assert.equal(m.includes(unitKey(b.farEnemy)), false, `${label(s)} reached into another region`);
  }
});

test('R265 §3c a static that says ENEMIES does not reach an enemy in another region', () => {
  // The static layer is a SECOND seam that answers "enemy" — the card's
  // `affects` compares controllers and says nothing about regions, and it is
  // `E.staticsFor` (`a.region === target.region`) that supplies the rest of
  // the ruling. Derived: the pool's enemy-boosting static.
  const [name] = allCardNames().filter(n => /^\[Augment\] Enemies gain/i.test(textOf(n).trim()));
  assert.ok(name, 'the pool must still contain a static that buffs enemies');
  const h = new Harness(24306);
  toDeployment(h);
  const seat = h.state.initiative as Seat;
  const foe = (1 - seat) as Seat;
  let near = 0, far = 0, base: [number, number] = [0, 0], boosted: [number, number] = [0, 0];
  withE(h, e => {
    const here = e.homeRegion(seat), there = e.homeRegion(foe);
    e.spawnUnit(seat, name!, here);
    near = e.spawnUnit(foe, VANILLA[0]!, here).id;
    far = e.spawnUnit(foe, VANILLA[0]!, there).id;
    e.settle();
  });
  withE(h, e => {
    boosted = e.effStats(e.entity(near)!);
    base = e.effStats(e.entity(far)!);
  });
  assert.notDeepEqual(boosted, base, 'the enemy in the region is buffed — the control is live');
  assert.equal(boosted[0] - base[0], 2, 'the printed +2/+2 landed on the enemy that is here');
  assert.deepEqual(base, [boosted[0] - 2, boosted[1] - 2],
    'the enemy in the OTHER region is untouched');
});

test('R265 §3d a trigger that watches for another ALLY does not see one spawn in another region', () => {
  // The trigger layer is a THIRD seam. The card's `when` reads
  // `ev.data.seat === self.controller` and never mentions a region; the
  // region comes from `E.fireEvent`, which only offers the event to listeners
  // in it. Derived: the pool augment that grows on every other ally spawn.
  const [name] = allCardNames()
    .filter(n => /Whenever another ally spawns, put a \+1\/\+1 counter on me/i.test(textOf(n)));
  assert.ok(name, 'the pool must still contain the ally-spawn watcher this measures');
  const h = new Harness(24307);
  toDeployment(h);
  const seat = h.state.initiative as Seat;
  const foe = (1 - seat) as Seat;
  let watcher = 0, here = 0, there = 0;
  withE(h, e => {
    here = e.homeRegion(seat); there = e.homeRegion(foe);
    watcher = e.spawnUnit(seat, name!, here).id;
    e.settle();
  });
  const drain = (): void => {
    let guard = 200;
    while (guard-- > 0) {
      const d = h.state.decision;
      if (!d) return;
      h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
    }
    throw new Error('decisions did not settle');
  };
  const counters = (): number => ent(h, watcher)!.counters;
  assert.equal(counters(), 0);
  withE(h, e => { e.spawnUnit(seat, VANILLA[0]!, here); e.settle(); });
  drain();
  assert.equal(counters(), 1, 'an ally spawning in the same region is an ally — the control is live');
  withE(h, e => { e.spawnUnit(seat, VANILLA[0]!, there); e.settle(); });
  drain();
  assert.equal(counters(), 1, 'an ally spawning in ANOTHER region is not one this card can see');
});

test('R265 §3e every ally and enemy list a card builds for itself names a region', () => {
  // The FOURTH seam: card code that walks the board directly rather than
  // through a target menu (sweeps, cost pools, untargeted "an ally" picks).
  // `unitsOf`/`unitsIn` are the only two doors to the board, and a call with
  // no region argument is the shape of a card that can see the whole table.
  const dir = fileURLToPath(new URL('../src/cards/', import.meta.url));
  const paths = [
    ...readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => dir + f),
    ...readdirSync(dir + 'sets').filter(f => f.endsWith('.ts')).map(f => dir + 'sets/' + f),
  ];
  let sites = 0;
  const bare: string[] = [];
  const allRegions: string[] = [];
  for (const p of paths) {
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\*|\/\/)/.test(line)) return;                 // a comment quoting the shape
      for (const m of line.matchAll(/\bunits(?:Of|In)\(([^)]*)\)/g)) {
        sites++;
        const args = m[1]!.split(',').map(s => s.trim()).filter(Boolean);
        const isIn = m[0]!.startsWith('unitsIn');
        if (args.length < (isIn ? 1 : 2)) bare.push(`${p.split('/').pop()}:${i + 1} ${m[0]}`);
        // a region ARGUMENT that is itself an iteration over every region is
        // the same reach by another route
        if (/g\.s\.regions/.test(line)) allRegions.push(`${p.split('/').pop()}:${i + 1}`);
      }
    });
  }
  assert.equal(sites, 78, 'board reads in card code — the derivation must keep finding them');
  assert.deepEqual(bare, [], 'a card read the board without naming a region');

  // ONE site walks every region, and it is not a unit set: it builds the menu
  // for "name a card", which is unrestricted by ruling and reads NAMES, not
  // allies. If a second one appears it is almost certainly a real leak.
  assert.equal(allRegions.length, 1, `card code sites that iterate every region: ${allRegions.join(', ')}`);
});

// ══════════════════════════════════════════════════════════════════════
// §4 — the seams have to keep agreeing
// ══════════════════════════════════════════════════════════════════════

test('R265 §4a the ambush legality gate asks for the same ally the ambush effect will', () => {
  // WAS A TRIPWIRE, IS NOW AN AGREEMENT CHECK, and the difference matters.
  //
  // `apply.ts` used to gate "may I play this as an Ambush?" with a spec it
  // BUILT INLINE — `{ what: 'allyUnit', prompt: '' }` — rather than with
  // `ambushEffect(name).targets`. Two places, one question, agreeing only
  // because the generated spec happened to carry no restriction. The first
  // version of this test asserted `spec.restrict === undefined`, which notices
  // the day the spec grows one but says NOTHING about whether the two places
  // agree — it fails identically before and after the fix, so it could not
  // have held the fix down.
  //
  // So: plant a restriction on the real spec, in memory, and check the GATE
  // follows it. That is the property R64/R65 are about, and it is the one a
  // future card actually depends on.
  const ambushers = allCardNames().filter(n => !!(getCard(n) as { ambush?: unknown }).ambush);
  assert.equal(ambushers.length, 6, 'cards with an Ambush mode');
  for (const n of ambushers) {
    const spec = ambushEffect(n).targets!;
    assert.equal(spec.what, 'allyUnit', `${n}: the Ambush mode still recalls a target ally`);
    assert.equal(spec.count ?? 1, 1);
  }

  // ── the agreement itself, exercised through the real legality gate ──
  // Ambush is BATTLE timing and the offer is only built for a seat that HOLDS
  // PRIORITY, so a deployment board (or a battle before anyone has attacked)
  // offers it zero times and every assertion below would pass vacuously.
  // Declare an attack, hand priority to the defender, give them an ally to
  // displace, and REQUIRE the unrestricted gate to offer the mode before
  // believing anything a restriction does to it.
  const name = ambushers[0]!;
  const spec = ambushEffect(name).targets!;
  const before = spec.restrict;
  const h = new Harness(24310);
  toDeployment(h);
  const atkSeat = h.state.initiative as Seat;
  const defSeat = (1 - atkSeat) as Seat;
  const attacker = spawn(h, atkSeat, VANILLA[0]!);
  spawn(h, defSeat, VANILLA[0]!);          // an ally for each side to displace
  toNextBattle(h, atkSeat);
  for (const k of ELEMENTS) { giveResources(h, atkSeat, k, 8); giveResources(h, defSeat, k, 8); }
  h.do({ type: 'declareAttack', seat: atkSeat, columns: [[attacker]] });
  // WHOEVER the attack window hands priority to — asserted, not assumed, since
  // which seat that is depends on the seed and is not what this test is about
  const acting = h.state.priority;
  assert.notEqual(acting, null, 'the attack window must open a priority window for somebody');
  assert.notEqual(defSeat, undefined);

  const gate = (): number => {
    const p = h.state.players[acting as Seat]!;
    p.hand.push(name);
    const n = legalActions(h.state, acting as Seat)
      .filter(a => a.type === 'playCard' && (a as { mode?: string }).mode === 'ambush').length;
    p.hand.pop();
    return n;
  };
  try {
    (spec as { restrict?: unknown }).restrict = undefined;
    const offered = gate();
    // ⚠ THE CONTROL THAT MAKES THE REST MEAN ANYTHING, and it earned its place:
    // the first draft of this test asserted `offered >= 0` on a DEPLOYMENT
    // board, which is true of every number. The restriction check below then
    // passed against the unfixed apply.ts too — an empty subject set reading
    // exactly like a working check, in the very file whose subject is two
    // places agreeing for the wrong reason.
    assert.ok(offered > 0,
      `the Ambush mode for ${name} is not on offer even with no restriction and every resource `
      + 'paid, so this test cannot tell a working gate from a broken one. Fix the board, not '
      + 'the assertion.');
    (spec as { restrict?: unknown }).restrict = () => false;
    assert.equal(gate(), 0,
      `the Ambush mode for ${name} is still offered with a target restriction that excludes `
      + 'every ally. The legality gate is asking a spec it built itself instead of the one the '
      + 'effect will use — apply.ts must go through specForSlot(ambushEffect(name).targets!, 0).');
    (spec as { restrict?: unknown }).restrict = () => true;
    assert.equal(gate(), offered,
      'POSITIVE CONTROL: with an always-true restriction the gate offers exactly what it offered '
      + 'with none. If not, the gate is reacting to the PRESENCE of a restriction rather than to '
      + 'what it says.');
  } finally {
    (spec as { restrict?: unknown }).restrict = before;
  }
});

test('R265 §4b no activated ability needs both an irreversible cost and a source-sensitive target', () => {
  // `ui/inspect.ts::activationNeedsConfirm` re-asks `targetCandidates` to
  // decide whether to warn before an irreversible cost — and it omits
  // `sourceId`, which `apply.ts`'s real gate (`abilityUnusable`) passes. A
  // restriction that reads `ctx.sourceId` therefore answers DIFFERENTLY in
  // the two places. Nothing in the pool is on both sides of that today; this
  // fails the day something is, and the fix is to thread `unit.id` through
  // inspect.ts's call.
  const b = board(24308);
  const risky: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name) as { abilities?: unknown[]; augmentText?: unknown[] };
    for (const list of [c.abilities ?? [], c.augmentText ?? []]) {
      for (const raw of list) {
        const ab = raw as { type?: string; cost?: Record<string, unknown>; effect?: EffectDef };
        if (ab.type !== 'activated' || !ab.effect?.targets) continue;
        const cost = ab.cost ?? {};
        const irreversible = !!(cost.sacrificeSelf || cost.life || cost.discard
          || cost.sacrificeOther || cost.discardOrSacrifice || cost.debt);
        if (!irreversible) continue;
        const spec = specForSlot(ab.effect.targets, 0);
        let withSource = -1, without = -1;
        withE(b.h, e => {
          withSource = e.targetCandidates(spec, b.here, undefined, b.seat, b.self).length;
          without = e.targetCandidates(spec, b.here, undefined, b.seat, undefined).length;
        });
        if (withSource !== without) risky.push(`${name} (${withSource} vs ${without})`);
      }
    }
  }
  assert.deepEqual(risky, [],
    'an irreversible activated ability whose target list depends on sourceId — '
    + 'ui/inspect.ts:162 asks without it and will disagree with apply.ts:1135');
});

test('R265 §4b2 the irreversible-cost warning reads the source the real gate reads', () => {
  // §4b above is a TRIPWIRE over the pool: it says no card is currently on both
  // sides of the seam, and it passes identically whether inspect.ts threads
  // `sourceId` or not. That makes it useless as a guard for the fix — which is
  // the whole failure mode this round keeps finding. So: plant a restriction
  // that reads ONLY `ctx.sourceId`, on a real irreversible-cost ability, and
  // check the warning surface answers the way the real gate does.
  //
  // `restrict: ctx => ctx.sourceId === undefined` is chosen so the two
  // versions cannot agree by luck: threaded, it excludes everything and the
  // player IS warned; unthreaded, it admits everything and the player is NOT.
  const b = board(24309);
  let found: { name: string; unit: Entity; ab: ActivatedAbility; index: number } | null = null;
  withE(b.h, e => {
    for (const name of allCardNames()) {
      if (found) break;
      const c = getCard(name) as { abilities?: unknown[] };
      // ⚠ THE INDEX IS PART OF THE ANSWER. `abilityOf` resolves the action's
      // `index` against the card, so a hard-coded 0 silently picks a DIFFERENT
      // ability — one whose cost is reversible, which returns early and makes
      // the whole test pass for the wrong reason.
      (c.abilities ?? []).forEach((raw, index) => {
        if (found) return;
        const ab = raw as ActivatedAbility & { cost?: Record<string, unknown> };
        if (ab.type !== 'activated' || !ab.effect?.targets) return;
        const cost = ab.cost ?? {};
        if (!(cost.sacrificeSelf || cost.life || cost.discard
          || cost.sacrificeOther || cost.discardOrSacrifice || cost.debt)) return;
        found = { name, unit: e.spawnUnit(b.seat, name, b.here), ab, index };
      });
    }
    e.settle();
  });
  assert.notEqual(found, null,
    'no activated ability in the pool carries an irreversible cost AND a target, so this test '
    + 'has nothing to measure and would pass forever. Do not delete it — find out why the pool '
    + 'changed.');
  const hit = found as unknown as
    { name: string; unit: Entity; ab: ActivatedAbility; index: number };
  // ⚠ MUTATE THE SOURCE SPEC, not a `specForSlot` result: that helper returns a
  // fresh `{ ...spec }` every call, so a restriction planted on a copy is
  // invisible to inspect.ts, which builds its own — and the test then passes
  // for the wrong reason against BOTH versions of the fix.
  const spec = hit.ab.effect!.targets!;
  const before = (spec as { restrict?: unknown }).restrict;
  // `abilityIndex`, not `index` — `abilityOf` reads that field, and a wrong key
  // makes it return undefined, which `activationNeedsConfirm` turns into a
  // cheerful `false`. Every assertion below would then hold for a reason that
  // has nothing to do with sourceId.
  // `entityId` and `abilityIndex` — both names matter. `abilityOf` reads
  // `abilityIndex`, and a wrong key there makes it return undefined, which
  // `activationNeedsConfirm` turns into a cheerful `false`; every assertion
  // below would then hold for a reason unrelated to sourceId. (This object was
  // written with `unit:` and `index:` first, typechecked as a cast, and the
  // test passed anyway — which is why it is now a plain typed literal.)
  const action: Extract<Action, { type: 'activateAbility' }> = {
    type: 'activateAbility', seat: b.seat, entityId: hit.unit.id, abilityIndex: hit.index,
  };
  try {
    (spec as { restrict?: unknown }).restrict = undefined;
    let base = false;
    withE(b.h, e => { base = activationNeedsConfirm(e, ent(b.h, hit.unit.id)!, action); });
    assert.equal(base, false,
      `${hit.name}: with no restriction the ability has targets, so no confirm is needed. If `
      + 'this is already true the check below cannot distinguish anything.');
    (spec as { restrict?: unknown }).restrict = (_g: unknown, _t: unknown,
      ctx: { sourceId?: EntityId }) => ctx.sourceId === undefined;
    let warned = false;
    withE(b.h, e => { warned = activationNeedsConfirm(e, ent(b.h, hit.unit.id)!, action); });
    assert.equal(warned, true,
      `${hit.name}: the irreversible-cost warning did not see a restriction that reads sourceId, `
      + 'so it is asking targetCandidates WITHOUT the source while apply.ts asks WITH it. '
      + 'ui/inspect.ts must pass `unit.id` as the fifth argument.');
  } finally {
    (spec as { restrict?: unknown }).restrict = before;
  }
});

test('R265 §4c ally is measured from the EFFECT controller, never from the chooser', () => {
  // R58, restated for this ruling: "under YOUR control" is the controller of
  // the effect. Asking the same slot as the other seat has to hand back the
  // other seat's units, or a redirect could drop an enemy into an ally slot.
  const b = board(24309);
  for (const s of allySlots) {
    let mine: string[] = [], theirs: string[] = [];
    withE(b.h, e => {
      mine = e.targetCandidates(s.spec, b.here, undefined, b.seat, b.self).map(r => JSON.stringify(r));
      theirs = e.targetCandidates(s.spec, b.here, undefined, b.foe, b.enemy).map(r => JSON.stringify(r));
    });
    assert.equal(mine.includes(unitKey(b.enemy)), false, `${label(s)}: my ally list held their unit`);
    assert.equal(theirs.includes(unitKey(b.self)), false, `${label(s)}: their ally list held my unit`);
    assert.equal(theirs.includes(unitKey(b.ally)), false, `${label(s)}: their ally list held my unit`);
  }
});
