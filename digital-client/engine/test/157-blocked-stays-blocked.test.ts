/* R185 — a blocked column stays blocked however the blocker leaves.
 *
 * CARD-TODO #62. The engine has always done this, and until now it was an
 * ACCIDENT of R72's after-blocks lock rather than a decision: `exchangeAt`
 * reads `blockedEver = b.blocks[ci] !== undefined`, so once a column has been
 * blocked it is blocked for the rest of the sub-step, whatever happens to the
 * blocker. The Manual is explicit about the MIRROR case — a blocker whose
 * attackers have all died "stays, but has nothing to deal damage to" — so one
 * direction was a written rule and the other was an implementation detail with
 * a comment on it.
 *
 * THE OWNER RULED IT, 2026-08-25: **the column stays blocked.** Removing a
 * blocker mid-combat does not un-declare the block, so the attacker still deals
 * nothing. His framing: removal "protected nothing but still cost them a card".
 * The alternative — killing a blocker becomes a way to push damage through —
 * was put to him explicitly and declined.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COMMENT. `02-combat.test.ts` already pins
 * the case where the blocker DIES. It does not pin any of the ways a blocker
 * can LEAVE without dying, and those are the ones that became reachable
 * recently: R172 pinned Download's mid-battle steal, and erase-from-play only
 * started announcing itself as a despawn yesterday. A rule that holds for one
 * route out of play and was never tested on the other three is exactly the
 * shape this repo keeps finding half-implemented (R167 was the same shape one
 * verb over).
 *
 * ⚠ The attacker here is deliberately a VANILLA unit. `02-combat`'s existing
 * test uses Good Whale, which is {Piercing}, and Piercing DOES carry through a
 * blocked-but-empty column — so a Piercing attacker measures the piercing rule
 * and not the blocking rule. Using one here would have made every assertion
 * below pass for the wrong reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { spawn, toDeployment, toNextBattle, pass, ent } from './util.ts';
import type { Seat, EntityId } from '../src/types.ts';

/** run a raw engine call against the harness state, absorbing a suspension */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try { fn(e); e.settle(); } catch (sig) { if (!(sig instanceof Suspended)) throw sig; }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** an attack of one vanilla unit into one blocker, stopped in the block window */
function blockedColumn(seed: number, block: boolean):
{ h: Harness; A: Seat; D: Seat; atk: EntityId; blk: EntityId; life: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Bubb');             // vanilla — NOT {Piercing}, see the header
  const blk = spawn(h, D, 'Curio Drifter');    // 2/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: block ? { 0: [blk] } : {} });
  return { h, A, D, atk, blk, life: h.state.players[D]!.life };
}

const runOut = (h: Harness): void => { pass(h); pass(h); pass(h); pass(h); };

/* ── the negative control comes FIRST, because without it every assertion
 *    below passes on a board where nothing was ever going to connect ──── */

test('R185 (control): an UNBLOCKED column really does connect, so the rest of this file means something', () => {
  const { h, D, life } = blockedColumn(7701, false);
  runOut(h);
  assert.ok(h.state.players[D]!.life < life,
    'the defender must lose life when the column was never blocked. If this fails, the fixture '
    + 'is not delivering damage at all and every "no damage through" assertion below is vacuous.');
});

test('R185: a blocker that DIES leaves the column blocked', () => {
  const { h, D, blk, life } = blockedColumn(7702, true);
  whiteBox(h, e => e.destroy(e.entity(blk)!, 'is deleted'));
  assert.ok(!ent(h, blk), 'the blocker is gone before damage');
  runOut(h);
  assert.equal(h.state.players[D]!.life, life, 'no damage through the blocked column');
});

test('R185: a blocker that is RECALLED leaves the column blocked', () => {
  const { h, D, blk, life } = blockedColumn(7703, true);
  whiteBox(h, e => (e as unknown as { recall(u: unknown): void }).recall(e.entity(blk)!));
  assert.ok(!ent(h, blk), 'the blocker left play without dying');
  runOut(h);
  assert.equal(h.state.players[D]!.life, life, 'no damage through the blocked column');
});

test('R185: a blocker that is ERASED leaves the column blocked', () => {
  const { h, D, blk, life } = blockedColumn(7704, true);
  whiteBox(h, e => (e as unknown as { eraseFromPlay(u: unknown): void }).eraseFromPlay(e.entity(blk)!));
  assert.ok(!ent(h, blk), 'the blocker left play without dying');
  runOut(h);
  assert.equal(h.state.players[D]!.life, life, 'no damage through the blocked column');
});

test('R185: a blocker STOLEN mid-combat (Download) leaves the column blocked', () => {
  // The route the ruling was actually asked about. R172 pinned the other half
  // of this — the stolen token sits out of the formation until regroup — but
  // said nothing about the column it was blocking.
  const { h, A, D, blk, life } = blockedColumn(7705, true);
  whiteBox(h, e => e.giveControl(e.entity(blk)!, A));
  assert.equal(ent(h, blk)?.controller, A, 'the blocker changed hands and is still in the game');
  runOut(h);
  assert.equal(h.state.players[D]!.life, life,
    'no damage through the blocked column — stealing the blocker does not un-declare the block, '
    + 'and the attacker does not get to fight a unit it now controls');
});
