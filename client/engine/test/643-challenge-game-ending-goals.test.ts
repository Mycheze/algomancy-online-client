/* WEEKLY CHALLENGES — the two goals about how the game ends, and the first
 * goal that can FAIL a run (src/challenge.ts foldTallies, verifyRun).
 *
 * dummyWins (Own Goal): "Lose the game, but only to an effect the dummy
 * controls." Met on the action that ends the game with the dummy the winner
 * while an item the DUMMY controls is resolving (CR 104.1: the player at 0 is
 * eliminated). A concession is not an effect; neither is your own spell.
 *
 * oneShot (One and Done): "Defeat a 60-life dummy with one blow: any hit that
 * leaves it standing ends the run." Met when the action that kills the dummy
 * took life from it once. Any life the dummy loses and lives through FAILS the
 * run: verifyRun refuses it at that action, and the browser calls it failed.
 *
 * §1 dummyWins: the dummy's item ending the game meets it; the player's own
 *    item, a concession, and a dummy win with nothing resolving do not
 * §2 oneShot: one loss that kills meets it; two losses in the killing action
 *    fail it; a loss the dummy lives through fails it, and a failed run stays
 *    failed (nothing meets it afterwards)
 * §3 verifyRun refuses a real run whose attack the dummy lives through, at the
 *    action that dealt it, with the sentence
 *
 * Seeds 64300-64399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { apply, createGame } from '../src/apply.ts';
import {
  DUMMY, DUMMY_DECK, PLAYER, challengeDeal, foldRun, goalText, newChallengeGame, newRun, progress, runFailed, settleDummy, verifyRun,
  type ChallengeDef, type Goal, type RunAcc,
} from '../src/challenge.ts';
import type { Action, CardName, EngineEvent, GameState, Seat, StackItem } from '../src/types.ts';

const DECK: CardName[] = Array.from({ length: 20 }, () => 'Crumbling Ancient');
const def = (seed: number, goal: Goal, setup?: ChallengeDef['setup']): ChallengeDef =>
  ({ id: `e${seed}`, week: '2026-11-29', title: 'T', blurb: '', goal, seed, par: 1, ...(setup ? { setup } : {}) });
const pass: Action = { type: 'passPriority', seat: PLAYER };
const ev = (type: string, data: Record<string, unknown>): EngineEvent => ({ type, msg: '', data } as unknown as EngineEvent);
const item = (id: number, controller: Seat): StackItem =>
  ({ id, kind: 'triggered', card: 'Spirit of Vengeance', label: 'x', controller, region: 1, negated: false, parts: [], sourceId: 5, event: null } as unknown as StackItem);

/** the state a dealt game is in, and a copy of it with these changes */
function states(d: ChallengeDef, change: (s: GameState) => void, stack: StackItem[] = []): [GameState, GameState] {
  const before = structuredClone(newChallengeGame(d, DECK).state);
  before.stack = stack;
  const after = structuredClone(before);
  after.stack = [];
  change(after);
  return [before, after];
}

test('§1 dummyWins: met when an item the dummy controls ends the game in its favour', () => {
  const d = def(64300, { kind: 'dummyWins' });
  const ending = (s: GameState) => { s.players[PLAYER]!.life = 0; s.phase = 'gameover'; s.winner = DUMMY; };
  const fold = (controller: Seat | null, extra: Record<string, unknown> = {}): RunAcc => {
    const [b, a] = states(d, ending, controller === null ? [] : [item(9, controller)]);
    const evs = [...(controller === null ? [] : [ev('resolved', { id: 9 })]),
      ev('lifeLost', { seat: PLAYER, n: 1 }), ev('gameOver', { winner: DUMMY, ...extra })];
    return foldRun(newRun(d.goal, DECK), b, pass, a, evs);
  };
  assert.equal(fold(DUMMY).met, true, 'the dummy’s Spirit of Vengeance trigger deals the last point');
  assert.equal(fold(PLAYER).met, false, 'your own effect is not the dummy’s');
  assert.equal(fold(null).met, false, 'nothing of the dummy’s was resolving');
  assert.equal(fold(DUMMY, { conceded: PLAYER }).met, false, 'a concession is not an effect');
  assert.deepEqual(progress(fold(DUMMY)), { value: 1, target: 1, met: true });
  assert.equal(goalText(d.goal), 'Lose the game to an effect the dummy controls');
});

test('§2 oneShot: one killing loss meets it; any loss the dummy lives through, or a second loss, fails it', () => {
  const d = def(64301, { kind: 'oneShot' }, { dummyLife: 60 });
  const kill = (s: GameState) => { s.players[DUMMY]!.life = -4; s.phase = 'gameover'; s.winner = PLAYER; };
  const hit = (s: GameState) => { s.players[DUMMY]!.life = 57; };
  const once = (() => { const [b, a] = states(d, kill); return foldRun(newRun(d.goal, DECK), b, pass, a, [ev('lifeLost', { seat: DUMMY, n: 64 }), ev('gameOver', { winner: PLAYER })]); })();
  assert.equal(once.met, true);
  assert.equal(runFailed(once), null);
  const twice = (() => { const [b, a] = states(d, kill); return foldRun(newRun(d.goal, DECK), b, pass, a, [ev('lifeLost', { seat: DUMMY, n: 3 }), ev('lifeLost', { seat: DUMMY, n: 61 }), ev('gameOver', { winner: PLAYER })]); })();
  assert.equal(twice.met, false);
  assert.match(runFailed(twice) ?? '', /hit more than once/);
  const [b, a] = states(d, hit);
  const scratched = foldRun(newRun(d.goal, DECK), b, pass, a, [ev('lifeLost', { seat: DUMMY, n: 3 })]);
  assert.equal(scratched.met, false);
  assert.match(runFailed(scratched) ?? '', /lost life and lived/);
  // failed stays failed: the kill that follows does not count
  const [b2, a2] = states(d, kill);
  const after = foldRun(scratched, b2, pass, a2, [ev('lifeLost', { seat: DUMMY, n: 57 }), ev('gameOver', { winner: PLAYER })]);
  assert.equal(after.met, false);
  assert.equal(after, scratched, 'the fold stops at the failure');
  assert.equal(goalText(d.goal), 'Defeat the dummy with a single blow');
});

test('§3 oneShot: verifyRun refuses a real run the dummy lives through, at the attack that hit it', () => {
  const d = def(64302, { kind: 'oneShot' }, { dummyLife: 60 });
  const h = newChallengeGame(d, DECK);
  for (let i = 0; i < 600 && h.state.players[DUMMY]!.life === 60 && h.state.turn <= 6; i++) {
    settleDummy(h);
    const l = h.legal(PLAYER);
    const p = h.state.players[PLAYER]!;
    const atk = l.find(a => a.type === 'declareAttack' && a.columns.length === 1);
    const a = l.find(x => x.type === 'bottomCards')
      ?? l.find(x => x.type === 'activateResource')
      ?? l.find(x => x.type === 'exchangePrismite' && x.element === 'earth')
      ?? (h.state.turn > 1 && p.activationsLeft > 0 ? l.find(x => x.type === 'recycleForResource' && x.element === 'earth') : undefined)
      ?? l.find(x => x.type === 'playCard') ?? atk
      ?? l.find(x => x.type === 'donePlanning') ?? l.find(x => x.type === 'doneHaste')
      ?? l.find(x => x.type === 'declareBlocks' && Object.keys(x.blocks).length === 0)
      ?? l.find(x => x.type === 'declareAttack') ?? l.find(x => x.type === 'passPriority')
      ?? l.find(x => x.type === 'doneDeploying') ?? l.find(x => x.type === 'decide');
    assert.ok(a, `a move at turn ${h.state.turn} (${h.state.phase}): ${[...new Set(l.map(x => x.type))].join(' ')}`);
    h.do(a);
  }
  assert.ok(h.state.players[DUMMY]!.life < 60 && h.state.players[DUMMY]!.life > 0, `the dummy took a hit and lived (${h.state.players[DUMMY]!.life})`);
  const v = verifyRun(d, DECK, h.actions);
  assert.equal(v.ok, false);
  assert.ok(!v.ok && /lost life and lived/.test(v.error) && typeof v.at === 'number', v.ok ? '' : v.error);
  // the action it names is the one after which the dummy first stood below 60
  const at = (v as { at: number }).at;
  let st = createGame(d.seed, ['A', 'B'], 'constructed', undefined, [DECK, [...DUMMY_DECK]], undefined, challengeDeal(d)).state;
  for (let i = 0; i < at; i++) st = apply(st, h.actions[i]!).state;
  assert.equal(st.players[DUMMY]!.life, 60, 'untouched before it');
  assert.ok(apply(st, h.actions[at]!).state.players[DUMMY]!.life < 60, 'hit by it');
});
