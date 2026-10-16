/* Light & Dark engine wave C: the new attributes, the Wight, Modular, and the
 * last cast-time/extractor primitives.
 *
 *  - CR 802.22b, 802.22c {Blessed}: lifelink, and SIMULTANEOUS — the gain lands on the same
 *    game-state check as the damage, so it applies BEFORE the lethal check and
 *    a blessed source can never kill its own controller. All damage, combat
 *    and effect alike.
 *  - CR 802.23c {Afflicting}: when an afflicting source kills one or more units their
 *    controllers gain a rot — including kills by -1/-1 COUNTERS (the only way
 *    Umbral Decay, the sole afflicting card, kills anything). One rot per
 *    affected controller per kill event.
 *  - CR 802.24c {Lethal}: any combat damage from a lethal unit kills a player — and
 *    still does when the column's damage is replaced by rot, because a
 *    replaced hit still counts as having been dealt (Caleb 2024-10-24).
 *  - CR 608.8a Blightsea Polyp: a per-COLUMN replacement of combat damage to
 *    players — 1 rot whatever the column's power, life untouched.
 *  - CR 706.12, 721.6 The Wraith (retired name: Wight): a 0-mana 3/3 token that shrinks an
 *    ally at the start of deployment and mints a FRESH Wraith augment when it
 *    dies. Two entry points (create / augment), one card, two printed names.
 *    Redesigned 2026-08-21; this retires the old Wraith ruling, under which the DYING Wraith
 *    re-attached itself instead of being erased.
 *  - CR 410.5a A dying token enters the bin and is then erased by a state-based
 *    sweep — and CR 801.2d: it is NOT trashed there (a token is not a card; this
 *    used to say it was, per the token ruling's withdrawn half); an Unstable (modded) unit is tested first
 *    and is erased with its mods, token or not.
 *  - {Modular}: mods applied to a card AS IT IS PLAYED — an additional cast
 *    cost (CR 724.3), riding on the stack with the spell.
 *  - TargetSpec 'cachedCard': a card in EITHER player's cache (CR 403.6, public).
 *  - CR 111.12 the "Discard me" play mode: pay the printed cost line, discard from
 *    hand, and the resulting trash fires the card's own trashed trigger.
 *
 * No Light & Dark card is scripted yet — every primitive here is proven with
 * synthetic test cards, the way the suite already tests bare mechanics.
 * Seeds: 3700-3799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import {
  allCardNames, getCard, registerSynthetic,
  type Printed, type ResolvedCached,
} from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, pass, pick, spawn,
  toDeployment, toNextBattle, withE as whiteBox,
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

// ── CR 802.22: {Blessed} ────────────────────────────────────────────────────


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

test('CR 802.22a {Blessed}: effect damage gains its controller exactly that much life', () => {
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

test('CR 802.22a {Blessed}: an identical unblessed source gains nothing', () => {
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

test('CR 802.22b {Blessed}: the gain lands BEFORE the lethal check — you heal before you die', () => {
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

test('CR 802.22b {Blessed}: without the attribute the same shot is lethal (the control)', () => {
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

test('CR 802.22a {Blessed}: combat damage to a player gains too', () => {
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

test('CR 802.22a {Blessed}: combat damage to a UNIT gains as well', () => {
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

// ── CR 802.23: {Afflicting} ─────────────────────────────────────────────────

test('CR 802.23c {Afflicting}: a -1/-1 COUNTER kill gives the dead unit\'s controller a rot', () => {
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

test('CR 802.23a {Afflicting}: the same kill without the attribute gives nobody a rot', () => {
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

test('CR 802.23b {Afflicting}: ONE rot per controller per kill event, however many died', () => {
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

test('CR 802.23a {Afflicting}: killing nothing gives no rot at all', () => {
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

test('CR 802.23d {Afflicting}: a plain COMBAT kill counts too', () => {
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

// ── CR 802.24c: {Lethal} + the Blightsea rot replacement ─────────────────────

test('CR 802.24a {Lethal}: any combat damage from a lethal unit kills the player', () => {
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

test('CR 608.8a Blightsea: a column\'s combat damage to a player becomes 1 rot, whatever its power', () => {
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

test('CR 608.8a Blightsea: the replacement is PER COLUMN', () => {
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

test('CR 802.24c {Lethal} still kills THROUGH the Blightsea replacement (the damage was still dealt)', () => {
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

// ── CR 110.2c: the Wraith (redesigned 2026-08-21; retires the old Wraith ruling) ──────────────

// The token was renamed Wight -> Wraith. Six cards print the current name;
// `Blight's End` still carries the retired one. Both must resolve to the SAME
// registered card, with the CURRENT name canonical — state stores 'Wraith',
// and 'Wight' exists only so an old printing still looks up.
test('Wraith and Wight are one card, and neither name is a second entry', () => {
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
test('the Wraith is EXTRACTED printed data, not a hand-written synthetic', () => {
  assert.ok(PRINTED['Wraith'], 'it is in printed.json (i.e. in the extractor POOL)');
  assert.equal(PRINTED['Wraith']!.power, 3);
  assert.equal(PRINTED['Wraith']!.image, 'Wraith.jpg', 'and it has its own printed art');
  assert.match(PRINTED['Wraith']!.text,
    /At the start of deployment, put a -1\/-1 counter on an ally\./);
  assert.match(PRINTED['Wraith']!.text, /When I die, Augment a Wraith onto an ally\./);
});

test('CR 304.4: "create a Wraith" spawns a real 3/3 token body', () => {
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
// text is live while it is a unit in play (CR 721.1d), so a Wraith BODY does this.
test('at the start of deployment a Wraith body shrinks a chosen ally', () => {
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
test('CR 110.4a ⚠: a lone Wraith may pick ITSELF as "an ally" (unconfirmed reading)', () => {
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

// The redesigned second line. The dying Wraith is NOT re-homed (that was the old Wraith ruling,
// retired): it is erased like any other token and a FRESH Wraith is minted.
test('CR 721.6: a dying Wraith mints a NEW Wraith onto a chosen ally', () => {
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

// "an ally" is not a TARGET (the word "target" is not printed), so it is
// exempt ON PURPOSE from choosing at the stack (CR 110.2): the ally is chosen on resolution.
// INVERTED 2026-10-16 (report round 2026-10-16), the owner verbatim: "Waiths
// can fizzle once you're fully out of units, but since they don't target, it's
// just a raw choice where it gets augmented." With no candidate the trigger
// asks nothing and does nothing, and the log now says it FIZZLES. (Was: 'with
// no ally left the death trigger does nothing — it cannot fizzle'.)
test('with no ally left the death trigger fizzles — it asks nothing and mints no Wraith', () => {
  const h = sterile(3734);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  whiteBox(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  assert.equal(h.state.decision, null, 'nothing to choose between');
  assert.equal(Object.values(h.state.entities).filter(e => e.card === 'Wraith').length, 0,
    'no body and no mod: gone');
  assert.ok(h.log.some(l => l.includes('Wraith fizzles — there is no ally to Augment a Wraith onto')),
    'and it says it fizzled for want of any ally');
});

// The token-zone ruling (CR 410.5), reversing the trashing rule's old carve-out — and the 2026-09-28 ruling (CR 801.2d)
// reversing the TRASH half of that again: this test used to be named "a dying
// Wraith IS trashed" and pinned one trash. The zone fact (bin, then erase)
// stands; a token is not a card, so it is not trashed.
test('CR 410.5a: a dying Wraith enters the bin untrashed, then is erased out of it', () => {
  const h = sterile(3735);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  let id = 0;
  whiteBox(h, e => { id = e.createWraith(P).id; });
  whiteBox(h, e => { e.destroy(e.entity(id)!, 'dies'); });
  assert.equal(trashes(h).length, 0, 'a token is NOT a card (CR 304.2), so entering a bin does not trash it (CR 801.2d)');
  assert.ok(h.events.some(ev => ev.type === 'erased' && ev.data!['card'] === 'Wraith' && ev.data!['from'] === 'bin'),
    'it did enter the bin — the sweep takes it out of one (CR 410.5a)');
  assert.deepEqual(h.state.players[P]!.bin, [], 'the state-based sweep erased it again');
  assert.deepEqual(h.q.erased(P), ['Wraith'], 'and it shows in the erased pile');
});

test('CR 721.6: "augment a Wraith onto a unit" makes the same token, directly as a mod', () => {
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
test('CR 721.1a: an augmented Wraith donates BOTH lines to its host', () => {
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

// CR 803.8e — the branch order in destroy(). This is game UZRG's bug: the token
// test used to come FIRST, so a modded token never reached the Unstable branch.
//
// The owner's 2026-08-24 Unstable-trash call (engine only, CT-246; CR 801.2h differs) inverted the trash half in place. This test used to be
// named "…no bin, no trash" and assert `trashes(h).length === 0`; the owner
// ruled that an Unstable death takes the token's route through the bin, so a
// Wraith body carrying a Wraith mod now trashes exactly ONCE — for the body,
// which is a token and so was trashed under the earlier reading (since reversed: tokens are not trashed), and NOT for the mod,
// which is a token MOD and has no card of its own to bin at all. Both flips
// are carried here rather than deleted: the branch order is still what the
// test is about, and one trash instead of two is the proof it is still right.
//
// The owner's 2026-09-28 ruling (now CR 801.2d) flips the BODY half back: the body is a TOKEN, and
// a token is never trashed, Unstable or not. The engine still trashes an Unstable
// CARD (224-mod-trash; CR 801.2h says it should not, CT-246); here both objects are tokens, so ZERO trashes. The
// branch order is proved by the Unstable log line and the two death triggers.
test('CR 803.8e: a MODDED token is Unstable — erased with its mods; CR 801.2d: neither the token body nor the token mod trashes', () => {
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
  assert.equal(trashes(h).length, 0,
    'NO trash: the body entered a bin but is a token (CR 801.2d); the token MOD never entered one (CR 410.4c)');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and the sweep emptied the bin again');
  assert.ok(h.log.some(l => l.includes('Unstable')), 'and it took the Unstable branch');
  // it still DIED, so both copies of the donated death text fired and each
  // minted a Wraith onto the only ally left standing
  assert.equal(modsOn(h, bystander).length, 2,
    'Unstable replaces the BIN, not the death — both death triggers still fired');
});

test('CR 720.7c: a token mod is erased with its host, never binned or trashed', () => {
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
  // The owner's 2026-08-23 ruling (now CR 724.5): a modded card is {Unstable} — Manual p.35, "as
  // long as a card is modded, it has the unstable attribute … even though mods
  // can be applied from the bin, they are generally only able to be applied
  // once". So the mod follows the card OUT OF THE GAME, not to a bin; this line
  // read `.bin.includes(...)` until that ruling landed.
  assert.ok(!h.state.players[A]!.bin.includes('T37 Graft Mod'), 'the mod does not reach a bin');
  assert.ok((h.state.players[A]!.erased ?? []).includes('T37 Graft Mod'),
    'it is erased with its carrier (CR 724.5)');
  assert.ok((h.state.players[A]!.erased ?? []).includes('T37 Modular Spell'),
    'and the carrier with it — Unstable is a BIN replacement, so neither reaches one');
  assert.equal(trashes(h).length, 0, 'from the stack, and never into a bin, so nothing was trashed (CR 801.2b)');
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

// ── TargetSpec 'cachedCard' (CR 403.6) ─────────────────────────────────────

test("CR 403.6: a 'cachedCard' target finds cards in BOTH players' caches", () => {
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

test('CR 403.6: a cached target that vanishes before resolution fizzles cleanly', () => {
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

test('cache uids are stable handles, and a pre-uid entry is simply untargetable', () => {
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

test('CR 110.1c: "recall UP TO ONE target cached card" still gains the life when nothing is aimed at', () => {
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
  pickBy(h, o => o.label === 'No targets');   // #206: nothing picked yet
  drainStack(h);
  assert.equal(h.state.players[A]!.life, life + 3, 'declining is a choice, not a fizzle');
  assert.deepEqual(h.q.cache(A).map(c => c.card), ['T37 Wall'], 'and the cache is untouched');
});

// ── CR 111.12: the "Discard me" play mode ───────────────────────────────────

test('CR 111.12: "Discard me" pays its own cost, trashes the card, and fires its own trigger', () => {
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
  assert.equal(t.length, 1, 'discarding from hand is trashing (CR 801.3)');
  assert.equal(t[0]!.data!['from'], 'hand');
  assert.equal(h.state.players[P]!.life, life + 7, "and the card's own trashed trigger resolved");
});

test('CR 111.12: "Discard me" is refused without the mana', () => {
  const h = sterile(3761);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'T37 Dropslime');
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.mode === 'discardMe'));
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx, mode: 'discardMe' }), IllegalAction);
  assert.ok(h.state.players[P]!.hand.includes('T37 Dropslime'), 'nothing happened');
});

test("CR 207.8: Nothyr's battle-timing discard-me line is refused outside battle", () => {
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

test("CR 207.8: Nothyr's discard-me mode works during battle, and its trigger uses the stack", () => {
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

test('CR 801.2a: the trashed trigger fires from the BIN, wherever the trash came from', () => {
  const h = sterile(3764);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const life = h.state.players[P]!.life;
  h.q.deckOf(P).unshift('T37 Dropslime');
  whiteBox(h, e => { e.mill(P, 1); });                     // milling trashes too (CR 801.2a)
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

/* ── CR 507.5, 706.12: DEPLOYMENT USES THE STACK, AND TRIGGERS MAY OVER-AIM ────────
 *
 * OWNER RULING, playtest report #101 (room SMVJ, action 318, 2026-08-24),
 * verbatim:
 *
 *   "Deployment should use the stack. All Wraith triggers should go onto the
 *    stack simultaneously and be allowed to target the same unit, even
 *    exceeding its defense (the final triggers would just fizzle)."
 *
 * Two halves, one commit each. (a) is this block; (b) is the one after it —
 * (b) was INVERTED on 2026-10-16, see its header.
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
 * CR 112.13d is NOT retested here: 43-dark-c.test.ts's "the start-of-deployment event
 * still fires after the rot replacement stopped to ask" already drives exactly
 * this path, and drives it harder now — under CR 706.3c that replacement trigger
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
// behind it. That is what "simultaneously" means mechanically. (Half (b) used
// to rest on it to aim a pile at one unit; since 2026-10-16 each trigger
// chooses as it resolves instead, and this half is unchanged.)
test('CR 507.4a: every start-of-deployment trigger is on the stack before any of them resolves', () => {
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
test('CR 706.3c: deployment triggers announce themselves onto the stack, all of them before the first resolves', () => {
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

// CR 101.6: the batch is shared but the AIM is not. Both seats' Wraiths fire into
// one queue and one stack, and each seat may still only shrink its own units in
// its own region — deployment puts each player alone in their home region.
test('CR 706.3c, 601.1b: a shared deployment stack does not let a Wraith reach across regions', () => {
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

// Crevice Lurker's tax is its "during battle" clause (CR 505.1b). Routing deployment
// through the stack must not invent a tax the card does not print, so the pay
// gate stays keyed on the BATTLE phase and a deployment trigger walks past it.
test('CR 507.5: the deployment stack is not taxed — CR 505.1b is a battle-phase gate', () => {
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

/* ── (b) CR 706.12: each Wraith trigger chooses its ally AS IT RESOLVES ──────────
 *
 * INVERTED 2026-10-16 (Discord report, report round 2026-10-16). The owner's
 * decision, verbatim, reversing his own 2026-08-24 ruling of report #101: "The
 * way that I *guessed* Wraiths work is wrong. It's this new way. They don't
 * target which means they can't be fizzled." And, clarifying: "Waiths can
 * fizzle once you're fully out of units, but since they don't target, it's
 * just a raw choice where it gets augmented." The report: "They should not
 * target and need to fully resolve their effect one at a time."
 *
 * From 2026-08-24 the deployment line was aimed in the STACK window (the
 * retired `EffectDef.subject` seam): several triggers could all name one 1/1
 * and the ones that outlived it fizzled. These tests pinned that, and now pin
 * the opposite: nothing is declared on the way to the stack (CR 110.2), each
 * trigger resolves fully before the next one asks, a unit an earlier trigger
 * killed is not on the next menu, and nothing fizzles while any ally is left.
 * Half (a) above (the whole batch is on the stack before the first resolves)
 * is unchanged.
 *
 * Still NOT a target: no `'targeted'` event, no redirect, invisible to every
 * targeting restriction (Mohruung, "when I become targeted, create a Crystal",
 * would otherwise pay out once per Wraith per deployment).
 */

/** a BOUNDED start-of-deployment shrinker that chooses on resolution, for the
 * CR 109.9a interaction below */
registerSynthetic(unit('T144 Bounded Shrinker', 1, 1), {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'], bounded: true,   // [once]
    label: 'put a -1/-1 counter on an ally',
    effect: {
      run: (g: E, ctx) => {
        const allies = g.unitsOf(ctx.controller, ctx.region);
        if (!allies.length) { g.ev('info', 'T144 Bounded Shrinker: no ally.'); return; }
        const id = allies.length === 1 ? allies[0]!.id : ctx.choose('shrink', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: 'T144 Bounded Shrinker: put a -1/-1 counter on an ally',
          options: allies.map(u => ({ label: u.card, value: u.id, card: u.card })),
        }) as number;
        g.addCounters(g.entity(id)!, -1);
      },
    },
  }],
});

/** answer every pending ally question with `id` when it is offered (else the
 * first option); returns, per question, whether `id` was on the menu */
function chooseEach(h: Harness, id: EntityId): boolean[] {
  const offered: boolean[] = [];
  let guard = 20;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    const i = dec.options.findIndex(o => o.value === id);
    offered.push(i !== -1);
    h.do({ type: 'decide', seat: dec.seat, choice: Math.max(0, i) });
  }
  return offered;
}

// The report's case, executed. Three Wraiths, one 1/1: the first trigger is
// offered the 1/1 and kills it; the second and third are asked only after
// that, the 1/1 is not on their menus, and their counters land on Wraiths.
// Under the 2026-08-24 ruling all three were asked up front, all three named
// the 1/1, and two fizzled.
test('CR 706.12: three Wraith triggers and one 1/1 choose as each resolves, so only the first is offered the 1/1 and none fizzles', () => {
  const h = sterile(3794);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Grunt');                    // 1/1: absorbs ONE
  let w1 = 0, w2 = 0, w3 = 0;
  whiteBox(h, e => { w1 = e.createWraith(P).id; w2 = e.createWraith(P).id; w3 = e.createWraith(P).id; });
  toNextBattle(h, P);
  finishBattle(h);                                          // → next deployment
  assert.deepEqual(chooseEach(h, ally), [true, false, false],
    'three questions, one per resolution; the dead 1/1 is offered only to the first');
  assert.equal(ent(h, ally), undefined, 'it took its one counter and died');
  assert.ok(!h.log.some(l => l.includes('fizzle')), 'nothing fizzled');
  const lost = [w1, w2, w3].reduce((n, w) => n + (3 - effStats(h, w)[1]), 0);
  assert.equal(lost, 2, 'the other two counters landed on Wraiths still in play');
});

// The arithmetic version: a 4/4 absorbs exactly four -1/-1 counters
// (4/4 → 3/3 → 2/2 → 1/1 → 0/0, dead). It is offered while it lives and not
// after, and the fifth counter goes on a unit still in play.
test('CR 706.12: a 4/4 is offered to Wraith triggers only while it is in play, and the fifth counter still lands', () => {
  const h = sterile(3795);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Brute');                    // 4/4: absorbs FOUR
  whiteBox(h, e => { for (let i = 0; i < 5; i++) e.createWraith(P); });
  toNextBattle(h, P);
  finishBattle(h);
  assert.deepEqual(chooseEach(h, ally), [true, true, true, true, false]);
  assert.equal(ent(h, ally), undefined, 'four counters killed it');
  assert.ok(!h.log.some(l => l.includes('fizzle')), 'and nothing fizzled');
});

// A lone Wraith: its only ally is itself, so nothing is asked and it shrinks.
// RENAMED 2026-10-16 from 'CR 706.12: "no ally at all" still does nothing — it
// is not a fizzle': the body never had "no ally" (the Wraith is its own), and
// under the owner's clarification a Wraith with NO ally at all now fizzles —
// that case is 461-wraith-no-ally-and-one-ally.test.ts's job.
test('CR 706.12: a lone Wraith is its own only ally — it shrinks itself without asking, and nothing fizzles', () => {
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

// The properties of a TARGET the Wraith's "an ally" does not have (CR 110.2a).
// The expensive one: Mohruung prints "when I become targeted, create a
// Crystal", and a pool where this fired would hand its controller a free
// Crystal per Wraith per deployment.
test('CR 706.12a: a subject is not a target — no "targeted" event is ever fired for it', () => {
  const h = sterile(3797);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Brute');
  whiteBox(h, e => { e.createWraith(P); e.createWraith(P); });
  const from = h.events.length;
  toNextBattle(h, P);
  finishBattle(h);
  chooseEach(h, ally);
  assert.equal(h.events.slice(from).filter(ev => ev.type === 'targeted').length, 0,
    'the word "target" is still not printed on the card, and nothing behaves as if it were');
  assert.deepEqual(effStats(h, ally), [2, 2], 'both counters landed all the same');
});

// CR 109.9a: a bounded use is spent by reaching the stack. A chooser that
// chooses on resolution has nothing to lose while an ally is left, so both
// [once] triggers resolve and both spend their use; the second simply chooses
// among what is left. (Fizzle-spends-the-use is 93-engine-defects.test.ts's job.)
test('CR 706.12 x CR 109.9a: a bounded chooser that chooses on resolution spends its use and never fizzles', () => {
  const h = sterile(3798);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ally = spawn(h, P, 'T37 Grunt');                    // 1/1: absorbs ONE
  const s1 = spawn(h, P, 'T144 Bounded Shrinker');
  const s2 = spawn(h, P, 'T144 Bounded Shrinker');
  toNextBattle(h, P);
  finishBattle(h);
  assert.deepEqual(chooseEach(h, ally), [true, false],
    'the first is offered the 1/1 and kills it; the second asks after, without it');
  assert.equal(ent(h, ally), undefined, 'one counter, one death');
  assert.ok(!h.log.some(l => l.includes('fizzle')), 'nothing fizzled');
  const key = 'ability:T144 Bounded Shrinker#0';
  const left = [s1, s2].filter(s => ent(h, s));
  assert.ok(left.length >= 1, 'the second counter landed on a Shrinker, and at most one died of it');
  for (const s of left) assert.equal(ent(h, s)!.budgets[key], 1, 'each [once] that resolved spent its use');
  assert.ok(!h.log.some(l => l.includes('its use is not spent')), 'no refund was announced');
});

// The choice is a decision like any other, so the replay depends on it being
// raised in a stable order and answered the same way. Same setup, same picks,
// same world.
test('CR 706.12: the aim is deterministic — same picks, same state', () => {
  const build = (): { h: Harness; ally: EntityId } => {
    const h = sterile(3799);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    const ally = spawn(h, P, 'T37 Brute');
    whiteBox(h, e => { e.createWraith(P); e.createWraith(P); e.createWraith(P); });
    toNextBattle(h, P);
    finishBattle(h);
    chooseEach(h, ally);
    return { h, ally };
  };
  const a = build(), b = build();
  assert.deepEqual(b.h.state, a.h.state, 'same actions, same state');
  assert.deepEqual(b.h.actions, a.h.actions);
  assert.equal(a.h.state.rngState, b.h.state.rngState, 'and the RNG never diverged');
});
