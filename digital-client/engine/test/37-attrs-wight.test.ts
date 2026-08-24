/* Light & Dark engine wave C: the new attributes, the Wight, Modular, and the
 * last cast-time/extractor primitives.
 *
 *  - R48 {Blessed}: lifelink, and SIMULTANEOUS — the gain lands on the same
 *    game-state check as the damage, so it applies BEFORE the lethal check and
 *    a blessed source can never kill its own controller. All damage, combat
 *    and effect alike.
 *  - R48 {Afflicting}: when an afflicting source kills one or more units their
 *    controllers gain a rot — including kills by -1/-1 COUNTERS (the only way
 *    Umbral Decay, the sole afflicting card, kills anything). One rot per
 *    affected controller per kill event.
 *  - R48 {Lethal}: any combat damage from a lethal unit kills a player — and
 *    still does when the column's damage is replaced by rot, because a
 *    replaced hit still counts as having been dealt (Caleb 2024-10-24).
 *  - R38 Blightsea Polyp: a per-COLUMN replacement of combat damage to
 *    players — 1 rot whatever the column's power, life untouched.
 *  - R71 The Wraith (retired name: Wight): a 0-mana 3/3 token that shrinks an
 *    ally at the start of deployment and mints a FRESH Wraith augment when it
 *    dies. Two entry points (create / augment), one card, two printed names.
 *    Redesigned 2026-08-21; this retires R47, under which the DYING Wraith
 *    re-attached itself instead of being erased.
 *  - R69 A dying token enters the bin, is TRASHED there, and is only then
 *    erased by a state-based sweep; an Unstable (modded) unit is tested first
 *    and is erased with its mods, token or not.
 *  - {Modular}: mods applied to a card AS IT IS PLAYED — an additional cast
 *    cost (R35), riding on the stack with the spell.
 *  - TargetSpec 'cachedCard': a card in EITHER player's cache (R41, public).
 *  - R40 the "Discard me" play mode: pay the printed cost line, discard from
 *    hand, and the resulting trash fires the card's own trashed trigger.
 *
 * No Light & Dark card is scripted yet — every primitive here is proven with
 * synthetic test cards, the way the suite already tests bare mechanics.
 * Seeds: 3700-3799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import {
  allCardNames, getCard, registerSynthetic,
  type Printed, type ResolvedCached,
} from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, pass, pick, spawn,
  toDeployment, toNextBattle,
} from './util.ts';
import type { DecisionOption, EngineEvent, Entity, EntityId, Seat } from '../src/types.ts';
import printedJson from '../src/cards/printed.json' with { type: 'json' };

const PRINTED = printedJson as unknown as Record<string, Printed>;

// ── synthetic test cards ──────────────────────────────────────────────

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});
const spell = (name: string, extra: Partial<Printed> = {}): Printed =>
  unit(name, 0, 0, { kind: 'spell', type: 'Test Spell', ...extra });

registerSynthetic(unit('T37 Grunt', 1, 1), {});
registerSynthetic(unit('T37 Wall', 0, 8), {});
registerSynthetic(unit('T37 Brute', 4, 4), {});
registerSynthetic(unit('T37 Duo', 2, 2), {});

// {Blessed} — "Damage dealt by a blessed source causes its controller to gain
// that much life." A 5-damage bolt at any target, blessed and not, so the
// difference is the attribute and nothing else.
const bolt5 = {
  targets: { what: 'any' as const, prompt: 'T37: deal 5 damage to any target' },
  run: (g: E, ctx: import('../src/cards/dsl.ts').EffectCtx) => { g.dealEffectDamage(ctx, ctx.targets[0]!, 5); },
};
registerSynthetic(spell('T37 Blessed Bolt', { attrs: ['Blessed'] }), { spellEffect: bolt5 });
registerSynthetic(spell('T37 Bolt'), { spellEffect: bolt5 });
registerSynthetic(unit('T37 Blessed Beast', 3, 3, { attrs: ['Blessed'] }), {});

// {Afflicting} — Umbral Decay's shape (two -1/-1 counters on target unit) and
// a board-wide version, for "one rot per controller however many died".
const decay2 = {
  targets: { what: 'unit' as const, prompt: 'T37: put two -1/-1 counters on target unit' },
  run: (g: E, ctx: import('../src/cards/dsl.ts').EffectCtx) => {
    const t = ctx.targets[0];
    if (t && 'id' in (t as object)) g.addCounters(t as Entity, -2);
  },
};
const wipe = {
  run: (g: E, ctx: import('../src/cards/dsl.ts').EffectCtx) => {
    for (const u of g.unitsIn(ctx.region)) g.addCounters(u, -5);
  },
};
registerSynthetic(spell('T37 Afflicting Decay', {
  timing: 'battle', type: '{Battle} {Afflicting} Test Spell', attrs: ['Afflicting'],
}), { spellEffect: decay2 });
registerSynthetic(spell('T37 Plain Decay', { timing: 'battle', type: '{Battle} Test Spell' }),
  { spellEffect: decay2 });
registerSynthetic(spell('T37 Afflicting Wave', {
  timing: 'battle', type: '{Battle} {Afflicting} Test Spell', attrs: ['Afflicting'],
}), { spellEffect: wipe });

/** an afflicting BODY: the attribute is generic, so it has to work for a
 * column that kills a blocker with plain combat damage too */
registerSynthetic(unit('T37 Afflicting Beast', 3, 3, { attrs: ['Afflicting'] }), {});

// {Lethal} — a 1/1 whose combat damage kills a player outright
registerSynthetic(unit('T37 Lethal Bug', 1, 1, { attrs: ['Lethal'] }), {});

/** Blightsea Polyp's shape: "[Augment] Columns deal combat damage to players
 * as 1 rot" — the whole card is the replacement hook, one rot per column. */
registerSynthetic(unit('T37 Polyp', 1, 1), {
  replaceCombatDamageToPlayer: (g, _self, seat) => { g.gainRot(seat, 1); return true; },
});

// {Modular} — Spellbind's shape: a battle spell you may apply mods to as it is
// played, plus a graftable mod with a real (nonzero) cost to pay for it.
registerSynthetic(spell('T37 Modular Spell', {
  timing: 'battle', type: '{Battle} {Modular} Test Spell', attrs: ['Modular'],
}), {
  spellEffect: { run: (g, ctx) => { g.gainRot(ctx.controller, 1); } },
});
registerSynthetic(spell('T37 Plain Spell', { timing: 'battle', type: '{Battle} Test Spell' }), {
  spellEffect: { run: (g, ctx) => { g.gainRot(ctx.controller, 1); } },
});
registerSynthetic(unit('T37 Graft Mod', 1, 1, { mana: 2 }), {
  graftEffect: { bounded: false, effect: { run: (g, ctx) => { g.gainLife(ctx.controller, 4, 'grafted rider'); } } },
});

/** Prismatic Observer's shape: "Recall up to one target cached card." */
registerSynthetic(spell('T37 Cache Seeker', { timing: 'battle', type: '{Battle} Test Spell' }), {
  spellEffect: {
    targets: { what: 'cachedCard', prompt: 'T37: recall target cached card' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('cached' in (t as object))) return;
      const { seat, uid } = (t as ResolvedCached).cached;
      const i = g.cacheIndexOf(seat, uid);
      if (i === -1) return;
      const cc = g.uncache(seat, i)!;
      g.player(seat).hand.push(cc.card);
      g.ev('info', `${cc.card} is recalled from ${g.pname(seat)}'s cache.`);
    },
  },
});

/** Prismatic Observer in full: "Recall UP TO ONE target cached card. You gain
 * 3 life." — a min-0 spec whose unconditional half must happen even when the
 * target is declined or there is nothing to aim at. */
registerSynthetic(spell('T37 Observer', { timing: 'battle', type: '{Battle} Test Spell' }), {
  spellEffect: {
    targets: { what: 'cachedCard', min: 0, prompt: 'T37: recall up to one target cached card' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (t && 'cached' in (t as object)) {
        const { seat, uid } = (t as ResolvedCached).cached;
        const i = g.cacheIndexOf(seat, uid);
        if (i !== -1) g.player(seat).hand.push(g.uncache(seat, i)!.card);
      }
      g.gainLife(ctx.controller, 3, 'T37 Observer');
    },
  },
});

/** Dropslime's shape: "1 Discard me{/n}When I am trashed, …" — the mode is a
 * deployment action (the card's own timing) and the trigger is the card's own,
 * fired out of the bin. */
const trashTrigger = (n: number) => ({
  type: 'triggered' as const, events: ['trashed' as const], self: true,
  label: 'when I am trashed',
  effect: { run: (g: E, ctx: import('../src/cards/dsl.ts').EffectCtx) => { g.gainLife(ctx.controller, n, 'trashed trigger'); } },
});
registerSynthetic(unit('T37 Dropslime', 1, 1, { mana: 2, discardMe: { cost: '', mana: 1 } }), {
  abilities: [trashTrigger(7)],
});
/** Nothyr's shape: "2 [d] Discard Me. {Battle}" — the {Battle} marker sits on
 * the discard-me LINE, so that mode is battle timing while the card is a
 * deploy unit. */
registerSynthetic(unit('T37 Nothyr', 3, 1, { mana: 2, discardMe: { cost: '', mana: 2, timing: 'battle' } }), {
  abilities: [trashTrigger(5)],
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

const trashes = (h: Harness): EngineEvent[] => h.events.filter(ev => ev.type === 'trashed');
const rotOf = (h: Harness, seat: Seat): number => h.q.rot(seat);
const unitsNamed = (h: Harness, card: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.card === card && e.kind === 'unit');
const modsOn = (h: Harness, id: EntityId): Entity[] =>
  (ent(h, id)?.mods ?? []).map(m => ent(h, m)!).filter(Boolean);

/** answer the pending decision with the first option matching `match` */
function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(match);
  if (i === -1) throw new Error(`no matching option in [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

/** pass priority until the stack drains (two passes resolve each item) */
function drainStack(h: Harness): void {
  let guard = 40;
  while (h.state.stack.length && h.state.phase === 'battle' && guard-- > 0) pass(h);
}

/** deployment → next turn's battle, attack with `columns`, drain the
 * attack-window triggers, and stop with priority in the attack window */
function attackWith(h: Harness, attacker: Seat, columns: EntityId[][]): void {
  toNextBattle(h, attacker);
  h.do({ type: 'declareAttack', seat: attacker, columns });
  drainStack(h);
}

/** from the attack window: no blocks, then let combat damage happen */
function throughCombat(h: Harness, defender: Seat): void {
  pass(h); pass(h);                                        // → block step
  h.do({ type: 'declareBlocks', seat: defender, blocks: {} });
  pass(h); pass(h);                                        // → combat damage
}

// ── R48: {Blessed} ────────────────────────────────────────────────────


/** the inert deck filler behind sterile() below: unaffordable (mana 20, no
 * affinity pips) and deploy-timed, so it is never playable, never opens a
 * haste step and never triggers anything. */
const FILLER = 'T37 Filler';
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

test('R48 {Blessed}: effect damage gains its controller exactly that much life', () => {
  const h = sterile(3700);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const wall = spawn(h, P, 'T37 Wall');                    // 0/8: survives the 5
  const idx = give(h, P, 'T37 Blessed Bolt');
  const life = h.state.players[P]!.life;
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  pick(h, { unit: wall });
  assert.equal(h.state.players[P]!.life, life + 5, 'the blessed source gained its controller 5');
  assert.equal(ent(h, wall)!.damage, 5, 'and the damage was still dealt in full');
});

test('R48 {Blessed}: an identical unblessed source gains nothing', () => {
  const h = sterile(3701);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const wall = spawn(h, P, 'T37 Wall');
  const idx = give(h, P, 'T37 Bolt');
  const life = h.state.players[P]!.life;
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  pick(h, { unit: wall });
  assert.equal(h.state.players[P]!.life, life, 'no attribute, no gain');
  assert.equal(h.events.filter(ev => ev.type === 'lifeGained').length, 0);
});

test('R48 {Blessed}: the gain lands BEFORE the lethal check — you heal before you die', () => {
  const h = sterile(3702);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.life = 3;                            // less than the damage
  const idx = give(h, P, 'T37 Blessed Bolt');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  pick(h, { player: P });                                  // aim it at yourself
  assert.equal(h.state.phase, 'deploy', 'the game did NOT end');
  assert.equal(h.state.winner, null);
  assert.equal(h.state.players[P]!.life, 3, '+5 then -5, on the same game state check');
  const iGain = h.log.findIndex(l => l.includes('gains 5 life'));
  const iLoss = h.log.findIndex(l => l.includes('loses 5 life'));
  assert.ok(iGain !== -1 && iLoss > iGain, 'and the gain is committed first');
});

test('R48 {Blessed}: without the attribute the same shot is lethal (the control)', () => {
  const h = sterile(3703);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const O = (1 - P) as Seat;
  h.state.players[P]!.life = 3;
  const idx = give(h, P, 'T37 Bolt');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  pick(h, { player: P });
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, O, 'an unblessed source kills its own controller happily');
});

test('R48 {Blessed}: combat damage to a player gains too', () => {
  const h = sterile(3704);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const beast = spawn(h, A, 'T37 Blessed Beast');          // 3/3 Blessed
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[beast]]);
  throughCombat(h, D);
  assert.equal(h.state.players[D]!.life, lifeD - 3, 'the face took 3');
  assert.equal(h.state.players[A]!.life, lifeA + 3, 'and the blessed column gained 3');
});

test('R48 {Blessed}: combat damage to a UNIT gains as well', () => {
  const h = sterile(3705);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const beast = spawn(h, A, 'T37 Blessed Beast');          // 3/3 Blessed
  const wall = spawn(h, D, 'T37 Wall');                    // 0/8: absorbs all 3
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[beast]]);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  pass(h); pass(h);
  assert.equal(ent(h, wall)!.damage, 3, 'the blocker took the whole 3');
  assert.equal(h.state.players[A]!.life, lifeA + 3, 'so the blessed column gained 3');
  assert.equal(h.state.players[D]!.life, lifeD, 'and no life changed hands otherwise');
});

// ── R48: {Afflicting} ─────────────────────────────────────────────────

test('R48 {Afflicting}: a -1/-1 COUNTER kill gives the dead unit\'s controller a rot', () => {
  const h = sterile(3710);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'T37 Brute');
  const victim = spawn(h, D, 'T37 Grunt');                 // 1/1: two -1/-1 kill it
  give(h, A, 'T37 Afflicting Decay');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Afflicting Decay') });
  pick(h, { unit: victim });
  drainStack(h);
  assert.equal(ent(h, victim), undefined, 'killed purely by counters — no damage anywhere');
  assert.equal(rotOf(h, D), 1, "the dead unit's controller gains a rot");
  assert.equal(rotOf(h, A), 0, 'the afflicting source\'s controller does not');
});

test('R48 {Afflicting}: the same kill without the attribute gives nobody a rot', () => {
  const h = sterile(3711);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'T37 Brute');
  const victim = spawn(h, D, 'T37 Grunt');
  give(h, A, 'T37 Plain Decay');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Plain Decay') });
  pick(h, { unit: victim });
  drainStack(h);
  assert.equal(ent(h, victim), undefined, 'it still died');
  assert.equal(rotOf(h, D), 0, 'but no attribute, no rot');
  assert.equal(rotOf(h, A), 0);
});

test('R48 {Afflicting}: ONE rot per controller per kill event, however many died', () => {
  const h = sterile(3712);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'T37 Grunt');
  spawn(h, D, 'T37 Grunt');
  spawn(h, D, 'T37 Grunt');                                // TWO of D's units
  give(h, A, 'T37 Afflicting Wave');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Afflicting Wave') });
  drainStack(h);
  assert.equal(h.q.unitsIn(h.q.homeRegion(D)).length, 0, 'the region is empty — everything died');
  assert.equal(rotOf(h, D), 1, 'two dead units, still exactly one rot');
  assert.equal(rotOf(h, A), 1, "and one for A, whose own attacker it also killed");
  const gains = h.events.filter(ev => ev.type === 'rotGained');
  assert.equal(gains.length, 2, 'one rotGained per affected controller, no more');
});

test('R48 {Afflicting}: killing nothing gives no rot at all', () => {
  const h = sterile(3713);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'T37 Grunt');
  const wall = spawn(h, D, 'T37 Wall');                    // 0/8 survives two -1/-1
  give(h, A, 'T37 Afflicting Decay');
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Afflicting Decay') });
  pick(h, { unit: wall });
  drainStack(h);
  assert.ok(ent(h, wall), 'it survived');
  assert.equal(rotOf(h, D), 0);
  assert.equal(rotOf(h, A), 0);
});

test('R48 {Afflicting}: a plain COMBAT kill counts too', () => {
  const h = sterile(3714);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const beast = spawn(h, A, 'T37 Afflicting Beast');       // 3/3 Afflicting
  const blocker = spawn(h, D, 'T37 Grunt');                // 1/1: dies to the 3
  attackWith(h, A, [[beast]]);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);
  assert.equal(ent(h, blocker), undefined, 'the blocker died in combat');
  assert.equal(rotOf(h, D), 1, 'and its controller gains a rot');
  assert.equal(rotOf(h, A), 0);
});

// ── R48: {Lethal} + the Blightsea rot replacement ─────────────────────

test('R48 {Lethal}: any combat damage from a lethal unit kills the player', () => {
  const h = sterile(3720);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bug = spawn(h, A, 'T37 Lethal Bug');               // a 1/1
  assert.ok(h.state.players[D]!.life > 1, 'the 1 damage is nowhere near lethal by itself');
  attackWith(h, A, [[bug]]);
  throughCombat(h, D);
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, A, 'one point of combat damage from a Lethal unit is enough');
});

test('R38 Blightsea: a column\'s combat damage to a player becomes 1 rot, whatever its power', () => {
  const h = sterile(3721);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const big = spawn(h, A, 'T37 Brute');                    // 4/4
  const small = spawn(h, A, 'T37 Duo');                    // 2/2 — the doc's example column
  spawn(h, D, 'T37 Polyp');
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[big, small]]);                        // ONE column, 6 power
  throughCombat(h, D);
  assert.equal(h.state.players[D]!.life, lifeD, 'the life total does not change');
  assert.equal(rotOf(h, D), 1, 'one rot for the column, not one per power');
  assert.equal(h.events.filter(ev => ev.type === 'lifeLost' && ev.data?.['why'] === 'combat').length, 0,
    'no combat life loss happened at all');
});

test('R38 Blightsea: the replacement is PER COLUMN', () => {
  const h = sterile(3722);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const big = spawn(h, A, 'T37 Brute');
  const small = spawn(h, A, 'T37 Duo');
  spawn(h, D, 'T37 Polyp');
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[big], [small]]);                      // TWO columns
  throughCombat(h, D);
  assert.equal(h.state.players[D]!.life, lifeD);
  assert.equal(rotOf(h, D), 2, 'two columns, two rot');
});

test('R48 {Lethal} still kills THROUGH the Blightsea replacement (the damage was still dealt)', () => {
  const h = sterile(3723);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const bug = spawn(h, A, 'T37 Lethal Bug');
  spawn(h, D, 'T37 Polyp');
  attackWith(h, A, [[bug]]);
  throughCombat(h, D);
  assert.ok(h.events.some(ev => ev.type === 'rotGained' && ev.data?.['seat'] === D),
    'the damage really was replaced by rot');
  assert.equal(h.events.filter(ev => ev.type === 'lifeLost' && ev.data?.['why'] === 'combat').length, 0,
    'so no combat damage reached the life total');
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, A, 'and Lethal killed anyway — Caleb 2024-10-24');
});

// ── R71: the Wraith (redesigned 2026-08-21; retires R47) ──────────────

// The token was renamed Wight -> Wraith. Six cards print the current name;
// `Blight's End` still carries the retired one. Both must resolve to the SAME
// registered card, with the CURRENT name canonical — state stores 'Wraith',
// and 'Wight' exists only so an old printing still looks up.
test('R71: Wraith and Wight are one card, and neither name is a second entry', () => {
  assert.equal(getCard('Wight'), getCard('Wraith'),
    'the retired name resolves to the same definition as the current one');
  assert.equal(getCard('Wight').name, 'Wraith',
    'and it reports the CURRENT name — the alias never leaks into state');
  assert.ok(allCardNames().includes('Wraith'), 'the canonical name is registered');
  assert.ok(!allCardNames().includes('Wight'), 'the retired alias is not a card of its own');
  assert.equal(getCard('Wraith').power, 3, 'redesigned: 4/4 -> 3/3');
  assert.equal(getCard('Wraith').toughness, 3);
  assert.equal(getCard('Wraith').mana, 0);
  assert.ok(/Token/.test(getCard('Wraith').type), 'and it is a token type, so it is not a deck card');
});

// Project rule: printed data is never hand-copied. The Wraith has a printed
// card and an oracle entry, so it goes through scripts/extract-printed.mjs
// like Wisp, Fireball and Poison — registry.ts carries behaviour only.
test('R71: the Wraith is EXTRACTED printed data, not a hand-written synthetic', () => {
  assert.ok(PRINTED['Wraith'], 'it is in printed.json (i.e. in the extractor POOL)');
  assert.equal(PRINTED['Wraith']!.power, 3);
  assert.equal(PRINTED['Wraith']!.image, 'Wraith.jpg', 'and it has its own printed art');
  assert.match(PRINTED['Wraith']!.text,
    /At the start of deployment, put a -1\/-1 counter on an ally\./);
  assert.match(PRINTED['Wraith']!.text, /When I die, Augment a Wraith onto an ally\./);
});

test('R71: "create a Wraith" spawns a real 3/3 token body', () => {
  const h = sterile(3730);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  const w = ent(h, id)!;
  assert.equal(w.card, 'Wraith');
  assert.equal(w.kind, 'unit');
  assert.equal(w.token, true);
  assert.deepEqual(effStats(h, id), [3, 3], 'a real 3/3 body, not merely a mod');
});

// The redesigned first line. It is [Augment] text, and a card's own [Augment]
// text is live while it is a unit in play (R55), so a Wraith BODY does this.
test('R71: at the start of deployment a Wraith body shrinks a chosen ally', () => {
  const h = sterile(3731);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Brute');                   // 4/4
  whiteBox(h, e => { e.createWraith(P); });
  toNextBattle(h, P);
  finishBattle(h);                                          // → next deployment
  assert.ok(h.state.decision, 'it asks which ally (Wraith body or Brute)');
  pickBy(h, o => o.value === ally);
  assert.deepEqual(effStats(h, ally), [3, 3], 'a -1/-1 counter landed on the chosen ally');
});

// ⚠ UNCONFIRMED (Bena to rule): may "an ally" be the carrier itself? The engine
// says yes, which is also what keeps the line from ever having no candidate.
test('R71 ⚠: a lone Wraith may pick ITSELF as "an ally" (unconfirmed reading)', () => {
  const h = sterile(3732);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(h.state.decision, null, 'only one candidate — itself — so nothing is asked');
  assert.deepEqual(effStats(h, id), [2, 2], 'and it shrank itself');
});

// The redesigned second line. The dying Wraith is NOT re-homed (that was R47,
// retired): it is erased like any other token and a FRESH Wraith is minted.
test('R71: a dying Wraith mints a NEW Wraith onto a chosen ally', () => {
  const h = sterile(3733);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Brute');
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  whiteBox(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  assert.equal(h.state.decision, null, 'only one ally left, so nothing to ask');
  assert.equal(unitsNamed(h, 'Wraith').length, 0, 'the body is gone for good');
  const mods = modsOn(h, ally);
  assert.equal(mods.length, 1, 'and a fresh Wraith arrived as an augment');
  assert.equal(mods[0]!.card, 'Wraith');
  assert.equal(mods[0]!.appliedAs, 'augment');
  assert.equal(mods[0]!.token, true);
  assert.notEqual(mods[0]!.id, id, 'a NEW token — the dead one did not re-home itself');
});

// "an ally" is not a TARGET (the word "target" is not printed), so this is an
// R67 exception ON PURPOSE: the ally is chosen on resolution, and with no
// candidate the trigger simply does nothing rather than fizzling.
test('R71: with no ally left the death trigger does nothing — it cannot fizzle', () => {
  const h = sterile(3734);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  whiteBox(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  assert.equal(h.state.decision, null, 'nothing to choose between');
  assert.equal(Object.values(h.state.entities).filter(e => e.card === 'Wraith').length, 0,
    'no body and no mod: gone');
  assert.ok(!h.log.some(l => l.includes('fizzles')),
    'and nothing fizzled — "an ally" was never a target to lose');
});

// R69, reversing R47/R40's old carve-out.
test('R69: a dying Wraith IS trashed, then erased out of the bin', () => {
  const h = sterile(3735);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  whiteBox(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  const t = trashes(h);
  assert.equal(t.length, 1, 'a token is NOT a card (R133) but it did enter a bin, which is what trashing keys on (R69)');
  assert.equal(t[0]!.data!['card'], 'Wraith');
  assert.deepEqual(h.state.players[P]!.bin, [], 'the state-based sweep erased it again');
  assert.deepEqual(h.q.erased(P), ['Wraith'], 'and it shows in the erased pile');
});

test('R71: "augment a Wraith onto a unit" makes the same token, directly as a mod', () => {
  const h = sterile(3736);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'T37 Brute');
  let created: Entity | null = null, applied: Entity | null = null;
  whiteBox(h, e => {
    created = e.createWraith(P);
    applied = e.augmentWraith(e.entity(host)!, P);
  });
  assert.equal(created!.card, 'Wraith');
  assert.equal(applied!.card, 'Wraith', 'both entry points produce the one token');
  assert.equal(applied!.kind, 'mod');
  assert.equal(applied!.appliedAs, 'augment');
  assert.equal(applied!.token, true);
});

// One text-box [Augment] over both lines, so BOTH travel to the host.
test('R71: an augmented Wraith donates BOTH lines to its host', () => {
  const h = sterile(3737);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'T37 Brute');                   // 4/4
  whiteBox(h, e => { e.augmentWraith(e.entity(host)!, P); });
  assert.deepEqual(effStats(h, host), [4, 4], 'the mod grants no stats of its own');
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(h.state.decision, null, 'the host is the only ally, so no question');
  assert.deepEqual(effStats(h, host), [3, 3], 'line 1 travelled: it shrank an ally');
});

// R69/B — the branch order in destroy(). This is game UZRG's bug: the token
// test used to come FIRST, so a modded token never reached the Unstable branch.
//
// R137 (2026-08-24) INVERTS the trash half in place. This test used to be
// named "…no bin, no trash" and assert `trashes(h).length === 0`; the owner
// ruled that an Unstable death takes the token's route through the bin, so a
// Wraith body carrying a Wraith mod now trashes exactly ONCE — for the body,
// which is a token and so trashes on the R69 ruling, and NOT for the mod,
// which is a token MOD and has no card of its own to bin at all. Both flips
// are carried here rather than deleted: the branch order is still what the
// test is about, and one trash instead of two is the proof it is still right.
test('R69: a MODDED token is Unstable — erased with its mods; R137: the body still trashes, the token mod does not', () => {
  const h = sterile(3738);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const bystander = spawn(h, P, 'T37 Brute');
  let id = 0;
  whiteBox(h, e => {
    id = e.createWraith(P).id;
    e.augmentWraith(e.entity(id)!, P);                     // a Wraith on a Wraith
  });
  whiteBox(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  const t = trashes(h);
  assert.equal(t.length, 1,
    'ONE trash: the body entered a bin (R69/R137); the token MOD never did (R69)');
  assert.equal(t[0]!.data!['card'], 'Wraith');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and the sweep emptied the bin again');
  assert.ok(h.log.some(l => l.includes('Unstable')), 'and it took the Unstable branch');
  // it still DIED, so both copies of the donated death text fired and each
  // minted a Wraith onto the only ally left standing
  assert.equal(modsOn(h, bystander).length, 2,
    'Unstable replaces the BIN, not the death — both death triggers still fired');
});

test('R69/R70: a token mod is erased with its host, never binned or trashed', () => {
  const h = sterile(3739);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'T37 Brute');
  whiteBox(h, e => { e.augmentWraith(e.entity(host)!, P); });
  whiteBox(h, e => { e.recall(e.entity(host)!); });
  assert.deepEqual(h.state.players[P]!.hand.filter(c => c === 'Wraith'), [], 'no Wraith in hand');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and none in the bin — a token mod is erased');
  assert.equal(trashes(h).length, 0);
});

// ── {Modular} ─────────────────────────────────────────────────────────

test('{Modular}: mods are applied at cast time, paid for, and ride on the stack item', () => {
  const h = sterile(3740);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'T37 Grunt');
  give(h, A, 'T37 Modular Spell');
  give(h, A, 'T37 Graft Mod');                             // costs [2]
  giveResources(h, A, 'fire', 3);
  attackWith(h, A, [[atk]]);
  const mana = h.q.openMana(A);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Modular Spell') });
  assert.ok(h.state.decision, 'the cast stopped to ask about mods');
  assert.ok(/Modular/.test(h.state.decision!.prompt));
  pickBy(h, o => o.label.startsWith('T37 Graft Mod'));
  assert.equal(h.state.decision, null, 'nothing else to apply, so no further question');

  const item = h.state.stack[0]!;
  assert.deepEqual(item.mods, [{ card: 'T37 Graft Mod', from: 'hand' }], 'visible on the stack item');
  assert.deepEqual(item.parts.map(p => p.effectKey),
    ['spell:T37 Modular Spell', 'graft:T37 Graft Mod'], 'the mod joined as an extra part');
  assert.ok(item.label.includes('T37 Graft Mod'), 'and the stack reads it out');
  assert.equal(h.q.openMana(A), mana - 2, 'you still pay their costs');
  assert.ok(!h.state.players[A]!.hand.includes('T37 Graft Mod'), 'the mod left the hand');

  const life = h.state.players[A]!.life;
  drainStack(h);
  assert.equal(rotOf(h, A), 1, 'the base effect resolved');
  assert.equal(h.state.players[A]!.life, life + 4, 'and so did the mod, as one composite ability');
  // R105 (owner, 2026-08-23): a modded card is {Unstable} — Manual p.35, "as
  // long as a card is modded, it has the unstable attribute … even though mods
  // can be applied from the bin, they are generally only able to be applied
  // once". So the mod follows the card OUT OF THE GAME, not to a bin; this line
  // read `.bin.includes(...)` until that ruling landed.
  assert.ok(!h.state.players[A]!.bin.includes('T37 Graft Mod'), 'the mod does not reach a bin');
  assert.ok((h.state.players[A]!.erased ?? []).includes('T37 Graft Mod'),
    'it is erased with its carrier (R65, R69)');
  assert.ok((h.state.players[A]!.erased ?? []).includes('T37 Modular Spell'),
    'and the carrier with it — Unstable is a BIN replacement, so neither reaches one');
  assert.equal(trashes(h).length, 0, 'from the stack, and never into a bin, so nothing was trashed (R40)');
});

test('{Modular}: the caster may decline, and a non-modular spell is never asked', () => {
  const h = sterile(3741);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'T37 Grunt');
  give(h, A, 'T37 Modular Spell');
  give(h, A, 'T37 Plain Spell');
  give(h, A, 'T37 Graft Mod');
  giveResources(h, A, 'fire', 3);
  attackWith(h, A, [[atk]]);
  // a plain spell never opens the question at all
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Plain Spell') });
  assert.equal(h.state.decision, null, 'no {Modular}, no mod collection');
  assert.equal(h.state.stack[0]!.mods, undefined);
  drainStack(h);
  // the modular one asks, and "No more mods" is a real answer
  const mana = h.q.openMana(A);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Modular Spell') });
  pickBy(h, o => o.label === 'No more mods');
  assert.equal(h.state.stack[0]!.mods, undefined, 'nothing attached');
  assert.equal(h.q.openMana(A), mana, 'and nothing paid');
  assert.ok(h.state.players[A]!.hand.includes('T37 Graft Mod'), 'the mod stayed in hand');
});

// ── TargetSpec 'cachedCard' (R41) ─────────────────────────────────────

test("R41: a 'cachedCard' target finds cards in BOTH players' caches", () => {
  const h = sterile(3750);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'T37 Grunt');
  give(h, A, 'T37 Cache Seeker');
  whiteBox(h, e => {
    e.cacheCard(A, 'T37 Grunt', 'effect');
    e.cacheCard(D, 'T37 Wall', 'effect');
  });
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Cache Seeker') });
  const labels = h.state.decision!.options.map(o => o.label);
  assert.equal(labels.length, 2, 'the cache is public — both players\' caches are legal targets');
  assert.ok(labels.some(l => l.includes('T37 Grunt')));
  assert.ok(labels.some(l => l.includes('T37 Wall')));
  pickBy(h, o => o.label.includes('T37 Wall'));            // steal from the opponent
  drainStack(h);
  assert.deepEqual(h.q.cache(D).map(c => c.card), [], "the opponent's cache is empty");
  assert.ok(h.state.players[D]!.hand.includes('T37 Wall'), 'and the card went home to their hand');
  assert.deepEqual(h.q.cache(A).map(c => c.card), ['T37 Grunt'], 'the untargeted entry is untouched');
});

test('R41: a cached target that vanishes before resolution fizzles cleanly', () => {
  const h = sterile(3751);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'T37 Grunt');
  give(h, A, 'T37 Cache Seeker');
  whiteBox(h, e => { e.cacheCard(A, 'T37 Grunt', 'effect'); });
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Cache Seeker') });
  pickBy(h, o => o.label.includes('T37 Grunt'));
  assert.equal(h.state.stack.length, 1, 'it is on the stack, targeting the cached card');
  whiteBox(h, e => { e.uncache(A, 0); });                  // …and now it is gone
  drainStack(h);
  assert.ok(h.log.some(l => l.includes('fizzles')), 'the spell fizzled instead of throwing');
  assert.equal(h.state.phase, 'battle', 'and the game carried on');
});

test('R41: cache uids are stable handles, and a pre-uid entry is simply untargetable', () => {
  const h = sterile(3752);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  whiteBox(h, e => {
    e.cacheCard(P, 'T37 Grunt', 'effect');
    e.cacheCard(P, 'T37 Wall', 'effect');
  });
  const [first, second] = h.q.cache(P);
  assert.ok(first!.uid !== undefined && second!.uid !== undefined);
  assert.notEqual(first!.uid, second!.uid, 'distinct handles');
  whiteBox(h, e => { e.uncache(P, 0); });                  // indices shift, uids do not
  assert.equal(h.q.cacheIndexOf(P, second!.uid!), 0, 'the survivor is findable at its new index');
  assert.equal(h.q.cacheIndexOf(P, first!.uid!), -1, 'and the removed one is simply gone');
  // an entry from a state cached before uids existed
  delete h.state.players[P]!.cache![0]!.uid;
  assert.equal(h.q.targetCandidates({ what: 'cachedCard', prompt: '' }, h.q.homeRegion(P)).length, 0,
    'no uid, no target — never a crash');
});

test('R5: "recall UP TO ONE target cached card" still gains the life when nothing is aimed at', () => {
  // Prismatic Observer's shape. A min-0 spec means declaring no target is a
  // legal CHOICE, not a fizzle — so everything printed alongside it happens.
  const h = sterile(3753);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'T37 Grunt');
  give(h, A, 'T37 Observer');
  give(h, A, 'T37 Observer');
  attackWith(h, A, [[atk]]);
  // (a) nobody has cached anything: castable anyway, and the rider resolves
  let life = h.state.players[A]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Observer') });
  assert.equal(h.state.decision, null, 'no candidates, nothing to ask');
  drainStack(h);
  assert.equal(h.state.players[A]!.life, life + 3, 'the unconditional half still happened');
  // (b) a cached card exists but the caster declines it
  whiteBox(h, e => { e.cacheCard(A, 'T37 Wall', 'effect'); });
  life = h.state.players[A]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Observer') });
  pickBy(h, o => o.label === 'No more targets');
  drainStack(h);
  assert.equal(h.state.players[A]!.life, life + 3, 'declining is a choice, not a fizzle');
  assert.deepEqual(h.q.cache(A).map(c => c.card), ['T37 Wall'], 'and the cache is untouched');
});

// ── R40: the "Discard me" play mode ───────────────────────────────────

test('R40: "Discard me" pays its own cost, trashes the card, and fires its own trigger', () => {
  const h = sterile(3760);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 1);
  const idx = give(h, P, 'T37 Dropslime');                 // the card itself costs [2]
  const life = h.state.players[P]!.life;
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx && !a.mode),
    'it cannot be played normally on one mana');
  assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx && a.mode === 'discardMe'),
    'but the discard-me mode is offered');
  h.do({ type: 'playCard', seat: P, handIndex: idx, mode: 'discardMe' });
  assert.equal(h.q.openMana(P), 0, 'the [1] cost line was paid');
  assert.ok(!h.state.players[P]!.hand.includes('T37 Dropslime'), 'it left the hand');
  assert.ok(h.state.players[P]!.bin.includes('T37 Dropslime'), 'into the bin');
  const t = trashes(h);
  assert.equal(t.length, 1, 'discarding from hand is trashing (R40)');
  assert.equal(t[0]!.data!['from'], 'hand');
  assert.equal(h.state.players[P]!.life, life + 7, "and the card's own trashed trigger resolved");
});

test('R40: "Discard me" is refused without the mana', () => {
  const h = sterile(3761);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'T37 Dropslime');
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.mode === 'discardMe'));
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx, mode: 'discardMe' }), IllegalAction);
  assert.ok(h.state.players[P]!.hand.includes('T37 Dropslime'), 'nothing happened');
});

test("R40: Nothyr's battle-timing discard-me line is refused outside battle", () => {
  const h = sterile(3762);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 2);
  const idx = give(h, P, 'T37 Nothyr');
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.mode === 'discardMe'),
    'the {Battle} marker on the cost LINE makes that mode battle-only…');
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx, mode: 'discardMe' }), IllegalAction);
  assert.ok(h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx && !a.mode),
    '…while the card itself is still a perfectly normal deployment unit');
});

test("R40: Nothyr's discard-me mode works during battle, and its trigger uses the stack", () => {
  const h = sterile(3763);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'T37 Grunt');
  giveResources(h, A, 'fire', 2);
  give(h, A, 'T37 Nothyr');
  attackWith(h, A, [[atk]]);
  const life = h.state.players[A]!.life;
  const idx = handIdx(h, A, 'T37 Nothyr');
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.handIndex === idx && a.mode === 'discardMe'));
  h.do({ type: 'playCard', seat: A, handIndex: idx, mode: 'discardMe' });
  assert.equal(h.q.openMana(A), 0, 'the [2] was paid');
  assert.equal(trashes(h).length, 1);
  assert.equal(h.state.stack.length, 1, 'in battle the trashed trigger goes on the stack…');
  assert.equal(h.state.players[A]!.life, life, '…so nothing has resolved yet');
  drainStack(h);
  assert.equal(h.state.players[A]!.life, life + 5, 'and then it does');
});

test('R40: the trashed trigger fires from the BIN, wherever the trash came from', () => {
  const h = sterile(3764);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const life = h.state.players[P]!.life;
  h.q.deckOf(P).unshift('T37 Dropslime');
  whiteBox(h, e => { e.mill(P, 1); });                     // milling trashes too (R40)
  assert.equal(h.state.players[P]!.life, life + 7, 'the card in the bin still heard its own trash');
});

// ── the printed data ──────────────────────────────────────────────────

test('the extractor lifts the "Discard me" cost line off the text of all three cards', () => {
  // read printed.json directly: no Light & Dark card is scripted yet, so these
  // names are printed DATA and not registry entries
  const drop = PRINTED['Dropslime']!;
  assert.deepEqual(drop.discardMe, { cost: '', mana: 1 });
  assert.ok(drop.text.startsWith('When I am trashed'), 'the cost line is stripped out of the text');
  const noth = PRINTED['Nothyr']!;
  assert.deepEqual(noth.discardMe, { cost: 'd', mana: 2, timing: 'battle' },
    "the pips and the line's own {Battle} marker are both captured");
  assert.equal(noth.timing, 'deploy', 'while the CARD is still a deployment unit');
  assert.ok(noth.text.startsWith('When I am trashed'));
  assert.deepEqual(PRINTED['Sacrifice Dude']!.discardMe, { cost: 'd', mana: 2 },
    'the third card printing the form is parsed the same way');
  // and nothing else in the pool does — a "Discard me" that is not a cost line
  // (Swarmling's "Whenever you discard me…") must not be lifted
  const withMode = Object.values(PRINTED).filter(p => p.discardMe).map(p => p.name).sort();
  assert.deepEqual(withMode, ['Dropslime', 'Nothyr', 'Sacrifice Dude']);
});

// ── serialization ─────────────────────────────────────────────────────

test('the new state survives a JSON round-trip, and pre-expansion states still load', () => {
  const h = sterile(3770);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'T37 Brute');                    // 4/4: survives its Wight
  give(h, A, 'T37 Modular Spell');
  give(h, A, 'T37 Graft Mod');
  giveResources(h, A, 'fire', 3);
  whiteBox(h, e => { e.augmentWraith(e.entity(atk)!, A); e.cacheCard(A, 'T37 Wall', 'effect'); });
  attackWith(h, A, [[atk]]);
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Modular Spell') });
  pickBy(h, o => o.label.startsWith('T37 Graft Mod'));

  const round = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  assert.deepEqual(round.stack[0]!.mods, h.state.stack[0]!.mods, 'the item mods round-trip');
  assert.equal(round.stack[0]!.modsDone, true);
  assert.equal(round.players[A]!.cache![0]!.uid, h.state.players[A]!.cache![0]!.uid);
  const wightMod = Object.values(round.entities).find(e => e.card === 'Wraith')!;
  assert.equal(wightMod.token, true, 'the token flag on a MOD round-trips too');
  h.state = round;
  drainStack(h);
  assert.equal(rotOf(h, A), 1, 'and the round-tripped game keeps resolving');

  // a state serialized before this wave has none of the new fields
  const old = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  for (const it of old.stack) { delete it.mods; delete it.modsDone; }
  for (const p of old.players) for (const cc of p.cache ?? []) delete cc.uid;
  const e = new E(old);
  assert.equal(e.cacheIndexOf(A, 1), -1, 'a uid-less cache entry is just not findable');
  h.state = old;
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy', 'and the old state still drives fine');
});

test('the new actions replay deterministically from the same setup', () => {
  const build = (): Harness => {
    const h = sterile(3780);
    toDeployment(h);
    const A = h.state.initiative;
    spawn(h, A, 'T37 Grunt');
    give(h, A, 'T37 Modular Spell');
    give(h, A, 'T37 Graft Mod');
    give(h, A, 'T37 Dropslime');
    giveResources(h, A, 'fire', 5);
    return h;
  };
  const drive = (h: Harness): void => {
    const A = h.state.initiative;
    h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Dropslime'), mode: 'discardMe' });
    const atk = Object.values(h.state.entities).find(e => e.card === 'T37 Grunt')!.id;
    attackWith(h, A, [[atk]]);
    h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'T37 Modular Spell') });
    pickBy(h, o => o.label.startsWith('T37 Graft Mod'));
    drainStack(h);
  };
  const a = build(); drive(a);
  const b = build(); drive(b);
  assert.deepEqual(b.state, a.state, 'same actions, same state');
  assert.deepEqual(b.actions, a.actions);
  assert.equal(a.state.rngState, b.state.rngState, 'and the RNG never diverged');
});

/* ── R144: DEPLOYMENT USES THE STACK, AND TRIGGERS MAY OVER-AIM ────────
 *
 * OWNER RULING, playtest report #101 (room SMVJ, action 318, 2026-08-24),
 * verbatim:
 *
 *   "Deployment should use the stack. All Wraith triggers should go onto the
 *    stack simultaneously and be allowed to target the same unit, even
 *    exceeding its defense (the final triggers would just fizzle)."
 *
 * Two halves, one commit each. (a) is this block; (b) is the one after it.
 *
 * WHAT THE BEHAVIOUR ACTUALLY WAS, measured before anything moved: three
 * Wraiths at the start of deployment queued three triggers, `battleMode` was
 * false, and every one of them took `stackPendingTrigger(next, 'resolve')` —
 * built, aimed and resolved to completion, one at a time, with the stack empty
 * throughout. The ally was chosen INSIDE the resolution (`ctx.choose`), so the
 * second trigger was aimed after the first had already killed a 1/1 and was
 * offered a menu the dead unit was no longer on. Not a targeting restriction
 * refusing it — the unit was simply gone. Both halves of the hypothesis
 * confirmed.
 *
 * R102 is NOT retested here: 43-dark-c.test.ts's "the start-of-deployment event
 * still fires after the rot replacement stopped to ask" already drives exactly
 * this path, and drives it harder now — under R144 that replacement trigger
 * goes through the deployment stack, suspends mid-way, and `finishDeployStart`
 * must still close the window afterwards.
 */

/** every stack depth observed from INSIDE a T144 Watcher's resolution */
const watched: number[] = [];
registerSynthetic(unit('T144 Watcher', 1, 1), {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'],
    label: 'note how many siblings are still on the stack',
    effect: {
      run: (g: E) => {
        watched.push(g.s.stack.length);
        g.ev('info', `T144 Watcher: ${g.s.stack.length} still on the stack.`);
      },
    },
  }],
});

// The claim in one number. A resolving deployment trigger used to see an empty
// stack because there was never anything on it; now the whole batch is pushed
// first and popped FILO, so the first to resolve can still see the two waiting
// behind it. That is what "simultaneously" means mechanically, and it is the
// precondition for half (b): a trigger cannot be aimed at a unit an earlier one
// is about to kill unless it was aimed BEFORE that one resolved.
test('R144(a): every start-of-deployment trigger is on the stack before any of them resolves', () => {
  const h = sterile(3790);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T144 Watcher');
  spawn(h, P, 'T144 Watcher');
  spawn(h, P, 'T144 Watcher');
  watched.length = 0;
  toNextBattle(h, P);
  finishBattle(h);                                          // → next deployment
  assert.equal(h.state.decision, null, 'nothing to ask — the watchers only look');
  assert.deepEqual(watched, [2, 1, 0],
    'three triggers, all three on the stack, popped FILO (was [0,0,0]: never stacked at all)');
  assert.equal(h.state.stack.length, 0, 'and settle() drained it before the phase settled');
});

// The stack is a real stack, not a bookkeeping detail: each item announces its
// arrival, and every arrival precedes every resolution.
test('R144(a): deployment triggers announce themselves onto the stack, all of them before the first resolves', () => {
  const h = sterile(3791);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T144 Watcher');
  spawn(h, P, 'T144 Watcher');
  watched.length = 0;
  const from = h.events.length;
  toNextBattle(h, P);
  finishBattle(h);
  const kinds = h.events.slice(from)
    .filter(ev => ev.type === 'stackPushed' || ev.type === 'resolved')
    .map(ev => ev.type);
  assert.deepEqual(kinds, ['stackPushed', 'stackPushed', 'resolved', 'resolved'],
    'both pushes happen before either resolution');
});

// R12: the batch is shared but the AIM is not. Both seats' Wraiths fire into
// one queue and one stack, and each seat may still only shrink its own units in
// its own region — deployment puts each player alone in their home region.
test('R144(a): R12 — a shared deployment stack does not let a Wraith reach across regions', () => {
  const h = sterile(3792);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const allyA = spawn(h, A, 'T37 Brute');
  const allyD = spawn(h, D, 'T37 Brute');
  let wA = 0, wD = 0;
  whiteBox(h, e => { wA = e.createWraith(A).id; wD = e.createWraith(D).id; });
  toNextBattle(h, A);
  finishBattle(h);
  const seen: Record<number, number[]> = {};
  let guard = 8;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    seen[dec.seat] = dec.options.map(o => o.value as number);
    pickBy(h, o => o.value === (dec.seat === A ? allyA : allyD));
  }
  const sorted = (xs: number[]): number[] => xs.slice().sort((x, y) => x - y);
  assert.deepEqual(sorted(seen[A]!), sorted([allyA, wA]),
    'the initiative seat is offered its OWN region only');
  assert.deepEqual(sorted(seen[D]!), sorted([allyD, wD]),
    'and so is the other seat — neither sees the other side of the table');
  assert.deepEqual(effStats(h, allyA), [3, 3]);
  assert.deepEqual(effStats(h, allyD), [3, 3], 'each counter landed at home');
});

// R121's tax is Crevice Lurker's "during battle" clause. Routing deployment
// through the stack must not invent a tax the card does not print, so the pay
// gate stays keyed on the BATTLE phase and a deployment trigger walks past it.
test('R144(a): the deployment stack is not taxed — R121 is a battle-phase gate', () => {
  const h = sterile(3793);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T144 Watcher');
  watched.length = 0;
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(h.state.decision, null, 'nobody was asked to pay for a deployment trigger');
  assert.deepEqual(watched, [0], 'and it resolved');
  assert.ok(!h.log.some(l => l.includes('is taxed')), 'no tax line at all');
});

/* ── R144(b): several triggers may aim at ONE unit; the surplus fizzles ──
 *
 * The load-bearing half. The Wraith's deployment line is aimed in the STACK
 * window now (`EffectDef.subject`), not inside its own resolution, so the whole
 * pile is aimed while the board still looks the way it did when they fired.
 *
 * ⚠ Still NOT a target. R71 is narrowed, not reversed: no `'targeted'` event,
 * no redirect, no compulsion, invisible to every targeting restriction. See
 * `EffectDef.subject` for why those three were withheld — chiefly Mohruung,
 * which creates a Crystal "when I become targeted" and would have paid its
 * controller once per Wraith per deployment.
 */

/** a BOUNDED start-of-deployment shrinker, for the R113 interaction below */
registerSynthetic(unit('T144 Bounded Shrinker', 1, 1), {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'], bounded: true,   // [once]
    label: 'put a -1/-1 counter on an ally',
    effect: {
      subject: {
        key: 'shrink',
        prompt: () => 'T144 Bounded Shrinker: put a -1/-1 counter on an ally',
        candidates: (g: E, item) => g.unitsOf(item.controller, item.region),
      },
      run: (g: E, ctx) => {
        if (!ctx.subject) { g.ev('info', 'T144 Bounded Shrinker: no ally.'); return; }
        g.addCounters(ctx.subject, -1);
      },
    },
  }],
});

/** answer every pending deployment aim with `id` if it is still offered */
function aimAllAt(h: Harness, id: EntityId): number {
  let asked = 0, guard = 20;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    const i = dec.options.findIndex(o => o.value === id);
    assert.notEqual(i, -1,
      `the aim must still be offered ${id}; menu was [${dec.options.map(o => o.label).join(' | ')}]`);
    h.do({ type: 'decide', seat: dec.seat, choice: i });
    asked++;
  }
  return asked;
}

// The owner's sentence, executed. Three Wraiths, one 1/1: all three are
// offered it, all three take it, the first kills it and the other two fizzle.
// Before R144(b) the second and third were asked AFTER the first had resolved,
// so the 1/1 was not on their menus at all and their counters were forced onto
// the Wraiths instead — the leftovers ate the player's own board.
test('R144(b): three Wraith triggers may all aim at one 1/1, and the surplus fizzles', () => {
  const h = sterile(3794);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Grunt');                    // 1/1: absorbs ONE
  let w1 = 0, w2 = 0, w3 = 0;
  whiteBox(h, e => { w1 = e.createWraith(P).id; w2 = e.createWraith(P).id; w3 = e.createWraith(P).id; });
  toNextBattle(h, P);
  finishBattle(h);                                          // → next deployment
  assert.equal(aimAllAt(h, ally), 3, 'all three were aimed, and all three were offered the 1/1');
  assert.equal(ent(h, ally), undefined, 'it took its one counter and died');
  const fizzles = h.log.filter(l => l.includes('fizzles'));
  assert.equal(fizzles.length, 2, 'the two that outlived it fizzled — one line each');
  assert.ok(fizzles.every(l => l.includes('what it was aimed at has left play')),
    'and the log SAYS why (R109: a no-op announces; it does not vanish)');
  // the point of the whole ruling: nothing was re-aimed at a bystander
  for (const w of [w1, w2, w3]) {
    assert.deepEqual(effStats(h, w), [3, 3], 'no Wraith was shrunk as a consolation prize');
  }
});

// Over-aiming is legal, not merely tolerated: the aim never pre-validates
// against what an earlier trigger is about to consume. The owner's own phrase
// is "even exceeding its defense", so this is the arithmetic version — a 4/4
// absorbs exactly four -1/-1 counters (4/4 → 3/3 → 2/2 → 1/1 → 0/0, dead), and
// the fifth is the surplus.
test('R144(b): the aim does not pre-validate against a limit an earlier trigger will consume', () => {
  const h = sterile(3795);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Brute');                    // 4/4: absorbs FOUR
  whiteBox(h, e => { for (let i = 0; i < 5; i++) e.createWraith(P); });
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(aimAllAt(h, ally), 5, 'a 4/4 may be named by FIVE triggers at once');
  assert.equal(ent(h, ally), undefined, 'four counters killed it');
  assert.equal(h.log.filter(l => l.includes('fizzles')).length, 1,
    'exactly one surplus, exactly one fizzle');
});

// R71's other half, unmoved. "There is no ally at all" declares NOTHING, so
// there is nothing to lose and the trigger does nothing rather than fizzling.
// That distinction is the whole reason `EffectPart.subject` has three states.
test('R144(b): "no ally at all" still does nothing — it is not a fizzle (R71 unmoved)', () => {
  const h = sterile(3796);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(h.state.decision, null, 'one candidate — itself — so nothing is asked');
  assert.deepEqual(effStats(h, id), [2, 2], 'and it shrank itself');
  assert.ok(!h.log.some(l => l.includes('fizzles')), 'nothing fizzled');
});

// The three properties of a TARGET that R144 deliberately does NOT grant. The
// first is the expensive one: Mohruung prints "when I become targeted, create a
// Crystal", a Wraith counter is aimed at an ALLY, and a pool where this fired
// would hand its controller a free Crystal per Wraith per deployment — a power
// gain the owner never asked for and could not have been reading in.
test('R144(b): a subject is not a target — no "targeted" event is ever fired for it', () => {
  const h = sterile(3797);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Brute');
  whiteBox(h, e => { e.createWraith(P); e.createWraith(P); });
  const from = h.events.length;
  toNextBattle(h, P);
  finishBattle(h);
  aimAllAt(h, ally);
  assert.equal(h.events.slice(from).filter(ev => ev.type === 'targeted').length, 0,
    'the word "target" is still not printed on the card, and nothing behaves as if it were');
  assert.deepEqual(effStats(h, ally), [2, 2], 'both counters landed all the same');
});

// ⚠ R113 vs R108, and R113 wins. R108's first reading ("a [once] is spent only
// when the ability does something") would refund a fizzle; the DESIGNER
// narrowed it on 2026-08-23 — a bounded ability "can only be activated or
// triggered once per turn. REGARDLESS OF IF THAT ABILITY RESOLVES OR DOESN'T"
// — so the use is spent by reaching the stack and a fizzle cannot hand it back.
// R144's fizzle is an ordinary fizzle and obeys the ordinary rule. The decline
// side of the same line is 94-bounded-uses.test.ts's job.
test('R144(b) x R113: a bounded ability that FIZZLES still spends its use', () => {
  const h = sterile(3798);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Grunt');                    // 1/1: absorbs ONE
  const s1 = spawn(h, P, 'T144 Bounded Shrinker');
  const s2 = spawn(h, P, 'T144 Bounded Shrinker');
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(aimAllAt(h, ally), 2, 'both [once] triggers were aimed at the 1/1');
  assert.equal(ent(h, ally), undefined, 'one counter, one death');
  assert.equal(h.log.filter(l => l.includes('fizzles')).length, 1, 'and one fizzle');
  const key = 'ability:T144 Bounded Shrinker#0';
  assert.equal(ent(h, s1)!.budgets[key], 1, 'the one that resolved spent its use');
  assert.equal(ent(h, s2)!.budgets[key], 1,
    'and so did the one that FIZZLED — R113: "regardless of if that ability resolves or doesn\'t"');
  assert.ok(!h.log.some(l => l.includes('its use is not spent')),
    'no refund was announced, because none was made');
});

// The aim is a decision like any other, so the replay depends on it being
// raised in a stable order and answered the same way. Same setup, same picks,
// same world.
test('R144(b): the aim is deterministic — same picks, same state', () => {
  const build = (): { h: Harness; ally: EntityId } => {
    const h = sterile(3799);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    const ally = spawn(h, P, 'T37 Brute');
    whiteBox(h, e => { e.createWraith(P); e.createWraith(P); e.createWraith(P); });
    toNextBattle(h, P);
    finishBattle(h);
    aimAllAt(h, ally);
    return { h, ally };
  };
  const a = build(), b = build();
  assert.deepEqual(b.h.state, a.h.state, 'same actions, same state');
  assert.deepEqual(b.h.actions, a.h.actions);
  assert.equal(a.h.state.rngState, b.h.state.rngState, 'and the RNG never diverged');
});

