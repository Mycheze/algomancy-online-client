/* R303 — A CACHED CARD'S MOD VERBS ARE GATED LIKE ITS PLAY VERB.
 *
 * Reported in Discord, 2026-09-20: *"once a card expires after being glimpsed
 * … you're still able to graft with it on future turns (and probably augment
 * too). On the turn its glimpsed, yeah for sure, but once the glimpse expires,
 * that card should be gone gone gone."*
 *
 * It was real and it was wider than the report. `doPlayCached` asked
 * `E.cachePermission` and refused without one; `doAugment`, `doGraft` and
 * `pushMods` never asked at all. The cache was a mod zone with no door on it:
 *
 *   · a glimpsed card you failed to play stayed a live graft FOREVER
 *   · so did a prophesied card whose condition was nowhere near met — the one
 *     case Caleb was asked about directly and answered "no you can't do that"
 *   · 340 of the 495 cards in the pool carry a graft symbol or an augment
 *     grant, so this was most of every glimpse in every game
 *
 * The price schedule the owner set (2026-09-20), and what each test below
 * pins:
 *
 *   PERMISSION      PLAY                       MOD
 *   prophecy ✓      free, ignores affinity     free, ignores affinity
 *   glimpse (live)  card's mana, no affinity   card's mana, no affinity
 *   expired/none    — refused —                — refused —
 *
 * Owner: *"Glimpse and Prophecy are not the same thing, but the Cache acts
 * like the hand when the condition is met … You can graft with glimpsed cards
 * and the written text of 'ignoring affinity' still holds true."*
 *
 * The two columns are deliberately the same column. Seeds: 3150-3199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { IllegalAction } from '../src/apply.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { ent, giveResources, skipHasteStep, spawn, withE as whiteBox } from './util.ts';
import type { Action, Seat } from '../src/types.ts';

// ── fixtures ──────────────────────────────────────────────────────────

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

/** a host that can be grafted onto (it needs its own graft cause) */
registerSynthetic(unit('T315 Host', 2, 2), {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true, graftCause: true,
    label: 'graft cause',
    effect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} graft cause fires.`); } },
  }],
});

/** THE card this ruling is about: both graftable and an augment, and printed
 * with EARTH pips its owner will never have. Off a glimpse it is usable
 * anyway ("ignoring affinity"); out of an expired one it is nothing. */
registerSynthetic(unit('T315 Rider', 1, 1, { cost: 'ee', mana: 2, augmentAttrs: ['Tough'] }), {
  graftEffect: { bounded: false, effect: { run: g => { g.ev('info', 'T315 Rider grafts.'); } } },
});

/** the same card WITHOUT pips. Test 1 needs one: with `T315 Rider` the
 * expired-glimpse case passes even with the gate removed, because the pips
 * alone make the mod unaffordable and the refusal comes from the price
 * instead of the permission. A test that cannot tell the two apart is not
 * guarding the ruling — this one is affordable from any zone, so the ONLY
 * thing that can refuse it is R303. */
registerSynthetic(unit('T315 Plain Rider', 1, 1, { cost: '', mana: 2, augmentAttrs: ['Tough'] }), {
  graftEffect: { bounded: false, effect: { run: g => { g.ev('info', 'T315 Plain Rider grafts.'); } } },
});

/** the same card with a banner, for the prophecy column */
registerSynthetic(unit('T315 Proph Rider', 1, 1, {
  cost: 'ee', mana: 2, augmentAttrs: ['Tough'],
  prophecy: { cost: '', mana: 1, condition: 'One Turn Passes' },
}), {
  graftEffect: { bounded: false, effect: { run: g => { g.ev('info', 'T315 Proph Rider grafts.'); } } },
});

/** a banner whose condition will not be met for four turns — the "no you
 * can't do that" case (Caleb 2024-12-03) */
registerSynthetic(unit('T315 Slow Prophet', 1, 1, {
  cost: '', mana: 2, augmentAttrs: ['Tough'],
  prophecy: { cost: '', mana: 1, condition: 'Four Turns Pass' },
}), {
  graftEffect: { bounded: false, effect: { run: g => { g.ev('info', 'T315 Slow Prophet grafts.'); } } },
});

const FILLER = 'T315 Filler';
registerSynthetic(unit(FILLER, 1, 1, { mana: 20 }), {});

// ── harness ───────────────────────────────────────────────────────────

/** 36-cache-prophecy's sterile(): empty hands, an inert deck, so nothing the
 * seed chose can reach an assertion. */
function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  return h;
}

function intoDeployment(h: Harness): void {
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
}

function endDeployment(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.phase === 'deploy' && h.state.deployDone && !h.state.deployDone[seat]) {
      h.do({ type: 'doneDeploying', seat });
    }
  }
}

/** one whole turn */
function nextTurnsDeployment(h: Harness): void {
  endDeployment(h);
  intoDeployment(h);
}

const cacheMods = (h: Harness, seat: Seat): Action[] => h.legal(seat).filter(a =>
  (a.type === 'augment' || a.type === 'graft') && a.from === 'cache');

/** glimpse the top card of `seat`'s deck into their cache, stamped live */
function glimpseTop(h: Harness, seat: Seat, name: string): void {
  h.q.deckOf(seat).unshift(name);
  whiteBox(h, e => { e.glimpse(seat, 1); });
}

// ── the report: an EXPIRED glimpse ────────────────────────────────────

test('R303: an expired glimpse is not a graft, not an augment, not anything', () => {
  const h = sterile(3150);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 6);
  glimpseTop(h, P, 'T315 Plain Rider');               // [2], NO pips — see the fixture
  const host = spawn(h, P, 'T315 Host');
  assert.equal(h.q.cachePermission(P, 0), 'glimpse');
  assert.equal(cacheMods(h, P).length > 0, true, 'on the glimpse turn: offered');

  nextTurnsDeployment(h);
  giveResources(h, P, 'fire', 6);
  assert.equal(h.q.cachePermission(P, 0), null, 'the window closed');
  assert.ok(h.q.canPayCard(P, 'T315 Plain Rider', { purpose: 'mod' }),
    'the normal mod price is affordable — so a refusal below can only be the PERMISSION');
  assert.deepEqual(cacheMods(h, P), [], 'and every mod offer closed with it');
  assert.throws(() => h.do({ type: 'graft', seat: P, from: 'cache', index: 0, hostId: host, position: 0 }),
    IllegalAction, 'the graft is refused, not merely unoffered');
  assert.throws(() => h.do({ type: 'augment', seat: P, from: 'cache', index: 0, hostId: host }),
    IllegalAction);
  assert.equal(h.state.players[P]!.cache!.length, 1, 'the card is still there — inert, not erased (R45)');
  assert.equal(ent(h, host)!.mods.length, 0, 'and nothing was attached');
});

// ── the glimpse turn: allowed, priced like the play ───────────────────

test('R303: a LIVE glimpse grafts for the card\'s mana, ignoring affinity', () => {
  const h = sterile(3151);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 6);                     // zero EARTH affinity
  glimpseTop(h, P, 'T315 Rider');                     // ee / [2]
  const host = spawn(h, P, 'T315 Host');
  assert.ok(!h.q.canPayCard(P, 'T315 Rider', { purpose: 'mod' }),
    'the affinity is unpayable, so this is the waiver and nothing else');
  const opt = h.legal(P).find(a => a.type === 'graft' && a.from === 'cache');
  assert.ok(opt, 'offered anyway — the glimpse ignores affinity for the MOD too');
  const mana = h.q.openMana(P);
  h.do(opt!);
  assert.equal(h.q.openMana(P), mana - 2, 'but the [2] mana is paid in full');
  assert.equal(ent(h, host)!.mods.length, 1);
  assert.equal(h.state.players[P]!.cache!.length, 0, 'and it left the cache');
});

test('R303: a live glimpse augments on the same terms', () => {
  const h = sterile(3152);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 6);
  glimpseTop(h, P, 'T315 Rider');
  const host = spawn(h, P, 'T315 Host');
  const opt = h.legal(P).find(a => a.type === 'augment' && a.from === 'cache');
  assert.ok(opt);
  const mana = h.q.openMana(P);
  h.do(opt!);
  assert.equal(h.q.openMana(P), mana - 2);
  assert.ok(h.q.ownAttrs(ent(h, host)!).has('Tough'), 'and the augment really applied');
});

test('R303: the glimpse waives the pips, NOT the mana — broke means refused', () => {
  const h = sterile(3153);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 1);                     // T315 Rider costs [2]
  glimpseTop(h, P, 'T315 Rider');
  spawn(h, P, 'T315 Host');
  assert.equal(h.q.cachePermission(P, 0), 'glimpse', 'permission is fine');
  assert.deepEqual(cacheMods(h, P), [], 'the mana is not');
});

// ── the prophecy column ───────────────────────────────────────────────

test('R303: an UNFULFILLED prophecy cannot be grafted — "no you can\'t do that"', () => {
  const h = sterile(3154);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 8);
  h.state.players[P]!.hand.push('T315 Slow Prophet');
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: 0 });
  const host = spawn(h, P, 'T315 Host');
  assert.equal(h.q.cachePermission(P, 0), null, 'four turns have not passed');
  assert.ok(h.q.canPayCard(P, 'T315 Slow Prophet', { purpose: 'mod' }),
    'the mod price is affordable — so what refuses it is the PERMISSION');
  assert.deepEqual(cacheMods(h, P), []);
  assert.throws(() => h.do({ type: 'graft', seat: P, from: 'cache', index: 0, hostId: host, position: 0 }),
    IllegalAction);
});

test('R303: a FULFILLED prophecy still grafts for free, affinity and all', () => {
  const h = sterile(3155);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 4);
  h.state.players[P]!.hand.push('T315 Proph Rider');
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: 0 });
  nextTurnsDeployment(h);                             // "One Turn Passes"
  const host = spawn(h, P, 'T315 Host');
  assert.equal(h.q.cachePermission(P, 0), 'prophecy');
  const mana = h.q.openMana(P);
  const opt = h.legal(P).find(a => a.type === 'graft' && a.from === 'cache');
  assert.ok(opt, 'still offered (R42, Caleb 2024-12-03)');
  h.do(opt!);
  assert.equal(h.q.openMana(P), mana, 'nothing paid — it was bought at the banner');
  assert.equal(ent(h, host)!.mods.length, 1);
});

// ── the seam ──────────────────────────────────────────────────────────

test('R303: legalActions and apply agree about every cache entry', () => {
  const h = sterile(3156);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 8);
  spawn(h, P, 'T315 Host');
  // one of each: live glimpse, unfulfilled banner, and an effect-cached card
  // with no permission at all
  glimpseTop(h, P, 'T315 Rider');
  h.state.players[P]!.hand.push('T315 Slow Prophet');
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: 0 });
  whiteBox(h, e => { e.cacheCard(P, 'T315 Plain Rider', 'effect'); });
  assert.deepEqual(
    [0, 1, 2].map(i => h.q.cachePermission(P, i)), ['glimpse', null, null],
    'the three permission states, in one cache');

  // every mod offered names index 0 and nothing else
  const offered = new Set(cacheMods(h, P).map(a => (a as { index: number }).index));
  assert.deepEqual([...offered], [0], 'only the live glimpse is offered');
  // and the two that are not offered are refused when asked for directly
  const host = h.q.unitsOf(P, h.q.homeRegion(P))[0]!.id;
  for (const index of [1, 2]) {
    assert.throws(() => h.do({ type: 'graft', seat: P, from: 'cache', index, hostId: host, position: 0 }),
      IllegalAction, `index ${index} is refused by apply too`);
  }
});

test('R303: hand and bin are untouched — they never needed a permission', () => {
  const h = sterile(3157);
  intoDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 8);
  const host = spawn(h, P, 'T315 Host');
  h.state.players[P]!.bin.push('T315 Slow Prophet');   // [2], no pips
  const opt = h.legal(P).find(a => a.type === 'graft' && a.from === 'bin');
  assert.ok(opt, 'a bin graft is still just a bin graft');
  const mana = h.q.openMana(P);
  h.do(opt!);
  assert.equal(h.q.openMana(P), mana - 2, 'paid in full, affinity and all');
  assert.equal(ent(h, host)!.mods.length, 1);
});
