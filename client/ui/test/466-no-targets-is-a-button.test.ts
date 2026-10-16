/* Report #206 (APNA, Debeli): "when Minor Kraken attacks, grafted with fester
 * doesnt let me decline the "up to one"".
 *
 * The engine always offered the decline — `{ doneTargets: true }`, labelled
 * "No more targets" and drawn as the dim, dashed `declinebtn` at the far right
 * of the bar, where nobody looking for "none" finds it. The owner, verbatim:
 * *"Make there be a "No targets" as the button, especially for an "up to 1"
 * option. But also, up to x should just "finish" when the max number is
 * chosen. So Debeli would have chosen 1, then not had to find a "confirm" or
 * something button."*
 *
 * Guards:
 *  · nothing picked yet: the stop reads "No targets" and is an ordinary button
 *    (no declinebtn) — on the report's own board, Kraken with Fester grafted,
 *    attacking where only its own side's units are legal;
 *  · one or more picked: it may still read "No more targets", the quiet one;
 *  · an "up to N" slot finishes by itself at N picks — up to one (Kraken),
 *    up to two (Twin Flame) and up to X (Blight's End at X = 2) — with no
 *    further decision about that slot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { NO_MORE_TARGETS, NO_TARGETS } from '../../engine/src/cards/dsl.ts';
import { declineButtonClass } from '../inspect.ts';
import { ent, give, giveResources, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';

const isDone = (v: unknown): boolean => !!v && typeof v === 'object' && 'doneTargets' in (v as object);

function krakenBoard(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const kraken = spawn(h, A, 'Minor Kraken');
  const g = new E(h.state);
  g.attachMod(g.entity(kraken)!, 'Fester', A, 'graft');
  // a second own unit beside it in battle (the region the targets are in),
  // so a slot that failed to close would have something left to ask about
  const mate = g.spawnUnit(A, 'Unit Token', g.homeRegion(A), { token: true, tokenStats: [1, 1] }).id;
  g.settle();
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken], [mate]] });
  return { h, A, kraken };
}

test('report 206 - Kraken grafted with Fester offers No targets as an ordinary button', async () => {
  const ui = await client();
  const { h, A, kraken } = krakenBoard(6660);
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'targets', 'the Kraken asks for its up-to-one target as it attacks');
  assert.match(dec.prompt, /Minor Kraken/);
  const refs = dec.options.filter(o => !isDone(o.value));
  assert.ok(refs.length > 0 && refs.every(o => (o.value as { unit?: EntityId }).unit !== undefined
    && ent(h, (o.value as { unit: EntityId }).unit)!.controller === A),
  'the premise: only the attacker own units are legal (the opponent has none)');
  const stop = dec.options.findIndex(o => isDone(o.value));
  assert.equal(dec.options[stop]!.label, NO_TARGETS, 'nothing is picked yet, so it is not "more" of anything');
  assert.equal(declineButtonClass(dec.options[stop]!), '');
  const html = ui.join(h.state, A, legalActions(h.state, A));
  const btn = new RegExp(`<button ([^>]*)data-i="${stop}"[^>]*>${NO_TARGETS}</button>`).exec(html);
  assert.ok(btn, 'the bar draws it, labelled No targets');
  assert.doesNotMatch(btn![1]!, /declinebtn/, 'as an ordinary button, not the dim dashed decline');
  // and answering it declines: Fester is asked next, the Kraken recalls nothing
  h.do({ type: 'decide', seat: dec.seat, choice: stop });
  assert.ok(ent(h, kraken), 'nothing was recalled');
  assert.match(h.state.decision?.prompt ?? '', /Fester/, 'the grafted Fester is the next question');
});

test('report 206 - an up to one slot finishes at one pick with no further decision', () => {
  const { h, kraken } = krakenBoard(6661);
  pick(h, { unit: kraken });
  const d = h.state.decision;
  assert.ok(!d || !/Minor Kraken/.test(d.prompt), `the Kraken slot is closed (next: ${d?.prompt})`);
  assert.ok(!d || !d.options.some(o => isDone(o.value)), 'no stop button left to find');
  assert.match(d?.prompt ?? '', /Fester/, 'straight on to the grafted Fester');
});

test('report 206 - an up to two spell finishes at two picks, and after one the stop is No more targets', () => {
  const h = new Harness(6662);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = spawn(h, D, 'Good Whale'), b = spawn(h, D, 'Good Whale');
  const atk = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  assert.equal(h.state.decision!.options.find(o => isDone(o.value))!.label, NO_TARGETS);
  pick(h, { unit: a });
  const mid = h.state.decision!.options.find(o => isDone(o.value))!;
  assert.equal(mid.label, NO_MORE_TARGETS, 'one picked: the quiet "No more targets"');
  assert.equal(declineButtonClass(mid), 'declinebtn');
  pick(h, { unit: b });
  assert.ok(h.state.decision?.kind !== 'targets', 'two of up to two: the collection closes itself');
  assert.equal(h.state.stack.at(-1)?.card, 'Twin Flame');
  assert.deepEqual(h.state.stack.at(-1)!.parts[0]!.targets, [{ unit: a }, { unit: b }]);
});

test('report 206 - an up to X spell finishes at X picks', () => {
  const h = new Harness(6663);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Hammer of Justice');
  const theirs = spawn(h, D, 'Hammer of Justice');
  spawn(h, D, 'Good Whale');               // a third legal target, so stopping is a real stop
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, "Blight's End") });
  pick(h, 2);                              // X = 2
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  assert.ok(h.state.decision?.kind !== 'targets', 'X = 2 and two picked: nothing more is asked');
  assert.deepEqual(h.state.stack.at(-1)!.parts[0]!.targets, [{ unit: mine }, { unit: theirs }]);
});
