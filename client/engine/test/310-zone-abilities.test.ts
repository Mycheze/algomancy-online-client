/**
 * A `zone:` CLAUSE IS NOT LIVE FROM PLAY — R51's missing half.
 *
 * `zone: 'bin' | 'cache'` says a triggered ability only exists while the card
 * SITS in that zone: "When you deal combat damage to an opponent, **if I am in
 * your bin**, recall me." `fireZoneTriggers` is the dispatcher built for it and
 * it gates on the card actually being there. But `fireEvent`'s OTHER scan —
 * the one that walks the entities in play — called `collectTriggersFrom`,
 * which checked `events`, `self` and suppression and never looked at `zone`.
 * So every zone clause in the pool ALSO fired off the battlefield, where its
 * own printed condition is false by construction.
 *
 * ── WHY IT HID FOR SO LONG ───────────────────────────────────────────
 *
 * Because the effects re-derive the zone by NAME when they resolve, and
 * mostly find nothing. Measured 2026-09-20, before the fix: Lurking Dread
 * attacking with an EMPTY bin and an EMPTY cache pushed BOTH of its zone
 * abilities onto the after-combat stack, and both fizzled with "it is no
 * longer in a bin or cache — nothing happens". Harmless, invisible, and wrong.
 *
 * Cinder Scuttler is the one where the re-check saves nothing, because between
 * the false trigger and its resolution the card legitimately ARRIVES in the
 * bin. It attacks; its body hears `combatFaceDamage` from play and queues
 * "recall me from your bin"; R261 holds the batch to the after-combat stack;
 * the blocker kills it in the meantime; `bin.lastIndexOf` then finds it and
 * recalls the card out of the combat that killed it. That is the Discord
 * report this file answers.
 *
 * ── WHAT THIS FILE DOES NOT TEST ─────────────────────────────────────
 *
 * The combat damage step, which was never at fault and is not touched. Owner,
 * 2026-09-20: *"If there is no Swift or Sluggish in combat, then it's
 * impossible for Cinder Scuttler to die to combat damage and be returned at
 * the same moment since, technically, it's not in the bin when the damage is
 * dealt."* The engine already ordered it that way — `checkDeaths()` runs after
 * the sub-step returns (R3, no priority window), the trigger queue is held
 * across sub-steps and drains after combat (R261), and R295 gives a split
 * damage step its reaction windows. §3 and §4 are the two halves of that
 * ruling, and §4 is the one that proves this fix did not over-correct.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import {
  ent, finishBattle, pass, resolveAfterCombat, spawn, toDeployment, toNextBattle,
} from './util.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';

/** every card carrying a zone-scoped triggered ability, derived not listed —
 * a card added tomorrow is covered without editing this file */
function zoneAbilityCards(): { card: string; zone: string; events: string[] }[] {
  const out: { card: string; zone: string; events: string[] }[] = [];
  for (const name of allCardNames()) {
    for (const a of getCard(name).abilities ?? []) {
      if (a.type === 'triggered' && a.zone) out.push({ card: name, zone: a.zone, events: [...a.events] });
    }
  }
  return out;
}

/** the seat's own region, which every zone event below is scoped to (R12) */
function withRegion(h: Harness, seat: Seat): number {
  return new E(h.state).homeRegion(seat);
}

test('§1 the pool still has zone clauses for §2 to be about', () => {
  const found = zoneAbilityCards();
  console.log(`    ${found.length} zone-scoped clause(s):`);
  for (const z of found) console.log(`      ${z.card} — zone ${z.zone}, on ${z.events.join('/')}`);
  assert.ok(found.length >= 5,
    'the zone-trigger census collapsed — this guard may be testing nothing');
  // the ones that can stand on a battlefield are the ones §2/§3 are about
  const units = found.filter(z => getCard(z.card).kind === 'unit').map(z => z.card);
  assert.ok(units.includes('Cinder Scuttler') && units.includes('Lurking Dread'),
    'the two measured cases are still units and still reachable');

  // ⚠ THE ONE DISPATCHER THIS FIX DOES NOT GATE. `fireOwnTrashTrigger` (R40)
  // fires `self: true` clauses for a card that is BEING trashed, off its own
  // stand-in, and it reads `card.abilities` directly rather than through
  // `collectTriggersFrom` — so the `zone` gate does not run there. Today that
  // is harmless because no zone clause listens for a trash event: the
  // enter-the-bin cards (Sacrifice Dude, Blightwalker) carry no `zone`, and
  // the zone clauses listen for combat, deployment and `leftBin`.
  //
  // It is asserted rather than reasoned about, because the day someone writes
  // `zone: 'bin'` on a `trashed` clause the question becomes real — does a
  // card ARRIVING in the bin satisfy "if I am in your bin"? — and it should be
  // answered by the owner then, not discovered as a second leak.
  const TRASH_EVENTS = ['trashed', 'died', 'discarded'];
  const trashy = zoneAbilityCards().filter(z => z.events.some(e => TRASH_EVENTS.includes(e)));
  assert.deepEqual(trashy, [],
    'a zone-scoped clause now listens for a trash-family event, which is dispatched by '
    + 'fireOwnTrashTrigger — a path the zone gate does not cover. Decide whether arriving '
    + 'in the bin counts as being in it, then gate that dispatcher too.');
});

/**
 * Fire one event at the board and report every trigger it queued that belongs
 * to `card`. Whitebox on purpose: §2 is about the LISTENER SCAN, and driving a
 * real game to each of five different events would test the drivers instead.
 *
 * ⚠ `seat` on the event is the card owner's OPPONENT. Cinder Scuttler's `when`
 * is `ev.data.seat !== self.controller` ("you dealt damage to an OPPONENT"), so
 * an event naming the owner's own seat is refused by the clause before the zone
 * is ever consulted — and a negative assertion that passes because `when` said
 * no proves nothing about this fix. The first draft of this sweep hardcoded
 * `seat: 1` and was vacuous for whichever seat won initiative.
 */
/**
 * WHERE THE CARD MUST BE, and WHAT THE EVENT MUST SAY, for one clause to be
 * given its fair chance. Two shapes, because R124 made `leftBin` an inversion:
 * its subject has ALREADY left the bin, so the event itself carries the card
 * and the bin is empty — presence-in-the-bin is exactly the wrong test there,
 * and `fireZoneTriggers` says so in as many words.
 */
function probeFor(card: string, zone: string, type: string, owner: Seat, region: number):
{ data: Record<string, unknown>; place: 'bin' | 'cache' | 'gone' } {
  if (type === 'leftBin') return { data: { card, seat: owner, region }, place: 'gone' };
  // everything else: an opponent-facing combat event, which is what the
  // `when` guards in this family read (`seat !== self.controller`)
  return { data: { region, seat: (1 - owner) as Seat, why: 'combat', n: 1 }, place: zone as 'bin' | 'cache' };
}

function queuedFor(h: Harness, card: string, data: Record<string, unknown>, type: string): string[] {
  // ⚠ NOT `withE`, which ends in `settle()` — and settle DRAINS the queue, so
  // reading it afterwards finds [] whatever happened. The first draft did that
  // and both halves of this sweep passed on an empty queue: the negative
  // vacuously, the positive by failing loudly, which is the only reason it was
  // caught. `fireEvent` deliberately never processes the queue ("that happens
  // at safe points via settle()"), so the dispatch is observable only here,
  // between the two.
  const e = new E(h.state);
  e.s.triggerQueue = [];
  e.fireEvent(type as Parameters<E['fireEvent']>[0],
    e.ev(type as Parameters<E['ev']>[0], '', data));
  return (e.s.triggerQueue ?? []).filter(t => t.sourceCard === card).map(t => t.label);
}

test('§2 SWEEP: no zone clause fires from play, and every one still fires from its zone', () => {
  // The owner's question, asked of the whole census rather than of the two
  // cards that were measured: "Cards that are only supposed to trigger while
  // in the bin or the cache now don't function when in play? Cinder Scuttler
  // can ONLY trigger when in the bin. Lurking Dread can ONLY be activated from
  // the bin or cache."
  //
  // BOTH halves, per clause, and THE SAME EVENT for each — same type, same
  // region, same seats, same data. The card's LOCATION is the only variable
  // between them, so "silent in play" and "fires from the zone" together say
  // the location is what decides it. Either half alone would be satisfied by a
  // clause that simply never fires.
  const rows: string[] = [];
  for (const { card, zone, events } of zoneAbilityCards()) {
    for (const type of events) {
      // ── in play (units only — a spell is never an entity on the board)
      //
      // ⚠ EXCEPT `leftBin`, where there is nothing to assert. R124 inverted it:
      // the event NAMES the card that left this seat's bin, so the event is
      // itself the qualifying condition and a copy standing in play is beside
      // the point — one Rotling on the board and another leaving the bin is a
      // real position, and the one that left is the one that fires. Firing it
      // at an in-play body and demanding silence would be asserting that a
      // legitimate trigger does not work.
      if (type === 'leftBin') {
        rows.push(`      ${card} on ${type}: in play -> n/a (R124: the event is the condition)`);
      } else if (getCard(card).kind === 'unit') {
        const h = new Harness(1213);
        toDeployment(h);
        const A = h.state.initiative;
        const region = withRegion(h, A);
        const probe = probeFor(card, zone, type, A, region);
        spawn(h, A, card as Parameters<typeof spawn>[2]);
        h.state.players[A]!.bin = [];
        h.state.players[A]!.cache = [];
        const fired = queuedFor(h, card, probe.data, type);
        rows.push(`      ${card} on ${type}: in play -> ${fired.length ? 'FIRED ' + fired.join('; ') : 'silent'}`);
        assert.deepEqual(fired, [],
          `${card}'s ${zone} clause fired while the card was ON THE BATTLEFIELD, where its `
          + 'own printed condition ("if I am in your bin") is false');
      }
      // ── the same event again, with the card where the clause says it lives
      const h2 = new Harness(1213);
      toDeployment(h2);
      const A2 = h2.state.initiative;
      const region2 = withRegion(h2, A2);
      const probe2 = probeFor(card, zone, type, A2, region2);
      if (probe2.place === 'bin') h2.state.players[A2]!.bin = [card as Parameters<typeof spawn>[2]];
      else if (probe2.place === 'cache') h2.state.players[A2]!.cache = [{ card: card as Parameters<typeof spawn>[2] } as never];
      const fromZone = queuedFor(h2, card, probe2.data, type);
      rows.push(`      ${card} on ${type}: ${probe2.place === 'gone' ? 'just left the bin' : 'in ' + probe2.place} -> ${fromZone.length ? 'fires' : 'SILENT'}`);
      assert.ok(fromZone.length > 0,
        `${card} did not fire from the ${zone} on ${type} — the fix has silenced the clause `
        + 'outright instead of confining it to its zone, which is the over-correction this '
        + 'half exists to catch');
    }
  }
  console.log(rows.join('\n'));
});

test('§3 Cinder Scuttler does NOT recall off the damage step it died in', () => {
  // The report. No Swift, no Sluggish: ONE damage step, so the Scuttler is on
  // the board when the face damage is dealt and its bin clause is simply false.
  const h = new Harness(1213);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const scut = spawn(h, A, 'Cinder Scuttler');   // 2/1, will be blocked and die
  const beater = spawn(h, A, 'Good Whale');      // 7/5, will go unblocked
  const blocker = spawn(h, D, 'Good Whale');     // kills the Scuttler outright
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[scut], [beater]] });
  const inHand = (): number => h.state.players[A]!.hand.filter(c => c === 'Cinder Scuttler').length;
  const inBin = (): number => h.state.players[A]!.bin.filter(c => c === 'Cinder Scuttler').length;
  const before = inHand();
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);
  resolveAfterCombat(h);
  assert.equal(ent(h, scut), undefined, 'it died in that damage step');
  assert.ok(h.state.players[D]!.life < 30, 'and the beater connected in the SAME step');
  // the ordering that makes this the right answer, asserted rather than assumed
  const iFace = h.events.findIndex(e => e.type === 'combatFaceDamage');
  const iDied = h.events.findIndex(e => e.type === 'died' && e.data?.['card'] === 'Cinder Scuttler');
  assert.ok(iFace !== -1 && iDied !== -1 && iFace < iDied,
    'combat damage is dealt, THEN state-based actions kill — the Scuttler was still on '
    + 'the board when the damage it would trigger off was dealt');
  assert.equal(inHand(), before, 'so it is not recalled');
  assert.equal(inBin(), 1, 'it stays in the bin');
  finishBattle(h);
});

test('§4 but a Swift unit bins it BEFORE the normal step — then it does recall', () => {
  // The owner's own counter-example, and the proof this fix did not
  // over-correct into "a Scuttler that died this combat can never come back":
  //   "So if Scuttler dies at the hands of a Swift unit, then in the normal
  //    combat damage step the owner deals combat damage to an opponent, yes,
  //    Cinder Scuttler will trigger and be recalled during the After Combat
  //    phase. But that's only possible since the Swift unit puts it into the
  //    bin before other damage happens."
  const h = new Harness(1213);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const scut = spawn(h, A, 'Cinder Scuttler');
  const beater = spawn(h, A, 'Good Whale');
  const swift = spawn(h, D, 'Flowstone Arcanite');   // 1/3 {Swift} — strikes a step early
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[scut], [beater]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [swift] } });
  // R295: a split damage step is several steps with a real reaction window
  // between them, so priority has to be driven through it.
  for (let i = 0; i < 40 && h.state.phase === 'battle' && !h.state.decision; i++) pass(h);
  assert.equal(ent(h, scut), undefined, 'the Swift blocker killed it in the Swift sub-step');
  const iDied = h.events.findIndex(e => e.type === 'died' && e.data?.['card'] === 'Cinder Scuttler');
  const iFace = h.events.findIndex(e => e.type === 'combatFaceDamage');
  assert.ok(iDied !== -1 && iFace !== -1 && iDied < iFace,
    'this time the death comes FIRST — a different damage step from the face damage');
  assert.equal(h.state.players[A]!.hand.filter(c => c === 'Cinder Scuttler').length, 1,
    'it really was in the bin when the normal step connected, so it recalls');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Cinder Scuttler').length, 0,
    'and has left the bin');
});
