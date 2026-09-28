/* R305 — spell tokens ARE played: taxed and counted.
 *
 * The owner, 2026-09-28, asked "Should casting a spell token count as playing
 * a spell?", chose *"Yes, taxed + counted."* That overturns R59's carve-out
 * ("a spell token is cast from play, not played"). The report that asked it
 * was playtest #174, room UYRX: The Silent was in play, Reconfigure had been
 * played, and a Crystal 4 was then cast for nothing.
 *
 * Two halves, both driven through real casts here:
 *  · TAXED — `doCastSpellToken` prices every token with `E.manaToPlay`, pays
 *    the sum for a {Burst} group, and refuses (and never offers) a cast the
 *    seat cannot pay.
 *  · COUNTED — a token cast bumps the token-inclusive `spellsPlayedAny:`
 *    ledger, and The Silent reads that one now.
 *
 * And the line R305 did NOT move: a token is still not a CARD (R133). Every
 * modifier whose printed noun is "card(s)" — Arbiter of Armistice, Vengeance,
 * Deferral Drone's "the next card you play" — leaves a token alone.
 *
 * Seeds 33700-33799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
  withE as whiteBox,
} from './util.ts';
import type { Action, EntityId, Seat } from '../src/types.ts';

interface Table { h: Harness; A: Seat; D: Seat; raider: EntityId; region: number }

/**
 * D attacks A's region with `raider` (or a Unit Token); A — the defender — is
 * the caster. `setup` runs in A's deployment, so whatever it spawns for A and
 * every spell token it makes sits in the region the battle is fought in.
 * Returns with A holding priority and an empty stack.
 */
function battle(seed: number, setup: (h: Harness, A: Seat, D: Seat) => void, raiderName = 'Unit Token'): Table {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const raider = spawn(h, D, raiderName);
  setup(h, A, D);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // D passes → A holds priority
  assert.equal(h.state.priority, A, 'setup: A holds priority');
  return { h, A, D, raider, region: h.state.battle!.region };
}

function crystal(h: Harness, seat: Seat, size: number): EntityId {
  let id = 0;
  whiteBox(h, e => { id = e.createSpellToken(seat, 'Crystal', size, e.homeRegion(seat)).id; });
  return id;
}

const open = (h: Harness, seat: Seat): number => new E(h.state).openMana(seat);
const price = (h: Harness, seat: Seat, name: string): number => new E(h.state).manaToPlay(seat, name);
const offersCast = (h: Harness, seat: Seat, id: EntityId): boolean =>
  h.legal(seat).some((a: Action) => a.type === 'castSpellToken' && a.entityId === id);

/** A plays Godray at D's face and lets it resolve; A holds priority again after */
function playGodray(t: Table): void {
  const { h, A, D } = t;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: D });
  pass(h); pass(h);                                           // Godray resolves
  if (h.state.priority !== A) pass(h);                        // D hands priority back
  assert.equal(h.state.priority, A, 'A holds priority after Godray');
  assert.equal(h.state.stack.length, 0);
}

// ── TAXED ─────────────────────────────────────────────────────────────────

test('R305: The Silent taxes a Crystal [2] after one prior spell this battle, and the mana is spent', () => {
  // The UYRX report, on a clean board: one spell played this battle, then a
  // Crystal 4. The Silent prints "Spells cost each player [two] more to play
  // for each spell their team has previously played in this battle".
  let tok = 0;
  const t = battle(33701, (h, A) => {
    spawn(h, A, 'The Silent');
    tok = crystal(h, A, 4);
    giveResources(h, A, 'light', 6);
  });
  const { h, A, raider } = t;
  playGodray(t);
  assert.equal(price(h, A, 'Crystal'), 2, 'one prior spell → a Crystal costs [2]');
  const before = open(h, A);
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  assert.equal(before - open(h, A), 2, 'the [2] is actually paid');
  assert.ok(h.log.some(l => /pays \[2\] to cast Crystal/.test(l)), 'and the log says so');
  finishBattle(h);
});

test('R305: a Crystal cast counts as a played spell, so it raises the tax on the next spell', () => {
  let tok = 0;
  const t = battle(33702, (h, A) => {
    spawn(h, A, 'The Silent');
    tok = crystal(h, A, 1);
    giveResources(h, A, 'light', 6);
  });
  const { h, A, raider, region } = t;
  assert.equal(price(h, A, 'Crystal'), 0, 'nothing played yet — the first cast is free');
  assert.equal(price(h, A, 'Godray'), 2, 'and Godray is at its printed [2]');
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  const e = new E(h.state);
  assert.equal(e.battleCounter(region, `spellsPlayedAny:${A}`), 1, 'the token cast is counted');
  assert.equal(e.battleCounter(region, `spellsPlayed:${A}`), 0,
    'the NONTOKEN ledger (Animated Spark) is untouched');
  assert.equal(e.manaToPlay(A, 'Godray'), 2 + 2, 'Godray now pays [2] for the Crystal played before it');
  finishBattle(h);
});

test('R305: an unaffordable token cast is not offered, and is refused if forced', () => {
  let tok = 0;
  const t = battle(33703, (h, A) => {
    spawn(h, A, 'The Silent');
    tok = crystal(h, A, 4);
    giveResources(h, A, 'light', 2);                          // exactly Godray's [2]
  });
  const { h, A } = t;
  playGodray(t);
  assert.equal(open(h, A), 0, 'Godray took every open mana');
  assert.equal(price(h, A, 'Crystal'), 2);
  assert.ok(!offersCast(h, A, tok), 'a Crystal A cannot pay for is not in legalActions');
  const snapshot = JSON.stringify(h.state);
  assert.throws(() => h.do({ type: 'castSpellToken', seat: A, entityId: tok }), /cannot pay/);
  assert.equal(JSON.stringify(h.state), snapshot, 'the refusal changes nothing');
  assert.ok(ent(h, tok), 'the token is still in play');
  finishBattle(h);
});

test('R305: a Burst group is priced at one instant and pays the sum', () => {
  let a = 0, b = 0;
  const t = battle(33704, (h, A) => {
    spawn(h, A, 'The Silent');
    a = crystal(h, A, 4);
    b = crystal(h, A, 1);
    giveResources(h, A, 'light', 5);                          // Godray 2 + 3 left
  });
  const { h, A, raider } = t;
  playGodray(t);
  // each Crystal costs [2] (one prior spell), so the pair costs [4] — not
  // [2] + [4], which is what pricing the second after the first commits
  // would charge
  assert.equal(open(h, A), 3);
  assert.ok(!offersCast(h, A, a) && !offersCast(h, A, b),
    '[3] open pays for one Crystal but not the group, and Burst casts the group');
  giveResources(h, A, 'light', 1);
  assert.ok(offersCast(h, A, a) && offersCast(h, A, b), '[4] open pays for the group');
  const before = open(h, A);
  h.do({ type: 'castSpellToken', seat: A, entityId: a });
  pick(h, { unit: raider });
  pick(h, { unit: raider });
  assert.equal(before - open(h, A), 4, 'two Crystals at [2] each: [4]');
  assert.ok(!ent(h, a) && !ent(h, b), 'both were cast');
  finishBattle(h);
});

test('R305: Tranquility taxes a spell token [1] in battle', () => {
  let tok = 0;
  const t = battle(33705, (h, A) => {
    spawn(h, A, 'Tranquility');
    tok = crystal(h, A, 2);
  });
  const { h, A, raider } = t;
  assert.equal(price(h, A, 'Crystal'), 1, '"Spells cost [one] more to play during battle"');
  assert.equal(open(h, A), 0);
  assert.ok(!offersCast(h, A, tok), 'no mana, no cast');
  giveResources(h, A, 'earth', 1);
  assert.ok(offersCast(h, A, tok));
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  assert.equal(open(h, A), 0, 'the [1] was paid');
  finishBattle(h);
});

test('R305: Stasis Sentry prints Spells, so a token (base cost 0) costs [3] in battle', () => {
  // "Spells with base cost [three] or less have a base cost of [three] to play
  // during battle." A token's base cost is its printed [0]; the 4 in
  // "Crystal 4" is its size, not a cost.
  const t = battle(33706, (h, A) => {
    spawn(h, A, 'Stasis Sentry');
    crystal(h, A, 4);
  });
  assert.equal(price(t.h, t.A, 'Crystal'), 3);
  finishBattle(t.h);
});

// ── NOT A CARD ────────────────────────────────────────────────────────────

test('R305: Arbiter of Armistice prints Cards, so a token cast pays no life', () => {
  let tok = 0;
  const t = battle(33710, (h, A) => {
    spawn(h, A, 'Arbiter of Armistice');
    tok = crystal(h, A, 1);
    giveResources(h, A, 'light', 2);
  });
  const { h, A, raider } = t;
  const e = new E(h.state);
  assert.equal(e.lifeToPlay(A, 'Godray'), 2, 'control: a spell CARD pays the 2 life');
  assert.equal(e.lifeToPlay(A, 'Crystal'), 0, 'a token is not a card');
  const life = h.state.players[A]!.life;
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  assert.equal(h.state.players[A]!.life, life, 'no life paid for the token');
  finishBattle(h);
});

test('R305: Vengeance prints Cards, so a token cast imposes no sacrifice', () => {
  // D attacks WITH Vengeance, so it stands in the battle region and "your
  // opponents" is A.
  let tok = 0;
  const t = battle(33711, (h, A) => { tok = crystal(h, A, 1); }, 'Vengeance');
  const { h, A, raider } = t;
  const e = new E(h.state);
  assert.equal(e.unitsToPlay(A, 'Godray'), 1, 'control: a spell CARD owes a sacrifice');
  assert.equal(e.unitsToPlay(A, 'Crystal'), 0, 'a token is not a card');
  assert.ok(offersCast(h, A, tok), 'A has no unit here to sacrifice, and needs none');
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  assert.ok(!ent(h, tok), 'cast');
  finishBattle(h);
});

test('R305: Deferral Drone prints the next card, so a token neither takes nor spends the discount', () => {
  let tok = 0;
  const t = battle(33712, (h, A) => {
    spawn(h, A, 'Tranquility');
    tok = crystal(h, A, 1);
    giveResources(h, A, 'earth', 1);
  });
  const { h, A, raider } = t;
  whiteBox(h, e => e.grantNextPlayDiscount(A, 3));
  assert.equal(price(h, A, 'Crystal'), 1, 'Tranquility [1], and no discount for a token');
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { unit: raider });
  assert.equal(h.state.nextPlayDiscount?.[A], 3, 'the charge is still waiting for a CARD');
  finishBattle(h);
});
