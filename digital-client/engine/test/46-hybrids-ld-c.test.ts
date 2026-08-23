/* Per-card tests for the Light & Dark hybrid batch C (batch-hybrids-ld-c):
 * bin-prophesying (Angel of Anguish, R42), life-paid recall and glimpse
 * (Aurozoa, Visionary Construct, R45), the combat-damage-as-rot replacement
 * (Blightsea Polyp, R38), counter/rot/debt doubling (Buffer Overflow),
 * stealing a unit into your hand plus a discard (Capture, R40), life-change
 * pumps and their [Switch1] budget (Deathcoil Construct, R9), a paid
 * spell-played drain (Dragnol), empty-hand bin plays (Gridxlan), a life total
 * rewritten from the bins (Haunting Memories), spawn lifegain (Iyngstra),
 * cost-funded glimpses (Lilbot), a variable discard CAST COST (No Hand Killer,
 * R64 — the discards used to happen at resolution),
 * a granted prophecy computed from a cost (Prophecy Bug, R43), damage-driven
 * rot (Rotwall), and the two shapes of a discard trigger (Swarmling, R40).
 * The PARKED Counter Theif (counter-placement replacement) and Trench Stalker
 * (discard cast cost / play into formation / play from bin) have registration
 * tests + todos.
 *
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration can't shift assertions. Seeds: 4600-4699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { legalActions, IllegalAction } from '../src/apply.ts';
import {
  effStats, ent, give, giveResources, pass, pick, skipHasteStep,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { CachedCard, EntityId, Seat } from '../src/types.ts';

// ── synthetic support cards (never in DECK_LIST: it is frozen at import) ──

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'LDC Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

registerSynthetic(unit('LDC Grunt', 1, 1), {});
registerSynthetic(unit('LDC Wall', 0, 5), {});
registerSynthetic(unit('LDC Brute', 3, 3), {});
/** a [5] unit: Prophecy Bug's X = ceil(5/2) = 3 */
registerSynthetic(unit('LDC Five', 2, 2, { mana: 5 }), {});
/** a free {Battle} spell — something for Dragnol's "whenever you play a spell" */
registerSynthetic(unit('LDC Battle Spell', 0, 0, {
  kind: 'spell', timing: 'battle', type: '{Battle} LDC Test Spell',
}), {
  spellEffect: { run: (g, ctx) => { g.ev('info', `${ctx.sourceName} resolves.`); } },
});

// ── helpers ───────────────────────────────────────────────────────────

/** run engine mutations white-box, keeping the harness log honest; a
 * mid-resolution choose suspends, which is answered afterwards with 'decide' */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];
const rotOf = (h: Harness, seat: Seat): number => h.q.rot(seat);
const lifeOf = (h: Harness, seat: Seat): number => h.state.players[seat]!.life;

/** pass priority until the stack drains (two passes resolve each item) */
function drainStack(h: Harness): void {
  let guard = 40;
  while (h.state.stack.length && h.state.phase === 'battle' && !h.state.decision && guard-- > 0) pass(h);
}

/** deployment → next turn's battle, attack with `columns`, stop in the
 * attack window with the triggers drained */
function attackWith(h: Harness, attacker: Seat, columns: EntityId[][]): void {
  toNextBattle(h, attacker);
  h.do({ type: 'declareAttack', seat: attacker, columns });
  drainStack(h);
}

/** from the attack window: the given blocks, then combat damage */
function throughCombat(h: Harness, defender: Seat, blocks: Record<number, EntityId[]> = {}): void {
  pass(h); pass(h);                                        // → block step
  h.do({ type: 'declareBlocks', seat: defender, blocks });
  pass(h); pass(h);                                        // → combat damage
}

/** finish planning into the battle phase without any deployment in between */
function intoBattle(h: Harness): void {
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
}

/** one whole turn of deployment, so "N Turns Pass" ticks */
function nextTurnsDeployment(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.phase === 'deploy' && h.state.deployDone && !h.state.deployDone[seat]) {
      h.do({ type: 'doneDeploying', seat });
    }
  }
  intoBattle(h);
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
}

// ── Angel of Anguish ─────────────────────────────────────────────────────

test('Angel of Anguish: can be prophesied FROM THE BIN, then released free two turns later (R42/R43)', () => {
  const h = new Harness(4600);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('LDC Grunt', 'Angel of Anguish');
  giveResources(h, P, 'fire', 2);                          // the banner is [1], no pips

  // only the card that SAYS SO is offered from the bin
  const fromBin = h.legal(P).filter(a => a.type === 'prophesy' && a.from === 'bin')
    .map(a => (a as { index: number }).index);
  assert.deepEqual(fromBin, [1], 'the bin-prophesy flag is what makes it legal');

  h.do({ type: 'prophesy', seat: P, from: 'bin', index: 1 });
  assert.deepEqual(h.state.players[P]!.bin, ['LDC Grunt'], 'it left the bin');
  const cc = cacheOf(h, P)[0]!;
  assert.equal(cc.card, 'Angel of Anguish');
  assert.equal(cc.prophecy!.norm, '2 turns pass', 'the printed banner condition');
  assert.equal(h.q.openMana(P), 1, 'the [1] banner was paid');

  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), null, 'one turn is not two (R43)');
  nextTurnsDeployment(h);
  assert.equal(h.q.cachePermission(P, 0), 'prophecy');
  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), mana, 'released for FREE, ignoring the ld affinity');
  const angel = unitsOf(h, P).find(u => u.card === 'Angel of Anguish');
  assert.ok(angel, 'the 5/5 is in play');
  assert.deepEqual(effStats(h, angel.id), [5, 5]);
});

// ── Aurozoa ──────────────────────────────────────────────────────────────

test('Aurozoa: "[Augment] Pay 1 life: Recall me" — on itself and donated to a host', () => {
  const h = new Harness(4601);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const own = spawn(h, P, 'Aurozoa');
  const life = lifeOf(h, P);
  h.do({ type: 'activateAbility', seat: P, entityId: own, abilityIndex: 0, via: 'augment' });
  assert.equal(lifeOf(h, P), life - 1, '1 life paid at resolution');
  assert.ok(!ent(h, own), 'Aurozoa left play');
  assert.ok(h.state.players[P]!.hand.includes('Aurozoa'), 'recalled to hand');

  // donated: "me" anchors on the HOST, so the host is what gets recalled
  const host = spawn(h, P, 'LDC Grunt');
  giveResources(h, P, 'light', 1);
  giveResources(h, P, 'water', 2);                         // lb / 3
  h.do({
    type: 'augment', seat: P, from: 'hand',
    index: h.state.players[P]!.hand.indexOf('Aurozoa'), hostId: host,
  });
  const mod = ent(h, host)!.mods[0]!;
  const life2 = lifeOf(h, P);
  h.do({ type: 'activateAbility', seat: P, entityId: host, abilityIndex: 0, via: { mod } });
  assert.equal(lifeOf(h, P), life2 - 1);
  assert.ok(!ent(h, host), 'the HOST was recalled');
  assert.ok(h.state.players[P]!.hand.includes('LDC Grunt'));
  assert.ok(h.state.players[P]!.bin.includes('Aurozoa'), 'the mod stayed behind → bin (R40)');
});

test('Aurozoa: R49 — at 1 life the cost is unpayable and the activation is ILLEGAL', () => {
  const h = new Harness(4602);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const own = spawn(h, P, 'Aurozoa');
  h.state.players[P]!.life = 1;
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: own, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/);
  assert.equal(lifeOf(h, P), 1, 'nothing paid');
  assert.ok(ent(h, own), 'and nothing recalled');
  assert.equal(h.state.phase, 'deploy', 'the game is very much not over');
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === own),
    'not offered either');
});

// ── Blightsea Polyp ──────────────────────────────────────────────────────

test('Blightsea Polyp: a column\'s combat damage to a player becomes 1 rot, per column (R38)', () => {
  const h = new Harness(4603);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const big = spawn(h, A, 'Trench Stalker');               // 6/2
  const small = spawn(h, A, 'LDC Brute');                  // 3/3
  spawn(h, D, 'Blightsea Polyp');                          // the defender's, in the battle region
  const lifeD = lifeOf(h, D);
  attackWith(h, A, [[big], [small]]);                      // TWO columns, 9 power total
  throughCombat(h, D);
  assert.equal(lifeOf(h, D), lifeD, 'the life total does not change at all');
  assert.equal(rotOf(h, D), 2, 'one rot per COLUMN, whatever its power');
  assert.equal(h.events.filter(ev => ev.type === 'lifeLost' && ev.data?.['why'] === 'combat').length, 0,
    'no combat life loss happened');
});

test('Blightsea Polyp: is an augment even though its text is a replacement hook', () => {
  const h = new Harness(4604);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'LDC Grunt');
  giveResources(h, P, 'water', 1);
  giveResources(h, P, 'dark', 1);                          // bd / 2
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Blightsea Polyp'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'accepted as an augment (augmentable)');
});

// ── Buffer Overflow ──────────────────────────────────────────────────────

test('Buffer Overflow: doubles counters on units and the rot/debt on players', () => {
  const h = new Harness(4605);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const plus = spawn(h, D, 'LDC Brute');
  const minus = spawn(h, D, 'LDC Wall');
  whiteBox(h, e => { e.addCounters(e.entity(plus)!, 2); e.addCounters(e.entity(minus)!, -1); });
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, D, 'metal', 2);
  giveResources(h, D, 'dark', 2);                          // md / 4
  attackWith(h, A, [[atk]]);
  // set the player counters AFTER the resource step, which would auto-pay debt
  h.state.players[D]!.rot = 1;
  h.state.players[D]!.debt = 3;
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Buffer Overflow') });
  pass(h); pass(h);                                        // resolve
  assert.equal(ent(h, plus)!.counters, 4, '+2 doubled to +4');
  assert.equal(ent(h, minus)!.counters, -2, 'the NET is what doubles (-1 → -2)');
  assert.equal(rotOf(h, D), 2, 'rot doubled');
  assert.equal(h.q.debt(D), 6, 'debt doubled');
  assert.equal(rotOf(h, A), 0, 'the other player had none, so nothing to double');
});

// ── Capture ──────────────────────────────────────────────────────────────

test('Capture: puts target unit into YOUR hand (a steal), then you discard a card', () => {
  const h = new Harness(4606);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Brute');                    // A's unit — Capture steals it
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'dark', 2);                          // bd / 4
  attackWith(h, A, [[atk]]);
  h.state.players[D]!.hand.length = 0;
  give(h, D, 'Capture');
  give(h, D, 'LDC Grunt');                                 // the card D will discard
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: 0 });
  pick(h, { unit: atk });
  pass(h); pass(h);                                        // resolve
  assert.ok(h.state.decision, 'the discard is a mid-resolution choice');
  pick(h, 0);                                              // discard LDC Grunt, keep the loot
  assert.ok(!ent(h, atk), 'the unit left play');
  assert.deepEqual(h.state.players[D]!.hand, ['LDC Brute'],
    "it went to the CASTER's hand, not its owner's");
  assert.ok(h.state.players[D]!.bin.includes('LDC Grunt'), 'and a card was discarded');
  assert.ok(h.events.some(ev => ev.type === 'trashed' && ev.data?.['card'] === 'LDC Grunt'),
    'discarding trashes it (R40)');
  assert.ok(!h.state.players[A]!.hand.includes('LDC Brute'), 'the owner never got it back');
});

// ── Counter Theif ────────────────────────────────────────────────────────

test('Counter Theif: counters placed on any unit during battle land on it instead', () => {
  // R104, the REDIRECT family: the number is untouched and the RECIPIENT
  // changes, so this is a first-claimant-consumes hook and not a summed
  // AmountMod. The counters land on exactly one unit either way.
  const h = new Harness(4620);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ct = spawn(h, P, 'Counter Theif');
  const other = spawn(h, P, 'LDC Grunt');
  toNextBattle(h, P);
  whiteBox(h, e => e.addCounters(e.entity(other)!, 2));
  assert.equal(ent(h, other)!.counters, 0, 'the printed recipient got none');
  assert.equal(ent(h, ct)!.counters, 2, '"those counters are placed on me instead"');
});

test('Counter Theif: outside battle the counters land where they were put', () => {
  // "during battle" is a printed restriction and it is real. The engine's own
  // battle state answers it, which costs a query rather than a listener.
  const h = new Harness(4621);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ct = spawn(h, P, 'Counter Theif');
  const other = spawn(h, P, 'LDC Grunt');
  whiteBox(h, e => e.addCounters(e.entity(other)!, 2));
  assert.equal(ent(h, other)!.counters, 2, 'deployment is not battle');
  assert.equal(ent(h, ct)!.counters, 0);
});

test('Counter Theif: two thieves do not ping-pong, and the theft never reaches the stack', () => {
  // The redirect really re-enters — putting the counters on the thief IS a
  // counter placement — so two thieves would bounce one placement between them
  // forever without a latch. The latch lives in the engine
  // (`E.inReplaceCounters`, in E.inCostMods' shape) and not as a module-level
  // `let` in a card file, which is the correction playtest report #60 asked
  // for. Lowest entity id claims, exactly as replaceRotDamage resolves ties.
  const h = new Harness(4622);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const first = spawn(h, P, 'Counter Theif');
  const second = spawn(h, P, 'Counter Theif');
  const other = spawn(h, P, 'LDC Grunt');
  toNextBattle(h, P);
  const before = h.events.length;
  whiteBox(h, e => e.addCounters(e.entity(other)!, 3));
  assert.equal(ent(h, first)!.counters, 3, 'the lower id claims them');
  assert.equal(ent(h, second)!.counters, 0, 'and the other gets nothing — a redirect, not a copy');
  const after = h.events.slice(before);
  assert.equal(after.filter(ev => ev.type === 'countersChanged').length, 1,
    'ONE countersChanged for one placement');
  assert.equal(after.filter(ev => ev.type === 'triggered' || ev.type === 'stackPushed').length, 0,
    'nothing was queued and nothing was pushed — there is no stack item to negate');
});

test('Counter Theif: plays as a 0/5 and augments (donating nothing yet)', () => {
  const h = new Harness(4607);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ct = spawn(h, P, 'Counter Theif');
  assert.deepEqual(effStats(h, ct), [0, 5], 'vanilla 0/5 in play');
  const host = spawn(h, P, 'LDC Grunt');
  giveResources(h, P, 'metal', 2);
  giveResources(h, P, 'dark', 2);                          // md / 4
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Counter Theif'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
  whiteBox(h, e => e.addCounters(e.entity(host)!, 2));
  assert.equal(ent(h, host)!.counters, 2,
    'outside battle nothing is stolen — and "me" is the HOST when the text is donated, '
    + 'so even in battle the host would keep its own counters');
});

// ── Deathcoil Construct ──────────────────────────────────────────────────

test('Deathcoil Construct: gaining OR losing life pumps all your units — once per turn (R9)', () => {
  const h = new Harness(4608);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const dc = spawn(h, P, 'Deathcoil Construct');
  const ally = spawn(h, P, 'LDC Grunt');
  const enemy = spawn(h, O, 'LDC Grunt');
  whiteBox(h, e => e.gainLife(P, 1, 'test'));
  assert.equal(ent(h, dc)!.counters, 1, 'the Construct pumps itself too');
  assert.equal(ent(h, ally)!.counters, 1);
  assert.equal(ent(h, enemy)!.counters, 0, "not the opponent's units");
  // [Switch1]: bounded per card, per turn
  whiteBox(h, e => e.loseLife(P, 1, 'test'));
  assert.equal(ent(h, dc)!.counters, 1, 'no second pump this turn');
  // an OPPONENT's life change is not "you gain or lose life"
  whiteBox(h, e => e.gainLife(O, 1, 'test'));
  assert.equal(ent(h, dc)!.counters, 1);
});

test('Deathcoil Construct: the [Switch1] budget resets next turn, and losing life fires it too', () => {
  const h = new Harness(4609);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const dc = spawn(h, P, 'Deathcoil Construct');
  whiteBox(h, e => e.gainLife(P, 1, 'test'));
  assert.equal(ent(h, dc)!.counters, 1);
  nextTurnsDeployment(h);
  whiteBox(h, e => e.loseLife(P, 2, 'test'));
  assert.equal(ent(h, dc)!.counters, 2, 'a fresh turn, a fresh [Switch1]');
});

// ── Dragnol ──────────────────────────────────────────────────────────────

// Dragnol sits with the DEFENDER, whose home region IS the battle region —
// R12: an [Augment] trigger only hears events in its own region.
test('Dragnol: a spell you play in battle lets you pay [2] to drain 2 and gain 2', () => {
  const h = new Harness(4610);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  spawn(h, D, 'Dragnol');
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, D, 'fire', 2);
  attackWith(h, A, [[atk]]);
  const lifeA = lifeOf(h, A), lifeD = lifeOf(h, D);
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'LDC Battle Spell') });
  pass(h); pass(h);                                        // resolve the Dragnol trigger
  assert.ok(h.state.decision, 'the [2] is a pay-or-decline');
  pick(h, true);
  assert.equal(lifeOf(h, D), lifeD + 2, 'you gain 2');
  assert.equal(lifeOf(h, A), lifeA - 2, 'each opponent loses 2');
  assert.equal(h.q.openMana(D), 0, 'the [2] was paid');
  drainStack(h);
});

test('Dragnol: declining pays nothing, and an OPPONENT\'s spell never offers', () => {
  const h = new Harness(4611);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  spawn(h, D, 'Dragnol');
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, D, 'fire', 2);
  giveResources(h, A, 'fire', 2);
  attackWith(h, A, [[atk]]);
  const lifeA = lifeOf(h, A), lifeD = lifeOf(h, D);
  // A's spell: "whenever YOU play a spell" — not this one
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'LDC Battle Spell') });
  assert.equal(h.state.stack.length, 1, 'only the spell — no Dragnol trigger on top of it');
  pass(h); pass(h);
  assert.equal(h.state.decision, null);
  // D's own spell does offer, and declining costs nothing
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'LDC Battle Spell') });
  pass(h); pass(h);
  assert.ok(h.state.decision, 'now it offers');
  pick(h, false);
  assert.equal(lifeOf(h, A), lifeA);
  assert.equal(lifeOf(h, D), lifeD);
  assert.equal(h.q.openMana(D), 2, 'nothing paid');
  drainStack(h);
});

// ── Gridxlan ─────────────────────────────────────────────────────────────

test('Gridxlan: with an EMPTY hand, play a unit out of your bin during deployment', () => {
  const h = new Harness(4612);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grid = spawn(h, P, 'Gridxlan');
  h.state.players[P]!.hand.length = 0;
  h.state.players[P]!.bin.push('LDC Five', 'LDC Grunt');   // [5] is unaffordable below
  giveResources(h, P, 'earth', 2);                         // 2 open mana
  h.do({ type: 'activateAbility', seat: P, entityId: grid, abilityIndex: 0, via: 'augment' });
  const dec = h.state.decision!;
  assert.deepEqual(dec.options.map(o => o.label), ['LDC Grunt', 'Decline'],
    'only affordable UNIT cards are offered');
  pick(h, 1);                                              // bin index 1 = LDC Grunt
  assert.ok(unitsOf(h, P).some(u => u.card === 'LDC Grunt'), 'it is in play');
  assert.deepEqual(h.state.players[P]!.bin, ['LDC Five'], 'and it left the bin');
  assert.equal(h.q.openMana(P), 2, 'LDC Grunt is a [0] — its own cost is what is paid');
});

test('R77: Gridxlan with a non-empty hand is not offered, and does not burn its [once]', () => {
  // this used to activate, print "your hand is not empty", do nothing, and
  // SPEND the once-per-turn budget — so emptying your hand afterwards was too
  // late. "If your hand is empty" is an activation condition (R77).
  const h = new Harness(4613);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grid = spawn(h, P, 'Gridxlan');
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'LDC Grunt');                                 // hand is NOT empty
  h.state.players[P]!.bin.push('LDC Grunt');
  const offered = (): boolean => legalActions(h.state, P).some(a =>
    a.type === 'activateAbility' && a.entityId === grid);
  assert.ok(!offered(), 'not offered while the hand has a card in it');
  assert.throws(() => h.do({ type: 'activateAbility', seat: P, entityId: grid, abilityIndex: 0, via: 'augment' }),
    (err: unknown) => err instanceof IllegalAction);
  assert.deepEqual(h.state.players[P]!.bin, ['LDC Grunt'], 'nothing left the bin');
  // and because nothing was activated, the [once] is intact: emptying the hand
  // now makes it usable
  h.state.players[P]!.hand.length = 0;
  assert.ok(offered(), 'the budget was never spent');
  h.do({ type: 'activateAbility', seat: P, entityId: grid, abilityIndex: 0, via: 'augment' });
  pick(h, 0);
  assert.ok(unitsOf(h, P).some(u => u.card === 'LDC Grunt'), 'it plays from the bin');
});

test('R77: Gridxlan with an empty hand but nothing playable in the bin is not offered', () => {
  const h = new Harness(4616);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grid = spawn(h, P, 'Gridxlan');
  h.state.players[P]!.hand.length = 0;
  h.state.players[P]!.bin.length = 0;                      // empty hand, empty bin
  assert.ok(!legalActions(h.state, P).some(a =>
    a.type === 'activateAbility' && a.entityId === grid),
    'an ability with nothing to do is not offered (R64)');
});

// ── Haunting Memories ────────────────────────────────────────────────────

test('Haunting Memories: a life total becomes twice the cards in ALL bins (up or down)', () => {
  const h = new Harness(4614);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Grunt');
  h.state.players[A]!.bin.push('LDC Grunt', 'LDC Grunt', 'LDC Grunt');
  h.state.players[D]!.bin.push('LDC Grunt', 'LDC Grunt');  // 5 cards in all bins → 10
  giveResources(h, D, 'light', 4);
  giveResources(h, D, 'dark', 4);                          // ld / 8
  attackWith(h, A, [[atk]]);
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haunting Memories') });
  pick(h, { player: A });
  pass(h); pass(h);                                        // resolve
  assert.equal(lifeOf(h, A), 10, 'set downwards from 30 to 2 × 5');
  assert.equal(lifeOf(h, D), 30, 'the untargeted player is untouched');
});

test('Haunting Memories: empty bins set the target to 0 — which kills them', () => {
  const h = new Harness(4615);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, D, 'light', 4);
  giveResources(h, D, 'dark', 4);
  attackWith(h, A, [[atk]]);
  pass(h);
  h.state.players[A]!.bin.length = 0;
  h.state.players[D]!.bin.length = 0;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haunting Memories') });
  pick(h, { player: A });
  pass(h); pass(h);
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, D, 'a life total of 0 is a dead player');
});

// ── Iyngstra ─────────────────────────────────────────────────────────────

test('Iyngstra: gain life equal to the defense of each OTHER ally that spawns', () => {
  const h = new Harness(4616);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const life0 = lifeOf(h, P);
  spawn(h, P, 'Iyngstra');
  assert.equal(lifeOf(h, P), life0, '"another" — it does not gain for itself');
  spawn(h, P, 'LDC Wall');                                 // 0/5
  assert.equal(lifeOf(h, P), life0 + 5, 'defense 5, five life');
  spawn(h, O, 'LDC Wall');
  assert.equal(lifeOf(h, P), life0 + 5, "not for an opponent's spawn");
  // live defense at resolution (R1): counters count
  whiteBox(h, e => {
    const u = e.spawnUnit(P, 'LDC Grunt', e.homeRegion(P), { counters: 3 });
    assert.ok(u);
  });
  assert.equal(lifeOf(h, P), life0 + 5 + 4, 'a 1/1 spawned with three +1/+1 counters is a 4/4');
});

// ── Lilbot ───────────────────────────────────────────────────────────────

test('Lilbot: [once] discard a card OR sacrifice another nontoken unit → Glimpse 2 (R45)', () => {
  const h = new Harness(4617);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const lil = spawn(h, P, 'Lilbot');
  const fodder = spawn(h, P, 'LDC Grunt');
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'LDC Five');
  h.q.deckOf(P).unshift('LDC Brute', 'LDC Wall');
  h.do({ type: 'activateAbility', seat: P, entityId: lil, abilityIndex: 0, via: 'augment' });
  const dec = h.state.decision!;
  assert.deepEqual(dec.options.map(o => o.label), ['Discard LDC Five', 'Sacrifice LDC Grunt'],
    'both halves of the either-or are offered; "another" excludes Lilbot itself');
  pick(h, { discard: 0 });                                 // R49: paid at activation
  assert.deepEqual(h.state.players[P]!.hand, [], 'the card was discarded');
  assert.ok(ent(h, fodder), 'and the unit survived');
  // R45: Glimpse 2 reveals two and caches ONE of the glimpser's choice
  const glimpseDec = h.state.decision!;
  assert.deepEqual(glimpseDec.options.map(o => o.card), ['LDC Brute', 'LDC Wall'],
    'both revealed cards are offered');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['LDC Brute'], 'exactly ONE is cached');
  assert.deepEqual(h.q.deckOf(P).slice(-1), ['LDC Wall'], 'the other is recycled to the bottom');
  assert.equal(h.q.cachePermission(P, 0), 'glimpse', 'playable until end of turn');
  // [once]: the budget is spent
  assert.throws(() => h.do({ type: 'activateAbility', seat: P, entityId: lil, abilityIndex: 0, via: 'augment' }));
});

test('Lilbot: the sacrifice half works, and no payable cost means no glimpse', () => {
  const h = new Harness(4618);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const lil = spawn(h, P, 'Lilbot');
  const fodder = spawn(h, P, 'LDC Grunt');
  h.state.players[P]!.hand.length = 0;
  h.q.deckOf(P).unshift('LDC Brute', 'LDC Wall');
  h.do({ type: 'activateAbility', seat: P, entityId: lil, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision!.options.length, 1, 'only one legal payment is offered');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.ok(!ent(h, fodder), 'the other unit was sacrificed');
  h.do({ type: 'decide', seat: P, choice: 1 });             // R45: cache one of the two
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['LDC Wall'], 'exactly one cached');
  assert.deepEqual(h.q.deckOf(P).slice(-1), ['LDC Brute'], 'the other recycled');
});

test('Lilbot: R49 — with nothing to discard and no other unit the activation is ILLEGAL', () => {
  const h = new Harness(4629);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const lil = spawn(h, P, 'Lilbot');                       // the ONLY unit
  h.state.players[P]!.hand.length = 0;
  h.q.deckOf(P).unshift('LDC Brute', 'LDC Wall');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: lil, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/);
  assert.deepEqual(cacheOf(h, P), [], 'nothing glimpsed');
  assert.ok(ent(h, lil), '"another" never lets it eat itself');
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === lil),
    'and the [once] budget is not burned on an unpayable activation');
});

// ── No Hand Killer ───────────────────────────────────────────────────────

// The killer sits with the DEFENDER (its home IS the battle region) and the
// victims attack into it — "each opponent" is region-scoped (R25), so both
// seats have to be present, which only an attack arranges.
test('No Hand Killer: [once] discard X cards → each opponent sacrifices X units', () => {
  const h = new Harness(4619);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const nhk = spawn(h, D, 'No Hand Killer');
  const v1 = spawn(h, A, 'LDC Grunt');
  const v2 = spawn(h, A, 'LDC Wall');
  const v3 = spawn(h, A, 'LDC Brute');
  attackWith(h, A, [[v1], [v2], [v3]]);
  h.state.players[D]!.hand.length = 0;
  give(h, D, 'LDC Grunt');
  give(h, D, 'LDC Wall');
  give(h, D, 'LDC Brute');                                 // a third card, deliberately kept
  pass(h);                                                 // priority → D
  const trashedBefore = h.events.filter(ev => ev.type === 'trashed').length;
  h.do({ type: 'activateAbility', seat: D, entityId: nhk, abilityIndex: 0, via: 'augment' });
  // R64 UN-PARKED: "Discard X cards" is the ACTIVATION cost, so the discards
  // are chosen and paid HERE, in the cast window, before the ability is on the
  // stack and before anyone can answer it. X is fixed by the time it is.
  pick(h, { discard: 0 });                                 // discard #1
  pick(h, { discard: 0 });                                 // discard #2
  pick(h, { doneCost: true });                             // that's enough: X = 2, not 3
  assert.deepEqual(h.state.players[D]!.hand, ['LDC Brute'], 'exactly two cards discarded — at cast');
  pass(h); pass(h);                                        // resolve the activated ability
  pick(h, v1);                                             // A sacrifices, 1 of 2
  pick(h, v2);                                             // …and 2 of 2 (v3 survives)
  assert.ok(h.events.filter(ev => ev.type === 'trashed').length >= trashedBefore + 2,
    'discarding trashes (R40)');
  assert.ok(!ent(h, v1) && !ent(h, v2), "two of the opponent's units are gone");
  assert.ok(ent(h, v3), 'and only two — X, not everything');
  drainStack(h);
});

test('No Hand Killer: an empty hand makes the activation unpayable — the [once] survives', () => {
  // R64 UN-PARKED, with the printed floor: the cost is `n: 'X', xMin: 1`, so
  // X = 0 is not on offer. It used to be reachable by declining every discard,
  // which did nothing AND burned the [once] budget for the turn.
  const h = new Harness(4620);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const nhk = spawn(h, D, 'No Hand Killer');
  const v1 = spawn(h, A, 'LDC Grunt');
  attackWith(h, A, [[v1]]);
  h.state.players[D]!.hand.length = 0;                     // empty hand
  pass(h);                                                 // priority → D
  assert.ok(!h.legal(D).some(a => a.type === 'activateAbility' && a.entityId === nhk),
    'nothing to discard → not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: nhk, abilityIndex: 0, via: 'augment' }),
    /nothing it can be used on|cannot pay/);
  assert.ok(ent(h, v1), 'nothing sacrificed');
  // and the budget is intact: give them a card and it works this same turn
  give(h, D, 'LDC Grunt');
  h.do({ type: 'activateAbility', seat: D, entityId: nhk, abilityIndex: 0, via: 'augment' });
  pick(h, { discard: 0 });
  // the hand is empty now, so nothing more can be paid: the variable cost
  // closes itself at X = 1 rather than asking again
  assert.equal(h.state.decision, null);
  assert.deepEqual(h.state.players[D]!.hand, [], 'the one card paid for X = 1');
  pass(h); pass(h);
  // A controls exactly one unit, so their sacrifice is forced and auto-picked
  assert.ok(!ent(h, v1), 'X = 1 unit sacrificed');
  drainStack(h);
});

// ── Prophecy Bug ─────────────────────────────────────────────────────────

test('Prophecy Bug: caches a card from hand with "X Turns Pass", X = half its cost rounded up', () => {
  const h = new Harness(4621);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'light', 1);
  giveResources(h, P, 'water', 1);                         // lb / 1
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'Prophecy Bug');
  give(h, P, 'LDC Five');                                  // [5] → X = ceil(5/2) = 3
  h.do({ type: 'playCard', seat: P, handIndex: 0 });
  assert.deepEqual(h.state.players[P]!.hand, [], 'the only other card was cached');
  const cc = cacheOf(h, P)[0]!;
  assert.equal(cc.card, 'LDC Five');
  assert.equal(cc.prophecy!.condition, '3 Turns Pass');
  assert.equal(cc.prophecy!.norm, '3 turns pass', 'a condition the engine actually recognises');
  assert.equal(cc.prophecy!.turn, h.state.turn, 'anchored to now (R43)');
  assert.equal(h.q.cachePermission(P, 0), null, 'and not yet fulfilled');
  assert.ok(unitsOf(h, P).some(u => u.card === 'Prophecy Bug'), 'the 1/1 body still spawned (spellUnit)');
});

test('Prophecy Bug: with an empty hand it is a harmless 1/1', () => {
  const h = new Harness(4622);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'light', 1);
  giveResources(h, P, 'water', 1);
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'Prophecy Bug');
  h.do({ type: 'playCard', seat: P, handIndex: 0 });
  assert.deepEqual(cacheOf(h, P), [], 'nothing cached');
  assert.ok(h.log.some(l => l.includes('Prophecy Bug: your hand is empty')));
  assert.ok(unitsOf(h, P).some(u => u.card === 'Prophecy Bug'));
});

// ── Rotwall ──────────────────────────────────────────────────────────────

test('Rotwall: damage dealt to it gives each opponent a rot (R38)', () => {
  const h = new Harness(4623);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Brute');                    // 3/3
  const wall = spawn(h, D, 'Rotwall');                     // 0/5 — survives, deals nothing
  attackWith(h, A, [[atk]]);
  throughCombat(h, D, { 0: [wall] });
  assert.equal(ent(h, wall)!.damage, 3, 'it took the hit');
  assert.equal(rotOf(h, A), 1, 'the opponent gained a rot');
  assert.equal(rotOf(h, D), 0, 'not its own controller');
  assert.ok(ent(h, atk), 'a 0-power wall kills nothing');
});

// ── Swarmling ────────────────────────────────────────────────────────────

test('Swarmling: discarding IT fires its own trigger from the bin — pay [1] for a copy', () => {
  const h = new Harness(4624);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'metal', 1);
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'Swarmling');
  whiteBox(h, e => { e.discardFromHand(P, 0); });
  assert.ok(h.state.decision, 'the [1] is a pay-or-decline');
  pick(h, true);
  const copies = unitsOf(h, P).filter(u => u.card === 'Swarmling');
  assert.equal(copies.length, 1, 'one copy created');
  assert.ok(copies[0]!.token, 'as a token (⚠ "create a copy of me")');
  assert.deepEqual(effStats(h, copies[0]!.id), [2, 1], 'with the printed stats');
  assert.equal(h.q.openMana(P), 0, 'the [1] was paid');
  assert.ok(h.state.players[P]!.bin.includes('Swarmling'), 'the discarded card is still in the bin');
});

test('Swarmling: in play, discarding ANOTHER card fires it too — and declining costs nothing', () => {
  const h = new Harness(4625);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'metal', 1);
  spawn(h, P, 'Swarmling');
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'LDC Grunt');
  whiteBox(h, e => { e.discardFromHand(P, 0); });
  assert.ok(h.state.decision);
  pick(h, false);
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Swarmling').length, 1, 'declined — no copy');
  assert.equal(h.q.openMana(P), 1, 'and nothing paid');

  // milling is not discarding (R40 trashes it, but not from hand)
  h.q.deckOf(P).unshift('LDC Grunt');
  whiteBox(h, e => { e.mill(P, 1); });
  assert.equal(h.state.decision, null, 'a mill offers no payment — "whenever you DISCARD"');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Swarmling').length, 1);
});

// ── Trench Stalker ───────────────────────────────────────────────────────

test('Trench Stalker: [Discard two cards] cost, play into formation, play from bin', { todo: true }, () => {
  // STILL PARKED, on two of its original three. R49 supplied the first:
  // `castCost: { kind: 'discardCard', n: 2 }` is expressible now (though the
  // extractor still leaves the printed line inside `text` rather than emitting
  // a cost, so it would have to be authored by hand). Deliberately NOT added
  // on its own: the cost without the two benefits it buys — a
  // play-directly-into-formation MODE and a play-from-bin ACTION, both of
  // which live in apply.ts's play paths — would make the card strictly worse
  // than the vanilla body it currently plays as.
});

test('Trench Stalker: registers and plays as an ordinary [2] {Battle} 6/2', () => {
  const h = new Harness(4626);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'dark', 1);                          // bd / 2
  attackWith(h, A, [[atk]]);
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Trench Stalker') });
  pass(h); pass(h);                                        // resolve
  const ts = unitsOf(h, D).find(u => u.card === 'Trench Stalker');
  assert.ok(ts, 'it is in play');
  assert.deepEqual(effStats(h, ts.id), [6, 2]);
});

// ── Visionary Construct ──────────────────────────────────────────────────

test('Visionary Construct: "Pay 3 life: Glimpse 1" — cached, playable this turn, mana still paid', () => {
  const h = new Harness(4627);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const vc = spawn(h, P, 'Visionary Construct');
  h.q.deckOf(P).unshift('LDC Five');
  giveResources(h, P, 'fire', 5);
  const life = lifeOf(h, P);
  h.do({ type: 'activateAbility', seat: P, entityId: vc, abilityIndex: 0, via: 'augment' });
  assert.equal(lifeOf(h, P), life - 3, '3 life paid');
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['LDC Five']);
  assert.equal(h.q.cachePermission(P, 0), 'glimpse');
  assert.ok(h.events.some(ev => ev.type === 'glimpsed'), 'revealed publicly (R41)');
  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), mana - 5, 'glimpse ignores affinity but still pays the mana (R45)');
  assert.ok(unitsOf(h, P).some(u => u.card === 'LDC Five'));
});

test('Visionary Construct: R49 — 3 life it cannot survive paying makes the activation ILLEGAL', () => {
  const h = new Harness(4628);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const vc = spawn(h, P, 'Visionary Construct');
  h.q.deckOf(P).unshift('LDC Five');
  h.state.players[P]!.life = 3;
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: vc, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/);
  assert.equal(lifeOf(h, P), 3, 'nothing paid');
  assert.deepEqual(cacheOf(h, P), [], 'and nothing glimpsed');
  assert.notEqual(h.state.phase, 'gameover');
  // at 4 life it is payable and the life goes at ACTIVATION
  h.state.players[P]!.life = 4;
  h.do({ type: 'activateAbility', seat: P, entityId: vc, abilityIndex: 0, via: 'augment' });
  assert.equal(lifeOf(h, P), 1, 'the 3 life is paid as the ability is activated');
  assert.equal(cacheOf(h, P).length, 1, 'and the glimpse happened');
});
