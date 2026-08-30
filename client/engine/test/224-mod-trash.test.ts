/* R244 — A MOD IS PART OF THE UNIT IT SITS ON.
 *
 * Playtest report #129 (room DSVQ, 2026-08-29, actionIndex 117). Rashi cast
 * the {Virus} Malformed Monstrosity onto BEN's The Everywhere; the -7/-7 killed
 * the host, and the log read:
 *
 *     Malformed Monstrosity augments The Everywhere (Ben's) — it is now Unstable.
 *     Ben trashes The Everywhere (from play).
 *     Rashi trashes Malformed Monstrosity (from play).
 *     Malformed Monstrosity is erased from the bin — it modded an Unstable card.
 *
 * The owner, on the third line: *"When a mod goes onto a unit, it becomes PART
 * of that unit. Here, it says that Rashi trashed Malformed Monstrosity which is
 * doubly wrong: 1. Trashing means it goes to the BIN. But the unit that died
 * was unstable, so it didn't go to the bin … 2. The Monstrosity was a mod, not
 * its own card, on Ben's unit, so it was part of a unit that was under Ben's
 * control. 'Trashing' didn't happen here."*
 *
 * Two halves, and they land in different places:
 *
 *   1. ATTRIBUTION. Where a mod IS trashed, the trash belongs to the HOST's
 *      controller, not the mod's owner. The bin it lands in is still its
 *      OWNER's — a card goes to its owner's bin — so `E.noteTrashed` had to
 *      grow a `binSeat` that is allowed to differ from the trashing seat.
 *   2. THE ERASE IS NOT A TRASH. A nontoken mod swept out of the bin with its
 *      {Unstable} host is not trashed at all.
 *
 * ⚠ Half 2 OVERRULES [R137]'s "The mods ride with it" section, which was
 * reasoning and not a log (the ANBB mod was a Wraith token, which has no card
 * to trash either way). Everything else in R137 stands, and the FIRST thing
 * this file does is prove it: the BODY of an {Unstable} unit that dies is
 * still binned and still trashed. That is report #93, and an implementation of
 * R244 that stops the body trashing has silently reopened it.
 *
 * The log line the owner objected to disappears entirely; the one above it stays.
 *
 * Report #121 (Cosmic Reversal) used to be here too; R250 ruled it and its
 * coverage moved to test/229-cosmic-and-control.test.ts. Seeds 9200-9299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import { ent, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const P = printed as unknown as Record<string, {
  name: string; kind: string; text?: string; virus?: boolean;
}>;

/**
 * DERIVE, NEVER ENUMERATE (docs/13-assessment.md §7.2). Every card that can
 * end up as a NONTOKEN mod on somebody else's unit, computed from printed
 * data: a {Virus} is augmented onto a unit by casting it, and a [Switch] /
 * [Switch1] marker is the graft marker. Naming Malformed Monstrosity here
 * instead would go stale the day somebody adds the 204th such card.
 */
const moddable = (): string[] => Object.values(P)
  .filter(c => c.virus || /\[Switch1?\]|\{Switch1?\}/.test(c.text ?? ''))
  .map(c => c.name);

/** Every card whose printed text is about trashing — the population whose
 * behaviour this ruling can move. Derived for the same reason. */
const trashTextCards = (): string[] => Object.values(P)
  .filter(c => /trash/i.test(c.text ?? '')).map(c => c.name);

const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const erasedOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
const trashEvents = (h: Harness, from: number): { seat: number; card: string; binNth?: number }[] =>
  h.events.slice(from)
    .filter(ev => ev.type === 'trashed')
    .map(ev => ev.data as unknown as { seat: number; card: string; binNth?: number });

/**
 * The #129 position: a battle is on, `A` has a unit in play, and `D` puts a
 * nontoken mod of their own onto it. Returns the ids and the seats, with the
 * event log marked so a caller can read only what the disposal emitted.
 */
function moddedEnemyUnit(seed: number, mod = 'Ignis Sprite', host = 'Good Whale'): {
  h: Harness; A: Seat; D: Seat; hostId: number; mark: number;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const hostId = spawn(h, A, host);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  withE(h, e => { e.attachMod(e.entity(hostId)!, mod, D, 'augment'); });
  assert.equal(h.state.phase, 'battle', 'the per-battle trash ledger only counts during a battle');
  return { h, A, D, hostId, mark: h.events.length };
}

// ── R137 first: the boundary this ruling must not cross ─────────────────

test('R137 GUARD: the BODY of an Unstable unit that dies is still trashed, mods or no mods', () => {
  // ⚠ THIS TEST IS THE FENCE. R137 (owner, 2026-08-24, report #93) overruled
  // BOTH the printed reminder text ("If they would enter a bin, erase them
  // instead") AND a direct Caleb ruling, on purpose: an {Unstable} unit that
  // dies passes THROUGH the bin, is trashed there, and is only then erased.
  // R244 changes what happens to its MODS and nothing else. If this reddens,
  // report #93 is open again and Dropslime is broken exactly as it was.
  const { h, A, hostId, mark } = moddedEnemyUnit(9200);
  assert.equal(ent(h, hostId)!.controller, A);
  withE(h, e => { e.destroy(e.entity(hostId)!, 'dies'); });

  const body = trashEvents(h, mark).filter(t => t.card === 'Good Whale');
  assert.equal(body.length, 1, 'the Unstable body is trashed exactly once');
  assert.equal(body[0]!.seat, A, 'and it is trashed by the seat whose bin it entered');
  assert.ok(h.log.some(l => l.includes('trashes Good Whale')),
    'and the trash is in the log, where report #93 could not find it');
  assert.ok(erasedOf(h, A).includes('Good Whale'), 'then erased, R137 step 4');
  assert.equal(binOf(h, A).filter(c => c === 'Good Whale').length, 0,
    'the bin is empty again before anybody can look');
});

test('R137 GUARD: the per-battle trashed ledger still counts an Unstable body', () => {
  // The other half of #93, and the half Dropslime reads: its damage is the
  // battle-wide `trashed` counter, not a per-seat one. Derived from the card,
  // not from the counter key, so the guard cannot drift from what the card
  // asks for.
  assert.ok(trashTextCards().includes('Dropslime'),
    'Dropslime is the card whose damage IS this counter');
  const { h, A, hostId } = moddedEnemyUnit(9201);
  const region = ent(h, hostId)!.region;
  let after = -1;
  withE(h, e => {
    const start = e.battleCounter(region, 'trashed');
    e.destroy(e.entity(hostId)!, 'dies');
    after = e.battleCounter(region, 'trashed') - start;
  });
  assert.equal(after, 1,
    'exactly one card was trashed by that death — the body, and NOT the mod as well');
  withE(h, e => {
    assert.equal(e.battleCounter(region, `trashed:${A}`) >= 1, true,
      'and it counted for the seat that lost the unit');
  });
});

// ── half 2: the erase is not a trash ────────────────────────────────────

test('R244: a nontoken mod erased with its Unstable host is not trashed at all', () => {
  const { h, A, D, hostId, mark } = moddedEnemyUnit(9202);
  withE(h, e => { e.destroy(e.entity(hostId)!, 'dies'); });

  const modTrashes = trashEvents(h, mark).filter(t => t.card === 'Ignis Sprite');
  assert.equal(modTrashes.length, 0,
    'report #129: the line "Rashi trashes Malformed Monstrosity" must not exist');
  assert.ok(!h.log.some(l => l.includes('trashes Ignis Sprite')),
    'and it is gone from the log too, which is where the owner read it');

  // it still GOES where the host goes — this is a change of what the departure
  // is called, not of whether the card leaves. ⚠ R250 §4 moved WHICH SEAT's
  // pile that is: zones follow control, and a mod's controller is its host's.
  assert.ok(erasedOf(h, A).includes('Ignis Sprite'),
    'the mod reaches the HOST CONTROLLER erased pile (R65 + R250)');
  assert.ok(!erasedOf(h, D).includes('Ignis Sprite'),
    'and not the mod owner one — R244 destination half is superseded');
  assert.equal(binOf(h, D).filter(c => c === 'Ignis Sprite').length, 0,
    'and it does not linger in a bin');
  assert.equal(binOf(h, A).filter(c => c === 'Ignis Sprite').length, 0,
    'in either bin');
  assert.ok(h.log.some(l => l.includes('Ignis Sprite is erased from the bin')),
    'the erase is still announced — the player is told what happened to it');
});

test('R244: Pull Under still trashes the mods it deliberately keeps binned', () => {
  // The one caller that suppresses the {Unstable} sweep (`keepBinned`) — "put
  // it and all of its mods into your bin". Those cards really do STAY in a
  // bin, so they really are trashed, and R244 does not touch them. This is why
  // the engine tests the SWEEP condition rather than special-casing the erase.
  const { h, D, hostId, mark } = moddedEnemyUnit(9203);
  withE(h, e => { e.destroy(e.entity(hostId)!, 'is deleted', { binTo: D, keepBinned: true }); });

  const trashes = trashEvents(h, mark);
  assert.ok(trashes.some(t => t.card === 'Good Whale' && t.seat === D),
    'the body is trashed into the caster bin');
  assert.ok(trashes.some(t => t.card === 'Ignis Sprite' && t.seat === D),
    'and so is the mod, because it stays there');
  assert.ok(binOf(h, D).includes('Good Whale') && binOf(h, D).includes('Ignis Sprite'),
    'both cards are still in the bin the card named');
});

// ── half 1: attribution follows the host ────────────────────────────────

test('R244: a mod trashed on a recall is trashed by the host controller, not by its owner', () => {
  // The route where a mod IS genuinely trashed: the host leaves for a hand, the
  // mod is left behind in a bin and STAYS there (R70, Caleb 2024-09-15). Before
  // R244 this said "Player 2 trashes Ignis Sprite" — the mod owner. It is part
  // of a unit under the other seat control, so it is that seat that trashed it.
  const { h, A, D, hostId, mark } = moddedEnemyUnit(9204);
  withE(h, e => { e.recall(e.entity(hostId)!); });

  const modTrashes = trashEvents(h, mark).filter(t => t.card === 'Ignis Sprite');
  assert.equal(modTrashes.length, 1, 'the mod is trashed exactly once');
  assert.equal(modTrashes[0]!.seat, A,
    'by the HOST controller — a mod is part of the unit it sits on');
  assert.notEqual(modTrashes[0]!.seat, D, 'and no longer by the mod owner');
  // ⚠ R250 §4 REVERSED R244's destination half. This block used to read "the
  // DESTINATION is untouched: a card still goes to its own owner bin". The
  // owner has since ruled the general form: *"Zones ALWAYS follow control. One
  // rule, no split. Whoever CONTROLLED the card at the moment it left play
  // gets it in their bin."* R244's ATTRIBUTION half — the two assertions above
  // — is what stands, and the title of this test is about that half.
  assert.ok(binOf(h, A).includes('Ignis Sprite'),
    'R250: the destination follows control too, so it lands in the trasher bin');
  assert.equal(binOf(h, D).filter(c => c === 'Ignis Sprite').length, 0,
    'the mod owner does not get their card back');
  assert.equal(modTrashes[0]!.binNth, 0,
    'and because the two seats now agree, the R131 bin ref is STAMPED');
});

test('R244: the per-seat trash ledger on a recall counts for the host controller', () => {
  // What actually moves at the table. "When you trash a card during battle,
  // Draw a card" (Muck Rummager) and "When you trash another card" (Murkstalker,
  // Cthyrian Rector, Murkdrop Distiller, Unrelenting Horror) all read
  // `ev.data.seat`; the counter is the same fact in ledger form.
  assert.ok(trashTextCards().includes('Muck Rummager'),
    'Muck Rummager is the card this counter is for');
  const { h, A, D, hostId } = moddedEnemyUnit(9205);
  const region = ent(h, hostId)!.region;
  let dHost = -1, dOwner = -1;
  withE(h, e => {
    const a0 = e.battleCounter(region, `trashed:${A}`);
    const d0 = e.battleCounter(region, `trashed:${D}`);
    e.recall(e.entity(hostId)!);
    dHost = e.battleCounter(region, `trashed:${A}`) - a0;
    dOwner = e.battleCounter(region, `trashed:${D}`) - d0;
  });
  assert.equal(dHost, 1, 'the host controller trashed a card');
  assert.equal(dOwner, 0, 'the mod owner did not');
});

test('R244: a cached host attributes its left-behind mods the same way a recalled one does', () => {
  // Same seam, the other caller of leavePlay + afterDespawn. Kept because the
  // two used to be one copy-paste apart (R153/CT-43) and this is exactly the
  // kind of change that fixes one and not the other.
  const { h, A, D, hostId, mark } = moddedEnemyUnit(9206);
  withE(h, e => { e.cacheUnit(e.entity(hostId)!); });
  const modTrashes = trashEvents(h, mark).filter(t => t.card === 'Ignis Sprite');
  assert.equal(modTrashes.length, 1);
  assert.equal(modTrashes[0]!.seat, A, 'the host controller, on the cache route too');
  assert.ok(binOf(h, A).includes('Ignis Sprite'), 'R250: and into that same seat bin');
  assert.ok(!binOf(h, D).includes('Ignis Sprite'), 'not the mod owner one');
});

test('R250 + R140: the bin ref names the copy just trashed, not the innocent older one', () => {
  // ⚠ THIS TEST REPLACES R244's HAZARD WITH R250's. R244 split the trasher
  // from the bin, so `noteTrashed` had to REFUSE to stamp a bin ref (counting
  // the name in a bin the card was not in would have answered with an innocent
  // older copy, and Cthyrian Rector — "recall THAT card from your bin" — would
  // have recalled it; that is R140 one seat over). R250 §4 closes the split:
  // the card really is in the trasher bin now, so the stamp is BACK, and the
  // whole question becomes whether it names the right copy.
  //
  // The older copy below is what makes the nth mean something. Get this wrong
  // and R140 is reopened by the fix that was supposed to make it unnecessary.
  const { h, A, D, hostId, mark } = moddedEnemyUnit(9207);
  h.state.players[A]!.bin.push('Ignis Sprite');           // an innocent older copy
  withE(h, e => { e.recall(e.entity(hostId)!); });

  const modTrashes = trashEvents(h, mark).filter(t => t.card === 'Ignis Sprite');
  assert.equal(modTrashes.length, 1);
  assert.equal(modTrashes[0]!.seat, A);
  assert.equal(binOf(h, A).filter(c => c === 'Ignis Sprite').length, 2,
    'two copies of the name are now in that bin');
  assert.equal(modTrashes[0]!.binNth, 1,
    'and the ref names the SECOND — the one just trashed, not the bystander');
  assert.ok(!binOf(h, D).includes('Ignis Sprite'),
    'the mod owner bin is not involved at all any more');
});

// ── the whole-pool sweep ────────────────────────────────────────────────

test('R244 whole pool: no nontoken mod is trashed by its host death, and the body always is', () => {
  // Derived over every card that can BE a nontoken mod (203 of them today),
  // not over the one card the report named. Three of them — the [Augment] "I
  // gain -X/-X" viruses, Malformed Monstrosity among them — shrink the host to
  // death the instant they land, which is the report position itself; they
  // reach the same disposal through checkDeaths and are counted there.
  const cards = moddable();
  assert.ok(cards.length > 150, `the derivation found only ${cards.length} moddable cards`);
  assert.ok(cards.includes('Malformed Monstrosity'), 'including the card from report #129');

  const modTrashed: string[] = [];
  const bodyNotTrashed: string[] = [];
  let checked = 0;
  for (const name of cards) {
    const h = new Harness(9208);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const hostId = spawn(h, A, 'Good Whale');
    withE(h, e => { e.attachMod(e.entity(hostId)!, name, D, 'augment'); });
    // the mod may have killed its host on the way in (the report position
    // itself) — then the disposal has already run, so read the whole window
    let mark = h.events.length;
    if (ent(h, hostId)) withE(h, e => { e.destroy(e.entity(hostId)!, 'dies'); });
    else mark = 0;
    checked++;
    const evs = trashEvents(h, mark);
    if (evs.some(t => t.card === name)) modTrashed.push(name);
    if (!evs.some(t => t.card === 'Good Whale')) bodyNotTrashed.push(name);
  }
  assert.equal(checked, cards.length, 'every candidate was actually exercised');
  assert.deepEqual(modTrashed, [],
    'R244: not one of them is trashed when it is erased with its host');
  assert.deepEqual(bodyNotTrashed, [],
    'R137 GUARD, whole pool: the body is trashed under every one of them');
});

test('R244 whole pool: every mod trashed on a recall is attributed to the host controller', () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const name of moddable()) {
    const h = new Harness(9209);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const hostId = spawn(h, A, 'Good Whale');
    withE(h, e => { e.attachMod(e.entity(hostId)!, name, D, 'augment'); });
    if (!ent(h, hostId)) continue;                 // the mod killed the host: not this route
    const mark = h.events.length;
    withE(h, e => { e.recall(e.entity(hostId)!); });
    checked++;
    const evs = trashEvents(h, mark).filter(t => t.card === name);
    if (evs.length !== 1 || evs[0]!.seat !== A) wrong.push(name);
  }
  assert.ok(checked > 150, `only ${checked} cards reached the recall route`);
  assert.deepEqual(wrong, [], 'every one of them is trashed by the host controller');
});

// ── report #121: Cosmic Reversal — RULED, and moved ────────────────────
//
// Two tests stood here. They PINNED the behaviour without blessing it: the
// card swept `g.s.stack` and never looked at the board, and its log could not
// tell a player what the sweep had considered. Both said in as many words that
// the reading was an owner call that had not been made.
//
// It has been made — **R250** (owner, 2026-08-29): *"It returns all spell
// effects on the stack … and recalls all spell units FROM THE BOARD."* So the
// pins are gone and the coverage lives with the rest of R250, in
// `test/229-cosmic-and-control.test.ts` §1, which asserts the ruled behaviour
// over the whole derived Spell Unit population instead of the one fixture.
// Nothing cited these two by name (checked against `playtest-ledger.ts` and
// `card-todo.ts` before removing them).
