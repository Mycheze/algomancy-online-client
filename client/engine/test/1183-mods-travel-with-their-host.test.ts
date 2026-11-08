/* CR 720.6 — A MOD GOES WHERE ITS HOST GOES.
 *
 * Playtest report #342 (invi, room ASSX, 2026-11-07): "augments falling off of
 * a recalled creature should count as trashed for dropslime". Yagamino grafted
 * Molten Upheaval and Void Memory onto Bloated Manablub at home, attacked into
 * invi's region and had it recalled by Auric Ascendant there. Both mods were
 * trashed (CR 720.8), but the battle's trash count put them under Yagamino's
 * home region, so each Dropslime dealt 5 where seven cards had been trashed in
 * the battle (CR 505.6: "in this battle" is counted per region).
 *
 * Root cause: a mod is a separate entity with its own `region`, and declaring
 * an attack moved the attackers (`declareAttack`) without their mods, as did a
 * counterattacker's arrival in the initiative player's region. Every other
 * move already carried them (control change CR 711.4, a mod moved to a new
 * host, regroup). CR 720.6: "the mods are not separate from it" — so every
 * move now goes through `E.moveToRegion`, which carries the mods, and the
 * fuzz invariant (test/fuzz.ts checkInvariants) refuses a mod whose region is
 * not its host's, so a new move that forgets them is caught on any seed.
 *
 * Seeds 11830-11839.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import { checkInvariants } from './fuzz.ts';

/** A modded unit of A's, attacking into D's region. */
function moddedAttacker(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const hostId = spawn(h, A, 'Good Whale');
  let modId = -1;
  withE(h, e => { modId = e.attachMod(e.entity(hostId)!, 'Ignis Sprite', A, 'augment').id; });
  toNextBattle(h, A);
  const home = new E(h.state).homeRegion(A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hostId]] });
  const region = h.state.battle!.region;
  assert.notEqual(region, home, 'premise: the attack leaves its home region');
  return { h, A, D, hostId, modId, region, home };
}

test('report #342: an attacker\'s mod travels into the battle region with it', () => {
  const { h, hostId, modId, region } = moddedAttacker(11830);
  assert.equal(ent(h, hostId)!.region, region, 'the host is in the battle region');
  assert.equal(ent(h, modId)!.region, region, 'and so is its mod — it is part of the host (CR 720.6)');
  checkInvariants(h.state);
});

test('report #342: a mod trashed off a recalled attacker counts as trashed in that battle (Dropslime\'s count)', () => {
  const { h, hostId, region, home } = moddedAttacker(11831);
  let here = -1, there = -1;
  withE(h, e => {
    const r0 = e.battleCounter(region, 'trashed'), h0 = e.battleCounter(home, 'trashed');
    e.recall(e.entity(hostId)!);
    here = e.battleCounter(region, 'trashed') - r0;
    there = e.battleCounter(home, 'trashed') - h0;
  });
  assert.ok(h.events.some(ev => ev.type === 'trashed' && ev.data?.['card'] === 'Ignis Sprite'),
    'premise: the mod is trashed on the recall (CR 720.8)');
  assert.equal(here, 1, 'the trash counts in the battle it happened in');
  assert.equal(there, 0, 'and not in the home region the host left');
});

test('report #342: a modded counterattacker arrives with its mods', () => {
  const h = new Harness(11832);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const ctr = spawn(h, D, 'Good Whale');
  let modId = -1;
  withE(h, e => { modId = e.attachMod(e.entity(ctr)!, 'Ignis Sprite', D, 'augment').id; });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr] });
  let guard = 20;
  while (h.state.battleRound === 1 && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.round, 2, 'premise: the counterattack round');
  const region = h.state.battle!.region;
  assert.equal(ent(h, ctr)!.region, region, 'the counterattacker has arrived');
  assert.equal(ent(h, modId)!.region, region, 'its mod arrived with it, before any attack is declared');
  checkInvariants(h.state);
});
