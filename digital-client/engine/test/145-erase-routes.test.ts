/**
 * R172 — AN ERASE IS A DESPAWN, AND EVERY ERASE GOES THROUGH ONE CHOKE POINT.
 *
 * Three related defects, all of them "a route OUT of play that does not behave
 * like the other routes out of play":
 *
 *  1. `E.eraseFromPlay` reverted the face, deleted the unit and its mods,
 *     unslotted it and emitted a single `'erased'` event — a type that NO
 *     `fireEvent` site in the engine or the card pool dispatches. So an erase
 *     was invisible to the game, exactly the way R152 found a Hooba-Mon
 *     exchange to be. R157 §3 had already ruled the general case — *"It's not
 *     a death, but it IS a despawn and a trashing"* — and R152 repaired this
 *     same omission on `exchangeInPlace`. An erase was the last non-death
 *     departure still silent: every "whenever a unit despawns" watcher was
 *     blind to Banishment, and every donated `[Augment] When I despawn` was
 *     dead on this route. R167's bug, one verb over — and because
 *     `eraseFromPlay` deleted its mods before it announced anything, R167's
 *     anchoring fix had to be repeated here or the new event would fire with
 *     nothing left to donate.
 *
 *  2. Two card-side copies of the erase bypassed the choke point entirely
 *     (`helpers.ts`'s `eraseFromPlay`, reached by EIGHT card sites including
 *     Banishment and Celestial Purge; and batch-hybrids-ld-a's `eraseUnit`,
 *     reached by Zephyrzoa). Neither turned a transformed card back over, so
 *     R157 §10 — *"in all zones, other than play, it exists as the front
 *     side"* — was false on every one of them: the erased pile recorded
 *     "Beyond, Codex Incarnate" instead of the Scholar of the Void that was
 *     really leaving the game. Both are one-line shims now, so (1) reaches
 *     them for free.
 *
 *  3. Download. "Gain control of target token" on a `{Battle}` spell can steal
 *     a Robot with the formations already declared, and `E.giveControl`
 *     unslots the stolen unit without ever re-slotting it. The owner ruled on
 *     2026-08-25 that this is CORRECT: **it sits out until regroup** — it
 *     changes controller at once, is out of the formation for the rest of this
 *     battle, and joins its new controller's side at regroup. The behaviour
 *     was an accident of there being no formation-join primitive; the two
 *     cases at the bottom of this file make it a decision, so the next reader
 *     does not "fix" it into a mid-battle re-slot.
 *
 * ⚠ WHAT MUST NOT CHANGE, and is pinned here as hard as the fix: an erase is
 * still NOT a death and NOT a trash. R40 is about a card entering a bin and
 * nothing here enters one, so no `'died'`, no `'trashed'`, no bin entry.
 * Widening the event is not the same as widening the verb.
 *
 * Seeds are 14500+, so nothing here collides with another band.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { DecisionOption, Entity, EntityId, Seat } from '../src/types.ts';

/** Run raw engine calls against the harness state, absorbing a suspension and
 * keeping the harness log honest. (Same shape 141-despawn-mods and
 * 129-disposal-tail use; kept local so no file's helpers can drift under
 * another's.) */
function withE(h: Harness, fn: (e: E) => void): void {
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
/** how many triggers `card` queued — the honest "did the text FIRE?" question,
 * since an event that fires nothing still writes a log line. */
const triggersOf = (h: Harness, card: string): number =>
  h.events.filter(ev => ev.type === 'triggered' && ev.msg.includes(card)).length;
const tokensNamed = (h: Harness, name: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.kind === 'spellToken' && e.card === name);
const eventsOf = (h: Harness, type: string, from = 0) =>
  h.events.slice(from).filter(ev => ev.type === type);

/** Erase `id` through the ENGINE choke point (Skybreaker's "Erase me:" cost
 * lands here, engine.ts's `payActivationCost`), then settle. */
function eraseDirect(h: Harness, id: EntityId): void {
  withE(h, e => { e.eraseFromPlay(e.entity(id)!); });
  resolveAll(h);
}

// ══════════════════════════════════════════════════════════════════════
// (i) the event exists, and a third party hears it
// ══════════════════════════════════════════════════════════════════════
//
// Demon of the Depths prints "[Augment] Whenever one of your units despawns,
// I deal 1 damage to any target" — a THIRD-PARTY watcher: it rides an ally
// that is still standing when a DIFFERENT ally is erased. Before R172 an
// erase fired only 'erased', which nothing dispatches, so this was silent.

test('R172 (i): an ERASE fires \'despawned\', and Demon of the Depths hears an ally being erased', () => {
  const h = new Harness(14500);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const watcher = spawn(h, A, 'Rune Channeler');   // no text of its own that listens here
  const victim = spawn(h, A, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(watcher)!, 'Demon of the Depths', A, 'augment'); });
  const mark = h.events.length;

  eraseDirect(h, victim);

  assert.equal(ent(h, victim), undefined, 'the victim left play');
  assert.equal(eventsOf(h, 'despawned', mark).length, 1,
    'an erase fires exactly one \'despawned\'. Before R172 it fired NONE — eraseFromPlay emitted '
    + '\'erased\' and stopped, and no fireEvent site anywhere dispatches that type.');
  assert.equal(eventsOf(h, 'erased', mark).length, 1,
    'and still exactly one \'erased\' — the pile line is not duplicated by the new event');
  assert.equal(triggersOf(h, 'Demon of the Depths'), 1,
    '…and a "whenever one of your units despawns" watcher on a SURVIVING ally saw it (R157 §3: '
    + '"not a death, but it IS a despawn")');
});

test('R172 (i-facts): the erase\'s \'despawned\' carries R70\'s fact bundle, and no card enters a zone', () => {
  // R70: 'despawned' fires once the entity is already out of s.entities, so
  // everything a listener could want has to ride the event. Demon of the
  // Depths' own `when` reads `ev.data.seat`, so a missing bundle is not a
  // cosmetic problem.
  const h = new Harness(14501);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const victim = spawn(h, A, 'Rune Channeler');
  const region = ent(h, victim)!.region;
  const mark = h.events.length;

  eraseDirect(h, victim);

  const ev = eventsOf(h, 'despawned', mark)[0]!;
  assert.deepEqual(
    {
      unit: ev.data!['unit'], card: ev.data!['card'], seat: ev.data!['seat'],
      owner: ev.data!['owner'], region: ev.data!['region'], to: ev.data!['to'],
    },
    { unit: victim, card: 'Rune Channeler', seat: A, owner: A, region, to: 'erased' },
    'leftPlayFacts rides the event, and `to` names the destination the way a recall says '
    + '"hand" and a cache says "cache"');
  assert.equal(countIn(erasedOf(h, A), 'Rune Channeler'), 1, 'R65: it is on the public pile');
});

// ══════════════════════════════════════════════════════════════════════
// (ii) R167's case, on the third route
// ══════════════════════════════════════════════════════════════════════
//
// A Pile of Runes is the probe R167 used, for the same reason: its WHOLE text
// box is "[Augment] When I despawn, create a Crystal X, where X is my
// defense", so a fired trigger is the only thing that can produce a Crystal,
// and the Crystal is a real entity rather than a log line. R167 gave it recall
// and cache; this is the route R167 did not have.

test('R172 (ii): a donated "[Augment] When I despawn" (A Pile of Runes) fires on an ERASE', () => {
  const h = new Harness(14502);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  withE(h, e => { e.attachMod(e.entity(host)!, 'A Pile of Runes', A, 'augment'); });
  assert.equal(tokensNamed(h, 'Crystal').length, 0, 'no Crystal before the erase');

  eraseDirect(h, host);

  assert.equal(ent(h, host), undefined, 'the host left play');
  assert.equal(triggersOf(h, 'A Pile of Runes'), 1,
    'the donated despawn text fired on an ERASE. Before R172 this was 0 twice over: no '
    + '\'despawned\' event at all, and the mod entity deleted before there could have been one.');
  assert.equal(tokensNamed(h, 'Crystal').length, 1,
    'and it RESOLVED — a queued trigger that never resolves is not a card doing what it prints');
});

test('R172 (ii-anchor): the mod entity outlives the announce and is gone once the window closes', () => {
  // R167's anchoring, repeated on this route: `fireEvent` finds donated
  // [Augment] text by walking `u.mods` THROUGH the entity table, so the mods
  // must still be there when 'despawned' fires — and must not survive it.
  const h = new Harness(14503);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  let mod = 0;
  withE(h, e => { mod = e.attachMod(e.entity(host)!, 'A Pile of Runes', A, 'augment').id; });

  eraseDirect(h, host);

  assert.equal(h.state.entities[mod], undefined,
    'the mod entity is deleted in the LAST statement of eraseFromPlay, not the third');
  assert.equal(Object.values(h.state.entities).filter(e => e.kind === 'mod').length, 0,
    'and no orphaned mod is left behind');
});

// ══════════════════════════════════════════════════════════════════════
// (iii)–(v) R157 §10 on all three card-side erase routes
// ══════════════════════════════════════════════════════════════════════
//
// "Turns back over. In all zones, other than play, it exists as the front
// side." The engine choke point has done this since R157 §10 shipped; the two
// hand-rolled copies never did, so the public erased pile — the only record
// that a card has left the GAME — named a back face that exists nowhere but
// play, and the Scholar of the Void that really left was recorded nowhere at
// all.

/** Spawn a Scholar of the Void for `seat` and turn it over by hand. (The card
 * turns itself over at the start of deployment; `transformFace` is the same
 * primitive that ability calls, and using it directly keeps these three cases
 * about the ERASE rather than about the flip.) */
function flippedScholar(h: Harness, seat: Seat): EntityId {
  const id = spawn(h, seat, 'Scholar of the Void');
  withE(h, e => { e.transformFace(e.entity(id)!, 'Beyond, Codex Incarnate'); });
  assert.equal(ent(h, id)!.card, 'Beyond, Codex Incarnate', 'it is turned over…');
  assert.equal(ent(h, id)!.frontFace, 'Scholar of the Void', '…and remembers which side is up');
  return id;
}

/** The §10 assertion, identical on all three routes. */
function assertFrontFaceOnPile(h: Harness, seat: Seat, id: EntityId): void {
  assert.equal(ent(h, id), undefined, 'it left play');
  assert.equal(countIn(erasedOf(h, seat), 'Scholar of the Void'), 1,
    'the erased pile records the FRONT face — "in all zones, other than play, it exists as the '
    + 'front side" (R157 §10). The hand-rolled copies never called revertFace.');
  assert.equal(countIn(erasedOf(h, seat), 'Beyond, Codex Incarnate'), 0,
    'and NOT the back face, which reaches no zone but play');
  assert.ok(h.log.some(l => l.includes('turns back over')),
    'the flip is announced, as it is on every other route out of play');
  assert.equal(countIn(binOf(h, seat), 'Scholar of the Void'), 0, 'erase means erase: no bin');
}

test('R172 (iii): a transformed Scholar of the Void ERASED BY BANISHMENT reaches the erased pile as its FRONT face', () => {
  const h = new Harness(14510);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);                          // Banishment: l/3
  toNextBattle(h, A);
  // R12/R25: the spell sweeps the region it resolves in — the battle region,
  // the defender's home. "Erase all units that spawned THIS TURN", so the
  // Scholar is spawned here.
  const scholar = flippedScholar(h, D);

  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Banishment') });
  pass(h); pass(h);
  resolveAll(h);

  assertFrontFaceOnPile(h, D, scholar);
});

test('R172 (iv): a transformed Scholar of the Void ERASED BY CELESTIAL PURGE reaches the erased pile as its FRONT face', () => {
  const h = new Harness(14511);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const scholar = flippedScholar(h, D);
  giveResources(h, A, 'water', 3);                          // Celestial Purge: bb/1
  toNextBattle(h, A);

  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Celestial Purge') });
  pick(h, { unit: scholar });
  pass(h); pass(h);
  resolveAll(h);                                            // the Glimpse 3 that follows

  assertFrontFaceOnPile(h, D, scholar);
});

test('R172 (v): a transformed Scholar of the Void ERASED BY ZEPHYRZOA\'s "erase me" reaches the erased pile as its FRONT face', () => {
  // Zephyrzoa is the only card that reaches batch-hybrids-ld-a's `eraseUnit`.
  // Its text is an [Augment], and "me" reads from the HOST when donated — so
  // a Zephyrzoa grafted onto the turned-over Scholar erases the SCHOLAR when
  // the column connects, which is what makes this route reachable with a
  // transformed card at all.
  const h = new Harness(14512);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const scholar = flippedScholar(h, A);                     // Beyond is an 8/3
  const ally = spawn(h, A, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(scholar)!, 'Zephyrzoa', A, 'augment'); });
  toNextBattle(h, A);

  h.do({ type: 'declareAttack', seat: A, columns: [[scholar, ally]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  // answer whatever the combat pump raised and drain the stack it queued
  let guard = 60;
  while (guard-- > 0) {
    const d = h.state.decision;
    if (d) {
      h.do({ type: 'decide', seat: d.seat, choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0 });
      continue;
    }
    if (h.state.phase !== 'battle') break;
    if (h.state.battle!.step !== 'afterWindow') break;
    if (!h.state.stack.length) break;
    pass(h);
  }
  assert.ok(guard > 0, 'the combat settled');

  assertFrontFaceOnPile(h, A, scholar);
});

// ══════════════════════════════════════════════════════════════════════
// (vi) the mods: one erased-pile entry, no bin, no trash
// ══════════════════════════════════════════════════════════════════════
//
// R167's (iv)/(v) invariants, on this route. The window between the announce
// and the mod deletion is now several statements long, so the risk is a
// SECOND pass over the same mods, not a missing one. R40 is the other half:
// an erase never touches a bin, so it is never a trash — for a nontoken mod
// just as much as for a token one.

test('R172 (vi): a nontoken mod (Chitin Shredder) erased with its host reaches the erased pile exactly once, and no bin', () => {
  const h = new Harness(14520);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Rune Channeler');
  // owned by the OTHER seat on purpose: "the mod's own owner" and "the body's
  // owner" must be different answers before either can be checked.
  withE(h, e => { e.attachMod(e.entity(host)!, 'Chitin Shredder', D, 'augment'); });

  eraseDirect(h, host);

  assert.equal(countIn(erasedOf(h, A), 'Chitin Shredder')
    + countIn(erasedOf(h, D), 'Chitin Shredder'), 1,
    'exactly one erased-pile entry for the mod — not two, now that the deletion happens after '
    + 'the announce instead of before it');
  assert.equal(countIn(binOf(h, A), 'Chitin Shredder') + countIn(binOf(h, D), 'Chitin Shredder'), 0,
    'and NO bin: an erase does not put a card in one, whoever owns it');
  assert.equal(trashesOf(h, 'Chitin Shredder').length, 0,
    'so R40 has nothing to trash — "erasing never touches a bin, so it is never a trash"');
});

test('R172 (vi-token): a token mod (Wraith) erased with its host reaches the erased pile exactly once, and no bin', () => {
  const h = new Harness(14521);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  withE(h, e => { e.augmentWraith(e.entity(host)!, A); });

  eraseDirect(h, host);

  assert.equal(countIn(erasedOf(h, A), 'Wraith'), 1,
    'R65/R69: a token mod has no card of its own, so the pile is the only record — exactly one');
  assert.equal(countIn(binOf(h, A), 'Wraith'), 0, 'and it never reaches a bin');
  assert.equal(trashesOf(h, 'Wraith').length, 0, 'so it is never trashed (R40)');
});

// ══════════════════════════════════════════════════════════════════════
// (vii) the verb did NOT widen
// ══════════════════════════════════════════════════════════════════════

test('R172 (vii): Banishment still fires no \'died\' and no \'trashed\' — an erase gained a despawn, not a death', () => {
  const h = new Harness(14530);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);
  toNextBattle(h, A);
  const victim = spawn(h, D, 'Rune Channeler');             // nontoken: it WOULD bin on a death
  const mark = h.events.length;

  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Banishment') });
  pass(h); pass(h);
  resolveAll(h);

  assert.equal(ent(h, victim), undefined, 'it was erased');
  assert.equal(eventsOf(h, 'despawned', mark).length, 1, 'one despawn (R172)…');
  assert.equal(eventsOf(h, 'died', mark).length, 0,
    '…and NO death: R157 §3 is "not a death, but it IS a despawn", both halves');
  assert.equal(trashesOf(h, 'Rune Channeler').length, 0,
    'and no trash — R40 turns on entering a bin, and nothing entered one');
  assert.equal(countIn(binOf(h, D), 'Rune Channeler'), 0, 'the card is in no bin');
  assert.equal(countIn(erasedOf(h, D), 'Rune Channeler'), 1, 'it is on the public erased pile');
});

// ══════════════════════════════════════════════════════════════════════
// (viii)–(ix) DOWNLOAD: a mid-battle theft sits out until regroup
// ══════════════════════════════════════════════════════════════════════
//
// Owner's ruling, 2026-08-25: *it sits out until regroup*. Not a limitation —
// a decision. These two cases exist so the next reader does not turn
// `E.giveControl`'s unslot into a re-slot.

test('R172 (viii): Download — a Robot token stolen mid-battle is OUT of the formation for the rest of the battle', () => {
  const h = new Harness(14540);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');                    // 1/1
  giveResources(h, A, 'metal', 2);                          // Download: mm/1
  toNextBattle(h, A);
  let robot = 0;
  withE(h, e => {
    // a Robot prints 0/0 and carries its size in +1/+1 counters, so a
    // counterless one dies to the state-based sweep before it can be stolen
    robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id;
  });
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [robot] } });
  assert.deepEqual(h.state.battle!.blocks[0], [robot], 'the Robot is a declared blocker');
  const life0 = h.state.players[D]!.life;

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  pick(h, { unit: robot });
  pass(h); pass(h);
  resolveAll(h);

  assert.equal(ent(h, robot)!.controller, A, 'it changes controller IMMEDIATELY (R8)');
  assert.equal(ent(h, robot)!.owner, D, 'owner never changes');
  const inLine = (): boolean =>
    [...h.state.battle!.columns, ...Object.values(h.state.battle!.blocks)]
      .some(col => col.includes(robot));
  assert.ok(!inLine(),
    'and it is OUT of the formation at once — it blocks for nobody and attacks for nobody. '
    + 'R172: the owner ruled it SITS OUT UNTIL REGROUP; giveControl\'s unslot is what delivers '
    + 'that and must not grow a re-slot.');

  // …for the REST of the battle: run the damage steps out and it is still out.
  let guard = 60;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const d = h.state.decision;
    if (d) {
      h.do({ type: 'decide', seat: d.seat, choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0 });
      continue;
    }
    assert.ok(!inLine(), `still out of the formation at step ${h.state.battle!.step}`);
    if (h.state.battle!.step === 'declare') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
    else if (h.state.battle!.step === 'blocks') h.do({ type: 'declareBlocks', seat: h.state.battle!.defender, blocks: {} });
    else pass(h);
  }
  assert.ok(guard > 0, 'the battle finished');
  // It FOUGHT FOR NOBODY, which is the substance of "sits out": a 2/2 Robot
  // that was still blocking would have killed the 1/1 it was declared against,
  // and a 2/2 attacking for its new owner would have dealt damage. Neither
  // happened, and the Robot itself is untouched.
  assert.ok(ent(h, atk), 'the 1/1 it was declared against survives — the block is really gone');
  assert.equal(ent(h, atk)!.damage, 0, 'and took no damage from it');
  assert.ok(ent(h, robot), 'the Robot survives the battle…');
  assert.equal(ent(h, robot)!.damage, 0, '…undamaged: it was in no fight on either side');
  // ⚠ NOT Download's doing, and pinned here so the two are not confused: the
  // attacking column stays BLOCKED even though its blocker left ("Column 1 is
  // blocked (blockers gone) — no damage through"), which is the same
  // after-blocks lock R72 states for column gaps. The steal removes a blocker;
  // it does not un-declare the block.
  assert.equal(h.state.players[D]!.life, life0,
    'the column it was blocking does NOT connect — a blocked column whose blockers are gone '
    + 'deals no damage through (existing engine rule, unchanged by R172)');
});

test('R172 (ix): Download — the stolen Robot token joins its NEW controller\'s side at regroup', () => {
  const h = new Harness(14541);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  let robot = 0;
  withE(h, e => {
    robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id;
  });
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  pick(h, { unit: robot });
  pass(h); pass(h);
  resolveAll(h);
  assert.equal(ent(h, robot)!.controller, A, 'stolen');

  let guard = 60;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const d = h.state.decision;
    if (d) {
      h.do({ type: 'decide', seat: d.seat, choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0 });
      continue;
    }
    if (h.state.battle!.step === 'declare') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
    else if (h.state.battle!.step === 'blocks') h.do({ type: 'declareBlocks', seat: h.state.battle!.defender, blocks: {} });
    else pass(h);
  }
  assert.ok(guard > 0, 'the battle finished, and regroup with it');

  const home = new E(h.state).homeRegion(A);
  assert.equal(ent(h, robot)!.region, home,
    'regroup sends every unit to homeRegion(CONTROLLER), so the stolen token comes home to the '
    + 'THIEF — this is the "joins the new controller\'s side" half of the ruling');
  assert.equal(ent(h, robot)!.controller, A, 'still A\'s');

  // and it really is on A's side of the next line: A can send it to attack.
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[robot]] });
  assert.deepEqual(h.state.battle!.columns[0], [robot],
    'A declares the stolen Robot as an attacker in the next battle — it sat out ONE battle, '
    + 'which is exactly what "until regroup" means');
});
