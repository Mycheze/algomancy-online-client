/**
 * CR 706.8c, 713.6 / CT-414 — the units one "sacrifices" instruction takes die
 * TOGETHER, as one death batch, so each still hears the others leave.
 *
 * The designer, rules-questions 2025-11-23, asked whether Perish's sacrifices
 * resolve "in any order I want" or all at once:
 *   calebgannon: "Sacrifices are resolved simultaneously, so there's no window
 *                 between the first and second sacrifice." (RQ 1442175942838718518)
 *   ainecaptain: "… if the refuse reclaimer was part of the sacrifices no
 *                 counters would be created? Or they would since it was 'there'?"
 *   calebgannon: "It would trigger but it would be dead before it was able to get
 *                 any counters." (RQ 1442177903952396430)
 *
 * Every "each player / each opponent sacrifices" card (and Lurking Dread's two)
 * used to commit its picks one `destroy` at a time — Perish even destroyed each
 * pick as it was made — so a Refuse Reclaimer picked first was gone before the
 * rest died and never triggered on them. They now plan every pick, then call
 * `sacrificeTogether` (one `E.destroyBatch`).
 *
 * Seeds 68300-68349.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard, type EffectCtx } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, give, giveResources, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const queuedLabels = (h: Harness) => [
  ...h.state.triggerQueue.map(t => t.label), ...h.state.stack.map(it => it.label ?? ''),
];

test('CR 706.8c, 713.6 / CT-414: a Refuse Reclaimer sacrificed first to Perish still triggers on every other unit Perish takes (the designer example)', () => {
  const h = new Harness(68300);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const reclaimer = spawn(h, A, 'Refuse Reclaimer');   // "[Augment] Whenever another unit dies, put a +1/+1 counter on me."
  const mine = [reclaimer, spawn(h, A, 'Good Whale'), spawn(h, A, 'Good Whale'), spawn(h, A, 'Good Whale')];
  const theirs = [spawn(h, D, 'Good Whale'), spawn(h, D, 'Good Whale')];
  giveResources(h, A, 'metal', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: mine.map(id => [id]) });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Perish') });   // "Each player sacrifices half of their units, rounded up."
  pass(h); pass(h);
  // A sacrifices 2 of 4 (the Reclaimer FIRST, then a Whale), D 1 of 2
  const pickFor = (id: EntityId) => {
    const d = h.state.decision!;
    const i = d.options.findIndex(o => o.value === id);
    assert.notEqual(i, -1, `option ${id} offered; menu [${d.options.map(o => o.label).join(' | ')}]`);
    h.do({ type: 'decide', seat: d.seat, choice: i });
  };
  pickFor(reclaimer);
  pickFor(mine[1]!);
  pickFor(theirs[0]!);
  assert.equal(ent(h, reclaimer), undefined, 'the Reclaimer was sacrificed');
  assert.equal(ent(h, mine[1]!), undefined);
  assert.equal(ent(h, theirs[0]!), undefined);
  const heard = queuedLabels(h).filter(l => l.startsWith('Refuse Reclaimer')).length;
  assert.equal(heard, 2, 'it triggers once for each other unit sacrificed with it ("It would trigger")');
});

test('CR 706.8c, 714.9 / CT-414: Maw of Damnation sacrifices an Ancient One with its neighbour in one batch, so it borrows that neighbour when-I-die line', () => {
  const h = new Harness(68301);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids: EntityId[] = [];
  withE(h, e => {
    for (const mod of ['A Pile of Rubbish', 'Ancient One', 'A Pile of Rubbish']) {
      const t = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [3, 3] });
      e.attachMod(t, mod, A, 'augment');
      ids.push(t.id);
    }
  });
  spawn(h, D, 'Unit Token');                          // D has one unit: 3 sacrificed, no repeat
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  // A picks the LEFT neighbour first, then the Ancient One; the right neighbour stays
  const want = [ids[0]!, ids[1]!];
  withE(h, e => {
    getCard('Maw of Damnation').spellEffect!.run(e, {
      controller: A, sourceName: 'Maw of Damnation', region: h.state.battle!.region, targets: [],
      event: null, eraseSelf: () => {},
      choose: (_k: string, d: { options: { value: unknown }[] }) =>
        d.options.find(o => want.includes(o.value as EntityId))?.value ?? d.options[0]!.value,
    } as unknown as EffectCtx);
  });
  assert.equal(ent(h, ids[0]!), undefined, 'the left neighbour was sacrificed');
  assert.equal(ent(h, ids[1]!), undefined, 'and the Ancient One');
  assert.ok(ent(h, ids[2]!), 'the right neighbour was not');
  const borrowed = queuedLabels(h).filter(l => l.includes('(as A Pile of Rubbish)')).length;
  assert.equal(borrowed, 2, 'one borrowed "when I die" from each neighbour, the sacrificed one included');
});
