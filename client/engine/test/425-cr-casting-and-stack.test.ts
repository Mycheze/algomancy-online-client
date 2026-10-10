/**
 * Comprehensive rules, unit U14 (playing vs applying, casting, the stack and
 * priority, resolution and fizzling) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U14
 * (data/comprehensive-rules/build/probes/U14/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U14.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, IllegalAction } from '../src/engine.ts';
import { apply } from '../src/apply.ts';
import type { EntityId, EventType, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, handIdx, pass, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf, withE,
} from './util.ts';

const FILLER = 'The Foretold';
const other = (s: Seat): Seat => (1 - s) as Seat;

function vanilla(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  h.state = e.s;
  return u.id;
}

/** Does the reducer refuse this action? (run on a copy, so the game is untouched) */
function refused(h: Harness, a: Parameters<typeof apply>[1]): boolean {
  try { apply(structuredClone(h.state), a); return false; } catch (err) {
    if (err instanceof IllegalAction) return true;
    throw err;
  }
}

/** A battle in progress with a filler deck, the attacker has cast Arc
 *  Lightning at the defender, and the defender holds priority with mana of
 *  every element. */
function battlePriority(seed: number) {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, FILLER);
  spawn(h, D, FILLER);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { player: D });
  for (const el of ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const) giveResources(h, D, el, 6);
  assert.equal(h.state.priority, D, 'fixture: the defender holds priority');
  return { h, A, D, atk };
}

/* ── playing from other zones: timing ───────────────────────────────────── */

test('cr:effects.casting.other-zones.timing — a glimpsed deploy-timing unit in the cache is not playable in battle', () => {
  const { h, D } = battlePriority(71435);
  h.q.deckOf(D).unshift('Curio Drifter');
  withE(h, e => { e.glimpse(D, 1); });
  const ci = h.state.players[D]!.cache!.length - 1;
  assert.equal(h.q.cachePermission(D, ci), 'glimpse', 'a live permission');
  assert.ok(!h.legal(D).some(a => a.type === 'playCached' && a.index === ci), 'not offered in battle');
  assert.throws(() => h.do({ type: 'playCached', seat: D, index: ci }), IllegalAction, 'and refused if forced');
});

test('cr:effects.casting.other-zones.timing — the same kind of glimpsed unit IS playable from the cache in deployment', () => {
  const h = new Harness(71432);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'earth', 4);
  h.q.deckOf(P).unshift('Mirage Scuttler');
  withE(h, e => { e.glimpse(P, 1); });
  const ci = h.state.players[P]!.cache!.length - 1;
  assert.equal(h.q.cachePermission(P, ci), 'glimpse', 'fixture: a live glimpse');
  assert.ok(h.legal(P).some(a => a.type === 'playCached' && a.index === ci), 'offered in deployment');
});

test('cr:effects.casting.other-zones.timing — under Abyssal Evocation a deploy-timing spell in the bin is not playable in battle', () => {
  const { h, D } = battlePriority(71436);
  // let the Arc resolve, then the defender plays Abyssal Evocation (a battle spell)
  pass(h);
  if (h.state.stack.length) pass(h);
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Abyssal Evocation') });
  for (let i = 0; i < 3 && h.state.stack.some(s => s.card === 'Abyssal Evocation'); i++) pass(h);
  assert.ok(!h.state.stack.some(s => s.card === 'Abyssal Evocation'), 'Evocation resolved');
  h.state.players[D]!.bin.push('Biotoxicity', 'Twin Flame');   // a deploy spell, a battle spell
  const bin = h.state.players[D]!.bin;
  const bi = bin.lastIndexOf('Biotoxicity'), ti = bin.lastIndexOf('Twin Flame');
  while (h.state.priority !== D && h.state.battle) pass(h);
  const legal = h.legal(D);
  assert.ok(legal.some(a => a.type === 'playFromBin' && a.binIndex === ti), 'the control: a battle spell is offered from the bin');
  assert.ok(!legal.some(a => a.type === 'playFromBin' && a.binIndex === bi), 'the deploy-timing spell is not');
  assert.throws(() => h.do({ type: 'playFromBin', seat: D, binIndex: bi }), IllegalAction);
});

test('cr:effects.casting.other-zones.timing — a battle-timing unit (Trench Stalker) is not playable from the bin in deployment', () => {
  const h = new Harness(71433);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 3);
  giveResources(h, P, 'water', 3);
  give(h, P, FILLER); give(h, P, FILLER); give(h, P, FILLER);
  h.state.players[P]!.bin = ['Trench Stalker'];
  assert.equal(h.legal(P).some(a => a.type === 'playFromBin'), false, 'deployment: no bin play offered for a battle-timing card');
  assert.equal(refused(h, { type: 'playFromBin', seat: P, binIndex: 0 }), true, 'deployment: the reducer refuses it');
});

/* ── playing from other zones: the cache widens like the hand ───────────── */

test('cr:effects.casting.other-zones.cache-widening — a glimpsed Virus in the cache augments onto a unit in a battle window', () => {
  const { h, D, atk } = battlePriority(71437);
  h.q.deckOf(D).unshift("Möbius's Corruption");
  withE(h, e => { e.glimpse(D, 1); });
  const opt = h.legal(D).find(a => a.type === 'augment' && a.from === 'cache' && a.hostId === atk);
  assert.ok(opt, 'offered onto the enemy unit in the battle');
  h.do(opt!);
  pass(h); pass(h);
  assert.ok(h.state.entities[atk]!.mods.some(m => h.state.entities[m]?.card === "Möbius's Corruption"),
    'the Virus is on the attacking unit');
});

/* ── spell tokens: Burst ────────────────────────────────────────────────── */

test('cr:effects.casting.spell-tokens.burst — both battle-region Fireballs are cast together and one in another region is not', () => {
  const h = new Harness(71423);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  const e = new E(h.state);
  const far = e.homeRegion(A);
  assert.notEqual(far, region, 'fixture: a second region');
  const t1 = e.createSpellToken(D, 'Fireball', 1, region);
  e.createSpellToken(D, 'Fireball', 1, region);
  const away = e.createSpellToken(D, 'Fireball', 1, far);
  h.state = e.s;
  pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: t1.id });
  while (h.state.decision) pick(h, { player: A });
  assert.equal(h.state.stack.filter(i => i.card === 'Fireball').length, 2, 'both battle-region Fireballs went on, as separate spells');
  assert.ok(ent(h, away.id), 'the Fireball in the other region is still in play, not cast');
  finishBattle(h);
});

/* ── fizzling: some targets lost ────────────────────────────────────────── */

test('cr:effects.resolution.fizzle.partial — Twin Flame with one of two targets gone still damages the other', () => {
  const h = new Harness(71433);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Unit Token');
  const w1 = spawn(h, D, 'Good Whale');
  const w2 = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: w1 });
  if (h.state.decision) pick(h, { unit: w2 });
  while (h.state.decision) pick(h, h.state.decision.options[0]!.value);
  withE(h, e => e.destroy(e.s.entities[w1]!, 'dies'));
  pass(h); pass(h);
  assert.equal(ent(h, w2)!.damage, 2, 'the remaining target received its 2 damage');
  finishBattle(h);
});

test('cr:effects.resolution.fizzle.partial — a graft composite with two targets losing one still runs its untargeted part', () => {
  const h = new Harness(71434);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const mush = spawn(h, A, 'Spewing Mushroom');
  const victim = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'wood', 8);
  giveResources(h, A, 'metal', 8);
  give(h, A, 'Biotoxicity');
  h.do({ type: 'graft', seat: A, from: 'hand', index: handIdx(h, A, 'Biotoxicity'), hostId: mush, position: 0 });
  give(h, A, 'Technological Superiority');
  h.do({ type: 'graft', seat: A, from: 'hand', index: handIdx(h, A, 'Technological Superiority'), hostId: mush, position: 0 });
  give(h, A, 'Technological Superiority');
  h.do({ type: 'graft', seat: A, from: 'hand', index: handIdx(h, A, 'Technological Superiority'), hostId: mush, position: 0 });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mush]] });
  const picks = [{ unit: mush }, { unit: victim }];
  let k = 0;
  while (h.state.decision && h.state.decision.kind === 'targets' && k < 2) pick(h, picks[k++]);
  while (h.state.decision) pick(h, h.state.decision.options[0]!.value);
  assert.equal(k, 2, 'two targeted grafts declared two targets');
  withE(h, e => e.destroy(e.s.entities[victim]!, 'dies'));
  for (let i = 0; i < 3 && h.state.stack.length; i++) { pass(h); pass(h); }
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Poison').length, 4,
    'one target lost, one left: the untargeted three Poison 1 and the printed Poison X still happen');
});

test('cr:effects.resolution.fizzle.partial — an item that loses one of two targets still runs its untargeted part, and one that loses both does not', () => {
  const run = (killBoth: boolean): number => {
    const h = new Harness(killBoth ? 71425 : 71424);
    toDeployment(h);
    const A = h.state.initiative as Seat, D = other(A);
    const u1 = vanilla(h, D, 1, 5);
    const u2 = vanilla(h, D, 1, 5);
    const u3 = vanilla(h, D, 1, 5);
    const e = new E(h.state);
    e.addCounters(e.entity(u3)!, 2);
    e.destroy(e.entity(u1)!, 'dies');
    if (killBoth) e.destroy(e.entity(u2)!, 'dies');
    e.settle();
    e.resolveItem({
      id: 9101, kind: 'triggered', label: 'probe composite', controller: A,
      region: e.homeRegion(D), negated: false, x: 1,
      parts: [
        { effectKey: 'spell:Poison', targets: [{ unit: u1 }] },
        { effectKey: 'spell:Poison', targets: [{ unit: u2 }] },
        { effectKey: 'spell:Burn the Blight', targets: [] },
      ],
    } as never);
    return e.entity(u3)!.counters;
  };
  assert.equal(run(true), 2, 'control: both targets lost, the whole item fizzles and the untargeted part keeps the counters');
  assert.equal(run(false), 0, 'one target left: the untargeted remove-all-counters part still runs');
});

/* ── fizzling: an effect that needs both of its targets ─────────────────── */

test('cr:effects.resolution.fizzle.pair — Fight that loses one target does not fizzle, does nothing to the survivor, and goes to the bin', () => {
  const h = new Harness(71431);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const mine = spawn(h, A, 'Good Whale');
  const theirs = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  withE(h, e => e.destroy(e.s.entities[theirs]!, 'dies'));
  const before = h.log.length;
  pass(h); pass(h);
  const tail = h.log.slice(before);
  assert.ok(!h.state.stack.some(i => i.card === 'Fight'), 'Fight has left the stack');
  assert.equal(ent(h, mine)!.damage, 0, 'the remaining target is not acted on');
  assert.ok(!tail.some(l => /Fight.*fizzle/i.test(l)), `it did not fizzle: ${tail.join(' | ')}`);
  assert.ok(tail.some(l => /no fight/.test(l)), 'it resolved and did nothing');
  assert.ok(h.state.players[A]!.bin.includes('Fight'), 'Fight is in the bin');
  finishBattle(h);
});

test('cr:effects.resolution.fizzle.pair — Organic Exchange that loses one target exchanges nothing', () => {
  const h = new Harness(71432);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const mine = spawn(h, A, 'Good Whale');
  const theirs = spawn(h, D, 'Good Whale');
  const third = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'wood', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Organic Exchange') });
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  while (h.state.decision) pick(h, h.state.decision.options[0]!.value);
  withE(h, e => e.destroy(e.s.entities[theirs]!, 'dies'));
  pass(h); pass(h);
  assert.ok(!h.state.stack.some(i => i.card === 'Organic Exchange'), 'Organic Exchange has left the stack');
  assert.equal(ent(h, mine)!.controller, A, 'the survivor stays with its controller');
  assert.equal(ent(h, third)!.controller, D, 'no other unit changes hands');
  finishBattle(h);
});

/* ── where a resolved, fizzled or negated spell goes ────────────────────── */

test('cr:effects.resolution.destination.unstable — a spell played from the bin under Abyssal Evocation that fizzles is erased, not binned', () => {
  const h = new Harness(71422);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const victim = vanilla(h, D, 1, 30);
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin = ['Luminous Arc'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);
  if (h.state.priority !== A) pass(h);
  const bi = h.state.players[A]!.bin.indexOf('Luminous Arc');
  h.do({ type: 'playFromBin', seat: A, binIndex: bi });
  if (h.state.decision) pick(h, { unit: victim });
  assert.ok(h.state.stack.some(i => i.card === 'Luminous Arc'), 'the Arc is on the stack');
  withE(h, e => { e.destroy(e.s.entities[victim]!, 'dies'); });
  pass(h); pass(h);
  assert.ok(h.log.some(l => /fizzles/.test(l)), 'the Arc fizzled');
  assert.equal(h.state.players[A]!.bin.includes('Luminous Arc'), false, 'not in the bin');
  assert.equal(new E(h.state).erased(A).includes('Luminous Arc'), true, 'erased instead');
  finishBattle(h);
});

/* ── helpers for the tests below ──────────────────────────────────────── */

/** answer every pending decision with its first option */
function answerAll(h: Harness): void {
  for (let g = 0; g < 20 && h.state.decision; g++) pick(h, h.state.decision.options[0]!.value);
}

const seen = (h: Harness, type: EventType): number => h.events.filter(e => e.type === type).length;
const playedCards = (h: Harness, from = 0): unknown[] =>
  h.events.slice(from).filter(e => e.type === 'cardPlayed').map(e => e.data?.['card']);

/** A battle with one vanilla attacker declared: the initiative player A
 *  attacks and holds priority in the attack window; nobody has acted yet. */
function attackWindow(seed: number) {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, FILLER);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.decision, null, 'fixture: a vanilla attacker asks nothing');
  assert.equal(h.state.priority, A, 'fixture: the initiative player holds priority');
  return { h, A, D, atk };
}

/* ── interaction goes through the stack ───────────────────────────────── */

test('cr:effects.general.interaction — a spell, a battle unit, a virus and an activated ability played in battle all go on the stack', () => {
  const { h, A, D, atk } = attackWindow(71501);
  const evoker = spawn(h, D, 'Omniwield Evoker');
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'metal', 4);
  giveResources(h, A, 'dark', 1);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: evoker });
  assert.deepEqual(h.state.stack.map(i => i.kind), ['spell'], 'the spell is on the stack');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Monke') });
  assert.deepEqual(h.state.stack.map(i => i.kind), ['spell', 'unit'], 'the battle unit went on above it');
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Gzxyclop'), hostId: atk });
  assert.equal(h.state.stack.at(-1)!.kind, 'virus', 'the virus went on above that');
  const ab = h.legal(D).find(a => a.type === 'activateAbility' && a.entityId === evoker);
  assert.ok(ab, 'the activated ability is offered');
  h.do(ab!);
  answerAll(h);
  assert.equal(h.state.stack.at(-1)!.kind, 'activated', 'and the activation went on top');
  assert.equal(h.state.stack.length, 4);
});

/* ── playing, applying, putting into play ─────────────────────────────── */

test('cr:effects.playing.what-is-played — a unit and a spell played from hand and a unit played from the bin are plays; a virus applied is not', () => {
  const { h, A, D, atk } = attackWindow(71502);
  giveResources(h, A, 'light', 2);
  giveResources(h, A, 'dark', 1);
  giveResources(h, D, 'metal', 1);
  giveResources(h, D, 'water', 4);
  giveResources(h, D, 'dark', 5);
  const m0 = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: D });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Monke') });
  assert.deepEqual(playedCards(h, m0), ['Godray', 'Monke'], 'a spell and a unit from hand are played');
  const m1 = h.events.length;
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Gzxyclop'), hostId: atk });
  assert.deepEqual(playedCards(h, m1), [], 'applying a virus is not playing a card');
  // drain, then a bin play
  while (h.state.stack.length) pass(h);
  h.state.players[D]!.bin.push('Trench Stalker');
  give(h, D, 'Jelly'); give(h, D, 'Jelly');
  while (h.state.priority !== D) pass(h);
  const offer = h.legal(D).find(a => a.type === 'playFromBin');
  assert.ok(offer, 'the bin play is offered');
  const m2 = h.events.length;
  h.do(offer!);
  while (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.deepEqual(playedCards(h, m2), ['Trench Stalker'], 'a unit played from the bin is played too');
});

test('cr:effects.playing.applying — a graft from hand and a virus from the cache are applied, never played', () => {
  const h = new Harness(71503);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Spewing Mushroom');
  giveResources(h, P, 'wood', 4);
  giveResources(h, P, 'dark', 4);
  const m0 = h.events.length;
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Biotoxicity'), hostId: host, position: 0 });
  answerAll(h);
  assert.ok(h.state.entities[host]!.mods.length >= 1, 'the graft is on the host');
  assert.deepEqual(playedCards(h, m0), [], 'no card was played');
  // a virus from the cache
  h.q.deckOf(P).unshift('Gzxyclop');
  withE(h, e => { e.glimpse(P, 1); });
  const ci = h.state.players[P]!.cache!.length - 1;
  const opt = h.legal(P).find(a => a.type === 'augment' && a.from === 'cache' && a.index === ci);
  assert.ok(opt, 'the cached virus can be applied');
  const m1 = h.events.length;
  h.do(opt!);
  answerAll(h);
  while (h.state.stack.length && h.state.priority !== null) pass(h);
  assert.ok(Object.values(h.state.entities).some(x => x.mods.some(m => h.state.entities[m]?.card === 'Gzxyclop')),
    'the virus is applied');
  assert.deepEqual(playedCards(h, m1), [], 'applying from the cache is not a play either');
});

test('cr:effects.playing.put-into-play — a unit put into play by Covenant of the Damned is not played', () => {
  const h = new Harness(71504);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('Curio Drifter');
  giveResources(h, P, 'light', 2);
  giveResources(h, P, 'dark', 2);
  const m0 = h.events.length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Covenant of the Damned') });
  answerAll(h);
  while (h.state.stack.length && h.state.priority !== null) pass(h);
  assert.ok(unitsOf(h, P).some(u => u.card === 'Curio Drifter'), 'the unit is in play');
  assert.deepEqual(playedCards(h, m0), ['Covenant of the Damned'], 'only the Covenant was played; the unit was put into play');
});

test('cr:effects.playing.put-into-play — a unit Wake the Dead plays counts as played', () => {
  const h = new Harness(71505);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Curio Drifter');
  giveResources(h, A, 'dark', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  const m0 = h.events.length;
  pass(h); pass(h);
  let g = 0;
  while (h.state.decision && g++ < 5) {
    const dec = h.state.decision;
    const i = dec.options.findIndex(o => o.card === 'Curio Drifter' || /Curio/.test(o.label));
    h.do({ type: 'decide', seat: dec.seat, choice: i >= 0 ? i : dec.options.length - 1 });
  }
  assert.ok(unitsOf(h, A).some(u => u.card === 'Curio Drifter'), 'the unit is in play');
  assert.deepEqual(playedCards(h, m0), ['Curio Drifter'], 'it was played');
});

test('cr:effects.playing.put-into-play.spell-unit — Lonely Forager put into play from the bin by Covenant of the Damned draws no card', () => {
  const h = new Harness(71506);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.bin.push('Lonely Forager');
  giveResources(h, P, 'light', 2);
  giveResources(h, P, 'dark', 2);
  const hand0 = h.state.players[P]!.hand.length;
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Covenant of the Damned') });
  answerAll(h);
  assert.ok(unitsOf(h, P).some(u => u.card === 'Lonely Forager'), 'the spell unit is in play');
  assert.equal(h.state.players[P]!.hand.length, hand0, 'no card was drawn: its spell did not happen');
});

/* ── what a play requires, and the order it is declared in ───────────── */

test('cr:effects.casting.requirements — Arc Lightning is not playable without its affinity, nor without its mana, and is with both', () => {
  const run = (fire: number, water: number) => {
    const { h, A } = attackWindow(71510 + fire * 10 + water);
    giveResources(h, A, 'fire', fire);
    giveResources(h, A, 'water', water);
    const hi = give(h, A, 'Arc Lightning');
    const offered = h.legal(A).some(a => a.type === 'playCard' && a.handIndex === hi);
    return { offered, refused: refused(h, { type: 'playCard', seat: A, handIndex: hi }) };
  };
  assert.deepEqual(run(0, 4), { offered: false, refused: true }, 'four mana but no fire affinity');
  assert.deepEqual(run(2, 0), { offered: false, refused: true }, 'the affinity but only two mana');
  assert.deepEqual(run(2, 2), { offered: true, refused: false }, 'both met');
});

test('cr:effects.casting.requirements — the target of Arc Lightning is selected as it is played, before it is on the stack', () => {
  const { h, A, D } = attackWindow(71511);
  const u = spawn(h, D, FILLER);
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  assert.equal(h.state.decision?.kind, 'targets', 'a target is asked for');
  assert.equal(h.state.stack.length, 0, 'nothing is on the stack yet');
  pick(h, { unit: u });
  assert.deepEqual(h.state.stack[0]!.parts[0]!.targets, [{ unit: u }], 'the play carries its chosen target onto the stack');
});

test('cr:effects.casting.requirements — Sacrificial Burst cannot be played by a player with no unit to pay its bracketed sacrifice', () => {
  const run = (withUnit: boolean) => {
    const { h, D } = attackWindow(withUnit ? 71524 : 71525);
    if (withUnit) spawn(h, D, 'Curio Drifter');
    giveResources(h, D, 'fire', 1);
    pass(h);
    const hi = give(h, D, 'Sacrificial Burst');
    return h.legal(D).some(a => a.type === 'playCard' && a.handIndex === hi) && !refused(h, { type: 'playCard', seat: D, handIndex: hi });
  };
  assert.equal(run(false), false, 'no unit to sacrifice: not playable');
  assert.equal(run(true), true, 'control: with a unit to sacrifice it is');
});

test('cr:effects.casting.requirements.mana — playing Arc Lightning (cost 4) expends four unexpended resources', () => {
  const { h, A, D } = attackWindow(71512);
  giveResources(h, A, 'fire', 6);
  const open = () => h.state.players[A]!.resources.filter(r => r.state === 'open').length;
  const spent = () => h.state.players[A]!.resources.filter(r => r.state === 'expended').length;
  const o0 = open(), s0 = spent();
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { player: D });
  assert.equal(o0 - open(), 4, 'four fewer unexpended resources');
  assert.equal(spent() - s0, 4, 'four more expended');
});

test('cr:effects.casting.requirements.timing — a card with no timing icon is playable in deployment and not in battle', () => {
  const { h, A } = attackWindow(71513);
  giveResources(h, A, 'water', 3);
  const hi = give(h, A, 'Lonely Forager');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === hi), 'not offered in battle');
  assert.equal(refused(h, { type: 'playCard', seat: A, handIndex: hi }), true, 'refused in battle');
  const h2 = new Harness(71523);
  toDeployment(h2);
  const P = h2.state.deployPlayer!;
  giveResources(h2, P, 'water', 3);
  const hj = give(h2, P, 'Lonely Forager');
  assert.ok(h2.legal(P).some(a => a.type === 'playCard' && a.handIndex === hj), 'offered in deployment');
});

test('cr:effects.casting.procedure — while Sacrificial Burst is being declared and paid it is not on the stack and the opponent cannot act', () => {
  const { h, A, D } = attackWindow(71514);
  const fodder = spawn(h, D, 'Curio Drifter');
  giveResources(h, D, 'fire', 1);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Sacrificial Burst') });
  let asks = 0;
  while (h.state.decision) {
    asks++;
    assert.equal(h.state.stack.length, 0, 'not on the stack while being declared');
    assert.deepEqual(h.legal(A), [], 'the opponent has nothing to respond with');
    pick(h, asks === 1 ? { player: A } : { unit: fodder });
  }
  assert.equal(asks, 2, 'a target and a cost were declared');
  assert.ok(!ent(h, fodder), 'the cost is paid');
  assert.equal(h.state.stack.length, 1, 'only now is it on the stack');
  assert.equal(h.state.priority, A, 'and only now may the opponent respond');
});

test('cr:effects.casting.procedure.modular — Spellbind asks for its Modular mods as it is played, and the chosen mod rides onto the stack with it', () => {
  const { h, A } = attackWindow(71515);
  giveResources(h, A, 'dark', 4);
  give(h, A, 'Primordial Coalescence');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  assert.ok(h.state.decision?.options.some(o => o.card === 'Primordial Coalescence'), 'the mod is offered at cast');
  assert.equal(h.state.stack.length, 0, 'before the spell is on the stack');
  pick(h, { modFrom: 'hand', index: handIdx(h, A, 'Primordial Coalescence') });
  while (h.state.decision) pick(h, { doneMods: true });
  assert.deepEqual(h.state.stack[0]!.mods, [{ card: 'Primordial Coalescence', from: 'hand' }]);
});

test('cr:effects.casting.procedure.spot — Tiderunner Initiate has its formation spot chosen as it is played, and the spot rides on the stack', () => {
  const h = new Harness(71516);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  giveResources(h, A, 'water', 1);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  assert.equal(h.state.decision?.kind, 'formationSlot', 'the spot is asked at cast');
  assert.equal(h.state.stack.length, 0, 'before it is on the stack');
  pick(h, { kind: 'behind', unit: wh });
  assert.deepEqual(h.state.stack[0]!.formationSpot, { kind: 'behind', unit: wh }, 'the chosen spot is on the item');
});

test('cr:effects.casting.procedure.fixed-costs — Sacrificial Burst asks for its target before its sacrifice, and Trench Stalker for its spot before its discards', () => {
  const { h, A, D } = attackWindow(71517);
  const fodder = spawn(h, D, 'Curio Drifter');
  giveResources(h, D, 'fire', 1);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Sacrificial Burst') });
  assert.ok(h.state.decision!.options.some(o => JSON.stringify(o.value) === JSON.stringify({ player: A })), 'the target comes first');
  pick(h, { player: A });
  assert.ok(ent(h, fodder), 'nothing is sacrificed yet');
  pick(h, { unit: fodder });
  assert.ok(!ent(h, fodder), 'then the sacrifice');

  const h2 = new Harness(71518);
  toDeployment(h2);
  const B = h2.state.initiative as Seat;
  const wh = spawn(h2, B, 'Good Whale');
  toNextBattle(h2, B);
  h2.do({ type: 'declareAttack', seat: B, columns: [[wh]] });
  giveResources(h2, B, 'water', 4);
  giveResources(h2, B, 'dark', 4);
  give(h2, B, 'Jelly'); give(h2, B, 'Jelly');
  const hand0 = h2.state.players[B]!.hand.length;
  h2.do({ type: 'playCard', seat: B, handIndex: give(h2, B, 'Trench Stalker') });
  assert.equal(h2.state.decision?.kind, 'formationSlot', 'the spot first');
  assert.equal(h2.state.players[B]!.hand.length, hand0, 'nothing discarded yet');
  pick(h2, { kind: 'behind', unit: wh });
  for (let k = 0; k < 2; k++) h2.do({ type: 'decide', seat: B, choice: 0 });
  assert.equal(h2.state.players[B]!.hand.length, hand0 - 2, 'then the two discards');
});

test('cr:effects.casting.procedure.stack — once declared and paid, Arc Lightning is on the stack as a spell effect, out of the hand', () => {
  const { h, A, D } = attackWindow(71519);
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { player: D });
  assert.equal(h.state.stack.length, 1);
  const it = h.state.stack[0]!;
  assert.equal(it.kind, 'spell');
  assert.equal(it.card, 'Arc Lightning');
  assert.equal(it.controller, A);
  assert.ok(!h.state.players[A]!.hand.includes('Arc Lightning'), 'it left the hand');
});

test('cr:effects.casting.x.variable-cost — Discharge with two counters removed one at a time has X = 2 and deals 2', () => {
  const h = new Harness(71520);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const a1 = spawn(h, A, 'Unit Token');
  withE(h, e => { e.addCounters(e.entity(a1)!, 3); });
  const victim = vanilla(h, D, 1, 9);
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });
  pick(h, { counterFrom: a1 });
  assert.equal(ent(h, a1)!.counters, 2, 'one counter paid');
  pick(h, { counterFrom: a1 });
  assert.equal(ent(h, a1)!.counters, 1, 'a second paid');
  pick(h, { doneCost: true });
  pick(h, { unit: victim });
  assert.equal(h.state.stack[0]!.parts[0]!.costPaid!.x, 2, 'X is the amount paid');
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 2, 'it deals X');
});

test('cr:effects.casting.spell-tokens — a Fireball in the battle region is cast onto the stack with a target, and one in another region is not castable', () => {
  const { h, A, D } = attackWindow(71521);
  const region = h.state.battle!.region;
  let far = 0;
  withE(h, e => {
    const farRegion = e.homeRegion(A) === region ? e.homeRegion(D) : e.homeRegion(A);
    e.createSpellToken(D, 'Fireball', 3, region);
    far = e.createSpellToken(D, 'Fireball', 3, farRegion).id;
  });
  pass(h);
  assert.equal(h.state.priority, D);
  assert.ok(!h.legal(D).some(a => a.type === 'castSpellToken' && a.entityId === far), 'the far one is not offered');
  assert.equal(refused(h, { type: 'castSpellToken', seat: D, entityId: far }), true, 'and is refused');
});

test('cr:effects.casting.spell-tokens — casting a spell token asks for its target and puts it on the stack, as a spell from hand would', () => {
  const { h, A, D } = attackWindow(71522);
  const region = h.state.battle!.region;
  let tok = 0;
  withE(h, e => { tok = e.createSpellToken(D, 'Fireball', 3, region).id; });
  pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: tok });
  assert.ok(h.state.decision, 'a target is asked');
  assert.equal(h.state.stack.length, 0);
  const life = h.state.players[A]!.life;
  pick(h, { player: A });
  assert.equal(h.state.stack.length, 1, 'on the stack');
  assert.equal(h.state.priority, A, 'and answerable');
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, life - 3, 'it resolves');
});

/* ── the stack and priority ────────────────────────────────────────────── */

test('cr:effects.priority.stack.not-immediate — a cast Luminous Arc waits on the stack, its target untouched, while the other player may respond', () => {
  const { h, A, D } = attackWindow(71530);
  const u = spawn(h, D, FILLER);
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'fire', 2);
  give(h, D, 'Luminous Arc');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  assert.equal(h.state.stack.length, 1);
  assert.equal(ent(h, u)!.damage, 0, 'nothing has happened to the target');
  assert.equal(h.state.priority, D);
  assert.ok(h.legal(D).some(a => a.type === 'playCard'), 'the other player may respond');
});

test('cr:effects.priority.stack.add-while-resolving — after the top of a two-item stack resolves, a new spell goes on above the remaining item and resolves first', () => {
  const { h, A, D } = attackWindow(71531);
  const u = vanilla(h, D, 1, 30);
  giveResources(h, A, 'fire', 4);
  giveResources(h, D, 'fire', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: u });
  assert.equal(h.state.stack.length, 2);
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 1, 'the top resolved, one still waiting');
  assert.equal(ent(h, u)!.damage, 6);
  assert.equal(h.state.priority, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  assert.equal(h.state.stack.length, 2, 'a new effect went on top of the stack mid-resolution');
  assert.equal(h.state.stack[1]!.controller, A);
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 1, 'the new one resolved first');
  assert.equal(h.state.stack[0]!.controller, A, 'the original bottom item is still waiting');
  assert.equal(ent(h, u)!.damage, 12);
});

test('cr:effects.priority.priority — only the player with priority may play a card', () => {
  const { h, A, D } = attackWindow(71532);
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'fire', 2);
  const ha = give(h, A, 'Luminous Arc');
  const hd = give(h, D, 'Luminous Arc');
  assert.equal(h.state.priority, A);
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.handIndex === ha), 'priority: offered');
  assert.ok(!h.legal(D).some(a => a.type === 'playCard'), 'no priority: nothing offered');
  assert.equal(refused(h, { type: 'playCard', seat: D, handIndex: hd }), true, 'and refused');
  assert.equal(refused(h, { type: 'passPriority', seat: D }), true, 'even passing is refused');
});

test('cr:effects.priority.priority.pass — after an action the other player receives priority, and the item resolves only once both pass in succession', () => {
  const { h, A, D } = attackWindow(71534);
  const u = vanilla(h, D, 1, 30);
  giveResources(h, A, 'fire', 4);
  giveResources(h, D, 'fire', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  assert.equal(h.state.priority, D, 'the other player may respond');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: u });
  assert.equal(h.state.priority, A, 'and after their response, the first player may respond again');
  pass(h);
  assert.equal(h.state.stack.length, 2, 'one pass resolves nothing');
  assert.equal(h.state.priority, D);
  pass(h);
  assert.equal(h.state.stack.length, 1, 'two passes in succession resolve the top');
});

test('cr:effects.priority.priority.no-response-to-pass — after one player passes, the other passing resolves the item with no further chance for the first', () => {
  const { h, A, D } = attackWindow(71535);
  const u = vanilla(h, D, 1, 30);
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'fire', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  h.do({ type: 'passPriority', seat: D });
  assert.equal(h.state.stack.length, 1, 'a pass is not an effect');
  h.do({ type: 'passPriority', seat: A });
  assert.equal(h.state.stack.length, 0, 'the item resolved at once');
  assert.equal(ent(h, u)!.damage, 6);
  // empty stack: initiative passes, then the other: the step moves on
  assert.equal(h.state.priority, A);
  h.do({ type: 'passPriority', seat: A });
  h.do({ type: 'passPriority', seat: D });
  assert.notEqual(h.state.battle?.step, 'attackWindow', 'the step ended; the first passer got no further chance');
});

test('cr:effects.priority.window — in an empty attack window each player receives priority in turn, initiative first, and then the step moves on', () => {
  const { h, A, D } = attackWindow(71536);
  const order: (Seat | null)[] = [h.state.priority];
  pass(h);
  order.push(h.state.priority);
  pass(h);
  assert.deepEqual(order, [A, D]);
  assert.notEqual(h.state.battle?.step, 'attackWindow');
});

test('cr:effects.priority.window.order — a new window opens with the initiative player even when the other player cast the item that just resolved', () => {
  const { h, A, D, atk } = attackWindow(71537);
  const u = atk;
  giveResources(h, D, 'fire', 2);
  assert.equal(h.state.priority, A, 'the attack window opens with the initiative player');
  pass(h);
  assert.equal(h.state.priority, D, 'priority passes to the non-initiative player');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: u });
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 0);
  assert.equal(h.state.priority, A, 'the new window starts with the initiative player again');
});

test('cr:effects.priority.window.resolve — two passes resolve the top item, a new window opens, and two passes on the empty stack end the step', () => {
  const { h, A, D } = attackWindow(71538);
  const u = vanilla(h, D, 1, 30);
  giveResources(h, A, 'fire', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  pass(h); pass(h);
  assert.equal(ent(h, u)!.damage, 6, 'the top effect resolved');
  assert.equal(h.state.battle!.step, 'attackWindow', 'still the same step');
  assert.equal(h.state.priority, A, 'a new window, from the initiative player');
  pass(h); pass(h);
  assert.notEqual(h.state.battle?.step, 'attackWindow', 'the empty-stack passes moved the game on');
});

test('cr:effects.priority.resolving — while Premonition is resolving it cannot be targeted, negated, augmented or responded to', () => {
  const { h, A, D } = attackWindow(71539);
  giveResources(h, D, 'water', 3);
  giveResources(h, A, 'wood', 2);
  giveResources(h, A, 'earth', 2);
  const hush = give(h, A, 'Hush Mush');
  const virus = give(h, A, 'Chitin Shredder');
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Premonition') });
  const waiting = h.state.stack[0]!;
  assert.ok(h.legal(A).some(a => a.type === 'augment' && (a as { hostStack?: number }).hostStack === waiting.id), 'control: while waiting, it can be augmented');
  pass(h); pass(h);
  assert.ok(h.state.resolving, 'it is resolving');
  const id = h.state.resolving!.id;
  assert.deepEqual(h.legal(A), [], 'nothing is offered to the other player');
  assert.deepEqual(new E(h.state).targetCandidates({ what: 'stackEffect', prompt: '' }, h.state.battle!.region)
    .filter(t => 'stack' in t && t.stack === id), [], 'not a legal target');
  assert.equal(refused(h, { type: 'playCard', seat: A, handIndex: hush }), true, 'a negation is refused');
  assert.equal(refused(h, { type: 'augment', seat: A, from: 'hand', index: virus, hostStack: id }), true, 'a virus is refused');
});

test('cr:effects.priority.haste-step — in the haste step nobody has priority and a haste card resolves at once with no stack', () => {
  const h = new Harness(71540);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  const p = h.state.initiative as Seat;
  giveResources(h, p, 'fire', 1);
  give(h, p, 'Molten Upheaval');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step');
  assert.equal(h.state.priority, null, 'no priority in the haste step');
  h.do({ type: 'playCard', seat: p, handIndex: handIdx(h, p, 'Molten Upheaval') });
  assert.equal(h.state.stack.length, 0, 'nothing waits on a stack');
  assert.equal(h.state.priority, null);
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Fireball').length, 1, 'it has already happened');
});

/* ── resolution, destinations and fizzling ────────────────────────────── */

test('cr:effects.resolution.order.no-window — the choice Premonition asks while resolving opens no priority window, and the item finishes as soon as it is made', () => {
  const { h, A, D } = attackWindow(71541);
  giveResources(h, D, 'water', 3);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Premonition') });
  pass(h); pass(h);
  assert.ok(h.state.decision, 'a choice mid-resolution');
  assert.deepEqual(h.legal(A), [], 'no window for the other player');
  assert.equal(refused(h, { type: 'passPriority', seat: A }), true);
  h.do({ type: 'decide', seat: D, choice: 0 });
  assert.equal(h.state.resolving ?? null, null, 'resolved without a pass');
  assert.ok(h.state.players[D]!.bin.includes('Premonition'));
});

test('cr:effects.resolution.destination — a resolved spell goes to its controller bin, and a resolved spell unit enters play', () => {
  const { h, A, D, atk } = attackWindow(71542);
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'water', 3);
  const u = vanilla(h, D, 1, 30);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  pass(h); pass(h);
  assert.ok(h.state.players[A]!.bin.includes('Luminous Arc'), 'in its controller bin');
  assert.ok(!h.state.players[D]!.bin.includes('Luminous Arc'));
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.ok(unitsOf(h, D).some(x => x.card === 'Jelly'), 'the spell unit is in play');
  assert.ok(!h.state.players[D]!.bin.includes('Jelly'), 'not in the bin');
});

test('cr:effects.resolution.destination.not-trashed — a spell that resolves into the bin and one that fizzles into it fire no trashed event', () => {
  const { h, A, D } = attackWindow(71543);
  giveResources(h, A, 'fire', 4);
  const u = vanilla(h, D, 1, 30);
  const v = vanilla(h, D, 1, 30);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: u });
  pass(h); pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: v });
  withE(h, e => e.destroy(e.s.entities[v]!, 'dies'));
  const t1 = h.events.filter(e => e.type === 'trashed').length;
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Luminous Arc').length, 2, 'both are in the bin');
  assert.equal(seen(h, 'trashed') - t1, 0, 'the fizzle trashed nothing');
  assert.ok(!h.events.filter(e => e.type === 'trashed').some(e => e.data?.['card'] === 'Luminous Arc'), 'no Arc was ever trashed');
});

test('cr:effects.resolution.fizzle — Arc Lightning whose only target died fizzles, does nothing, and goes to the bin', () => {
  const { h, A, D } = attackWindow(71546);
  giveResources(h, A, 'fire', 4);
  const u = vanilla(h, D, 1, 30);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { unit: u });
  withE(h, e => e.destroy(e.s.entities[u]!, 'dies'));
  const dmg0 = seen(h, 'damage');
  pass(h); pass(h);
  assert.ok(h.events.some(e => e.type === 'fizzled'), 'it fizzled');
  assert.equal(seen(h, 'damage') - dmg0, 0, 'no damage was dealt');
  assert.equal(h.state.players[D]!.life, lifeD);
  assert.ok(h.state.players[A]!.bin.includes('Arc Lightning'), 'in the bin');
});

test('cr:effects.resolution.fizzle.ambush — Lurking Slimebeast whose ambush target died fizzles and goes to the bin', () => {
  const h = new Harness(71547);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const raider = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: raider });
  assert.equal(h.state.stack[0]!.kind, 'ambush');
  withE(h, e => e.destroy(e.s.entities[raider]!, 'dies'));
  pass(h); pass(h);
  assert.ok(h.events.some(e => e.type === 'fizzled'), 'it fizzled');
  assert.ok(!Object.values(h.state.entities).some(x => x.card === 'Lurking Slimebeast'), 'never spawned');
  assert.ok(h.state.players[A]!.bin.includes('Lurking Slimebeast'), 'in the bin');
});

test('cr:effects.resolution.fizzle.virus — a virus whose host died before it resolved goes to the bin and is not offered as a virus again', () => {
  const { h, A, D, atk } = attackWindow(71548);
  giveResources(h, D, 'dark', 3);
  pass(h);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Gzxyclop'), hostId: atk });
  assert.equal(h.state.stack[0]!.kind, 'virus');
  withE(h, e => e.destroy(e.s.entities[atk]!, 'dies'));
  pass(h); pass(h);
  assert.ok(h.state.players[D]!.bin.includes('Gzxyclop'), 'in the bin');
  spawn(h, A, FILLER);
  while (h.state.priority !== D && h.state.priority !== null) pass(h);
  assert.ok(!h.legal(D).some(a => a.type === 'augment'), 'no augment from the bin is offered');
});
