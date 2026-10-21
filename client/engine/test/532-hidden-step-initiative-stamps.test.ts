/**
 * 532 — in a hidden simultaneous step, the initiative player's plays are
 * timestamped before the other player's, whatever order they were clicked in
 * (CR 113.2).
 *
 * Owner, 2026-10-21: "Yes, deployment is stamped accourding to INT/NIT order.
 * "Real time" doesn't matter in simultanous phases". The question came from
 * nyarlathotep8457's case on report #231, relayed the same day: "If player A is
 * INT and performs their Deployment first -> playing a Transmogrifiant. And then
 * player B played PP. The next turn player A gifted the T to B with rebalance
 * then the units would still have piercing. If INT/NIT where flipped then the
 * scenario would leave B with pierce-less units."
 *
 * Both seats deploy at once in this client (CR 507.3a) and the engine's clock
 * (`nextId`) reads real click order across them, so until 2026-10-21 the
 * earlier CLICK was the older timestamp. §1 is the case where that and the
 * ruling disagree: the NIT player clicks first. §2 flips the initiative with
 * the same clicks (both readings agree: the Piercing goes). §3 is the other
 * disagreement: the NIT player's Transmogrifant is clicked first, and is
 * still the newer. §4 checks the haste step, the other step that makes
 * entities, and that a stamp after the step is later than all of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

/** resolve whatever the last play put on its deployment stack */
function drain(h: Harness): void {
  for (let guard = 60; (h.state.stack.length || h.state.decision) && guard-- > 0;) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
}

interface Case { seed: number; transmogIsInitiative: boolean; piercingFirst: boolean }

/**
 * One deployment: player T augments Transmogrifant onto their The Bonesculptor,
 * player P casts Pernicious Photosynthesis (+2/+2 and Piercing until regroup),
 * in the click order given. Next battle P attacks into T's region and T casts
 * Rebalance, giving P The Bonesculptor, so Transmogrifant covers P's units.
 * Returns whether P's Bubb still has the Piercing, after checking it lost its
 * printed Unaware (the strip reached it either way).
 */
function play(c: Case): { kept: boolean; T: Seat; P: Seat } {
  const h = new Harness(c.seed);
  const INT = h.state.initiative, NIT = (1 - INT) as Seat;
  const T = c.transmogIsInitiative ? INT : NIT, P = (1 - T) as Seat;
  let bones: EntityId = -1;
  bones = spawn(h, T, 'The Bonesculptor');
  const bubb = spawn(h, P, 'Bubb');                               // {Unaware}
  const token = spawn(h, P, 'Unit Token');                        // what P gives away
  toDeployment(h);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.initiative, INT, 'setup: the initiative has not moved');

  giveResources(h, T, 'metal', 4);                                // Transmogrifant mm/4
  giveResources(h, P, 'wood', 4);                                 // Pernicious Photosynthesis gg/4
  const transmog = (): void => {
    h.do({ type: 'augment', seat: T, from: 'hand', index: give(h, T, 'Transmogrifant'), hostId: bones });
    drain(h);
  };
  const photosynthesis = (): void => {
    h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Pernicious Photosynthesis') });
    drain(h);
  };
  if (c.piercingFirst) { photosynthesis(); transmog(); } else { transmog(); photosynthesis(); }
  assert.ok(ent(h, bones)!.mods.some(m => ent(h, m)!.card === 'Transmogrifant'), 'setup: Transmogrifant is on The Bonesculptor');
  assert.ok(ownAttrs(h, bubb).has('Piercing') && ownAttrs(h, bubb).has('Unaware'), 'setup: Bubb has Piercing and is not covered yet');

  giveResources(h, T, 'wood', 2);                                 // Rebalance g/2
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[token], [bubb]] });
  for (let guard = 8; h.state.priority !== T && guard-- > 0;) pass(h);
  h.do({ type: 'playCard', seat: T, handIndex: give(h, T, 'Rebalance') });
  pass(h); pass(h);
  for (let guard = 0; h.state.decision && guard < 4; guard++) {
    const dec = h.state.decision;
    const want = dec.seat === P ? token : bones;
    const i = dec.options.findIndex(o => JSON.stringify(o.value).includes(String(want)));
    assert.ok(i >= 0, `Rebalance offers ${want} to seat ${dec.seat}`);
    h.do({ type: 'decide', seat: dec.seat, choice: i });
  }
  assert.equal(ent(h, bones)!.controller, P, 'Rebalance gave P The Bonesculptor');
  assert.equal(ent(h, bones)!.region, ent(h, bubb)!.region, 'in the region with Bubb');
  assert.ok(!ownAttrs(h, bubb).has('Unaware'), 'Transmogrifant now covers Bubb: its printed Unaware is gone');
  const kept = ownAttrs(h, bubb).has('Piercing');
  finishBattle(h);
  return { kept, T, P };
}

test('§1 the NIT player clicks first, and the Transmogrifant of the INT player is still the older: the Piercing stays', () => {
  const r = play({ seed: 53201, transmogIsInitiative: true, piercingFirst: true });
  assert.ok(r.kept, 'Pernicious Photosynthesis was clicked first, by the NIT player; the INT player\'s Transmogrifant is older, so the Piercing it gave is kept');
});

test('§2 the same clicks with the initiative flipped: the Piercing goes', () => {
  const r = play({ seed: 53202, transmogIsInitiative: false, piercingFirst: true });
  assert.ok(!r.kept, 'Pernicious Photosynthesis is the INT player\'s and the older, so Transmogrifant takes the Piercing');
});

test('§3 the Transmogrifant of the NIT player, clicked first, is still the newer: the Piercing goes', () => {
  const r = play({ seed: 53203, transmogIsInitiative: false, piercingFirst: false });
  assert.ok(!r.kept, 'the INT player\'s Pernicious Photosynthesis, clicked second, is the older');
});

test('§4 the haste step orders its arrivals by initiative too, and a stamp after the step is later than all of it', () => {
  const h = new Harness(53204);
  const INT = h.state.initiative, NIT = (1 - INT) as Seat;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.state.phase, 'planning');
  assert.ok(h.state.hasteDone, 'in the haste step');
  const g = (): E => new E(h.state);
  const nit = spawn(h, NIT, 'Unit Token');                        // made first, by the NIT player
  const int = spawn(h, INT, 'Unit Token');
  assert.ok(nit < int, 'setup: the NIT player\'s arrived first by the clock');
  assert.ok(E.older(g().stampOf(int), g().stampOf(nit)), 'the INT player\'s arrival is the older');
  h.do({ type: 'doneHaste', seat: INT });
  h.do({ type: 'doneHaste', seat: NIT });
  assert.notEqual(h.state.phase, 'planning', 'the haste step is over');
  const later = g().stampNow(INT);
  assert.ok(E.older(g().stampOf(nit), later) && E.older(g().stampOf(int), later),
    'a stamp taken after the step is later than everything stamped in it');
});
