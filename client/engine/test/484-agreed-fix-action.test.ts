/* BL-46 — THE AGREED FIX, AS AN ENGINE ACTION ("Beta: propose a fix").
 *
 * The owner, 2026-10-16: "Assuming both players agree, it doesn't change
 * anything in the game. it'll only be used to solve broken engine/game
 * issues." One seat proposes, the other agrees, and the server logs the edit
 * as an `amend` action (types.ts). This file pins what the ENGINE does with
 * one; the server's gate (no amend off a socket) is server/test/486.
 *
 *   §1 never offered: no amend in legalActions, in any state the walk meets
 *   §2 each v1 edit does what it says (life, draw, move, unit off the board)
 *   §3 QUIET (owner, accepting the recommendation): nothing triggers on a fix
 *      — each proved against the same move made the ordinary way, which does
 *   §4 refused: the same seat agreeing, a hidden step, an open decision, a
 *      card that is no longer where the proposer saw it, life 0
 *   §5 a log with fixes in it replays to the same board, twice
 *
 * Seeds 48400-48499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, legalActions, replay } from '../src/apply.ts';
import type { Action, AmendEdit, GameState, Seat } from '../src/types.ts';
import { spawn, toDeployment, toNextBattle } from './util.ts';

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const amend = (seat: Seat, edit: AmendEdit, by: Seat = other(seat)): Action => ({ type: 'amend', seat, by, edit });
const refusal = (s: GameState, a: Action): string => {
  try { apply(s, a); return ''; } catch (err) { return (err as Error).message; }
};

/** a battle window with a unit on the board, nobody being asked anything */
function battle(seed: number): { h: Harness; A: Seat; D: Seat; unit: number } {
  const h = new Harness(seed, ['Ann', 'Bo']);
  toDeployment(h);
  const A = h.state.initiative;
  const unit = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  assert.equal(h.state.phase, 'battle', 'fixture: in battle');
  assert.equal(h.state.decision, null, 'fixture: no question open');
  return { h, A, D: other(A), unit };
}

/* ── §1 ─────────────────────────────────────────────────────────────── */

test('§1 an agreed fix is never offered as a legal action', () => {
  const h = new Harness(48400, ['Ann', 'Bo']);
  let seen = 0;
  for (let step = 0; step < 120 && h.state.phase !== 'gameover'; step++) {
    for (const seat of [0, 1] as Seat[]) {
      const legal = legalActions(h.state, seat);
      seen += legal.length;
      assert.ok(!legal.some(a => a.type === 'amend'), `seat ${seat} was offered an amend at step ${step}`);
    }
    const seat = ([0, 1] as Seat[]).find(s => legalActions(h.state, s).length)!;
    if (seat === undefined) break;
    const legal = legalActions(h.state, seat);
    h.do(legal.find(a => a.type !== 'concede') ?? legal[0]!);
  }
  assert.ok(seen > 100, 'the walk saw real legal-action lists');
});

/* ── §2 ─────────────────────────────────────────────────────────────── */

test('§2 life: the target life total is SET, and the log says so publicly', () => {
  const { h, A, D } = battle(48410);
  const r = apply(h.state, amend(A, { kind: 'life', target: D, life: 7 }));
  assert.equal(r.state.players[D]!.life, 7);
  const line = r.events.find(e => e.data?.['amend'] === 'life');
  const name = h.state.players[D]!.name;
  assert.ok(line && line.msg.includes(`Agreed fix: set ${name}'s life to 7 (it was `) && /agreed by/.test(line.msg), line?.msg ?? "no line");
  assert.equal(line!.data?.['privateTo'], undefined, 'the line is for both seats');
});

test('§2 draw: the target draws N off the top of their deck', () => {
  const { h, A } = battle(48411);
  const top = h.state.sharedDeck.slice(0, 2);
  const before = h.state.players[A]!.hand.length;
  const r = apply(h.state, amend(A, { kind: 'drawCards', target: A, n: 2 }));
  assert.equal(r.state.players[A]!.hand.length, before + 2);
  assert.deepEqual(r.state.players[A]!.hand.slice(-2), top, 'the top two cards, in order');
  assert.deepEqual(r.state.sharedDeck, h.state.sharedDeck.slice(2));
});

test('§2 move: one of your cards between hand, bin, cache and the deck', () => {
  const { h, A } = battle(48412);
  const p = (s: GameState) => s.players[A]!;
  const card = p(h.state).hand[0]!;
  let s = apply(h.state, amend(A, { kind: 'move', from: 'hand', index: 0, card, to: 'bin' })).state;
  assert.equal(p(s).bin[p(s).bin.length - 1], card, 'hand → bin');
  s = apply(s, amend(A, { kind: 'move', from: 'bin', index: p(s).bin.length - 1, card, to: 'cache' })).state;
  assert.equal(p(s).cache!.at(-1)!.card, card, 'bin → cache');
  s = apply(s, amend(A, { kind: 'move', from: 'cache', index: p(s).cache!.length - 1, card, to: 'deckTop' })).state;
  assert.equal(s.sharedDeck[0], card, 'cache → the top of the deck');
  const card2 = p(s).hand[0]!;
  s = apply(s, amend(A, { kind: 'move', from: 'hand', index: 0, card: card2, to: 'deckBottom' })).state;
  assert.equal(s.sharedRecycled!.at(-1), card2, 'hand → the bottom of the deck, which is past the mark (CR 408.2)');
  s = apply(s, amend(A, { kind: 'drawCards', target: A, n: 1 })).state;
  assert.equal(p(s).hand.at(-1), card, 'and back into the hand off the top');
});

test('§2 unit: taken off the board to its controller hand, bin or deck bottom', () => {
  for (const to of ['hand', 'bin', 'deckBottom'] as const) {
    const { h, A, unit } = battle(48413);
    const s = apply(h.state, amend(other(A), { kind: 'unit', id: unit, card: 'Good Whale', to })).state;
    assert.equal(s.entities[unit], undefined, `${to}: the unit is gone from the board`);
    const p = s.players[A]!;
    const where = to === 'hand' ? p.hand : to === 'bin' ? p.bin : s.sharedRecycled ?? [];
    assert.equal(where[where.length - 1], 'Good Whale', `${to}: the card went to its controller's ${to}`);
  }
});

/* ── §3 quiet ───────────────────────────────────────────────────────── */

test('§3 quiet: a unit taken off the board neither dies nor despawns', () => {
  const { h, A, unit } = battle(48420);
  const r = apply(h.state, amend(A, { kind: 'unit', id: unit, card: 'Good Whale', to: 'bin' }));
  const kinds = r.events.map(e => e.type);
  for (const k of ['died', 'despawned', 'trashed'] as const) {
    assert.ok(!kinds.includes(k), `a fix emitted '${k}' — it must be quiet`);
  }
  assert.deepEqual(r.state.triggerQueue, [], 'nothing queued');
});

test('§3 quiet: a fix into the bin is not a trash (Afflicting Anima stays silent)', () => {
  const { h, A } = battle(48421);
  h.state.players[A]!.hand.push('Afflicting Anima');
  const i = h.state.players[A]!.hand.length - 1;
  const r = apply(h.state, amend(A, { kind: 'move', from: 'hand', index: i, card: 'Afflicting Anima', to: 'bin' }));
  assert.ok(!r.events.some(e => e.type === 'trashed'), 'no trash event');
  assert.deepEqual(r.state.triggerQueue, [], 'its "when I am trashed" did not queue');
  // the positive control: the same card discarded the ordinary way IS trashed
  const s2 = structuredClone(h.state);
  const e = new E(s2);
  e.player(A).hand.splice(i, 1);
  e.toBin(A, 'Afflicting Anima', 'hand');
  assert.ok(e.events.some(ev => ev.type === 'trashed'), 'control: an ordinary discard trashes it');
});

test('§3 quiet: a card leaving the bin by a fix does not fire leftBin (Rotling stays silent)', () => {
  const { h, A } = battle(48422);
  h.state.players[A]!.bin.push('Rotling');
  const i = h.state.players[A]!.bin.length - 1;
  const r = apply(h.state, amend(A, { kind: 'move', from: 'bin', index: i, card: 'Rotling', to: 'hand' }));
  assert.deepEqual(r.state.triggerQueue, [], 'Rotling queued nothing');
  const s2 = structuredClone(h.state);
  const e = new E(s2);
  e.removeFromBin(A, i, 'control');
  assert.ok(s2.triggerQueue.length > 0, 'control: the same card leaving the bin the ordinary way does queue its trigger');
});

test('§3 quiet: a fix draw is not a draw for anything listening', () => {
  const { h, A } = battle(48423);
  const r = apply(h.state, amend(A, { kind: 'drawCards', target: A, n: 1 }));
  assert.ok(!r.events.some(e => e.type === 'draw'), 'no draw event to hear');
  assert.deepEqual(r.state.triggerQueue, []);
});

/* ── §4 refused ─────────────────────────────────────────────────────── */

test('§4 refused: agreed by the proposer, in a hidden step, with a question open', () => {
  const { h, A, D } = battle(48430);
  assert.match(refusal(h.state, amend(A, { kind: 'life', target: D, life: 5 }, A)), /agreed by the other player/);
  const plan = new Harness(48431, ['Ann', 'Bo']);
  assert.match(refusal(plan.state, amend(0, { kind: 'drawCards', target: 0, n: 1 })), /hidden planning, haste or deploy/);
  const dep = new Harness(48432, ['Ann', 'Bo']);
  toDeployment(dep);
  assert.match(refusal(dep.state, amend(0, { kind: 'drawCards', target: 0, n: 1 })), /hidden planning, haste or deploy/);
  const asked = structuredClone(h.state);
  asked.decision = { id: 1, seat: D, kind: 'targets', prompt: 'x', options: [] } as unknown as GameState['decision'];
  assert.match(refusal(asked, amend(A, { kind: 'drawCards', target: A, n: 1 })), /decision is pending/);
});

test('§4 refused: a card that is no longer where the proposer saw it, and life 0', () => {
  const { h, A, D, unit } = battle(48433);
  const card = h.state.players[A]!.hand[0]!;
  assert.match(refusal(h.state, amend(A, { kind: 'move', from: 'hand', index: 0, card: `${card}x`, to: 'bin' })), /no longer/);
  assert.match(refusal(h.state, amend(A, { kind: 'move', from: 'hand', index: 99, card, to: 'bin' })), /no card at that place/);
  assert.match(refusal(h.state, amend(A, { kind: 'move', from: 'hand', index: 0, card, to: 'hand' })), /already there/);
  assert.match(refusal(h.state, amend(A, { kind: 'unit', id: unit, card: 'Lilbot', to: 'hand' })), /no longer Lilbot/);
  assert.match(refusal(h.state, amend(A, { kind: 'life', target: D, life: 0 })), /between 1 and 999/);
  assert.match(refusal(h.state, amend(A, { kind: 'drawCards', target: D, n: 0 })), /between 1 and 10/);
});

/* ── §5 replay ──────────────────────────────────────────────────────── */

test('§5 a log with agreed fixes in it replays to the same board, twice', () => {
  // the whole log through logged actions only, so `replay` can rebuild it
  const h = new Harness(48440, ['Ann', 'Bo']);
  const log: Action[] = [];
  const act = (a: Action): void => { h.do(a); log.push(a); };
  let fixes = 0;
  const recycled = new Set<string>();
  for (let step = 0; step < 400 && h.state.phase !== 'gameover' && fixes < 3; step++) {
    const s = h.state;
    if (s.phase === 'battle' && !s.decision && s.priority !== null) {
      const P = s.priority as Seat;
      act(amend(P, fixes === 0 ? { kind: 'drawCards', target: P, n: 1 }
        : fixes === 1 ? { kind: 'life', target: other(P), life: 12 }
          : { kind: 'move', from: 'hand', index: 0, card: s.players[P]!.hand[0]!, to: 'bin' }));
      fixes++;
    }
    const seat = ([0, 1] as Seat[]).find(x => legalActions(h.state, x).length);
    if (seat === undefined) break;
    const legal = legalActions(h.state, seat);
    const key = `${h.state.turn}:${seat}`;
    const rec = legal.find(a => a.type === 'recycleForResource');
    const pick = rec && !recycled.has(key) ? (recycled.add(key), rec)
      : legal.find(a => a.type === 'activateResource')
        ?? (h.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
        ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
        ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? legal[0]!;
    act(pick);
  }
  assert.ok(log.filter(a => a.type === 'amend').length >= 1, 'the walk reached a battle window and logged a fix');
  const a = replay(48440, log, ['Ann', 'Bo']).state;
  const b = replay(48440, log, ['Ann', 'Bo']).state;
  assert.equal(JSON.stringify(a), JSON.stringify(h.state), 'the replay is the game');
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'and deterministic');
});
