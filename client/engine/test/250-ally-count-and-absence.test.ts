/* R270 — A SENT COUNTERATTACKER IS NOT ON THE BOARD, SO IT CANNOT DIE ON IT.
 *
 * Report #144 (room QJEY, 2026-08-30): *"Why did the Prickly Protector die
 * here? It should have always been in a region with at least 1 other ally,
 * offsetting the -1/-1 counter that it had."*
 *
 * QJEY cannot be replayed (the server forked it mid-game; divergence starts at
 * action 14), so the board is rebuilt here instead. What the ACTION LOG still
 * says is the shape: action 124 augmented a card from the bin onto entity 31,
 * action 149 declared `blocks {} send [35, 31]`, and by action 156 only 35 was
 * left to attack with. The carrier died in the send.
 *
 * THE MECHANISM. `E.anchored` refuses to radiate from an ABSENT anchor — "a
 * sent counterattacker doesn't exist until phase 1 finishes" (Manual p.20) —
 * and `doDeclareBlocks` stamps `absent = true` on every unit it sends. Every
 * other read in the engine agrees with that stamp: an absent unit is not
 * targetable (`E.targetLive`), not sacrificeable, not returned by `unitsOf` /
 * `unitsIn`, and radiates nothing. `checkDeaths` was the one dissenter — it
 * swept `s.entities` for `kind === 'unit'` and never looked at `absent`. So a
 * unit that does not exist was still being asked to pass a state-based check,
 * with its OWN text switched off for the duration.
 *
 * Prickly Protector — "[Augment] I gain +1/+1 for each other ally", a 0/1 —
 * is the sharpest possible victim: with a -1/-1 counter it is alive only
 * because of a static it radiates onto itself. Declaring it as a
 * counterattacker killed it before it ever left.
 *
 * Seeds 25000-25099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { effStats, ent, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** the live "other allies" Prickly Protector counts from `id`'s perspective */
function otherAllies(h: Harness, id: EntityId): number {
  const e = new E(h.state);
  const self = e.entity(id)!;
  return e.unitsOf(self.controller, self.region).filter(u => u.id !== self.id).length;
}

/** attacker declares one column, both seats pass into the blocks step */
function intoBlocks(h: Harness, A: Seat, atk: EntityId): void {
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'the defender is on to declare blocks');
}

/** pass/answer until battle round 2 has started (the counterattack) */
function intoRound2(h: Harness): void {
  let guard = 60;
  while (h.state.battleRound !== 2 && guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
      continue;
    }
    if (h.state.phase !== 'battle') break;
    pass(h);
  }
  assert.equal(h.state.battleRound, 2, 'the counterattack round started');
}

// ── 1. THE REPORT, played straight ────────────────────────────────────────
//
// Prickly Protector and one ally, both sent out together, exactly as QJEY's
// action 149 sent 35 and 31. Nothing has touched the Protector: no damage, no
// second counter, no spell. It is declared as a counterattacker and dies.

test('Prickly Protector survives being declared as a counterattacker (R270, report 144)', () => {
  const h = new Harness(25000);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const prick = spawn(h, D, 'Prickly Protector');        // 0/1
  const mate = spawn(h, D, 'Unit Token');                // the one other ally
  withE(h, e => { e.addCounters(e.entity(prick)!, -1); });

  // NON-VACUITY FIRST: the board really is the one the report describes —
  // one other ally in the region, a -1/-1 counter, and a live 0/1 body.
  assert.equal(otherAllies(h, prick), 1, 'exactly one other ally in the region');
  assert.equal(ent(h, prick)!.counters, -1, 'the Protector carries the -1/-1 counter');
  assert.deepEqual(effStats(h, prick), [0, 1], 'the +1/+1 offsets the counter: a live 0/1');

  toNextBattle(h, A);
  intoBlocks(h, A, atk);
  assert.deepEqual(effStats(h, prick), [0, 1], 'still a live 0/1 on the way into the blocks step');

  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [prick, mate] });

  assert.ok(ent(h, prick), 'the Protector is still on the board after being sent');
  assert.ok(!h.log.some(l => l.includes('Prickly Protector dies')),
    `nothing killed it: ${JSON.stringify(h.log.slice(-4))}`);
  assert.equal(ent(h, prick)!.absent, true, 'and it IS away — absent, as a counterattacker should be');

  // it comes back in the attacker's region with its companion, and is still
  // exactly the 0/1 it was: one other ally there too.
  intoRound2(h);
  assert.ok(ent(h, prick), 'it arrived');
  assert.equal(ent(h, prick)!.absent, false, 'and it exists again');
  assert.equal(otherAllies(h, prick), 1, 'its companion arrived in the same region');
  assert.deepEqual(effStats(h, prick), [0, 1], 'still the live 0/1');
  assert.deepEqual(h.state.battle!.attackerPool, [prick, mate],
    'both counterattackers are available to attack with');
});

// ── 2. The same thing through the AUGMENT channel ─────────────────────────
//
// QJEY's action 124 put a card from the bin onto entity 31 as an augment, and
// Prickly Protector is `augmentable`. Donated, its static anchors on the HOST
// and reads the host's region and controller. `E.anchored` drops an augment
// mod exactly as it drops a unit when the ANCHOR is absent, so the host loses
// the donated text the moment it is sent — the identical failure, one channel
// over, and it is the shape the report was actually filed against.

test('a host wearing a donated Prickly Protector survives being sent out (R270)', () => {
  const h = new Harness(25001);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const host = spawn(h, D, 'Unit Token');                // 1/1
  const mate = spawn(h, D, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Prickly Protector', D, 'augment'); });
  withE(h, e => { e.addCounters(e.entity(host)!, -1); });

  assert.equal(otherAllies(h, host), 1, 'one other ally for the donated static to count');
  assert.deepEqual(effStats(h, host), [1, 1], 'base 1/1, +1/+1 from the augment, -1/-1 from the counter');

  toNextBattle(h, A);
  intoBlocks(h, A, atk);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [host, mate] });

  assert.ok(ent(h, host), 'the augmented host is still on the board after being sent');
  intoRound2(h);
  assert.ok(ent(h, host), 'and it arrived');
  assert.deepEqual(effStats(h, host), [1, 1], 'the donated static still reads one other ally');
});

// ── 3. Not immortal — the sweep just moves to the arrival ─────────────────
//
// The counterattacker skips the state-based sweep only while it does not
// exist. `endBattleRound` puts it back, in the INITIATIVE seat's region, and
// that is the first moment its stats can be read again — so one sent out on
// its own, with its allies left at home, materialises with nothing to count
// and dies there. Both halves matter: alive at the send (red before R270),
// dead on the arrival (which is what stops the fix from being "counter-
// attackers cannot die").

test('a counterattacker sent out alone survives the send and dies on arrival (R270)', () => {
  const h = new Harness(25002);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const prick = spawn(h, D, 'Prickly Protector');
  const stayer = spawn(h, D, 'Unit Token');              // stays home
  withE(h, e => { e.addCounters(e.entity(prick)!, -1); });
  assert.deepEqual(effStats(h, prick), [0, 1], 'a live 0/1 before anyone moves');

  toNextBattle(h, A);
  intoBlocks(h, A, atk);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [prick] });
  assert.ok(ent(h, prick), 'the send itself does not kill it');
  assert.ok(ent(h, stayer), 'and the ally it left behind is untouched');

  intoRound2(h);
  assert.equal(ent(h, prick), undefined,
    'it arrived alone in the other region, counted no allies, and died there');
  assert.ok(h.log.some(l => l.includes('Prickly Protector dies')), 'and the death is logged');
});

// ── 4. SCOPE. What R270 does NOT change ───────────────────────────────────
//
// The fix is about the absent unit ITSELF, not about the region count. A unit
// that stays home while its only ally counterattacks is present, is death-
// checked, and legitimately has nobody left to count: `unitsOf` has excluded
// absent units since the flag existed, 32 pool cards print "ally"/"allies" and
// 59 card-code sites are region-scoped, so widening that would be a pool-wide
// rules change and not a bug fix. This pins the current answer so the fix
// cannot quietly grow into it. It is the question R270 puts to the owner.

test('scope: a unit left at home still loses the ally that counterattacked away', () => {
  const h = new Harness(25003);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const prick = spawn(h, D, 'Prickly Protector');
  const mate = spawn(h, D, 'Unit Token');
  withE(h, e => { e.addCounters(e.entity(prick)!, -1); });
  assert.deepEqual(effStats(h, prick), [0, 1], 'alive on its one ally');

  toNextBattle(h, A);
  intoBlocks(h, A, atk);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [mate] });   // the ALLY leaves; the Protector stays

  assert.equal(ent(h, mate)!.absent, true, 'the ally is away');
  assert.equal(ent(h, prick), undefined,
    'the Protector, still present and still swept, has no other ally left to count');
});
