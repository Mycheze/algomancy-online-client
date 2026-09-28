/**
 * R306 (owner, 2026-09-28) — TOKENS ARE NOT TRASHED.
 *
 * R133 (2026-08-24) recorded the owner saying *"Tokens are trashed, yes"*, and
 * the engine had trashed a dying token ever since R40's 2026-08-21 amendment:
 * it enters the bin, so it was trashed there, and only then swept. The owner:
 *
 *   > "that ruling was my fault. It is just false."
 *   > "Tokens are specifically not considered cards in terms of specific
 *   >  semantics of the game. A card is an actual physical card that has an
 *   >  algomancy card back only … A token dying should never count."
 *
 * So a dying token still passes THROUGH the bin and is erased there (R69 — a
 * zone fact, unchanged), but it fires no `trashed` event, bumps no `trashed` /
 * `trashed:<seat>` battle counter, and fires no "when I am trashed", its own
 * included. Its `died` event is unchanged: a token is still a unit.
 *
 * The one choke point is `E.noteTrashed`, which returns for a token anchor.
 * Every route there was walked (see its doc comment): the only one a token
 * can take is `disposeToBin`'s body trash (death, and Hooba-Mon's exchange —
 * 42-dark-b / 129-disposal-tail); the two mod loops already skip a token mod.
 *
 * The watchers and own-trash cards are DERIVED from the registry, not listed:
 * every card with a `trashed` trigger. Seeds 33800-33899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';
import { allCardNames, getCard, isTriggered } from '../src/cards/dsl.ts';
import { ent, give, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** every card with a `trashed` trigger, split by whose trash it hears */
function trashListeners(self: boolean): string[] {
  return allCardNames().filter(n => {
    const c = getCard(n);
    return [...(c.abilities ?? []), ...(c.augmentText ?? [])]
      .some(a => isTriggered(a) && a.events.includes('trashed') && !!a.self === self);
  });
}

const trashes = (h: Harness, from = 0): EngineEvent[] =>
  h.events.slice(from).filter(ev => ev.type === 'trashed');
const triggersOf = (h: Harness, card: string, from = 0): EngineEvent[] =>
  h.events.slice(from).filter(ev => ev.type === 'triggered' && ev.msg.includes(card));

/** A battle is on in A's home region: A attacks with a plain unit. */
function inBattle(seed: number): { h: Harness; A: Seat; D: Seat; region: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.phase, 'battle', 'the per-battle trash ledger only counts during a battle');
  return { h, A, D, region: ent(h, atk)!.region };
}

/** a nontoken unit of `name` for `seat`, standing in the BATTLE region (the
 * `spawn` helper puts it in the seat's home, which is not where A's attack is,
 * and the trash ledger and every watcher are region-scoped — R12/R14) */
function put(h: Harness, seat: Seat, name: string, region: number): EntityId {
  let id = -1;
  withE(h, e => { id = e.spawnUnit(seat, name, region).id; });
  return id;
}

/** spawn a token unit of `name` for `seat` in `region` and kill it */
function killToken(h: Harness, seat: Seat, region: number, name = 'Unit Token'): void {
  withE(h, e => {
    const t = e.spawnUnit(seat, name, region, { token: true });
    e.destroy(t, 'dies');
  });
}

test('R306: the derived population is the one the ruling names', () => {
  const watchers = trashListeners(false);
  const own = trashListeners(true);
  for (const n of ['Cerebrox', 'Cthyrian Culler', 'Cthyrian Rector', 'Muck Rummager',
    'Murkdrop Distiller', 'Murkstalker', 'Splort', 'Unrelenting Horror']) {
    assert.ok(watchers.includes(n), `${n} watches someone else trashing`);
  }
  for (const n of ['Afflicting Anima', 'Blightwalker', 'Dropslime', 'Maw of Despair', 'Nothyr', 'Thoughtripper']) {
    assert.ok(own.includes(n), `${n} has its own "when I am trashed"`);
  }
});

test('R306: a token unit dying in battle does not bump the trashed ledger that Dropslime reads', () => {
  const { h, A, D, region } = inBattle(33801);
  const start = h.events.length;
  let before = -1, after = -1, beforeA = -1, afterA = -1;
  withE(h, e => { before = e.battleCounter(region, 'trashed'); beforeA = e.battleCounter(region, `trashed:${A}`); });
  killToken(h, A, region);
  killToken(h, D, region);
  withE(h, e => { after = e.battleCounter(region, 'trashed'); afterA = e.battleCounter(region, `trashed:${A}`); });
  assert.equal(after, before, 'two tokens died and the battle ledger did not move');
  assert.equal(afterA, beforeA, 'nor did the per-seat one');
  assert.equal(trashes(h, start).length, 0, 'and no trashed event fired');
  // the zone fact and the death are unchanged
  const died = h.events.slice(start).filter(ev => ev.type === 'died');
  assert.equal(died.length, 2, 'both tokens DIED — a token is still a unit');
  assert.ok(died.every(ev => ev.data!['token'] === true && ev.data!['to'] === 'bin'),
    'each death says token, into the bin (R69/R70)');
  const swept = h.events.slice(start).filter(ev => ev.type === 'erased' && ev.data!['from'] === 'bin');
  assert.equal(swept.length, 2, 'and each was erased out of the bin by the sweep (R69)');
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token') && !h.state.players[D]!.bin.includes('Unit Token'),
    'no token is left in a bin');
});

test('R306: Dropslime deals damage for the CARDS trashed this battle and not for the tokens', () => {
  const { h, A, D, region } = inBattle(33802);
  const victim = put(h, D, 'Good Whale', region);      // a real card, dies below
  const target = put(h, D, 'Good Whale', region);      // takes Dropslime's damage
  killToken(h, A, region);
  killToken(h, D, region);
  killToken(h, D, region);
  withE(h, e => { e.destroy(e.entity(victim)!, 'dies'); });
  let ledger = -1;
  withE(h, e => { ledger = e.battleCounter(region, 'trashed'); });
  assert.equal(ledger, 1, 'three tokens and one card died: ONE card was trashed');
  // now Dropslime itself is trashed from hand, and its own trash counts
  give(h, A, 'Dropslime');
  const hand = h.state.players[A]!.hand;
  withE(h, e => { e.discardFromHand(A, hand.lastIndexOf('Dropslime')); });
  assert.ok(h.state.decision, 'Dropslime asks for its target');
  pick(h, { unit: target });
  for (let i = 0; i < 4 && h.state.stack.length; i++) pass(h);
  assert.equal(ent(h, target)?.damage, 2,
    'the damage is 2 — the dead card and Dropslime itself — not 5 with the three tokens');
});

test('R306: Splort, Cthyrian Culler and Muck Rummager do not fire on a token death', () => {
  const { h, A, D, region } = inBattle(33803);
  for (const n of ['Splort', 'Cthyrian Culler', 'Muck Rummager']) put(h, A, n, region);
  const lifeD = h.state.players[D]!.life;
  const handA = h.state.players[A]!.hand.length;
  const start = h.events.length;
  killToken(h, A, region);   // Muck Rummager hears only MY trash — so the token is mine
  killToken(h, D, region);
  for (const n of ['Splort', 'Cthyrian Culler', 'Muck Rummager']) {
    assert.equal(triggersOf(h, n, start).length, 0, `${n} did not trigger on a token death`);
  }
  assert.equal(h.state.decision, null, 'nothing asks for a target');
  assert.equal(h.state.stack.length, 0, 'and nothing is on the stack');
  assert.equal(h.state.players[D]!.life, lifeD, 'Culler cost nobody life');
  assert.equal(h.state.players[A]!.hand.length, handA, 'Rummager drew nothing');
});

test('R306 control: a NONTOKEN death still counts and still fires the same three watchers', () => {
  const { h, A, region } = inBattle(33804);
  for (const n of ['Splort', 'Cthyrian Culler', 'Muck Rummager']) put(h, A, n, region);
  const victim = put(h, A, 'Good Whale', region);
  const start = h.events.length;
  let before = -1, after = -1;
  withE(h, e => { before = e.battleCounter(region, 'trashed'); });
  withE(h, e => { e.destroy(e.entity(victim)!, 'dies'); });
  withE(h, e => { after = e.battleCounter(region, 'trashed'); });
  assert.equal(after - before, 1, 'a card died: the ledger counts it');
  assert.equal(trashes(h, start).length, 1, 'and it was trashed');
  for (const n of ['Splort', 'Cthyrian Culler', 'Muck Rummager']) {
    assert.equal(triggersOf(h, n, start).length, 1, `${n} triggered on the card death`);
  }
});

test('R306 whole pool: no trash watcher hears a token die, whoever controls it', () => {
  const watchers = trashListeners(false).filter(n => getCard(n).kind === 'unit');
  assert.ok(watchers.length >= 8, `the watcher population is derived (${watchers.length})`);
  for (const w of watchers) {
    const { h, A, D, region } = inBattle(33810);
    put(h, A, w, region);
    const start = h.events.length;
    killToken(h, A, region);
    killToken(h, D, region);
    assert.equal(trashes(h, start).length, 0, `${w}: no trashed event for a token`);
    assert.equal(triggersOf(h, w, start).length, 0, `${w} did not trigger on a token death`);
  }
});

// A token that carries its OWN "when I am trashed". In play the only token
// copy maker is Hooba-God ("a token that is a copy of me"), which would need to
// be wearing one of these faces (R118 layer 0); Swarmling's token copy has one,
// but it narrows to a discard, which a token can never be. So this is a
// white-box spawn of the token copy, which is the object those routes make.
test('R306: a token copy of an own-trash card does not fire its own when-I-am-trashed', () => {
  const own = trashListeners(true).filter(n => getCard(n).kind === 'unit');
  assert.ok(own.includes('Dropslime'), 'Dropslime is in the derived population');
  for (const n of own) {
    const { h, A, region } = inBattle(33820);
    const start = h.events.length;
    killToken(h, A, region, n);
    assert.equal(h.events.slice(start).filter(ev => ev.type === 'died' && ev.data!['card'] === n).length, 1,
      `a token ${n} died`);
    assert.equal(trashes(h, start).length, 0, `a token ${n} is not trashed`);
    assert.equal(triggersOf(h, n, start).length, 0, `and its own trash trigger did not fire (${n})`);
  }
});

test('R306 control: the same Dropslime as a CARD dying in battle does fire', () => {
  const { h, A, region } = inBattle(33821);
  const slime = put(h, A, 'Dropslime', region);
  const start = h.events.length;
  withE(h, e => { e.destroy(e.entity(slime)!, 'dies'); });
  assert.equal(trashes(h, start).length, 1, 'the card is trashed');
  assert.equal(triggersOf(h, 'Dropslime', start).length, 1, 'and its own trigger fires');
});

test('R306: a token MOD on a dying card host is erased and not trashed; the host is', () => {
  const { h, A, region } = inBattle(33830);
  const host = put(h, A, 'Good Whale', region);
  withE(h, e => { e.augmentWraith(e.entity(host)!, A); });   // a token MOD
  const start = h.events.length;
  withE(h, e => { e.destroy(e.entity(host)!, 'dies'); });
  const t = trashes(h, start);
  assert.deepEqual(t.map(ev => ev.data!['card']), ['Good Whale'],
    'one trash: the CARD host (R137, Unstable by its mod); the token mod never (R69/R306)');
  assert.ok(h.state.players[A]!.erased?.includes('Wraith'), 'the token mod reached the erased pile (R65)');
});
