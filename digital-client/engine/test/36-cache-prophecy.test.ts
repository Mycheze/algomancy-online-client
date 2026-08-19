/* Light & Dark engine wave B: the cache zone, prophecy and glimpse.
 *
 *  - R41 Cache: a fourth zone beside hand, bin and deck, holding cards PLUS
 *    per-card metadata. Public information (no redaction). A cached card stays
 *    cached; being cached is NOT permission to play it. Mods may be applied
 *    out of it, paying normally.
 *  - R42 Prophecy: a deployment-only action that caches a banner card for the
 *    banner's plain mana (no affinity). Once the condition is fulfilled the
 *    card may be played from cache FREE and affinity-free — but at normal
 *    timing, "as if it were in your hand". A fulfilled prophecy also makes a
 *    graft/augment of that card free.
 *  - R43 Conditions count FORWARD from the moment of prophesying, never
 *    backwards. The vocabulary is data-driven (PROPHECY_RULES) and an
 *    unrecognised condition fails safely and loudly.
 *  - R44 Fulfilment LATCHES: once met it stays met.
 *  - R45 Glimpse N: reveal N, cache exactly ONE of the glimpser's choice and
 *    recycle the other N-1 to the bottom of the deck. The cached card may be
 *    played until end of turn ignoring affinity but paying the mana. The
 *    permission expires; the card stays cached, inert.
 *  - R46 A unit cached from play sheds its mods to the bin (which, per wave
 *    A's R40, trashes them).
 *
 * No Light & Dark card is scripted yet — every primitive here is proven with
 * synthetic test cards, the way the suite already tests bare mechanics.
 * Seeds: 3600-3699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended, normalizeProphecy } from '../src/engine.ts';
import { IllegalAction, replay } from '../src/apply.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import {
  ent, give, giveResources, skipHasteStep, spawn, toDeployment,
} from './util.ts';
import type { CachedCard, EngineEvent, Seat } from '../src/types.ts';

// ── synthetic test cards ──────────────────────────────────────────────

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

/** the workhorse: a [6] unit with EARTH pips that can be prophesied for [2].
 * The mismatch is deliberate — releasing it from cache must work with neither
 * 6 mana nor any earth affinity, which is what "for free also ignores
 * affinity" (R42) means. */
registerSynthetic(unit('Test Prophet', 4, 4, {
  cost: 'ee', mana: 6, prophecy: { mana: 2, condition: 'One Turn Passes' },
}), {});

/** same, but a {Battle} spell — proves TIMING still applies to a free release */
registerSynthetic(unit('Test Battle Prophet', 0, 0, {
  kind: 'spell', timing: 'battle', type: 'Test Spell', cost: 'ee', mana: 6,
  prophecy: { mana: 1, condition: 'One Battle Passes' },
}), {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); } },
});

registerSynthetic(unit('Test Life Prophet', 1, 1, {
  prophecy: { mana: 1, condition: 'Your life is 5 or less' },
}), {});

registerSynthetic(unit('Test Costs Prophet', 1, 1, {
  prophecy: { mana: 1, condition: 'Your units have four unique costs.' },
}), {});

registerSynthetic(unit('Test Haste Prophet', 1, 1, {
  timing: 'haste', prophecy: { mana: 1, condition: 'End [Haste] with used mana' },
}), {});

/** Divine Intervention's shape: a {Battle} card whose banner marks the RELEASE
 * [Haste] — the marker is timing, not condition (R42). */
registerSynthetic(unit('Test Release Prophet', 0, 0, {
  kind: 'spell', timing: 'battle', type: 'Test Spell',
  prophecy: { mana: 1, condition: 'One Turn Passes [Haste]' },
}), {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); } },
});

/** Angel of Anguish's shape: "I can be prophesied from your bin." */
registerSynthetic(unit('Test Bin Prophet', 2, 2, {
  prophecy: { mana: 1, condition: 'One Turn Passes' },
}), { prophesyFromBin: true });

/** a condition no rule row matches — must fail safely and loudly */
registerSynthetic(unit('Test Bad Prophet', 1, 1, {
  prophecy: { mana: 1, condition: 'The moon is in Scorpio' },
}), {});

/** an augment (type-line grant) with a prophecy banner: proves a fulfilled
 * prophecy makes the AUGMENT free too, not only the play (R42) */
registerSynthetic(unit('Test Aug Prophet', 1, 1, {
  cost: 'ee', mana: 5, augmentAttrs: ['Tough'],
  prophecy: { mana: 1, condition: 'One Turn Passes' },
}), {});

/** a plain augment used to prove modding from cache WITHOUT a prophecy still
 * works and still costs the normal price (Caleb 2024-12-02) */
registerSynthetic(unit('Test Aug Mod', 1, 1, { cost: 'rr', mana: 3, augmentAttrs: ['Tough'] }), {});

/** graft host + graft mod (the mod carries a prophecy banner so the free-graft
 * half of R42 can be shown) */
registerSynthetic(unit('Test Graft Host', 2, 2), {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true, graftCause: true,
    label: 'graft cause',
    effect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} graft cause fires.`); } },
  }],
});
registerSynthetic(unit('Test Graft Prophet', 1, 1, {
  cost: 'ee', mana: 5, prophecy: { mana: 1, condition: 'One Turn Passes' },
}), {
  graftEffect: { bounded: false, effect: { run: g => { g.ev('info', 'grafted rider.'); } } },
});

registerSynthetic(unit('Test Grunt', 1, 1), {});
registerSynthetic(unit('Test Deck Top', 1, 1), {});
registerSynthetic(unit('Test Mod', 1, 1, { augmentAttrs: ['Tough'] }), {});
/** four distinct printed costs for "Your units have four unique costs." */
registerSynthetic(unit('Test Cost0', 1, 1, { mana: 0 }), {});
registerSynthetic(unit('Test Cost1', 1, 1, { mana: 1 }), {});
registerSynthetic(unit('Test Cost2', 1, 1, { mana: 2 }), {});
registerSynthetic(unit('Test Cost3', 1, 1, { mana: 3 }), {});
/** R45: glimpse carriers. The choose-one decision is raised through the
 * RESOLVING PART's ctx.choose, so a real stack item is the only honest way to
 * exercise it — a bare white-box e.glimpse() has no decision window. */
registerSynthetic(unit('Test Glimpse 3', 0, 0, {
  kind: 'spell', timing: 'deploy', type: 'Test Spell', mana: 0,
}), { spellEffect: { run: (g, ctx) => { g.glimpse(ctx.controller, 3); } } });
registerSynthetic(unit('Test Glimpse 1', 0, 0, {
  kind: 'spell', timing: 'deploy', type: 'Test Spell', mana: 0,
}), { spellEffect: { run: (g, ctx) => { g.glimpse(ctx.controller, 1); } } });

/** a [1] unit with EARTH pips: unplayable from hand without earth affinity,
 * playable from cache for mana alone (R45 ignores affinity, not cost) */
registerSynthetic(unit('Test Pips', 1, 1, { cost: 'ee', mana: 1 }), {});

/** a [1] haste spell: something to spend mana on during the haste step */
registerSynthetic(unit('Test Haste Spell', 0, 0, {
  kind: 'spell', timing: 'haste', type: 'Test Spell', mana: 1,
}), {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); } },
});

// ── helpers ───────────────────────────────────────────────────────────

/** run engine mutations white-box, keeping the harness log honest */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];
const trashes = (h: Harness): EngineEvent[] => h.events.filter(ev => ev.type === 'trashed');

/** planning → (haste) → both battle rounds declined → deployment */
function intoDeployment(h: Harness): void {
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
}

/** finish deployment (both seats) — the turn flips */
function endDeployment(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.phase === 'deploy' && h.state.deployDone && !h.state.deployDone[seat]) {
      h.do({ type: 'doneDeploying', seat });
    }
  }
}

/** one whole turn: deployment → next turn's deployment */
function nextTurnsDeployment(h: Harness): void {
  endDeployment(h);
  intoDeployment(h);
}

/** the cache index of `name` in `seat`'s cache */
function cacheIdx(h: Harness, seat: Seat, name: string): number {
  return cacheOf(h, seat).findIndex(cc => cc.card === name);
}

// ── R42: the prophesy action ──────────────────────────────────────────


/** the inert deck filler behind sterile() below: unaffordable (mana 20, no
 * affinity pips) and deploy-timed, so it is never playable, never opens a
 * haste step and never triggers anything. */
const FILLER = 'T36 Filler';
registerSynthetic({
  name: FILLER, cost: '', mana: 20, power: 1, toughness: 1, type: 'Test Unit',
  kind: 'unit', timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '',
}, {});

/**
 * A harness whose RANDOMNESS CANNOT LEAK INTO ASSERTIONS.
 *
 * These tests used to read cards out of the seeded opening hand. That is
 * seed-derived state, and the seed is not the only input: DECK_LIST feeds the
 * opening shuffle, so EVERY batch that registers a card reshuffles every
 * game — which made this file flicker each time a sibling batch landed.
 *
 * So the state is built explicitly instead: both hands are emptied and the
 * shared deck is replaced by a long run of one inert filler unit (unaffordable
 * — mana 20, no pips — and deploy-timed, so it can never open a haste step,
 * never be playable and never trigger anything). Every test then puts exactly
 * the cards it needs exactly where it needs them, and nothing else is there.
 */
function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  return h;
}

test('R42: prophesying is a DEPLOYMENT action — illegal in planning, the haste step and battle', () => {
  const h = sterile(3600);
  const P = 0 as const;
  giveResources(h, P, 'fire', 4);
  const idx = give(h, P, 'Test Prophet');
  give(h, P, 'Test Haste Spell');                    // so the haste step opens

  // planning (resource step)
  assert.equal(h.state.phase, 'planning');
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }), IllegalAction);
  assert.ok(!h.legal(P).some(a => a.type === 'prophesy'), 'and never offered');

  // haste step
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step opened');
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }), IllegalAction);
  assert.ok(!h.legal(P).some(a => a.type === 'prophesy'));
  skipHasteStep(h);

  // battle, holding priority
  const atk = spawn(h, h.state.battle!.attacker, 'Test Grunt');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [[atk]] });
  assert.equal(h.state.priority, h.state.initiative);
  assert.throws(() => h.do({ type: 'prophesy', seat: h.state.priority!, from: 'hand', index: idx }), IllegalAction);
  assert.ok(!h.legal(h.state.priority!).some(a => a.type === 'prophesy'));
});

test('R42: prophesying costs the banner mana (no affinity) and caches the card with its prophecy', () => {
  const h = sterile(3601);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 3);                    // FIRE mana; the card wants 'ee'
  const idx = give(h, P, 'Test Prophet');
  assert.ok(!h.q.canPayCard(P, 'Test Prophet'), 'unplayable from hand: [6] and no earth affinity');
  const offered = h.legal(P).filter(a => a.type === 'prophesy');
  assert.equal(offered.length, 1, 'but the prophecy IS offered — the banner cost has no pips');

  h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx });
  assert.equal(h.q.openMana(P), 1, 'the banner [2] was paid');
  assert.ok(!h.state.players[P]!.hand.includes('Test Prophet'), 'it left the hand');
  const cache = cacheOf(h, P);
  assert.equal(cache.length, 1);
  assert.equal(cache[0]!.card, 'Test Prophet');
  assert.equal(cache[0]!.prophecy!.condition, 'One Turn Passes');
  assert.equal(cache[0]!.prophecy!.turn, h.state.turn, 'R43: anchored to the turn it was prophesied on');
  assert.ok(!cache[0]!.prophecy!.fulfilled, 'not fulfilled yet');
  assert.ok(h.events.some(ev => ev.type === 'prophesied'), 'the action is in the log');
  assert.ok(h.events.some(ev => ev.type === 'cached'), 'and so is the zone change');
});

test('R42: with less than the banner mana the prophecy is refused and never offered', () => {
  const h = sterile(3602);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 1);                    // the banner wants 2
  const idx = give(h, P, 'Test Prophet');
  assert.ok(!h.legal(P).some(a => a.type === 'prophesy'));
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }), IllegalAction);
});

test('R42: a card with no banner cannot be prophesied at all', () => {
  const h = sterile(3603);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 4);
  const idx = give(h, P, 'Test Grunt');
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index: idx }), IllegalAction);
});

test('R42: only a card that SAYS SO may be prophesied from the bin', () => {
  const h = sterile(3604);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 4);
  h.state.players[P]!.bin.push('Test Prophet', 'Test Bin Prophet');
  const fromBin = h.legal(P).filter(a => a.type === 'prophesy' && a.from === 'bin')
    .map(a => (a as { index: number }).index);
  assert.deepEqual(fromBin, [1], 'exactly one of the two says it can — the prophesyFromBin one');
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'bin', index: 0 }), IllegalAction);
  h.do({ type: 'prophesy', seat: P, from: 'bin', index: 1 });
  assert.deepEqual(h.state.players[P]!.bin, ['Test Prophet'], 'it left the bin');
  assert.equal(cacheOf(h, P)[0]!.card, 'Test Bin Prophet');
});

// ── R43: conditions count forward ─────────────────────────────────────

test('R43: "One Turn Passes" counts from the PROPHESYING, not from turn 1', () => {
  const h = sterile(3610);
  // burn a few turns first: a naive "turn >= 1" would already be satisfied
  toDeployment(h);
  nextTurnsDeployment(h);
  nextTurnsDeployment(h);
  const P = h.state.deployPlayer!;
  assert.ok(h.state.turn >= 3, 'several turns have already passed');
  giveResources(h, P, 'fire', 3);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Prophet') });
  assert.equal(h.q.cachePermission(P, 0), null, 'not fulfilled by the turns that predate it');
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'one turn later it is');
  assert.ok(cacheOf(h, P)[0]!.prophecy!.fulfilled, 'and the latch was written to state');
});

test('R43: "Two Turns Pass" needs two, not one', () => {
  const h = sterile(3611);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 3);
  // grant the condition through the rules-text API rather than a banner
  whiteBox(h, e => { e.cacheCard(P, 'Test Grunt', 'effect', { prophecy: 'Prophecy — Two Turns Pass' }); });
  assert.equal(h.q.cachePermission(P, 0), null);
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), null, 'one turn is not two');
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), 'prophecy');
});

test('R43: "One Battle Passes" — both battles of a turn tick it, counted forward', () => {
  const h = sterile(3612);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const before = h.state.battlesCompleted;
  assert.ok(before! >= 2, 'this turn already ran both battle rounds');
  giveResources(h, P, 'fire', 3);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Battle Prophet') });
  assert.equal(cacheOf(h, P)[0]!.prophecy!.battles, before,
    'anchored to the battles already completed — those do not count');
  assert.equal(h.q.cachePermission(P, 0), null);
  // next turn's FIRST battle round is enough
  endDeployment(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.q.cachePermission(P, 0), null, 'the battle has not finished yet');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'one completed battle round is enough');
});

test('R43: "Your life is 5 or less" is a live check while the prophecy stands', () => {
  const h = sterile(3613);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Life Prophet') });
  assert.equal(h.q.cachePermission(P, 0), null, 'at 30 life, no');
  h.state.players[P]!.life = 5;
  whiteBox(h, () => { /* any settle sweeps the prophecies */ });
  assert.equal(h.q.cachePermission(P, 0), 'prophecy');
});

test('R43: "Your units have four unique costs" counts DISTINCT printed costs in play', () => {
  const h = sterile(3614);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  spawn(h, P, 'Test Cost0');
  spawn(h, P, 'Test Cost1');
  spawn(h, P, 'Test Cost2');
  spawn(h, P, 'Test Cost2');        // a duplicate cost adds nothing
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Costs Prophet') });
  assert.equal(h.q.cachePermission(P, 0), null, 'three distinct costs is not four');
  spawn(h, P, 'Test Cost3');        // spawn() settles, which sweeps
  assert.equal(h.q.cachePermission(P, 0), 'prophecy');
});

test('R43: "End [Haste] with used mana" needs mana spent IN that haste step', () => {
  const h = sterile(3615);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Haste Prophet') });
  // turn N+1: a haste step in which P spends nothing
  endDeployment(h);
  give(h, O, 'Test Haste Spell');
  giveResources(h, O, 'fire', 1);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the step opened (O holds a haste card)');
  skipHasteStep(h);
  assert.equal(h.q.cachePermission(P, 0), null, "the opponent's spending is not yours");
  // turn N+2: P plays a [1] haste spell during the step
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  endDeployment(h);
  const hasteIdx = give(h, P, 'Test Haste Spell');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'playCard', seat: P, handIndex: hasteIdx });
  assert.equal(h.q.cachePermission(P, 0), null, 'not yet — the step has not ENDED');
  skipHasteStep(h);
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'the haste step ended with used mana');
  assert.equal(h.state.hasteManaSpent![P], 0, 'and the window tally is cleared behind it');
});

/** R50 landed an 'endOfHaste' EVENT in exactly the place R43's mana-tally
 * sweep already lived. The order is load-bearing and easy to break, so it is
 * pinned here: the event fires while `hasteDone` still describes the closing
 * step (so `hasteWithUsedMana`, which requires hasteDone === null, cannot latch
 * early off a TRIGGER's own spending), and only then is hasteDone nulled, the
 * prophecy swept and the tally cleared. */
registerSynthetic(unit('Test Haste Listener', 1, 1), {
  abilities: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'the haste step ended',
    effect: { run: (g, ctx) => { g.ev('info', `Test Haste Listener heard the end of haste (hasteDone ${g.s.hasteDone === null ? 'null' : 'set'}).`); } },
  }],
});

test("R43 + R50: the end-of-haste EVENT and the 'used mana' prophecy sweep coexist", () => {
  const h = sterile(3617);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Test Haste Listener');
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Haste Prophet') });
  endDeployment(h);
  const hasteIdx = give(h, P, 'Test Haste Spell');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'playCard', seat: P, handIndex: hasteIdx });   // [1] spent IN the step
  assert.equal(h.q.cachePermission(P, 0), null, 'not yet — the step has not ENDED');
  skipHasteStep(h);

  // 1. the event fired, and it fired while the step was still open
  assert.ok(h.events.some(e => e.type === 'endOfHaste'), "R50: 'endOfHaste' is dispatched");
  assert.ok(h.log.some(l => l.includes('Test Haste Listener heard the end of haste (hasteDone set)')),
    'R50: the listener sees the step it is closing, not the state after it');
  // 2. …and the R43 sweep still latched, in the same breath
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'R43/R44: the prophecy latched');
  assert.equal(h.state.hasteManaSpent![P], 0, 'and the window tally was cleared behind it');
  assert.equal(h.state.hasteDone, null);
  assert.equal(h.state.phase, 'battle', 'and the phase flip completed');
});

test('R43: an UNRECOGNISED condition never fulfils, never crashes, and says so in the log', () => {
  const h = sterile(3616);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Bad Prophet') });
  assert.equal(h.q.cachePermission(P, 0), null);
  nextTurnsDeployment(h);
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), null, 'still not fulfilled — silence would be worse');
  assert.ok(h.log.some(l => l.includes('Unrecognised prophecy condition') && l.includes('The moon is in Scorpio')),
    'and the game log carries the warning');
});

test('R43: condition normalisation absorbs the transcription differences', () => {
  // Blurf: 'Prophecy: 1 turn passes'; everything else: 'Prophecy — One Turn Passes'
  assert.equal(normalizeProphecy('Prophecy: 1 turn passes').norm, '1 turn passes');
  assert.equal(normalizeProphecy('Prophecy — One Turn Passes').norm, '1 turn passes');
  assert.equal(normalizeProphecy('Two Turns Pass').norm, '2 turns pass');
  assert.equal(normalizeProphecy('Your units have four unique costs.').norm, 'your units have 4 unique costs');
  // R42: a TRAILING [Haste] is a release marker, not part of the condition…
  const di = normalizeProphecy('Your life is 5 or less [Haste]');
  assert.equal(di.norm, 'your life is 5 or less');
  assert.equal(di.release, 'haste');
  // …but Tithe Enforcer's non-trailing bracket names the STEP and stays
  const te = normalizeProphecy('End [Haste] with used mana');
  assert.equal(te.norm, 'end haste with used mana');
  assert.equal(te.release, undefined);
});

// ── R44: fulfilment latches ───────────────────────────────────────────

test('R44: a fulfilled prophecy LATCHES — gaining the life back leaves it playable', () => {
  const h = sterile(3620);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Life Prophet') });
  h.state.players[P]!.life = 4;
  whiteBox(h, () => { /* sweep */ });
  assert.ok(cacheOf(h, P)[0]!.prophecy!.fulfilled, 'latched');
  h.state.players[P]!.life = 30;
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'still playable at full life (R44)');
  // and it really is playable: the unit deploys for free
  assert.ok(h.legal(P).some(a => a.type === 'playCached' && a.index === 0));
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(cacheOf(h, P).length, 0, 'it left the cache');
  assert.ok(Object.values(h.state.entities).some(e => e.card === 'Test Life Prophet'));
});

// ── R42: playing from cache ───────────────────────────────────────────

test('R42: a released prophecy is FREE and ignores affinity', () => {
  const h = sterile(3630);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Prophet') });
  assert.equal(h.q.openMana(P), 0, 'the banner ate both mana');
  nextTurnsDeployment(h);
  assert.equal(h.q.openMana(P), 2, 'two fire refreshed — the card itself costs [6] with ee');
  assert.ok(!h.q.canPayCard(P, 'Test Prophet'), 'unplayable out of hand: not enough mana, no earth affinity');
  assert.ok(h.legal(P).some(a => a.type === 'playCached'), 'but the cache release is offered');
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), 2, 'nothing was paid — free means free');
  assert.ok(Object.values(h.state.entities).some(e => e.card === 'Test Prophet'), 'and it is in play');
  assert.equal(cacheOf(h, P).length, 0);
});

test('R42: normal TIMING still applies — a {Battle} release is refused at deployment', () => {
  const h = sterile(3631);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Battle Prophet') });
  endDeployment(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'a battle round completed — fulfilled');
  // …but not at deployment
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  assert.ok(!h.legal(P).some(a => a.type === 'playCached'), 'a {Battle} card is not offered at deployment');
  assert.throws(() => h.do({ type: 'playCached', seat: P, index: 0 }), IllegalAction);
  // in battle, holding priority, it is
  endDeployment(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  const atk = spawn(h, h.state.battle!.attacker, 'Test Grunt');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [[atk]] });
  while (h.state.priority !== P) h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.ok(h.legal(P).some(a => a.type === 'playCached'), 'battle timing, with priority: offered');
  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), mana, 'free');
  assert.equal(h.state.stack.length, 1, 'and it went on the stack like any battle card');
});

test('R42: a trailing [Haste] on the banner moves the RELEASE into the haste step', () => {
  const h = sterile(3632);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Release Prophet') });
  const cc = cacheOf(h, P)[0]!;
  assert.equal(cc.prophecy!.condition, 'One Turn Passes', 'the marker is not part of the condition');
  assert.equal(cc.prophecy!.release, 'haste');
  endDeployment(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step opened FOR the cached release');
  assert.ok(h.legal(P).some(a => a.type === 'playCached'), 'and the {Battle} card is offered there');
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.ok(h.log.some(l => l.includes('Test Release Prophet resolves')), 'it resolved immediately, like any haste play');
});

test('R41: being in the cache is NOT permission — an unpermitted card is unplayable, forever', () => {
  const h = sterile(3633);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 5);
  whiteBox(h, e => { e.cacheCard(P, 'Test Grunt', 'effect'); });
  assert.equal(h.q.cachePermission(P, 0), null);
  assert.ok(!h.legal(P).some(a => a.type === 'playCached'));
  assert.throws(() => h.do({ type: 'playCached', seat: P, index: 0 }), IllegalAction);
  // and it STAYS cached: never binned, discarded or erased
  nextTurnsDeployment(h);
  nextTurnsDeployment(h);
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Grunt']);
  assert.ok(!h.state.players[P]!.bin.includes('Test Grunt'));
});

// ── R45: glimpse ──────────────────────────────────────────────────────

test('R45: Glimpse N reveals N, caches exactly ONE of the glimpser\'s choice and recycles the rest', () => {
  const h = sterile(3640);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.q.deckOf(P).unshift('Test Cost2', 'Test Grunt', 'Test Deck Top');
  giveResources(h, P, 'fire', 3);
  const deckBefore = h.q.deckOf(P).length;
  const handBefore = [...h.state.players[P]!.hand];
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Test Glimpse 3') });
  const dec = h.state.decision!;
  assert.equal(dec.seat, P, 'the GLIMPSER chooses');
  assert.deepEqual(dec.options.map(o => o.card), ['Test Cost2', 'Test Grunt', 'Test Deck Top'],
    'all three revealed cards are offered, top-first');
  h.do({ type: 'decide', seat: P, choice: 0 });        // cache Test Cost2
  // the reveal event is re-emitted when the suspended part replays, so it
  // lands in the log once the choice is in (R41: public information)
  assert.ok(h.events.some(ev => ev.type === 'glimpsed'), 'and revealed publicly (R41)');
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Cost2'], 'exactly ONE card is cached');
  assert.equal(h.q.cachePermission(P, 0), 'glimpse', "and it carries cachePermission 'glimpse'");
  assert.equal(cacheOf(h, P)[0]!.prophecy, undefined, 'glimpse attaches no prophecy');
  assert.deepEqual(h.state.players[P]!.hand, handBefore, 'NOTHING reaches hand');
  assert.equal(h.q.deckOf(P).length, deckBefore - 1, 'only the cached card left the deck');
  assert.deepEqual(h.q.deckOf(P).slice(-2), ['Test Grunt', 'Test Deck Top'],
    'the other two are on the BOTTOM of the deck, in revealed order');
  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });     // Test Cost2 costs [2]
  assert.equal(h.q.openMana(P), mana - 2, 'the mana cost IS paid (Caleb 2023-08-13)');
  assert.ok(Object.values(h.state.entities).some(e => e.card === 'Test Cost2'));
});

test('R45: choosing the LAST revealed card recycles the two above it, in order', () => {
  const h = sterile(3643);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.q.deckOf(P).unshift('Test Cost2', 'Test Grunt', 'Test Deck Top');
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Test Glimpse 3') });
  h.do({ type: 'decide', seat: P, choice: 2 });
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Deck Top'], 'the third one is cached');
  assert.deepEqual(h.q.deckOf(P).slice(-2), ['Test Cost2', 'Test Grunt'],
    'the first two are on the bottom, still in revealed order');
});

test('R45: Glimpse 1 raises no decision — cache-one and cache-all coincide', () => {
  const h = sterile(3644);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.q.deckOf(P).unshift('Test Grunt');
  const deckBefore = h.q.deckOf(P).length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Test Glimpse 1') });
  assert.equal(h.state.decision, null, 'nothing to choose between — no pointless prompt');
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Grunt']);
  assert.equal(h.q.deckOf(P).length, deckBefore - 1, 'and nothing was recycled');
});

test('R45: a card with no affinity is ILLEGAL from hand but LEGAL from cache, for mana only', () => {
  const h = sterile(3645);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 3);                      // zero EARTH affinity
  const inHand = give(h, P, 'Test Pips');              // ee / [1]
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.handIndex === inHand),
    'from HAND: no earth affinity, so it cannot be played');
  h.q.deckOf(P).unshift('Test Pips', 'Test Grunt');
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Test Glimpse 3') });
  h.do({ type: 'decide', seat: P, choice: 0 });        // cache the pipped copy
  assert.equal(h.q.cachePermission(P, 0), 'glimpse');
  assert.ok(h.legal(P).some(a => a.type === 'playCached' && a.index === 0),
    'from CACHE: offered — the glimpse permission ignores affinity');
  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), mana - 1, 'but the [1] mana cost is still paid');
  assert.ok(Object.values(h.state.entities).some(e => e.card === 'Test Pips'));
});

test('R45: the glimpse permission expires at end of turn — the cards stay cached, inert', () => {
  const h = sterile(3641);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.q.deckOf(P).unshift('Test Grunt');
  giveResources(h, P, 'fire', 3);
  whiteBox(h, e => { e.glimpse(P, 1); });
  assert.ok(h.legal(P).some(a => a.type === 'playCached'), 'playable this turn');
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), null, 'not the next turn');
  assert.ok(!h.legal(P).some(a => a.type === 'playCached'));
  assert.throws(() => h.do({ type: 'playCached', seat: P, index: 0 }), IllegalAction);
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Grunt'], 'but it is still in the cache');
});

test('R45: glimpse still obeys timing, and a short deck glimpses fewer', () => {
  const h = sterile(3642);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.q.deckOf(P).unshift('Test Battle Prophet');
  giveResources(h, P, 'fire', 8);
  whiteBox(h, e => { e.glimpse(P, 1); });
  assert.equal(h.q.cachePermission(P, 0), 'glimpse');
  assert.ok(!h.legal(P).some(a => a.type === 'playCached'), 'a {Battle} card is still a battle card');
  assert.throws(() => h.do({ type: 'playCached', seat: P, index: 0 }), IllegalAction);
  // an empty deck glimpses nothing rather than throwing
  whiteBox(h, e => { e.deckOf(P).length = 0; assert.deepEqual(e.glimpse(P, 3), []); });
});

// ── R41/R42: augment & graft from cache ───────────────────────────────

test('R41: you can augment from cache without a prophecy — paying the normal cost', () => {
  const h = sterile(3650);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Test Grunt');
  giveResources(h, P, 'fire', 3);                     // Test Aug Mod: rr / [3]
  whiteBox(h, e => { e.cacheCard(P, 'Test Aug Mod', 'effect'); });
  const opt = h.legal(P).find(a => a.type === 'augment' && a.from === 'cache');
  assert.ok(opt, 'offered — modding from cache needs no prophecy (Caleb 2024-12-02)');
  h.do({ type: 'augment', seat: P, from: 'cache', index: 0, hostId: host });
  assert.equal(h.q.openMana(P), 0, 'the mod cost was paid as normal');
  assert.equal(cacheOf(h, P).length, 0, 'and it left the cache');
  assert.equal(ent(h, host)!.mods.length, 1);
});

test('R41: an unaffordable cached mod is not offered', () => {
  const h = sterile(3651);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Test Grunt');
  giveResources(h, P, 'fire', 1);                     // Test Aug Mod needs [3] + rr
  whiteBox(h, e => { e.cacheCard(P, 'Test Aug Mod', 'effect'); });
  assert.ok(!h.legal(P).some(a => a.type === 'augment' && a.from === 'cache'));
});

test('R42: a FULFILLED prophecy makes the augment free too — and ignores affinity', () => {
  const h = sterile(3652);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 1);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Aug Prophet') });
  nextTurnsDeployment(h);
  const host = spawn(h, P, 'Test Grunt');
  assert.ok(!h.q.canPayCard(P, 'Test Aug Prophet'), '[5] with ee: nowhere near affordable');
  assert.ok(h.legal(P).some(a => a.type === 'augment' && a.from === 'cache'), 'still offered — it is free');
  const mana = h.q.openMana(P);
  h.do({ type: 'augment', seat: P, from: 'cache', index: 0, hostId: host });
  assert.equal(h.q.openMana(P), mana, 'nothing paid');
  assert.equal(ent(h, host)!.mods.length, 1);
  assert.ok(h.q.ownAttrs(ent(h, host)!).has('Tough'), 'and the augment really applied');
});

test('R42: a FULFILLED prophecy makes the graft free too', () => {
  const h = sterile(3653);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 1);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Graft Prophet') });
  nextTurnsDeployment(h);
  const host = spawn(h, P, 'Test Graft Host');
  const opt = h.legal(P).find(a => a.type === 'graft' && a.from === 'cache');
  assert.ok(opt, 'grafting from cache is offered');
  const mana = h.q.openMana(P);
  h.do({ type: 'graft', seat: P, from: 'cache', index: 0, hostId: host, position: 0 });
  assert.equal(h.q.openMana(P), mana, 'free (Caleb 2024-12-03)');
  assert.equal(cacheOf(h, P).length, 0);
  assert.equal(ent(h, host)!.mods.length, 1);
  assert.equal(ent(h, ent(h, host)!.mods[0]!)!.appliedAs, 'graft');
});

// ── R46: mods do not follow a card into cache ─────────────────────────

test('R46: caching a unit sheds its mods to the bin, and that TRASHES them (R40)', () => {
  const h = sterile(3660);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'Test Graft Host');
  whiteBox(h, e => {
    e.attachMod(e.entity(u)!, 'Test Mod', P, 'augment');
    e.cacheUnit(e.entity(u)!);
  });
  assert.ok(!ent(h, u), 'the unit left play');
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Graft Host'], 'the card is cached…');
  assert.deepEqual(h.state.players[P]!.bin, ['Test Mod'], '…and the mod stayed behind, in the bin');
  const t = trashes(h);
  assert.equal(t.length, 1, 'wave A classifies it: bin, from play → trashed');
  assert.equal(t[0]!.data!['card'], 'Test Mod');
  assert.equal(t[0]!.data!['from'], 'play');
  assert.equal(Object.values(h.state.entities).filter(e => e.kind === 'mod').length, 0, 'no orphan mod entity');
});

test('R46: a cached unit can carry a granted prophecy (Grob / Waxen Witness)', () => {
  const h = sterile(3661);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'Test Grunt');
  whiteBox(h, e => { e.cacheUnit(e.entity(u)!, { prophecy: 'Prophecy — One Battle Passes' }); });
  const cc = cacheOf(h, P)[0]!;
  assert.equal(cc.prophecy!.norm, '1 battle passes');
  assert.equal(h.q.cachePermission(P, 0), null, 'not yet — R43 counts forward');
});

test('R46: a TOKEN cached from play is erased, not cached (there is no card)', () => {
  const h = sterile(3662);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  whiteBox(h, e => {
    const t = e.spawnUnit(P, 'Test Grunt', e.homeRegion(P), { token: true });
    e.cacheUnit(t);
  });
  assert.deepEqual(cacheOf(h, P), [], 'nothing cached');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and nothing binned');
  assert.equal(trashes(h).length, 0);
});

// ── R41: cache-zone plumbing ──────────────────────────────────────────

test('R41: the cache primitives move cards out of hand, bin and deck', () => {
  const h = sterile(3670);
  const P = 0 as const;
  h.q.deckOf(P).unshift('Test Deck Top');                 // explicit, not seed-derived
  const deckTop = 'Test Deck Top';
  const deckSize = h.q.deckOf(P).length;
  give(h, P, 'Test Grunt');
  h.state.players[P]!.bin.push('Test Mod');
  whiteBox(h, e => {
    e.cacheFromHand(P, h.state.players[P]!.hand.indexOf('Test Grunt'));
    e.cacheFromBin(P, 0, { playable: true });
    e.cacheTopOfDeck(P, 1, { prophecy: 'One Turn Passes' });
  });
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Grunt', 'Test Mod', deckTop]);
  assert.ok(!h.state.players[P]!.hand.includes('Test Grunt'), 'it left the hand');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and the bin');
  assert.equal(h.q.deckOf(P).length, deckSize - 1, 'and the deck is one shorter');
  assert.ok(!h.q.deckOf(P).includes(deckTop), 'the cached card really left the deck');
  assert.equal(cacheOf(h, P)[1]!.playableUntilTurn, h.state.turn);
  assert.equal(cacheOf(h, P)[2]!.prophecy!.norm, '1 turn passes');
  // and back out again (Prismatic Observer, Lurking Dread)
  whiteBox(h, e => {
    const taken = e.uncache(P, 0);
    assert.equal(taken!.card, 'Test Grunt');
    assert.equal(e.uncache(P, 99), undefined, 'a bad index is not an exception');
  });
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Test Mod', deckTop]);
});

test('R41: a card leaving the cache for a BIN is trashed (R40 classifies it automatically)', () => {
  const h = sterile(3671);
  const P = 0 as const;
  whiteBox(h, e => {
    e.cacheCard(P, 'Test Grunt', 'effect');
    const taken = e.uncache(P, 0)!;
    e.toBin(P, taken.card, 'cache');
  });
  const t = trashes(h);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.data!['from'], 'cache');
  assert.ok(h.log.some(l => l.includes('trashes Test Grunt (from the cache)')));
});

test('R41: the cache is PUBLIC — both seats read the same zone, unredacted', () => {
  const h = sterile(3672);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Prophet') });
  // no per-seat view exists in the engine: the field is simply not secret, and
  // the server's viewFor() masks only named fields, so it passes through
  const seen = h.state.players[P]!.cache!;
  assert.equal(seen[0]!.card, 'Test Prophet');
  assert.equal(seen[0]!.prophecy!.condition, 'One Turn Passes');
  assert.ok(h.events.some(ev => ev.type === 'cached' && ev.msg.includes('Test Prophet')),
    "the caching is announced in the shared log, not hidden from the opponent");
  assert.notEqual(O, P);
});

// ── replay ────────────────────────────────────────────────────────────

test('the new actions replay deterministically from seed + action log', () => {
  // docs/04 §1: the whole game is seed + actions. The cache actions must be
  // no exception — a prophecy anchor, a latch and a cache index all have to
  // land identically on a rerun. (The hand/resource setup below is white-box,
  // so the comparison is against a harness replaying the SAME action log from
  // an identically prepared state, not against createGame alone.)
  const build = (): Harness => {
    const h = sterile(3690);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    giveResources(h, P, 'fire', 4);
    give(h, P, 'Test Prophet');
    give(h, P, 'Test Aug Prophet');
    spawn(h, P, 'Test Grunt');
    return h;
  };
  const drive = (h: Harness): void => {
    const P = h.state.deployPlayer!;
    const at = (name: string) => h.state.players[P]!.hand.indexOf(name);
    h.do({ type: 'prophesy', seat: P, from: 'hand', index: at('Test Prophet') });
    h.do({ type: 'prophesy', seat: P, from: 'hand', index: at('Test Aug Prophet') });
    nextTurnsDeployment(h);
    h.do({ type: 'playCached', seat: P, index: 0 });
    const host = Object.values(h.state.entities).find(e => e.card === 'Test Grunt')!;
    h.do({ type: 'augment', seat: P, from: 'cache', index: 0, hostId: host.id });
  };
  const a = build(); drive(a);
  const b = build(); drive(b);
  assert.deepEqual(b.state, a.state, 'same actions, same state');
  assert.deepEqual(b.actions, a.actions);
  assert.equal(a.state.rngState, b.state.rngState, 'and the RNG never diverged');
  // and a plain createGame replay of a log with no cache actions is unaffected.
  // This one deliberately uses the REAL createGame deck — replay() rebuilds
  // from seed alone, so a sterilised (white-box mutated) start would not match.
  const plain = new Harness(3691);
  plain.do({ type: 'donePlanning', seat: 0 });
  plain.do({ type: 'donePlanning', seat: 1 });
  assert.deepEqual(replay(3691, plain.actions).state, plain.state);
});

// ── serialization ─────────────────────────────────────────────────────

test('a populated cache survives a JSON round-trip, and pre-expansion states still load', () => {
  const h = sterile(3680);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Test Prophet') });
  h.q.deckOf(P).unshift('Test Grunt');
  whiteBox(h, e => { e.glimpse(P, 1); });

  const round = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  assert.deepEqual(round.players[P]!.cache, h.state.players[P]!.cache, 'every field round-trips');
  assert.equal(round.players[P]!.cache![0]!.prophecy!.condition, 'One Turn Passes');
  assert.equal(round.players[P]!.cache![1]!.playableUntilTurn, h.state.turn);
  assert.equal(round.battlesCompleted, h.state.battlesCompleted);
  assert.deepEqual(round.hasteManaSpent, h.state.hasteManaSpent);
  // the round-tripped state keeps driving, and the permissions still read
  h.state = round;
  assert.equal(h.q.cachePermission(P, 1), 'glimpse');
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'the turn count still counts');

  // a state serialized before the expansion has none of the new fields
  const old = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  delete old.players[0]!.cache;
  delete old.players[1]!.cache;
  delete old.battlesCompleted;
  delete old.hasteManaSpent;
  const e = new E(old);
  assert.deepEqual(e.cache(0), [], 'a missing cache reads as an empty zone');
  assert.equal(e.cachePermission(0, 0), null);
  h.state = old;
  endDeployment(h);
  assert.equal(h.state.phase, 'planning', 'and the old state still drives fine');
});
