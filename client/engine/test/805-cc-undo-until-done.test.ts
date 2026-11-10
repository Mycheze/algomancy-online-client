/* Competitive Constructed — UNDO UNTIL DONE, the engine half (doc 22 §3.6;
 * the owner's answer of 2026-11-02, "Undo until Done").
 *
 * `sequentialStep` says which CC step is open and whose it is; `ccUndoMark`
 * says, per applied action, whether it can ever be taken back; `ccUndoFloor`
 * is the walk: the earliest of the asking seat's actions an undo may reach.
 * The server's rewind (W3) and the button (W6) are built on these; nothing
 * here touches a room.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { apply, IllegalAction } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { ccUndoFloor, ccUndoMark, sequentialStep, type CcUndoMark } from '../src/ccundo.ts';
import { Harness } from '../src/harness.ts';
import type { Action, EngineEvent, GameState, Seat } from '../src/types.ts';
import { ccBottomed, ccDecks, ccGame, ccToDeploy } from './cc-walk.ts';
import { give, giveResources } from './util.ts';

/** a CC Harness that keeps the server's per-action marks */
class Marked {
  readonly marks: CcUndoMark[] = [];
  readonly h: Harness;
  constructor(h: Harness) { this.h = h; }
  do(a: Action): EngineEvent[] {
    const before = this.h.state;
    const ev = this.h.do(a);
    this.marks.push(ccUndoMark(before, a, this.h.state, ev));
    return ev;
  }
  floor(seat: Seat): number { return ccUndoFloor(this.marks, seat, this.h.state); }
}

/** a Harness's history as Marked: re-applied action by action */
function marked(h: Harness, int: Seat): Marked {
  const m = new Marked(ccGame(int));
  for (const a of h.actions) m.do(a);
  return m;
}

test('CC undo: sequentialStep names the open step and the seat taking it', () => {
  const h = ccGame(1);
  assert.equal(sequentialStep(h.state), null, 'while both bottom, nobody owns a step');
  ccBottomed(h);
  assert.deepEqual(sequentialStep(h.state), { key: '1:plan:1', step: 'plan', seat: 1 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.deepEqual(sequentialStep(h.state), { key: '1:plan:0', step: 'plan', seat: 0 });
  ccToDeploy(h);
  assert.deepEqual(sequentialStep(h.state), { key: '1:deploy:1', step: 'deploy', seat: 1 });
  const house = new Harness(42, ['Ann', 'Bob'], 'constructed', undefined, ccDecks());
  assert.equal(sequentialStep(house.state), null, 'a house-rules game has no sequential step');
});

test('CC undo: the resource step is undoable back to its start, and only by the seat taking it', () => {
  const m = new Marked(ccGame(0));
  m.do({ type: 'bottomCards', seat: 1, handIndices: [0, 1] });
  m.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  const start = m.marks.length;
  assert.equal(m.floor(0), start, 'nothing yet');
  m.do({ type: 'activateResource', seat: 0, index: 0 });
  m.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'water' });
  m.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'fire' });
  assert.deepEqual(m.marks.slice(start).map(x => x.barrier), [null, null, null], 'a recycle is not a draw: the card goes to the bottom');
  assert.equal(m.floor(0), start, 'all three can be taken back');
  assert.equal(m.floor(1), m.marks.length, 'the NIT has nothing to undo in the INT step');
  m.do({ type: 'donePlanning', seat: 0 });
  assert.equal(m.marks.at(-1)!.barrier, 'done');
  assert.equal(m.floor(0), m.marks.length, 'never past a Done');
  assert.equal(m.floor(1), m.marks.length, 'the NIT step has only just opened');
  m.do({ type: 'recycleForResource', seat: 1, handIndex: 0, element: 'earth' });
  assert.equal(m.floor(1), m.marks.length - 1);
  assert.equal(m.floor(0), m.marks.length, 'the INT cannot reach back into a step it finished');
});

/** a deploy-timed card `seat` can play here whose play leaves no barrier and no question */
function quietPlay(m: Marked, seat: Seat, skip: Set<string>): string {
  for (const n of DECK_LIST) {
    if (skip.has(n) || getCard(n).timing !== 'deploy' || getCard(n).kind !== 'unit') continue;
    const s = structuredClone(m.h.state);
    s.players[seat]!.hand.push(n);
    try {
      const a: Action = { type: 'playCard', seat, handIndex: s.players[seat]!.hand.length - 1 };
      const r = apply(s, a);
      if (!r.state.decision && r.state.stack.length === 0 && ccUndoMark(s, a, r.state, r.events).barrier === null) return n;
    } catch (err) { if (!(err instanceof IllegalAction)) throw err; }
  }
  throw new Error('no quiet unit');
}

test('CC undo: a draw stands, and everything before it with it', () => {
  const m = marked(ccToDeploy(ccGame(0)), 0);
  for (const el of ['dark', 'fire', 'wood', 'water', 'earth', 'metal', 'light'] as const) giveResources(m.h, 0, el, 4);
  const quiet = quietPlay(m, 0, new Set(['Bloatfiend']));
  const start = m.marks.length;
  m.do({ type: 'playCard', seat: 0, handIndex: give(m.h, 0, quiet) });
  assert.equal(m.floor(0), start, 'a quiet play can be taken back');
  const deckBefore = m.h.state.decks![0]!.length;
  m.do({ type: 'playCard', seat: 0, handIndex: give(m.h, 0, 'Bloatfiend') });   // "When I spawn, draw a card."
  assert.equal(m.h.state.decks![0]!.length, deckBefore - 1, 'it drew');
  assert.equal(m.marks.at(-1)!.barrier, 'deck');
  assert.equal(m.floor(0), m.marks.length, 'the draw stands, and the quiet play before it too');
  m.do({ type: 'playCard', seat: 0, handIndex: give(m.h, 0, quietPlay(m, 0, new Set(['Bloatfiend']))) });
  assert.equal(m.floor(0), m.marks.length - 1, 'a play after the draw can be taken back, back to the draw');
});

test('CC undo: each barrier, read off the boards and never off a card list', () => {
  const h = ccToDeploy(ccGame(0));
  const s = h.state;
  const a: Action = { type: 'doneDeploying', seat: 0 };
  const quiet = (): GameState => structuredClone(s);
  const mark = (after: GameState, act: Action = { type: 'passPriority', seat: 0 } as Action, ev: EngineEvent[] = []) => ccUndoMark(s, act, after, ev);
  assert.equal(mark(quiet()).barrier, null);
  assert.equal(mark(quiet(), a).key, '1:deploy:0');
  { const t = quiet(); t.rngState = (t.rngState + 1) >>> 0; assert.equal(mark(t).barrier, 'random', 'a shuffle'); }
  { const t = quiet(); t.players[0]!.hand.push(t.decks![0]!.shift()!); assert.equal(mark(t).barrier, 'deck', 'a draw'); }
  { const t = quiet(); t.decks![0]!.unshift(t.players[0]!.hand.pop()!); assert.equal(mark(t).barrier, 'deck', 'a card put on top'); }
  { const t = quiet(); t.decks![0]!.reverse(); assert.equal(mark(t).barrier, 'deck', 'a reorder'); }
  { const t = quiet(); (t.recycled ??= [[], []])[0]!.push(t.players[0]!.hand.pop()!); assert.equal(mark(t).barrier, null, 'a recycle to the bottom'); }
  { const t = quiet(); t.seenHand = [{ turn: 1, cards: [...t.players[1]!.hand] }, null]; assert.equal(mark(t).barrier, 'seen', 'a looked-at hand'); }
  assert.equal(mark(quiet(), undefined, [{ type: 'glimpsed', msg: 'x' } as EngineEvent]).barrier, 'seen', 'a glimpse');
  assert.equal(mark(quiet(), undefined, [{ type: 'revealed', msg: 'x' } as EngineEvent]).barrier, 'seen', 'a reveal');
  { const t = quiet(); t.decision = { id: 9, seat: 1, kind: 'choice', prompt: 'p', options: [] } as never; assert.equal(mark(t).barrier, 'asks', 'a question for the other seat'); }
  { const t = quiet(); t.decision = { id: 9, seat: 0, kind: 'choice', prompt: 'p', options: [] } as never; assert.equal(mark(t).barrier, null, 'my own question (a cast awaiting targets)'); }
  assert.equal(mark(quiet(), { type: 'decide', seat: 1, choice: 0 }).barrier, 'other', "the other seat's answer");
  assert.equal(mark(quiet(), { type: 'amend', seat: 0 } as never).barrier, 'fix');
  { const t = quiet(); t.deployDone = [true, false]; t.deployPlayer = 1; assert.equal(mark(t, a).barrier, 'done'); }
  // a house-rules board: no step, no barrier, no walk
  const twin = structuredClone(s); delete twin.sequential;
  assert.deepEqual(ccUndoMark(twin, a, twin, []), { key: null, seat: 0, barrier: null, leftDecision: false, decide: false });
});

test('CC undo: a step that opened on a question keeps its answers', () => {
  const h = ccToDeploy(ccGame(0));
  const key = sequentialStep(h.state)!.key;
  const m = (over: Partial<CcUndoMark>): CcUndoMark => ({ key, seat: 0, barrier: null, leftDecision: false, decide: false, ...over });
  const marks: CcUndoMark[] = [
    m({ key: '1:haste:1', seat: 1, barrier: 'done', leftDecision: true }),   // the other seat's Done opened the step on a question
    m({ decide: true, leftDecision: true }),
    m({ decide: true }),                                                    // the start-of-step question answered
    m({}),
    m({}),
  ];
  assert.equal(ccUndoFloor(marks, 0, h.state), 3, 'back to the first free move, not into the answers');
  assert.equal(ccUndoFloor(marks, 1, h.state), marks.length, 'not the other seat\'s step');
  assert.equal(ccUndoFloor([...marks, m({ seat: 1, barrier: 'other' })], 0, h.state), 6, 'an answer by the other seat stops the walk');
  assert.equal(ccUndoFloor([...marks, m({ seat: 1 })], 0, h.state), 6, 'only my own actions, whatever the mark says');
  const noQuestion = [m({ key: '1:haste:1', seat: 1, barrier: 'done' }), m({ decide: true }), m({})];
  assert.equal(ccUndoFloor(noQuestion, 0, h.state), 1, 'a decide of my own (a target) is mine to take back');
});
