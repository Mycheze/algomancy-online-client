/* Per-card tests for the Light & Dark hybrid batch C (batch-hybrids-ld-c):
 * bin-prophesying (Angel of Anguish, CR 803.7c), life-paid recall and glimpse
 * (Aurozoa, Visionary Construct, CR 801.9), the combat-damage-as-rot replacement
 * (Blightsea Polyp, CR 608.8a), counter/rot/debt doubling (Buffer Overflow),
 * stealing a unit into your hand plus a discard (Capture, CR 801.3), life-change
 * pumps and their [Switch1] budget (Deathcoil Construct, CR 722.5), a paid
 * spell-played drain (Dragnol), empty-hand bin plays (Gridxlan), a life total
 * rewritten from the bins (Haunting Memories), an after-combat life exchange (Iyngstra),
 * cost-funded glimpses (Lilbot), a variable discard CAST COST (No Hand Killer,
 * CR 705.3b — the discards used to happen at resolution),
 * a granted prophecy computed from a cost (Prophecy Bug, CR 803.7), damage-driven
 * rot (Rotwall), and the two shapes of a discard trigger (Swarmling).
 * The PARKED Counter Thief (counter-placement replacement) has a registration
 * test + todo. Trench Stalker is LIVE, whole: the [Discard two
 * cards] cast cost, CR 602.7 formation entry and the play-from-bin action landed
 * together.
 *
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration can't shift assertions. Seeds: 4600-4699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { legalActions, IllegalAction } from '../src/apply.ts';
import {
  effStats, ent, give, giveResources, pass, pick, resolveAfterCombat, skipHasteStep,
  spawn, toDeployment, toNextBattle, unitsOf, withE as whiteBox,
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

test('Angel of Anguish: can be prophesied FROM THE BIN, then released free two turns later (CR 803.7c, 803.7)', () => {
  const h = new Harness(4600);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('LDC Grunt', 'Angel of Anguish');
  giveResources(h, P, 'light', 1);   // CR 803.7d: the banner is [1ld] — one mana,
  giveResources(h, P, 'dark', 1);    // and a light and a dark pip to meet

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
  assert.equal(h.q.cachePermission(P, 0), null, 'one turn is not two (CR 803.7)');
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

// The designer's printing of 2026-11-10 is "[Augment][Battle] Pay 1 life:
// Recall me." — the [Battle] glyph makes it a battle-speed activation (CR 705.2),
// on Aurozoa itself and on a host alike. It used to be activatable in deployment.

test('Aurozoa: "[Augment][Battle] Pay 1 life: Recall me" — in battle, on itself and donated to a host', () => {
  const h = new Harness(4601);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const own = spawn(h, P, 'Aurozoa');
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[own]] });
  drainStack(h);
  const life = lifeOf(h, P);
  assert.equal(h.state.priority, P, 'the attacker holds priority in the attack window');
  h.do({ type: 'activateAbility', seat: P, entityId: own, abilityIndex: 0, via: 'augment' });
  assert.equal(lifeOf(h, P), life - 1, '1 life paid as the cost (CR 111.6)');
  drainStack(h);
  assert.ok(!ent(h, own), 'Aurozoa left play');
  assert.ok(h.state.players[P]!.hand.includes('Aurozoa'), 'recalled to hand');

  // donated: "me" anchors on the HOST, so the host is what gets recalled
  const h2 = new Harness(4633);
  toDeployment(h2);
  const Q = h2.state.deployPlayer!;
  const host = spawn(h2, Q, 'LDC Grunt');
  giveResources(h2, Q, 'light', 1);
  giveResources(h2, Q, 'water', 2);                        // lb / 3
  h2.do({ type: 'augment', seat: Q, from: 'hand', index: give(h2, Q, 'Aurozoa'), hostId: host });
  const mod = ent(h2, host)!.mods[0]!;
  toNextBattle(h2, Q);
  h2.do({ type: 'declareAttack', seat: Q, columns: [[host]] });
  drainStack(h2);
  const life2 = lifeOf(h2, Q);
  h2.do({ type: 'activateAbility', seat: Q, entityId: host, abilityIndex: 0, via: { mod } });
  assert.equal(lifeOf(h2, Q), life2 - 1);
  drainStack(h2);
  assert.ok(!ent(h2, host), 'the HOST was recalled');
  assert.ok(h2.state.players[Q]!.hand.includes('LDC Grunt'));
  assert.ok(h2.state.players[Q]!.bin.includes('Aurozoa'), 'the mod stayed behind → bin (CR 410.4)');
});

test('Aurozoa: the [Battle] glyph — in deployment the recall is neither offered nor accepted, on itself or on a host', () => {
  const h = new Harness(4634);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const own = spawn(h, P, 'Aurozoa');
  const host = spawn(h, P, 'LDC Grunt');
  giveResources(h, P, 'light', 1);
  giveResources(h, P, 'water', 2);
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Aurozoa'), hostId: host });
  const mod = ent(h, host)!.mods[0]!;
  const life = lifeOf(h, P);
  assert.equal(h.state.phase, 'deploy');
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && (a.entityId === own || a.entityId === host)),
    'not offered in deployment');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: own, abilityIndex: 0, via: 'augment' }),
    /only be activated during battle/);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: host, abilityIndex: 0, via: { mod } }),
    /only be activated during battle/);
  assert.equal(lifeOf(h, P), life, 'nothing paid');
  assert.ok(ent(h, own) && ent(h, host), 'and nothing recalled');
});

test('Aurozoa: CR 111.6b — at 1 life the cost is unpayable and the activation is ILLEGAL', () => {
  const h = new Harness(4602);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const own = spawn(h, P, 'Aurozoa');
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[own]] });
  drainStack(h);
  h.state.players[P]!.life = 1;
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: own, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/);
  assert.equal(lifeOf(h, P), 1, 'nothing paid');
  assert.ok(ent(h, own), 'and nothing recalled');
  assert.equal(h.state.phase, 'battle', 'the game is very much not over');
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === own),
    'not offered either');
});

// ── Blightsea Polyp ──────────────────────────────────────────────────────

test('Blightsea Polyp: a column\'s combat damage to a player becomes 1 rot, per column (CR 608.8a)', () => {
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
  pass(h); // resolve
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
  pass(h); // resolve
  assert.ok(h.state.decision, 'the discard is a mid-resolution choice');
  pick(h, 0);                                              // discard LDC Grunt, keep the loot
  assert.ok(!ent(h, atk), 'the unit left play');
  assert.deepEqual(h.state.players[D]!.hand, ['LDC Brute'],
    "it went to the CASTER's hand, not its owner's");
  assert.ok(h.state.players[D]!.bin.includes('LDC Grunt'), 'and a card was discarded');
  assert.ok(h.events.some(ev => ev.type === 'trashed' && ev.data?.['card'] === 'LDC Grunt'),
    'discarding trashes it (CR 801.3)');
  assert.ok(!h.state.players[A]!.hand.includes('LDC Brute'), 'the owner never got it back');
});

// ── Counter Thief ────────────────────────────────────────────────────────

test('Counter Thief: counters placed on any unit during battle land on it instead', () => {
  // CR 708.4a, the REDIRECT family: the number is untouched and the RECIPIENT
  // changes, so this is a first-claimant-consumes hook and not a summed
  // AmountMod. The counters land on exactly one unit either way.
  const h = new Harness(4620);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ct = spawn(h, P, 'Counter Thief');
  const other = spawn(h, P, 'LDC Grunt');
  toNextBattle(h, P);
  whiteBox(h, e => e.addCounters(e.entity(other)!, 2));
  assert.equal(ent(h, other)!.counters, 0, 'the printed recipient got none');
  assert.equal(ent(h, ct)!.counters, 2, '"those counters are placed on me instead"');
});

test('Counter Thief: outside battle the counters land where they were put', () => {
  // "during battle" is a printed restriction and it is real. The engine's own
  // battle state answers it, which costs a query rather than a listener.
  const h = new Harness(4621);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ct = spawn(h, P, 'Counter Thief');
  const other = spawn(h, P, 'LDC Grunt');
  whiteBox(h, e => e.addCounters(e.entity(other)!, 2));
  assert.equal(ent(h, other)!.counters, 2, 'deployment is not battle');
  assert.equal(ent(h, ct)!.counters, 0);
});

test('Counter Thief: two thieves do not ping-pong, and the theft never reaches the stack', () => {
  // Counters a thief redirects onto itself are still a counter placement, so
  // two thieves could bounce one placement between them forever. They do not,
  // because each replacement applies to the placement once (CR 708.4) — the
  // engine's chain, not a module-level `let` in a card file (report #60).
  //
  // INVERTED 2026-10-16 (report round 2026-10-16, WP9): this used to assert
  // that the LOWER id claims them ("first one wins"). Caleb, rules-questions
  // 2025-11-25: "the tldr is replacement effects only apply once onto an
  // effect", and the owner: "the chain should work in the way he says". The
  // first thief's redirect leaves counters "placed on one or more units", which
  // the second thief, not yet applied, still matches — so they end on the
  // SECOND (timestamp order; who orders them is an open item).
  const h = new Harness(4622);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const first = spawn(h, P, 'Counter Thief');
  const second = spawn(h, P, 'Counter Thief');
  const other = spawn(h, P, 'LDC Grunt');
  toNextBattle(h, P);
  const before = h.events.length;
  whiteBox(h, e => e.addCounters(e.entity(other)!, 3));
  assert.equal(ent(h, second)!.counters, 3, 'the chain ends on the later thief');
  assert.equal(ent(h, first)!.counters, 0, 'and the other gets nothing — a redirect, not a copy');
  assert.equal(ent(h, other)!.counters, 0);
  const after = h.events.slice(before);
  assert.equal(after.filter(ev => ev.type === 'countersChanged').length, 1,
    'ONE countersChanged for one placement');
  assert.equal(after.filter(ev => ev.type === 'triggered' || ev.type === 'stackPushed').length, 0,
    'nothing was queued and nothing was pushed — there is no stack item to negate');
});

test('Counter Thief: plays as a 0/5 and augments (donating nothing yet)', () => {
  const h = new Harness(4607);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const ct = spawn(h, P, 'Counter Thief');
  assert.deepEqual(effStats(h, ct), [0, 5], 'vanilla 0/5 in play');
  const host = spawn(h, P, 'LDC Grunt');
  giveResources(h, P, 'metal', 2);
  giveResources(h, P, 'dark', 2);                          // md / 4
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Counter Thief'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
  whiteBox(h, e => e.addCounters(e.entity(host)!, 2));
  assert.equal(ent(h, host)!.counters, 2,
    'outside battle nothing is stolen — and "me" is the HOST when the text is donated, '
    + 'so even in battle the host would keep its own counters');
});

// ── Deathcoil Construct ──────────────────────────────────────────────────

test('Deathcoil Construct: gaining OR losing life pumps all your units — once per turn (CR 109.9)', () => {
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
// CR 601.1d: an [Augment] trigger only hears events in its own region.
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
  pass(h);
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
//
// CR 707.10: a standing permission since the CT-255 fix was applied to it —
// each playable unit in the bin is its own `playFromBin` offer in deployment
// (559 is its guard). These are the old activated-ability tests, kept on the
// new action shape.

/** the bin cards a deployment bin-play permission offers `P` right now */
const binOffer = (h: Harness, P: Seat): string[] => legalActions(h.state, P)
  .flatMap(a => a.type === 'playFromBin' ? [h.state.players[P]!.bin[a.binIndex]!] : []);

test('Gridxlan: with an EMPTY hand, play a unit out of your bin during deployment', () => {
  const h = new Harness(4612);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Gridxlan');
  h.state.players[P]!.hand.length = 0;
  h.state.players[P]!.bin.push('LDC Five', 'LDC Grunt');   // [5] is unaffordable below
  giveResources(h, P, 'earth', 2);                         // 2 open mana
  assert.deepEqual(binOffer(h, P), ['LDC Grunt'], 'only affordable UNIT cards are offered');
  h.do({ type: 'playFromBin', seat: P, binIndex: 1 });     // bin index 1 = LDC Grunt
  assert.ok(unitsOf(h, P).some(u => u.card === 'LDC Grunt'), 'it is in play');
  assert.deepEqual(h.state.players[P]!.bin, ['LDC Five'], 'and it left the bin');
  assert.equal(h.q.openMana(P), 2, 'LDC Grunt is a [0] — its own cost is what is paid');
});

test('CR 705.3a: Gridxlan with a non-empty hand is not offered, and does not burn its [once]', () => {
  // "If your hand is empty" is a condition of the permission: while it is false
  // nothing is offered and nothing is spent, so emptying the hand afterwards
  // still lets the play happen.
  const h = new Harness(4613);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Gridxlan');
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'LDC Grunt');                                 // hand is NOT empty
  h.state.players[P]!.bin.push('LDC Grunt');
  assert.deepEqual(binOffer(h, P), [], 'not offered while the hand has a card in it');
  assert.throws(() => h.do({ type: 'playFromBin', seat: P, binIndex: 0 }),
    (err: unknown) => err instanceof IllegalAction);
  assert.deepEqual(h.state.players[P]!.bin, ['LDC Grunt'], 'nothing left the bin');
  h.state.players[P]!.hand.length = 0;
  assert.deepEqual(binOffer(h, P), ['LDC Grunt'], 'the budget was never spent');
  h.do({ type: 'playFromBin', seat: P, binIndex: 0 });
  assert.ok(unitsOf(h, P).some(u => u.card === 'LDC Grunt'), 'it plays from the bin');
});

test('Gridxlan with an empty hand but nothing playable in the bin is not offered', () => {
  const h = new Harness(4616);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grid = spawn(h, P, 'Gridxlan');
  h.state.players[P]!.hand.length = 0;
  h.state.players[P]!.bin.length = 0;                      // empty hand, empty bin
  assert.deepEqual(binOffer(h, P), [], 'an empty bin offers nothing');
  assert.ok(!legalActions(h.state, P).some(a => a.type === 'activateAbility' && a.entityId === grid),
    'and there is no ability to activate at all (CR 707.10)');
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
  pass(h); // resolve
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
  pass(h);
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, D, 'a life total of 0 is a dead player');
});

// ── Iyngstra ─────────────────────────────────────────────────────────────

// The designer's new printing (the owner, 2026-11-10): le/5, "[Augment] After
// combat, you may exchange life totals with target player." It was le/3,
// "[Augment] Whenever another ally spawns, you gain life equal to their
// defense." The spawn half is gone; the after-combat exchange is new.

/** Iyngstra attacks alone, unblocked; returns at the after-combat target pick */
function iyngstraAfterCombat(seed: number, lives: [number, number]): { h: Harness; A: Seat; D: Seat; iy: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const iy = spawn(h, A, 'Iyngstra');                      // 3/6
  toNextBattle(h, A);
  h.state.players[A]!.life = lives[0];
  h.state.players[D]!.life = lives[1];
  h.do({ type: 'declareAttack', seat: A, columns: [[iy]] });
  pass(h); pass(h);                                        // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                        // combat (D takes 3) + the after-combat trigger
  return { h, A, D, iy };
}

test('Iyngstra: after combat, you may exchange life totals with target player', () => {
  const { h, A, D } = iyngstraAfterCombat(4616, [8, 25]);
  assert.equal(lifeOf(h, D), 22, 'combat first: D took 3');
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets', 'the after-combat trigger asks for its player');
  assert.equal(dec.seat, A);
  const vals = dec.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.includes(JSON.stringify({ player: A })) && vals.includes(JSON.stringify({ player: D })),
    '"target player": either player, yourself included (CR 110.3c)');
  assert.ok(vals.includes(JSON.stringify({ doneTargets: true })), '"you may": the stop is offered before any pick');
  const self = dec.options.find(o => JSON.stringify(o.value) === JSON.stringify({ player: A }))!;
  assert.match(self.confirm ?? '', /yourself changes nothing/, 'picking yourself asks first');
  assert.equal(dec.options.find(o => JSON.stringify(o.value) === JSON.stringify({ player: D }))!.confirm,
    undefined, 'picking the opponent does not');
  pick(h, { player: D });
  resolveAfterCombat(h);
  assert.equal(lifeOf(h, A), 22, "A takes D's total");
  assert.equal(lifeOf(h, D), 8, "D takes A's");
});

test('Iyngstra: declining, or picking yourself, leaves both totals as they were', () => {
  const a = iyngstraAfterCombat(4635, [8, 25]);
  pick(a.h, { doneTargets: true });
  resolveAfterCombat(a.h);
  assert.deepEqual([lifeOf(a.h, a.A), lifeOf(a.h, a.D)], [8, 22], 'declined');
  const b = iyngstraAfterCombat(4636, [8, 25]);
  pick(b.h, { player: b.A });
  resolveAfterCombat(b.h);
  assert.deepEqual([lifeOf(b.h, b.A), lifeOf(b.h, b.D)], [8, 22], 'with yourself: nothing changes');
});

test('Iyngstra: the exchange is two life changes — a locked total stays, the other still moves', () => {
  const { h, A, D } = iyngstraAfterCombat(4637, [8, 25]);
  whiteBox(h, e => e.lockLife(D, h.state.battle!.region));   // Suspend on D
  pick(h, { player: D });
  resolveAfterCombat(h);
  assert.equal(lifeOf(h, D), 22, "D's total can't change this battle");
  assert.equal(lifeOf(h, A), 22, 'A still gains up to it (CR 101.5: as much as it can)');
  assert.ok(h.events.some(ev => ev.type === 'lifeGained' && ev.data?.['seat'] === A && ev.data?.['n'] === 14),
    "A's half is an ordinary life gain of 14");
});

test('Iyngstra: augmented onto a host, the host carries the exchange', () => {
  const h = new Harness(4639);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  h.state.deployPlayer = A;
  const host = spawn(h, A, 'LDC Grunt');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'earth', 4);                         // le / 5
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Iyngstra'), hostId: host });
  toNextBattle(h, A);
  h.state.players[A]!.life = 5;
  h.state.players[D]!.life = 20;
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                        // D takes 1
  assert.equal(h.state.decision?.kind, 'targets', "the host's after-combat trigger asks");
  pick(h, { player: D });
  resolveAfterCombat(h);
  assert.deepEqual([lifeOf(h, A), lifeOf(h, D)], [19, 5]);
});

test('Iyngstra: no longer gains life when another ally spawns', () => {
  const h = new Harness(4638);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Iyngstra');
  const life0 = lifeOf(h, P);
  spawn(h, P, 'LDC Wall');                                 // 0/5
  assert.equal(lifeOf(h, P), life0, 'the old spawn trigger is gone');
});

// ── Lilbot ───────────────────────────────────────────────────────────────

test('Lilbot: [once] discard a card OR sacrifice another nontoken unit → Glimpse 2 (CR 801.9)', () => {
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
  pick(h, { discard: 0 });                                 // CR 111.7: paid at activation
  assert.deepEqual(h.state.players[P]!.hand, [], 'the card was discarded');
  assert.ok(ent(h, fodder), 'and the unit survived');
  // CR 801.9a: Glimpse 2 reveals two and caches ONE of the glimpser's choice
  const glimpseDec = h.state.decision!;
  assert.deepEqual(glimpseDec.options.map(o => o.card), ['LDC Brute', 'LDC Wall'],
    'both revealed cards are offered');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['LDC Brute'], 'exactly ONE is cached');
  assert.deepEqual(h.q.recycleOf(P).slice(-1), ['LDC Wall'], 'CR 408.2: the other is recycled past the mark');
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
  h.do({ type: 'decide', seat: P, choice: 1 });             // CR 801.9a: cache one of the two
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['LDC Wall'], 'exactly one cached');
  assert.deepEqual(h.q.recycleOf(P).slice(-1), ['LDC Brute'], 'CR 408.2: the other recycled past the mark');
});

test('Lilbot: CR 705.4 — with nothing to discard and no other unit the activation is ILLEGAL', () => {
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
// victims attack into it — "each opponent" is region-scoped (CR 601.4d), so both
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
  // UN-PARKED (CR 111.7): "Discard X cards" is the ACTIVATION cost, so the discards
  // are chosen and paid HERE, in the cast window, before the ability is on the
  // stack and before anyone can answer it. X is fixed by the time it is.
  pick(h, { discard: 0 });                                 // discard #1
  pick(h, { discard: 0 });                                 // discard #2
  pick(h, { doneCost: true });                             // that's enough: X = 2, not 3
  assert.deepEqual(h.state.players[D]!.hand, ['LDC Brute'], 'exactly two cards discarded — at cast');
  pass(h); // resolve the activated ability
  pick(h, v1);                                             // A sacrifices, 1 of 2
  pick(h, v2);                                             // …and 2 of 2 (v3 survives)
  assert.ok(h.events.filter(ev => ev.type === 'trashed').length >= trashedBefore + 2,
    'discarding trashes (CR 801.3)');
  assert.ok(!ent(h, v1) && !ent(h, v2), "two of the opponent's units are gone");
  assert.ok(ent(h, v3), 'and only two — X, not everything');
  drainStack(h);
});

test('CR 107.2b: an empty hand still activates No Hand Killer — X = 0, and the [once] is spent', () => {
  // REVERSED by the owner's answer of 2026-08-25 (now CR 109.9c): *"You can legally activate it and
  // discard no cards."* The cost used to carry the unprinted floor `xMin: 1`
  // so that X = 0 — which does nothing AND burns the [once] budget — could not
  // be reached. The ruling says that pointless activation is the player's to
  // make, so the floor is gone and the offer stands with an empty hand.
  const h = new Harness(4620);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const nhk = spawn(h, D, 'No Hand Killer');
  const v1 = spawn(h, A, 'LDC Grunt');
  attackWith(h, A, [[v1]]);
  h.state.players[D]!.hand.length = 0;                     // empty hand
  pass(h);                                                 // priority → D
  assert.ok(h.legal(D).some(a => a.type === 'activateAbility' && a.entityId === nhk),
    'nothing to discard, and it is offered anyway');
  h.do({ type: 'activateAbility', seat: D, entityId: nhk, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision, null, 'no menu: an empty hand pays X = 0 outright');
  drainStack(h);
  assert.ok(ent(h, v1), 'X = 0 — nothing sacrificed');
  assert.ok(!h.legal(D).some(a => a.type === 'activateAbility' && a.entityId === nhk),
    'and the [once] really was spent on it — that is the price the ruling accepts');
  drainStack(h);
});

test('No Hand Killer: with a card in hand, X = 1 forces one sacrifice', () => {
  const h = new Harness(4621);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const nhk = spawn(h, D, 'No Hand Killer');
  const v1 = spawn(h, A, 'LDC Grunt');
  attackWith(h, A, [[v1]]);
  h.state.players[D]!.hand.length = 0;
  pass(h);                                                 // priority → D
  give(h, D, 'LDC Grunt');
  h.do({ type: 'activateAbility', seat: D, entityId: nhk, abilityIndex: 0, via: 'augment' });
  pick(h, { discard: 0 });
  // the hand is empty now, so nothing more can be paid: the variable cost
  // closes itself at X = 1 rather than asking again
  assert.equal(h.state.decision, null);
  assert.deepEqual(h.state.players[D]!.hand, [], 'the one card paid for X = 1');
  pass(h);
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
  assert.equal(cc.prophecy!.turn, h.state.turn, 'anchored to now (CR 803.7)');
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

test('Rotwall: damage dealt to it gives each opponent a rot (CR 112.13)', () => {
  const h = new Harness(4623);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Brute');                    // 3/3
  const wall = spawn(h, D, 'Rotwall');                     // 0/5 — survives, deals nothing
  attackWith(h, A, [[atk]]);
  throughCombat(h, D, { 0: [wall] });
  resolveAfterCombat(h);   // CR 608.9b: the "damage dealt to it" trigger is stacked after combat
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

  // milling is not discarding (CR 801.2a trashes it, but not from hand)
  h.q.deckOf(P).unshift('LDC Grunt');
  whiteBox(h, e => { e.mill(P, 1); });
  assert.equal(h.state.decision, null, 'a mill offers no payment — "whenever you DISCARD"');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Swarmling').length, 1);
});

// ── Trench Stalker ───────────────────────────────────────────────────────

/** answer the cast-window questions in whatever order collectTargets raises
 * them (the CR 702.3e open-spot question comes before the fixed [Discard two
 * cards]); returns how many of each were asked. */
function answerStalkerCast(h: Harness): { spots: number; discards: number } {
  const n = { spots: 0, discards: 0 };
  let guard = 10;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    if (dec.prompt.includes('which open spot')) {
      n.spots++;
      const i = dec.options.findIndex(o => o.label.includes('behind LDC Grunt'));
      assert.ok(i >= 0, `an open spot behind the attacker is on the menu: [${dec.options.map(o => o.label)}]`);
      h.do({ type: 'decide', seat: dec.seat, choice: i });
    } else if (dec.prompt.includes('discard')) {
      n.discards++;
      pick(h, { discard: 0 });
    } else break;
  }
  return n;
}

test('Trench Stalker (CR 405.9a): played from your bin — [Discard two cards] paid in the cast window, straight into an open spot (CR 602.7), and NO {Unstable}', () => {
  const h = new Harness(4630);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'dark', 1);                          // bd / 2
  h.state.players[A]!.bin.push('Trench Stalker');
  attackWith(h, A, [[atk]]);
  h.state.players[A]!.hand.splice(0);                      // deterministic fodder
  give(h, A, 'LDC Grunt'); give(h, A, 'LDC Grunt');
  const offer = h.legal(A).find(a => a.type === 'playFromBin');
  assert.ok(offer, 'the bin play is offered in the battle window');
  h.do(offer!);
  // mid-cast wire trip: the suspension and its cost receipts are plain state
  h.state = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  const asked = answerStalkerCast(h);
  assert.equal(asked.spots, 1, 'the CR 602.7 open-spot question was asked at cast');
  assert.equal(asked.discards, 2, 'both discards chosen and paid at cast');
  drainStack(h);                                           // resolve
  const ts = unitsOf(h, A).find(u => u.card === 'Trench Stalker')!;
  assert.ok(ts, 'in play');
  assert.ok(h.state.battle!.columns[0]!.includes(ts.id), 'played directly into the line — never standing outside it');
  assert.equal(h.state.players[A]!.hand.length, 0, 'both fodder cards discarded');
  assert.ok(!h.state.players[A]!.bin.includes('Trench Stalker'), 'the Stalker left the bin');
  assert.equal(h.state.players[A]!.bin.filter(n => n === 'LDC Grunt').length, 2, '…and the two discards reached it');
  assert.ok(h.log.some(l => l.includes("Trench Stalker is played from")), 'the log says where it came from');
  assert.ok(!h.q.isUnstable(ts),
    "NOT {Unstable}: the CR 405.9a stamp is the GRANTING card's own text (Abyssal Evocation), and Trench Stalker's line grants none");
});

test('Trench Stalker (CR 405.9): with fewer than two other cards in hand the bin play is not offered — the cost gates the offer', () => {
  const h = new Harness(4631);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'dark', 1);
  h.state.players[A]!.bin.push('Trench Stalker');
  attackWith(h, A, [[atk]]);
  h.state.players[A]!.hand.splice(0);
  give(h, A, 'LDC Grunt');
  assert.ok(!h.legal(A).some(a => a.type === 'playFromBin'), 'one card to discard is not two — no offer');
  give(h, A, 'LDC Grunt');
  assert.ok(h.legal(A).some(a => a.type === 'playFromBin'), '…and with a second card it appears');
});

test('Trench Stalker (CR 205.3): from HAND the printed cost applies too — no longer strictly better than printed in either direction', () => {
  const h = new Harness(4632);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'dark', 1);
  attackWith(h, A, [[atk]]);
  h.state.players[A]!.hand.splice(0);
  const tsIdx = give(h, A, 'Trench Stalker');
  // direction 1: the vanilla registration played from an empty hand; the
  // printed card cannot — the [cost] gates the hand play as well
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === tsIdx),
    'with nothing to discard the hand play is refused');
  give(h, A, 'LDC Grunt'); give(h, A, 'LDC Grunt');
  const offer = h.legal(A).find(a => a.type === 'playCard' && a.handIndex === tsIdx);
  assert.ok(offer, 'with two other cards it is offered');
  h.do(offer!);
  const asked = answerStalkerCast(h);
  assert.equal(asked.discards, 2);
  assert.equal(asked.spots, 1, 'direction 2: the formation entry works from hand too');
  drainStack(h);
  const ts = unitsOf(h, A).find(u => u.card === 'Trench Stalker')!;
  assert.ok(h.state.battle!.columns[0]!.includes(ts.id), 'joined the column behind the attacker');
  assert.equal(h.state.players[A]!.hand.length, 0, 'both discards paid from hand');
});

test('Trench Stalker: registers as a bd/2 {Battle} 6/2 — and a plain hand play now pays the printed [Discard two cards] (CR 205.3)', () => {
  const h = new Harness(4626);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'LDC Grunt');
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'dark', 1);                          // bd / 2
  attackWith(h, A, [[atk]]);
  pass(h);                                                 // priority → D
  const before = h.state.players[D]!.hand.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Trench Stalker') });
  pick(h, { discard: 0 }); pick(h, { discard: 0 });        // CR 205.3: the cost, paid at cast
  // no open-spot question here: the DEFENDER has no formation before blocks
  // are declared, and CR 602.7c asks nothing when there is nothing to join
  drainStack(h);                                           // resolve
  const ts = unitsOf(h, D).find(u => u.card === 'Trench Stalker');
  assert.ok(ts, 'it is in play');
  assert.deepEqual(effStats(h, ts.id), [6, 2]);
  assert.equal(h.state.players[D]!.hand.length, before - 2, 'two cards were discarded on the way in');
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
  assert.ok(h.events.some(ev => ev.type === 'glimpsed'), 'revealed publicly (CR D6.2c)');
  const mana = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), mana - 5, 'glimpse ignores affinity but still pays the mana (CR 801.9f)');
  assert.ok(unitsOf(h, P).some(u => u.card === 'LDC Five'));
});

test('Visionary Construct: CR 111.6b — 3 life it cannot survive paying makes the activation ILLEGAL', () => {
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
