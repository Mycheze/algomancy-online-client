/**
 * CT-299 / CT-305 / CT-303 — a play with required targets needs ALL of them.
 *
 * The owner, 2026-10-16, on Tilling the Graves: it needs both targets,
 * "otherwise it'd say 'up to two'". And generally: "Unless a card says 'up to',
 * it must have targets in order to be cast." CR 110.7; the RAQ (_passer,
 * 2025-08-27): "In order to play a card, you must be able to select the valid
 * targets".
 *
 * Tilling the Graves prints "Recall two target units in your bin, then discard
 * a card". It was `min: 0`, so it was offered with an empty bin, a bin holding
 * only a spell, and a bin holding one unit ("target 1 of up to 2" plus a
 * "No targets" button).
 *
 * CT-303 — "Augment a Wight onto X target units" / "Recall X target nontoken
 * allies": X is chosen BEFORE the targets (CR 702.3c), so an X larger than the
 * legal targets is not offered at all, and the target menu never offers a stop
 * short of X. X = 0 with nothing to aim at is still a legal play.
 *
 * The registry-wide sweep of the same rule is 477.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { CardName, ResourceState, Seat } from '../src/types.ts';
import { give, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const open = (kind: ResourceState['kind']): ResourceState => ({ kind, state: 'open' });
const isDone = (v: unknown): boolean => !!v && typeof v === 'object' && 'doneTargets' in (v as object);

/** a {Battle} window: the attacker has `attackers` in the fight, the defender
 * holds priority with `mana` open and an empty hand */
function battle(seed: number, mana: ResourceState[], attackers: string[] = ['Cinder Scuttler']) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids = attackers.map(n => spawn(h, A, n));
  toNextBattle(h, A);
  h.state.players[D]!.resources = mana;
  h.state.players[D]!.hand = [];
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  pass(h);
  return { h, A, D, ids };
}

const playable = (h: Harness, seat: Seat, name: string): boolean => legalActions(h.state, seat).some(a =>
  a.type === 'playCard' && h.state.players[seat]!.hand[(a as { handIndex: number }).handIndex] === name);

const dark = () => Array.from({ length: 8 }, () => open('dark'));

for (const [label, bin] of [
  ['an empty bin', []],
  ['a bin holding only a spell', ['Arc Lightning']],
  ['a bin holding one unit', ['Cinder Scuttler']],
  ['a bin holding one unit and a spell', ['Cinder Scuttler', 'Arc Lightning']],
] as const) {
  test(`Tilling the Graves is not offered with ${label}`, () => {
    const { h, D } = battle(47801, dark());
    h.state.players[D]!.bin = [...bin] as CardName[];
    give(h, D, 'Arc Lightning');   // something to discard, so only the targets decide
    give(h, D, 'Tilling the Graves');
    assert.equal(playable(h, D, 'Tilling the Graves'), false,
      `Tilling the Graves needs two units in the bin (CR 110.7), bin was ${JSON.stringify(bin)}`);
  });
}

test('Tilling the Graves with two units in the bin is offered and asks for both with no stop', () => {
  const { h, D } = battle(47802, dark());
  h.state.players[D]!.bin = ['Cinder Scuttler', 'Arc Lightning', 'Cinder Scuttler'] as CardName[];
  give(h, D, 'Arc Lightning');
  const hi = give(h, D, 'Tilling the Graves');
  assert.ok(playable(h, D, 'Tilling the Graves'), 'two units in the bin: Tilling the Graves is castable');
  h.do({ type: 'playCard', seat: D, handIndex: hi });
  for (const n of [1, 2]) {
    const dec = h.state.decision!;
    assert.equal(dec?.kind, 'targets', `target ${n} is asked for`);
    assert.ok(!dec.options.some(o => isDone(o.value)),
      `no "No targets" / "No more targets" before both are picked (target ${n}): `
      + JSON.stringify(dec.options.map(o => o.label)));
    const refs = dec.options.filter(o => !isDone(o.value));
    assert.equal(refs.length, 3 - n, 'only the units in the bin are targets, never the spell');
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.indexOf(refs[0]!) });
  }
  const top = h.state.stack.at(-1)!;
  assert.equal(top.card, 'Tilling the Graves', 'the spell is on the stack');
  assert.equal(top.parts[0]!.targets.length, 2, 'aimed at both units');
});

// ── CT-303: X target spells ───────────────────────────────────────────────

function xMenu(h: Harness): number[] {
  const dec = h.state.decision!;
  assert.equal(dec?.prompt.includes('choose X'), true, `an X question is pending: ${dec?.prompt}`);
  return dec.options.map(o => o.value as number);
}

test('Blight End with one unit in the battle offers X up to 1 only, and X = 1 needs its target', () => {
  const mana = [open('wood'), open('dark'), open('wood'), open('dark'), open('wood')];
  const { h, D, ids } = battle(47803, mana);
  const hi = give(h, D, "Blight's End");
  h.do({ type: 'playCard', seat: D, handIndex: hi });
  assert.deepEqual(xMenu(h), [0, 1], 'one unit in the region: X = 2 and X = 3 are not declarable (CR 110.7)');
  pick(h, 1);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets');
  assert.ok(!dec.options.some(o => isDone(o.value)), 'X = 1: no stop before the one target');
  pick(h, { unit: ids[0] });
  assert.equal(h.state.stack.at(-1)!.parts[0]!.targets.length, 1);
});

test('Blight End with two units asks for both at X = 2, never offering a stop at one', () => {
  const mana = [open('wood'), open('dark'), open('wood'), open('dark'), open('wood')];
  const { h, D, ids } = battle(47804, mana, ['Cinder Scuttler', 'Cinder Scuttler']);
  const hi = give(h, D, "Blight's End");
  h.do({ type: 'playCard', seat: D, handIndex: hi });
  assert.deepEqual(xMenu(h), [0, 1, 2]);
  pick(h, 2);
  pick(h, { unit: ids[0] });
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'targets', 'the second target is still owed');
  assert.ok(!dec.options.some(o => isDone(o.value)), 'no "No more targets" at 1 of 2');
  pick(h, { unit: ids[1] });
  assert.equal(h.state.stack.at(-1)!.parts[0]!.targets.length, 2);
});

test('Torrential Reclamation with no ally in the fight is castable at X = 0 only', () => {
  // the defender has no unit in this battle: X = 0 needs no target (CR 107.2b keeps its sacrifice)
  const mana = Array.from({ length: 6 }, (_, i) => open(i % 2 ? 'water' : 'fire'));
  const { h, D } = battle(47805, mana);
  const hi = give(h, D, 'Torrential Reclamation');
  assert.ok(playable(h, D, 'Torrential Reclamation'), 'X = 0 needs no target, so the spell is castable');
  h.do({ type: 'playCard', seat: D, handIndex: hi });
  assert.deepEqual(xMenu(h), [0], 'no nontoken ally: X = 0 is the only declarable X');
});

test('Torrential Reclamation offers X only up to the nontoken allies, and X = 0 always', () => {
  // the caster is the ATTACKER here: its allies are in the fight
  const h = new Harness(47806);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const ids = [spawn(h, A, 'Cinder Scuttler'), spawn(h, A, 'Cinder Scuttler')];
  toNextBattle(h, A);
  h.state.players[A]!.resources = Array.from({ length: 8 }, (_, i) => open(i % 2 ? 'water' : 'fire'));
  h.state.players[A]!.hand = [];
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  if (h.state.priority !== A) pass(h);
  assert.equal(h.state.priority, A, 'the attacker holds priority in the battle window');
  const hi = give(h, A, 'Torrential Reclamation');
  assert.ok(playable(h, A, 'Torrential Reclamation'));
  h.do({ type: 'playCard', seat: A, handIndex: hi });
  const xs = xMenu(h);
  assert.ok(xs.includes(0) && xs.includes(2), `X = 0 and X = 2 are declarable: ${JSON.stringify(xs)}`);
  assert.ok(!xs.some(x => x > 2), `no X above the two nontoken allies: ${JSON.stringify(xs)}`);
});
