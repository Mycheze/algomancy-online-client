/**
 * CR 111.2, 713.6e / CT-435 — the units one COST sacrifices die together, in
 * one death batch, once the cost is paid in full.
 *
 * CT-414 made the units one sacrifice INSTRUCTION takes die together (Caleb on
 * Perish: "Sacrifices are resolved simultaneously"). Costs were left alone,
 * because those words were about an effect: the cost payer destroyed each unit
 * the moment it was picked. The designer settled the cost case himself, in
 * rules-questions 2025-06-02, answering a player who wanted to pay Malevolent
 * Machinations' "[Sacrifice X units]" with a Maelstrom Charger and then the
 * Ancient One borrowing its ability:
 *   nyarlathotep8457: "Can you sacrifice Maelstrom charger first and the ancient
 *                      one after that? for Malevolent Machinations … would
 *                      Ancient One lose the ability while you perform the
 *                      casting?"
 *   calebgannon: "Technically it should be within the same game action so I
 *                 don't think order matters" (RQ 1379132774207848589)
 *
 * Order not mattering is what one batch means: an Ancient One paid with its
 * neighbour still has the neighbour's abilities as it dies (CR 714.9), and a
 * unit that hears deaths hears the others paid with it (CR 706.8c).
 *
 * The three cards with a multi-unit sacrifice cost are all here: Infernal
 * Cultivator and Malevolent Machinations ("Sacrifice X units") and Deformant
 * ("Sacrifice me and another ally", whose source half is choice-free).
 *
 * Seeds 113900-113949.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, give, giveResources, offered, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const queuedLabels = (h: Harness) => [
  ...h.state.triggerQueue.map(t => t.label), ...h.state.stack.map(it => it.label ?? ''),
];

/** a 3/3 unit token carrying `mod` as an augment, in `seat`'s home region */
function modded(h: Harness, seat: Seat, mod: string): EntityId {
  let id = -1 as EntityId;
  withE(h, e => {
    const t = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [3, 3] });
    e.attachMod(t, mod, seat, 'augment');
    id = t.id;
  });
  return id;
}

test('CR 714.9, 713.6e / CT-435: Infernal Cultivator paid with an Ancient One and its neighbour — the Ancient One still borrows that neighbour\'s when-I-die line as it dies', () => {
  const h = new Harness(113900);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const left = modded(h, A, 'A Pile of Rubbish');      // "[Augment] When I die, draw a card."
  const ancient = modded(h, A, 'Ancient One');         // "[Augment] I have all abilities of adjacent allies."
  const right = modded(h, A, 'A Pile of Rubbish');
  const cult = spawn(h, A, 'Infernal Cultivator');     // "[Augment] [once] Sacrifice X units: Create X Fireball 1."
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right], [cult]] });
  h.do({ type: 'activateAbility', seat: A, entityId: cult, abilityIndex: 0, via: 'augment' });
  // the LEFT neighbour first, then the Ancient One — the order that used to strip it
  pick(h, { unit: left });
  assert.ok(ent(h, left), 'a picked unit is not dead yet: the cost is not paid until it is paid in full');
  assert.ok(!offered(h).includes(`{"unit":${left}}`), 'and it is not offered a second time');
  pick(h, { unit: ancient });
  pick(h, { doneCost: true });                         // X = 2
  assert.equal(ent(h, left), undefined, 'the left neighbour was sacrificed');
  assert.equal(ent(h, ancient), undefined, 'and the Ancient One');
  assert.ok(ent(h, right), 'the right neighbour was not');
  assert.equal(h.state.stack.find(it => it.card === 'Infernal Cultivator')?.parts[0]?.costPaid?.x, 2, 'X = 2');
  const borrowed = queuedLabels(h).filter(l => l.includes('(as A Pile of Rubbish)')).length;
  assert.equal(borrowed, 2, 'one borrowed "when I die" from each neighbour, the one paid with it included');
});

test('CR 706.8c, 713.6e / CT-435: a Refuse Reclaimer paid first into Malevolent Machinations still hears the unit paid after it', () => {
  const h = new Harness(113901);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const reclaimer = spawn(h, A, 'Refuse Reclaimer');   // "[Augment] Whenever another unit dies, put a +1/+1 counter on me."
  const whale = spawn(h, A, 'Good Whale');
  const spare = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 2);
  giveResources(h, A, 'metal', 1);                     // Malevolent Machinations rrm/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[reclaimer], [whale], [spare]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Malevolent Machinations') });
  pick(h, { unit: reclaimer });
  pick(h, { unit: whale });
  pick(h, { doneCost: true });                         // X = 2
  assert.equal(ent(h, reclaimer), undefined);
  assert.equal(ent(h, whale), undefined);
  assert.ok(ent(h, spare));
  const heard = queuedLabels(h).filter(l => l.startsWith('Refuse Reclaimer')).length;
  assert.equal(heard, 1, 'it triggers on the Whale it was paid with ("order doesn\'t matter")');
});

test('CR 111.7a, 713.6e / CT-435: Deformant\'s choice-free "me" half waits for "another ally", and the two die together', () => {
  const h = new Harness(113902);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  // a Deformant carrying a when-I-die line, and an Ancient One beside it as
  // "another ally": the Deformant is charged FIRST (no choice), so one at a
  // time the Ancient One had already lost the borrowed line when it died
  const def = spawn(h, A, 'Deformant');               // "Sacrifice me and another ally: Delete all units with cost equal to the total number of counters on us."
  withE(h, e => { e.attachMod(e.entity(def)!, 'A Pile of Rubbish', A, 'augment'); });   // "When I die, draw a card."
  const ally = modded(h, A, 'Ancient One');
  spawn(h, A, 'Good Whale');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[def], [ally]] });
  h.do({ type: 'activateAbility', seat: A, entityId: def, abilityIndex: 0 });
  assert.equal(h.state.decision?.kind, 'targets', 'the ally is asked for');
  assert.ok(ent(h, def), 'the Deformant waits for the rest of its cost');
  assert.ok(!offered(h).includes(`{"unit":${def}}`), 'and is not offered as "another ally"');
  pick(h, { unit: ally });
  assert.equal(ent(h, def), undefined, 'both are sacrificed once the cost is paid');
  assert.equal(ent(h, ally), undefined);
  assert.deepEqual(h.state.stack.find(it => it.card === 'Deformant')?.parts[0]?.costPaid?.sacrificedUnits?.map(r => r.unit),
    [def, ally], 'the receipt keeps the payment order: me, then the ally');
  const labels = queuedLabels(h);
  assert.equal(labels.filter(l => l.startsWith('A Pile of Rubbish')).length, 1, "the Deformant's own line");
  assert.equal(labels.filter(l => l.includes('(as A Pile of Rubbish)')).length, 1,
    'and the Ancient One, paid with it, still borrowed that line as it died');
});
