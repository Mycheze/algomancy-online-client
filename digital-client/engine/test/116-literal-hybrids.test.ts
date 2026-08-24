/* The LITERAL-READING audit of the four hybrid batches wm-b / ld-a / ld-b /
 * ld-c (2026-08-24), pinning the two places where an implementation carried a
 * qualifier the printed card does not.
 *
 * Both are the R125 shape — "the shape of the mechanism that happened to exist
 * got promoted into a rule about the card" — and both are about the word ALL:
 *
 *  · Ominous Growth, "delete all tokens": the sweep knew two of the engine's
 *    THREE token shapes. A Wraith augmented onto a unit (R71, kind 'mod',
 *    token:true) is a token in play and used to survive.
 *  · Brough, "Everything is balanced": the static was filtered to
 *    `kind === 'unit'`, the identical invented filter R125 took off Rotspore
 *    Herald. ⚠ Nothing arithmetical moves — the three spell tokens in the pool
 *    all print 3/3 — so what is pinned here is the GRANT being literal.
 *
 * States are built explicitly (spawn/whiteBox) so parallel card registration
 * can't shift assertions. Seeds: 11600-11699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import type { EntityId } from '../src/types.ts';
import {
  ent, effStats, finishBattle, ownAttrs, pass, spawn, toDeployment, toNextBattle,
} from './util.ts';

/** run engine mutations white-box; a trigger's decision may suspend —
 * the suspension is recorded in state and answered via h.do('decide'). */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

// ── Ominous Growth: "all tokens" includes a TOKEN MOD ─────────────────────

test('Ominous Growth: "delete all tokens" reaches a Wraith augment — the third token shape', () => {
  const h = new Harness(11601);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const growth = spawn(h, D, 'Ominous Growth');          // own [Augment] text live
  // the host sits in D's home, which is the region the battle happens in —
  // "all tokens" is region-scoped (R12) and a mod carries its host's region
  const host = spawn(h, D, 'Hammer of Justice');         // a NONTOKEN 10/3 body
  let wraith: EntityId = 0, unitTok: EntityId = 0;
  whiteBox(h, e => {
    // R71: a Wraith applied rather than spawned — a token entity of kind 'mod'
    // (A augmented it onto an enemy body, which is what Blight's End does)
    wraith = e.augmentWraith(e.entity(host)!, A).id;
    unitTok = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [1, 1] }).id;
  });
  assert.equal(ent(h, wraith)!.kind, 'mod', 'the Wraith rode on as a mod');
  assert.ok(ent(h, wraith)!.token, '… and it is a token');
  assert.ok(ent(h, host)!.mods.includes(wraith), '… linked to its host');

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[unitTok]] });
  pass(h); pass(h);                                      // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                      // combat + afterCombat trigger
  pass(h); pass(h);                                      // resolve the deletion

  assert.ok(!ent(h, unitTok), 'the unit token is deleted (the shape that always worked)');
  assert.ok(!ent(h, wraith), 'the WRAITH MOD is deleted too — it is a token');
  const survivor = ent(h, host);
  assert.ok(survivor, 'its nontoken host survives — the token was the augment, not the unit');
  assert.ok(!survivor!.mods.includes(wraith), 'and the host no longer lists it');
  assert.ok(ent(h, growth), 'nontoken units stay');
  finishBattle(h);
});

// ── Brough: "Everything" carries no kind filter ───────────────────────────

test('Brough: "Everything is balanced" reaches a SPELL TOKEN, not just units', () => {
  const h = new Harness(11602);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Brough');                                 // printed 0/4
  let fb: EntityId = 0;
  whiteBox(h, e => { fb = e.createSpellToken(p, 'Fireball', 1, e.homeRegion(p)).id; });
  assert.equal(ent(h, fb)!.kind, 'spellToken', 'a non-unit entity standing in the region');
  assert.ok(ownAttrs(h, fb).has('Balanced'),
    'the Fireball token wears {Balanced} — "everything" is not "every unit"');
  // ⚠ HONEST: the grant is literal, the arithmetic does not move. Every spell
  // token in the pool prints 3/3 and max(3,3) is 3, so this is deliberately
  // asserted as UNCHANGED rather than dressed up as a stat fix.
  assert.deepEqual(effStats(h, fb), [3, 3], 'a printed 3/3 balances to 3/3 — a no-op, by design');
});

test('Brough: "Everything" is unowned — the ENEMY\'s units are balanced too', () => {
  const h = new Harness(11603);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const brough = spawn(h, D, 'Brough');                  // printed 0/4
  // put an enemy body in the SAME region as the Brough (statics are R12-scoped)
  let foe: EntityId = 0;
  whiteBox(h, e => {
    foe = e.spawnUnit(A, 'Hammer of Justice', e.entity(brough)!.region).id;
  });
  assert.equal(ent(h, foe)!.controller, A, 'it really is the other seat’s unit');
  assert.deepEqual(effStats(h, foe), [10, 10], 'a printed 10/3 enemy balances up to 10/10');
  assert.deepEqual(effStats(h, brough), [4, 4], '… and the carrier balances itself');
});

test('Brough: the REGION is the scope — a Brough at home balances nothing elsewhere', () => {
  const h = new Harness(11604);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const brough = spawn(h, D, 'Brough');
  let far: EntityId = 0, home = -1, away = -1;
  whiteBox(h, e => {
    home = e.entity(brough)!.region;
    away = e.homeRegion(A);
    far = e.spawnUnit(A, 'Hammer of Justice', away).id;
  });
  assert.notEqual(home, away, 'the fixture really does straddle two regions');
  assert.deepEqual(effStats(h, far), [10, 3], 'out of the region, no {Balanced}');
  assert.ok(!ownAttrs(h, far).has('Balanced'), '… and no grant either');
});
