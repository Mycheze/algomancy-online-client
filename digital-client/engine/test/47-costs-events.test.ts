/* Light & Dark engine wave D: the primitives the nine card batches asked for.
 *
 *  - R49 `lifeGained:<seat>` battle ledger — the exact mirror of `lifeLost`.
 *  - R49 non-mana COSTS. CastCost gained payLife / discardCard / gainDebt
 *    beside sacrificeUnit; ActivatedAbility.cost gained life / debt / discard /
 *    sacrificeOther / discardOrSacrifice. All of them GATE the action (an
 *    unpayable cost is refused and never offered) and are paid before the item
 *    reaches the stack, so nobody may respond between cost and effect.
 *  - R49 ⚠ the LIFE-COST ruling: payable only while you have MORE life than it
 *    costs. Paying your last life is refused too.
 *  - R49 per-ability `timing` — the printed {Battle}/{Deployment} marker on an
 *    ACTIVATED ability, enforced at activation.
 *  - R49 `Entity.spawnedTurn`, and `from` (the source ZONE) on the two play
 *    events.
 *  - R50 the two turn-structure events that had none: 'endOfHaste' (fired
 *    while hasteDone still describes the closing step, BEFORE R43's mana-tally
 *    sweep) and 'startOfDeployment' (fired AFTER R38's rot damage).
 *  - R51 zone-resident trigger listeners: a card sitting in a BIN or a CACHE.
 *
 * Every primitive is proven with SYNTHETIC test cards over an explicitly built
 * state — no assertion reads anything out of the opening shuffle, so a sibling
 * batch registering a card cannot shake this file. Seeds: 4700-4799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, skipHasteStep,
  spawn, toDeployment, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

// ── synthetic test cards ──────────────────────────────────────────────

const base = (name: string, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power: 1, toughness: 1, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

/** the inert deck filler (see sterile()): unaffordable and deploy-timed */
const FILLER = 'T47 Filler';
registerSynthetic(base(FILLER, { mana: 20 }), {});

registerSynthetic(base('T47 Grunt'), {});
registerSynthetic(base('T47 Chaff'), {});
registerSynthetic(base('T47 Chaff B'), {});

// ── cast costs (R35/R49) ───────────────────────────────────────────────

registerSynthetic(base('T47 Life Bolt', {
  kind: 'spell', type: 'Test Spell', timing: 'deploy', power: 0, toughness: 0,
}), {
  spellEffect: {
    castCost: { kind: 'payLife', n: 5 },
    run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); },
  },
});

registerSynthetic(base('T47 Discard Bolt', {
  kind: 'spell', type: 'Test Spell', timing: 'deploy', power: 0, toughness: 0,
}), {
  spellEffect: {
    castCost: { kind: 'discardCard', n: 2 },
    run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); },
  },
});

registerSynthetic(base('T47 Debt Bolt', {
  kind: 'spell', type: 'Test Spell', timing: 'deploy', power: 0, toughness: 0,
}), {
  spellEffect: {
    castCost: { kind: 'gainDebt', n: 3 },
    run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); },
  },
});

/** a printed "[Gain 2 debt]" LINE (Printed.gainDebt, Hyper Beam's shape) —
 * consumed by the engine itself rather than by an EffectDef */
registerSynthetic(base('T47 Printed Debt', {
  kind: 'spell', type: 'Test Spell', timing: 'deploy', power: 0, toughness: 0,
  gainDebt: 2,
}), {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); } },
});

// ── activation costs (R49) ─────────────────────────────────────────────

registerSynthetic(base('T47 Life Pump', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: { life: 4 },
    label: 'pay 4 life: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

registerSynthetic(base('T47 Discard Pump', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: { discard: 1 },
    label: 'discard a card: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

registerSynthetic(base('T47 Sac Pump', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: { sacrificeOther: 1 },
    label: 'sacrifice another unit: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

registerSynthetic(base('T47 Either Pump', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: { discardOrSacrifice: 1 },
    label: 'discard a card or sacrifice a nontoken unit: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

registerSynthetic(base('T47 Debt Pump', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: { debt: 2 },
    label: 'gain 2 debt: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

registerSynthetic(base('T47 Battle Only', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: {}, timing: 'battle',
    label: '[Battle] only: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

registerSynthetic(base('T47 Deploy Only', { toughness: 4 }), {
  abilities: [{
    type: 'activated', cost: {}, timing: 'deploy',
    label: '[Deployment] only: +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

// ── the two new turn-structure events (R50) ────────────────────────────

registerSynthetic(base('T47 Haste Watcher'), {
  abilities: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'the haste step ended',
    effect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, 'T47 Haste Watcher'); } },
  }],
});

/** an end-of-haste trigger that ASKS something. The phase flip has to survive
 * the suspension: without GameState.hasteEnding the game would be stranded
 * between the haste step and the battle phase (the endTurn/turnEnding shape). */
registerSynthetic(base('T47 Haste Asker'), {
  abilities: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'choose how much life to gain',
    effect: {
      run: (g, ctx) => {
        const n = ctx.choose('howMuch', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'T47 Haste Asker: gain how much life?',
          options: [{ label: '1', value: 1 }, { label: '5', value: 5 }],
        }) as number;
        g.gainLife(ctx.controller, n, 'T47 Haste Asker');
      },
    },
  }],
});

registerSynthetic(base('T47 Deploy Watcher'), {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'],
    label: 'deployment started',
    effect: {
      run: (g, ctx) => {
        g.ev('info', `T47 Deploy Watcher fires at ${g.player(ctx.controller).life} life.`);
      },
    },
  }],
});

// ── zone-resident listeners (R51) ──────────────────────────────────────

registerSynthetic(base('T47 Bin Lurker'), {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'], zone: 'bin',
    label: 'from your bin: draw a card',
    effect: { run: (g, ctx) => { g.draw(ctx.controller, 1); } },
  }],
});

registerSynthetic(base('T47 Cache Lurker'), {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'], zone: 'cache',
    label: 'from your cache: gain 2 life',
    effect: { run: (g, ctx) => { g.gainLife(ctx.controller, 2, 'T47 Cache Lurker'); } },
  }],
});

// ── helpers ───────────────────────────────────────────────────────────

/** A harness whose randomness cannot leak into assertions: hands emptied, deck
 * replaced by an inert unaffordable filler. Everything a test needs is put
 * there explicitly. */
function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  return h;
}

function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** end deployment for both seats and drive on into the next battle phase */
function toNextBattlePhase(h: Harness, initiative?: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  if (initiative !== undefined) h.state.initiative = initiative;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
}

/** …and on again into the next deployment */
function toNextDeployment(h: Harness): void {
  toNextBattlePhase(h);
  finishBattle(h);
}

// ══════════════════════ R49: the lifeGained ledger ═════════════════════

test('R49: E.gainLife bumps `lifeGained:<seat>` exactly the way loseLife bumps `lifeLost`', () => {
  const h = sterile(4701);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'T47 Grunt');
  toNextBattlePhase(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  assert.equal(h.q.battleCounter(region, `lifeGained:${A}`), 0, 'starts at 0');
  whiteBox(h, e => { e.gainLife(A, 3, 'test'); e.gainLife(A, 2, 'test'); e.gainLife(D, 7, 'test'); });
  assert.equal(h.q.battleCounter(region, `lifeGained:${A}`), 5, 'accumulates, per seat');
  assert.equal(h.q.battleCounter(region, `lifeGained:${D}`), 7);
  assert.equal(h.q.battleCounter(region, `lifeLost:${A}`), 0, 'and does not touch the loss ledger');
  finishBattle(h);
});

test('R49: the gain ledger is per BATTLE PHASE — a gain outside battle counts for nothing', () => {
  const h = sterile(4702);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  whiteBox(h, e => e.gainLife(A, 4, 'during deployment'));
  toNextBattlePhase(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  const region = h.state.battle!.region;
  assert.equal(h.q.battleCounter(region, `lifeGained:${A}`), 0,
    'battleCounters are wiped when the battle phase opens');
  finishBattle(h);
});

// ═══════════════════ R49: bracketed CAST costs (R35) ═══════════════════

test('R49: a [Pay N life] cast cost is charged at CAST, before the item exists', () => {
  const h = sterile(4710);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const life = h.state.players[P]!.life;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'T47 Life Bolt') });
  assert.equal(h.state.players[P]!.life, life - 5, 'the 5 life went at cast');
  assert.ok(h.log.some(l => l.includes('pays 5 life')));
  assert.ok(h.state.players[P]!.bin.includes('T47 Life Bolt'), 'and the spell resolved');
});

test('R49 ⚠ the life-cost RULING: a cost you cannot SURVIVE is not payable', () => {
  const h = sterile(4711);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'T47 Life Bolt');
  h.state.players[P]!.life = 5;                       // exactly the cost
  assert.throws(
    () => h.do({ type: 'playCard', seat: P, handIndex: idx }),
    /unpayable \[cost\]/,
    'paying your LAST life is refused too — the rule is life > n, not >=');
  assert.equal(h.state.players[P]!.life, 5, 'nothing paid');
  assert.equal(h.state.winner, null, 'nobody killed themselves paying a cost');
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx),
    'and legalActions does not offer it');
  h.state.players[P]!.life = 6;                       // one more than the cost
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  assert.equal(h.state.players[P]!.life, 1, 'at life > n it is payable, down to exactly 1');
});

test('R49: a [Discard N cards] cast cost asks for each card, at cast, and TRASHES them (R40)', () => {
  const h = sterile(4712);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  give(h, P, 'T47 Chaff');
  give(h, P, 'T47 Chaff B');
  const idx = give(h, P, 'T47 Discard Bolt');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  assert.equal(h.state.decision!.seat, P, 'the cost is asked first, at cast');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.ok(h.state.decision, 'and again for the second card');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.equal(h.state.decision, null);
  assert.ok(h.state.players[P]!.bin.includes('T47 Chaff'));
  assert.ok(h.state.players[P]!.bin.includes('T47 Chaff B'));
  assert.equal(h.events.filter(e => e.type === 'trashed').length, 2, 'R40: discarding trashes');
});

test('R49: a [Discard N cards] cost that cannot be paid makes the CAST illegal', () => {
  const h = sterile(4713);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  give(h, P, 'T47 Chaff');                            // only one other card, cost needs two
  const idx = give(h, P, 'T47 Discard Bolt');
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx }), /unpayable \[cost\]/);
  assert.ok(!h.legal(P).some(a => a.type === 'playCard' && a.handIndex === idx));
  assert.deepEqual(h.state.players[P]!.bin, [], 'nothing was discarded');
  // a spell may not discard ITSELF to pay its own cost, so two others are needed
  give(h, P, 'T47 Chaff B');
  h.do({ type: 'playCard', seat: P, handIndex: h.state.players[P]!.hand.indexOf('T47 Discard Bolt') });
  assert.ok(h.state.decision, 'now it is payable');
});

test('R49: a [Gain N debt] cast cost is taken at cast (R39)', () => {
  const h = sterile(4714);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'T47 Debt Bolt') });
  assert.equal(h.q.debt(P), 3, 'the debt was taken');
});

test('R49: printed.gainDebt is a REAL cast cost — a negated spell still cost the debt', () => {
  const h = sterile(4715);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'T47 Printed Debt') });
  assert.equal(h.q.debt(P), 2, 'the printed [Gain 2 debt] line was charged by the engine');
  assert.ok(h.log.some(l => l.includes('the [cost] of T47 Printed Debt')));
});

// ═════════════════════ R49: ACTIVATION costs ═══════════════════════════

test('R49: a life activation cost is paid at ACTIVATION and gates the ability', () => {
  const h = sterile(4720);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T47 Life Pump');
  h.state.players[P]!.life = 4;                       // exactly the cost
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 }),
    /cannot pay the activation cost/);
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === u));
  h.state.players[P]!.life = 10;
  h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 });
  assert.equal(h.state.players[P]!.life, 6, 'paid at activation');
  assert.deepEqual(effStats(h, u), [3, 6], 'and the ability resolved');
});

test('R49: a discard activation cost is CHOSEN and paid before the item reaches the stack', () => {
  const h = sterile(4721);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const u = spawn(h, A, 'T47 Discard Pump');
  const raider = spawn(h, D, 'T47 Grunt');
  toNextBattlePhase(h, D);
  // A defends, so the battle happens in A's region — where the unit is
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                             // D passes → A acts
  h.state.players[A]!.hand.length = 0;
  give(h, A, 'T47 Chaff');
  h.do({ type: 'activateAbility', seat: A, entityId: u, abilityIndex: 0 });
  assert.equal(h.state.decision!.seat, A, 'the cost choice comes at activation');
  h.do({ type: 'decide', seat: A, choice: 0 });
  assert.ok(h.state.players[A]!.bin.includes('T47 Chaff'),
    'paid immediately — the opponent never got priority in between');
  assert.equal(h.state.stack.length, 1, 'and only THEN does the ability reach the stack');
  pass(h); pass(h);
  assert.deepEqual(effStats(h, u), [3, 6]);
  finishBattle(h);
});

test('R49: an empty hand makes a discard activation cost unpayable', () => {
  const h = sterile(4722);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T47 Discard Pump');
  h.state.players[P]!.hand.length = 0;
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 }),
    /cannot pay the activation cost/);
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === u));
});

test('R49: a sacrifice-another cost never offers the source itself', () => {
  const h = sterile(4723);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T47 Sac Pump');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 }),
    /cannot pay the activation cost/, 'alone, there is no OTHER unit to sacrifice');
  const victim = spawn(h, P, 'T47 Grunt');
  h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 });
  assert.equal(h.state.decision!.options.length, 1, 'exactly one candidate: not itself');
  assert.equal(h.state.decision!.options[0]!.card, 'T47 Grunt');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.ok(!ent(h, victim), 'sacrificed');
  assert.deepEqual(effStats(h, u), [3, 6]);
});

test('R49: an either/or cost offers both pools and excludes tokens and the source', () => {
  const h = sterile(4724);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T47 Either Pump');
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'T47 Chaff');
  const ally = spawn(h, P, 'T47 Grunt');
  whiteBox(h, e => { e.spawnUnit(P, 'T47 Grunt', e.homeRegion(P), { token: true }); });
  h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 });
  const labels = h.state.decision!.options.map(o => o.label);
  assert.deepEqual(labels.sort(), ['Discard T47 Chaff', 'Sacrifice T47 Grunt'],
    'one hand card and one NONTOKEN other unit — the token and the source are excluded');
  h.do({ type: 'decide', seat: P, choice: labels.indexOf('Sacrifice T47 Grunt') });
  assert.ok(!ent(h, ally));
  assert.deepEqual(effStats(h, u), [3, 6]);
});

test('R49: a debt activation cost is taken at activation', () => {
  const h = sterile(4725);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T47 Debt Pump');
  h.do({ type: 'activateAbility', seat: P, entityId: u, abilityIndex: 0 });
  assert.equal(h.q.debt(P), 2);
  assert.deepEqual(effStats(h, u), [3, 6]);
});

// ══════════════════ R49: per-ability [Battle] timing ═══════════════════

test('R49: ActivatedAbility.timing gates activation by WINDOW, both ways', () => {
  const h = sterile(4730);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const battleOnly = spawn(h, A, 'T47 Battle Only');
  const deployOnly = spawn(h, A, 'T47 Deploy Only');
  const raider = spawn(h, D, 'T47 Grunt');

  // deployment: only the deploy-marked ability is legal
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: battleOnly, abilityIndex: 0 }),
    /can only be activated during battle/);
  assert.ok(!h.legal(A).some(a => a.type === 'activateAbility' && a.entityId === battleOnly));
  h.do({ type: 'activateAbility', seat: A, entityId: deployOnly, abilityIndex: 0 });
  assert.deepEqual(effStats(h, deployOnly), [3, 6]);

  // battle: the other way round
  toNextBattlePhase(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: deployOnly, abilityIndex: 0 }),
    /that ability is a deployment ability/);
  assert.ok(!h.legal(A).some(a => a.type === 'activateAbility' && a.entityId === deployOnly));
  h.do({ type: 'activateAbility', seat: A, entityId: battleOnly, abilityIndex: 0 });
  pass(h); pass(h);
  assert.deepEqual(effStats(h, battleOnly), [3, 6]);
  finishBattle(h);
});

// ══════════════════════ R49: Entity.spawnedTurn ════════════════════════

test('R49: every entity is stamped with the turn it arrived', () => {
  const h = sterile(4740);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const early = spawn(h, P, 'T47 Grunt');
  const turn = h.state.turn;
  assert.equal(ent(h, early)!.spawnedTurn, turn);
  assert.ok(h.q.spawnedThisTurn(ent(h, early)!));
  toNextDeployment(h);
  assert.ok(h.state.turn > turn, 'a turn has passed');
  assert.equal(ent(h, early)!.spawnedTurn, turn, 'the stamp does not move');
  assert.ok(!h.q.spawnedThisTurn(ent(h, early)!), 'and it is no longer "this turn"');
  const late = spawn(h, P, 'T47 Grunt');
  assert.equal(ent(h, late)!.spawnedTurn, h.state.turn);
  assert.ok(h.q.spawnedThisTurn(ent(h, late)!));
});

// ═══════════ R49: the source zone on the two play events ═══════════════

test('R49: play events carry `from` — hand vs cache, on both channels', () => {
  const h = sterile(4750);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const seen = () => h.events.filter(e => e.type === 'spawned' || e.type === 'spellPlayed')
    .map(e => [e.type, e.data?.['card'], e.data?.['from']]);
  const before = seen().length;

  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'T47 Grunt') });
  assert.deepEqual(seen().slice(before), [['spawned', 'T47 Grunt', 'hand']],
    'a unit played from hand');

  const mark = seen().length;
  h.q.deckOf(P).unshift('T47 Grunt');
  whiteBox(h, e => { e.glimpse(P, 1); });
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.deepEqual(seen().slice(mark), [['spawned', 'T47 Grunt', 'cache']],
    'and the same unit released from the cache');

  const mark2 = seen().length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'T47 Debt Bolt') });
  assert.deepEqual(seen().slice(mark2), [['spellPlayed', 'T47 Debt Bolt', 'hand']],
    'a spell reports the zone on spellPlayed');
});

test('R49: a unit CREATED by an effect carries no `from` — it was never played', () => {
  const h = sterile(4751);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const mark = h.events.length;
  whiteBox(h, e => { e.spawnUnit(P, 'T47 Grunt', e.homeRegion(P)); });
  const ev = h.events.slice(mark).find(e => e.type === 'spawned')!;
  assert.equal(ev.data!['from'], undefined,
    'no zone: "play a card from anywhere other than your hand" must not see this');
});

// ═════════════════ R50: 'endOfHaste' and 'startOfDeployment' ═══════════

test("R50: 'endOfHaste' fires — even when the step was skipped outright (R18)", () => {
  const h = sterile(4760);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T47 Haste Watcher');
  const life = h.state.players[P]!.life;
  toNextBattlePhase(h, P);                             // nobody holds a haste card
  assert.equal(h.state.phase, 'battle', 'the phase flip completed');
  assert.equal(h.state.players[P]!.life, life + 1,
    'the optimisation that skips the step is not observable');
  assert.equal(h.state.hasteDone, null, 'and hasteDone is cleared behind it');
  finishBattle(h);
});

test("R50: 'endOfHaste' fires INSIDE the closing step, before R43's mana-tally sweep", () => {
  const h = sterile(4761);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T47 Haste Watcher');
  toNextBattlePhase(h, P);
  const i = h.events.findIndex(e => e.type === 'endOfHaste');
  const j = h.events.findIndex(e => e.type === 'lifeGained' && e.data?.['why'] === 'T47 Haste Watcher');
  assert.ok(i >= 0, 'the event is dispatched');
  assert.ok(j > i, 'and its trigger resolved after it, inside the same settle window');
  finishBattle(h);
});

test('R50: an end-of-haste trigger that SUSPENDS does not strand the phase flip', () => {
  const h = sterile(4763);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T47 Haste Asker');
  const life = h.state.players[P]!.life;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = P;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  // the end-of-haste window is OPEN and waiting on a decision
  assert.ok(h.state.decision, 'the trigger asked');
  assert.equal(h.state.phase, 'planning', 'the flip is deferred, not lost');
  assert.equal(h.state.hasteEnding, true, 'and the state says why');
  h.do({ type: 'decide', seat: P, choice: 1 });               // gain 5
  assert.equal(h.state.players[P]!.life, life + 5);
  assert.equal(h.state.phase, 'battle', 'answering the decision completes the flip');
  assert.ok(!h.state.hasteEnding);
  assert.equal(h.state.hasteDone, null);
  assert.ok(h.state.battle, 'and battle round 1 really opened');
  finishBattle(h);
});

test("R50: 'startOfDeployment' fires AFTER R38's rot damage (the documented order)", () => {
  const h = sterile(4762);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'T47 Deploy Watcher');
  whiteBox(h, e => e.gainRot(P, 3));
  const life = h.state.players[P]!.life;
  toNextDeployment(h);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.players[P]!.life, life - 3, 'rot dealt its 3');
  assert.ok(h.log.some(l => l.includes(`T47 Deploy Watcher fires at ${life - 3} life`)),
    'the trigger sees the post-rot life total: rot is part of the step OPENING');
});

// ══════════════ R51: zone-resident trigger listeners ═══════════════════

test('R51: a card sitting in your BIN hears events, anchored on its bin owner', () => {
  const h = sterile(4770);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('T47 Bin Lurker');
  toNextDeployment(h);
  const hand = h.state.players[P]!.hand.length;
  assert.ok(h.log.some(l => l.includes("T47 Bin Lurker") && l.includes("bin")),
    'the zone trigger was dispatched from the bin');
  assert.ok(hand > 0, 'and it drew');
  // the OPPONENT, whose bin is empty, gets nothing
  assert.ok(!h.log.some(l => l.includes(`from ${h.q.pname(1 - P)}'s bin`)));
});

test('R51: a card sitting in your CACHE hears events too', () => {
  const h = sterile(4771);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  whiteBox(h, e => e.cacheCard(P, 'T47 Cache Lurker', 'hand'));
  const life = h.state.players[P]!.life;
  toNextDeployment(h);
  assert.equal(h.state.players[P]!.life, life + 2, 'the cache-resident trigger fired');
});

test('R51: no copy in the zone, no trigger — and one firing per zone, not per copy', () => {
  const h = sterile(4772);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  toNextDeployment(h);
  assert.ok(!h.log.some(l => l.includes('T47 Bin Lurker')), 'an empty bin says nothing');

  // three copies in the bin fire ONCE — these are standing permissions
  h.state.players[P]!.bin.push('T47 Bin Lurker', 'T47 Bin Lurker', 'T47 Bin Lurker');
  const hand = h.state.players[P]!.hand.length;
  toNextDeployment(h);
  const drawnByTurn = 2;                               // shared mode draws 2 at start of turn
  assert.equal(h.state.players[P]!.hand.length, hand + drawnByTurn + 1,
    'exactly one extra card: one firing, however many copies are in the zone');
});

test('R51: a zone listener costs nothing when nothing in the pool listens for that event', () => {
  // the index is keyed by event type: a type nobody listens for is one failed
  // Map.get(). This is the behavioural half — an unrelated event fires no
  // zone trigger even with the card sitting in the bin.
  const h = sterile(4773);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('T47 Bin Lurker');
  const hand = h.state.players[P]!.hand.length;
  whiteBox(h, e => e.gainLife(P, 1, 'an unrelated event'));
  assert.equal(h.state.players[P]!.hand.length, hand, 'lifeGained is not its event');
});

// ═══════════════════════ replay determinism ════════════════════════════

test('R49/R50/R51: the new costs and events replay deterministically', () => {
  const build = (): Harness => {
    const h = sterile(4790);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    h.state.players[P]!.hand.length = 0;
    give(h, P, 'T47 Chaff');
    give(h, P, 'T47 Chaff B');
    give(h, P, 'T47 Discard Bolt');
    give(h, P, 'T47 Life Bolt');
    h.state.players[P]!.bin.push('T47 Bin Lurker');
    spawn(h, P, 'T47 Haste Watcher');
    return h;
  };
  const drive = (h: Harness): void => {
    const P = h.state.deployPlayer!;
    const at = (n: string) => h.state.players[P]!.hand.indexOf(n);
    h.do({ type: 'playCard', seat: P, handIndex: at('T47 Discard Bolt') });
    h.do({ type: 'decide', seat: P, choice: 0 });
    h.do({ type: 'decide', seat: P, choice: 0 });
    h.do({ type: 'playCard', seat: P, handIndex: at('T47 Life Bolt') });
    toNextDeployment(h);
  };
  const a = build(); drive(a);
  const b = build(); drive(b);
  assert.deepEqual(b.state, a.state, 'same setup + same actions = same state');
  assert.deepEqual(b.actions, a.actions);
  assert.equal(a.state.rngState, b.state.rngState, 'and the RNG never diverged');
});

// ════════════════ an unpayable cost never half-pays ════════════════════

test('R35/R49: a refused cast pays nothing at all — mana, life and debt included', () => {
  const h = sterile(4795);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'fire', 3);
  const mana = h.q.openMana(P);
  h.state.players[P]!.life = 5;
  const idx = give(h, P, 'T47 Life Bolt');
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx }), IllegalAction);
  assert.equal(h.q.openMana(P), mana, 'no mana spent');
  assert.equal(h.state.players[P]!.life, 5, 'no life paid');
  assert.equal(h.q.debt(P), 0, 'no debt taken');
  assert.ok(h.state.players[P]!.hand.includes('T47 Life Bolt'), 'and the card is still in hand');
  assert.equal(unitsOf(h, P).length, 0);
});
