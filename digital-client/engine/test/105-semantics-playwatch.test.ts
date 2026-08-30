/* CT-9 semantics: the play-watcher band ("when you play"-watchers,
 * counter-matters, damage-reflection). Every card in this band already has a
 * REAL behavior test (the census counts exact quoted-name occurrences, which
 * is why a card with a single spawn() call lands in the "named once" band even
 * when its printed promise is pinned). What was NOT pinned is the R37 line —
 * local errata, docs/digital-rules.md: applying a MOD (augment/graft/virus) is
 * NOT "playing a card", so "when you play a unit/spell" triggers must not fire
 * on mod application — plus a few printed clauses the existing tests skirt:
 * the nontoken gate against actual TOKEN SPELLS, [once] budgets not being
 * spent by non-firing events (R108/R113), Stalwart Sentinel's bin cases
 * (R96/R123 spell-from-bin counts, Rook's mod-from-bin does not), Pestilent
 * Mycelion's "one or more" batch reading, and Lithoghul's "that much" scaling.
 *
 * States are built explicitly; seeds are 10501-10599. Positive controls sit
 * inside the negative tests so a silently-dead watcher cannot fake a pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, resolveAfterCombat, spawn,
  toDeployment, toNextBattle, unitsOf, withE as whiteBox,
} from './util.ts';
import type { Seat } from '../src/types.ts';

// ── helpers (local ports of 43-dark-c's rig) ─────────────────────────────

/** pass priority until `seat` holds it */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}

// ── Ravenous Fireslinger ─────────────────────────────────────────────────

test('Ravenous Fireslinger: R37 — applying an augment is not playing a spell (no +1/-1); a real spell still is', () => {
  const h = new Harness(10501);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const slinger = spawn(h, p, 'Ravenous Fireslinger');     // 4/3
  const host = spawn(h, p, 'The Foretold');                // 3/3 vanilla host
  giveResources(h, p, 'earth', 2);                         // Reality Bender e/2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the mod really landed');
  assert.deepEqual(effStats(h, slinger), [4, 3],
    'R37: applying a mod is NOT playing a spell — no +1/-1');
  giveResources(h, p, 'water', 3);                         // Lonely Forager b/3 (spellUnit)
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.deepEqual(effStats(h, slinger), [5, 2],
    'the watcher was live all along — a real nontoken spell gives +1/-1');
});

// ── Stormsowing Nimbus ───────────────────────────────────────────────────

test('Stormsowing Nimbus: R37/nontoken — neither a mod application nor a token spell makes a 1/1; a real battle spell does', () => {
  const h = new Harness(10502);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                   // 7/5 — survives the pokes below
  spawn(h, D, 'Stormsowing Nimbus');                       // defender: home = battle region
  const host = spawn(h, D, 'The Foretold');
  giveResources(h, D, 'earth', 2);                         // Reality Bender e/2
  giveResources(h, D, 'fire', 3);                          // Twin Flame rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const made = () => unitsOf(h, D).filter(u => u.card === 'Unit Token' && u.token);
  // 1. a virus augment applied during battle is a MOD, not a play (R37)
  passTo(h, D);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Reality Bender'), hostId: host });
  pass(h); pass(h);                                        // the virus-shaped item resolves
  assert.equal(made().length, 0, 'R37: a mod application makes no 1/1');
  // 2. a TOKEN spell is filtered by "nontoken"
  const region = h.state.battle!.region;
  const poison = new E(h.state).createSpellToken(D, 'Poison', 1, region);
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: poison.id });
  pick(h, { unit: atk });
  pass(h); pass(h);                                        // Poison resolves
  assert.equal(made().length, 0, 'a token spell does not count as "nontoken"');
  // 3. positive control: a real nontoken battle spell makes exactly one 1/1
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Twin Flame') });
  pick(h, { unit: atk });                                  // first target at cast
  pick(h, { doneTargets: true });                          // "up to two" — stop at one
  pass(h); pass(h);                                        // the Nimbus trigger resolves
  assert.equal(made().length, 1, 'the real spell made exactly one 1/1');
  assert.deepEqual(effStats(h, made()[0]!.id), [1, 1]);
  pass(h); pass(h);                                        // Twin Flame resolves
  finishBattle(h);
});

// ── Aethercap Siphoner ───────────────────────────────────────────────────

test('Aethercap Siphoner: R37 — a mod application offers no counter move; a real nontoken spell does', () => {
  const h = new Harness(10503);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const siph = spawn(h, p, 'Aethercap Siphoner');          // spawns with three -1/-1
  assert.equal(ent(h, siph)!.counters, -3);
  const host = spawn(h, p, 'The Foretold');                // 3/3 — survives a moved -1/-1
  const decision = () => h.state.decision;                 // unnarrowed read
  giveResources(h, p, 'earth', 2);
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: host });
  assert.ok(!decision(), 'R37: no "move a counter" menu for a mod application');
  assert.equal(ent(h, siph)!.counters, -3, 'nothing moved');
  giveResources(h, p, 'water', 3);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.equal(decision()?.kind, 'targets', 'the real spell asks');
  pick(h, { unit: host });
  assert.equal(ent(h, siph)!.counters, -2, 'one -1/-1 moved off the Siphoner');
  assert.equal(ent(h, host)!.counters, -1, '…onto the chosen unit');
});

// ── Channeled Amalgam ────────────────────────────────────────────────────

test('Channeled Amalgam: a token spell neither feeds it nor spends the [once] — the next real spell still lands X', () => {
  const h = new Harness(10504);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                   // 7/5 target dummy
  const amalgam = spawn(h, D, 'Channeled Amalgam');        // 1/1
  giveResources(h, D, 'fire', 3);                          // Twin Flame rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  const poison = new E(h.state).createSpellToken(D, 'Poison', 1, region);
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: poison.id });
  pick(h, { unit: atk });
  pass(h); pass(h);                                        // Poison resolves
  assert.equal(ent(h, amalgam)!.counters, 0, 'a token spell feeds nothing');
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Twin Flame') });
  pick(h, { unit: atk });
  pick(h, { doneTargets: true });
  pass(h); pass(h);                                        // the Amalgam trigger resolves
  assert.equal(ent(h, amalgam)!.counters, 3,
    'X = the real spell\'s cost (3) — the token spell had NOT spent the [once] (R108/R113)');
  assert.deepEqual(effStats(h, amalgam), [4, 4]);
  pass(h); pass(h);                                        // Twin Flame resolves
  finishBattle(h);
});

// ── Arcane Concentrator ──────────────────────────────────────────────────

test('Arcane Concentrator: R37 — a mod application makes no X/X and leaves the [once] unspent', () => {
  const h = new Harness(10505);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Arcane Concentrator');                      // 3/2
  const host = spawn(h, p, 'The Foretold');
  const made = () => unitsOf(h, p).filter(u => u.card === 'Unit Token' && u.token);
  giveResources(h, p, 'earth', 2);
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: host });
  assert.equal(made().length, 0, 'R37: applying a mod ([2]) is not playing a spell — no X/X');
  giveResources(h, p, 'water', 3);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.equal(made().length, 1, 'the [once] was still unspent — the real spell fired it');
  assert.deepEqual(effStats(h, made()[0]!.id), [3, 3], 'X = the spell\'s cost (3)');
});

// ── Stalwart Sentinel ────────────────────────────────────────────────────

test('Stalwart Sentinel: R96/R123 — a spell played from the BIN counts (+2), a mod applied from the BIN does not (R37, Rook)', () => {
  const h = new Harness(10506);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                   // 7/5 — the bin spell's target
  const sent = spawn(h, D, 'Stalwart Sentinel');           // 1/1, home = battle region
  const host = spawn(h, D, 'The Foretold');                // host for the bin mod
  giveResources(h, D, 'fire', 7);                          // Abyssal Evocation rr/4 + Twin Flame rr/3
  giveResources(h, D, 'metal', 2);                         // A Pile of Rubbish m/2 (the bin mod)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[D]!.bin = ['Twin Flame', 'A Pile of Rubbish'];
  // playing the granting spell from HAND is the ordinary place — no counters
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Abyssal Evocation') });
  pass(h); pass(h);                                        // grant resolves
  assert.equal(ent(h, sent)!.counters, 0, 'a hand play never counts');
  // R96: the bin spell is offered and played — spellPlayed carries from:"bin"
  passTo(h, D);
  assert.ok(h.legal(D).some(a => a.type === 'playFromBin' && a.binIndex === 0),
    'the Twin Flame in the bin is offered under the grant');
  h.do({ type: 'playFromBin', seat: D, binIndex: 0 });
  pick(h, { unit: atk });
  pick(h, { doneTargets: true });
  pass(h); pass(h);                                        // the Sentinel trigger resolves
  assert.equal(ent(h, sent)!.counters, 2,
    'played from anywhere other than your hand → two +1/+1 counters');
  assert.deepEqual(effStats(h, sent), [3, 3]);
  pass(h); pass(h);                                        // Twin Flame resolves
  // R37: Rook opens the bin as a MOD zone — and a mod from the bin is NOT a play
  whiteBox(h, e => { e.spawnUnit(D, 'Rook', h.state.battle!.region); });
  passTo(h, D);
  const rubbishIdx = h.state.players[D]!.bin.indexOf('A Pile of Rubbish');
  assert.ok(rubbishIdx >= 0, 'the augment is still in the bin');
  h.do({ type: 'augment', seat: D, from: 'bin', index: rubbishIdx, hostId: host });
  pass(h); pass(h);                                        // the virus-shaped item resolves
  assert.ok(ent(h, host)!.mods.length === 1, 'the bin mod really attached');
  assert.equal(ent(h, sent)!.counters, 2,
    'R37: a mod applied FROM THE BIN is still not "playing a card" — no third counter');
  finishBattle(h);
});

// ── Pestilent Mycelion ───────────────────────────────────────────────────

test('Pestilent Mycelion: a batch of -1/-1 counters is ONE life loss, and +1/+1 counters are silent', () => {
  const h = new Harness(10507);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Pestilent Mycelion');                       // 1/3, own [Augment] text live
  const whale = spawn(h, D, 'Good Whale');                 // 7/5 — the counter carrier
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const lifeA = h.state.players[A]!.life;
  const lifeD = h.state.players[D]!.life;
  whiteBox(h, e => { e.addCounters(e.entity(whale)!, -3); });   // one batch of three
  pass(h); pass(h);                                        // the trigger resolves
  assert.equal(h.state.players[A]!.life, lifeA - 1,
    '"one or more" — a batch of three -1/-1 counters is ONE firing, 1 life');
  assert.equal(h.state.players[D]!.life, lifeD, 'its own controller loses nothing');
  whiteBox(h, e => { e.addCounters(e.entity(whale)!, 2); });    // +1/+1 counters
  assert.equal(h.state.stack.length, 0, '+1/+1 counters stack no trigger at all');
  assert.equal(h.state.players[A]!.life, lifeA - 1, 'and cost no life');
  finishBattle(h);
});

// ── Morphic Mentor ───────────────────────────────────────────────────────

test('Morphic Mentor: an augment applied during DEPLOYMENT does not buff — the printed trigger is battle-only', () => {
  const h = new Harness(10508);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mentor = spawn(h, p, 'Morphic Mentor');            // 2/3
  const host = spawn(h, p, 'The Foretold');
  giveResources(h, p, 'earth', 2);
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the augment really applied');
  assert.deepEqual(effStats(h, mentor), [2, 3],
    '"during battle" — a deployment augment gives no +2/+2 (17-earth-b pins the battle positive)');
});

// ── Origon ───────────────────────────────────────────────────────────────

test('Origon: a virus applied during battle is not a spell — not negated, and the first-spell countdown is untouched', () => {
  const h = new Harness(10509);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const orig = spawn(h, D, 'Origon');                      // 6/7, own [Augment] text live
  giveResources(h, A, 'earth', 2);                         // Reality Bender e/2
  giveResources(h, A, 'fire', 3);                          // Twin Flame rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // R37: a virus augment during battle rides the stack, but it is a MOD
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: atk });
  pass(h); pass(h);                                        // the virus resolves
  assert.ok(ent(h, atk)!.mods.length === 1, 'the mod landed');
  assert.ok(!h.log.some(m => m.includes('is negated')), 'nothing was negated — a mod is not a spell');
  // the countdown is intact: A's FIRST actual spell is still the one negated
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: orig });
  pick(h, { doneTargets: true });
  pass(h); pass(h);                                        // Origon's trigger resolves
  assert.ok(h.log.some(m => m.includes('Twin Flame is negated')),
    'the first SPELL this battle was negated — the mod never consumed the countdown');
  assert.ok(h.state.players[A]!.bin.includes('Twin Flame'), 'negated → bin');
  assert.equal(ent(h, orig)!.damage, 0, 'and it never dealt its damage');
  assert.equal(h.state.stack.length, 0, 'R68: the negated spell left the stack');
  finishBattle(h);
});

// ── Lithoghul ────────────────────────────────────────────────────────────

test('Lithoghul: the reflection is "that much" — a 3-power hit costs its controller 3', () => {
  const h = new Harness(10510);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');                 // 3/3
  const lith = spawn(h, D, 'Lithoghul');                   // 4/4
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [lith] } });
  pass(h); pass(h);                                        // combat damage
  resolveAfterCombat(h);   // R261: the reflection is stacked after combat, not drained in the sub-step
  assert.ok(!ent(h, atk), 'the 3/3 died to the 4-power block');
  assert.equal(ent(h, lith)!.damage, 3, 'Lithoghul took 3');
  assert.equal(h.state.players[D]!.life, lifeD - 3,
    '"that much" — the mirrored damage scales with the hit (16-earth-a pins the 1-damage case)');
  assert.equal(h.state.players[A]!.life, lifeA, 'the attacker took nothing');
  finishBattle(h);
});
