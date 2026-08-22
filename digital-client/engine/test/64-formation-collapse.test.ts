/* R72 — formation GRAVITY: the two halves, and their different timing.
 *
 * Reported in game BRDM, 2026-08-20, deferred in the round-7 commit message,
 * and fixed in round 13:
 *
 *   "When a column becomes empty during combat, the columns to the right
 *    should immediately collapse and fill the gap. There can never be an empty
 *    column in the middle of a formation. The game fixes the formation as a
 *    state based action"
 *
 * The Manual's "HOLD THE LINE" is the actual rule, and it is narrower than the
 * report — the report is right about the mechanism and wrong about when:
 *
 *   "The front row of a column must be filled first before a unit can be
 *    placed in a back row."
 *   "If a unit is removed from a formation, any units behind it move to the
 *    front row and take its place."
 *   "If the last unit in a column is removed from a formation, the columns on
 *    its sides will close in to fill the gap. This only happens before blocks
 *    are declared. After blocks, columns will not move to fill gaps."
 *
 * So VERTICAL gravity is untimed and HORIZONTAL gravity is not. After blocks,
 * an emptied column is a permanent hole and every column index is frozen for
 * the rest of the battle. The first build of R72 ran the collapse
 * unconditionally, including between damage sub-steps; these tests are mostly
 * about the window.
 *
 * The hard part of the horizontal half is that `BattleState.blocks` is keyed by
 * attack-column INDEX — the index IS the column's identity — so closing a gap
 * is a re-key. Note what the timing rule does to that: a collapse can only run
 * while `b.blocks` is still empty, so the live re-key case is R75's
 * left-insert, not this one. `E.rekeyColumns` owns both.
 *
 * Seeds 6400-6499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';

/** shape a unit's stats white-box (layer 2, R66) so each scenario decides
 * exactly who dies and who walks away */
function stats(h: Harness, id: EntityId, p: number, t: number): void {
  new E(h.state).setBase(ent(h, id)!, p, t);
}

/** the formation as a plain array, holes included */
function cols(h: Harness): EntityId[][] {
  return h.state.battle!.columns.map(c => c.slice());
}

/** kill a unit white-box — a stand-in for any spell that removes one. Returns
 * the events it produced: a white-box E keeps its own event list, so they never
 * reach h.events. */
function kill(h: Harness, id: EntityId): EngineEvent[] {
  const e = new E(h.state);
  e.destroy(ent(h, id)!, 'is deleted');
  e.settle();
  return e.events;
}

/**
 * Three one-unit attacking columns of `The Foretold` (a vanilla 3/3), stopped
 * at the block step — which is still BEFORE blocks are declared.
 */
function board(seed: number, nBlockers = 0): {
  h: Harness; A: Seat; D: Seat; atk: EntityId[]; blk: EntityId[];
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [0, 1, 2].map(() => spawn(h, A, 'The Foretold'));
  const blk = Array.from({ length: nBlockers }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  pass(h); pass(h);                                   // attack window → blocks
  return { h, A, D, atk, blk };
}

/* ── horizontal gravity: BEFORE blocks are declared ─────────────────────── */

test('R72: a middle column emptied before blocks collapses, and the right-hand columns shift', () => {
  const { h, atk } = board(6400);
  assert.ok(h.state.battle!.step === 'blocks', 'blocks have not been declared yet');
  kill(h, atk[1]!);

  const b = h.state.battle!;
  assert.equal(b.columns.length, 2, 'the empty column stopped existing');
  assert.deepEqual(cols(h), [[atk[0]!], [atk[2]!]], 'the right-hand column slid left into the gap');
  assert.ok(!b.columns.some(c => c.length === 0), 'no hole is left behind');
  finishBattle(h);
});

test('R72: the LEFT column emptying pulls everything left too', () => {
  const { h, atk } = board(6401);
  kill(h, atk[0]!);
  assert.deepEqual(cols(h), [[atk[1]!], [atk[2]!]]);
  finishBattle(h);
});

test('R72: a unit RECALLED out of a middle column closes the gap too (no death involved)', () => {
  const { h, atk } = board(6402);
  const e = new E(h.state);
  e.recall(ent(h, atk[1]!)!);
  e.settle();
  assert.deepEqual(cols(h), [[atk[0]!], [atk[2]!]]);
  finishBattle(h);
});

test('R72: the gap is closed before any observer runs — the collapse sits between the death and its trash', () => {
  const { h, atk } = board(6403);
  const evs = kill(h, atk[1]!);
  const types = evs.map(ev => ev.type);
  const died = evs.findIndex(ev => ev.type === 'died' && ev.data?.['unit'] === atk[1]!);
  assert.ok(died !== -1, 'the unit died');
  const closed = evs.findIndex((ev, i) =>
    i > died && ev.type === 'info' && /formation closes up/.test(ev.msg));
  assert.ok(closed !== -1, 'the collapse is announced');
  const trashed = types.indexOf('trashed', died);
  assert.ok(trashed !== -1 && closed < trashed,
    'the formation is repaired before the trash event — and therefore before '
    + "fireEvent('died') collects a single trigger");
  finishBattle(h);
});

test('R72: a column-scoped battle counter rides the collapse to the new index', () => {
  const { h, atk } = board(6404);
  const region = h.state.battle!.region;
  const e = new E(h.state);
  e.bumpBattleCounter(region, e.colCounterKey(1, 'connected'), 3);   // on the doomed column
  e.bumpBattleCounter(region, e.colCounterKey(2, 'connected'), 5);   // on the one that moves
  const deathsBefore = e.battleCounter(region, `allyDeaths:${ent(h, atk[1]!)!.controller}`);
  e.destroy(ent(h, atk[1]!)!, 'is deleted');
  e.settle();

  const q = h.q;
  assert.deepEqual(cols(h), [[atk[0]!], [atk[2]!]]);
  assert.equal(q.battleCounter(region, q.colCounterKey(1, 'connected')), 5,
    "the third column's ledger moved with it");
  assert.equal(q.battleCounter(region, q.colCounterKey(2, 'connected')), 0,
    'nothing is left behind at the old index');
  assert.equal(q.battleCounter(region, `allyDeaths:${ent(h, atk[0]!)!.controller}`),
    deathsBefore + 1, 'a counter that is not column-scoped is untouched by the re-key');
  finishBattle(h);
});

test('R72: a death trigger still receives the DEATH event, not the collapse announcement', () => {
  // Malicious Hardware: "whenever one of your units dies, each opponent
  // sacrifices a unit" — its `when` reads ev.data.seat, so it is exactly the
  // observer a mis-captured event would silence. The death that fires it is
  // also the death that collapses the line.
  const h = new Harness(6405);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a0 = spawn(h, A, 'The Foretold');
  const a1 = spawn(h, A, 'The Foretold');
  const mh = spawn(h, A, 'Malicious Hardware');       // rides in the third column
  const bystander = spawn(h, D, 'The Foretold');      // the forced sacrifice
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1], [mh]] });
  const evs = kill(h, a1);                            // in the attack window
  assert.deepEqual(cols(h), [[a0], [mh]], 'the column collapsed and the Hardware slid left');
  const collapse = evs.findIndex(ev => ev.type === 'info' && /formation closes up/.test(ev.msg));
  const a1Death = evs.findIndex(ev => ev.type === 'died' && ev.data?.['unit'] === a1);
  assert.ok(collapse > a1Death && collapse - a1Death <= 2,
    "the collapse rides a1's own death — otherwise this test cannot bite");
  pass(h); pass(h);                                   // the trigger resolves off the stack
  assert.ok(!ent(h, bystander),
    'the Hardware heard a1 die and forced the sacrifice — the trigger got the '
    + "death event, not the 'formation closes up' line that follows it");
  finishBattle(h);
});

test('R72: the collapse is deterministic — same script, same state, same log', () => {
  const run = (): Harness => {
    const { h, atk } = board(6406);
    kill(h, atk[1]!);
    assert.deepEqual(cols(h), [[atk[0]!], [atk[2]!]]);
    finishBattle(h);
    return h;
  };
  const a = run(), b = run();
  assert.deepEqual(a.state, b.state, 'identical final states');
  assert.deepEqual(a.log, b.log, 'identical logs');
});

/* ── horizontal gravity: AFTER blocks, the line is LOCKED ───────────────── */

test('R72 (Manual): after blocks are declared, an emptied column stays as a HOLE', () => {
  const { h, D, atk, blk } = board(6407, 1);
  stats(h, blk[0]!, 9, 9);                            // kills the middle attacker, survives
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blk[0]!] } });
  pass(h); pass(h);                                   // combat damage

  const b = h.state.battle!;
  assert.ok(!ent(h, atk[1]!), 'the middle attacker died');
  assert.equal(b.columns.length, 3, '"after blocks, columns will not move to fill gaps"');
  assert.deepEqual(cols(h), [[atk[0]!], [], [atk[2]!]], 'a hole in the attacking line');
  assert.deepEqual(Object.keys(b.blocks), ['1'], 'and every index is frozen');
  assert.deepEqual(b.blocks[1], [blk[0]!], 'the blocker is still attached to its own column');
  assert.equal(h.state.players[D]!.life, 24, 'the two survivors each connected for 3');
  finishBattle(h);
});

test('R72 (Manual): the hole is permanent — losing the blockers too does not close it', () => {
  // this is where the Manual and the earlier ⚠ part company. Under the ruling
  // "a column holding blockers is not empty" the column would collapse the
  // moment its blocker left; under the Manual nothing moves after blocks, full
  // stop, and the special case dissolves into the general rule.
  const { h, D, atk, blk } = board(6408, 1);
  stats(h, blk[0]!, 9, 9);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blk[0]!] } });
  pass(h); pass(h);
  assert.deepEqual(cols(h), [[atk[0]!], [], [atk[2]!]]);

  kill(h, blk[0]!);                                   // now the column holds nothing at all
  assert.deepEqual(cols(h), [[atk[0]!], [], [atk[2]!]], 'still three columns, still a hole');
  assert.deepEqual(h.state.battle!.blocks[1], [],
    'and the emptied block entry stays as the sticky "was blocked" flag (R13)');
  finishBattle(h);
});

test('R72 (Manual): a whole column trading itself out mid-combat leaves a hole, not a collapse', () => {
  const { h, D, atk, blk } = board(6409, 1);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blk[0]!] } });   // 3/3 vs 3/3: both die
  pass(h); pass(h);
  assert.ok(!ent(h, atk[1]!) && !ent(h, blk[0]!), 'the middle column traded itself out');
  assert.deepEqual(cols(h), [[atk[0]!], [], [atk[2]!]]);
  assert.ok(!h.log.some(l => /formation closes up/.test(l)), 'nothing closed up');
  finishBattle(h);
});

test('R72: no collapse between the Swift and normal sub-steps either', () => {
  // R3 says there is no priority window between sub-steps, which is exactly
  // where the first build ran the collapse. The Manual says the line is locked
  // from the moment blocks are declared, so the sub-step boundary is inside
  // the locked window, not outside it.
  const h = new Harness(6410);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a0 = spawn(h, A, 'The Foretold');
  const a1 = spawn(h, A, 'Dune Drifter');             // 2/1 {Swift}
  const a2 = spawn(h, A, 'The Foretold');
  const swift = spawn(h, D, 'Dune Drifter');          // 2/1 {Swift}
  const slow = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1], [a2]] });
  pass(h); pass(h);
  stats(h, a1, 5, 1);                                 // a Swift column on BOTH sides…
  stats(h, swift, 5, 1);                              // …so the whole exchange dies in Swift
  stats(h, slow, 0, 9);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [swift], 2: [slow] } });
  pass(h); pass(h);

  const b = h.state.battle!;
  assert.ok(!ent(h, a1) && !ent(h, swift), 'the Swift exchange wiped its own column');
  assert.deepEqual(cols(h), [[a0], [], [a2]], 'the hole opened between sub-steps and STAYED');
  assert.deepEqual(b.blocks[2], [slow], 'so column 2 is still column 2, and keeps its blocker');
  assert.equal(ent(h, slow)!.damage, 3, 'and the normal sub-step hit it, not the empty column');
  assert.equal(h.state.players[D]!.life, 27, 'only the unblocked column connected');
  finishBattle(h);
});

/* ── the surviving half of the 2026-08-21 ruling: a hole deals nothing ──── */

test('R72 (ruling): a hole deals and takes no damage — Piercing included', () => {
  // Bena, 2026-08-21: "It stays, but has nothing to deal damage to, so it
  // doesn't deal damage." Before R72 the engine pushed the blocker's FULL power
  // through to the attacking player: a Good Whale (7/5 {Piercing}) whose
  // attacker was killed in the block window used to deal 7 to the attacker's
  // face. Piercing is the EXCESS of an assignment (R7), and there is no
  // assignment to be the excess of.
  //
  // Note the deliberate asymmetry with R13, which is the Manual's own: "the
  // column is considered blocked even if the defending unit is removed during
  // combat", so a Piercing ATTACKER still gets through a dead block.
  const h = new Harness(6411);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a0 = spawn(h, A, 'The Foretold');
  const a1 = spawn(h, A, 'The Foretold');
  const pierce = spawn(h, D, 'Good Whale');           // 7/5 {Piercing}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [pierce] } });
  kill(h, a1);                                        // a spell in the block window

  assert.deepEqual(cols(h), [[a0], []], 'blocks are declared, so the gap stays open');
  assert.deepEqual(h.state.battle!.blocks[1], [pierce], 'and the blocker keeps its place');
  pass(h); pass(h);                                   // combat damage

  assert.equal(h.state.players[A]!.life, 30, 'the stranded Piercing blocker dealt nothing');
  assert.equal(ent(h, pierce)!.damage, 0, 'and took nothing');
  assert.equal(h.state.players[D]!.life, 27, 'the surviving attacker still connected');
  assert.ok(h.log.some(l => /has no attackers left/.test(l)), 'and the log says why');
  finishBattle(h);
});

test('R72 (ruling): a hole deals nothing in a LATER sub-step either', () => {
  const h = new Harness(6412);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a0 = spawn(h, A, 'The Foretold');
  const a1 = spawn(h, A, 'The Foretold');
  const slug = spawn(h, D, 'Rime Wraith');            // 2/1 {Swift} {Sluggish}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  pass(h); pass(h);
  stats(h, slug, 9, 9);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [slug] } });
  kill(h, a1);
  pass(h); pass(h);

  assert.deepEqual(cols(h), [[a0], []], 'the hole survived the whole damage pump');
  assert.equal(h.state.players[A]!.life, 30, 'no sub-step found anything for it to hit');
  assert.equal(ent(h, slug)!.damage, 0);
  finishBattle(h);
});

/* ── vertical gravity: untimed, unlike the horizontal half ──────────────── */

test('R72 (Manual): the back row promotes BEFORE blocks', () => {
  const h = new Harness(6413);
  toDeployment(h);
  const A = h.state.initiative;
  const front = spawn(h, A, 'The Foretold');
  const back = spawn(h, A, 'The Foretold');
  const solo = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back], [solo]] });
  pass(h); pass(h);
  kill(h, front);
  assert.deepEqual(cols(h), [[back], [solo]],
    'the back row came forward; the column is still a column and nothing shifted sideways');
  finishBattle(h);
});

test('R72 (Manual): the back row promotes AFTER blocks too — vertical gravity is untimed', () => {
  // the asymmetry is the whole finding: "any units behind it move to the front
  // row and take its place" carries no timing qualifier, while the column rule
  // explicitly does.
  const { h, A, D, atk, blk } = board(6414, 1);
  const back = new E(h.state).spawnUnit(A, 'The Foretold', h.state.battle!.region);
  h.state.battle!.columns[1]!.push(back.id);          // column 1 is [front, back]
  stats(h, blk[0]!, 3, 9);                            // exactly lethal to the front, no excess
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blk[0]!] } });
  pass(h); pass(h);                                   // the 9/9 kills the front unit

  assert.ok(!ent(h, atk[1]!), 'the front unit died mid-combat');
  assert.deepEqual(cols(h)[1], [back.id], 'the back row came forward, after blocks');
  assert.equal(h.state.battle!.columns.length, 3, 'and still no column moved sideways');
  finishBattle(h);
});

test('R72 (Manual): the front row always fills first, so [gap, back] is unreachable', () => {
  // "The front row of a column must be filled first before a unit can be
  // placed in a back row." Promotion + the dead-id splice + append-only
  // placement make that an invariant, not a check: every column is [], [front]
  // or [front, back].
  const { h, D, atk, blk } = board(6415, 1);
  stats(h, blk[0]!, 9, 9);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blk[0]!] } });
  pass(h); pass(h);
  for (const col of [...h.state.battle!.columns, ...Object.values(h.state.battle!.blocks)]) {
    assert.ok(col.length <= 2, 'at most two rows');
    assert.ok(col.every(id => ent(h, id)), 'and every occupied row holds a live unit');
  }
  assert.ok(atk.length === 3);
  finishBattle(h);
});
