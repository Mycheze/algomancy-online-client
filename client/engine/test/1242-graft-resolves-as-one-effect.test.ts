/**
 * CR 713.3a / report #390 (room NJJR) — A GRAFTED EFFECT RESOLVES AS ONE EFFECT:
 * no death is checked between its parts.
 *
 * proud's Galerider Eel trigger carried Overwhelm and Recall as grafts: one
 * effect on the stack — (1) Eel's +4/+4 and flying, (2) Overwhelm "Target unit
 * gains -1/-1 until regroup for each card in your hand" at Nyar's Maelstrom
 * Charger (4/2, took -3/-3), (3) Recall "Each player recalls one of their units
 * and loses 2 life". The engine ran its death check after every part, so the
 * Charger died between (2) and (3) and Nyar could not recall it.
 *
 * The owner, 2026-11-13: "it looks like the client isn't resolving a grafted
 * effect as a single effect, but actually checking state based actions between
 * parts. It shouldn't!" The RAQ agrees ("[Solved] Graft 101", _passer, point 8:
 * "Triggered/Activated Graft is SINGLE effect on the stack").
 *
 * So the Charger stands as a 1/-1 through part 3, can be recalled, and dies
 * only if it is still lethal once the WHOLE effect has resolved. The kill riders
 * ({Reaping}, {Afflicting}) still credit the effect for a death its earlier part
 * caused, because the diff now spans the whole item rather than one part.
 *
 * White-box: the composite is built directly (Overwhelm's and Recall's own
 * graft effects, which is what the Eel trigger carried) and resolved through
 * `resolveItem` — the same `resolveParts` loop a real graft composite runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat, StackItem } from '../src/types.ts';
import { effStats, ent, give, spawn, toDeployment, withE } from './util.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

/** A (the effect's controller) and D share one region; D's Maelstrom Charger is in it,
 * A holds `hand` cards, so Overwhelm gives the Charger -hand/-hand. */
function table(seed: number, hand: number): { h: Harness; A: Seat; D: Seat; region: number; charger: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const charger = spawn(h, D, 'Maelstrom Charger');
  const region = ent(h, charger)!.region;
  // "each player" = the seats present in the region (CR 601.4d); only D's units are here
  h.state.regions[region]!.presentSeats = [D];
  h.state.players[A]!.hand = [];
  for (let i = 0; i < hand; i++) give(h, A, 'Good Whale');
  assert.deepEqual(effStats(h, charger), [4, 2], 'setup: the Charger is a 4/2');
  return { h, A, D, region, charger };
}

function composite(h: Harness, A: Seat, region: number, charger: EntityId, recall: boolean,
  card?: string): StackItem {
  return {
    id: h.state.nextId++, kind: card ? 'spell' : 'triggered',
    ...(card ? { card } : {}),
    label: card ?? 'Galerider Eel (grafted)', controller: A, region, negated: false,
    parts: [
      { effectKey: 'graft:Overwhelm', targets: [{ unit: charger }] },
      ...(recall ? [{ effectKey: 'graft:Recall', targets: [] }] : []),
    ],
  };
}

test('CR 713.3a / #390: a unit an earlier part made lethal is still there for a later part to recall', () => {
  const { h, A, D, region, charger } = table(39001, 3);
  const life = h.state.players[D]!.life;
  withE(h, e => e.resolveItem(composite(h, A, region, charger, true)));
  assert.equal(h.state.decision, null, 'the only unit D has is recalled without a question');
  assert.equal(ent(h, charger), undefined, 'the Charger left play');
  assert.ok(h.state.players[D]!.hand.includes('Maelstrom Charger'),
    `the Charger was RECALLED to its owner's hand, not killed: hand=[${h.state.players[D]!.hand}] bin=[${h.state.players[D]!.bin}]`);
  assert.ok(!h.state.players[D]!.bin.includes('Maelstrom Charger'), 'and it is not in the bin');
  assert.ok(!h.events.some(ev => ev.type === 'died' && ev.data?.['unit'] === charger), 'no death was announced');
  assert.equal(h.state.players[D]!.life, life - 2, 'and the rest of part 3 happened: D lost 2');
});

test('CR 713.3a / #390: with a choice to make, the recall question still offers the lethal unit, and the answer recalls it', () => {
  const { h, A, D, region, charger } = table(39002, 3);
  const whale = spawn(h, D, 'Good Whale');
  assert.equal(ent(h, whale)!.region, region, 'setup: both of D\'s units are in the region');
  withE(h, e => e.resolveItem(composite(h, A, region, charger, true)));
  const dec = h.state.decision;
  assert.ok(dec, 'D is asked which unit to recall');
  assert.equal(dec.seat, D);
  const i = dec.options.findIndex(o => JSON.stringify(o.value).includes(String(charger)) || /Charger/.test(o.label));
  assert.ok(i >= 0, `the 1/-1 Charger is on the menu: [${dec.options.map(o => o.label).join(' | ')}]`);
  assert.ok(ent(h, charger), 'and it is still on the board while D is asked');
  assert.deepEqual(effStats(h, charger), [1, -1], 'as a 1/-1');
  h.do({ type: 'decide', seat: D, choice: i });
  assert.equal(ent(h, charger), undefined, 'the Charger left play');
  assert.ok(h.state.players[D]!.hand.includes('Maelstrom Charger'), 'to the hand, recalled — not killed');
  assert.ok(ent(h, whale), 'the Whale stayed');
});

test('CR 713.3a / #390 CONTROL: the same shrink with nothing after it kills the unit once the effect has resolved', () => {
  const { h, A, D, region, charger } = table(39003, 3);
  withE(h, e => e.resolveItem(composite(h, A, region, charger, false)));
  assert.equal(ent(h, charger), undefined, 'the Charger died');
  assert.ok(h.state.players[D]!.bin.includes('Maelstrom Charger'), 'to the bin');
});

test('CR 713.3a / #390: the death waits for the end of the effect — part 3 runs with the unit still in play', () => {
  const { h, A, region, charger } = table(39004, 3);
  const whale = spawn(h, other(A), 'Good Whale');
  const e = new E(h.state);
  try { e.resolveItem(composite(h, A, region, charger, true)); } catch { /* the recall question */ }
  // suspended in part 3 (Recall asks D): parts 1–2 have run and nothing has died
  assert.ok(e.s.decision, 'part 3 is asking');
  assert.ok(e.s.entities[charger], 'the lethal Charger is still in play mid-effect');
  assert.ok(!e.events.some(ev => ev.type === 'died'), 'no death mid-effect');
  void whale;
});

test('CR 713.3a / CR 802.21b: a kill caused by an EARLIER part is still the effect\'s kill — {Reaping} draws once', () => {
  // Invasive Reassignment prints {Reaping}; its item carries the graft parts, so the
  // effect is a reaping source. Part 1 makes the Charger lethal; part 2 (Recall) is
  // removed so the unit is still lethal at the end and dies to the effect.
  const { h, A, D, region, charger } = table(39005, 3);
  const drew = h.state.players[A]!.hand.length;
  withE(h, e => e.resolveItem(composite(h, A, region, charger, false, 'Invasive Reassignment')));
  assert.equal(ent(h, charger), undefined, 'the Charger died at the end of the effect');
  assert.ok(h.state.players[D]!.bin.includes('Maelstrom Charger'));
  assert.equal(h.state.players[A]!.hand.length, drew + 1, 'Reaping paid one card for the kill');
});

/** D's Towering Colossus (10/15) under "Everything is deadly" (D's Rotspore Herald),
 * hit by a 6-damage part — a DECIDED death ({Deadly}), not a lethal reading — then
 * a Recall part that has to ask D which unit (D has three). */
function deadlyTable(seed: number): { h: Harness; D: Seat; colossus: EntityId } {
  const { h, A, D, region } = table(seed, 0);
  const colossus = spawn(h, D, 'Towering Colossus');
  spawn(h, D, 'Rotspore Herald');
  const item: StackItem = {
    id: h.state.nextId++, kind: 'triggered', card: 'Galerider Eel', label: 'Galerider Eel', controller: A, region, negated: false,
    parts: [
      { effectKey: 'spell:Luminous Arc', targets: [{ unit: colossus }] },
      { effectKey: 'graft:Recall', targets: [] },
    ],
  };
  withE(h, e => e.resolveItem(item));
  return { h, D, colossus };
}

test('CR 713.3a / CR 802.3a: a {Deadly} kill decided in part 1 waits, through part 2\'s question, for the end of the effect', () => {
  const { h, D, colossus } = deadlyTable(39006);
  assert.ok(h.state.decision, 'part 2 asks D which unit to recall');
  assert.ok(ent(h, colossus), 'the Deadly-hit Colossus is still in play while D is asked');
  assert.ok(!h.events.some(ev => ev.type === 'died'), 'nothing has died yet');
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => /Charger/.test(o.label));
  assert.ok(i >= 0, `the Charger is on the menu: [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: D, choice: i });
  assert.ok(h.state.players[D]!.hand.includes('Maelstrom Charger'), 'the Charger was recalled');
  assert.equal(ent(h, colossus), undefined, 'and the decided Deadly death happened once the effect resolved');
  assert.ok(h.state.players[D]!.bin.includes('Towering Colossus'));
  assert.ok(h.events.some(ev => /Deadly — Towering Colossus dies/.test(ev.msg)), 'announced as the Deadly kill');
});

test('CR 713.3a: a unit with a decided death that a later part recalls is recalled, not killed', () => {
  const { h, D, colossus } = deadlyTable(39007);
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => /Colossus/.test(o.label));
  assert.ok(i >= 0, `the Colossus is on the menu: [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: D, choice: i });
  assert.equal(ent(h, colossus), undefined, 'the Colossus left play');
  assert.ok(h.state.players[D]!.hand.includes('Towering Colossus'), 'to the hand');
  assert.ok(!h.state.players[D]!.bin.includes('Towering Colossus'), 'not the bin');
  assert.ok(!h.events.some(ev => /Deadly — Towering Colossus dies/.test(ev.msg)), 'and no Deadly death line');
});
