/**
 * CT-436 — in a mixed death batch each "Deadly — X dies." line is printed just
 * before X's own "dies → bin" line, not all of them ahead of the first one.
 *
 * Since CT-413 (test 680) the Deadly, collapsed-Unaware and Pure sweeps only
 * DECIDE who dies; `checkDeaths` disposes them in one `destroyBatch` with the
 * lethal-damage deaths (CR 608.7b, 713.6). Each decided victim carries its
 * announcement (`Doomed.say`), and `checkDeaths` used to call every one of
 * them before the batch began, so the log read
 *
 *   Deadly — A dies.  Deadly — B dies.  A dies → bin.  B dies → bin.
 *
 * The announcement now rides into `destroyBatch` and is printed just before
 * its own unit's death line. Which units die and in what order is unchanged
 * (test 680 pins the batch).
 *
 * Seeds 114000-114099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EffectCtx } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, pass, toDeployment, toNextBattle, withE } from './util.ts';

function token(h: Harness, s: Seat, p: number, t: number): EntityId {
  let id = -1;
  withE(h, g => { id = g.spawnUnit(s, 'Unit Token', g.homeRegion(s), { token: true, tokenStats: [p, t] }).id; });
  return id;
}

/** the log from `from` on, cut to the Deadly announcements and the death lines */
function deathLines(h: Harness, from: number): string[] {
  return h.log.slice(from).filter(l => / dies → /.test(l) || /Deadly — .* dies\./.test(l));
}

/** every Deadly announcement is followed at once by a death line */
function assertPaired(lines: string[], deadly: number): void {
  const ann = lines.flatMap((l, i) => (/Deadly — /.test(l) ? [i] : []));
  assert.equal(ann.length, deadly, `${deadly} Deadly announcements:\n${lines.join('\n')}`);
  for (const i of ann) {
    assert.match(lines[i + 1] ?? '', / dies → /,
      `"${lines[i]}" is followed by its unit's death line, not another announcement:\n${lines.join('\n')}`);
  }
}

test('CT-436: two Deadly kills and a lethal one in one combat sub-step — each "Deadly — X dies." sits just before its own death line', () => {
  const h = new Harness(114000);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = token(h, A, 1, 9), a1 = token(h, A, 1, 9), a2 = token(h, A, 5, 9);
  withE(h, g => { g.addTempAttr(g.entity(a0)!, 'Deadly'); g.addTempAttr(g.entity(a1)!, 'Deadly'); });
  const b0 = token(h, D, 0, 3), b1 = token(h, D, 0, 3), b2 = token(h, D, 0, 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1], [a2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0], 1: [b1], 2: [b2] } });
  const from = h.log.length;
  pass(h); pass(h);                                   // the one (normal) damage sub-step
  for (const id of [b0, b1, b2]) assert.equal(ent(h, id), undefined, 'all three blockers died');
  const lines = deathLines(h, from);
  assert.equal(lines.filter(l => / dies → /.test(l)).length, 3, lines.join('\n'));
  assertPaired(lines, 2);
});

test('CT-436: a Deadly effect killing a row — each "<source> is Deadly — X dies." sits just before its own death line', () => {
  const h = new Harness(114001);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids = [token(h, A, 3, 3), token(h, A, 3, 3), token(h, A, 3, 3)];
  token(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  const from = h.log.length;
  withE(h, g => {
    g.dealEffectDamageAll({
      controller: D, sourceName: 'Carapace Devourer', region: h.state.battle!.region, targets: [],
      event: null, eraseSelf: () => {},   // printed {Deadly}
      choose: () => { throw new Error('no choice expected'); },
    } as unknown as EffectCtx, ids.map(id => ({ target: g.entity(id)!, n: 1 })));
  });
  for (const id of ids) assert.equal(ent(h, id), undefined, '1 Deadly damage killed every 3/3 token');
  assertPaired(deathLines(h, from), 3);
});

test('CT-436: a lethal death keeps no announcement — a lone lethal kill is just its death line', () => {
  const h = new Harness(114002);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = token(h, A, 5, 9);
  const b0 = token(h, D, 0, 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  const from = h.log.length;
  pass(h); pass(h);
  assert.equal(ent(h, b0), undefined);
  assert.deepEqual(deathLines(h, from).map(l => / dies → /.test(l)), [true]);
});
