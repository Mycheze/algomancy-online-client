/* R202 — THE EVENT CHANNEL LEAKED WHAT THE STATE CHANNEL HID.
 *
 * ── THE DEFECT
 *
 * `server/view.ts`'s own header states the contract: *"What is hidden from a
 * seat … the OPPONENT's hand contents -> count only (card backs)"*. `viewFor`
 * honours it, mapping every opposing hand card to `HIDDEN_CARD`.
 *
 * R179's `E.toHand` then added `handEntered`, carrying
 * `{ seat, from, cards: names, card: names[0], n }` — for EVERY route a card
 * takes into a hand: a draw, a bin recursion, a recall, an uncache, a pull off
 * the stack, a card taken out of an opponent's hand. `sendUpdate` ships raw
 * event objects, filtered only by `visibleToSeat` (which gates on
 * `data.privateTo`, a field `handEntered` never carried) and mapped by
 * `redactEvent` (which touched only `recycle`). So the same update that hid
 * nine card backs also carried the two names that had just gone in.
 *
 * ── WHY IT SURVIVED A WEEK
 *
 * `msg` is `''`, so nothing was ever VISIBLE — the leak had no log line to be
 * noticed in. But `ui/inspect.ts::namesInEvents` walks `data.cards[]` on
 * purpose, feeding `growCardLedger`, so the names were not merely on the wire:
 * they were being read by the client.
 *
 * ── WHY REDACTION AND NOT `privateTo`
 *
 * `toHand` DISPATCHES `handEntered` to card listeners inside a battle. Rider of
 * the Tides, Xenopod Progenitor and Galerider Eel all print *"whenever a card
 * enters a player's hand during battle"*. Suppressing the event engine-side
 * would silently kill three cards, so the fix is server-side and the count
 * survives — hand SIZE is already public from the card backs.
 *
 * ── §2 IS THE POINT
 *
 * §1 is the reported defect; §2 is the class. A per-event redaction rule is a
 * denylist, and a denylist rots the day a new event carries a secret — which
 * is precisely what R179 did to the one that existed. §2 asserts the INVARIANT
 * over every event the engine can emit about a hidden zone, so the next
 * `toHand`-shaped addition fails here instead of shipping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { E } from '../../engine/src/engine.ts';
import { Harness } from '../../engine/src/harness.ts';
import { redactEvent, viewFor, HIDDEN_CARD } from '../view.ts';
import type { EngineEvent, Seat } from '../../engine/src/types.ts';
import '../../engine/src/cards/registry.ts';

const NAMES = ['Ben', 'Opponent'];

/** every card name mentioned anywhere in an event's `data`, at any depth —
 *  the same reach `ui/inspect.ts::namesInEvents` has. */
function namesIn(ev: EngineEvent): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { out.push(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
  };
  walk(ev.data);
  return out;
}

/* ── §1. the reported defect, per route ──────────────────────────────────── */

for (const from of ['deck', 'bin', 'play', 'stack', 'cache', 'hand'] as const) {
  test(`R202 §1: a card entering the opponent's hand from the ${from} is not named to the other seat`, () => {
    const h = new Harness(4242);
    const e = new E(h.state);
    const secret = ['Rampart Guardian', 'Retribution Thing'];
    const before = e.events.length;
    e.toHand(1, secret, from);

    const mine = e.events.slice(before).filter(x => x.type === 'handEntered');
    assert.equal(mine.length, 1, 'fixture: exactly one handEntered to inspect');

    // the owning seat still sees everything
    const own = redactEvent(mine[0]!, 1, NAMES);
    assert.deepEqual(own.data?.['cards'], secret,
      'seat 1 must still be told what seat 1 drew — redaction is one-directional');

    // the other seat sees the COUNT and nothing else
    const theirs = redactEvent(mine[0]!, 0, NAMES);
    for (const s of secret) {
      assert.ok(!namesIn(theirs).includes(s),
        `"${s}" reached the opponent through the EVENT channel while viewFor was `
        + 'hiding the very same card behind a card back');
    }
    assert.equal(theirs.data?.['n'], 2,
      'the COUNT stays: hand size is already public from the card backs, and three '
      + 'cards print "whenever a card enters a player\'s hand during battle"');
    assert.equal(theirs.data?.['seat'], 1, 'and whose hand it was stays public too');
  });
}

test('R202 §1: the state channel and the event channel now agree about one hand', () => {
  const h = new Harness(4242);
  const e = new E(h.state);
  const before = e.events.length;
  e.toHand(1, ['Rampart Guardian'], 'deck');

  const hand = viewFor(h.state, 0).players[1]!.hand;
  assert.ok(hand.every(c => c === HIDDEN_CARD),
    'fixture: the state channel really is hiding seat 1\'s hand');

  const leaked = e.events.slice(before)
    .map(x => redactEvent(x, 0, NAMES))
    .flatMap(namesIn)
    .filter(n => n === 'Rampart Guardian');
  assert.deepEqual(leaked, [],
    'the two channels disagreed: viewFor drew nine card backs and the event stream '
    + 'in the SAME update named what had just gone in');
});

/* ── §2. the class: no event may name a card in a zone viewFor hides ─────── */

test('R202 §2: no event names a card in a zone the state channel hides — the invariant, not the instance', () => {
  const h = new Harness(4242);
  const e = new E(h.state);

  // Every route a secret can travel. A new one added later without a redaction
  // arm fails HERE rather than shipping, which is the whole point of §2: a
  // per-event rule is a denylist, and R179 is what a denylist rots against.
  const secret = 'Rampart Guardian';
  const before = e.events.length;
  e.toHand(1, [secret], 'deck');
  e.toHand(1, [secret], 'bin');
  e.toHand(0, [secret], 'deck');   // control: MY hand, must stay visible to me

  const offenders: string[] = [];
  for (const ev of e.events.slice(before)) {
    for (const viewer of [0, 1] as Seat[]) {
      const owner = ev.data?.['seat'];
      if (typeof owner !== 'number' || owner === viewer) continue;   // own zone is public to its owner
      if (namesIn(redactEvent(ev, viewer, NAMES)).includes(secret)) {
        offenders.push(`${ev.type} names a card in seat ${owner}'s hidden zone to seat ${viewer}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'an event carried a card name out of a zone viewFor hides. Either give it a '
    + 'redactEvent arm, or (if the card is genuinely public, like a reveal) say so '
    + 'here — deliberately, not by omission.');

  // and the control really is a control
  const own = e.events.slice(before)
    .filter(x => x.data?.['seat'] === 0)
    .flatMap(x => namesIn(redactEvent(x, 0, NAMES)));
  assert.ok(own.includes(secret), 'seat 0 must still be told what seat 0 drew');
});
