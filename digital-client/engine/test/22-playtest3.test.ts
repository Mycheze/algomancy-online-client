/* Playtest round 3 (2026-08-18, second live game):
 *  - absent counterattackers "don't exist" in the region they left: no
 *    statics radiation (Towering Colossus), no spell-token enumeration
 *  - Tidelurker's 2/2 is created in its CONTROLLER'S region, not the battle
 *  - Tiderunner Initiate's "open spot" prompt: behind a survivor, an emptied
 *    column, or a NEW column beside an existing formation
 *  - seenHand: a Bripp look is remembered; the owner's draft merge clears it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

// ── absent units don't exist where they left ──────────────────────────

test('a SENT Towering Colossus host radiates nothing in the region it left (Manual p.20)', () => {
  const h = new Harness(2200);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                 // 1/1 attacker
  const host = spawn(h, D, 'Bubb');                      // 5/6 — the Colossus carrier
  const dHome = spawn(h, D, 'Unit Token');               // 1/1 staying home
  giveResources(h, D, 'earth', 5);                       // Colossus augment ee/5
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Towering Colossus'), hostId: host });
  assert.deepEqual(effStats(h, atk), [1, 1], 'pre-battle: enemies buffed only in the SAME region');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                      // → blocks
  // the attacker IS in D's region now — the in-region Colossus buffs it (+2/+2)
  assert.deepEqual(effStats(h, atk), [3, 3], 'enemy attacker in the Colossus region gets +2/+2');
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [host] });
  // host is SENT: it has left the region — the attacker loses the buff NOW
  assert.deepEqual(effStats(h, atk), [1, 1], 'a sent Colossus radiates nothing in the region it left');
  // survive round 1 (unblocked 1 damage to D), into round 2
  let guard = 8;
  while (h.state.phase === 'battle' && h.state.battle?.round === 1 && guard-- > 0) {
    pass(h);
  }
  assert.equal(h.state.battle?.round, 2, 'round 2: the counterattack');
  assert.equal(ent(h, host)!.region, new E(h.state).homeRegion(A), 'the sent host arrived in the enemy region');
  assert.equal(ent(h, host)!.absent, false, 'and exists again');
  assert.deepEqual(effStats(h, dHome), [1, 1], "D's home unit is not an enemy of D — never buffed");
  finishBattle(h);
});

test('a sent spell token is not enumerable (castSpellToken) while absent', () => {
  const h = new Harness(2201);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const dUnit = spawn(h, D, 'Unit Token');
  const e = new E(h.state);
  const tok = e.createSpellToken(D, 'Fireball', 2, e.homeRegion(D));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [dUnit, tok.id] });
  const q = new E(h.state);
  assert.ok(!q.tokensOf(D, q.homeRegion(D)).some(t => t.id === tok.id),
    'the sent token has left — not castable from the region it departed');
  finishBattle(h);
});

// ── Tidelurker ────────────────────────────────────────────────────────

test("Tidelurker's 2/2 is created at HOME even when it triggers while attacking", () => {
  const h = new Harness(2202);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lurker = spawn(h, A, 'Tidelurker');              // 1/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lurker]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                      // combat: D takes 1 → trigger at once
  const e = new E(h.state);
  const tokens = unitsOf(h, A).filter(u => u.token && u.tokenStats?.[0] === 2);
  assert.equal(tokens.length, 1, 'the 2/2 was created');
  assert.equal(tokens[0]!.region, e.homeRegion(A),
    "…in its controller's HOME region (it can block the counterattack), not the battle region");
  finishBattle(h);
});

// ── Tiderunner Initiate ───────────────────────────────────────────────

/** drive: attacker declares, then plays Tiderunner in the attack window.
 *
 * R29 (retimed 2026-08-22, playtest UFAB): the four passes are gone. The spot
 * is part of PLAYING the card, so `playCard` raises the question itself —
 * there is no window in which the unit stands outside the formation waiting
 * for a trigger to resolve, which is exactly the window the report was about. */
function castTiderunner(h: Harness, seat: Seat): void {
  giveResources(h, seat, 'water', 1);
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Tiderunner Initiate') });
}

test('Tiderunner (attacker): offered behind-survivor, a NEW column, or stay out', () => {
  const h = new Harness(2203);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Bubb');                       // 5/6 survives everything
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  castTiderunner(h, A);
  const dec = h.state.decision!;
  assert.equal(dec.seat, A);
  assert.ok(dec.options.some(o => o.label.includes('behind Bubb')), 'behind the survivor');
  // R75: BOTH ends of the line, not just the right-hand one
  assert.ok(dec.options.some(o => o.label === 'a new column on the left'), 'the left end');
  assert.ok(dec.options.some(o => o.label === 'a new column on the right'), 'the right end');
  assert.ok(dec.options.some(o => o.label === 'stay out of formation'), 'joining is optional');
  pick(h, dec.options.find(o => o.label === 'a new column on the right')!.value);
  pass(h); pass(h);                                      // the cast resolves
  const b = h.state.battle!;
  assert.equal(b.columns.length, 2, 'the formation widened');
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.deepEqual(b.columns[1], [tr.id], 'Tiderunner fronts the new column');
  finishBattle(h);
});

test('Tiderunner with NO formation of yours: no join prompt at all', () => {
  const h = new Harness(2204);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Bubb');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                               // priority → D
  // D (defender, no blocks declared yet → no formation) plays it
  giveResources(h, D, 'water', 1);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tiderunner Initiate') });
  pass(h); pass(h);                                      // resolve: spawns, NO trigger
  assert.equal(h.state.decision, null, 'nothing to join — no prompt');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Tiderunner Initiate'), 'still entered play');
  finishBattle(h);
});

// ── seenHand ──────────────────────────────────────────────────────────

test("Bripp look is remembered in seenHand; the owner's draft merge clears it", () => {
  const h = new Harness(2205);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  pick(h, { player: D });
  pass(h); pass(h);                                      // resolve → hand look → pick pending
  // the pending pick decision carries card names for the client
  const dec = h.state.decision!;
  assert.ok(dec.options.some(o => o.card !== undefined), 'options carry card refs');
  pick(h, -1);                                           // decline the recycle
  // (the reveal commits with the resolution — a mid-choice suspension rolls
  // back to the part boundary, so assert after the decision completes)
  assert.ok(h.state.seenHand[A], 'the look was recorded');
  assert.equal(h.state.seenHand[A]!.cards.length, h.state.players[D]!.hand.length,
    'snapshot matches the hand (nothing was recycled)');
  assert.equal(h.state.seenHand[A]!.turn, h.state.turn);
  assert.equal(h.state.seenHand[D], null, 'the other seat saw nothing');
  // draft-merge staleness: white-box on a draft game
  const d = new Harness(2205, undefined, 'draft');
  d.state.seenHand[0] = { turn: 1, cards: ['Jelly'] };
  const H = d.state.players[1]!.hand.length;
  d.do({ type: 'draftCommit', seat: 1, packIndices: d.state.packs[1]!.map((_, i) => H + i) });
  assert.equal(d.state.seenHand[0], null, "seat 1's merge stales what seat 0 saw");
});
