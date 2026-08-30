/**
 * R262 — A STOLEN CARD GOES TO THE THIEF'S ZONES, IN ALL FOUR OF THEM.
 *
 * Round-32 Q2. R250 answered the BIN — *"The controller trashes it and it goes
 * to their graveyard. In Algomancy, there's no issue with taking opponent's
 * cards and putting them into your zones in the way that's not possible in
 * other card games. The primary format (live draft) is a fully shared card
 * pool."* — and deliberately left the other three per-seat destinations reading
 * `owner`, because each one is a power change. Put to the owner as Q2, the
 * answer was **(a) All four follow control — one rule, no seam.**
 *
 * ⚠ WHY THIS FILE HAD TO BE WRITTEN AT ALL. The engine change is three
 * defaults — `opts.to ?? u.owner` → `?? u.controller` in `recall` and
 * `cacheUnit`, and `{ seat: mod.owner }` → `mod.controller` in `eraseMod`.
 * Every existing test stayed green, and NOT because the change is safe: for a
 * unit nobody has stolen `owner === controller`, so the whole suite is one
 * enormous positive control for the case that did not change and carries no
 * coverage at all of the case that did. A change no test can see is a change
 * nothing will keep.
 *
 * So every test here builds a real theft with `E.giveControl` — the engine's
 * own primitive, the one the seven card files use — and then asserts the
 * destination. §4 is the other half: ownership does NOT move, which is the
 * distinction R262 §3 keeps for constructed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ent, spawn, toDeployment, withE } from './util.ts';

/** a body with no text, so nothing but the zone rule can move it */
const VANILLA = 'Just a Unit';

/** A owns a unit, B has stolen it. Returns both seats and the entity id. */
function stolen(seed: number): { h: Harness; owner: Seat; thief: Seat; id: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const owner = h.state.deployPlayer!;
  const thief = (1 - owner) as Seat;
  const id = spawn(h, owner, VANILLA);
  withE(h, e => {
    const ok = e.giveControl(ent(h, id)!, thief);
    assert.equal(ok, true, 'giveControl refused — the fixture never created a theft');
  });
  const u = ent(h, id)!;
  // THE CONTROL FOR EVERY TEST BELOW. If these two ever agree, this whole file
  // is asserting the behaviour that never changed and would pass against the
  // engine as it was before R262.
  assert.equal(u.owner, owner, 'the fixture must leave ownership with the original owner');
  assert.equal(u.controller, thief, 'the fixture must leave control with the thief');
  assert.notEqual(u.owner, u.controller, 'owner and controller must DIFFER, or nothing is tested');
  return { h, owner, thief, id };
}

test('R262 §1: a stolen unit recalled goes to the THIEF hand, not the owner', () => {
  const { h, owner, thief, id } = stolen(24601);
  withE(h, e => e.recall(ent(h, id)!));
  assert.deepEqual(h.state.players[thief]!.hand.filter(c => c === VANILLA), [VANILLA],
    'the recalled card is in the hand of the player who controlled it');
  assert.deepEqual(h.state.players[owner]!.hand.filter(c => c === VANILLA), [],
    'and NOT in its owner hand — this is the line R262 changed, and the Manual '
    + 'sentence it overrules is quoted in the ruling');
});

test('R262 §1: a stolen unit cached goes to the THIEF cache', () => {
  const { h, owner, thief, id } = stolen(24602);
  withE(h, e => e.cacheUnit(ent(h, id)!));
  const cacheOf = (seat: Seat): number =>
    (h.state.players[seat]?.cache ?? []).filter(c => c?.card === VANILLA).length;
  assert.equal(cacheOf(thief), 1, 'the cached card is in the cache of the player who controlled it');
  assert.equal(cacheOf(owner), 0);
});

test('R262 §2: an explicit destination still wins over the control default', () => {
  // `opts.to` is how a card whose PRINTED TEXT names a destination says so —
  // Cosmic Reversal passes `to: controller` because it prints "put them into
  // their controller's hands". R262 changed the DEFAULT and must not have
  // taken the override away, or a printed-text argument stops working.
  const { h, owner, thief, id } = stolen(24603);
  withE(h, e => e.recall(ent(h, id)!, { to: owner }));
  assert.deepEqual(h.state.players[owner]!.hand.filter(c => c === VANILLA), [VANILLA],
    'an explicit `to` still sends the card where the caller said');
  assert.deepEqual(h.state.players[thief]!.hand.filter(c => c === VANILLA), []);
});

test('R262 §3: ownership does NOT move — only the destination does', () => {
  // The distinction the owner kept: *"owner in constructed is always the
  // person who brought the card to the game."* A zone change is not a change
  // of ownership, and anything reading `owner` to answer "whose card is this"
  // must keep getting the same answer it always got.
  const { h, owner, thief, id } = stolen(24604);
  const u = ent(h, id)!;
  assert.equal(u.owner, owner);
  assert.equal(u.controller, thief);
  // read it off the EVENT rather than by calling the private `leftPlayFacts`
  // directly — the event is what every listener actually sees, so this is the
  // stronger place to assert it anyway
  const mark = h.events.length;
  withE(h, e => e.recall(ent(h, id)!));
  const despawn = h.events.slice(mark).find(ev => ev.data?.['owner'] !== undefined);
  assert.ok(despawn, 'the recall announced no owner at all, so nothing here is being tested');
  assert.equal(despawn!.data!['owner'], owner,
    'the facts riding the event still report the OWNER. R262 moved zones, not ownership.');
});

test('R262 §4 CONTROL: an unstolen unit is unchanged, so the sweep is not a no-op rewrite', () => {
  // The other side. If this ever disagreed with §1 the change would have moved
  // every card in the game, not just the stolen ones.
  const h = new Harness(24605);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, VANILLA);
  const u = ent(h, id)!;
  assert.equal(u.owner, u.controller, 'nobody has stolen this one');
  withE(h, e => e.recall(u));
  assert.deepEqual(h.state.players[seat]!.hand.filter(c => c === VANILLA), [VANILLA]);
});

test('R262 §5: the erased pile files a stolen mod under the THIEF', () => {
  // R65's public erased pile is a per-seat zone like the other three, and it
  // was the one R244 left behind when it moved the mod BIN this way.
  const h = new Harness(24606);
  toDeployment(h);
  const owner = h.state.deployPlayer!;
  const thief = (1 - owner) as Seat;
  const host = spawn(h, owner, VANILLA);
  let modId = 0;
  withE(h, e => {
    const u = ent(h, host)!;
    const before = new Set(u.mods);
    e.attachMod(u, 'Ignis Sprite', owner, 'augment');
    modId = u.mods.find(m => !before.has(m))!;
    assert.ok(modId, 'the fixture must really have attached a mod');
    assert.equal(e.giveControl(ent(h, host)!, thief), true);
  });
  const mod = ent(h, modId)!;
  assert.equal(mod.owner, owner, 'the mod is still the original owner card');
  assert.equal(mod.controller, thief, 'giveControl carries the mods with the host');
  const mark = h.events.length;
  withE(h, e => { e.eraseMod(mod, {}); });
  const seen = h.events.slice(mark)
    .filter(ev => ev.type === 'erased')
    .map(ev => ev.data as { seat: unknown; cards: unknown });
  assert.ok(seen.length > 0,
    'no erased event was emitted at all, so this test proves nothing about which seat it names');
  assert.deepEqual(seen.map(x => x.seat), seen.map(() => thief),
    'the erased pile files the mod under the player who CONTROLLED it (R262), not its owner');
});
