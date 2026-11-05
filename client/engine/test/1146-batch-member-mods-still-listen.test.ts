/**
 * CR 706.8c / CT-525 — a unit that dies in a simultaneous batch "still
 * triggers on their deaths … as it would have had it survived", and that
 * includes the text its MODS give it, not only its printed text.
 *
 * `destroyBatch` disposes one body at a time. `fireEvent` keeps an already
 * disposed member listening (`deathBatch`), but read that member's augment
 * lines through `entity(modId)` — and `destroy` deletes the mod entities with
 * their host. So a Refuse Reclaimer carried as an augment ("Whenever another
 * unit dies, put a +1/+1 counter on me.") went deaf the instant its host was
 * disposed, and heard a batch-mate only if the host happened to be disposed
 * LAST. The mods are already kept for the batch (`deathBatchMods`, CT-351's
 * snapshot for Ancient One); the listener sweep now reads them too.
 *
 * Seeds 114600-114699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Entity, EntityId, Seat } from '../src/types.ts';
import { spawn, toDeployment, withE } from './util.ts';

// the trigger is queued and resolved inside the same settle, so count its log line
const TRIGGERED = 'Trigger: Refuse Reclaimer — put a +1/+1 counter on me';

/** a Unit Token wearing Refuse Reclaimer as an augment, and a plain unit
 * beside it, destroyed together in `order` */
function run(seed: number, order: 'host-first' | 'host-last', carrier: 'augment' | 'card'): number {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  let host!: EntityId;
  if (carrier === 'card') host = spawn(h, A, 'Refuse Reclaimer');
  const other = spawn(h, A, 'Unit Token');
  const mark = h.log.length;
  withE(h, e => {
    if (carrier === 'augment') {
      const t = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [2, 2] });
      e.attachMod(t, 'Refuse Reclaimer', A, 'augment');
      host = t.id;
    }
    const units = [host, other].map(id => e.entity(id)!) as Entity[];
    e.destroyBatch(order === 'host-first' ? units : [...units].reverse(), 'is deleted');
  });
  return h.log.slice(mark).filter(l => l.startsWith(TRIGGERED)).length;
}

test('CR 706.8c / CT-525: an augmented Refuse Reclaimer destroyed FIRST in a batch still hears the member destroyed after it', () => {
  assert.equal(run(114600, 'host-first', 'augment'), 1,
    'the host left play first, but its augment line hears the batch-mate as it would have had it survived');
});

test('CR 706.8c / CT-525: an augmented Refuse Reclaimer destroyed LAST hears the earlier member (unchanged)', () => {
  assert.equal(run(114601, 'host-last', 'augment'), 1);
});

test('CR 706.8c / CT-525: a Refuse Reclaimer CARD destroyed first hears the later member (its own text, unchanged)', () => {
  assert.equal(run(114602, 'host-first', 'card'), 1);
});

/** Forager of the Fallen ("Whenever an enemy unit dies, [Switch1] create a 2/2
 * unit.") with Metamorphic Luminary grafted under it ("[Switch] Create a
 * Crystal 1."), destroyed together with an enemy unit in `order`: how many
 * Crystals its controller gets — the graft joining the Forager's firing */
function forager(seed: number, order: 'forager-first' | 'forager-last'): number {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const crystals = () => Object.values(h.state.entities)
    .filter(x => x.kind === 'spellToken' && x.controller === A && x.card === 'Crystal').length;
  let before = 0;
  withE(h, e => {
    const f = e.spawnUnit(A, 'Forager of the Fallen', e.homeRegion(A));
    e.attachMod(f, 'Metamorphic Luminary', A, 'graft');
    const enemy = e.spawnUnit(D, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [1, 1] });
    before = Object.values(e.s.entities)
      .filter(x => x.kind === 'spellToken' && x.controller === A && x.card === 'Crystal').length;
    e.destroyBatch(order === 'forager-first' ? [f, enemy] : [enemy, f], 'is deleted');
  });
  return crystals() - before;
}

test('CR 706.8c / CT-525: a Forager of the Fallen destroyed FIRST in a batch still fires its graft on the enemy destroyed after it', () => {
  assert.equal(forager(114610, 'forager-first'), 1, 'the grafted Crystal 1 joins the firing, as it would had the Forager survived');
});

test('CR 706.8c / CT-525: a Forager of the Fallen destroyed LAST fires its graft (unchanged)', () => {
  assert.equal(forager(114611, 'forager-last'), 1);
});
