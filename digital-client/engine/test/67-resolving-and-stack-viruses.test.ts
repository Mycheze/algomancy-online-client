/* R78 — an item stays visible until it has ACTUALLY resolved.
 * R79 — a Virus may be augmented onto a SPELL on the stack.
 *
 * Playtest round 13. R78: "It would make more sense if there was a different
 * state before resolution like 'Opponent is resolving [effect]' and leave the
 * effect on the stack until it's ACTUALLY resolved … Right now, having it
 * leave the stack while the player is choosing things looks wrong."
 * R79: "being able to augment viruses onto spells that are on the stack …
 * put the powerful guy onto a giant fireball you're casting to have it deal
 * double damage." Seeds 6700-6799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, IllegalAction } from '../src/engine.ts';
import { apply, createGame, legalActions } from '../src/apply.ts';
import type { Action, GameState, Seat, StackItem } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import { fuzzGame } from './fuzz.ts';

/** A live attack window in `A`'s battle: one vanilla attacker, both seats
 * holding priority in a region with units in it. */
function attackWindow(seed: number): { h: Harness; A: Seat; D: Seat; atk: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');           // 3/3, no attrs, no triggers
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.decision, null, 'a vanilla attacker asks nothing');
  return { h, A, D, atk };
}

const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const erasedOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
const count = (xs: string[], n: string): number => xs.filter(c => c === n).length;
const onStack = (h: Harness, card: string): StackItem | undefined =>
  h.state.stack.find(i => i.card === card);

/** pass priority until the stack has drained (triggers pushed by a resolution
 * go on it too, so "two more passes" is not always enough) */
function drain(h: Harness, guard = 40): void {
  while (h.state.stack.length && h.state.phase === 'battle' && guard-- > 0) {
    if (h.state.decision) throw new Error('unexpected decision while draining the stack');
    pass(h);
  }
}

/** a seeded walk of purely legal actions — no white-box state pokes, so the
 * action log alone reproduces it */
function walk(seed: number, steps: number): { state: GameState; actions: Action[] } {
  let state = createGame(seed).state;
  const actions: Action[] = [];
  let rng = seed >>> 0;
  const nextInt = (n: number): number => { rng = (rng * 1103515245 + 12345) >>> 0; return rng % n; };
  for (let i = 0; i < steps && state.phase !== 'gameover'; i++) {
    const acts = ([0, 1] as Seat[]).flatMap(s => legalActions(state, s));
    if (!acts.length) break;
    const a = acts[nextInt(acts.length)]!;
    state = apply(state, a).state;
    actions.push(a);
  }
  return { state, actions };
}

// ── R78: the resolving state ────────────────────────────────────────────

test('R78: an item that suspends mid-resolution is off the stack but flagged as RESOLVING', () => {
  const { h, A, D } = attackWindow(6700);
  giveResources(h, D, 'water', 3);                   // Premonition b/1 → Glimpse 3
  pass(h);                                           // A declines
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Premonition') });
  assert.equal(h.state.stack.length, 1, 'the spell is on the stack, waiting');
  assert.equal(h.state.resolving ?? null, null, 'nothing is resolving yet');

  pass(h); pass(h);                                  // both pass — it resolves…

  // …and stops dead in the middle of resolving, asking its controller to pick.
  assert.ok(h.state.decision, 'Glimpse 3 asks which card to cache');
  assert.equal(h.state.decision!.seat, D);
  assert.equal(h.state.stack.length, 0, 'it is no longer WAITING to resolve');
  assert.ok(h.state.resolving, 'but it is still there, resolving');
  assert.equal(h.state.resolving!.card, 'Premonition');
  assert.equal(h.state.resolving!.controller, D, 'the client reads this to say WHOSE effect');

  h.do({ type: 'decide', seat: D, choice: 0 });
  assert.equal(h.state.resolving ?? null, null, 'cleared the moment it ACTUALLY resolved');
  assert.equal(h.state.players[D]!.cache!.length, 1, 'and its effect is on the board');
});

test('R78: a resolving item cannot be responded to, negated or targeted', () => {
  const { h, A, D } = attackWindow(6701);
  giveResources(h, D, 'water', 3);
  giveResources(h, A, 'wood', 2);                    // Hush Mush gg/2, "negate target effect"
  const hush = give(h, A, 'Hush Mush');
  const virus = give(h, A, 'Chitin Shredder');
  giveResources(h, A, 'earth', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Premonition') });
  // while it is merely WAITING, it is answerable by both routes
  const waiting = onStack(h, 'Premonition')!;
  assert.ok(new E(h.state).targetCandidates({ what: 'stackEffect', prompt: '' }, h.state.battle!.region)
    .some(t => 'stack' in t && t.stack === waiting.id), 'R60: a waiting item is a legal "target effect"');
  assert.ok(legalActions(h.state, A).some(a => a.type === 'augment' && a.hostStack === waiting.id),
    'R79: and a legal virus host');

  pass(h); pass(h);                                  // now it is RESOLVING
  assert.ok(h.state.resolving);
  const id = h.state.resolving!.id;

  // 1. nothing is offered to the opponent at all — the decision owns the game
  assert.deepEqual(legalActions(h.state, A), [], 'no response window while it resolves');
  // 2. it is not a "target effect" (R60) — targetCandidates reads s.stack only
  assert.deepEqual(
    new E(h.state).targetCandidates({ what: 'stackEffect', prompt: '' }, h.state.battle!.region)
      .filter(t => 'stack' in t && t.stack === id), [], 'not a legal target');
  // 3. negate() cannot find it either — it is not on the stack to remove
  assert.equal(new E(structuredClone(h.state)).removeFromStack(id), undefined);
  // 4. and every action that is not `decide` is refused outright
  for (const bad of [
    { type: 'playCard', seat: A, handIndex: hush },
    { type: 'augment', seat: A, from: 'hand', index: virus, hostStack: id },
    { type: 'passPriority', seat: A },
  ] as Action[]) {
    assert.throws(() => h.do(bad), IllegalAction, `${bad.type} must be illegal mid-resolution`);
  }
});

test('R78: the flag survives the suspension rollback as ONE object, and the game still replays', () => {
  const { h, D } = attackWindow(6702);
  giveResources(h, D, 'water', 3);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Premonition') });
  pass(h); pass(h);
  // resolveParts rolled the whole state back to the part boundary and re-pointed
  // the marker at the live item: state must hold ONE object, not two copies.
  const sus = h.state.suspension as { type: string; item: StackItem };
  assert.equal(sus.type, 'resolve');
  assert.equal(h.state.resolving, sus.item, 'aliased — a clone here would drift on replay');
  h.do({ type: 'decide', seat: D, choice: 1 });
  assert.equal(h.state.resolving ?? null, null);
});

test('R78: replay(seed, actions) is still bit-identical', () => {
  for (const seed of [6705, 6706, 6707, 6708]) {
    const { state, actions } = walk(seed, 400);
    let st: GameState = createGame(seed).state;
    for (const a of actions) st = apply(st, a).state;
    assert.equal(JSON.stringify(st), JSON.stringify(state), `seed ${seed} diverged on replay`);
  }
});

test('R78: every exit clears it — a fizzle, and a battle played to its end', () => {
  // a spell whose only target dies before it resolves fizzles (R5) — the exit
  // that never reaches resolveParts at all
  const { h, A, D } = attackWindow(6703);
  giveResources(h, D, 'fire', 2);
  giveResources(h, A, 'fire', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: h.state.battle!.columns[0]![0]! });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });   // kill it first
  pick(h, { unit: h.state.battle!.columns[0]![0]! });
  pass(h); pass(h);                                  // A's Arc resolves, the 3/3 dies
  pass(h); pass(h);                                  // D's Arc fizzles
  assert.equal(h.state.resolving ?? null, null, 'a fizzle leaves nothing stranded');
  assert.equal(h.state.stack.length, 0);
});

test('R78: fuzzed play never strands a resolving item outside a pending decision', () => {
  // The stuck-state guard: `resolving` may be non-null ONLY while a decision
  // is open. Anything else is an item that has left the stack and will never
  // come back — this codebase has just had two of those.
  //
  // A purely random walk almost never plays the one card that suspends
  // mid-resolution, so the walk is SEEDED with a real suspension and then let
  // loose from there.
  const { h, A, D } = attackWindow(6704);
  giveResources(h, D, 'water', 3);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Premonition') });
  pass(h); pass(h);
  assert.ok(h.state.resolving, 'seeded: Premonition is mid-resolution');

  let state = h.state;
  let seen = 0;
  let rng = 6704;
  const nextInt = (n: number): number => { rng = (rng * 1103515245 + 12345) >>> 0; return rng % n; };
  for (let i = 0; i < 1500 && state.phase !== 'gameover'; i++) {
    if (state.resolving) {
      seen++;
      assert.ok(state.decision, 'a resolving item outside a decision window is a stuck state');
      assert.equal(state.phase, 'battle', 'the marker is published in battle only');
    }
    const acts = ([0, 1] as Seat[]).flatMap(s => legalActions(state, s));
    if (!acts.length) break;
    state = apply(state, acts[nextInt(acts.length)]!).state;
  }
  assert.ok(seen > 0, 'the walk never saw a mid-resolution suspension — the guard proved nothing');
  assert.equal(state.resolving ?? null, null, 'and the game did not end holding one');
});

test('R78: a NESTED resolution that suspends does not strand the outer marker (fuzz seed 693)', () => {
  // The fuzzer's find. A battle resolution ended the battle; settle() then
  // resolved a Wraith's startOfDeployment trigger INLINE, and that trigger
  // suspended on its own choice. The throw abandons the outer resolution
  // entirely, so leaving the outer item marked stranded it — in the DEPLOY
  // phase, where the marker must not be published at all (a hidden segment).
  // fuzzGame re-checks every invariant after every action, so this is the pin.
  fuzzGame(693);
});

// ── R79: viruses onto spells on the stack ───────────────────────────────

test('R79: the powerful guy on a giant fireball — Chitin Shredder doubles Arc Lightning', () => {
  const { h, A, D } = attackWindow(6710);
  giveResources(h, D, 'fire', 4);                    // Arc Lightning rr/4
  giveResources(h, D, 'earth', 2);                   // Chitin Shredder ee/2
  const before = h.state.players[A]!.life;
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  const spell = onStack(h, 'Arc Lightning')!;
  pass(h);                                           // A declines to answer
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: spell.id });
  assert.equal(h.state.stack.length, 2, 'the virus is a response: it sits ABOVE its host');
  assert.equal(h.state.stack[1]!.kind, 'virus');

  pass(h); pass(h);                                  // the virus resolves first
  assert.equal(h.state.stack.length, 1);
  assert.deepEqual(onStack(h, 'Arc Lightning')!.augments, [{ card: 'Chitin Shredder', by: D }]);

  pass(h); pass(h);                                  // the spell resolves
  assert.equal(before - h.state.players[A]!.life, 12, '6 damage, doubled by {Powerful}');
});

test('R79: you can hit an ENEMY spell, and a virus on a unit still works unchanged', () => {
  const { h, A, D } = attackWindow(6711);
  giveResources(h, D, 'fire', 4);
  giveResources(h, A, 'earth', 2);
  const before = h.state.players[A]!.life;
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  const spell = onStack(h, 'Arc Lightning')!;
  // A augments the OPPONENT's spell — legal, and a spectacularly bad idea here
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostStack: spell.id });
  pass(h); pass(h);
  pass(h); pass(h);
  assert.equal(before - h.state.players[A]!.life, 12, 'A doubled the spell aimed at A');
  // R65: each card reaches ITS OWN owner's erased pile
  assert.equal(count(erasedOf(h, D), 'Arc Lightning'), 1, "the spell is D's");
  assert.equal(count(erasedOf(h, A), 'Chitin Shredder'), 1, "the virus is A's");
  assert.equal(count(erasedOf(h, D), 'Chitin Shredder'), 0);
});

test('R79 ⚠: a spell that carried a virus is Unstable — it is ERASED, never binned', () => {
  const { h, A, D } = attackWindow(6712);
  giveResources(h, D, 'fire', 4);
  giveResources(h, D, 'earth', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  pass(h);                                           // A declines
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: onStack(h, 'Arc Lightning')!.id });
  pass(h); pass(h);
  pass(h); pass(h);
  assert.equal(count(binOf(h, D), 'Arc Lightning'), 0, 'the spell never reaches a bin');
  assert.equal(count(binOf(h, D), 'Chitin Shredder'), 0, 'nor does the virus');
  assert.deepEqual(erasedOf(h, D).slice(-2).sort(), ['Arc Lightning', 'Chitin Shredder']);
});

test('R79: negating the CARRIER erases it too; negating the VIRUS ITSELF bins it (Manual p.34)', () => {
  // 1. the virus item is negated before it ever attaches → it is binned
  const { h, A, D } = attackWindow(6713);
  giveResources(h, D, 'fire', 4);
  giveResources(h, D, 'earth', 2);
  giveResources(h, A, 'wood', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  pass(h);                                           // A declines
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: onStack(h, 'Arc Lightning')!.id });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Hush Mush') });
  pick(h, { stack: h.state.stack.find(i => i.kind === 'virus')!.id });
  pass(h); pass(h);
  assert.equal(count(binOf(h, D), 'Chitin Shredder'), 1, 'a negated virus goes to the bin');
  assert.deepEqual(onStack(h, 'Arc Lightning')!.augments ?? [], [], 'and never attached');

  // 2. the carrier is negated after the virus attached → both erased
  const g = attackWindow(6714);
  giveResources(g.h, g.D, 'fire', 4);
  giveResources(g.h, g.D, 'earth', 2);
  giveResources(g.h, g.A, 'wood', 2);
  pass(g.h);
  g.h.do({ type: 'playCard', seat: g.D, handIndex: give(g.h, g.D, 'Arc Lightning') });
  pick(g.h, { player: g.A });
  pass(g.h);                                         // A declines
  g.h.do({ type: 'augment', seat: g.D, from: 'hand', index: give(g.h, g.D, 'Chitin Shredder'), hostStack: onStack(g.h, 'Arc Lightning')!.id });
  pass(g.h); pass(g.h);                              // the virus attaches
  g.h.do({ type: 'playCard', seat: g.A, handIndex: give(g.h, g.A, 'Hush Mush') });
  pick(g.h, { stack: onStack(g.h, 'Arc Lightning')!.id });
  pass(g.h); pass(g.h);
  assert.equal(count(binOf(g.h, g.D), 'Arc Lightning'), 0, 'Unstable beats the negation bin (R69)');
  assert.deepEqual(erasedOf(g.h, g.D).slice(-2).sort(), ['Arc Lightning', 'Chitin Shredder']);
});

test('R79: a virus whose host leaves the stack first fizzles to the bin', () => {
  const { h, A, D } = attackWindow(6715);
  giveResources(h, D, 'fire', 4);
  giveResources(h, D, 'earth', 2);
  giveResources(h, A, 'wood', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  pass(h);                                           // A declines
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: onStack(h, 'Arc Lightning')!.id });
  // A's negate goes ABOVE the virus, so the host is gone before the virus runs
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Hush Mush') });
  pick(h, { stack: onStack(h, 'Arc Lightning')!.id });
  pass(h); pass(h);                                  // Hush Mush negates the host
  assert.equal(onStack(h, 'Arc Lightning'), undefined);
  assert.equal(count(binOf(h, D), 'Arc Lightning'), 1, 'a negated spell with no virus is binned (R68)');
  drain(h);                                          // the virus fizzles
  assert.equal(count(binOf(h, D), 'Chitin Shredder'), 1, 'Manual p.34: an invalid target bins the virus');
});

test('R79: only SPELLS are legal hosts — not abilities, not units mid-cast', () => {
  const { h, A, D } = attackWindow(6716);
  giveResources(h, A, 'earth', 4);
  const virus = give(h, A, 'Chitin Shredder');
  // Warbloom Herald's attack trigger puts a `triggered` item on the stack
  const g = new Harness(6717);
  toDeployment(g);
  const GA = g.state.initiative, GD = (1 - GA) as Seat;
  const herald = spawn(g, GA, 'Warbloom Herald');
  giveResources(g, GD, 'earth', 4);
  toNextBattle(g, GA);
  g.do({ type: 'declareAttack', seat: GA, columns: [[herald]] });
  const trig = g.state.stack.find(i => i.kind === 'triggered');
  assert.ok(trig, 'an attack trigger is on the stack');
  const gVirus = give(g, GD, 'Chitin Shredder');
  assert.ok(!legalActions(g.state, GD).some(a => a.type === 'augment' && a.hostStack !== undefined),
    'a triggered ability is not offered as a virus host');
  assert.throws(
    () => g.do({ type: 'augment', seat: GD, from: 'hand', index: gVirus, hostStack: trig!.id }),
    IllegalAction, 'and refused if asked for anyway');

  // a nonexistent stack id, and naming two hosts at once
  assert.throws(() => h.do({ type: 'augment', seat: A, from: 'hand', index: virus, hostStack: 99999 }), IllegalAction);
  assert.throws(() => h.do({
    type: 'augment', seat: A, from: 'hand', index: virus,
    hostId: h.state.battle!.columns[0]![0]!, hostStack: 1,
  }), IllegalAction, 'one host, not two');
});

test('R79: a spell UNIT carries its virus into play as an augment mod', () => {
  const { h, A, D } = attackWindow(6718);
  giveResources(h, D, 'wood', 2);                    // Hush Mush gg/2 — a {Battle} SPELL UNIT
  giveResources(h, D, 'earth', 2);
  giveResources(h, A, 'water', 2);
  // give Hush Mush something to negate so it does not fizzle
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Premonition') });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Hush Mush') });
  pick(h, { stack: onStack(h, 'Premonition')!.id });
  pass(h);                                           // A declines
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: onStack(h, 'Hush Mush')!.id });
  pass(h); pass(h);                                  // the virus attaches
  pass(h); pass(h);                                  // Hush Mush resolves and spawns
  const body = Object.values(h.state.entities).find(e => e.card === 'Hush Mush' && e.kind === 'unit');
  assert.ok(body, 'the spell unit arrived — it is not erased on its way into play');
  const q = new E(h.state);
  assert.ok(q.ownAttrs(body!).has('Powerful'), 'and the virus rode it in as an augment mod');
  assert.equal(count(erasedOf(h, D), 'Hush Mush'), 0);
});

test('R79: legalActions offers exactly the spells on the stack as virus hosts', () => {
  const { h, A, D } = attackWindow(6719);
  giveResources(h, D, 'fire', 4);
  giveResources(h, A, 'earth', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  const spell = onStack(h, 'Arc Lightning')!;
  const vi = give(h, A, 'Chitin Shredder');
  const offers = legalActions(h.state, A).filter(
    a => a.type === 'augment' && a.from === 'hand' && a.index === vi && a.hostStack !== undefined);
  assert.equal(offers.length, 1, 'exactly the one spell on the stack');
  assert.equal((offers[0] as { hostStack: number }).hostStack, spell.id);
  h.do(offers[0]!);
  drain(h);
  assert.equal(h.state.resolving ?? null, null);
  assert.equal(h.state.stack.length, 0);
});

test('R79: a spell TOKEN is a legal host too (Caleb 2025-03-06 names them)', () => {
  const { h, A, D } = attackWindow(6720);
  giveResources(h, D, 'earth', 2);
  // a Fireball 3 in D's hands: "{Battle} {Burst} Spell Token — Deal X damage"
  const tok = new E(h.state).createSpellToken(D, 'Fireball', 3, h.state.battle!.region);
  const before = h.state.players[A]!.life;
  pass(h);                                           // A declines
  h.do({ type: 'castSpellToken', seat: D, entityId: tok.id });
  pick(h, { player: A });
  const item = onStack(h, 'Fireball')!;
  pass(h);                                           // A declines again
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: item.id });
  pass(h); pass(h);                                  // the virus attaches
  pass(h); pass(h);                                  // the token resolves
  assert.equal(before - h.state.players[A]!.life, 6, '3 damage, doubled by {Powerful}');
  // a token has no card to bin either way (R40); the virus is erased with it
  assert.equal(count(binOf(h, D), 'Chitin Shredder'), 0);
  assert.equal(count(erasedOf(h, D), 'Chitin Shredder'), 1);
});
