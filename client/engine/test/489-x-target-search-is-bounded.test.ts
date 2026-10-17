/**
 * CT-303 follow-up — THE "CAN ALL X SLOTS BE FILLED?" SEARCH STAYS CHEAP.
 *
 * `min: 'X'` (Blight's End, Torrential Reclamation, Channel Through) made
 * `requiredSlotsFillable` require every counted slot, and it searched them as
 * SEQUENCES: an X above the number of legal targets tried every ordering of
 * them before giving up — n!/(n−X)! paths. It runs inside `legalActions` (the
 * castability gate) and inside `collectX` (the X menu), so ten units in a
 * battle with Blight's End in hand and eleven mana open never returned. The
 * card drill (81) hung on it for twenty minutes before anyone noticed.
 *
 * The counted slots are interchangeable, so they are now searched as a set.
 * These boards would not finish under the old search; the timing bound is
 * generous (they take milliseconds) so it fails only on a blow-up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { EntityId, ResourceState, Seat } from '../src/types.ts';
import { give, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const open = (kind: ResourceState['kind']): ResourceState => ({ kind, state: 'open' });
const BOUND_MS = 3000;

/** a {Battle} window: the attacker has `n` bodies in two-unit columns, the
 * defender holds priority with `mana` open and an empty hand */
function bigBattle(seed: number, n: number, mana: ResourceState[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids = Array.from({ length: n }, () => spawn(h, A, 'Cinder Scuttler'));
  toNextBattle(h, A);
  h.state.players[D]!.resources = mana;
  h.state.players[D]!.hand = [];
  const columns: EntityId[][] = [];
  for (let i = 0; i < ids.length; i += 2) columns.push(ids.slice(i, i + 2));
  h.do({ type: 'declareAttack', seat: A, columns });
  pass(h);
  return { h, A, D, ids };
}

function timed<T>(label: string, f: () => T): T {
  const t = Date.now();
  const out = f();
  const ms = Date.now() - t;
  assert.ok(ms < BOUND_MS, `${label} took ${ms}ms — the X-slot search is exploring orderings again`);
  return out;
}

test("Blight's End against ten units with X up to 14: legal actions and the X menu answer at once", () => {
  const mana = Array.from({ length: 16 }, (_, i) => open(i % 2 ? 'wood' : 'dark'));
  const { h, D } = bigBattle(48901, 10, mana);
  const hi = give(h, D, "Blight's End");
  const acts = timed('legalActions', () => legalActions(h.state, D));
  assert.ok(acts.some(a => a.type === 'playCard' && (a as { handIndex: number }).handIndex === hi), 'castable');
  timed('playCard → X menu', () => h.do({ type: 'playCard', seat: D, handIndex: hi }));
  const dec = h.state.decision!;
  const xs = dec.options.map(o => o.value as number);
  assert.equal(Math.max(...xs), 10, 'X stops at the ten units the board holds (CR 110.7)');
  pick(h, 10);
  for (let i = 0; i < 10; i++) {
    const d = h.state.decision!;
    assert.equal(d.kind, 'targets', `target ${i + 1} of 10 is still owed`);
    pick(h, d.options[0]!.value);
  }
  assert.equal(h.state.stack.at(-1)!.parts[0]!.targets.length, 10);
});
