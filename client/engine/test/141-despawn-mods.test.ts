/**
 * R167 / CARD-TODO #50 — A DONATED "[Augment] When I despawn" MUST FIRE
 * WHICHEVER WAY ITS HOST LEAVES PLAY.
 *
 * `E.fireEvent` finds a mod's donated `[Augment]` text by walking the host's
 * `u.mods` through the entity table. `E.destroy` therefore keeps the mod
 * ENTITIES alive across the death window on purpose — `disposeToBin` deletes
 * them at the very bottom, and carries a comment saying why. `E.leavePlay`
 * (recall and cache) did the exact opposite: it deleted every mod entity
 * BEFORE the caller fired `'despawned'`, so a printed "[Augment] When I
 * despawn, …" had no anchor left to be found on and did nothing at all.
 *
 * Measured before the fix, one Growing Plague grafted onto one host, counting
 * the queued trigger:
 *
 *     destroy   1
 *     recall    0
 *     cache     0
 *
 * Half a printed word — and the same object behaving differently depending on
 * how its host left play, which is the exact shape R137 exists to remove. The
 * repair moves the mod deletion out of `leavePlay` and down to the bottom of
 * `afterDespawn`, which puts it in the same place in the sequence
 * `disposeToBin` already uses. Nothing between the two halves can RESOLVE
 * (`fireEvent` and `noteTrashed` only queue), so the window can only be READ.
 *
 * WHAT THIS FILE PINS, and how it differs from 129-disposal-tail: 129 pins
 * that the DEATH/EXCHANGE tail is one shared primitive. This file pins the
 * OTHER tail — `leavePlay` + `afterDespawn` — and specifically that the three
 * routes out of play now agree about donated despawn text, while the bin, the
 * trash and the erased pile are each still touched exactly once. Seeds are
 * 14100+, so nothing here can collide with another band.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, spawn, toDeployment, withE } from './util.ts';
import type { DecisionOption, Entity, EntityId, Seat } from '../src/types.ts';

/** The three ways a unit leaves play that this file is about. */
type Route = 'death' | 'recall' | 'cache';
const ROUTES: Route[] = ['death', 'recall', 'cache'];

/** Drive everything pending to a standstill. */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  let guard = 120;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (!dec) return;
    if (dec.pickOrder) {
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      continue;
    }
    const i = dec.options.findIndex(choose);
    h.do({ type: 'decide', seat: dec.seat, choice: i === -1 ? 0 : i });
  }
  throw new Error('resolveAll did not terminate');
}

const countIn = (xs: string[], name: string): number => xs.filter(x => x === name).length;
const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const erasedOf = (h: Harness, seat: Seat): string[] => new E(h.state).erased(seat);
const trashesOf = (h: Harness, card: string) =>
  h.events.filter(ev => ev.type === 'trashed' && ev.data!['card'] === card);
/** how many triggers `card` queued — the honest "did the donated text FIRE?"
 * question, since a despawn that fires nothing still writes a log line. */
const triggersOf = (h: Harness, card: string): number =>
  h.events.filter(ev => ev.type === 'triggered' && ev.msg.includes(card)).length;
const tokensNamed = (h: Harness, name: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.kind === 'spellToken' && e.card === name);

/**
 * The one board every case below uses: a plain host (Rune Channeler, no text
 * of its own that listens to anything here) wearing one augment mod. `modBy`
 * is the mod's OWNER, deliberately settable to the OTHER seat so "its own
 * owner's bin" and "the body's owner's bin" are different answers.
 */
function board(seed: number, mod: string | 'Wraith-token', modBy?: (a: Seat) => Seat):
{ h: Harness; A: Seat; D: Seat; host: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const host = spawn(h, A, 'Rune Channeler');
  const by = modBy ? modBy(A) : A;
  withE(h, e => {
    const u = e.entity(host)!;
    if (mod === 'Wraith-token') e.augmentWraith(u, by);
    else e.attachMod(u, mod, by, 'augment');
  });
  return { h, A, D, host };
}

/** Take `host` off the table by `route`, then settle everything it queued. */
function leaveBy(h: Harness, host: EntityId, route: Route): void {
  withE(h, e => {
    const u = e.entity(host)!;
    if (route === 'death') e.destroy(u, 'dies');
    else if (route === 'recall') e.recall(u);
    else e.cacheUnit(u);
  });
  resolveAll(h);
}

// ══════════════════════════════════════════════════════════════════════
// (i)–(iii) the printed word, on each of the three routes
// ══════════════════════════════════════════════════════════════════════
//
// A Pile of Runes is the probe: its WHOLE text box is "[Augment] When I
// despawn, create a Crystal X, where X is my defense" — no main text at all,
// so a fired trigger is the only thing that can produce a Crystal, and the
// Crystal is a real entity rather than a log line. Its `when` snapshots the
// HOST's defense at event time, which is a second thing that can only happen
// while the window is open.

test('R167 (i): a donated "[Augment] When I despawn" fires on a RECALL', () => {
  const { h, A, host } = board(14100, 'A Pile of Runes');
  assert.equal(tokensNamed(h, 'Crystal').length, 0, 'no Crystal before the recall');

  leaveBy(h, host, 'recall');

  assert.equal(ent(h, host), undefined, 'the host left play…');
  assert.ok(h.state.players[A]!.hand.includes('Rune Channeler'), '…for its owner’s hand');
  assert.equal(triggersOf(h, 'A Pile of Runes'), 1,
    'the donated despawn text fired. Before R167 leavePlay() deleted the mod entity before '
    + '\'despawned\' was fired, so fireEvent’s mod scan found nothing and this was 0.');
  assert.equal(tokensNamed(h, 'Crystal').length, 1,
    'and it RESOLVED — a queued trigger that never resolves is not a card doing what it prints');
});

test('R167 (ii): a donated "[Augment] When I despawn" fires on a CACHE', () => {
  const { h, A, host } = board(14101, 'A Pile of Runes');

  leaveBy(h, host, 'cache');

  assert.equal(ent(h, host), undefined, 'the host left play…');
  assert.ok(new E(h.state).cache(A).some(c => c.card === 'Rune Channeler'), '…for its owner’s cache');
  assert.equal(triggersOf(h, 'A Pile of Runes'), 1,
    'the donated despawn text fired on a cache too — 0 before R167');
  assert.equal(tokensNamed(h, 'Crystal').length, 1, 'and resolved');
});

test('R167 (iii): a donated "[Augment] When I despawn" still fires exactly ONCE on a DEATH', () => {
  // The regression guard. A death already worked (disposeToBin deletes its mods
  // last, deliberately); the risk in moving the delete out of leavePlay is a
  // SECOND scan of the same mods, not a missing one. `exactly once` is the
  // whole assertion.
  const { h, host } = board(14102, 'A Pile of Runes');

  leaveBy(h, host, 'death');

  assert.equal(ent(h, host), undefined, 'the host left play');
  assert.equal(triggersOf(h, 'A Pile of Runes'), 1,
    'exactly one firing — the death path must not have gained a duplicate');
  assert.equal(tokensNamed(h, 'Crystal').length, 1, 'and exactly one Crystal, not two');
});

// ══════════════════════════════════════════════════════════════════════
// (iv) a NONTOKEN mod: one bin, one trash, on every route
// ══════════════════════════════════════════════════════════════════════
//
// Chitin Shredder has no text at all, so nothing here can be answered by a
// trigger cancelling something. It is owned by the OTHER seat, which is what
// separates "its own owner's bin" (R137) from "the body's".
//
// The three routes legitimately DIFFER in where the card comes to rest: a
// recall and a cache leave it in the bin, while a death makes the body
// {Unstable} (R69: a modded card is Unstable) and the state-based sweep takes
// both back out again (R137/R140).
//
// ⚠ R244 (2026-08-29, report #129) makes that difference decide the TRASH as
// well, and this test used to assert the opposite. A mod left behind in a bin
// stays there and is trashed; a mod erased with its host is not trashed at
// all, because it is PART of that unit and never had a presence of its own.
// The other half of the ruling is here too: where a mod IS trashed, it is
// trashed by the HOST'S CONTROLLER — `A` on this board — while the card still
// goes to its own owner's bin (`D`). What must still be identical across the
// routes is that nothing happens TWICE.
test('R167 (iv): a nontoken mod is binned and trashed exactly once on all three routes', () => {
  for (const [i, route] of ROUTES.entries()) {
    const { h, A, D, host } = board(14110 + i, 'Chitin Shredder', a => (1 - a) as Seat);

    leaveBy(h, host, route);

    if (route === 'death') {
      // R69/R137: the body is {Unstable} because it is modded, so the sweep
      // pulls the pair back out of the bins it just entered — and R244 says
      // that departure is not a trashing.
      assert.equal(trashesOf(h, 'Chitin Shredder').length, 0,
        'death: erased with its host, so never trashed (R244; this was 1 under R137)');
      assert.equal(countIn(erasedOf(h, A), 'Chitin Shredder'), 1,
        'death: swept out of the bin exactly once — Unstable. R250 §4: out of the '
        + 'HOST CONTROLLER bin, because zones follow control');
      assert.equal(countIn(binOf(h, A), 'Chitin Shredder'), 0, 'death: and does not rest there');
      assert.equal(countIn(erasedOf(h, D), 'Chitin Shredder'), 0,
        'death: the mod owner zones are not involved');
    } else {
      assert.equal(trashesOf(h, 'Chitin Shredder').length, 1,
        `${route}: the mod was left behind in a bin and STAYS there, so R40 trashed it — once`);
      assert.equal(trashesOf(h, 'Chitin Shredder')[0]!.data!['seat'], A,
        `${route}: by the HOST’s controller — a mod is part of the unit it sits on (R244)`);
      assert.equal(countIn(binOf(h, A), 'Chitin Shredder'), 1,
        `${route}: R250 §4 — and the CARD rests in that same seat bin, exactly one copy`);
      assert.equal(countIn(binOf(h, D), 'Chitin Shredder'), 0,
        `${route}: the mod owner does not get it back`);
      assert.equal(countIn(erasedOf(h, A), 'Chitin Shredder'), 0,
        `${route}: a recalled/cached carrier’s mods are not erased`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
// (v) a TOKEN mod: one erased-pile entry, no bin, on every route
// ══════════════════════════════════════════════════════════════════════
//
// R69: a token mod has no card of its own, so it never reaches a bin and is
// never trashed; R65 files it on the public erased pile instead. Moving the
// deletion later must not file it twice, nor let it slip into a bin.
test('R167 (v): a token mod reaches the erased pile exactly once, and no bin, on all three routes', () => {
  for (const [i, route] of ROUTES.entries()) {
    const { h, A, host } = board(14120 + i, 'Wraith-token');

    leaveBy(h, host, route);

    assert.equal(countIn(erasedOf(h, A), 'Wraith'), 1,
      `${route}: the token mod is filed on the erased pile exactly once (R65/R69)`);
    assert.equal(countIn(binOf(h, A), 'Wraith'), 0,
      `${route}: a token mod has no card to bin`);
    assert.equal(trashesOf(h, 'Wraith').length, 0,
      `${route}: and nothing that never entered a bin is trashed (R40)`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// (vi) the pool, not just the probe
// ══════════════════════════════════════════════════════════════════════
//
// Every card in the pool whose printed [Augment] text listens for its HOST
// leaving play. Each one was dead on a recall and a cache and alive on a
// death; the fix is at the leave-play seam, so all of them move together —
// and this is the test that says so out loud, so a later reordering cannot
// quietly take them back one at a time.
//
// ⚠ Tempest Oracle is NOT in this list, and the divergence inventory's sweep
// was wrong to name it: its "When I despawn" is in `abilities`, not
// `augmentText`, so it is the card's OWN text and rides fireEvent's
// `dyingUnit` unshift rather than the mod scan. It was never broken. It is
// asserted below all the same, as the control that says the mod scan is not
// the only route in.
const DONATED_DESPAWN = [
  'A Pile of Runes',
  'Celestial Fluxmorph',
  'Growing Plague',
  'Pathogenic Enclave',
  'Verdant Necrophage',
  // "[Augment] Whenever one of your units despawns" — no "another", so the
  // CARRIER'S OWN departure counts, and that is the case that was dead.
  'Demon of the Depths',
] as const;

test('R167 (vi): every card with donated despawn text now answers a RECALL the way it answers a DEATH', () => {
  DONATED_DESPAWN.forEach((name, i) => {
    const byDeath = board(14130 + i * 2, name);
    leaveBy(byDeath.h, byDeath.host, 'death');
    const onDeath = triggersOf(byDeath.h, name);

    const byRecall = board(14131 + i * 2, name);
    leaveBy(byRecall.h, byRecall.host, 'recall');
    const onRecall = triggersOf(byRecall.h, name);

    assert.equal(onDeath, 1, `${name}: the death route is the one that always worked`);
    assert.equal(onRecall, onDeath,
      `${name}: a recall must reach the same printed text. Before R167 this was 0 against 1 — `
      + 'the mod entity was deleted before the despawn event fired.');
  });
});

test('R167 (vi-control): Tempest Oracle’s OWN despawn text was never on the mod scan', () => {
  // Its text box has no [Augment] marker, so there is no `augmentText` to
  // donate: as a mod it contributes nothing on any route, and as a UNIT it is
  // found by fireEvent's `dyingUnit` unshift. Pinned so the inventory's claim
  // that this card was affected cannot come back.
  const h = new Harness(14150);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const oracle = spawn(h, A, 'Tempest Oracle');
  withE(h, e => { e.recall(e.entity(oracle)!); });
  assert.equal(triggersOf(h, 'Tempest Oracle'), 1,
    'the unit’s own "When I despawn" fires on a recall — it always did');
});

// ══════════════════════════════════════════════════════════════════════
// (vii) the window closes
// ══════════════════════════════════════════════════════════════════════
//
// The deletion did not disappear, it MOVED. `leavePlay` no longer deletes the
// mod entities, so `afterDespawn` has to — and if a future caller of
// `leavePlay` ever forgets to reach it, the mods are orphaned entities whose
// host is gone, which is a leak this assertion is here to catch.
test('R167 (vii): the mod entities are deleted once the despawn window closes', () => {
  for (const [i, route] of ROUTES.entries()) {
    const { h, host } = board(14140 + i, 'A Pile of Runes');
    const modIds = h.state.entities[host]!.mods.slice();
    assert.equal(modIds.length, 1, 'one mod on the host to begin with');

    leaveBy(h, host, route);

    for (const id of modIds) {
      assert.equal(h.state.entities[id], undefined,
        `${route}: the mod entity is gone from s.entities once the window has closed`);
    }
    assert.equal(Object.values(h.state.entities).filter(e => e.kind === 'mod').length, 0,
      `${route}: and no orphaned mod is left behind`);
  }
});
