/* R129 — two events that the engine already knew about and never dispatched.
 * Both halves have the same shape: a card's trigger could not hear something
 * the engine had already written into the log.
 *
 *  (a) 'tokenCreated' was LOGGED by `createSpellToken` and never fired, so
 *      Mycelial Mentor's "when you create a token" heard unit tokens (through
 *      'spawned') and never heard a Poison / Crystal / Fireball. Spell tokens
 *      are still tokens (owner, 2026-08-24), and the set proves it itself —
 *      Cosmic Conspirator prints "a Robot, Poison, Crystal or Fireball".
 *      The risk in this half is the OTHER listener: The World Shepherd prints
 *      "whenever a UNIT token is created" and must NOT start firing on spell
 *      tokens. Both directions are pinned below.
 *
 *  (b) `commitItem` fired 'spellPlayed' for spell / spell unit / spell token
 *      only, so a {Battle}-timing UNIT and an AMBUSH reached the stack with no
 *      play event at all — half the noun Void Mandible prints ("when a
 *      nontoken CARD is played during battle"). 'cardPlayed' fires now, and
 *      it fires ALONGSIDE 'spellPlayed' rather than replacing it, so no
 *      existing "when you play a spell" listener changed meaning. R37 still
 *      holds in both events: applying a mod is not playing a card.
 *
 * Seeds are 11900-11999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { CARD_PLAY_KINDS } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';
import type { EventType, Seat, StackItem } from '../src/types.ts';

/** run raw engine calls against the harness state, absorbing a suspension
 * (the 40-light-c / 30-hybrids-wm-b idiom) */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

const seen = (h: Harness, type: EventType): number => h.events.filter(e => e.type === type).length;

// ── (a) a SPELL token is a token ─────────────────────────────────────────

test('Mycelial Mentor: creating a POISON fires "when you create a token"', () => {
  const h = new Harness(11901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mentor = spawn(h, p, 'Mycelial Mentor');              // g/1 2/1
  const ally = spawn(h, p, 'Stasis Sentry');
  const before = effStats(h, ally);
  // THE REGRESSION: this line used to write a 'tokenCreated' log entry that
  // nothing was listening to, and the Mentor sat there doing nothing.
  whiteBox(h, e => { e.createSpellToken(p, 'Poison', 1, e.homeRegion(p)); });
  if (h.state.decision) pick(h, { unit: ally });
  assert.deepEqual(effStats(h, ally), [before[0] + 3, before[1] + 3],
    'the Mentor triggered off a spell token and pumped the target ally');
  assert.ok(ent(h, mentor), 'and the Mentor itself is untouched');
});

test('Mycelial Mentor: a FIREBALL is a token too — the name is not the point', () => {
  const h = new Harness(11902);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Mycelial Mentor');
  const ally = spawn(h, p, 'Stasis Sentry');
  const before = effStats(h, ally);
  whiteBox(h, e => { e.createSpellToken(p, 'Fireball', 2, e.homeRegion(p)); });
  if (h.state.decision) pick(h, { unit: ally });
  assert.deepEqual(effStats(h, ally), [before[0] + 3, before[1] + 3],
    '"a token" carries no qualifier, so every spell token is one');
});

test('Mycelial Mentor: a UNIT token still fires it (the half that already worked)', () => {
  const h = new Harness(11903);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Mycelial Mentor');
  const ally = spawn(h, p, 'Stasis Sentry');
  const before = effStats(h, ally);
  whiteBox(h, e => { e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true }); });
  if (h.state.decision) pick(h, { unit: ally });
  assert.deepEqual(effStats(h, ally), [before[0] + 3, before[1] + 3],
    'the "spawned" half is untouched by the fix');
});

test('Mycelial Mentor: a NONTOKEN spawn still fires nothing', () => {
  const h = new Harness(11904);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Mycelial Mentor');
  const ally = spawn(h, p, 'Stasis Sentry');
  const before = effStats(h, ally);
  spawn(h, p, 'Stasis Sentry');
  assert.ok(!h.state.decision, 'nothing to target — nothing triggered');
  assert.deepEqual(effStats(h, ally), before, 'a plain unit is not a token');
});

test('The World Shepherd: a SPELL token is not a UNIT token — it must not fire', () => {
  // The whole risk of half (a): 'tokenCreated' is dispatched now, so a
  // listener that means "unit token" has to say so. This one does, in the
  // printed word and in three independent ways in the code — and all three
  // are pinned here, because any ONE of them is what stops a Poison from
  // taxing the Shepherd and being handed a +1/+1 it has nowhere to put.
  const h = new Harness(11905);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const shep = spawn(h, p, 'The World Shepherd');             // 2/3, own [Augment] live
  let poison = 0;
  whiteBox(h, e => { poison = e.createSpellToken(p, 'Poison', 1, e.homeRegion(p)).id; });
  whiteBox(h, e => { e.createSpellToken(p, 'Crystal', 2, e.homeRegion(p)); });
  assert.ok(!h.state.decision, 'no trigger was queued at all');
  assert.equal(ent(h, shep)!.counters, 0,
    'the Shepherd did NOT tax itself: "a unit token" excludes a Poison and a Crystal, '
    + 'and the +1/+1 half of the same sentence has nothing to land on');
  // guard 1 — the EVENT: the Shepherd listens to 'spawned', which a spell
  // token does not fire.
  assert.deepEqual(h.events.filter(e => e.type === 'spawned'), [],
    'creating a spell token is not a spawn — the event the Shepherd listens to never fired');
  // guard 2 — the PAYLOAD: 'tokenCreated' carries `id`, never `unit`. Every
  // unit-token listener in the pool reads `data.unit`, so this key is what
  // keeps the widened event out of their reach.
  const created = h.events.filter(e => e.type === 'tokenCreated');
  assert.equal(created.length, 2, 'the Poison and the Crystal each fired one');
  for (const e of created) {
    assert.equal(e.data?.['unit'], undefined, "a spell token is not a unit — no 'unit' key");
    assert.equal(typeof e.data?.['id'], 'number', 'it identifies itself as `id`');
  }
  // guard 3 — the ENTITY: a spell token is `kind: 'spellToken'` and carries no
  // `token` flag, so `!!u.token` is false even if a listener does find it.
  assert.equal(ent(h, poison)!.kind, 'spellToken');
  assert.ok(!ent(h, poison)!.token, 'the `token` flag belongs to unit tokens');
  // and the half it does mean still works, right beside the half it does not
  let tok = 0;
  whiteBox(h, e => { tok = e.spawnUnit(p, 'Unit Token', e.homeRegion(p), { token: true }).id; });
  assert.equal(ent(h, shep)!.counters, -1, 'a UNIT token still taxes it');
  assert.equal(ent(h, tok)!.counters, 1, 'and still gets the +1/+1');
});

// ── (b) a UNIT is a card, and so is an AMBUSH ────────────────────────────

test('Void Mandible: a {Battle} UNIT is a card played — sacrifice, then negate', () => {
  const h = new Harness(11906);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');                    // 2/1, in A's home
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'metal', 1);                            // Monke is m/[1] {Battle}
  toNextBattle(h, D);                                         // D attacks → A's home is the battle region
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  // THE REGRESSION: a unit item pushed with no play event, so this trigger
  // never existed and Monke simply resolved.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Monke') });
  assert.equal(h.state.stack.length, 2, 'Monke + the Mandible trigger above it');
  pass(h); pass(h);                                           // the trigger resolves first
  assert.ok(!ent(h, vm), 'the Mandible sacrificed itself — the cast cost (R73)');
  assert.equal(h.state.stack.length, 0, 'R68: the negated Monke left the stack at once');
  assert.ok(!h.state.players[D]!.hand.includes('Monke'), 'it was played, not returned');
  assert.deepEqual(h.state.players[D]!.bin.filter(c => c === 'Monke'), ['Monke'],
    'a negated card is binned (R68) — and never spawned');
  assert.equal(h.state.entities[raider]!.card, 'Unit Token');
  assert.ok(!Object.values(h.state.entities).some(e => e.card === 'Monke'),
    'no Monke body ever arrived');
  finishBattle(h);
});

test('Void Mandible: an AMBUSH is a card played too', () => {
  const h = new Harness(11907);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3);                            // Lurking Slimebeast ambush: [3b]
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: raider });                                  // recall target ally (R67: at cast)
  assert.equal(h.state.stack.length, 2, 'the ambush + the Mandible trigger above it');
  pass(h); pass(h);
  assert.ok(!ent(h, vm), 'the Mandible sacrificed itself');
  assert.equal(h.state.stack.length, 0, 'the negated ambush left the stack');
  assert.ok(!Object.values(h.state.entities).some(e => e.card === 'Lurking Slimebeast'),
    'the ambusher never took the slot');
  assert.ok(ent(h, raider), 'and its target was never recalled');
  finishBattle(h);
});

test('Void Mandible: a SPELL still works — "alongside", not "instead of"', () => {
  const h = new Harness(11908);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'light', 2);
  const lifeA = h.state.players[A]!.life;
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Godray') });
  pick(h, { player: A });
  assert.equal(h.state.stack.length, 2, 'Godray + the Mandible trigger above it');
  pass(h); pass(h);
  assert.ok(!ent(h, vm), 'the Mandible sacrificed itself');
  assert.equal(h.state.stack.length, 0, 'and the Godray is negated off the stack');
  assert.equal(h.state.players[A]!.life, lifeA, 'no 3 damage');
  finishBattle(h);
});

test("'cardPlayed' rides BESIDE 'spellPlayed', and only for the kinds that are cards", () => {
  const h = new Harness(11909);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'light', 2);
  giveResources(h, D, 'metal', 1);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });

  const mark = { spell: seen(h, 'spellPlayed'), card: seen(h, 'cardPlayed') };
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Godray') });
  pick(h, { player: A });
  assert.equal(seen(h, 'spellPlayed') - mark.spell, 1,
    "a SPELL still fires 'spellPlayed' exactly once — the narrow event is unchanged");
  assert.equal(seen(h, 'cardPlayed') - mark.card, 1,
    "and fires 'cardPlayed' beside it: a spell is a card");
  pass(h); pass(h);

  const mark2 = { spell: seen(h, 'spellPlayed'), card: seen(h, 'cardPlayed') };
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Monke') });
  assert.equal(seen(h, 'spellPlayed') - mark2.spell, 0, 'a UNIT is not a spell');
  assert.equal(seen(h, 'cardPlayed') - mark2.card, 1, 'but it IS a card being played');
  pass(h); pass(h);
  finishBattle(h);
});

test('a spell TOKEN is cast, not played: "spellPlayed" yes, "cardPlayed" no', () => {
  // "Tokens are NOT cards, however." — owner, 2026-08-24. R59 says the same
  // thing from the other side: a spell token is cast from play, not played.
  const h = new Harness(11910);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const raider = spawn(h, D, 'Unit Token');
  let tok = 0;
  whiteBox(h, e => { tok = e.createSpellToken(A, 'Fireball', 2, e.homeRegion(A)).id; });
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // initiative passes → A acts
  const mark = { spell: seen(h, 'spellPlayed'), card: seen(h, 'cardPlayed') };
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { player: D });                                     // R67: the token names its victim at cast
  assert.equal(seen(h, 'spellPlayed') - mark.spell, 1, 'the narrow event is unchanged (token: true)');
  assert.equal(seen(h, 'cardPlayed') - mark.card, 0, 'a token is not a card');
  finishBattle(h);
});

// ── R37: applying a mod is not playing a card ────────────────────────────

test('R37 holds: applying a VIRUS fires neither event, and Void Mandible sleeps', () => {
  const h = new Harness(11911);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');
  const raider = spawn(h, D, 'Unit Token');
  const host = spawn(h, A, 'Stasis Sentry');
  giveResources(h, D, 'dark', 1);                             // Gzxyclop is d/[1] {Virus}
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  const mark = { spell: seen(h, 'spellPlayed'), card: seen(h, 'cardPlayed'), tok: seen(h, 'tokenCreated') };
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Gzxyclop'), hostId: host });
  assert.equal(h.state.stack[0]!.kind, 'virus', 'the premise: a virus item is on the stack');
  assert.equal(seen(h, 'cardPlayed') - mark.card, 0,
    'R37: applying a mod is NOT playing a card, in the new event as well as the old');
  assert.equal(seen(h, 'spellPlayed') - mark.spell, 0, 'and it never was in the old one');
  assert.equal(seen(h, 'tokenCreated') - mark.tok, 0, 'and no token was created');
  assert.equal(h.state.stack.length, 1, 'no Mandible trigger sits above it');
  assert.ok(ent(h, vm), 'the Mandible is still alive — it was never asked to pay');
  finishBattle(h);
});

test('CARD_PLAY_KINDS is exactly the played-card half of the StackItem kinds', () => {
  // Pinned against the whole union rather than against a game that happens to
  // exercise four arms of it, so a new item kind cannot join silently.
  const all: StackItem['kind'][] =
    ['unit', 'spell', 'spellUnit', 'spellToken', 'virus', 'triggered', 'activated', 'ambush'];
  assert.deepEqual(all.filter(k => CARD_PLAY_KINDS.has(k)),
    ['unit', 'spell', 'spellUnit', 'ambush'],
    '"Everything is a card, including units. Tokens are NOT cards, however." — and a '
    + 'virus is a mod being applied (R37), while triggers and activations are not plays');
});
