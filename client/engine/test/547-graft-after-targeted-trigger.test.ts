/**
 * CR 110.11 / CT-242 — a graft onto Mohruung attaches only AFTER Mohruung's
 * "when I become targeted" trigger has resolved.
 *
 * Designer (RAQ Graft 101 point 5): "Applying Graft is 'targeting' effect, so
 * if you try to Graft something underneath the Mohruung, he will trigger
 * first". The engine fired the targeted event, attached the graft at once and
 * only then resolved the queued trigger, so the log read "Flame Juggle grafts
 * onto Mohruung" before "Resolving Mohruung: create a Crystal 2". The graft now
 * waits (GameState.pendingMods) until the targeted triggers are off the
 * stack — through a decision they raise, too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { viewFor } from '../../server/view.ts';
import { ent, give, giveResources, pass, pick, toDeployment, tokensOf, unitsOf } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

function mohruung(seed: number, grafts: string[] = []): { h: Harness; A: Seat; mohr: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const g = new E(h.state);
  const m = g.spawnUnit(A, 'Mohruung', g.homeRegion(A));
  grafts.forEach((c, i) => g.attachMod(m, c, A, 'graft', i));
  g.settle();
  h.state = g.s;
  giveResources(h, A, 'fire', 2);
  return { h, A, mohr: m.id };
}

const idx = (h: Harness, from: number, re: RegExp): number =>
  h.events.slice(from).findIndex(ev => re.test(ev.msg));

test('CR 110.11 / CT-242: grafting onto Mohruung resolves his trigger before the graft attaches', () => {
  const { h, A, mohr } = mohruung(5470);
  const n = h.events.length;
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: mohr, position: 0 });
  const crystal = idx(h, n, /creates a Crystal 2/);
  const grafted = idx(h, n, /Flame Juggle grafts onto Mohruung/);
  assert.ok(crystal >= 0 && grafted >= 0, 'both happened');
  assert.ok(crystal < grafted, `the Crystal (${crystal}) is made before the graft attaches (${grafted})`);
  assert.equal(ent(h, mohr)!.mods.length, 1, 'and the graft is on Mohruung');
  assert.equal(h.state.pendingMods, undefined, 'nothing is left waiting');
});

test('CR 110.11 / CT-242: a graft that triggers nothing attaches at once', () => {
  const h = new Harness(5471);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const g = new E(h.state);
  const boulder = g.spawnUnit(A, 'Bellowing Boulder', g.homeRegion(A)).id;
  g.settle();
  h.state = g.s;
  giveResources(h, A, 'fire', 2);
  const n = h.events.length;
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: boulder, position: 0 });
  assert.equal(ent(h, boulder)!.mods.length, 1);
  assert.ok(idx(h, n, /grafts onto Bellowing Boulder/) >= 0);
  assert.equal(h.state.pendingMods, undefined);
});

test('CR 110.11 / CT-242: the graft waits through a decision the trigger raises, unseen by the other seat', () => {
  // Overbloom grafted under Mohruung rides his trigger and asks for a target
  const { h, A, mohr } = mohruung(5472, ['Overbloom']);
  const D = (1 - A) as Seat;
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: mohr, position: 1 });
  assert.ok(h.state.decision, 'setup: the composite asks for the Overbloom target');
  assert.equal(ent(h, mohr)!.mods.length, 1, 'Flame Juggle is not attached yet');
  assert.equal(h.state.pendingMods?.length, 1, 'it is waiting');
  assert.equal(viewFor(h.state, A).pendingMods?.length, 1, 'its applier sees it waiting');
  assert.equal(viewFor(h.state, D).pendingMods, undefined, 'the other seat does not');
  pick(h, { unit: mohr });
  while (h.state.decision || h.state.stack.length) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  const cards = ent(h, mohr)!.mods.map(m => ent(h, m)!.card);
  assert.deepEqual(cards, ['Overbloom', 'Flame Juggle'], 'attached after, at the chosen position');
  assert.ok(tokensOf(h, A).some(t => t.card === 'Crystal'), 'and the Crystal was made');
  assert.equal(h.state.pendingMods, undefined);
});

test('CR 110.11 / CT-242: a graft whose host died to its own trigger goes to the bin', () => {
  // Feed to Hooba under Mohruung: "delete target unit" — Mohruung is the only one
  const { h, A, mohr } = mohruung(5473, ['Feed to Hooba']);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Flame Juggle'), hostId: mohr, position: 1 });
  while (h.state.decision || h.state.stack.length) {
    if (h.state.decision) pick(h, h.state.decision.options.find(o => JSON.stringify(o.value) === JSON.stringify({ unit: mohr }))?.value ?? h.state.decision.options[0]!.value);
    else pass(h);
  }
  assert.equal(ent(h, mohr), undefined, 'setup: Mohruung was deleted by his own composite');
  assert.ok(h.state.players[A]!.bin.includes('Flame Juggle'), 'the waiting graft went to the bin');
  assert.ok(h.events.some(ev => /Flame Juggle: its host left play before it could attach/.test(ev.msg)), 'and the log says so');
  assert.ok(!unitsOf(h, A).some(u => u.mods.some(m => ent(h, m)?.card === 'Flame Juggle')), 'it is on nothing');
  assert.equal(h.state.pendingMods, undefined);
});
