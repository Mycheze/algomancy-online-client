/**
 * CR 710.7, 722.4 / report 271 — AN ANCIENT ONE THAT BORROWS A GRAFT CAUSE
 * BORROWS THE GRAFTS ON IT.
 *
 * Tomzy (report 271): "in the attached state, it doesn't copy the grafted
 * ability, but it should." The state was not attached, so these are the
 * shapes it could have been, measured:
 *
 *  · a graft on an ADJACENT ALLY's graft cause — triggered and activated.
 *    BROKEN: the Ancient One's copy of the cause carried the cause's own
 *    effect and none of the grafts. The triggered copy was built as a single
 *    part; the activated one composed its grafts off the Ancient One's own
 *    (empty) mods.
 *  · a graft on the Ancient One itself — never legal: CR 722.2, the host must
 *    have a graft cause of its own, and the Ancient One's borrowed text only
 *    exists in a formation, where nothing is grafted. Guarded below.
 *
 * The sources: the oracle ruling "This effect includes modifications such as
 * grafted and augmented abilities"; the designer, "If Ancient One copies a
 * bounded Graft effect … it triggers on each creature" (each keeps its own
 * use); and the designer's worked board — Amphivore carrying Astral Painseeker
 * with the Ancient One behind it, Bloodwind Revenant beside the Ancient One —
 * "6 combat damage triggers total (draw a card + Bloodwind Revenant trigger)
 * … you would get two Bloodwind Revenant triggers since Ancient One is also
 * copying that."
 *
 * Seeds 58800-58899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** drive the battle to its end, recording every stack item ever seen. Every
 * question takes its LAST answer (declines a "you may sacrifice"); every
 * trigger order is kept as given. */
function driveRecording(h: Harness): { label: string; sourceId?: number; parts: string[] }[] {
  const stacked = new Map<number, { label: string; sourceId?: number; parts: string[] }>();
  for (let guard = 200; h.state.phase === 'battle' && guard-- > 0;) {
    for (const i of h.state.stack) stacked.set(i.id, { label: i.label, sourceId: i.sourceId, parts: i.parts.map(p => p.effectKey) });
    const d = h.state.decision;
    if (d) { h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : d.options.length - 1 }); continue; }
    const b = h.state.battle!;
    if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else pass(h);
  }
  return [...stacked.values()];
}

test('CR 722.4 / report 271: an Ancient One borrowing a grafted triggered cause runs the graft too, with its own use', () => {
  const h = new Harness(58800);
  toDeployment(h);
  const A = h.state.initiative;
  const seer = spawn(h, A, 'Lifebound Seer');        // "When I attack or block, [Switch1] Glimpse 2."
  const ancient = spawn(h, A, 'Ancient One');
  let pebble = -1;
  withE(h, e => { pebble = e.attachMod(e.s.entities[seer]!, 'Plodding Pebble', A, 'graft').id; });   // [Switch1] +1/+1 counter on me
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[seer], [ancient]] });
  const mine = driveRecording(h).find(i => i.sourceId === ancient);
  assert.deepEqual(mine?.parts, ['ability:Lifebound Seer#0', 'graft:Plodding Pebble'],
    'the borrowed composite is the whole composite');
  assert.equal(ent(h, seer)!.counters, 1, 'the Seer ran its graft');
  assert.equal(ent(h, ancient)!.counters, 1, '"me" in the borrowed graft is the Ancient One (CR 710.7a)');
  assert.equal(ent(h, pebble)!.budgets['graft'], 1, 'the Seer spent the graft use on the mod');
  assert.equal(ent(h, ancient)!.budgets[`graft:Plodding Pebble@m${pebble}`], 1,
    'and the Ancient One spent its own — "it triggers on each creature"');
});

test('CR 722.4 / report 271: an Ancient One activating a borrowed grafted cause runs the graft too', () => {
  const h = new Harness(58801);
  toDeployment(h);
  const A = h.state.initiative;
  const evoker = spawn(h, A, 'Omniwield Evoker');    // "[three]: [Switch] put a +1/+1 counter on me"
  const ancient = spawn(h, A, 'Ancient One');
  withE(h, e => { e.attachMod(e.s.entities[evoker]!, 'Omniwield Evoker', A, 'graft'); });
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[evoker], [ancient]] });
  for (let guard = 8; h.state.priority !== A && guard-- > 0;) pass(h);
  giveResources(h, A, 'metal', 3);
  const act = legalActions(h.state, A).find(a => a.type === 'activateAbility' && a.entityId === ancient);
  assert.ok(act, 'the Ancient One offers the Evoker ability it borrowed');
  h.do(act!);
  assert.deepEqual(h.state.stack.at(-1)?.parts.map(p => p.effectKey),
    ['ability:Omniwield Evoker#0', 'graft:Omniwield Evoker'], 'cause and graft, one composite');
  for (let guard = 8; h.state.stack.length && guard-- > 0;) pass(h);
  assert.equal(ent(h, ancient)!.counters, 2, 'two counters: the Evoker line and its graft, both on "me"');
  assert.equal(ent(h, evoker)!.counters, 0, 'the neighbour did not activate anything');
  finishBattle(h);
});

test('CR 710.7, 722.7 / report 271: the designer board — Amphivore with Astral Painseeker, Ancient One behind it, Bloodwind Revenant beside', () => {
  const h = new Harness(58802);
  toDeployment(h);
  const A = h.state.initiative;
  const amphivore = spawn(h, A, 'Amphivore');
  const ancient = spawn(h, A, 'Ancient One');
  const tidewraith = spawn(h, A, 'Astral Tidewraith');
  const revenant = spawn(h, A, 'Bloodwind Revenant');
  withE(h, e => { e.attachMod(e.s.entities[amphivore]!, 'Astral Painseeker', A, 'graft'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[amphivore, ancient], [tidewraith, revenant]] });
  const items = driveRecording(h);
  const amphs = items.filter(i => i.label.includes('Amphivore'));
  assert.equal(amphs.length, 2, 'the Amphivore trigger and the Ancient One\'s copy of it');
  for (const i of amphs) {
    assert.deepEqual(i.parts, ['ability:Amphivore#0', ...Array(3).fill('graft:Astral Painseeker')],
      `${i.label}: three copies of the grafted draw — six in all`);
  }
  assert.ok(amphs.some(i => i.sourceId === ancient), 'one of them is the Ancient One\'s');
  assert.equal(items.filter(i => i.label.includes('Bloodwind Revenant')).length, 2,
    '"you would get two Bloodwind Revenant triggers since Ancient One is also copying that"');
  assert.equal(items.filter(i => i.label.includes('Astral Tidewraith')).length, 1,
    'the attack trigger is only on Astral Tidewraith — it is not adjacent to the Ancient One');
});

test('CR 722.2 / report 271: no graft is ever offered onto an Ancient One — it has no graft cause of its own', () => {
  const h = new Harness(58803);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ancient = spawn(h, A, 'Ancient One');
  const seer = spawn(h, A, 'Lifebound Seer');
  give(h, A, 'Omniwield Evoker');
  give(h, A, 'Plodding Pebble');
  giveResources(h, A, 'metal', 8);
  const grafts = legalActions(h.state, A).filter(a => a.type === 'graft');
  assert.ok(grafts.some(a => (a as { hostId: number }).hostId === seer), 'the rig offers grafts at all');
  assert.ok(!grafts.some(a => (a as { hostId: number }).hostId === ancient), 'never onto the Ancient One');
});
