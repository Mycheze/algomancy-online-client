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
import type { Seat } from '../src/types.ts';
import { effStats, finishBattle, spawn, toDeployment, toNextBattle, withE } from './util.ts';

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
