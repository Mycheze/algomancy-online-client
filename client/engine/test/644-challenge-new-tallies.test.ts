/* WEEKLY CHALLENGES — the tallies the 2026-10-24 goals read (src/challenge.ts
 * foldTallies, boardValue), each pinned on the events and states that feed it.
 * The reference runs (server test 506) prove every goal is reachable; this
 * proves what is and is not counted.
 *
 * §1 drawsInTurn: draws add up within a turn and start again at the next; the
 *    bottom step's "puts 2 on the bottom" (also a 'draw' event) is not a draw;
 *    the dummy's draws are not yours
 * §2 graftLadder (CR 722.4, 722.5a, 722.7): a graft cause's composite counts by
 *    its parts — a multiplier's repeats included — whether it resolves inside
 *    the action ('stackFlash') or waits in a battle window ('stackPushed');
 *    once per item; never an ability that is not a graft cause, never the
 *    dummy's
 * §3 manaSpent: resources that go from open to expended; nothing across the
 *    turn's refresh
 * §4 stackDepth: the most items the stack has held after any action
 * §5 life and tokenSet are read off the board: tokens by name, the player's
 *    only, each name capped at what the set asks
 * §6 the goal sentences and meter labels of the new kinds
 *
 * Seeds 64400-64499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import {
  DUMMY, PLAYER, foldRun, goalText, newChallengeGame, newRun, progress, progressLabel, type ChallengeDef, type Goal, type RunAcc,
} from '../src/challenge.ts';
import type { Action, CardName, EngineEvent, Entity, GameState, Seat, StackItem } from '../src/types.ts';

const DECK: CardName[] = Array.from({ length: 20 }, () => 'Crumbling Ancient');
const def = (goal: Goal): ChallengeDef => ({ id: 'n644', week: '2026-11-22', title: 'T', blurb: '', goal, seed: 64400, par: 1 });
const BASE = newChallengeGame(def({ kind: 'life', n: 100 }), DECK).state;
const pass: Action = { type: 'passPriority', seat: PLAYER };
const bottom: Action = { type: 'bottomCards', seat: PLAYER, handIndices: [0, 1] };
const ev = (type: string, data: Record<string, unknown>): EngineEvent => ({ type, msg: '', data } as unknown as EngineEvent);
const st = (change: (s: GameState) => void = () => {}): GameState => { const s = structuredClone(BASE); change(s); return s; };
const fold = (acc: RunAcc, events: EngineEvent[], opts: { action?: Action; before?: GameState; after?: GameState } = {}): RunAcc =>
  foldRun(acc, opts.before ?? st(), opts.action ?? pass, opts.after ?? opts.before ?? st(), events);
const item = (id: number, effectKey: string, parts: number, controller: Seat = PLAYER, kind = 'activated'): StackItem =>
  ({ id, kind, card: 'x', label: 'x', controller, region: 0, negated: false, sourceId: 2, event: null,
    parts: Array.from({ length: parts }, (_, i) => ({ effectKey: i ? 'graft:Sprouter' : effectKey, targets: [] })) } as unknown as StackItem);

test('§1 drawsInTurn: a turn of draws, the bottom step excluded, the next turn from 0', () => {
  const g = def({ kind: 'drawsInTurn', n: 6 });
  let acc = newRun(g.goal, DECK);
  acc = fold(acc, [ev('draw', { seat: PLAYER, n: 4 })]);
  acc = fold(acc, [ev('draw', { seat: PLAYER, n: 2 })], { action: bottom });
  assert.equal(progress(acc).value, 4, 'the two put on the bottom are not drawn');
  acc = fold(acc, [ev('draw', { seat: DUMMY, n: 3 }), ev('draw', { seat: PLAYER, n: 1 })]);
  assert.equal(progress(acc).value, 5, 'the dummy’s three are not yours'.replace('’', ''));
  acc = fold(acc, [ev('turn', { turn: 2 }), ev('draw', { seat: PLAYER, n: 4 })]);
  assert.equal(acc.draws?.n, 4, 'a new turn starts a new count');
  assert.equal(progress(acc).value, 5, 'and the best turn stays');
  acc = fold(acc, [ev('draw', { seat: PLAYER, n: 2 })]);
  assert.deepEqual(progress(acc), { value: 6, target: 6, met: true });
});

test('§2 CR 722.4 / graftLadder: composites by their parts, flashed or pushed, once each, graft causes only', () => {
  const g = def({ kind: 'graftLadder', n: 12 });
  let acc = newRun(g.goal, DECK);
  const EVOKER = 'ability:Omniwield Evoker#0';   // "[three]: [Switch] put a +1/+1 counter on me"
  // resolved inside the action (deployment): only the flash carries it, and a push may follow
  acc = fold(acc, [ev('stackFlash', { item: item(10, EVOKER, 3) }), ev('stackPushed', { id: 10, controller: PLAYER })]);
  assert.deepEqual(acc.graftSizes, [3], 'once, by its parts');
  // waiting in a battle window: on the stack after the action
  const after = st(s => { s.stack = [item(11, EVOKER, 7, PLAYER, 'triggered')]; });
  acc = fold(acc, [ev('stackPushed', { id: 11, controller: PLAYER })], { after });
  assert.deepEqual(acc.graftSizes, [3, 7]);
  // a multiplier's repeats are parts (CR 722.7): the item carries them
  acc = fold(acc, [ev('stackFlash', { item: item(12, EVOKER, 12) })]);
  assert.deepEqual(acc.graftSizes, [3, 7, 12]);
  // not a graft cause: Pack Leader's "[two]: create a 1/1"; not yours: the dummy's
  acc = fold(acc, [ev('stackFlash', { item: item(13, 'ability:Pack Leader#0', 1) })]);
  acc = fold(acc, [ev('stackFlash', { item: item(14, EVOKER, 1, DUMMY) })]);
  acc = fold(acc, [ev('stackFlash', { item: item(15, EVOKER, 5, PLAYER, 'spell') })]);
  assert.deepEqual(acc.graftSizes, [3, 7, 12], 'none of those');
  assert.deepEqual(progress(acc), { value: 3, target: 12, met: false });
  // a size over n is kept but is not progress
  const small = fold(newRun({ kind: 'graftLadder', n: 2 }, DECK), [ev('stackFlash', { item: item(16, EVOKER, 3) })]);
  assert.equal(progress(small).value, 0);
});

test('§3 manaSpent: open to expended, resource by resource, within a turn', () => {
  const g = def({ kind: 'manaSpent', n: 3 });
  const open3 = st(s => { s.players[PLAYER]!.resources = [0, 1, 2].map(() => ({ kind: 'earth', state: 'open' })); });
  const spent2 = st(s => { s.players[PLAYER]!.resources = [{ kind: 'earth', state: 'expended' }, { kind: 'earth', state: 'expended' }, { kind: 'earth', state: 'open' }]; });
  let acc = fold(newRun(g.goal, DECK), [], { before: open3, after: spent2 });
  assert.equal(progress(acc).value, 2);
  const nextTurn = st(s => { s.turn = BASE.turn + 1; s.players[PLAYER]!.resources = [0, 1, 2].map(() => ({ kind: 'earth', state: 'expended' })); });
  acc = fold(acc, [], { before: open3, after: nextTurn });
  assert.equal(progress(acc).value, 2, 'an action that crosses into the next turn is not read');
});

test('§4 stackDepth: the most items the stack held after any action', () => {
  const g = def({ kind: 'stackDepth', n: 4 });
  const withN = (n: number) => st(s => { s.stack = Array.from({ length: n }, (_, i) => item(30 + i, 'spell', 1)); });
  let acc = fold(newRun(g.goal, DECK), [], { after: withN(3) });
  acc = fold(acc, [], { after: withN(1) });
  assert.equal(progress(acc).value, 3, 'the deepest it got');
  acc = fold(acc, [], { after: withN(4) });
  assert.deepEqual(progress(acc), { value: 4, target: 4, met: true });
});

test('§5 life and tokenSet: read off the board', () => {
  const life = fold(newRun({ kind: 'life', n: 100 }, DECK), [], { after: st(s => { s.players[PLAYER]!.life = 127; }) });
  assert.deepEqual(progress(life), { value: 127, target: 100, met: true });
  const set: Goal = { kind: 'tokenSet', tokens: { Robot: 2, Crystal: 2 } };
  let id = 900;
  const ent = (card: CardName, kind: Entity['kind'], controller: Seat, token = true): Entity =>
    ({ id: id++, card, kind, controller, owner: controller, region: 0, damage: 0, counters: 0, tempPower: 0, tempToughness: 0, mods: [], budgets: {}, ...(token ? { token: true } : {}) } as Entity);
  const board = st(s => {
    for (const e of [ent('Robot', 'unit', PLAYER), ent('Robot', 'unit', PLAYER), ent('Robot', 'unit', PLAYER),
      ent('Crystal', 'spellToken', PLAYER), ent('Crystal', 'spellToken', DUMMY), ent('Fireball', 'spellToken', PLAYER)]) s.entities[e.id] = e;
  });
  const acc = fold(newRun(set, DECK), [], { after: board });
  assert.deepEqual(progress(acc), { value: 3, target: 4, met: false }, 'two Robots of three, one Crystal (the dummy’s is not yours)'.replace('’', ''));
});

test('§6 the new goals read as a player would say them', () => {
  assert.equal(goalText({ kind: 'tokenSet', tokens: { Robot: 5, Crystal: 5, Fireball: 5, Poison: 5 } }),
    'Control 5 Robots, 5 Crystals, 5 Fireballs and 5 Poisons at once');
  assert.equal(goalText({ kind: 'drawsInTurn', n: 15 }), 'Draw 15 cards in a single turn');
  assert.equal(goalText({ kind: 'graftLadder', n: 12 }), 'Fire a graft effect with exactly 1 part, one with exactly 2, … up to 12');
  assert.equal(goalText({ kind: 'manaSpent', n: 50 }), 'Spend 50 mana');
  assert.equal(goalText({ kind: 'stackDepth', n: 30 }), 'Have 30 effects on the stack at once');
  assert.equal(goalText({ kind: 'life', n: 100 }), 'Reach 100 life');
  for (const g of [{ kind: 'tokenSet', tokens: { Robot: 1 } }, { kind: 'drawsInTurn', n: 1 }, { kind: 'dummyWins' }, { kind: 'oneShot' },
    { kind: 'graftLadder', n: 1 }, { kind: 'manaSpent', n: 1 }, { kind: 'stackDepth', n: 1 }, { kind: 'life', n: 1 }] as Goal[]) {
    assert.ok(progressLabel(g).length > 2, `${g.kind} has a meter label`);
  }
});
