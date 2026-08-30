/* R227 / R223 — AN EFFECT WITH NO LEGAL TARGET FIZZLES, AND SAYS SO.
 *
 * The owner, 2026-08-28, asked what a spell should do when it resolves with no
 * legal target: **"Fizzle, and say so in the log."** Not silently, not as an
 * invariant violation. The player must learn why nothing happened, and the log
 * line is REQUIRED, not optional.
 *
 * ── WHAT WAS ACTUALLY BROKEN
 *
 * The pool's idiom for "the one thing I was aimed at" was `ctx.targets[0]!`,
 * and the `!` is a TypeScript token, not a guard: it type-strips to nothing and
 * the list IS empty when the effect is entered having lost what it declared.
 * The result was a TypeError with no card name in it — the loudest possible
 * way to not answer the question the ruling answers.
 *
 * CT-89 named TWO cards ("Luminous Arc and Dreadwave Devourer") and predicted
 * there would be more. It was right to predict that and wrong about the
 * instrument, and so was report #46 before it, which was closed with a
 * one-card fix and then re-filed by the owner twice as the same class.
 *
 * ── THE CLASS, MEASURED (R227, 2026-08-28)
 *
 * Not grepped — grep finds 12 sites of a TOKEN, which is not a guard analysis.
 * Measured by re-driving every EffectDef in the registry through
 * `65-effect-conformance`'s own rig with `ctx.targets` forced EMPTY, on all
 * three of its boards:
 *
 *     42 throws  =  14 EFFECT SLOTS  on  12 CARDS
 *     11 of the 14 came through ONE shared factory, registry.ts's
 *     `dealToAnyTarget` — the "I deal N damage to any target" family.
 *
 * ⚠ TWO CARDS THROW ON MORE THAN ONE ROUTE, and it is the same `EffectDef`
 * object reached twice, not two copies of a bug:
 *
 *     Sacrificial Burst — `spell:` AND `graft:`   (one `burstEffect`)
 *     Rune Channeler    — `ability:#0` AND `graft:` (one `runeChannelerDeal2`)
 *
 * A NAME-KEYED guard gets those wrong in both directions: fix "the card" by
 * patching one call site and the other route still crashes; count "the cards"
 * and the class looks two smaller than it is. The unit of this defect is the
 * EFFECT SLOT. `identity` below asserts the sharing so nobody re-splits them.
 *
 * ── WHY THIS WAS LATENT AND NOT A LIVE CRASH
 *
 * `E.resolveItem` applies R86 first: an item that has lost every target it
 * declared fizzles — and logs — BEFORE `run` is entered, so the ordinary cast
 * path never reaches these lines. That is a property of ONE CALLER. Every one
 * of the 14 has `min >= 1` and none is optional, which was checked rather than
 * assumed; and 65's `unfairThrows` had been printing two of them as "artifacts"
 * for two rounds. R223 makes the cards answer for themselves.
 *
 * ── THE GUARDS THIS FILE IS THE REGRESSION SUITE FOR
 *
 * The sweep that measured the class IS the guard now — `65-effect-conformance`
 * §3, computed from the registry every run, with a positive control proving it
 * can convict. A second, source-level guard in the same section bans the idiom
 * outright, because the drive can only prove things about lines it REACHES:
 * `Burning Vengeance` held an unguarded site behind a `deaths <= 0` early
 * return that no board reaches, and only the source scan saw it.
 *
 * This file is the other half the owner asked for: *"For each bug that has to
 * do with certain cards, design a new test which will be run during testing to
 * ensure the card retains the intended functionality in that case."* Named,
 * per-card, per-ROUTE, asserting both halves of the ruling — the fizzle and the
 * line — and asserting that the guarded cards still do their job when they DO
 * have a target.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { effectByKey, isEntityTarget, type EffectCtx, type ResolvedTarget } from '../src/cards/dsl.ts';
import { spawn, toDeployment } from './util.ts';
import type { CardName, Entity, GameState, Seat } from '../src/types.ts';

/** the wording R223 requires, in one place here too — if `firstTarget` ever
 * says something else, every case below reddens at once rather than one of
 * them quietly passing on a different sentence. */
const FIZZLE_LINE = /: it has no legal target — nothing happens\.$/;

interface Rig { g: E; seat: Seat; region: number }

function rig(): Rig {
  const h = new Harness(9100);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const g = new E(structuredClone(h.state) as GameState);
  return { g, seat, region: g.homeRegion(seat) };
}

function ctxFor(r: Rig, sourceName: string, targets: ResolvedTarget[], extra: object = {}): EffectCtx {
  return {
    controller: r.seat, sourceName, region: r.region, targets, x: 0, event: null,
    eraseSelf: () => {}, spawnUnder: () => {}, spawnWearing: () => {}, refundBudget: () => {},
    choose: (_k: string, dec: { options: { value: unknown }[] }) => dec.options[0]?.value,
    ...extra,
  } as unknown as EffectCtx;
}

/** run one effect SLOT (not one card) with nothing to aim at, and report what
 * it did. `extra` supplies whatever else that slot needs to reach its target
 * dereference — Wildfire's X, Sacrificial Burst's cost receipt. */
function starve(key: string, extra: object = {}): { threw: Error | null; log: string[] } {
  const r = rig();
  const card = key.slice(key.indexOf(':') + 1).split('#')[0]!;
  const before = r.g.events.length;
  let threw: Error | null = null;
  try { effectByKey(key).run(r.g, ctxFor(r, card, [], extra)); } catch (e) { threw = e as Error; }
  return { threw, log: r.g.events.slice(before).map(e => e.msg) };
}

/**
 * THE ASSERTION, both halves of R223 at once. A case that only checked "does
 * not throw" would pass on a silent `return`, which is the outcome the owner
 * explicitly ruled out ("Not silently").
 */
function assertFizzlesAndSays(key: string, extra: object = {}): void {
  const { threw, log } = starve(key, extra);
  assert.equal(threw, null,
    `${key} THREW with no target instead of fizzling: ${threw?.message}`);
  const said = log.filter(m => FIZZLE_LINE.test(m));
  assert.equal(said.length, 1,
    `${key} did not say why nothing happened (R223: "Fizzle, and say so in the log"). `
    + `Its log was: ${log.length ? log.join(' | ') : '(empty)'}`);
  const card = key.slice(key.indexOf(':') + 1).split('#')[0]!;
  assert.ok(said[0]!.startsWith(`${card}:`),
    `${key}'s fizzle line does not name the card the player is looking at: ${said[0]}`);
}

// ── 1. the eleven-slot `dealToAnyTarget` family (registry.ts) ─────────
//
// One shared factory, so one fix — but each member is named here, because a
// later round that inlines any of them must redden this file, not slip past it.

for (const key of [
  'spell:Flame of History',
  'spell:All-Consuming Blaze',
  'spell:Arc Lightning',
]) {
  test(`R227 ${key}: no target → fizzles and logs`, () => assertFizzlesAndSays(key));
}

// ── 2. CT-89's two named cards, which were only ever the visible half ──

test('R227 spell:Luminous Arc: no target → fizzles and logs (CT-89 #1)', () => {
  assertFizzlesAndSays('spell:Luminous Arc');
});

test('R227 spell:Dreadwave Devourer: no target → fizzles and logs (CT-89 #2)', () => {
  // its old body was `'stack' in (t as object)` — the `in` operator on
  // `undefined`, which is the TypeError the ticket quoted.
  assertFizzlesAndSays('spell:Dreadwave Devourer');
});

// ── 3. ⚠ BOTH MULTI-ROUTE CARDS, BOTH ROUTES EACH ─────────────────────
//
// The part a name-keyed fix gets wrong. Each of these pairs is ONE EffectDef
// object reached down two different slots, and the test asserts that identity
// as well as the behaviour: if a later round splits them into two defs, the
// identity assertion fails and whoever split them has to guard both.

test('R227 Sacrificial Burst: BOTH routes fizzle — spell and graft are one EffectDef', () => {
  assert.equal(effectByKey('spell:Sacrificial Burst'), effectByKey('graft:Sacrificial Burst'),
    'Sacrificial Burst\'s spell and graft rider are no longer the same EffectDef — '
    + 'both routes now need their own R227 guard');
  const paid = { costPaid: { sacrificed: { card: 'Tidal Menace' as CardName, power: 2, defense: 2 } } };
  assertFizzlesAndSays('spell:Sacrificial Burst', paid);
  assertFizzlesAndSays('graft:Sacrificial Burst', paid);
});

test('R227 Rune Channeler: BOTH routes fizzle — ability #0 and graft are one EffectDef', () => {
  assert.equal(effectByKey('ability:Rune Channeler#0'), effectByKey('graft:Rune Channeler'),
    'Rune Channeler\'s triggered ability and graft rider are no longer the same EffectDef — '
    + 'both routes now need their own R227 guard');
  assertFizzlesAndSays('ability:Rune Channeler#0');
  assertFizzlesAndSays('graft:Rune Channeler');
});

// ── 4. the remaining route shapes: spell-token, X-spell, augment ──────

test('R227 spell:Fireball: a spell TOKEN with no target fizzles and logs', () => {
  // the route matters: a Fireball is created by other cards and resolves as a
  // spellToken, so its target can go stale in a window nobody chose.
  assertFizzlesAndSays('spell:Fireball', { x: 3 });
});

test('R227 spell:Wildfire: X is paid and there is still no target', () => {
  // ⚠ ordering: Wildfire's `x <= 0` branch returns FIRST, so a starved run with
  // X=0 never reaches the dereference at all. X is forced positive here on
  // purpose — otherwise this test would pass against the unfixed card.
  assertFizzlesAndSays('spell:Wildfire', { x: 4 });
  const { log } = starve('spell:Wildfire', { x: 0 });
  assert.ok(log.some(m => /X = 0/.test(m)), 'the X = 0 branch stopped announcing itself');
});

test('R227 spell:Seismomancy: no target → fizzles and logs', () => {
  assertFizzlesAndSays('spell:Seismomancy');
});

test('R227 augment:Voltwrath Behemoth#0: donated [Augment] text fizzles and logs', () => {
  assertFizzlesAndSays('augment:Voltwrath Behemoth#0');
});

test('R227 augment:Throwing Boulder#0: an activated augment fizzles and logs', () => {
  // its carrier is already in the bin by the time this runs (the sacrifice was
  // the cost), so there is nothing to fall back on but the log line.
  assertFizzlesAndSays('augment:Throwing Boulder#0');
});

// ── 5. the three sites the DRIVE could not convict ────────────────────
//
// Fixed under the same ruling and named here for the same reason: they are the
// evidence that the sweep alone is not the whole guard.

test('R227 spell:Jelly: silence was the old failure mode, not a crash', () => {
  // Jelly read `ctx.targets[0]!` and then asked `isEnt(t)`, which is null-safe
  // — so with no target it completed, did nothing and SAID nothing. R223 rules
  // that out as explicitly as it rules out the throw.
  assertFizzlesAndSays('spell:Jelly');
});

test('R227 Leaping Lillik: BOTH routes of the shared `deleteUnit` def fizzle', () => {
  assert.equal(effectByKey('spell:Leaping Lillik'), effectByKey('graft:Leaping Lillik'));
  assertFizzlesAndSays('spell:Leaping Lillik');
  assertFizzlesAndSays('graft:Leaping Lillik');
});

test('R227 Burning Vengeance: the site the drive CANNOT reach', () => {
  // ⚠ THE REASON THE SOURCE SCAN EXISTS. Its dereference sits behind
  // `if (deaths <= 0) return`, and no board 65's rig builds has a battle death
  // on it, so the empty-targets drive convicted every other member of this
  // class and walked past this one. It was found by the source scan.
  //
  // With no deaths the card takes its own announced early return, which is
  // correct and must stay — so the guard is asserted with the counter bumped.
  const r = rig();
  r.g.bumpBattleCounter(r.region, 'allyDeaths:0', 1);
  assert.equal(r.g.battleCounter(r.region, 'allyDeaths:0'), 1,
    'the counter did not take — this case would be testing the early return, not the guard');
  const before = r.g.events.length;
  let threw: Error | null = null;
  try {
    effectByKey('spell:Burning Vengeance').run(r.g, ctxFor(r, 'Burning Vengeance', []));
  } catch (e) { threw = e as Error; }
  const log = r.g.events.slice(before).map(e => e.msg);
  assert.equal(threw, null, `Burning Vengeance threw with no target: ${threw?.message}`);
  assert.ok(log.some(m => FIZZLE_LINE.test(m)),
    `Burning Vengeance resolved into silence with no target. Log: ${log.join(' | ')}`);
  assert.ok(!log.some(m => /no unit has died/.test(m)),
    'this case took the `deaths <= 0` early return, so it never reached the guard it is for');
});

// ── 6. ⚠ THE OTHER DIRECTION: the guard must not have eaten the card ──
//
// Every assertion above is satisfied by `run: () => {}`. These are the ones
// that are not: a target IS supplied and the printed effect must still land.

function withTarget(key: string, sourceName: string, extra: object = {}): { victim: Entity; g: E } {
  const h = new Harness(9100);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, 'Tidal Menace');
  const g = new E(h.state);
  const victim = g.entity(id)!;
  effectByKey(key).run(g, ctxFor({ g, seat, region: g.homeRegion(seat) }, sourceName, [victim], extra));
  return { victim: g.entity(id) ?? victim, g };
}

test('R227 regression: Luminous Arc still deals 6 when it HAS a target', () => {
  const { victim, g } = withTarget('spell:Luminous Arc', 'Luminous Arc');
  const dead = !g.entity(victim.id);
  assert.ok(dead || (victim.damage ?? 0) >= 6,
    `Luminous Arc no longer damages its target — the R227 guard swallowed the effect. `
    + `damage=${victim.damage}, alive=${!dead}`);
  assert.ok(!g.events.some(e => FIZZLE_LINE.test(e.msg)),
    'Luminous Arc logged a fizzle while holding a perfectly good target');
});

test('R227 regression: the dealToAnyTarget family still deals when it HAS a target', () => {
  for (const [key, name] of [
    ['spell:Arc Lightning', 'Arc Lightning'],
    ['spell:Flame of History', 'Flame of History'],
    ['graft:Rune Channeler', 'Rune Channeler'],
  ] as const) {
    const { victim, g } = withTarget(key, name);
    const dead = !g.entity(victim.id);
    assert.ok(dead || (victim.damage ?? 0) > 0, `${key} dealt no damage to a live target`);
    assert.ok(!g.events.some(e => FIZZLE_LINE.test(e.msg)), `${key} fizzled with a target in hand`);
  }
});

test('R227 regression: Leaping Lillik still deletes the unit it is given', () => {
  const { victim, g } = withTarget('spell:Leaping Lillik', 'Leaping Lillik');
  assert.equal(g.entity(victim.id), undefined,
    'Leaping Lillik no longer deletes its target — the R227 guard swallowed the effect');
});

test('R227 regression: Jelly still applies -2/-2 to the unit it is given', () => {
  // Tidal Menace is a 2/2, so -2/-2 kills it and there is no entity left to
  // read the stat off — the `statChanged` receipt is the durable evidence.
  const { g } = withTarget('spell:Jelly', 'Jelly');
  const stat = g.events.find(e => e.type === 'statChanged');
  assert.ok(stat, `Jelly no longer changes its target's stats. Log: ${g.events.map(e => e.msg).join(' | ')}`);
  assert.equal(stat.data?.dp, -2, 'Jelly no longer applies its -2 power');
  assert.equal(stat.data?.dt, -2, 'Jelly no longer applies its -2 defense');
  assert.ok(!g.events.some(e => FIZZLE_LINE.test(e.msg)), 'Jelly fizzled with a target in hand');
});

// ── 7. the helper's own contract ──────────────────────────────────────

test('R227: the fizzle wording lives in ONE place, so it cannot drift', () => {
  // every card above is asserted against the SAME regex, and the regex matches
  // what `firstTarget` emits. This is the assertion that the sentence is
  // single-sourced: if two cards ever said it differently, one of the cases
  // above would already have failed.
  const keys = [
    'spell:Luminous Arc', 'spell:Dreadwave Devourer', 'spell:Seismomancy',
    'graft:Sacrificial Burst', 'ability:Rune Channeler#0', 'augment:Voltwrath Behemoth#0',
  ];
  const paid = { costPaid: { sacrificed: { card: 'Tidal Menace' as CardName, power: 2, defense: 2 } } };
  const lines = new Set<string>();
  const mute: string[] = [];
  for (const k of keys) {
    const card = k.slice(k.indexOf(':') + 1).split('#')[0]!;
    const said = starve(k, paid).log.filter(m => FIZZLE_LINE.test(m));
    if (!said.length) mute.push(k);
    for (const m of said) lines.add(m.slice(card.length));
  }
  // without this, a card that stopped using the helper entirely would simply
  // contribute NOTHING to the set and the equality below would still pass —
  // "all the cards that agree, agree", which is not a test.
  assert.deepEqual(mute, [],
    `these routes did not emit the shared line at all, so they cannot be said to agree with it: `
    + `${mute.join(', ')}`);
  assert.equal(lines.size, 1,
    `the "no legal target" line is worded ${lines.size} different ways across the pool — `
    + `it must come from \`firstTarget\` and nowhere else:\n  ${[...lines].join('\n  ')}`);
});

test('R227: a PLAYER target is not mistaken for an absent one', () => {
  // `firstTarget` returns the element and the caller tests it for truth, so the
  // helper is only correct while every ResolvedTarget shape is an object. The
  // shape most likely to break that is `{ player: 0 }` — seat 0 is falsy, and a
  // helper that read the SEAT instead of the ref would report "no target" about
  // the opponent's own player target. Driven through a real card that accepts
  // one, so this is behaviour and not a type-level opinion.
  const r = rig();
  const player = { player: (1 - r.seat) as Seat } as ResolvedTarget;
  assert.ok(!isEntityTarget(player), 'a player ref must not read as an entity');
  const before = r.g.events.length;
  effectByKey('spell:Arc Lightning').run(r.g, ctxFor(r, 'Arc Lightning', [player]));
  const log = r.g.events.slice(before).map(e => e.msg);
  assert.ok(!log.some(m => FIZZLE_LINE.test(m)),
    `Arc Lightning reported "no legal target" while aimed at a player: ${log.join(' | ')}`);
  assert.ok(log.length > 0, 'aiming Arc Lightning at a player did nothing at all');
});
