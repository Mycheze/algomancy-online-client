/**
 * CR 721.1c, 710.7 / CT-349 — an Ancient One beside an ally wearing an augment
 * mod borrows the text the MOD gives that ally (its [Augment] box), not the
 * mod card's whole face.
 *
 * Ancient One: "[Augment] I have all abilities of adjacent allies. (This
 * includes modded abilities.)" CR 721.1c: on a host only the augment's own
 * augment text works. So the ally has the box and nothing else of the mod, and
 * the box is all there is to borrow. The projection used to take the mod's
 * whole face: Good Whale wearing Infernal Wispweaver ("Your wisps gain +2/+1
 * and do not sacrifice themselves after combat. [Augment] At the end of turn,
 * create a wisp.") beside an Ancient One made a 0/1 Wisp a 2/2 — the
 * Wispweaver's BODY static reached through the Ancient One — and the
 * activation list offered the mod card's body abilities too.
 *
 * Seeds 62500-62599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import { effStats, finishBattle, giveResources, spawn, toDeployment, toNextBattle, withE } from './util.ts';

test('CR 721.1c, 710.7 / CT-349: a mod body static does not reach through an Ancient One (Infernal Wispweaver on a Good Whale)', () => {
  const h = new Harness(62500);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');
  const ancient = spawn(h, A, 'Ancient One');
  const wisp = spawn(h, A, 'Wisp');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(whale)!, 'Infernal Wispweaver', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale], [ancient], [wisp]] });
  const e = new E(h.state);
  assert.deepEqual(e.adjacentInFormation(ancient).map(u => u.card).sort(), ['Good Whale', 'Wisp'],
    'the board: the Ancient One stands between the modded Whale and the Wisp');
  assert.deepEqual(effStats(h, wisp), [0, 1],
    'the Wisp keeps its printed 0/1: the Wispweaver body "+2/+1" is not text the Whale has');
  const boxes = e.activatedBoxes(e.entity(ancient)!).filter(b => b.card === 'Infernal Wispweaver');
  assert.deepEqual(boxes.map(b => b.text), ['augment'],
    'of the mod, only its [Augment] text is borrowed — no body box');
  finishBattle(h);
});

test('CR 721.1c, 710.7 / CT-349: a mod [Augment] box static still reaches through an Ancient One (Glowhaven Elder worn as a mod)', () => {
  const h = new Harness(62501);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Unit Token');
  const ancient = spawn(h, A, 'Ancient One');
  const bystander = spawn(h, A, 'Unit Token');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  // Glowhaven Elder: "[Augment] your OTHER units gain +1/+1"
  withE(h, e => { e.attachMod(e.entity(host)!, 'Glowhaven Elder', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host], [ancient], [bystander]] });
  const base = new E(h.state).baseStatsOf(new E(h.state).entity(bystander)!);
  assert.deepEqual(effStats(h, bystander), [base[0] + 2, base[1] + 2],
    'the mod on the host and the Ancient One that borrowed its box: +2/+2 on another unit');
  finishBattle(h);
});

test('CR 721.1c, 710.2a / CT-349: beside a COPY of a modded unit, the Ancient One borrows only the box of the mod the copy copied', () => {
  const h = new Harness(62502);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');
  const copy = spawn(h, A, 'Unit Token');
  const ancient = spawn(h, A, 'Ancient One');
  const wisp = spawn(h, A, 'Wisp');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => {
    e.attachMod(e.entity(whale)!, 'Infernal Wispweaver', A, 'augment');
    // Borrower of Forms / Apex Prime: a copy carries its source's mods as text (CR 710.2a)
    e.becomeCopy(e.entity(copy)!, e.entity(whale)!, { from: 'test', until: 'permanent' });
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[copy], [ancient], [wisp]] });
  const e = new E(h.state);
  assert.ok(e.copiedAugments(e.entity(copy)!, 'behavior').includes('Infernal Wispweaver'),
    'the board: the copy carries the Wispweaver it copied');
  assert.deepEqual(effStats(h, wisp), [0, 1],
    'the Wisp keeps its printed 0/1: a copied mod is its box, and so is what the Ancient One borrows of it');
  finishBattle(h);
});

test('CR 710.7, 721.1c / CT-349: a card an ally prints whole is borrowed whole, even when another ally wears it as a mod', () => {
  const h = new Harness(62503);
  toDeployment(h);
  const A = h.state.initiative;
  // the modded ally stands on the LEFT, so its box-only Wispweaver is met first
  const whale = spawn(h, A, 'Good Whale');
  const ancient = spawn(h, A, 'Ancient One');
  const weaver = spawn(h, A, 'Infernal Wispweaver');
  const wisp = spawn(h, A, 'Wisp');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(whale)!, 'Infernal Wispweaver', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale], [ancient], [weaver], [wisp]] });
  const e = new E(h.state);
  assert.deepEqual(e.adjacentInFormation(ancient).map(u => u.card), ['Good Whale', 'Infernal Wispweaver'],
    'the board: the modded Whale is the first neighbour, the printed Wispweaver the second');
  assert.deepEqual(effStats(h, wisp), [4, 3],
    'the Wispweaver itself (+2/+1) and the Ancient One that borrowed its whole card (+2/+1)');
  finishBattle(h);
});

test('CR 721.1c, 710.7 / CT-349: an Ancient One may still activate the [Augment] text of a mod its neighbour wears (Pack Leader)', () => {
  const h = new Harness(62504);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Unit Token');
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  // Pack Leader: "[Augment] [two]: create a 1/1 unit"
  withE(h, e => { e.attachMod(e.entity(host)!, 'Pack Leader', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host], [ancient]] });
  giveResources(h, A, 'fire', 4);
  const acts = legalActions(h.state, A).filter(a => a.type === 'activateAbility' && a.entityId === ancient);
  const vias = acts.map(a => JSON.stringify((a as { via?: unknown }).via));
  assert.ok(vias.includes(JSON.stringify({ face: 'Pack Leader', text: 'augment' })),
    `the borrowed box is offered (offered: ${vias.join(' ')})`);
  assert.ok(!vias.includes(JSON.stringify({ face: 'Pack Leader' })), 'and no body list of the mod card');
  finishBattle(h);
});

test('CR 721.1c / CT-349: the body list of a card borrowed only as a mod box is not addressable by an activation', () => {
  const h = new Harness(62505);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(whale)!, 'Infernal Wispweaver', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale], [ancient]] });
  // a hand-made action, as a stale log or a forged client would send it: the
  // accept must refuse it as the offer never makes it (the fuzzer invariant)
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Infernal Wispweaver' } }),
    /does not have that ability/, 'refused: the Ancient One does not have the Wispweaver body');
  finishBattle(h);
});
