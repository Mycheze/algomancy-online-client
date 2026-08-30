/**
 * "EACH OPPONENT" IN A REGION THAT HOLDS NOBODY ELSE — CARD-TODO #70 / R187.
 *
 * R25 scopes an effect to its region. Nine effects read the region's
 * `presentSeats` to find "each opponent", and a HOME region out of battle
 * lists only its owner — so the loop runs zero times, the effect resolves,
 * and the log said NOTHING. The player was told neither what happened nor why
 * it did not.
 *
 * ⚠ THE LOOP IS NOT THE BUG. The region genuinely holds nobody else and the
 * effect genuinely does nothing; "nothing happened" is a legitimate outcome
 * here and no card in this file was made to reach a seat that is not present.
 * Not SAYING so is the bug, and that is the only thing repaired.
 *
 * `85-silent-branches` §9 made exactly this repair for the three the old fuzz
 * happened to reach — Restitution, Vroot and Flzzz. R182's deterministic drive
 * then reached the whole registry and found the rest of the family sitting in
 * `65-effect-conformance`'s `SILENT_KNOWN`, thirteen labels of it (nine
 * EffectDefs, four of them reached twice because the ability/spell and the
 * graft rider are the SAME object). This file is the per-card regression net
 * for all nine, plus the near neighbour that travelled with them.
 *
 * ⚠ R209 / CARD-TODO #74: **the family now lives HERE and only here.** 85's §9
 * three have been moved into §11 below. They were split across two files whose
 * class tests each claimed the two lists were disjoint, which meant that when
 * the family next grew, neither file owned it — the exact failure mode
 * docs/13-assessment.md §4 keeps naming. §13's count is the guard on that.
 *
 * ── ITS SIBLING FILE, AND WHERE THE LINE BETWEEN THEM IS
 *
 * `test/179-empty-collection-branches.test.ts` (CT-74/CT-81b) watches the
 * OTHER cause of the same player-facing defect: the opponent IS present, and
 * every present seat has nothing to give, so the collection comes back empty.
 * Same silence, different reason, twelve more cards. §13 asserts the two lists
 * stay disjoint so that each card has exactly one owner.
 *
 * WHAT EACH TEST ASSERTS, IN ORDER
 *
 *   1. the PRECONDITION — the effect's region really does hold no opponent,
 *      so the test is aimed at the situation it claims to be aimed at;
 *   2. the opponent really did have something to lose (life, a hand, a unit,
 *      a bin) somewhere else, so a silent pass is not silence about a board
 *      that was empty anyway;
 *   3. the effect SPOKE — at least one event, carrying a non-empty message;
 *   4. and the guard really was a guard: the board did not move.
 *
 * NEVER THE PROSE. A test that greps a sentence gets deleted the first time
 * somebody improves the sentence, and then the branch is unguarded again —
 * the same house rule as 85-silent-branches. The CARD and its PRINTED CLAUSE
 * are named in every assertion message instead, so a failure says which card
 * went quiet and about which line of its text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { effectsOf } from '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { spawn, toDeployment } from './util.ts';
import type { EngineEvent, Seat } from '../src/types.ts';

// ── the rig ─────────────────────────────────────────────────────────────

interface Board { g: E; A: Seat; D: Seat; region: number }

/**
 * A real game walked to deployment, with a body on each side.
 *
 * Deployment is the ordinary out-of-battle shape: `regions` is
 * `[{owner:0,presentSeats:[0]},{owner:1,presentSeats:[1]}]`, so seat A's home
 * region holds A and nobody else while D sits in D's own region with a unit,
 * a full hand and his life total intact. That is precisely the situation R25
 * produces and the one the whole family used to resolve into silence in.
 */
function board(seed: number): Board {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  spawn(h, A, 'Tidal Menace');
  spawn(h, D, 'The Foretold');
  const g = new E(h.state);
  return { g, A, D, region: g.homeRegion(A) };
}

/** Resolve one EffectDef in A's home region and return the events IT emitted. */
function resolve(
  def: EffectDef, b: Board, ctx: Partial<EffectCtx> = {},
): EngineEvent[] {
  const before = b.g.events.length;
  def.run(b.g, {
    sourceName: 'test',
    controller: b.A,
    region: b.region,
    targets: [],
    event: null,
    choose: (_key, dec) => dec.options[0]!.value,
    ...ctx,
  } as EffectCtx);
  return b.g.events.slice(before);
}

const spellOf = (card: string): EffectDef => getCard(card).spellEffect!;
const abilityOf = (card: string, i = 0): EffectDef => getCard(card).abilities![i]!.effect;
const augmentOf = (card: string, i = 0): EffectDef => getCard(card).augmentText![i]!.effect;

/**
 * The precondition, as an assertion: this really is "a region holding nobody
 * else". If the rig ever stopped producing it, every test below would pass for
 * the wrong reason — the loop would run, something would happen, and an event
 * would be emitted by the payload rather than by the guard.
 */
function assertNoOpponentPresent(b: Board, card: string): void {
  const others = b.g.s.regions[b.region]!.presentSeats.filter(s => s !== b.A);
  assert.deepEqual(others, [],
    `${card}: the rig is supposed to put the effect in a region that holds NOBODY but its `
    + 'controller (R25) — with an opponent present the payload runs and this test proves nothing');
}

/** the whole point, in one line: the player was TOLD. */
function assertSpoke(evs: EngineEvent[], card: string, clause: string): void {
  assert.ok(evs.length > 0,
    `${card}: "${clause}" resolved in a region holding no opponent (R25) and emitted NOTHING. `
    + 'The player watches the effect leave the stack with no indication of what it did or why '
    + "it did not — add a g.ev('info', …) saying the region held no opponent before that return. "
    + '"Nothing happened" is a legitimate outcome; not SAYING so never is.');
  assert.ok(evs.some(e => e.msg.length > 0),
    `${card}: "${clause}" emitted ${evs.length} event(s) but not one of them carries a message, `
    + 'so nothing reaches the log and the player still cannot tell a rule from a bug');
}

// ── 1. Bloated Manablub ────────────────────────────────────────────────
// "When I despawn, [Switch1] Each opponent loses 3 life."

test('Bloated Manablub — "Each opponent loses 3 life" in a region holding no opponent says so and takes no life', () => {
  const b = board(8710);
  assertNoOpponentPresent(b, 'Bloated Manablub');
  const life = b.g.s.players.map(p => p.life);
  assert.ok(life[b.D]! > 3, 'Bloated Manablub: the opponent has life to lose — a no-op here is R25, not exhaustion');
  const evs = resolve(abilityOf('Bloated Manablub'), b, {
    sourceName: 'Bloated Manablub',
    event: { type: 'died', msg: '', data: {} },
  });
  assertSpoke(evs, 'Bloated Manablub', 'Each opponent loses 3 life');
  assert.deepEqual(b.g.s.players.map(p => p.life), life,
    'Bloated Manablub: "Each opponent loses 3 life" must NOT reach a seat that is not in the '
    + 'region (R25) — the repair is the announcement, never making the loop run');
});

// ── 2. Blightmound ─────────────────────────────────────────────────────
// "When I deal combat damage or die, [Switch1] Each opponent gains 1 rot."

test('Blightmound — "Each opponent gains 1 rot" in a region holding no opponent says so and gives no rot', () => {
  const b = board(8711);
  assertNoOpponentPresent(b, 'Blightmound');
  const rot = b.g.s.players.map(p => p.rot ?? 0);
  const evs = resolve(abilityOf('Blightmound'), b, {
    sourceName: 'Blightmound',
    event: { type: 'died', msg: '', data: {} },
  });
  assertSpoke(evs, 'Blightmound', 'Each opponent gains 1 rot');
  assert.deepEqual(b.g.s.players.map(p => p.rot ?? 0), rot,
    'Blightmound: "Each opponent gains 1 rot" must not reach a seat outside the region (R25)');
});

// ── 3. Linked Extinction ───────────────────────────────────────────────
// "[Switch1] /[Sacrifice a unit]: Each opponent sacrifices a unit."
//
// ⚠ Its DECLINED-COST branch already announced itself; the opponent loop
// below it did not. So the cost is PAID here on purpose — a test that let the
// cost lapse would be re-testing the branch that was never broken.

test('Linked Extinction — "Each opponent sacrifices a unit" with the cost PAID and no opponent in the region says so and destroys nothing', () => {
  const b = board(8712);
  assertNoOpponentPresent(b, 'Linked Extinction');
  const theirs = b.g.unitsOf(b.D, b.g.homeRegion(b.D));
  assert.ok(theirs.length > 0,
    'Linked Extinction: the opponent has a unit — in his OWN region, which R25 puts out of reach');
  const before = Object.keys(b.g.s.entities).length;
  const evs = resolve(spellOf('Linked Extinction'), b, {
    sourceName: 'Linked Extinction',
    costPaid: { sacrificed: { card: 'Tidal Menace', power: 1, defense: 1 } },
  });
  assertSpoke(evs, 'Linked Extinction', 'Each opponent sacrifices a unit');
  assert.equal(Object.keys(b.g.s.entities).length, before,
    'Linked Extinction: "Each opponent sacrifices a unit" is region-scoped (R25) — a unit '
    + 'standing in the opponent\'s own region is not one this spell may reach');
});

// ── 4. Void Memory ─────────────────────────────────────────────────────
// "[Switch1] Each opponent discards a unit or spell if able. Otherwise, they
// reveal their hand."
//
// ⚠ Its own comment CITED R25 for this exact case and it still said nothing
// when the case arrived.

test('Void Memory — "Each opponent discards a unit or spell" in a region holding no opponent says so and touches no hand', () => {
  const b = board(8713);
  assertNoOpponentPresent(b, 'Void Memory');
  const hands = b.g.s.players.map(p => p.hand.length);
  assert.ok(hands[b.D]! > 0,
    'Void Memory: the opponent HAS a hand, so silence here cannot be blamed on an empty one — '
    + 'the empty-hand case already announced itself and is not what this test is about');
  const evs = resolve(spellOf('Void Memory'), b, { sourceName: 'Void Memory' });
  assertSpoke(evs, 'Void Memory', 'Each opponent discards a unit or spell if able');
  assert.deepEqual(b.g.s.players.map(p => p.hand.length), hands,
    'Void Memory: "each opponent" is the region\'s present seats (R25) and a seat that is not '
    + 'there neither discards nor reveals');
});

// ── 5. Growing Plague ──────────────────────────────────────────────────
// "[Augment] When I despawn, each other player draws two cards."

test('Growing Plague — "each other player draws two cards" in a region holding no other player says so and draws nothing', () => {
  const b = board(8714);
  assertNoOpponentPresent(b, 'Growing Plague');
  const hands = b.g.s.players.map(p => p.hand.length);
  const decks = b.g.s.players.map(p => b.g.deckOf(p.seat).length);
  assert.ok(decks[b.D]! >= 2,
    'Growing Plague: the other player has cards left to draw — a no-op here is R25, not an empty deck');
  const evs = resolve(augmentOf('Growing Plague'), b, {
    sourceName: 'Growing Plague',
    event: { type: 'despawned', msg: '', data: {} },
  });
  assertSpoke(evs, 'Growing Plague', 'each other player draws two cards');
  assert.deepEqual(b.g.s.players.map(p => p.hand.length), hands,
    'Growing Plague: "each other player" is region-scoped (R25) — nobody outside the region draws');
  assert.deepEqual(b.g.s.players.map(p => b.g.deckOf(p.seat).length), decks,
    'Growing Plague: and no deck was touched either');
});

// ── 6. Malicious Hardware ──────────────────────────────────────────────
// "[Augment] Whenever one of your units dies, each opponent sacrifices a unit."

test('Malicious Hardware — "each opponent sacrifices a unit" in a region holding no opponent says so and destroys nothing', () => {
  const b = board(8715);
  assertNoOpponentPresent(b, 'Malicious Hardware');
  const before = Object.keys(b.g.s.entities).length;
  const evs = resolve(augmentOf('Malicious Hardware'), b, {
    sourceName: 'Malicious Hardware',
    event: { type: 'died', msg: '', data: { seat: b.A } },
  });
  assertSpoke(evs, 'Malicious Hardware', 'each opponent sacrifices a unit');
  assert.equal(Object.keys(b.g.s.entities).length, before,
    'Malicious Hardware: "each opponent sacrifices a unit" reaches only seats present in the '
    + 'effect\'s region (R25) — nothing on the board may move');
});

// ── 7. Pestilent Mycelion ──────────────────────────────────────────────
// "[Augment] Whenever one or more -1/-1 counters land on a unit, each
// opponent loses 1 life."

test('Pestilent Mycelion — "each opponent loses 1 life" in a region holding no opponent says so and takes no life', () => {
  const b = board(8716);
  assertNoOpponentPresent(b, 'Pestilent Mycelion');
  const life = b.g.s.players.map(p => p.life);
  const evs = resolve(augmentOf('Pestilent Mycelion'), b, {
    sourceName: 'Pestilent Mycelion',
    event: { type: 'countersChanged', msg: '', data: { n: -1 } },
  });
  assertSpoke(evs, 'Pestilent Mycelion', 'each opponent loses 1 life');
  assert.deepEqual(b.g.s.players.map(p => p.life), life,
    'Pestilent Mycelion: "each opponent" is the region\'s present seats (R25) and nobody else loses life');
});

// ── 8. Rotwall ─────────────────────────────────────────────────────────
// "[Augment] Whenever I am dealt damage, each opponent gains a rot."

test('Rotwall — "each opponent gains a rot" in a region holding no opponent says so and gives no rot', () => {
  const b = board(8717);
  assertNoOpponentPresent(b, 'Rotwall');
  const rot = b.g.s.players.map(p => p.rot ?? 0);
  const evs = resolve(augmentOf('Rotwall'), b, {
    sourceName: 'Rotwall',
    event: { type: 'damage', msg: '', data: { n: 3 } },
  });
  assertSpoke(evs, 'Rotwall', 'each opponent gains a rot');
  assert.deepEqual(b.g.s.players.map(p => p.rot ?? 0), rot,
    'Rotwall: `opponentsIn` yields nobody in a home region (R25) and no rot may be handed out');
});

// ── 9. Verdant Necrophage ──────────────────────────────────────────────
// "[Augment] When I despawn, each opponent recalls a unit from their bin."
//
// ⚠ Its per-opponent branch already announced an EMPTY BIN; the loop above it
// did not announce having nobody to walk. So the opponent's bin is stocked
// here on purpose, to keep the two apart.

test('Verdant Necrophage — "each opponent recalls a unit from their bin" in a region holding no opponent says so and moves no card', () => {
  const b = board(8718);
  assertNoOpponentPresent(b, 'Verdant Necrophage');
  b.g.player(b.D).bin.push('Tidal Menace');
  const bins = b.g.s.players.map(p => p.bin.join(','));
  const hands = b.g.s.players.map(p => p.hand.length);
  assert.ok(b.g.player(b.D).bin.length > 0,
    'Verdant Necrophage: the opponent HAS a unit in his bin, so this test is about the empty '
    + 'LOOP and not about the empty-bin branch, which already announced itself');
  const evs = resolve(augmentOf('Verdant Necrophage'), b, {
    sourceName: 'Verdant Necrophage',
    event: { type: 'died', msg: '', data: {} },
  });
  assertSpoke(evs, 'Verdant Necrophage', 'each opponent recalls a unit from their bin');
  assert.deepEqual(b.g.s.players.map(p => p.bin.join(',')), bins,
    'Verdant Necrophage: a seat that is not in the region recalls nothing (R25) — his bin is untouched');
  assert.deepEqual(b.g.s.players.map(p => p.hand.length), hands,
    'Verdant Necrophage: and nothing arrived in anybody\'s hand');
});

// ── 10. Stellarspore Harvester — the near neighbour ────────────────────
// "[Augment] When I die, give each of your units with a -1/-1 counter on it
// to target opponent."
//
// NOT the R25 shape: the opponent is a TARGET and is really there. The
// quantity — "each of your units with a -1/-1 counter" — is counted at
// RESOLUTION (R157 §15 / R161) and may be none, and none used to be silent.
// It travelled off `SILENT_KNOWN` with the family, so it is watched with them.

test('Stellarspore Harvester — "each of your units with a -1/-1 counter" counting zero says so and hands over nothing', () => {
  const b = board(8719);
  const mine = b.g.unitsOf(b.A, b.region);
  assert.ok(mine.length > 0 && mine.every(u => u.counters >= 0),
    'Stellarspore Harvester: the controller HAS units here and none of them carries a -1/-1 '
    + 'counter — that is the zero count this test is about, not an empty board');
  const evs = resolve(augmentOf('Stellarspore Harvester'), b, {
    sourceName: 'Stellarspore Harvester',
    targets: [{ player: b.D }],
    event: { type: 'died', msg: '', data: {} },
  } as Partial<EffectCtx>);
  assertSpoke(evs, 'Stellarspore Harvester',
    'give each of your units with a -1/-1 counter on it to target opponent');
  assert.ok(b.g.unitsOf(b.A, b.region).length === mine.length,
    'Stellarspore Harvester: a zero count gives nothing away — every unit is still the '
    + "controller's, and the target opponent received no gift he was never owed");
});

// ── 11. THE THREE THE OLD FUZZ REACHED (moved here from 85-silent-branches §9)
//
// R209 / CARD-TODO #74. These three were repaired FIRST — 85-silent-branches
// §9 fixed them because the old fuzz drive happened to walk into them — and
// the other ten arrived here later, which left one family split across two
// files with each file's class test claiming the lists were disjoint. Neither
// file owned the family, so the next member to appear would have been nobody's.
// They are the same defect, the same repair and the same board; they belong in
// one place, and this is it.
//
// Restitution and Vroot drain on DAMAGE, Flzzz on a LIFE GAIN — the events are
// what their own `when` reads, so each is handed the one it would really see.

const MOVED_FROM_85: [string, EffectDef, string, Partial<EffectCtx>][] = [
  ['Restitution', augmentOf('Restitution'), 'each opponent loses that much life',
    { event: { type: 'damage', msg: '', data: { n: 3 } } }],
  ['Vroot', augmentOf('Vroot'), 'each opponent loses that much life',
    { event: { type: 'damage', msg: '', data: { n: 3 } } }],
  ['Flzzz', augmentOf('Flzzz'), 'each opponent loses that much life',
    { event: { type: 'lifeGained', msg: '', data: { n: 3 } } }],
];

for (const [card, def, clause, extra] of MOVED_FROM_85) {
  test(`${card} — "${clause}" in a region holding no opponent says so and takes no life`, () => {
    const b = board(8590);
    assertNoOpponentPresent(b, card);
    const lives = b.g.s.players.map(p => p.life);
    assert.ok(lives[b.D]! > 3,
      `${card}: the opponent HAS life to lose — a no-op here is R25, not exhaustion`);
    const evs = resolve(def, b, { sourceName: card, ...extra });
    assertSpoke(evs, card, clause);
    assert.deepEqual(b.g.s.players.map(p => p.life), lives,
      `${card}: nobody gained or lost life — the repair is a line, not a branch`);
  });
}

// ── 12. THE GRAFT RIDER IS THE SAME OBJECT ──────────────────────────────

test('the four grafted R25 riders are the same EffectDef object the tests above drove', () => {
  // 65-effect-conformance labels a card's spell/ability and its graft rider
  // SEPARATELY, so the family was thirteen labels over nine effects. Four of
  // those thirteen are the second sighting of an object already covered above
  // — this is that claim as an assertion rather than as a hope, because if a
  // card ever stopped sharing the object the graft route would go unwatched.
  const shared: [string, EffectDef][] = [
    ['Bloated Manablub', abilityOf('Bloated Manablub')],
    ['Blightmound', abilityOf('Blightmound')],
    ['Linked Extinction', spellOf('Linked Extinction')],
    ['Void Memory', spellOf('Void Memory')],
  ];
  for (const [card, def] of shared) {
    const rider = getCard(card).graftEffect;
    assert.ok(rider, `${card}: the graft rider is gone — 65's graft:${card} label went with it`);
    assert.equal(rider.effect, def,
      `${card}: the graft rider used to BE the same EffectDef as the card's own text, which is `
      + `why one repair covered both labels. It is a different object now, so graft:${card} `
      + 'needs its own "no opponent in the region" test in this file.');
  }
});

// ── 13. THE CLASS ITSELF ────────────────────────────────────────────────

test('every card repaired for CARD-TODO #70 is one the whole-pool sweeps also watch', () => {
  // 65-effect-conformance drives every EffectDef in the registry and 81-card-drill
  // drives the real action path; both fail on a run that completes without
  // emitting. This file reaches the ONE situation neither of their board states
  // arranges. The nets have to be aimed at the same cards, or a fix here can rot
  // without the sweeps noticing. (Same house rule as 85-silent-branches §11.)
  const fixed = [
    'Bloated Manablub', 'Blightmound', 'Linked Extinction', 'Void Memory',
    'Growing Plague', 'Malicious Hardware', 'Pestilent Mycelion', 'Rotwall',
    'Verdant Necrophage', 'Stellarspore Harvester',
    // R209/CT-74: moved here from 85-silent-branches §9 so the family has ONE
    // owner. 85's own class test no longer claims them.
    ...MOVED_FROM_85.map(([c]) => c),
  ];
  assert.equal(fixed.length, 13,
    'the whole R25 family lives in THIS file now — ten from R187 plus the three 85-silent-branches '
    + '§9 reached first. If the family grows, it grows here.');
  const missing = fixed.filter(c => effectsOf(c).length === 0);
  assert.deepEqual(missing, [],
    'these cards carry no EffectDef the registry can see, so the whole-pool sweeps cannot watch them');
});

// ── 14. R239's THREE, AND WHERE THE LINE BETWEEN THE FILES IS ───────────
//
// R239 (owner, 2026-08-28): "Only players that are in the region as an effect
// can even see that it exists. So anything that happens in a region where a
// player or unit currently isn't is 100% ignored, as if that effect didn't
// exist." Same ruling as this whole file — a DIFFERENT failure.
//
// Every card above went QUIET: its loop ran zero times, nothing happened, and
// nothing was said. Three others did the opposite: Uglk, Big Glimpse Card and
// Rebalance NAMED an opponent rather than looping over one, and produced that
// opponent by arithmetic (`?? (1 - seat)`, and in Rebalance's case a bare
// `(1 - seat)` that never consulted the region at all). They REACHED a seat R25
// says is not there.
//
// Their per-card regression net is `208-region-scoping-is-absolute.test.ts`,
// which also carries the whole-pool SOURCE SWEEP for the shape. This section is
// the boundary marker the 179/158 split taught us to write down: two files, one
// ruling, and each card owned by exactly one of them.

const R239_REACHED = ['Uglk', 'Big Glimpse Card', 'Rebalance'];

test('R239: the three cards that REACHED an absent seat are 208\'s, not this file\'s', () => {
  const fixedHere = [
    'Bloated Manablub', 'Blightmound', 'Linked Extinction', 'Void Memory',
    'Growing Plague', 'Malicious Hardware', 'Pestilent Mycelion', 'Rotwall',
    'Verdant Necrophage', 'Stellarspore Harvester',
    ...MOVED_FROM_85.map(([c]) => c),
  ];
  const overlap = R239_REACHED.filter(c => fixedHere.includes(c));
  assert.deepEqual(overlap, [],
    'a card is watched by BOTH files, which is how the 85/158 split produced a family nobody '
    + 'owned. Pick one owner: 158 watches "the loop ran zero times and said nothing", 208 '
    + 'watches "the effect reached a seat that was not in the region".');
  const invisible = R239_REACHED.filter(c => effectsOf(c).length === 0);
  assert.deepEqual(invisible, [],
    'these carry no EffectDef the registry can see, so 65-effect-conformance and 81-card-drill '
    + 'cannot watch them either and 208 would be their only net');
});
