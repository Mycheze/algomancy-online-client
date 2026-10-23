/* WEEKLY CHALLENGES — the fold, the score and the verifier
 * (client/docs/21-weekly-challenges.md "Scoring"; src/challenge.ts).
 *
 *  §1–§5  every Goal kind, reached by a scripted game with real cards, with
 *         the meter rising short of the target before it is met
 *  §6     the score on a constructed example: three copies of one name (one
 *         extra), copies replayed — recalled by Invasive Species every
 *         deployment — counting once, recycled copies counting, cards only
 *         drawn or bottomed costing nothing
 *  §7–§11 verifyRun: accepts the recorded log and truncates what follows
 *         the goal; refuses a tampered player action (with `at`), a changed
 *         dummy action, a run that never gets there, a game that ends first,
 *         and an agreed fix smuggled into the log
 *
 * Seeds 49900-49999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { apply, createGame } from '../src/apply.ts';
import {
  BOARD_KINDS, DUMMY, DUMMY_DECK, PLAYER, challengeDeal, compareScores, foldRun, goalText, newChallengeGame, newRun,
  progress, progressLabel, scoreRun, settleDummy, verifyRun, type ChallengeDef, type Goal, type RunAcc, type RunScore,
} from '../src/challenge.ts';
import type { Action, CardName, Element, ResourceKind } from '../src/types.ts';

const SPRITE = 'Ignis Sprite';            // r, 1/1: "When I spawn or die, [Switch] Create a Fireball 1."
const SPECIES = 'Invasive Species';       // bg, 4/4: "[Augment] At the start of deployment, recall all your other units."
const SPORE = 'Noxious Sporefiend';       // g — recycled for resources here
const ANCIENT = 'Crumbling Ancient';      // e, 3/8
const SYNERGIST = 'Powerforge Synergist'; // m, 0/0: "I spawn with two +1/+1 counters."

const def = (seed: number, goal: Goal): ChallengeDef => ({ id: `t${seed}`, week: '2026-10-25', title: 'Test', blurb: '', goal, seed, par: 90 });

interface Plan {
  /** recycle these, in order, each once, for the element named */
  recycle?: [CardName, ResourceKind][];
  /** turn the active Prismites into these, in order */
  exchange?: Element[];
  /** the only cards the player plays */
  play: CardName[];
}

/**
 * A scripted player: bottom the last two cards, recycle per the plan, open
 * the newest dormant resources, exchange Prismites per the plan, play what the plan allows,
 * never attack. The dummy is settled before every player move. Runs until
 * the goal is met plus `extra` more player moves, or `turns` is passed.
 * Returns the harness and the fold over its WHOLE log, both seats.
 */
function drive(d: ChallengeDef, deck: CardName[], plan: Plan, opts: { turns?: number; extra?: number } = {}) {
  const h = newChallengeGame(d, deck);
  const recycle = [...(plan.recycle ?? [])];
  const exchange = [...(plan.exchange ?? [])];
  const pick = (legal: Action[]): Action | undefined => {
    const p = h.state.players[PLAYER]!;
    const by = (t: Action['type']) => legal.find(a => a.type === t);
    if (by('bottomCards')) {
      return legal.find(a => a.type === 'bottomCards' && a.handIndices[0] === p.hand.length - 2) ?? by('bottomCards');
    }
    for (const [i, [name, el]] of recycle.entries()) {
      const a = legal.find(x => x.type === 'recycleForResource' && p.hand[x.handIndex] === name && x.element === el);
      if (a) { recycle.splice(i, 1); return a; }
    }
    for (let i = p.resources.length - 1; i >= 0; i--) {
      const a = legal.find(x => x.type === 'activateResource' && x.index === i);
      if (a) return a;
    }
    if (exchange.length) {
      const a = legal.find(x => x.type === 'exchangePrismite' && x.element === exchange[0]);
      if (a) { exchange.shift(); return a; }
    }
    return legal.find(x => x.type === 'playCard' && plan.play.includes(p.hand[x.handIndex]!))
      ?? by('donePlanning') ?? by('doneHaste')
      ?? legal.find(x => x.type === 'declareAttack' && x.columns.length === 0)
      ?? legal.find(x => x.type === 'declareBlocks' && Object.keys(x.blocks).length === 0)
      ?? by('passPriority') ?? by('doneDeploying') ?? by('decide');
  };
  let extra = opts.extra ?? 0;
  for (let i = 0; i < 600 && h.state.phase !== 'gameover' && h.state.turn <= (opts.turns ?? 8); i++) {
    settleDummy(h);
    const a = pick(h.legal(PLAYER));
    assert.ok(a, `the scripted player has a move (turn ${h.state.turn}, ${h.state.phase})`);
    h.do(a);
    if (foldLog(d, deck, h.actions).met && extra-- <= 0) break;
  }
  return { h, acc: foldLog(d, deck, h.actions) };
}

/** fold a whole log from the bare deal — what a client's meter does */
function foldLog(d: ChallengeDef, deck: CardName[], actions: Action[], until?: (acc: RunAcc, i: number) => void): RunAcc {
  let state = createGame(d.seed, ['A', 'B'], 'constructed', undefined, [deck, [...DUMMY_DECK]], undefined, challengeDeal(d)).state;
  let acc = newRun(d.goal, deck);
  actions.forEach((a, i) => {
    const r = apply(state, a);
    acc = foldRun(acc, state, a, r.state, r.events);
    state = r.state;
    until?.(acc, i);
  });
  return acc;
}

/** the meter rose short of the target before it was met */
function sawProgress(d: ChallengeDef, deck: CardName[], actions: Action[]): number[] {
  const seen = new Set<number>();
  foldLog(d, deck, actions, acc => { if (!acc.met) seen.add(progress(acc).value); });
  return [...seen].sort((a, b) => a - b);
}

const SPRITES: CardName[] = Array.from({ length: 20 }, () => SPRITE);
const FIRE: Plan = { recycle: [[SPRITE, 'fire'], [SPRITE, 'fire']], exchange: ['fire', 'fire'], play: [SPRITE] };

test('§1 unitsInPlay: Ignis Sprites until four stand at once', () => {
  const d = def(49900, { kind: 'unitsInPlay', n: 4 });
  const { h, acc } = drive(d, SPRITES, FIRE);
  assert.equal(acc.met, true);
  assert.deepEqual(progress(acc), { value: 4, target: 4, met: true });
  assert.equal(Object.values(h.state.entities).filter(e => e.kind === 'unit' && e.controller === PLAYER).length, 4);
  assert.deepEqual(sawProgress(d, SPRITES, h.actions), [0, 1, 2, 3]);
  assert.equal(goalText(d.goal), 'Have 4 units in play at once');
  assert.equal(progressLabel(d.goal), 'Units in play');
});

test('§2 spellTokens: every Sprite that spawns creates a Fireball', () => {
  const d = def(49901, { kind: 'spellTokens', n: 3 });
  const { h, acc } = drive(d, SPRITES, FIRE);
  assert.equal(acc.met, true);
  assert.equal(progress(acc).value, 3);
  // regroup cleans unused spell tokens up, so count the creations, not the table
  const made = h.events.filter(e => e.type === 'tokenCreated' && (e.data as { seat?: number }).seat === PLAYER);
  assert.equal(made.length, 3, 'three Fireballs created');
  assert.ok(sawProgress(d, SPRITES, h.actions).includes(2));
  assert.equal(goalText(d.goal), 'Create 3 spell tokens');
});

test('§3 unitSize: a Crumbling Ancient is a 3/8', () => {
  const deck = Array.from({ length: 10 }, () => ANCIENT);
  const d = def(49902, { kind: 'unitSize', p: 3, t: 8 });
  const { h, acc } = drive(d, deck, { recycle: [[ANCIENT, 'earth']], exchange: ['earth', 'earth'], play: [ANCIENT] });
  assert.equal(acc.met, true);
  assert.deepEqual(progress(acc), { value: 8, target: 8, met: true });
  assert.deepEqual(sawProgress(d, deck, h.actions), [0]);
  // a bigger goal is progress short of met: 3/8 against 6/8 reads as half
  const far = foldLog(def(49902, { kind: 'unitSize', p: 6, t: 8 }), deck, h.actions);
  assert.deepEqual(progress(far), { value: 4, target: 8, met: false });
  assert.equal(goalText(d.goal), 'Have a 3/8 unit in play');
});

test('§4 counters: Powerforge Synergists spawn with two +1/+1 counters each', () => {
  const deck = Array.from({ length: 10 }, () => SYNERGIST);
  const d = def(49903, { kind: 'counters', n: 4 });
  const { h, acc } = drive(d, deck, { recycle: [[SYNERGIST, 'metal']], exchange: ['metal', 'metal'], play: [SYNERGIST] });
  assert.equal(acc.met, true);
  assert.equal(progress(acc).value, 4);
  assert.deepEqual(sawProgress(d, deck, h.actions), [0, 2]);
  assert.equal(goalText(d.goal), 'Put 4 +1/+1 counters on your units');
});

test('§5 unitsPlayed: every unit card played counts', () => {
  const d = def(49904, { kind: 'unitsPlayed', n: 3 });
  const { h, acc } = drive(d, SPRITES, FIRE);
  assert.equal(acc.met, true);
  assert.equal(progress(acc).value, 3);
  assert.deepEqual(sawProgress(d, SPRITES, h.actions), [0, 1, 2]);
  assert.equal(goalText({ kind: 'unitsPlayed', n: 1 }), 'Play 1 unit card');
});

/**
 * THE CONSTRUCTED EXAMPLE. Deck, top first:
 *   Species, Sprite ×3, Sporefiend ×2, filler ×2 | Sporefiend, filler ×11 | Sprite ×6
 * (the last six are never drawn by turn 4: they are there so the cap at the
 * copies in the deck cannot hide a replay counted twice)
 * Turn 1: the two fillers go to the bottom; both Sporefiends are recycled
 * (wood, water) and opened; Species is played off them.
 * Turn 2: the third Sporefiend comes up and is recycled for fire; the three
 * Sprites are played. Turns 3 and 4: Species recalls the Sprites at the start
 * of deployment and they are played again — the 10th play is turn 4's last.
 *   used: Species 1, Sprite 3 (played 9 times), Sporefiend 3 (recycled)
 *   unique 3, extra (3−2)+(3−2) = 2, cards 5, elements water/wood/fire = 3
 *   turns 4 → raw 5 × 3 × 4 = 60, and against par 90 Skill 90 ÷ 60 × 100 = 150.
 * The fillers were drawn and bottomed: free.
 */
const FILL = ANCIENT;
const EXAMPLE: CardName[] = [SPECIES, SPRITE, SPRITE, SPRITE, SPORE, SPORE, FILL, FILL, SPORE,
  ...Array.from({ length: 11 }, () => FILL), ...Array.from({ length: 6 }, () => SPRITE)];
const EXAMPLE_PLAN: Plan = {
  recycle: [[SPORE, 'wood'], [SPORE, 'water'], [SPORE, 'fire']], play: [SPECIES, SPRITE],
};
const exampleDef = def(49905, { kind: 'unitsPlayed', n: 10 });

test('§6 the score: extra copies count, a replayed copy counts once, drawn cards are free', () => {
  const { h, acc } = drive(exampleDef, EXAMPLE, EXAMPLE_PLAN);
  assert.equal(acc.met, true);
  const plays = h.actions.filter(a => a.type === 'playCard').length;
  assert.equal(plays, 10, 'Species once, the three Sprites three times each');
  assert.deepEqual(acc.used, { [SPECIES]: 1, [SPRITE]: 3, [SPORE]: 3 });
  assert.deepEqual(scoreRun(acc, exampleDef.par), { unique: 3, extra: 2, cards: 5, elements: 3, turns: 4, raw: 60, skill: 150 });
});

test('§7 verifyRun accepts the recorded log and drops what follows the goal', () => {
  const { h } = drive(exampleDef, EXAMPLE, EXAMPLE_PLAN, { extra: 6 });
  const metAt = h.actions.findIndex((_, i) => foldLog(exampleDef, EXAMPLE, h.actions.slice(0, i + 1)).met);
  assert.ok(metAt > 0 && metAt < h.actions.length - 1, 'the log runs on past the goal');
  const r = verifyRun(exampleDef, EXAMPLE, JSON.parse(JSON.stringify(h.actions)));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.actions.length, metAt + 1, 'truncated at the action that met the goal');
  assert.deepEqual(r.score, { unique: 3, extra: 2, cards: 5, elements: 3, turns: 4, raw: 60, skill: 150 });
  assert.ok(h.actions.some(a => a.seat === DUMMY), 'the log carries the dummy moves too');
});

test('§8 verifyRun refuses a tampered player action, with the index', () => {
  const { h } = drive(exampleDef, EXAMPLE, EXAMPLE_PLAN);
  const at = h.actions.findIndex(a => a.type === 'playCard');
  const bad = h.actions.map((a, i) => (i === at ? { ...a, handIndex: 99 } : a));
  const r = verifyRun(exampleDef, EXAMPLE, bad);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.at, at);
  // the same log against a different deck goes wrong too
  const swapped = [...EXAMPLE]; swapped[0] = SPORE;
  assert.equal(verifyRun(exampleDef, swapped, h.actions).ok, false);
  // a deck the challenge refuses is refused before any action
  assert.deepEqual(verifyRun(exampleDef, ['Training Construct'], h.actions).ok, false);
  assert.equal(verifyRun(exampleDef, EXAMPLE, 'nope').ok, false);
});

test('§9 verifyRun refuses a dummy action that is not dummyMove', () => {
  const { h } = drive(exampleDef, EXAMPLE, EXAMPLE_PLAN);
  const at = h.actions.findIndex(a => a.seat === DUMMY && a.type === 'donePlanning');
  assert.ok(at >= 0);
  // a dummy recycle would be refused by the engine anyway (no hand); a pass
  // the engine might take is still not the dummy's move
  for (const swap of [{ type: 'passPriority', seat: DUMMY }, { type: 'donePlanning', seat: DUMMY, extra: 1 }]) {
    const bad = h.actions.map((a, i) => (i === at ? swap as unknown as Action : a));
    const r = verifyRun(exampleDef, EXAMPLE, bad);
    assert.equal(r.ok, false, JSON.stringify(swap));
    assert.equal(!r.ok && r.at, at);
  }
  // a dummy move inserted where the dummy has none
  const extra = [...h.actions];
  extra.splice(at + 1, 0, { type: 'donePlanning', seat: DUMMY });
  const r = verifyRun(exampleDef, EXAMPLE, extra);
  assert.equal(!r.ok && r.at, at + 1);
});

test('§10 verifyRun refuses a run that never meets the goal, or a game that ends first', () => {
  const { h } = drive(exampleDef, EXAMPLE, EXAMPLE_PLAN);
  const short = verifyRun(exampleDef, EXAMPLE, h.actions.slice(0, -1));
  assert.deepEqual(short, { ok: false, error: 'the run never meets the goal' });
  const harder = def(49905, { kind: 'unitsPlayed', n: 11 });
  assert.equal(verifyRun(harder, EXAMPLE, h.actions).ok, false);
  const conceded = [...h.actions.slice(0, 5), { type: 'concede', seat: PLAYER } as Action];
  const r = verifyRun(exampleDef, EXAMPLE, conceded);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.at, 5);
  assert.match(!r.ok ? r.error : '', /ended/);
  assert.equal(verifyRun(exampleDef, EXAMPLE, h.actions, { maxActions: 3 }).ok, false, 'over the action cap');
});

test('§11 verifyRun refuses an agreed fix in the log, which the engine itself would accept', () => {
  const { h } = drive(exampleDef, EXAMPLE, EXAMPLE_PLAN);
  const fix = { type: 'amend', seat: PLAYER, by: DUMMY, edit: { kind: 'drawCards', target: PLAYER, n: 5 } } as Action;
  const r = verifyRun(exampleDef, EXAMPLE, [fix, ...h.actions]);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.at, 0);
});

test('§12 a tie is no win, on any board (the full orders are test 539)', () => {
  const s: RunScore = { unique: 5, extra: 0, cards: 5, elements: 2, turns: 4, raw: 40, skill: 225 };
  for (const k of BOARD_KINDS) assert.equal(compareScores(k, s, { ...s }), 0, k);
});
